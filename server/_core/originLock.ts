import type { Request, RequestHandler } from "express";
import {
  assertNonEmptyCfRanges,
  cfCidrStalenessWarning,
  edgeMode,
  edgeProofPasses,
  hasOriginSecretConfigured,
} from "./edgeProxy";

/**
 * Phase 4 — origin lock middleware.
 *
 * Renders a direct hit on the public *.up.railway.app origin useless once armed
 * ("on" mode): any request that does not carry a valid `x-dime-edge-secret` AND
 * arrive from a Cloudflare-range upstream is 403'd — EXCEPT `/health` (Railway's
 * healthcheck probes the origin directly and must stay green through a CF-edge
 * outage). The secret is the load-bearing factor; the CF-range check is
 * defence-in-depth (see edgeProxy design law #2). The origin lock is a SECOND
 * layer beneath the infra-level proof (Authenticated Origin Pulls / Cloudflare
 * Tunnel) documented in the runbook.
 *
 * Rollout safety (Phase 4 adversarial review):
 *  - "off"/unset: pure pass-through — byte-identical to today, merge is inert.
 *  - "log": observe-only. Never 403s; emits a would-deny event so the operator
 *    can confirm Cloudflare is injecting the secret on real traffic BEFORE
 *    enforcing. Because IP-keying is decoupled (resolveClientIp applies the
 *    same proof in log+on), "log" is a fully HEALTHY rollback target — the fast
 *    escape hatch from an enforcement fault is `EDGE_MODE=on → log`, no DNS
 *    change, no PoP rate-limit collapse.
 *  - "on" with NO secret configured: anti-lockout — downgrade to log behavior
 *    (never 403 the whole site) and shout CRITICAL. The fail-closed guarantee
 *    holds whenever at least one secret is set.
 *
 * Residual (documented fast-follow, not built here): "on" WITH a secret but
 * Cloudflare not actually injecting it (DNS not orange-clouded / secret typo)
 * would 403 legit traffic. Mitigated by (a) the mandatory log-mode soak before
 * flipping on, (b) the healthy log rollback, and (c) the loud onEvent alerts —
 * a stateful auto-downgrade is a future enhancement.
 *
 * The secret value is NEVER logged.
 */

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      edgeVerified?: boolean;
    }
  }
}

export type OriginLockEvent =
  "edge_deny" | "edge_would_deny" | "edge_no_secret";

export function originLock(
  onEvent?: (kind: OriginLockEvent, req: Request) => void
): RequestHandler {
  // Fail fast at boot if we are arming with a corrupt CF range snapshot; a bad
  // list must never silently open the second factor or 403-storm. Gated on
  // mode so a corrupt list can never crash boot while the feature is dormant.
  if (edgeMode() !== "off") {
    assertNonEmptyCfRanges();
    // Observability backstop: warn (never block) if the CF range snapshot has
    // gone stale, in case the scheduled refresh lapsed. Second factor only.
    const staleness = cfCidrStalenessWarning();
    if (staleness.stale) console.warn(staleness.message);
  }

  return (req, res, next) => {
    const mode = edgeMode();
    if (mode === "off") return next();
    // Railway healthcheck path — always reachable, no secret required.
    if (req.path === "/health") return next();

    if (edgeProofPasses(req)) {
      req.edgeVerified = true;
      return next();
    }

    if (mode === "log") {
      onEvent?.("edge_would_deny", req);
      return next();
    }

    // mode === "on"
    if (!hasOriginSecretConfigured()) {
      // Anti-lockout: refuse to 403 the entire site because the secret is unset.
      onEvent?.("edge_no_secret", req);
      return next();
    }

    onEvent?.("edge_deny", req);
    res.status(403).end();
  };
}
