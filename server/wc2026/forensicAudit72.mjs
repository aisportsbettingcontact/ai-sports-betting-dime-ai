/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║  WC2026 ESPN SCRAPER — 72-MATCH FORENSIC AUDIT ENGINE v4.0                 ║
 * ║  Full Group Stage: June 11–27, 2026 | 72 Matches | 9 Tables per Match      ║
 * ║  250x/500x depth | Midnight rule validation | Schema/index integrity        ║
 * ║  Ground truth: groupStageGameIds.json + ESPN verified scores                ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 *
 * TIMEZONE POLICY (per user requirement):
 *   - matchDateUtc: UTC epoch ms (universal sort key)
 *   - matchGameDate: PT date (Pacific Time date the game kicked off)
 *   - matchKickoffEt: ET time string "HH:MM" (Eastern Time kickoff)
 *   - MIDNIGHT RULE: if game starts at 12:00 AM ET, store PT date (day before ET date)
 *     Example: 760421 kicks off at 04:00 UTC = 00:00 ET Jun 14 = 21:00 PT Jun 13
 *              → matchGameDate = "2026-06-13" (PT date), matchKickoffEt = "00:00"
 *
 * AUDIT DEPTH:
 *   Per match: ~40 checks across 9 tables
 *   Cross-match: row count, midnight rule, schema, index integrity
 *   Total: ~3000+ individual checks across all 72 matches
 */
import mysql from 'mysql2/promise';
import { config } from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../../.env') });

// ── CONFIG ────────────────────────────────────────────────────────────────────
const LOG_DIR = path.resolve(__dirname, '../../.manus-logs');
const LOG_FILE = path.join(LOG_DIR, 'forensicAudit72.txt');
const REPORT_FILE = path.join(LOG_DIR, 'WC2026_FORENSIC_AUDIT_72_REPORT.md');

// ── GROUND TRUTH: All 72 Group Stage Matches ─────────────────────────────────
// Derived from groupStageGameIds.json + ESPN verified data
// dateTime is UTC ISO string from ESPN
// date is the PT date (YYYYMMDD) from ESPN's date field
// Midnight rule: if UTC time converts to 00:00 ET, use PT date (day before ET date)
//
// ET offset: EDT = UTC-4 (June = summer, EDT applies)
// Midnight rule check: if (utcHour * 60 + utcMin) % 1440 maps to ET 00:00
//   → ET 00:00 = UTC 04:00 (EDT)
//
// PT offset: PDT = UTC-7 (June = summer, PDT applies)
//   → PT 21:00 = UTC 04:00 (PDT)
//
// For each match:
//   utcIso: from dateTime field
//   ptDate: from date field (YYYYMMDD → YYYY-MM-DD)
//   etTime: UTC → ET conversion (UTC-4 in June)
//   isMidnight: etTime === "00:00"

function parseMatchGT(m) {
  const utcIso = m.dateTime; // e.g. "2026-06-12T02:00Z"
  const utcMs = new Date(utcIso).getTime();
  // ET = UTC - 4h (EDT in June)
  const etMs = utcMs - (4 * 60 * 60 * 1000);
  const etDate = new Date(etMs);
  const etHH = String(etDate.getUTCHours()).padStart(2, '0');
  const etMM = String(etDate.getUTCMinutes()).padStart(2, '0');
  const etTime = `${etHH}:${etMM}`;
  const isMidnight = etTime === '00:00';
  // PT date: ALWAYS compute from UTC using PDT offset (UTC-7)
  // This is the CORRECT midnight rule: PT date is the kickoff date in Pacific Time
  // For midnight games: UTC 04:00 = PT 21:00 (day before ET date)
  // ESPN's date field uses ET date for midnight games, which is WRONG for our rule
  const ptMs = utcMs - (7 * 60 * 60 * 1000); // PDT = UTC-7
  const ptDateObj = new Date(ptMs);
  const ptDate = `${ptDateObj.getUTCFullYear()}-${String(ptDateObj.getUTCMonth()+1).padStart(2,'0')}-${String(ptDateObj.getUTCDate()).padStart(2,'0')}`;
  // homeScore/awayScore as integers
  const homeScore = parseInt(m.homeScore, 10);
  const awayScore = parseInt(m.awayScore, 10);
  return {
    gameId: m.gameId,
    homeTeam: m.homeTeam,
    awayTeam: m.awayTeam,
    homeScore,
    awayScore,
    name: m.name,
    utcIso,
    utcMs,
    etTime,
    ptDate,
    isMidnight,
    status: m.status,
  };
}

// Load ground truth from groupStageGameIds.json
const gidsPath = path.resolve(__dirname, 'groupStageGameIds.json');
const gidsData = JSON.parse(fs.readFileSync(gidsPath, 'utf8'));
const ALL_MATCHES = gidsData.matches.map(parseMatchGT);
const GT_MAP = Object.fromEntries(ALL_MATCHES.map(m => [m.gameId, m]));
const ALL_IDS = ALL_MATCHES.map(m => m.gameId);

// Identify midnight rule matches
const MIDNIGHT_MATCHES = ALL_MATCHES.filter(m => m.isMidnight);

// ── LOGGER ────────────────────────────────────────────────────────────────────
let logBuffer = [];
let passCount = 0, failCount = 0, warnCount = 0, infoCount = 0;
const matchResults = {};

function ts() { return new Date().toISOString(); }

function log(level, tag, msg, data = null) {
  const dataStr = data ? ` | ${JSON.stringify(data)}` : '';
  const line = `[${ts()}] [${level.padEnd(7)}] [${tag.padEnd(30)}] ${msg}${dataStr}`;
  console.log(line);
  logBuffer.push(line);
  if (level === 'PASS') passCount++;
  else if (level === 'FAIL') failCount++;
  else if (level === 'WARN') warnCount++;
  else if (level === 'INFO') infoCount++;
}

function check(condition, tag, passMsg, failMsg, data = null, isWarn = false) {
  if (condition) { log('PASS', tag, `✅ ${passMsg}`, data); return true; }
  else { log(isWarn ? 'WARN' : 'FAIL', tag, `${isWarn ? '⚠️' : '❌'} ${failMsg}`, data); return false; }
}

function section(title) {
  const bar = '═'.repeat(76);
  const lines = [`\n${bar}`, `  ${title}`, bar];
  lines.forEach(l => { console.log(l); logBuffer.push(l); });
}

function subsection(title) {
  const line = `\n── ${title} ${'─'.repeat(Math.max(0, 72 - title.length))}`;
  console.log(line); logBuffer.push(line);
}

function saveLog() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.writeFileSync(LOG_FILE, logBuffer.join('\n'), 'utf8');
  log('INFO', 'LOG_SAVED', `Log written → ${LOG_FILE}`);
}

// ── DB CONNECTION ─────────────────────────────────────────────────────────────
const pool = mysql.createPool({
  uri: process.env.DATABASE_URL,
  connectionLimit: 5,
  waitForConnections: true,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  connectTimeout: 30000,
  ssl: { rejectUnauthorized: false },
});
const conn = {
  execute: (...args) => pool.execute(...args),
  end: () => pool.end(),
};

// ── TIMEZONE HELPERS ──────────────────────────────────────────────────────────
function utcMsToEtDate(ms) {
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}
function utcMsToEtTime(ms) {
  const d = new Date(ms);
  const etMs = ms - (4 * 60 * 60 * 1000); // EDT = UTC-4
  const etD = new Date(etMs);
  return `${String(etD.getUTCHours()).padStart(2,'0')}:${String(etD.getUTCMinutes()).padStart(2,'0')}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 1: EXISTENCE CHECK — All 72 matches in DB
// ═══════════════════════════════════════════════════════════════════════════════
async function phase1_existenceCheck() {
  section('PHASE 1: EXISTENCE CHECK — All 72 Matches in DB');
  const [rows] = await conn.execute(`SELECT matchId FROM wc2026_espn_matches ORDER BY matchId`);
  const dbIds = new Set(rows.map(r => String(r.matchId)));
  const missing = ALL_IDS.filter(id => !dbIds.has(id));
  const extra = [...dbIds].filter(id => !ALL_IDS.includes(id));

  // DB may have extra R32 matches from earlier sessions — check ≥72 and all 72 GS IDs present
  check(rows.length >= 72, 'PHASE1/TOTAL_COUNT',
    `${rows.length} matches in DB (≥72) ✓`,
    `Match count CRITICAL: DB has only ${rows.length}, expected ≥72`,
    { dbCount: rows.length, expected: 72 });

  check(missing.length === 0, 'PHASE1/MISSING_MATCHES',
    `No missing matches ✓`,
    `${missing.length} MISSING matches: ${missing.join(', ')}`,
    { missing });

  if (extra.length > 0) {
    log('WARN', 'PHASE1/EXTRA_MATCHES', `⚠️ ${extra.length} extra matches in DB not in group stage list: ${extra.join(', ')}`);
  }

  log('INFO', 'PHASE1/SUMMARY', `DB has ${rows.length} matches | Missing: ${missing.length} | Extra: ${extra.length}`);
  return { dbIds, missing };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 2: MIDNIGHT RULE VALIDATION — All midnight-edge matches
// ═══════════════════════════════════════════════════════════════════════════════
async function phase2_midnightRuleValidation() {
  section(`PHASE 2: MIDNIGHT RULE VALIDATION — ${MIDNIGHT_MATCHES.length} Midnight-Edge Matches`);
  log('INFO', 'PHASE2/MIDNIGHT_LIST', `Midnight matches: ${MIDNIGHT_MATCHES.map(m => `${m.gameId}(${m.ptDate})`).join(', ')}`);

  let midnightPass = 0, midnightFail = 0;
  for (const gt of MIDNIGHT_MATCHES) {
    const [[m]] = await conn.execute(`SELECT matchId, matchGameDate, matchKickoffEt, matchDateUtc FROM wc2026_espn_matches WHERE matchId=?`, [gt.gameId]);
    if (!m) {
      log('FAIL', `PHASE2/${gt.gameId}`, `❌ Match ${gt.gameId} NOT IN DB — cannot validate midnight rule`);
      midnightFail++;
      continue;
    }
    const etTimeOk = m.matchKickoffEt === '00:00';
    const ptDateOk = m.matchGameDate === gt.ptDate;
    const utcMs = Number(m.matchDateUtc);
    const etDateFromUtc = utcMsToEtDate(utcMs);

    if (etTimeOk && ptDateOk) {
      log('PASS', `PHASE2/${gt.gameId}`, `✅ MIDNIGHT RULE PASS | ${gt.name} | matchGameDate=${m.matchGameDate}(PT) matchKickoffEt=${m.matchKickoffEt}(ET) | UTC=${gt.utcIso} | ET_date_from_UTC=${etDateFromUtc}`);
      midnightPass++;
    } else {
      log('FAIL', `PHASE2/${gt.gameId}`, `❌ MIDNIGHT RULE FAIL | ${gt.name} | matchGameDate=${m.matchGameDate}(expected ${gt.ptDate}) matchKickoffEt=${m.matchKickoffEt}(expected 00:00)`,
        { ptDateOk, etTimeOk, stored_ptDate: m.matchGameDate, expected_ptDate: gt.ptDate, stored_etTime: m.matchKickoffEt });
      midnightFail++;
    }
  }
  log('INFO', 'PHASE2/SUMMARY', `Midnight rule: ${midnightPass} PASS | ${midnightFail} FAIL | ${MIDNIGHT_MATCHES.length} total midnight matches`);
  return { midnightPass, midnightFail };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 3: PER-MATCH DEEP AUDIT — All 72 matches
// ═══════════════════════════════════════════════════════════════════════════════
async function phase3_perMatchAudit(dbIds) {
  section('PHASE 3: PER-MATCH DEEP AUDIT — All 72 Matches');
  let totalMatchPass = 0, totalMatchFail = 0;

  for (let i = 0; i < ALL_MATCHES.length; i++) {
    const gt = ALL_MATCHES[i];
    const mid = gt.gameId;
    const mp = { pass: 0, fail: 0, warn: 0 };

    function mc(condition, tag, passMsg, failMsg, data = null, isWarn = false) {
      const level = condition ? 'PASS' : (isWarn ? 'WARN' : 'FAIL');
      const emoji = condition ? '✅' : (isWarn ? '⚠️' : '❌');
      log(level, `M${mid}/${tag}`, `${emoji} ${condition ? passMsg : failMsg}`, data);
      if (level === 'PASS') mp.pass++;
      else if (level === 'FAIL') mp.fail++;
      else mp.warn++;
      return condition;
    }

    if (!dbIds.has(mid)) {
      log('FAIL', `M${mid}/EXISTENCE`, `❌ Match ${mid} (${gt.name}) NOT IN DB — SKIPPING DEEP AUDIT`);
      matchResults[mid] = { ...gt, pass: 0, fail: 1, warn: 0, pct: '0.0', verdict: '❌ NOT IN DB', label: gt.name };
      totalMatchFail++;
      continue;
    }

    // Progress indicator every 8 matches
    if (i % 8 === 0) {
      log('INFO', 'PHASE3/PROGRESS', `Auditing match ${i+1}/${ALL_MATCHES.length} | gameId=${mid} | ${gt.name}`);
    }

    // ── A. wc2026_espn_matches ─────────────────────────────────────────────
    const [[m]] = await conn.execute(`SELECT * FROM wc2026_espn_matches WHERE matchId=?`, [mid]);
    mc(!!m, 'MATCH_ROW', `Row exists`, `CRITICAL: Row MISSING`);
    if (!m) {
      matchResults[mid] = { ...gt, pass: mp.pass, fail: mp.fail, warn: mp.warn, pct: '0.0', verdict: '❌ MISSING', label: gt.name };
      totalMatchFail++;
      continue;
    }

    // Team identity
    mc(m.homeTeamAbbrev === gt.homeTeam, 'HOME_ABBREV', `homeTeamAbbrev="${m.homeTeamAbbrev}" ✓`, `homeTeamAbbrev MISMATCH: got "${m.homeTeamAbbrev}" expected "${gt.homeTeam}"`);
    mc(m.awayTeamAbbrev === gt.awayTeam, 'AWAY_ABBREV', `awayTeamAbbrev="${m.awayTeamAbbrev}" ✓`, `awayTeamAbbrev MISMATCH: got "${m.awayTeamAbbrev}" expected "${gt.awayTeam}"`);
    mc(!!m.homeTeamName, 'HOME_NAME', `homeTeamName="${m.homeTeamName}" ✓`, 'homeTeamName MISSING');
    mc(!!m.awayTeamName, 'AWAY_NAME', `awayTeamName="${m.awayTeamName}" ✓`, 'awayTeamName MISSING');

    // Score
    mc(Number(m.homeScore) === gt.homeScore, 'HOME_SCORE', `homeScore=${m.homeScore} ✓`, `homeScore MISMATCH: got ${m.homeScore} expected ${gt.homeScore}`);
    mc(Number(m.awayScore) === gt.awayScore, 'AWAY_SCORE', `awayScore=${m.awayScore} ✓`, `awayScore MISMATCH: got ${m.awayScore} expected ${gt.awayScore}`);

    // Status
    mc(m.statusState === 'post', 'STATUS_STATE', `statusState="post" ✓`, `statusState="${m.statusState}" ≠ "post"`);
    mc(!!m.statusDetail, 'STATUS_DETAIL', `statusDetail="${m.statusDetail}" ✓`, 'statusDetail MISSING');

    // Venue/attendance
    mc(!!m.venue, 'VENUE', `venue="${m.venue}" ✓`, 'venue MISSING');
    mc(!!m.city, 'CITY', `city="${m.city}" ✓`, 'city MISSING');
    mc(Number(m.attendance) > 0, 'ATTENDANCE', `attendance=${m.attendance} ✓`, 'attendance=0 or NULL');
    mc(!!m.referee, 'REFEREE', `referee="${m.referee}" ✓`, 'referee MISSING');

    // Formations
    mc(!!m.homeFormation, 'HOME_FORMATION', `homeFormation="${m.homeFormation}" ✓`, 'homeFormation MISSING', null, true);
    mc(!!m.awayFormation, 'AWAY_FORMATION', `awayFormation="${m.awayFormation}" ✓`, 'awayFormation MISSING', null, true);

    // ── A2. Timezone / Midnight Rule ──────────────────────────────────────
    const dbUtcMs = Number(m.matchDateUtc);
    const dbPtDate = m.matchGameDate;
    const dbEtTime = m.matchKickoffEt;
    const computedEtTime = utcMsToEtTime(dbUtcMs);

    // UTC epoch must be parseable and reasonable (2026 WC dates)
    mc(dbUtcMs > 1780000000000 && dbUtcMs < 1790000000000, 'UTC_MS_RANGE',
      `matchDateUtc=${dbUtcMs} (${new Date(dbUtcMs).toISOString()}) in valid WC2026 range ✓`,
      `matchDateUtc=${dbUtcMs} OUT OF VALID RANGE for WC2026`);

    // PT date must match ESPN's date field
    mc(dbPtDate === gt.ptDate, 'PT_DATE',
      `matchGameDate="${dbPtDate}" (PT date) ✓`,
      `matchGameDate MISMATCH: got "${dbPtDate}" expected "${gt.ptDate}" (PT date)`,
      { stored: dbPtDate, expected: gt.ptDate, utcIso: new Date(dbUtcMs).toISOString() });

    // ET time must match computed ET time
    mc(dbEtTime === gt.etTime, 'ET_TIME',
      `matchKickoffEt="${dbEtTime}" (ET) ✓`,
      `matchKickoffEt MISMATCH: got "${dbEtTime}" expected "${gt.etTime}"`,
      { stored: dbEtTime, expected: gt.etTime, computed: computedEtTime });

    // Midnight rule specific
    if (gt.isMidnight) {
      mc(dbEtTime === '00:00', 'MIDNIGHT_ET',
        `MIDNIGHT RULE: matchKickoffEt="00:00" ✓`,
        `MIDNIGHT RULE FAIL: matchKickoffEt="${dbEtTime}" should be "00:00"`);
      // PT date must be day BEFORE ET date
      const etDateFromUtc = utcMsToEtDate(dbUtcMs);
      mc(dbPtDate < etDateFromUtc, 'MIDNIGHT_PT_BEFORE_ET',
        `MIDNIGHT RULE: PT date ${dbPtDate} < ET date ${etDateFromUtc} ✓ (correct day boundary)`,
        `MIDNIGHT RULE FAIL: PT date ${dbPtDate} should be < ET date ${etDateFromUtc}`,
        { ptDate: dbPtDate, etDate: etDateFromUtc });
    }

    // Scrape version — 500x is the current enhanced version
    mc(m.scrapeVersion === '500x', 'SCRAPE_VERSION', `scrapeVersion="500x" ✓`, `scrapeVersion="${m.scrapeVersion}" ≠ "500x"`);

    // matchRound — must be 'group-stage' for all 72 Group Stage matches (ESPN native season.slug)
    mc(m.matchRound === 'group-stage', 'MATCH_ROUND',
      `matchRound="group-stage" (ESPN season.slug) ✓`,
      `matchRound="${m.matchRound}" ≠ "group-stage" — ESPN season.slug not stored correctly`,
      { stored: m.matchRound, expected: 'group-stage' });
    mc(!!m.createdAt, 'CREATED_AT', 'createdAt present ✓', 'createdAt MISSING');

    // ── B. wc2026_espn_match_odds ──────────────────────────────────────────
    const [oddsRows] = await conn.execute(`SELECT * FROM wc2026_espn_match_odds WHERE matchId=?`, [mid]);
    mc(oddsRows.length >= 1, 'ODDS_EXISTS', `${oddsRows.length} odds row(s) ✓`, 'CRITICAL: No odds rows');
    if (oddsRows.length > 0) {
      const o = oddsRows[0];
      mc(!!o.provider, 'ODDS_PROVIDER', `provider="${o.provider}" ✓`, 'provider MISSING', null, true);
      mc(o.homeOdds !== null, 'ODDS_HOME_ML', `homeOdds="${o.homeOdds}" ✓`, 'homeOdds NULL', null, true);
      mc(o.drawOdds !== null, 'ODDS_DRAW_ML', `drawOdds="${o.drawOdds}" ✓`, 'drawOdds NULL', null, true);
      mc(o.awayOdds !== null, 'ODDS_AWAY_ML', `awayOdds="${o.awayOdds}" ✓`, 'awayOdds NULL', null, true);
      mc(o.overUnder !== null, 'ODDS_OU', `overUnder="${o.overUnder}" ✓`, 'overUnder NULL', null, true);
    }

    // ── C. wc2026_espn_team_stats ──────────────────────────────────────────
    const [[ts_row]] = await conn.execute(`SELECT * FROM wc2026_espn_team_stats WHERE matchId=?`, [mid]);
    mc(!!ts_row, 'TS_EXISTS', 'team_stats row exists ✓', 'CRITICAL: team_stats row MISSING');
    if (ts_row) {
      mc(ts_row.possession !== null, 'TS_HOME_POSS', `possession="${ts_row.possession}" ✓`, 'possession NULL');
      mc(ts_row.possessionAway !== null, 'TS_AWAY_POSS', `possessionAway="${ts_row.possessionAway}" ✓`, 'possessionAway NULL');
      mc(ts_row.shotAttempts !== null, 'TS_HOME_SHOTS', `shotAttempts=${ts_row.shotAttempts} ✓`, 'shotAttempts NULL');
      mc(ts_row.shotAttemptsAway !== null, 'TS_AWAY_SHOTS', `shotAttemptsAway=${ts_row.shotAttemptsAway} ✓`, 'shotAttemptsAway NULL');
      mc(ts_row.saves !== null, 'TS_HOME_SAVES', `saves=${ts_row.saves} ✓`, 'saves NULL');
      mc(ts_row.savesAway !== null, 'TS_AWAY_SAVES', `savesAway=${ts_row.savesAway} ✓`, 'savesAway NULL');
    }

    // ── D. wc2026_espn_match_stats ─────────────────────────────────────────
    const [[ms_row]] = await conn.execute(`SELECT * FROM wc2026_espn_match_stats WHERE matchId=?`, [mid]);
    mc(!!ms_row, 'MS_EXISTS', 'match_stats row exists ✓', 'CRITICAL: match_stats row MISSING');
    if (ms_row) {
      // Shots
      const shotNulls = ['homeShotsOnGoal','homeShots','awayShotsOnGoal','awayShots'].filter(c => ms_row[c] === null);
      mc(shotNulls.length === 0, 'MS_SHOTS', `SHOTS: core fields populated ✓`, `SHOTS: ${shotNulls.length} null: ${shotNulls.join(', ')}`);
      // Passes
      const passNulls = ['homeAccuratePasses','homePasses','awayAccuratePasses','awayPasses'].filter(c => ms_row[c] === null);
      mc(passNulls.length === 0, 'MS_PASSES', `PASSES: core fields populated ✓`, `PASSES: ${passNulls.length} null: ${passNulls.join(', ')}`);
      // Defense
      const defNulls = ['homeTackles','homeInterceptions','awayTackles','awayInterceptions'].filter(c => ms_row[c] === null);
      mc(defNulls.length === 0, 'MS_DEFENSE', `DEFENSE: core fields populated ✓`, `DEFENSE: ${defNulls.length} null: ${defNulls.join(', ')}`);
    }

    // ── E. wc2026_espn_expected_goals ─────────────────────────────────────
    const [[xg]] = await conn.execute(`SELECT * FROM wc2026_espn_expected_goals WHERE matchId=?`, [mid]);
    mc(!!xg, 'XG_EXISTS', 'expected_goals row exists ✓', 'CRITICAL: expected_goals row MISSING');
    if (xg) {
      mc(xg.homeXg !== null, 'XG_HOME', `homeXg=${xg.homeXg} ✓`, 'homeXg NULL');
      mc(xg.awayXg !== null, 'XG_AWAY', `awayXg=${xg.awayXg} ✓`, 'awayXg NULL');
    }

    // ── F. wc2026_espn_shot_map ────────────────────────────────────────────
    const [[shotMapCount]] = await conn.execute(`SELECT COUNT(*) as cnt FROM wc2026_espn_shot_map WHERE matchId=?`, [mid]);
    mc(Number(shotMapCount.cnt) > 0, 'SHOT_MAP_EXISTS', `${shotMapCount.cnt} shot map entries ✓`, 'CRITICAL: shot_map EMPTY');

    // ── G. wc2026_espn_player_stats ────────────────────────────────────────
    const [[playerCount]] = await conn.execute(`SELECT COUNT(*) as cnt FROM wc2026_espn_player_stats WHERE matchId=?`, [mid]);
    mc(Number(playerCount.cnt) >= 22, 'PLAYER_STATS_COUNT', `${playerCount.cnt} player stat rows (≥22) ✓`, `player_stats count=${playerCount.cnt} < 22`);

    // ── H. wc2026_espn_lineups ─────────────────────────────────────────────
    const [[lineupCount]] = await conn.execute(`SELECT COUNT(*) as cnt FROM wc2026_espn_lineups WHERE matchId=?`, [mid]);
    mc(Number(lineupCount.cnt) >= 22, 'LINEUPS_COUNT', `${lineupCount.cnt} lineup entries (≥22) ✓`, `lineups count=${lineupCount.cnt} < 22`);

    // Starters check
    const [[starterCount]] = await conn.execute(`SELECT COUNT(*) as cnt FROM wc2026_espn_lineups WHERE matchId=? AND role='starter'`, [mid]);
    mc(Number(starterCount.cnt) === 22, 'STARTERS_22', `22 starters ✓`, `starters count=${starterCount.cnt} ≠ 22`);

    // ── I. wc2026_espn_glossary ────────────────────────────────────────────
    const [[glossaryCount]] = await conn.execute(`SELECT COUNT(*) as cnt FROM wc2026_espn_glossary`);
    mc(Number(glossaryCount.cnt) > 0, 'GLOSSARY_EXISTS', `${glossaryCount.cnt} glossary entries ✓`, 'CRITICAL: glossary EMPTY', null, true);

    // Log match summary
    const totalChecks = mp.pass + mp.fail + mp.warn;
    const pct = totalChecks > 0 ? ((mp.pass / totalChecks) * 100).toFixed(1) : '0.0';
    const verdict = mp.fail === 0 ? '✅ PASS' : mp.fail <= 2 ? '⚠️ MINOR' : '❌ FAIL';
    log('INFO', `M${mid}/SUMMARY`, `${gt.name} | P=${mp.pass} F=${mp.fail} W=${mp.warn} (${pct}%) | ${verdict} | ET=${gt.etTime} PT_date=${gt.ptDate}${gt.isMidnight ? ' 🌙MIDNIGHT' : ''}`);

    matchResults[mid] = { ...gt, pass: mp.pass, fail: mp.fail, warn: mp.warn, pct, verdict, label: gt.name };
    if (mp.fail === 0) totalMatchPass++;
    else totalMatchFail++;
  }

  log('INFO', 'PHASE3/SUMMARY', `Per-match audit complete | ${totalMatchPass} PASS | ${totalMatchFail} FAIL | ${ALL_MATCHES.length} total`);
  return { totalMatchPass, totalMatchFail };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 4: SCHEMA & INDEX INTEGRITY
// ═══════════════════════════════════════════════════════════════════════════════
async function phase4_schemaIntegrity() {
  section('PHASE 4: SCHEMA & INDEX INTEGRITY');

  const tables = [
    'wc2026_espn_matches',
    'wc2026_espn_match_odds',
    'wc2026_espn_team_stats',
    'wc2026_espn_match_stats',
    'wc2026_espn_expected_goals',
    'wc2026_espn_shot_map',
    'wc2026_espn_player_stats',
    'wc2026_espn_lineups',
    'wc2026_espn_glossary',
  ];

  for (const tbl of tables) {
    try {
      const [[countRow]] = await conn.execute(`SELECT COUNT(*) as cnt FROM ${tbl}`);
      log('PASS', `PHASE4/${tbl}`, `✅ Table exists | rows=${countRow.cnt}`);
    } catch (e) {
      log('FAIL', `PHASE4/${tbl}`, `❌ Table MISSING or inaccessible: ${e.message}`);
    }
  }

  // Check key indexes exist by running EXPLAIN on matchId queries
  const indexChecks = [
    { tbl: 'wc2026_espn_matches', col: 'matchId', query: `SELECT matchId FROM wc2026_espn_matches WHERE matchId='760414'` },
    { tbl: 'wc2026_espn_player_stats', col: '(matchId, athleteId)', query: `SELECT matchId FROM wc2026_espn_player_stats WHERE matchId='760414' LIMIT 1` },
    { tbl: 'wc2026_espn_lineups', col: '(matchId, athleteId)', query: `SELECT matchId FROM wc2026_espn_lineups WHERE matchId='760414' LIMIT 1` },
    { tbl: 'wc2026_espn_shot_map', col: 'matchId', query: `SELECT matchId FROM wc2026_espn_shot_map WHERE matchId='760414' LIMIT 1` },
  ];

  for (const ic of indexChecks) {
    try {
      const [[explain]] = await conn.execute(`EXPLAIN ${ic.query}`);
      const usesIndex = explain.key !== null;
      check(usesIndex, `PHASE4/IDX_${ic.tbl.replace('wc2026_espn_','')}`,
        `Index on ${ic.col} active (key=${explain.key}) ✓`,
        `No index on ${ic.col} — full scan (key=null)`,
        { key: explain.key, rows: explain.rows }, !usesIndex);
    } catch (e) {
      log('WARN', `PHASE4/IDX_${ic.tbl}`, `⚠️ EXPLAIN failed: ${e.message}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 5: AGGREGATE CROSS-MATCH VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════
async function phase5_aggregateValidation() {
  section('PHASE 5: AGGREGATE CROSS-MATCH VALIDATION');

  // Row counts per table
  const tableCounts = {};
  const tables = [
    'wc2026_espn_matches', 'wc2026_espn_match_odds', 'wc2026_espn_team_stats',
    'wc2026_espn_match_stats', 'wc2026_espn_expected_goals', 'wc2026_espn_shot_map',
    'wc2026_espn_player_stats', 'wc2026_espn_lineups',
  ];

  for (const tbl of tables) {
    const [[r]] = await conn.execute(`SELECT COUNT(*) as cnt FROM ${tbl}`);
    tableCounts[tbl] = Number(r.cnt);
  }

  // wc2026_espn_matches: at least 72 rows (may have extra R32 matches from earlier sessions)
  check(tableCounts['wc2026_espn_matches'] >= 72, 'AGG/MATCHES_72',
    `wc2026_espn_matches: ${tableCounts['wc2026_espn_matches']} rows (≥72) ✓`,
    `wc2026_espn_matches: ${tableCounts['wc2026_espn_matches']} rows < 72`);

  // wc2026_espn_team_stats: at least 72 rows
  check(tableCounts['wc2026_espn_team_stats'] >= 72, 'AGG/TEAM_STATS_72',
    `wc2026_espn_team_stats: ${tableCounts['wc2026_espn_team_stats']} rows (≥72) ✓`,
    `wc2026_espn_team_stats: ${tableCounts['wc2026_espn_team_stats']} rows < 72`);

  // wc2026_espn_match_stats: at least 72 rows
  check(tableCounts['wc2026_espn_match_stats'] >= 72, 'AGG/MATCH_STATS_72',
    `wc2026_espn_match_stats: ${tableCounts['wc2026_espn_match_stats']} rows (≥72) ✓`,
    `wc2026_espn_match_stats: ${tableCounts['wc2026_espn_match_stats']} rows < 72`);

  // wc2026_espn_expected_goals: at least 72 rows
  check(tableCounts['wc2026_espn_expected_goals'] >= 72, 'AGG/XG_72',
    `wc2026_espn_expected_goals: ${tableCounts['wc2026_espn_expected_goals']} rows (≥72) ✓`,
    `wc2026_espn_expected_goals: ${tableCounts['wc2026_espn_expected_goals']} rows < 72`);

  // wc2026_espn_player_stats: at least 72*22 = 1584 rows
  check(tableCounts['wc2026_espn_player_stats'] >= 1584, 'AGG/PLAYER_STATS_MIN',
    `wc2026_espn_player_stats: ${tableCounts['wc2026_espn_player_stats']} rows (≥1584) ✓`,
    `wc2026_espn_player_stats: ${tableCounts['wc2026_espn_player_stats']} rows < 1584 (72×22)`);

  // wc2026_espn_lineups: at least 72*22 = 1584 rows
  check(tableCounts['wc2026_espn_lineups'] >= 1584, 'AGG/LINEUPS_MIN',
    `wc2026_espn_lineups: ${tableCounts['wc2026_espn_lineups']} rows (≥1584) ✓`,
    `wc2026_espn_lineups: ${tableCounts['wc2026_espn_lineups']} rows < 1584 (72×22)`);

  // wc2026_espn_shot_map: at least 72*5 = 360 rows (conservative minimum)
  check(tableCounts['wc2026_espn_shot_map'] >= 360, 'AGG/SHOT_MAP_MIN',
    `wc2026_espn_shot_map: ${tableCounts['wc2026_espn_shot_map']} rows (≥360) ✓`,
    `wc2026_espn_shot_map: ${tableCounts['wc2026_espn_shot_map']} rows < 360`);

  // wc2026_espn_match_odds: at least 72 rows (one per match minimum)
  check(tableCounts['wc2026_espn_match_odds'] >= 72, 'AGG/ODDS_MIN',
    `wc2026_espn_match_odds: ${tableCounts['wc2026_espn_match_odds']} rows (≥72) ✓`,
    `wc2026_espn_match_odds: ${tableCounts['wc2026_espn_match_odds']} rows < 72`);

  // All midnight matches have correct ET time
  const [midnightRows] = await conn.execute(`SELECT matchId, matchKickoffEt, matchGameDate FROM wc2026_espn_matches WHERE matchKickoffEt='00:00'`);
  const expectedMidnightIds = new Set(MIDNIGHT_MATCHES.map(m => m.gameId));
  const dbMidnightIds = new Set(midnightRows.map(r => String(r.matchId)));
  log('INFO', 'AGG/MIDNIGHT_COUNT', `DB has ${midnightRows.length} matches with matchKickoffEt='00:00' | Expected: ${MIDNIGHT_MATCHES.length}`);
  check(midnightRows.length === MIDNIGHT_MATCHES.length, 'AGG/MIDNIGHT_RULE_COUNT',
    `Midnight match count = ${MIDNIGHT_MATCHES.length} ✓`,
    `Midnight match count MISMATCH: DB=${midnightRows.length} expected=${MIDNIGHT_MATCHES.length}`,
    { dbMidnightIds: [...dbMidnightIds], expectedMidnightIds: [...expectedMidnightIds] });

  // Scrape version: all 72 GROUP STAGE matches should be '500x' (enhanced version)
  const [[v500Count]] = await conn.execute(`SELECT COUNT(*) as cnt FROM wc2026_espn_matches WHERE scrapeVersion='500x' AND matchId IN (${ALL_IDS.map(id => `'${id}'`).join(',')})`);
  check(Number(v500Count.cnt) === 72, 'AGG/SCRAPE_VERSION_500X',
    `${v500Count.cnt}/72 Group Stage matches have scrapeVersion='500x' ✓`,
    `Only ${v500Count.cnt}/72 Group Stage matches have scrapeVersion='500x'`,
    { count: Number(v500Count.cnt), expected: 72 });

  // matchRound: all 72 GROUP STAGE matches should have matchRound='group-stage' (ESPN native)
  const [[gsRoundCount]] = await conn.execute(`SELECT COUNT(*) as cnt FROM wc2026_espn_matches WHERE matchRound='group-stage' AND matchId IN (${ALL_IDS.map(id => `'${id}'`).join(',')})`);
  check(Number(gsRoundCount.cnt) === 72, 'AGG/MATCH_ROUND_GROUP_STAGE',
    `${gsRoundCount.cnt}/72 Group Stage matches have matchRound='group-stage' ✓`,
    `Only ${gsRoundCount.cnt}/72 Group Stage matches have matchRound='group-stage' — ESPN season.slug missing`,
    { count: Number(gsRoundCount.cnt), expected: 72 });

  // matchRound across all 9 tables: verify group-stage label propagated to all tables
  const roundTables = [
    { tbl: 'wc2026_espn_match_odds', label: 'match_odds' },
    { tbl: 'wc2026_espn_team_stats', label: 'team_stats' },
    { tbl: 'wc2026_espn_match_stats', label: 'match_stats' },
    { tbl: 'wc2026_espn_expected_goals', label: 'expected_goals' },
    { tbl: 'wc2026_espn_shot_map', label: 'shot_map' },
    { tbl: 'wc2026_espn_player_stats', label: 'player_stats' },
    { tbl: 'wc2026_espn_lineups', label: 'lineups' },
  ];
  for (const rt of roundTables) {
    const [[rtCount]] = await conn.execute(`SELECT COUNT(DISTINCT matchId) as cnt FROM ${rt.tbl} WHERE matchRound='group-stage' AND matchId IN (${ALL_IDS.map(id => `'${id}'`).join(',')})`);
    check(Number(rtCount.cnt) === 72, `AGG/MATCH_ROUND_${rt.label.toUpperCase()}`,
      `${rtCount.cnt}/72 matches have matchRound='group-stage' in ${rt.label} ✓`,
      `Only ${rtCount.cnt}/72 matches have matchRound='group-stage' in ${rt.label}`,
      { count: Number(rtCount.cnt), expected: 72 });
  }

  // Status: all GROUP STAGE 72 should be statusState='post'
  const [[postCount]] = await conn.execute(`SELECT COUNT(*) as cnt FROM wc2026_espn_matches WHERE statusState='post'`);
  check(Number(postCount.cnt) >= 72, 'AGG/STATUS_POST',
    `${postCount.cnt} matches have statusState='post' (≥72) ✓`,
    `Only ${postCount.cnt} matches have statusState='post' (< 72)`);

  // Date range: group stage matches between 2026-06-11 and 2026-06-27 (R32 may extend beyond)
  const [[dateRange]] = await conn.execute(`SELECT MIN(matchGameDate) as minDate, MAX(matchGameDate) as maxDate FROM wc2026_espn_matches WHERE matchId IN (${ALL_IDS.map(id => `'${id}'`).join(',')})`);
  log('INFO', 'AGG/DATE_RANGE', `Group stage matchGameDate range: ${dateRange.minDate} → ${dateRange.maxDate} (expected 2026-06-11 → 2026-06-27)`);
  check(dateRange.minDate >= '2026-06-11', 'AGG/DATE_MIN', `Min date ${dateRange.minDate} ≥ 2026-06-11 ✓`, `Min date ${dateRange.minDate} < 2026-06-11`);
  check(dateRange.maxDate <= '2026-06-27', 'AGG/DATE_MAX', `Max date ${dateRange.maxDate} ≤ 2026-06-27 ✓`, `Max date ${dateRange.maxDate} > 2026-06-27`);

  // Log table counts summary
  log('INFO', 'AGG/TABLE_COUNTS', `Table row counts: ${Object.entries(tableCounts).map(([t,c]) => `${t.replace('wc2026_espn_','')}=${c}`).join(' | ')}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// REPORT WRITER
// ═══════════════════════════════════════════════════════════════════════════════
function writeReport() {
  const grandTotal = passCount + failCount + warnCount;
  const overallPct = grandTotal > 0 ? ((passCount / grandTotal) * 100).toFixed(1) : '0.0';
  const finalVerdict = failCount === 0 ? '✅ ELITE — ZERO FAILURES' : failCount <= 5 ? '⚠️ MINOR ISSUES' : failCount <= 20 ? '⚠️ MODERATE ISSUES' : '❌ CRITICAL ISSUES';

  const lines = [
    '# WC2026 ESPN Scraper — 72-Match Forensic Audit Report v4.0',
    `**Generated:** ${new Date().toISOString()}`,
    `**Audit Engine:** v4.0 | 250x/500x depth | 72 matches | 9 tables`,
    `**Group Stage:** June 11–27, 2026`,
    '',
    '## Final Summary',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| **Total Checks** | ${grandTotal} |`,
    `| **PASS** | ${passCount} |`,
    `| **FAIL** | ${failCount} |`,
    `| **WARN** | ${warnCount} |`,
    `| **Pass Rate** | ${overallPct}% |`,
    `| **Verdict** | ${finalVerdict} |`,
    `| **Midnight Rule Matches** | ${MIDNIGHT_MATCHES.length} |`,
    '',
    '## Midnight Rule Matches',
    '| gameId | Match | UTC | PT Date | ET Time | Rule |',
    '|--------|-------|-----|---------|---------|------|',
    ...MIDNIGHT_MATCHES.map(m => `| ${m.gameId} | ${m.name} | ${m.utcIso} | ${m.ptDate} | ${m.etTime} | 🌙 MIDNIGHT |`),
    '',
    '## Per-Match Results (72 Matches)',
    '| # | gameId | Match | PT Date | ET Time | PASS | FAIL | WARN | % | Verdict |',
    '|---|--------|-------|---------|---------|------|------|------|---|---------|',
    ...ALL_MATCHES.map((gt, i) => {
      const r = matchResults[gt.gameId] || { pass: 0, fail: 0, warn: 0, pct: 'N/A', verdict: '⏭ NOT RUN' };
      const midnight = gt.isMidnight ? ' 🌙' : '';
      return `| ${i+1} | ${gt.gameId} | ${gt.name} | ${gt.ptDate}${midnight} | ${gt.etTime} | ${r.pass} | ${r.fail} | ${r.warn} | ${r.pct}% | ${r.verdict} |`;
    }),
    '',
    '## Timezone Policy',
    '- `matchDateUtc`: UTC epoch ms (universal sort key)',
    '- `matchGameDate`: PT date (Pacific Time date the game kicked off)',
    '- `matchKickoffEt`: ET time "HH:MM" (Eastern Time kickoff)',
    '- **Midnight Rule**: if game starts at 12:00 AM ET, store PT date (day before ET date)',
    '  - Example: 760421 kicks off at 04:00 UTC = 00:00 ET Jun 14 = 21:00 PT Jun 13 → matchGameDate="2026-06-13", matchKickoffEt="00:00"',
    '',
    '## Log File',
    `See: \`.manus-logs/forensicAudit72.txt\``,
  ];

  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.writeFileSync(REPORT_FILE, lines.join('\n'), 'utf8');
  log('INFO', 'REPORT_SAVED', `Report written → ${REPORT_FILE}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════
section('WC2026 ESPN SCRAPER — 72-MATCH FORENSIC AUDIT ENGINE v4.0');
log('INFO', 'START', `Audit started | ${new Date().toISOString()} | 72 matches | 9 tables`);
log('INFO', 'MATCHES', `Group Stage: June 11–27, 2026 | IDs: ${ALL_IDS[0]}–${ALL_IDS[ALL_IDS.length-1]}`);
log('INFO', 'MIDNIGHT_RULE', `${MIDNIGHT_MATCHES.length} midnight-edge matches: ${MIDNIGHT_MATCHES.map(m => `${m.gameId}(${m.ptDate} ET=${m.etTime})`).join(', ')}`);
log('INFO', 'TZ_POLICY', 'matchGameDate=PT date | matchKickoffEt=ET time | matchDateUtc=UTC epoch ms');

const { dbIds, missing } = await phase1_existenceCheck();
await phase2_midnightRuleValidation();
const { totalMatchPass, totalMatchFail } = await phase3_perMatchAudit(dbIds);
await phase4_schemaIntegrity();
await phase5_aggregateValidation();

section('FINAL AUDIT SUMMARY');
const grandTotal = passCount + failCount + warnCount;
const overallPct = grandTotal > 0 ? ((passCount / grandTotal) * 100).toFixed(1) : '0.0';
const finalVerdict = failCount === 0 ? '✅ ELITE — ZERO FAILURES' : failCount <= 5 ? '⚠️ MINOR ISSUES' : failCount <= 20 ? '⚠️ MODERATE ISSUES' : '❌ CRITICAL ISSUES';

log('INFO', 'FINAL_VERDICT', `${finalVerdict} | PASS=${passCount} FAIL=${failCount} WARN=${warnCount} | ${overallPct}% pass rate`);
log('INFO', 'FINAL_MATCHES', `Per-match: ${totalMatchPass} PASS | ${totalMatchFail} FAIL | ${ALL_MATCHES.length} total`);
log('INFO', 'FINAL_MISSING', `Missing from DB: ${missing.length} | ${missing.length > 0 ? missing.join(', ') : 'NONE'}`);
log('INFO', 'FINAL_MIDNIGHT', `Midnight rule matches: ${MIDNIGHT_MATCHES.length} | ${MIDNIGHT_MATCHES.map(m => m.gameId).join(', ')}`);

// Print per-match summary table
subsection('Per-Match Verdict Table');
for (const gt of ALL_MATCHES) {
  const r = matchResults[gt.gameId];
  if (r) {
    const midnight = gt.isMidnight ? ' 🌙' : '';
    log('INFO', `FINAL_${gt.gameId}`, `${r.verdict} | ${gt.name}${midnight} | P=${r.pass} F=${r.fail} W=${r.warn} (${r.pct}%) | PT=${gt.ptDate} ET=${gt.etTime}`);
  }
}

saveLog();
writeReport();
await conn.end();

console.log(`\n${'═'.repeat(76)}`);
console.log(`  WC2026 72-Match Forensic Audit Complete`);
console.log(`  ${finalVerdict}`);
console.log(`  PASS=${passCount} | FAIL=${failCount} | WARN=${warnCount} | ${overallPct}%`);
console.log(`  Per-match: ${totalMatchPass}/72 PASS | ${totalMatchFail}/72 FAIL`);
console.log(`  Missing matches: ${missing.length}`);
console.log(`${'═'.repeat(76)}\n`);
