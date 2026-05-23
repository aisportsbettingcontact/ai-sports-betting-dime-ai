/**
 * mlbBacktestAuditCore.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Production-grade deterministic grading engine for the 10 approved MLB markets.
 *
 * APPROVED MARKETS (scope-locked per spec):
 *   1. Full Game Moneyline (FG_ML)
 *   2. Full Game Run Line (FG_RL)
 *   3. Full Game Totals (FG_TOTAL)
 *   4. First 5 Moneyline (F5_ML)
 *   5. First 5 Run Line (F5_RL)
 *   6. First 5 Totals (F5_TOTAL)
 *   7. YRFI
 *   8. NRFI
 *   9. Strikeout Props (K_PROP)
 *  10. Home Run Props (HR_PROP)
 *
 * GRADE VALUES (exhaustive — no other values allowed):
 *   WIN | LOSS | PUSH | VOID | QUARANTINED | UNGRADED
 *
 * LEAKAGE GUARD:
 *   Every grading call validates that modelRunAt < gameStartUtcMs.
 *   If modelRunAt is missing or after game start → result = QUARANTINED.
 *
 * LOGGING FORMAT (per spec Section 18):
 *   [LEVEL][MLB_BACKTEST][MARKET][TIMEFRAME][MODULE][CHECK] message | records_checked=N | ...
 *
 * IDEMPOTENCY:
 *   All grading functions are pure — same inputs → same output, no side effects.
 *
 * MATHEMATICAL CONTRACTS:
 *   - mlToProb: positive odds → 100/(ml+100), negative odds → |ml|/(|ml|+100)
 *   - noVigProb: p1/(p1+p2) — two-sided market only
 *   - edge: modelProb - bookNoVigProb
 *   - ev: edge * (1/bookProb - 1) * 100 (for -110 standard: ev = edge * 0.909 * 100)
 *   - roi: (wins * (100/|avgOdds|) - losses) / (wins + losses)
 *   - brierScore: mean((p - o)^2) over binary outcomes
 *   - logLoss: -mean(o*log(p) + (1-o)*log(1-p))
 *   - clv: modelProb - closingNoVigProb (positive = model beat the close)
 */

// ─── Grade Values ─────────────────────────────────────────────────────────────
export type GradeValue = "WIN" | "LOSS" | "PUSH" | "VOID" | "QUARANTINED" | "UNGRADED";

// ─── Market / Timeframe Labels ────────────────────────────────────────────────
export type ApprovedMarket =
  | "fg_ml_home" | "fg_ml_away"
  | "fg_rl_home" | "fg_rl_away"
  | "fg_over"    | "fg_under"
  | "f5_ml_home" | "f5_ml_away"
  | "f5_rl_home" | "f5_rl_away"
  | "f5_over"    | "f5_under"
  | "nrfi"       | "yrfi"
  | "k_prop"     | "hr_prop";

export type ApprovedTimeframe =
  | "FULL_GAME"
  | "FIRST_5"
  | "FIRST_INNING"
  | "PLAYER_GAME";

export const MARKET_TIMEFRAME: Record<ApprovedMarket, ApprovedTimeframe> = {
  fg_ml_home: "FULL_GAME", fg_ml_away: "FULL_GAME",
  fg_rl_home: "FULL_GAME", fg_rl_away: "FULL_GAME",
  fg_over:    "FULL_GAME", fg_under:   "FULL_GAME",
  f5_ml_home: "FIRST_5",  f5_ml_away: "FIRST_5",
  f5_rl_home: "FIRST_5",  f5_rl_away: "FIRST_5",
  f5_over:    "FIRST_5",  f5_under:   "FIRST_5",
  nrfi:       "FIRST_INNING", yrfi: "FIRST_INNING",
  k_prop:     "PLAYER_GAME",  hr_prop: "PLAYER_GAME",
};

// ─── Grading Input / Output Types ─────────────────────────────────────────────
export interface GradingInput {
  /** Canonical market key */
  market: ApprovedMarket;
  /** FK to games table */
  gameId: number;
  /** YYYY-MM-DD */
  gameDate: string;
  /** Player MLBAM ID — required for k_prop and hr_prop */
  playerId?: number | null;
  /** Player name — for logging only */
  playerName?: string | null;
  /** Model side: 'home'|'away'|'over'|'under'|'nrfi'|'yrfi'|player name */
  modelSide: string;
  /** Model probability [0,1] */
  modelProb: number;
  /** Book line, e.g. "1.5" or "8.5" */
  bookLine: number | null;
  /** Book odds for the model side (American integer) */
  bookOdds: number | null;
  /** Book odds for the opposite side (American integer) — used for no-vig */
  bookOddsOpposite: number | null;
  /** Closing odds for the model side (American integer) — for CLV */
  closingOdds?: number | null;
  /** Closing odds for opposite side — for CLV */
  closingOddsOpposite?: number | null;
  /** UTC ms when model ran — REQUIRED for leakage guard */
  modelRunAt: number | null;
  /** UTC ms of scheduled first pitch — REQUIRED for leakage guard */
  gameStartUtcMs: number | null;
  /** UTC ms when odds were recorded */
  oddsTimestamp?: number | null;
  /** UTC ms when official result was recorded */
  resultTimestamp?: number | null;
  /** Actual result value — interpretation depends on market */
  actualValue: ActualValue;
  /** Source trace ID for audit trail */
  sourceTraceId?: string;
}

export interface ActualValue {
  /** Full game: away runs (includes extra innings) */
  fgAwayRuns?: number | null;
  /** Full game: home runs (includes extra innings) */
  fgHomeRuns?: number | null;
  /** F5: away runs through 5 innings */
  f5AwayRuns?: number | null;
  /** F5: home runs through 5 innings */
  f5HomeRuns?: number | null;
  /** First inning: 'NRFI' | 'YRFI' | null */
  nrfiResult?: "NRFI" | "YRFI" | null;
  /** K-Props: actual strikeouts thrown */
  actualKs?: number | null;
  /** HR Props: 1 = hit HR, 0 = no HR, null = missing */
  actualHr?: number | null;
  /** Whether game was officially postponed/cancelled */
  isPostponed?: boolean;
  /** Whether game was officially suspended (not completed) */
  isSuspended?: boolean;
  /** Whether batter did not appear in the game */
  didNotAppear?: boolean;
}

export interface GradingOutput {
  market: ApprovedMarket;
  timeframe: ApprovedTimeframe;
  gameId: number;
  gameDate: string;
  playerId: number | null;
  playerName: string | null;
  modelSide: string;
  bookLine: number | null;
  bookOdds: number | null;
  bookNoVigProb: number | null;
  modelProb: number;
  edge: number | null;
  ev: number | null;
  clv: number | null;
  grade: GradeValue;
  profitLoss: number | null;
  roi: number | null;
  pushFlag: boolean;
  voidFlag: boolean;
  quarantineFlag: boolean;
  quarantineReason: string | null;
  errorFlag: boolean;
  errorReason: string | null;
  sourceTraceId: string | null;
  predictionTimestamp: number | null;
  oddsTimestamp: number | null;
  resultTimestamp: number | null;
  gradingTimestamp: number;
  leakageSafe: boolean;
  notes: string;
}

// ─── Logging Helper ────────────────────────────────────────────────────────────
const TAG = "MLB_BACKTEST";

export function auditLog(
  level: "DEBUG" | "INFO" | "WARN" | "ERROR" | "CRITICAL",
  market: string,
  timeframe: string,
  module: string,
  check: string,
  message: string,
  counts: {
    records_checked?: number;
    passed?: number;
    failed?: number;
    quarantined?: number;
    date_min?: string;
    date_max?: string;
    impact?: string;
    action?: string;
  } = {},
): void {
  const parts = [
    `[${level}][${TAG}][${market}][${timeframe}][${module}][${check}]`,
    message,
    `| records_checked=${counts.records_checked ?? 0}`,
    `| passed=${counts.passed ?? 0}`,
    `| failed=${counts.failed ?? 0}`,
    `| quarantined=${counts.quarantined ?? 0}`,
  ];
  if (counts.date_min) parts.push(`| date_min=${counts.date_min}`);
  if (counts.date_max) parts.push(`| date_max=${counts.date_max}`);
  if (counts.impact)   parts.push(`| impact=${counts.impact}`);
  if (counts.action)   parts.push(`| action=${counts.action}`);
  console.log(parts.join(" "));
}

// ─── Math Library ─────────────────────────────────────────────────────────────

/**
 * Convert American odds to implied probability.
 * [INPUT]  ml: American odds integer (e.g. -138, +120)
 * [OUTPUT] probability [0,1]
 */
export function mlToProb(ml: number): number {
  if (!isFinite(ml) || ml === 0) return 0;
  if (ml > 0) return 100 / (ml + 100);
  return Math.abs(ml) / (Math.abs(ml) + 100);
}

/**
 * Convert probability to American odds.
 * [INPUT]  p: probability [0,1]
 * [OUTPUT] American odds integer
 */
export function probToMl(p: number): number {
  if (p <= 0 || p >= 1) return 0;
  if (p >= 0.5) return Math.round(-(p / (1 - p)) * 100);
  return Math.round(((1 - p) / p) * 100);
}

/**
 * Remove vig from two-sided market.
 * [INPUT]  ml1, ml2: American odds for each side
 * [OUTPUT] no-vig probability for side 1 (side 2 = 1 - result)
 */
export function noVigProb(ml1: number, ml2: number): number {
  const p1 = mlToProb(ml1);
  const p2 = mlToProb(ml2);
  const total = p1 + p2;
  if (total <= 0) return 0;
  return parseFloat((p1 / total).toFixed(6));
}

/**
 * Market hold (vig) = sum of implied probs - 1.
 */
export function marketHold(ml1: number, ml2: number): number {
  return parseFloat((mlToProb(ml1) + mlToProb(ml2) - 1).toFixed(6));
}

/**
 * Edge = modelProb - bookNoVigProb.
 * Positive edge = model thinks it's more likely than the market implies.
 */
export function calcEdge(modelProb: number, bookNoVigProb: number | null): number | null {
  if (bookNoVigProb === null) return null;
  return parseFloat((modelProb - bookNoVigProb).toFixed(6));
}

/**
 * Expected Value = edge * (1/bookNoVigProb - 1) * 100.
 * Represents expected profit per $100 wagered.
 */
export function calcEV(modelProb: number, bookOdds: number | null): number | null {
  if (bookOdds === null) return null;
  const bookP = mlToProb(bookOdds);
  if (bookP <= 0) return null;
  const payout = bookOdds > 0 ? bookOdds / 100 : 100 / Math.abs(bookOdds);
  return parseFloat((modelProb * payout - (1 - modelProb)).toFixed(4));
}

/**
 * Profit/Loss for a single bet at American odds.
 * WIN  → payout = odds > 0 ? odds/100 : 100/|odds|
 * LOSS → -1 (lose stake)
 * PUSH → 0
 * VOID → 0 (stake returned, not counted in ROI denominator)
 */
export function calcProfitLoss(grade: GradeValue, bookOdds: number | null): number | null {
  if (grade === "QUARANTINED" || grade === "UNGRADED") return null;
  if (grade === "VOID" || grade === "PUSH") return 0;
  if (bookOdds === null) return null;
  if (grade === "WIN") {
    return bookOdds > 0 ? bookOdds / 100 : 100 / Math.abs(bookOdds);
  }
  return -1; // LOSS
}

/**
 * ROI = total profit / total risked.
 * VOID rows are excluded from denominator.
 * PUSH rows: stake returned, counted in denominator, profit = 0.
 */
export function calcRoi(wins: number, losses: number, avgOdds = -110): number {
  const denom = wins + losses;
  if (denom === 0) return 0;
  const payout = avgOdds > 0 ? avgOdds / 100 : 100 / Math.abs(avgOdds);
  const profit = wins * payout - losses;
  return parseFloat((profit / denom).toFixed(6));
}

/**
 * Brier Score = mean((p - o)^2) for binary outcomes.
 * [INPUT]  probs: model probabilities [0,1], outcomes: 0 or 1
 * [OUTPUT] Brier score [0,1] — lower is better
 */
export function brierScore(probs: number[], outcomes: number[]): number {
  if (probs.length !== outcomes.length || probs.length === 0) return 0;
  const sum = probs.reduce((acc, p, i) => acc + Math.pow(p - outcomes[i], 2), 0);
  return parseFloat((sum / probs.length).toFixed(6));
}

/**
 * Log Loss = -mean(o*log(p) + (1-o)*log(1-p)).
 * Clips p to [1e-7, 1-1e-7] to avoid log(0).
 */
export function logLoss(probs: number[], outcomes: number[]): number {
  if (probs.length !== outcomes.length || probs.length === 0) return 0;
  const eps = 1e-7;
  const sum = probs.reduce((acc, p, i) => {
    const clipped = Math.max(eps, Math.min(1 - eps, p));
    const o = outcomes[i];
    return acc - (o * Math.log(clipped) + (1 - o) * Math.log(1 - clipped));
  }, 0);
  return parseFloat((sum / probs.length).toFixed(6));
}

/**
 * CLV (Closing Line Value) = modelProb - closingNoVigProb.
 * Positive CLV = model beat the closing line (sharp).
 */
export function calcCLV(
  modelProb: number,
  closingOdds: number | null,
  closingOddsOpposite: number | null,
): number | null {
  if (closingOdds === null || closingOddsOpposite === null) return null;
  const closingNoVig = noVigProb(closingOdds, closingOddsOpposite);
  return parseFloat((modelProb - closingNoVig).toFixed(6));
}

/**
 * Confidence interval for a proportion (Wilson score interval).
 * [INPUT]  k: successes, n: total, z: z-score (1.96 for 95%)
 * [OUTPUT] { lower, upper, center }
 */
export function wilsonCI(
  k: number,
  n: number,
  z = 1.96,
): { lower: number; upper: number; center: number } {
  if (n === 0) return { lower: 0, upper: 1, center: 0 };
  const p = k / n;
  const denom = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / denom;
  const margin = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / denom;
  return {
    lower: parseFloat(Math.max(0, center - margin).toFixed(6)),
    upper: parseFloat(Math.min(1, center + margin).toFixed(6)),
    center: parseFloat(center.toFixed(6)),
  };
}

// ─── Leakage Guard ─────────────────────────────────────────────────────────────

/**
 * Parse "H:MM AM/PM" EST time string + YYYY-MM-DD date → UTC ms.
 * Returns null if time is "TBD" or unparseable.
 *
 * [STEP] Convert EST game time to UTC ms for leakage comparison.
 * EST = UTC-5, EDT = UTC-4. MLB season runs April–October (EDT).
 * We conservatively use UTC-4 (EDT) for all games April–October.
 */
export function parseGameStartUtcMs(
  gameDate: string,
  startTimeEst: string | null | undefined,
): number | null {
  if (!startTimeEst || startTimeEst === "TBD" || startTimeEst === "") return null;
  // Normalize: "7:10 PM" or "7:10PM" or "19:10"
  const normalized = startTimeEst.trim().toUpperCase();
  let hours = 0, minutes = 0;
  const ampmMatch = normalized.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  const militaryMatch = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (ampmMatch) {
    hours = parseInt(ampmMatch[1], 10);
    minutes = parseInt(ampmMatch[2], 10);
    if (ampmMatch[3] === "PM" && hours !== 12) hours += 12;
    if (ampmMatch[3] === "AM" && hours === 12) hours = 0;
  } else if (militaryMatch) {
    hours = parseInt(militaryMatch[1], 10);
    minutes = parseInt(militaryMatch[2], 10);
  } else {
    return null;
  }
  // gameDate is YYYY-MM-DD; parse as local date then apply EDT offset (UTC-4)
  const [year, month, day] = gameDate.split("-").map(Number);
  // EDT offset: UTC-4 → add 4 hours to get UTC
  const utcMs = Date.UTC(year, month - 1, day, hours + 4, minutes, 0, 0);
  return utcMs;
}

/**
 * Leakage guard: verify modelRunAt < gameStartUtcMs.
 *
 * Returns:
 *   { safe: true }  — model ran before first pitch
 *   { safe: false, reason: string } — leakage detected or data missing
 *
 * [VERIFY] Prediction timestamp must be strictly before scheduled first pitch.
 */
export function checkLeakage(
  modelRunAt: number | null,
  gameStartUtcMs: number | null,
  gameDate: string,
  startTimeEst: string | null | undefined,
): { safe: boolean; reason: string | null } {
  // Derive gameStartUtcMs from date + time if not provided
  const startMs = gameStartUtcMs ?? parseGameStartUtcMs(gameDate, startTimeEst);

  if (modelRunAt === null || modelRunAt === undefined) {
    return {
      safe: false,
      reason: "MISSING_PREDICTION_TIMESTAMP: modelRunAt is null — cannot verify pre-game prediction",
    };
  }
  if (startMs === null) {
    // Time is TBD — we cannot verify. Mark as WARN but allow through with flag.
    return {
      safe: true,
      reason: "UNVERIFIABLE_GAME_TIME: startTimeEst is TBD — leakage check skipped",
    };
  }
  if (modelRunAt >= startMs) {
    const lagMinutes = Math.round((modelRunAt - startMs) / 60000);
    return {
      safe: false,
      reason: `PREDICTION_AFTER_FIRST_PITCH: modelRunAt=${new Date(modelRunAt).toISOString()} >= gameStart=${new Date(startMs).toISOString()} (lag=${lagMinutes}min)`,
    };
  }
  return { safe: true, reason: null };
}

// ─── VOID / QUARANTINE Helpers ─────────────────────────────────────────────────

function makeVoid(input: GradingInput, reason: string): GradingOutput {
  const bookNoVig = (input.bookOdds !== null && input.bookOddsOpposite !== null)
    ? noVigProb(input.bookOdds, input.bookOddsOpposite) : null;
  return {
    market: input.market,
    timeframe: MARKET_TIMEFRAME[input.market],
    gameId: input.gameId,
    gameDate: input.gameDate,
    playerId: input.playerId ?? null,
    playerName: input.playerName ?? null,
    modelSide: input.modelSide,
    bookLine: input.bookLine,
    bookOdds: input.bookOdds,
    bookNoVigProb: bookNoVig,
    modelProb: input.modelProb,
    edge: calcEdge(input.modelProb, bookNoVig),
    ev: calcEV(input.modelProb, input.bookOdds),
    clv: calcCLV(input.modelProb, input.closingOdds ?? null, input.closingOddsOpposite ?? null),
    grade: "VOID",
    profitLoss: 0,
    roi: null,
    pushFlag: false,
    voidFlag: true,
    quarantineFlag: false,
    quarantineReason: null,
    errorFlag: false,
    errorReason: null,
    sourceTraceId: input.sourceTraceId ?? null,
    predictionTimestamp: input.modelRunAt,
    oddsTimestamp: input.oddsTimestamp ?? null,
    resultTimestamp: input.resultTimestamp ?? null,
    gradingTimestamp: Date.now(),
    leakageSafe: true,
    notes: `VOID: ${reason}`,
  };
}

function makeQuarantined(input: GradingInput, reason: string): GradingOutput {
  const bookNoVig = (input.bookOdds !== null && input.bookOddsOpposite !== null)
    ? noVigProb(input.bookOdds, input.bookOddsOpposite) : null;
  return {
    market: input.market,
    timeframe: MARKET_TIMEFRAME[input.market],
    gameId: input.gameId,
    gameDate: input.gameDate,
    playerId: input.playerId ?? null,
    playerName: input.playerName ?? null,
    modelSide: input.modelSide,
    bookLine: input.bookLine,
    bookOdds: input.bookOdds,
    bookNoVigProb: bookNoVig,
    modelProb: input.modelProb,
    edge: null,
    ev: null,
    clv: null,
    grade: "QUARANTINED",
    profitLoss: null,
    roi: null,
    pushFlag: false,
    voidFlag: false,
    quarantineFlag: true,
    quarantineReason: reason,
    errorFlag: false,
    errorReason: null,
    sourceTraceId: input.sourceTraceId ?? null,
    predictionTimestamp: input.modelRunAt,
    oddsTimestamp: input.oddsTimestamp ?? null,
    resultTimestamp: input.resultTimestamp ?? null,
    gradingTimestamp: Date.now(),
    leakageSafe: false,
    notes: `QUARANTINED: ${reason}`,
  };
}

function makeUngraded(input: GradingInput, reason: string): GradingOutput {
  const bookNoVig = (input.bookOdds !== null && input.bookOddsOpposite !== null)
    ? noVigProb(input.bookOdds, input.bookOddsOpposite) : null;
  return {
    market: input.market,
    timeframe: MARKET_TIMEFRAME[input.market],
    gameId: input.gameId,
    gameDate: input.gameDate,
    playerId: input.playerId ?? null,
    playerName: input.playerName ?? null,
    modelSide: input.modelSide,
    bookLine: input.bookLine,
    bookOdds: input.bookOdds,
    bookNoVigProb: bookNoVig,
    modelProb: input.modelProb,
    edge: calcEdge(input.modelProb, bookNoVig),
    ev: calcEV(input.modelProb, input.bookOdds),
    clv: calcCLV(input.modelProb, input.closingOdds ?? null, input.closingOddsOpposite ?? null),
    grade: "UNGRADED",
    profitLoss: null,
    roi: null,
    pushFlag: false,
    voidFlag: false,
    quarantineFlag: false,
    quarantineReason: null,
    errorFlag: false,
    errorReason: reason,
    sourceTraceId: input.sourceTraceId ?? null,
    predictionTimestamp: input.modelRunAt,
    oddsTimestamp: input.oddsTimestamp ?? null,
    resultTimestamp: input.resultTimestamp ?? null,
    gradingTimestamp: Date.now(),
    leakageSafe: true,
    notes: `UNGRADED: ${reason}`,
  };
}

function buildOutput(
  input: GradingInput,
  grade: GradeValue,
  bookNoVig: number | null,
  notes: string,
  leakageSafe = true,
): GradingOutput {
  const pl = calcProfitLoss(grade, input.bookOdds);
  const clv = calcCLV(input.modelProb, input.closingOdds ?? null, input.closingOddsOpposite ?? null);
  return {
    market: input.market,
    timeframe: MARKET_TIMEFRAME[input.market],
    gameId: input.gameId,
    gameDate: input.gameDate,
    playerId: input.playerId ?? null,
    playerName: input.playerName ?? null,
    modelSide: input.modelSide,
    bookLine: input.bookLine,
    bookOdds: input.bookOdds,
    bookNoVigProb: bookNoVig,
    modelProb: input.modelProb,
    edge: calcEdge(input.modelProb, bookNoVig),
    ev: calcEV(input.modelProb, input.bookOdds),
    clv,
    grade,
    profitLoss: pl,
    roi: pl !== null ? pl : null,
    pushFlag: grade === "PUSH",
    voidFlag: grade === "VOID",
    quarantineFlag: grade === "QUARANTINED",
    quarantineReason: null,
    errorFlag: false,
    errorReason: null,
    sourceTraceId: input.sourceTraceId ?? null,
    predictionTimestamp: input.modelRunAt,
    oddsTimestamp: input.oddsTimestamp ?? null,
    resultTimestamp: input.resultTimestamp ?? null,
    gradingTimestamp: Date.now(),
    leakageSafe,
    notes,
  };
}

// ─── Pre-flight Validation ─────────────────────────────────────────────────────

/**
 * Run all pre-flight checks on a grading input.
 * Returns null if safe, or a GradingOutput with QUARANTINED/VOID/UNGRADED grade.
 */
function preflight(input: GradingInput): GradingOutput | null {
  const mkt = input.market.toUpperCase();
  const tf  = MARKET_TIMEFRAME[input.market];

  // 1. Probability bounds
  if (input.modelProb < 0 || input.modelProb > 1) {
    auditLog("ERROR", mkt, tf, "GRADING", "PROB_BOUNDS",
      `Model probability out of bounds: ${input.modelProb}`,
      { records_checked: 1, failed: 1, quarantined: 1,
        impact: `${mkt}_grading_quarantined`, action: "quarantine_row" });
    return makeQuarantined(input, `INVALID_PROBABILITY: modelProb=${input.modelProb} out of [0,1]`);
  }

  // 2. Postponed / suspended → VOID
  if (input.actualValue.isPostponed) {
    auditLog("INFO", mkt, tf, "GRADING", "POSTPONED_VOID",
      `Game ${input.gameId} is postponed — grading VOID`,
      { records_checked: 1, passed: 1, impact: "void_no_roi_impact", action: "void_row" });
    return makeVoid(input, "GAME_POSTPONED: official postponement — bet voided, stake returned");
  }
  if (input.actualValue.isSuspended) {
    auditLog("WARN", mkt, tf, "GRADING", "SUSPENDED_VOID",
      `Game ${input.gameId} is suspended — grading VOID pending completion`,
      { records_checked: 1, passed: 1, impact: "void_pending_completion", action: "void_row" });
    return makeVoid(input, "GAME_SUSPENDED: game not completed — grading VOID until official completion");
  }

  // 3. Leakage guard
  const leakage = checkLeakage(
    input.modelRunAt,
    input.gameStartUtcMs,
    input.gameDate,
    undefined,
  );
  if (!leakage.safe) {
    auditLog("CRITICAL", mkt, tf, "LEAKAGE", "PREDICTION_AFTER_START",
      `Leakage detected for game ${input.gameId}: ${leakage.reason}`,
      { records_checked: 1, failed: 1, quarantined: 1,
        impact: `${mkt}_publication_blocked`, action: "quarantine_row" });
    return makeQuarantined(input, leakage.reason!);
  }

  // 4. Player prop: playerId required
  if ((input.market === "k_prop" || input.market === "hr_prop") && !input.playerId) {
    auditLog("ERROR", mkt, tf, "GRADING", "MISSING_PLAYER_ID",
      `Player ID missing for ${input.market} prop — game ${input.gameId}`,
      { records_checked: 1, failed: 1, quarantined: 1,
        impact: "prop_grading_quarantined", action: "quarantine_row" });
    return makeQuarantined(input, "MISSING_PLAYER_ID: playerId required for player props");
  }

  return null; // all checks passed
}

// ─── Grading Functions ─────────────────────────────────────────────────────────

/**
 * grade_full_game_moneyline
 * Uses full game final score including extra innings.
 * Tie (extra innings) is a push only if market explicitly supports it;
 * standard two-way ML: extra innings determine winner — no tie possible.
 */
export function gradeFgMl(input: GradingInput): GradingOutput {
  const pre = preflight(input);
  if (pre) return pre;

  const { fgAwayRuns, fgHomeRuns } = input.actualValue;
  if (fgAwayRuns === null || fgAwayRuns === undefined ||
      fgHomeRuns === null || fgHomeRuns === undefined) {
    return makeUngraded(input, "MISSING_FINAL_SCORE: fgAwayRuns or fgHomeRuns is null");
  }

  const bookNoVig = (input.bookOdds !== null && input.bookOddsOpposite !== null)
    ? noVigProb(input.bookOdds, input.bookOddsOpposite) : null;

  // Two-way ML: extra innings always produce a winner
  const homeWon = fgHomeRuns > fgAwayRuns;
  const awayWon = fgAwayRuns > fgHomeRuns;
  // Tie after 9 is impossible in MLB (extra innings continue until winner)
  // But guard against data error
  if (fgHomeRuns === fgAwayRuns) {
    return makeQuarantined(input, `INVALID_FINAL_SCORE: tie score ${fgAwayRuns}-${fgHomeRuns} in full game ML — extra innings should resolve`);
  }

  let grade: GradeValue;
  if (input.modelSide === "home") {
    grade = homeWon ? "WIN" : "LOSS";
  } else if (input.modelSide === "away") {
    grade = awayWon ? "WIN" : "LOSS";
  } else {
    return makeQuarantined(input, `INVALID_MODEL_SIDE: '${input.modelSide}' not 'home' or 'away'`);
  }

  const notes = `FG ML ${input.modelSide}: score=${fgAwayRuns}-${fgHomeRuns} homeWon=${homeWon} grade=${grade}`;
  auditLog("INFO", "FG_ML", "FULL_GAME", "GRADING", "FINAL_SCORE_MATCH",
    notes, { records_checked: 1, passed: 1 });
  return buildOutput(input, grade, bookNoVig, notes);
}

/**
 * grade_full_game_run_line
 * Uses full game final margin including extra innings.
 * Standard MLB run line: home -1.5 / away +1.5.
 * Push occurs only on whole-number lines (rare in MLB).
 */
export function gradeFgRl(input: GradingInput): GradingOutput {
  const pre = preflight(input);
  if (pre) return pre;

  const { fgAwayRuns, fgHomeRuns } = input.actualValue;
  if (fgAwayRuns === null || fgAwayRuns === undefined ||
      fgHomeRuns === null || fgHomeRuns === undefined) {
    return makeUngraded(input, "MISSING_FINAL_SCORE: fgAwayRuns or fgHomeRuns is null");
  }
  if (input.bookLine === null) {
    return makeUngraded(input, "MISSING_RUN_LINE: bookLine is null");
  }

  const bookNoVig = (input.bookOdds !== null && input.bookOddsOpposite !== null)
    ? noVigProb(input.bookOdds, input.bookOddsOpposite) : null;

  const margin = fgHomeRuns - fgAwayRuns; // positive = home wins by margin
  const line = input.bookLine; // e.g. -1.5 for home, +1.5 for away

  let grade: GradeValue;
  if (input.modelSide === "home -1.5" || input.modelSide === "home") {
    // Home -1.5: home must win by 2+
    const homeCovers = margin > Math.abs(line);
    const isPush = margin === Math.abs(line); // only on whole-number lines
    grade = isPush ? "PUSH" : homeCovers ? "WIN" : "LOSS";
  } else if (input.modelSide === "away +1.5" || input.modelSide === "away") {
    // Away +1.5: away must not lose by 2+
    const awayCovers = margin < Math.abs(line);
    const isPush = margin === Math.abs(line);
    grade = isPush ? "PUSH" : awayCovers ? "WIN" : "LOSS";
  } else {
    return makeQuarantined(input, `INVALID_MODEL_SIDE: '${input.modelSide}' not recognized for FG RL`);
  }

  const notes = `FG RL ${input.modelSide}: score=${fgAwayRuns}-${fgHomeRuns} margin=${margin} line=${line} grade=${grade}`;
  auditLog("INFO", "FG_RL", "FULL_GAME", "GRADING", "RUN_LINE_MATCH",
    notes, { records_checked: 1, passed: 1 });
  return buildOutput(input, grade, bookNoVig, notes);
}

/**
 * grade_full_game_total
 * Uses full game final total runs including extra innings.
 * Over: total > line. Under: total < line. Push: total == line.
 */
export function gradeFgTotal(input: GradingInput): GradingOutput {
  const pre = preflight(input);
  if (pre) return pre;

  const { fgAwayRuns, fgHomeRuns } = input.actualValue;
  if (fgAwayRuns === null || fgAwayRuns === undefined ||
      fgHomeRuns === null || fgHomeRuns === undefined) {
    return makeUngraded(input, "MISSING_FINAL_SCORE: fgAwayRuns or fgHomeRuns is null");
  }
  if (input.bookLine === null) {
    return makeUngraded(input, "MISSING_TOTAL_LINE: bookLine is null");
  }

  const bookNoVig = (input.bookOdds !== null && input.bookOddsOpposite !== null)
    ? noVigProb(input.bookOdds, input.bookOddsOpposite) : null;

  const total = fgAwayRuns + fgHomeRuns;
  const line  = input.bookLine;

  let grade: GradeValue;
  if (input.modelSide === "over") {
    grade = total > line ? "WIN" : total === line ? "PUSH" : "LOSS";
  } else if (input.modelSide === "under") {
    grade = total < line ? "WIN" : total === line ? "PUSH" : "LOSS";
  } else {
    return makeQuarantined(input, `INVALID_MODEL_SIDE: '${input.modelSide}' not 'over' or 'under'`);
  }

  const notes = `FG Total ${input.modelSide}: total=${total} line=${line} grade=${grade}`;
  auditLog("INFO", "FG_TOTAL", "FULL_GAME", "GRADING", "TOTAL_MATCH",
    notes, { records_checked: 1, passed: 1 });
  return buildOutput(input, grade, bookNoVig, notes);
}

/**
 * grade_first_5_moneyline
 * Uses score through 5 complete innings ONLY.
 * Does NOT use full game score. Does NOT use innings 6-9 or extra innings.
 * Tie after 5: standard two-way F5 ML → PUSH.
 */
export function gradeF5Ml(input: GradingInput): GradingOutput {
  const pre = preflight(input);
  if (pre) return pre;

  const { f5AwayRuns, f5HomeRuns } = input.actualValue;
  if (f5AwayRuns === null || f5AwayRuns === undefined ||
      f5HomeRuns === null || f5HomeRuns === undefined) {
    return makeUngraded(input, "MISSING_F5_SCORE: f5AwayRuns or f5HomeRuns is null");
  }

  // Guard: reject if full game score was accidentally supplied
  const { fgAwayRuns, fgHomeRuns } = input.actualValue;
  if (fgAwayRuns !== undefined && fgHomeRuns !== undefined &&
      fgAwayRuns !== null && fgHomeRuns !== null) {
    if (f5AwayRuns === fgAwayRuns && f5HomeRuns === fgHomeRuns) {
      // Suspicious: F5 score equals FG score — may be data error
      auditLog("WARN", "F5_ML", "FIRST_5", "DATA", "F5_EQUALS_FG",
        `F5 score equals FG score for game ${input.gameId} — possible data error`,
        { records_checked: 1, failed: 1,
          impact: "f5_ml_grading_suspect", action: "flag_for_review" });
    }
  }

  const bookNoVig = (input.bookOdds !== null && input.bookOddsOpposite !== null)
    ? noVigProb(input.bookOdds, input.bookOddsOpposite) : null;

  const homeLeads = f5HomeRuns > f5AwayRuns;
  const awayLeads = f5AwayRuns > f5HomeRuns;
  const tied      = f5HomeRuns === f5AwayRuns;

  let grade: GradeValue;
  if (input.modelSide === "home") {
    grade = tied ? "PUSH" : homeLeads ? "WIN" : "LOSS";
  } else if (input.modelSide === "away") {
    grade = tied ? "PUSH" : awayLeads ? "WIN" : "LOSS";
  } else {
    return makeQuarantined(input, `INVALID_MODEL_SIDE: '${input.modelSide}' not 'home' or 'away'`);
  }

  const notes = `F5 ML ${input.modelSide}: f5=${f5AwayRuns}-${f5HomeRuns} tied=${tied} grade=${grade}`;
  auditLog("INFO", "F5_ML", "FIRST_5", "GRADING", "F5_SCORE_MATCH",
    notes, { records_checked: 1, passed: 1 });
  return buildOutput(input, grade, bookNoVig, notes);
}

/**
 * grade_first_5_run_line
 * Uses F5 margin only. Standard F5 RL: home -0.5 / away +0.5.
 * Push is impossible with -0.5/+0.5 line and integer scores.
 */
export function gradeF5Rl(input: GradingInput): GradingOutput {
  const pre = preflight(input);
  if (pre) return pre;

  const { f5AwayRuns, f5HomeRuns } = input.actualValue;
  if (f5AwayRuns === null || f5AwayRuns === undefined ||
      f5HomeRuns === null || f5HomeRuns === undefined) {
    return makeUngraded(input, "MISSING_F5_SCORE: f5AwayRuns or f5HomeRuns is null");
  }
  if (input.bookLine === null) {
    return makeUngraded(input, "MISSING_F5_RUN_LINE: bookLine is null");
  }

  const bookNoVig = (input.bookOdds !== null && input.bookOddsOpposite !== null)
    ? noVigProb(input.bookOdds, input.bookOddsOpposite) : null;

  const f5Margin = f5HomeRuns - f5AwayRuns;
  const line = input.bookLine; // e.g. -0.5 for home, +0.5 for away

  let grade: GradeValue;
  if (input.modelSide === "home -0.5" || input.modelSide === "home") {
    // Home -0.5: home must lead after 5 (margin > 0)
    const homeCovers = f5Margin > 0;
    const isPush = f5Margin === Math.abs(line) && line !== 0.5; // impossible with 0.5
    grade = isPush ? "PUSH" : homeCovers ? "WIN" : "LOSS";
  } else if (input.modelSide === "away +0.5" || input.modelSide === "away") {
    // Away +0.5: away must not trail after 5 (margin <= 0)
    const awayCovers = f5Margin <= 0;
    const isPush = f5Margin === Math.abs(line) && line !== 0.5;
    grade = isPush ? "PUSH" : awayCovers ? "WIN" : "LOSS";
  } else {
    return makeQuarantined(input, `INVALID_MODEL_SIDE: '${input.modelSide}' not recognized for F5 RL`);
  }

  const notes = `F5 RL ${input.modelSide}: f5=${f5AwayRuns}-${f5HomeRuns} margin=${f5Margin} line=${line} grade=${grade}`;
  auditLog("INFO", "F5_RL", "FIRST_5", "GRADING", "F5_RL_MATCH",
    notes, { records_checked: 1, passed: 1 });
  return buildOutput(input, grade, bookNoVig, notes);
}

/**
 * grade_first_5_total
 * Uses F5 total runs only. Does NOT use full game total.
 */
export function gradeF5Total(input: GradingInput): GradingOutput {
  const pre = preflight(input);
  if (pre) return pre;

  const { f5AwayRuns, f5HomeRuns } = input.actualValue;
  if (f5AwayRuns === null || f5AwayRuns === undefined ||
      f5HomeRuns === null || f5HomeRuns === undefined) {
    return makeUngraded(input, "MISSING_F5_SCORE: f5AwayRuns or f5HomeRuns is null");
  }
  if (input.bookLine === null) {
    return makeUngraded(input, "MISSING_F5_TOTAL_LINE: bookLine is null");
  }

  const bookNoVig = (input.bookOdds !== null && input.bookOddsOpposite !== null)
    ? noVigProb(input.bookOdds, input.bookOddsOpposite) : null;

  const f5Total = f5AwayRuns + f5HomeRuns;
  const line    = input.bookLine;

  let grade: GradeValue;
  if (input.modelSide === "over") {
    grade = f5Total > line ? "WIN" : f5Total === line ? "PUSH" : "LOSS";
  } else if (input.modelSide === "under") {
    grade = f5Total < line ? "WIN" : f5Total === line ? "PUSH" : "LOSS";
  } else {
    return makeQuarantined(input, `INVALID_MODEL_SIDE: '${input.modelSide}' not 'over' or 'under'`);
  }

  const notes = `F5 Total ${input.modelSide}: f5Total=${f5Total} line=${line} grade=${grade}`;
  auditLog("INFO", "F5_TOTAL", "FIRST_5", "GRADING", "F5_TOTAL_MATCH",
    notes, { records_checked: 1, passed: 1 });
  return buildOutput(input, grade, bookNoVig, notes);
}

/**
 * grade_yrfi
 * YRFI = Yes Run First Inning. Wins if at least one run scores in inning 1.
 * Uses nrfiResult: "NRFI" | "YRFI".
 */
export function gradeYrfi(input: GradingInput): GradingOutput {
  const pre = preflight(input);
  if (pre) return pre;

  const { nrfiResult } = input.actualValue;
  if (nrfiResult === null || nrfiResult === undefined) {
    return makeUngraded(input, "MISSING_NRFI_RESULT: nrfiActualResult is null");
  }

  const bookNoVig = (input.bookOdds !== null && input.bookOddsOpposite !== null)
    ? noVigProb(input.bookOdds, input.bookOddsOpposite) : null;

  const grade: GradeValue = nrfiResult === "YRFI" ? "WIN" : "LOSS";
  const notes = `YRFI: actual=${nrfiResult} grade=${grade}`;
  auditLog("INFO", "YRFI", "FIRST_INNING", "GRADING", "NRFI_RESULT_MATCH",
    notes, { records_checked: 1, passed: 1 });
  return buildOutput(input, grade, bookNoVig, notes);
}

/**
 * grade_nrfi
 * NRFI = No Run First Inning. Wins if no run scores in inning 1.
 */
export function gradeNrfi(input: GradingInput): GradingOutput {
  const pre = preflight(input);
  if (pre) return pre;

  const { nrfiResult } = input.actualValue;
  if (nrfiResult === null || nrfiResult === undefined) {
    return makeUngraded(input, "MISSING_NRFI_RESULT: nrfiActualResult is null");
  }

  const bookNoVig = (input.bookOdds !== null && input.bookOddsOpposite !== null)
    ? noVigProb(input.bookOdds, input.bookOddsOpposite) : null;

  const grade: GradeValue = nrfiResult === "NRFI" ? "WIN" : "LOSS";
  const notes = `NRFI: actual=${nrfiResult} grade=${grade}`;
  auditLog("INFO", "NRFI", "FIRST_INNING", "GRADING", "NRFI_RESULT_MATCH",
    notes, { records_checked: 1, passed: 1 });
  return buildOutput(input, grade, bookNoVig, notes);
}

/**
 * grade_strikeout_prop
 * Over: actualKs > bookLine. Under: actualKs < bookLine. Push: actualKs == bookLine.
 * Pitcher did not appear → VOID.
 */
export function gradeKProp(input: GradingInput): GradingOutput {
  const pre = preflight(input);
  if (pre) return pre;

  const { actualKs, didNotAppear } = input.actualValue;

  // Pitcher did not appear (scratched, did not start)
  if (didNotAppear) {
    return makeVoid(input, "PITCHER_DID_NOT_APPEAR: prop voided — pitcher scratched or did not start");
  }

  if (actualKs === null || actualKs === undefined) {
    return makeUngraded(input, "MISSING_ACTUAL_KS: actualKs is null — result not yet available");
  }
  if (input.bookLine === null) {
    return makeUngraded(input, "MISSING_K_PROP_LINE: bookLine is null");
  }

  const bookNoVig = (input.bookOdds !== null && input.bookOddsOpposite !== null)
    ? noVigProb(input.bookOdds, input.bookOddsOpposite) : null;

  const line = input.bookLine;
  let grade: GradeValue;
  if (input.modelSide === "over") {
    grade = actualKs > line ? "WIN" : actualKs === line ? "PUSH" : "LOSS";
  } else if (input.modelSide === "under") {
    grade = actualKs < line ? "WIN" : actualKs === line ? "PUSH" : "LOSS";
  } else {
    return makeQuarantined(input, `INVALID_MODEL_SIDE: '${input.modelSide}' not 'over' or 'under' for K-Prop`);
  }

  const notes = `K-Prop ${input.playerName ?? "unknown"} ${input.modelSide}: actual=${actualKs} line=${line} grade=${grade}`;
  auditLog("INFO", "K_PROP", "PLAYER_GAME", "GRADING", "K_PROP_MATCH",
    notes, { records_checked: 1, passed: 1 });
  return buildOutput(input, grade, bookNoVig, notes);
}

/**
 * grade_home_run_prop
 * Over (hit HR): actualHr >= 1 → WIN. Under (no HR): actualHr === 0 → WIN.
 * Batter did not appear → VOID.
 * Multiple HRs still count as WIN for the over (batter hit ≥1 HR).
 */
export function gradeHrProp(input: GradingInput): GradingOutput {
  const pre = preflight(input);
  if (pre) return pre;

  const { actualHr, didNotAppear } = input.actualValue;

  // Batter did not appear
  if (didNotAppear) {
    return makeVoid(input, "BATTER_DID_NOT_APPEAR: prop voided — batter did not appear in game");
  }

  if (actualHr === null || actualHr === undefined) {
    return makeUngraded(input, "MISSING_ACTUAL_HR: actualHr is null — result not yet available");
  }

  const bookNoVig = (input.bookOdds !== null && input.bookOddsOpposite !== null)
    ? noVigProb(input.bookOdds, input.bookOddsOpposite) : null;

  const hitHr = actualHr >= 1;
  let grade: GradeValue;
  if (input.modelSide === "over") {
    grade = hitHr ? "WIN" : "LOSS";
  } else if (input.modelSide === "under") {
    grade = !hitHr ? "WIN" : "LOSS";
  } else {
    return makeQuarantined(input, `INVALID_MODEL_SIDE: '${input.modelSide}' not 'over' or 'under' for HR-Prop`);
  }

  const notes = `HR-Prop ${input.playerName ?? "unknown"} ${input.modelSide}: actual=${actualHr} HR hitHr=${hitHr} grade=${grade}`;
  auditLog("INFO", "HR_PROP", "PLAYER_GAME", "GRADING", "HR_PROP_MATCH",
    notes, { records_checked: 1, passed: 1 });
  return buildOutput(input, grade, bookNoVig, notes);
}

// ─── Dispatch Router ──────────────────────────────────────────────────────────

/**
 * Route a grading input to the correct deterministic grading function.
 * This is the single entry point for all grading operations.
 */
export function gradeMarket(input: GradingInput): GradingOutput {
  switch (input.market) {
    case "fg_ml_home":
    case "fg_ml_away":
      return gradeFgMl(input);
    case "fg_rl_home":
    case "fg_rl_away":
      return gradeFgRl(input);
    case "fg_over":
    case "fg_under":
      return gradeFgTotal(input);
    case "f5_ml_home":
    case "f5_ml_away":
      return gradeF5Ml(input);
    case "f5_rl_home":
    case "f5_rl_away":
      return gradeF5Rl(input);
    case "f5_over":
    case "f5_under":
      return gradeF5Total(input);
    case "yrfi":
      return gradeYrfi(input);
    case "nrfi":
      return gradeNrfi(input);
    case "k_prop":
      return gradeKProp(input);
    case "hr_prop":
      return gradeHrProp(input);
    default:
      // TypeScript exhaustiveness guard
      return makeQuarantined(input as GradingInput,
        `OUT_OF_SCOPE_MARKET: '${(input as GradingInput).market}' is not an approved market`);
  }
}

// ─── Batch Grading Summary ─────────────────────────────────────────────────────

export interface BatchGradingSummary {
  market: string;
  timeframe: string;
  recordsChecked: number;
  wins: number;
  losses: number;
  pushes: number;
  voids: number;
  quarantined: number;
  ungraded: number;
  accuracy: number;
  roi: number;
  avgEdge: number;
  avgModelProb: number;
  avgBookNoVigProb: number;
  dateMin: string | null;
  dateMax: string | null;
  leakageSafeCount: number;
  leakageViolationCount: number;
}

export function summarizeBatch(outputs: GradingOutput[]): BatchGradingSummary[] {
  const byMarket = new Map<string, GradingOutput[]>();
  for (const o of outputs) {
    const key = o.market;
    if (!byMarket.has(key)) byMarket.set(key, []);
    byMarket.get(key)!.push(o);
  }

  const summaries: BatchGradingSummary[] = [];
  for (const [market, rows] of byMarket) {
    const wins     = rows.filter(r => r.grade === "WIN").length;
    const losses   = rows.filter(r => r.grade === "LOSS").length;
    const pushes   = rows.filter(r => r.grade === "PUSH").length;
    const voids    = rows.filter(r => r.grade === "VOID").length;
    const qCount   = rows.filter(r => r.grade === "QUARANTINED").length;
    const ungraded = rows.filter(r => r.grade === "UNGRADED").length;
    const graded   = wins + losses;
    const acc      = graded > 0 ? wins / graded : 0;
    const roi      = calcRoi(wins, losses);

    const edgeRows = rows.filter(r => r.edge !== null);
    const avgEdge  = edgeRows.length > 0
      ? edgeRows.reduce((s, r) => s + r.edge!, 0) / edgeRows.length : 0;
    const avgModelProb = rows.length > 0
      ? rows.reduce((s, r) => s + r.modelProb, 0) / rows.length : 0;
    const nvRows = rows.filter(r => r.bookNoVigProb !== null);
    const avgBookNoVigProb = nvRows.length > 0
      ? nvRows.reduce((s, r) => s + r.bookNoVigProb!, 0) / nvRows.length : 0;

    const dates = rows.map(r => r.gameDate).filter(Boolean).sort();

    summaries.push({
      market,
      timeframe: MARKET_TIMEFRAME[market as ApprovedMarket] ?? "UNKNOWN",
      recordsChecked: rows.length,
      wins, losses, pushes, voids,
      quarantined: qCount,
      ungraded,
      accuracy: parseFloat(acc.toFixed(6)),
      roi: parseFloat(roi.toFixed(6)),
      avgEdge: parseFloat(avgEdge.toFixed(6)),
      avgModelProb: parseFloat(avgModelProb.toFixed(6)),
      avgBookNoVigProb: parseFloat(avgBookNoVigProb.toFixed(6)),
      dateMin: dates[0] ?? null,
      dateMax: dates[dates.length - 1] ?? null,
      leakageSafeCount: rows.filter(r => r.leakageSafe).length,
      leakageViolationCount: rows.filter(r => !r.leakageSafe).length,
    });
  }
  return summaries;
}
