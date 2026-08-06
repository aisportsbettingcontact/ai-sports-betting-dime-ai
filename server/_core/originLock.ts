import type { Request, RequestHandler } from "express";
import {
  assertNonEmptyCfRanges,
  cfCidrStalenessWarning,
  edgeMode,
  edgeProofPasses,
  hasOriginSecretConfigured,
} from "./edgeProxy";
import {
  type EdgeBreakerConfig,
  type EdgeBreakerState,
  edgeBreakerConfig,
  initialBreakerState,
  isEnforcing,
  observe,
} from "./edgeCircuitBreaker";

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
 * Residual mitigation (NOW BUILT — edgeCircuitBreaker.ts): "on" WITH a secret
 * but Cloudflare not actually injecting it (DNS not orange-clouded / secret typo
 * / CF outage) would 403 legit traffic. A self-healing circuit breaker observes
 * every "on"-mode request and, once it has seen `minSample` requests of which
 * ~none passed the edge proof, judges Cloudflare absent and auto-downgrades this
 * middleware to observe-only (never 403) while shouting CRITICAL — then closes
 * automatically when verified traffic returns. The signal is un-gameable: the
 * proof requires the origin secret that only Cloudflare forwards, so a
 * direct-origin flood cannot manufacture verified requests, and real users
 * behind CF keep the verified count up so an attacker cannot force a downgrade.
 * Still complemented by the mandatory log-mode soak and the healthy log rollback.
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
  | "edge_deny"
  | "edge_would_deny"
  | "edge_no_secret"
  | "edge_breaker_tripped"
  | "edge_breaker_recovered";

export function originLock(
  onEvent?: (kind: OriginLockEvent, req: Request) => void,
  opts?: { breakerConfig?: EdgeBreakerConfig; now?: () => number }
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

  const clock = opts?.now ?? Date.now;
  const breakerCfg = opts?.breakerConfig ?? edgeBreakerConfig();
  // Per-instance breaker state: persists across requests for the life of the
  // process, so the verified-ratio observation accumulates across traffic.
  let breaker: EdgeBreakerState = initialBreakerState(clock());

  return (req, res, next) => {
    const mode = edgeMode();
    if (mode === "off") return next();
    // Railway healthcheck path — always reachable, no secret required.
    if (req.path === "/health") return next();

    const verified = edgeProofPasses(req);

    // Circuit breaker observes ONLY in the enforcing sub-mode — "on" WITH a
    // secret configured, the sole path that actually 403s (the no-secret branch
    // below already anti-lockout-downgrades, so it has no outage to prevent and
    // must not feed the breaker or it would fire a spurious CRITICAL trip).
    if (mode === "on" && hasOriginSecretConfigured()) {
      const { next: nextState, event } = observe(
        breaker,
        verified,
        clock(),
        breakerCfg
      );
      breaker = nextState;
      if (event === "tripped") onEvent?.("edge_breaker_tripped", req);
      else if (event === "recovered") onEvent?.("edge_breaker_recovered", req);
    }

    if (verified) {
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

    // Self-heal: if the breaker has judged Cloudflare absent (a full sample with
    // ~no verified traffic), downgrade to observe-only rather than 403-storm the
    // whole site. Phase 3 gating + rate limiters still protect the payload.
    if (!isEnforcing(breaker)) {
      onEvent?.("edge_would_deny", req);
      return next();
    }

    onEvent?.("edge_deny", req);
    res.status(403).end();
  };
}
