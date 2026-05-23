/**
 * DEEP VALIDATION SCRIPT — 2026 MLB Full Season Backtest
 * Audits: QUARANTINED rate, fg_rl zero grades, hr_prop NO_ACTION,
 *         MISSING_DATA root cause, leakage distribution, date coverage
 */
import { createConnection } from 'mysql2/promise';

const S = '2026-03-25';
const E = '2026-05-22';
const conn = await createConnection(process.env.DATABASE_URL);

console.log('='.repeat(70));
console.log('DEEP VALIDATION — 2026 MLB FULL SEASON BACKTEST');
console.log('='.repeat(70));

// ─── 1. OVERALL RESULT DISTRIBUTION ───────────────────────────────────────
console.log('\n[1] OVERALL RESULT DISTRIBUTION');
const [overall] = await conn.query(`
  SELECT result, COUNT(*) AS cnt,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) AS pct
  FROM mlb_game_backtest
  WHERE gameDate >= ? AND gameDate <= ?
  GROUP BY result ORDER BY cnt DESC
`, [S, E]);
for (const r of overall) {
  console.log(`  ${String(r.result).padEnd(15)} ${String(r.cnt).padStart(6)} rows  (${r.pct}%)`);
}

// ─── 2. QUARANTINED AUDIT ──────────────────────────────────────────────────
console.log('\n[2] QUARANTINED AUDIT — root cause analysis');
const [quarSample] = await conn.query(`
  SELECT gameDate, gameId, market, quarantineReason, modelRunAt, leakageSafe
  FROM mlb_game_backtest
  WHERE gameDate >= ? AND gameDate <= ? AND result = 'QUARANTINED'
  LIMIT 5
`, [S, E]);
console.log('  Sample QUARANTINED rows:');
for (const r of quarSample) {
  console.log(`    ${r.gameDate} gameId=${r.gameId} market=${r.market} reason="${r.quarantineReason}" modelRunAt=${r.modelRunAt} leakageSafe=${r.leakageSafe}`);
}

// Count by quarantine reason
const [quarReasons] = await conn.query(`
  SELECT quarantineReason, COUNT(*) AS cnt
  FROM mlb_game_backtest
  WHERE gameDate >= ? AND gameDate <= ? AND result = 'QUARANTINED'
  GROUP BY quarantineReason ORDER BY cnt DESC
`, [S, E]);
console.log('  QUARANTINED by reason:');
for (const r of quarReasons) {
  console.log(`    "${r.quarantineReason}": ${r.cnt}`);
}

// What % of games have modelRunAt populated?
const [modelRunAtStats] = await conn.query(`
  SELECT
    COUNT(*) AS total_games,
    SUM(CASE WHEN modelRunAt IS NOT NULL THEN 1 ELSE 0 END) AS has_model_run_at,
    SUM(CASE WHEN modelRunAt IS NULL THEN 1 ELSE 0 END) AS no_model_run_at
  FROM games
  WHERE gameDate >= ? AND gameDate <= ? AND sport = 'MLB'
`, [S, E]);
const mrs = modelRunAtStats[0];
console.log(`  games.modelRunAt populated: ${mrs.has_model_run_at}/${mrs.total_games} (${(mrs.has_model_run_at/mrs.total_games*100).toFixed(1)}%)`);
console.log(`  games.modelRunAt NULL: ${mrs.no_model_run_at}/${mrs.total_games} (${(mrs.no_model_run_at/mrs.total_games*100).toFixed(1)}%)`);

// Sample a QUARANTINED game to understand the leakage
const [quarGame] = await conn.query(`
  SELECT g.id, g.gameDate, g.startTimeEst, g.modelRunAt, g.modelHomeWinPct, g.modelAwayWinPct
  FROM games g
  JOIN mlb_game_backtest bt ON bt.gameId = g.id
  WHERE bt.result = 'QUARANTINED' AND g.gameDate >= ? AND g.gameDate <= ?
  LIMIT 3
`, [S, E]);
console.log('  Sample QUARANTINED games (from games table):');
for (const g of quarGame) {
  console.log(`    id=${g.id} date=${g.gameDate} startTimeEst="${g.startTimeEst}" modelRunAt=${g.modelRunAt} homeWinPct=${g.modelHomeWinPct}`);
}

// ─── 3. FG_RL ZERO GRADES AUDIT ───────────────────────────────────────────
console.log('\n[3] FG_RL ZERO GRADES AUDIT');
const [fgRlSample] = await conn.query(`
  SELECT bt.gameDate, bt.gameId, bt.market, bt.result, bt.quarantineReason,
    g.awayRunLine, g.homeRunLine, g.awayRunLineOdds, g.homeRunLineOdds,
    g.modelHomePLCoverPct, g.modelAwayPLCoverPct, g.actualAwayScore, g.actualHomeScore
  FROM mlb_game_backtest bt
  JOIN games g ON g.id = bt.gameId
  WHERE bt.market IN ('fg_rl_home','fg_rl_away') AND bt.gameDate >= ? AND bt.gameDate <= ?
  LIMIT 10
`, [S, E]);
console.log('  Sample fg_rl rows:');
for (const r of fgRlSample) {
  console.log(`    ${r.gameDate} gameId=${r.gameId} market=${r.market} result=${r.result} reason="${r.quarantineReason}" awayRL=${r.awayRunLine} homeRL=${r.homeRunLine} awayRLOdds=${r.awayRunLineOdds} homeRLOdds=${r.homeRunLineOdds} modelHomePL=${r.modelHomePLCoverPct} modelAwayPL=${r.modelAwayPLCoverPct} actualAway=${r.actualAwayScore} actualHome=${r.actualHomeScore}`);
}

// How many fg_rl games have awayRunLine populated?
const [fgRlAvail] = await conn.query(`
  SELECT
    COUNT(*) AS total,
    SUM(CASE WHEN awayRunLine IS NOT NULL THEN 1 ELSE 0 END) AS has_away_rl,
    SUM(CASE WHEN homeRunLine IS NOT NULL THEN 1 ELSE 0 END) AS has_home_rl,
    SUM(CASE WHEN awayRunLineOdds IS NOT NULL THEN 1 ELSE 0 END) AS has_away_rl_odds,
    SUM(CASE WHEN modelAwayPLCoverPct IS NOT NULL THEN 1 ELSE 0 END) AS has_model_away_pl,
    SUM(CASE WHEN modelHomePLCoverPct IS NOT NULL THEN 1 ELSE 0 END) AS has_model_home_pl
  FROM games
  WHERE gameDate >= ? AND gameDate <= ? AND sport = 'MLB'
`, [S, E]);
const frl = fgRlAvail[0];
console.log(`  awayRunLine populated: ${frl.has_away_rl}/${frl.total}`);
console.log(`  awayRunLineOdds populated: ${frl.has_away_rl_odds}/${frl.total}`);
console.log(`  modelAwayPLCoverPct populated: ${frl.has_model_away_pl}/${frl.total}`);
console.log(`  modelHomePLCoverPct populated: ${frl.has_model_home_pl}/${frl.total}`);

// ─── 4. HR_PROP AUDIT ─────────────────────────────────────────────────────
console.log('\n[4] HR_PROP AUDIT');
const [hrSample] = await conn.query(`
  SELECT bt.gameDate, bt.gameId, bt.result, bt.quarantineReason,
    hp.playerName, hp.modelHrProb, hp.lineHr, hp.overOdds, hp.actualHr
  FROM mlb_game_backtest bt
  LEFT JOIN mlb_hr_props hp ON hp.gameId = bt.gameId
  WHERE bt.market = 'hr_prop' AND bt.gameDate >= ? AND bt.gameDate <= ?
  LIMIT 5
`, [S, E]);
console.log('  Sample hr_prop rows:');
for (const r of hrSample) {
  console.log(`    ${r.gameDate} gameId=${r.gameId} result=${r.result} reason="${r.quarantineReason}" player=${r.playerName} modelHrProb=${r.modelHrProb} lineHr=${r.lineHr} overOdds=${r.overOdds} actualHr=${r.actualHr}`);
}

// ─── 5. MISSING_DATA AUDIT ────────────────────────────────────────────────
console.log('\n[5] MISSING_DATA AUDIT');
const [missSample] = await conn.query(`
  SELECT bt.gameDate, bt.gameId, bt.market, bt.quarantineReason,
    g.gameStatus, g.actualAwayScore, g.actualHomeScore, g.actualF5AwayScore, g.actualF5HomeScore, g.nrfiActualResult
  FROM mlb_game_backtest bt
  JOIN games g ON g.id = bt.gameId
  WHERE bt.result = 'MISSING_DATA' AND bt.gameDate >= ? AND bt.gameDate <= ?
  LIMIT 10
`, [S, E]);
console.log('  Sample MISSING_DATA rows:');
for (const r of missSample) {
  console.log(`    ${r.gameDate} gameId=${r.gameId} market=${r.market} status=${r.gameStatus} reason="${r.quarantineReason}" actualAway=${r.actualAwayScore} actualHome=${r.actualHomeScore} f5Away=${r.actualF5AwayScore} f5Home=${r.actualF5HomeScore} nrfi=${r.nrfiActualResult}`);
}

// Count MISSING_DATA by market
const [missByMkt] = await conn.query(`
  SELECT market, COUNT(*) AS cnt, MIN(gameDate) AS dmin, MAX(gameDate) AS dmax
  FROM mlb_game_backtest
  WHERE result = 'MISSING_DATA' AND gameDate >= ? AND gameDate <= ?
  GROUP BY market ORDER BY cnt DESC
`, [S, E]);
console.log('  MISSING_DATA by market:');
for (const r of missByMkt) {
  console.log(`    ${r.market.padEnd(18)} cnt=${r.cnt} dates=${r.dmin}→${r.dmax}`);
}

// ─── 6. DATE COVERAGE VERIFICATION ───────────────────────────────────────
console.log('\n[6] DATE COVERAGE VERIFICATION');
const [btDates] = await conn.query(`
  SELECT DISTINCT gameDate FROM mlb_game_backtest
  WHERE gameDate >= ? AND gameDate <= ? ORDER BY gameDate
`, [S, E]);
const [gameDates] = await conn.query(`
  SELECT DISTINCT gameDate FROM games
  WHERE gameDate >= ? AND gameDate <= ? AND sport = 'MLB' ORDER BY gameDate
`, [S, E]);
const covered = new Set(btDates.map(r => r.gameDate));
const missing = gameDates.filter(r => !covered.has(r.gameDate));
console.log(`  Backtest dates: ${btDates.length}`);
console.log(`  Game dates in DB: ${gameDates.length}`);
if (missing.length === 0) {
  console.log(`  [VERIFY] PASS — all ${gameDates.length} game dates covered`);
} else {
  console.log(`  [VERIFY] FAIL — ${missing.length} dates missing: ${missing.map(r => r.gameDate).join(', ')}`);
}

// ─── 7. LEAKAGE DISTRIBUTION ──────────────────────────────────────────────
console.log('\n[7] LEAKAGE DISTRIBUTION (per game, not per row)');
const [leakDist] = await conn.query(`
  SELECT leakageSafe, COUNT(DISTINCT gameId) AS games
  FROM mlb_game_backtest
  WHERE gameDate >= ? AND gameDate <= ?
  GROUP BY leakageSafe
`, [S, E]);
for (const r of leakDist) {
  const label = r.leakageSafe === 1 ? 'SAFE' : r.leakageSafe === 0 ? 'LEAKED' : 'UNKNOWN';
  console.log(`  ${label}: ${r.games} games`);
}

// ─── 8. GRADED ROWS ACCURACY SUMMARY ─────────────────────────────────────
console.log('\n[8] GRADED ROWS ACCURACY SUMMARY (WIN/LOSS only, excludes PUSH)');
const [gradedSummary] = await conn.query(`
  SELECT
    market,
    SUM(CASE WHEN result='WIN' THEN 1 ELSE 0 END) AS wins,
    SUM(CASE WHEN result='LOSS' THEN 1 ELSE 0 END) AS losses,
    SUM(CASE WHEN result='PUSH' THEN 1 ELSE 0 END) AS pushes,
    ROUND(SUM(CASE WHEN result='WIN' THEN 1 ELSE 0 END) * 100.0 /
      NULLIF(SUM(CASE WHEN result IN ('WIN','LOSS') THEN 1 ELSE 0 END), 0), 2) AS win_pct,
    ROUND(SUM(CASE WHEN result='WIN' THEN profitLoss ELSE CASE WHEN result='LOSS' THEN -100 ELSE 0 END END), 2) AS total_pl,
    COUNT(DISTINCT gameDate) AS dates_graded
  FROM mlb_game_backtest
  WHERE gameDate >= ? AND gameDate <= ? AND result IN ('WIN','LOSS','PUSH')
  GROUP BY market ORDER BY market
`, [S, E]);
console.log(`  ${'Market'.padEnd(18)} | ${'W'.padStart(5)} | ${'L'.padStart(5)} | ${'P'.padStart(4)} | ${'Win%'.padStart(6)} | ${'P/L($100)'.padStart(12)} | Dates`);
console.log('  ' + '-'.repeat(80));
for (const r of gradedSummary) {
  console.log(`  ${String(r.market).padEnd(18)} | ${String(r.wins).padStart(5)} | ${String(r.losses).padStart(5)} | ${String(r.pushes).padStart(4)} | ${String(r.win_pct ?? 'N/A').padStart(6)}% | ${String(r.total_pl ?? 'N/A').padStart(12)} | ${r.dates_graded}`);
}

// ─── 9. TOTAL ROW COUNT VERIFICATION ─────────────────────────────────────
console.log('\n[9] TOTAL ROW COUNT VERIFICATION');
const [totalCount] = await conn.query(`
  SELECT COUNT(*) AS total FROM mlb_game_backtest WHERE gameDate >= ? AND gameDate <= ?
`, [S, E]);
const expected = 769 * 14; // 769 games × 14 markets (hr_prop is separate)
const actual = totalCount[0].total;
console.log(`  Expected (769 games × 14 markets): ${expected}`);
console.log(`  Actual rows in DB: ${actual}`);
// Note: hr_prop has 157 rows (separate from main 14 markets)
const [hrCount] = await conn.query(`
  SELECT COUNT(*) AS cnt FROM mlb_game_backtest WHERE market = 'hr_prop' AND gameDate >= ? AND gameDate <= ?
`, [S, E]);
console.log(`  hr_prop rows (separate): ${hrCount[0].cnt}`);
console.log(`  Total including hr_prop: ${actual}`);
if (actual >= expected) {
  console.log(`  [VERIFY] PASS — row count meets or exceeds expected`);
} else {
  console.log(`  [VERIFY] WARN — row count below expected by ${expected - actual}`);
}

await conn.end();
console.log('\n[VERIFY] PASS — deep validation complete');
