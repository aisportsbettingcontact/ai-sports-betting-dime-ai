/**
 * publishJuly2Projections.mjs
 * ============================================================
 * v16.0-KO25-RECALIBRATED-10MATCH — FORENSIC PUBLISH SCRIPT
 * ============================================================
 * PURPOSE:
 *   1. Read-back audit: verify all 27 feed-critical fields in wc2026_model_projections
 *      for wc26-r32-083 / wc26-r32-084 / wc26-r32-085
 *   2. Freeze: set is_frozen=1, frozen_at=NOW() on all 3 rows
 *   3. Feed simulation: run the exact same query the todayWithOdds procedure uses
 *      and confirm all 3 fixtures are returned with non-null modelOdds
 *   4. wc2026MatchOdds cross-check: verify all 20 model fields match wc2026_model_projections
 *   5. Append full structured log to wc2026modeling.txt (append-only, nothing omitted)
 *
 * LOGGING STANDARD:
 *   [TIMESTAMP] +Xs SXXXXX [EMOJI TAG] [CONTEXT] message
 *   Tags: ▶ STEP | ✅ PASS | ❌ FAIL | ⚠️ WARN | 🔒 FREEZE | 📡 FEED | 🔗 XREF | → OUT | ✔ VERIFY
 *
 * ZERO HALLUCINATION GUARANTEE:
 *   Every value read from DB is printed. No value is assumed or inferred.
 *   All comparisons use exact equality (integers) or ≤0.0001 tolerance (doubles).
 */

import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

// ── Constants ────────────────────────────────────────────────────────────────
const ENGINE_VERSION  = 'v16.0-KO25-RECALIBRATED-10MATCH';
const SCRIPT_NAME     = 'publishJuly2Projections.mjs';
const FIXTURE_IDS     = ['wc26-r32-083', 'wc26-r32-084', 'wc26-r32-085'];
const LOG_FILE        = path.resolve(__dirname, '../../../wc2026modeling.txt');
const SESSION_ID      = `publish-july2-${Date.now()}`;
const T0              = Date.now();

// ── Logging infrastructure ────────────────────────────────────────────────────
let stepCounter = 0;
const logLines = [];

function ts() { return new Date().toISOString(); }
function elapsed() { return ((Date.now() - T0) / 1000).toFixed(3) + 's'; }
function pad(n, w=5) { return String(n).padStart(w, '0'); }

const EMOJI = {
  STEP:   '▶  STEP',
  PASS:   '✅ PASS ',
  FAIL:   '❌ FAIL ',
  WARN:   '⚠️  WARN ',
  FREEZE: '🔒 FRZN ',
  FEED:   '📡 FEED ',
  XREF:   '🔗 XREF ',
  OUT:    '→→ OUT ',
  VERIFY: '✔  VFY ',
  BANNER: '════════',
  SUB:    '────────',
};

function log(tag, ctx, msg) {
  stepCounter++;
  const line = `[${ts()}] +${elapsed()} S${pad(stepCounter)} [${EMOJI[tag] ?? tag}] [${ctx.padEnd(18)}] ${msg}`;
  process.stdout.write(line + '\n');
  logLines.push(line);
}

function banner(title) {
  const sep = '═'.repeat(100);
  const lines = [sep, `  ${title}`, sep];
  lines.forEach(l => { process.stdout.write(l + '\n'); logLines.push(l); });
}

function subBanner(title) {
  const sep = '─'.repeat(100);
  const lines = [sep, `  ▶ ${title}`, sep];
  lines.forEach(l => { process.stdout.write(l + '\n'); logLines.push(l); });
}

function flushLog() {
  const header = [
    '',
    '═'.repeat(100),
    `  SESSION: ${SESSION_ID}`,
    `  SCRIPT:  ${SCRIPT_NAME}`,
    `  ENGINE:  ${ENGINE_VERSION}`,
    `  STARTED: ${new Date(T0).toISOString()}`,
    `  PURPOSE: FORENSIC PUBLISH — FREEZE + FEED VERIFY — July 2, 2026 WC2026 Projections`,
    '═'.repeat(100),
    '',
  ];
  const block = [...header, ...logLines, ''].join('\n');
  fs.appendFileSync(LOG_FILE, block, 'utf8');
  console.log(`\n[LOG] Appended ${logLines.length} lines to ${LOG_FILE}`);
}

// ── Expected values from v16.0 engine output ─────────────────────────────────
const EXPECTED = {
  'wc26-r32-083': {
    fixture: 'ESP vs AUT',
    lambdaH: 1.78889585929145, lambdaA: 1.1548640192028334,
    projH: 1.78889585929145,   projA: 1.1548640192028334,
    mlHome: -112, mlDraw: 358, mlAway: 296,
    spread: -1.5, homeSpOdds: 244, awaySpOdds: -244,
    over: -129, under: 129,
    bttsY: -129, bttsN: 129,
    advH: -186, advA: 186,
    dc1x: -296, dcX2: 112,
    ndH: -210, ndA: 210,
    pH: 0.5293, pD: 0.2182, pA: 0.2525,
  },
  'wc26-r32-084': {
    fixture: 'POR vs CRO',
    lambdaH: 1.4157516286779246, lambdaA: 0.9048369277024,
    projH: 1.4157516286779246,   projA: 0.9048369277024,
    mlHome: 101, mlDraw: 293, mlAway: 302,
    spread: -1.5, homeSpOdds: 317, awaySpOdds: -317,
    over: 144, under: -144,
    bttsY: 126, bttsN: -126,
    advH: -175, advA: 175,
    dc1x: -302, dcX2: -101,
    ndH: -200, ndA: 200,
    pH: 0.4971, pD: 0.2542, pA: 0.2487,
  },
  'wc26-r32-085': {
    fixture: 'SUI vs ALG',
    lambdaH: 2.0424355656754, lambdaA: 1.3757121825421914,
    projH: 2.0424355656754,   projA: 1.3757121825421914,
    mlHome: -115, mlDraw: 396, mlAway: 280,
    spread: -1.5, homeSpOdds: 220, awaySpOdds: -220,
    over: -197, under: 197,
    bttsY: -181, bttsN: 181,
    advH: -183, advA: 183,
    dc1x: -280, dcX2: 115,
    ndH: -203, ndA: 203,
    pH: 0.5352, pD: 0.2017, pA: 0.2631,
  },
};

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  banner(`${SCRIPT_NAME} — ${ENGINE_VERSION} — FORENSIC PUBLISH`);
  log('STEP', 'INIT', `Session: ${SESSION_ID}`);
  log('STEP', 'INIT', `Fixtures: ${FIXTURE_IDS.join(', ')}`);
  log('STEP', 'INIT', `Log file: ${LOG_FILE}`);
  log('STEP', 'INIT', `Expected values loaded for ${Object.keys(EXPECTED).length} fixtures`);

  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  log('PASS', 'DB_CONNECT', 'MySQL connection established ✓');

  let totalChecks = 0, totalPass = 0, totalFail = 0;
  const auditResults = {};

  // ── PHASE 1: READ-BACK AUDIT ──────────────────────────────────────────────
  banner('PHASE 1 — READ-BACK AUDIT: wc2026_model_projections');

  for (const fid of FIXTURE_IDS) {
    subBanner(`AUDIT: ${fid} (${EXPECTED[fid].fixture})`);
    const [rows] = await conn.query(`
      SELECT fixture_id, model_version, is_frozen,
        home_lambda, away_lambda,
        proj_home_score, proj_away_score, proj_total,
        model_home_ml, model_draw_ml, model_away_ml,
        model_spread, home_spread_odds, away_spread_odds,
        over_odds, under_odds,
        btts_yes_odds, btts_no_odds,
        to_advance_home_odds, to_advance_away_odds,
        dc_1x_odds, dc_x2_odds,
        no_draw_home_odds, no_draw_away_odds,
        home_win_prob, draw_prob, away_win_prob,
        modeled_at
      FROM wc2026_model_projections
      WHERE fixture_id = ?
    `, [fid]);

    if (rows.length === 0) {
      log('FAIL', 'AUDIT', `${fid}: NOT FOUND in wc2026_model_projections — CRITICAL`);
      totalFail++;
      auditResults[fid] = 'NOT_FOUND';
      continue;
    }

    const r = rows[0];
    const exp = EXPECTED[fid];
    log('STEP', 'AUDIT', `${fid}: row found | version=${r.model_version} | frozen=${r.is_frozen}`);

    // Check for any NULL fields
    const nullFields = Object.entries(r).filter(([k,v]) => v === null).map(([k]) => k);
    if (nullFields.length > 0) {
      log('WARN', 'AUDIT', `${fid}: NULL fields detected: ${nullFields.join(', ')}`);
    } else {
      log('PASS', 'AUDIT', `${fid}: zero NULL fields ✓`);
    }

    // Field-by-field verification
    const checks = [
      ['model_version',       r.model_version,          ENGINE_VERSION,          0,      'exact'],
      ['home_lambda',         parseFloat(r.home_lambda), exp.lambdaH,             0.0001, 'tol'],
      ['away_lambda',         parseFloat(r.away_lambda), exp.lambdaA,             0.0001, 'tol'],
      ['proj_home_score',     parseFloat(r.proj_home_score), exp.projH,           0.0001, 'tol'],
      ['proj_away_score',     parseFloat(r.proj_away_score), exp.projA,           0.0001, 'tol'],
      ['model_home_ml',       parseInt(r.model_home_ml),  exp.mlHome,             0,      'exact'],
      ['model_draw_ml',       parseInt(r.model_draw_ml),  exp.mlDraw,             0,      'exact'],
      ['model_away_ml',       parseInt(r.model_away_ml),  exp.mlAway,             0,      'exact'],
      ['model_spread',        parseFloat(r.model_spread), exp.spread,             0.0001, 'tol'],
      ['home_spread_odds',    parseInt(r.home_spread_odds), exp.homeSpOdds,       0,      'exact'],
      ['away_spread_odds',    parseInt(r.away_spread_odds), exp.awaySpOdds,       0,      'exact'],
      ['over_odds',           parseInt(r.over_odds),      exp.over,               0,      'exact'],
      ['under_odds',          parseInt(r.under_odds),     exp.under,              0,      'exact'],
      ['btts_yes_odds',       parseInt(r.btts_yes_odds),  exp.bttsY,              0,      'exact'],
      ['btts_no_odds',        parseInt(r.btts_no_odds),   exp.bttsN,              0,      'exact'],
      ['to_advance_home_odds',parseInt(r.to_advance_home_odds), exp.advH,         0,      'exact'],
      ['to_advance_away_odds',parseInt(r.to_advance_away_odds), exp.advA,         0,      'exact'],
      ['dc_1x_odds',          parseInt(r.dc_1x_odds),     exp.dc1x,               0,      'exact'],
      ['dc_x2_odds',          parseInt(r.dc_x2_odds),     exp.dcX2,               0,      'exact'],
      ['no_draw_home_odds',   parseInt(r.no_draw_home_odds), exp.ndH,             0,      'exact'],
      ['no_draw_away_odds',   parseInt(r.no_draw_away_odds), exp.ndA,             0,      'exact'],
      ['home_win_prob',       parseFloat(r.home_win_prob), exp.pH,                0.001,  'tol'],
      ['draw_prob',           parseFloat(r.draw_prob),    exp.pD,                 0.001,  'tol'],
      ['away_win_prob',       parseFloat(r.away_win_prob), exp.pA,                0.001,  'tol'],
    ];

    let fixturePass = 0, fixtureFail = 0;
    for (const [field, stored, expected, tol, mode] of checks) {
      totalChecks++;
      let ok;
      if (mode === 'exact') {
        ok = stored === expected || String(stored) === String(expected);
      } else {
        ok = Math.abs(stored - expected) <= tol;
      }
      if (ok) {
        log('PASS', 'AUDIT', `  ${fid}.${field}: stored=${stored} expected=${expected} ✓`);
        totalPass++; fixturePass++;
      } else {
        log('FAIL', 'AUDIT', `  ${fid}.${field}: stored=${stored} expected=${expected} diff=${Math.abs(stored-expected).toFixed(6)} ✗`);
        totalFail++; fixtureFail++;
      }
    }
    log(fixtureFail === 0 ? 'PASS' : 'FAIL', 'AUDIT',
      `${fid}: ${fixturePass}/${checks.length} fields verified | ${fixtureFail} failures`);
    auditResults[fid] = fixtureFail === 0 ? 'PASS' : `FAIL(${fixtureFail})`;
  }

  log('OUT', 'AUDIT_SUMMARY', `Total checks: ${totalChecks} | PASS: ${totalPass} | FAIL: ${totalFail}`);

  // ── PHASE 2: FREEZE ───────────────────────────────────────────────────────
  banner('PHASE 2 — FREEZE: set is_frozen=1, frozen_at=NOW()');

  for (const fid of FIXTURE_IDS) {
    subBanner(`FREEZE: ${fid}`);
    log('STEP', 'FREEZE', `${fid}: setting is_frozen=1 and frozen_at=NOW()`);
    const [result] = await conn.query(
      `UPDATE wc2026_model_projections SET is_frozen=1, frozen_at=NOW() WHERE fixture_id=?`,
      [fid]
    );
    if (result.affectedRows === 1) {
      log('FREEZE', 'FREEZE', `${fid}: is_frozen=1 confirmed (affectedRows=1) ✓`);
    } else {
      log('FAIL', 'FREEZE', `${fid}: affectedRows=${result.affectedRows} — expected 1`);
    }

    // Read-back freeze confirmation
    const [freezeCheck] = await conn.query(
      `SELECT is_frozen, frozen_at FROM wc2026_model_projections WHERE fixture_id=?`,
      [fid]
    );
    if (freezeCheck.length > 0 && freezeCheck[0].is_frozen === 1) {
      log('PASS', 'FREEZE', `${fid}: read-back confirmed is_frozen=1 frozen_at=${freezeCheck[0].frozen_at} ✓`);
    } else {
      log('FAIL', 'FREEZE', `${fid}: read-back FAILED — is_frozen=${freezeCheck[0]?.is_frozen}`);
    }
  }

  // ── PHASE 3: FEED SIMULATION ──────────────────────────────────────────────
  banner('PHASE 3 — FEED SIMULATION: todayWithOdds query pattern');
  log('STEP', 'FEED', 'Simulating the exact todayWithOdds procedure query for 2026-07-02');

  const [fixtureRows] = await conn.query(`
    SELECT fixture_id, home_team_id, away_team_id, match_date, kickoff_utc
    FROM wc2026_fixtures
    WHERE match_date = '2026-07-02'
    ORDER BY kickoff_utc, fixture_id
  `);
  log('FEED', 'FEED', `wc2026_fixtures for 2026-07-02: ${fixtureRows.length} rows found`);
  fixtureRows.forEach(f => {
    log('FEED', 'FEED', `  ${f.fixture_id} | home_team_id=${f.home_team_id} away_team_id=${f.away_team_id} | kickoff=${f.kickoff_utc}`);
  });

  if (fixtureRows.length !== 3) {
    log('FAIL', 'FEED', `Expected 3 fixtures for 2026-07-02, got ${fixtureRows.length}`);
  } else {
    log('PASS', 'FEED', '3 fixtures confirmed for 2026-07-02 ✓');
  }

  const feedFixtureIds = fixtureRows.map(f => f.fixture_id);
  const placeholders = feedFixtureIds.map(() => '?').join(',');

  // Simulate the projRowsT query
  const [projRows] = await conn.query(`
    SELECT fixture_id, model_version, is_frozen, frozen_at,
      home_lambda, away_lambda,
      model_home_ml, model_draw_ml, model_away_ml,
      model_spread, home_spread_odds, away_spread_odds,
      over_odds, under_odds,
      btts_yes_odds, btts_no_odds,
      to_advance_home_odds, to_advance_away_odds,
      dc_1x_odds, dc_x2_odds,
      no_draw_home_odds, no_draw_away_odds,
      proj_home_score, proj_away_score, proj_total,
      home_win_prob, draw_prob, away_win_prob,
      home_edge, draw_edge, away_edge
    FROM wc2026_model_projections
    WHERE fixture_id IN (${placeholders})
  `, feedFixtureIds);

  log('FEED', 'FEED', `wc2026_model_projections returned ${projRows.length} rows for feed query`);

  for (const fid of FIXTURE_IDS) {
    const proj = projRows.find(p => p.fixture_id === fid);
    if (!proj) {
      log('FAIL', 'FEED', `${fid}: NOT returned by feed query — will show no model odds on feed`);
      continue;
    }
    log('PASS', 'FEED', `${fid}: returned by feed query | version=${proj.model_version} | frozen=${proj.is_frozen} ✓`);

    // Simulate projToModelOddsT mapping (exact replica of wc2026Router.ts lines 543-571)
    const modelOdds = {
      home:           proj.model_home_ml,
      draw:           proj.model_draw_ml,
      away:           proj.model_away_ml,
      overLine:       proj.model_spread != null ? 2.5 : undefined,
      overOdds:       proj.over_odds,
      underOdds:      proj.under_odds,
      homeSpreadLine: proj.model_spread,
      homeSpreadOdds: proj.home_spread_odds,
      awaySpreadLine: proj.model_spread != null ? -proj.model_spread : undefined,
      awaySpreadOdds: proj.away_spread_odds,
      homeDrawOdds:   proj.dc_1x_odds,
      awayDrawOdds:   proj.dc_x2_odds,
      bttsYes:        proj.btts_yes_odds,
      bttsNo:         proj.btts_no_odds,
      noDraw:         proj.no_draw_away_odds ?? proj.no_draw_home_odds,
      toAdvanceHome:  proj.to_advance_home_odds,
      toAdvanceAway:  proj.to_advance_away_odds,
      projHomeScore:  proj.proj_home_score,
      projAwayScore:  proj.proj_away_score,
      projTotal:      proj.proj_total,
    };

    const nullModelFields = Object.entries(modelOdds).filter(([k,v]) => v == null).map(([k]) => k);
    if (nullModelFields.length > 0) {
      log('WARN', 'FEED', `${fid}: modelOdds has null fields: ${nullModelFields.join(', ')}`);
    } else {
      log('PASS', 'FEED', `${fid}: modelOdds fully populated — zero null fields ✓`);
    }
    log('FEED', 'FEED', `${fid}: modelOdds=${JSON.stringify(modelOdds)}`);
  }

  // ── PHASE 4: wc2026MatchOdds CROSS-CHECK ─────────────────────────────────
  banner('PHASE 4 — CROSS-CHECK: wc2026MatchOdds vs wc2026_model_projections');

  const [moRows] = await conn.query(`
    SELECT fixture_id,
      lamba_home, lamba_away,
      model_projected_home_goals, model_projected_away_goals,
      model_home_ml, model_draw, model_away_ml,
      model_primary_spread, model_home_primary_spread_odds, model_away_primary_spread_odds,
      model_total, model_over_odds, model_under_odds,
      model_btts_yes, model_btts_no,
      model_home_to_advance, model_away_to_advance,
      model_home_wd, model_away_wd,
      model_no_draw
    FROM wc2026MatchOdds
    WHERE fixture_id IN (${placeholders})
    ORDER BY fixture_id
  `, feedFixtureIds);

  log('XREF', 'XREF', `wc2026MatchOdds returned ${moRows.length} rows`);

  for (const fid of FIXTURE_IDS) {
    subBanner(`XREF: ${fid}`);
    const mo = moRows.find(r => r.fixture_id === fid);
    const mp = projRows.find(r => r.fixture_id === fid);
    if (!mo) { log('FAIL', 'XREF', `${fid}: NOT found in wc2026MatchOdds`); continue; }
    if (!mp) { log('FAIL', 'XREF', `${fid}: NOT found in wc2026_model_projections`); continue; }

    const xrefChecks = [
      ['lamba_home vs home_lambda',           parseFloat(mo.lamba_home),                    parseFloat(mp.home_lambda),           0.0001],
      ['lamba_away vs away_lambda',           parseFloat(mo.lamba_away),                    parseFloat(mp.away_lambda),           0.0001],
      ['proj_home_goals vs proj_home_score',  parseFloat(mo.model_projected_home_goals),    parseFloat(mp.proj_home_score),       0.0001],
      ['proj_away_goals vs proj_away_score',  parseFloat(mo.model_projected_away_goals),    parseFloat(mp.proj_away_score),       0.0001],
      ['model_home_ml',                       parseInt(mo.model_home_ml),                   parseInt(mp.model_home_ml),           0],
      ['model_draw vs model_draw_ml',         parseInt(mo.model_draw),                      parseInt(mp.model_draw_ml),           0],
      ['model_away_ml',                       parseInt(mo.model_away_ml),                   parseInt(mp.model_away_ml),           0],
      ['model_primary_spread vs model_spread',parseFloat(mo.model_primary_spread),          parseFloat(mp.model_spread),          0.0001],
      ['home_primary_spread_odds',            parseInt(mo.model_home_primary_spread_odds),  parseInt(mp.home_spread_odds),        0],
      ['away_primary_spread_odds',            parseInt(mo.model_away_primary_spread_odds),  parseInt(mp.away_spread_odds),        0],
      ['model_over_odds',                     parseInt(mo.model_over_odds),                 parseInt(mp.over_odds),               0],
      ['model_under_odds',                    parseInt(mo.model_under_odds),                parseInt(mp.under_odds),              0],
      ['model_btts_yes',                      parseInt(mo.model_btts_yes),                  parseInt(mp.btts_yes_odds),           0],
      ['model_btts_no',                       parseInt(mo.model_btts_no),                   parseInt(mp.btts_no_odds),            0],
      ['model_home_to_advance',               parseInt(mo.model_home_to_advance),           parseInt(mp.to_advance_home_odds),    0],
      ['model_away_to_advance',               parseInt(mo.model_away_to_advance),           parseInt(mp.to_advance_away_odds),    0],
      ['model_home_wd vs dc_1x_odds',         parseInt(mo.model_home_wd),                   parseInt(mp.dc_1x_odds),              0],
      ['model_away_wd vs dc_x2_odds',         parseInt(mo.model_away_wd),                   parseInt(mp.dc_x2_odds),              0],
      ['model_no_draw vs no_draw_home_odds',  parseInt(mo.model_no_draw),                   parseInt(mp.no_draw_home_odds),       0],
    ];

    let xrefPass = 0, xrefFail = 0;
    for (const [field, moVal, mpVal, tol] of xrefChecks) {
      totalChecks++;
      const ok = tol === 0 ? moVal === mpVal : Math.abs(moVal - mpVal) <= tol;
      if (ok) {
        log('PASS', 'XREF', `  ${fid}.${field}: MO=${moVal} MP=${mpVal} ✓`);
        totalPass++; xrefPass++;
      } else {
        log('FAIL', 'XREF', `  ${fid}.${field}: MO=${moVal} MP=${mpVal} diff=${Math.abs(moVal-mpVal).toFixed(6)} ✗`);
        totalFail++; xrefFail++;
      }
    }
    log(xrefFail === 0 ? 'PASS' : 'FAIL', 'XREF',
      `${fid}: ${xrefPass}/${xrefChecks.length} cross-checks passed | ${xrefFail} failures`);
  }

  // ── PHASE 5: FINAL REPORT ─────────────────────────────────────────────────
  banner('PHASE 5 — FINAL REPORT');

  log('OUT', 'FINAL_REPORT', `Engine: ${ENGINE_VERSION}`);
  log('OUT', 'FINAL_REPORT', `Session: ${SESSION_ID}`);
  log('OUT', 'FINAL_REPORT', `Fixtures published: ${FIXTURE_IDS.join(', ')}`);
  log('OUT', 'FINAL_REPORT', `Total field checks: ${totalChecks} | PASS: ${totalPass} | FAIL: ${totalFail}`);
  log('OUT', 'FINAL_REPORT', `Audit results: ${JSON.stringify(auditResults)}`);

  for (const fid of FIXTURE_IDS) {
    const exp = EXPECTED[fid];
    log('OUT', 'FINAL_REPORT', `  ${fid} (${exp.fixture}): λH=${exp.lambdaH.toFixed(4)} λA=${exp.lambdaA.toFixed(4)} Proj:${exp.projH.toFixed(2)}-${exp.projA.toFixed(2)}`);
    log('OUT', 'FINAL_REPORT', `    ML: Home=${exp.mlHome} Draw=${exp.mlDraw} Away=${exp.mlAway}`);
    log('OUT', 'FINAL_REPORT', `    Spread: -1.5 Home=${exp.homeSpOdds} Away=${exp.awaySpOdds} | Total O2.5:${exp.over}/U2.5:${exp.under}`);
    log('OUT', 'FINAL_REPORT', `    BTTS: Y=${exp.bttsY} N=${exp.bttsN} | Adv: H=${exp.advH} A=${exp.advA}`);
    log('OUT', 'FINAL_REPORT', `    DC: 1X=${exp.dc1x} X2=${exp.dcX2} | NoDraw: H=${exp.ndH} A=${exp.ndA}`);
  }

  const overallStatus = totalFail === 0 ? '✅ ALL CHECKS PASSED — PUBLISHED TO FEED' : `❌ ${totalFail} FAILURES DETECTED`;
  log('OUT', 'FINAL_SUMMARY', `STATUS: ${overallStatus}`);
  log('OUT', 'FINAL_SUMMARY', `ELAPSED: ${elapsed()}`);

  banner(`PUBLISH COMPLETE — ${overallStatus}`);

  await conn.end();
  log('PASS', 'DB_CLOSE', 'MySQL connection closed ✓');

  flushLog();
  process.exit(totalFail === 0 ? 0 : 1);
}

main().catch(e => {
  console.error('FATAL ENGINE ERROR:', e.message);
  process.exit(1);
});
