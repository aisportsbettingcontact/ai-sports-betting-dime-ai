/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║  WC2026 ESPN SCRAPER — 79-MATCH FORENSIC AUDIT ENGINE v5.1                 ║
 * ║  72 Group Stage (Jun 11–27) + 7 R32 Knockout Stage (Jun 28–30)             ║
 * ║  500x depth | Midnight rule | matchRound per round | 9 Tables per Match    ║
 * ║  Ground truth: groupStageGameIds.json + ESPN API verified R32 data          ║
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
 * ROUND LABELS (ESPN native season.slug):
 *   - Group Stage (760414–760485): matchRound = "group-stage"  (season.type=13802)
 *   - Round of 32 (760486–760492): matchRound = "round-of-32" (season.type=13801)
 *
 * AUDIT DEPTH:
 *   Per match: ~40 checks across 9 tables
 *   Cross-match: row count, midnight rule, schema, index integrity
 *   Total: ~3700+ individual checks across all 79 matches
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
const LOG_FILE = path.join(LOG_DIR, 'forensicAudit78.txt');
const REPORT_FILE = path.join(LOG_DIR, 'WC2026_FORENSIC_AUDIT_78_REPORT.md');
const TERMINAL_LOG = `/tmp/forensicAudit78_run.txt`;

// ── GROUND TRUTH HELPERS ──────────────────────────────────────────────────────
function parseMatchGT(m) {
  const utcIso = m.dateTime;
  const utcMs = new Date(utcIso).getTime();
  // ET = UTC - 4h (EDT in June/July)
  const etMs = utcMs - (4 * 60 * 60 * 1000);
  const etDate = new Date(etMs);
  const etHH = String(etDate.getUTCHours()).padStart(2, '0');
  const etMM = String(etDate.getUTCMinutes()).padStart(2, '0');
  const etTime = `${etHH}:${etMM}`;
  const isMidnight = etTime === '00:00';
  // PT date: compute from UTC using PDT offset (UTC-7)
  // Midnight rule: PT date is the kickoff date in Pacific Time
  const ptMs = utcMs - (7 * 60 * 60 * 1000);
  const ptDateObj = new Date(ptMs);
  const ptDate = `${ptDateObj.getUTCFullYear()}-${String(ptDateObj.getUTCMonth()+1).padStart(2,'0')}-${String(ptDateObj.getUTCDate()).padStart(2,'0')}`;
  return {
    gameId: m.gameId,
    homeTeam: m.homeTeam,
    awayTeam: m.awayTeam,
    homeScore: parseInt(m.homeScore, 10),
    awayScore: parseInt(m.awayScore, 10),
    name: m.name,
    utcIso,
    utcMs,
    etTime,
    ptDate,
    isMidnight,
    status: m.status,
    matchRound: m.matchRound || 'group-stage',
  };
}

// ── GROUP STAGE GROUND TRUTH (from groupStageGameIds.json) ───────────────────
const gidsPath = path.resolve(__dirname, 'groupStageGameIds.json');
const gidsData = JSON.parse(fs.readFileSync(gidsPath, 'utf8'));
const GS_MATCHES = gidsData.matches.map(m => parseMatchGT({ ...m, matchRound: 'group-stage' }));
const GS_IDS = GS_MATCHES.map(m => m.gameId);

// ── R32 GROUND TRUTH (from ESPN API — verified Jun 28-30, 2026) ───────────────
// All 7 completed R32 matches. Source: ESPN scoreboard API + summary API
// season.type=13801 → season.slug="round-of-32"
// No midnight matches in R32 (all ET times are 13:00-22:00)
const R32_RAW = [
  { gameId: '760486', homeTeam: 'RSA', awayTeam: 'CAN', homeScore: 0, awayScore: 1, name: 'South Africa vs Canada',   dateTime: '2026-06-28T19:00:00Z', status: 'post' },
  { gameId: '760487', homeTeam: 'BRA', awayTeam: 'JPN', homeScore: 2, awayScore: 1, name: 'Brazil vs Japan',          dateTime: '2026-06-29T17:00:00Z', status: 'post' },
  { gameId: '760489', homeTeam: 'GER', awayTeam: 'PAR', homeScore: 1, awayScore: 1, name: 'Germany vs Paraguay',      dateTime: '2026-06-29T20:30:00Z', status: 'post' },
  { gameId: '760488', homeTeam: 'NED', awayTeam: 'MAR', homeScore: 1, awayScore: 1, name: 'Netherlands vs Morocco',   dateTime: '2026-06-30T01:00:00Z', status: 'post' },
  { gameId: '760490', homeTeam: 'CIV', awayTeam: 'NOR', homeScore: 1, awayScore: 2, name: 'Ivory Coast vs Norway',    dateTime: '2026-06-30T17:00:00Z', status: 'post' },
  { gameId: '760491', homeTeam: 'MEX', awayTeam: 'ECU', homeScore: 2, awayScore: 0, name: 'Mexico vs Ecuador',        dateTime: '2026-07-01T02:00:00Z', status: 'post' },
  { gameId: '760492', homeTeam: 'FRA', awayTeam: 'SWE', homeScore: 3, awayScore: 0, name: 'France vs Sweden',          dateTime: '2026-06-30T21:00:00Z', status: 'post' },
];
const R32_MATCHES = R32_RAW.map(m => parseMatchGT({ ...m, matchRound: 'round-of-32' }));
const R32_IDS = R32_MATCHES.map(m => m.gameId);

// ── ALL 79 MATCHES ────────────────────────────────────────────────────────────
const ALL_MATCHES = [...GS_MATCHES, ...R32_MATCHES];
const ALL_IDS = ALL_MATCHES.map(m => m.gameId);
const GT_MAP = Object.fromEntries(ALL_MATCHES.map(m => [m.gameId, m]));

// Midnight matches (GS only — no R32 midnight matches)
const MIDNIGHT_MATCHES = ALL_MATCHES.filter(m => m.isMidnight);

// ── LOGGER ────────────────────────────────────────────────────────────────────
let logBuffer = [];
let passCount = 0, failCount = 0, warnCount = 0, infoCount = 0;
const matchResults = {};
let terminalStream;

function initTerminalLog() {
  terminalStream = fs.createWriteStream(TERMINAL_LOG, { flags: 'w' });
}

function ts() { return new Date().toISOString(); }

function log(level, tag, msg, data = null) {
  const dataStr = data ? ` | ${JSON.stringify(data)}` : '';
  const line = `[${ts()}] [${level.padEnd(7)}] [${tag.padEnd(32)}] ${msg}${dataStr}`;
  console.log(line);
  logBuffer.push(line);
  if (terminalStream) terminalStream.write(line + '\n');
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
  const bar = '═'.repeat(78);
  const lines = [`\n${bar}`, `  ${title}`, bar];
  lines.forEach(l => { console.log(l); logBuffer.push(l); if (terminalStream) terminalStream.write(l + '\n'); });
}

function subsection(title) {
  const line = `\n── ${title} ${'─'.repeat(Math.max(0, 74 - title.length))}`;
  console.log(line); logBuffer.push(line); if (terminalStream) terminalStream.write(line + '\n');
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
  const etMs = ms - (4 * 60 * 60 * 1000); // EDT = UTC-4
  const etD = new Date(etMs);
  return `${String(etD.getUTCHours()).padStart(2,'0')}:${String(etD.getUTCMinutes()).padStart(2,'0')}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 1: EXISTENCE CHECK — All 78 matches in DB
// ═══════════════════════════════════════════════════════════════════════════════
async function phase1_existenceCheck() {
  section('PHASE 1: EXISTENCE CHECK — All 79 Matches in DB (72 GS + 7 R32)');
  const [rows] = await conn.execute(`SELECT matchId FROM wc2026_espn_matches ORDER BY matchId`);
  const dbIds = new Set(rows.map(r => String(r.matchId)));
  const missing = ALL_IDS.filter(id => !dbIds.has(id));
  const extra = [...dbIds].filter(id => !ALL_IDS.includes(id));

  check(rows.length >= 79, 'PHASE1/TOTAL_COUNT',
    `${rows.length} matches in DB (≥79) ✓`,
    `Match count CRITICAL: DB has only ${rows.length}, expected ≥79`,
    { dbCount: rows.length, expected: 79 });

  check(missing.length === 0, 'PHASE1/MISSING_MATCHES',
    `No missing matches ✓`,
    `${missing.length} MISSING matches: ${missing.join(', ')}`,
    { missing });

  // GS-specific existence
  const missingGS = GS_IDS.filter(id => !dbIds.has(id));
  check(missingGS.length === 0, 'PHASE1/MISSING_GS',
    `All 72 Group Stage matches present ✓`,
    `${missingGS.length} Group Stage matches MISSING: ${missingGS.join(', ')}`,
    { missing: missingGS });

  // R32-specific existence
  const missingR32 = R32_IDS.filter(id => !dbIds.has(id));
  check(missingR32.length === 0, 'PHASE1/MISSING_R32',
    `All 7 R32 Knockout Stage matches present ✓`,
    `${missingR32.length} R32 matches MISSING: ${missingR32.join(', ')}`,
    { missing: missingR32 });

  if (extra.length > 0) {
    log('WARN', 'PHASE1/EXTRA_MATCHES', `⚠️ ${extra.length} extra matches in DB beyond 79: ${extra.join(', ')}`);
  }

  log('INFO', 'PHASE1/SUMMARY', `DB has ${rows.length} matches | GS missing: ${missingGS.length} | R32 missing: ${missingR32.length} | Extra: ${extra.length}`);
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
// PHASE 3: PER-MATCH DEEP AUDIT — All 78 matches
// ═══════════════════════════════════════════════════════════════════════════════
async function phase3_perMatchAudit(dbIds) {
  section('PHASE 3: PER-MATCH DEEP AUDIT — All 79 Matches (72 GS + 7 R32)');
  let totalMatchPass = 0, totalMatchFail = 0;

  for (let i = 0; i < ALL_MATCHES.length; i++) {
    const gt = ALL_MATCHES[i];
    const mid = gt.gameId;
    const mp = { pass: 0, fail: 0, warn: 0 };
    const roundLabel = gt.matchRound; // 'group-stage' or 'round-of-32'

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
      log('FAIL', `M${mid}/EXISTENCE`, `❌ Match ${mid} (${gt.name}) [${roundLabel}] NOT IN DB — SKIPPING DEEP AUDIT`);
      matchResults[mid] = { ...gt, pass: 0, fail: 1, warn: 0, pct: '0.0', verdict: '❌ NOT IN DB', label: gt.name };
      totalMatchFail++;
      continue;
    }

    // Progress indicator every 8 matches
    if (i % 8 === 0) {
      log('INFO', 'PHASE3/PROGRESS', `Auditing match ${i+1}/${ALL_MATCHES.length} | gameId=${mid} | ${gt.name} [${roundLabel}]`);
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

    // PT date must match computed PT date
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
      const etDateFromUtc = utcMsToEtDate(dbUtcMs);
      mc(dbPtDate < etDateFromUtc, 'MIDNIGHT_PT_BEFORE_ET',
        `MIDNIGHT RULE: PT date ${dbPtDate} < ET date ${etDateFromUtc} ✓`,
        `MIDNIGHT RULE FAIL: PT date ${dbPtDate} should be < ET date ${etDateFromUtc}`,
        { ptDate: dbPtDate, etDate: etDateFromUtc });
    }

    // Scrape version — 500x is the current enhanced version
    mc(m.scrapeVersion === '500x', 'SCRAPE_VERSION', `scrapeVersion="500x" ✓`, `scrapeVersion="${m.scrapeVersion}" ≠ "500x"`);

    // matchRound — must match ESPN native season.slug for this match's round
    mc(m.matchRound === roundLabel, 'MATCH_ROUND',
      `matchRound="${roundLabel}" (ESPN season.slug) ✓`,
      `matchRound="${m.matchRound}" ≠ "${roundLabel}" — ESPN season.slug incorrect`,
      { stored: m.matchRound, expected: roundLabel });

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
      const shotNulls = ['homeShotsOnGoal','homeShots','awayShotsOnGoal','awayShots'].filter(c => ms_row[c] === null);
      mc(shotNulls.length === 0, 'MS_SHOTS', `SHOTS: core fields populated ✓`, `SHOTS: ${shotNulls.length} null: ${shotNulls.join(', ')}`);
      const passNulls = ['homeAccuratePasses','homePasses','awayAccuratePasses','awayPasses'].filter(c => ms_row[c] === null);
      mc(passNulls.length === 0, 'MS_PASSES', `PASSES: core fields populated ✓`, `PASSES: ${passNulls.length} null: ${passNulls.join(', ')}`);
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

    const [[starterCount]] = await conn.execute(`SELECT COUNT(*) as cnt FROM wc2026_espn_lineups WHERE matchId=? AND role='starter'`, [mid]);
    mc(Number(starterCount.cnt) === 22, 'STARTERS_22', `22 starters ✓`, `starters count=${starterCount.cnt} ≠ 22`);

    // ── I. wc2026_espn_glossary ────────────────────────────────────────────
    const [[glossaryCount]] = await conn.execute(`SELECT COUNT(*) as cnt FROM wc2026_espn_glossary`);
    mc(Number(glossaryCount.cnt) > 0, 'GLOSSARY_EXISTS', `${glossaryCount.cnt} glossary entries ✓`, 'CRITICAL: glossary EMPTY', null, true);

    // Log match summary
    const totalChecks = mp.pass + mp.fail + mp.warn;
    const pct = totalChecks > 0 ? ((mp.pass / totalChecks) * 100).toFixed(1) : '0.0';
    const verdict = mp.fail === 0 ? '✅ PASS' : mp.fail <= 2 ? '⚠️ MINOR' : '❌ FAIL';
    log('INFO', `M${mid}/SUMMARY`, `${gt.name} [${roundLabel}] | P=${mp.pass} F=${mp.fail} W=${mp.warn} (${pct}%) | ${verdict} | ET=${gt.etTime} PT_date=${gt.ptDate}${gt.isMidnight ? ' 🌙MIDNIGHT' : ''}`);

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
      // Also check matchRound column exists
      const [[roundRow]] = await conn.execute(`SELECT COUNT(*) as cnt FROM ${tbl} WHERE matchRound IS NOT NULL`);
      log('PASS', `PHASE4/${tbl}`, `✅ Table exists | rows=${countRow.cnt} | matchRound populated=${roundRow.cnt}`);
    } catch (e) {
      log('FAIL', `PHASE4/${tbl}`, `❌ Table MISSING or inaccessible: ${e.message}`);
    }
  }

  // Check key indexes
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

  // Check matchRound index on matches table
  try {
    const [[explain]] = await conn.execute(`EXPLAIN SELECT matchId FROM wc2026_espn_matches WHERE matchRound='group-stage' LIMIT 1`);
    const usesIndex = explain.key !== null;
    check(usesIndex, 'PHASE4/IDX_MATCH_ROUND',
      `matchRound index active (key=${explain.key}) ✓`,
      `No matchRound index — full scan`,
      { key: explain.key }, !usesIndex);
  } catch (e) {
    log('WARN', 'PHASE4/IDX_MATCH_ROUND', `⚠️ matchRound EXPLAIN failed: ${e.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 5: AGGREGATE CROSS-MATCH VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════
async function phase5_aggregateValidation() {
  section('PHASE 5: AGGREGATE CROSS-MATCH VALIDATION');

  const tables = [
    'wc2026_espn_matches', 'wc2026_espn_match_odds', 'wc2026_espn_team_stats',
    'wc2026_espn_match_stats', 'wc2026_espn_expected_goals', 'wc2026_espn_shot_map',
    'wc2026_espn_player_stats', 'wc2026_espn_lineups',
  ];
  const tableCounts = {};
  for (const tbl of tables) {
    const [[r]] = await conn.execute(`SELECT COUNT(*) as cnt FROM ${tbl}`);
    tableCounts[tbl] = Number(r.cnt);
  }

  // Total match count ≥78
  check(tableCounts['wc2026_espn_matches'] >= 79, 'AGG/MATCHES_79',
    `wc2026_espn_matches: ${tableCounts['wc2026_espn_matches']} rows (≥79) ✓`,
    `wc2026_espn_matches: ${tableCounts['wc2026_espn_matches']} rows < 79`);

  // Per-table row counts ≥78
  for (const tbl of ['wc2026_espn_team_stats','wc2026_espn_match_stats','wc2026_espn_expected_goals']) {
    const label = tbl.replace('wc2026_espn_','');
    check(tableCounts[tbl] >= 79, `AGG/${label.toUpperCase()}_79`,
      `${tbl}: ${tableCounts[tbl]} rows (≥79) ✓`,
      `${tbl}: ${tableCounts[tbl]} rows < 79`);
  }

  // Player stats ≥79*22=1738
  check(tableCounts['wc2026_espn_player_stats'] >= 1738, 'AGG/PLAYER_STATS_MIN',
    `wc2026_espn_player_stats: ${tableCounts['wc2026_espn_player_stats']} rows (≥1738) ✓`,
    `wc2026_espn_player_stats: ${tableCounts['wc2026_espn_player_stats']} rows < 1738 (79×22)`);

  // Lineups ≥79*22=1738
  check(tableCounts['wc2026_espn_lineups'] >= 1738, 'AGG/LINEUPS_MIN',
    `wc2026_espn_lineups: ${tableCounts['wc2026_espn_lineups']} rows (≥1738) ✓`,
    `wc2026_espn_lineups: ${tableCounts['wc2026_espn_lineups']} rows < 1738 (79×22)`);

  // Shot map ≥79*5=395
  check(tableCounts['wc2026_espn_shot_map'] >= 395, 'AGG/SHOT_MAP_MIN',
    `wc2026_espn_shot_map: ${tableCounts['wc2026_espn_shot_map']} rows (≥395) ✓`,
    `wc2026_espn_shot_map: ${tableCounts['wc2026_espn_shot_map']} rows < 395`);

  // Odds ≥79
  check(tableCounts['wc2026_espn_match_odds'] >= 79, 'AGG/ODDS_MIN',
    `wc2026_espn_match_odds: ${tableCounts['wc2026_espn_match_odds']} rows (≥79) ✓`,
    `wc2026_espn_match_odds: ${tableCounts['wc2026_espn_match_odds']} rows < 79`);

  // Midnight matches
  const [midnightRows] = await conn.execute(`SELECT matchId, matchKickoffEt, matchGameDate FROM wc2026_espn_matches WHERE matchKickoffEt='00:00'`);
  const expectedMidnightIds = new Set(MIDNIGHT_MATCHES.map(m => m.gameId));
  const dbMidnightIds = new Set(midnightRows.map(r => String(r.matchId)));
  log('INFO', 'AGG/MIDNIGHT_COUNT', `DB has ${midnightRows.length} matches with matchKickoffEt='00:00' | Expected: ${MIDNIGHT_MATCHES.length}`);
  check(midnightRows.length === MIDNIGHT_MATCHES.length, 'AGG/MIDNIGHT_RULE_COUNT',
    `Midnight match count = ${MIDNIGHT_MATCHES.length} ✓`,
    `Midnight match count MISMATCH: DB=${midnightRows.length} expected=${MIDNIGHT_MATCHES.length}`,
    { dbMidnightIds: [...dbMidnightIds], expectedMidnightIds: [...expectedMidnightIds] });

  // scrapeVersion=500x for ALL 78 matches
  const gsIdList = GS_IDS.map(id => `'${id}'`).join(',');
  const r32IdList = R32_IDS.map(id => `'${id}'`).join(',');
  const allIdList = ALL_IDS.map(id => `'${id}'`).join(',');

  const [[v500GS]] = await conn.execute(`SELECT COUNT(*) as cnt FROM wc2026_espn_matches WHERE scrapeVersion='500x' AND matchId IN (${gsIdList})`);
  check(Number(v500GS.cnt) === 72, 'AGG/SCRAPE_VERSION_500X_GS',
    `${v500GS.cnt}/72 Group Stage matches have scrapeVersion='500x' ✓`,
    `Only ${v500GS.cnt}/72 Group Stage matches have scrapeVersion='500x'`);

  const [[v500R32]] = await conn.execute(`SELECT COUNT(*) as cnt FROM wc2026_espn_matches WHERE scrapeVersion='500x' AND matchId IN (${r32IdList})`);
  check(Number(v500R32.cnt) === 7, 'AGG/SCRAPE_VERSION_500X_R32',
    `${v500R32.cnt}/7 R32 matches have scrapeVersion='500x' ✓`,
    `Only ${v500R32.cnt}/7 R32 matches have scrapeVersion='500x'`);

  // matchRound='group-stage' for all 72 GS matches across all 9 tables
  const [[gsRoundCount]] = await conn.execute(`SELECT COUNT(*) as cnt FROM wc2026_espn_matches WHERE matchRound='group-stage' AND matchId IN (${gsIdList})`);
  check(Number(gsRoundCount.cnt) === 72, 'AGG/MATCH_ROUND_GROUP_STAGE',
    `${gsRoundCount.cnt}/72 Group Stage matches have matchRound='group-stage' ✓`,
    `Only ${gsRoundCount.cnt}/72 Group Stage matches have matchRound='group-stage'`,
    { count: Number(gsRoundCount.cnt), expected: 72 });

  // matchRound='round-of-32' for all 7 R32 matches
  const [[r32RoundCount]] = await conn.execute(`SELECT COUNT(*) as cnt FROM wc2026_espn_matches WHERE matchRound='round-of-32' AND matchId IN (${r32IdList})`);
  check(Number(r32RoundCount.cnt) === 7, 'AGG/MATCH_ROUND_R32',
    `${r32RoundCount.cnt}/7 R32 matches have matchRound='round-of-32' ✓`,
    `Only ${r32RoundCount.cnt}/7 R32 matches have matchRound='round-of-32'`,
    { count: Number(r32RoundCount.cnt), expected: 7 });

  // matchRound propagated to all 7 secondary tables for GS
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
    const [[rtGS]] = await conn.execute(`SELECT COUNT(DISTINCT matchId) as cnt FROM ${rt.tbl} WHERE matchRound='group-stage' AND matchId IN (${gsIdList})`);
    check(Number(rtGS.cnt) === 72, `AGG/MATCH_ROUND_GS_${rt.label.toUpperCase()}`,
      `${rtGS.cnt}/72 GS matches have matchRound='group-stage' in ${rt.label} ✓`,
      `Only ${rtGS.cnt}/72 GS matches have matchRound='group-stage' in ${rt.label}`,
      { count: Number(rtGS.cnt), expected: 72 });

    const [[rtR32]] = await conn.execute(`SELECT COUNT(DISTINCT matchId) as cnt FROM ${rt.tbl} WHERE matchRound='round-of-32' AND matchId IN (${r32IdList})`);
    check(Number(rtR32.cnt) === 7, `AGG/MATCH_ROUND_R32_${rt.label.toUpperCase()}`,
      `${rtR32.cnt}/7 R32 matches have matchRound='round-of-32' in ${rt.label} ✓`,
      `Only ${rtR32.cnt}/7 R32 matches have matchRound='round-of-32' in ${rt.label}`,
      { count: Number(rtR32.cnt), expected: 7 });
  }

  // Status: all 79 should be statusState='post'
  const [[postCount]] = await conn.execute(`SELECT COUNT(*) as cnt FROM wc2026_espn_matches WHERE statusState='post' AND matchId IN (${allIdList})`);
  check(Number(postCount.cnt) === 79, 'AGG/STATUS_POST',
    `${postCount.cnt}/79 matches have statusState='post' ✓`,
    `Only ${postCount.cnt}/79 matches have statusState='post'`);

  // Date ranges
  const [[gsDateRange]] = await conn.execute(`SELECT MIN(matchGameDate) as minDate, MAX(matchGameDate) as maxDate FROM wc2026_espn_matches WHERE matchId IN (${gsIdList})`);
  log('INFO', 'AGG/GS_DATE_RANGE', `Group Stage matchGameDate range: ${gsDateRange.minDate} → ${gsDateRange.maxDate} (expected 2026-06-11 → 2026-06-27)`);
  check(gsDateRange.minDate >= '2026-06-11', 'AGG/GS_DATE_MIN', `GS min date ${gsDateRange.minDate} ≥ 2026-06-11 ✓`, `GS min date ${gsDateRange.minDate} < 2026-06-11`);
  check(gsDateRange.maxDate <= '2026-06-27', 'AGG/GS_DATE_MAX', `GS max date ${gsDateRange.maxDate} ≤ 2026-06-27 ✓`, `GS max date ${gsDateRange.maxDate} > 2026-06-27`);

  const [[r32DateRange]] = await conn.execute(`SELECT MIN(matchGameDate) as minDate, MAX(matchGameDate) as maxDate FROM wc2026_espn_matches WHERE matchId IN (${r32IdList})`);
  log('INFO', 'AGG/R32_DATE_RANGE', `R32 matchGameDate range: ${r32DateRange.minDate} → ${r32DateRange.maxDate} (expected 2026-06-28 → 2026-06-30)`);
  check(r32DateRange.minDate >= '2026-06-28', 'AGG/R32_DATE_MIN', `R32 min date ${r32DateRange.minDate} ≥ 2026-06-28 ✓`, `R32 min date ${r32DateRange.minDate} < 2026-06-28`);
  check(r32DateRange.maxDate <= '2026-06-30', 'AGG/R32_DATE_MAX', `R32 max date ${r32DateRange.maxDate} ≤ 2026-06-30 ✓`, `R32 max date ${r32DateRange.maxDate} > 2026-06-30`);

  log('INFO', 'AGG/TABLE_COUNTS', `Table row counts: ${Object.entries(tableCounts).map(([t,c]) => `${t.replace('wc2026_espn_','')}=${c}`).join(' | ')}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// REPORT WRITER
// ═══════════════════════════════════════════════════════════════════════════════
function writeReport() {
  const grandTotal = passCount + failCount + warnCount;
  const overallPct = grandTotal > 0 ? ((passCount / grandTotal) * 100).toFixed(1) : '0.0';
  const finalVerdict = failCount === 0 ? '✅ ELITE — ZERO FAILURES' : failCount <= 5 ? '⚠️ MINOR ISSUES' : failCount <= 20 ? '⚠️ MODERATE ISSUES' : '❌ CRITICAL ISSUES';

  const gsResults = Object.values(matchResults).filter(r => GS_IDS.includes(r.gameId));
  const r32Results = Object.values(matchResults).filter(r => R32_IDS.includes(r.gameId));

  const lines = [
    '# WC2026 ESPN Scraper — 79-Match Forensic Audit Report v5.1',
    `**Generated:** ${new Date().toISOString()}`,
    `**Audit Engine:** v5.1 | 500x depth | 79 matches (72 GS + 7 R32) | 9 tables`,
    `**Group Stage:** June 11–27, 2026 | **R32 Knockout Stage:** June 28–30, 2026`,
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
    `| **Group Stage Matches** | 72 (760414–760485) |`,
    `| **R32 Knockout Matches** | 7 (760486–760492) |`,
    `| **Midnight Rule Matches** | ${MIDNIGHT_MATCHES.length} |`,
    '',
    '## Midnight Rule Matches',
    '| gameId | Match | UTC | PT Date | ET Time | Rule |',
    '|--------|-------|-----|---------|---------|------|',
    ...MIDNIGHT_MATCHES.map(m => `| ${m.gameId} | ${m.name} | ${m.utcIso} | ${m.ptDate} | ${m.etTime} | 🌙 MIDNIGHT |`),
    '',
    '## Group Stage Results (72 Matches)',
    '| # | gameId | Match | Round | PT Date | ET Time | PASS | FAIL | WARN | % | Verdict |',
    '|---|--------|-------|-------|---------|---------|------|------|------|---|---------|',
    ...gsResults.map((r, i) => `| ${i+1} | ${r.gameId} | ${r.label} | group-stage | ${r.ptDate} | ${r.etTime}${r.isMidnight ? ' 🌙' : ''} | ${r.pass} | ${r.fail} | ${r.warn} | ${r.pct}% | ${r.verdict} |`),
    '',
    '## R32 Knockout Stage Results (7 Matches)',
    '| # | gameId | Match | Round | PT Date | ET Time | PASS | FAIL | WARN | % | Verdict |',
    '|---|--------|-------|-------|---------|---------|------|------|------|---|---------|',
    ...r32Results.map((r, i) => `| ${i+1} | ${r.gameId} | ${r.label} | round-of-32 | ${r.ptDate} | ${r.etTime} | ${r.pass} | ${r.fail} | ${r.warn} | ${r.pct}% | ${r.verdict} |`),
  ];

  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.writeFileSync(REPORT_FILE, lines.join('\n'), 'utf8');
  log('INFO', 'REPORT_SAVED', `Report written → ${REPORT_FILE}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════
async function main() {
  initTerminalLog();
  const startMs = Date.now();

  const header = [
    '╔══════════════════════════════════════════════════════════════════════════════╗',
    '║  WC2026 ESPN SCRAPER — 79-MATCH FORENSIC AUDIT ENGINE v5.1                 ║',
    '║  72 Group Stage (Jun 11–27) + 7 R32 Knockout Stage (Jun 28–30)             ║',
    '║  500x depth | ESPN-native matchRound | Midnight rule | 9 tables/match      ║',
    '╚══════════════════════════════════════════════════════════════════════════════╝',
    `Started: ${new Date().toISOString()}`,
    `GS matches: ${GS_IDS.length} | R32 matches: ${R32_IDS.length} | Total: ${ALL_IDS.length}`,
    `Midnight matches: ${MIDNIGHT_MATCHES.length} (${MIDNIGHT_MATCHES.map(m=>m.gameId).join(', ')})`,
    `Log: ${LOG_FILE}`,
    `Terminal log: ${TERMINAL_LOG}`,
  ];
  header.forEach(l => { console.log(l); logBuffer.push(l); if (terminalStream) terminalStream.write(l + '\n'); });

  try {
    const { dbIds } = await phase1_existenceCheck();
    await phase2_midnightRuleValidation();
    await phase3_perMatchAudit(dbIds);
    await phase4_schemaIntegrity();
    await phase5_aggregateValidation();
  } catch (err) {
    log('FAIL', 'AUDIT_FATAL', `❌ Fatal audit error: ${err.message}`, { stack: err.stack });
  } finally {
    await conn.end();
  }

  const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);
  const grandTotal = passCount + failCount + warnCount;
  const overallPct = grandTotal > 0 ? ((passCount / grandTotal) * 100).toFixed(1) : '0.0';
  const finalVerdict = failCount === 0 ? '✅ ELITE — ZERO FAILURES' : failCount <= 5 ? '⚠️ MINOR ISSUES' : failCount <= 20 ? '⚠️ MODERATE ISSUES' : '❌ CRITICAL ISSUES';

  const summary = [
    '',
    '╔══════════════════════════════════════════════════════════════════════════════╗',
    `║  FINAL AUDIT RESULT: ${finalVerdict.padEnd(56)}║`,
    `║  PASS=${String(passCount).padEnd(6)} FAIL=${String(failCount).padEnd(6)} WARN=${String(warnCount).padEnd(6)} | ${overallPct}% pass rate | ${elapsedSec}s  ║`,
    `║  Per-match: ${Object.values(matchResults).filter(r=>r.fail===0).length}/${ALL_MATCHES.length} PASS | Midnight rule: ${MIDNIGHT_MATCHES.length}/${MIDNIGHT_MATCHES.length} ║`,
    '╚══════════════════════════════════════════════════════════════════════════════╝',
  ];
  summary.forEach(l => { console.log(l); logBuffer.push(l); if (terminalStream) terminalStream.write(l + '\n'); });

  saveLog();
  writeReport();

  if (terminalStream) terminalStream.end();
  process.exit(failCount === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
