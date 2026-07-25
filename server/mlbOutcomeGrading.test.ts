/**
 * Unit tests for the outcome ingestor's pure grading + Brier functions.
 *
 * Covers the two audited defects fixed in mlbOutcomeIngestor.ts:
 *   M-203 — brierScore divided every input by 100 while modelPNrfi and
 *           modelF5OverRate are stored 0-1 (garbage briers, p≈0.005).
 *   M-101 — the games grading columns graded a fixed away-side bet instead
 *           of the model's pick.
 *
 * No DB access: all functions under test are pure.
 */

import { describe, expect, it } from "vitest";
import {
  brierScore,
  computeBrierScores,
  computeModelPickGrades,
  gradeMoneylinePick,
  gradeNrfiPick,
  gradeRunLinePick,
  gradeTotalPick,
  probFromPct,
  probFromUnit,
  type GameOutcome,
} from "./mlbOutcomeIngestor";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeOutcome(overrides: Partial<GameOutcome> = {}): GameOutcome {
  return {
    gamePk: 1,
    awayAbbrev: "NYY",
    homeAbbrev: "BOS",
    awayFgRuns: null,
    homeFgRuns: null,
    awayF5Runs: null,
    homeF5Runs: null,
    nrfiBinary: null,
    isFinal: true,
    ...overrides,
  };
}

/** A game row with every model column populated on its true storage scale. */
const FULL_GAME = {
  bookTotal: "8.5",
  modelOverRate: "60.00",        // 0-100
  f5Total: "4.5",
  modelF5OverRate: "0.6000",     // 0-1 (NOT 0-100)
  modelPNrfi: "0.5500",          // 0-1 (NOT 0-100)
  modelHomeWinPct: "55.00",      // 0-100
  modelF5HomeWinPct: "48.00",    // 0-100
  modelAwayWinPct: "45.00",      // 0-100
  modelF5AwayWinPct: "52.00",    // 0-100
  modelAwayScore: "4.10",
  modelHomeScore: "4.90",
  modelF5AwayScore: "2.60",
  modelF5HomeScore: "2.20",
  awayRunLine: "+1.5",
  f5AwayRunLine: "-0.5",
};

// ─── Brier scales (M-203) ─────────────────────────────────────────────────────

describe("brier scales (M-203)", () => {
  it("probFromPct normalizes 0-100 columns to [0,1]", () => {
    expect(probFromPct("54.30")).toBeCloseTo(0.543, 10);
    expect(probFromPct(null)).toBeNull();
    expect(probFromPct("not-a-number")).toBeNull();
  });

  it("probFromUnit passes 0-1 columns through unscaled", () => {
    expect(probFromUnit("0.5430")).toBeCloseTo(0.543, 10);
    expect(probFromUnit(null)).toBeNull();
  });

  it("brierScore takes an already-normalized probability", () => {
    expect(brierScore(0.543, 1)).toBe(0.208849);
    expect(brierScore(0.543, 0)).toBe(0.294849);
  });

  it("brierScore rejects un-normalized (out-of-range) probabilities", () => {
    // A 0-100 value passed without normalization must NOT silently produce
    // a garbage score.
    expect(brierScore(54.3, 1)).toBeNull();
    expect(brierScore(-0.1, 0)).toBeNull();
    expect(brierScore(null, 1)).toBeNull();
    expect(brierScore(0.5, null)).toBeNull();
  });

  it("computeBrierScores normalizes each column on its own storage scale", () => {
    // FG 6-4 (total 10 > 8.5 → over), F5 3-2 (total 5 > 4.5 → over), NRFI held
    const outcome = makeOutcome({
      awayFgRuns: 6, homeFgRuns: 4,
      awayF5Runs: 3, homeF5Runs: 2,
      nrfiBinary: 1,
    });
    const briers = computeBrierScores(FULL_GAME, outcome);

    // modelOverRate 60.00 (0-100) → p=0.6, over hit → (0.6-1)^2
    expect(briers.brierFgTotal).toBe(0.16);
    // modelF5OverRate 0.6000 (0-1) → p=0.6, over hit → (0.6-1)^2.
    // The pre-fix /100 bug produced (0.006-1)^2 ≈ 0.988036 here.
    expect(briers.brierF5Total).toBe(0.16);
    // modelPNrfi 0.5500 (0-1) → (0.55-1)^2. Pre-fix bug: (0.0055-1)^2 ≈ 0.989.
    expect(briers.brierNrfi).toBe(0.2025);
    // modelHomeWinPct 55.00 (0-100), home lost → (0.55-0)^2
    expect(briers.brierFgMl).toBe(0.3025);
    // modelF5HomeWinPct 48.00 (0-100), home lost F5 → (0.48-0)^2
    expect(briers.brierF5Ml).toBe(0.2304);
  });
});

// ─── Model-pick vs away-side grading (M-101) ─────────────────────────────────

describe("model-pick grading vs away-side grading (M-101)", () => {
  it("grades a WIN when the model's HOME pick wins even though away lost", () => {
    // pAway=0.4 → pick home; home wins 5-3. Away-side grading would call this
    // a LOSS (away lost) — the exact M-101 defect.
    expect(gradeMoneylinePick(0.4, 3, 5)).toEqual({ result: "WIN", correct: 1 });
  });

  it("grades a LOSS when the model's AWAY pick loses", () => {
    expect(gradeMoneylinePick(0.6, 2, 5)).toEqual({ result: "LOSS", correct: 0 });
  });

  it("grades a LOSS when the model's HOME pick loses even though away won", () => {
    // Away-side grading would call this a WIN.
    expect(gradeMoneylinePick(0.4, 5, 3)).toEqual({ result: "LOSS", correct: 0 });
  });

  it("picks home at exactly 50% (pick = pAway > 0.5)", () => {
    expect(gradeMoneylinePick(0.5, 3, 5)).toEqual({ result: "WIN", correct: 1 });
  });

  it("returns nulls without a model probability or scores", () => {
    expect(gradeMoneylinePick(null, 3, 5)).toEqual({ result: null, correct: null });
    expect(gradeMoneylinePick(0.6, null, 5)).toEqual({ result: null, correct: null });
  });
});

// ─── Push handling ────────────────────────────────────────────────────────────

describe("push handling", () => {
  it("F5 ML tie → PUSH with correct null", () => {
    expect(gradeMoneylinePick(0.6, 2, 2)).toEqual({ result: "PUSH", correct: null });
  });

  it("run line exact cover → PUSH with correct null", () => {
    // away -2, actual away margin exactly 2 → cover lands on the line
    expect(gradeRunLinePick(1, -2, 2)).toEqual({ result: "PUSH", correct: null });
  });

  it("run line model margin exactly on the line → no pick, both null", () => {
    expect(gradeRunLinePick(2, -2, 3)).toEqual({ result: null, correct: null });
  });

  it("total exact push → PUSH with correct null", () => {
    expect(gradeTotalPick(0.6, 9, 9)).toEqual({ result: "PUSH", correct: null });
  });
});

// ─── Run line pick grading ────────────────────────────────────────────────────

describe("gradeRunLinePick", () => {
  it("away +1.5 pick covers on a 1-run away loss", () => {
    // model margin -1 → -1+1.5 > 0 → pick away; actual -1 → covered
    expect(gradeRunLinePick(-1, 1.5, -1)).toEqual({ result: "WIN", correct: 1 });
  });

  it("away +1.5 pick loses on a 2-run away loss", () => {
    expect(gradeRunLinePick(-1, 1.5, -2)).toEqual({ result: "LOSS", correct: 0 });
  });

  it("away -1.5 pick loses when away wins by only 1", () => {
    // model margin 2.4 → 2.4-1.5 > 0 → pick away; actual 1 → 1-1.5 < 0 → home covered
    expect(gradeRunLinePick(2.4, -1.5, 1)).toEqual({ result: "LOSS", correct: 0 });
  });

  it("returns nulls when the line is missing", () => {
    expect(gradeRunLinePick(2.4, null, 1)).toEqual({ result: null, correct: null });
  });
});

// ─── Total pick grading ───────────────────────────────────────────────────────

describe("gradeTotalPick", () => {
  it("records the actual side and grades the model pick", () => {
    expect(gradeTotalPick(0.6, 8.5, 10)).toEqual({ result: "OVER", correct: 1 });
    expect(gradeTotalPick(0.6, 8.5, 8)).toEqual({ result: "UNDER", correct: 0 });
    expect(gradeTotalPick(0.4, 8.5, 8)).toEqual({ result: "UNDER", correct: 1 });
  });

  it("records the actual side with correct null when the model prob is missing", () => {
    expect(gradeTotalPick(null, 8.5, 10)).toEqual({ result: "OVER", correct: null });
  });

  it("returns nulls without a line (0 = no line)", () => {
    expect(gradeTotalPick(0.6, 0, 10)).toEqual({ result: null, correct: null });
    expect(gradeTotalPick(0.6, null, 10)).toEqual({ result: null, correct: null });
  });
});

// ─── NRFI pick grading ────────────────────────────────────────────────────────

describe("gradeNrfiPick", () => {
  it("grades the NRFI/YRFI pick against the binary actual", () => {
    expect(gradeNrfiPick(0.55, 1)).toEqual({ result: "WIN", correct: 1 });
    expect(gradeNrfiPick(0.55, 0)).toEqual({ result: "LOSS", correct: 0 });
    expect(gradeNrfiPick(0.45, 0)).toEqual({ result: "WIN", correct: 1 });
    expect(gradeNrfiPick(0.45, 1)).toEqual({ result: "LOSS", correct: 0 });
  });

  it("returns nulls when inputs are missing", () => {
    expect(gradeNrfiPick(null, 1)).toEqual({ result: null, correct: null });
    expect(gradeNrfiPick(0.55, null)).toEqual({ result: null, correct: null });
  });
});

// ─── computeModelPickGrades integration ──────────────────────────────────────

describe("computeModelPickGrades", () => {
  it("grades all markets from one row using per-column storage scales", () => {
    // FG: away 3, home 5 (total 8, margin -2). F5: 2-2 (total 4, margin 0). NRFI held.
    const outcome = makeOutcome({
      awayFgRuns: 3, homeFgRuns: 5,
      awayF5Runs: 2, homeF5Runs: 2,
      nrfiBinary: 1,
    });
    const grades = computeModelPickGrades(FULL_GAME, outcome);

    // modelAwayWinPct 45.00 → pick home; home won → WIN (away-side grading: LOSS)
    expect(grades.fgMlResult).toBe("WIN");
    expect(grades.fgMlCorrect).toBe(1);
    // model margin 4.10-4.90=-0.8, away +1.5 → -0.8+1.5>0 → pick away;
    // actual -2+1.5<0 → home covered → LOSS
    expect(grades.fgRlResult).toBe("LOSS");
    expect(grades.fgRlCorrect).toBe(0);
    // modelOverRate 60.00 (0-100) → pick over; actual 8 < 8.5 → UNDER, wrong
    expect(grades.fgTotalResult).toBe("UNDER");
    expect(grades.fgTotalCorrect).toBe(0);
    // F5 tie → PUSH, correct null
    expect(grades.f5MlResult).toBe("PUSH");
    expect(grades.f5MlCorrect).toBeNull();
    // model F5 margin 0.4, away -0.5 → -0.1 → pick home; actual 0-0.5<0 → home covered → WIN
    expect(grades.f5RlResult).toBe("WIN");
    expect(grades.f5RlCorrect).toBe(1);
    // modelF5OverRate 0.6000 (0-1!) → pick over; actual 4 < 4.5 → UNDER, wrong.
    // If the 0-1 column were wrongly read as a percent (0.006 → pick under),
    // this would grade correct=1 — the scale regression this test pins.
    expect(grades.f5TotalResult).toBe("UNDER");
    expect(grades.f5TotalCorrect).toBe(0);
    // modelPNrfi 0.5500 (0-1!) → pick NRFI; held → WIN. A wrongly /100-scaled
    // read (0.0055) would pick YRFI and grade LOSS.
    expect(grades.nrfiBacktestResult).toBe("WIN");
    expect(grades.nrfiCorrect).toBe(1);
  });

  it("returns all nulls when model columns and lines are absent", () => {
    const emptyGame = {
      bookTotal: null, modelOverRate: null, f5Total: null, modelF5OverRate: null,
      modelPNrfi: null, modelAwayWinPct: null, modelF5AwayWinPct: null,
      modelAwayScore: null, modelHomeScore: null, modelF5AwayScore: null,
      modelF5HomeScore: null, awayRunLine: null, f5AwayRunLine: null,
    };
    const outcome = makeOutcome({
      awayFgRuns: 3, homeFgRuns: 5,
      awayF5Runs: 2, homeF5Runs: 1,
      nrfiBinary: 0,
    });
    const grades = computeModelPickGrades(emptyGame, outcome);
    for (const value of Object.values(grades)) {
      expect(value).toBeNull();
    }
  });
});
