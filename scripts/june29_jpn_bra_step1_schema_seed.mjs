/**
 * june29_jpn_bra_step1_schema_seed.mjs
 * ═══════════════════════════════════════════════════════════════════════════════
 * STEP 1 OF 2 — SCHEMA MIGRATION + FIXTURE + FROZEN BOOK ODDS SEED
 * Match: Japan (Away) vs Brazil (Home) — Round of 32
 * Fixture ID: wc26-r32-074
 * Date: June 29, 2026 | Kickoff: 1:00 PM ET = 17:00 UTC
 * Venue: Estadio Azteca, Mexico City (mexico-city)
 *
 * OPERATIONS:
 *   [A] ALTER TABLE — add to_advance_home_odds + to_advance_away_odds to
 *       wc2026_frozen_book_odds and wc2026_model_projections
 *   [B] Validate team IDs (jpn, bra) and venue (mexico-city) exist in DB
 *   [C] Idempotent fixture insert (delete + re-insert if exists)
 *   [D] Insert frozen DK book odds including to_advance market
 *   [E] Full verification — every field validated against expected values
 *
 * LOGGING FRAMEWORK:
 *   - Dual output: terminal (stdout) + /home/ubuntu/june29_jpn_bra.log
 *   - Tags: [PHASE][STEP][INPUT][STATE][OUTPUT][VERIFY][PASS][FAIL][GATE][WARN]
 *   - Timestamps on every line (ISO 8601 ms precision)
 *   - Section banners with ═══ borders for visual segmentation
 *   - Inline diff display for schema changes
 *   - Cumulative pass/fail counter
 *   - Fatal error: full stack trace + context dump before exit(1)
 *
 * SCHEMA MAPPING (DraftKings, June 29 2026):
 *   Home = Brazil (bra) | Away = Japan (jpn)
 *   book_home_ml        = -140  (Brazil ML)
 *   book_away_ml        = +425  (Japan ML)
 *   book_draw_ml        = +270  (Draw)
 *   book_spread_line    = -1.5  (HOME Brazil -1.5 → home spread line = -1.5)
 *   book_home_spread_odds = +210 (Brazil -1.5)
 *   book_away_spread_odds = -275 (Japan +1.5)
 *   book_total_line     = 2.5
 *   book_over_odds      = -130
 *   book_under_odds     = +105
 *   book_btts_yes_odds  = -105
 *   book_btts_no_odds   = -120
 *   book_dc_1x_odds     = +180  (Japan or Draw = away or draw = DC 1X)
 *   book_dc_x2_odds     = -500  (Brazil or Draw = home or draw = DC X2)
 *   book_no_draw_away_odds = -1400 (Japan or Brazil no draw — stored as away no-draw)
 *   to_advance_home_odds = -320 (Brazil to Advance)
 *   to_advance_away_odds = +240 (Japan to Advance)
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../.env') });

// ── LOGGING FRAMEWORK ─────────────────────────────────────────────────────────
const LOG_FILE = '/home/ubuntu/june29_jpn_bra.log';
const LOG_STREAM = fs.createWriteStream(LOG_FILE, { flags: 'a' });

let passCount = 0;
let failCount = 0;
let warnCount = 0;
let stepCount = 0;

function ts() {
  return new Date().toISOString();
}

function pad(s, n = 80) {
  return String(s).padEnd(n);
}

function log(tag, msg, extra = '') {
  const line = `[${ts()}] ${tag.padEnd(8)} │ ${msg}${extra ? '  ' + extra : ''}`;
  process.stdout.write(line + '\n');
  LOG_STREAM.write(line + '\n');
}

function banner(title, char = '═') {
  const border = char.repeat(78);
  const titleLine = `${char}${char}  ${title}  `.padEnd(77, char) + char;
  log('', '');
  log('BANNER', border);
  log('BANNER', titleLine);
  log('BANNER', border);
}

function subBanner(title) {
  const line = `── ${title} ${'─'.repeat(Math.max(0, 72 - title.length))}`;
  log('', '');
  log('SECTION', line);
}

function logPass(msg) {
  passCount++;
  log('✅ PASS', msg);
}

function logFail(msg) {
  failCount++;
  log('❌ FAIL', msg);
}

function logWarn(msg) {
  warnCount++;
  log('⚠️  WARN', msg);
}

function logStep(msg) {
  stepCount++;
  log(`STEP ${String(stepCount).padStart(2,'0')}`, msg);
}

function logInput(msg) { log('INPUT', msg); }
function logState(msg) { log('STATE', msg); }
function logOutput(msg) { log('OUTPUT', msg); }
function logVerify(msg) { log('VERIFY', msg); }
function logGate(msg) { log('GATE', msg); }
function logPhase(msg) { log('PHASE', msg); }

function fatal(msg, err = null) {
  log('💀 FATAL', msg);
  if (err) {
    log('💀 FATAL', `Error class: ${err.constructor.name}`);
    log('💀 FATAL', `Message: ${err.message}`);
    if (err.stack) {
      err.stack.split('\n').forEach(line => log('💀 STACK', line));
    }
  }
  log('💀 FATAL', `Cumulative stats at abort: PASS=${passCount} FAIL=${failCount} WARN=${warnCount} STEPS=${stepCount}`);
  LOG_STREAM.end();
  process.exit(1);
}

function summary() {
  banner('EXECUTION SUMMARY', '─');
  log('SUMMARY', `Total steps executed : ${stepCount}`);
  log('SUMMARY', `Total PASS           : ${passCount}`);
  log('SUMMARY', `Total FAIL           : ${failCount}`);
  log('SUMMARY', `Total WARN           : ${warnCount}`);
  log('SUMMARY', `Log file             : ${LOG_FILE}`);
  if (failCount > 0) {
    log('SUMMARY', `⚠️  COMPLETED WITH ${failCount} FAILURE(S) — review log`);
  } else {
    log('SUMMARY', `✅ ALL CHECKS PASSED — zero failures`);
  }
}

// ── CONSTANTS ─────────────────────────────────────────────────────────────────
const FIXTURE_ID   = 'wc26-r32-074';
const HOME_TEAM    = 'bra';         // Brazil
const AWAY_TEAM    = 'jpn';         // Japan
const VENUE_ID     = 'mexico-city'; // Estadio Azteca
const MATCH_DATE   = '2026-06-29';
const KICKOFF_UTC  = '2026-06-29 17:00:00';  // 1:00 PM ET = 17:00 UTC
const STAGE        = 'R32';
const DISPLAY_ORDER = 1;

// DraftKings Frozen Odds — June 29, 2026
// Home = Brazil | Away = Japan
const ODDS = {
  book_home_ml:            -140,  // Brazil ML
  book_draw_ml:             270,  // Draw
  book_away_ml:             425,  // Japan ML
  // Spread: Brazil (HOME) -1.5 → book_spread_line = -1.5 (home team line)
  book_spread_line:         -1.5, // HOME team spread line (Brazil -1.5)
  book_home_spread_odds:    210,  // Brazil -1.5 odds
  book_away_spread_odds:   -275,  // Japan +1.5 odds
  // Total
  book_total_line:           2.5,
  book_over_odds:           -130,
  book_under_odds:           105,
  // BTTS
  book_btts_yes_odds:       -105,
  book_btts_no_odds:        -120,
  // Double Chance
  // DC 1X = Away or Draw = Japan or Draw = +180
  // DC X2 = Home or Draw = Brazil or Draw = -500
  book_dc_1x_odds:           180,  // Japan or Draw (away or draw)
  book_dc_x2_odds:          -500,  // Brazil or Draw (home or draw)
  // No Draw: Japan or Brazil (no draw) = -1400
  book_no_draw_home_odds:   null,  // Not separately provided
  book_no_draw_away_odds:  -1400,  // Japan or Brazil no draw (stored as away no-draw)
  // To Advance (knockout round — who advances)
  to_advance_home_odds:     -320,  // Brazil to Advance
  to_advance_away_odds:      240,  // Japan to Advance
  book_source: 'DK_FROZEN',
};

// ── MAIN EXECUTION ────────────────────────────────────────────────────────────
banner('JUNE 29 WC2026 — JAPAN vs BRAZIL — STEP 1: SCHEMA MIGRATION + SEED');
log('INIT', `Script: june29_jpn_bra_step1_schema_seed.mjs`);
log('INIT', `Log file: ${LOG_FILE} (append mode)`);
log('INIT', `Fixture ID: ${FIXTURE_ID}`);
log('INIT', `Match: ${AWAY_TEAM.toUpperCase()}(Away) vs ${HOME_TEAM.toUpperCase()}(Home)`);
log('INIT', `Date: ${MATCH_DATE} | Kickoff: ${KICKOFF_UTC} (1:00 PM ET)`);
log('INIT', `Venue: ${VENUE_ID}`);
log('INIT', `Node version: ${process.version}`);
log('INIT', `PID: ${process.pid}`);

logInput(`book_home_ml=${ODDS.book_home_ml} (Brazil ML)`);
logInput(`book_draw_ml=${ODDS.book_draw_ml} (Draw)`);
logInput(`book_away_ml=${ODDS.book_away_ml} (Japan ML)`);
logInput(`book_spread_line=${ODDS.book_spread_line} (Brazil -1.5 = home spread line)`);
logInput(`book_home_spread_odds=${ODDS.book_home_spread_odds} (Brazil -1.5)`);
logInput(`book_away_spread_odds=${ODDS.book_away_spread_odds} (Japan +1.5)`);
logInput(`book_total_line=${ODDS.book_total_line} | over=${ODDS.book_over_odds} | under=${ODDS.book_under_odds}`);
logInput(`book_btts_yes_odds=${ODDS.book_btts_yes_odds} | book_btts_no_odds=${ODDS.book_btts_no_odds}`);
logInput(`book_dc_1x_odds=${ODDS.book_dc_1x_odds} (Japan or Draw) | book_dc_x2_odds=${ODDS.book_dc_x2_odds} (Brazil or Draw)`);
logInput(`book_no_draw_away_odds=${ODDS.book_no_draw_away_odds} (Japan or Brazil no draw)`);
logInput(`to_advance_home_odds=${ODDS.to_advance_home_odds} (Brazil to Advance)`);
logInput(`to_advance_away_odds=${ODDS.to_advance_away_odds} (Japan to Advance)`);

async function run() {
  // ── PHASE A: DATABASE CONNECTION ──────────────────────────────────────────
  banner('PHASE A — DATABASE CONNECTION');
  logPhase('Establishing TiDB Cloud connection via DATABASE_URL');
  logStep('Connect to MySQL/TiDB via mysql2/promise');

  if (!process.env.DATABASE_URL) fatal('DATABASE_URL environment variable is not set');
  const urlMasked = process.env.DATABASE_URL.replace(/:([^@]+)@/, ':***@');
  logState(`DATABASE_URL (masked): ${urlMasked}`);

  let conn;
  try {
    conn = await mysql.createConnection(process.env.DATABASE_URL);
    logPass('Database connection established');
  } catch (e) {
    fatal('Failed to connect to database', e);
  }

  // ── PHASE B: SCHEMA MIGRATION — ADD to_advance COLUMNS ───────────────────
  banner('PHASE B — SCHEMA MIGRATION: ADD to_advance COLUMNS');
  logPhase('Adding to_advance_home_odds + to_advance_away_odds to both target tables');

  const alterOps = [
    {
      table: 'wc2026_frozen_book_odds',
      col: 'to_advance_home_odds',
      sql: 'ALTER TABLE wc2026_frozen_book_odds ADD COLUMN to_advance_home_odds SMALLINT NULL AFTER book_no_draw_away_odds',
    },
    {
      table: 'wc2026_frozen_book_odds',
      col: 'to_advance_away_odds',
      sql: 'ALTER TABLE wc2026_frozen_book_odds ADD COLUMN to_advance_away_odds SMALLINT NULL AFTER to_advance_home_odds',
    },
    {
      table: 'wc2026_model_projections',
      col: 'to_advance_home_prob',
      sql: 'ALTER TABLE wc2026_model_projections ADD COLUMN to_advance_home_prob DOUBLE NULL AFTER btts_no_odds',
    },
    {
      table: 'wc2026_model_projections',
      col: 'to_advance_away_prob',
      sql: 'ALTER TABLE wc2026_model_projections ADD COLUMN to_advance_away_prob DOUBLE NULL AFTER to_advance_home_prob',
    },
    {
      table: 'wc2026_model_projections',
      col: 'to_advance_home_odds',
      sql: 'ALTER TABLE wc2026_model_projections ADD COLUMN to_advance_home_odds SMALLINT NULL AFTER to_advance_away_prob',
    },
    {
      table: 'wc2026_model_projections',
      col: 'to_advance_away_odds',
      sql: 'ALTER TABLE wc2026_model_projections ADD COLUMN to_advance_away_odds SMALLINT NULL AFTER to_advance_home_odds',
    },
  ];

  for (const op of alterOps) {
    logStep(`ALTER TABLE ${op.table} — ADD COLUMN ${op.col}`);
    logState(`SQL: ${op.sql}`);
    try {
      await conn.execute(op.sql);
      logPass(`Column added: ${op.table}.${op.col}`);
    } catch (e) {
      if (e.message.includes('Duplicate column name') || e.message.includes('already exists') || e.code === 'ER_DUP_FIELDNAME') {
        logWarn(`Column ${op.table}.${op.col} already exists — skipping (idempotent)`);
      } else {
        fatal(`Unexpected error adding column ${op.table}.${op.col}`, e);
      }
    }
  }

  // Verify columns exist post-migration
  subBanner('POST-MIGRATION COLUMN VERIFICATION');
  logStep('Verify to_advance columns in wc2026_frozen_book_odds');
  const [fboDesc] = await conn.execute('DESCRIBE wc2026_frozen_book_odds');
  const fboCols = fboDesc.map(r => r.Field);
  for (const col of ['to_advance_home_odds', 'to_advance_away_odds']) {
    if (fboCols.includes(col)) {
      logPass(`wc2026_frozen_book_odds.${col} — PRESENT`);
    } else {
      logFail(`wc2026_frozen_book_odds.${col} — MISSING after ALTER`);
    }
  }

  logStep('Verify to_advance columns in wc2026_model_projections');
  const [mpDesc] = await conn.execute('DESCRIBE wc2026_model_projections');
  const mpCols = mpDesc.map(r => r.Field);
  for (const col of ['to_advance_home_prob', 'to_advance_away_prob', 'to_advance_home_odds', 'to_advance_away_odds']) {
    if (mpCols.includes(col)) {
      logPass(`wc2026_model_projections.${col} — PRESENT`);
    } else {
      logFail(`wc2026_model_projections.${col} — MISSING after ALTER`);
    }
  }

  // ── PHASE C: VALIDATE REFERENCE DATA ─────────────────────────────────────
  banner('PHASE C — VALIDATE REFERENCE DATA (TEAMS + VENUE)');

  logStep(`Validate team IDs: home=${HOME_TEAM}, away=${AWAY_TEAM}`);
  const [teams] = await conn.execute(
    'SELECT team_id, name, fifa_code FROM wc2026_teams WHERE team_id IN (?, ?)',
    [HOME_TEAM, AWAY_TEAM]
  );
  logState(`Teams found in DB: ${teams.length}/2`);
  if (teams.length !== 2) {
    fatal(`Expected 2 teams, found ${teams.length}. Missing team IDs: ${JSON.stringify(teams.map(t=>t.team_id))}`);
  }
  for (const t of teams) {
    logVerify(`Team: team_id=${t.team_id} | name=${t.name} | fifa_code=${t.fifa_code}`);
    logPass(`Team ${t.team_id} (${t.name}) validated`);
  }

  logStep(`Validate venue: ${VENUE_ID}`);
  const [venues] = await conn.execute(
    'SELECT venue_id, city, stadium, country FROM wc2026_venues WHERE venue_id = ?',
    [VENUE_ID]
  );
  if (venues.length === 0) {
    fatal(`Venue not found in wc2026_venues: ${VENUE_ID}`);
  }
  const v = venues[0];
  logVerify(`Venue: venue_id=${v.venue_id} | stadium=${v.stadium} | city=${v.city}`);
  logPass(`Venue ${VENUE_ID} validated`);

  // ── PHASE D: IDEMPOTENT FIXTURE INSERT ────────────────────────────────────
  banner('PHASE D — FIXTURE INSERT (IDEMPOTENT)');

  logStep(`Check for existing fixture: ${FIXTURE_ID}`);
  const [existing] = await conn.execute(
    'SELECT fixture_id, match_date, kickoff_utc FROM wc2026_matches WHERE fixture_id = ?',
    [FIXTURE_ID]
  );
  logState(`Existing rows for ${FIXTURE_ID}: ${existing.length}`);

  if (existing.length > 0) {
    logWarn(`Fixture ${FIXTURE_ID} already exists — executing idempotent delete + re-insert`);
    logState(`Existing record: ${JSON.stringify(existing[0])}`);

    logStep(`Delete existing frozen_book_odds for ${FIXTURE_ID}`);
    const [delOdds] = await conn.execute(
      'DELETE FROM wc2026_frozen_book_odds WHERE fixture_id = ?', [FIXTURE_ID]
    );
    logState(`Deleted ${delOdds.affectedRows} frozen_book_odds rows`);
    logPass(`Frozen book odds cleared for ${FIXTURE_ID}`);

    logStep(`Delete existing model_projections for ${FIXTURE_ID}`);
    const [delProj] = await conn.execute(
      'DELETE FROM wc2026_model_projections WHERE fixture_id = ?', [FIXTURE_ID]
    );
    logState(`Deleted ${delProj.affectedRows} model_projections rows`);
    logPass(`Model projections cleared for ${FIXTURE_ID}`);

    logStep(`Delete existing fixture record: ${FIXTURE_ID}`);
    const [delFix] = await conn.execute(
      'DELETE FROM wc2026_matches WHERE fixture_id = ?', [FIXTURE_ID]
    );
    logState(`Deleted ${delFix.affectedRows} fixture rows`);
    logPass(`Fixture record cleared for ${FIXTURE_ID}`);
  } else {
    logState(`No existing fixture found — proceeding with fresh insert`);
  }

  logStep(`Insert fixture: ${FIXTURE_ID} | ${HOME_TEAM.toUpperCase()}(H) vs ${AWAY_TEAM.toUpperCase()}(A)`);
  logState(`match_date=${MATCH_DATE} | kickoff_utc=${KICKOFF_UTC} | stage=${STAGE} | venue=${VENUE_ID}`);
  logState(`display_order=${DISPLAY_ORDER} | is_host_home=0 (Brazil is host nation but not at home stadium)`);

  try {
    await conn.execute(
      `INSERT INTO wc2026_matches
        (fixture_id, match_date, kickoff_utc, stage, group_letter, matchday,
         home_team_id, away_team_id, venue_id, home_score, away_score,
         status, is_host_home, display_order)
       VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, NULL, NULL, 'SCHEDULED', 0, ?)`,
      [FIXTURE_ID, MATCH_DATE, KICKOFF_UTC, STAGE, HOME_TEAM, AWAY_TEAM, VENUE_ID, DISPLAY_ORDER]
    );
    logPass(`Fixture inserted: ${FIXTURE_ID}`);
  } catch (e) {
    fatal(`Failed to insert fixture ${FIXTURE_ID}`, e);
  }

  // ── PHASE E: INSERT FROZEN BOOK ODDS ─────────────────────────────────────
  banner('PHASE E — INSERT FROZEN DK BOOK ODDS (INCLUDING to_advance)');

  logStep('Prepare frozen book odds payload');
  logState(`book_home_ml=${ODDS.book_home_ml} (Brazil ML) | book_draw_ml=${ODDS.book_draw_ml} | book_away_ml=${ODDS.book_away_ml} (Japan ML)`);
  logState(`book_spread_line=${ODDS.book_spread_line} (Brazil -1.5) | home_spread_odds=${ODDS.book_home_spread_odds} | away_spread_odds=${ODDS.book_away_spread_odds}`);
  logState(`book_total_line=${ODDS.book_total_line} | over=${ODDS.book_over_odds} | under=${ODDS.book_under_odds}`);
  logState(`btts_yes=${ODDS.book_btts_yes_odds} | btts_no=${ODDS.book_btts_no_odds}`);
  logState(`dc_1x=${ODDS.book_dc_1x_odds} (Japan or Draw) | dc_x2=${ODDS.book_dc_x2_odds} (Brazil or Draw)`);
  logState(`no_draw_home=${ODDS.book_no_draw_home_odds} | no_draw_away=${ODDS.book_no_draw_away_odds}`);
  logState(`to_advance_home=${ODDS.to_advance_home_odds} (Brazil) | to_advance_away=${ODDS.to_advance_away_odds} (Japan)`);
  logState(`book_source=${ODDS.book_source}`);

  logStep('Execute INSERT INTO wc2026_frozen_book_odds');
  try {
    await conn.execute(
      `INSERT INTO wc2026_frozen_book_odds
        (fixture_id, frozen_at, frozen_by,
         book_home_ml, book_draw_ml, book_away_ml,
         book_spread_line, book_home_spread_odds, book_away_spread_odds,
         book_total_line, book_over_odds, book_under_odds,
         book_btts_yes_odds, book_btts_no_odds,
         book_dc_1x_odds, book_dc_x2_odds,
         book_no_draw_home_odds, book_no_draw_away_odds,
         to_advance_home_odds, to_advance_away_odds,
         book_source)
       VALUES (?, NOW(), 'manual_seed',
               ?, ?, ?,
               ?, ?, ?,
               ?, ?, ?,
               ?, ?,
               ?, ?,
               ?, ?,
               ?, ?,
               ?)`,
      [
        FIXTURE_ID,
        ODDS.book_home_ml, ODDS.book_draw_ml, ODDS.book_away_ml,
        ODDS.book_spread_line, ODDS.book_home_spread_odds, ODDS.book_away_spread_odds,
        ODDS.book_total_line, ODDS.book_over_odds, ODDS.book_under_odds,
        ODDS.book_btts_yes_odds, ODDS.book_btts_no_odds,
        ODDS.book_dc_1x_odds, ODDS.book_dc_x2_odds,
        ODDS.book_no_draw_home_odds, ODDS.book_no_draw_away_odds,
        ODDS.to_advance_home_odds, ODDS.to_advance_away_odds,
        ODDS.book_source,
      ]
    );
    logPass('Frozen book odds row inserted');
  } catch (e) {
    fatal('Failed to insert frozen book odds', e);
  }

  // ── PHASE F: FULL VERIFICATION ────────────────────────────────────────────
  banner('PHASE F — FULL VERIFICATION (FIXTURE + ODDS)');

  logStep('Query fixture row back from DB for verification');
  const [verFix] = await conn.execute(
    `SELECT fixture_id, match_date, kickoff_utc, stage, home_team_id, away_team_id,
            venue_id, status, display_order, is_host_home
     FROM wc2026_matches WHERE fixture_id = ?`,
    [FIXTURE_ID]
  );
  if (verFix.length === 0) fatal(`Fixture ${FIXTURE_ID} not found in DB after insert`);
  const fx = verFix[0];
  logOutput(`Fixture row: ${JSON.stringify(fx)}`);

  const fixChecks = [
    ['fixture_id',    fx.fixture_id,    FIXTURE_ID],
    ['match_date',    fx.match_date instanceof Date ? fx.match_date.toISOString().slice(0,10) : String(fx.match_date).slice(0,10), MATCH_DATE],
    ['stage',         fx.stage,         STAGE],
    ['home_team_id',  fx.home_team_id,  HOME_TEAM],
    ['away_team_id',  fx.away_team_id,  AWAY_TEAM],
    ['venue_id',      fx.venue_id,      VENUE_ID],
    ['status',        fx.status,        'SCHEDULED'],
    ['display_order', Number(fx.display_order), DISPLAY_ORDER],
  ];

  subBanner('FIXTURE FIELD VALIDATION');
  for (const [field, actual, expected] of fixChecks) {
    if (String(actual) === String(expected)) {
      logPass(`fixture.${field}: expected="${expected}" actual="${actual}"`);
    } else {
      logFail(`fixture.${field}: expected="${expected}" actual="${actual}" — MISMATCH`);
    }
  }

  logStep('Query frozen_book_odds row back from DB for verification');
  const [verOdds] = await conn.execute(
    `SELECT fixture_id,
            book_home_ml, book_draw_ml, book_away_ml,
            book_spread_line, book_home_spread_odds, book_away_spread_odds,
            book_total_line, book_over_odds, book_under_odds,
            book_btts_yes_odds, book_btts_no_odds,
            book_dc_1x_odds, book_dc_x2_odds,
            book_no_draw_home_odds, book_no_draw_away_odds,
            to_advance_home_odds, to_advance_away_odds,
            book_source, frozen_by
     FROM wc2026_frozen_book_odds WHERE fixture_id = ?`,
    [FIXTURE_ID]
  );
  if (verOdds.length === 0) fatal(`Frozen book odds for ${FIXTURE_ID} not found in DB after insert`);
  const od = verOdds[0];
  logOutput(`Frozen odds row: ${JSON.stringify(od)}`);

  subBanner('FROZEN ODDS FIELD VALIDATION (17 CHECKS)');
  const oddsChecks = [
    ['book_home_ml',           Number(od.book_home_ml),           ODDS.book_home_ml],
    ['book_draw_ml',           Number(od.book_draw_ml),           ODDS.book_draw_ml],
    ['book_away_ml',           Number(od.book_away_ml),           ODDS.book_away_ml],
    ['book_spread_line',       parseFloat(od.book_spread_line),   ODDS.book_spread_line],
    ['book_home_spread_odds',  Number(od.book_home_spread_odds),  ODDS.book_home_spread_odds],
    ['book_away_spread_odds',  Number(od.book_away_spread_odds),  ODDS.book_away_spread_odds],
    ['book_total_line',        parseFloat(od.book_total_line),    ODDS.book_total_line],
    ['book_over_odds',         Number(od.book_over_odds),         ODDS.book_over_odds],
    ['book_under_odds',        Number(od.book_under_odds),        ODDS.book_under_odds],
    ['book_btts_yes_odds',     Number(od.book_btts_yes_odds),     ODDS.book_btts_yes_odds],
    ['book_btts_no_odds',      Number(od.book_btts_no_odds),      ODDS.book_btts_no_odds],
    ['book_dc_1x_odds',        Number(od.book_dc_1x_odds),        ODDS.book_dc_1x_odds],
    ['book_dc_x2_odds',        Number(od.book_dc_x2_odds),        ODDS.book_dc_x2_odds],
    ['book_no_draw_home_odds', od.book_no_draw_home_odds,         ODDS.book_no_draw_home_odds],
    ['book_no_draw_away_odds', Number(od.book_no_draw_away_odds), ODDS.book_no_draw_away_odds],
    ['to_advance_home_odds',   Number(od.to_advance_home_odds),   ODDS.to_advance_home_odds],
    ['to_advance_away_odds',   Number(od.to_advance_away_odds),   ODDS.to_advance_away_odds],
  ];

  let allOddsPass = true;
  for (const [field, actual, expected] of oddsChecks) {
    if (expected === null) {
      if (actual === null || actual === undefined) {
        logPass(`odds.${field}: expected=NULL actual=${actual}`);
      } else {
        logFail(`odds.${field}: expected=NULL actual=${actual} — MISMATCH`);
        allOddsPass = false;
      }
    } else {
      if (Number(actual) === Number(expected)) {
        logPass(`odds.${field}: expected=${expected} actual=${actual}`);
      } else {
        logFail(`odds.${field}: expected=${expected} actual=${actual} — MISMATCH`);
        allOddsPass = false;
      }
    }
  }

  // ── PHASE G: GATE CHECK ───────────────────────────────────────────────────
  banner('PHASE G — GATE CHECK');
  logGate(`Total checks executed: ${passCount + failCount}`);
  logGate(`PASS: ${passCount} | FAIL: ${failCount} | WARN: ${warnCount}`);

  if (failCount > 0) {
    logFail(`GATE FAILED — ${failCount} check(s) did not pass`);
    logFail('Seed is NOT safe to proceed to simulation phase');
    logFail('Review log file for specific failures');
  } else {
    logPass('GATE PASSED — all checks green');
    logPass(`Fixture ${FIXTURE_ID} seeded and frozen correctly`);
    logPass('Schema migration complete — to_advance columns present in both tables');
    logPass('READY FOR STEP 2: 1M Simulation Engine');
  }

  summary();

  logOutput(`fixture_id=${FIXTURE_ID} | stage=${STAGE} | date=${MATCH_DATE} | kickoff=${KICKOFF_UTC}`);
  logOutput(`Home: Brazil (BRA) | Away: Japan (JPN) | Venue: Estadio Azteca, Mexico City`);
  logOutput(`Book odds frozen: DK_FROZEN | to_advance: BRA=${ODDS.to_advance_home_odds} JPN=${ODDS.to_advance_away_odds}`);
  logOutput('Model lines: NOT seeded — awaiting simulation + user approval');

  await conn.end();
  logState('DB connection closed');
  LOG_STREAM.end();
}

run().catch(e => {
  fatal('Unhandled top-level error in run()', e);
});
