/**
 * validateFeedJuly2.mjs — v2
 * v16.0-KO25 — Feed Rendering Validation for July 2, 2026
 * Uses EXACT wc2026MatchOdds column names confirmed from SHOW COLUMNS
 * Validates all 3 fixtures: wc26-r32-083/084/085
 * Appends full log to wc2026modeling.txt
 */

import mysql from 'mysql2/promise';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const LOG_FILE = '/home/ubuntu/wc2026modeling.txt';
const SESSION_ID = `feed-validate-july2-v2-${Date.now()}`;
const ENGINE = 'v16.0-KO25-RECALIBRATED-10MATCH';
let stepCounter = 0;
const logLines = [];

function ts() { return new Date().toISOString(); }
function elapsed(start) { return ((Date.now() - start) / 1000).toFixed(3) + 's'; }

function log(phase, tag, msg, level = 'INFO') {
  stepCounter++;
  const s = String(stepCounter).padStart(5, '0');
  const icon = level === 'PASS' ? '✅ PASS ' : level === 'FAIL' ? '❌ FAIL ' : level === 'WARN' ? '⚠️ WARN ' : '→→ OUT ';
  const line = `[${ts()}] S${s} [${icon}] [${tag.padEnd(18)}] ${msg}`;
  console.log(line);
  logLines.push(line);
}

function divider(char = '─', width = 96) {
  const line = char.repeat(width);
  console.log(line);
  logLines.push(line);
}

function header(title) {
  divider('═');
  const line = `  ${title}`;
  console.log(line);
  logLines.push(line);
  divider('═');
}

const START = Date.now();

header(`FEED VALIDATION v2 — ${ENGINE} — Session: ${SESSION_ID}`);
log('INIT', 'SESSION', `Engine: ${ENGINE}`);
log('INIT', 'SESSION', `Session: ${SESSION_ID}`);
log('INIT', 'SESSION', `Target date: 2026-07-02`);
log('INIT', 'SESSION', `Fixtures: wc26-r32-083 (ESP/AUT), wc26-r32-084 (POR/CRO), wc26-r32-085 (SUI/ALG)`);
log('INIT', 'SESSION', `Column schema: exact names from SHOW COLUMNS wc2026MatchOdds`);

// Expected values from v16.0 engine — ground truth
const EXPECTED = {
  'wc26-r32-083': {
    home_team: 'ESP', away_team: 'AUT',
    lamba_home: 1.7889, lamba_away: 1.1549,
    model_projected_home_goals: 1.7889, model_projected_away_goals: 1.1549,
    model_home_ml: -112, model_draw: 358, model_away_ml: 296,
    model_primary_spread: -1.5, model_home_primary_spread_odds: 244, model_away_primary_spread_odds: -244,
    model_total: 2.5, model_over_odds: -129, model_under_odds: 129,
    model_btts_yes: -129, model_btts_no: 129,
    model_home_wd: -296, model_away_wd: 112,
    model_home_to_advance: -186, model_away_to_advance: 186,
    model_no_draw: -210,
  },
  'wc26-r32-084': {
    home_team: 'POR', away_team: 'CRO',
    lamba_home: 1.4158, lamba_away: 0.9048,
    model_projected_home_goals: 1.4158, model_projected_away_goals: 0.9048,
    model_home_ml: 101, model_draw: 293, model_away_ml: 302,
    model_primary_spread: -1.5, model_home_primary_spread_odds: 317, model_away_primary_spread_odds: -317,
    model_total: 2.5, model_over_odds: 144, model_under_odds: -144,
    model_btts_yes: 126, model_btts_no: -126,
    model_home_wd: -302, model_away_wd: -101,
    model_home_to_advance: -175, model_away_to_advance: 175,
    model_no_draw: -200,
  },
  'wc26-r32-085': {
    home_team: 'SUI', away_team: 'ALG',
    lamba_home: 2.0424, lamba_away: 1.3757,
    model_projected_home_goals: 2.0424, model_projected_away_goals: 1.3757,
    model_home_ml: -115, model_draw: 396, model_away_ml: 280,
    model_primary_spread: -1.5, model_home_primary_spread_odds: 220, model_away_primary_spread_odds: -220,
    model_total: 2.5, model_over_odds: -197, model_under_odds: 197,
    model_btts_yes: -181, model_btts_no: 181,
    model_home_wd: -280, model_away_wd: 115,
    model_home_to_advance: -183, model_away_to_advance: 183,
    model_no_draw: -203,
  },
};

let conn;
try {
  conn = await mysql.createConnection(process.env.DATABASE_URL);
  log('DB', 'DB_CONNECT', 'MySQL connection established ✓', 'PASS');
} catch (e) {
  log('DB', 'DB_CONNECT', `FATAL: ${e.message}`, 'FAIL');
  process.exit(1);
}

// ─── PHASE 1: RAW DB READ ────────────────────────────────────────────────────
divider();
log('P1', 'PHASE', 'PHASE 1 — Raw DB read from wc2026MatchOdds (exact column names)');
divider();

const [rows] = await conn.query(`
  SELECT 
    match_id, world_cup_round, world_cup_stage,
    home_team, away_team,
    lamba_home, lamba_away,
    model_projected_home_goals, model_projected_away_goals,
    book_home_ml, book_draw, book_away_ml,
    model_home_ml, model_draw, model_away_ml,
    book_primary_spread, book_home_primary_spread_odds, book_away_primary_spread_odds,
    model_primary_spread, model_home_primary_spread_odds, model_away_primary_spread_odds,
    book_total, book_over_odds, book_under_odds,
    model_total, model_over_odds, model_under_odds,
    book_btts_yes, book_btts_no,
    model_btts_yes, model_btts_no,
    book_home_wd, book_away_wd,
    model_home_wd, model_away_wd,
    book_home_to_advance, book_away_to_advance,
    model_home_to_advance, model_away_to_advance,
    book_no_draw, model_no_draw
  FROM wc2026MatchOdds
  WHERE match_id IN ('wc26-r32-083','wc26-r32-084','wc26-r32-085')
  ORDER BY match_id ASC
`);

log('P1', 'DB_READ', `wc2026MatchOdds returned ${rows.length}/3 rows`, rows.length === 3 ? 'PASS' : 'FAIL');

if (rows.length !== 3) {
  log('P1', 'DB_READ', `FATAL: Expected 3 rows, got ${rows.length}`, 'FAIL');
  await conn.end();
  process.exit(1);
}

// ─── PHASE 2: PER-FIXTURE VALIDATION ─────────────────────────────────────────
divider();
log('P2', 'PHASE', 'PHASE 2 — Per-fixture field validation (21 model fields + orientation + book non-null)');
divider();

const auditResults = {};
let totalPass = 0, totalFail = 0;

for (const row of rows) {
  const fid = row.match_id;
  const exp = EXPECTED[fid];
  divider('─');
  log('P2', 'FIXTURE', `▶ ${fid}: ${row.away_team} (Away) @ ${row.home_team} (Home) | Round: ${row.world_cup_round}`);

  let fixturePass = 0, fixtureFail = 0;

  function check(label, actual, expected, tolerance = 0.01) {
    const actualNum = actual === null || actual === undefined ? NaN : parseFloat(actual);
    const expNum = parseFloat(expected);
    if (isNaN(actualNum)) {
      log('P2', 'CHECK', `  ${label}: DB=NULL EXP=${expNum} ✗ — NULL in DB`, 'FAIL');
      fixtureFail++;
      return false;
    }
    const diff = Math.abs(actualNum - expNum);
    const pass = diff <= tolerance;
    log('P2', 'CHECK', `  ${label}: DB=${actualNum} EXP=${expNum} diff=${diff.toFixed(4)} ${pass ? '✓' : '✗'}`, pass ? 'PASS' : 'FAIL');
    if (pass) fixturePass++; else fixtureFail++;
    return pass;
  }

  function checkNonNull(label, actual) {
    const pass = actual !== null && actual !== undefined;
    log('P2', 'CHECK', `  ${label}: ${pass ? actual + ' ✓' : 'NULL ✗'}`, pass ? 'PASS' : 'FAIL');
    if (pass) fixturePass++; else fixtureFail++;
    return pass;
  }

  // Orientation
  const homeOk = row.home_team === exp.home_team;
  const awayOk = row.away_team === exp.away_team;
  log('P2', 'ORIENT', `  home_team: DB=${row.home_team} EXP=${exp.home_team} ${homeOk ? '✓' : '✗'}`, homeOk ? 'PASS' : 'FAIL');
  log('P2', 'ORIENT', `  away_team: DB=${row.away_team} EXP=${exp.away_team} ${awayOk ? '✓' : '✗'}`, awayOk ? 'PASS' : 'FAIL');
  if (homeOk) fixturePass++; else fixtureFail++;
  if (awayOk) fixturePass++; else fixtureFail++;

  // Lambda
  check('λH (lamba_home)', row.lamba_home, exp.lamba_home, 0.001);
  check('λA (lamba_away)', row.lamba_away, exp.lamba_away, 0.001);

  // Projected goals
  check('Proj Home Goals', row.model_projected_home_goals, exp.model_projected_home_goals, 0.001);
  check('Proj Away Goals', row.model_projected_away_goals, exp.model_projected_away_goals, 0.001);

  // Book ML non-null
  checkNonNull('Book Home ML', row.book_home_ml);
  checkNonNull('Book Draw', row.book_draw);
  checkNonNull('Book Away ML', row.book_away_ml);

  // Model ML
  check('Model Home ML', row.model_home_ml, exp.model_home_ml, 1);
  check('Model Draw', row.model_draw, exp.model_draw, 1);
  check('Model Away ML', row.model_away_ml, exp.model_away_ml, 1);

  // Spread
  check('Model Spread Line', row.model_primary_spread, exp.model_primary_spread, 0.01);
  check('Model Home Spread Odds', row.model_home_primary_spread_odds, exp.model_home_primary_spread_odds, 1);
  check('Model Away Spread Odds', row.model_away_primary_spread_odds, exp.model_away_primary_spread_odds, 1);

  // Total
  check('Model Total Line', row.model_total, exp.model_total, 0.01);
  check('Model Over Odds', row.model_over_odds, exp.model_over_odds, 1);
  check('Model Under Odds', row.model_under_odds, exp.model_under_odds, 1);

  // BTTS
  check('Model BTTS Yes', row.model_btts_yes, exp.model_btts_yes, 1);
  check('Model BTTS No', row.model_btts_no, exp.model_btts_no, 1);

  // Double Chance
  check('Model DC 1X (home_wd)', row.model_home_wd, exp.model_home_wd, 1);
  check('Model DC X2 (away_wd)', row.model_away_wd, exp.model_away_wd, 1);

  // To Advance
  check('Model To Advance Home', row.model_home_to_advance, exp.model_home_to_advance, 1);
  check('Model To Advance Away', row.model_away_to_advance, exp.model_away_to_advance, 1);

  // No Draw
  check('Model No Draw', row.model_no_draw, exp.model_no_draw, 1);

  const status = fixtureFail === 0 ? 'PASS' : 'FAIL';
  auditResults[fid] = { pass: fixturePass, fail: fixtureFail, status, row };
  log('P2', 'FIXTURE_SUMMARY', `${fid}: ${fixturePass}/${fixturePass + fixtureFail} checks | ${fixtureFail} failures | STATUS: ${status}`, status);
  totalPass += fixturePass;
  totalFail += fixtureFail;
}

// ─── PHASE 3: FEED QUERY SIMULATION ──────────────────────────────────────────
divider();
log('P3', 'PHASE', 'PHASE 3 — Feed query simulation (wc2026_model_projections — todayWithOdds path)');
divider();

const [projRows] = await conn.query(`
  SELECT match_id, model_version, is_frozen, frozen_at,
    home_lambda, away_lambda,
    model_home_ml, model_draw_ml, model_away_ml,
    model_spread, home_spread_odds, away_spread_odds,
    over_odds, under_odds,
    btts_yes_odds, btts_no_odds,
    to_advance_home_odds, to_advance_away_odds,
    dc_1x_odds, dc_x2_odds,
    no_draw_home_odds, no_draw_away_odds,
    proj_home_score, proj_away_score, proj_total,
    home_win_prob, draw_prob, away_win_prob
  FROM wc2026_model_projections
  WHERE match_id IN ('wc26-r32-083','wc26-r32-084','wc26-r32-085')
  ORDER BY match_id ASC
`);

log('P3', 'FEED_QUERY', `wc2026_model_projections returned ${projRows.length}/3 rows`, projRows.length === 3 ? 'PASS' : 'FAIL');
if (projRows.length === 3) totalPass++; else totalFail++;

for (const p of projRows) {
  const frozenOk = p.is_frozen === 1;
  log('P3', 'FEED_ROW', `${p.match_id} | version=${p.model_version} | is_frozen=${p.is_frozen} | frozen_at=${p.frozen_at}`, frozenOk ? 'PASS' : 'WARN');
  log('P3', 'FEED_ROW', `  λH=${p.home_lambda} λA=${p.away_lambda} | Proj: ${p.proj_home_score}-${p.proj_away_score} | Total=${p.proj_total}`);
  log('P3', 'FEED_ROW', `  pH=${p.home_win_prob} pD=${p.draw_prob} pA=${p.away_win_prob}`);
  log('P3', 'FEED_ROW', `  ML: H=${p.model_home_ml} D=${p.model_draw_ml} A=${p.model_away_ml}`);
  log('P3', 'FEED_ROW', `  SPR: ${p.model_spread} H=${p.home_spread_odds} A=${p.away_spread_odds}`);
  log('P3', 'FEED_ROW', `  TOT: O=${p.over_odds} U=${p.under_odds} | BTTS: Y=${p.btts_yes_odds} N=${p.btts_no_odds}`);
  log('P3', 'FEED_ROW', `  DC: 1X=${p.dc_1x_odds} X2=${p.dc_x2_odds} | ADV: H=${p.to_advance_home_odds} A=${p.to_advance_away_odds}`);
  log('P3', 'FEED_ROW', `  NoDraw: H=${p.no_draw_home_odds} A=${p.no_draw_away_odds}`);
  if (frozenOk) totalPass++; else totalFail++;
}

// ─── PHASE 4: FINAL REPORT ────────────────────────────────────────────────────
divider('═');
log('P4', 'FINAL_REPORT', `Engine: ${ENGINE}`);
log('P4', 'FINAL_REPORT', `Session: ${SESSION_ID}`);
log('P4', 'FINAL_REPORT', `Total checks: ${totalPass + totalFail} | PASS: ${totalPass} | FAIL: ${totalFail}`);
log('P4', 'FINAL_REPORT', `Per-fixture: ${JSON.stringify(Object.fromEntries(Object.entries(auditResults).map(([k,v]) => [k, v.status])))}`);

for (const [fid, res] of Object.entries(auditResults)) {
  const r = res.row;
  log('P4', 'SUMMARY', `${fid} (${r.away_team} @ ${r.home_team}): ${res.pass}/${res.pass + res.fail} PASS | ${res.status}`);
  log('P4', 'SUMMARY', `  λH=${r.lamba_home} λA=${r.lamba_away} | Proj: ${r.model_projected_home_goals}-${r.model_projected_away_goals}`);
  log('P4', 'SUMMARY', `  ML: H=${r.model_home_ml} D=${r.model_draw} A=${r.model_away_ml}`);
  log('P4', 'SUMMARY', `  SPR: ${r.model_primary_spread} H=${r.model_home_primary_spread_odds} A=${r.model_away_primary_spread_odds}`);
  log('P4', 'SUMMARY', `  TOT: ${r.model_total} O=${r.model_over_odds} U=${r.model_under_odds}`);
  log('P4', 'SUMMARY', `  BTTS: Y=${r.model_btts_yes} N=${r.model_btts_no}`);
  log('P4', 'SUMMARY', `  DC: 1X=${r.model_home_wd} X2=${r.model_away_wd}`);
  log('P4', 'SUMMARY', `  ADV: H=${r.model_home_to_advance} A=${r.model_away_to_advance}`);
  log('P4', 'SUMMARY', `  NoDraw: ${r.model_no_draw}`);
  log('P4', 'SUMMARY', `  Book ML: H=${r.book_home_ml} D=${r.book_draw} A=${r.book_away_ml}`);
  log('P4', 'SUMMARY', `  Book SPR: ${r.book_primary_spread} H=${r.book_home_primary_spread_odds} A=${r.book_away_primary_spread_odds}`);
  log('P4', 'SUMMARY', `  Book TOT: ${r.book_total} O=${r.book_over_odds} U=${r.book_under_odds}`);
  log('P4', 'SUMMARY', `  Book BTTS: Y=${r.book_btts_yes} N=${r.book_btts_no}`);
  log('P4', 'SUMMARY', `  Book DC: 1X=${r.book_home_wd} X2=${r.book_away_wd}`);
  log('P4', 'SUMMARY', `  Book ADV: H=${r.book_home_to_advance} A=${r.book_away_to_advance}`);
}

const overallStatus = totalFail === 0 ? '✅ ALL CHECKS PASSED — FEED READY' : `❌ ${totalFail} FAILURES DETECTED`;
log('P4', 'FINAL_SUMMARY', `STATUS: ${overallStatus}`);
log('P4', 'FINAL_SUMMARY', `ELAPSED: ${elapsed(START)}`);
divider('═');

await conn.end();
log('DB', 'DB_CLOSE', 'MySQL connection closed ✓', 'PASS');

// Append to wc2026modeling.txt
const appendBlock = '\n' + logLines.join('\n') + '\n';
fs.appendFileSync(LOG_FILE, appendBlock);
console.log(`[LOG] Appended ${logLines.length} lines to ${LOG_FILE}`);
