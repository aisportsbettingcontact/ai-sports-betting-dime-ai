import type { RequestHandler } from "express";

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
 * composition (`login,me` vs `login,foo`, …). Limiter keys must therefore be
 * class-stable (`ip:<class>`), never path-derived.
 */

export type TrpcLimiterClass = "auth" | "stripe_checkout" | "waitlist";

/** Strictest-first: a mixed batch takes the most sensitive class present. */
const CLASS_PRIORITY: readonly TrpcLimiterClass[] = [
  "auth",
  "stripe_checkout",
  "waitlist",
];

export const TRPC_PROCEDURE_CLASSES: ReadonlyMap<string, TrpcLimiterClass> =
  new Map([
    // Login brute-force boundary — 5/15min/IP (trpcAuthLimiter)
    ["appUsers.login", "auth"],
    ["auth.login", "auth"],
    // Unauthenticated checkout surface — 10/15min/IP (stripeCheckoutLimiter)
    ["stripe.publicCreateCheckoutSession", "stripe_checkout"],
    ["stripe.publicCreateEmbeddedCheckoutSession", "stripe_checkout"],
    ["stripe.publicAttachCheckoutIdentity", "stripe_checkout"],
    ["stripe.getCheckoutSessionUser", "stripe_checkout"],
    ["stripe.completeAccountSetup", "stripe_checkout"],
    // Public form endpoint — 5/15min/IP (waitlistSubmitLimiter, DB-006)
    ["waitlist.submit", "waitlist"],
  ]);

/** `/a.b,c.d` (path relative to the /api/trpc mount) → `["a.b", "c.d"]`. */
export function parseTrpcProcedureList(path: string): string[] {
  return path
    .replace(/^\//, "")
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
 * Single dispatch middleware for `/api/trpc`: classifies the batch and hands
 * the request to exactly one class limiter; unclassified batches pass through.
 */
export function createTrpcRateLimitDispatch(
  limiters: Record<TrpcLimiterClass, RequestHandler>
): RequestHandler {
  return (req, res, next) => {
    const cls = classifyTrpcProcedures(parseTrpcProcedureList(req.path));
    if (!cls) return next();
    return limiters[cls](req, res, next);
  };
}
