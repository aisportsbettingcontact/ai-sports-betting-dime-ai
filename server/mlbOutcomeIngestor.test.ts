import { describe, expect, it } from "vitest";
import {
  brierScore,
  computeBrierScores,
  parseNumOrNull,
  probFromPct,
  probFromUnit,
  type GameOutcome,
} from "./mlbOutcomeIngestor";

/**
 * First unit coverage of mlbOutcomeIngestor (audit M-203).
 *
 * The bug these tests exist to prevent: the games table stores model
 * probabilities on TWO scales — 0-100 for modelOverRate / modelHomeWinPct /
 * modelF5HomeWinPct, and 0-1 for modelF5OverRate / modelPNrfi — and brierScore
 * used to divide EVERY input by 100. The two unit-scaled markets were
 * therefore scored at 1/100th of their real probability for the whole 2026
 * season, and there was no test in the repo that could notice.
 */

const outcome = (over: Partial<GameOutcome> = {}): GameOutcome =>
  ({
    gamePk: 1,
    awayAbbrev: "NYY",
    homeAbbrev: "BOS",
    awayFgRuns: 5,
    homeFgRuns: 4,
    awayF5Runs: 3,
    homeF5Runs: 2,
    nrfiBinary: 1,
    ...over,
  }) as GameOutcome;

describe("probability scale helpers", () => {
  it("parseNumOrNull tolerates decimal strings, null and junk", () => {
    expect(parseNumOrNull("0.5234")).toBeCloseTo(0.5234, 6);
    expect(parseNumOrNull(54.3)).toBe(54.3);
    expect(parseNumOrNull(null)).toBeNull();
    expect(parseNumOrNull(undefined)).toBeNull();
    expect(parseNumOrNull("not-a-number")).toBeNull();
  });

  it("probFromPct divides, probFromUnit does not — that is the whole bug", () => {
    expect(probFromPct("54.30")).toBeCloseTo(0.543, 6);
    expect(probFromUnit("0.5430")).toBeCloseTo(0.543, 6);
    // The same stored string means different things per column.
    expect(probFromPct("0.5234")).toBeCloseTo(0.005234, 8);
    expect(probFromUnit("0.5234")).toBeCloseTo(0.5234, 8);
  });
});

describe("brierScore takes an ALREADY-normalized [0,1] probability", () => {
  it("scores a confident correct call near zero", () => {
    expect(brierScore(0.9, 1)).toBeCloseTo(0.01, 6);
  });
  it("scores a confident wrong call near one", () => {
    expect(brierScore(0.9, 0)).toBeCloseTo(0.81, 6);
  });
  it("rejects out-of-range input rather than scoring nonsense", () => {
    // A caller that forgets probFromPct and passes a raw 0-100 value gets null,
    // not a silently wrong score.
    expect(brierScore(54.3, 1)).toBeNull();
    expect(brierScore(-0.1, 1)).toBeNull();
  });
  it("is null when either input is missing", () => {
    expect(brierScore(null, 1)).toBeNull();
    expect(brierScore(0.5, null)).toBeNull();
  });
});

describe("computeBrierScores — M-203 regression", () => {
  const game = {
    bookTotal: "8.5",
    modelOverRate: "54.30", // 0-100
    f5Total: "4.5",
    modelF5OverRate: "0.5234", // 0-1  ← was scored as 0.005234
    modelPNrfi: "0.5200", // 0-1  ← was scored as 0.0052
    modelHomeWinPct: "45.10", // 0-100
    modelF5HomeWinPct: "48.00", // 0-100
  };

  it("scores the two UNIT-scaled markets on their real probability", () => {
    // FG total 9 > 8.5 → over hit. F5 total 5 > 4.5 → over hit. NRFI = 1.
    const r = computeBrierScores(game, outcome());
    // Pre-fix these were (0.005234 - 1)^2 = 0.98956 and (0.0052 - 1)^2 = 0.98963
    // — indistinguishable from a model that always predicted the opposite.
    expect(r.brierF5Total).toBeCloseTo((0.5234 - 1) ** 2, 6);
    expect(r.brierNrfi).toBeCloseTo((0.52 - 1) ** 2, 6);
    // The tell: a coin-flip probability must never score worse than 0.25 on a
    // hit. Pre-fix both were ~0.99.
    expect(r.brierF5Total!).toBeLessThan(0.25);
    expect(r.brierNrfi!).toBeLessThan(0.25);
  });

  it("leaves the three PERCENT-scaled markets numerically unchanged", () => {
    const r = computeBrierScores(game, outcome());
    expect(r.brierFgTotal).toBeCloseTo((0.543 - 1) ** 2, 6);
    expect(r.brierFgMl).toBeCloseTo((0.451 - 0) ** 2, 6); // away won FG
    expect(r.brierF5Ml).toBeCloseTo((0.48 - 0) ** 2, 6); // away led after 5
  });

  it("nulls a push rather than scoring it", () => {
    const r = computeBrierScores(
      { ...game, bookTotal: "9" },
      outcome() // 5 + 4 = 9 exactly
    );
    expect(r.brierFgTotal).toBeNull();
  });

  it("nulls every market when the linescore is unavailable", () => {
    const r = computeBrierScores(
      game,
      outcome({
        awayFgRuns: null,
        homeFgRuns: null,
        awayF5Runs: null,
        homeF5Runs: null,
        nrfiBinary: null,
      })
    );
    expect(r).toEqual({
      brierFgTotal: null,
      brierF5Total: null,
      brierNrfi: null,
      brierFgMl: null,
      brierF5Ml: null,
    });
  });
});
