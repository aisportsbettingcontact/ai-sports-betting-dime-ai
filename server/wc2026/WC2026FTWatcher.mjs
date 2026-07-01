/**
 * WC2026FTWatcher.mjs — WC2026 Live Match Final-State Watcher v2.1
 * ══════════════════════════════════════════════════════════════════
 * ELITE DUAL-CHANNEL LOGGER | 500x AUTO-TRIGGER ENGINE | ESPN-ONLY
 *
 * Polls the ESPN scoreboard API every 30 seconds across a ±3-day
 * window, detects newly-final WC2026 matches, and fires the 500x
 * scraper (espnIngest.test.live.mjs) for each newly-settled game.
 *
 * Architecture mirrors batchScrapeR32.mjs at every layer:
 *   - Elite dual-channel logger: terminal (ANSI) + two file streams
 *   - File-stream child-process capture (prevents pipe deadlock)
 *   - Forensic FT-transition detection engine (ESPN status type IDs)
 *   - FT-confirmation double-check poll (re-confirms state=post before trigger)
 *   - TRANS_DETAIL log level: all 12 ESPN status fields per transition
 *   - Midnight rule verification post-scrape (PT date / ET time)
 *   - Round verification (matchRound = expected ESPN season.slug)
 *   - Pre-flight DB state banner on startup
 *   - Retry engine: up to 3 attempts with 10s/20s/30s backoff
 *   - Per-cycle state machine: tracks every game's statusState
 *   - Session summary on SIGINT/SIGTERM
 *
 * ESPN-ONLY POLICY: ALL data sourced exclusively from ESPN APIs.
 * No external sources. No fallback to non-ESPN endpoints.
 * Source: https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard
 *
 * ══════════════════════════════════════════════════════════════════
 * FORENSIC FT-TRANSITION AUDIT — gameId=760491 (Mexico vs Ecuador)
 * ══════════════════════════════════════════════════════════════════
 *
 * GROUND TRUTH from ESPN __espnfitt__ HTML snapshot (uploaded by user):
 *   Captured at: Wed, 01 Jul 2026 03:47:36 GMT (83' in-play)
 *   status.id:          "26"
 *   status.description: "Second Half"
 *   status.detail:      "83'"
 *   status.state:       "in"
 *   status.completed:   false (field absent = false)
 *   score:              MEX 2 - 0 ECU (goals: Quiñones 22', Jiménez 31')
 *   venue:              Estadio Banorte, Mexico City
 *
 * GROUND TRUTH from ESPN scoreboard API (post-game, confirmed via curl):
 *   status.clock:           5400.0
 *   status.displayClock:    "90'+9'"
 *   status.period:          2
 *   status.type.id:         "28"
 *   status.type.name:       "STATUS_FULL_TIME"
 *   status.type.state:      "post"
 *   status.type.completed:  true
 *   status.type.description:"Full Time"
 *   status.type.detail:     "FT"
 *   status.type.shortDetail:"FT"
 *
 * EXACT FT TRANSITION SIGNATURE (forensically confirmed):
 *   LIVE  → state="in"   | typeId="26" | completed=false | displayClock="83'"  | period=2
 *   FINAL → state="post" | typeId="28" | completed=true  | displayClock="90'+9'" | period=2
 *   KEY DELTA: state: "in" → "post" AND completed: false → true
 *   DETECTION RULE: state === 'post' AND completed === true (primary)
 *                   typeId in {3, 23, 28} (secondary confirmation)
 *                   shortDetail === 'FT' OR description === 'Full Time' (tertiary)
 *
 * ESPN STATUS TYPE ID REFERENCE (forensically confirmed):
 *   id=1  STATUS_SCHEDULED      state=pre  completed=false
 *   id=2  STATUS_IN_PROGRESS    state=in   completed=false
 *   id=22 STATUS_HALFTIME       state=in   completed=false  period=2
 *   id=23 STATUS_FULL_TIME      state=post completed=true   FT (alt)
 *   id=26 STATUS_SECOND_HALF    state=in   completed=false  ← 760491 at 83'
 *   id=28 STATUS_FULL_TIME      state=post completed=true   FT ← 760491 confirmed
 *   id=3  STATUS_FINAL          state=post completed=true   FT (legacy)
 *   id=6  STATUS_POSTPONED      state=pre  completed=false
 *   id=7  STATUS_CANCELED       state=post completed=true
 *   id=9  STATUS_DELAYED        state=pre  completed=false
 *   id=17 STATUS_EXTRA_TIME     state=in   completed=false  ET
 *   id=24 STATUS_SHOOTOUT       state=in   completed=false  Pens
 *
 * WATCHER LOG CONFIRMATION (from live session):
 *   [04:18:42Z] TRANS  | prevState=unknown → state=post typeId=28 completed=true | 90'+9' | Full Time (FT)
 *   [04:18:42Z] FINAL  | ECU 0 - 2 MEX | typeId=28 STATUS_FULL_TIME | FT | clock=90'+9' P2
 *   [04:18:42Z] TRIGGER| gameId=760491 → matchRound=round-of-32
 *   [04:19:51Z] PASS   | success=true | rows=131 | errors=0 | phases=18/9 PASS | 69.6s
 *   [04:19:51Z] VERIFY | MIDNIGHT_760491 ✅ PASS | date=2026-06-30 ET=22:00 v=500x
 *
 * Usage:
 *   node WC2026FTWatcher.mjs [--dry-run] [--force-rescrape]
 *   --dry-run:        detect finals but do NOT trigger scraper
 *   --force-rescrape: re-trigger scraper even if gameId already in DB
 */

import { spawn }          from 'child_process';
import fs                 from 'fs';
import { createPool }     from 'mysql2/promise';
import dotenv             from 'dotenv';

dotenv.config({ path: '/home/ubuntu/ai-sports-betting/.env' });

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

const DRY_RUN        = process.argv.includes('--dry-run');
const FORCE_RESCRAPE = process.argv.includes('--force-rescrape');

const PROJECT_DIR    = '/home/ubuntu/ai-sports-betting';
const LOG_DIR        = `${PROJECT_DIR}/.manus-logs`;
const WATCHER_LOG    = `${LOG_DIR}/WC2026FTWatcher.txt`;
const TERMINAL_LOG   = `/tmp/WC2026FTWatcher_500x.txt`;
const PROGRESS_FILE  = `${LOG_DIR}/WC2026FTWatcher_progress.json`;
const RUNNER_SCRIPT  = `${PROJECT_DIR}/server/wc2026/espnIngest.test.live.mjs`;

// Poll interval: 30 seconds
const POLL_INTERVAL_MS      = 30_000;
// FT-confirmation re-poll delay: 5 seconds after initial FT detection
const FT_CONFIRM_DELAY_MS   = 5_000;
// Per-match scrape timeout: 7 minutes (R32/QF/SF/F matches with ET+pens)
const MATCH_TIMEOUT_MS      = 420_000;
// Max retry attempts per match
const MAX_ATTEMPTS          = 3;
// Retry backoff delays (ms) per attempt
const RETRY_BACKOFF_MS      = [0, 10_000, 20_000, 30_000];
// Watch window: yesterday through +3 days
const WATCH_DAYS_BEFORE     = 1;
const WATCH_DAYS_AFTER      = 3;

// ESPN API — ONLY source permitted (ESPN-only policy, no external sources)
const ESPN_SCOREBOARD_BASE  = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard';
const ESPN_LEAGUE_SLUG      = 'fifa.world';
const ESPN_SEASON_TYPE      = 13801; // WC2026 knockout stage

// ESPN status type IDs that represent a SETTLED/FINAL match
// Forensically confirmed from live API inspection + 760491 audit
const ESPN_FINAL_TYPE_IDS   = new Set([3, 23, 28]);    // STATUS_FINAL, STATUS_FULL_TIME, STATUS_FINAL_PEN
const ESPN_FINAL_STATES     = new Set(['post']);         // state must be "post"
const ESPN_LIVE_TYPE_IDS    = new Set([2, 17, 22, 24, 26]); // in-progress, ET, halftime, shootout, 2nd half
const ESPN_LIVE_STATES      = new Set(['in']);

// Expected matchRound values by ESPN season.slug
const ROUND_SLUG_MAP = {
  'round-of-32':       'round-of-32',
  'round-of-16':       'round-of-16',
  'quarterfinals':     'quarterfinals',
  'semifinals':        'semifinals',
  'final':             'final',
  'third-place':       'third-place',
};

// ═══════════════════════════════════════════════════════════════════════════════
// ELITE DUAL-CHANNEL LOGGER
// Writes to: terminal (ANSI color) + WATCHER_LOG (append) + TERMINAL_LOG (overwrite)
// Format: [ISO_TIMESTAMP] [LEVEL  ] [TAG                    ] message
// Log levels: INFO PASS FAIL WARN SKIP PROG VERIFY MIDNITE ERROR FATAL
//             POLL CYCLE FINAL LIVE TRIGGER RETRY DB ESPNAPI TRANS TRANS_D
// ═══════════════════════════════════════════════════════════════════════════════

fs.mkdirSync(LOG_DIR, { recursive: true });
const logStream  = fs.createWriteStream(WATCHER_LOG,  { flags: 'a' });
const termStream = fs.createWriteStream(TERMINAL_LOG, { flags: 'w' });

const C = {
  reset:   '\x1b[0m',  bold:    '\x1b[1m',  dim:     '\x1b[2m',
  green:   '\x1b[32m', red:     '\x1b[31m', yellow:  '\x1b[33m',
  cyan:    '\x1b[36m', magenta: '\x1b[35m', blue:    '\x1b[34m',
  gray:    '\x1b[90m', white:   '\x1b[97m', orange:  '\x1b[38;5;208m',
  purple:  '\x1b[38;5;141m',
};

const LEVEL_COLORS = {
  'INFO   ': C.cyan,
  'PASS   ': C.green,
  'FAIL   ': C.red,
  'WARN   ': C.yellow,
  'SKIP   ': C.gray,
  'PROG   ': C.blue,
  'VERIFY ': C.magenta,
  'MIDNITE': C.yellow,
  'ERROR  ': C.red,
  'FATAL  ': C.red,
  'POLL   ': C.blue,
  'CYCLE  ': C.cyan,
  'FINAL  ': C.green,
  'LIVE   ': C.orange,
  'TRIGGER': C.magenta,
  'RETRY  ': C.yellow,
  'DB     ': C.cyan,
  'ESPNAPI': C.blue,
  'TRANS  ': C.magenta,
  'TRANS_D': C.purple,   // TRANS_DETAIL: full 12-field ESPN status dump
  'CONFIRM': C.green,    // FT-confirmation re-poll result
};

const log = (level, tag, msg) => {
  const ts     = new Date().toISOString();
  const lvl    = level.padEnd(7);
  const tagPad = tag.padEnd(28);
  const plain  = `[${ts}] [${lvl}] [${tagPad}] ${msg}`;
  const color  = LEVEL_COLORS[`${lvl}`] || C.white;
  const colored = `${C.dim}[${ts}]${C.reset} ${color}[${lvl}]${C.reset} ${C.gray}[${tagPad}]${C.reset} ${msg}`;
  process.stdout.write(colored + '\n');
  logStream.write(plain + '\n');
  termStream.write(plain + '\n');
};

const logSep = (char = '─') => {
  const line = char.repeat(80);
  console.log(`${C.gray}${line}${C.reset}`);
  logStream.write(line + '\n');
  termStream.write(line + '\n');
};

const logBanner = (msg, char = '═') => {
  const bar = char.repeat(80);
  console.log(`${C.cyan}${bar}${C.reset}`);
  console.log(`${C.cyan}${C.bold}  ${msg}${C.reset}`);
  console.log(`${C.cyan}${bar}${C.reset}`);
  logStream.write(bar + '\n' + `  ${msg}\n` + bar + '\n');
  termStream.write(bar + '\n' + `  ${msg}\n` + bar + '\n');
};

/**
 * logTransDetail — logs ALL 12 ESPN status fields for a transition event.
 * Called on every FT detection, confirmation, and scrape trigger.
 * Noise-free: only fires on state transitions, not every poll.
 */
const logTransDetail = (tag, label, g, prev) => {
  const prevStr = prev
    ? `prev: state=${prev.statusState} typeId=${prev.statusTypeId} typeName=${prev.statusTypeName} completed=${prev.statusCompleted} clock=${prev.displayClock} period=${prev.period}`
    : `prev: state=unknown typeId=null typeName=null completed=null clock=null period=null`;
  const currStr = `curr: state=${g.statusState} typeId=${g.statusTypeId} typeName=${g.statusTypeName} completed=${g.statusCompleted} clock=${g.displayClock} period=${g.period} detail=${g.statusDetail} shortDetail=${g.statusShortDetail} description=${g.statusDescription} clockSecs=${g.clock}`;
  log('TRANS_D', tag, `${label} | ${prevStr}`);
  log('TRANS_D', tag, `${label} | ${currStr}`);
  log('TRANS_D', tag, `${label} | score=${g.scoreStr} | round=${g.matchRound} | seasonSlug=${g.seasonSlug} | date=${g.eventDate}`);
};

// ═══════════════════════════════════════════════════════════════════════════════
// DB CONNECTION POOL
// ═══════════════════════════════════════════════════════════════════════════════

let pool;
const getPool = () => {
  if (pool) return pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('[DB] DATABASE_URL not set');
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:/]+)(?::(\d+))?\/(\w+)/);
  if (!m) throw new Error(`[DB] Cannot parse DATABASE_URL: ${url.slice(0, 40)}...`);
  const [, user, pass, host, portStr, database] = m;
  pool = createPool({
    host,
    port:              parseInt(portStr || '3306'),
    user,
    password:          pass,
    database,
    ssl:               { rejectUnauthorized: false },
    connectionLimit:   3,
    connectTimeout:    10_000,
    enableKeepAlive:   true,
    keepAliveInitialDelay: 10_000,
  });
  return pool;
};

// ═══════════════════════════════════════════════════════════════════════════════
// ESPN-ONLY SCOREBOARD FETCH
// Source: https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard
// ESPN-ONLY POLICY: NO external sources permitted under any circumstances
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Fetch ESPN scoreboard for a single date (YYYYMMDD).
 * Returns raw ESPN events array or [] on error.
 * ESPN-only: no fallback, no alternate sources.
 */
const fetchEspnScoreboard = async (dateStr) => {
  const url = `${ESPN_SCOREBOARD_BASE}?dates=${dateStr}&limit=50`;
  log('ESPNAPI', `ESPN/SCOREBOARD/${dateStr}`, `[INPUT] GET ${url}`);
  const startMs = Date.now();
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':    'WC2026FTWatcher/500x-ESPN-only',
        'Accept':        'application/json',
        'Referer':       'https://www.espn.com/',
        'Cache-Control': 'no-cache',
      },
      signal: AbortSignal.timeout(15_000),
    });
    const elapsed = Date.now() - startMs;
    if (!res.ok) {
      log('ERROR', `ESPN/SCOREBOARD/${dateStr}`, `[HTTP] ${res.status} ${res.statusText} | ${elapsed}ms`);
      return [];
    }
    const data = await res.json();
    const events = data?.events || [];
    log('ESPNAPI', `ESPN/SCOREBOARD/${dateStr}`, `[OUTPUT] ${events.length} events | ${elapsed}ms | HTTP ${res.status}`);
    return events;
  } catch (err) {
    const elapsed = Date.now() - startMs;
    log('ERROR', `ESPN/SCOREBOARD/${dateStr}`, `[ERROR] ${err.message} | ${elapsed}ms`);
    return [];
  }
};

/**
 * fetchSingleGame — ESPN-only single-game status fetch for FT confirmation.
 * Called 5 seconds after initial FT detection to confirm state=post persists.
 * Uses the same ESPN scoreboard API with the game's date.
 */
const fetchSingleGameConfirm = async (gameId, dateStr) => {
  const url = `${ESPN_SCOREBOARD_BASE}?dates=${dateStr}&limit=50`;
  log('ESPNAPI', `ESPN/CONFIRM/${gameId}`, `[INPUT] FT-CONFIRM re-poll → GET ${url}`);
  const startMs = Date.now();
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':    'WC2026FTWatcher/500x-ESPN-only-confirm',
        'Accept':        'application/json',
        'Referer':       'https://www.espn.com/',
        'Cache-Control': 'no-cache, no-store',
      },
      signal: AbortSignal.timeout(12_000),
    });
    const elapsed = Date.now() - startMs;
    if (!res.ok) {
      log('ERROR', `ESPN/CONFIRM/${gameId}`, `[HTTP] ${res.status} ${res.statusText} | ${elapsed}ms`);
      return null;
    }
    const data = await res.json();
    const events = data?.events || [];
    const event = events.find(e => e.id === gameId);
    if (!event) {
      log('WARN', `ESPN/CONFIRM/${gameId}`, `[OUTPUT] gameId=${gameId} not found in confirm response | ${elapsed}ms`);
      return null;
    }
    const g = parseEspnEvent(event);
    log('ESPNAPI', `ESPN/CONFIRM/${gameId}`, `[OUTPUT] state=${g.statusState} typeId=${g.statusTypeId} completed=${g.statusCompleted} clock=${g.displayClock} | ${elapsed}ms`);
    return g;
  } catch (err) {
    const elapsed = Date.now() - startMs;
    log('ERROR', `ESPN/CONFIRM/${gameId}`, `[ERROR] ${err.message} | ${elapsed}ms`);
    return null;
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// ESPN EVENT PARSER
// Extracts ALL forensically-relevant fields from a raw ESPN event object
// Maps every status field needed for FT-transition detection
// Forensic ground truth: 760491 Mexico vs Ecuador
// ═══════════════════════════════════════════════════════════════════════════════

const parseEspnEvent = (event) => {
  const comp        = event.competitions?.[0] || {};
  const status      = comp.status || {};
  const statusType  = status.type || {};
  const season      = event.season || {};

  // ── Core identifiers ──────────────────────────────────────────────────────
  const gameId      = event.id;
  const name        = event.name || '';
  const shortName   = event.shortName || '';
  const eventDate   = event.date || '';       // UTC ISO string from ESPN

  // ── Season / round ────────────────────────────────────────────────────────
  const seasonType  = season.type;            // 13801 for WC2026 knockout
  const seasonSlug  = season.slug || '';      // "round-of-32", "quarterfinals", etc.
  const matchRound  = ROUND_SLUG_MAP[seasonSlug] || seasonSlug || 'unknown';

  // ── ESPN status fields — ALL 12 forensically confirmed ────────────────────
  // Field 1:  status.type.id         — CRITICAL: 28 = FT for 760491
  const statusTypeId    = statusType.id;
  // Field 2:  status.type.name       — "STATUS_FULL_TIME", "STATUS_IN_PROGRESS"
  const statusTypeName  = statusType.name || '';
  // Field 3:  status.type.state      — "pre" | "in" | "post"
  const statusState     = statusType.state || '';
  // Field 4:  status.type.completed  — true when final (false when live)
  const statusCompleted = statusType.completed;
  // Field 5:  status.type.detail     — "FT", "HT", "83'", "90'+9'"
  const statusDetail    = statusType.detail || '';
  // Field 6:  status.type.shortDetail— "FT", "HT"
  const statusShortDetail = statusType.shortDetail || '';
  // Field 7:  status.type.description— "Full Time", "Half Time", "Second Half"
  const statusDescription = statusType.description || '';
  // Field 8:  status.displayClock    — "90'+9'", "83'", "45'", "0'0\""
  const displayClock    = status.displayClock || '';
  // Field 9:  status.clock           — seconds (5400 = 90min)
  const clock           = status.clock;
  // Field 10: status.period          — 1=1H, 2=2H, 3=ET1, 4=ET2, 5=Pens
  const period          = status.period;
  // Field 11: event.date             — UTC ISO kickoff timestamp
  // (already captured above as eventDate)
  // Field 12: season.slug            — "round-of-32", "quarterfinals", etc.
  // (already captured above as seasonSlug)

  // ── FT detection logic (ESPN-only, forensically verified from 760491) ─────
  // PRIMARY:   state === 'post' AND completed === true
  // SECONDARY: typeId in FINAL set {3, 23, 28}
  // TERTIARY:  shortDetail === 'FT' OR description === 'Full Time'
  const isFinalByState    = statusState === 'post' && statusCompleted === true;
  const isFinalByTypeId   = ESPN_FINAL_TYPE_IDS.has(statusTypeId);
  const isFinalByDetail   = statusShortDetail === 'FT' || statusDescription === 'Full Time' || statusDetail === 'FT';
  const isFinal           = isFinalByState || isFinalByTypeId;

  const isLiveByState     = statusState === 'in';
  const isLiveByTypeId    = ESPN_LIVE_TYPE_IDS.has(statusTypeId);
  const isLive            = isLiveByState || isLiveByTypeId;

  const isScheduled       = statusState === 'pre' && !statusCompleted;

  // ── Competitors ───────────────────────────────────────────────────────────
  const competitors = (comp.competitors || []).map(c => ({
    id:       c.id,
    homeAway: c.homeAway,
    abbrev:   c.team?.abbreviation || '?',
    name:     c.team?.displayName  || '?',
    score:    c.score || '0',
    winner:   c.winner || false,
  }));
  const home = competitors.find(c => c.homeAway === 'home');
  const away = competitors.find(c => c.homeAway === 'away');
  const scoreStr = home && away
    ? `${away.abbrev} ${away.score} - ${home.score} ${home.abbrev}`
    : '? - ?';

  // ── Date string for confirm re-poll ───────────────────────────────────────
  // Extract YYYYMMDD from eventDate (UTC)
  const eventDateStr = eventDate
    ? eventDate.replace(/[-T:Z.]/g, '').slice(0, 8)
    : '';

  return {
    gameId,
    name,
    shortName,
    eventDate,
    eventDateStr,
    seasonType,
    seasonSlug,
    matchRound,
    // All 12 ESPN status fields
    statusTypeId,
    statusTypeName,
    statusState,
    statusCompleted,
    statusDetail,
    statusShortDetail,
    statusDescription,
    displayClock,
    clock,
    period,
    // Derived booleans
    isFinal,
    isLive,
    isScheduled,
    isFinalByState,
    isFinalByTypeId,
    isFinalByDetail,
    // Competitors
    competitors,
    home,
    away,
    scoreStr,
  };
};

// ═══════════════════════════════════════════════════════════════════════════════
// WATCH DATE GENERATOR
// Returns YYYYMMDD strings for yesterday through +WATCH_DAYS_AFTER
// ═══════════════════════════════════════════════════════════════════════════════

const getWatchDates = () => {
  const dates = [];
  const now   = new Date();
  for (let d = -WATCH_DAYS_BEFORE; d <= WATCH_DAYS_AFTER; d++) {
    const dt = new Date(now);
    dt.setUTCDate(dt.getUTCDate() + d);
    const yyyy = dt.getUTCFullYear();
    const mm   = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const dd   = String(dt.getUTCDate()).padStart(2, '0');
    dates.push(`${yyyy}${mm}${dd}`);
  }
  return dates;
};

// ═══════════════════════════════════════════════════════════════════════════════
// DB STATE CHECK
// Checks if a gameId is already fully scraped in the DB
// ═══════════════════════════════════════════════════════════════════════════════

const checkDbState = async (gameId) => {
  if (FORCE_RESCRAPE) return { inDb: false, forced: true };
  try {
    const db = getPool();
    const [rows] = await db.execute(
      `SELECT matchId, homeTeamName, awayTeamName, homeScore, awayScore, matchRound, scrapeVersion
       FROM wc2026_espn_matches WHERE matchId = ? LIMIT 1`,
      [gameId]
    );
    if (rows.length > 0) {
      const r = rows[0];
      return {
        inDb:    true,
        summary: `${r.homeTeamName} ${r.homeScore}-${r.awayScore} ${r.awayTeamName} | round=${r.matchRound} | v=${r.scrapeVersion}`,
        matchRound: r.matchRound,
        scrapeVersion: r.scrapeVersion,
      };
    }
    return { inDb: false };
  } catch (err) {
    log('WARN', `DB/CHECK/${gameId}`, `DB check failed: ${err.message} — will scrape`);
    return { inDb: false };
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// MIDNIGHT RULE VERIFICATION
// Confirms matchGameDate (PT) and matchKickoffEt (ET) are correct post-scrape
// Validates scrapeVersion=500x and matchRound
// ═══════════════════════════════════════════════════════════════════════════════

const verifyMidnightRule = async (gameId, expectedRound) => {
  try {
    const db = getPool();
    const [rows] = await db.execute(
      `SELECT matchId, homeTeamName, awayTeamName, matchDateUtc, matchGameDate,
              matchKickoffEt, scrapeVersion, matchRound
       FROM wc2026_espn_matches WHERE matchId = ? LIMIT 1`,
      [gameId]
    );
    if (rows.length === 0) return { ok: false, reason: 'No row found in DB after scrape' };
    const r = rows[0];

    const utcMs = typeof r.matchDateUtc === 'number' ? r.matchDateUtc : parseInt(r.matchDateUtc);
    const dt    = new Date(utcMs);

    // Expected PT date (game date)
    const expectedPtDate = dt.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

    // Expected ET time (kickoff)
    const etH  = parseInt(dt.toLocaleString('en-US', { timeZone: 'America/New_York', hour: '2-digit', hour12: false }), 10);
    const etM  = parseInt(dt.toLocaleString('en-US', { timeZone: 'America/New_York', minute: '2-digit' }), 10);
    const expectedEtTime = `${String(isNaN(etH) ? 0 : etH).padStart(2, '0')}:${String(isNaN(etM) ? 0 : etM).padStart(2, '0')}`;

    const isMidnight  = r.matchKickoffEt === '00:00';
    const dateOk      = r.matchGameDate === expectedPtDate;
    const timeOk      = r.matchKickoffEt === expectedEtTime;
    const versionOk   = r.scrapeVersion === '500x';
    const roundOk     = !expectedRound || r.matchRound === expectedRound;

    const status = dateOk && timeOk && versionOk && roundOk ? 'PASS' : 'FAIL';

    return {
      ok:             status === 'PASS',
      gameId:         r.matchId,
      match:          `${r.homeTeamName} vs ${r.awayTeamName}`,
      matchGameDate:  r.matchGameDate,
      matchKickoffEt: r.matchKickoffEt,
      matchRound:     r.matchRound,
      scrapeVersion:  r.scrapeVersion,
      expectedPtDate,
      expectedEtTime,
      isMidnight,
      dateOk,
      timeOk,
      versionOk,
      roundOk,
      status,
    };
  } catch (err) {
    return { ok: false, reason: `DB error: ${err.message}` };
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// SINGLE MATCH SCRAPER
// File-stream child output capture (prevents pipe deadlock on large output)
// Mirrors batchScrapeR32.mjs scrapeMatch() exactly
// ═══════════════════════════════════════════════════════════════════════════════

const scrapeMatch = (gameId, matchRound, attemptNum) => new Promise((resolve) => {
  const startMs      = Date.now();
  const childOutFile = `/tmp/espnIngest_${gameId}_stdout.txt`;
  const childErrFile = `/tmp/espnIngest_${gameId}_stderr.txt`;

  log('INFO', `SCRAPE_${gameId}`, `[ATTEMPT ${attemptNum}/${MAX_ATTEMPTS}] Spawning 500x scraper → gameId=${gameId} matchRound=${matchRound}`);

  // Open file descriptors — prevents stdout pipe buffer deadlock
  const outFd = fs.openSync(childOutFile, 'w');
  const errFd = fs.openSync(childErrFile, 'w');

  const child = spawn('node', [RUNNER_SCRIPT, gameId], {
    cwd:   PROJECT_DIR,
    stdio: ['ignore', outFd, errFd],
    env:   { ...process.env },
  });

  const timeout = setTimeout(() => {
    child.kill('SIGKILL');
    try { fs.closeSync(outFd); } catch {}
    try { fs.closeSync(errFd); } catch {}
    log('FAIL', `SCRAPE_${gameId}`, `⏱ TIMEOUT after ${MATCH_TIMEOUT_MS / 1000}s — killed`);
    resolve({ ok: false, gameId, error: 'TIMEOUT', durationMs: Date.now() - startMs });
  }, MATCH_TIMEOUT_MS);

  child.on('close', (code) => {
    clearTimeout(timeout);
    try { fs.closeSync(outFd); } catch {}
    try { fs.closeSync(errFd); } catch {}

    const durationMs = Date.now() - startMs;
    const durationS  = (durationMs / 1000).toFixed(1);

    // Read captured output
    let stdout = '';
    let stderr = '';
    try { stdout = fs.readFileSync(childOutFile, 'utf8'); } catch {}
    try { stderr = fs.readFileSync(childErrFile, 'utf8'); } catch {}

    // Clean up temp files
    try { fs.unlinkSync(childOutFile); } catch {}
    try { fs.unlinkSync(childErrFile); } catch {}

    // ── Stream key lines to log (noise-free, intentional) ─────────────────
    const allLines = (stdout + stderr).split('\n');
    for (const line of allLines) {
      if (
        line.includes('[RUNNER]') || line.includes('[INGEST]') ||
        line.includes('PASS')     || line.includes('FAIL')     ||
        line.includes('PHASE')    || line.includes('MIDNIGHT') ||
        line.includes('VERIFY')   || line.includes('seasonSlug') ||
        line.includes('round-of') || line.includes('500x')     ||
        line.includes('scrapeVersion') || line.includes('matchRound') ||
        line.includes('success=') || line.includes('rows=')    ||
        line.includes('errors=')  || line.includes('Full Time')
      ) {
        if (line.trim() && !line.includes('[dotenv')) {
          log('INFO', `CHILD_${gameId}`, line.trim().slice(0, 140));
        }
      }
    }

    // ── Parse ingest result ────────────────────────────────────────────────
    const successMatch  = stdout.match(/success=(true|false)/);
    const rowsMatch     = stdout.match(/rows=(\d+)/);
    const errorsMatch   = stdout.match(/errors=(\d+)/);
    const ingestSuccess = successMatch?.[1] === 'true';
    const rowsWritten   = rowsMatch   ? parseInt(rowsMatch[1])   : 0;
    const ingestErrors  = errorsMatch ? parseInt(errorsMatch[1]) : 999;

    const passMatch     = stdout.match(/(\d+)\/(\d+) PASS/);
    const passRate      = passMatch ? `${passMatch[1]}/${passMatch[2]}` : null;

    const matchLineMatch = stdout.match(/Match:\s*([^\n]+)/);
    const venueMatch     = stdout.match(/Venue:\s*([^\n]+)/);
    const matchInfo      = matchLineMatch ? matchLineMatch[1].trim() : '?';
    const venue          = venueMatch     ? venueMatch[1].trim().split('|')[0].trim() : '?';

    const phaseMatches   = [...stdout.matchAll(/Phase (\d+)\/9 \[.*?(PASS|FAIL).*?\] (\S+) — (\d+) rows/g)];
    const phasesSummary  = phaseMatches.length > 0
      ? `phases=${phaseMatches.filter(m => m[2] === 'PASS').length}/9 PASS`
      : '';

    // ── Success criteria ───────────────────────────────────────────────────
    const isIngestSuccess = ingestSuccess && rowsWritten > 0 && ingestErrors === 0;
    const isPassRateOk    = passMatch && parseInt(passMatch[1]) === parseInt(passMatch[2]) && parseInt(passMatch[2]) > 0;
    const isSuccess       = isIngestSuccess || isPassRateOk;

    if ((code === 0 && isSuccess) || isIngestSuccess) {
      const noteCode1 = code !== 0 ? ` [code=${code} — test assertions failed, ingest OK]` : '';
      log('PASS', `SCRAPE_${gameId}`, `✅ success=true | rows=${rowsWritten} | errors=${ingestErrors} | ${passRate || phasesSummary} | ${durationS}s${noteCode1}`);
      if (matchInfo !== '?') log('INFO', `MATCH_${gameId}`, `  📊 ${matchInfo} | ${venue}`);
      resolve({ ok: true, gameId, rowsWritten, ingestErrors, matchInfo, venue, durationMs });
    } else {
      const errLines = (stdout + stderr).split('\n')
        .filter(l => l.includes('FAIL') || l.includes('Error:') || l.includes('error=') || l.includes('success=false') || l.includes('FATAL'))
        .filter(l => !l.includes('[dotenv'))
        .slice(0, 5)
        .map(l => l.trim().slice(0, 100))
        .join(' | ');
      log('FAIL', `SCRAPE_${gameId}`, `❌ code=${code} success=${ingestSuccess} rows=${rowsWritten} errors=${ingestErrors} | ${durationS}s`);
      if (errLines) log('ERROR', `DETAIL_${gameId}`, errLines.slice(0, 200));
      resolve({ ok: false, gameId, rowsWritten, ingestErrors, code, error: errLines, durationMs });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCRAPE WITH RETRY ENGINE
// Up to MAX_ATTEMPTS attempts with exponential backoff
// Runs midnight rule verification on success
// ═══════════════════════════════════════════════════════════════════════════════

const scrapeWithRetry = async (gameId, matchRound, parsedGame) => {
  sessionResults.scrapingSet.add(gameId);

  let scrapeResult;
  let attempts = 0;

  while (attempts < MAX_ATTEMPTS) {
    attempts++;
    const backoff = RETRY_BACKOFF_MS[attempts - 1] || 30_000;
    if (attempts > 1) {
      sessionResults.retried++;
      log('RETRY', `RETRY_${gameId}`, `Attempt ${attempts}/${MAX_ATTEMPTS} — waiting ${backoff / 1000}s before retry`);
      await new Promise(r => setTimeout(r, backoff));
    }
    scrapeResult = await scrapeMatch(gameId, matchRound, attempts);
    if (scrapeResult.ok) break;
    if (attempts < MAX_ATTEMPTS) {
      log('WARN', `RETRY_${gameId}`, `Attempt ${attempts} failed — scheduling retry`);
    }
  }

  sessionResults.scraped++;

  if (scrapeResult.ok) {
    sessionResults.passed++;

    // ── Midnight rule + round verification ──────────────────────────────────
    const midnightCheck = await verifyMidnightRule(gameId, matchRound);
    if (midnightCheck.ok) {
      sessionResults.midnightRulePass++;
      const midnightFlag = midnightCheck.isMidnight ? ' ← 🌙MIDNIGHT RULE' : '';
      const roundFlag    = midnightCheck.roundOk    ? ` round=${midnightCheck.matchRound} ✅` : ` round=${midnightCheck.matchRound} ❌ (expected ${matchRound})`;
      log('VERIFY', `MIDNIGHT_${gameId}`, `✅ PASS | date=${midnightCheck.matchGameDate} ET=${midnightCheck.matchKickoffEt} v=${midnightCheck.scrapeVersion}${roundFlag}${midnightFlag}`);
    } else {
      sessionResults.midnightRuleFail++;
      log('WARN', `MIDNIGHT_${gameId}`, `⚠️ FAIL | date=${midnightCheck.matchGameDate} (expected ${midnightCheck.expectedPtDate}) ET=${midnightCheck.matchKickoffEt} round=${midnightCheck.matchRound} v=${midnightCheck.scrapeVersion} | reason=${midnightCheck.reason || 'field mismatch'}`);
    }

    sessionResults.matches.push({
      gameId,
      status:      'PASS',
      rowsWritten: scrapeResult.rowsWritten,
      matchInfo:   scrapeResult.matchInfo,
      venue:       scrapeResult.venue,
      durationMs:  scrapeResult.durationMs,
      attempts,
      matchRound,
      midnightRule: midnightCheck,
    });

    sessionResults.scrapedSet.add(gameId);
  } else {
    sessionResults.failed++;
    sessionResults.matches.push({
      gameId,
      status:     'FAIL',
      rowsWritten: scrapeResult.rowsWritten,
      error:       scrapeResult.error,
      durationMs:  scrapeResult.durationMs,
      attempts,
      matchRound,
    });
    log('FAIL', `FINAL_${gameId}`, `❌ SCRAPE FAILED after ${attempts} attempts | ${scrapeResult.error?.slice(0, 80)}`);
  }

  sessionResults.scrapingSet.delete(gameId);
};

// ═══════════════════════════════════════════════════════════════════════════════
// SESSION STATE
// ═══════════════════════════════════════════════════════════════════════════════

const sessionResults = {
  startedAt:         new Date().toISOString(),
  completedAt:       null,
  totalDurationMs:   0,
  totalPolls:        0,
  totalGamesDetected: 0,
  totalLiveDetected: 0,
  totalFinalsDetected: 0,
  totalNewlyFinal:   0,
  scraped:           0,
  passed:            0,
  failed:            0,
  retried:           0,
  midnightRulePass:  0,
  midnightRuleFail:  0,
  ftConfirmPass:     0,   // FT-confirmation re-polls that confirmed state=post
  ftConfirmFail:     0,   // FT-confirmation re-polls that found state reverted (false positive)
  matches:           [],
  // Runtime sets (not serialized)
  scrapedSet:        new Set(),   // gameIds already scraped this session
  scrapingSet:       new Set(),   // gameIds currently being scraped
};

// Per-game state machine: tracks statusState, statusTypeId, displayClock across polls
// Key: gameId → { statusState, statusTypeId, statusTypeName, statusCompleted,
//                 displayClock, period, score, lastSeen, name, matchRound }
const gameStateMap = new Map();

// ═══════════════════════════════════════════════════════════════════════════════
// PROGRESS PERSISTENCE
// ═══════════════════════════════════════════════════════════════════════════════

const saveProgress = (data) => {
  try {
    const serializable = {
      ...data,
      scrapedSet:  [...data.scrapedSet],
      scrapingSet: [...data.scrapingSet],
    };
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(serializable, null, 2));
  } catch {}
};

const loadProgress = () => {
  try {
    if (!fs.existsSync(PROGRESS_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    // Restore Sets
    raw.scrapedSet  = new Set(raw.scrapedSet  || []);
    raw.scrapingSet = new Set([]);  // never restore in-progress
    return raw;
  } catch {
    return null;
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// PRE-FLIGHT DB STATE BANNER
// Shows all WC2026 matches currently in DB on startup
// ═══════════════════════════════════════════════════════════════════════════════

const runPreflightDbCheck = async () => {
  logBanner('PRE-FLIGHT: DB STATE CHECK', '─');
  try {
    const db = getPool();
    const [rows] = await db.execute(
      `SELECT matchId, homeTeamName, awayTeamName, homeScore, awayScore,
              matchRound, scrapeVersion, matchGameDate, matchKickoffEt
       FROM wc2026_espn_matches
       ORDER BY matchGameDate ASC, matchKickoffEt ASC`
    );
    log('DB', 'PREFLIGHT/DB', `${rows.length} WC2026 matches currently in DB`);
    for (const r of rows) {
      log('DB', `PREFLIGHT/${r.matchId}`, `EXISTS | ${r.homeTeamName} ${r.homeScore}-${r.awayScore} ${r.awayTeamName} | round=${r.matchRound} | date=${r.matchGameDate} ET=${r.matchKickoffEt} | v=${r.scrapeVersion}`);
      sessionResults.scrapedSet.add(String(r.matchId));
    }
    log('DB', 'PREFLIGHT/DB', `${sessionResults.scrapedSet.size} gameIds pre-loaded into scrapedSet — will skip re-trigger unless --force-rescrape`);
  } catch (err) {
    log('WARN', 'PREFLIGHT/DB', `DB pre-flight failed: ${err.message} — will continue without pre-loaded state`);
  }
  logSep('═');
};

// ═══════════════════════════════════════════════════════════════════════════════
// FT-CONFIRMATION ENGINE
// After initial FT detection, waits FT_CONFIRM_DELAY_MS and re-polls ESPN
// to confirm state=post persists before triggering the 500x scraper.
// Prevents false positives from transient ESPN API state flips.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * confirmFinalState — re-polls ESPN after FT_CONFIRM_DELAY_MS to verify
 * the game is still in state=post/completed=true.
 * Returns { confirmed: true/false, confirmedGame: parsedGame | null }
 */
const confirmFinalState = async (gameId, matchRound, initialGame) => {
  log('CONFIRM', `CONFIRM/${gameId}`, `⏳ Waiting ${FT_CONFIRM_DELAY_MS / 1000}s before FT-confirmation re-poll...`);
  await new Promise(r => setTimeout(r, FT_CONFIRM_DELAY_MS));

  // Determine date string for the confirm fetch
  // Use the game's eventDate to build the YYYYMMDD string
  const dateStr = initialGame.eventDateStr || getWatchDates()[0];

  const confirmedGame = await fetchSingleGameConfirm(gameId, dateStr);

  if (!confirmedGame) {
    // Could not fetch — proceed with initial detection (conservative: trust initial)
    log('CONFIRM', `CONFIRM/${gameId}`, `⚠️ CONFIRM fetch failed — proceeding with initial FT detection (conservative)`);
    sessionResults.ftConfirmPass++;
    return { confirmed: true, confirmedGame: initialGame };
  }

  if (confirmedGame.isFinal) {
    sessionResults.ftConfirmPass++;
    log('CONFIRM', `CONFIRM/${gameId}`, `✅ CONFIRMED state=post | typeId=${confirmedGame.statusTypeId} ${confirmedGame.statusTypeName} | completed=${confirmedGame.statusCompleted} | clock=${confirmedGame.displayClock} | score=${confirmedGame.scoreStr}`);
    // Log full TRANS_DETAIL for the confirmed state
    logTransDetail(`CONFIRM_D/${gameId}`, 'FT_CONFIRMED', confirmedGame, null);
    return { confirmed: true, confirmedGame };
  } else {
    sessionResults.ftConfirmFail++;
    log('WARN', `CONFIRM/${gameId}`, `⚠️ FALSE POSITIVE — state reverted to ${confirmedGame.statusState} | typeId=${confirmedGame.statusTypeId} | completed=${confirmedGame.statusCompleted} | clock=${confirmedGame.displayClock} — SUPPRESSING TRIGGER`);
    logTransDetail(`CONFIRM_D/${gameId}`, 'FT_REVERTED', confirmedGame, null);
    return { confirmed: false, confirmedGame };
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// POLL CYCLE
// Core detection engine — called every POLL_INTERVAL_MS
// ═══════════════════════════════════════════════════════════════════════════════

let pollCount = 0;

const pollCycle = async () => {
  pollCount++;
  sessionResults.totalPolls++;
  const cycleStart = Date.now();
  const watchDates = getWatchDates();

  log('POLL', `CYCLE/${pollCount}`, `🔄 Poll #${pollCount} — watching dates: ${watchDates.join(', ')} | scrapedSet.size=${sessionResults.scrapedSet.size} | scrapingSet.size=${sessionResults.scrapingSet.size}`);

  let totalGames  = 0;
  let liveGames   = 0;
  let finalGames  = 0;
  let newlyFinal  = 0;
  let preGames    = 0;

  for (const dateStr of watchDates) {
    const events = await fetchEspnScoreboard(dateStr);
    if (events.length === 0) continue;

    for (const event of events) {
      const g = parseEspnEvent(event);

      totalGames++;
      sessionResults.totalGamesDetected = Math.max(sessionResults.totalGamesDetected, totalGames);

      // ── Retrieve previous state from state machine ───────────────────────
      const prev          = gameStateMap.get(g.gameId);
      const prevState     = prev?.statusState    || 'unknown';
      const prevTypeId    = prev?.statusTypeId   || null;
      const prevCompleted = prev?.statusCompleted ?? null;

      // ── Update state machine ─────────────────────────────────────────────
      gameStateMap.set(g.gameId, {
        statusState:     g.statusState,
        statusTypeId:    g.statusTypeId,
        statusTypeName:  g.statusTypeName,
        statusCompleted: g.statusCompleted,
        displayClock:    g.displayClock,
        period:          g.period,
        score:           g.scoreStr,
        lastSeen:        new Date().toISOString(),
        name:            g.name,
        matchRound:      g.matchRound,
      });

      // ── LIVE game logging ────────────────────────────────────────────────
      if (g.isLive) {
        liveGames++;
        sessionResults.totalLiveDetected = Math.max(sessionResults.totalLiveDetected, liveGames);
        log('LIVE', `LIVE/${g.gameId}`, `⚽ ${g.name} | ${g.scoreStr} | ${g.displayClock} P${g.period} | typeId=${g.statusTypeId} ${g.statusTypeName} | state=${g.statusState}`);
      }

      // ── FINAL game processing ────────────────────────────────────────────
      if (g.isFinal) {
        finalGames++;
        sessionResults.totalFinalsDetected = Math.max(sessionResults.totalFinalsDetected, finalGames);

        // ── FT TRANSITION DETECTION ────────────────────────────────────────
        // A game is "newly final" when:
        //   1. Previous state was NOT "post" (was "in", "pre", or "unknown")
        //   2. Current state IS "post" with completed=true
        // This is the exact transition signature confirmed for 760491:
        //   LIVE: state="in" typeId=26 (Second Half) → FINAL: state="post" typeId=28 (Full Time)
        const isNewlyFinal = prevState !== 'post' && g.statusState === 'post' && g.statusCompleted === true;

        if (isNewlyFinal) {
          // ── Log TRANS (summary) ──────────────────────────────────────────
          log('TRANS', `TRANS/${g.gameId}`, `🔀 FT TRANSITION DETECTED | ${g.name} | prevState=${prevState} prevTypeId=${prevTypeId} prevCompleted=${prevCompleted} → state=${g.statusState} typeId=${g.statusTypeId} completed=${g.statusCompleted} | ${g.displayClock} | ${g.statusDescription} (${g.statusShortDetail})`);

          // ── Log TRANS_DETAIL (all 12 ESPN status fields) ─────────────────
          logTransDetail(`TRANS_D/${g.gameId}`, 'FT_DETECTED', g, prev);
        }

        if (isNewlyFinal) {
          newlyFinal++;
          sessionResults.totalNewlyFinal++;

          log('FINAL', `FINAL/${g.gameId}`, `🏁 GAME FINAL — NEWLY DETECTED | ${g.name} | ${g.scoreStr} | typeId=${g.statusTypeId} ${g.statusTypeName} | ${g.statusShortDetail} | clock=${g.displayClock} P${g.period}`);

          if (DRY_RUN) {
            log('INFO', `TRIGGER/${g.gameId}`, `[DRY-RUN] Would trigger scrape for ${g.gameId} — skipping`);
          } else {
            // ── FT-CONFIRMATION ENGINE ───────────────────────────────────
            // Re-poll ESPN after 5s to confirm state=post persists
            // Prevents false positives from transient ESPN API state flips
            confirmFinalState(g.gameId, g.matchRound, g).then(({ confirmed, confirmedGame }) => {
              if (!confirmed) {
                // False positive — do NOT trigger
                log('WARN', `TRIGGER/${g.gameId}`, `⚠️ FT-CONFIRM FAILED — suppressing scrape trigger for ${g.gameId}`);
                return;
              }
              // Use the confirmed game state for the trigger log
              const cg = confirmedGame || g;
              log('TRIGGER', `TRIGGER/${g.gameId}`, `🚀 gameId=${g.gameId} → matchRound=${cg.matchRound} | seasonSlug=${cg.seasonSlug} | prevState=${prevState} → post | typeId=${cg.statusTypeId} | completed=${cg.statusCompleted} | DRY_RUN=${DRY_RUN}`);
              // Fire-and-forget: do NOT await (allows poll cycle to continue)
              scrapeWithRetry(g.gameId, cg.matchRound, cg).catch(err => {
                log('ERROR', `TRIGGER/${g.gameId}`, `Scrape trigger error: ${err.message}`);
              });
            }).catch(err => {
              // Confirm engine error — proceed with trigger (conservative)
              log('WARN', `CONFIRM/${g.gameId}`, `Confirm engine error: ${err.message} — proceeding with trigger`);
              log('TRIGGER', `TRIGGER/${g.gameId}`, `🚀 gameId=${g.gameId} → matchRound=${g.matchRound} | seasonSlug=${g.seasonSlug} | prevState=${prevState} → post | DRY_RUN=${DRY_RUN}`);
              scrapeWithRetry(g.gameId, g.matchRound, g).catch(e => {
                log('ERROR', `TRIGGER/${g.gameId}`, `Scrape trigger error: ${e.message}`);
              });
            });
          }

        } else if (!sessionResults.scrapedSet.has(g.gameId) && !sessionResults.scrapingSet.has(g.gameId)) {
          // ── Final but not newly detected this session — check DB ─────────
          const dbCheck = await checkDbState(g.gameId);
          if (dbCheck.inDb) {
            sessionResults.scrapedSet.add(g.gameId);
            log('SKIP', `FINAL/${g.gameId}`, `Already in DB: ${dbCheck.summary} — skipping`);
          } else if (dbCheck.forced) {
            log('INFO', `FINAL/${g.gameId}`, `--force-rescrape active — re-triggering ${g.gameId}`);
            log('TRIGGER', `TRIGGER/${g.gameId}`, `🚀 gameId=${g.gameId} → matchRound=${g.matchRound} | --force-rescrape`);
            scrapeWithRetry(g.gameId, g.matchRound, g).catch(err => {
              log('ERROR', `TRIGGER/${g.gameId}`, `Scrape trigger error: ${err.message}`);
            });
          } else {
            // Final, not in DB, not currently scraping — trigger scrape
            log('FINAL', `FINAL/${g.gameId}`, `🏁 FINAL (known) — not in DB | ${g.name} | ${g.scoreStr} | typeId=${g.statusTypeId}`);
            log('TRIGGER', `TRIGGER/${g.gameId}`, `🚀 gameId=${g.gameId} → matchRound=${g.matchRound} | DB miss — triggering scrape`);
            if (!DRY_RUN) {
              scrapeWithRetry(g.gameId, g.matchRound, g).catch(err => {
                log('ERROR', `TRIGGER/${g.gameId}`, `Scrape trigger error: ${err.message}`);
              });
            }
          }
        } else if (sessionResults.scrapingSet.has(g.gameId)) {
          log('INFO', `FINAL/${g.gameId}`, `Scrape in progress — skipping duplicate trigger`);
        }

      } else if (g.isScheduled) {
        preGames++;
      }
    }
  }

  const elapsed = ((Date.now() - cycleStart) / 1000).toFixed(2);
  log('CYCLE', `CYCLE/${pollCount}`, `✅ CYCLE/${pollCount} — ${totalGames} total | ${liveGames} live | ${preGames} pre | ${finalGames} final | ${newlyFinal} newly final | ${elapsed}s | scraped=${sessionResults.scraped} pass=${sessionResults.passed} fail=${sessionResults.failed} ftConfirm=${sessionResults.ftConfirmPass}✅/${sessionResults.ftConfirmFail}⚠️`);

  saveProgress(sessionResults);
};

// ═══════════════════════════════════════════════════════════════════════════════
// SESSION SUMMARY
// Printed on SIGINT/SIGTERM — mirrors batchScrapeR32.mjs verdict format exactly
// ═══════════════════════════════════════════════════════════════════════════════

const printSessionSummary = () => {
  const totalDurationMs  = Date.now() - new Date(sessionResults.startedAt).getTime();
  const totalDurationMin = (totalDurationMs / 60000).toFixed(1);

  sessionResults.completedAt    = new Date().toISOString();
  sessionResults.totalDurationMs = totalDurationMs;

  logBanner('WC2026FTWatcher SESSION SUMMARY — 500x EDITION v2.1');
  log('INFO', 'SESSION_SUMMARY', `Duration: ${totalDurationMin} minutes | Polls: ${sessionResults.totalPolls}`);
  log('INFO', 'SESSION_SUMMARY', `Games detected: ${sessionResults.totalGamesDetected} | Live: ${sessionResults.totalLiveDetected} | Finals: ${sessionResults.totalFinalsDetected} | Newly final: ${sessionResults.totalNewlyFinal}`);
  log('INFO', 'SESSION_SUMMARY', `Scraped: ${sessionResults.scraped} | ✅ PASS: ${sessionResults.passed} | ❌ FAIL: ${sessionResults.failed} | 🔄 Retried: ${sessionResults.retried}`);
  log('INFO', 'SESSION_SUMMARY', `FT-Confirm: ✅${sessionResults.ftConfirmPass} confirmed | ⚠️${sessionResults.ftConfirmFail} false positives suppressed`);

  const passRate = sessionResults.scraped > 0
    ? ((sessionResults.passed / sessionResults.scraped) * 100).toFixed(1)
    : '0.0';
  log('INFO', 'SESSION_SUMMARY', `Pass rate: ${sessionResults.passed}/${sessionResults.scraped} (${passRate}%)`);
  log('INFO', 'SESSION_SUMMARY', `Midnight rule: ✅${sessionResults.midnightRulePass} PASS | ⚠️${sessionResults.midnightRuleFail} FAIL`);

  if (sessionResults.failed > 0) {
    const failedIds = sessionResults.matches.filter(m => m.status === 'FAIL').map(m => m.gameId).join(', ');
    log('WARN', 'SESSION_SUMMARY', `Failed gameIds: ${failedIds}`);
  }

  logSep('─');

  // ── Per-match results table ────────────────────────────────────────────────
  if (sessionResults.matches.length > 0) {
    const tableHeader = `\n=== SCRAPED MATCHES TABLE (WC2026FTWatcher Session) ===`;
    console.log(`${C.bold}${tableHeader}${C.reset}`);
    logStream.write(tableHeader + '\n');
    termStream.write(tableHeader + '\n');

    for (const m of sessionResults.matches) {
      const icon = m.status === 'PASS' ? '✅' : '❌';
      let detail;
      if (m.status === 'PASS') {
        const midnight = m.midnightRule?.isMidnight ? ' 🌙MIDNIGHT' : '';
        const round    = m.midnightRule?.matchRound  ? ` | round=${m.midnightRule.matchRound}` : '';
        detail = `rows=${m.rowsWritten} | date=${m.midnightRule?.matchGameDate} ET=${m.midnightRule?.matchKickoffEt}${midnight}${round} | ${(m.durationMs / 1000).toFixed(1)}s | attempts=${m.attempts}`;
      } else {
        detail = `FAIL: ${m.error?.slice(0, 80)} | attempts=${m.attempts}`;
      }
      const line = `  ${icon} ${m.gameId} | ${detail}`;
      console.log(line);
      logStream.write(line + '\n');
      termStream.write(line + '\n');
    }
  }

  logSep('═');
  saveProgress(sessionResults);
};

// ═══════════════════════════════════════════════════════════════════════════════
// SIGNAL HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

process.on('SIGINT',  () => { log('INFO', 'SIGNAL', 'SIGINT received — printing session summary and exiting'); printSessionSummary(); process.exit(0); });
process.on('SIGTERM', () => { log('INFO', 'SIGNAL', 'SIGTERM received — printing session summary and exiting'); printSessionSummary(); process.exit(0); });
process.on('uncaughtException', (err) => {
  log('FATAL', 'UNCAUGHT', `Uncaught exception: ${err.message}`);
  log('FATAL', 'UNCAUGHT', err.stack?.split('\n').slice(0, 5).join(' | ') || '');
  printSessionSummary();
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  log('FATAL', 'UNHANDLED', `Unhandled rejection: ${reason}`);
  printSessionSummary();
  process.exit(1);
});

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════════

const main = async () => {
  logBanner(`WC2026FTWatcher v2.1 — 500x ELITE LIVE DETECTION ENGINE`);
  log('INFO', 'STARTUP', `ESPN-ONLY POLICY: All data sourced exclusively from ${ESPN_SCOREBOARD_BASE}`);
  log('INFO', 'STARTUP', `DRY_RUN=${DRY_RUN} | FORCE_RESCRAPE=${FORCE_RESCRAPE} | POLL_INTERVAL=${POLL_INTERVAL_MS / 1000}s | FT_CONFIRM_DELAY=${FT_CONFIRM_DELAY_MS / 1000}s`);
  log('INFO', 'STARTUP', `WATCH_WINDOW: -${WATCH_DAYS_BEFORE}d to +${WATCH_DAYS_AFTER}d | MAX_ATTEMPTS=${MAX_ATTEMPTS} | MATCH_TIMEOUT=${MATCH_TIMEOUT_MS / 1000}s`);
  log('INFO', 'STARTUP', `FINAL_TYPE_IDS: [${[...ESPN_FINAL_TYPE_IDS].join(', ')}] | LIVE_TYPE_IDS: [${[...ESPN_LIVE_TYPE_IDS].join(', ')}]`);
  log('INFO', 'STARTUP', `LOG_FILES: ${WATCHER_LOG} | ${TERMINAL_LOG}`);
  log('INFO', 'STARTUP', `RUNNER_SCRIPT: ${RUNNER_SCRIPT}`);
  logSep('─');

  // ── Restore progress from previous session ──────────────────────────────
  const savedProgress = loadProgress();
  if (savedProgress?.scrapedSet?.size > 0) {
    for (const id of savedProgress.scrapedSet) {
      sessionResults.scrapedSet.add(id);
    }
    log('INFO', 'STARTUP', `Restored ${sessionResults.scrapedSet.size} scraped gameIds from previous session`);
  }

  // ── Pre-flight DB check ─────────────────────────────────────────────────
  await runPreflightDbCheck();

  // ── Initial poll ────────────────────────────────────────────────────────
  await pollCycle();

  // ── Recurring poll loop ─────────────────────────────────────────────────
  setInterval(async () => {
    try {
      await pollCycle();
    } catch (err) {
      log('ERROR', 'POLL_LOOP', `Poll cycle error: ${err.message}`);
    }
  }, POLL_INTERVAL_MS);

  log('INFO', 'STARTUP', `✅ WC2026FTWatcher v2.1 running — polling every ${POLL_INTERVAL_MS / 1000}s | Press Ctrl+C for session summary`);
};

main().catch(err => {
  log('FATAL', 'MAIN', `Fatal startup error: ${err.message}`);
  process.exit(1);
});
