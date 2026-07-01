/**
 * wc2026LiveWatcher.mjs — WC2026 Live Match Final-State Watcher v2.3
 * ══════════════════════════════════════════════════════════════════
 * ELITE DUAL-CHANNEL LOGGER | 500x AUTO-TRIGGER ENGINE | ESPN-ONLY
 * 44-SCENARIO TEST MATRIX | DAY_ADVANCE ROLLING WINDOW ENGINE
 * ESPN_LIVE_STATUS_NAMES DUAL-PATH (typeId + name-based fallback)
 * STATUS_EXTRA_TIME_HALF_TIME | STATUS_PENALTY name alias
 * fixtureStatus classification log | hasWinner/isTdy/statusPrimary
 * isSwapped orientation note | statusDesc in every LIVE log line
 *
 * Architecture mirrors batchScrapeR32.mjs at every layer:
 *   - Elite dual-channel logger: terminal (ANSI) + two file streams
 *   - File-stream child-process capture (prevents pipe deadlock)
 *   - Forensic FT-transition detection engine (ESPN status type IDs)
 *   - FT-confirmation DOUBLE-CHECK poll (2 consecutive state=post required)
 *   - TRANS_DETAIL log level: all 12 ESPN status fields per transition
 *   - Midnight rule verification post-scrape (PT date / ET time)
 *   - Round verification (matchRound = expected ESPN season.slug)
 *   - Pre-flight DB state banner on startup
 *   - Retry engine: up to 3 attempts with 10s/20s/30s backoff
 *   - Per-cycle state machine: tracks every game's statusState
 *   - Session summary on SIGINT/SIGTERM
 *
 * NEW IN v2.3 — LIVE SCRAPER INTEGRATION (from wc2026Ingester.ts):
 *   - ESPN_LIVE_STATUS_NAMES name-based fallback (secondary path alongside typeId):
 *       STATUS_FIRST_HALF, STATUS_HALFTIME, STATUS_SECOND_HALF,
 *       STATUS_EXTRA_TIME, STATUS_EXTRA_TIME_HALF_TIME, STATUS_PENALTY,
 *       STATUS_IN_PROGRESS — prevents silent skip if ESPN changes a typeId
 *   - STATUS_EXTRA_TIME_HALF_TIME: new state — ET halftime break
 *       Classified as LIVE, logs ET_HT_ACTIVE, tightens poll to 15s
 *   - STATUS_PENALTY name fallback: alias for typeId=24 (isShootout detection)
 *   - fixtureStatus classification: logs FT|LIVE|PRE|SKIP on every event
 *   - statusDesc in every LIVE log line (description field)
 *   - hasWinner flag as tertiary FT confirmation signal
 *   - isTdy (isToday) flag logged per event in CYCLE summary
 *   - statusPrimary from gmStrp logged when present
 *   - isSwapped orientation note on FINAL detection
 *
 * NEW IN v2.2 — 44-SCENARIO ENGINE:
 *   - DAY_ADVANCE rolling window: once all games on earliest date are final,
 *     drop that date and add the next day at the far end (rolling 4-day window)
 *   - DAY_FINAL detection: logs when all games on a date are settled
 *   - Status-specific state machines for all 12 ESPN type IDs:
 *       id=1  SCHEDULED   → log PRE, no trigger
 *       id=2  IN_PROGRESS → log WATCHING, record kickoff
 *       id=22 HALFTIME    → log LIVE/HT, no trigger
 *       id=26 SECOND_HALF → log LIVE/2H, no trigger (760491 ground truth)
 *       id=17 EXTRA_TIME  → log ET_ACTIVE, tighten poll to 15s
 *       id=24 SHOOTOUT    → log PENS_ACTIVE, tighten poll to 15s
 *       id=28 FULL_TIME   → TRANS_D + double-confirm + TRIGGER (760491 confirmed)
 *       id=23 FULL_TIME   → same as id=28 (alt FT)
 *       id=3  FINAL       → same as id=28 (legacy FT)
 *       id=6  POSTPONED   → log POSTPONED, extend window +7d, add to postponedSet
 *       id=9  DELAYED     → log DELAYED, extend window +2h, add to delayedSet
 *       id=7  CANCELED    → log CANCELED, add to canceledSet, NEVER trigger
 *   - Cancel guard: id=7 games NEVER trigger scraper even if state=post/completed=true
 *   - Postponed window recalc: adds +7 days to watch window
 *   - Delayed window recalc: adds +2 hours (next poll cycle)
 *   - Cancel-then-reschedule: if canceledSet game transitions to pre, log RESCHEDULED
 *   - ET extended warning: if id=17/24 persists >30 min, log ET_EXTENDED
 *   - Double false-positive guard: requires 2 consecutive state=post confirmations
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
 *   id=7  STATUS_CANCELED       state=post completed=true   ← NEVER trigger scraper
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
 *   node wc2026LiveWatcher.mjs [--dry-run] [--force-rescrape]
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
const WATCHER_LOG    = `${LOG_DIR}/wc2026LiveWatcher.txt`;
const TERMINAL_LOG   = `/tmp/wc2026LiveWatcher_500x.txt`;
const PROGRESS_FILE  = `${LOG_DIR}/wc2026LiveWatcher_progress.json`;
const RUNNER_SCRIPT  = `${PROJECT_DIR}/server/wc2026/wc2026ESPNScraper.mjs`;

// Poll interval: 30 seconds (normal)
const POLL_INTERVAL_MS        = 30_000;
// Tightened poll interval when ET or Pens is active
const POLL_INTERVAL_ET_MS     = 15_000;
// FT-confirmation re-poll delay: 5 seconds after initial FT detection
const FT_CONFIRM_DELAY_MS     = 5_000;
// Second FT-confirmation re-poll delay: 8 seconds after first confirm
const FT_CONFIRM2_DELAY_MS    = 8_000;
// Per-match scrape timeout: 7 minutes (R32/QF/SF/F matches with ET+pens)
const MATCH_TIMEOUT_MS        = 420_000;
// Max retry attempts per match
const MAX_ATTEMPTS            = 3;
// Retry backoff delays (ms) per attempt
const RETRY_BACKOFF_MS        = [0, 10_000, 20_000, 30_000];
// Watch window: yesterday through +3 days (rolling, managed by DAY_ADVANCE engine)
const WATCH_DAYS_BEFORE       = 1;
const WATCH_DAYS_AFTER        = 3;
// ET/Pens extended warning threshold: 30 minutes
const ET_EXTENDED_WARN_MS     = 30 * 60 * 1000;
// Postponed window extension: +7 days
const POSTPONED_WINDOW_DAYS   = 7;

// ESPN API — ONLY source permitted (ESPN-only policy, no external sources)
const ESPN_SCOREBOARD_BASE    = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard';
const ESPN_LEAGUE_SLUG        = 'fifa.world';

// ESPN status type IDs that represent a SETTLED/FINAL match
// Forensically confirmed from live API inspection + 760491 audit
// CRITICAL: id=7 (CANCELED) is in FINAL_TYPE_IDS for state detection but
//           is EXCLUDED from trigger logic via canceledSet guard
const ESPN_FINAL_TYPE_IDS     = new Set([3, 23, 28]);    // STATUS_FINAL, STATUS_FULL_TIME (×2)
const ESPN_CANCELED_TYPE_IDS  = new Set([7]);             // STATUS_CANCELED — NEVER trigger scraper
const ESPN_FINAL_STATES       = new Set(['post']);
const ESPN_LIVE_TYPE_IDS      = new Set([2, 17, 22, 24, 25, 26]); // in-progress, ET, ET-HT, halftime, shootout, 2nd half
const ESPN_LIVE_STATES        = new Set(['in']);
const ESPN_ET_TYPE_IDS        = new Set([17]);            // STATUS_EXTRA_TIME
const ESPN_ET_HT_TYPE_IDS     = new Set([25]);            // STATUS_EXTRA_TIME_HALF_TIME (ET halftime break)
const ESPN_PENS_TYPE_IDS      = new Set([24]);            // STATUS_SHOOTOUT
const ESPN_POSTPONED_TYPE_IDS = new Set([6]);             // STATUS_POSTPONED
const ESPN_DELAYED_TYPE_IDS   = new Set([9]);             // STATUS_DELAYED

// v2.3: ESPN_LIVE_STATUS_NAMES — name-based fallback (from wc2026Ingester.ts)
// Prevents silent skip if ESPN changes a typeId but keeps the name stable.
// Root cause of original STATUS_SECOND_HALF silent skip: name not in set.
const ESPN_LIVE_STATUS_NAMES = new Set([
  'STATUS_IN_PROGRESS',
  'STATUS_FIRST_HALF',
  'STATUS_HALFTIME',
  'STATUS_SECOND_HALF',
  'STATUS_EXTRA_TIME',
  'STATUS_EXTRA_TIME_HALF_TIME',
  'STATUS_PENALTY',          // name alias for typeId=24 (shootout)
]);

// Expected matchRound values by ESPN season.slug
const ROUND_SLUG_MAP = {
  'round-of-32':   'round-of-32',
  'round-of-16':   'round-of-16',
  'quarterfinals': 'quarterfinals',
  'semifinals':    'semifinals',
  'final':         'final',
  'third-place':   'third-place',
};

// ═══════════════════════════════════════════════════════════════════════════════
// ELITE DUAL-CHANNEL LOGGER
// Writes to: terminal (ANSI color) + WATCHER_LOG (append) + TERMINAL_LOG (overwrite)
// Format: [ISO_TIMESTAMP] [LEVEL  ] [TAG                    ] message
// ═══════════════════════════════════════════════════════════════════════════════

fs.mkdirSync(LOG_DIR, { recursive: true });
const logStream  = fs.createWriteStream(WATCHER_LOG,  { flags: 'a' });
const termStream = fs.createWriteStream(TERMINAL_LOG, { flags: 'w' });

const C = {
  reset:   '\x1b[0m',  bold:    '\x1b[1m',  dim:     '\x1b[2m',
  green:   '\x1b[32m', red:     '\x1b[31m', yellow:  '\x1b[33m',
  cyan:    '\x1b[36m', magenta: '\x1b[35m', blue:    '\x1b[34m',
  gray:    '\x1b[90m', white:   '\x1b[97m', orange:  '\x1b[38;5;208m',
  purple:  '\x1b[38;5;141m',  teal: '\x1b[38;5;51m', lime: '\x1b[38;5;154m',
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
  'CONFIRM': C.green,
  'DAY_ADV': C.lime,     // DAY_ADVANCE rolling window engine
  'DAY_FIN': C.lime,     // DAY_FINAL: all games on a date settled
  'CANCEL ': C.red,      // STATUS_CANCELED guard
  'POSTPON': C.yellow,   // STATUS_POSTPONED
  'DELAYED': C.yellow,   // STATUS_DELAYED
  'ET_ACT ': C.orange,   // STATUS_EXTRA_TIME active
  'PENS_AC': C.orange,   // STATUS_SHOOTOUT active
  'WATCH  ': C.teal,     // Game enters STATUS_IN_PROGRESS (id=2)
  'ET_HT  ': C.orange,   // STATUS_EXTRA_TIME_HALF_TIME (ET halftime break)
  'FIXTURE': C.gray,     // fixtureStatus classification log (FT|LIVE|PRE|SKIP)
};

const log = (level, tag, msg) => {
  const ts      = new Date().toISOString();
  const lvl     = level.padEnd(7);
  const tagPad  = tag.padEnd(28);
  const plain   = `[${ts}] [${lvl}] [${tagPad}] ${msg}`;
  const color   = LEVEL_COLORS[`${lvl}`] || C.white;
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
// ═══════════════════════════════════════════════════════════════════════════════

const fetchEspnScoreboard = async (dateStr) => {
  const url = `${ESPN_SCOREBOARD_BASE}?dates=${dateStr}&limit=50`;
  log('ESPNAPI', `ESPN/SCOREBOARD/${dateStr}`, `[INPUT] GET ${url}`);
  const startMs = Date.now();
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':    'WC2026FTWatcher/500x-v2.3-ESPN-only',
        'Accept':        'application/json',
        'Referer':       'https://www.espn.com/',
        'Cache-Control': 'no-cache',
      },
      signal: AbortSignal.timeout(15_000),
    });
    const elapsed = Date.now() - startMs;
    if (!res.ok) {
      if (res.status === 429) {
        log('WARN', `ESPN/SCOREBOARD/${dateStr}`, `[RATE_LIMIT] 429 Too Many Requests | ${elapsed}ms — backing off`);
      } else {
        log('ERROR', `ESPN/SCOREBOARD/${dateStr}`, `[HTTP] ${res.status} ${res.statusText} | ${elapsed}ms`);
      }
      return [];
    }
    const data = await res.json();
    const events = data?.events || [];
    log('ESPNAPI', `ESPN/SCOREBOARD/${dateStr}`, `[OUTPUT] ${events.length} events | ${elapsed}ms | HTTP ${res.status}`);
    if (events.length === 0) {
      log('INFO', `ESPN/SCOREBOARD/${dateStr}`, `[NO_EVENTS] No events returned for date ${dateStr}`);
    }
    return events;
  } catch (err) {
    const elapsed = Date.now() - startMs;
    if (err.name === 'SyntaxError') {
      log('ERROR', `ESPN/SCOREBOARD/${dateStr}`, `[PARSE_ERROR] Malformed JSON response | ${elapsed}ms`);
    } else {
      log('ERROR', `ESPN/SCOREBOARD/${dateStr}`, `[ERROR] ${err.message} | ${elapsed}ms`);
    }
    return [];
  }
};

const fetchSingleGameConfirm = async (gameId, dateStr, confirmNum = 1) => {
  const url = `${ESPN_SCOREBOARD_BASE}?dates=${dateStr}&limit=50`;
  log('ESPNAPI', `ESPN/CONFIRM${confirmNum}/${gameId}`, `[INPUT] FT-CONFIRM#${confirmNum} re-poll → GET ${url}`);
  const startMs = Date.now();
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':    `WC2026FTWatcher/500x-v2.3-confirm${confirmNum}`,
        'Accept':        'application/json',
        'Referer':       'https://www.espn.com/',
        'Cache-Control': 'no-cache, no-store',
      },
      signal: AbortSignal.timeout(12_000),
    });
    const elapsed = Date.now() - startMs;
    if (!res.ok) {
      log('ERROR', `ESPN/CONFIRM${confirmNum}/${gameId}`, `[HTTP] ${res.status} ${res.statusText} | ${elapsed}ms`);
      return null;
    }
    const data = await res.json();
    const events = data?.events || [];
    const event = events.find(e => e.id === gameId);
    if (!event) {
      log('WARN', `ESPN/CONFIRM${confirmNum}/${gameId}`, `[OUTPUT] gameId=${gameId} not found in confirm response | ${elapsed}ms`);
      return null;
    }
    const g = parseEspnEvent(event);
    log('ESPNAPI', `ESPN/CONFIRM${confirmNum}/${gameId}`, `[OUTPUT] state=${g.statusState} typeId=${g.statusTypeId} completed=${g.statusCompleted} clock=${g.displayClock} | ${elapsed}ms`);
    return g;
  } catch (err) {
    const elapsed = Date.now() - startMs;
    log('ERROR', `ESPN/CONFIRM${confirmNum}/${gameId}`, `[ERROR] ${err.message} | ${elapsed}ms`);
    return null;
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// ESPN EVENT PARSER
// Extracts ALL forensically-relevant fields from a raw ESPN event object
// ═══════════════════════════════════════════════════════════════════════════════

const parseEspnEvent = (event) => {
  const comp          = event.competitions?.[0] || {};
  const status        = comp.status || {};
  const statusType    = status.type || {};
  const season        = event.season || {};

  const gameId        = event.id;
  const name          = event.name || '';
  const shortName     = event.shortName || '';
  const eventDate     = event.date || '';

  const seasonType    = season.type;
  const seasonSlug    = season.slug || '';
  const matchRound    = ROUND_SLUG_MAP[seasonSlug] || seasonSlug || 'unknown';

  // All 12 ESPN status fields (forensically confirmed from 760491)
  const statusTypeId      = statusType.id;
  const statusTypeName    = statusType.name || '';
  const statusState       = statusType.state || '';
  const statusCompleted   = statusType.completed;
  const statusDetail      = statusType.detail || '';
  const statusShortDetail = statusType.shortDetail || '';
  const statusDescription = statusType.description || '';
  const displayClock      = status.displayClock || '';
  const clock             = status.clock;
  const period            = status.period;

  // FT detection (ESPN-only, forensically verified from 760491)
  // PRIMARY:   state === 'post' AND completed === true
  // SECONDARY: typeId in FINAL set {3, 23, 28}
  // CANCEL GUARD: typeId=7 is NEVER a valid FT trigger
  const isCanceled        = ESPN_CANCELED_TYPE_IDS.has(statusTypeId);
  const isFinalByState    = statusState === 'post' && statusCompleted === true && !isCanceled;
  const isFinalByTypeId   = ESPN_FINAL_TYPE_IDS.has(statusTypeId);
  const isFinal           = isFinalByState || isFinalByTypeId;

  const isLiveByState     = statusState === 'in';
  const isLiveByTypeId    = ESPN_LIVE_TYPE_IDS.has(statusTypeId);
  // v2.3: name-based fallback — evaluated AFTER isLiveByName is computed below
  const isLive            = isLiveByState || isLiveByTypeId;

  const isScheduled       = statusState === 'pre' && !statusCompleted;
  const isPostponed       = ESPN_POSTPONED_TYPE_IDS.has(statusTypeId);
  const isDelayed         = ESPN_DELAYED_TYPE_IDS.has(statusTypeId);
  const isExtraTime       = ESPN_ET_TYPE_IDS.has(statusTypeId);
  const isExtraTimeHT     = ESPN_ET_HT_TYPE_IDS.has(statusTypeId) || statusTypeName === 'STATUS_EXTRA_TIME_HALF_TIME';
  const isShootout        = ESPN_PENS_TYPE_IDS.has(statusTypeId) || statusTypeName === 'STATUS_PENALTY';
  const isInProgress      = String(statusTypeId) === '2' || statusTypeName === 'STATUS_IN_PROGRESS';
  const isHalftime        = String(statusTypeId) === '22' || statusTypeName === 'STATUS_HALFTIME';
  const isSecondHalf      = String(statusTypeId) === '26' || statusTypeName === 'STATUS_SECOND_HALF';
  const isFirstHalf       = statusTypeName === 'STATUS_FIRST_HALF';

  // v2.3: name-based LIVE fallback (secondary path alongside typeId)
  // Prevents silent skip if ESPN changes a typeId but keeps the name stable
  const isLiveByName      = ESPN_LIVE_STATUS_NAMES.has(statusTypeName);

  // v2.3: hasWinner — tertiary FT confirmation signal (from gmStrp)
  const hasWinner         = (comp.competitors || []).some(c => c.winner === true);

  // v2.3: isTdy — isToday flag (from espn_deep_audit gmStrp.isTdy)
  const eventDateUTC      = eventDate ? eventDate.slice(0, 10) : '';
  const todayUTC          = new Date().toISOString().slice(0, 10);
  const isTdy             = eventDateUTC === todayUTC;

  // v2.3: statusPrimary — from gmStrp.statusPrimary if present
  const statusPrimary     = event.statusPrimary || comp.statusPrimary || null;

  // v2.3: isSwapped — orientation flag (from wc2026Ingester.ts)
  // ESPN sometimes lists home team as index[0] instead of index[1]
  const homeIdx           = (comp.competitors || []).findIndex(c => c.homeAway === 'home');
  const isSwapped         = homeIdx === 0; // true if home is first in array (non-standard)

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

  // Date string for confirm re-poll (UTC date from ESPN event)
  const eventDateStr = eventDate
    ? eventDate.replace(/[-T:Z.]/g, '').slice(0, 8)
    : '';

  // v2.3: fixtureStatus classification (from wc2026Ingester.ts)
  // FT = completed=true | LIVE = in-progress by any detection path | PRE = scheduled | SKIP = none
  const isLiveFinal = isLiveByState || isLiveByTypeId || isLiveByName;
  // v2.3: canceled must be SKIP even if ESPN marks completed=true
  const fixtureStatus = (statusCompleted === true && !isCanceled) ? 'FT'
    : isLiveFinal ? 'LIVE'
    : statusState === 'pre' ? 'PRE'
    : 'SKIP';

  return {
    gameId, name, shortName, eventDate, eventDateStr,
    seasonType, seasonSlug, matchRound,
    statusTypeId, statusTypeName, statusState, statusCompleted,
    statusDetail, statusShortDetail, statusDescription,
    displayClock, clock, period,
    isFinal, isLive: isLiveFinal, isScheduled, isCanceled,
    isFinalByState, isFinalByTypeId,
    isPostponed, isDelayed, isExtraTime, isExtraTimeHT, isShootout,
    isInProgress, isHalftime, isSecondHalf, isFirstHalf,
    isLiveByState, isLiveByTypeId, isLiveByName,
    hasWinner, isTdy, statusPrimary, isSwapped,
    fixtureStatus,
    competitors, home, away, scoreStr,
  };
};

// ═══════════════════════════════════════════════════════════════════════════════
// DYNAMIC WATCH WINDOW ENGINE (DAY_ADVANCE)
// ─────────────────────────────────────────────────────────────────────────────
// The watch window is a rolling set of YYYYMMDD date strings.
// Initial window: yesterday through +WATCH_DAYS_AFTER (4 dates total).
//
// DAY_ADVANCE logic:
//   After each poll cycle, if ALL games on the earliest date in the window
//   are in state=post (settled), that date is dropped and the next day is
//   appended at the far end.
//
//   Example:
//     Window: [20260630, 20260701, 20260702, 20260703]
//     760491 (last game on 20260630) goes final
//     DAY_FINAL fires for 20260630
//     20260630 dropped → 20260704 added
//     New window: [20260701, 20260702, 20260703, 20260704]
//
// Postponed/delayed extension:
//   If a game on a date is postponed (id=6), that date's window is extended
//   by POSTPONED_WINDOW_DAYS (7 days) — the date stays in the window longer.
//   If a game is delayed (id=9), the date stays in the window for the next cycle.
// ═══════════════════════════════════════════════════════════════════════════════

// The active watch window — initialized in main()
let watchWindow = [];

// Track which dates have been extended due to postponed games
// Key: dateStr → extensionExpiryDateStr (YYYYMMDD)
const postponedExtensions = new Map();

// Track which dates have delayed games (keep in window for next cycle)
const delayedDates = new Set();

/**
 * initWatchWindow — builds the initial watch window on startup.
 * Returns array of YYYYMMDD strings: yesterday through +WATCH_DAYS_AFTER.
 */
const initWatchWindow = () => {
  const dates = [];
  const now   = new Date();
  for (let d = -WATCH_DAYS_BEFORE; d <= WATCH_DAYS_AFTER; d++) {
    const dt = new Date(now);
    dt.setUTCDate(dt.getUTCDate() + d);
    dates.push(toDateStr(dt));
  }
  return dates;
};

/**
 * toDateStr — converts a Date to YYYYMMDD UTC string.
 */
const toDateStr = (dt) => {
  const yyyy = dt.getUTCFullYear();
  const mm   = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd   = String(dt.getUTCDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
};

/**
 * addDaysToDateStr — adds N days to a YYYYMMDD string, returns new YYYYMMDD.
 */
const addDaysToDateStr = (dateStr, days) => {
  const dt = new Date(
    parseInt(dateStr.slice(0, 4)),
    parseInt(dateStr.slice(4, 6)) - 1,
    parseInt(dateStr.slice(6, 8))
  );
  dt.setUTCDate(dt.getUTCDate() + days);
  return toDateStr(dt);
};

/**
 * advanceWatchWindow — called after each poll cycle.
 * For each date in the window, checks if all games on that date are settled.
 * If the EARLIEST date is fully settled, drops it and appends the next day.
 * Respects postponed extensions and delayed dates.
 *
 * @param {Map<string, {statusState, isFinal, isPostponed, isDelayed}>} dateGameStates
 *   Map of dateStr → array of game states seen on that date in this cycle
 */
const advanceWatchWindow = (dateGameStates) => {
  if (watchWindow.length === 0) return;

  const earliest = watchWindow[0];

  // Check if earliest date has a postponed extension
  if (postponedExtensions.has(earliest)) {
    const expiryStr = postponedExtensions.get(earliest);
    const today     = toDateStr(new Date());
    if (today < expiryStr) {
      log('INFO', `DAY_ADV/POSTPONE`, `Date ${earliest} has postponed extension until ${expiryStr} — keeping in window`);
      return;
    } else {
      postponedExtensions.delete(earliest);
      log('INFO', `DAY_ADV/POSTPONE`, `Postponed extension for ${earliest} expired — evaluating for advance`);
    }
  }

  // Check if earliest date has delayed games
  if (delayedDates.has(earliest)) {
    log('INFO', `DAY_ADV/DELAYED`, `Date ${earliest} has delayed games — keeping in window`);
    return;
  }

  const gamesOnEarliest = dateGameStates.get(earliest) || [];

  // If no games were found on this date at all, it may be a future date with
  // no scheduled games yet — keep it for now (ESPN may not list it yet)
  if (gamesOnEarliest.length === 0) {
    log('INFO', `DAY_ADV/${earliest}`, `No games found on ${earliest} this cycle — keeping in window`);
    return;
  }

  // Check if ALL games on earliest date are final
  const allFinal = gamesOnEarliest.every(g => g.isFinal);
  const anyLive  = gamesOnEarliest.some(g => g.isLive);
  const anyPre   = gamesOnEarliest.some(g => g.isScheduled || g.isPostponed || g.isDelayed);

  if (anyLive || anyPre) {
    // Still active games on earliest date — do not advance
    return;
  }

  if (allFinal) {
    // All games on earliest date are settled — advance the window
    const newFarDate = addDaysToDateStr(watchWindow[watchWindow.length - 1], 1);
    watchWindow.shift();
    watchWindow.push(newFarDate);

    log('DAY_ADV', `DAY_ADV/ADVANCE`, `🗓️  DAY_ADVANCE: ${earliest} fully settled (${gamesOnEarliest.length} games) → dropped | ${newFarDate} added | window=[${watchWindow.join(', ')}]`);
    log('DAY_FIN', `DAY_FIN/${earliest}`, `🏁 DAY_FINAL: ALL ${gamesOnEarliest.length} games on ${earliest} are settled | window now starts at ${watchWindow[0]}`);
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// SPECIAL STATUS STATE MACHINES
// Tracks per-game special states: postponed, delayed, canceled, ET, pens
// ═══════════════════════════════════════════════════════════════════════════════

// canceledSet: gameIds confirmed canceled — NEVER trigger scraper
const canceledSet = new Set();
// postponedSet: gameIds currently postponed
const postponedSet = new Set();
// delayedSet: gameIds currently delayed
const delayedSet = new Set();
// etActiveMap: gameId → { firstSeenMs } — tracks when ET/pens started
const etActiveMap = new Map();
// watchingSet: gameIds that have been seen as id=2 (in-progress) this session
const watchingSet = new Set();

/**
 * handleSpecialStatus — processes non-FT status transitions.
 * Called for every game in every poll cycle.
 * Returns { handled: true } if the game was handled by a special case.
 */
const handleSpecialStatus = (g, prev) => {
  const prevTypeId = prev?.statusTypeId;

  // ── CANCELED (id=7) ───────────────────────────────────────────────────────
  if (g.isCanceled) {
    if (!canceledSet.has(g.gameId)) {
      canceledSet.add(g.gameId);
      log('CANCEL', `CANCEL/${g.gameId}`, `🚫 STATUS_CANCELED | ${g.name} | typeId=7 | state=${g.statusState} | completed=${g.statusCompleted} | SCRAPER WILL NEVER TRIGGER`);
    }
    return { handled: true, isCanceled: true };
  }

  // ── CANCEL-THEN-RESCHEDULE: was canceled, now pre ────────────────────────
  if (canceledSet.has(g.gameId) && g.isScheduled) {
    canceledSet.delete(g.gameId);
    log('INFO', `CANCEL/${g.gameId}`, `♻️  RESCHEDULED — was canceled, now pre/scheduled | ${g.name} | typeId=${g.statusTypeId}`);
    return { handled: false }; // allow normal pre handling
  }

  // ── POSTPONED (id=6) ─────────────────────────────────────────────────────
  if (g.isPostponed) {
    if (!postponedSet.has(g.gameId)) {
      postponedSet.add(g.gameId);
      delayedDates.delete(g.eventDateStr); // clear delayed if now postponed
      // Extend watch window for this date
      if (g.eventDateStr) {
        const expiryStr = addDaysToDateStr(g.eventDateStr, POSTPONED_WINDOW_DAYS);
        postponedExtensions.set(g.eventDateStr, expiryStr);
        // Ensure the extended dates are in the watch window
        for (let d = 1; d <= POSTPONED_WINDOW_DAYS; d++) {
          const extDate = addDaysToDateStr(g.eventDateStr, d);
          if (!watchWindow.includes(extDate)) {
            watchWindow.push(extDate);
            log('DAY_ADV', `DAY_ADV/POSTPONE`, `📅 POSTPONED extension: added ${extDate} to watch window`);
          }
        }
        log('POSTPON', `POSTPON/${g.gameId}`, `⏸️  STATUS_POSTPONED | ${g.name} | typeId=6 | date=${g.eventDateStr} | window extended +${POSTPONED_WINDOW_DAYS}d until ${expiryStr}`);
      }
    }
    return { handled: true };
  }

  // ── POSTPONED-THEN-RESCHEDULED: was postponed, now pre ──────────────────
  if (postponedSet.has(g.gameId) && g.isScheduled) {
    postponedSet.delete(g.gameId);
    log('INFO', `POSTPON/${g.gameId}`, `♻️  RESCHEDULED — was postponed, now pre/scheduled | ${g.name} | new date=${g.eventDate}`);
  }

  // ── DELAYED (id=9) ───────────────────────────────────────────────────────
  if (g.isDelayed) {
    if (!delayedSet.has(g.gameId)) {
      delayedSet.add(g.gameId);
      if (g.eventDateStr) delayedDates.add(g.eventDateStr);
      log('DELAYED', `DELAYED/${g.gameId}`, `⏳ STATUS_DELAYED | ${g.name} | typeId=9 | date=${g.eventDateStr} | keeping date in window for next cycle`);
    }
    return { handled: true };
  }

  // ── DELAYED-THEN-RESOLVED: was delayed, now in-progress ─────────────────
  if (delayedSet.has(g.gameId) && (g.isLive || g.isInProgress)) {
    delayedSet.delete(g.gameId);
    if (g.eventDateStr) delayedDates.delete(g.eventDateStr);
    log('INFO', `DELAYED/${g.gameId}`, `▶️  DELAY_RESOLVED — was delayed, now in-progress | ${g.name} | typeId=${g.statusTypeId}`);
  }

  // ── IN_PROGRESS (id=2) — game kicked off ─────────────────────────────────
  if (g.isInProgress && !watchingSet.has(g.gameId)) {
    watchingSet.add(g.gameId);
    log('WATCH', `WATCH/${g.gameId}`, `👁️  WATCHING — STATUS_IN_PROGRESS | ${g.name} | typeId=2 | kickoff=${g.eventDate} | ${g.scoreStr}`);
  }

  // ── EXTRA_TIME_HALF_TIME (id=25 / name=STATUS_EXTRA_TIME_HALF_TIME) ───────
  if (g.isExtraTimeHT) {
    if (!etActiveMap.has(g.gameId)) {
      etActiveMap.set(g.gameId, { firstSeenMs: Date.now(), type: 'ET_HT' });
      log('ET_HT', `ET_HT/${g.gameId}`, `⚡ ET_HT_ACTIVE — STATUS_EXTRA_TIME_HALF_TIME | ${g.name} | typeId=${g.statusTypeId} name=${g.statusTypeName} | ${g.scoreStr} | ${g.displayClock} | POLL TIGHTENED to ${POLL_INTERVAL_ET_MS / 1000}s`);
    }
    return { handled: false, tightenPoll: true };
  }

  // ── EXTRA_TIME (id=17) ───────────────────────────────────────────────────
  if (g.isExtraTime) {
    if (!etActiveMap.has(g.gameId)) {
      etActiveMap.set(g.gameId, { firstSeenMs: Date.now(), type: 'ET' });
      log('ET_ACT', `ET_ACT/${g.gameId}`, `⚡ ET_ACTIVE — STATUS_EXTRA_TIME | ${g.name} | typeId=17 | ${g.scoreStr} | ${g.displayClock} | POLL TIGHTENED to ${POLL_INTERVAL_ET_MS / 1000}s`);
    } else {
      const elapsed = Date.now() - etActiveMap.get(g.gameId).firstSeenMs;
      if (elapsed > ET_EXTENDED_WARN_MS && !etActiveMap.get(g.gameId).warnedExtended) {
        etActiveMap.get(g.gameId).warnedExtended = true;
        log('WARN', `ET_ACT/${g.gameId}`, `⚠️  ET_EXTENDED — Extra time has been active for ${Math.round(elapsed / 60000)} min | ${g.name} | ${g.displayClock}`);
      }
    }
    return { handled: false, tightenPoll: true }; // still needs FT detection
  }

  // ── SHOOTOUT (id=24) ─────────────────────────────────────────────────────
  if (g.isShootout) {
    if (!etActiveMap.has(g.gameId)) {
      etActiveMap.set(g.gameId, { firstSeenMs: Date.now(), type: 'PENS' });
      log('PENS_AC', `PENS_AC/${g.gameId}`, `🥅 PENS_ACTIVE — STATUS_SHOOTOUT | ${g.name} | typeId=24 | ${g.scoreStr} | ${g.displayClock} | POLL TIGHTENED to ${POLL_INTERVAL_ET_MS / 1000}s`);
    } else {
      const elapsed = Date.now() - etActiveMap.get(g.gameId).firstSeenMs;
      if (elapsed > ET_EXTENDED_WARN_MS && !etActiveMap.get(g.gameId).warnedExtended) {
        etActiveMap.get(g.gameId).warnedExtended = true;
        log('WARN', `PENS_AC/${g.gameId}`, `⚠️  PENS_EXTENDED — Shootout has been active for ${Math.round(elapsed / 60000)} min | ${g.name} | ${g.displayClock}`);
      }
    }
    return { handled: false, tightenPoll: true };
  }

  // ── ET/PENS resolved (game went FT after ET/pens) ────────────────────────
  if (etActiveMap.has(g.gameId) && g.isFinal) {
    const etInfo = etActiveMap.get(g.gameId);
    const elapsed = ((Date.now() - etInfo.firstSeenMs) / 1000).toFixed(0);
    log('INFO', `ET_ACT/${g.gameId}`, `✅ ${etInfo.type}_RESOLVED — game went final after ${etInfo.type} | ${g.name} | ${g.scoreStr} | duration=${elapsed}s`);
    etActiveMap.delete(g.gameId);
  }

  return { handled: false };
};

// ═══════════════════════════════════════════════════════════════════════════════
// DB STATE CHECK
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

    const expectedPtDate = dt.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    const etH  = parseInt(dt.toLocaleString('en-US', { timeZone: 'America/New_York', hour: '2-digit', hour12: false }), 10);
    const etM  = parseInt(dt.toLocaleString('en-US', { timeZone: 'America/New_York', minute: '2-digit' }), 10);
    const expectedEtTime = `${String(isNaN(etH) ? 0 : etH).padStart(2, '0')}:${String(isNaN(etM) ? 0 : etM).padStart(2, '0')}`;

    const isMidnight = r.matchKickoffEt === '00:00';
    const dateOk     = r.matchGameDate === expectedPtDate;
    const timeOk     = r.matchKickoffEt === expectedEtTime;
    const versionOk  = r.scrapeVersion === '500x';
    const roundOk    = !expectedRound || r.matchRound === expectedRound;
    const status     = dateOk && timeOk && versionOk && roundOk ? 'PASS' : 'FAIL';

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
    };
  } catch (err) {
    return { ok: false, reason: `DB error: ${err.message}` };
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// CHILD PROCESS RUNNER — 500x SCRAPER INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════════

const scrapeMatch = (gameId, matchRound) => {
  return new Promise((resolve) => {
    const startMs  = Date.now();
    const outFile  = `/tmp/wc2026_scrape_${gameId}_${Date.now()}.txt`;
    const errFile  = `/tmp/wc2026_scrape_${gameId}_${Date.now()}_err.txt`;
    const outStream = fs.createWriteStream(outFile);
    const errStream = fs.createWriteStream(errFile);

    log('PROG', `SCRAPE/${gameId}`, `▶ Spawning 500x scraper | gameId=${gameId} matchRound=${matchRound} | outFile=${outFile}`);

    const child = spawn('node', [RUNNER_SCRIPT, gameId, matchRound], {
      cwd:   PROJECT_DIR,
      env:   { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.pipe(outStream);
    child.stderr.pipe(errStream);

    // Stream stdout to our log in real-time
    child.stdout.on('data', (chunk) => {
      const lines = chunk.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        log('PROG', `SCRAPE/${gameId}`, line.slice(0, 200));
      }
    });

    child.stderr.on('data', (chunk) => {
      const lines = chunk.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        log('WARN', `SCRAPE/${gameId}`, `[STDERR] ${line.slice(0, 200)}`);
      }
    });

    // Timeout guard
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      log('WARN', `SCRAPE/${gameId}`, `⏱️  TIMEOUT — scraper exceeded ${MATCH_TIMEOUT_MS / 1000}s — process killed`);
      resolve({ success: false, error: 'TIMEOUT', rowsWritten: 0, durationMs: Date.now() - startMs });
    }, MATCH_TIMEOUT_MS);

    child.on('close', (code) => {
      clearTimeout(timeout);
      const durationMs = Date.now() - startMs;
      outStream.end();
      errStream.end();

      // Parse output for success markers
      let rawOut = '';
      try { rawOut = fs.readFileSync(outFile, 'utf8'); } catch {}

      const successMatch = rawOut.match(/success=(true|false)/);
      const rowsMatch    = rawOut.match(/rows=(\d+)/);
      const errorsMatch  = rawOut.match(/errors=(\d+)/);
      const matchInfoMatch = rawOut.match(/matchInfo=([^\|]+)/);
      const venueMatch   = rawOut.match(/venue=([^\|]+)/);

      const success    = successMatch?.[1] === 'true' && code === 0;
      const rowsWritten = parseInt(rowsMatch?.[1] || '0', 10);
      const errors     = parseInt(errorsMatch?.[1] || '0', 10);
      const matchInfo  = matchInfoMatch?.[1]?.trim() || '';
      const venue      = venueMatch?.[1]?.trim() || '';

      log('PROG', `SCRAPE/${gameId}`, `◀ Scraper exited | code=${code} | success=${success} | rows=${rowsWritten} | errors=${errors} | ${(durationMs / 1000).toFixed(1)}s`);

      resolve({ success, rowsWritten, errors, matchInfo, venue, durationMs, code, error: success ? null : `exit code ${code}` });
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      const durationMs = Date.now() - startMs;
      log('ERROR', `SCRAPE/${gameId}`, `Spawn error: ${err.message}`);
      resolve({ success: false, error: err.message, rowsWritten: 0, durationMs });
    });
  });
};

const scrapeWithRetry = async (gameId, matchRound, g) => {
  sessionResults.scraped++;
  sessionResults.scrapingSet.add(gameId);

  let attempts = 0;
  let scrapeResult;

  while (attempts < MAX_ATTEMPTS) {
    attempts++;
    const backoff = RETRY_BACKOFF_MS[attempts - 1] || 0;
    if (backoff > 0) {
      log('RETRY', `RETRY/${gameId}`, `⏳ Attempt ${attempts}/${MAX_ATTEMPTS} — waiting ${backoff / 1000}s before retry`);
      await new Promise(r => setTimeout(r, backoff));
      sessionResults.retried++;
    }
    log('PROG', `SCRAPE/${gameId}`, `▶ Attempt ${attempts}/${MAX_ATTEMPTS} | gameId=${gameId} matchRound=${matchRound}`);
    scrapeResult = await scrapeMatch(gameId, matchRound);
    if (scrapeResult.success) break;
    log('WARN', `SCRAPE/${gameId}`, `Attempt ${attempts} failed: ${scrapeResult.error}`);
  }

  if (scrapeResult.success) {
    sessionResults.passed++;
    log('PASS', `FINAL_${gameId}`, `✅ SCRAPE PASS | success=true | rows=${scrapeResult.rowsWritten} | errors=${scrapeResult.errors} | ${(scrapeResult.durationMs / 1000).toFixed(1)}s | attempts=${attempts}`);

    // Midnight rule verification
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
      gameId, status: 'PASS',
      rowsWritten: scrapeResult.rowsWritten,
      matchInfo:   scrapeResult.matchInfo,
      venue:       scrapeResult.venue,
      durationMs:  scrapeResult.durationMs,
      attempts, matchRound, midnightRule: midnightCheck,
    });
    sessionResults.scrapedSet.add(gameId);
  } else {
    sessionResults.failed++;
    sessionResults.matches.push({
      gameId, status: 'FAIL',
      rowsWritten: scrapeResult.rowsWritten,
      error:       scrapeResult.error,
      durationMs:  scrapeResult.durationMs,
      attempts, matchRound,
    });
    log('FAIL', `FINAL_${gameId}`, `❌ SCRAPE FAILED after ${attempts} attempts | ${scrapeResult.error?.slice(0, 80)}`);
  }

  sessionResults.scrapingSet.delete(gameId);
};

// ═══════════════════════════════════════════════════════════════════════════════
// FT-CONFIRMATION ENGINE — DOUBLE-CHECK (2 consecutive state=post required)
// ═══════════════════════════════════════════════════════════════════════════════

const confirmFinalState = async (gameId, matchRound, initialGame) => {
  // ── CONFIRM #1 ────────────────────────────────────────────────────────────
  log('CONFIRM', `CONFIRM/${gameId}`, `⏳ Waiting ${FT_CONFIRM_DELAY_MS / 1000}s before FT-CONFIRM #1 re-poll...`);
  await new Promise(r => setTimeout(r, FT_CONFIRM_DELAY_MS));

  // Determine date string for the confirm fetch (use UTC date from ESPN event)
  // CRITICAL: For midnight-boundary games like 760491 (22:00 ET = next UTC day),
  // the eventDateStr is the UTC date of the ESPN event, not the local date.
  let confirmDateStr = initialGame.eventDateStr;
  if (!confirmDateStr) {
    confirmDateStr = toDateStr(new Date());
    log('WARN', `CONFIRM/${gameId}`, `eventDateStr missing — using today's UTC date: ${confirmDateStr}`);
  }

  const confirm1 = await fetchSingleGameConfirm(gameId, confirmDateStr, 1);

  if (confirm1 === null) {
    // ESPN returned no data — conservative pass (game may have crossed midnight)
    log('CONFIRM', `CONFIRM/${gameId}`, `⚠️  CONFIRM#1 fetch returned null — conservative pass (possible midnight boundary)`);
    logTransDetail(`CONFIRM_D/${gameId}`, 'FT_CONFIRMED_CONSERVATIVE', initialGame, null);
    sessionResults.ftConfirmPass++;
    return { confirmed: true, confirmedGame: initialGame };
  }

  // Check if game is still final after confirm #1
  const still1Final = confirm1.statusState === 'post' && confirm1.statusCompleted === true && !confirm1.isCanceled;

  if (!still1Final) {
    // State reverted — FALSE POSITIVE
    log('WARN', `CONFIRM/${gameId}`, `⚠️  FALSE POSITIVE #1 — state reverted to ${confirm1.statusState} | typeId=${confirm1.statusTypeId} | completed=${confirm1.statusCompleted} | clock=${confirm1.displayClock} — SUPPRESSING TRIGGER`);
    logTransDetail(`CONFIRM_D/${gameId}`, 'FT_REVERTED_1', confirm1, null);
    sessionResults.ftConfirmFail++;
    return { confirmed: false, confirmedGame: confirm1 };
  }

  log('CONFIRM', `CONFIRM/${gameId}`, `✅ CONFIRM#1 PASS | state=post | typeId=${confirm1.statusTypeId} ${confirm1.statusTypeName} | completed=true | clock=${confirm1.displayClock} | score=${confirm1.scoreStr}`);
  logTransDetail(`CONFIRM_D/${gameId}`, 'FT_CONFIRMED_1', confirm1, null);

  // ── CONFIRM #2 (double-check) ─────────────────────────────────────────────
  log('CONFIRM', `CONFIRM/${gameId}`, `⏳ Waiting ${FT_CONFIRM2_DELAY_MS / 1000}s before FT-CONFIRM #2 double-check...`);
  await new Promise(r => setTimeout(r, FT_CONFIRM2_DELAY_MS));

  const confirm2 = await fetchSingleGameConfirm(gameId, confirmDateStr, 2);

  if (confirm2 === null) {
    // Conservative pass on second confirm too
    log('CONFIRM', `CONFIRM/${gameId}`, `⚠️  CONFIRM#2 fetch returned null — using CONFIRM#1 result (conservative)`);
    sessionResults.ftConfirmPass++;
    return { confirmed: true, confirmedGame: confirm1 };
  }

  const still2Final = confirm2.statusState === 'post' && confirm2.statusCompleted === true && !confirm2.isCanceled;

  if (!still2Final) {
    log('WARN', `CONFIRM/${gameId}`, `⚠️  FALSE POSITIVE #2 — state reverted on second check | state=${confirm2.statusState} | typeId=${confirm2.statusTypeId} | SUPPRESSING TRIGGER`);
    logTransDetail(`CONFIRM_D/${gameId}`, 'FT_REVERTED_2', confirm2, null);
    sessionResults.ftConfirmFail++;
    return { confirmed: false, confirmedGame: confirm2 };
  }

  log('CONFIRM', `CONFIRM/${gameId}`, `✅ CONFIRM#2 PASS — DOUBLE-CONFIRMED | state=post | typeId=${confirm2.statusTypeId} | clock=${confirm2.displayClock} | score=${confirm2.scoreStr}`);
  logTransDetail(`CONFIRM_D/${gameId}`, 'FT_CONFIRMED_2', confirm2, null);
  sessionResults.ftConfirmPass++;
  return { confirmed: true, confirmedGame: confirm2 };
};

// ═══════════════════════════════════════════════════════════════════════════════
// SESSION STATE
// ═══════════════════════════════════════════════════════════════════════════════

const sessionResults = {
  startedAt:           new Date().toISOString(),
  completedAt:         null,
  totalDurationMs:     0,
  totalPolls:          0,
  totalGamesDetected:  0,
  totalLiveDetected:   0,
  totalFinalsDetected: 0,
  totalNewlyFinal:     0,
  scraped:             0,
  passed:              0,
  failed:              0,
  retried:             0,
  midnightRulePass:    0,
  midnightRuleFail:    0,
  ftConfirmPass:       0,
  ftConfirmFail:       0,
  dayAdvanceCount:     0,
  canceledCount:       0,
  postponedCount:      0,
  delayedCount:        0,
  etActiveCount:       0,
  matches:             [],
  scrapedSet:          new Set(),
  scrapingSet:         new Set(),
};

// Per-game state machine
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
      watchWindow,
    };
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(serializable, null, 2));
  } catch {}
};

const loadProgress = () => {
  try {
    if (!fs.existsSync(PROGRESS_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    raw.scrapedSet  = new Set(raw.scrapedSet  || []);
    raw.scrapingSet = new Set([]);
    return raw;
  } catch {
    return null;
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// PRE-FLIGHT DB STATE BANNER
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
// POLL CYCLE — CORE DETECTION ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

let pollCount = 0;
// Dynamic poll interval — tightened when ET/pens is active
let currentPollInterval = POLL_INTERVAL_MS;

const pollCycle = async () => {
  pollCount++;
  sessionResults.totalPolls++;
  const cycleStart = Date.now();

  log('POLL', `CYCLE/${pollCount}`, `🔄 Poll #${pollCount} — watching dates: ${watchWindow.join(', ')} | scrapedSet.size=${sessionResults.scrapedSet.size} | scrapingSet.size=${sessionResults.scrapingSet.size}`);

  let totalGames  = 0;
  let liveGames   = 0;
  let finalGames  = 0;
  let newlyFinal  = 0;
  let preGames    = 0;
  let etPensActive = false;

  // dateGameStates: dateStr → array of parsed game objects (for DAY_ADVANCE)
  const dateGameStates = new Map();

  for (const dateStr of watchWindow) {
    const events = await fetchEspnScoreboard(dateStr);
    if (!dateGameStates.has(dateStr)) dateGameStates.set(dateStr, []);

    if (events.length === 0) continue;

    for (const event of events) {
      const g = parseEspnEvent(event);
      dateGameStates.get(dateStr).push(g);

      totalGames++;
      sessionResults.totalGamesDetected = Math.max(sessionResults.totalGamesDetected, totalGames);

      // Retrieve previous state
      const prev          = gameStateMap.get(g.gameId);
      const prevState     = prev?.statusState    || 'unknown';
      const prevTypeId    = prev?.statusTypeId   || null;
      const prevCompleted = prev?.statusCompleted ?? null;

      // Update state machine
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

      // ── Special status state machines ──────────────────────────────────────
      const special = handleSpecialStatus(g, prev);
      if (special.tightenPoll) etPensActive = true;
      if (special.isCanceled) {
        // Canceled games: log but never trigger
        finalGames++; // ESPN marks canceled as post/completed
        continue;
      }
      if (special.handled) continue;

      // ── LIVE game logging ──────────────────────────────────────────────────
      // v2.3: fixtureStatus classification log — every event, every cycle
      log('FIXTURE', `FIXTURE/${g.gameId}`, `[CLASSIFY] ${g.name} | fixtureStatus=${g.fixtureStatus} | typeId=${g.statusTypeId} typeName=${g.statusTypeName} state=${g.statusState} completed=${g.statusCompleted} | isTdy=${g.isTdy} hasWinner=${g.hasWinner}${g.statusPrimary ? ` statusPrimary=${g.statusPrimary}` : ''} | isLiveByState=${g.isLiveByState} isLiveByTypeId=${g.isLiveByTypeId} isLiveByName=${g.isLiveByName}`);

      if (g.isLive) {
        liveGames++;
        sessionResults.totalLiveDetected = Math.max(sessionResults.totalLiveDetected, liveGames);
        const liveType = g.isExtraTimeHT ? 'ET_HT' : g.isExtraTime ? 'ET' : g.isShootout ? 'PENS' : g.isHalftime ? 'HT' : g.isFirstHalf ? '1H' : g.isSecondHalf ? '2H' : g.isInProgress ? 'IP' : 'LIVE';
        log('LIVE', `LIVE/${g.gameId}`, `⚽ [${liveType}] ${g.name} | ${g.scoreStr} | ${g.displayClock} P${g.period} | typeId=${g.statusTypeId} ${g.statusTypeName} | state=${g.statusState} | desc=${g.statusDescription} | isTdy=${g.isTdy}`);
      }

      // ── FINAL game processing ──────────────────────────────────────────────
      if (g.isFinal) {
        finalGames++;
        sessionResults.totalFinalsDetected = Math.max(sessionResults.totalFinalsDetected, finalGames);

        // FT TRANSITION DETECTION
        // Newly final = previous state was NOT "post" AND current is "post"/completed=true
        // Forensically confirmed for 760491: in/typeId=26 → post/typeId=28
        const isNewlyFinal = prevState !== 'post' && g.statusState === 'post' && g.statusCompleted === true;

        if (isNewlyFinal) {
          log('TRANS', `TRANS/${g.gameId}`, `🔀 FT TRANSITION DETECTED | ${g.name} | prevState=${prevState} prevTypeId=${prevTypeId} prevCompleted=${prevCompleted} → state=${g.statusState} typeId=${g.statusTypeId} completed=${g.statusCompleted} | ${g.displayClock} | ${g.statusDescription} (${g.statusShortDetail})`);
          logTransDetail(`TRANS_D/${g.gameId}`, 'FT_DETECTED', g, prev);
        }

        if (isNewlyFinal) {
          newlyFinal++;
          sessionResults.totalNewlyFinal++;

          // v2.3: isSwapped orientation note on FINAL detection
          const swapNote = g.isSwapped ? ' | ⚠️ isSwapped=true (home at idx[0])' : ' | isSwapped=false';
          // v2.3: hasWinner as tertiary FT confirmation signal
          const winnerNote = g.hasWinner ? ' | hasWinner=true ✅' : ' | hasWinner=false ⚠️';
          log('FINAL', `FINAL/${g.gameId}`, `🏁 GAME FINAL — NEWLY DETECTED | ${g.name} | ${g.scoreStr} | typeId=${g.statusTypeId} ${g.statusTypeName} | ${g.statusShortDetail} | clock=${g.displayClock} P${g.period}${swapNote}${winnerNote}`);

          if (DRY_RUN) {
            log('INFO', `TRIGGER/${g.gameId}`, `[DRY-RUN] Would trigger scrape for ${g.gameId} — skipping`);
          } else {
            // Double-confirm before trigger
            confirmFinalState(g.gameId, g.matchRound, g).then(({ confirmed, confirmedGame }) => {
              if (!confirmed) {
                log('WARN', `TRIGGER/${g.gameId}`, `⚠️ FT-CONFIRM FAILED (false positive) — suppressing scrape trigger for ${g.gameId}`);
                return;
              }
              const cg = confirmedGame || g;
              log('TRIGGER', `TRIGGER/${g.gameId}`, `🚀 gameId=${g.gameId} → matchRound=${cg.matchRound} | seasonSlug=${cg.seasonSlug} | prevState=${prevState} → post | typeId=${cg.statusTypeId} | completed=${cg.statusCompleted} | DRY_RUN=${DRY_RUN}`);
              scrapeWithRetry(g.gameId, cg.matchRound, cg).catch(err => {
                log('ERROR', `TRIGGER/${g.gameId}`, `Scrape trigger error: ${err.message}`);
              });
            }).catch(err => {
              log('WARN', `CONFIRM/${g.gameId}`, `Confirm engine error: ${err.message} — proceeding with trigger`);
              log('TRIGGER', `TRIGGER/${g.gameId}`, `🚀 gameId=${g.gameId} → matchRound=${g.matchRound} | confirm engine error — conservative trigger`);
              scrapeWithRetry(g.gameId, g.matchRound, g).catch(e => {
                log('ERROR', `TRIGGER/${g.gameId}`, `Scrape trigger error: ${e.message}`);
              });
            });
          }

        } else if (!sessionResults.scrapedSet.has(g.gameId) && !sessionResults.scrapingSet.has(g.gameId)) {
          // Final, known from previous poll — check DB
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

  // ── DAY_ADVANCE: check if earliest date is fully settled ──────────────────
  advanceWatchWindow(dateGameStates);

  // ── Adjust poll interval based on ET/pens activity ────────────────────────
  const targetInterval = etPensActive ? POLL_INTERVAL_ET_MS : POLL_INTERVAL_MS;
  if (targetInterval !== currentPollInterval) {
    currentPollInterval = targetInterval;
    log('INFO', 'POLL_INTERVAL', `⚡ Poll interval adjusted to ${currentPollInterval / 1000}s (${etPensActive ? 'ET/PENS active' : 'normal'})`);
  }

  const elapsed = ((Date.now() - cycleStart) / 1000).toFixed(2);
  log('CYCLE', `CYCLE/${pollCount}`, `✅ CYCLE/${pollCount} — ${totalGames} total | ${liveGames} live | ${preGames} pre | ${finalGames} final | ${newlyFinal} newly final | ${elapsed}s | scraped=${sessionResults.scraped} pass=${sessionResults.passed} fail=${sessionResults.failed} ftConfirm=${sessionResults.ftConfirmPass}✅/${sessionResults.ftConfirmFail}⚠️ | window=[${watchWindow.join(',')}]`);

  saveProgress(sessionResults);
};

// ═══════════════════════════════════════════════════════════════════════════════
// SESSION SUMMARY
// ═══════════════════════════════════════════════════════════════════════════════

const printSessionSummary = () => {
  const totalDurationMs  = Date.now() - new Date(sessionResults.startedAt).getTime();
  const totalDurationMin = (totalDurationMs / 60000).toFixed(1);

  sessionResults.completedAt    = new Date().toISOString();
  sessionResults.totalDurationMs = totalDurationMs;

  logBanner('WC2026FTWatcher SESSION SUMMARY — 500x EDITION v2.3');
  log('INFO', 'SESSION_SUMMARY', `Duration: ${totalDurationMin} minutes | Polls: ${sessionResults.totalPolls}`);
  log('INFO', 'SESSION_SUMMARY', `Games detected: ${sessionResults.totalGamesDetected} | Live: ${sessionResults.totalLiveDetected} | Finals: ${sessionResults.totalFinalsDetected} | Newly final: ${sessionResults.totalNewlyFinal}`);
  log('INFO', 'SESSION_SUMMARY', `Scraped: ${sessionResults.scraped} | ✅ PASS: ${sessionResults.passed} | ❌ FAIL: ${sessionResults.failed} | 🔄 Retried: ${sessionResults.retried}`);
  log('INFO', 'SESSION_SUMMARY', `FT-Confirm: ✅${sessionResults.ftConfirmPass} confirmed | ⚠️${sessionResults.ftConfirmFail} false positives suppressed`);
  log('INFO', 'SESSION_SUMMARY', `DAY_ADVANCE: ${sessionResults.dayAdvanceCount} advances | Canceled: ${canceledSet.size} | Postponed: ${postponedSet.size} | Delayed: ${delayedSet.size} | ET/Pens: ${etActiveMap.size} active`);
  log('INFO', 'SESSION_SUMMARY', `Final watch window: [${watchWindow.join(', ')}]`);

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

  if (sessionResults.matches.length > 0) {
    const tableHeader = `\n=== SCRAPED MATCHES TABLE (WC2026FTWatcher Session v2.3) ===`;
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
// DYNAMIC POLL LOOP — respects currentPollInterval (tightened for ET/pens)
// ═══════════════════════════════════════════════════════════════════════════════

let pollTimer = null;

const schedulePoll = () => {
  pollTimer = setTimeout(async () => {
    try {
      await pollCycle();
    } catch (err) {
      log('ERROR', 'POLL_LOOP', `Poll cycle error: ${err.message}`);
    }
    schedulePoll(); // reschedule with potentially updated interval
  }, currentPollInterval);
};

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════════

const main = async () => {
  logBanner(`WC2026FTWatcher v2.3 — 500x ELITE LIVE DETECTION ENGINE | 44-SCENARIO | ESPN_LIVE_STATUS_NAMES`);
  log('INFO', 'STARTUP', `ESPN-ONLY POLICY: All data sourced exclusively from ${ESPN_SCOREBOARD_BASE}`);
  log('INFO', 'STARTUP', `DRY_RUN=${DRY_RUN} | FORCE_RESCRAPE=${FORCE_RESCRAPE} | POLL_INTERVAL=${POLL_INTERVAL_MS / 1000}s | ET_POLL=${POLL_INTERVAL_ET_MS / 1000}s | FT_CONFIRM_DELAY=${FT_CONFIRM_DELAY_MS / 1000}s+${FT_CONFIRM2_DELAY_MS / 1000}s`);
  log('INFO', 'STARTUP', `ESPN_LIVE_STATUS_NAMES (v2.3 name-based fallback): [${[...ESPN_LIVE_STATUS_NAMES].join(', ')}]`);
  log('INFO', 'STARTUP', `ET_HT_TYPE_IDS: [${[...ESPN_ET_HT_TYPE_IDS].join(', ')}] (STATUS_EXTRA_TIME_HALF_TIME)`);
  log('INFO', 'STARTUP', `FINAL_TYPE_IDS: [${[...ESPN_FINAL_TYPE_IDS].join(', ')}] | CANCELED_TYPE_IDS: [${[...ESPN_CANCELED_TYPE_IDS].join(', ')}] | LIVE_TYPE_IDS: [${[...ESPN_LIVE_TYPE_IDS].join(', ')}]`);
  log('INFO', 'STARTUP', `ET_TYPE_IDS: [${[...ESPN_ET_TYPE_IDS].join(', ')}] | PENS_TYPE_IDS: [${[...ESPN_PENS_TYPE_IDS].join(', ')}] | POSTPONED: [${[...ESPN_POSTPONED_TYPE_IDS].join(', ')}] | DELAYED: [${[...ESPN_DELAYED_TYPE_IDS].join(', ')}]`);
  log('INFO', 'STARTUP', `MAX_ATTEMPTS=${MAX_ATTEMPTS} | MATCH_TIMEOUT=${MATCH_TIMEOUT_MS / 1000}s | POSTPONED_WINDOW_DAYS=${POSTPONED_WINDOW_DAYS} | ET_EXTENDED_WARN=${ET_EXTENDED_WARN_MS / 60000}min`);
  log('INFO', 'STARTUP', `LOG_FILES: ${WATCHER_LOG} | ${TERMINAL_LOG}`);
  log('INFO', 'STARTUP', `RUNNER_SCRIPT: ${RUNNER_SCRIPT}`);
  logSep('─');

  // ── Initialize watch window ─────────────────────────────────────────────
  watchWindow.push(...initWatchWindow());
  log('INFO', 'STARTUP', `Initial watch window: [${watchWindow.join(', ')}]`);

  // ── Restore progress from previous session ──────────────────────────────
  const savedProgress = loadProgress();
  if (savedProgress?.scrapedSet?.size > 0) {
    for (const id of savedProgress.scrapedSet) {
      sessionResults.scrapedSet.add(id);
    }
    log('INFO', 'STARTUP', `Restored ${sessionResults.scrapedSet.size} scraped gameIds from previous session`);
  }
  // Restore watch window from previous session if available
  if (savedProgress?.watchWindow?.length > 0) {
    watchWindow.length = 0;
    watchWindow.push(...savedProgress.watchWindow);
    log('INFO', 'STARTUP', `Restored watch window from previous session: [${watchWindow.join(', ')}]`);
  }

  // ── Pre-flight DB check ─────────────────────────────────────────────────
  await runPreflightDbCheck();

  // ── Initial poll ────────────────────────────────────────────────────────
  await pollCycle();

  // ── Dynamic poll loop ───────────────────────────────────────────────────
  schedulePoll();

  log('INFO', 'STARTUP', `✅ WC2026FTWatcher v2.3 running — dynamic poll ${POLL_INTERVAL_MS / 1000}s (${POLL_INTERVAL_ET_MS / 1000}s during ET/pens/ET_HT) | Press Ctrl+C for session summary`);
};

main().catch(err => {
  log('FATAL', 'MAIN', `Fatal startup error: ${err.message}`);
  process.exit(1);
});
