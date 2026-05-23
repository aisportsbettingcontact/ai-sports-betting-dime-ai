/**
 * ============================================================
 * FULL 2026 MLB SEASON BACKTEST RUNNER
 * ============================================================
 * Markets: fg_ml_home, fg_ml_away, fg_rl_home, fg_rl_away,
 *          fg_over, fg_under, f5_ml_home, f5_ml_away,
 *          f5_rl_home, f5_rl_away, f5_over, f5_under,
 *          nrfi, yrfi, k_prop, hr_prop
 * Date range: 2026-03-25 → 2026-05-22 (all 59 game dates)
 * Mode: UPSERT — safe to re-run; idempotent per (gameId, market)
 *
 * GRADING LOGIC (deterministic, zero-hallucination):
 * ─────────────────────────────────────────────────
 * VOID        → gameStatus IN ('postponed','suspended')
 * QUARANTINED → leakage detected (modelRunAt >= gameStartUtcMs)
 *               OR model prob is NULL for a market that requires it
 * MISSING_DATA→ actual score is NULL (game not yet final)
 * NO_ACTION   → model prob exists but edge below threshold OR
 *               book odds missing (cannot compute edge)
 * WIN/LOSS/PUSH → fully graded bet
 *
 * LEAKAGE GUARD:
 *   modelRunAt is a bigint epoch ms in the games table.
 *   gameStartUtcMs is derived from gameDate + startTimeEst.
 *   If modelRunAt >= gameStartUtcMs → QUARANTINED (look-ahead bias).
 *   If modelRunAt is NULL → leakageSafe = NULL (unknown, not quarantined).
 *
 * EDGE THRESHOLD: 0.0% (record ALL bets where model prob exists
 *   and book odds exist — let the analyst filter by edge post-hoc).
 *   NO_ACTION only when book odds are missing.
 *
 * UPSERT KEY: (gameId, market) — unique constraint.
 * ============================================================
 */

import { createConnection } from 'mysql2/promise';

// ─── CONSTANTS ────────────────────────────────────────────────
const SEASON_START = '2026-03-25';
const SEASON_END   = '2026-05-22';
const BACKTEST_VERSION = 'v2026-full-audit-1.0';
const BATCH_SIZE = 50; // rows per INSERT batch

// Market keys
const MARKETS = [
  'fg_ml_home','fg_ml_away',
  'fg_rl_home','fg_rl_away',
  'fg_over','fg_under',
  'f5_ml_home','f5_ml_away',
  'f5_rl_home','f5_rl_away',
  'f5_over','f5_under',
  'nrfi','yrfi',
  // k_prop and hr_prop handled separately via prop tables
];

// ─── MATH UTILITIES ───────────────────────────────────────────

/** American odds string → implied probability (no-vig not applied here, raw book prob) */
function oddsToProb(oddsStr) {
  if (oddsStr == null) return null;
  const o = parseFloat(String(oddsStr).replace(/[^0-9.\-+]/g, ''));
  if (isNaN(o)) return null;
  if (o > 0) return 100 / (o + 100);
  if (o < 0) return Math.abs(o) / (Math.abs(o) + 100);
  return null;
}

/** American odds string → decimal odds */
function oddsToDecimal(oddsStr) {
  if (oddsStr == null) return null;
  const o = parseFloat(String(oddsStr).replace(/[^0-9.\-+]/g, ''));
  if (isNaN(o)) return null;
  if (o > 0) return (o / 100) + 1;
  if (o < 0) return (100 / Math.abs(o)) + 1;
  return null;
}

/** No-vig probability from two-sided market */
function noVigProb(oddsA, oddsB) {
  const pA = oddsToProb(oddsA);
  const pB = oddsToProb(oddsB);
  if (pA == null || pB == null) return null;
  const total = pA + pB;
  if (total <= 0) return null;
  return pA / total;
}

/** Edge = modelProb - noVigBookProb */
function computeEdge(modelProb, bookOdds, oppositeOdds) {
  if (modelProb == null || bookOdds == null) return null;
  const nvp = oppositeOdds != null ? noVigProb(bookOdds, oppositeOdds) : oddsToProb(bookOdds);
  if (nvp == null) return null;
  return parseFloat((modelProb - nvp).toFixed(6));
}

/** EV = (modelProb * decimalOdds) - 1 */
function computeEV(modelProb, bookOdds) {
  if (modelProb == null || bookOdds == null) return null;
  const dec = oddsToDecimal(bookOdds);
  if (dec == null) return null;
  return parseFloat((modelProb * dec - 1).toFixed(6));
}

/** Profit/loss on $100 flat bet */
function computePL(result, bookOdds) {
  if (result === 'WIN') {
    const dec = oddsToDecimal(bookOdds);
    if (dec == null) return null;
    return parseFloat(((dec - 1) * 100).toFixed(2));
  }
  if (result === 'LOSS') return -100;
  if (result === 'PUSH') return 0;
  return null;
}

// ─── LEAKAGE GUARD ────────────────────────────────────────────

/**
 * Parse "7:05 PM ET" → UTC epoch ms for a given gameDate "YYYY-MM-DD"
 * Returns null if unparseable (treated as unknown, not quarantined).
 */
function parseGameStartUtcMs(gameDate, startTimeEst) {
  if (!startTimeEst || startTimeEst === 'TBD') return null;
  try {
    // Parse "7:05 PM ET" → hour/min/ampm
    const m = String(startTimeEst).match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!m) return null;
    let hour = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    const ampm = m[3].toUpperCase();
    if (ampm === 'PM' && hour !== 12) hour += 12;
    if (ampm === 'AM' && hour === 12) hour = 0;
    // ET = UTC-4 (EDT) or UTC-5 (EST). MLB season = EDT (UTC-4)
    const utcHour = hour + 4;
    const [y, mo, d] = gameDate.split('-').map(Number);
    const dt = new Date(Date.UTC(y, mo - 1, d, utcHour, min, 0, 0));
    return dt.getTime();
  } catch {
    return null;
  }
}

/**
 * Returns: 'SAFE' | 'LEAKED' | 'UNKNOWN'
 */
function checkLeakage(modelRunAt, gameStartUtcMs) {
  if (modelRunAt == null || gameStartUtcMs == null) return 'UNKNOWN';
  // modelRunAt is epoch ms (bigint from DB)
  const mra = typeof modelRunAt === 'bigint' ? Number(modelRunAt) : Number(modelRunAt);
  return mra >= gameStartUtcMs ? 'LEAKED' : 'SAFE';
}

// ─── GRADING FUNCTIONS ────────────────────────────────────────

/**
 * Grade FG ML (full-game moneyline)
 * Actual winner: actualAwayScore vs actualHomeScore (includes extra innings)
 */
function gradeFgMl(side, row) {
  const { actualAwayScore, actualHomeScore } = row;
  if (actualAwayScore == null || actualHomeScore == null) return 'MISSING_DATA';
  if (actualAwayScore === actualHomeScore) return 'PUSH'; // tie (rare in MLB)
  const awayWon = actualAwayScore > actualHomeScore;
  if (side === 'away') return awayWon ? 'WIN' : 'LOSS';
  if (side === 'home') return awayWon ? 'LOSS' : 'WIN';
  return 'MISSING_DATA';
}

/**
 * Grade FG RL (full-game run line, standard -1.5/+1.5)
 * Uses actualAwayScore vs actualHomeScore
 */
function gradeFgRl(side, row) {
  const { actualAwayScore, actualHomeScore, awayRunLine, homeRunLine } = row;
  if (actualAwayScore == null || actualHomeScore == null) return 'MISSING_DATA';
  // Determine the run line for this side
  const rl = side === 'away'
    ? parseFloat(String(awayRunLine ?? '-1.5'))
    : parseFloat(String(homeRunLine ?? '+1.5'));
  const margin = side === 'away'
    ? actualAwayScore - actualHomeScore + rl
    : actualHomeScore - actualAwayScore + rl;
  if (margin > 0) return 'WIN';
  if (margin < 0) return 'LOSS';
  return 'PUSH';
}

/**
 * Grade FG Total (over/under)
 * Uses actualFgTotal if populated, else actualAwayScore + actualHomeScore
 */
function gradeFgTotal(direction, row) {
  const { actualAwayScore, actualHomeScore, actualFgTotal, bookTotal } = row;
  const total = actualFgTotal != null
    ? parseFloat(actualFgTotal)
    : (actualAwayScore != null && actualHomeScore != null ? actualAwayScore + actualHomeScore : null);
  if (total == null) return 'MISSING_DATA';
  const line = parseFloat(String(bookTotal ?? '0'));
  if (line === 0) return 'MISSING_DATA';
  if (direction === 'over') {
    if (total > line) return 'WIN';
    if (total < line) return 'LOSS';
    return 'PUSH';
  }
  if (direction === 'under') {
    if (total < line) return 'WIN';
    if (total > line) return 'LOSS';
    return 'PUSH';
  }
  return 'MISSING_DATA';
}

/**
 * Grade F5 ML (first-5-innings moneyline)
 */
function gradeF5Ml(side, row) {
  const { actualF5AwayScore, actualF5HomeScore } = row;
  if (actualF5AwayScore == null || actualF5HomeScore == null) return 'MISSING_DATA';
  if (actualF5AwayScore === actualF5HomeScore) return 'PUSH';
  const awayWon = actualF5AwayScore > actualF5HomeScore;
  if (side === 'away') return awayWon ? 'WIN' : 'LOSS';
  if (side === 'home') return awayWon ? 'LOSS' : 'WIN';
  return 'MISSING_DATA';
}

/**
 * Grade F5 RL (first-5-innings run line, standard -0.5/+0.5)
 */
function gradeF5Rl(side, row) {
  const { actualF5AwayScore, actualF5HomeScore, f5AwayRunLine, f5HomeRunLine } = row;
  if (actualF5AwayScore == null || actualF5HomeScore == null) return 'MISSING_DATA';
  const rl = side === 'away'
    ? parseFloat(String(f5AwayRunLine ?? '-0.5'))
    : parseFloat(String(f5HomeRunLine ?? '+0.5'));
  const margin = side === 'away'
    ? actualF5AwayScore - actualF5HomeScore + rl
    : actualF5HomeScore - actualF5AwayScore + rl;
  if (margin > 0) return 'WIN';
  if (margin < 0) return 'LOSS';
  return 'PUSH';
}

/**
 * Grade F5 Total (over/under)
 */
function gradeF5Total(direction, row) {
  const { actualF5AwayScore, actualF5HomeScore, actualF5Total, f5Total } = row;
  const total = actualF5Total != null
    ? parseFloat(actualF5Total)
    : (actualF5AwayScore != null && actualF5HomeScore != null ? actualF5AwayScore + actualF5HomeScore : null);
  if (total == null) return 'MISSING_DATA';
  const line = parseFloat(String(f5Total ?? '0'));
  if (line === 0) return 'MISSING_DATA';
  if (direction === 'over') {
    if (total > line) return 'WIN';
    if (total < line) return 'LOSS';
    return 'PUSH';
  }
  if (direction === 'under') {
    if (total < line) return 'WIN';
    if (total > line) return 'LOSS';
    return 'PUSH';
  }
  return 'MISSING_DATA';
}

/**
 * Grade NRFI (no run first inning)
 * nrfiActualResult: 'NRFI' | 'YRFI'
 * actualNrfiBinary: 1=NRFI, 0=YRFI
 */
function gradeNrfi(side, row) {
  // side: 'nrfi' or 'yrfi'
  const actual = row.nrfiActualResult ?? (row.actualNrfiBinary != null ? (row.actualNrfiBinary === 1 ? 'NRFI' : 'YRFI') : null);
  if (actual == null) return 'MISSING_DATA';
  const isNrfi = actual === 'NRFI' || actual === '1' || actual === 1;
  if (side === 'nrfi') return isNrfi ? 'WIN' : 'LOSS';
  if (side === 'yrfi') return isNrfi ? 'LOSS' : 'WIN';
  return 'MISSING_DATA';
}

// ─── MARKET ROUTER ────────────────────────────────────────────

/**
 * For a given market key and game row, returns:
 * { modelProb, bookOdds, oppositeOdds, bookLine, gradeFn, side }
 */
function getMarketConfig(market, row) {
  switch (market) {
    case 'fg_ml_home':
      return {
        modelProb: row.modelHomeWinPct != null ? parseFloat(row.modelHomeWinPct) / 100 : null,
        bookOdds: row.homeML,
        oppositeOdds: row.awayML,
        bookLine: 'ML',
        gradeFn: () => gradeFgMl('home', row),
      };
    case 'fg_ml_away':
      return {
        modelProb: row.modelAwayWinPct != null ? parseFloat(row.modelAwayWinPct) / 100 : null,
        bookOdds: row.awayML,
        oppositeOdds: row.homeML,
        bookLine: 'ML',
        gradeFn: () => gradeFgMl('away', row),
      };
    case 'fg_rl_home':
      return {
        modelProb: row.modelHomePLCoverPct != null ? parseFloat(row.modelHomePLCoverPct) / 100 : null,
        bookOdds: row.homeRunLineOdds,
        oppositeOdds: row.awayRunLineOdds,
        bookLine: row.homeRunLine ?? '+1.5',
        gradeFn: () => gradeFgRl('home', row),
      };
    case 'fg_rl_away':
      return {
        modelProb: row.modelAwayPLCoverPct != null ? parseFloat(row.modelAwayPLCoverPct) / 100 : null,
        bookOdds: row.awayRunLineOdds,
        oppositeOdds: row.homeRunLineOdds,
        bookLine: row.awayRunLine ?? '-1.5',
        gradeFn: () => gradeFgRl('away', row),
      };
    case 'fg_over':
      return {
        modelProb: row.modelOverRate != null ? parseFloat(row.modelOverRate) / 100 : null,
        bookOdds: row.overOdds,
        oppositeOdds: row.underOdds,
        bookLine: row.bookTotal != null ? `O${row.bookTotal}` : null,
        gradeFn: () => gradeFgTotal('over', row),
      };
    case 'fg_under':
      return {
        modelProb: row.modelUnderRate != null ? parseFloat(row.modelUnderRate) / 100 : null,
        bookOdds: row.underOdds,
        oppositeOdds: row.overOdds,
        bookLine: row.bookTotal != null ? `U${row.bookTotal}` : null,
        gradeFn: () => gradeFgTotal('under', row),
      };
    case 'f5_ml_home':
      return {
        modelProb: row.modelF5HomeWinPct != null ? parseFloat(row.modelF5HomeWinPct) / 100 : null,
        bookOdds: row.f5HomeML,
        oppositeOdds: row.f5AwayML,
        bookLine: 'F5 ML',
        gradeFn: () => gradeF5Ml('home', row),
      };
    case 'f5_ml_away':
      return {
        modelProb: row.modelF5AwayWinPct != null ? parseFloat(row.modelF5AwayWinPct) / 100 : null,
        bookOdds: row.f5AwayML,
        oppositeOdds: row.f5HomeML,
        bookLine: 'F5 ML',
        gradeFn: () => gradeF5Ml('away', row),
      };
    case 'f5_rl_home':
      return {
        modelProb: row.modelF5HomeRLCoverPct != null ? parseFloat(row.modelF5HomeRLCoverPct) / 100 : null,
        bookOdds: row.f5HomeRunLineOdds,
        oppositeOdds: row.f5AwayRunLineOdds,
        bookLine: row.f5HomeRunLine ?? '+0.5',
        gradeFn: () => gradeF5Rl('home', row),
      };
    case 'f5_rl_away':
      return {
        modelProb: row.modelF5AwayRLCoverPct != null ? parseFloat(row.modelF5AwayRLCoverPct) / 100 : null,
        bookOdds: row.f5AwayRunLineOdds,
        oppositeOdds: row.f5HomeRunLineOdds,
        bookLine: row.f5AwayRunLine ?? '-0.5',
        gradeFn: () => gradeF5Rl('away', row),
      };
    case 'f5_over':
      return {
        modelProb: row.modelF5OverRate != null ? parseFloat(row.modelF5OverRate) / 100 : null,
        bookOdds: row.f5OverOdds,
        oppositeOdds: row.f5UnderOdds,
        bookLine: row.f5Total != null ? `F5 O${row.f5Total}` : null,
        gradeFn: () => gradeF5Total('over', row),
      };
    case 'f5_under':
      return {
        modelProb: row.modelF5UnderRate != null ? parseFloat(row.modelF5UnderRate) / 100 : null,
        bookOdds: row.f5UnderOdds,
        oppositeOdds: row.f5OverOdds,
        bookLine: row.f5Total != null ? `F5 U${row.f5Total}` : null,
        gradeFn: () => gradeF5Total('under', row),
      };
    case 'nrfi':
      return {
        modelProb: row.modelPNrfi != null ? parseFloat(row.modelPNrfi) / 100 : null,
        bookOdds: row.nrfiOverOdds,
        oppositeOdds: row.yrfiUnderOdds,
        bookLine: 'NRFI',
        gradeFn: () => gradeNrfi('nrfi', row),
      };
    case 'yrfi':
      return {
        // YRFI prob = 1 - NRFI prob
        modelProb: row.modelPNrfi != null ? parseFloat((1 - parseFloat(row.modelPNrfi) / 100).toFixed(6)) : null,
        bookOdds: row.yrfiUnderOdds,
        oppositeOdds: row.nrfiOverOdds,
        bookLine: 'YRFI',
        gradeFn: () => gradeNrfi('yrfi', row),
      };
    default:
      return null;
  }
}

// ─── DETERMINE RESULT STATE ───────────────────────────────────

/**
 * Full result determination pipeline for one (game, market) pair.
 * Returns a complete backtest row object ready for INSERT/UPSERT.
 */
function evaluateMarket(market, row, leakageStatus) {
  const now = Date.now();

  // Base fields
  const base = {
    gameId: row.id,
    gameDate: row.gameDate,
    market,
    homeTeam: row.homeTeam,
    awayTeam: row.awayTeam,
    homePitcher: row.homeStartingPitcher ?? null,
    awayPitcher: row.awayStartingPitcher ?? null,
    gameTime: row.startTimeEst ?? null,
    dayNight: row.startTimeEst ? (parseInt(row.startTimeEst) >= 18 || row.startTimeEst.includes('PM') ? 'N' : 'D') : null,
    isDoubleheader: row.doubleHeader === 'Y' ? 1 : 0,
    gameNumber: row.gameNumber ?? 1,
    modelRunAt: row.modelRunAt != null ? Number(row.modelRunAt) : null,
    gameStartUtcMs: parseGameStartUtcMs(row.gameDate, row.startTimeEst),
    leakageSafe: leakageStatus === 'SAFE' ? 1 : leakageStatus === 'LEAKED' ? 0 : null,
    auditVersion: BACKTEST_VERSION,
    backtestRunAt: now,
  };

  // VOID: postponed or suspended
  if (row.gameStatus === 'postponed' || row.gameStatus === 'suspended') {
    return {
      ...base,
      modelSide: null,
      modelProb: null,
      bookLine: null,
      bookOdds: null,
      bookNoVigProb: null,
      bookOddsOpposite: null,
      edge: null,
      ev: null,
      confidencePassed: 0,
      result: 'VOID',
      correct: null,
      actualAwayScore: null,
      actualHomeScore: null,
      closingOdds: null,
      closingOddsOpposite: null,
      clv: null,
      profitLoss: null,
      quarantineReason: null,
      voidReason: `gameStatus=${row.gameStatus}`,
    };
  }

  // QUARANTINED: leakage detected
  if (leakageStatus === 'LEAKED') {
    const cfg = getMarketConfig(market, row);
    return {
      ...base,
      modelSide: market,
      modelProb: cfg?.modelProb ?? null,
      bookLine: cfg?.bookLine ?? null,
      bookOdds: cfg?.bookOdds ?? null,
      bookNoVigProb: cfg ? noVigProb(cfg.bookOdds, cfg.oppositeOdds) : null,
      bookOddsOpposite: cfg?.oppositeOdds ?? null,
      edge: null,
      ev: null,
      confidencePassed: 0,
      result: 'QUARANTINED',
      correct: null,
      actualAwayScore: row.actualAwayScore ?? null,
      actualHomeScore: row.actualHomeScore ?? null,
      closingOdds: null,
      closingOddsOpposite: null,
      clv: null,
      profitLoss: null,
      quarantineReason: `modelRunAt=${base.modelRunAt} >= gameStartUtcMs=${base.gameStartUtcMs}`,
      voidReason: null,
    };
  }

  // Get market config
  const cfg = getMarketConfig(market, row);
  if (!cfg) {
    return {
      ...base,
      result: 'MISSING_DATA',
      quarantineReason: `unknown market: ${market}`,
      voidReason: null,
      modelSide: market, modelProb: null, bookLine: null, bookOdds: null,
      bookNoVigProb: null, bookOddsOpposite: null, edge: null, ev: null,
      confidencePassed: 0, correct: null, actualAwayScore: null, actualHomeScore: null,
      closingOdds: null, closingOddsOpposite: null, clv: null, profitLoss: null,
    };
  }

  const { modelProb, bookOdds, oppositeOdds, bookLine, gradeFn } = cfg;
  const bookNoVigProb = noVigProb(bookOdds, oppositeOdds);
  const edge = computeEdge(modelProb, bookOdds, oppositeOdds);
  const ev = computeEV(modelProb, bookOdds);

  // NO_ACTION: model prob is null (model didn't run for this market)
  // or book odds are null (can't compute edge, can't grade)
  if (modelProb == null) {
    return {
      ...base,
      modelSide: market,
      modelProb: null,
      bookLine,
      bookOdds,
      bookNoVigProb,
      bookOddsOpposite: oppositeOdds,
      edge: null,
      ev: null,
      confidencePassed: 0,
      result: 'NO_ACTION',
      correct: null,
      actualAwayScore: row.actualAwayScore ?? null,
      actualHomeScore: row.actualHomeScore ?? null,
      closingOdds: null,
      closingOddsOpposite: null,
      clv: null,
      profitLoss: null,
      quarantineReason: 'modelProb=null',
      voidReason: null,
    };
  }

  // NO_ACTION: book odds missing (can't grade or compute edge)
  if (bookOdds == null) {
    return {
      ...base,
      modelSide: market,
      modelProb,
      bookLine,
      bookOdds: null,
      bookNoVigProb: null,
      bookOddsOpposite: null,
      edge: null,
      ev: null,
      confidencePassed: 0,
      result: 'NO_ACTION',
      correct: null,
      actualAwayScore: row.actualAwayScore ?? null,
      actualHomeScore: row.actualHomeScore ?? null,
      closingOdds: null,
      closingOddsOpposite: null,
      clv: null,
      profitLoss: null,
      quarantineReason: 'bookOdds=null',
      voidReason: null,
    };
  }

  // Grade the bet
  const rawResult = gradeFn();

  // MISSING_DATA: game not yet final or actual score missing
  if (rawResult === 'MISSING_DATA') {
    return {
      ...base,
      modelSide: market,
      modelProb,
      bookLine,
      bookOdds,
      bookNoVigProb,
      bookOddsOpposite: oppositeOdds,
      edge,
      ev,
      confidencePassed: edge != null && edge > 0 ? 1 : 0,
      result: 'MISSING_DATA',
      correct: null,
      actualAwayScore: row.actualAwayScore ?? null,
      actualHomeScore: row.actualHomeScore ?? null,
      closingOdds: null,
      closingOddsOpposite: null,
      clv: null,
      profitLoss: null,
      quarantineReason: 'actual score missing',
      voidReason: null,
    };
  }

  // WIN / LOSS / PUSH
  const correct = rawResult === 'WIN' ? 1 : rawResult === 'LOSS' ? 0 : null;
  const profitLoss = computePL(rawResult, bookOdds);

  return {
    ...base,
    modelSide: market,
    modelProb,
    bookLine,
    bookOdds,
    bookNoVigProb,
    bookOddsOpposite: oppositeOdds,
    edge,
    ev,
    confidencePassed: edge != null && edge > 0 ? 1 : 0,
    result: rawResult,
    correct,
    actualAwayScore: row.actualAwayScore ?? null,
    actualHomeScore: row.actualHomeScore ?? null,
    closingOdds: null,
    closingOddsOpposite: null,
    clv: null,
    profitLoss,
    quarantineReason: null,
    voidReason: null,
  };
}

// ─── UPSERT HELPER ────────────────────────────────────────────

const UPSERT_COLS = [
  'gameId','gameDate','market','modelSide','modelProb','bookLine','bookOdds',
  'bookNoVigProb','bookOddsOpposite','edge','ev','confidencePassed','result',
  'correct','actualAwayScore','actualHomeScore','backtestRunAt',
  'homeTeam','awayTeam','homePitcher','awayPitcher','gameTime','dayNight',
  'isDoubleheader','gameNumber','modelRunAt','leakageSafe',
  'quarantineReason','voidReason','closingOdds','closingOddsOpposite','clv',
  'profitLoss','auditVersion',
];

async function upsertBatch(conn, rows) {
  if (rows.length === 0) return;
  const placeholders = rows.map(() => `(${UPSERT_COLS.map(() => '?').join(',')})`).join(',');
  const values = rows.flatMap(r => UPSERT_COLS.map(c => {
    const v = r[c];
    return v === undefined ? null : v;
  }));
  const updateSet = UPSERT_COLS
    .filter(c => !['gameId','market'].includes(c))
    .map(c => `${c} = VALUES(${c})`)
    .join(', ');
  const sql = `INSERT INTO mlb_game_backtest (${UPSERT_COLS.join(',')}) VALUES ${placeholders}
    ON DUPLICATE KEY UPDATE ${updateSet}`;
  await conn.query(sql, values);
}

// ─── MAIN RUNNER ──────────────────────────────────────────────

async function main() {
  const conn = await createConnection(process.env.DATABASE_URL);
  console.log(`[INPUT] Connected to DB`);
  console.log(`[INPUT] Season window: ${SEASON_START} → ${SEASON_END}`);
  console.log(`[INPUT] Markets: ${MARKETS.join(', ')}`);
  console.log(`[INPUT] Audit version: ${BACKTEST_VERSION}`);

  // Fetch ALL MLB games in the season window
  console.log(`\n[STEP] Fetching all MLB games for ${SEASON_START} → ${SEASON_END}`);
  const [games] = await conn.query(`
    SELECT
      id, gameDate, startTimeEst, awayTeam, homeTeam,
      awayStartingPitcher, homeStartingPitcher,
      doubleHeader, gameNumber, gameStatus, mlbGamePk,
      -- Scores
      awayScore, homeScore, actualAwayScore, actualHomeScore,
      actualF5AwayScore, actualF5HomeScore,
      actualFgTotal, actualF5Total, actualNrfiBinary,
      -- FG odds
      awayML, homeML, bookTotal, overOdds, underOdds,
      awayRunLine, homeRunLine, awayRunLineOdds, homeRunLineOdds,
      -- F5 odds
      f5AwayML, f5HomeML, f5Total, f5OverOdds, f5UnderOdds,
      f5AwayRunLine, f5HomeRunLine, f5AwayRunLineOdds, f5HomeRunLineOdds,
      -- NRFI/YRFI odds and result
      nrfiOverOdds, yrfiUnderOdds, nrfiActualResult,
      -- Model probabilities
      modelHomeWinPct, modelAwayWinPct,
      modelOverRate, modelUnderRate,
      modelHomePLCoverPct, modelAwayPLCoverPct,
      modelF5HomeWinPct, modelF5AwayWinPct,
      modelF5OverRate, modelF5UnderRate,
      modelF5HomeRLCoverPct, modelF5AwayRLCoverPct,
      modelPNrfi,
      -- Leakage
      modelRunAt
    FROM games
    WHERE gameDate >= ? AND gameDate <= ? AND sport = 'MLB'
    ORDER BY gameDate ASC, id ASC
  `, [SEASON_START, SEASON_END]);

  console.log(`[STATE] Total games fetched: ${games.length}`);

  // Tally by date
  const byDate = {};
  for (const g of games) {
    byDate[g.gameDate] = (byDate[g.gameDate] || 0) + 1;
  }
  console.log(`[STATE] Unique dates: ${Object.keys(byDate).length}`);
  console.log(`[STATE] Date distribution:`);
  for (const [d, cnt] of Object.entries(byDate)) {
    console.log(`  ${d}: ${cnt} games`);
  }

  // Process each game × each market
  let totalRows = 0;
  let totalWin = 0, totalLoss = 0, totalPush = 0;
  let totalVoid = 0, totalQuarantined = 0, totalNoAction = 0, totalMissing = 0;
  let leakCount = 0, leakUnknown = 0, leakSafe = 0;

  const batch = [];
  const flushBatch = async () => {
    if (batch.length === 0) return;
    await upsertBatch(conn, [...batch]);
    batch.length = 0;
  };

  console.log(`\n[STEP] Processing ${games.length} games × ${MARKETS.length} markets = ${games.length * MARKETS.length} evaluations`);

  for (let gi = 0; gi < games.length; gi++) {
    const row = games[gi];
    const gameStartUtcMs = parseGameStartUtcMs(row.gameDate, row.startTimeEst);
    const leakageStatus = checkLeakage(row.modelRunAt, gameStartUtcMs);

    if (leakageStatus === 'LEAKED') leakCount++;
    else if (leakageStatus === 'UNKNOWN') leakUnknown++;
    else leakSafe++;

    for (const market of MARKETS) {
      const btRow = evaluateMarket(market, row, leakageStatus);

      // Tally
      switch (btRow.result) {
        case 'WIN':          totalWin++; break;
        case 'LOSS':         totalLoss++; break;
        case 'PUSH':         totalPush++; break;
        case 'VOID':         totalVoid++; break;
        case 'QUARANTINED':  totalQuarantined++; break;
        case 'NO_ACTION':    totalNoAction++; break;
        case 'MISSING_DATA': totalMissing++; break;
      }
      totalRows++;

      batch.push(btRow);
      if (batch.length >= BATCH_SIZE) await flushBatch();
    }

    // Progress log every 100 games
    if ((gi + 1) % 100 === 0 || gi === games.length - 1) {
      console.log(`[STATE] Processed ${gi + 1}/${games.length} games | rows=${totalRows} | W=${totalWin} L=${totalLoss} P=${totalPush} VOID=${totalVoid} QUAR=${totalQuarantined} NO_ACT=${totalNoAction} MISS=${totalMissing}`);
    }
  }

  await flushBatch();

  // ─── FINAL SUMMARY ────────────────────────────────────────
  console.log(`\n${'='.repeat(70)}`);
  console.log(`[OUTPUT] FULL SEASON BACKTEST COMPLETE`);
  console.log(`${'='.repeat(70)}`);
  console.log(`[OUTPUT] Total rows upserted:   ${totalRows}`);
  console.log(`[OUTPUT] WIN:                   ${totalWin}`);
  console.log(`[OUTPUT] LOSS:                  ${totalLoss}`);
  console.log(`[OUTPUT] PUSH:                  ${totalPush}`);
  console.log(`[OUTPUT] VOID:                  ${totalVoid}`);
  console.log(`[OUTPUT] QUARANTINED:           ${totalQuarantined}`);
  console.log(`[OUTPUT] NO_ACTION:             ${totalNoAction}`);
  console.log(`[OUTPUT] MISSING_DATA:          ${totalMissing}`);
  console.log(`[OUTPUT] Leakage SAFE:          ${leakSafe} games`);
  console.log(`[OUTPUT] Leakage LEAKED:        ${leakCount} games`);
  console.log(`[OUTPUT] Leakage UNKNOWN:       ${leakUnknown} games`);

  const graded = totalWin + totalLoss + totalPush;
  const accuracy = graded > 0 ? ((totalWin / (totalWin + totalLoss)) * 100).toFixed(2) : 'N/A';
  console.log(`[OUTPUT] Graded rows (W+L+P):   ${graded}`);
  console.log(`[OUTPUT] Win rate (W/W+L):      ${accuracy}%`);

  // Per-market summary from DB
  console.log(`\n[STEP] Per-market summary from DB`);
  const [mktSummary] = await conn.query(`
    SELECT
      market,
      COUNT(*) AS total,
      SUM(CASE WHEN result='WIN' THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN result='LOSS' THEN 1 ELSE 0 END) AS losses,
      SUM(CASE WHEN result='PUSH' THEN 1 ELSE 0 END) AS pushes,
      SUM(CASE WHEN result='VOID' THEN 1 ELSE 0 END) AS voids,
      SUM(CASE WHEN result='QUARANTINED' THEN 1 ELSE 0 END) AS quarantined,
      SUM(CASE WHEN result='NO_ACTION' THEN 1 ELSE 0 END) AS no_action,
      SUM(CASE WHEN result='MISSING_DATA' THEN 1 ELSE 0 END) AS missing,
      MIN(gameDate) AS date_min,
      MAX(gameDate) AS date_max
    FROM mlb_game_backtest
    WHERE gameDate >= ? AND gameDate <= ?
    GROUP BY market
    ORDER BY market
  `, [SEASON_START, SEASON_END]);

  console.log(`\n[OUTPUT] Per-market results:`);
  console.log(`${'Market'.padEnd(18)} | ${'Total'.padStart(6)} | ${'W'.padStart(5)} | ${'L'.padStart(5)} | ${'P'.padStart(4)} | ${'VOID'.padStart(4)} | ${'QUAR'.padStart(4)} | ${'NO_ACT'.padStart(6)} | ${'MISS'.padStart(4)} | ${'Win%'.padStart(6)} | DateMin → DateMax`);
  console.log('-'.repeat(130));
  for (const r of mktSummary) {
    const wl = Number(r.wins) + Number(r.losses);
    const winPct = wl > 0 ? ((Number(r.wins) / wl) * 100).toFixed(1) + '%' : 'N/A';
    console.log(
      `${String(r.market).padEnd(18)} | ${String(r.total).padStart(6)} | ${String(r.wins).padStart(5)} | ${String(r.losses).padStart(5)} | ${String(r.pushes).padStart(4)} | ${String(r.voids).padStart(4)} | ${String(r.quarantined).padStart(4)} | ${String(r.no_action).padStart(6)} | ${String(r.missing).padStart(4)} | ${winPct.padStart(6)} | ${r.date_min} → ${r.date_max}`
    );
  }

  // Date coverage check
  console.log(`\n[STEP] Date coverage verification`);
  const [dateCoverage] = await conn.query(`
    SELECT DISTINCT gameDate FROM mlb_game_backtest
    WHERE gameDate >= ? AND gameDate <= ?
    ORDER BY gameDate ASC
  `, [SEASON_START, SEASON_END]);
  console.log(`[OUTPUT] Backtest covers ${dateCoverage.length} unique dates`);
  const coveredSet = new Set(dateCoverage.map(r => r.gameDate));
  const [allDates] = await conn.query(`
    SELECT DISTINCT gameDate FROM games
    WHERE gameDate >= ? AND gameDate <= ? AND sport = 'MLB'
    ORDER BY gameDate ASC
  `, [SEASON_START, SEASON_END]);
  const stillMissing = allDates.filter(r => !coveredSet.has(r.gameDate));
  if (stillMissing.length === 0) {
    console.log(`[VERIFY] PASS — all ${allDates.length} game dates are covered`);
  } else {
    console.log(`[VERIFY] WARN — ${stillMissing.length} dates still missing: ${stillMissing.map(r => r.gameDate).join(', ')}`);
  }

  await conn.end();
  console.log(`\n[VERIFY] PASS — backtest runner completed successfully`);
}

main().catch(e => {
  console.error(`[FAIL] Fatal error: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});
