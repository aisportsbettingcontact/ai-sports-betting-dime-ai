/**
 * CLEANUP: Remove all APPROVED bet_edit_requests
 * ================================================
 * The corresponding bets have already been deleted from tracked_bets.
 * This removes the orphaned APPROVED request rows.
 * The single DENIED request (id=4, betId=150102) is preserved.
 *
 * APPROVED request IDs to delete: 1, 2, 3, 5, 6, 7, 30001, 60001
 * DENIED request to keep: id=4, betId=150102
 */

import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log('═══════════════════════════════════════════════════════════════');
console.log('[INPUT] Cleaning up APPROVED bet_edit_requests...');
console.log('[INPUT] Preserving DENIED request id=4 (betId=150102)');
console.log('═══════════════════════════════════════════════════════════════\n');

// ─── STEP 1: Verify pre-state ─────────────────────────────────────────────────
const [preCounts] = await conn.execute(
  `SELECT status, COUNT(*) as cnt FROM bet_edit_requests GROUP BY status`
);
console.log('[STEP 1] Pre-cleanup counts:');
for (const r of preCounts) {
  console.log(`  [STATE] ${r.status}: ${r.cnt} rows`);
}

// ─── STEP 2: Verify the DENIED row exists and is correct ─────────────────────
const [deniedCheck] = await conn.execute(
  `SELECT id, betId, status, reason FROM bet_edit_requests WHERE status = 'DENIED'`
);
console.log(`\n[STEP 2] DENIED rows (must keep all of these):`);
for (const r of deniedCheck) {
  console.log(`  [VERIFY] id=${r.id} betId=${r.betId} status=${r.status} reason="${r.reason}"`);
}
if (deniedCheck.length !== 1 || deniedCheck[0].id !== 4) {
  console.error(`[VERIFY] FAIL — unexpected DENIED state. Aborting.`);
  await conn.end();
  process.exit(1);
}
console.log(`[VERIFY] PASS — exactly 1 DENIED row confirmed (id=4, betId=150102)`);

// ─── STEP 3: Delete all APPROVED rows ─────────────────────────────────────────
console.log(`\n[STEP 3] Deleting all APPROVED bet_edit_requests...`);
const [deleteResult] = await conn.execute(
  `DELETE FROM bet_edit_requests WHERE status = 'APPROVED'`
);
console.log(`[OUTPUT] Deleted ${deleteResult.affectedRows} APPROVED request rows`);

// ─── STEP 4: Verify post-state ────────────────────────────────────────────────
const [postRows] = await conn.execute(
  `SELECT id, betId, requestType, status, reason FROM bet_edit_requests ORDER BY id ASC`
);
console.log(`\n[STEP 4] Post-cleanup state — total rows remaining: ${postRows.length}`);
for (const r of postRows) {
  console.log(`  [ROW] id=${r.id} betId=${r.betId} type=${r.requestType} status=${r.status} reason="${r.reason}"`);
}

// ─── STEP 5: Final validation ─────────────────────────────────────────────────
const approvedRemaining = postRows.filter(r => r.status === 'APPROVED').length;
const deniedRemaining   = postRows.filter(r => r.status === 'DENIED').length;
const pendingRemaining  = postRows.filter(r => r.status === 'PENDING').length;

console.log(`\n[VERIFY] APPROVED remaining: ${approvedRemaining} (expected: 0)`);
console.log(`[VERIFY] DENIED remaining:   ${deniedRemaining} (expected: 1)`);
console.log(`[VERIFY] PENDING remaining:  ${pendingRemaining} (expected: 0)`);

if (approvedRemaining !== 0 || deniedRemaining !== 1) {
  console.error(`[VERIFY] FAIL — unexpected post-cleanup state`);
  await conn.end();
  process.exit(1);
}

console.log(`\n[VERIFY] PASS — cleanup complete. DB is clean.`);
console.log(`  ✓ All 8 APPROVED requests removed`);
console.log(`  ✓ DENIED request id=4 (betId=150102, "money") preserved`);

await conn.end();
