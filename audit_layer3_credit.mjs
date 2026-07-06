/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║  AUDIT LAYER 3: CREDIT ACCOUNTING — DEEP LEDGER VERIFICATION                ║
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
  console.log(`[LAYER3] [${s}] ${cond ? '✓' : '✗'} GATE: ${name} | ${JSON.stringify(ev)}`);
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('AUDIT LAYER 3: CREDIT ACCOUNTING — DEEP LEDGER VERIFICATION');
console.log(`TIMESTAMP: ${new Date().toISOString()}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

// 1. Full ledger dump
const [ledger] = await db.execute('SELECT id, user_id, request_id, delta_credits, balance_after, reason, created_at FROM dime_credit_ledger ORDER BY id ASC');
console.log('\n╔═══ SECTION 1: LEDGER COMPLETENESS ═══╗');
console.log(`  Total rows: ${ledger.length}`);
gate('LEDGER.has_rows', ledger.length > 0, { count: ledger.length });

// 2. Balance chain verification
console.log('\n╔═══ SECTION 2: BALANCE CHAIN CONTINUITY ═══╗');
let chainBreaks = [];
let prevBal = {};
for (const row of ledger) {
  const uid = row.user_id;
  const delta = Number(row.delta_credits);
  const balAfter = Number(row.balance_after);
  if (prevBal[uid] !== undefined) {
    const expected = prevBal[uid] + delta;
    if (expected !== balAfter) {
      chainBreaks.push({ id: row.id, uid, prev: prevBal[uid], delta, expected, actual: balAfter });
    }
  }
  prevBal[uid] = balAfter;
}
gate('CHAIN.zero_breaks', chainBreaks.length === 0, { breaks: chainBreaks.length, details: chainBreaks.slice(0, 3) });

// 3. Negative balance check
console.log('\n╔═══ SECTION 3: NO NEGATIVE BALANCES ═══╗');
const negRows = ledger.filter(r => Number(r.balance_after) < 0);
gate('BALANCE.no_negatives', negRows.length === 0, { negative_rows: negRows.length });

// 4. No multi-charge
console.log('\n╔═══ SECTION 4: NO MULTI-CHARGE ═══╗');
const multiCharge = ledger.filter(r => Number(r.delta_credits) < -1);
gate('CHARGE.no_multi_deduct', multiCharge.length === 0, { multi_charge_rows: multiCharge.length });

// 5. Every charge has a request_id
console.log('\n╔═══ SECTION 5: CHARGE-REQUEST LINKAGE ═══╗');
const chargesNoReqId = ledger.filter(r => Number(r.delta_credits) === -1 && (r.request_id === null || r.request_id === ''));
gate('LINKAGE.all_charges_have_request_id', chargesNoReqId.length === 0, { orphan_charges: chargesNoReqId.length });

// 6. No duplicate request_ids
console.log('\n╔═══ SECTION 6: NO DUPLICATE CHARGES ═══╗');
const chargeReqIds = ledger.filter(r => Number(r.delta_credits) === -1 && r.request_id).map(r => r.request_id);
const uniqueReqIds = new Set(chargeReqIds);
gate('DEDUP.no_double_charge', chargeReqIds.length === uniqueReqIds.size, {
  total_charges: chargeReqIds.length,
  unique_request_ids: uniqueReqIds.size,
  duplicates: chargeReqIds.length - uniqueReqIds.size
});

// 7. Balance arithmetic
console.log('\n╔═══ SECTION 7: BALANCE ARITHMETIC ═══╗');
const totalCharges = ledger.filter(r => Number(r.delta_credits) === -1).length;
const totalGrants = ledger.filter(r => Number(r.delta_credits) > 0).reduce((s, r) => s + Number(r.delta_credits), 0);
const currentBalance = Number(ledger[ledger.length - 1]?.balance_after ?? 0);
const firstRow = ledger[0];
const initialBalance = Number(firstRow?.balance_after) - Number(firstRow?.delta_credits);
console.log(`  Initial balance (derived): ${initialBalance}`);
console.log(`  Total charges (delta=-1): ${totalCharges}`);
console.log(`  Total grants (delta>0): ${totalGrants}`);
console.log(`  Current balance: ${currentBalance}`);
console.log(`  Expected: ${initialBalance} - ${totalCharges} + ${totalGrants} = ${initialBalance - totalCharges + totalGrants}`);
gate('ARITHMETIC.balance_correct', initialBalance - totalCharges + totalGrants === currentBalance, {
  initial: initialBalance, charges: totalCharges, grants: totalGrants,
  expected: initialBalance - totalCharges + totalGrants, actual: currentBalance
});

// 8. Phantom charge detection
console.log('\n╔═══ SECTION 8: PHANTOM CHARGE DETECTION ═══╗');
const [phantoms] = await db.execute(`
  SELECT cl.id, cl.request_id FROM dime_credit_ledger cl
  WHERE cl.delta_credits = -1 AND cl.request_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM dime_response_audit ra WHERE ra.request_id = cl.request_id AND ra.credits_charged = 1)
`);
gate('PHANTOM.no_charges_without_response', phantoms.length === 0, {
  phantom_count: phantoms.length,
  sample: phantoms.slice(0, 5).map(p => p.request_id)
});

// 9. Temporal ordering (charges must be chronological)
console.log('\n╔═══ SECTION 9: TEMPORAL ORDERING ═══╗');
let outOfOrder = 0;
for (let i = 1; i < ledger.length; i++) {
  if (new Date(ledger[i].created_at) < new Date(ledger[i - 1].created_at)) {
    outOfOrder++;
  }
}
gate('TEMPORAL.chronological', outOfOrder === 0, { out_of_order_rows: outOfOrder });

// 10. Reason field populated for all rows
console.log('\n╔═══ SECTION 10: REASON FIELD COMPLETENESS ═══╗');
const noReason = ledger.filter(r => !r.reason || r.reason.trim() === '');
gate('REASON.all_populated', noReason.length === 0, { missing_reason: noReason.length });

// FINAL
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`LAYER 3 FINAL VERDICT: ${pass}/${pass + fail} GATES PASS | ${fail} FAILURES`);
console.log(`OVERALL: ${fail === 0 ? '✓ LAYER 3 CERTIFIED' : '✗ LAYER 3 HAS FAILURES'}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

await db.end();
process.exit(fail > 0 ? 1 : 0);
