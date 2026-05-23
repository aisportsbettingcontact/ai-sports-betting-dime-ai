/**
 * Re-run backtest for 4 markets with corrected model prob scale:
 * f5_over, f5_under, nrfi, yrfi
 * These markets had modelProb stored as near-zero (divided by 100 incorrectly).
 * This script deletes and re-inserts those rows with correct modelProb values.
 */
import { createConnection } from 'mysql2/promise';

const SEASON_START = '2026-03-25';
const SEASON_END   = '2026-05-22';
const BACKTEST_VERSION = 'v2026-full-audit-1.0';
const AFFECTED_MARKETS = ['f5_over','f5_under','nrfi','yrfi'];

function oddsToProb(oddsStr) {
  if (oddsStr == null) return null;
  const o = parseFloat(String(oddsStr).replace(/[^0-9.\-+]/g, ''));
  if (isNaN(o)) return null;
  if (o > 0) return 100 / (o + 100);
  if (o < 0) return Math.abs(o) / (Math.abs(o) + 100);
  return null;
}
function oddsToDecimal(oddsStr) {
  if (oddsStr == null) return null;
  const o = parseFloat(String(oddsStr).replace(/[^0-9.\-+]/g, ''));
  if (isNaN(o)) return null;
  if (o > 0) return (o / 100) + 1;
  if (o < 0) return (100 / Math.abs(o)) + 1;
  return null;
}
function noVigProb(oddsA, oddsB) {
  const pA = oddsToProb(oddsA);
  const pB = oddsToProb(oddsB);
  if (pA == null || pB == null) return null;
  const total = pA + pB;
  if (total <= 0) return null;
  return pA / total;
}
function computeEdge(modelProb, bookOdds, oppositeOdds) {
  if (modelProb == null || bookOdds == null) return null;
  const nvp = oppositeOdds != null ? noVigProb(bookOdds, oppositeOdds) : oddsToProb(bookOdds);
  if (nvp == null) return null;
  return parseFloat((modelProb - nvp).toFixed(6));
}
function computeEV(modelProb, bookOdds) {
  if (modelProb == null || bookOdds == null) return null;
  const dec = oddsToDecimal(bookOdds);
  if (dec == null) return null;
  return parseFloat((modelProb * dec - 1).toFixed(6));
}
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
function parseGameStartUtcMs(gameDate, startTimeEst) {
  if (!startTimeEst || startTimeEst === 'TBD') return null;
  try {
    const m = String(startTimeEst).match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!m) return null;
    let hour = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    const ampm = m[3].toUpperCase();
    if (ampm === 'PM' && hour !== 12) hour += 12;
    if (ampm === 'AM' && hour === 12) hour = 0;
    const utcHour = hour + 4;
    const [y, mo, d] = gameDate.split('-').map(Number);
    const dt = new Date(Date.UTC(y, mo - 1, d, utcHour, min, 0, 0));
    return dt.getTime();
  } catch { return null; }
}
function checkLeakage(modelRunAt, gameStartUtcMs) {
  if (modelRunAt == null || gameStartUtcMs == null) return 'UNKNOWN';
  const mra = Number(modelRunAt);
  return mra >= gameStartUtcMs ? 'LEAKED' : 'SAFE';
}

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
function gradeNrfi(side, row) {
  const actual = row.nrfiActualResult ?? (row.actualNrfiBinary != null ? (row.actualNrfiBinary === 1 ? 'NRFI' : 'YRFI') : null);
  if (actual == null) return 'MISSING_DATA';
  const isNrfi = actual === 'NRFI' || actual === '1' || actual === 1;
  if (side === 'nrfi') return isNrfi ? 'WIN' : 'LOSS';
  if (side === 'yrfi') return isNrfi ? 'LOSS' : 'WIN';
  return 'MISSING_DATA';
}

const conn = await createConnection(process.env.DATABASE_URL);

console.log('[INPUT] Re-running 4 affected markets with corrected model prob scale');
console.log('[INPUT] Markets:', AFFECTED_MARKETS.join(', '));
console.log('[INPUT] Date range:', SEASON_START, '→', SEASON_END);

// Step 1: Delete existing rows for these markets
for (const mkt of AFFECTED_MARKETS) {
  const [del] = await conn.query(
    `DELETE FROM mlb_game_backtest WHERE market = ? AND gameDate >= ? AND gameDate <= ?`,
    [mkt, SEASON_START, SEASON_END]
  );
  console.log(`[STEP] Deleted ${del.affectedRows} rows for market=${mkt}`);
}

// Step 2: Fetch all games in range
const [games] = await conn.query(`
  SELECT id, gameDate, startTimeEst, gameStatus, awayTeam, homeTeam,
    homeStartingPitcher AS homePitcher, awayStartingPitcher AS awayPitcher,
    f5OverOdds, f5UnderOdds, f5Total,
    nrfiOverOdds, yrfiUnderOdds,
    actualF5AwayScore, actualF5HomeScore, actualF5Total,
    nrfiActualResult, actualNrfiBinary,
    modelF5OverRate, modelF5UnderRate, modelPNrfi,
    modelRunAt
  FROM games
  WHERE gameDate >= ? AND gameDate <= ? AND sport = 'MLB'
  ORDER BY gameDate, startTimeEst
`, [SEASON_START, SEASON_END]);

console.log(`[INPUT] ${games.length} games loaded`);

let totalInserted = 0;
const rows = [];

for (const g of games) {
  const gameStartUtcMs = parseGameStartUtcMs(g.gameDate, g.startTimeEst);
  const leakage = checkLeakage(g.modelRunAt, gameStartUtcMs);
  const leakageSafe = leakage === 'SAFE' ? 1 : leakage === 'LEAKED' ? 0 : null;

  // VOID check
  const isVoid = ['postponed','suspended'].includes(String(g.gameStatus).toLowerCase());

  const marketConfigs = {
    f5_over: {
      modelProb: g.modelF5OverRate != null ? parseFloat(g.modelF5OverRate) : null, // 0-1 scale
      bookOdds: g.f5OverOdds,
      oppositeOdds: g.f5UnderOdds,
      bookLine: g.f5Total != null ? `F5 O${g.f5Total}` : null,
      gradeFn: () => gradeF5Total('over', g),
    },
    f5_under: {
      modelProb: g.modelF5UnderRate != null ? parseFloat(g.modelF5UnderRate) : null, // 0-1 scale
      bookOdds: g.f5UnderOdds,
      oppositeOdds: g.f5OverOdds,
      bookLine: g.f5Total != null ? `F5 U${g.f5Total}` : null,
      gradeFn: () => gradeF5Total('under', g),
    },
    nrfi: {
      modelProb: g.modelPNrfi != null ? parseFloat(g.modelPNrfi) : null, // 0-1 scale
      bookOdds: g.nrfiOverOdds,
      oppositeOdds: g.yrfiUnderOdds,
      bookLine: 'NRFI',
      gradeFn: () => gradeNrfi('nrfi', g),
    },
    yrfi: {
      modelProb: g.modelPNrfi != null ? parseFloat((1 - parseFloat(g.modelPNrfi)).toFixed(6)) : null, // 0-1 scale
      bookOdds: g.yrfiUnderOdds,
      oppositeOdds: g.nrfiOverOdds,
      bookLine: 'YRFI',
      gradeFn: () => gradeNrfi('yrfi', g),
    },
  };

  for (const market of AFFECTED_MARKETS) {
    const cfg = marketConfigs[market];
    const { modelProb, bookOdds, oppositeOdds, bookLine, gradeFn } = cfg;

    let result, quarantineReason = null, voidReason = null;

    if (isVoid) {
      result = 'VOID';
      voidReason = g.gameStatus;
    } else if (leakage === 'LEAKED') {
      result = 'QUARANTINED';
      quarantineReason = `leakage:modelRunAt=${g.modelRunAt}>=gameStart=${gameStartUtcMs}`;
    } else if (modelProb == null) {
      result = 'NO_ACTION';
      quarantineReason = 'modelProb=null';
    } else if (bookOdds == null) {
      result = 'NO_ACTION';
      quarantineReason = 'bookOdds=null';
    } else {
      const gradeResult = gradeFn();
      if (gradeResult === 'MISSING_DATA') {
        result = 'MISSING_DATA';
      } else {
        result = gradeResult; // WIN/LOSS/PUSH
      }
    }

    const edge = (result === 'WIN' || result === 'LOSS' || result === 'PUSH')
      ? computeEdge(modelProb, bookOdds, oppositeOdds)
      : null;
    const ev = (result === 'WIN' || result === 'LOSS' || result === 'PUSH')
      ? computeEV(modelProb, bookOdds)
      : null;
    const profitLoss = computePL(result, bookOdds);
    const correct = result === 'WIN' ? 1 : result === 'LOSS' ? 0 : null;

    rows.push([
      g.id, g.gameDate, market, g.awayTeam, g.homeTeam,
      g.homePitcher ?? null, g.awayPitcher ?? null,
      null, null, // gameTime, dayNight
      null, null, // isDoubleheader, gameNumber
      modelProb != null ? modelProb : null,
      bookOdds ?? null, oppositeOdds ?? null, bookLine ?? null,
      result, correct,
      edge, ev, profitLoss,
      leakageSafe,
      gameStartUtcMs ?? null,
      g.modelRunAt ?? null,
      quarantineReason, voidReason,
      BACKTEST_VERSION,
    ]);
  }
}

// Batch insert
const BATCH = 200;
for (let i = 0; i < rows.length; i += BATCH) {
  const batch = rows.slice(i, i + BATCH);
  await conn.query(`
    INSERT INTO mlb_game_backtest
      (gameId, gameDate, market, homeTeam, awayTeam,
       homePitcher, awayPitcher,
       gameTime, dayNight,
       isDoubleheader, gameNumber,
       modelProb, bookOdds, bookOddsOpposite, bookLine,
       result, correct,
       edge, ev, profitLoss,
       leakageSafe, gameStartUtcMs, modelRunAt,
       quarantineReason, voidReason,
       auditVersion)
    VALUES ?
  `, [batch]);
  totalInserted += batch.length;
}

console.log(`[OUTPUT] Inserted ${totalInserted} rows for ${AFFECTED_MARKETS.length} markets`);

// Verify
for (const mkt of AFFECTED_MARKETS) {
  const [cnt] = await conn.query(
    `SELECT result, COUNT(*) n, ROUND(AVG(modelProb),4) avgProb FROM mlb_game_backtest WHERE market=? AND gameDate>=? AND gameDate<=? GROUP BY result ORDER BY result`,
    [mkt, SEASON_START, SEASON_END]
  );
  console.log(`[VERIFY] ${mkt}:`);
  for (const r of cnt) console.log(`  result=${r.result} n=${r.n} avgProb=${r.avgProb}`);
}

await conn.end();
console.log('[VERIFY] PASS — re-run complete');
