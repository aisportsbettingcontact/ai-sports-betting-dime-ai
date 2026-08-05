import type { Request, RequestHandler, Response } from "express";
import { ipKeyGenerator } from "express-rate-limit";

/**
 * Procedure-aware tRPC rate-limit classification (AUTH-004 generalized).
 *
 * The client uses httpBatchLink, so tRPC calls arrive as a comma-separated
 * procedure list: `/api/trpc/appUsers.login,appUsers.me?batch=1`. An Express
 * path-prefix mount (`app.use("/api/trpc/appUsers.login", limiter)`) only
 * matches when the mount is followed by end-of-path or "/" — a comma breaks
 * the match, so appending ANY second procedure evaded the limiter entirely.
 * This was fixed for the Stripe checkout procedures (2026-05-24 forensics) but
 * remained open for the login and waitlist mounts. All procedure-scoped
 * limiters now dispatch through this one classifier.
 *
 * Keying note for the limiters this dispatch feeds: when mounted at
 * `/api/trpc`, `req.path` is the FULL comma list, so a limiter key derived
 * from the path would let an attacker mint a fresh budget per batch
 * composition (`login,me` vs `login,foo`, …). Limiter keys are therefore
 * class-stable (`ip:<class>`) and IP-derived via `clientIpKey`, never
 * path-derived.
 */

export type TrpcLimiterClass =
  "auth" | "stripe_checkout" | "waitlist" | "public_feed";

/**
 * Strictest-first: a mixed batch takes the most sensitive class present.
 * `public_feed` is last (least strict) — a batch mixing a feed read with a
 * login attempt is governed by the login (auth) budget.
 */
const CLASS_PRIORITY: readonly TrpcLimiterClass[] = [
  "auth",
  "stripe_checkout",
  "waitlist",
  "public_feed",
];

/**
 * Classes that fail OPEN if their limiter throws: the feed is the product, so
 * a limiter defect must degrade to "allow", never to a 5xx outage. Auth and
 * checkout fail CLOSED (a limiter fault there blocks, not passes).
 */
const FAIL_OPEN_CLASSES: ReadonlySet<TrpcLimiterClass> =
  new Set<TrpcLimiterClass>(["public_feed"]);

export const TRPC_PROCEDURE_CLASSES: ReadonlyMap<string, TrpcLimiterClass> =
  new Map([
    // Login brute-force boundary — 5/15min/IP (trpcAuthLimiter)
    ["appUsers.login", "auth"],
    ["auth.login", "auth"],
    // Password-reset surface (public, unauthenticated): per-IP protection on
    // top of requestPasswordReset's per-identifier limiter — closes the
    // rotate-identifiers email-bomb vector; resetPassword adds an IP ceiling
    // above its token entropy.
    ["appUsers.requestPasswordReset", "auth"],
    ["appUsers.resetPassword", "auth"],
    // Unauthenticated checkout surface — 10/15min/IP (stripeCheckoutLimiter)
    ["stripe.publicCreateCheckoutSession", "stripe_checkout"],
    ["stripe.publicCreateEmbeddedCheckoutSession", "stripe_checkout"],
    ["stripe.publicAttachCheckoutIdentity", "stripe_checkout"],
    ["stripe.getCheckoutSessionUser", "stripe_checkout"],
    ["stripe.completeAccountSetup", "stripe_checkout"],
    // Public form endpoint — 5/15min/IP (waitlistSubmitLimiter, DB-006)
    ["waitlist.submit", "waitlist"],
    // Public feed reads — the scraper hot path (feedProcedureLimiter, fail-open)
    ["games.list", "public_feed"],
    ["games.getCurrentDate", "public_feed"],
    ["games.getAvailableDates", "public_feed"],
    ["games.lastRefresh", "public_feed"],
    ["wc2026.matchesByDate", "public_feed"],
  ]);

/**
 * `/a.b,c.d` (path relative to the /api/trpc mount) → `["a.b", "c.d"]`.
 *
 * Percent-DECODES the whole path before splitting on comma, mirroring tRPC's
 * own `decodeURIComponent(path).split(",")` order. Without this, an attacker
 * could encode a single character of a rate-limited procedure name
 * (`appUsers.logi%6E`, or an encoded comma `login%2Cx`) so the classifier sees
 * no match and applies NO limiter, while tRPC decodes and EXECUTES
 * `appUsers.login` — the AUTH-004 evasion class via URL-encoding. A malformed
 * `%` sequence is left as-is: `decodeURIComponent` and tRPC both reject it, so
 * no procedure executes and passing it through unclassified is safe.
 */
export function parseTrpcProcedureList(path: string): string[] {
  let raw = path.replace(/^\//, "");
  try {
    raw = decodeURIComponent(raw);
  } catch {
    /* malformed percent-encoding — tRPC 404s it; classify the raw form */
  }
  return raw
    .split(",")
    .map(p => p.trim())
    .filter(Boolean);
}

/** Most sensitive class present in the batch, or null when none match. */
export function classifyTrpcProcedures(
  procedures: string[]
): TrpcLimiterClass | null {
  const present = new Set<TrpcLimiterClass>();
  for (const proc of procedures) {
    const cls = TRPC_PROCEDURE_CLASSES.get(proc);
    if (cls) present.add(cls);
  }
  for (const cls of CLASS_PRIORITY) {
    if (present.has(cls)) return cls;
  }
  return null;
}

/**
 * IPv6-normalized true-client key for rate limiters.
 *
 * Railway's edge sanitizes inbound `X-Forwarded-For` (verified in production
 * 2026-08-05: an injected XFF is discarded) and rewrites it as
 * `[trueClient, railwayEdgeInternal]`. Express `req.ip` under
 * `trust proxy = 1` resolves to the RIGHTMOST entry — the Railway edge node,
 * which rotates per connection (152.233.x.x) — so keying on `req.ip` both
 * multiplied the per-client budget (one client across N edge nodes) and let
 * unrelated clients behind one edge node share a budget. The true client is
 * the LEFTMOST sanitized entry. Global `trust proxy` is left at 1 on purpose:
 * raising it also shifts `x-forwarded-proto` resolution and would risk the
 * secure-cookie / `req.protocol` path — this fix is scoped to limiter keys.
 * `ipKeyGenerator` is mandatory for IPv6 /56 normalization (express-rate-limit
 * v8 throws ERR_ERL_KEY_GEN_IPV6 on a raw address).
 */
export function clientIpKey(req: Pick<Request, "headers" | "ip">): string {
  const xff = req.headers?.["x-forwarded-for"];
  const first = (Array.isArray(xff) ? xff[0] : xff)?.split(",")[0]?.trim();
  return ipKeyGenerator(first || req.ip || "");
}

/** True when the request targets a tRPC procedure (stable across mount depth). */
export function isTrpcRequest(req: Pick<Request, "originalUrl">): boolean {
  return (req.originalUrl ?? "").startsWith("/api/trpc");
}

type TrpcErrorEntry = {
  error: {
    json: {
      message: string;
      code: number;
      data: { code: string; httpStatus: number };
    };
  };
};

/**
 * A tRPC httpBatchLink error envelope for a rate-limited batch: one
 * TOO_MANY_REQUESTS entry per procedure so the client surfaces a typed
 * `TRPCClientError` per call instead of a JSON-parse failure → generic toast.
 * tRPC v11 maps TOO_MANY_REQUESTS to JSON-RPC code -32029 / HTTP 429.
 */
export function trpcRateLimitEnvelope(
  procedureCount: number,
  message = "Too many requests. Please slow down and try again shortly."
): TrpcErrorEntry[] {
  const n = Math.max(1, procedureCount);
  const entry: TrpcErrorEntry = {
    error: {
      json: {
        message,
        code: -32029,
        data: { code: "TOO_MANY_REQUESTS", httpStatus: 429 },
      },
    },
  };
  return Array.from({ length: n }, () => entry);
}

/**
 * Send a 429 that the caller can actually parse: a tRPC batch envelope for
 * `/api/trpc` requests, a plain `{ error }` object for everything else. The
 * `RateLimit-*`/`Retry-After` headers set by express-rate-limit are preserved.
 */
export function sendRateLimitResponse(
  req: Pick<Request, "originalUrl" | "path">,
  res: Response,
  message: string
): void {
  if (isTrpcRequest(req)) {
    const count = parseTrpcProcedureList(req.path ?? "").length;
    res.status(429).json(trpcRateLimitEnvelope(count, message));
    return;
  }
  res.status(429).json({ error: message });
}

/**
 * Single dispatch middleware for `/api/trpc`: classifies the batch and hands
 * the request to exactly one class limiter; unclassified batches pass through.
 *
 * Fail-open classes (`public_feed`) never turn a limiter fault into a 5xx: the
 * feed is the product. express-rate-limit wraps its middleware in an async
 * function, so a real store/keygen fault surfaces as a REJECTED PROMISE (or
 * `next(error)`), never a synchronous throw — so we guard BOTH: a sync throw
 * and a promise rejection both degrade to "allow" (with an observability log).
 * Note: the feed limiter also sets `passOnStoreError: true`, so a store fault
 * fails open natively inside express-rate-limit before reaching this guard.
 * Fail-closed classes (auth/checkout/waitlist) propagate faults unchanged.
 */
export function createTrpcRateLimitDispatch(
  limiters: Record<TrpcLimiterClass, RequestHandler>
): RequestHandler {
  return (req, res, next) => {
    const cls = classifyTrpcProcedures(parseTrpcProcedureList(req.path));
    if (!cls) return next();
    if (!FAIL_OPEN_CLASSES.has(cls)) {
      return limiters[cls](req, res, next);
    }
    const allowThrough = (err: unknown) => {
      // Observable: a degraded fail-open limiter must not be silent.
      console.warn(
        `[RateLimit][${cls.toUpperCase()}] FAIL_OPEN — limiter fault, request allowed:`,
        err instanceof Error ? err.message : String(err)
      );
      if (!res.headersSent) next();
    };
    try {
      const result = limiters[cls](req, res, next) as unknown;
      if (result && typeof (result as Promise<unknown>).catch === "function") {
        (result as Promise<unknown>).catch(allowThrough);
      }
      return result as void;
    } catch (err) {
      return allowThrough(err);
    }
  };
}
