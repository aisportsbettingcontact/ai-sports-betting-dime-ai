/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║  AUDIT LAYER 4: AUDIT TRAIL INTEGRITY                                        ║
 * ║  Cross-reference request/response/context audit tables                        ║
 * ║  Verify completeness, consistency, and referential integrity                  ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 */
import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const db = await mysql.createConnection({ uri: process.env.DATABASE_URL, connectTimeout: 15000 });
let pass = 0, fail = 0;

function gate(name, cond, ev) {
  const s = cond ? 'PASS' : 'FAIL';
  if (cond) pass++; else fail++;
  console.log(`[LAYER4] [${s}] ${cond ? '✓' : '✗'} GATE: ${name} | ${JSON.stringify(ev)}`);
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('AUDIT LAYER 4: AUDIT TRAIL INTEGRITY — CROSS-REFERENCE VERIFICATION');
console.log(`TIMESTAMP: ${new Date().toISOString()}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

// Get counts
const [reqRows] = await db.execute('SELECT COUNT(*) as cnt FROM dime_request_audit');
const [respRows] = await db.execute('SELECT COUNT(*) as cnt FROM dime_response_audit');
const [ctxRows] = await db.execute('SELECT COUNT(*) as cnt FROM dime_context_audit');
console.log(`\n  Request audit: ${reqRows[0].cnt} rows`);
console.log(`  Response audit: ${respRows[0].cnt} rows`);
console.log(`  Context audit: ${ctxRows[0].cnt} rows`);

// ═══ SECTION 1: EVERY RESPONSE HAS A REQUEST ═══
console.log('\n╔═══ SECTION 1: RESPONSE → REQUEST REFERENTIAL INTEGRITY ═══╗');
const [orphanResp] = await db.execute(`
  SELECT COUNT(*) as cnt FROM dime_response_audit ra
  WHERE NOT EXISTS (SELECT 1 FROM dime_request_audit rq WHERE rq.request_id = ra.request_id)
`);
gate('REF.response_has_request', Number(orphanResp[0].cnt) === 0, { orphan_responses: orphanResp[0].cnt });

// ═══ SECTION 2: EVERY CONTEXT HAS A REQUEST ═══
console.log('\n╔═══ SECTION 2: CONTEXT → REQUEST REFERENTIAL INTEGRITY ═══╗');
const [orphanCtx] = await db.execute(`
  SELECT COUNT(*) as cnt FROM dime_context_audit ca
  WHERE NOT EXISTS (SELECT 1 FROM dime_request_audit rq WHERE rq.request_id = ca.request_id)
`);
gate('REF.context_has_request', Number(orphanCtx[0].cnt) === 0, { orphan_contexts: orphanCtx[0].cnt });

// ═══ SECTION 3: RESPONSE AND CONTEXT COUNTS MATCH ═══
console.log('\n╔═══ SECTION 3: RESPONSE-CONTEXT PARITY ═══╗');
gate('PARITY.response_equals_context', Number(respRows[0].cnt) === Number(ctxRows[0].cnt), {
  response_count: respRows[0].cnt, context_count: ctxRows[0].cnt
});

// ═══ SECTION 4: EVERY RESPONSE HAS MATCHING CONTEXT (same request_id) ═══
console.log('\n╔═══ SECTION 4: RESPONSE-CONTEXT MATCHING ═══╗');
const [respNoCtx] = await db.execute(`
  SELECT COUNT(*) as cnt FROM dime_response_audit ra
  WHERE NOT EXISTS (SELECT 1 FROM dime_context_audit ca WHERE ca.request_id = ra.request_id)
`);
gate('MATCH.response_has_context', Number(respNoCtx[0].cnt) === 0, { responses_without_context: respNoCtx[0].cnt });

// ═══ SECTION 5: REQUEST_ID UNIQUENESS ═══
console.log('\n╔═══ SECTION 5: REQUEST_ID UNIQUENESS ═══╗');
const [dupReq] = await db.execute(`
  SELECT request_id, COUNT(*) as cnt FROM dime_request_audit GROUP BY request_id HAVING cnt > 1
`);
gate('UNIQUE.request_audit_ids', dupReq.length === 0, { duplicate_request_ids: dupReq.length, samples: dupReq.slice(0,3).map(r => r.request_id) });

const [dupResp] = await db.execute(`
  SELECT request_id, COUNT(*) as cnt FROM dime_response_audit GROUP BY request_id HAVING cnt > 1
`);
gate('UNIQUE.response_audit_ids', dupResp.length === 0, { duplicate_response_ids: dupResp.length });

const [dupCtx] = await db.execute(`
  SELECT request_id, COUNT(*) as cnt FROM dime_context_audit GROUP BY request_id HAVING cnt > 1
`);
gate('UNIQUE.context_audit_ids', dupCtx.length === 0, { duplicate_context_ids: dupCtx.length });

// ═══ SECTION 6: CREDITS_CHARGED CONSISTENCY ═══
console.log('\n╔═══ SECTION 6: CREDITS_CHARGED CONSISTENCY ═══╗');
// Response audit credits_charged=1 should match credit_ledger entries
const [respCharged] = await db.execute(`SELECT COUNT(*) as cnt FROM dime_response_audit WHERE credits_charged = 1`);
const [ledgerCharges] = await db.execute(`SELECT COUNT(*) as cnt FROM dime_credit_ledger WHERE delta_credits = -1`);
gate('CONSISTENCY.response_charged_equals_ledger', Number(respCharged[0].cnt) === Number(ledgerCharges[0].cnt), {
  response_charged: respCharged[0].cnt, ledger_charges: ledgerCharges[0].cnt
});

// ═══ SECTION 7: AUTH STATUS DISTRIBUTION ═══
console.log('\n╔═══ SECTION 7: AUTH STATUS DISTRIBUTION ═══╗');
const [authDist] = await db.execute(`SELECT auth_status, COUNT(*) as cnt FROM dime_request_audit GROUP BY auth_status`);
console.log('  Auth status distribution:');
for (const row of authDist) {
  console.log(`    ${row.auth_status}: ${row.cnt}`);
}
gate('DIST.auth_statuses_valid', authDist.every(r => ['PASSED', 'FAILED', 'NO_TOKEN', 'INVALID_TOKEN', 'USER_NOT_FOUND'].includes(r.auth_status)), {
  statuses: authDist.map(r => r.auth_status)
});

// ═══ SECTION 8: RESPONSE MODE DISTRIBUTION ═══
console.log('\n╔═══ SECTION 8: RESPONSE MODE DISTRIBUTION ═══╗');
const [modeDist] = await db.execute(`SELECT response_mode, COUNT(*) as cnt FROM dime_response_audit GROUP BY response_mode`);
console.log('  Response mode distribution:');
for (const row of modeDist) {
  console.log(`    ${row.response_mode}: ${row.cnt}`);
}
gate('DIST.response_modes_valid', modeDist.every(r => ['ANSWER', 'REFUSE', 'INTERNAL_ERROR', 'PASS_NO_BET'].includes(r.response_mode)), {
  modes: modeDist.map(r => r.response_mode)
});

// ═══ SECTION 9: CONTEXT HASH CONSISTENCY ═══
console.log('\n╔═══ SECTION 9: CONTEXT HASH CONSISTENCY ═══╗');
const [nullHash] = await db.execute(`SELECT COUNT(*) as cnt FROM dime_context_audit WHERE context_hash IS NULL OR context_hash = ''`);
gate('HASH.all_contexts_hashed', Number(nullHash[0].cnt) === 0, { null_hashes: nullHash[0].cnt });

// ═══ SECTION 10: TEMPORAL CONSISTENCY ═══
console.log('\n╔═══ SECTION 10: TEMPORAL CONSISTENCY ═══╗');
// Response should not be created before its request
const [timeViolation] = await db.execute(`
  SELECT COUNT(*) as cnt FROM dime_response_audit ra
  JOIN dime_request_audit rq ON rq.request_id = ra.request_id
  WHERE ra.created_at < rq.created_at
`);
gate('TEMPORAL.response_after_request', Number(timeViolation[0].cnt) === 0, { violations: timeViolation[0].cnt });

// ═══ SECTION 11: NULL FIELD DETECTION ═══
console.log('\n╔═══ SECTION 11: CRITICAL NULL FIELD DETECTION ═══╗');
const [nullUserId] = await db.execute(`SELECT COUNT(*) as cnt FROM dime_request_audit WHERE user_id IS NULL OR user_id = ''`);
gate('NULL.no_null_user_ids', Number(nullUserId[0].cnt) === 0, { null_user_ids: nullUserId[0].cnt });

const [nullReqId] = await db.execute(`SELECT COUNT(*) as cnt FROM dime_request_audit WHERE request_id IS NULL OR request_id = ''`);
gate('NULL.no_null_request_ids', Number(nullReqId[0].cnt) === 0, { null_request_ids: nullReqId[0].cnt });

// FINAL
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`LAYER 4 FINAL VERDICT: ${pass}/${pass + fail} GATES PASS | ${fail} FAILURES`);
console.log(`OVERALL: ${fail === 0 ? '✓ LAYER 4 CERTIFIED' : '✗ LAYER 4 HAS FAILURES'}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

await db.end();
process.exit(fail > 0 ? 1 : 0);
