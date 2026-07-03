/**
 * seedToAdvanceJuly2.mjs
 * ============================================================
 * PURPOSE: Seed To Advance (To Qualify) odds from DraftKings
 *          into wc2026MatchOdds for all 3 July 2, 2026 matchs.
 *
 * SOURCE: DraftKings "To Qualify" market (screenshot provided by user)
 * DATE: 2026-07-02
 * VERSION: v1.0-TOADV-JULY2
 *
 * ORIENTATION MAPPING (forensic — matches wc2026MatchOdds home/away):
 *   wc26-r32-083: homeTeamId=esp, awayTeamId=aut
 *     → book_home_to_advance = -1000 (Spain)
 *     → book_away_to_advance = +600  (Austria)
 *
 *   wc26-r32-084: homeTeamId=por, awayTeamId=cro
 *     → book_home_to_advance = -330  (Portugal)
 *     → book_away_to_advance = +255  (Croatia)
 *
 *   wc26-r32-085: homeTeamId=sui, awayTeamId=alg
 *     → book_home_to_advance = -220  (Switzerland)
 *     → book_away_to_advance = +175  (Algeria)
 *
 * LOGGING: All operations appended to /home/ubuntu/wc2026modeling.txt
 * ============================================================
 */

import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const LOG_FILE = '/home/ubuntu/wc2026modeling.txt';
const SCRIPT_NAME = 'seedToAdvanceJuly2.mjs';
const VERSION = 'v1.0-TOADV-JULY2';

// ─── Logger ──────────────────────────────────────────────────────────────────
const startTs = Date.now();
const logLines = [];

function log(tag, label, msg) {
  const elapsed = ((Date.now() - startTs) / 1000).toFixed(3);
  const line = `[${new Date().toISOString()}] +${elapsed}s ${tag.padEnd(10)} [${label.padEnd(6)}] ${SCRIPT_NAME} │ ${msg}`;
  console.log(line);
  logLines.push(line);
}

function flushLog() {
  const header = [
    '',
    '='.repeat(96),
    `SESSION START: ${new Date().toISOString()}`,
    `SCRIPT: ${SCRIPT_NAME}`,
    `PURPOSE: Seed To Advance (To Qualify) odds into wc2026MatchOdds for July 2, 2026 matchs`,
    `VERSION: ${VERSION}`,
    '='.repeat(96),
  ].join('\n');
  fs.appendFileSync(LOG_FILE, header + '\n' + logLines.join('\n') + '\n');
  console.log(`[LOG] Appended ${logLines.length} lines to ${LOG_FILE}`);
}

// ─── Seed Data ────────────────────────────────────────────────────────────────
// Forensic orientation: home team first, away team second
// Source: DraftKings "To Qualify" screenshot, 2026-07-02
const SEED = [
  {
    matchId: 'wc26-r32-083',
    homeTeam: 'Spain (ESP)',
    awayTeam: 'Austria (AUT)',
    homeTeamId: 'esp',
    awayTeamId: 'aut',
    bookHomeToAdvance: -1000,
    bookAwayToAdvance: 600,
  },
  {
    matchId: 'wc26-r32-084',
    homeTeam: 'Portugal (POR)',
    awayTeam: 'Croatia (CRO)',
    homeTeamId: 'por',
    awayTeamId: 'cro',
    bookHomeToAdvance: -330,
    bookAwayToAdvance: 255,
  },
  {
    matchId: 'wc26-r32-085',
    homeTeam: 'Switzerland (SUI)',
    awayTeam: 'Algeria (ALG)',
    homeTeamId: 'sui',
    awayTeamId: 'alg',
    bookHomeToAdvance: -220,
    bookAwayToAdvance: 175,
  },
];

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  log('██ [BANNER]', 'INIT', `${VERSION} — To Advance Seed Script`);
  log('██ [BANNER]', 'INIT', 'ZERO HALLUCINATION | ZERO OVERSIGHT | 500x FORENSIC PRECISION');
  log('██ [BANNER]', 'INIT', `Log file: ${LOG_FILE}`);
  log('', 'INIT', '');

  // ── Section 1: Input Validation ──────────────────────────────────────────
  log('██ [SECTION]', 'INPUT', 'SECTION 1: INPUT VALIDATION');
  log('◀◀ [INPUT]', 'INPUT', `Matchs to seed: ${SEED.length}`);
  for (const s of SEED) {
    log('◀◀ [INPUT]', 'INPUT', `  ${s.matchId}: ${s.homeTeam} (home) vs ${s.awayTeam} (away)`);
    log('   [ATOMIC]', 'INPUT', `    book_home_to_advance = ${s.bookHomeToAdvance > 0 ? '+' : ''}${s.bookHomeToAdvance} (${s.homeTeam})`);
    log('   [ATOMIC]', 'INPUT', `    book_away_to_advance = ${s.bookAwayToAdvance > 0 ? '+' : ''}${s.bookAwayToAdvance} (${s.awayTeam})`);
  }

  // ── Section 2: DB Connection ──────────────────────────────────────────────
  log('', '', '');
  log('██ [SECTION]', 'DB', 'SECTION 2: DATABASE CONNECTION');
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    log('✗✗ [FAIL]', 'DB', 'DATABASE_URL not set — aborting');
    flushLog();
    process.exit(1);
  }
  log('▶▶ [STEP]', 'DB', 'Connecting to TiDB...');
  const conn = await mysql.createConnection(dbUrl);
  log('✅ [PASS]', 'DB', 'Connected to TiDB');

  // ── Section 3: Pre-flight — verify match orientation ───────────────────
  log('', '', '');
  log('██ [SECTION]', 'PRE', 'SECTION 3: PRE-FLIGHT — MATCH ORIENTATION VERIFICATION');
  let preflightPass = 0;
  let preflightFail = 0;

  for (const s of SEED) {
    log('▶▶ [STEP]', 'PRE', `Verifying orientation for ${s.matchId}`);
    const [rows] = await conn.execute(
      'SELECT match_id, home_team_id, away_team_id FROM wc2026_matches WHERE match_id = ?',
      [s.matchId]
    );
    if (!rows.length) {
      log('✗✗ [FAIL]', 'PRE', `  ${s.matchId}: NOT FOUND in wc2026_matches — ABORT`);
      preflightFail++;
      continue;
    }
    const row = rows[0];
    const homeOk = row.home_team_id === s.homeTeamId;
    const awayOk = row.away_team_id === s.awayTeamId;
    log('   [ATOMIC]', 'PRE', `  DB home_team_id=${row.home_team_id} | expected=${s.homeTeamId} | ${homeOk ? 'MATCH ✓' : 'MISMATCH ✗'}`);
    log('   [ATOMIC]', 'PRE', `  DB away_team_id=${row.away_team_id} | expected=${s.awayTeamId} | ${awayOk ? 'MATCH ✓' : 'MISMATCH ✗'}`);
    if (homeOk && awayOk) {
      log('✅ [PASS]', 'PRE', `  ${s.matchId}: Orientation VERIFIED — home=${s.homeTeamId} away=${s.awayTeamId}`);
      preflightPass++;
    } else {
      log('✗✗ [FAIL]', 'PRE', `  ${s.matchId}: Orientation MISMATCH — ABORT`);
      preflightFail++;
    }
  }

  if (preflightFail > 0) {
    log('✗✗ [FAIL]', 'PRE', `Preflight FAILED: ${preflightFail} orientation mismatches — aborting all updates`);
    await conn.end();
    flushLog();
    process.exit(1);
  }
  log('✅ [PASS]', 'PRE', `Preflight PASSED: ${preflightPass}/${SEED.length} orientations verified`);

  // ── Section 4: Pre-update state snapshot ─────────────────────────────────
  log('', '', '');
  log('██ [SECTION]', 'SNAP', 'SECTION 4: PRE-UPDATE STATE SNAPSHOT');
  for (const s of SEED) {
    const [rows] = await conn.execute(
      'SELECT match_id, book_home_to_advance, book_away_to_advance FROM wc2026MatchOdds WHERE match_id = ?',
      [s.matchId]
    );
    if (!rows.length) {
      log('⚠️ [WARN]', 'SNAP', `  ${s.matchId}: NOT FOUND in wc2026MatchOdds — will INSERT`);
    } else {
      const r = rows[0];
      log('·· [STATE]', 'SNAP', `  ${s.matchId}: current book_home_to_advance=${r.book_home_to_advance ?? 'NULL'} book_away_to_advance=${r.book_away_to_advance ?? 'NULL'}`);
    }
  }

  // ── Section 5: UPDATE ─────────────────────────────────────────────────────
  log('', '', '');
  log('██ [SECTION]', 'UPD', 'SECTION 5: UPDATE wc2026MatchOdds — book_home_to_advance + book_away_to_advance');
  let updatePass = 0;
  let updateFail = 0;

  for (const s of SEED) {
    log('▶▶ [STEP]', 'UPD', `Updating ${s.matchId}: home=${s.bookHomeToAdvance > 0 ? '+' : ''}${s.bookHomeToAdvance} away=+${s.bookAwayToAdvance}`);
    try {
      const [result] = await conn.execute(
        `UPDATE wc2026MatchOdds
         SET book_home_to_advance = ?,
             book_away_to_advance = ?,
             last_inserted_at = NOW(),
             last_insert_method = ?
         WHERE match_id = ?`,
        [
          s.bookHomeToAdvance,
          s.bookAwayToAdvance,
          'seedToAdvanceJuly2.mjs',
          s.matchId,
        ]
      );
      if (result.affectedRows === 1) {
        log('✅ [PASS]', 'UPD', `  ${s.matchId}: UPDATE OK — affectedRows=1`);
        updatePass++;
      } else {
        log('✗✗ [FAIL]', 'UPD', `  ${s.matchId}: UPDATE FAILED — affectedRows=${result.affectedRows}`);
        updateFail++;
      }
    } catch (err) {
      log('✗✗ [FAIL]', 'UPD', `  ${s.matchId}: EXCEPTION — ${err.message}`);
      updateFail++;
    }
  }

  // ── Section 6: Post-update verification ──────────────────────────────────
  log('', '', '');
  log('██ [SECTION]', 'VFY', 'SECTION 6: POST-UPDATE VERIFICATION');
  let vfyPass = 0;
  let vfyFail = 0;

  for (const s of SEED) {
    const [rows] = await conn.execute(
      'SELECT match_id, book_home_to_advance, book_away_to_advance FROM wc2026MatchOdds WHERE match_id = ?',
      [s.matchId]
    );
    if (!rows.length) {
      log('✗✗ [FAIL]', 'VFY', `  ${s.matchId}: NOT FOUND after update`);
      vfyFail++;
      continue;
    }
    const r = rows[0];
    const homeOk = Number(r.book_home_to_advance) === s.bookHomeToAdvance;
    const awayOk = Number(r.book_away_to_advance) === s.bookAwayToAdvance;
    log('   [ATOMIC]', 'VFY', `  ${s.matchId}: book_home_to_advance=${r.book_home_to_advance} | expected=${s.bookHomeToAdvance} | ${homeOk ? 'PASS ✓' : 'FAIL ✗'}`);
    log('   [ATOMIC]', 'VFY', `  ${s.matchId}: book_away_to_advance=${r.book_away_to_advance} | expected=${s.bookAwayToAdvance} | ${awayOk ? 'PASS ✓' : 'FAIL ✗'}`);
    if (homeOk && awayOk) {
      log('✅ [PASS]', 'VFY', `  ${s.matchId}: VERIFIED — ${s.homeTeam} home=${s.bookHomeToAdvance > 0 ? '+' : ''}${s.bookHomeToAdvance} | ${s.awayTeam} away=+${s.bookAwayToAdvance}`);
      vfyPass++;
    } else {
      log('✗✗ [FAIL]', 'VFY', `  ${s.matchId}: MISMATCH after update`);
      vfyFail++;
    }
  }

  // ── Section 7: Summary ────────────────────────────────────────────────────
  log('', '', '');
  log('██ [SECTION]', 'SUM', 'SECTION 7: FINAL SUMMARY');
  log('·· [STATE]', 'SUM', `Preflight:  ${preflightPass}/${SEED.length} PASS`);
  log('·· [STATE]', 'SUM', `Updates:    ${updatePass}/${SEED.length} PASS, ${updateFail} FAIL`);
  log('·· [STATE]', 'SUM', `Verify:     ${vfyPass}/${SEED.length} PASS, ${vfyFail} FAIL`);

  const totalChecks = SEED.length * 2; // home + away per match
  const totalPass = vfyPass * 2;
  log('·· [STATE]', 'SUM', `Total field checks: ${totalPass}/${totalChecks}`);

  if (vfyFail === 0 && updateFail === 0) {
    log('✅ [PASS]', 'SUM', `ALL CHECKS PASSED — ${totalPass}/${totalChecks} field checks PASS`);
    log('✅ [PASS]', 'SUM', 'wc2026MatchOdds To Advance odds seeded and verified for all 3 July 2 matchs');
  } else {
    log('✗✗ [FAIL]', 'SUM', `FAILURES DETECTED — updates=${updateFail} verify=${vfyFail}`);
  }

  await conn.end();
  log('✅ [PASS]', 'DB', 'Connection closed');
  flushLog();
}

main().catch((err) => {
  console.error('[FATAL]', err);
  fs.appendFileSync(LOG_FILE, `\n[FATAL] ${SCRIPT_NAME}: ${err.message}\n`);
  process.exit(1);
});
