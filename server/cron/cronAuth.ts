/**
 * cronAuth.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Host-independent shared-secret guard for GitHub-Actions-triggered cron endpoints.
 *
 * WHY (systematic-debugging finding — 2026-07-09):
 *   The legacy /api/scheduled/* Heartbeat endpoints authenticated through the
 *   retired platform's hosted session helper and only accepted a session whose
 *   openId was prefixed "cron_" (issued exclusively by that platform). GitHub
 *   Actions runners have no such cookie, so they can never pass that guard. As we
 *   migrate background jobs off the legacy platform onto
 *   "GitHub Actions on a timer" hitting the Railway app, we need an auth mechanism
 *   that depends on nothing but a shared secret both sides hold.
 *
 * CONTRACT:
 *   - Fail CLOSED: no CRON_SECRET configured → 503 (never implicitly open).
 *   - Constant-time comparison via crypto.timingSafeEqual, length-guarded so a
 *     wrong-length token can't throw or leak timing.
 *   - Accept the secret via `Authorization: Bearer <secret>` or `x-cron-secret`.
 *
 * The Railway env sets CRON_SECRET; the GitHub Actions workflow passes the same
 * value from repository secrets. Rotating the secret is a one-line change on both.
 */

import { timingSafeEqual } from "crypto";
import type { Request, Response } from "express";
import { logSafe } from "../_core/logSafe";
import { resolveClientIdentity } from "../_core/clientIdentity";

export type CronAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: string };

interface HeadersBag {
  headers: Record<string, string | string[] | undefined>;
}

/** Pull the presented token from either supported header, normalising whitespace. */
function extractPresentedToken(req: HeadersBag): string | null {
  const raw = req.headers ?? {};
  const xCron = raw["x-cron-secret"];
  if (typeof xCron === "string" && xCron.length > 0) return xCron.trim();

  const authz = raw["authorization"] ?? raw["Authorization"];
  const authStr = Array.isArray(authz) ? authz[0] : authz;
  if (typeof authStr === "string") {
    // `/^Bearer\s+(.+)$/` backtracks quadratically on "Bearer" followed by a
    // long run of whitespace — reachable BEFORE any secret check, so an
    // unauthenticated request can burn CPU. Fixed-width anchor + slice is
    // linear and behaviourally identical.
    const trimmed = authStr.trim();
    if (/^Bearer\s/i.test(trimmed)) {
      const token = trimmed.slice("Bearer".length).trim();
      if (token.length > 0) return token;
    }
  }
  return null;
}

/** Length-guarded constant-time string compare. */
function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    // timingSafeEqual throws on unequal lengths; compare against self so the work
    // done is constant regardless of the mismatch, then return false.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Decide whether a request may run a cron job. Pure — no side effects, no Express
 * coupling — so it is trivially unit-testable.
 */
export function verifyCronSecret(req: HeadersBag): CronAuthResult {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length === 0) {
    return { ok: false, status: 503, error: "cron-not-configured" };
  }

  const presented = extractPresentedToken(req);
  if (!presented) {
    return { ok: false, status: 401, error: "missing-cron-secret" };
  }

  if (!constantTimeEqual(presented, secret)) {
    return { ok: false, status: 401, error: "invalid-cron-secret" };
  }

  return { ok: true };
}

/**
 * Express convenience: apply verifyCronSecret to a live request. On failure it
 * writes the status + JSON error and returns false; on success returns true so the
 * caller proceeds. Logs every rejection for the "advanced logging" mandate.
 */
export function requireCronSecret(req: Request, res: Response, jobLabel: string): boolean {
  const result = verifyCronSecret(req as unknown as HeadersBag);
  if (!result.ok) {
    // Cosmetic log line on an internal, secret-authed path — migrated for
    // consistency with the single client-identity surface (2026-08-06 audit).
    console.warn(
      `[Cron:${jobLabel}] [AUTH] REJECT status=${result.status} reason=${logSafe(result.error)} ` +
      `ip=${resolveClientIdentity(req) || "?"} ua="${logSafe((req.headers["user-agent"] as string | undefined)?.slice(0, 80) ?? "?")}"`
    );
    res.status(result.status).json({ ok: false, error: result.error });
    return false;
  }
  return true;
}
