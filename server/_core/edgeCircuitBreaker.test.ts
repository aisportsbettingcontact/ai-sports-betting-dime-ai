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
const CFG: EdgeBreakerConfig = {
  windowMs: 1000,
  minSample: 3,
  verifiedFloor: 0,
  tripWindows: 2,
  recoverFloor: 2,
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
      EDGE_BREAKER_DISABLED: "1",
    });
    expect(c).toEqual({
      windowMs: 30_000,
      minSample: 500,
      verifiedFloor: 0,
      tripWindows: 5,
      recoverFloor: 10,
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
