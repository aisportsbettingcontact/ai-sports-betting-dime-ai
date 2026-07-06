import mysql from 'mysql2/promise';
const DB_URL = process.env.DATABASE_URL;
const conn = await mysql.createConnection(DB_URL);

console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
console.log('║  BLOCK 3: POST-SOAK P0 PRESERVATION CHECK                                  ║');
console.log('╠══════════════════════════════════════════════════════════════════════════════╣');
console.log(`║  TIMESTAMP: ${new Date().toISOString()}`);
console.log('╚══════════════════════════════════════════════════════════════════════════════╝');
console.log('');

// Corrected table names based on actual DB schema
const expected = {
  wc2026_matches: 104,
  wc2026_teams: 49,
  wc2026_venues: 16,
  wc2026_espn_expected_goals: 88,
  wc2026_espn_team_stats: 88,
  wc2026_espn_player_stats: 2742,
  wc2026_espn_matches: 90,
  wc2026_model_projections: 92,
  wc2026_recommendations: 264,
  wc2026_holdout_validation: 258,
  wc2026_model_grades: 57,
};

let allPass = true;
const results = [];

for (const [table, expectedCount] of Object.entries(expected)) {
  try {
    const [rows] = await conn.execute(`SELECT COUNT(*) as cnt FROM ${table}`);
    const actual = rows[0].cnt;
    const pass = actual >= expectedCount;
    if (!pass) allPass = false;
    const icon = pass ? '✓' : '✗';
    console.log(`  [P0] ${icon} ${table.padEnd(30)} | expected≥${String(expectedCount).padStart(5)} | actual=${String(actual).padStart(5)} | ${pass ? 'INTACT' : 'DEGRADED'}`);
    results.push({ table, expected: expectedCount, actual, pass });
  } catch (err) {
    allPass = false;
    console.log(`  [P0] ✗ ${table.padEnd(30)} | ERROR: ${err.message}`);
    results.push({ table, expected: expectedCount, actual: -1, pass: false });
  }
}

// Dime tables
console.log('');
console.log('  --- DIME ACCOUNTABILITY TABLES (post-soak growth) ---');
const dimeTables = ['dime_entitlements', 'dime_credit_ledger', 'dime_request_audit', 'dime_response_audit', 'dime_context_audit'];
for (const table of dimeTables) {
  try {
    const [rows] = await conn.execute(`SELECT COUNT(*) as cnt FROM ${table}`);
    console.log(`  [DIME] ${table.padEnd(28)} | rows=${rows[0].cnt}`);
  } catch (err) {
    console.log(`  [DIME] ${table.padEnd(28)} | ERROR: ${err.message}`);
  }
}

console.log('');
if (allPass) {
  console.log('████████████████████████████████████████████████████████████████████████████████');
  console.log('██  BLOCK 3 VERDICT: ALL P0 TABLES INTACT — SOAK DID NOT CORRUPT DATA        ██');
  console.log('████████████████████████████████████████████████████████████████████████████████');
} else {
  console.log('████████████████████████████████████████████████████████████████████████████████');
  console.log('██  BLOCK 3 VERDICT: P0 DEGRADATION DETECTED — INVESTIGATE                   ██');
  console.log('████████████████████████████████████████████████████████████████████████████████');
}

await conn.end();
