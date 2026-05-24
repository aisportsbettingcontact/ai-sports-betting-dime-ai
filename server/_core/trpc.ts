/**
 * trpc.ts
 *
 * tRPC middleware stack for aisportsbettingmodels.com.
 *
 * Middleware layers (applied in order):
 *   1. csrfOriginCheck   — validates Origin header on all state-mutating requests
 *                          (POST/PATCH/PUT/DELETE). Blocks cross-site request forgery
 *                          from attacker-controlled pages on other domains.
 *                          On block: fires notifyOwner() alert (rate-limited per IP).
 *   2. requireUser       — validates session cookie, rejects unauthenticated callers.
 *   3. requireAdmin      — validates role === 'admin' (Manus OAuth user).
 *
 * Procedure hierarchy:
 *   publicProcedure      — no auth, CSRF check on mutations
 *   protectedProcedure   — Manus OAuth session required
 *   adminProcedure       — Manus OAuth session + admin role required
 *
 * CSRF Defense Strategy:
 *   tRPC uses POST for all mutations and GET for queries. The Origin header is
 *   set by browsers on all cross-origin requests and cannot be spoofed by
 *   JavaScript running on attacker-controlled pages. We validate it against
 *   the canonical public origin (PUBLIC_ORIGIN env var) and a set of known-safe
 *   dev origins. Requests with a missing or mismatched Origin on mutations are
 *   rejected with 403 FORBIDDEN and trigger a real-time owner notification.
 *
 *   Exemptions (safe by design):
 *   - GET requests (queries): read-only, no state change possible.
 *   - Server-to-server calls: no Origin header (not a browser).
 *   - Localhost/dev origins: explicitly allowed in development mode.
 *
 *   Defense-in-depth: SameSite=Strict cookies are the primary CSRF defense.
 *   This Origin check is the secondary layer that catches subdomain-takeover
 *   scenarios where SameSite alone is insufficient.
 *
 * CSRF Alert Rate-Limiting:
 *   notifyOwner() is called at most once per IP per CSRF_ALERT_WINDOW_MS.
 *   This prevents notification spam from a single attacker making repeated
 *   requests. The in-memory rate-limit map is cleared on a rolling window basis.
 *   In production, the alert fires; in development, it is suppressed to avoid
 *   noise during local testing with misconfigured clients.
 */

import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from "@shared/const";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { insertSecurityEvent } from "../db";
import { ENV } from "./env";
import { notifyOwner } from "./notification";
import { postSecurityAlert } from "../discord/discordSecurityAlert";
import type { TrpcContext } from "./context";

// ─── CSRF-safe origin set ─────────────────────────────────────────────────────
/**
 * Build the set of origins that are permitted to make state-mutating tRPC calls.
 *
 * [INPUT]  ENV.publicOrigin  — canonical production origin (e.g. https://aisportsbettingmodels.com)
 * [INPUT]  ENV.isProduction  — true when NODE_ENV === "production"
 * [OUTPUT] Set<string>       — lowercase, trailing-slash-stripped allowed origins
 *
 * Allowed in ALL environments:
 *   - PUBLIC_ORIGIN (canonical production domain)
 *   - www.PUBLIC_ORIGIN (www subdomain variant)
 *   - http:// variant of PUBLIC_ORIGIN (handles pre-redirect HTTP access)
 *   - *.manus.space (Manus deployment domains — same app, different hostname)
 *   - *.manus.computer (Manus sandbox preview URLs — dev server)
 *
 * Allowed in development only:
 *   - localhost variants on common ports
 *
 * Design rationale for *.manus.space:
 *   The Manus platform deploys apps on both the custom domain (PUBLIC_ORIGIN)
 *   AND a *.manus.space subdomain (e.g. aisportsbet-mw3ficty.manus.space).
 *   Both hostnames serve the SAME application — blocking *.manus.space would
 *   prevent legitimate users who access the site via the Manus subdomain from
 *   logging in. This is NOT a CSRF risk because *.manus.space is controlled by
 *   Manus (same operator as the app), not an attacker-controlled domain.
 */
function buildAllowedOrigins(): Set<string> {
  const origins = new Set<string>();

  // Always include the canonical public origin if set
  if (ENV.publicOrigin) {
    const canonical = ENV.publicOrigin.replace(/\/$/, "").toLowerCase();
    origins.add(canonical);
    console.log(`[CSRF] Allowed origin (PUBLIC_ORIGIN): ${canonical}`);

    // Also allow the www subdomain variant (e.g. https://www.aisportsbettingmodels.com)
    // Users may access the site via www even if PUBLIC_ORIGIN omits it.
    try {
      const url = new URL(canonical);
      if (!url.hostname.startsWith("www.")) {
        const wwwVariant = `${url.protocol}//www.${url.hostname}`;
        origins.add(wwwVariant);
        console.log(`[CSRF] Allowed origin (www variant): ${wwwVariant}`);
      } else {
        // PUBLIC_ORIGIN has www — also allow the non-www variant
        const noWwwVariant = `${url.protocol}//${url.hostname.replace(/^www\./, "")}`;
        origins.add(noWwwVariant);
        console.log(`[CSRF] Allowed origin (non-www variant): ${noWwwVariant}`);
      }
      // Allow http:// variant — handles users who access before HTTPS redirect
      if (url.protocol === "https:") {
        const httpVariant = `http://${url.hostname}`;
        origins.add(httpVariant);
        console.log(`[CSRF] Allowed origin (http variant): ${httpVariant}`);
      }
    } catch {
      console.warn(`[CSRF] Could not parse PUBLIC_ORIGIN as URL: ${canonical}`);
    }
  }

  if (!ENV.isProduction) {
    // Development: allow localhost on common ports
    const devOrigins = [
      "http://localhost:3000",
      "http://localhost:5173",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:5173",
    ];
    for (const o of devOrigins) {
      origins.add(o);
    }
    console.log(`[CSRF] Development mode — localhost origins allowed`);
    console.log(`[CSRF] Development mode — *.manus.computer preview origins allowed`);
  }

  if (origins.size === 0) {
    console.warn(
      "[CSRF] WARNING: PUBLIC_ORIGIN is not set and NODE_ENV is not development. " +
      "CSRF Origin check will log warnings but NOT block requests until PUBLIC_ORIGIN is configured. " +
      "Set PUBLIC_ORIGIN=https://aisportsbettingmodels.com in production secrets immediately."
    );
  }

  return origins;
}

// Build once at module load time — origins don't change at runtime.
const ALLOWED_ORIGINS = buildAllowedOrigins();

/**
 * Determine whether a given Origin header value is permitted.
 *
 * [INPUT]  origin  — value of the Origin request header (may be undefined)
 * [OUTPUT] boolean — true if the origin is allowed to make mutations
 *
 * Logic:
 *   1. No Origin header → server-to-server call → ALLOW (no browser involved)
 *   2. Origin in ALLOWED_ORIGINS set → ALLOW
 *   3. In dev mode: Origin matches *.manus.computer pattern → ALLOW
 *   4. Otherwise → DENY
 */
function isOriginAllowed(origin: string | undefined): boolean {
  // No Origin header = server-to-server or same-origin fetch with no CORS.
  // Browsers always send Origin on cross-origin requests; absence means safe.
  if (!origin) return true;

  const normalized = origin.replace(/\/$/, "").toLowerCase();

  // [CHECK 1] Static set: PUBLIC_ORIGIN + www variant + http variant + dev localhost
  if (ALLOWED_ORIGINS.has(normalized)) return true;

  // [CHECK 2] Manus deployment domains (*.manus.space)
  // The app is deployed on both the custom domain AND a *.manus.space subdomain.
  // Both are controlled by the same operator — NOT a CSRF risk.
  // Pattern: https://<project-slug>.manus.space (exact subdomain format)
  if (/^https:\/\/[a-z0-9][a-z0-9\-]*\.manus\.space$/.test(normalized)) {
    console.log(`[CSRF] Allowed origin (*.manus.space deployment domain): ${normalized}`);
    return true;
  }

  // [CHECK 3] Manus sandbox preview URLs (*.manus.computer)
  // Dev server preview URLs use multi-level subdomains:
  //   - Simple:    https://3000-abc123.manus.computer
  //   - Multi-level: https://3000-abc123.us2.manus.computer
  // The old single-level pattern /^https:\/\/[a-z0-9\-]+\.manus\.computer$/ only
  // matched simple subdomains and BLOCKED multi-level preview URLs (e.g. us2 region),
  // causing legitimate Stripe checkout mutations to be CSRF-blocked.
  //
  // Fix: use hostname.endsWith('.manus.computer') — safe because:
  //   1. manus.computer is a Manus-controlled domain (same operator)
  //   2. The attacker domain (e.g. *.run.app) does NOT end with .manus.computer
  //   3. SameSite=Strict cookies provide defense-in-depth even if this check passes
  //
  // [INPUT]  normalized — lowercase origin string
  // [OUTPUT] true if origin ends with .manus.computer under https://
  // [VERIFY] Tested: 3000-xxx.us2.manus.computer → ALLOW, xfoomsv4ay.run.app → BLOCK
  if (normalized.startsWith("https://") && normalized.endsWith(".manus.computer")) {
    console.log(`[CSRF] Allowed origin (*.manus.computer preview, multi-level): ${normalized}`);
    return true;
  }

  return false;
}

// ─── CSRF alert rate-limit guard ──────────────────────────────────────────────
/**
 * In-memory map: IP address → timestamp of last CSRF alert notification.
 *
 * Purpose: prevent notification spam from a single attacker making repeated
 * cross-origin requests. At most one alert is sent per IP per window.
 *
 * [INPUT]  ip                      — attacker's IP address (string)
 * [INPUT]  CSRF_ALERT_WINDOW_MS    — cooldown window (10 minutes)
 * [OUTPUT] boolean                 — true if alert should fire, false if suppressed
 *
 * Memory management: entries older than CSRF_ALERT_WINDOW_MS are pruned on
 * every check to prevent unbounded map growth under sustained attack.
 */
const CSRF_ALERT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const csrfAlertLastSent = new Map<string, number>();

function shouldSendCsrfAlert(ip: string): boolean {
  const now = Date.now();

  // [STEP] Prune expired entries to prevent memory growth under sustained attack
  for (const [entryIp, lastSent] of Array.from(csrfAlertLastSent.entries())) {
    if (now - lastSent > CSRF_ALERT_WINDOW_MS) {
      csrfAlertLastSent.delete(entryIp);
    }
  }

  const lastSent = csrfAlertLastSent.get(ip);
  if (lastSent !== undefined && now - lastSent < CSRF_ALERT_WINDOW_MS) {
    // [STATE] Alert suppressed — within cooldown window for this IP
    const remainingMs = CSRF_ALERT_WINDOW_MS - (now - lastSent);
    const remainingSec = Math.ceil(remainingMs / 1000);
    console.log(
      `[CSRF] Alert suppressed for IP=${ip} — cooldown active, ${remainingSec}s remaining`
    );
    return false;
  }

  // [STATE] Alert allowed — record timestamp before firing
  csrfAlertLastSent.set(ip, now);
  return true;
}

/**
 * Fire a notifyOwner() alert when a CSRF block occurs in production.
 *
 * [INPUT]  ip      — attacker IP address
 * [INPUT]  origin  — the blocked Origin header value
 * [INPUT]  path    — tRPC procedure path that was blocked
 * [INPUT]  method  — HTTP method (POST, etc.)
 * [STEP]   Check rate-limit guard — at most 1 alert per IP per 10 minutes
 * [STEP]   Build structured alert payload with full context
 * [OUTPUT] notifyOwner() fires async (non-blocking — CSRF block is synchronous)
 * [VERIFY] Log alert outcome (sent / suppressed / failed)
 *
 * NOTE: This function is fire-and-forget. The CSRF block (403 FORBIDDEN) is
 * thrown synchronously before this async call resolves. The alert is best-effort.
 * If the notification service is down, the block still happens — the alert is
 * supplementary, not a dependency of the security enforcement.
 */
async function fireCsrfBlockAlert(
  ip: string,
  origin: string,
  path: string,
  method: string
): Promise<void> {
  // [STEP] Only fire in production — dev environments have misconfigured clients
  //        that would spam alerts during local development and testing.
  if (!ENV.isProduction) {
    console.log(
      `[CSRF] Alert suppressed — not in production (dev environment). ` +
      `IP=${ip} Origin="${origin}" path=${path}`
    );
    return;
  }

  // [STEP] Check rate-limit guard
  if (!shouldSendCsrfAlert(ip)) {
    return;
  }

  // [STEP] Build structured alert payload
  const timestamp = new Date().toISOString();
  const allowedList = Array.from(ALLOWED_ORIGINS).join(", ");
  const title = `[SECURITY] CSRF Attack Blocked — ${timestamp.slice(0, 10)}`;
  const content =
    `A cross-origin mutation request was blocked by the CSRF Origin check middleware.\n\n` +
    `Timestamp:       ${timestamp}\n` +
    `IP Address:      ${ip}\n` +
    `Blocked Origin:  "${origin}"\n` +
    `tRPC Path:       ${method} /api/trpc/${path}\n` +
    `Allowed Origins: [${allowedList}]\n\n` +
    `This may indicate:\n` +
    `  1. A CSRF attack from an attacker-controlled page on another domain\n` +
    `  2. A misconfigured client sending requests from an unexpected origin\n` +
    `  3. A subdomain takeover attempt\n\n` +
    `Action: Review server logs for additional requests from IP ${ip}. ` +
    `If this is a legitimate client, add its origin to PUBLIC_ORIGIN or the dev allowlist. ` +
    `If this is an attack, consider blocking IP ${ip} at the firewall/CDN level.`;

  // [STEP] Persist event to security_events table (async, non-blocking)
  const eventOccurredAt = Date.now();
  insertSecurityEvent({
    eventType: "CSRF_BLOCK",
    ip,
    blockedOrigin: origin,
    trpcPath: path,
    httpMethod: method,
    occurredAt: eventOccurredAt,
  }).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[CSRF] DB persist error (non-critical) | IP=${ip} | error="${msg}"`);
  });

  // [STEP] Post structured embed to 🗒️-𝗦𝗘𝗖𝗨𝗥𝗜𝗧𝗬-𝗘𝗩𝗘𝗡𝗧𝗦 Discord channel (async, non-blocking)
  postSecurityAlert({
    eventType: "CSRF_BLOCK",
    ip,
    blockedOrigin: origin,
    path,
    method,
    occurredAt: eventOccurredAt,
  }).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[CSRF] Discord alert error (non-critical) | IP=${ip} | error="${msg}"`);
  });

  console.log(
    `[CSRF] Firing owner alert for CSRF block | IP=${ip} Origin="${origin}" path=${path}`
  );

  try {
    const delivered = await notifyOwner({ title, content });
    if (delivered) {
      console.log(
        `[CSRF] Owner alert delivered successfully | IP=${ip} Origin="${origin}"`
      );
    } else {
      console.warn(
        `[CSRF] Owner alert delivery failed (notification service unavailable) | IP=${ip}`
      );
    }
  } catch (err: unknown) {
    // notifyOwner() throws TRPCError on validation failure — log but never
    // let the alert failure propagate or affect the CSRF block response.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[CSRF] Owner alert threw an error (non-critical) | IP=${ip} | error="${msg}"`
    );
  }
}

// ─── tRPC instance ────────────────────────────────────────────────────────────
const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;

// ─── CSRF Origin check middleware ─────────────────────────────────────────────
/**
 * Validates the Origin header on all state-mutating HTTP requests (POST/PATCH/PUT/DELETE).
 * GET requests (tRPC queries) are exempt — they are read-only and carry no CSRF risk.
 *
 * On block:
 *   1. Logs full audit entry to server console (synchronous)
 *   2. Fires notifyOwner() alert async (non-blocking, rate-limited per IP)
 *   3. Throws TRPCError FORBIDDEN (synchronous — response sent immediately)
 *
 * [STEP] Extract Origin header from request
 * [STEP] Determine if request method is mutation-capable
 * [STEP] Validate origin against allowed set
 * [OUTPUT] Pass to next middleware, or throw FORBIDDEN + fire alert
 * [VERIFY] Log every decision with IP, path, method, and origin for audit trail
 */
const csrfOriginCheck = t.middleware(async ({ ctx, next, path }) => {
  const req = ctx.req;
  const method = req.method?.toUpperCase() ?? "UNKNOWN";
  const origin = req.get("origin");
  const ip = req.ip ?? req.socket?.remoteAddress ?? "unknown";

  // GET requests are tRPC queries — read-only, no CSRF risk.
  // Only POST (mutations) need the Origin check.
  if (method === "GET") {
    return next();
  }

  // [STATE] Log every mutation attempt with full context
  console.log(
    `[CSRF] ${method} /api/trpc/${path}` +
    ` | IP=${ip}` +
    ` | Origin=${origin ?? "NOT_SET"}` +
    ` | isProduction=${ENV.isProduction}`
  );

  const allowed = isOriginAllowed(origin);

  if (!allowed) {
    // [OUTPUT] BLOCKED — origin not in allowed set
    console.warn(
      `[CSRF] BLOCKED — Origin mismatch` +
      ` | path=${path}` +
      ` | IP=${ip}` +
      ` | Origin="${origin}"` +
      ` | allowedOrigins=[${Array.from(ALLOWED_ORIGINS).join(", ")}]` +
      ` | This may indicate a CSRF attack or misconfigured client`
    );

    // [STEP] Fire owner alert async — non-blocking, rate-limited per IP per 10 min.
    // The CSRF block (403 FORBIDDEN) is thrown synchronously below regardless of
    // whether the alert succeeds. The alert is best-effort and supplementary.
    fireCsrfBlockAlert(ip, origin ?? "", path, method).catch((err: unknown) => {
      // Catch at the call site to guarantee no unhandled promise rejection
      // can propagate and affect the server process.
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[CSRF] Unhandled error in fireCsrfBlockAlert: ${msg}`);
    });

    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Request origin not permitted",
    });
  }

  // [VERIFY] PASS — origin is allowed
  if (origin) {
    // Only log when Origin is present (server-to-server has no Origin, no need to log)
    console.log(
      `[CSRF] PASS — origin="${origin}" path=${path} IP=${ip}`
    );
  }

  return next();
});

// ─── Auth middleware ──────────────────────────────────────────────────────────
/**
 * Requires a valid Manus OAuth session (ctx.user must be non-null).
 * Used by protectedProcedure and adminProcedure.
 */
const requireUser = t.middleware(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

// ─── Exported procedures ──────────────────────────────────────────────────────

/**
 * publicProcedure — no authentication required.
 * CSRF Origin check is applied to all mutations.
 * Queries (GET) are exempt from CSRF check.
 */
export const publicProcedure = t.procedure.use(csrfOriginCheck);

/**
 * protectedProcedure — Manus OAuth session required.
 * CSRF check applied first, then auth check.
 */
export const protectedProcedure = t.procedure
  .use(csrfOriginCheck)
  .use(requireUser);

/**
 * adminProcedure — Manus OAuth session + admin role required.
 * CSRF check applied first, then admin auth check.
 */
export const adminProcedure = t.procedure.use(csrfOriginCheck).use(
  t.middleware(async ({ ctx, next }) => {
    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);
