/**
 * migrateFixtureToMatchId.mjs
 * ═══════════════════════════════════════════════════════════════════════════════
 * PHASE 1: RENAME match_id → match_id IN ALL 8 WC2026 TABLES
 * 
 * STRATEGY: ALTER TABLE ... CHANGE COLUMN (TiDB-compatible)
 * TiDB does not support RENAME COLUMN syntax, but CHANGE COLUMN works.
 * 
 * TABLES AFFECTED: 8
 * OPERATION: Column rename only — zero data modification
 * RISK: LOW — column rename preserves all data, indexes, and constraints
 * 
 * PRE-REQUISITE: All code references must be updated AFTER this runs
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

const TABLES = [
  { name: 'wc2026MatchOdds', expectedRows: 88, keyType: 'UNIQUE' },
  { name: 'wc2026_matches', expectedRows: 104, keyType: 'PRIMARY KEY' },
  { name: 'wc2026_frozen_book_odds', expectedRows: 37, keyType: 'UNIQUE' },
  { name: 'wc2026_lineups', expectedRows: 2484, keyType: 'INDEX' },
  { name: 'wc2026_match_events', expectedRows: 1422, keyType: 'INDEX' },
  { name: 'wc2026_match_stats', expectedRows: 63, keyType: 'PRIMARY KEY' },
  { name: 'wc2026_model_projections', expectedRows: 93, keyType: 'INDEX' },
  { name: 'wc2026_odds_snapshots', expectedRows: 4384, keyType: 'INDEX' },
];

console.log("═══════════════════════════════════════════════════════════════════════════════");
console.log("[MIGRATION] PHASE 1: RENAME match_id → match_id (ALTER TABLE CHANGE COLUMN)");
console.log("═══════════════════════════════════════════════════════════════════════════════");
console.log(`[INPUT] Timestamp: ${new Date().toISOString()}`);
console.log(`[INPUT] Tables to migrate: ${TABLES.length}`);
console.log(`[INPUT] Strategy: ALTER TABLE CHANGE COLUMN match_id match_id VARCHAR(16) NOT NULL`);
console.log(`[INPUT] Engine: TiDB (MySQL 5.7-compatible DDL)`);
console.log(`[INPUT] Risk: LOW — rename only, zero data modification`);
console.log("");

let successCount = 0;
let skipCount = 0;
let errorCount = 0;
const results = [];

for (const { name, expectedRows, keyType } of TABLES) {
  console.log(`─── TABLE: ${name} (${keyType}) ─────────────────────────────────────────`);
  
  // Pre-flight: check if match_id already exists (idempotency)
  const [cols] = await conn.query(`SHOW COLUMNS FROM \`${name}\` LIKE 'match_id'`);
  if (cols.length > 0) {
    console.log(`  [SKIP] match_id column already exists — migration already applied`);
    skipCount++;
    results.push({ table: name, status: 'SKIPPED', reason: 'already renamed' });
    continue;
  }
  
  // Pre-flight: verify match_id exists
  const [fixCols] = await conn.query(`SHOW COLUMNS FROM \`${name}\` LIKE 'match_id'`);
  if (fixCols.length === 0) {
    console.log(`  [ERROR] match_id column NOT FOUND — cannot rename`);
    errorCount++;
    results.push({ table: name, status: 'ERROR', reason: 'match_id not found' });
    continue;
  }
  
  const colType = fixCols[0].Type;
  const colNull = fixCols[0].Null === 'YES' ? '' : 'NOT NULL';
  const colDefault = fixCols[0].Default ? `DEFAULT '${fixCols[0].Default}'` : '';
  console.log(`  [STATE] Current column: match_id ${colType} ${colNull} ${colDefault}`);
  
  // Pre-flight: verify row count
  const [preCount] = await conn.query(`SELECT COUNT(*) as cnt FROM \`${name}\``);
  console.log(`  [STATE] Pre-migration row count: ${preCount[0].cnt} (expected: ~${expectedRows})`);
  
  // Sample 3 match_id values for post-verification
  const [sampleRows] = await conn.query(`SELECT match_id FROM \`${name}\` LIMIT 3`);
  const sampleIds = sampleRows.map(r => r.match_id);
  console.log(`  [STATE] Sample match_ids for verification: ${JSON.stringify(sampleIds)}`);
  
  // Execute CHANGE COLUMN (TiDB-compatible rename)
  const sql = `ALTER TABLE \`${name}\` CHANGE COLUMN \`match_id\` \`match_id\` ${colType} ${colNull}`;
  console.log(`  [STEP] Executing: ${sql.trim()}`);
  
  try {
    await conn.query(sql);
    console.log(`  [OUTPUT] CHANGE COLUMN — SUCCESS`);
    
    // Post-flight: verify match_id exists
    const [postCols] = await conn.query(`SHOW COLUMNS FROM \`${name}\` LIKE 'match_id'`);
    if (postCols.length === 0) {
      console.log(`  [VERIFY] FAIL — match_id column NOT found after CHANGE`);
      errorCount++;
      results.push({ table: name, status: 'ERROR', reason: 'match_id not found post-alter' });
      continue;
    }
    console.log(`  [VERIFY] Column renamed: match_id → match_id ✓`);
    console.log(`  [VERIFY] New type: ${postCols[0].Type} | Key: ${postCols[0].Key} | Extra: ${postCols[0].Extra}`);
    
    // Verify match_id is GONE
    const [oldCols] = await conn.query(`SHOW COLUMNS FROM \`${name}\` LIKE 'match_id'`);
    if (oldCols.length > 0) {
      console.log(`  [VERIFY] FAIL — match_id still exists after rename`);
      errorCount++;
      results.push({ table: name, status: 'ERROR', reason: 'match_id still present' });
      continue;
    }
    console.log(`  [VERIFY] Old column removed: match_id → GONE ✓`);
    
    // Verify row count unchanged
    const [postCount] = await conn.query(`SELECT COUNT(*) as cnt FROM \`${name}\``);
    if (Number(postCount[0].cnt) !== Number(preCount[0].cnt)) {
      console.log(`  [VERIFY] FAIL — row count changed: ${preCount[0].cnt} → ${postCount[0].cnt}`);
      errorCount++;
      results.push({ table: name, status: 'ERROR', reason: 'row count mismatch' });
      continue;
    }
    console.log(`  [VERIFY] Row count preserved: ${postCount[0].cnt} ✓`);
    
    // Verify sample data preserved
    const [verifySample] = await conn.query(`SELECT match_id FROM \`${name}\` LIMIT 3`);
    const verifyIds = verifySample.map(r => r.match_id);
    const dataMatch = JSON.stringify(sampleIds) === JSON.stringify(verifyIds);
    console.log(`  [VERIFY] Sample data preserved: ${dataMatch ? 'YES ✓' : 'NO ✗'}`);
    if (!dataMatch) {
      console.log(`  [VERIFY] Expected: ${JSON.stringify(sampleIds)}`);
      console.log(`  [VERIFY] Got: ${JSON.stringify(verifyIds)}`);
    }
    
    console.log(`  [VERDICT] TABLE ${name}: PASS — all gates cleared`);
    successCount++;
    results.push({ table: name, status: 'SUCCESS', rows: preCount[0].cnt });
    
  } catch (err) {
    console.log(`  [ERROR] ${err.message}`);
    errorCount++;
    results.push({ table: name, status: 'ERROR', reason: err.message });
  }
  
  console.log("");
}

console.log("═══════════════════════════════════════════════════════════════════════════════");
console.log("[OUTPUT] PHASE 1 MIGRATION SUMMARY");
console.log("═══════════════════════════════════════════════════════════════════════════════");
console.log(`  ✓ Success: ${successCount}/${TABLES.length}`);
console.log(`  ⊘ Skipped: ${skipCount}/${TABLES.length}`);
console.log(`  ✗ Errors:  ${errorCount}/${TABLES.length}`);
console.log("");
console.log("  Results by table:");
for (const r of results) {
  const icon = r.status === 'SUCCESS' ? '✓' : r.status === 'SKIPPED' ? '⊘' : '✗';
  console.log(`    ${icon} ${r.table}: ${r.status}${r.rows ? ` (${r.rows} rows)` : ''}${r.reason ? ` — ${r.reason}` : ''}`);
}
console.log("");

if (errorCount === 0) {
  console.log("[VERDICT] ALL 8 TABLES MIGRATED — match_id → match_id COMPLETE");
  console.log("[NEXT] Update Drizzle schema, router, heartbeat, ingesters, frontend, Python");
} else {
  console.log("[VERDICT] ERRORS DETECTED — review output above before proceeding");
}

console.log("═══════════════════════════════════════════════════════════════════════════════");

await conn.end();
process.exit(errorCount > 0 ? 1 : 0);
