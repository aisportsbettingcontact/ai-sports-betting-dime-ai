/**
 * seedModelJune30v11.mjs
 * ══════════════════════════════════════════════════════════════════════════════
 * Seeds WC2026 v11.0-KO23 model projections for all 3 June 30 R32 fixtures.
 * Reads from /home/ubuntu/wc2026_june30_model_results.json (output of runModelJune30v11.mjs)
 * Writes to wc2026_model_projections table (is_frozen=1).
 * Does NOT overwrite frozen book odds (those are already correct from seedJune30Direct.ts).
 *
 * AUDIT FRAMEWORK: Industry-leading structured logging at every step.
 * ZERO TOLERANCE: Every operation validated. Any FAIL halts execution.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../../.env') });

const LOG_PATH = '/home/ubuntu/wc2026_june30_seed_audit.log';
const RESULTS_PATH = '/home/ubuntu/wc2026_june30_model_results.json';
const logLines = [];
let passCount = 0, failCount = 0, warnCount = 0, stepCount = 0;

function ts() { return new Date().toISOString(); }
function pad(s, n) { return String(s).padEnd(n); }
function log(level, msg, step = null) {
  const stepTag = step ? `[${String(step).padStart(2,'0')}] ` : '    ';
  const line = `[${ts()}] ${pad(level,7)} │ ${stepTag}${msg}`;
  console.log(line); logLines.push(line);
}
function banner(msg) {
  const b = '═'.repeat(80);
  [b, msg.padStart(Math.floor((80+msg.length)/2)).padEnd(80), b].forEach(l => {
    const line = `[${ts()}] BANNER  │ ${l}`;
    console.log(line); logLines.push(line);
  });
}
function pass(msg, step = null) { passCount++; log('PASS', `✅ ${msg}`, step); }
function fail(msg, step = null) { failCount++; log('FAIL', `❌ ${msg}`, step); throw new Error(`FATAL: ${msg}`); }
function warn(msg, step = null) { warnCount++; log('WARN', `⚠️  ${msg}`, step); }
function saveLog() {
  fs.writeFileSync(LOG_PATH, logLines.join('\n') + '\n');
  log('OUTPUT', `Log saved → ${LOG_PATH}`);
}

const SMALLINT_MAX = 32767, SMALLINT_MIN = -32768;
function cap(v) {
  if (v == null || isNaN(v) || !isFinite(v)) return null;
  return Math.max(SMALLINT_MIN, Math.min(SMALLINT_MAX, Math.round(v)));
}

const FIXTURE_IDS = ['wc26-r32-077', 'wc26-r32-078', 'wc26-r32-079'];

banner('WC2026 v11.0-KO23 SEED + AUDIT — June 30, 2026 R32 Model Projections');
log('INPUT', `Fixtures: ${FIXTURE_IDS.join(', ')}`);
log('INPUT', `Results source: ${RESULTS_PATH}`);
log('INPUT', `Log path: ${LOG_PATH}`);

// ── STEP 1: Load simulation results ──────────────────────────────────────────
stepCount++;
log('STEP', 'Loading simulation results from JSON', stepCount);
if (!fs.existsSync(RESULTS_PATH)) fail(`Results file not found: ${RESULTS_PATH}`);
const results = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8'));
if (!Array.isArray(results) || results.length !== 3) fail(`Expected 3 results, got ${results.length}`);
pass(`Loaded ${results.length} simulation results from JSON`);

// Index by match_id
const MODEL = {};
for (const r of results) {
  MODEL[r.fid] = r;
  log('STATE', `  [${r.fid}] ${r.label}: λH=${r.home_lam} λA=${r.away_lam} | proj ${r.proj_home_score}-${r.proj_away_score}`);
}

// ── STEP 2: Pre-flight validation ─────────────────────────────────────────────
stepCount++;
log('STEP', 'Pre-flight: validating all model data structures', stepCount);

for (const fid of FIXTURE_IDS) {
  const m = MODEL[fid];
  if (!m) fail(`Missing model data for ${fid}`);

  // Prob sums
  const sum1x2 = m.home_win_prob + m.draw_prob + m.away_win_prob;
  if (Math.abs(sum1x2 - 1.0) > 0.01) fail(`[${fid}] 1X2 sum=${sum1x2.toFixed(6)}`);
  pass(`[${fid}] 1X2 sum=${sum1x2.toFixed(6)} ✓`);

  const sumAdv = m.p_adv_home + m.p_adv_away;
  if (Math.abs(sumAdv - 1.0) > 0.01) fail(`[${fid}] Advance sum=${sumAdv.toFixed(6)}`);
  pass(`[${fid}] Advance sum=${sumAdv.toFixed(6)} ✓`);

  // Lambda positivity
  if (m.home_lam <= 0 || m.away_lam <= 0) fail(`[${fid}] Non-positive lambda`);
  pass(`[${fid}] Lambdas positive: H=${m.home_lam} A=${m.away_lam}`);

  // Advance >= win
  if (m.p_adv_home < m.home_win_prob - 0.001) fail(`[${fid}] adv_home < home_win`);
  pass(`[${fid}] adv_home(${m.p_adv_home}) >= home_win(${m.home_win_prob}) ✓`);
  if (m.p_adv_away < m.away_win_prob - 0.001) fail(`[${fid}] adv_away < away_win`);
  pass(`[${fid}] adv_away(${m.p_adv_away}) >= away_win(${m.away_win_prob}) ✓`);

  // Critical ML fields non-null
  const critFields = ['model_home_ml','model_draw_ml','model_away_ml','model_adv_home_ml','model_adv_away_ml'];
  for (const f of critFields) {
    if (m[f] == null) fail(`[${fid}] ${f} is null`);
    pass(`[${fid}] ${f}=${m[f]} non-null ✓`);
  }

  log('STATE', `  [${fid}] ML: H=${m.model_home_ml} D=${m.model_draw_ml} A=${m.model_away_ml}`);
  log('STATE', `  [${fid}] ADV: H=${m.model_adv_home_ml}(${m.p_adv_home}) A=${m.model_adv_away_ml}(${m.p_adv_away})`);
  log('STATE', `  [${fid}] Spread ${m.model_spread_line}: H=${m.model_home_spread_ml} A=${m.model_away_spread_ml}`);
  log('STATE', `  [${fid}] Total ${m.model_total_line}: O=${m.model_over_ml} U=${m.model_under_ml}`);
  log('STATE', `  [${fid}] BTTS: Y=${m.model_btts_yes_ml} N=${m.model_btts_no_ml}`);
  log('STATE', `  [${fid}] DC: 1X=${m.model_dc_1x_ml} X2=${m.model_dc_x2_ml} | NoDraw=${m.model_no_draw_ml}`);
  log('STATE', `  [${fid}] Lean: ${m.lean} (${(m.lean_prob*100).toFixed(2)}%)`);
}
log('OUTPUT', `Pre-flight complete: ${passCount} PASS | ${failCount} FAIL | ${warnCount} WARN`);

// ── STEP 3: Connect to DB ─────────────────────────────────────────────────────
stepCount++;
log('STEP', 'Connecting to database', stepCount);
const conn = await mysql.createConnection(process.env.DATABASE_URL);
log('STATE', 'DB connected');
pass('DB connection established');

// ── STEP 4: Verify fixtures exist ─────────────────────────────────────────────
stepCount++;
log('STEP', 'Verifying June 30 fixtures exist in wc2026_matches', stepCount);
const [fixRows] = await conn.execute(
  `SELECT match_id, home_team_id, away_team_id, stage, status FROM wc2026_matches WHERE match_id IN (?,?,?)`,
  FIXTURE_IDS
);
log('STATE', `Found ${fixRows.length} fixture rows`);
if (fixRows.length !== 3) fail(`Expected 3 fixtures, found ${fixRows.length}`);
for (const row of fixRows) {
  log('STATE', `  ${row.match_id}: H=${row.home_team_id} A=${row.away_team_id} stage=${row.stage} status=${row.status}`);
  pass(`[${row.match_id}] fixture verified in DB`);
}

// ── STEP 5: Verify frozen book odds exist ─────────────────────────────────────
stepCount++;
log('STEP', 'Verifying frozen book odds exist for all 3 fixtures', stepCount);
const [bookRows] = await conn.execute(
  `SELECT match_id, book_home_ml, book_draw_ml, book_away_ml, to_advance_home_odds, to_advance_away_odds
   FROM wc2026_frozen_book_odds WHERE match_id IN (?,?,?)`,
  FIXTURE_IDS
);
if (bookRows.length !== 3) fail(`Expected 3 book odds rows, found ${bookRows.length}`);
for (const row of bookRows) {
  log('STATE', `  [${row.match_id}] Book: H=${row.book_home_ml} D=${row.book_draw_ml} A=${row.book_away_ml} | ADV H=${row.to_advance_home_odds} A=${row.to_advance_away_odds}`);
  pass(`[${row.match_id}] Book odds verified in DB`);
}

// ── STEP 6: Delete any existing model projections ─────────────────────────────
stepCount++;
log('STEP', 'Deleting any existing model projections for June 30 fixtures', stepCount);
const [delRes] = await conn.execute(
  `DELETE FROM wc2026_model_projections WHERE match_id IN (?,?,?)`,
  FIXTURE_IDS
);
log('STATE', `Deleted ${delRes.affectedRows} existing projection rows`);
pass(`Deleted ${delRes.affectedRows} stale projection rows`);

// ── STEP 7: Insert v11.0-KO23 model projections ───────────────────────────────
stepCount++;
log('STEP', 'Inserting v11.0-KO23 model projections for all 3 fixtures', stepCount);
let modelSeedCount = 0;

for (const fid of FIXTURE_IDS) {
  const m = MODEL[fid];
  log('STATE', `  [${fid}] Inserting: λH=${m.home_lam} λA=${m.away_lam} | proj: ${m.proj_home_score}-${m.proj_away_score}`);
  log('STATE', `  [${fid}] ML: H=${m.model_home_ml} D=${m.model_draw_ml} A=${m.model_away_ml}`);
  log('STATE', `  [${fid}] ADV: H=${m.model_adv_home_ml}(${m.p_adv_home}) A=${m.model_adv_away_ml}(${m.p_adv_away})`);

  const [ins] = await conn.execute(
    `INSERT INTO wc2026_model_projections (
      match_id, model_version, n_simulations,
      home_team, away_team,
      home_lambda, away_lambda,
      home_win_prob, draw_prob, away_win_prob,
      proj_home_score, proj_away_score, proj_total,
      proj_spread,
      model_home_ml, model_draw_ml, model_away_ml,
      model_total, model_total_raw,
      over_odds, under_odds,
      model_spread, model_spread_raw,
      home_spread_odds, away_spread_odds,
      dc_1x_odds, dc_x2_odds,
      no_draw_home_odds, no_draw_away_odds,
      btts_prob, btts_yes_odds, btts_no_odds,
      nv_home_prob, nv_draw_prob, nv_away_prob,
      nv_dc_1x, nv_dc_x2,
      nv_no_draw_home, nv_no_draw_away,
      home_edge, draw_edge, away_edge,
      model_lean, lean_prob,
      to_advance_home_prob, to_advance_away_prob,
      to_advance_home_odds, to_advance_away_odds,
      is_frozen, frozen_at, modeled_at
    ) VALUES (
      ?,?,?,
      ?,?,
      ?,?,
      ?,?,?,
      ?,?,?,
      ?,
      ?,?,?,
      ?,?,
      ?,?,
      ?,?,
      ?,?,
      ?,?,
      ?,?,
      ?,?,?,
      ?,?,?,
      ?,?,
      ?,?,
      ?,?,?,
      ?,?,
      ?,?,
      ?,?,
      1,NOW(),NOW()
    )`,
    [
      fid, m.model_version, m.n_sims,
      m.home, m.away,
      m.home_lam, m.away_lam,
      m.home_win_prob, m.draw_prob, m.away_win_prob,
      m.proj_home_score, m.proj_away_score, m.proj_total,
      m.model_spread_line,
      cap(m.model_home_ml), cap(m.model_draw_ml), cap(m.model_away_ml),
      m.model_total_line, m.proj_total,
      cap(m.model_over_ml), cap(m.model_under_ml),
      m.model_spread_line, m.model_spread_line,
      cap(m.model_home_spread_ml), cap(m.model_away_spread_ml),
      cap(m.model_dc_1x_ml), cap(m.model_dc_x2_ml),
      cap(m.model_no_draw_ml), cap(m.model_no_draw_ml),
      m.btts_prob, cap(m.model_btts_yes_ml), cap(m.model_btts_no_ml),
      m.nv_home, m.nv_draw, m.nv_away,
      m.nv_dc_1x, m.nv_dc_x2,
      m.nv_no_draw_home, m.nv_no_draw_away,
      m.home_edge, m.draw_edge, m.away_edge,
      m.lean, m.lean_prob,
      m.p_adv_home, m.p_adv_away,
      cap(m.model_adv_home_ml), cap(m.model_adv_away_ml),
    ]
  );
  modelSeedCount++;
  pass(`[${fid}] Model projection inserted (affectedRows=${ins.affectedRows})`);
}
log('OUTPUT', `Model projections seeded: ${modelSeedCount}/3`);

// ── STEP 8: Verify model projections in DB ────────────────────────────────────
stepCount++;
log('STEP', 'Verifying model projections in DB — all 14 markets', stepCount);
const [modelVerRows] = await conn.execute(
  `SELECT match_id, model_version, n_simulations,
          home_lambda, away_lambda,
          home_win_prob, draw_prob, away_win_prob,
          proj_home_score, proj_away_score, proj_total,
          model_home_ml, model_draw_ml, model_away_ml,
          over_odds, under_odds,
          home_spread_odds, away_spread_odds,
          btts_yes_odds, btts_no_odds,
          dc_1x_odds, dc_x2_odds,
          no_draw_home_odds, no_draw_away_odds,
          to_advance_home_prob, to_advance_away_prob,
          to_advance_home_odds, to_advance_away_odds,
          model_lean, lean_prob,
          home_edge, draw_edge, away_edge,
          is_frozen, frozen_at
   FROM wc2026_model_projections
   WHERE match_id IN (?,?,?) ORDER BY match_id`,
  FIXTURE_IDS
);
if (modelVerRows.length !== 3) fail(`Model verify: expected 3 rows, got ${modelVerRows.length}`);

for (const row of modelVerRows) {
  const m = MODEL[row.match_id];
  const mChecks = [
    ['model_home_ml',      row.model_home_ml,      cap(m.model_home_ml)],
    ['model_draw_ml',      row.model_draw_ml,      cap(m.model_draw_ml)],
    ['model_away_ml',      row.model_away_ml,      cap(m.model_away_ml)],
    ['to_advance_home_odds', row.to_advance_home_odds, cap(m.model_adv_home_ml)],
    ['to_advance_away_odds', row.to_advance_away_odds, cap(m.model_adv_away_ml)],
    ['btts_yes_odds',      row.btts_yes_odds,      cap(m.model_btts_yes_ml)],
    ['btts_no_odds',       row.btts_no_odds,       cap(m.model_btts_no_ml)],
    ['over_odds',          row.over_odds,          cap(m.model_over_ml)],
    ['under_odds',         row.under_odds,         cap(m.model_under_ml)],
    ['home_spread_odds',   row.home_spread_odds,   cap(m.model_home_spread_ml)],
    ['away_spread_odds',   row.away_spread_odds,   cap(m.model_away_spread_ml)],
    ['dc_1x_odds',         row.dc_1x_odds,         cap(m.model_dc_1x_ml)],
    ['dc_x2_odds',         row.dc_x2_odds,         cap(m.model_dc_x2_ml)],
  ];
  for (const [field, actual, expected] of mChecks) {
    if (actual !== expected) fail(`[${row.match_id}] ${field}: DB=${actual} ≠ expected=${expected}`);
    pass(`[${row.match_id}] ${field}: ${actual} ✓`);
  }
  // Critical non-null checks
  if (row.to_advance_home_odds == null) fail(`[${row.match_id}] to_advance_home_odds NULL`);
  if (row.to_advance_away_odds == null) fail(`[${row.match_id}] to_advance_away_odds NULL`);
  if (row.is_frozen !== 1) fail(`[${row.match_id}] is_frozen=${row.is_frozen} (expected 1)`);
  pass(`[${row.match_id}] is_frozen=1, TO ADVANCE non-null ✓`);
  log('STATE', `  [${row.match_id}] VERIFIED: ML H=${row.model_home_ml} D=${row.model_draw_ml} A=${row.model_away_ml} | ADV H=${row.to_advance_home_odds} A=${row.to_advance_away_odds} | lean=${row.model_lean}(${row.lean_prob})`);
}

// ── STEP 9: Final cross-table audit ───────────────────────────────────────────
stepCount++;
log('STEP', 'Final cross-table audit: book + model both present for all 3 fixtures', stepCount);
const [crossRows] = await conn.execute(
  `SELECT f.match_id,
          b.book_home_ml, b.book_draw_ml, b.book_away_ml,
          b.to_advance_home_odds AS book_adv_h, b.to_advance_away_odds AS book_adv_a,
          mp.model_home_ml, mp.model_draw_ml, mp.model_away_ml,
          mp.to_advance_home_odds AS model_adv_h, mp.to_advance_away_odds AS model_adv_a,
          mp.model_lean, mp.lean_prob, mp.is_frozen
   FROM wc2026_matches f
   JOIN wc2026_frozen_book_odds b ON b.match_id = f.match_id
   JOIN wc2026_model_projections mp ON mp.match_id = f.match_id
   WHERE f.match_id IN (?,?,?)
   ORDER BY f.match_id`,
  FIXTURE_IDS
);
if (crossRows.length !== 3) fail(`Cross-table audit: expected 3 rows, got ${crossRows.length}`);
for (const row of crossRows) {
  if (row.book_home_ml == null) fail(`[${row.match_id}] book_home_ml NULL in cross-audit`);
  if (row.model_home_ml == null) fail(`[${row.match_id}] model_home_ml NULL in cross-audit`);
  if (row.is_frozen !== 1) fail(`[${row.match_id}] is_frozen=${row.is_frozen}`);
  pass(`[${row.match_id}] Cross-table: Book H=${row.book_home_ml} D=${row.book_draw_ml} A=${row.book_away_ml} | Model H=${row.model_home_ml} D=${row.model_draw_ml} A=${row.model_away_ml} | Lean=${row.model_lean}(${row.lean_prob}) | frozen=✅`);
}

// ── STEP 10: Final summary ────────────────────────────────────────────────────
await conn.end();
banner('SEED COMPLETE — June 30, 2026 WC2026 Model Projections Published');
log('OUTPUT', `Total steps: ${stepCount} | PASS: ${passCount} | FAIL: ${failCount} | WARN: ${warnCount}`);
log('OUTPUT', `Status: ${failCount === 0 ? 'ALL SYSTEMS GO ✅ — All 3 June 30 fixtures published to feed' : 'FAILURES DETECTED ❌'}`);
log('OUTPUT', '');
log('OUTPUT', 'PUBLISHED FIXTURES:');
for (const fid of FIXTURE_IDS) {
  const m = MODEL[fid];
  log('OUTPUT', `  ${fid}: ${m.label}`);
  log('OUTPUT', `    Proj: ${m.proj_home_score}-${m.proj_away_score} | Total: ${m.proj_total} | Lean: ${m.lean}`);
  log('OUTPUT', `    Model ML: H=${m.model_home_ml > 0 ? '+' : ''}${m.model_home_ml} D=${m.model_draw_ml > 0 ? '+' : ''}${m.model_draw_ml} A=${m.model_away_ml > 0 ? '+' : ''}${m.model_away_ml}`);
  log('OUTPUT', `    Advance:  H=${m.model_adv_home_ml > 0 ? '+' : ''}${m.model_adv_home_ml} (${(m.p_adv_home*100).toFixed(2)}%)  A=${m.model_adv_away_ml > 0 ? '+' : ''}${m.model_adv_away_ml} (${(m.p_adv_away*100).toFixed(2)}%)`);
}

saveLog();
process.exit(failCount > 0 ? 1 : 0);
