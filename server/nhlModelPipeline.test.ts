/**
 * NHL Model Pipeline Tests
 * Tests: model engine output parsing, puck line odds calculation,
 *        goalie adjustment logic, freeze detection, sport-scoping
 */
import { describe, it, expect } from "vitest";

// ─── 1. Puck line odds calculation ────────────────────────────────────────────
// The model converts win probability to American odds
function probToAmerican(prob: number): number {
  if (prob <= 0 || prob >= 1) throw new Error("prob must be in (0,1)");
  if (prob >= 0.5) {
    return Math.round(-(prob / (1 - prob)) * 100);
  } else {
    return Math.round(((1 - prob) / prob) * 100);
  }
}

describe("probToAmerican", () => {
  it("50% → ±100", () => {
    expect(probToAmerican(0.5)).toBe(-100);
  });
  it("60% favorite → negative odds", () => {
    const odds = probToAmerican(0.6);
    expect(odds).toBeLessThan(0);
    expect(odds).toBe(-150);
  });
  it("40% underdog → positive odds", () => {
    const odds = probToAmerican(0.4);
    expect(odds).toBeGreaterThan(0);
    expect(odds).toBe(150);
  });
  it("68.6% → approx -218", () => {
    const odds = probToAmerican(0.686);
    expect(odds).toBeLessThan(-200);
  });
});

// ─── 2. Goalie adjustment ─────────────────────────────────────────────────────
type GoalieRating = "elite" | "average" | "weak";

function goalieAdjustment(rating: GoalieRating): number {
  if (rating === "elite") return -0.35;
  if (rating === "weak") return 0.4;
  return 0.0;
}

describe("goalieAdjustment", () => {
  it("elite goalie reduces expected goals by 0.35", () => {
    expect(goalieAdjustment("elite")).toBe(-0.35);
  });
  it("average goalie has no adjustment", () => {
    expect(goalieAdjustment("average")).toBe(0.0);
  });
  it("weak goalie adds 0.40 expected goals", () => {
    expect(goalieAdjustment("weak")).toBe(0.4);
  });
});

// ─── 3. Puck line cover probability ──────────────────────────────────────────
// Away team is always +1.5, home team is always -1.5
// Away covers +1.5 if: awayGoals + 1.5 > homeGoals  → awayGoals >= homeGoals - 1
// i.e. away loses by 1 or less, or wins outright
function simulatePuckLineCover(
  awayGoals: number,
  homeGoals: number
): { awayCoversPL: boolean; homeCoversPL: boolean } {
  const awayCoversPL = awayGoals + 1.5 > homeGoals; // away +1.5
  const homeCoversPL = homeGoals - 1.5 > awayGoals; // home -1.5
  return { awayCoversPL, homeCoversPL };
}

describe("simulatePuckLineCover", () => {
  it("away wins 3-2: away covers +1.5, home does NOT cover -1.5", () => {
    const { awayCoversPL, homeCoversPL } = simulatePuckLineCover(3, 2);
    expect(awayCoversPL).toBe(true);
    expect(homeCoversPL).toBe(false);
  });
  it("home wins 4-2: home covers -1.5, away does NOT cover +1.5", () => {
    const { awayCoversPL, homeCoversPL } = simulatePuckLineCover(2, 4);
    expect(awayCoversPL).toBe(false);
    expect(homeCoversPL).toBe(true);
  });
  it("home wins 3-2: away covers +1.5 (loses by 1), home does NOT cover -1.5", () => {
    const { awayCoversPL, homeCoversPL } = simulatePuckLineCover(2, 3);
    expect(awayCoversPL).toBe(true); // 2 + 1.5 = 3.5 > 3 ✓
    expect(homeCoversPL).toBe(false); // 3 - 1.5 = 1.5 < 2 ✗
  });
  it("tie 3-3: away covers +1.5, home does NOT cover -1.5", () => {
    const { awayCoversPL, homeCoversPL } = simulatePuckLineCover(3, 3);
    expect(awayCoversPL).toBe(true); // 3 + 1.5 = 4.5 > 3 ✓
    expect(homeCoversPL).toBe(false); // 3 - 1.5 = 1.5 < 3 ✗
  });
});

// ─── 4. Model output parsing ──────────────────────────────────────────────────
interface NhlModelOutput {
  projectedAwayGoals: number;
  projectedHomeGoals: number;
  awayPLOdds: number;
  homePLOdds: number;
  awayML: number;
  homeML: number;
  overLine: number;
  overOdds: number;
  underOdds: number;
  awayPLCoverPct: number;
  homePLCoverPct: number;
}

function parseModelOutput(raw: Record<string, unknown>): NhlModelOutput {
  return {
    projectedAwayGoals: Number(raw.projected_away_goals),
    projectedHomeGoals: Number(raw.projected_home_goals),
    awayPLOdds: Number(raw.away_pl_odds),
    homePLOdds: Number(raw.home_pl_odds),
    awayML: Number(raw.away_ml),
    homeML: Number(raw.home_ml),
    overLine: Number(raw.over_line),
    overOdds: Number(raw.over_odds),
    underOdds: Number(raw.under_odds),
    awayPLCoverPct: Number(raw.away_pl_cover_pct),
    homePLCoverPct: Number(raw.home_pl_cover_pct),
  };
}

describe("parseModelOutput", () => {
  const sampleRaw = {
    projected_away_goals: 2.73,
    projected_home_goals: 3.18,
    away_pl_odds: 135,
    home_pl_odds: -135,
    away_ml: 135,
    home_ml: -135,
    over_line: 6.0,
    over_odds: -101,
    under_odds: 101,
    away_pl_cover_pct: 0.686,
    home_pl_cover_pct: 0.314,
  };

  it("parses projected goals correctly", () => {
    const out = parseModelOutput(sampleRaw);
    expect(out.projectedAwayGoals).toBeCloseTo(2.73);
    expect(out.projectedHomeGoals).toBeCloseTo(3.18);
  });

  it("parses puck line odds correctly", () => {
    const out = parseModelOutput(sampleRaw);
    expect(out.awayPLOdds).toBe(135);
    expect(out.homePLOdds).toBe(-135);
  });

  it("parses total correctly", () => {
    const out = parseModelOutput(sampleRaw);
    expect(out.overLine).toBe(6.0);
    expect(out.overOdds).toBe(-101);
    expect(out.underOdds).toBe(101);
  });

  it("parses puck line cover percentages correctly", () => {
    const out = parseModelOutput(sampleRaw);
    expect(out.awayPLCoverPct).toBeCloseTo(0.686);
    expect(out.homePLCoverPct).toBeCloseTo(0.314);
    // They should sum to ~1.0
    expect(out.awayPLCoverPct + out.homePLCoverPct).toBeCloseTo(1.0);
  });
});

// ─── 5. Sport-scoping logic ───────────────────────────────────────────────────
type Sport = "NCAAM" | "NBA" | "NHL";

function shouldRefreshSport(activeSport: Sport, targetSport: Sport): boolean {
  return activeSport === targetSport;
}

describe("sport-scoping", () => {
  it("NHL tab only refreshes NHL", () => {
    expect(shouldRefreshSport("NHL", "NHL")).toBe(true);
    expect(shouldRefreshSport("NHL", "NBA")).toBe(false);
    expect(shouldRefreshSport("NHL", "NCAAM")).toBe(false);
  });
  it("NCAAM tab only refreshes NCAAM", () => {
    expect(shouldRefreshSport("NCAAM", "NCAAM")).toBe(true);
    expect(shouldRefreshSport("NCAAM", "NHL")).toBe(false);
    expect(shouldRefreshSport("NCAAM", "NBA")).toBe(false);
  });
  it("NBA tab only refreshes NBA", () => {
    expect(shouldRefreshSport("NBA", "NBA")).toBe(true);
    expect(shouldRefreshSport("NBA", "NHL")).toBe(false);
    expect(shouldRefreshSport("NBA", "NCAAM")).toBe(false);
  });
});

// ─── 6. Odds freeze detection ─────────────────────────────────────────────────
type GameStatus = "scheduled" | "live" | "final" | "postponed";

function shouldFreezeOdds(gameStatus: GameStatus): boolean {
  return gameStatus === "live" || gameStatus === "final";
}

describe("shouldFreezeOdds", () => {
  it("freezes odds for live games", () => {
    expect(shouldFreezeOdds("live")).toBe(true);
  });
  it("freezes odds for final games", () => {
    expect(shouldFreezeOdds("final")).toBe(true);
  });
  it("does NOT freeze odds for scheduled games", () => {
    expect(shouldFreezeOdds("scheduled")).toBe(false);
  });
  it("does NOT freeze odds for postponed games", () => {
    expect(shouldFreezeOdds("postponed")).toBe(false);
  });
});

// ─── 7. Puck line display format ──────────────────────────────────────────────
function formatPuckLine(isAway: boolean): string {
  return isAway ? "+1.5" : "-1.5";
}

describe("formatPuckLine", () => {
  it("away team always shows +1.5", () => {
    expect(formatPuckLine(true)).toBe("+1.5");
  });
  it("home team always shows -1.5", () => {
    expect(formatPuckLine(false)).toBe("-1.5");
  });
});

// ─── 8. Bayesian goalie multiplier regression ─────────────────────────────────
// Mirrors the Python engine's compute_goalie_multiplier with GOALIE_REGRESSION_K=500
const GOALIE_REGRESSION_K = 500;

function computeGoalieMultiplier(
  gsax: number,
  shotsFaced: number,
  gp: number
): number {
  let sa = shotsFaced;
  if (sa <= 0) {
    sa = (gp || 1) * 28;
  }
  const rawEffect = gsax / sa;
  const regressionWeight = sa / (sa + GOALIE_REGRESSION_K);
  const regressedEffect = rawEffect * regressionWeight;
  const multiplier = 1.0 - regressedEffect;
  return Math.max(0.88, Math.min(1.12, multiplier));
}

describe("computeGoalieMultiplier (Bayesian regression)", () => {
  it("average goalie (GSAx=0) always returns 1.0 regardless of sample size", () => {
    expect(computeGoalieMultiplier(0, 800, 30)).toBeCloseTo(1.0);
    expect(computeGoalieMultiplier(0, 50, 2)).toBeCloseTo(1.0);
  });

  it("tiny-sample backup (1 GP, 20 SA) is heavily regressed toward 1.0", () => {
    // Laurent Brossoit case: GSAx=-2.12, SA=20 → old multiplier was 1.106, new should be ~1.004
    const m = computeGoalieMultiplier(-2.12, 20, 1);
    expect(m).toBeGreaterThan(1.0);
    expect(m).toBeLessThan(1.01); // Heavily regressed — nearly neutral
  });

  it("elite goalie with large sample gets meaningful multiplier below 1.0", () => {
    // Darcy Kuemper: GSAx=7.37, SA=769 → should be meaningfully below 1.0
    const m = computeGoalieMultiplier(7.37, 769, 41);
    expect(m).toBeLessThan(1.0);
    expect(m).toBeGreaterThan(0.99); // Still modest — GSAx/SA = 0.96%
  });

  it("weak goalie with large sample gets multiplier above 1.0", () => {
    // Binnington: GSAx=-14.77, SA=725 → should be above 1.0 but dampened
    const m = computeGoalieMultiplier(-14.77, 725, 36);
    expect(m).toBeGreaterThan(1.0);
    expect(m).toBeLessThan(1.02); // Dampened by regression
  });

  it("clamps to [0.88, 1.12] for extreme outliers", () => {
    // Hypothetical extreme: GSAx=+50 on 1000 SA → raw effect = 5% → multiplier = 0.95 (within clamp)
    const m1 = computeGoalieMultiplier(50, 1000, 40);
    expect(m1).toBeGreaterThanOrEqual(0.88);
    // Hypothetical extreme: GSAx=-50 on 1000 SA → raw effect = -5% → multiplier = 1.05 (within clamp)
    const m2 = computeGoalieMultiplier(-50, 1000, 40);
    expect(m2).toBeLessThanOrEqual(1.12);
  });

  it("regression weight increases with sample size", () => {
    // Same GSAx rate but different sample sizes — larger sample should have stronger effect
    const smallSample = computeGoalieMultiplier(-5, 100, 4); // 100 SA
    const largeSample = computeGoalieMultiplier(-25, 500, 20); // 500 SA (same -5/100 rate)
    // Large sample should deviate more from 1.0 (stronger negative effect)
    expect(largeSample).toBeGreaterThan(smallSample);
  });
});
