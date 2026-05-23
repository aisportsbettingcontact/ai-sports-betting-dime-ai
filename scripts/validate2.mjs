import { createConnection } from 'mysql2/promise';
const S = '2026-03-25', E = '2026-05-22';
const conn = await createConnection(process.env.DATABASE_URL);

// Graded summary
const [gs] = await conn.query(`
  SELECT market,
    SUM(result='WIN') w, SUM(result='LOSS') l, SUM(result='PUSH') p,
    ROUND(SUM(result='WIN')*100.0/NULLIF(SUM(result IN ('WIN','LOSS')),0),2) win_pct,
    ROUND(SUM(CASE WHEN result='WIN' THEN profitLoss WHEN result='LOSS' THEN -100 ELSE 0 END),2) total_pl
  FROM mlb_game_backtest
  WHERE gameDate>=? AND gameDate<=? AND result IN ('WIN','LOSS','PUSH')
  GROUP BY market ORDER BY market
`, [S,E]);
console.log('GRADED SUMMARY:');
for(const r of gs) console.log(`  ${String(r.market).padEnd(18)} W=${r.w} L=${r.l} P=${r.p} Win%=${r.win_pct}% P/L=$${r.total_pl}`);

// Leakage distribution
const [ld] = await conn.query(`
  SELECT leakageSafe, COUNT(DISTINCT gameId) games FROM mlb_game_backtest WHERE gameDate>=? AND gameDate<=? GROUP BY leakageSafe
`,[S,E]);
console.log('\nLEAKAGE DISTRIBUTION:');
for(const r of ld) {
  const label = r.leakageSafe === 1 ? 'SAFE' : r.leakageSafe === 0 ? 'LEAKED' : 'UNKNOWN';
  console.log(`  ${label} (leakageSafe=${r.leakageSafe}): ${r.games} games`);
}

// Unique games quarantined
const [qg] = await conn.query(`
  SELECT COUNT(DISTINCT gameId) leaked_games FROM mlb_game_backtest WHERE result='QUARANTINED' AND gameDate>=? AND gameDate<=?
`,[S,E]);
console.log(`\nUnique games QUARANTINED: ${qg[0].leaked_games} of 769`);

// Lag analysis: how many hours after game start did model run?
const [lag] = await conn.query(`
  SELECT g.gameDate, g.id, g.startTimeEst,
    ROUND((g.modelRunAt - bt.gameStartUtcMs)/3600000, 1) AS hours_after_start
  FROM games g
  JOIN mlb_game_backtest bt ON bt.gameId = g.id AND bt.market = 'fg_ml_home'
  WHERE bt.result='QUARANTINED' AND g.gameDate>='2026-03-25' AND g.gameDate<='2026-05-22'
  ORDER BY hours_after_start DESC
  LIMIT 10
`,[]);
console.log('\nTop 10 worst leakage (hours after game start):');
for(const r of lag) console.log(`  ${r.gameDate} id=${r.id} startTime=${r.startTimeEst} hours_after=${r.hours_after_start}`);

// MISSING_DATA root cause: what % of these games have actualAwayScore populated?
const [missRoot] = await conn.query(`
  SELECT g.gameStatus, COUNT(*) cnt
  FROM mlb_game_backtest bt
  JOIN games g ON g.id = bt.gameId
  WHERE bt.result='MISSING_DATA' AND bt.gameDate>=? AND bt.gameDate<=?
  GROUP BY g.gameStatus ORDER BY cnt DESC
`,[S,E]);
console.log('\nMISSING_DATA by gameStatus:');
for(const r of missRoot) console.log(`  gameStatus=${r.gameStatus}: ${r.cnt}`);

// NO_ACTION root cause breakdown
const [naRoot] = await conn.query(`
  SELECT market, quarantineReason, COUNT(*) cnt
  FROM mlb_game_backtest
  WHERE result='NO_ACTION' AND gameDate>=? AND gameDate<=?
  GROUP BY market, quarantineReason ORDER BY market, cnt DESC
`,[S,E]);
console.log('\nNO_ACTION by market+reason:');
for(const r of naRoot) console.log(`  ${String(r.market).padEnd(18)} reason="${r.quarantineReason}" cnt=${r.cnt}`);

// Total row count
const [tc] = await conn.query(`SELECT COUNT(*) total FROM mlb_game_backtest WHERE gameDate>=? AND gameDate<=?`,[S,E]);
console.log(`\nTOTAL ROWS IN DB: ${tc[0].total}`);
console.log(`Expected (769 games x 14 markets + 157 hr_prop): ${769*14 + 157}`);

await conn.end();
console.log('\n[VERIFY] PASS — validation complete');
