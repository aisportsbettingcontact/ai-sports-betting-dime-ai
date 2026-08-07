import { describe, expect, it } from "vitest";
import {
  type EdgeBreakerConfig,
  type EdgeBreakerState,
  edgeBreakerConfig,
  initialBreakerState,
  isEnforcing,
  observe,
} from "./edgeCircuitBreaker";

// windowMs 1000, need 2 CONSECUTIVE starved windows (>=3 obs, 0 verified) to trip
// NOTE: tsconfig excludes **/*.test.ts from tsc, so a missing field here would
// silently read as `undefined` (and `fraction >= undefined` is always false)
// rather than failing the typecheck. The bypass fields are therefore set
// EXPLICITLY inert for this shared config, so the pre-existing trip/recover
// tests below keep asserting exactly what they asserted before.
const CFG: EdgeBreakerConfig = {
  windowMs: 1000,
  minSample: 3,
  verifiedFloor: 0,
  tripWindows: 2,
  recoverFloor: 2,
  bypassAlertFraction: 1, // unreachable: a suspect window needs verified > 0
  bypassAlertWindows: 999,
  disabled: false,
};

/** Drive a batch of observations at a fixed clock; collect transition events. */
function batch(
  state: EdgeBreakerState,
  seq: boolean[],
  now: number,
  cfg = CFG
): { state: EdgeBreakerState; events: (string | null)[] } {
  let s = state;
  const events: (string | null)[] = [];
  for (const v of seq) {
    const r = observe(s, v, now, cfg);
    s = r.next;
    events.push(r.event);
  }
  return { state: s, events };
}

const F = false;
const T = true;

describe("edgeCircuitBreaker — initial state", () => {
  it("starts enforcing with empty counters", () => {
    const s = initialBreakerState(100);
    expect(s).toEqual({
      windowStart: 100,
      total: 0,
      verified: 0,
      consecutiveStarved: 0,
      tripped: false,
      consecutiveBypassSuspect: 0,
      bypassAlerted: false,
    });
    expect(isEnforcing(s)).toBe(true);
  });
});

describe("edgeCircuitBreaker — trip requires tripWindows CONSECUTIVE starved windows", () => {
  it("does NOT trip on a single starved window (the naive-design bug that was fixed)", () => {
    // one full window of >minSample unverified requests, then close it
    let s = batch(initialBreakerState(0), [F, F, F, F], 0).state;
    expect(s.tripped).toBe(false);
    const closed = batch(s, [F], 1000); // closes window 1 → consec=1, no trip
    expect(closed.state.tripped).toBe(false);
    expect(closed.state.consecutiveStarved).toBe(1);
    expect(closed.events.every(e => e === null)).toBe(true);
  });

  it("trips after two consecutive starved windows, firing 'tripped' exactly once", () => {
    let s = batch(initialBreakerState(0), [F, F, F], 0).state; // window 1 fills
    const w2 = batch(s, [F, F, F], 1000); // closes w1 (consec=1), fills w2
    expect(w2.state.tripped).toBe(false);
    expect(w2.state.consecutiveStarved).toBe(1);
    const w3 = batch(w2.state, [F], 2000); // closes w2 (consec=2) → TRIP
    expect(w3.state.tripped).toBe(true);
    expect(isEnforcing(w3.state)).toBe(false);
    expect(w3.events).toEqual(["tripped"]);
  });

  it("UN-GAMEABLE: a single verified request anywhere in a window resets the streak", () => {
    let s = batch(initialBreakerState(0), [F, F, F], 0).state; // starved w1
    const w2 = batch(s, [F, T, F], 1000); // closes w1 (consec=1); w2 has 1 verified
    expect(w2.state.consecutiveStarved).toBe(1);
    const w3 = batch(w2.state, [F], 2000); // closes w2: verified>0 → NOT starved → consec=0
    expect(w3.state.consecutiveStarved).toBe(0);
    expect(w3.state.tripped).toBe(false);
  });

  it("attacker flood cannot trip during active hours: one real CF user per window keeps it enforcing", () => {
    // 4 windows, each: a flood of unverified + exactly ONE verified (a real user)
    let s = initialBreakerState(0);
    for (let w = 0; w < 4; w++) {
      s = batch(s, [F, F, F, F, F, T], w * 1000).state;
    }
    expect(s.tripped).toBe(false);
    expect(s.consecutiveStarved).toBe(0);
  });

  it("a low-traffic window (below minSample) is not evidence — never trips", () => {
    let s = initialBreakerState(0);
    for (let w = 0; w < 5; w++) s = batch(s, [F, F], w * 1000).state; // 2 < minSample 3
    expect(s.tripped).toBe(false);
    expect(s.consecutiveStarved).toBe(0);
  });

  it("an idle gap (>=2 windows elapsed) breaks the starved streak", () => {
    let s = batch(initialBreakerState(0), [F, F, F], 0).state;
    const closed = batch(s, [F], 1000); // consec=1
    expect(closed.state.consecutiveStarved).toBe(1);
    // now a long idle gap before the next request
    const afterGap = observe(closed.state, false, 5000, CFG); // >=2*windowMs
    expect(afterGap.next.consecutiveStarved).toBe(0);
    expect(afterGap.next.tripped).toBe(false);
  });

  it("honors verifiedFloor > 0", () => {
    const cfg = { ...CFG, minSample: 5, verifiedFloor: 1, tripWindows: 1 };
    // window with exactly 1 verified → verified<=floor(1) → starved → trips (tripWindows=1)
    const s = batch(initialBreakerState(0), [F, T, F, F, F], 0, cfg).state;
    const closed = batch(s, [F], 1000, cfg);
    expect(closed.state.tripped).toBe(true);
    // 2 verified → not starved → no trip
    const b = batch(initialBreakerState(0), [F, T, T, F, F], 0, cfg).state;
    expect(batch(b, [F], 1000, cfg).state.tripped).toBe(false);
  });
});

describe("edgeCircuitBreaker — recovery", () => {
  function trippedState(): EdgeBreakerState {
    let s = batch(initialBreakerState(0), [F, F, F], 0).state;
    s = batch(s, [F, F, F], 1000).state;
    s = batch(s, [F], 2000).state;
    expect(s.tripped).toBe(true);
    return s;
  }

  it("closes immediately once recoverFloor verified requests arrive (not blockable)", () => {
    const s = trippedState();
    const rec = batch(s, [T, T], 2000); // reaches recoverFloor(2) in the open window
    expect(rec.state.tripped).toBe(false);
    expect(rec.state.consecutiveStarved).toBe(0);
    expect(rec.events).toContain("recovered");
  });

  it("a single verified request below recoverFloor does not yet recover", () => {
    const s = trippedState();
    const rec = batch(s, [T], 2000);
    expect(rec.state.tripped).toBe(true);
    expect(rec.events.every(e => e === null)).toBe(true);
  });
});

describe("edgeCircuitBreaker — disabled kill-switch", () => {
  it("never auto-downgrades when disabled", () => {
    const cfg = { ...CFG, disabled: true };
    let s = initialBreakerState(0);
    for (let w = 0; w < 5; w++) s = batch(s, [F, F, F, F], w * 1000, cfg).state;
    expect(s.tripped).toBe(false);
  });

  it("force-closes an already-tripped breaker when disabled mid-flight", () => {
    let s = batch(initialBreakerState(0), [F, F, F], 0).state;
    s = batch(s, [F, F, F], 1000).state;
    s = batch(s, [F], 2000).state;
    expect(s.tripped).toBe(true);
    const r = observe(s, false, 2000, { ...CFG, disabled: true });
    expect(r.next.tripped).toBe(false);
    expect(r.event).toBe("recovered");
  });
});

describe("edgeBreakerConfig — env parsing", () => {
  it("uses defaults when unset", () => {
    expect(edgeBreakerConfig({})).toEqual({
      windowMs: 60_000,
      minSample: 200,
      verifiedFloor: 0,
      tripWindows: 3,
      recoverFloor: 3,
      bypassAlertFraction: 0.5,
      bypassAlertWindows: 3,
      disabled: false,
    });
  });

  it("parses overrides; verifiedFloor accepts 0, the rest reject 0/invalid", () => {
    const c = edgeBreakerConfig({
      EDGE_BREAKER_WINDOW_MS: "30000",
      EDGE_BREAKER_MIN_SAMPLE: "500",
      EDGE_BREAKER_VERIFIED_FLOOR: "0",
      EDGE_BREAKER_TRIP_WINDOWS: "5",
      EDGE_BREAKER_RECOVER_FLOOR: "10",
      EDGE_BREAKER_BYPASS_ALERT_FRACTION: "0.8",
      EDGE_BREAKER_BYPASS_ALERT_WINDOWS: "4",
      EDGE_BREAKER_DISABLED: "1",
    });
    expect(c).toEqual({
      windowMs: 30_000,
      minSample: 500,
      verifiedFloor: 0,
      tripWindows: 5,
      recoverFloor: 10,
      bypassAlertFraction: 0.8,
      bypassAlertWindows: 4,
      disabled: true,
    });
    const d = edgeBreakerConfig({
      EDGE_BREAKER_TRIP_WINDOWS: "0",
      EDGE_BREAKER_MIN_SAMPLE: "-1",
      EDGE_BREAKER_WINDOW_MS: "x",
    });
    expect(d.tripWindows).toBe(3);
    expect(d.minSample).toBe(200);
    expect(d.windowMs).toBe(60_000);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Task 5.4 — partial-bypass detection
//
// The plan's Step 2 proposed changing the TRIP condition from "zero verified"
// to a verified-FRACTION floor. That is unsound and is deliberately NOT what
// was built: a tripped breaker stops the origin lock from 403ing at all
// (originLock.ts), so a fraction rule hands an attacker an on-demand switch to
// disable the lock — unverified traffic is precisely what they can generate for
// free. These tests pin BOTH halves: detection fires, enforcement never moves.
// ═════════════════════════════════════════════════════════════════════════════

// Suspect after 2 consecutive windows that have >=10 obs, SOME verified, and
// >=50% unverified. Trip config is the same as CFG (2 starved windows).
const BYPASS_CFG: EdgeBreakerConfig = {
  windowMs: 1000,
  minSample: 10,
  verifiedFloor: 0,
  tripWindows: 2,
  recoverFloor: 2,
  bypassAlertFraction: 0.5,
  bypassAlertWindows: 2,
  disabled: false,
};

/** A window's worth of observations: `v` verified + `u` unverified. */
function window(v: number, u: number): boolean[] {
  return [...Array(v).fill(T), ...Array(u).fill(F)];
}

describe("edgeCircuitBreaker — partial bypass is detected, never self-healed", () => {
  it("does NOT alert on the real audited baseline (449 verified vs 5 unverified)", () => {
    // Plan Step 3, with the measured production numbers from the 2026-08-06
    // audit window: ~112 minutes, 449 verified through Cloudflare, 5 direct.
    // Spread across windows this is ~1.1% unverified — nowhere near suspect.
    let s = initialBreakerState(0);
    let alerts = 0;
    for (let w = 0; w < 4; w++) {
      const r = batch(s, window(112, 1), 1000 * (w + 1), BYPASS_CFG);
      s = r.state;
      alerts += r.events.filter(e => e === "partial_bypass_suspected").length;
    }
    console.log(`[STATE] baseline 449v/5u — alerts=${alerts} tripped=${s.tripped}`);
    expect(alerts).toBe(0);
    expect(s.tripped).toBe(false);
    expect(isEnforcing(s)).toBe(true);
    console.log("[VERIFY] PASS — healthy production traffic neither trips nor alerts");
  });

  it("ALERTS on sustained partial bypass — and leaves enforcement ON", () => {
    // Cloudflare is up (verified traffic present) but most ingress is direct:
    // the 2026-08-06 signature that went unnoticed for 7 hours.
    let s = initialBreakerState(0);
    const seen: (string | null)[] = [];
    for (let w = 0; w < 3; w++) {
      const r = batch(s, window(3, 17), 1000 * (w + 1), BYPASS_CFG);
      s = r.state;
      seen.push(...r.events);
    }
    console.log(`[STATE] events=${JSON.stringify(seen.filter(Boolean))}`);
    expect(seen).toContain("partial_bypass_suspected");
    // The whole point: detection did NOT drop the lock.
    expect(s.tripped).toBe(false);
    expect(isEnforcing(s)).toBe(true);
    console.log("[VERIFY] PASS — alerted, and the origin lock is still enforcing");
  });

  it("fires the suspicion ONCE per streak, not once per window", () => {
    let s = initialBreakerState(0);
    let fired = 0;
    for (let w = 0; w < 6; w++) {
      const r = batch(s, window(3, 17), 1000 * (w + 1), BYPASS_CFG);
      s = r.state;
      fired += r.events.filter(e => e === "partial_bypass_suspected").length;
    }
    console.log(`[STATE] suspicion events across 6 sustained windows: ${fired}`);
    expect(fired).toBe(1);
    console.log("[VERIFY] PASS — one-shot latch holds; no per-window alert flood");
  });

  it("clears when the unverified share returns to normal", () => {
    let s = initialBreakerState(0);
    for (let w = 0; w < 3; w++) s = batch(s, window(3, 17), 1000 * (w + 1), BYPASS_CFG).state;
    expect(s.bypassAlerted).toBe(true);
    const r = batch(s, window(19, 1), 4000, BYPASS_CFG);
    const r2 = batch(r.state, window(19, 1), 5000, BYPASS_CFG);
    console.log(`[STATE] clear events=${JSON.stringify([...r.events, ...r2.events].filter(Boolean))}`);
    expect([...r.events, ...r2.events]).toContain("partial_bypass_cleared");
    console.log("[VERIFY] PASS — signal clears once healthy ingress resumes");
  });

  it("ATTACK: an unverified flood cannot move enforcement at all", () => {
    // Regression guard against re-introducing a fraction-based TRIP.
    // 100 genuine verified req/window + 400 attacker-generated unverified —
    // an 80% unverified fraction, far past any sane floor. Enforcement must
    // not budge, because the attacker cannot suppress verified traffic.
    //
    // Measured for honesty: a fraction-floor trip does NOT fully bypass the
    // lock here (recovery re-closes it — 72/8000 unverified served, 9 trips
    // over 20 windows). The defect it introduces is attacker-induced FLAPPING
    // and alert storm, not takeover. This test pins zero movement either way.
    let s = initialBreakerState(0);
    const seen: (string | null)[] = [];
    for (let w = 0; w < 10; w++) {
      const r = batch(s, window(100, 400), 1000 * (w + 1), BYPASS_CFG);
      s = r.state;
      seen.push(...r.events);
    }
    console.log(
      `[STATE] after 10 flooded windows (80% unverified): tripped=${s.tripped} enforcing=${isEnforcing(s)}`
    );
    // Alerting on the flood is correct and desirable — it IS an attack signal.
    expect(seen).toContain("partial_bypass_suspected");
    // Never trips: no starved window ever occurred.
    expect(seen).not.toContain("tripped");
    expect(s.tripped).toBe(false);
    expect(isEnforcing(s)).toBe(true);
    console.log("[VERIFY] PASS — flood produced an alert, NOT an edge bypass");
  });
});
