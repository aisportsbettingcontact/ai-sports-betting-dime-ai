import { describe, it, expect } from "vitest";
import { computePowerScore, deriveTier, POWER_WEIGHTS, type PowerScoreInput } from "./powerScore";

const base: PowerScoreInput = {
  daysSinceLastActive: 0,
  activeDays: 0,
  distinctSurfaces: 0,
  valueEvents: 0,
  actionEvents: 0,
  sessions: 0,
};

describe("computePowerScore", () => {
  it("weights sum to 1", () => {
    const sum = Object.values(POWER_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });
  it("a dead-cold account scores near zero (only Recency, and that's 0 far out)", () => {
    const { score } = computePowerScore({ ...base, daysSinceLastActive: 60 });
    expect(score).toBeLessThanOrEqual(1);
  });
  it("a fully-engaged recent user scores high (≤ ~90 in P0 without streak)", () => {
    const { score, tier } = computePowerScore({
      daysSinceLastActive: 0,
      activeDays: 30,
      distinctSurfaces: 4,
      valueEvents: 60,
      actionEvents: 240,
      sessions: 20,
      longestStreak: 14,
    });
    expect(score).toBeGreaterThanOrEqual(85);
    expect(score).toBeLessThanOrEqual(100);
    expect(tier).toBe("power");
  });
  it("is monotonic in value events (more value ⇒ ≥ score)", () => {
    const lo = computePowerScore({ ...base, daysSinceLastActive: 1, valueEvents: 2, sessions: 1, activeDays: 2 }).score;
    const hi = computePowerScore({ ...base, daysSinceLastActive: 1, valueEvents: 40, sessions: 1, activeDays: 2 }).score;
    expect(hi).toBeGreaterThanOrEqual(lo);
  });
  it("clamps out-of-range inputs (never > 100, never negative)", () => {
    const { score } = computePowerScore({
      daysSinceLastActive: -5,
      activeDays: 999,
      distinctSurfaces: 9,
      valueEvents: 9999,
      actionEvents: 9999,
      sessions: 1,
      longestStreak: 999,
    });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

describe("deriveTier — recency gates override the raw score", () => {
  it("caps a high score at at_risk after 14 idle days", () => {
    expect(deriveTier(95, 20)).toBe("at_risk");
  });
  it("is dormant after 30 idle days regardless of score", () => {
    expect(deriveTier(95, 40)).toBe("dormant");
  });
  it("maps fresh scores to the right band", () => {
    expect(deriveTier(72, 0)).toBe("power");
    expect(deriveTier(55, 1)).toBe("core");
    expect(deriveTier(35, 2)).toBe("casual");
    expect(deriveTier(20, 3)).toBe("at_risk");
    expect(deriveTier(5, 3)).toBe("dormant");
  });
});
