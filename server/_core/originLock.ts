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
 *    holds whenever at least one secret is set. Shouted TWICE, independently:
 *    once at BOOT (the `[boot]` assertion in originLock() below, so a
 *    misconfigured deploy is loud before any traffic arrives — `/health` is
 *    lock-exempt, so the Railway deploy goes green either way) and again per
 *    request via the `edge_no_secret` event, which index.ts escalates at most
 *    once per minute. Neither signal consumes the other's budget.
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
  | "edge_breaker_recovered"
  /**
   * ALERT-ONLY. Cloudflare is up and verified traffic is flowing, but an
   * unusually large share of ingress arrived unverified — the partial-bypass
   * signature (real users reaching the origin directly and being 403'd). The
   * request outcome is UNCHANGED by these two kinds; they exist because
   * partial bypass is undetectable by the breaker's trip condition, which must
   * stay un-gameable. See edgeCircuitBreaker.ts's header.
   */
  | "edge_partial_bypass_suspected"
  | "edge_partial_bypass_cleared";

export function originLock(
  onEvent?: (kind: OriginLockEvent, req: Request) => void,
  opts?: { breakerConfig?: EdgeBreakerConfig; now?: () => number }
): RequestHandler {
  const bootMode = edgeMode();

  // ─── Boot assertion: ARMED but no origin secret configured (Task 5.3 §4) ──
  // Before this, "EDGE_MODE is on but nothing is configured" was discoverable
  // ONLY on the first request that reached this middleware (the
  // `edge_no_secret` event → index.ts's once-per-minute CRITICAL + Discord
  // escalation). A misconfigured deploy therefore looked perfectly healthy:
  // Railway's healthcheck probes `/health`, which is lock-exempt, so the
  // deploy goes green and the fault stays invisible until real traffic lands.
  //
  // This is the one-shot BOOT signal for that same fault, and it is
  // deliberately NOT the same signal as the per-request escalation:
  //   - emitted once, at middleware construction, never per request;
  //   - carries its own `[boot]` tag so log search separates the two;
  //   - does NOT call onEvent() — there is no Request at boot, and routing it
  //     through onEvent would consume index.ts's edgeNoSecretLastEscalatedAt
  //     budget, suppressing the first real request's escalation. The two
  //     signals stay independent.
  //
  // It MUST NEVER throw. Railway's healthcheck kills a deploy that fails to
  // boot, and the anti-lockout downgrade below exists precisely so the site
  // stays UP while unprotected — crashing here would convert "unprotected"
  // into "offline", which is strictly worse. A bare console.error is the whole
  // mechanism; no path here can reject or throw. It is emitted BEFORE
  // assertNonEmptyCfRanges() (which throws by design) so the cheapest, loudest
  // signal can never be pre-empted by that throw.
  //
  // The secret value is never read here — only its presence (booleans only).
  if (bootMode !== "off" && !hasOriginSecretConfigured()) {
    console.error(
      `[edge][origin-lock][boot] CRITICAL EDGE_MODE=${bootMode} but neither ` +
        `EDGE_ORIGIN_SECRET nor EDGE_ORIGIN_SECRET_PREV is configured. ` +
        (bootMode === "on"
          ? `The origin lock is INERT: every request takes the anti-lockout ` +
            `downgrade, so nothing is ever 403'd and the raw origin is NOT ` +
            `protected. `
          : `Every request will read as unverified, so a log-mode soak ` +
            `measures nothing and MUST NOT be used as an arming gate. `) +
        `Client identity degrades too: with no configured secret the edge ` +
        `proof can never pass, so resolveClientIdentity() falls back to the ` +
        `leftmost X-Forwarded-For — with Cloudflare in front that is the PoP, ` +
        `collapsing all six rate limiters onto per-PoP buckets. ` +
        `Set EDGE_ORIGIN_SECRET in Railway (project stunning-creativity → ` +
        `production) and redeploy. Rotation procedure: ` +
        `docs/runbooks/edge-secret-rotation.md`
    );
  }

  // Fail fast at boot if we are arming with a corrupt CF range snapshot; a bad
  // list must never silently open the second factor or 403-storm. Gated on
  // mode so a corrupt list can never crash boot while the feature is dormant.
  if (bootMode !== "off") {
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
      else if (event === "partial_bypass_suspected")
        onEvent?.("edge_partial_bypass_suspected", req);
      else if (event === "partial_bypass_cleared")
        onEvent?.("edge_partial_bypass_cleared", req);
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
