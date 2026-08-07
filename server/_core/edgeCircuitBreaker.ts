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
 * WHAT THIS BREAKER DOES NOT COVER (Task 5.4 Step 5 — stated honestly, because
 * the as-built record previously implied otherwise):
 *
 *   It does NOT trip on PARTIAL bypass — the case that actually materialised on
 *   2026-08-06, where Cloudflare fronts most traffic but a minority of real
 *   users reach the origin directly and are 403'd. That is by design and must
 *   stay that way: any trip rule of the form "enough unverified traffic ⇒ stop
 *   enforcing" is attacker-INFLUENCED, because unverified traffic is exactly
 *   what an attacker generates for free, whereas the existing "zero verified"
 *   condition is attacker-PROOF — nobody can cause the ABSENCE of genuine
 *   verified traffic.
 *
 *   Measured, so the reason is honest rather than rhetorical. Simulating a
 *   verified-fraction floor of 0.5 against an 80% unverified flood (100 real
 *   CF req + 400 attacker req per window, interleaved, 20 windows) produced:
 *   9 trips, 72 of 8000 unverified requests served with the lock open (0.9%),
 *   7928 still blocked. So it is NOT the clean on-demand bypass it first looks
 *   like — `recoverFloor` verified requests re-close the breaker almost
 *   immediately whenever real traffic is flowing. What it IS is flapping: nine
 *   attacker-induced CRITICAL trip alerts in twenty minutes, nine intermittent
 *   enforcement gaps, and a small but real leak — all on demand, for the price
 *   of a few hundred requests a minute. A control that an attacker can make
 *   oscillate and shout is not a control worth having, and the leak grows as
 *   genuine verified traffic thins out (at which point the starved condition
 *   already covers the case correctly).
 *
 *   Partial bypass is therefore a DETECTION problem, not a self-heal problem:
 *   Cloudflare is working for the majority, so silently disabling the origin
 *   lock for everyone is the wrong response. It is surfaced instead by the
 *   alert-only `partial_bypass_suspected` signal below, which NEVER changes
 *   enforcement — the worst an attacker achieves by flooding is making us
 *   alert on their own flood, which is itself a signal worth having. The
 *   operator response is to fix the DNS/routing, not to drop the lock.
 *
 * The `disabled` kill-switch short-circuits detection along with enforcement;
 * it is an emergency lever meaning "enforcement is unconditional, stop
 * evaluating", and is documented as such rather than silently half-active.
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
  /**
   * ALERT-ONLY. A closed window with `>= minSample` observations, SOME verified
   * traffic (so not starved), and an unverified fraction at or above this is
   * "bypass-suspect". Never affects enforcement — see the header on why a
   * fraction must never gate the trip.
   */
  bypassAlertFraction: number;
  /** ALERT-ONLY. Consecutive bypass-suspect windows before the signal fires. */
  bypassAlertWindows: number;
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
  /** ALERT-ONLY. Count of consecutive CLOSED windows that were bypass-suspect. */
  consecutiveBypassSuspect: number;
  /** ALERT-ONLY. True while the partial-bypass signal is latched (one-shot per streak). */
  bypassAlerted: boolean;
}

export type EdgeBreakerEvent =
  | "tripped"
  | "recovered"
  /** ALERT-ONLY — enforcement is unchanged when this fires. */
  | "partial_bypass_suspected"
  | "partial_bypass_cleared"
  | null;

const DEFAULTS: EdgeBreakerConfig = {
  windowMs: 60_000, // 1 min
  minSample: 200,
  verifiedFloor: 0, // the secret guarantees verified==0 when CF is truly absent
  tripWindows: 3, // ⇒ ~3 min of sustained, total CF absence before a downgrade
  recoverFloor: 3,
  bypassAlertFraction: 0.5, // alert-only; never gates the trip
  bypassAlertWindows: 3,
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

/** Fraction parse in (0,1]. Rejects NaN, <=0 and >1 so a typo cannot make every window suspect. */
function fractionEnv(raw: string | undefined, dflt: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > 1) return dflt;
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
    bypassAlertFraction: fractionEnv(
      env.EDGE_BREAKER_BYPASS_ALERT_FRACTION,
      DEFAULTS.bypassAlertFraction
    ),
    bypassAlertWindows: intEnv(
      env.EDGE_BREAKER_BYPASS_ALERT_WINDOWS,
      DEFAULTS.bypassAlertWindows
    ),
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
    consecutiveBypassSuspect: 0,
    bypassAlerted: false,
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
    let consecutiveBypassSuspect: number;
    if (elapsed >= 2 * config.windowMs) {
      // At least one fully-empty window elapsed → an idle gap breaks the streak.
      consecutiveStarved = 0;
      consecutiveBypassSuspect = 0;
    } else if (s.total >= config.minSample) {
      // Enough evidence: starved iff ~no verified traffic all window.
      const starvedWindow = s.verified <= config.verifiedFloor;
      consecutiveStarved = starvedWindow ? s.consecutiveStarved + 1 : 0;

      // ALERT-ONLY, and deliberately DISJOINT from starvation: a window is
      // bypass-suspect only when genuine verified traffic IS present (so
      // Cloudflare is up and this is not the outage case) yet an unusually
      // large share of ingress arrived unverified — the partial-bypass
      // signature. This never feeds `tripped`; see the header.
      const unverifiedFraction = (s.total - s.verified) / s.total;
      consecutiveBypassSuspect =
        !starvedWindow && unverifiedFraction >= config.bypassAlertFraction
          ? s.consecutiveBypassSuspect + 1
          : 0;
    } else {
      // Too little traffic to conclude anything — not evidence of CF absence.
      consecutiveStarved = 0;
      consecutiveBypassSuspect = 0;
    }

    let tripped = s.tripped;
    if (!tripped && consecutiveStarved >= config.tripWindows) {
      tripped = true;
      event = "tripped";
    }

    // One-shot latch per streak, and strictly lower priority than a trip so a
    // real outage always reports as the outage.
    let bypassAlerted = s.bypassAlerted;
    if (!bypassAlerted && consecutiveBypassSuspect >= config.bypassAlertWindows) {
      bypassAlerted = true;
      if (!event) event = "partial_bypass_suspected";
    } else if (bypassAlerted && consecutiveBypassSuspect === 0) {
      bypassAlerted = false;
      if (!event) event = "partial_bypass_cleared";
    }

    s = {
      windowStart: now,
      total: 0,
      verified: 0,
      consecutiveStarved,
      tripped,
      consecutiveBypassSuspect,
      bypassAlerted,
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
