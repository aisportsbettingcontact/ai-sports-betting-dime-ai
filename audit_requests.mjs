import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log('═══════════════════════════════════════════════════════════════');
console.log('[INPUT] Auditing all bet_edit_requests in DB...');
console.log('═══════════════════════════════════════════════════════════════');

const [rows] = await conn.execute(`
  SELECT ber.id, ber.betId, ber.requestType, ber.status, ber.reason,
         au_req.username as requester, au_rev.username as reviewer,
         ber.createdAt, ber.updatedAt
  FROM bet_edit_requests ber
  LEFT JOIN app_users au_req ON ber.requestedBy = au_req.id
  LEFT JOIN app_users au_rev ON ber.reviewedBy  = au_rev.id
  ORDER BY ber.status ASC, ber.id ASC
`);

console.log(`[STATE] Total bet_edit_requests: ${rows.length}`);
for (const r of rows) {
  console.log(`  [ROW] id=${r.id} betId=${r.betId} type=${r.requestType} status=${r.status} reason="${r.reason}" requester=@${r.requester} reviewer=${r.reviewer ? '@'+r.reviewer : 'null'} created=${r.createdAt}`);
}

const byStatus = {};
for (const r of rows) { byStatus[r.status] = (byStatus[r.status]||0)+1; }
console.log('[STATE] Breakdown by status:', JSON.stringify(byStatus));

// Show APPROVED ones specifically — these are the ones to clean up
const approved = rows.filter(r => r.status === 'APPROVED');
const denied   = rows.filter(r => r.status === 'DENIED');
const pending  = rows.filter(r => r.status === 'PENDING');

console.log(`\n[OUTPUT] APPROVED (to clean up): ${approved.length}`);
for (const r of approved) {
  console.log(`  betId=${r.betId} requestId=${r.id} reason="${r.reason}"`);
}

console.log(`[OUTPUT] DENIED (to keep): ${denied.length}`);
for (const r of denied) {
  console.log(`  betId=${r.betId} requestId=${r.id} reason="${r.reason}"`);
}

console.log(`[OUTPUT] PENDING (still open): ${pending.length}`);
for (const r of pending) {
  console.log(`  betId=${r.betId} requestId=${r.id} reason="${r.reason}"`);
}

// Check if the APPROVED bets still exist in tracked_bets
if (approved.length > 0) {
  const approvedBetIds = approved.map(r => r.betId);
  const [existCheck] = await conn.execute(
    `SELECT id FROM tracked_bets WHERE id IN (${approvedBetIds.join(',')})`
  );
  console.log(`\n[VERIFY] APPROVED bet IDs still in tracked_bets: ${existCheck.map(r=>r.id).join(', ') || 'NONE (already deleted)'}`);
}

await conn.end();
console.log('\n[VERIFY] PASS — audit complete');
