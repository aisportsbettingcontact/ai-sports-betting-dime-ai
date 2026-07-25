/**
 * mlbOutcomeIngestor.ts — Automated MLB outcome ingestion + Brier score computation.
 *
 * PURPOSE:
 *   After a game transitions to 'final', this module fetches the authoritative
 *   innings-level linescore from the MLB Stats API and writes the following to DB:
 *
 *   Outcome fields (games table):
 *     actualFgTotal      — away + home final runs (used for FG Total Brier + drift)
 *     actualF5Total      — away + home F5 runs (used for F5 Total Brier + f5_share drift)
 *     actualNrfiBinary   — 1 if no run in inning 1, 0 if run scored (used for NRFI Brier)
 *
 *   Brier score fields (games table):
 *     brierFgTotal  — (p_over - outcome_over)^2 for FG Total market
 *     brierF5Total  — (p_f5_over - outcome_f5_over)^2 for F5 Total market
 *     brierNrfi     — (p_nrfi - outcome_nrfi)^2 for NRFI market
 *     brierFgMl     — (p_home_win - outcome_home_win)^2 for FG ML market
 *     brierF5Ml     — (p_f5_home_win - outcome_f5_home_win)^2 for F5 ML market
 *     outcomeIngestedAt — UTC ms timestamp of ingestion
 *
 *   Model-pick grading fields (games table, M-101 forward path):
 *     fgMlResult/fgMlCorrect, fgRlResult/fgRlCorrect, fgTotalResult/fgTotalCorrect,
 *     f5MlResult/f5MlCorrect, f5RlResult/f5RlCorrect, f5TotalResult/f5TotalCorrect,
 *     nrfiBacktestResult/nrfiCorrect — grade the MODEL'S PICK (the pre-audit
 *     columns graded a fixed away-side bet and were abandoned; audit M-101),
 *     plus fgBacktestRunAt/f5BacktestRunAt/nrfiBacktestRunAt stamps.
 *
 * BRIER SCORE FORMULA:
 *   BS = (p - o)^2
 *   where p = model probability [0,1], o = binary outcome (0 or 1)
 *   Range: [0, 1]. Lower = better calibration.
 *   Perfect calibration: BS = 0. Worst: BS = 1.
 *   Null if required inputs (model prob or actual score) are unavailable.
 *
 * PROBABILITY STORAGE SCALES (audit M-203):
 *   The games model columns are stored on TWO scales:
 *     0-100 percent — modelOverRate, modelAwayWinPct, modelHomeWinPct,
 *                     modelF5AwayWinPct, modelF5HomeWinPct
 *     0-1 unit      — modelPNrfi, modelF5OverRate (mlbModelRunner writes the
 *                     raw probabilities unscaled for these two)
 *   brierScore() takes an already-normalized [0,1] probability; every call
 *   site normalizes explicitly via probFromPct / probFromUnit.
 *
 * PUSH HANDLING:
 *   If actualFgTotal == bookTotal (push), brierFgTotal = null (no outcome to score).
 *   If actualF5Total == f5Total (push), brierF5Total = null.
 *   Ties in ML (actualAway == actualHome) → brierFgMl = null.
 *
 * IDEMPOTENCY:
 *   Games with outcomeIngestedAt already set are SKIPPED unless force=true.
 *   Safe to run multiple times per day — only processes newly-final games.
 *
 * LOGGING CONVENTION:
 *   [OutcomeIngestor][INPUT]  — trigger context + date range
 *   [OutcomeIngestor][STEP]   — operation in progress
 *   [OutcomeIngestor][STATE]  — intermediate values per game
 *   [OutcomeIngestor][OUTPUT] — write result per game
 *   [OutcomeIngestor][VERIFY] — post-write validation pass/fail
 *   [OutcomeIngestor][ERROR]  — failure with context
 *   [OutcomeIngestor][SUMMARY]— batch summary
 *
 * INTEGRATION:
 *   Called by mlbNightlyCron after score refresh completes.
 *   Also exported for manual backfill via scripts/backfillOutcomes.mts.
 */

import { and, eq, isNull, isNotNull, sql, or } from "drizzle-orm";
import { getDb } from "./db";
import { games } from "../drizzle/schema";
import { notifyOwner } from "./_core/notification";
import { checkF5ShareDrift } from "./mlbDriftDetector";

// ─── Constants ────────────────────────────────────────────────────────────────

const TAG = "[OutcomeIngestor]";
const MLB_STATS_API_BASE = "https://statsapi.mlb.com/api/v1";
const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "application/json",
  Referer: "https://www.mlb.com/",
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface MlbApiInning {
  num: number;
  away?: { runs?: number };
  home?: { runs?: number };
}

interface MlbApiLinescore {
  teams?: {
    away?: { runs?: number };
    home?: { runs?: number };
  };
  innings?: MlbApiInning[];
}

interface MlbApiGame {
  gamePk: number;
  status: {
    abstractGameState: string;
    detailedState: string;
  };
  teams: {
    away: { team: { abbreviation: string }; score?: number };
    home: { team: { abbreviation: string }; score?: number };
  };
  linescore?: MlbApiLinescore;
}

/** Parsed outcome data from the MLB Stats API for a single game */
export interface GameOutcome {
  gamePk: number;
  awayAbbrev: string;
  homeAbbrev: string;
  /** Full-game away runs (null if game not final or linescore missing) */
  awayFgRuns: number | null;
  /** Full-game home runs (null if game not final or linescore missing) */
  homeFgRuns: number | null;
  /** Away runs through 5 innings (null if < 5 innings in linescore) */
  awayF5Runs: number | null;
  /** Home runs through 5 innings (null if < 5 innings in linescore) */
  homeF5Runs: number | null;
  /** 1 if no run scored in inning 1, 0 if run scored, null if inning 1 not in linescore */
  nrfiBinary: number | null;
  /** True if game is final per API */
  isFinal: boolean;
}

/** Per-game ingestion result */
export interface OutcomeIngestResult {
  gameId: number;
  matchup: string;
  gameDate: string;
  status: "written" | "skipped_already_ingested" | "skipped_not_final" | "skipped_no_mlbgamepk" | "skipped_no_api_match" | "error";
  actualFgTotal: number | null;
  actualF5Total: number | null;
  actualNrfiBinary: number | null;
  brierFgTotal: number | null;
  brierF5Total: number | null;
  brierNrfi: number | null;
  brierFgMl: number | null;
  brierF5Ml: number | null;
  error?: string;
}

/** Batch ingestion summary */
export interface OutcomeIngestSummary {
  date: string;
  totalGames: number;
  written: number;
  skippedAlreadyIngested: number;
  skippedNotFinal: number;
  skippedNoGamePk: number;
  skippedNoApiMatch: number;
  errors: number;
  results: OutcomeIngestResult[];
  runAt: number;
}

// ─── Brier Score Computation ──────────────────────────────────────────────────

/** Parses a numeric DB value (decimal string, varchar line) to number, or null. */
function parseNumOrNull(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = parseFloat(String(value));
  return isNaN(n) ? null : n;
}

/**
 * Normalizes a model column stored on the 0-100 percent scale (modelOverRate,
 * modelAwayWinPct, modelHomeWinPct, modelF5AwayWinPct, modelF5HomeWinPct) to
 * a [0,1] probability.
 */
export function probFromPct(value: string | number | null | undefined): number | null {
  const n = parseNumOrNull(value);
  return n !== null ? n / 100 : null;
}

/**
 * Reads a model column already stored on the 0-1 unit scale (modelPNrfi,
 * modelF5OverRate — mlbModelRunner writes these unscaled). Dividing these by
 * 100 was the M-203 garbage-Brier bug.
 */
export function probFromUnit(value: string | number | null | undefined): number | null {
  return parseNumOrNull(value);
}

/**
 * Computes a single Brier score: (p - o)^2
 *
 * @param p        Model probability already normalized to [0, 1]. Callers must
 *                 normalize explicitly (probFromPct / probFromUnit) — the games
 *                 model columns are stored on two different scales (see header).
 * @param outcome  Binary outcome: 1 = event occurred, 0 = did not occur
 * @returns Brier score in [0, 1], or null if inputs are invalid
 */
export function brierScore(
  p: number | null,
  outcome: 0 | 1 | null,
): number | null {
  if (p === null || outcome === null) return null;
  if (isNaN(p) || p < 0 || p > 1) return null;
  const bs = Math.pow(p - outcome, 2);
  // Round to 6 decimal places (matches precision: 7, scale: 6 in schema)
  return parseFloat(bs.toFixed(6));
}

/**
 * Computes all 5 Brier scores for a game.
 *
 * @param game        DB game row (model probabilities)
 * @param outcome     Parsed outcome from MLB Stats API
 * @returns Object with all 5 Brier scores (null if inputs unavailable)
 */
export function computeBrierScores(
  game: {
    bookTotal: string | null | undefined;
    modelOverRate: string | null | undefined;
    f5Total: string | null | undefined;
    modelF5OverRate: string | null | undefined;
    modelPNrfi: string | null | undefined;
    modelHomeWinPct: string | null | undefined;
    modelF5HomeWinPct: string | null | undefined;
  },
  outcome: GameOutcome,
): {
  brierFgTotal: number | null;
  brierF5Total: number | null;
  brierNrfi: number | null;
  brierFgMl: number | null;
  brierF5Ml: number | null;
} {
  // ── FG Total ──────────────────────────────────────────────────────────────
  let brierFgTotal: number | null = null;
  const fgTotal = outcome.awayFgRuns !== null && outcome.homeFgRuns !== null
    ? outcome.awayFgRuns + outcome.homeFgRuns
    : null;
  const bookTotalNum = game.bookTotal ? parseFloat(String(game.bookTotal)) : null;
  if (fgTotal !== null && bookTotalNum !== null && bookTotalNum > 0) {
    if (fgTotal !== bookTotalNum) {
      // Not a push — compute Brier. modelOverRate is stored 0-100.
      const outcomeOver: 0 | 1 = fgTotal > bookTotalNum ? 1 : 0;
      brierFgTotal = brierScore(probFromPct(game.modelOverRate), outcomeOver);
    }
    // Push → brierFgTotal stays null
  }

  // ── F5 Total ──────────────────────────────────────────────────────────────
  let brierF5Total: number | null = null;
  const f5TotalActual = outcome.awayF5Runs !== null && outcome.homeF5Runs !== null
    ? outcome.awayF5Runs + outcome.homeF5Runs
    : null;
  const bookF5TotalNum = game.f5Total ? parseFloat(String(game.f5Total)) : null;
  if (f5TotalActual !== null && bookF5TotalNum !== null && bookF5TotalNum > 0) {
    if (f5TotalActual !== bookF5TotalNum) {
      // modelF5OverRate is stored 0-1 (NOT 0-100 — M-203)
      const outcomeF5Over: 0 | 1 = f5TotalActual > bookF5TotalNum ? 1 : 0;
      brierF5Total = brierScore(probFromUnit(game.modelF5OverRate), outcomeF5Over);
    }
    // Push → brierF5Total stays null
  }

  // ── NRFI ──────────────────────────────────────────────────────────────────
  let brierNrfi: number | null = null;
  if (outcome.nrfiBinary !== null) {
    // modelPNrfi is stored 0-1 (NOT 0-100 — M-203)
    brierNrfi = brierScore(probFromUnit(game.modelPNrfi), outcome.nrfiBinary as 0 | 1);
  }

  // ── FG ML ─────────────────────────────────────────────────────────────────
  let brierFgMl: number | null = null;
  if (outcome.awayFgRuns !== null && outcome.homeFgRuns !== null) {
    if (outcome.awayFgRuns !== outcome.homeFgRuns) {
      // No tie in MLB (extra innings always produce a winner). modelHomeWinPct is stored 0-100.
      const outcomeHomeWin: 0 | 1 = outcome.homeFgRuns > outcome.awayFgRuns ? 1 : 0;
      brierFgMl = brierScore(probFromPct(game.modelHomeWinPct), outcomeHomeWin);
    }
    // Tie (shouldn't happen in MLB but guard anyway) → brierFgMl stays null
  }

  // ── F5 ML ─────────────────────────────────────────────────────────────────
  let brierF5Ml: number | null = null;
  if (outcome.awayF5Runs !== null && outcome.homeF5Runs !== null) {
    if (outcome.awayF5Runs !== outcome.homeF5Runs) {
      // modelF5HomeWinPct is stored 0-100
      const outcomeF5HomeWin: 0 | 1 = outcome.homeF5Runs > outcome.awayF5Runs ? 1 : 0;
      brierF5Ml = brierScore(probFromPct(game.modelF5HomeWinPct), outcomeF5HomeWin);
    }
    // F5 tie (common) → brierF5Ml stays null
  }

  return { brierFgTotal, brierF5Total, brierNrfi, brierFgMl, brierF5Ml };
}

// ─── Model-Pick Grading (M-101 forward path) ─────────────────────────────────
//
// The games grading columns historically graded a fixed AWAY-SIDE bet and were
// abandoned (audit M-101: 104/104 stored f5MlCorrect followed "away won F5").
// The functions below grade the MODEL'S PICK instead: WIN means the side the
// model favored won/covered. All functions are pure — outcomes come from the
// already-fetched MLB Stats API linescore; nothing here reads or writes the DB.

export interface PickGrade {
  result: "WIN" | "LOSS" | "PUSH" | null;
  correct: 0 | 1 | null;
}

export interface TotalGrade {
  result: "OVER" | "UNDER" | "PUSH" | null;
  correct: 0 | 1 | null;
}

/**
 * Grades a moneyline pick: pick = away when P(away win) > 0.5, home otherwise.
 * Result is from the pick's perspective (WIN = the picked side won).
 * Tie (possible in F5) → PUSH with correct = null.
 */
export function gradeMoneylinePick(
  pAwayWin: number | null,
  actualAwayScore: number | null,
  actualHomeScore: number | null,
): PickGrade {
  if (pAwayWin === null || isNaN(pAwayWin)) return { result: null, correct: null };
  if (actualAwayScore === null || actualHomeScore === null) return { result: null, correct: null };
  if (actualAwayScore === actualHomeScore) return { result: "PUSH", correct: null };
  const pickedAway = pAwayWin > 0.5;
  const awayWon = actualAwayScore > actualHomeScore;
  const won = pickedAway === awayWon;
  return { result: won ? "WIN" : "LOSS", correct: won ? 1 : 0 };
}

/**
 * Grades a run-line pick. awayRunLine is the away side's spread (e.g. +1.5):
 * away covers when actualAwayMargin + awayRunLine > 0. The model's pick is the
 * side its own projected margin covers (away when modelAwayMargin + awayRunLine > 0).
 * Exact actual cover → PUSH with correct = null. A model margin landing exactly
 * on the line gives no pick → both null.
 */
export function gradeRunLinePick(
  modelAwayMargin: number | null,
  awayRunLine: number | null,
  actualAwayMargin: number | null,
): PickGrade {
  if (modelAwayMargin === null || awayRunLine === null || actualAwayMargin === null) {
    return { result: null, correct: null };
  }
  if (isNaN(modelAwayMargin) || isNaN(awayRunLine) || isNaN(actualAwayMargin)) {
    return { result: null, correct: null };
  }
  const actualCover = actualAwayMargin + awayRunLine;
  if (actualCover === 0) return { result: "PUSH", correct: null };
  const modelCover = modelAwayMargin + awayRunLine;
  if (modelCover === 0) return { result: null, correct: null };
  const pickedAway = modelCover > 0;
  const awayCovered = actualCover > 0;
  const won = pickedAway === awayCovered;
  return { result: won ? "WIN" : "LOSS", correct: won ? 1 : 0 };
}

/**
 * Grades a total pick. result records the actual market side (OVER/UNDER/PUSH —
 * the schema's documented value domain for the *TotalResult columns); correct
 * grades the model's pick (over when pOver > 0.5, under otherwise) against it.
 * Push → correct = null.
 */
export function gradeTotalPick(
  pOver: number | null,
  bookTotal: number | null,
  actualTotal: number | null,
): TotalGrade {
  if (bookTotal === null || actualTotal === null || isNaN(bookTotal) || isNaN(actualTotal)) {
    return { result: null, correct: null };
  }
  if (bookTotal <= 0) return { result: null, correct: null }; // 0 = no line (same guard as briers)
  if (actualTotal === bookTotal) return { result: "PUSH", correct: null };
  const wentOver = actualTotal > bookTotal;
  const result: TotalGrade["result"] = wentOver ? "OVER" : "UNDER";
  if (pOver === null || isNaN(pOver)) return { result, correct: null };
  const pickedOver = pOver > 0.5;
  const won = pickedOver === wentOver;
  return { result, correct: won ? 1 : 0 };
}

/**
 * Grades the NRFI pick: pick = NRFI when P(NRFI) > 0.5, YRFI otherwise.
 * actualNrfiBinary: 1 = no run in inning 1. NRFI has no push.
 */
export function gradeNrfiPick(
  pNrfi: number | null,
  actualNrfiBinary: number | null,
): PickGrade {
  if (pNrfi === null || isNaN(pNrfi) || actualNrfiBinary === null) {
    return { result: null, correct: null };
  }
  const pickedNrfi = pNrfi > 0.5;
  const wasNrfi = actualNrfiBinary === 1;
  const won = pickedNrfi === wasNrfi;
  return { result: won ? "WIN" : "LOSS", correct: won ? 1 : 0 };
}

/** All model-pick grading columns for one game, ready for the games UPDATE. */
export interface ModelPickGrades {
  fgMlResult: PickGrade["result"];
  fgMlCorrect: PickGrade["correct"];
  fgRlResult: PickGrade["result"];
  fgRlCorrect: PickGrade["correct"];
  fgTotalResult: TotalGrade["result"];
  fgTotalCorrect: TotalGrade["correct"];
  f5MlResult: PickGrade["result"];
  f5MlCorrect: PickGrade["correct"];
  f5RlResult: PickGrade["result"];
  f5RlCorrect: PickGrade["correct"];
  f5TotalResult: TotalGrade["result"];
  f5TotalCorrect: TotalGrade["correct"];
  nrfiBacktestResult: PickGrade["result"];
  nrfiCorrect: PickGrade["correct"];
}

/**
 * Computes all model-pick grades for a game from its DB model columns and the
 * MLB Stats API outcome. Normalization per column matches the storage scales
 * documented in the header (M-203).
 */
export function computeModelPickGrades(
  game: {
    modelAwayWinPct: string | null | undefined;   // 0-100
    modelAwayScore: string | null | undefined;
    modelHomeScore: string | null | undefined;
    awayRunLine: string | null | undefined;       // away spread, e.g. "+1.5"
    modelOverRate: string | null | undefined;     // 0-100
    bookTotal: string | null | undefined;
    modelF5AwayWinPct: string | null | undefined; // 0-100
    modelF5AwayScore: string | null | undefined;
    modelF5HomeScore: string | null | undefined;
    f5AwayRunLine: string | null | undefined;     // away F5 spread
    modelF5OverRate: string | null | undefined;   // 0-1 (NOT 0-100)
    f5Total: string | null | undefined;
    modelPNrfi: string | null | undefined;        // 0-1 (NOT 0-100)
  },
  outcome: GameOutcome,
): ModelPickGrades {
  // ── FG ────────────────────────────────────────────────────────────────────
  const fgMl = gradeMoneylinePick(
    probFromPct(game.modelAwayWinPct), outcome.awayFgRuns, outcome.homeFgRuns,
  );
  const modelAwayScore = parseNumOrNull(game.modelAwayScore);
  const modelHomeScore = parseNumOrNull(game.modelHomeScore);
  const modelFgMargin = modelAwayScore !== null && modelHomeScore !== null
    ? modelAwayScore - modelHomeScore
    : null;
  const actualFgMargin = outcome.awayFgRuns !== null && outcome.homeFgRuns !== null
    ? outcome.awayFgRuns - outcome.homeFgRuns
    : null;
  const fgRl = gradeRunLinePick(modelFgMargin, parseNumOrNull(game.awayRunLine), actualFgMargin);
  const actualFgTotal = outcome.awayFgRuns !== null && outcome.homeFgRuns !== null
    ? outcome.awayFgRuns + outcome.homeFgRuns
    : null;
  const fgTot = gradeTotalPick(
    probFromPct(game.modelOverRate), parseNumOrNull(game.bookTotal), actualFgTotal,
  );

  // ── F5 ────────────────────────────────────────────────────────────────────
  const f5Ml = gradeMoneylinePick(
    probFromPct(game.modelF5AwayWinPct), outcome.awayF5Runs, outcome.homeF5Runs,
  );
  const modelF5Away = parseNumOrNull(game.modelF5AwayScore);
  const modelF5Home = parseNumOrNull(game.modelF5HomeScore);
  const modelF5Margin = modelF5Away !== null && modelF5Home !== null
    ? modelF5Away - modelF5Home
    : null;
  const actualF5Margin = outcome.awayF5Runs !== null && outcome.homeF5Runs !== null
    ? outcome.awayF5Runs - outcome.homeF5Runs
    : null;
  const f5Rl = gradeRunLinePick(modelF5Margin, parseNumOrNull(game.f5AwayRunLine), actualF5Margin);
  const actualF5Total = outcome.awayF5Runs !== null && outcome.homeF5Runs !== null
    ? outcome.awayF5Runs + outcome.homeF5Runs
    : null;
  const f5Tot = gradeTotalPick(
    probFromUnit(game.modelF5OverRate), parseNumOrNull(game.f5Total), actualF5Total,
  );

  // ── NRFI ──────────────────────────────────────────────────────────────────
  const nrfi = gradeNrfiPick(probFromUnit(game.modelPNrfi), outcome.nrfiBinary);

  return {
    fgMlResult: fgMl.result, fgMlCorrect: fgMl.correct,
    fgRlResult: fgRl.result, fgRlCorrect: fgRl.correct,
    fgTotalResult: fgTot.result, fgTotalCorrect: fgTot.correct,
    f5MlResult: f5Ml.result, f5MlCorrect: f5Ml.correct,
    f5RlResult: f5Rl.result, f5RlCorrect: f5Rl.correct,
    f5TotalResult: f5Tot.result, f5TotalCorrect: f5Tot.correct,
    nrfiBacktestResult: nrfi.result, nrfiCorrect: nrfi.correct,
  };
}

// ─── MLB Stats API Fetch ──────────────────────────────────────────────────────

/**
 * Fetches innings-level linescore data for all games on a given date.
 * Returns a map of gamePk → GameOutcome.
 *
 * API endpoint: statsapi.mlb.com/api/v1/schedule
 * Hydration: linescore (includes innings array)
 */
async function fetchMlbOutcomes(dateStr: string): Promise<Map<number, GameOutcome>> {
  const url =
    `${MLB_STATS_API_BASE}/schedule` +
    `?sportId=1&date=${dateStr}&hydrate=linescore`;

  console.log(`${TAG} [STEP] Fetching MLB Stats API: ${url}`);

  const res = await fetch(url, { headers: FETCH_HEADERS });
  if (!res.ok) {
    throw new Error(`MLB Stats API HTTP ${res.status} for date=${dateStr}`);
  }

  const json = await res.json() as {
    dates?: Array<{ games?: MlbApiGame[] }>;
  };

  const outcomes = new Map<number, GameOutcome>();
  const dateEntry = json.dates?.[0];
  if (!dateEntry?.games) {
    console.log(`${TAG} [STATE] No games found in API response for date=${dateStr}`);
    return outcomes;
  }

  for (const g of dateEntry.games) {
    const abstractState = g.status?.abstractGameState ?? "";
    const detailedState = g.status?.detailedState ?? "";
    const isFinal =
      abstractState === "Final" &&
      !["Postponed", "Suspended", "Cancelled"].includes(detailedState);

    const linescore = g.linescore;
    const innings = linescore?.innings ?? [];

    // Full-game runs from linescore teams (most reliable for final games)
    const awayFgRuns = isFinal
      ? (linescore?.teams?.away?.runs ?? g.teams.away.score ?? null)
      : null;
    const homeFgRuns = isFinal
      ? (linescore?.teams?.home?.runs ?? g.teams.home.score ?? null)
      : null;

    // F5 runs: sum innings 1-5 (only if at least 5 innings are present)
    const f5Innings = innings.filter(i => i.num >= 1 && i.num <= 5);
    const hasF5 = f5Innings.length >= 5 || (isFinal && innings.length >= 5);
    const awayF5Runs = hasF5
      ? f5Innings.reduce((s, i) => s + (i.away?.runs ?? 0), 0)
      : null;
    const homeF5Runs = hasF5
      ? f5Innings.reduce((s, i) => s + (i.home?.runs ?? 0), 0)
      : null;

    // NRFI: inning 1 — 1 if no run scored, 0 if any run scored
    const inn1 = innings.find(i => i.num === 1);
    let nrfiBinary: number | null = null;
    if (inn1) {
      const i1Away = inn1.away?.runs ?? 0;
      const i1Home = inn1.home?.runs ?? 0;
      nrfiBinary = (i1Away === 0 && i1Home === 0) ? 1 : 0;
    }

    const awayAbbrev = g.teams.away.team.abbreviation;
    const homeAbbrev = g.teams.home.team.abbreviation;

    outcomes.set(g.gamePk, {
      gamePk: g.gamePk,
      awayAbbrev,
      homeAbbrev,
      awayFgRuns,
      homeFgRuns,
      awayF5Runs,
      homeF5Runs,
      nrfiBinary,
      isFinal,
    });

    console.log(
      `${TAG} [STATE] gamePk=${g.gamePk} ${awayAbbrev}@${homeAbbrev}` +
      ` | final=${isFinal} | FG=${awayFgRuns ?? "?"}–${homeFgRuns ?? "?"}` +
      ` | F5=${awayF5Runs ?? "?"}–${homeF5Runs ?? "?"}` +
      ` | NRFI=${nrfiBinary ?? "?"}` +
      ` | innings=${innings.length}`
    );
  }

  console.log(`${TAG} [STEP] API returned ${outcomes.size} games for date=${dateStr}`);
  return outcomes;
}

// ─── Main Ingestion Function ──────────────────────────────────────────────────

/**
 * Ingests outcomes for all final MLB games on the given date.
 *
 * Strategy:
 *   1. Query DB for all MLB games on date with gameStatus='final' and sport='MLB'
 *   2. Skip games where outcomeIngestedAt is already set (unless force=true)
 *   3. Fetch innings-level linescore from MLB Stats API
 *   4. Match DB games to API outcomes by mlbGamePk (primary) or team abbreviation (fallback)
 *   5. Compute actualFgTotal, actualF5Total, actualNrfiBinary
 *   6. Compute 5 Brier scores using model probabilities from DB
 *   7. Write all fields atomically in a single UPDATE per game
 *   8. Verify written values match computed values
 *
 * @param dateStr  YYYY-MM-DD date string (PST/PDT)
 * @param force    If true, re-ingest games that already have outcomeIngestedAt set
 */
export async function ingestMlbOutcomes(
  dateStr: string,
  force = false,
): Promise<OutcomeIngestSummary> {
  const startMs = Date.now();
  console.log(`\n${TAG} ══════════════════════════════════════════════════════`);
  console.log(`${TAG} [INPUT] date=${dateStr} force=${force}`);

  const db = await getDb();

  // ── Step 1: Query DB for final MLB games on this date ─────────────────────
  console.log(`${TAG} [STEP 1] Querying DB for final MLB games on ${dateStr}`);

  const dbGames = await db
    .select({
      id: games.id,
      gameDate: games.gameDate,
      awayTeam: games.awayTeam,
      homeTeam: games.homeTeam,
      gameStatus: games.gameStatus,
      mlbGamePk: games.mlbGamePk,
      outcomeIngestedAt: games.outcomeIngestedAt,
      // Model probabilities for Brier computation
      bookTotal: games.bookTotal,
      modelOverRate: games.modelOverRate,
      f5Total: games.f5Total,
      modelF5OverRate: games.modelF5OverRate,
      modelPNrfi: games.modelPNrfi,
      modelHomeWinPct: games.modelHomeWinPct,
      modelF5HomeWinPct: games.modelF5HomeWinPct,
      // Model picks + lines for model-pick grading (M-101)
      modelAwayWinPct: games.modelAwayWinPct,
      modelF5AwayWinPct: games.modelF5AwayWinPct,
      modelAwayScore: games.modelAwayScore,
      modelHomeScore: games.modelHomeScore,
      modelF5AwayScore: games.modelF5AwayScore,
      modelF5HomeScore: games.modelF5HomeScore,
      awayRunLine: games.awayRunLine,
      f5AwayRunLine: games.f5AwayRunLine,
      // Existing actual scores (may already be set by mlbScoreRefresh)
      actualAwayScore: games.actualAwayScore,
      actualHomeScore: games.actualHomeScore,
      actualF5AwayScore: games.actualF5AwayScore,
      actualF5HomeScore: games.actualF5HomeScore,
    })
    .from(games)
    .where(
      and(
        eq(games.gameDate, dateStr),
        eq(games.sport, "MLB"),
        eq(games.gameStatus, "final"),
      )
    );

  console.log(`${TAG} [STATE] Found ${dbGames.length} final MLB games in DB for ${dateStr}`);

  const results: OutcomeIngestResult[] = [];
  let written = 0;
  let skippedAlreadyIngested = 0;
  let skippedNotFinal = 0;
  let skippedNoGamePk = 0;
  let skippedNoApiMatch = 0;
  let errors = 0;

  if (dbGames.length === 0) {
    console.log(`${TAG} [OUTPUT] No final MLB games to ingest for ${dateStr}`);
    return {
      date: dateStr,
      totalGames: 0,
      written: 0,
      skippedAlreadyIngested: 0,
      skippedNotFinal: 0,
      skippedNoGamePk: 0,
      skippedNoApiMatch: 0,
      errors: 0,
      results: [],
      runAt: Date.now(),
    };
  }

  // ── Step 2: Fetch MLB Stats API outcomes ──────────────────────────────────
  console.log(`${TAG} [STEP 2] Fetching MLB Stats API for date=${dateStr}`);
  let apiOutcomes: Map<number, GameOutcome>;
  try {
    apiOutcomes = await fetchMlbOutcomes(dateStr);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${TAG} [ERROR] MLB Stats API fetch failed: ${msg}`);
    // Return all games as errors
    for (const g of dbGames) {
      results.push({
        gameId: g.id,
        matchup: `${g.awayTeam}@${g.homeTeam}`,
        gameDate: g.gameDate ?? dateStr,
        status: "error",
        actualFgTotal: null,
        actualF5Total: null,
        actualNrfiBinary: null,
        brierFgTotal: null,
        brierF5Total: null,
        brierNrfi: null,
        brierFgMl: null,
        brierF5Ml: null,
        error: `API fetch failed: ${msg}`,
      });
      errors++;
    }
    return {
      date: dateStr,
      totalGames: dbGames.length,
      written: 0,
      skippedAlreadyIngested: 0,
      skippedNotFinal: 0,
      skippedNoGamePk: 0,
      skippedNoApiMatch: 0,
      errors,
      results,
      runAt: Date.now(),
    };
  }

  // ── Step 3: Process each DB game ──────────────────────────────────────────
  console.log(`${TAG} [STEP 3] Processing ${dbGames.length} games`);

  for (const game of dbGames) {
    const matchup = `${game.awayTeam}@${game.homeTeam}`;
    console.log(`\n${TAG} [STEP] Processing game id=${game.id} ${matchup} date=${game.gameDate}`);

    // Skip if already ingested (unless force)
    if (!force && game.outcomeIngestedAt !== null && game.outcomeIngestedAt !== undefined) {
      console.log(`${TAG} [STATE] SKIP — already ingested at ${new Date(game.outcomeIngestedAt).toISOString()}`);
      results.push({
        gameId: game.id,
        matchup,
        gameDate: game.gameDate ?? dateStr,
        status: "skipped_already_ingested",
        actualFgTotal: null,
        actualF5Total: null,
        actualNrfiBinary: null,
        brierFgTotal: null,
        brierF5Total: null,
        brierNrfi: null,
        brierFgMl: null,
        brierF5Ml: null,
      });
      skippedAlreadyIngested++;
      continue;
    }

    // Match to API outcome
    let apiOutcome: GameOutcome | undefined;

    // Primary match: mlbGamePk
    if (game.mlbGamePk) {
      apiOutcome = apiOutcomes.get(game.mlbGamePk);
      if (apiOutcome) {
        console.log(`${TAG} [STATE] Matched by mlbGamePk=${game.mlbGamePk}`);
      }
    }

    // Fallback match: team abbreviation (normalize SF → SF, etc.)
    if (!apiOutcome) {
      for (const outcome of Array.from(apiOutcomes.values())) {
        const awayMatch =
          outcome.awayAbbrev === game.awayTeam ||
          normalizeTeamAbbrev(outcome.awayAbbrev) === normalizeTeamAbbrev(game.awayTeam);
        const homeMatch =
          outcome.homeAbbrev === game.homeTeam ||
          normalizeTeamAbbrev(outcome.homeAbbrev) === normalizeTeamAbbrev(game.homeTeam);
        if (awayMatch && homeMatch) {
          apiOutcome = outcome;
          console.log(`${TAG} [STATE] Matched by team abbreviation: ${outcome.awayAbbrev}@${outcome.homeAbbrev}`);
          break;
        }
      }
    }

    if (!apiOutcome) {
      console.warn(`${TAG} [WARN] No API match for game id=${game.id} ${matchup} — skipping`);
      results.push({
        gameId: game.id,
        matchup,
        gameDate: game.gameDate ?? dateStr,
        status: "skipped_no_api_match",
        actualFgTotal: null,
        actualF5Total: null,
        actualNrfiBinary: null,
        brierFgTotal: null,
        brierF5Total: null,
        brierNrfi: null,
        brierFgMl: null,
        brierF5Ml: null,
      });
      skippedNoApiMatch++;
      continue;
    }

    if (!apiOutcome.isFinal) {
      console.log(`${TAG} [STATE] SKIP — API reports game not final (gamePk=${apiOutcome.gamePk})`);
      results.push({
        gameId: game.id,
        matchup,
        gameDate: game.gameDate ?? dateStr,
        status: "skipped_not_final",
        actualFgTotal: null,
        actualF5Total: null,
        actualNrfiBinary: null,
        brierFgTotal: null,
        brierF5Total: null,
        brierNrfi: null,
        brierFgMl: null,
        brierF5Ml: null,
      });
      skippedNotFinal++;
      continue;
    }

    // ── Compute derived outcome fields ────────────────────────────────────
    const actualFgTotal =
      apiOutcome.awayFgRuns !== null && apiOutcome.homeFgRuns !== null
        ? apiOutcome.awayFgRuns + apiOutcome.homeFgRuns
        : null;
    const actualF5Total =
      apiOutcome.awayF5Runs !== null && apiOutcome.homeF5Runs !== null
        ? apiOutcome.awayF5Runs + apiOutcome.homeF5Runs
        : null;
    const actualNrfiBinary = apiOutcome.nrfiBinary;

    console.log(
      `${TAG} [STATE] id=${game.id} ${matchup}` +
      ` | actualFgTotal=${actualFgTotal ?? "null"}` +
      ` | actualF5Total=${actualF5Total ?? "null"}` +
      ` | actualNrfiBinary=${actualNrfiBinary ?? "null"}`
    );

    // ── Compute Brier scores ──────────────────────────────────────────────
    const briers = computeBrierScores(game, apiOutcome);

    console.log(
      `${TAG} [STATE] Brier scores:` +
      ` FgTotal=${briers.brierFgTotal ?? "null"}` +
      ` F5Total=${briers.brierF5Total ?? "null"}` +
      ` NRFI=${briers.brierNrfi ?? "null"}` +
      ` FgML=${briers.brierFgMl ?? "null"}` +
      ` F5ML=${briers.brierF5Ml ?? "null"}`
    );

    // ── Compute model-pick grades (M-101 forward path) ────────────────────
    const grades = computeModelPickGrades(game, apiOutcome);

    console.log(
      `${TAG} [STATE] Model-pick grades:` +
      ` fgMl=${grades.fgMlResult ?? "null"}` +
      ` fgRl=${grades.fgRlResult ?? "null"}` +
      ` fgTotal=${grades.fgTotalResult ?? "null"}` +
      ` f5Ml=${grades.f5MlResult ?? "null"}` +
      ` f5Rl=${grades.f5RlResult ?? "null"}` +
      ` f5Total=${grades.f5TotalResult ?? "null"}` +
      ` nrfi=${grades.nrfiBacktestResult ?? "null"}`
    );

    // ── Write to DB ───────────────────────────────────────────────────────
    try {
      const now = Date.now();
      await db
        .update(games)
        .set({
          actualFgTotal: actualFgTotal !== null ? String(actualFgTotal) : undefined,
          actualF5Total: actualF5Total !== null ? String(actualF5Total) : undefined,
          actualNrfiBinary: actualNrfiBinary,
          brierFgTotal: briers.brierFgTotal !== null ? String(briers.brierFgTotal) : undefined,
          brierF5Total: briers.brierF5Total !== null ? String(briers.brierF5Total) : undefined,
          brierNrfi: briers.brierNrfi !== null ? String(briers.brierNrfi) : undefined,
          brierFgMl: briers.brierFgMl !== null ? String(briers.brierFgMl) : undefined,
          brierF5Ml: briers.brierF5Ml !== null ? String(briers.brierF5Ml) : undefined,
          // Model-pick grades (M-101): written as a complete set — nulls
          // included — so a fresh backtestRunAt stamp never sits over stale
          // away-side-era grades. Grading columns only; never projections.
          fgMlResult: grades.fgMlResult,
          fgMlCorrect: grades.fgMlCorrect,
          fgRlResult: grades.fgRlResult,
          fgRlCorrect: grades.fgRlCorrect,
          fgTotalResult: grades.fgTotalResult,
          fgTotalCorrect: grades.fgTotalCorrect,
          fgBacktestRunAt: now,
          f5MlResult: grades.f5MlResult,
          f5MlCorrect: grades.f5MlCorrect,
          f5RlResult: grades.f5RlResult,
          f5RlCorrect: grades.f5RlCorrect,
          f5TotalResult: grades.f5TotalResult,
          f5TotalCorrect: grades.f5TotalCorrect,
          f5BacktestRunAt: now,
          nrfiBacktestResult: grades.nrfiBacktestResult,
          nrfiCorrect: grades.nrfiCorrect,
          nrfiBacktestRunAt: now,
          outcomeIngestedAt: now,
        })
        .where(eq(games.id, game.id));

      console.log(`${TAG} [OUTPUT] id=${game.id} ${matchup} — written OK`);

      // ── Post-write verification ────────────────────────────────────────
      const [verify] = await db
        .select({
          actualFgTotal: games.actualFgTotal,
          actualF5Total: games.actualF5Total,
          actualNrfiBinary: games.actualNrfiBinary,
          brierFgTotal: games.brierFgTotal,
          outcomeIngestedAt: games.outcomeIngestedAt,
        })
        .from(games)
        .where(eq(games.id, game.id));

      const fgMatch = verify.actualFgTotal !== null && actualFgTotal !== null
        ? Math.abs(parseFloat(String(verify.actualFgTotal)) - actualFgTotal) < 0.01
        : verify.actualFgTotal === null && actualFgTotal === null;

      if (!fgMatch) {
        console.error(
          `${TAG} [VERIFY] FAIL — id=${game.id} ${matchup}` +
          ` | expected actualFgTotal=${actualFgTotal} got=${verify.actualFgTotal}`
        );
      } else {
        console.log(`${TAG} [VERIFY] PASS — id=${game.id} ${matchup} | actualFgTotal=${verify.actualFgTotal} | outcomeIngestedAt=${verify.outcomeIngestedAt}`);
      }

      results.push({
        gameId: game.id,
        matchup,
        gameDate: game.gameDate ?? dateStr,
        status: "written",
        actualFgTotal,
        actualF5Total,
        actualNrfiBinary,
        brierFgTotal: briers.brierFgTotal,
        brierF5Total: briers.brierF5Total,
        brierNrfi: briers.brierNrfi,
        brierFgMl: briers.brierFgMl,
        brierF5Ml: briers.brierF5Ml,
      });
      written++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${TAG} [ERROR] DB write failed for id=${game.id} ${matchup}: ${msg}`);
      results.push({
        gameId: game.id,
        matchup,
        gameDate: game.gameDate ?? dateStr,
        status: "error",
        actualFgTotal: null,
        actualF5Total: null,
        actualNrfiBinary: null,
        brierFgTotal: null,
        brierF5Total: null,
        brierNrfi: null,
        brierFgMl: null,
        brierF5Ml: null,
        error: msg,
      });
      errors++;
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startMs) / 1000).toFixed(2);
  console.log(`\n${TAG} ══════════════════════════════════════════════════════`);
  console.log(`${TAG} [SUMMARY] date=${dateStr}`);
  console.log(`${TAG} [SUMMARY] total=${dbGames.length} | written=${written} | skipped_ingested=${skippedAlreadyIngested} | skipped_not_final=${skippedNotFinal} | skipped_no_pk=${skippedNoGamePk} | skipped_no_match=${skippedNoApiMatch} | errors=${errors}`);
  console.log(`${TAG} [SUMMARY] elapsed=${elapsed}s`);
  console.log(`${TAG} ══════════════════════════════════════════════════════\n`);

  // ── Drift detector: run rolling f5_share check (before notifyOwner so result is included) ─────────
  let driftSummaryLine = 'Drift check: skipped (insufficient data)';
  try {
    console.log(`${TAG} [STEP] Running drift detector (rolling f5_share check)...`);
    const driftResult = await checkF5ShareDrift();
    console.log(`${TAG} [OUTPUT] driftDetected=${driftResult.driftDetected} | delta=${driftResult.delta?.toFixed(4) ?? 'N/A'} | rollingF5Share=${driftResult.rollingF5Share?.toFixed(4) ?? 'N/A'} | windowSize=${driftResult.windowSize}`);
    console.log(`${TAG} [OUTPUT] drift message: ${driftResult.message}`);
    if (driftResult.driftDetected) {
      console.warn(`${TAG} [VERIFY] DRIFT DETECTED — delta=${driftResult.delta?.toFixed(4)} exceeds threshold. recalibrationTriggered=${driftResult.recalibrationTriggered}`);
      driftSummaryLine = `⚠️ DRIFT DETECTED — delta=${driftResult.delta?.toFixed(4)} | rolling=${driftResult.rollingF5Share?.toFixed(4)} | baseline=${driftResult.baselineF5Share.toFixed(4)} | recalibrated=${driftResult.recalibrationTriggered}`;
    } else if (driftResult.rollingF5Share !== null) {
      console.log(`${TAG} [VERIFY] PASS — no drift detected (delta=${driftResult.delta?.toFixed(4) ?? 'N/A'})`);
      driftSummaryLine = `✅ No drift — delta=${driftResult.delta?.toFixed(4)} | rolling=${driftResult.rollingF5Share?.toFixed(4)} | baseline=${driftResult.baselineF5Share.toFixed(4)} | window=${driftResult.windowSize}`;
    } else {
      driftSummaryLine = `Drift check: insufficient data (${driftResult.windowSize} games, need 20+)`;
    }
  } catch (driftErr) {
    const driftMsg = driftErr instanceof Error ? driftErr.message : String(driftErr);
    console.error(`${TAG} [ERROR] drift detector failed (non-fatal): ${driftMsg}`);
    driftSummaryLine = `Drift check: error — ${driftMsg.slice(0, 80)}`;
  }

  // ── F5 ML coverage audit: count games with model but no book F5 ML odds ──────────────────
  let coverageLine = '';
  try {
    const db = await getDb();
    const coverageGap = await db
      .select({ count: sql<number>`count(*)` })
      .from(games)
      .where(and(
        isNotNull(games.modelF5AwayWinPct),
        isNull(games.f5AwayML),
      ));
    const gapCount = Number(coverageGap[0]?.count ?? 0);
    coverageLine = gapCount > 0
      ? `⚠️ F5 ML coverage gap: ${gapCount} game${gapCount !== 1 ? 's' : ''} have model but no book F5 ML odds`
      : `✅ F5 ML coverage: no gaps detected`;
    console.log(`${TAG} [OUTPUT] F5 ML coverage audit: ${coverageLine}`);
  } catch (covErr) {
    coverageLine = 'F5 ML coverage audit: error (non-fatal)';
    console.error(`${TAG} [ERROR] F5 ML coverage audit failed: ${covErr instanceof Error ? covErr.message : String(covErr)}`);
  }

  // ── notifyOwner: push Brier calibration summary + drift result to owner ──────────────────
  if (written > 0) {
    try {
      const ingestedResults = results.filter(r => r.status === 'written');
      const brierAvg = (field: keyof OutcomeIngestResult): string => {
        const vals = ingestedResults
          .map(r => r[field] as number | null | undefined)
          .filter((v): v is number => v != null && !isNaN(v as number));
        if (vals.length === 0) return 'N/A';
        const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
        return avg.toFixed(4);
      };
      const statusLine = errors > 0 ? `⚠️ ${errors} error(s)` : '✅ 0 errors';
      const notifTitle = `MLB Outcome Ingest — ${dateStr}`;
      const notifContent = [
        `Date: ${dateStr}`,
        `Games ingested: ${written} / ${dbGames.length} | ${statusLine}`,
        `Elapsed: ${elapsed}s`,
        ``,
        `Brier Scores (today's ${written} game${written !== 1 ? 's' : ''}):`,
        `  FG ML:    ${brierAvg('brierFgMl')}`,
        `  F5 ML:    ${brierAvg('brierF5Ml')}`,
        `  NRFI:     ${brierAvg('brierNrfi')}`,
        `  FG Total: ${brierAvg('brierFgTotal')}`,
        `  F5 Total: ${brierAvg('brierF5Total')}`,
        ``,
        `(lower = better | perfect = 0.0000 | random = 0.2500)`,
        ``,
        `Drift Detector:`,
        `  ${driftSummaryLine}`,
        ``,
        `Coverage Audit:`,
        `  ${coverageLine}`,
      ].join('\n');
      console.log(`${TAG} [STEP] Sending owner notification with Brier calibration summary + drift result...`);
      const notifOk = await notifyOwner({ title: notifTitle, content: notifContent });
      console.log(`${TAG} [OUTPUT] notifyOwner: ${notifOk ? 'sent' : 'failed (non-fatal)'}`);
    } catch (notifErr) {
      const notifMsg = notifErr instanceof Error ? notifErr.message : String(notifErr);
      console.error(`${TAG} [ERROR] notifyOwner failed (non-fatal): ${notifMsg}`);
    }
  } else {
    console.log(`${TAG} [STEP] Skipping owner notification (written=0, no new games ingested)`);
  }

  return {
    date: dateStr,
    totalGames: dbGames.length,
    written,
    skippedAlreadyIngested,
    skippedNotFinal,
    skippedNoGamePk,
    skippedNoApiMatch,
    errors,
    results,
    runAt: Date.now(),
  };
}

/**
 * Ingests outcomes for a range of dates (inclusive).
 * Used for backfill operations.
 *
 * @param startDate  YYYY-MM-DD start date
 * @param endDate    YYYY-MM-DD end date
 * @param force      If true, re-ingest already-ingested games
 */
async function ingestMlbOutcomesRange(
  startDate: string,
  endDate: string,
  force = false,
): Promise<OutcomeIngestSummary[]> {
  const summaries: OutcomeIngestSummary[] = [];
  const start = new Date(startDate + "T00:00:00Z");
  const end = new Date(endDate + "T00:00:00Z");

  console.log(`${TAG} [INPUT] Range backfill: ${startDate} → ${endDate} force=${force}`);

  const current = new Date(start);
  while (current <= end) {
    const dateStr = current.toISOString().slice(0, 10);
    const summary = await ingestMlbOutcomes(dateStr, force);
    summaries.push(summary);
    current.setUTCDate(current.getUTCDate() + 1);
  }

  const totalWritten = summaries.reduce((s, r) => s + r.written, 0);
  const totalErrors = summaries.reduce((s, r) => s + r.errors, 0);
  console.log(`${TAG} [SUMMARY] Range complete: ${startDate}→${endDate} | totalWritten=${totalWritten} | totalErrors=${totalErrors}`);

  return summaries;
}

// ─── Team Abbreviation Normalization ─────────────────────────────────────────

/**
 * Normalizes MLB team abbreviations for fuzzy matching.
 * Handles known discrepancies between MLB Stats API and our DB.
 */
function normalizeTeamAbbrev(abbrev: string): string {
  const MAP: Record<string, string> = {
    // MLB Stats API → our DB
    "SF":  "SF",
    "SFG": "SF",
    "SD":  "SD",
    "SDP": "SD",
    "KC":  "KC",
    "KCR": "KC",
    "TB":  "TB",
    "TBR": "TB",
    "CWS": "CWS",
    "CHW": "CWS",
    "WSH": "WSH",
    "WAS": "WSH",
    "ARI": "ARI",
    "AZ":  "ARI",
  };
  return MAP[abbrev] ?? abbrev;
}
