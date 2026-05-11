/**
 * mlbMultiMarketBacktest.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Multi-Market MLB Backtest Engine
 *
 * Markets evaluated per game:
 *   1. Full Game ML (home/away)
 *   2. Full Game Run Line (home -1.5 / away +1.5)
 *   3. Full Game Total (over/under)
 *   4. F5 ML (home/away)
 *   5. F5 Run Line (home -0.5 / away +0.5)
 *   6. F5 Total (over/under)
 *   7. NRFI / YRFI (1st inning total 0.5)
 *   8. K-Props (per pitcher — delegated to kPropsBacktestService)
 *   9. HR Props (per batter — from mlb_hr_props table)
 *
 * Result evaluation:
 *   WIN  — model prediction matches actual outcome AND edge >= CONFIDENCE_THRESHOLD
 *   LOSS — model prediction does not match actual outcome AND edge >= CONFIDENCE_THRESHOLD
 *   PUSH — actual outcome lands exactly on the line
 *   NO_ACTION — model edge below CONFIDENCE_THRESHOLD
 *   MISSING_DATA — actual scores or required data not yet populated
 *
 * Automated learning:
 *   - Per-market accuracy tracked in mlb_game_backtest table
 *   - Rolling 7-day / 30-day accuracy computed per market
 *   - Drift detection: flag if 7-day accuracy deviates > 2σ from 30-day baseline
 *   - Recalibration trigger: write to mlb_model_learning_log when drift detected
 *
 * Auto-triggered by runMlbCycle when a game transitions to FINAL status.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { getDb } from "./db";
import {
  games,
  mlbHrProps,
  mlbGameBacktest,
  mlbModelLearningLog,
} from "../drizzle/schema";
import { runKPropsBacktest } from "./kPropsBacktestService";

// ─────────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────────
const TAG = "[MLB-BACKTEST]";
const CONFIDENCE_THRESHOLD = 0.65;   // minimum model probability to act (totals/NRFI only)
const MIN_EDGE_THRESHOLD    = 0.05;   // minimum edge vs book no-vig prob to act (ML/RL markets)
// NOTE: ML/RL markets use edge-based confidence (modelProb - bookNoVigProb >= MIN_EDGE_THRESHOLD)
// because away ML base rate is ~44.75% — raw prob threshold of 0.65 would never fire for away bets.
// Totals/NRFI use raw probability threshold since they are symmetric markets.
//
// FG ML Home market-specific threshold:
// Sensitivity scan (n=554 games) shows edge>=0.06 produces 58.1% ACC / +10.9% ROI (n=74),
// while edge>=0.05 is only 51.5% ACC / -1.7% ROI (n=99). The 5% threshold captures 25 extra
// games in the 0.05-0.06 bucket that have a 36% win rate — pure noise. Raising to 6% removes
// this low-confidence band and concentrates action on genuine model disagreement.
const FG_ML_HOME_EDGE_THRESHOLD = 0.06;  // raised from 0.05 — backtest: 58.1% ACC +10.9% ROI (n=74)
//
// FG RL Away market-specific threshold:
// The fg_ml_home_edge (+0.03) calibration correction inflates away +1.5 cover probability on
// ~81% of games, pushing nearly every game above the 5% edge threshold. This is a systematic
// model bias artifact, not a genuine edge. Raising to 18% concentrates action on games where
// the model has a structural advantage (away team meaningfully better than the line implies).
// Backtest target: action rate ~15-25%, accuracy >= 58%.
const FG_RL_AWAY_EDGE_THRESHOLD = 0.18;  // raised from 0.05 — market-specific, see comment above
const DRIFT_SIGMA_THRESHOLD = 2.0;   // standard deviations to trigger recalibration
const MIN_SAMPLE_FOR_DRIFT  = 20;    // minimum samples before drift detection fires

// ─── Backtest-calibrated NRFI/F5 constants (3-YR ROLLING: 2024+2025+2026, n=5103 games) ──────
// NRFI: 51.50% 3-yr rate (n=5103 graded). 2024=53.25% | 2025=49.71% | 2026=51.85%
// Filter: combined pitcher NRFI signal >= 0.56 (grid search optimal, 69.38% win rate)
// 3-YR Backtest-calibrated INNING1_RUN_SHARE: 0.1166 (was 0.1093, updated 2026-04-14)
// 3-YR Backtest-calibrated F5_RUN_SHARE: 0.5618 (was 0.5311, updated 2026-04-14)
// 3-YR Backtest-calibrated I9_WEIGHT: 0.0792 (was 0.1170, CORRECTED walk-off inflation)
// These constants are applied in MLBAIModel.py; this file consumes the output.
const NRFI_CONFIDENCE_THRESHOLD = 0.55;  // lower than FG — NRFI is a binary 50/50 market
// F5 threshold raised from 0.55 → 0.60 (empirical: prob=0.55 bucket has 38.5% win rate,
// prob=0.60 bucket has 59.2% win rate — breakeven at ~52.4% for -110 odds)
const F5_CONFIDENCE_THRESHOLD   = 0.60;  // F5 home win rate: 45.11% season-wide (3yr empirical)
// Calibration version tag — bump when MLBAIModel.py constants change
const CALIBRATION_VERSION = "2026-04-14-3yr-v2"; // INNING1=0.1166 F5=0.5618 I9=0.0792 (3yr: 2024+2025+2026, n=5103)

// Market identifiers — canonical names used in mlb_game_backtest.market column
export const MARKETS = {
  FG_ML_HOME:   "fg_ml_home",
  FG_ML_AWAY:   "fg_ml_away",
  FG_RL_HOME:   "fg_rl_home",
  FG_RL_AWAY:   "fg_rl_away",
  FG_OVER:      "fg_over",
  FG_UNDER:     "fg_under",
  F5_ML_HOME:   "f5_ml_home",
  F5_ML_AWAY:   "f5_ml_away",
  F5_RL_HOME:   "f5_rl_home",
  F5_RL_AWAY:   "f5_rl_away",
  F5_OVER:      "f5_over",
  F5_UNDER:     "f5_under",
  NRFI:         "nrfi",
  YRFI:         "yrfi",
  K_PROP:       "k_prop",
  HR_PROP:      "hr_prop",
} as const;

type MarketKey = typeof MARKETS[keyof typeof MARKETS];

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────
export interface BacktestResult {
  gameId:       number;
  market:       MarketKey;
  modelSide:    string;   // "home" | "away" | "over" | "under" | "nrfi" | player name
  modelProb:    number;
  bookLine:     string | null;
  bookOdds:     string | null;
  bookNoVigProb: number | null;
  edge:         number | null;
  ev:           number | null;
  confidencePassed: boolean;
  result:       "WIN" | "LOSS" | "PUSH" | "NO_ACTION" | "MISSING_DATA";
  correct:      boolean | null;
  actualValue:  string;
  notes:        string;
}

export interface MultiMarketBacktestSummary {
  gameId:       number;
  gameDate:     string;
  matchup:      string;
  markets:      BacktestResult[];
  kPropsRan:    boolean;
  hrPropsRan:   boolean;
  driftFlags:   DriftFlag[];
  runAt:        number;
}

export interface DriftFlag {
  market:       MarketKey;
  rolling7Acc:  number;
  rolling30Acc: number;
  zScore:       number;
  message:      string;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Convert American odds to implied probability (raw, no vig removed). */
function mlToProb(ml: number): number {
  if (ml > 0) return 100 / (ml + 100);
  return Math.abs(ml) / (Math.abs(ml) + 100);
}

/** Remove vig from two-sided market to get no-vig probability. */
function noVigProb(ml: number, mlOpposite: number): number {
  const p1 = mlToProb(ml);
  const p2 = mlToProb(mlOpposite);
  return parseFloat((p1 / (p1 + p2)).toFixed(4));
}

/** Calculate edge = model_prob - book_no_vig_prob */
function calcEdge(modelProb: number, bookNoVigProb: number | null): number | null {
  if (bookNoVigProb === null) return null;
  return parseFloat((modelProb - bookNoVigProb).toFixed(4));
}

/** Calculate EV per unit: EV = model_p * payout - (1 - model_p) */
function calcEV(modelProb: number, bookOdds: number | null): number | null {
  if (bookOdds === null) return null;
  const payout = bookOdds > 0 ? bookOdds / 100 : 100 / Math.abs(bookOdds);
  return parseFloat((modelProb * payout - (1 - modelProb)).toFixed(4));
}

/** Parse a numeric string from DB. Returns null if not a valid number. */
function parseNum(val: string | number | null | undefined): number | null {
  if (val === null || val === undefined || val === "") return null;
  const n = typeof val === "number" ? val : parseFloat(val);
  return isNaN(n) ? null : n;
}

/** Parse an integer ML odds string. Returns null if not valid. */
function parseOdds(val: string | number | null | undefined): number | null {
  if (val === null || val === undefined || val === "") return null;
  const n = typeof val === "number" ? val : parseInt(String(val), 10);
  return isNaN(n) ? null : n;
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE BACKTEST EVALUATORS
// ─────────────────────────────────────────────────────────────────────────────

type GameRow = typeof games.$inferSelect;

/**
 * Evaluate Full Game ML markets.
 */
function evaluateFgMl(game: GameRow): BacktestResult[] {
  const results: BacktestResult[] = [];
  const actualHome = parseNum(game.actualHomeScore);
  const actualAway = parseNum(game.actualAwayScore);

  if (actualHome === null || actualAway === null) {
    console.log(`  [WARN] FG ML: missing actual scores for game ${game.id}`);
    return [
      { gameId: game.id, market: MARKETS.FG_ML_HOME, modelSide: "home", modelProb: 0,
        bookLine: null, bookOdds: null, bookNoVigProb: null, edge: null, ev: null,
        confidencePassed: false, result: "MISSING_DATA", correct: null,
        actualValue: "unknown", notes: "Missing actual scores" },
      { gameId: game.id, market: MARKETS.FG_ML_AWAY, modelSide: "away", modelProb: 0,
        bookLine: null, bookOdds: null, bookNoVigProb: null, edge: null, ev: null,
        confidencePassed: false, result: "MISSING_DATA", correct: null,
        actualValue: "unknown", notes: "Missing actual scores" },
    ];
  }

  const homeWon    = actualHome > actualAway;
  const awayWon    = actualAway > actualHome;
  const actualWinner = homeWon ? "home" : awayWon ? "away" : "tie";

  const pHomeRaw   = parseNum(game.modelHomeWinPct);  // stored as 0-100 percentage
  const pAwayRaw   = parseNum(game.modelAwayWinPct);
  const bookHomeMl = parseOdds(game.homeML);
  const bookAwayMl = parseOdds(game.awayML);

  // No-vig probabilities
  const nvHome = (bookHomeMl !== null && bookAwayMl !== null)
    ? noVigProb(bookHomeMl, bookAwayMl) : null;
  const nvAway = nvHome !== null ? parseFloat((1 - nvHome).toFixed(4)) : null;

  // Home ML — edge-based confidence with market-specific threshold
  // Rationale: raw prob threshold (0.65) is too restrictive for home favorites which the book
  // already prices at 60-65%. Edge-based (model_prob - book_no_vig >= FG_ML_HOME_EDGE_THRESHOLD)
  // captures genuine model disagreement. Threshold raised to 6% (from 5%) per backtest:
  // edge>=0.06 → 58.1% ACC +10.9% ROI (n=74); edge>=0.05 → 51.5% ACC -1.7% ROI (n=99).
  if (pHomeRaw !== null) {
    const pHome = pHomeRaw / 100;
    const edge  = calcEdge(pHome, nvHome);
    const ev    = calcEV(pHome, bookHomeMl);
    const conf  = edge !== null && edge >= FG_ML_HOME_EDGE_THRESHOLD;
    const result = !conf ? "NO_ACTION"
      : actualWinner === "tie" ? "PUSH"
      : actualWinner === "home" ? "WIN" : "LOSS";
    results.push({
      gameId: game.id, market: MARKETS.FG_ML_HOME, modelSide: "home",
      modelProb: parseFloat(pHome.toFixed(4)),
      bookLine: null, bookOdds: bookHomeMl !== null ? String(bookHomeMl) : null,
      bookNoVigProb: nvHome, edge, ev, confidencePassed: conf,
      result, correct: result === "WIN" ? true : result === "LOSS" ? false : null,
      actualValue: actualWinner,
      notes: `P(home)=${pHome.toFixed(4)} nvHome=${nvHome?.toFixed(4)} edge=${edge?.toFixed(4)} book=${bookHomeMl} [edge-based]`,
    });
  }

  // Away ML
  if (pAwayRaw !== null) {
    const pAway = pAwayRaw / 100;
    const edge  = calcEdge(pAway, nvAway);
    const ev    = calcEV(pAway, bookAwayMl);
    const conf  = edge !== null && edge >= MIN_EDGE_THRESHOLD;
    const result = !conf ? "NO_ACTION"
      : actualWinner === "tie" ? "PUSH"
      : actualWinner === "away" ? "WIN" : "LOSS";
    results.push({
      gameId: game.id, market: MARKETS.FG_ML_AWAY, modelSide: "away",
      modelProb: parseFloat(pAway.toFixed(4)),
      bookLine: null, bookOdds: bookAwayMl !== null ? String(bookAwayMl) : null,
      bookNoVigProb: nvAway, edge, ev, confidencePassed: conf,
      result, correct: result === "WIN" ? true : result === "LOSS" ? false : null,
      actualValue: actualWinner,
      notes: `P(away)=${pAway.toFixed(4)} nvAway=${nvAway?.toFixed(4)} edge=${edge?.toFixed(4)} book=${bookAwayMl}`,
    });
  }

  return results;
}

/**
 * Evaluate Full Game Run Line markets (home -1.5 / away +1.5).
 */
function evaluateFgRl(game: GameRow): BacktestResult[] {
  const results: BacktestResult[] = [];
  const actualHome = parseNum(game.actualHomeScore);
  const actualAway = parseNum(game.actualAwayScore);

  if (actualHome === null || actualAway === null) {
    return [
      { gameId: game.id, market: MARKETS.FG_RL_HOME, modelSide: "home -1.5", modelProb: 0,
        bookLine: "-1.5", bookOdds: null, bookNoVigProb: null, edge: null, ev: null,
        confidencePassed: false, result: "MISSING_DATA", correct: null,
        actualValue: "unknown", notes: "Missing actual scores" },
      { gameId: game.id, market: MARKETS.FG_RL_AWAY, modelSide: "away +1.5", modelProb: 0,
        bookLine: "+1.5", bookOdds: null, bookNoVigProb: null, edge: null, ev: null,
        confidencePassed: false, result: "MISSING_DATA", correct: null,
        actualValue: "unknown", notes: "Missing actual scores" },
    ];
  }

  const margin = actualHome - actualAway;
  const homeCovers = margin > 1.5;
  const awayCovers = margin < 1.5;
  const isPush     = margin === 1.5; // impossible with integers

  // Model RL cover probabilities (stored as 0-100 percentages)
  // NOTE: modelHomePLCoverPct / modelAwayPLCoverPct are NULL for all current games.
  // Fallback: derive from model score differential using calibrated sigmoid.
  // Sigmoid calibration (2026-05-11, n=554 games, auditFgRlHomeSigmoid.mjs):
  //   k=0.4, center=1.5 -> Brier=0.2366 (optimal; k=0.8 was Brier=0.2475, bias=-7.84%)
  const RL_SIGMOID_K = 0.4;
  const rlSigmoid = (x: number) => 1 / (1 + Math.exp(-x));
  const pHomeRlRaw = parseNum(game.modelHomePLCoverPct);
  const pAwayRlRaw = parseNum(game.modelAwayPLCoverPct);
  const modelHomeScore = parseNum(game.modelHomeScore);
  const modelAwayScore = parseNum(game.modelAwayScore);
  const modelMargin = (modelHomeScore !== null && modelAwayScore !== null)
    ? modelHomeScore - modelAwayScore : null;
  // Resolve RL cover probabilities: use stored values if available, else sigmoid fallback
  const pHomeRlResolved: number | null = pHomeRlRaw !== null
    ? pHomeRlRaw / 100
    : modelMargin !== null ? rlSigmoid((modelMargin - 1.5) * RL_SIGMOID_K) : null;
  const pAwayRlResolved: number | null = pAwayRlRaw !== null
    ? pAwayRlRaw / 100
    : pHomeRlResolved !== null ? 1 - pHomeRlResolved : null;
  const rlSource = pHomeRlRaw !== null ? 'stored' : 'sigmoid-fallback';
  const bookHomeRlOdds = parseOdds(game.homeRunLineOdds);
  const bookAwayRlOdds = parseOdds(game.awayRunLineOdds);

  const nvHomeRl = (bookHomeRlOdds !== null && bookAwayRlOdds !== null)
    ? noVigProb(bookHomeRlOdds, bookAwayRlOdds) : null;
  const nvAwayRl = nvHomeRl !== null ? parseFloat((1 - nvHomeRl).toFixed(4)) : null;

  if (pHomeRlResolved !== null) {
    const pHomeRl = pHomeRlResolved;
    const edge = calcEdge(pHomeRl, nvHomeRl);
    const ev   = calcEV(pHomeRl, bookHomeRlOdds);
    const conf = edge !== null && edge >= MIN_EDGE_THRESHOLD;
    const result = !conf ? "NO_ACTION"
      : isPush ? "PUSH"
      : homeCovers ? "WIN" : "LOSS";
    results.push({
      gameId: game.id, market: MARKETS.FG_RL_HOME, modelSide: "home -1.5",
      modelProb: parseFloat(pHomeRl.toFixed(4)),
      bookLine: "-1.5", bookOdds: bookHomeRlOdds !== null ? String(bookHomeRlOdds) : null,
      bookNoVigProb: nvHomeRl, edge, ev, confidencePassed: conf,
      result, correct: result === "WIN" ? true : result === "LOSS" ? false : null,
      actualValue: `margin=${margin}`,
      notes: `P(home RL -1.5)=${pHomeRl.toFixed(4)} source=${rlSource} modelMargin=${modelMargin?.toFixed(2)} margin=${margin} covers=${homeCovers} book=${bookHomeRlOdds}`,
    });
  }

  if (pAwayRlResolved !== null) {
    const pAwayRl = pAwayRlResolved;
    const edge = calcEdge(pAwayRl, nvAwayRl);
    const ev   = calcEV(pAwayRl, bookAwayRlOdds);
    // Use FG_RL_AWAY_EDGE_THRESHOLD (18%) -- raised from global 5% to filter out
    // systematic home-edge correction bias. See constant definition for full rationale.
    const conf = edge !== null && edge >= FG_RL_AWAY_EDGE_THRESHOLD;
    const result = !conf ? "NO_ACTION"
      : isPush ? "PUSH"
      : awayCovers ? "WIN" : "LOSS";
    results.push({
      gameId: game.id, market: MARKETS.FG_RL_AWAY, modelSide: "away +1.5",
      modelProb: parseFloat(pAwayRl.toFixed(4)),
      bookLine: "+1.5", bookOdds: bookAwayRlOdds !== null ? String(bookAwayRlOdds) : null,
      bookNoVigProb: nvAwayRl, edge, ev, confidencePassed: conf,
      result, correct: result === "WIN" ? true : result === "LOSS" ? false : null,
      actualValue: `margin=${margin}`,
      notes: `P(away RL +1.5)=${pAwayRl.toFixed(4)} source=${rlSource} edge=${edge?.toFixed(4)} threshold=${FG_RL_AWAY_EDGE_THRESHOLD} modelMargin=${modelMargin?.toFixed(2)} covers=${awayCovers} book=${bookAwayRlOdds}`,
    });
  }

  return results;
}

/**
 * Evaluate Full Game Total markets (over/under).
 */
function evaluateFgTotal(game: GameRow): BacktestResult[] {
  const results: BacktestResult[] = [];
  const actualHome = parseNum(game.actualHomeScore);
  const actualAway = parseNum(game.actualAwayScore);
  const bookTotal  = parseNum(game.bookTotal);
  const bookOverOdds  = parseOdds(game.overOdds);
  const bookUnderOdds = parseOdds(game.underOdds);
  const modelOverOdds  = parseOdds(game.modelOverOdds);
  const modelUnderOdds = parseOdds(game.modelUnderOdds);

  if (actualHome === null || actualAway === null || bookTotal === null) {
    return [
      { gameId: game.id, market: MARKETS.FG_OVER, modelSide: "over", modelProb: 0,
        bookLine: null, bookOdds: null, bookNoVigProb: null, edge: null, ev: null,
        confidencePassed: false, result: "MISSING_DATA", correct: null,
        actualValue: "unknown", notes: "Missing actual scores or book total" },
      { gameId: game.id, market: MARKETS.FG_UNDER, modelSide: "under", modelProb: 0,
        bookLine: null, bookOdds: null, bookNoVigProb: null, edge: null, ev: null,
        confidencePassed: false, result: "MISSING_DATA", correct: null,
        actualValue: "unknown", notes: "Missing actual scores or book total" },
    ];
  }

  const actualTotal = actualHome + actualAway;
  const wentOver  = actualTotal > bookTotal;
  const wentUnder = actualTotal < bookTotal;
  const isPush    = actualTotal === bookTotal;
  const actualStr = `${actualTotal} (line=${bookTotal})`;

  const nvOver = (bookOverOdds !== null && bookUnderOdds !== null)
    ? noVigProb(bookOverOdds, bookUnderOdds) : null;
  const nvUnder = nvOver !== null ? parseFloat((1 - nvOver).toFixed(4)) : null;

  // Derive model over/under probabilities from model odds
  const pOver  = modelOverOdds  !== null ? mlToProb(modelOverOdds)  : null;
  const pUnder = modelUnderOdds !== null ? mlToProb(modelUnderOdds) : null;

  if (pOver !== null) {
    const edge = calcEdge(pOver, nvOver);
    const ev   = calcEV(pOver, bookOverOdds);
    const conf = pOver >= CONFIDENCE_THRESHOLD;
    const result = !conf ? "NO_ACTION"
      : isPush ? "PUSH"
      : wentOver ? "WIN" : "LOSS";
    results.push({
      gameId: game.id, market: MARKETS.FG_OVER, modelSide: "over",
      modelProb: parseFloat(pOver.toFixed(4)),
      bookLine: bookTotal != null ? String(bookTotal) : null, bookOdds: bookOverOdds !== null ? String(bookOverOdds) : null,
      bookNoVigProb: nvOver, edge, ev, confidencePassed: conf,
      result, correct: result === "WIN" ? true : result === "LOSS" ? false : null,
      actualValue: actualStr,
      notes: `P(over)=${pOver.toFixed(4)} actual=${actualTotal} line=${bookTotal} wentOver=${wentOver}`,
    });
  }

  if (pUnder !== null) {
    const edge = calcEdge(pUnder, nvUnder);
    const ev   = calcEV(pUnder, bookUnderOdds);
    const conf = pUnder >= CONFIDENCE_THRESHOLD;
    const result = !conf ? "NO_ACTION"
      : isPush ? "PUSH"
      : wentUnder ? "WIN" : "LOSS";
    results.push({
      gameId: game.id, market: MARKETS.FG_UNDER, modelSide: "under",
      modelProb: parseFloat(pUnder.toFixed(4)),
      bookLine: bookTotal != null ? String(bookTotal) : null, bookOdds: bookUnderOdds !== null ? String(bookUnderOdds) : null,
      bookNoVigProb: nvUnder, edge, ev, confidencePassed: conf,
      result, correct: result === "WIN" ? true : result === "LOSS" ? false : null,
      actualValue: actualStr,
      notes: `P(under)=${pUnder.toFixed(4)} actual=${actualTotal} line=${bookTotal} wentUnder=${wentUnder}`,
    });
  }

  return results;
}

/**
 * Evaluate F5 (First Five Innings) markets.
 * Requires actualF5HomeScore + actualF5AwayScore to be populated.
 */
function evaluateF5Markets(game: GameRow): BacktestResult[] {
  const results: BacktestResult[] = [];
  const f5Home = parseNum(game.actualF5HomeScore);
  const f5Away = parseNum(game.actualF5AwayScore);

  if (f5Home === null || f5Away === null) {
    console.log(`  [WARN] F5: missing actual F5 scores for game ${game.id} — skipping F5 markets`);
    const missingMarkets: Array<[MarketKey, string]> = [
      [MARKETS.F5_ML_HOME, "home"], [MARKETS.F5_ML_AWAY, "away"],
      [MARKETS.F5_RL_HOME, "home -0.5"], [MARKETS.F5_RL_AWAY, "away +0.5"],
      [MARKETS.F5_OVER, "over"], [MARKETS.F5_UNDER, "under"],
    ];
    return missingMarkets.map(([m, side]) => ({
      gameId: game.id, market: m, modelSide: side, modelProb: 0,
      bookLine: null, bookOdds: null, bookNoVigProb: null, edge: null, ev: null,
      confidencePassed: false, result: "MISSING_DATA" as const, correct: null,
      actualValue: "unknown", notes: "Missing actual F5 scores",
    }));
  }

  const f5Margin = f5Home - f5Away;
  const f5Total  = f5Home + f5Away;
  const f5Winner = f5Margin > 0 ? "home" : f5Margin < 0 ? "away" : "tie";

  // F5 ML — use model F5 win pct (stored as 0-100)
  const pF5HomeRaw = parseNum(game.modelF5HomeWinPct);
  const pF5AwayRaw = parseNum(game.modelF5AwayWinPct);
  const bookF5HomeOdds = parseOdds(game.f5HomeML);
  const bookF5AwayOdds = parseOdds(game.f5AwayML);

  const nvF5Home = (bookF5HomeOdds !== null && bookF5AwayOdds !== null)
    ? noVigProb(bookF5HomeOdds, bookF5AwayOdds) : null;
  const nvF5Away = nvF5Home !== null ? parseFloat((1 - nvF5Home).toFixed(4)) : null;

  if (pF5HomeRaw !== null) {
    const pF5Home = pF5HomeRaw / 100;
    const edge = calcEdge(pF5Home, nvF5Home);
    const ev   = calcEV(pF5Home, bookF5HomeOdds);
    // F5 ML home: edge-based confidence (consistent with away ML and FG ML home)
    // F5 home win rate is ~54.8% — raw prob threshold is too restrictive for home favorites
    // already priced at 55-60% by the book. Edge-based captures genuine model disagreement.
    const conf = edge !== null && edge >= MIN_EDGE_THRESHOLD;
    const result = !conf ? "NO_ACTION"
      : f5Winner === "tie" ? "PUSH"
      : f5Winner === "home" ? "WIN" : "LOSS";
    results.push({
      gameId: game.id, market: MARKETS.F5_ML_HOME, modelSide: "home",
      modelProb: parseFloat(pF5Home.toFixed(4)),
      bookLine: null, bookOdds: bookF5HomeOdds !== null ? String(bookF5HomeOdds) : null,
      bookNoVigProb: nvF5Home, edge, ev, confidencePassed: conf,
      result, correct: result === "WIN" ? true : result === "LOSS" ? false : null,
      actualValue: f5Winner,
      notes: `F5 P(home)=${pF5Home.toFixed(4)} F5score=${f5Home}-${f5Away} winner=${f5Winner}`,
    });
  }

  if (pF5AwayRaw !== null) {
    const pF5Away = pF5AwayRaw / 100;
    const edge = calcEdge(pF5Away, nvF5Away);
    const ev   = calcEV(pF5Away, bookF5AwayOdds);
    const conf = edge !== null && edge >= MIN_EDGE_THRESHOLD;
    const result = !conf ? "NO_ACTION"
      : f5Winner === "tie" ? "PUSH"
      : f5Winner === "away" ? "WIN" : "LOSS";
    results.push({
      gameId: game.id, market: MARKETS.F5_ML_AWAY, modelSide: "away",
      modelProb: parseFloat(pF5Away.toFixed(4)),
      bookLine: null, bookOdds: bookF5AwayOdds !== null ? String(bookF5AwayOdds) : null,
      bookNoVigProb: nvF5Away, edge, ev, confidencePassed: conf,
      result, correct: result === "WIN" ? true : result === "LOSS" ? false : null,
      actualValue: f5Winner,
      notes: `F5 P(away)=${pF5Away.toFixed(4)} F5score=${f5Home}-${f5Away} winner=${f5Winner}`,
    });
  }

  // F5 Run Line (-0.5 / +0.5)
  const f5HomeCoversRl = f5Margin > 0;  // home leads after 5
  const f5AwayCoversRl = f5Margin <= 0; // away leads or tied after 5 (away +0.5)
  const f5RlPush = false;               // impossible with integer scores and 0.5 line

  const pF5HomeRlRaw = parseNum(game.modelF5HomeRLCoverPct);
  const pF5AwayRlRaw = parseNum(game.modelF5AwayRLCoverPct);
  const bookF5HomeRlOdds = parseOdds(game.f5HomeRunLineOdds);
  const bookF5AwayRlOdds = parseOdds(game.f5AwayRunLineOdds);

  const nvF5HomeRl = (bookF5HomeRlOdds !== null && bookF5AwayRlOdds !== null)
    ? noVigProb(bookF5HomeRlOdds, bookF5AwayRlOdds) : null;
  const nvF5AwayRl = nvF5HomeRl !== null ? parseFloat((1 - nvF5HomeRl).toFixed(4)) : null;

  if (pF5HomeRlRaw !== null) {
    const pF5HomeRl = pF5HomeRlRaw / 100;
    const edge = calcEdge(pF5HomeRl, nvF5HomeRl);
    const ev   = calcEV(pF5HomeRl, bookF5HomeRlOdds);
    const conf = edge !== null && edge >= MIN_EDGE_THRESHOLD;
    const result = !conf ? "NO_ACTION"
      : f5RlPush ? "PUSH"
      : f5HomeCoversRl ? "WIN" : "LOSS";
    results.push({
      gameId: game.id, market: MARKETS.F5_RL_HOME, modelSide: "home -0.5",
      modelProb: parseFloat(pF5HomeRl.toFixed(4)),
      bookLine: "-0.5", bookOdds: bookF5HomeRlOdds !== null ? String(bookF5HomeRlOdds) : null,
      bookNoVigProb: nvF5HomeRl, edge, ev, confidencePassed: conf,
      result, correct: result === "WIN" ? true : result === "LOSS" ? false : null,
      actualValue: `F5 margin=${f5Margin}`,
      notes: `F5 RL home -0.5: margin=${f5Margin} covers=${f5HomeCoversRl} book=${bookF5HomeRlOdds}`,
    });
  }

  if (pF5AwayRlRaw !== null) {
    const pF5AwayRl = pF5AwayRlRaw / 100;
    const edge = calcEdge(pF5AwayRl, nvF5AwayRl);
    const ev   = calcEV(pF5AwayRl, bookF5AwayRlOdds);
    const conf = edge !== null && edge >= MIN_EDGE_THRESHOLD;
    const result = !conf ? "NO_ACTION"
      : f5RlPush ? "PUSH"
      : f5AwayCoversRl ? "WIN" : "LOSS";
    results.push({
      gameId: game.id, market: MARKETS.F5_RL_AWAY, modelSide: "away +0.5",
      modelProb: parseFloat(pF5AwayRl.toFixed(4)),
      bookLine: "+0.5", bookOdds: bookF5AwayRlOdds !== null ? String(bookF5AwayRlOdds) : null,
      bookNoVigProb: nvF5AwayRl, edge, ev, confidencePassed: conf,
      result, correct: result === "WIN" ? true : result === "LOSS" ? false : null,
      actualValue: `F5 margin=${f5Margin}`,
      notes: `F5 RL away +0.5: margin=${f5Margin} covers=${f5AwayCoversRl} book=${bookF5AwayRlOdds}`,
    });
  }

  // F5 Total
  const f5TotalLine    = parseNum(game.f5Total);
  const bookF5OverOdds  = parseOdds(game.f5OverOdds);
  const bookF5UnderOdds = parseOdds(game.f5UnderOdds);
  const modelF5OverOdds  = parseOdds(game.modelF5OverOdds);
  const modelF5UnderOdds = parseOdds(game.modelF5UnderOdds);

  const nvF5Over = (bookF5OverOdds !== null && bookF5UnderOdds !== null)
    ? noVigProb(bookF5OverOdds, bookF5UnderOdds) : null;
  const nvF5Under = nvF5Over !== null ? parseFloat((1 - nvF5Over).toFixed(4)) : null;

  if (f5TotalLine !== null && modelF5OverOdds !== null) {
    const pF5Over = mlToProb(modelF5OverOdds);
    const wentF5Over  = f5Total > f5TotalLine;
    const wentF5Under = f5Total < f5TotalLine;
    const f5Push = f5Total === f5TotalLine;
    const edge = calcEdge(pF5Over, nvF5Over);
    const ev   = calcEV(pF5Over, bookF5OverOdds);
    const conf = pF5Over >= F5_CONFIDENCE_THRESHOLD;
    const result = !conf ? "NO_ACTION"
      : f5Push ? "PUSH"
      : wentF5Over ? "WIN" : "LOSS";
    results.push({
      gameId: game.id, market: MARKETS.F5_OVER, modelSide: "over",
      modelProb: parseFloat(pF5Over.toFixed(4)),
      bookLine: f5TotalLine != null ? String(f5TotalLine) : null, bookOdds: bookF5OverOdds !== null ? String(bookF5OverOdds) : null,
      bookNoVigProb: nvF5Over, edge, ev, confidencePassed: conf,
      result, correct: result === "WIN" ? true : result === "LOSS" ? false : null,
      actualValue: `F5 total=${f5Total} line=${f5TotalLine}`,
      notes: `F5 Over: total=${f5Total} line=${f5TotalLine} wentOver=${wentF5Over}`,
    });
  }

  if (f5TotalLine !== null && modelF5UnderOdds !== null) {
    const pF5Under = mlToProb(modelF5UnderOdds);
    const wentF5Under = f5Total < f5TotalLine;
    const f5Push = f5Total === f5TotalLine;
    const edge = calcEdge(pF5Under, nvF5Under);
    const ev   = calcEV(pF5Under, bookF5UnderOdds);
    const conf = pF5Under >= F5_CONFIDENCE_THRESHOLD;
    const result = !conf ? "NO_ACTION"
      : f5Push ? "PUSH"
      : wentF5Under ? "WIN" : "LOSS";
    results.push({
      gameId: game.id, market: MARKETS.F5_UNDER, modelSide: "under",
      modelProb: parseFloat(pF5Under.toFixed(4)),
      bookLine: f5TotalLine != null ? String(f5TotalLine) : null, bookOdds: bookF5UnderOdds !== null ? String(bookF5UnderOdds) : null,
      bookNoVigProb: nvF5Under, edge, ev, confidencePassed: conf,
      result, correct: result === "WIN" ? true : result === "LOSS" ? false : null,
      actualValue: `F5 total=${f5Total} line=${f5TotalLine}`,
      notes: `F5 Under: total=${f5Total} line=${f5TotalLine} wentUnder=${wentF5Under}`,
    });
  }

  return results;
}

/**
 * Evaluate NRFI / YRFI markets.
 * Uses nrfiActualResult column (set by score ingestion pipeline).
 * Falls back to MISSING_DATA if not yet populated.
 */
function evaluateNrfi(game: GameRow): BacktestResult[] {
  const results: BacktestResult[] = [];

  const nrfiActual = game.nrfiActualResult;  // "NRFI" | "YRFI" | null
  const pNrfiRaw   = parseNum(game.modelPNrfi);  // stored as 0.0-1.0 probability
  const bookNrfiOdds = parseOdds(game.nrfiOverOdds);  // NRFI = under 0.5 1st inn
  const bookYrfiOdds = parseOdds(game.yrfiUnderOdds); // YRFI = over 0.5 1st inn
  const modelNrfiOdds = parseOdds(game.modelNrfiOdds);
  const modelYrfiOdds = parseOdds(game.modelYrfiOdds);

  // Derive model probabilities from model odds
  const pNrfi = modelNrfiOdds !== null ? mlToProb(modelNrfiOdds)
    : pNrfiRaw !== null ? pNrfiRaw : null;
  const pYrfi = modelYrfiOdds !== null ? mlToProb(modelYrfiOdds)
    : pNrfi !== null ? parseFloat((1 - pNrfi).toFixed(4)) : null;

  const nvNrfi = (bookNrfiOdds !== null && bookYrfiOdds !== null)
    ? noVigProb(bookNrfiOdds, bookYrfiOdds) : null;
  const nvYrfi = nvNrfi !== null ? parseFloat((1 - nvNrfi).toFixed(4)) : null;

  if (pNrfi !== null) {
    const edge = calcEdge(pNrfi, nvNrfi);
    const ev   = calcEV(pNrfi, bookNrfiOdds);
    // Use backtest-calibrated NRFI threshold (0.55) — NRFI is a binary 50/50 market;
    // standard 0.65 threshold is too restrictive given 51.7% season-wide NRFI rate.
    const conf = pNrfi >= NRFI_CONFIDENCE_THRESHOLD;
    const result = nrfiActual === null ? "MISSING_DATA"
      : !conf ? "NO_ACTION"
      : nrfiActual === "NRFI" ? "WIN" : "LOSS";
    results.push({
      gameId: game.id, market: MARKETS.NRFI, modelSide: "nrfi",
      modelProb: parseFloat(pNrfi.toFixed(4)),
      bookLine: "0.5", bookOdds: bookNrfiOdds !== null ? String(bookNrfiOdds) : null,
      bookNoVigProb: nvNrfi, edge, ev, confidencePassed: conf,
      result, correct: result === "WIN" ? true : result === "LOSS" ? false : null,
      actualValue: nrfiActual ?? "unknown",
      notes: `P(NRFI)=${pNrfi.toFixed(4)} book=${bookNrfiOdds} actual=${nrfiActual ?? "unknown"} calibVer=${CALIBRATION_VERSION}`,
    });
  }

  if (pYrfi !== null) {
    const edge = calcEdge(pYrfi, nvYrfi);
    const ev   = calcEV(pYrfi, bookYrfiOdds);
    const conf = pYrfi >= NRFI_CONFIDENCE_THRESHOLD;
    const result = nrfiActual === null ? "MISSING_DATA"
      : !conf ? "NO_ACTION"
      : nrfiActual === "YRFI" ? "WIN" : "LOSS";
    results.push({
      gameId: game.id, market: MARKETS.YRFI, modelSide: "yrfi",
      modelProb: parseFloat(pYrfi.toFixed(4)),
      bookLine: "0.5", bookOdds: bookYrfiOdds !== null ? String(bookYrfiOdds) : null,
      bookNoVigProb: nvYrfi, edge, ev, confidencePassed: conf,
      result, correct: result === "WIN" ? true : result === "LOSS" ? false : null,
      actualValue: nrfiActual ?? "unknown",
      notes: `P(YRFI)=${pYrfi.toFixed(4)} book=${bookYrfiOdds} actual=${nrfiActual ?? "unknown"} calibVer=${CALIBRATION_VERSION}`,
    });
  }

  return results;
}

/**
 * Evaluate HR Props for a game from mlb_hr_props table.
 * WIN: model P(HR >= 1) >= CONFIDENCE_THRESHOLD AND player hit a HR
 * LOSS: model P(HR >= 1) >= CONFIDENCE_THRESHOLD AND player did NOT hit a HR
 * NO_ACTION: model P(HR >= 1) < CONFIDENCE_THRESHOLD
 */
async function evaluateHrProps(gameId: number): Promise<BacktestResult[]> {
  const db = await getDb();
  const props = await db
    .select()
    .from(mlbHrProps)
    .where(eq(mlbHrProps.gameId, gameId));

  if (props.length === 0) {
    console.log(`  [WARN] HR Props: no props found for game ${gameId}`);
    return [];
  }

  const results: BacktestResult[] = [];

  for (const prop of props) {
    const modelProb = parseNum(prop.modelPHr);
    const actualHr  = prop.actualHr;
    const bookOverOdds = parseOdds(prop.consensusOverOdds);
    const bookUnderOdds = parseOdds(prop.fdUnderOdds);

    const nvOver = (bookOverOdds !== null && bookUnderOdds !== null)
      ? noVigProb(bookOverOdds, bookUnderOdds) : null;

    if (modelProb === null) {
      results.push({
        gameId, market: MARKETS.HR_PROP, modelSide: prop.playerName ?? "unknown",
        modelProb: 0, bookLine: "0.5",
        bookOdds: bookOverOdds !== null ? String(bookOverOdds) : null,
        bookNoVigProb: nvOver, edge: null, ev: null, confidencePassed: false,
        result: "MISSING_DATA", correct: null,
        actualValue: "unknown",
        notes: `${prop.playerName}: missing model probability`,
      });
      continue;
    }

    if (actualHr === null || actualHr === undefined) {
      results.push({
        gameId, market: MARKETS.HR_PROP, modelSide: prop.playerName ?? "unknown",
        modelProb, bookLine: "0.5",
        bookOdds: bookOverOdds !== null ? String(bookOverOdds) : null,
        bookNoVigProb: nvOver, edge: null, ev: null, confidencePassed: false,
        result: "MISSING_DATA", correct: null,
        actualValue: "unknown",
        notes: `${prop.playerName}: missing actual HR result`,
      });
      continue;
    }

    const hitHr = actualHr >= 1;
    const edge  = calcEdge(modelProb, nvOver);
    const ev    = calcEV(modelProb, bookOverOdds);
    const conf  = modelProb >= CONFIDENCE_THRESHOLD;
    const result = !conf ? "NO_ACTION"
      : hitHr ? "WIN" : "LOSS";

    results.push({
      gameId, market: MARKETS.HR_PROP, modelSide: prop.playerName ?? "unknown",
      modelProb,
      bookLine: "0.5",
      bookOdds: bookOverOdds !== null ? String(bookOverOdds) : null,
      bookNoVigProb: nvOver, edge, ev, confidencePassed: conf,
      result, correct: result === "WIN" ? true : result === "LOSS" ? false : null,
      actualValue: `${actualHr} HR`,
      notes: `${prop.playerName} (${prop.teamAbbrev}): P(HR)=${modelProb.toFixed(4)} actual=${actualHr} book=${bookOverOdds}`,
    });
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// DRIFT DETECTION + AUTOMATED LEARNING
// ─────────────────────────────────────────────────────────────────────────────

async function getRollingAccuracy(
  market: MarketKey,
  days: number,
): Promise<{ accuracy: number; sampleSize: number }> {
  const db = await getDb();
  const cutoffTs = BigInt(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({ correct: mlbGameBacktest.correct })
    .from(mlbGameBacktest)
    .where(
      and(
        eq(mlbGameBacktest.market, market),
        sql`${mlbGameBacktest.backtestRunAt} >= ${cutoffTs}`,
        isNotNull(mlbGameBacktest.correct),
      )
    );

  if (rows.length === 0) return { accuracy: 0, sampleSize: 0 };
  const correct = rows.filter((r: { correct: number | null }) => r.correct === 1).length;
  return {
    accuracy: parseFloat((correct / rows.length).toFixed(4)),
    sampleSize: rows.length,
  };
}

async function detectDrift(market: MarketKey): Promise<DriftFlag | null> {
  const [r7, r30] = await Promise.all([
    getRollingAccuracy(market, 7),
    getRollingAccuracy(market, 30),
  ]);

  if (r7.sampleSize < MIN_SAMPLE_FOR_DRIFT || r30.sampleSize < MIN_SAMPLE_FOR_DRIFT) {
    return null;
  }

  const p30 = r30.accuracy;
  const n30 = r30.sampleSize;
  const se30 = Math.sqrt((p30 * (1 - p30)) / n30);
  if (se30 === 0) return null;

  const zScore = Math.abs(r7.accuracy - p30) / se30;
  if (zScore <= DRIFT_SIGMA_THRESHOLD) return null;

  return {
    market,
    rolling7Acc:  r7.accuracy,
    rolling30Acc: p30,
    zScore:       parseFloat(zScore.toFixed(3)),
    message:      `DRIFT: ${market} | 7d=${(r7.accuracy * 100).toFixed(1)}% (n=${r7.sampleSize}) vs 30d=${(p30 * 100).toFixed(1)}% (n=${n30}) | z=${zScore.toFixed(2)}σ`,
  };
}

async function writeDriftLog(flags: DriftFlag[], gameId: number): Promise<void> {
  if (flags.length === 0) return;
  const db = await getDb();
  const now = Date.now();

  for (const flag of flags) {
    await db.insert(mlbModelLearningLog).values({
      market:          flag.market,
      windowDays:      7,
      accuracyBefore:  String(flag.rolling30Acc),
      accuracyAfter:   String(flag.rolling7Acc),
      triggerReason:   "drift_detected",
      sampleSize:      MIN_SAMPLE_FOR_DRIFT,
      paramChanges:    JSON.stringify({ zScore: flag.zScore, message: flag.message }),
      runAt:           now,
    });
    console.log(`  [LEARN] ${flag.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DB WRITE
// ─────────────────────────────────────────────────────────────────────────────

async function writeBacktestResults(results: BacktestResult[], gameDate: string, awayPitcher: string, homePitcher: string, actualAway: number | null, actualHome: number | null): Promise<void> {
  if (results.length === 0) return;
  const db = await getDb();
  const now = Date.now();

  let written = 0;
  let errors  = 0;

  for (const r of results) {
    // Null-guard all nullable fields for both INSERT and UPDATE paths
    const iCorrect  = r.correct !== null && r.correct !== undefined ? (r.correct ? 1 : 0) : null;
    const iNvProb   = r.bookNoVigProb !== null && r.bookNoVigProb !== undefined ? parseFloat(r.bookNoVigProb.toFixed(4)) : null;
    const iEdge     = r.edge !== null && r.edge !== undefined ? parseFloat(r.edge.toFixed(4)) : null;
    const iEv       = r.ev !== null && r.ev !== undefined ? parseFloat(r.ev.toFixed(2)) : null;
    const iBookLine = r.bookLine || null;
    const iBookOdds = r.bookOdds || null;
    try {
      // Try insert first
      await db.insert(mlbGameBacktest).values({
        gameId:          r.gameId,
        gameDate:        gameDate,
        market:          r.market,
        modelSide:       r.modelSide.slice(0, 8),
        modelProb:       parseFloat(r.modelProb.toFixed(4)),
        bookLine:        iBookLine,
        bookOdds:        iBookOdds,
        bookNoVigProb:   iNvProb,
        edge:            iEdge,
        ev:              iEv,
        confidencePassed: r.confidencePassed ? 1 : 0,
        result:          r.result,
        correct:         iCorrect,
        actualAwayScore: actualAway ?? null,
        actualHomeScore: actualHome ?? null,
        awayPitcher:     awayPitcher,
        homePitcher:     homePitcher,
        backtestRunAt:   now,
      });
      written++;
    } catch (_insertErr) {
      // On duplicate, update
      try {
        // Use explicit sql`NULL` for nullable fields to avoid Drizzle empty-string serialization bug
        const safeCorrect = r.correct !== null && r.correct !== undefined ? (r.correct ? 1 : 0) : null;
        const safeNvProb  = r.bookNoVigProb !== null && r.bookNoVigProb !== undefined ? parseFloat(r.bookNoVigProb.toFixed(4)) : null;
        const safeEdge    = r.edge !== null && r.edge !== undefined ? parseFloat(r.edge.toFixed(4)) : null;
        const safeEv      = r.ev !== null && r.ev !== undefined ? parseFloat(r.ev.toFixed(2)) : null;
        await db.update(mlbGameBacktest)
          .set({
            modelProb:        parseFloat(r.modelProb.toFixed(4)),
            bookLine:         r.bookLine ?? null,
            bookOdds:         r.bookOdds ?? null,
            bookNoVigProb:    safeNvProb,
            edge:             safeEdge,
            ev:               safeEv,
            confidencePassed: r.confidencePassed ? 1 : 0,
            result:           r.result,
            correct:          safeCorrect,
            actualAwayScore:  actualAway ?? null,
            actualHomeScore:  actualHome ?? null,
            backtestRunAt:    now,
          })
          .where(
            and(
              eq(mlbGameBacktest.gameId, r.gameId),
              eq(mlbGameBacktest.market, r.market),
              eq(mlbGameBacktest.modelSide, r.modelSide.slice(0, 8)),
            )
          );
        written++;
      } catch (updateErr) {
        console.error(`  [DB ERROR] game=${r.gameId} market=${r.market} side=${r.modelSide}: ${updateErr}`);
        errors++;
      }
    }
  }

  console.log(`  [DB] Backtest results: ${written} written, ${errors} errors`);
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run the full multi-market backtest for a single game.
 * Called automatically when a game transitions to FINAL status.
 */
export async function runMultiMarketBacktest(
  gameId: number,
  runKProps = true,
): Promise<MultiMarketBacktestSummary> {
  const startMs = Date.now();
  console.log(`\n${TAG} ══════════════════════════════════════════════════════`);
  console.log(`${TAG} [INPUT] Starting multi-market backtest | gameId=${gameId}`);

  const db = await getDb();

  // ── Step 1: Fetch game record ─────────────────────────────────────────────
  console.log(`${TAG} [STEP 1] Fetching game record id=${gameId}`);
  const gameRows = await db.select().from(games).where(eq(games.id, gameId));
  if (gameRows.length === 0) {
    throw new Error(`${TAG} Game id=${gameId} not found in DB`);
  }
  const game = gameRows[0];
  const matchup = `${game.awayTeam ?? "?"} @ ${game.homeTeam ?? "?"}`;
  console.log(`${TAG} [INPUT] Game: ${matchup} | Date: ${game.gameDate} | Status: ${game.gameStatus}`);
  console.log(`${TAG} [INPUT] Actual FG: Away=${game.actualAwayScore ?? "?"} Home=${game.actualHomeScore ?? "?"}`);
  console.log(`${TAG} [INPUT] Actual F5: Away=${game.actualF5AwayScore ?? "?"} Home=${game.actualF5HomeScore ?? "?"}`);
  console.log(`${TAG} [INPUT] NRFI actual: ${game.nrfiActualResult ?? "not set"}`);

  // ── Step 2: Validate status ───────────────────────────────────────────────
  console.log(`${TAG} [STEP 2] Validating game status`);
  const statusLower = (game.gameStatus ?? "").toLowerCase();
  if (!["final", "f", "completed"].includes(statusLower)) {
    console.log(`${TAG} [WARN] Game ${gameId} status='${game.gameStatus}' — not FINAL. Proceeding anyway.`);
  } else {
    console.log(`${TAG} [VERIFY] PASS — status=${game.gameStatus}`);
  }

  // ── Step 3: Evaluate all markets ─────────────────────────────────────────
  console.log(`\n${TAG} [STEP 3] Evaluating all markets`);
  const allResults: BacktestResult[] = [];

  console.log(`  [STEP] Full Game ML...`);
  const fgMl = evaluateFgMl(game);
  allResults.push(...fgMl);
  fgMl.forEach(r => console.log(`  [STATE] ${r.market}: ${r.result} | ${r.notes}`));

  console.log(`  [STEP] Full Game Run Line...`);
  const fgRl = evaluateFgRl(game);
  allResults.push(...fgRl);
  fgRl.forEach(r => console.log(`  [STATE] ${r.market}: ${r.result} | ${r.notes}`));

  console.log(`  [STEP] Full Game Total...`);
  const fgTotal = evaluateFgTotal(game);
  allResults.push(...fgTotal);
  fgTotal.forEach(r => console.log(`  [STATE] ${r.market}: ${r.result} | ${r.notes}`));

  console.log(`  [STEP] F5 Markets...`);
  const f5 = evaluateF5Markets(game);
  allResults.push(...f5);
  f5.forEach(r => console.log(`  [STATE] ${r.market}: ${r.result} | ${r.notes}`));

  console.log(`  [STEP] NRFI/YRFI...`);
  const nrfi = evaluateNrfi(game);
  allResults.push(...nrfi);
  nrfi.forEach(r => console.log(`  [STATE] ${r.market}: ${r.result} | ${r.notes}`));

  console.log(`  [STEP] HR Props...`);
  const hrResults = await evaluateHrProps(gameId);
  allResults.push(...hrResults);
  const hrWins   = hrResults.filter(r => r.result === "WIN").length;
  const hrLosses = hrResults.filter(r => r.result === "LOSS").length;
  console.log(`  [STATE] HR Props: ${hrResults.length} props | WIN=${hrWins} LOSS=${hrLosses}`);

  // ── Step 3g: K-Props ─────────────────────────────────────────────────────
  let kPropsRan = false;
  if (runKProps && game.gameDate) {
    console.log(`  [STEP] K-Props backtest (delegated)...`);
    try {
      await runKPropsBacktest(game.gameDate);
      kPropsRan = true;
      console.log(`  [STATE] K-Props backtest complete`);
    } catch (err) {
      console.error(`  [ERROR] K-Props backtest failed: ${err}`);
    }
  }

  // ── Step 4: Write results ─────────────────────────────────────────────────
  console.log(`\n${TAG} [STEP 4] Writing ${allResults.length} backtest results to DB`);
  const actualAway = parseNum(game.actualAwayScore);
  const actualHome = parseNum(game.actualHomeScore);
  await writeBacktestResults(
    allResults,
    game.gameDate ?? "",
    game.awayStartingPitcher ?? "",
    game.homeStartingPitcher ?? "",
    actualAway,
    actualHome,
  );

  // ── Step 5: Drift detection ───────────────────────────────────────────────
  console.log(`\n${TAG} [STEP 5] Drift detection`);
  const driftFlags: DriftFlag[] = [];
  const marketsToCheck: MarketKey[] = Object.values(MARKETS).filter(m => m !== MARKETS.K_PROP);

  for (const market of marketsToCheck) {
    const flag = await detectDrift(market);
    if (flag) driftFlags.push(flag);
  }

  if (driftFlags.length === 0) {
    console.log(`  [VERIFY] PASS — no drift detected (${marketsToCheck.length} markets checked)`);
  } else {
    console.log(`  [WARN] ${driftFlags.length} drift flag(s) detected`);
    await writeDriftLog(driftFlags, gameId);
  }

  // ── Step 6: Summary ───────────────────────────────────────────────────────
  const wins    = allResults.filter(r => r.result === "WIN").length;
  const losses  = allResults.filter(r => r.result === "LOSS").length;
  const pushes  = allResults.filter(r => r.result === "PUSH").length;
  const noAct   = allResults.filter(r => r.result === "NO_ACTION").length;
  const missing = allResults.filter(r => r.result === "MISSING_DATA").length;
  const elapsed = ((Date.now() - startMs) / 1000).toFixed(2);
  const acc     = wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : "N/A";

  console.log(`\n${TAG} ══════════════════════════════════════════════════════`);
  console.log(`${TAG} [OUTPUT] Backtest complete: ${matchup}`);
  console.log(`${TAG} [OUTPUT] ${allResults.length} markets | WIN=${wins} LOSS=${losses} PUSH=${pushes} NO_ACTION=${noAct} MISSING=${missing}`);
  console.log(`${TAG} [OUTPUT] Accuracy (WIN+LOSS): ${acc}% (${wins}/${wins + losses})`);
  console.log(`${TAG} [OUTPUT] Drift flags: ${driftFlags.length} | K-Props: ${kPropsRan} | HR Props: ${hrResults.length}`);
  console.log(`${TAG} [VERIFY] Elapsed: ${elapsed}s`);
  console.log(`${TAG} ══════════════════════════════════════════════════════\n`);

  return {
    gameId,
    gameDate:   game.gameDate ?? "",
    matchup,
    markets:    allResults,
    kPropsRan,
    hrPropsRan: hrResults.length > 0,
    driftFlags,
    runAt:      Date.now(),
  };
}

/**
 * Run multi-market backtest for all FINAL games on a given date.
 */
export async function runMultiMarketBacktestForDate(
  dateStr: string,
): Promise<{ processed: number; errors: number; summaries: MultiMarketBacktestSummary[] }> {
  console.log(`\n${TAG} Batch backtest for ALL FINAL MLB games on ${dateStr}`);
  const db = await getDb();

  const finalGames = await db
    .select({ id: games.id, awayTeam: games.awayTeam, homeTeam: games.homeTeam })
    .from(games)
    .where(
      and(
        eq(games.gameDate, dateStr),
        eq(games.sport, "MLB"),
        sql`LOWER(${games.gameStatus}) IN ('final', 'f', 'completed')`,
      )
    );

  console.log(`${TAG} [INPUT] Found ${finalGames.length} FINAL MLB games on ${dateStr}`);

  const summaries: MultiMarketBacktestSummary[] = [];
  let processed = 0;
  let errors    = 0;

  for (const g of finalGames) {
    try {
      const summary = await runMultiMarketBacktest(g.id, true);
      summaries.push(summary);
      processed++;
    } catch (err) {
      console.error(`${TAG} [ERROR] game ${g.id} (${g.awayTeam}@${g.homeTeam}): ${err}`);
      errors++;
    }
  }

  console.log(`\n${TAG} [FINAL] Date ${dateStr}: processed=${processed} errors=${errors}`);
  return { processed, errors, summaries };
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC QUERY: rolling accuracy per market
// ─────────────────────────────────────────────────────────────────────────────

/** Return rolling accuracy for every market over the last N days. */
export async function getMultiMarketRollingAccuracy(days: number): Promise<
  Array<{ market: MarketKey; accuracy: number; sampleSize: number }>
> {
  const marketKeys = Object.keys(MARKETS) as MarketKey[];
  const results = await Promise.all(
    marketKeys.map(async (market) => {
      const { accuracy, sampleSize } = await getRollingAccuracy(market, days);
      return { market, accuracy, sampleSize };
    })
  );
  return results.sort((a, b) => b.sampleSize - a.sampleSize);
}
