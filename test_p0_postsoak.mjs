/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║  BLOCK 3: POST-SOAK P0 PRESERVATION CHECK                                  ║
 * ║  Verifies all critical WC2026 tables survived 100-request soak unharmed     ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 */
import mysql from 'mysql2/promise';

const DB_URL = process.env.DATABASE_URL;
const conn = await mysql.createConnection(DB_URL);

console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
console.log('║  BLOCK 3: POST-SOAK P0 PRESERVATION CHECK                                  ║');
console.log('╠══════════════════════════════════════════════════════════════════════════════╣');
console.log(`║  TIMESTAMP: ${new Date().toISOString()}`);
console.log('╚══════════════════════════════════════════════════════════════════════════════╝');
console.log('');

// Expected baseline counts (from Block 0)
const expected = {
  wc2026_matches: 104,
  wc2026_teams: 49,
  wc2026_venues: 16,
  wc2026_xg: 88,
  wc2026_team_stats: 88,
  wc2026_player_stats: 2742,
  wc2026_espn_matches: 90,
  wc2026_projections: 92,
  wc2026_recommendations: 264,
  wc2026_holdout_odds: 258,
  wc2026_model_grades: 57,
};

let allPass = true;
const results = [];

for (const [table, expectedCount] of Object.entries(expected)) {
  const [rows] = await conn.execute(`SELECT COUNT(*) as cnt FROM ${table}`);
  const actual = rows[0].cnt;
  const pass = actual >= expectedCount;
  if (!pass) allPass = false;
  const icon = pass ? '✓' : '✗';
  console.log(`  [P0] ${icon} ${table.padEnd(28)} | expected≥${String(expectedCount).padStart(5)} | actual=${String(actual).padStart(5)} | ${pass ? 'INTACT' : 'DEGRADED'}`);
  results.push({ table, expected: expectedCount, actual, pass });
}

// Also check Dime tables (should have grown from soak)
console.log('');
console.log('  --- DIME TABLES (should have grown from soak) ---');
const dimeTables = ['dime_entitlements', 'dime_credit_ledger', 'dime_request_audit', 'dime_response_audit', 'dime_context_audit'];
for (const table of dimeTables) {
  const [rows] = await conn.execute(`SELECT COUNT(*) as cnt FROM ${table}`);
  const actual = rows[0].cnt;
  console.log(`  [DIME] ${table.padEnd(28)} | rows=${actual}`);
  results.push({ table, expected: 0, actual, pass: true });
}

// Check soak test results table
const [soakRows] = await conn.execute(`SELECT COUNT(*) as cnt FROM dime_soak_test_results`);
console.log(`  [SOAK] dime_soak_test_results        | rows=${soakRows[0].cnt}`);

console.log('');
if (allPass) {
  console.log('████████████████████████████████████████████████████████████████████████████████');
  console.log('██  BLOCK 3 VERDICT: ALL P0 TABLES INTACT — SOAK DID NOT CORRUPT DATA        ██');
  console.log('████████████████████████████████████████████████████████████████████████████████');
} else {
  console.log('████████████████████████████████████████████████████████████████████████████████');
  console.log('██  BLOCK 3 VERDICT: P0 DEGRADATION DETECTED — INVESTIGATE IMMEDIATELY       ██');
  console.log('████████████████████████████████████████████████████████████████████████████████');
}

console.log('');
console.log('[P0_RESULTS_JSON]');
console.log(JSON.stringify({ timestamp: new Date().toISOString(), allPass, results }, null, 2));

await conn.end();
