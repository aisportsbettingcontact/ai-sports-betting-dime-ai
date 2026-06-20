/**
 * wc_bt_audit.mjs
 * Audits the WC backtest DB state: June 19 fixtures, backtest match counts,
 * backtest projections, and prior recalibration logs.
 */
import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);
console.log('\n[AUDIT] ================================================================');
console.log('[AUDIT] WC BACKTEST STATE AUDIT — June 20, 2026');
console.log('[AUDIT] ================================================================\n');

// ── June 19 fixtures ──────────────────────────────────────────────────────────
console.log('[AUDIT] [STEP 1] June 19 fixtures status...');
const [june19] = await conn.query(`
  SELECT fixture_id, home_team, away_team, home_score, away_score, status, kickoff_utc
  FROM wc2026_fixtures
  WHERE match_date = '2026-06-19'
  ORDER BY kickoff_utc
`);
console.log(`[AUDIT] [STATE] June 19 fixtures (${june19.length}):`);
for (const f of june19) {
  console.log(`  ${f.home_team} vs ${f.away_team} | score=${f.home_score}-${f.away_score} | status=${f.status} | id=${f.fixture_id}`);
}

// ── Backtest match counts ─────────────────────────────────────────────────────
console.log('\n[AUDIT] [STEP 2] Backtest match counts by year...');
const [btCounts] = await conn.query(`
  SELECT tournament_year, COUNT(*) as cnt,
    SUM(CASE WHEN home_score IS NOT NULL THEN 1 ELSE 0 END) as with_scores
  FROM wc_bt_matches
  GROUP BY tournament_year
  ORDER BY tournament_year
`);
for (const r of btCounts) {
  console.log(`  ${r.tournament_year}: total=${r.cnt} with_scores=${r.with_scores}`);
}

// ── Backtest projections ──────────────────────────────────────────────────────
console.log('\n[AUDIT] [STEP 3] Backtest projections count...');
const [btProj] = await conn.query(`SELECT COUNT(*) as cnt FROM wc_bt_projections`);
console.log(`  wc_bt_projections: ${btProj[0].cnt} rows`);

// ── Recalibration logs ────────────────────────────────────────────────────────
console.log('\n[AUDIT] [STEP 4] Recalibration logs...');
const [recalLogs] = await conn.query(`
  SELECT COUNT(*) as cnt FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wc_bt_recalibration_log'
`);
if (recalLogs[0].cnt > 0) {
  const [logs] = await conn.query(`SELECT * FROM wc_bt_recalibration_log ORDER BY created_at DESC LIMIT 5`);
  console.log(`  wc_bt_recalibration_log: ${logs.length} recent entries`);
  for (const l of logs) console.log('  ', JSON.stringify(l));
} else {
  console.log('  wc_bt_recalibration_log: table does not exist yet');
}

// ── Batch results ─────────────────────────────────────────────────────────────
console.log('\n[AUDIT] [STEP 5] Batch results...');
const [batchRes] = await conn.query(`
  SELECT batch_id, total_matches, correct_ml, correct_total, correct_draw, correct_dc, accuracy_pct, created_at
  FROM wc_bt_batch_results
  ORDER BY created_at DESC LIMIT 5
`);
if (batchRes.length > 0) {
  console.log(`  Last ${batchRes.length} batch results:`);
  for (const b of batchRes) {
    console.log(`  batch=${b.batch_id} matches=${b.total_matches} ml=${b.correct_ml} total=${b.correct_total} draw=${b.correct_draw} dc=${b.correct_dc} acc=${b.accuracy_pct}% at=${b.created_at}`);
  }
} else {
  console.log('  No batch results yet');
}

// ── Model features ────────────────────────────────────────────────────────────
console.log('\n[AUDIT] [STEP 6] Match features count...');
const [featCount] = await conn.query(`SELECT COUNT(*) as cnt FROM wc_bt_match_features`);
console.log(`  wc_bt_match_features: ${featCount[0].cnt} rows`);

const [projCount] = await conn.query(`SELECT COUNT(*) as cnt FROM wc_bt_projections`);
console.log(`  wc_bt_projections: ${projCount[0].cnt} rows`);

await conn.end();
console.log('\n[AUDIT] ✅ DONE');
