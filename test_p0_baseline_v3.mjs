/**
 * P0 BASELINE CAPTURE — Pre-Soak Snapshot
 * Captures all critical table row counts before the soak test.
 * Output: JSON to stdout + human-readable table
 */
import mysql from 'mysql2/promise';

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error('[FATAL] DATABASE_URL not set'); process.exit(1); }

const P0_TABLES = [
  'wc2026_matches',
  'wc2026_teams',
  'wc2026_venues',
  'wc2026_match_xg',
  'wc2026_team_stats',
  'wc2026_player_stats',
  'wc2026_espn_matches',
  'wc2026_projections',
  'wc2026_recommendations',
  'wc2026_holdout_odds',
  'wc2026_model_grades',
];

const DIME_TABLES = [
  'dime_entitlements',
  'dime_credit_ledger',
  'dime_request_audit',
  'dime_response_audit',
  'dime_context_audit',
  'dime_soak_test_results',
];

async function main() {
  const db = await mysql.createConnection({ uri: DB_URL, connectTimeout: 10000 });
  console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  P0 BASELINE CAPTURE — PRE-SOAK SNAPSHOT                                    ║');
  console.log(`║  TIMESTAMP: ${new Date().toISOString()}`);
  console.log('╠══════════════════════════════════════════════════════════════════════════════╣');

  const baseline = {};

  // P0 Tables
  console.log('║  ── P0 TABLES (must NOT change during soak) ──');
  for (const table of P0_TABLES) {
    try {
      const [rows] = await db.execute(`SELECT COUNT(*) as cnt FROM ${table}`);
      baseline[table] = rows[0].cnt;
      console.log(`║    ${table.padEnd(30)} ${String(rows[0].cnt).padStart(6)} rows`);
    } catch (err) {
      baseline[table] = -1;
      console.log(`║    ${table.padEnd(30)} ERROR: ${err.message}`);
    }
  }

  // Dime Tables (expected to grow)
  console.log('║  ── DIME TABLES (expected to grow during soak) ──');
  for (const table of DIME_TABLES) {
    try {
      const [rows] = await db.execute(`SELECT COUNT(*) as cnt FROM ${table}`);
      baseline[table] = rows[0].cnt;
      console.log(`║    ${table.padEnd(30)} ${String(rows[0].cnt).padStart(6)} rows`);
    } catch (err) {
      baseline[table] = -1;
      console.log(`║    ${table.padEnd(30)} ERROR: ${err.message}`);
    }
  }

  // Credit balance snapshot
  const [creditRows] = await db.execute(
    `SELECT balance_after FROM dime_credit_ledger WHERE user_id = '1' ORDER BY id DESC LIMIT 1`
  );
  const creditBalance = creditRows.length > 0 ? creditRows[0].balance_after : 100;
  baseline['owner_credit_balance'] = Number(creditBalance);
  console.log(`║    ${'owner_credit_balance'.padEnd(30)} ${String(creditBalance).padStart(6)}`);

  console.log('╚══════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('[P0_BASELINE_JSON]');
  console.log(JSON.stringify(baseline, null, 2));

  await db.end();
}

main().catch(err => { console.error('[FATAL]', err.message); process.exit(1); });
