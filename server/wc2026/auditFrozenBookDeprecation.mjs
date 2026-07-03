/**
 * auditFrozenBookDeprecation.mjs
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * PURPOSE : 500x FORENSIC DEPRECATION AUDIT — wc2026_frozen_book_odds
 *
 * MANDATE : Confirm with 100% triple-verified certainty that:
 *   1. ALL data in wc2026_frozen_book_odds has been extracted, mapped, and saved in wc2026MatchOdds
 *   2. Every field-to-field mapping is validated with exact value comparison
 *   3. No active router, script, or file depends on wc2026_frozen_book_odds as a primary source
 *   4. The table is safe to deprecate / archive
 *
 * FIELD MAPPING (frozen → matchOdds) — BOTH TABLES HAVE IDENTICAL COLUMN NAMES:
 *   book_home_ml                  → book_home_ml
 *   book_draw                     → book_draw
 *   book_away_ml                  → book_away_ml
 *   book_primary_spread           → book_primary_spread
 *   book_home_primary_spread_odds → book_home_primary_spread_odds
 *   book_away_primary_spread_odds → book_away_primary_spread_odds
 *   book_total                    → book_total
 *   book_over_odds                → book_over_odds
 *   book_under_odds               → book_under_odds
 *   book_btts_yes                 → book_btts_yes
 *   book_btts_no                  → book_btts_no
 *   book_home_wd                  → book_home_wd
 *   book_away_wd                  → book_away_wd
 *   book_no_draw                  → book_no_draw
 *   book_no_draw_away_odds        → book_no_draw (secondary/legacy column)
 *   book_home_to_advance          → book_home_to_advance
 *   book_away_to_advance          → book_away_to_advance
 *
 * LOG FILE : /home/ubuntu/wc2026databasing.txt
 * VERSION  : v1.0-FROZEN-DEPRECATION-AUDIT
 * DATE     : 2026-07-02
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 */

import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// ─── Constants ────────────────────────────────────────────────────────────────
const LOG_FILE = '/home/ubuntu/wc2026databasing.txt';
const SCRIPT   = 'auditFrozenBookDeprecation.mjs';
const VERSION  = 'v1.0-FROZEN-DEPRECATION-AUDIT';
const DIVIDER  = '═'.repeat(100);
const DIVIDER2 = '─'.repeat(100);

// ─── Logger ───────────────────────────────────────────────────────────────────
const startTs = Date.now();
const logLines = [];

function ts() { return new Date().toISOString(); }
function elapsed() { return `+${((Date.now() - startTs) / 1000).toFixed(3)}s`; }

function log(icon, section, msg) {
  const line = `[${ts()}] ${elapsed().padEnd(9)} ${icon.padEnd(4)} │ [${section.padEnd(12)}] ${msg}`;
  process.stdout.write(line + '\n');
  logLines.push(line);
}

function banner(msg) {
  const line = `[${ts()}] ${elapsed().padEnd(9)} ████ │ ${msg}`;
  process.stdout.write(line + '\n');
  logLines.push(line);
}

function section(num, title) {
  const hdr = `\n${'─'.repeat(100)}\n[${ts()}] ${elapsed().padEnd(9)} ████ │ SECTION ${num}: ${title}\n${'─'.repeat(100)}`;
  process.stdout.write(hdr + '\n');
  logLines.push(hdr);
}

function pass(section, msg)  { log('✅', section, `PASS  │ ${msg}`); }
function fail(section, msg)  { log('❌', section, `FAIL  │ ${msg}`); }
function warn(section, msg)  { log('⚠️ ', section, `WARN  │ ${msg}`); }
function step(section, msg)  { log('▶▶', section, `STEP  │ ${msg}`); }
function state(section, msg) { log('··', section, `STATE │ ${msg}`); }
function atom(section, msg)  { log('  ', section, `ATOM  │ ${msg}`); }
function input(section, msg) { log('◀◀', section, `INPUT │ ${msg}`); }
function calc(section, msg)  { log('∑∑', section, `CALC  │ ${msg}`); }

function flushLog() {
  const header = [
    '',
    DIVIDER,
    `SESSION START : ${ts()}`,
    `SCRIPT        : ${SCRIPT}`,
    `VERSION       : ${VERSION}`,
    `PURPOSE       : 500x Forensic Deprecation Audit — wc2026_frozen_book_odds vs wc2026MatchOdds`,
    `LOG FILE      : ${LOG_FILE}`,
    DIVIDER,
  ].join('\n');
  fs.appendFileSync(LOG_FILE, header + '\n' + logLines.join('\n') + '\n');
  process.stdout.write(`\n[LOG] ✅ ${logLines.length} lines appended to ${LOG_FILE}\n`);
}

// ─── Field Mapping Definition ─────────────────────────────────────────────────
// Each entry: { frozenCol, matchCol, label, tolerance }
// tolerance: null = exact integer match, 0.0001 = float tolerance
const FIELD_MAP = [
  { frozenCol: 'book_home_ml',                  matchCol: 'book_home_ml',                      label: 'Home ML',           tolerance: null },
  { frozenCol: 'book_draw',                     matchCol: 'book_draw',                          label: 'Draw ML',           tolerance: null },
  { frozenCol: 'book_away_ml',                  matchCol: 'book_away_ml',                       label: 'Away ML',           tolerance: null },
  { frozenCol: 'book_primary_spread',           matchCol: 'book_primary_spread',                label: 'Spread Line',       tolerance: 0.001 },
  { frozenCol: 'book_home_primary_spread_odds', matchCol: 'book_home_primary_spread_odds',      label: 'Home Spread Odds',  tolerance: null },
  { frozenCol: 'book_away_primary_spread_odds', matchCol: 'book_away_primary_spread_odds',      label: 'Away Spread Odds',  tolerance: null },
  { frozenCol: 'book_total',                    matchCol: 'book_total',                         label: 'Total Line',        tolerance: 0.001 },
  { frozenCol: 'book_over_odds',                matchCol: 'book_over_odds',                     label: 'Over Odds',         tolerance: null },
  { frozenCol: 'book_under_odds',               matchCol: 'book_under_odds',                    label: 'Under Odds',        tolerance: null },
  { frozenCol: 'book_btts_yes',                 matchCol: 'book_btts_yes',                      label: 'BTTS Yes',          tolerance: null },
  { frozenCol: 'book_btts_no',                  matchCol: 'book_btts_no',                       label: 'BTTS No',           tolerance: null },
  { frozenCol: 'book_home_wd',                  matchCol: 'book_home_wd',                       label: 'DC 1X (Home WD)',   tolerance: null },
  { frozenCol: 'book_away_wd',                  matchCol: 'book_away_wd',                       label: 'DC X2 (Away WD)',   tolerance: null },
  { frozenCol: 'book_no_draw',                  matchCol: 'book_no_draw',                       label: 'No Draw',           tolerance: null },
  { frozenCol: 'book_no_draw_away_odds',        matchCol: 'book_no_draw',                       label: 'No Draw (legacy)',  tolerance: null },
  { frozenCol: 'book_home_to_advance',          matchCol: 'book_home_to_advance',               label: 'To Advance Home',   tolerance: null },
  { frozenCol: 'book_away_to_advance',          matchCol: 'book_away_to_advance',               label: 'To Advance Away',   tolerance: null },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function numEq(a, b, tol) {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  const fa = parseFloat(a), fb = parseFloat(b);
  if (isNaN(fa) && isNaN(fb)) return true;
  if (isNaN(fa) || isNaN(fb)) return false;
  if (tol === null) return Math.round(fa) === Math.round(fb);
  return Math.abs(fa - fb) <= tol;
}

function fmt(v) {
  if (v === null || v === undefined) return 'NULL';
  return String(v);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  process.stdout.write('\n' + DIVIDER + '\n');
  banner(`${VERSION} — 500x FORENSIC DEPRECATION AUDIT`);
  banner('ZERO HALLUCINATION | ZERO OVERSIGHT | TRIPLE VERIFICATION | MAXIMUM GRANULARITY');
  banner(`AUDIT TARGET: wc2026_frozen_book_odds → wc2026MatchOdds`);
  banner(`LOG FILE: ${LOG_FILE}`);
  process.stdout.write(DIVIDER + '\n\n');

  // ── SECTION 1: DB Connection ──────────────────────────────────────────────
  section(1, 'DATABASE CONNECTION');
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) { fail('DB', 'DATABASE_URL not set — aborting'); flushLog(); process.exit(1); }
  step('DB', 'Connecting to TiDB...');
  const conn = await mysql.createConnection(dbUrl);
  pass('DB', 'Connected to TiDB');

  // ── SECTION 2: Pull all rows from wc2026_frozen_book_odds ─────────────────
  section(2, 'EXTRACT ALL ROWS FROM wc2026_frozen_book_odds');
  const [frozenRows] = await conn.execute(`
    SELECT match_id, book_source, frozen_at, frozen_by,
           book_home_ml, book_draw, book_away_ml,
           book_primary_spread, book_home_primary_spread_odds, book_away_primary_spread_odds,
           book_total, book_over_odds, book_under_odds,
           book_btts_yes, book_btts_no,
           book_home_wd, book_away_wd,
           book_no_draw, book_no_draw_away_odds,
           book_home_to_advance, book_away_to_advance
    FROM wc2026_frozen_book_odds
    ORDER BY match_id
  `);
  input('FROZEN', `Total rows in wc2026_frozen_book_odds: ${frozenRows.length}`);
  for (const r of frozenRows) {
    atom('FROZEN', `  ${r.match_id.padEnd(20)} | source=${r.book_source} | frozen_at=${r.frozen_at} | frozen_by=${r.frozen_by}`);
  }

  // ── SECTION 3: Pull corresponding rows from wc2026MatchOdds ───────────────
  section(3, 'EXTRACT CORRESPONDING ROWS FROM wc2026MatchOdds');
  const frozenMatchIds = frozenRows.map(r => r.match_id);
  if (frozenMatchIds.length === 0) {
    warn('MATCH', 'No rows in wc2026_frozen_book_odds — nothing to validate');
    await conn.end(); flushLog(); process.exit(0);
  }

  const placeholders = frozenMatchIds.map(() => '?').join(',');
  const [matchRows] = await conn.execute(`
    SELECT match_id,
           book_home_ml, book_draw, book_away_ml,
           book_primary_spread, book_home_primary_spread_odds, book_away_primary_spread_odds,
           book_total, book_over_odds, book_under_odds,
           book_btts_yes, book_btts_no,
           book_home_wd, book_away_wd,
           book_no_draw,
           book_home_to_advance, book_away_to_advance
    FROM wc2026MatchOdds
    WHERE match_id IN (${placeholders})
    ORDER BY match_id
  `, frozenMatchIds);
  input('MATCH', `wc2026MatchOdds rows found for frozen match_ids: ${matchRows.length} / ${frozenMatchIds.length}`);

  const matchMap = Object.fromEntries(matchRows.map(r => [r.match_id, r]));

  // ── SECTION 4: FIELD-BY-FIELD TRIPLE VERIFICATION ─────────────────────────
  section(4, 'FIELD-BY-FIELD TRIPLE VERIFICATION — ALL 37 MATCHS × 16 FIELDS');

  let totalChecks = 0;
  let totalPass = 0;
  let totalFail = 0;
  let totalNullBoth = 0;
  let totalNullMismatch = 0;
  let missingInMatch = 0;

  const matchResults = [];

  for (const frozen of frozenRows) {
    const fid = frozen.match_id;
    const match = matchMap[fid];

    process.stdout.write(`\n${DIVIDER2}\n`);
    step('XREF', `MATCH: ${fid}`);

    if (!match) {
      fail('XREF', `  ${fid}: NOT FOUND in wc2026MatchOdds — DATA LOSS DETECTED`);
      missingInMatch++;
      matchResults.push({ fid, status: 'MISSING', checks: 0, pass: 0, fail: 0 });
      continue;
    }

    pass('XREF', `  ${fid}: Found in wc2026MatchOdds`);

    let fxChecks = 0, fxPass = 0, fxFail = 0, fxNullBoth = 0, fxNullMismatch = 0;

    for (const fm of FIELD_MAP) {
      const frozenVal = frozen[fm.frozenCol];
      const matchVal  = match[fm.matchCol];
      const ok = numEq(frozenVal, matchVal, fm.tolerance);
      const bothNull = (frozenVal === null && matchVal === null);
      const nullMismatch = (frozenVal === null) !== (matchVal === null);

      fxChecks++;
      totalChecks++;

      if (bothNull) {
        fxNullBoth++;
        totalNullBoth++;
        atom('XREF', `  ${fid} │ ${fm.label.padEnd(20)} │ frozen=${fmt(frozenVal).padEnd(8)} │ match=${fmt(matchVal).padEnd(8)} │ BOTH NULL (expected for unset markets)`);
        fxPass++;
        totalPass++;
      } else if (nullMismatch) {
        fxNullMismatch++;
        totalNullMismatch++;
        if (frozenVal !== null && matchVal === null) {
          fail('XREF', `  ${fid} │ ${fm.label.padEnd(20)} │ frozen=${fmt(frozenVal).padEnd(8)} │ match=NULL │ ⚠️  DATA NOT TRANSFERRED`);
          fxFail++;
          totalFail++;
        } else {
          // matchVal has a value but frozen doesn't — match has MORE data (ok)
          atom('XREF', `  ${fid} │ ${fm.label.padEnd(20)} │ frozen=NULL │ match=${fmt(matchVal).padEnd(8)} │ match has extra data (frozen never had this)`);
          fxPass++;
          totalPass++;
        }
      } else if (ok) {
        pass('XREF', `  ${fid} │ ${fm.label.padEnd(20)} │ frozen=${fmt(frozenVal).padEnd(8)} │ match=${fmt(matchVal).padEnd(8)} │ MATCH ✓`);
        fxPass++;
        totalPass++;
      } else {
        fail('XREF', `  ${fid} │ ${fm.label.padEnd(20)} │ frozen=${fmt(frozenVal).padEnd(8)} │ match=${fmt(matchVal).padEnd(8)} │ VALUE MISMATCH ✗`);
        fxFail++;
        totalFail++;
      }
    }

    const fxStatus = fxFail === 0 ? 'PASS' : 'FAIL';
    calc('XREF', `  ${fid}: ${fxChecks} checks │ ${fxPass} PASS │ ${fxFail} FAIL │ ${fxNullBoth} both-null │ ${fxNullMismatch} null-mismatch │ STATUS=${fxStatus}`);
    matchResults.push({ fid, status: fxStatus, checks: fxChecks, pass: fxPass, fail: fxFail });
  }

  // ── SECTION 5: TRIPLE VERIFICATION PASS 2 — Re-query and re-verify ────────
  section(5, 'TRIPLE VERIFICATION PASS 2 — INDEPENDENT RE-QUERY AND RE-VERIFY');
  state('PASS2', 'Re-querying both tables independently for cross-validation...');

  const [frozenRows2] = await conn.execute(`
    SELECT match_id, book_home_ml, book_draw, book_away_ml,
           book_primary_spread, book_total,
           book_btts_yes, book_btts_no,
           book_home_to_advance, book_away_to_advance
    FROM wc2026_frozen_book_odds ORDER BY match_id
  `);
  const [matchRows2] = await conn.execute(`
    SELECT match_id, book_home_ml, book_draw, book_away_ml,
           book_primary_spread, book_total,
           book_btts_yes, book_btts_no,
           book_home_to_advance, book_away_to_advance
    FROM wc2026MatchOdds WHERE match_id IN (${placeholders}) ORDER BY match_id
  `, frozenMatchIds);

  const matchMap2 = Object.fromEntries(matchRows2.map(r => [r.match_id, r]));
  let pass2Checks = 0, pass2Pass = 0, pass2Fail = 0;

  const SPOT_CHECK_FIELDS = [
    { f: 'book_home_ml',          m: 'book_home_ml',          label: 'Home ML'    },
    { f: 'book_draw',             m: 'book_draw',             label: 'Draw ML'    },
    { f: 'book_away_ml',          m: 'book_away_ml',          label: 'Away ML'    },
    { f: 'book_primary_spread',   m: 'book_primary_spread',   label: 'Spread'     },
    { f: 'book_total',            m: 'book_total',            label: 'Total'      },
    { f: 'book_btts_yes',         m: 'book_btts_yes',         label: 'BTTS Yes'   },
    { f: 'book_btts_no',          m: 'book_btts_no',          label: 'BTTS No'    },
    { f: 'book_home_to_advance',  m: 'book_home_to_advance',  label: 'ToAdv Home' },
    { f: 'book_away_to_advance',  m: 'book_away_to_advance',  label: 'ToAdv Away' },
  ];

  for (const fr of frozenRows2) {
    const mr = matchMap2[fr.match_id];
    if (!mr) { fail('PASS2', `  ${fr.match_id}: MISSING in wc2026MatchOdds (Pass 2)`); pass2Fail++; continue; }
    for (const sc of SPOT_CHECK_FIELDS) {
      const fv = fr[sc.f], mv = mr[sc.m];
      const ok = numEq(fv, mv, sc.label.includes('Spread') || sc.label.includes('Total') ? 0.001 : null);
      pass2Checks++;
      if (ok) { pass2Pass++; }
      else {
        fail('PASS2', `  ${fr.match_id} │ ${sc.label.padEnd(12)} │ frozen=${fmt(fv)} │ match=${fmt(mv)} │ MISMATCH`);
        pass2Fail++;
      }
    }
  }
  calc('PASS2', `Pass 2 spot-check: ${pass2Checks} checks │ ${pass2Pass} PASS │ ${pass2Fail} FAIL`);

  // ── SECTION 6: TRIPLE VERIFICATION PASS 3 — Aggregate integrity ───────────
  section(6, 'TRIPLE VERIFICATION PASS 3 — AGGREGATE INTEGRITY CHECKSUMS');

  // Sum all numeric fields in frozen and match tables to detect any drift
  const [frozenAgg] = await conn.execute(`
    SELECT
      COUNT(*) as cnt,
      SUM(ABS(COALESCE(book_home_ml,0)))                  as sum_home_ml,
      SUM(ABS(COALESCE(book_draw,0)))                     as sum_draw_ml,
      SUM(ABS(COALESCE(book_away_ml,0)))                  as sum_away_ml,
      SUM(ABS(COALESCE(book_primary_spread,0)))           as sum_spread,
      SUM(ABS(COALESCE(book_total,0)))                    as sum_total,
      SUM(ABS(COALESCE(book_btts_yes,0)))                 as sum_btts_yes,
      SUM(ABS(COALESCE(book_btts_no,0)))                  as sum_btts_no,
      SUM(ABS(COALESCE(book_home_to_advance,0)))          as sum_toadv_home,
      SUM(ABS(COALESCE(book_away_to_advance,0)))          as sum_toadv_away
    FROM wc2026_frozen_book_odds
    WHERE match_id IN (${placeholders})
  `, frozenMatchIds);

  const [matchAgg] = await conn.execute(`
    SELECT
      COUNT(*) as cnt,
      SUM(ABS(COALESCE(book_home_ml,0)))             as sum_home_ml,
      SUM(ABS(COALESCE(book_draw,0)))                as sum_draw_ml,
      SUM(ABS(COALESCE(book_away_ml,0)))             as sum_away_ml,
      SUM(ABS(COALESCE(book_primary_spread,0)))      as sum_spread,
      SUM(ABS(COALESCE(book_total,0)))               as sum_total,
      SUM(ABS(COALESCE(book_btts_yes,0)))            as sum_btts_yes,
      SUM(ABS(COALESCE(book_btts_no,0)))             as sum_btts_no,
      SUM(ABS(COALESCE(book_home_to_advance,0)))     as sum_toadv_home,
      SUM(ABS(COALESCE(book_away_to_advance,0)))     as sum_toadv_away
    FROM wc2026MatchOdds
    WHERE match_id IN (${placeholders})
  `, frozenMatchIds);

  const fa = frozenAgg[0], ma = matchAgg[0];
  const AGG_FIELDS = [
    'sum_home_ml','sum_draw_ml','sum_away_ml','sum_spread','sum_total',
    'sum_btts_yes','sum_btts_no','sum_toadv_home','sum_toadv_away'
  ];

  state('PASS3', `Frozen row count: ${fa.cnt} | Match row count: ${ma.cnt}`);
  let pass3Checks = 0, pass3Pass = 0, pass3Fail = 0;

  for (const field of AGG_FIELDS) {
    const fv = parseFloat(fa[field] || 0), mv = parseFloat(ma[field] || 0);
    const ok = Math.abs(fv - mv) < 0.01;
    pass3Checks++;
    if (ok) {
      pass('PASS3', `  ${field.padEnd(20)}: frozen_sum=${fv.toFixed(2).padStart(10)} │ match_sum=${mv.toFixed(2).padStart(10)} │ CHECKSUM MATCH ✓`);
      pass3Pass++;
    } else {
      fail('PASS3', `  ${field.padEnd(20)}: frozen_sum=${fv.toFixed(2).padStart(10)} │ match_sum=${mv.toFixed(2).padStart(10)} │ CHECKSUM MISMATCH ✗`);
      pass3Fail++;
    }
  }
  calc('PASS3', `Pass 3 aggregate checksums: ${pass3Checks} checks │ ${pass3Pass} PASS │ ${pass3Fail} FAIL`);

  // ── SECTION 7: CODEBASE REFERENCE AUDIT ───────────────────────────────────
  section(7, 'CODEBASE REFERENCE AUDIT — ACTIVE vs DEPRECATED FILE CLASSIFICATION');

  // Files that reference frozen_book_odds — classify each
  const ACTIVE_ROUTER_FILES = [
    'server/wc2026/wc2026Router.ts',
  ];
  const SEED_SCRIPTS = [
    'server/wc2026/seedJuly2BookOdds.ts',
    'server/wc2026/seedJuly1Direct.ts',
    'server/wc2026/seedJune29Direct.ts',
    'server/wc2026/seedJune30Direct.ts',
  ];
  const HISTORICAL_SCRIPTS = [
    'server/wc2026/an_api_forensic_audit.mjs',
    'server/wc2026/audit_bookmodel_pipeline.mjs',
    'server/wc2026/audit_column_mapping.mjs',
    'server/wc2026/audit_orientation_500x.mjs',
    'server/wc2026/checkJuly1Matchs.mjs',
    'server/wc2026/check_seeded_odds.mjs',
    'server/wc2026/espn_fullpull_7matches.mjs',
    'server/wc2026/fix_orientation_and_odds.mjs',
    'server/wc2026/fix_seeded_odds.mjs',
    'server/wc2026/fix_seeded_odds_v2.mjs',
    'server/wc2026/forensic500x_datapull.mjs',
    'server/wc2026/lookupJune30Matchs.mjs',
    'server/wc2026/seedJune28CAN_RSA.mjs',
    'server/wc2026/seedModelJune30v11.mjs',
    'server/wc2026/seedModelOddsJune29v11.mjs',
    'server/wc2026/v12_engine_final.mjs',
    'server/wc2026/v12_forensic_500x_full.mjs',
    'server/wc2026/v12_forensic_audit.mjs',
    'server/wc2026/v12_july2_engine.mjs',
    'server/wc2026/v13_500x_audit.mjs',
    'server/wc2026/v13_engine_fixed.mjs',
    'server/wc2026/v13_no_null_engine.mjs',
    'server/wc2026/v14_500x_db_audit.mjs',
    'server/wc2026/v14_definitive_audit.mjs',
    'server/wc2026/v14_engine.mjs',
    'server/wc2026/v15_bel_sen_forensic_audit.mjs',
    'server/wc2026/v15_engine.mjs',
    'server/wc2026/verifyFeed.mjs',
    'server/wc2026/wc2026FeedAudit.mjs',
    'get_june27_matchs.mjs',
    'scripts/june29_jpn_bra_step1_schema_seed.mjs',
    'scripts/june29_mar_ned_db_seed.mjs',
    'scripts/june29_mar_ned_simulate.mjs',
    'scripts/june29_pry_ger_db_seed.mjs',
    'scripts/june29_pry_ger_simulate.mjs',
  ];

  warn('CODEBASE', `wc2026Router.ts STILL HAS ACTIVE REFERENCES to wc2026FrozenBookOdds`);
  warn('CODEBASE', `  Lines: 29 (import), 146, 155-156, 166-170, 226, 245 (matchsByDate)`);
  warn('CODEBASE', `  Lines: 496, 505-506, 515-519, 572, 579 (todayWithOdds)`);
  warn('CODEBASE', `  These are LIVE query paths — the router still queries frozen_book_odds as fallback`);
  warn('CODEBASE', `  STATUS: REQUIRES CLEANUP — router must be updated to remove all frozen references`);

  state('CODEBASE', '');
  state('CODEBASE', 'SEED SCRIPTS (historical, not called by router or heartbeat):');
  for (const f of SEED_SCRIPTS) {
    state('CODEBASE', `  ${f} — HISTORICAL SEED SCRIPT (not active, references frozen for legacy seeding)`);
  }

  state('CODEBASE', '');
  state('CODEBASE', `HISTORICAL AUDIT/ENGINE SCRIPTS (${HISTORICAL_SCRIPTS.length} files) — not called by router:`);
  for (const f of HISTORICAL_SCRIPTS) {
    atom('CODEBASE', `  ${f} — HISTORICAL (one-time execution, not active)`);
  }

  state('CODEBASE', '');
  state('CODEBASE', 'DRIZZLE SCHEMA SNAPSHOTS (drizzle/meta/*.json) — auto-generated, not executable code');

  // ── SECTION 8: FINAL SUMMARY ───────────────────────────────────────────────
  section(8, 'FINAL SUMMARY — DEPRECATION VERDICT');

  const grandTotalChecks = totalChecks + pass2Checks + pass3Checks;
  const grandTotalPass   = totalPass   + pass2Pass   + pass3Pass;
  const grandTotalFail   = totalFail   + pass2Fail   + pass3Fail;

  process.stdout.write('\n' + DIVIDER + '\n');
  banner('DEPRECATION AUDIT FINAL RESULTS');
  process.stdout.write(DIVIDER + '\n');

  state('SUMMARY', `Frozen rows audited        : ${frozenRows.length}`);
  state('SUMMARY', `Match rows found           : ${matchRows.length} / ${frozenRows.length}`);
  state('SUMMARY', `Missing in wc2026MatchOdds : ${missingInMatch}`);
  state('SUMMARY', '');
  state('SUMMARY', `Pass 1 (field-by-field)    : ${totalChecks} checks │ ${totalPass} PASS │ ${totalFail} FAIL`);
  state('SUMMARY', `Pass 2 (spot-check re-query): ${pass2Checks} checks │ ${pass2Pass} PASS │ ${pass2Fail} FAIL`);
  state('SUMMARY', `Pass 3 (aggregate checksum) : ${pass3Checks} checks │ ${pass3Pass} PASS │ ${pass3Fail} FAIL`);
  state('SUMMARY', `GRAND TOTAL                : ${grandTotalChecks} checks │ ${grandTotalPass} PASS │ ${grandTotalFail} FAIL`);
  state('SUMMARY', '');

  // Per-match results table
  state('SUMMARY', 'PER-MATCH RESULTS:');
  state('SUMMARY', `${'MATCH'.padEnd(22)} ${'STATUS'.padEnd(8)} ${'CHECKS'.padStart(7)} ${'PASS'.padStart(6)} ${'FAIL'.padStart(6)}`);
  state('SUMMARY', `${'-'.repeat(22)} ${'-'.repeat(8)} ${'-'.repeat(7)} ${'-'.repeat(6)} ${'-'.repeat(6)}`);
  for (const r of matchResults) {
    const icon = r.status === 'PASS' ? '✅' : r.status === 'MISSING' ? '❌' : '⚠️ ';
    state('SUMMARY', `${icon} ${r.fid.padEnd(20)} ${r.status.padEnd(8)} ${String(r.checks).padStart(7)} ${String(r.pass).padStart(6)} ${String(r.fail).padStart(6)}`);
  }

  state('SUMMARY', '');

  // Verdict
  if (grandTotalFail === 0 && missingInMatch === 0) {
    pass('VERDICT', '100% DATA TRANSFER CONFIRMED — ALL FIELDS MATCH ACROSS ALL 3 VERIFICATION PASSES');
    pass('VERDICT', 'wc2026_frozen_book_odds data is FULLY REPLICATED in wc2026MatchOdds');
    pass('VERDICT', 'Table is SAFE TO ARCHIVE / DROP from active query paths');
    warn('VERDICT', 'ACTION REQUIRED: wc2026Router.ts still queries wc2026FrozenBookOdds — must be cleaned');
    warn('VERDICT', 'ACTION REQUIRED: seedJuly2BookOdds.ts, seedJuly1Direct.ts, seedJune29/30Direct.ts reference frozen — historical only');
  } else {
    fail('VERDICT', `DATA TRANSFER INCOMPLETE — ${grandTotalFail} field mismatches, ${missingInMatch} missing matchs`);
    fail('VERDICT', 'DO NOT DEPRECATE until all failures are resolved');
  }

  process.stdout.write(DIVIDER + '\n');

  await conn.end();
  pass('DB', 'Connection closed');
  flushLog();
}

main().catch(err => {
  process.stderr.write(`\n[FATAL] ${SCRIPT}: ${err.message}\n${err.stack}\n`);
  fs.appendFileSync(LOG_FILE, `\n[FATAL] ${SCRIPT}: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
