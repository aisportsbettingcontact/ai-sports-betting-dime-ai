/**
 * Origin-lock circuit breaker — self-healing auto-downgrade for EDGE_MODE=on.
 *
 * The documented residual risk of arming the origin lock (see originLock.ts
 * header): if EDGE_MODE=on AND a secret is configured BUT Cloudflare is not
 * actually fronting the origin (DNS not orange-clouded, secret typo, CF outage),
 * every real request fails `edgeProofPasses` and is 403'd — a total outage, the
 * #370-class deploy-order hazard. This breaker converts that outage into a
 * self-heal: it observes each on-mode request's edge-proof result and, once
 * Cloudflare has been judged genuinely absent, downgrades the origin-lock 403 to
 * observe-only (never blocks) + a CRITICAL alert, auto-recovering when verified
 * traffic returns.
 *
 * SOUNDNESS — why an attacker cannot weaponize the downgrade (learned from a
 * 4-lens adversarial review that broke a naive single-window design):
 *
 *  - "Verified" requires the shared origin secret that ONLY your Cloudflare
 *    forwards. A direct-origin flood cannot manufacture a verified request.
 *  - The trip fires ONLY after `tripWindows` CONSECUTIVE full windows each of
 *    which closed with `>= minSample` requests and `<= verifiedFloor` verified.
 *    A single verified request anywhere in a window makes that window non-starved
 *    and RESETS the consecutive streak. So during active hours — when real users
 *    reach the CF-fronted domain every minute — an attacker flooding the raw
 *    origin can never assemble `tripWindows` consecutive all-unverified windows;
 *    genuine traffic keeps breaking the streak. The trip is reachable only during
 *    a sustained, total absence of verified traffic (a real misconfig) or a
 *    genuinely zero-user dead period — where the downgrade's blast radius is
 *    just the origin-lock layer: Phase 3 model-IP gating and the rate limiters
 *    are independent and still strip/throttle the payload.
 *  - Recovery is immediate and not blockable: any `recoverFloor` verified
 *    requests (each cryptographically proving Cloudflare is forwarding again)
 *    close the breaker; an attacker cannot suppress genuine verified traffic.
 *
 * A low-traffic real outage (below `minSample`/window) may not reach the trip
 * threshold — that class is caught by the runbook's external synthetic monitor
 * through the Cloudflare hostname, not by this passive origin-side breaker.
 *
 * Pure + injectable-now for testability, mirroring accountLockout.ts. Never throws.
 */

export interface EdgeBreakerConfig {
  /** Rolling window length (ms). */
  windowMs: number;
  /** A closed window is evidence only when it saw at least this many observations. */
  minSample: number;
  /** A closed window is "starved" (Cloudflare judged absent) when verified <= this. */
  verifiedFloor: number;
  /** Trip only after this many CONSECUTIVE starved windows (any non-starved window resets the streak). */
  tripWindows: number;
  /** Close a tripped breaker once the open window reaches this many verified requests. */
  recoverFloor: number;
  /** Kill-switch: when true the breaker never auto-downgrades — enforcement is unconditional. */
  disabled: boolean;
}

export interface EdgeBreakerState {
  /** ms timestamp the current (open) rolling window opened. */
  windowStart: number;
  /** Observations in the OPEN window so far. */
  total: number;
  /** Of those, how many passed edgeProofPasses (genuine Cloudflare ingress). */
  verified: number;
  /** Count of consecutive CLOSED windows that were starved. */
  consecutiveStarved: number;
  /** True while enforcement is downgraded (Cloudflare judged absent). */
  tripped: boolean;
}

export type EdgeBreakerEvent = "tripped" | "recovered" | null;

const DEFAULTS: EdgeBreakerConfig = {
  windowMs: 60_000, // 1 min
  minSample: 200,
  verifiedFloor: 0, // the secret guarantees verified==0 when CF is truly absent
  tripWindows: 3, // ⇒ ~3 min of sustained, total CF absence before a downgrade
  recoverFloor: 3,
  disabled: false,
};

/** Non-negative-integer env parse. Rejects NaN/negative; rejects 0 unless `allowZero`. */
function intEnv(
  raw: string | undefined,
  dflt: number,
  allowZero = false
): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return dflt;
  if (n === 0 && !allowZero) return dflt;
  return n;
}

export function edgeBreakerConfig(
  env: Record<string, string | undefined> = process.env
): EdgeBreakerConfig {
  return {
    windowMs: intEnv(env.EDGE_BREAKER_WINDOW_MS, DEFAULTS.windowMs),
    minSample: intEnv(env.EDGE_BREAKER_MIN_SAMPLE, DEFAULTS.minSample),
    verifiedFloor: intEnv(
      env.EDGE_BREAKER_VERIFIED_FLOOR,
      DEFAULTS.verifiedFloor,
      true
    ),
    tripWindows: intEnv(env.EDGE_BREAKER_TRIP_WINDOWS, DEFAULTS.tripWindows),
    recoverFloor: intEnv(env.EDGE_BREAKER_RECOVER_FLOOR, DEFAULTS.recoverFloor),
    disabled: (env.EDGE_BREAKER_DISABLED ?? "").trim() === "1",
  };
}

export function initialBreakerState(now: number): EdgeBreakerState {
  return {
    windowStart: now,
    total: 0,
    verified: 0,
    consecutiveStarved: 0,
    tripped: false,
  };
}

/** True when the origin lock should currently ENFORCE (403 non-verified requests). */
export function isEnforcing(state: EdgeBreakerState): boolean {
  return !state.tripped;
}

/**
 * Record one origin-lock observation and evaluate the breaker.
 *
 * `verified` = did this request pass edgeProofPasses (real Cloudflare ingress).
 * The trip is decided at WINDOW CLOSE over the whole just-closed window, so any
 * verified request in a window blocks that window from being "starved". Returns
 * the next state and a one-shot transition event (fired exactly once per edge).
 */
export function observe(
  state: EdgeBreakerState,
  verified: boolean,
  now: number,
  config: EdgeBreakerConfig
): { next: EdgeBreakerState; event: EdgeBreakerEvent } {
  // Kill-switch: never auto-downgrade. If we were tripped, force-close (enforce).
  if (config.disabled) {
    if (state.tripped) {
      return {
        next: { ...state, tripped: false, consecutiveStarved: 0 },
        event: "recovered",
      };
    }
    return { next: state, event: null };
  }

  let s = state;
  let event: EdgeBreakerEvent = null;

  // Window close: fold the just-closed window's verdict into the starved streak.
  const elapsed = now - s.windowStart;
  if (elapsed >= config.windowMs) {
    let consecutiveStarved: number;
    if (elapsed >= 2 * config.windowMs) {
      // At least one fully-empty window elapsed → an idle gap breaks the streak.
      consecutiveStarved = 0;
    } else if (s.total >= config.minSample) {
      // Enough evidence: starved iff ~no verified traffic all window.
      consecutiveStarved =
        s.verified <= config.verifiedFloor ? s.consecutiveStarved + 1 : 0;
    } else {
      // Too little traffic to conclude anything — not evidence of CF absence.
      consecutiveStarved = 0;
    }

    let tripped = s.tripped;
    if (!tripped && consecutiveStarved >= config.tripWindows) {
      tripped = true;
      event = "tripped";
    }

    s = {
      windowStart: now,
      total: 0,
      verified: 0,
      consecutiveStarved,
      tripped,
    };
  }

  // Record this observation into the (possibly reset) open window.
  s = { ...s, total: s.total + 1, verified: s.verified + (verified ? 1 : 0) };

  // Immediate recovery: genuine verified traffic (only CF can forge it) is back.
  if (s.tripped && s.verified >= config.recoverFloor) {
    return {
      next: { ...s, tripped: false, consecutiveStarved: 0 },
      event: "recovered",
    };
  }

  return { next: s, event };
}
