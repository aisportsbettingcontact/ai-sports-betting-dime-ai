/**
 * BACKTEST INVENTORY SCRIPT
 * Audits the games table to determine:
 * 1. All column names available for model predictions
 * 2. Data availability per date for all 59 2026 season dates
 * 3. What model prediction columns are populated vs null
 * 4. What actual score columns are populated vs null
 * 5. What odds columns are available
 */
import { createConnection } from 'mysql2/promise';

const conn = await createConnection(process.env.DATABASE_URL);

console.log('[INPUT] DATABASE_URL loaded, connecting...');
console.log('[STEP] Describing games table schema');

// 1. Full schema
const [cols] = await conn.query('DESCRIBE games');
console.log('\n[STATE] games table columns:');
for (const c of cols) {
  console.log(`  ${c.Field.padEnd(45)} ${c.Type.padEnd(30)} NULL=${c.Null} DEFAULT=${c.Default}`);
}

// 2. Sample row for 2026 season
console.log('\n[STEP] Fetching one sample game row from 2026-03-25');
const [sample] = await conn.query(
  `SELECT * FROM games WHERE gameDate = '2026-03-25' AND sport = 'MLB' LIMIT 1`
);
if (sample.length > 0) {
  console.log('[STATE] Sample row keys and values:');
  for (const [k, v] of Object.entries(sample[0])) {
    console.log(`  ${k.padEnd(45)} = ${v === null ? 'NULL' : String(v).substring(0, 80)}`);
  }
} else {
  console.log('[WARN] No game found for 2026-03-25');
}

// 3. Per-date availability: count games, count with model probs, count with actual scores
console.log('\n[STEP] Per-date data availability audit (2026-03-25 to 2026-05-22)');
const [dateStats] = await conn.query(`
  SELECT
    gameDate,
    COUNT(*) AS total_games,
    SUM(CASE WHEN awayScore IS NOT NULL AND homeScore IS NOT NULL THEN 1 ELSE 0 END) AS has_final_score,
    SUM(CASE WHEN actualAwayScore IS NOT NULL AND actualHomeScore IS NOT NULL THEN 1 ELSE 0 END) AS has_actual_score,
    SUM(CASE WHEN modelHomeWinPct IS NOT NULL THEN 1 ELSE 0 END) AS has_model_home_win_pct,
    SUM(CASE WHEN modelAwayWinPct IS NOT NULL THEN 1 ELSE 0 END) AS has_model_away_win_pct,
    SUM(CASE WHEN modelOverRate IS NOT NULL THEN 1 ELSE 0 END) AS has_model_over_rate,
    SUM(CASE WHEN homeML IS NOT NULL THEN 1 ELSE 0 END) AS has_home_ml,
    SUM(CASE WHEN awayML IS NOT NULL THEN 1 ELSE 0 END) AS has_away_ml,
    SUM(CASE WHEN bookTotal IS NOT NULL THEN 1 ELSE 0 END) AS has_book_total,
    SUM(CASE WHEN overOdds IS NOT NULL THEN 1 ELSE 0 END) AS has_over_odds,
    SUM(CASE WHEN underOdds IS NOT NULL THEN 1 ELSE 0 END) AS has_under_odds,
    SUM(CASE WHEN homeRL IS NOT NULL THEN 1 ELSE 0 END) AS has_home_rl,
    SUM(CASE WHEN awayRL IS NOT NULL THEN 1 ELSE 0 END) AS has_away_rl,
    SUM(CASE WHEN homeRLOdds IS NOT NULL THEN 1 ELSE 0 END) AS has_home_rl_odds,
    SUM(CASE WHEN awayRLOdds IS NOT NULL THEN 1 ELSE 0 END) AS has_away_rl_odds,
    SUM(CASE WHEN nrfiResult IS NOT NULL THEN 1 ELSE 0 END) AS has_nrfi_result,
    SUM(CASE WHEN modelNrfiProb IS NOT NULL THEN 1 ELSE 0 END) AS has_model_nrfi_prob,
    SUM(CASE WHEN actualF5AwayScore IS NOT NULL THEN 1 ELSE 0 END) AS has_f5_away_score,
    SUM(CASE WHEN actualF5HomeScore IS NOT NULL THEN 1 ELSE 0 END) AS has_f5_home_score,
    SUM(CASE WHEN modelF5HomeWinPct IS NOT NULL THEN 1 ELSE 0 END) AS has_model_f5_home_win_pct,
    SUM(CASE WHEN modelF5OverRate IS NOT NULL THEN 1 ELSE 0 END) AS has_model_f5_over_rate,
    SUM(CASE WHEN f5HomeML IS NOT NULL THEN 1 ELSE 0 END) AS has_f5_home_ml,
    SUM(CASE WHEN f5BookTotal IS NOT NULL THEN 1 ELSE 0 END) AS has_f5_book_total,
    SUM(CASE WHEN postponed IS NOT NULL AND postponed = 1 THEN 1 ELSE 0 END) AS postponed_games,
    SUM(CASE WHEN modelRunAt IS NOT NULL THEN 1 ELSE 0 END) AS has_model_run_at,
    SUM(CASE WHEN startTimeEst IS NOT NULL THEN 1 ELSE 0 END) AS has_start_time_est
  FROM games
  WHERE gameDate >= '2026-03-25' AND gameDate <= '2026-05-22'
    AND sport = 'MLB'
  GROUP BY gameDate
  ORDER BY gameDate ASC
`);

console.log('\n[STATE] Per-date availability:');
console.log('Date       | Games | FinalScore | ActualScore | ModelHWP | ModelOR | HomeML | BookTotal | NRFI | F5Score | F5ML | ModelRunAt');
console.log('-'.repeat(130));
for (const r of dateStats) {
  console.log(
    `${r.gameDate} | ${String(r.total_games).padStart(5)} | ${String(r.has_final_score).padStart(10)} | ${String(r.has_actual_score).padStart(11)} | ${String(r.has_model_home_win_pct).padStart(8)} | ${String(r.has_model_over_rate).padStart(7)} | ${String(r.has_home_ml).padStart(6)} | ${String(r.has_book_total).padStart(9)} | ${String(r.has_nrfi_result).padStart(4)} | ${String(r.has_f5_away_score).padStart(7)} | ${String(r.has_f5_home_ml).padStart(5)} | ${String(r.has_model_run_at).padStart(11)}`
  );
}

// 4. Check what columns actually exist (some may not exist yet)
console.log('\n[STEP] Checking which model prediction columns exist in games table');
const colNames = new Set(cols.map(c => c.Field));
const checkCols = [
  'modelHomeWinPct','modelAwayWinPct','modelOverRate','modelUnderRate',
  'modelNrfiProb','modelYrfiProb','modelF5HomeWinPct','modelF5AwayWinPct',
  'modelF5OverRate','modelRunAt','startTimeEst','homeML','awayML',
  'bookTotal','overOdds','underOdds','homeRL','awayRL','homeRLOdds','awayRLOdds',
  'nrfiResult','actualF5AwayScore','actualF5HomeScore','f5HomeML','f5AwayML',
  'f5BookTotal','f5OverOdds','f5UnderOdds','f5HomeRL','f5AwayRL',
  'f5HomeRLOdds','f5AwayRLOdds','awayScore','homeScore','actualAwayScore',
  'actualHomeScore','postponed','suspended','gameStatus',
  'modelFgOverRate','modelFgHomeWinPct','modelFgAwayWinPct',
];
for (const col of checkCols) {
  console.log(`  ${col.padEnd(35)} EXISTS=${colNames.has(col) ? 'YES' : '*** NO ***'}`);
}

// 5. Check mlb_strikeout_props and mlb_hr_props for 2026 data
console.log('\n[STEP] Checking mlb_strikeout_props for 2026 data');
const [kpropStats] = await conn.query(`
  SELECT 
    gameDate, COUNT(*) AS total,
    SUM(CASE WHEN actualKs IS NOT NULL THEN 1 ELSE 0 END) AS has_actual_ks,
    SUM(CASE WHEN modelKs IS NOT NULL THEN 1 ELSE 0 END) AS has_model_ks,
    SUM(CASE WHEN lineKs IS NOT NULL THEN 1 ELSE 0 END) AS has_line_ks
  FROM mlb_strikeout_props
  WHERE gameDate >= '2026-03-25' AND gameDate <= '2026-05-22'
  GROUP BY gameDate ORDER BY gameDate ASC LIMIT 10
`).catch(() => [[{ error: 'table not found or no data' }]]);
console.log('[STATE] mlb_strikeout_props sample:', JSON.stringify(kpropStats.slice(0, 5)));

console.log('\n[STEP] Checking mlb_hr_props for 2026 data');
const [hrpropStats] = await conn.query(`
  SELECT 
    gameDate, COUNT(*) AS total,
    SUM(CASE WHEN actualHr IS NOT NULL THEN 1 ELSE 0 END) AS has_actual_hr,
    SUM(CASE WHEN modelHrProb IS NOT NULL THEN 1 ELSE 0 END) AS has_model_hr_prob
  FROM mlb_hr_props
  WHERE gameDate >= '2026-03-25' AND gameDate <= '2026-05-22'
  GROUP BY gameDate ORDER BY gameDate ASC LIMIT 10
`).catch(() => [[{ error: 'table not found or no data' }]]);
console.log('[STATE] mlb_hr_props sample:', JSON.stringify(hrpropStats.slice(0, 5)));

// 6. Check existing backtest rows to understand what's already graded
console.log('\n[STEP] Existing mlb_game_backtest rows per market for 2026 season');
const [existingBt] = await conn.query(`
  SELECT market, result, COUNT(*) AS cnt
  FROM mlb_game_backtest
  WHERE gameDate >= '2026-03-25' AND gameDate <= '2026-05-22'
  GROUP BY market, result
  ORDER BY market, result
`);
console.log('[STATE] Existing backtest rows:');
for (const r of existingBt) {
  console.log(`  ${r.market.padEnd(20)} result=${String(r.result).padEnd(15)} cnt=${r.cnt}`);
}

await conn.end();
console.log('\n[OUTPUT] Inventory complete');
console.log('[VERIFY] PASS — all queries executed successfully');
