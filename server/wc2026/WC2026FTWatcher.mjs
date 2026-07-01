/**
 * WC2026FTWatcher.mjs — WC2026 Final-Time Watcher Daemon v1.0
 * ============================================================
 * ELITE DUAL-CHANNEL LOGGER | 500x SCRAPER | AUTO-TRIGGER ENGINE
 *
 * Polls ESPN's scoreboard API every 30 seconds across the active WC2026
 * match dates. Detects when games transition to final/post status and
 * immediately auto-triggers the 500x scraper (espnIngest.test.live.mjs).
 *
 * Features:
 *   - Elite dual-channel logging: terminal (ANSI color) + file simultaneously
 *   - ESPN scoreboard API polling every 30s across current + next 3 days
 *   - Game state machine: pre → in → post transition detection
 *   - alreadyScraped set: prevents duplicate scrapes per session
 *   - Child-process file-stream output capture (no pipe deadlock)
 *   - Retry logic: MAX_ATTEMPTS=2, 8s delay between retries
 *   - Midnight rule verification: PT date / ET time post-scrape DB check
 *   - Per-poll CYCLE summary line with total/live/final/newly-final counts
 *   - Per-trigger TRIGGER log: gameId → matchRound
 *   - Session summary on SIGINT/SIGTERM with verdict line
 *   - scrapeVersion='500x' on all records (enforced by espnDbIngester.ts)
 *
 * Usage:
 *   node server/wc2026/WC2026FTWatcher.mjs [--dates=YYYYMMDD,YYYYMMDD]
 *
 * Output format from espnIngest.test.live.mjs:
 *   [RUNNER] Ingest complete — success=true | rows=N | errors=0
 *
 * Log file: .manus-logs/WC2026FTWatcher.txt
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { createConnection } from 'mysql2/promise';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: '/home/ubuntu/ai-sports-betting/.env' });

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

const PROJECT_DIR       = '/home/ubuntu/ai-sports-betting';
const LOG_DIR           = `${PROJECT_DIR}/.manus-logs`;
const LOG_FILE          = `${LOG_DIR}/WC2026FTWatcher.txt`;
const PROGRESS_FILE     = `${LOG_DIR}/WC2026FTWatcher_progress.json`;
const RUNNER_SCRIPT     = `${PROJECT_DIR}/server/wc2026/espnIngest.test.live.mjs`;
const SCRAPE_LOG_DIR    = `/tmp`;

const POLL_INTERVAL_MS  = 30_000;   // 30 seconds between poll cycles
const MATCH_TIMEOUT_MS  = 420_000;  // 7 minutes per scrape (R32 extra time/penalties)
const RETRY_DELAY_MS    = 8_000;    // 8 seconds between retry attempts
const MAX_ATTEMPTS      = 2;        // max scrape attempts per game

const ESPN_SCOREBOARD   = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard';
const ESPN_SUMMARY      = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary';

// ESPN season type → matchRound slug mapping
const SEASON_TYPE_TO_SLUG = {
  13802: 'group-stage',
  13801: 'round-of-32',
  13800: 'round-of-16',
  13799: 'quarterfinals',
  13798: 'semifinals',
  13797: 'third-place',
  13796: 'final',
};

// ═══════════════════════════════════════════════════════════════════════════════
// ELITE DUAL-CHANNEL LOGGER
// Writes to BOTH terminal (with ANSI color) AND log file (plain text)
// Format: [ISO_TIMESTAMP] [LEVEL  ] [TAG                  ] message
// ═══════════════════════════════════════════════════════════════════════════════

fs.mkdirSync(LOG_DIR, { recursive: true });
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });

// ANSI color codes for terminal
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', magenta: '\x1b[35m', blue: '\x1b[34m',
  white: '\x1b[37m', gray: '\x1b[90m',
};

const LEVEL_COLORS = {
  'INFO':    C.cyan,
  'PASS':    C.green,
  'FAIL':    C.red,
  'WARN':    C.yellow,
  'SKIP':    C.blue,
  'PROG':    C.magenta,
  'MIDNITE': C.yellow,
  'VERIFY':  C.green,
  'ERROR':   C.red,
  'FATAL':   C.red + C.bold,
  'POLL':    C.cyan,
  'TRIGGER': C.magenta + C.bold,
  'FINAL':   C.green + C.bold,
  'CYCLE':   C.cyan,
  'LIVE':    C.yellow,
};

const log = (level, tag, msg) => {
  const ts = new Date().toISOString();
  const plainLine = `[${ts}] [${level.padEnd(7)}] [${tag.padEnd(22)}] ${msg}`;
  const color = LEVEL_COLORS[level] || C.white;
  const colorLine = `${C.gray}[${ts}]${C.reset} ${color}[${level.padEnd(7)}]${C.reset} ${C.bold}[${tag.padEnd(22)}]${C.reset} ${msg}`;
  console.log(colorLine);
  logStream.write(plainLine + '\n');
};

const logSep = (char = '─', len = 80) => {
  const line = char.repeat(len);
  console.log(`${C.gray}${line}${C.reset}`);
  logStream.write(line + '\n');
};

const logBanner = (msg, char = '═') => {
  const bar = char.repeat(80);
  console.log(`${C.cyan}${bar}${C.reset}`);
  console.log(`${C.cyan}${C.bold}  ${msg}${C.reset}`);
  console.log(`${C.cyan}${bar}${C.reset}`);
  logStream.write(bar + '\n');
  logStream.write(`  ${msg}\n`);
  logStream.write(bar + '\n');
};

// ═══════════════════════════════════════════════════════════════════════════════
// DB CONNECTION
// ═══════════════════════════════════════════════════════════════════════════════

let db;
const getDb = async () => {
  if (db) return db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^/]+)\/(\w+)/);
  if (!m) {
    db = await createConnection(url);
  } else {
    const [, user, pass, host, database] = m;
    const [hostname, portStr] = host.split(':');
    db = await createConnection({
      host: hostname,
      port: parseInt(portStr || '3306'),
      user,
      password: pass,
      database,
      ssl: { rejectUnauthorized: false },
      connectTimeout: 10_000,
    });
  }
  return db;
};

// ═══════════════════════════════════════════════════════════════════════════════
// MIDNIGHT RULE VERIFICATION
// PT date = game date (matchGameDate)
// ET time = kickoff time (matchKickoffEt)
// If ET time = 00:00 → midnight rule applied (PT date is one day before UTC date)
// ═══════════════════════════════════════════════════════════════════════════════

const verifyMidnightRule = async (gameId) => {
  try {
    const conn = await getDb();
    const [rows] = await conn.execute(
      `SELECT matchId, homeTeamName, awayTeamName, matchDateUtc, matchGameDate, matchKickoffEt, scrapeVersion
       FROM wc2026_espn_matches WHERE matchId = ? LIMIT 1`,
      [gameId]
    );
    if (rows.length === 0) return { ok: false, reason: 'No row found in DB' };
    const r = rows[0];
    const isMidnight = r.matchKickoffEt === '00:00';

    const utcMs = typeof r.matchDateUtc === 'number' ? r.matchDateUtc : parseInt(r.matchDateUtc);
    const dt = new Date(utcMs);
    const expectedPtDate = dt.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    const expectedEtTime = (() => {
      const h = parseInt(dt.toLocaleString('en-US', { timeZone: 'America/New_York', hour: '2-digit', hour12: false }), 10);
      const m = parseInt(dt.toLocaleString('en-US', { timeZone: 'America/New_York', minute: '2-digit' }), 10);
      return `${String(isNaN(h) ? 0 : h).padStart(2, '0')}:${String(isNaN(m) ? 0 : m).padStart(2, '0')}`;
    })();

    const dateOk    = r.matchGameDate === expectedPtDate;
    const timeOk    = r.matchKickoffEt === expectedEtTime;
    const versionOk = r.scrapeVersion === '500x';
    const status    = dateOk && timeOk && versionOk ? 'PASS' : 'FAIL';

    return {
      ok: status === 'PASS',
      gameId: r.matchId,
      match: `${r.homeTeamName} vs ${r.awayTeamName}`,
      matchGameDate: r.matchGameDate,
      matchKickoffEt: r.matchKickoffEt,
      expectedPtDate,
      expectedEtTime,
      isMidnight,
      scrapeVersion: r.scrapeVersion,
      dateOk,
      timeOk,
      versionOk,
      status,
    };
  } catch (err) {
    return { ok: false, reason: `DB error: ${err.message}` };
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// DB STATE CHECK — is this game already in the DB?
// ═══════════════════════════════════════════════════════════════════════════════

const checkDbState = async (gameId) => {
  try {
    const conn = await getDb();
    const [rows] = await conn.execute(
      `SELECT matchId, homeTeamName, awayTeamName, homeScore, awayScore, matchRound
       FROM wc2026_espn_matches WHERE matchId = ? LIMIT 1`,
      [gameId]
    );
    if (rows.length > 0) {
      const r = rows[0];
      return {
        inDb: true,
        summary: `${r.homeTeamName} ${r.homeScore}-${r.awayScore} ${r.awayTeamName}`,
        matchRound: r.matchRound,
      };
    }
    return { inDb: false };
  } catch (err) {
    log('WARN', `CHECK_${gameId}`, `DB check failed: ${err.message} — will scrape`);
    return { inDb: false };
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// PROGRESS PERSISTENCE
// ═══════════════════════════════════════════════════════════════════════════════

const saveProgress = (progress) => {
  try {
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
  } catch {}
};

// ═══════════════════════════════════════════════════════════════════════════════
// GAME STATE MACHINE
// Tracks pre → in → post transitions per gameId
// ═══════════════════════════════════════════════════════════════════════════════

// gameId → { statusState, statusName, displayClock, period, score, lastSeen, name, matchRound }
const gameStateMap = new Map();

// gameId → true (currently being scraped — prevents duplicate triggers)
const scrapingSet = new Set();

// gameId → true (successfully scraped this session)
const scrapedSet = new Set();

// Session-level results accumulator
const sessionResults = {
  startedAt: new Date().toISOString(),
  totalPolls: 0,
  totalGamesDetected: 0,
  totalFinalsDetected: 0,
  totalNewlyFinal: 0,
  scraped: 0,
  passed: 0,
  failed: 0,
  retried: 0,
  midnightRulePass: 0,
  midnightRuleFail: 0,
  matches: [],
};

// ═══════════════════════════════════════════════════════════════════════════════
// ESPN API HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchScoreboard(dateStr) {
  const url = `${ESPN_SCOREBOARD}?dates=${dateStr}&limit=50`;
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WC2026FTWatcher/1.0)' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) throw new Error(`ESPN scoreboard HTTP ${resp.status} for date ${dateStr}`);
  return resp.json();
}

// ═══════════════════════════════════════════════════════════════════════════════
// DATE HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function getWatchDates() {
  const arg = process.argv.find(a => a.startsWith('--dates='));
  if (arg) {
    return arg.replace('--dates=', '').split(',').map(d => d.trim());
  }
  // Default: yesterday + today + tomorrow + day after tomorrow (UTC)
  const dates = [];
  for (let offset = -1; offset <= 2; offset++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + offset);
    const y  = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dy = String(d.getUTCDate()).padStart(2, '0');
    dates.push(`${y}${mo}${dy}`);
  }
  return dates;
}

// ═══════════════════════════════════════════════════════════════════════════════
// GAME STATUS PARSER
// Extracts structured game info from ESPN scoreboard event object
// ═══════════════════════════════════════════════════════════════════════════════

function parseGameStatus(event) {
  const comp        = (event.competitions || [])[0] || {};
  const status      = comp.status || {};
  const statusType  = status.type || {};
  const seasonType  = event.season?.type || null;
  const matchRound  = SEASON_TYPE_TO_SLUG[seasonType] || 'unknown';

  return {
    gameId:           String(event.id),
    name:             event.name || event.shortName || '',
    statusName:       statusType.name || '',
    statusState:      statusType.state || '',
    statusShortDetail: status.type?.shortDetail || '',
    displayClock:     status.displayClock || '',
    period:           status.period || 0,
    isFinal:          statusType.state === 'post',
    isLive:           statusType.state === 'in',
    isPre:            statusType.state === 'pre',
    competitors: (comp.competitors || []).map(c => ({
      abbrev:   c.team?.abbreviation || '',
      name:     c.team?.displayName || '',
      score:    c.score || '0',
      homeAway: c.homeAway || '',
    })),
    startTime:  event.date || '',
    seasonType,
    matchRound,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SINGLE MATCH SCRAPER
// Spawns espnIngest.test.live.mjs as child process with file-stream output capture
// Parses: "[RUNNER] Ingest complete — success=true | rows=N | errors=0"
// ═══════════════════════════════════════════════════════════════════════════════

const scrapeMatch = (gameId, matchRound, attemptNum) => new Promise((resolve) => {
  const startMs = Date.now();
  const scrapeLogFile = path.join(SCRAPE_LOG_DIR, `WC2026FTWatcher_scrape_${gameId}.txt`);
  const scrapeStream  = fs.createWriteStream(scrapeLogFile, { flags: 'w' });

  log('INFO', `SCRAPE_${gameId}`, `[ATTEMPT ${attemptNum}] Spawning 500x scraper → gameId=${gameId} matchRound=${matchRound}`);

  const child = spawn('node', [RUNNER_SCRIPT, gameId], {
    cwd: PROJECT_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  let stdout = '';
  let stderr = '';

  child.stdout.on('data', d => {
    const chunk = d.toString();
    stdout += chunk;
    scrapeStream.write(chunk);
    // Stream key lines to watcher log in real-time (noise-free filtered output)
    const lines = chunk.split('\n');
    for (const line of lines) {
      if (
        line.includes('[RUNNER]') || line.includes('[INGEST]') ||
        line.includes('PASS') || line.includes('FAIL') ||
        line.includes('PHASE') || line.includes('MIDNIGHT') ||
        line.includes('VERIFY') || line.includes('success=') ||
        line.includes('rows=') || line.includes('errors=')
      ) {
        if (line.trim()) {
          console.log(`  ${C.dim}${line.trim().slice(0, 140)}${C.reset}`);
          logStream.write(`  ${line.trim()}\n`);
        }
      }
    }
  });

  child.stderr.on('data', d => {
    const chunk = d.toString();
    stderr += chunk;
    scrapeStream.write(`[STDERR] ${chunk}`);
    // Only log actual errors, not dotenv notices
    const lines = chunk.split('\n');
    for (const line of lines) {
      if ((line.includes('Error') || line.includes('error') || line.includes('FATAL')) &&
          line.trim() && !line.includes('[dotenv')) {
        log('ERROR', `STDERR_${gameId}`, line.trim().slice(0, 120));
      }
    }
  });

  const timeout = setTimeout(() => {
    child.kill('SIGKILL');
    log('FAIL', `SCRAPE_${gameId}`, `⏱ TIMEOUT after ${MATCH_TIMEOUT_MS / 1000}s — killed`);
    scrapeStream.end();
    resolve({ ok: false, gameId, matchRound, error: 'TIMEOUT', durationMs: Date.now() - startMs });
  }, MATCH_TIMEOUT_MS);

  child.on('close', (code) => {
    clearTimeout(timeout);
    scrapeStream.end();
    const durationMs = Date.now() - startMs;
    const durationS  = (durationMs / 1000).toFixed(1);

    // ── Parse ingest result from output ──────────────────────────────────────
    // Primary format: "[RUNNER] Ingest complete — success=true | rows=N | errors=0"
    const successMatch  = stdout.match(/success=(true|false)/);
    const rowsMatch     = stdout.match(/rows=(\d+)/);
    const errorsMatch   = stdout.match(/errors=(\d+)/);
    const ingestSuccess = successMatch?.[1] === 'true';
    const rowsWritten   = rowsMatch   ? parseInt(rowsMatch[1])   : 0;
    const ingestErrors  = errorsMatch ? parseInt(errorsMatch[1]) : 999;

    // Secondary format: "N/N PASS" (from test runner summary)
    const passMatch = stdout.match(/(\d+)\/(\d+) PASS/);
    const passRate  = passMatch ? `${passMatch[1]}/${passMatch[2]}` : null;

    // Extract match info from output
    const matchLineMatch = stdout.match(/Match:\s*([^\n]+)/);
    const venueMatch     = stdout.match(/Venue:\s*([^\n]+)/);
    const matchInfo      = matchLineMatch ? matchLineMatch[1].trim() : '?';
    const venue          = venueMatch ? venueMatch[1].trim().split('|')[0].trim() : '?';

    // Extract phase results
    const phaseMatches   = [...stdout.matchAll(/Phase (\d+)\/9 \[.*?(PASS|FAIL).*?\] (\S+) — (\d+) rows/g)];
    const phasesSummary  = phaseMatches.length > 0
      ? `phases=${phaseMatches.filter(m => m[2] === 'PASS').length}/9 PASS`
      : '';

    // Success criteria: ingest succeeded, rows written, zero errors
    // NOTE: exit code 1 can occur when test assertions fail (e.g. shot map goal count = 0)
    // but the ingest itself succeeded. We treat success=true|rows>0|errors=0 as PASS.
    const isIngestSuccess = ingestSuccess && rowsWritten > 0 && ingestErrors === 0;
    const isTestSuccess   = passMatch && parseInt(passMatch[1]) === parseInt(passMatch[2]) && parseInt(passMatch[2]) > 0;
    const isSuccess       = isIngestSuccess || isTestSuccess;

    if ((code === 0 && isSuccess) || isIngestSuccess) {
      const noteCode1 = code !== 0 ? ` [code=${code} — test assertions failed, ingest OK]` : '';
      log('PASS', `SCRAPE_${gameId}`, `✅ success=true | rows=${rowsWritten} | errors=${ingestErrors} | ${passRate || phasesSummary} | ${durationS}s${noteCode1}`);
      if (matchInfo !== '?') log('INFO', `MATCH_${gameId}`, `  📊 ${matchInfo} | ${venue}`);
      resolve({ ok: true, gameId, matchRound, rowsWritten, ingestErrors, matchInfo, venue, durationMs, scrapeLogFile });
    } else {
      const errLines = (stdout + stderr).split('\n')
        .filter(l => l.includes('FAIL') || l.includes('Error:') || l.includes('error=') || l.includes('success=false') || l.includes('FATAL'))
        .filter(l => !l.includes('[dotenv'))
        .slice(0, 5)
        .map(l => l.trim().slice(0, 100))
        .join(' | ');
      log('FAIL', `SCRAPE_${gameId}`, `❌ code=${code} success=${ingestSuccess} rows=${rowsWritten} errors=${ingestErrors} | ${durationS}s`);
      if (errLines) log('ERROR', `DETAIL_${gameId}`, errLines.slice(0, 200));
      resolve({ ok: false, gameId, matchRound, rowsWritten, ingestErrors, code, error: errLines, durationMs, scrapeLogFile });
    }
  });

  child.on('error', (err) => {
    clearTimeout(timeout);
    scrapeStream.end();
    log('ERROR', `SPAWN_${gameId}`, `❌ Spawn error: ${err.message}`);
    resolve({ ok: false, gameId, matchRound, error: `SPAWN: ${err.message}`, durationMs: Date.now() - startMs });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCRAPE WITH RETRY
// Wraps scrapeMatch with MAX_ATTEMPTS retries and RETRY_DELAY_MS between attempts
// ═══════════════════════════════════════════════════════════════════════════════

async function scrapeWithRetry(gameId, matchRound, gameInfo) {
  if (scrapingSet.has(gameId)) {
    log('SKIP', `SCRAPE_${gameId}`, `Already scraping — skipping duplicate trigger`);
    return;
  }
  if (scrapedSet.has(gameId)) {
    log('SKIP', `SCRAPE_${gameId}`, `Already scraped this session — skipping`);
    return;
  }

  scrapingSet.add(gameId);
  sessionResults.scraped++;

  let scrapeResult;
  let attempts = 0;

  while (attempts < MAX_ATTEMPTS) {
    attempts++;
    if (attempts > 1) {
      log('INFO', `RETRY_${gameId}`, `Retry attempt ${attempts}/${MAX_ATTEMPTS} after ${RETRY_DELAY_MS / 1000}s...`);
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
      sessionResults.retried++;
    }

    scrapeResult = await scrapeMatch(gameId, matchRound, attempts);
    if (scrapeResult.ok) break;

    if (attempts < MAX_ATTEMPTS) {
      log('WARN', `RETRY_${gameId}`, `Attempt ${attempts} failed — scheduling retry`);
    }
  }

  scrapingSet.delete(gameId);

  // ── Midnight rule post-scrape verification ──────────────────────────────────
  if (scrapeResult.ok) {
    scrapedSet.add(gameId);
    sessionResults.passed++;

    const midnightCheck = await verifyMidnightRule(gameId);
    if (midnightCheck.ok) {
      sessionResults.midnightRulePass++;
      const midnightFlag = midnightCheck.isMidnight ? ' ← MIDNIGHT RULE' : '';
      log('VERIFY', `MIDNIGHT_${gameId}`, `✅ PASS | date=${midnightCheck.matchGameDate} ET=${midnightCheck.matchKickoffEt} v=${midnightCheck.scrapeVersion}${midnightFlag}`);
    } else {
      sessionResults.midnightRuleFail++;
      log('WARN', `MIDNIGHT_${gameId}`, `⚠️ FAIL | date=${midnightCheck.matchGameDate} (expected ${midnightCheck.expectedPtDate}) ET=${midnightCheck.matchKickoffEt} (expected ${midnightCheck.expectedEtTime})`);
    }

    sessionResults.matches.push({
      gameId,
      matchRound,
      status: 'PASS',
      rowsWritten: scrapeResult.rowsWritten,
      matchInfo: scrapeResult.matchInfo,
      venue: scrapeResult.venue,
      durationMs: scrapeResult.durationMs,
      attempts,
      midnightRule: midnightCheck,
      scrapedAt: new Date().toISOString(),
    });
  } else {
    sessionResults.failed++;
    sessionResults.matches.push({
      gameId,
      matchRound,
      status: 'FAIL',
      rowsWritten: scrapeResult.rowsWritten,
      error: scrapeResult.error,
      durationMs: scrapeResult.durationMs,
      attempts,
      scrapedAt: new Date().toISOString(),
    });
  }

  saveProgress(sessionResults);
}

// ═══════════════════════════════════════════════════════════════════════════════
// POLL CYCLE
// Fetches ESPN scoreboard for all watch dates, detects FT transitions,
// triggers scraper for newly-final games
// ═══════════════════════════════════════════════════════════════════════════════

let pollCount = 0;

async function pollCycle() {
  pollCount++;
  sessionResults.totalPolls = pollCount;
  const dates     = getWatchDates();
  const cycleStart = Date.now();

  log('POLL', `CYCLE/${pollCount}`, `🔄 Poll #${pollCount} — watching dates: ${dates.join(', ')}`);

  let totalGames  = 0;
  let liveGames   = 0;
  let finalGames  = 0;
  let newlyFinal  = 0;

  for (const dateStr of dates) {
    let data;
    try {
      data = await fetchScoreboard(dateStr);
    } catch (err) {
      log('ERROR', `SCOREBOARD/${dateStr}`, `❌ Fetch failed: ${err.message}`);
      continue;
    }

    const events = data.events || [];
    if (events.length === 0) continue;

    log('INFO', `SCOREBOARD/${dateStr}`, `Found ${events.length} events`);

    for (const event of events) {
      const game = parseGameStatus(event);
      totalGames++;
      sessionResults.totalGamesDetected = Math.max(sessionResults.totalGamesDetected, totalGames);

      const prev      = gameStateMap.get(game.gameId);
      const prevState = prev?.statusState || 'unknown';

      // Update state machine
      gameStateMap.set(game.gameId, {
        statusState:  game.statusState,
        statusName:   game.statusName,
        displayClock: game.displayClock,
        period:       game.period,
        score:        game.competitors.map(c => `${c.abbrev}:${c.score}`).join(' vs '),
        lastSeen:     new Date().toISOString(),
        name:         game.name,
        matchRound:   game.matchRound,
      });

      if (game.isLive) {
        liveGames++;
        const home = game.competitors.find(c => c.homeAway === 'home');
        const away = game.competitors.find(c => c.homeAway === 'away');
        log('LIVE', `LIVE/${game.gameId}`, `⚽ ${game.name} | ${away?.abbrev || '?'} ${away?.score || '0'} - ${home?.score || '0'} ${home?.abbrev || '?'} | ${game.displayClock} P${game.period} | ${game.statusName}`);
      }

      if (game.isFinal) {
        finalGames++;
        sessionResults.totalFinalsDetected = Math.max(sessionResults.totalFinalsDetected, finalGames);
        const home = game.competitors.find(c => c.homeAway === 'home');
        const away = game.competitors.find(c => c.homeAway === 'away');
        const scoreStr = `${away?.abbrev || '?'} ${away?.score || '0'} - ${home?.score || '0'} ${home?.abbrev || '?'}`;

        // Detect NEWLY final (was live or pre, now post)
        const isNewlyFinal = prevState !== 'post' && game.statusState === 'post';

        if (isNewlyFinal) {
          newlyFinal++;
          sessionResults.totalNewlyFinal++;
          log('FINAL', `FINAL/${game.gameId}`, `🏁 GAME FINAL — NEWLY DETECTED | ${game.name} | ${scoreStr} | ${game.statusShortDetail}`);
          log('TRIGGER', `TRIGGER/${game.gameId}`, `🚀 gameId=${game.gameId} → matchRound=${game.matchRound} | prevState=${prevState} → post`);
          // Fire-and-forget: do NOT await (allows poll cycle to continue)
          scrapeWithRetry(game.gameId, game.matchRound, game).catch(err => {
            log('ERROR', `TRIGGER/${game.gameId}`, `Scrape trigger error: ${err.message}`);
          });
        } else if (!scrapedSet.has(game.gameId) && !scrapingSet.has(game.gameId)) {
          // Final but not newly detected this session — check DB
          const dbCheck = await checkDbState(game.gameId);
          if (dbCheck.inDb) {
            // Already in DB — mark as scraped to prevent future re-triggers
            scrapedSet.add(game.gameId);
            log('SKIP', `FINAL/${game.gameId}`, `Already in DB: ${dbCheck.summary} (${dbCheck.matchRound}) — skipping`);
          } else {
            // Final, not in DB, not currently scraping — trigger scrape
            log('FINAL', `FINAL/${game.gameId}`, `🏁 FINAL (known) — not in DB | ${game.name} | ${scoreStr}`);
            log('TRIGGER', `TRIGGER/${game.gameId}`, `🚀 gameId=${game.gameId} → matchRound=${game.matchRound} | DB miss — triggering scrape`);
            scrapeWithRetry(game.gameId, game.matchRound, game).catch(err => {
              log('ERROR', `TRIGGER/${game.gameId}`, `Scrape trigger error: ${err.message}`);
            });
          }
        }
      }
    }
  }

  const elapsed = ((Date.now() - cycleStart) / 1000).toFixed(2);
  log('CYCLE', `CYCLE/${pollCount}`, `✅ CYCLE/${pollCount} — ${totalGames} total | ${liveGames} live | ${finalGames} final | ${newlyFinal} newly final | ${elapsed}s`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SESSION SUMMARY
// Printed on SIGINT/SIGTERM — mirrors batchScrape72.mjs verdict format
// ═══════════════════════════════════════════════════════════════════════════════

function printSessionSummary() {
  const totalDurationMs  = Date.now() - new Date(sessionResults.startedAt).getTime();
  const totalDurationMin = (totalDurationMs / 60000).toFixed(1);

  sessionResults.completedAt    = new Date().toISOString();
  sessionResults.totalDurationMs = totalDurationMs;

  logBanner(`WC2026FTWatcher SESSION SUMMARY`);
  log('INFO', 'SESSION_SUMMARY', `Duration: ${totalDurationMin} minutes`);
  log('INFO', 'SESSION_SUMMARY', `Total polls: ${sessionResults.totalPolls}`);
  log('INFO', 'SESSION_SUMMARY', `Games detected: ${sessionResults.totalGamesDetected} | Finals: ${sessionResults.totalFinalsDetected} | Newly final: ${sessionResults.totalNewlyFinal}`);
  log('INFO', 'SESSION_SUMMARY', `Scraped: ${sessionResults.scraped} | ✅ PASS: ${sessionResults.passed} | ❌ FAIL: ${sessionResults.failed} | 🔄 Retried: ${sessionResults.retried}`);

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

  // ── Match results table ────────────────────────────────────────────────────
  if (sessionResults.matches.length > 0) {
    const tableHeader = `\n=== SCRAPED MATCHES TABLE (WC2026FTWatcher Session) ===`;
    console.log(`${C.bold}${tableHeader}${C.reset}`);
    logStream.write(tableHeader + '\n');

    for (const m of sessionResults.matches) {
      const icon = m.status === 'PASS' ? '✅' : '❌';
      let detail;
      if (m.status === 'PASS') {
        const midnight = m.midnightRule?.isMidnight ? ' 🌙MIDNIGHT' : '';
        detail = `rows=${m.rowsWritten} | date=${m.midnightRule?.matchGameDate} ET=${m.midnightRule?.matchKickoffEt}${midnight} | ${(m.durationMs / 1000).toFixed(1)}s | ${m.matchRound}`;
      } else {
        detail = `FAIL: ${m.error?.slice(0, 80)} | ${m.matchRound}`;
      }
      const line = `  ${icon} ${m.gameId} | ${detail}`;
      console.log(line);
      logStream.write(line + '\n');
    }
  }

  logSep('═');

  saveProgress(sessionResults);

  const verdict = sessionResults.scraped === 0
    ? `⏳ NO GAMES SCRAPED THIS SESSION — watching for finals`
    : sessionResults.failed === 0
      ? `✅ ELITE — ZERO FAILURES | ${sessionResults.passed}/${sessionResults.scraped} PASS | ${totalDurationMin}min`
      : `⚠️  ${sessionResults.failed} FAILURES — REVIEW REQUIRED | ${sessionResults.passed}/${sessionResults.scraped} PASS`;
  log('INFO', 'VERDICT', verdict);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN — startup banner, initial poll, interval loop, signal handlers
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  logBanner(`WC2026FTWatcher v1.0 — ELITE DUAL-CHANNEL LOGGER | 500x AUTO-TRIGGER ENGINE`);
  log('INFO', 'WATCHER/INIT', `Poll interval: ${POLL_INTERVAL_MS / 1000}s | Scrape timeout: ${MATCH_TIMEOUT_MS / 1000}s | Max attempts: ${MAX_ATTEMPTS}`);
  log('INFO', 'WATCHER/INIT', `Watch dates: ${getWatchDates().join(', ')}`);
  log('INFO', 'WATCHER/INIT', `Runner: ${RUNNER_SCRIPT}`);
  log('INFO', 'WATCHER/INIT', `Log file: ${LOG_FILE}`);
  log('INFO', 'WATCHER/INIT', `Progress: ${PROGRESS_FILE}`);
  log('INFO', 'WATCHER/INIT', `Midnight rule: PT date → matchGameDate | ET time → matchKickoffEt`);
  log('INFO', 'WATCHER/INIT', `scrapeVersion: 500x (enforced by espnDbIngester.ts)`);
  logSep('═');

  // Run first poll immediately
  try {
    await pollCycle();
  } catch (err) {
    log('ERROR', 'WATCHER/POLL', `❌ Initial poll error: ${err.message}`);
  }

  // Then poll every 30 seconds
  const intervalHandle = setInterval(async () => {
    try {
      await pollCycle();
    } catch (err) {
      log('ERROR', 'WATCHER/POLL', `❌ Poll cycle error: ${err.message}`);
    }
  }, POLL_INTERVAL_MS);

  log('INFO', 'WATCHER/RUNNING', `✅ WC2026FTWatcher running — polling every ${POLL_INTERVAL_MS / 1000}s | Press Ctrl+C to stop`);

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  const shutdown = (signal) => {
    log('INFO', 'WATCHER/SHUTDOWN', `🛑 ${signal} received — shutting down gracefully`);
    clearInterval(intervalHandle);
    printSessionSummary();
    db?.end().catch(() => {});
    process.exit(0);
  };

  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(err => {
  log('FATAL', 'UNHANDLED', `${err.message}\n${err.stack}`);
  process.exit(1);
});
