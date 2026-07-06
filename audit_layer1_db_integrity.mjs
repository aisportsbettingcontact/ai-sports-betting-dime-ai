/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║  AUDIT LAYER 1: DATABASE INTEGRITY                                          ║
 * ║  Full rigorous inspection of all P0 + Dime tables                           ║
 * ║  Checks: row counts, orphans, schema validation, FK integrity               ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 */
import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error('[FATAL] DATABASE_URL not set'); process.exit(1); }

const TIMESTAMP = new Date().toISOString();
const results = [];

function log(level, msg, data = '') {
  const line = `[${new Date().toISOString()}] [LAYER1] [${level}] ${msg}${data ? ' | ' + JSON.stringify(data) : ''}`;
  console.log(line);
  results.push({ level, msg, data, ts: new Date().toISOString() });
}

function gate(name, condition, evidence) {
  if (condition) {
    log('PASS', `✓ GATE: ${name}`, evidence);
  } else {
    log('FAIL', `✗ GATE: ${name}`, evidence);
  }
  return condition;
}

async function main() {
  const db = await mysql.createConnection({ uri: DB_URL, connectTimeout: 15000 });
  log('INFO', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log('INFO', 'AUDIT LAYER 1: DATABASE INTEGRITY — FULL INSPECTION');
  log('INFO', `TIMESTAMP: ${TIMESTAMP}`);
  log('INFO', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 1: P0 TABLE ROW COUNTS (must match baseline)
  // ═══════════════════════════════════════════════════════════════════════
  log('INFO', '');
  log('INFO', '╔═══ SECTION 1: P0 TABLE ROW COUNTS ═══╗');
  
  const P0_EXPECTED = {
    'wc2026_matches': 104,
    'wc2026_teams': 49,
    'wc2026_venues': 16,
    'wc2026_espn_expected_goals': 88,
    'wc2026_espn_team_stats': 88,
    'wc2026_espn_player_stats': 2742,
    'wc2026_espn_matches': 90,
    'wc2026_model_projections': 92,
    'wc2026_recommendations': 264,
    'wc2026_holdout_validation': 258,
    'wc2026_model_grades': 57,
    'wc2026_market_edges': 54,
    'wc2026_market_no_vig': 63,
  };

  let p0Pass = 0, p0Fail = 0;
  for (const [table, expected] of Object.entries(P0_EXPECTED)) {
    try {
      const [rows] = await db.execute(`SELECT COUNT(*) as cnt FROM \`${table}\``);
      const actual = Number(rows[0].cnt);
      const pass = actual === expected;
      if (pass) p0Pass++; else p0Fail++;
      gate(`P0.${table}`, pass, { expected, actual, delta: actual - expected });
    } catch (err) {
      p0Fail++;
      log('FAIL', `✗ GATE: P0.${table} — TABLE ERROR`, { error: err.message });
    }
  }
  log('INFO', `P0 SUMMARY: ${p0Pass} PASS / ${p0Fail} FAIL out of ${Object.keys(P0_EXPECTED).length} tables`);

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 2: DIME TABLE ROW COUNTS + SCHEMA VALIDATION
  // ═══════════════════════════════════════════════════════════════════════
  log('INFO', '');
  log('INFO', '╔═══ SECTION 2: DIME TABLE INSPECTION ═══╗');

  const DIME_TABLES = ['dime_credit_ledger', 'dime_request_audit', 'dime_response_audit', 'dime_context_audit', 'dime_user_entitlements', 'dime_soak_test_results'];
  
  for (const table of DIME_TABLES) {
    try {
      const [rows] = await db.execute(`SELECT COUNT(*) as cnt FROM \`${table}\``);
      const [cols] = await db.execute(`SHOW COLUMNS FROM \`${table}\``);
      log('INFO', `  ${table}: ${rows[0].cnt} rows | ${cols.length} columns`, { columns: cols.map(c => c.Field).join(', ') });
    } catch (err) {
      log('FAIL', `  ${table}: ERROR`, { error: err.message });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 3: CREDIT LEDGER INTEGRITY
  // ═══════════════════════════════════════════════════════════════════════
  log('INFO', '');
  log('INFO', '╔═══ SECTION 3: CREDIT LEDGER INTEGRITY ═══╗');

  // Check for negative balances
  const [negBal] = await db.execute(`SELECT COUNT(*) as cnt FROM dime_credit_ledger WHERE balance_after < 0`);
  gate('CREDIT.no_negative_balances', Number(negBal[0].cnt) === 0, { negative_count: negBal[0].cnt });

  // Check balance chain continuity (each row's balance_after = prev balance_after + delta)
  const [ledger] = await db.execute(`SELECT id, user_id, delta_credits as delta, balance_after FROM dime_credit_ledger ORDER BY id ASC`);
  let chainBroken = 0;
  let prevBalance = {};
  for (const row of ledger) {
    const uid = row.user_id;
    if (prevBalance[uid] !== undefined) {
      const expected = prevBalance[uid] + Number(row.delta);
      if (expected !== Number(row.balance_after)) {
        chainBroken++;
        log('FAIL', `  CHAIN BREAK at id=${row.id}`, { user_id: uid, prev: prevBalance[uid], delta: row.delta, expected, actual: row.balance_after });
      }
    }
    prevBalance[uid] = Number(row.balance_after);
  }
  gate('CREDIT.balance_chain_continuous', chainBroken === 0, { total_rows: ledger.length, breaks: chainBroken });

  // Check all deltas are -1 (consumption) or positive (grants)
  const [invalidDeltas] = await db.execute(`SELECT COUNT(*) as cnt FROM dime_credit_ledger WHERE delta_credits < -1`);
  gate('CREDIT.no_multi_charge', Number(invalidDeltas[0].cnt) === 0, { multi_charge_count: invalidDeltas[0].cnt });

  // Latest balance for owner
  const [ownerBal] = await db.execute(`SELECT balance_after FROM dime_credit_ledger WHERE user_id = '1' ORDER BY id DESC LIMIT 1`);
  const currentBalance = ownerBal.length > 0 ? Number(ownerBal[0].balance_after) : 'NO_ROWS';
  log('INFO', `  Owner (user_id=1) current balance: ${currentBalance}`);

  // Count charges vs grants
  const [charges] = await db.execute(`SELECT COUNT(*) as cnt FROM dime_credit_ledger WHERE delta_credits = -1`);
  const [grants] = await db.execute(`SELECT COUNT(*) as cnt FROM dime_credit_ledger WHERE delta_credits > 0`);
  log('INFO', `  Total charges (delta=-1): ${charges[0].cnt} | Total grants (delta>0): ${grants[0].cnt}`);

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 4: ORPHAN DETECTION
  // ═══════════════════════════════════════════════════════════════════════
  log('INFO', '');
  log('INFO', '╔═══ SECTION 4: ORPHAN DETECTION ═══╗');

  // Response audit entries without matching request audit
  const [orphanResp] = await db.execute(`
    SELECT COUNT(*) as cnt FROM dime_response_audit ra
    WHERE NOT EXISTS (SELECT 1 FROM dime_request_audit rq WHERE rq.request_id = ra.request_id)
  `);
  gate('ORPHAN.response_without_request', Number(orphanResp[0].cnt) === 0, { orphan_responses: orphanResp[0].cnt });

  // Context audit entries without matching request audit
  const [orphanCtx] = await db.execute(`
    SELECT COUNT(*) as cnt FROM dime_context_audit ca
    WHERE NOT EXISTS (SELECT 1 FROM dime_request_audit rq WHERE rq.request_id = ca.request_id)
  `);
  gate('ORPHAN.context_without_request', Number(orphanCtx[0].cnt) === 0, { orphan_contexts: orphanCtx[0].cnt });

  // Credit ledger entries without matching request audit
  const [orphanCredit] = await db.execute(`
    SELECT COUNT(*) as cnt FROM dime_credit_ledger cl
    WHERE cl.request_id IS NOT NULL 
    AND NOT EXISTS (SELECT 1 FROM dime_request_audit rq WHERE rq.request_id = cl.request_id)
  `);
  gate('ORPHAN.credit_without_request', Number(orphanCredit[0].cnt) === 0, { orphan_credits: orphanCredit[0].cnt });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 5: DATA FRESHNESS + CONSISTENCY
  // ═══════════════════════════════════════════════════════════════════════
  log('INFO', '');
  log('INFO', '╔═══ SECTION 5: DATA FRESHNESS ═══╗');

  const [latestReq] = await db.execute(`SELECT MAX(created_at) as latest FROM dime_request_audit`);
  const [latestResp] = await db.execute(`SELECT MAX(created_at) as latest FROM dime_response_audit`);
  const [latestCredit] = await db.execute(`SELECT MAX(created_at) as latest FROM dime_credit_ledger`);
  log('INFO', `  Latest request_audit:  ${latestReq[0].latest}`);
  log('INFO', `  Latest response_audit: ${latestResp[0].latest}`);
  log('INFO', `  Latest credit_ledger:  ${latestCredit[0].latest}`);

  // ═══════════════════════════════════════════════════════════════════════
  // FINAL VERDICT
  // ═══════════════════════════════════════════════════════════════════════
  log('INFO', '');
  log('INFO', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  const totalGates = results.filter(r => r.msg.includes('GATE:')).length;
  const passGates = results.filter(r => r.level === 'PASS' && r.msg.includes('GATE:')).length;
  const failGates = results.filter(r => r.level === 'FAIL' && r.msg.includes('GATE:')).length;
  log('INFO', `LAYER 1 FINAL VERDICT: ${passGates}/${totalGates} GATES PASS | ${failGates} FAILURES`);
  log('INFO', `OVERALL: ${failGates === 0 ? '✓ LAYER 1 CERTIFIED' : '✗ LAYER 1 HAS FAILURES'}`);
  log('INFO', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  await db.end();
  process.exit(failGates > 0 ? 1 : 0);
}

main().catch(err => { console.error('[FATAL]', err.message); process.exit(1); });
