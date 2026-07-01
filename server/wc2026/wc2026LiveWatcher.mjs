/**
 * WC2026 LIVE GAME WATCHER DAEMON — 500x EDITION
 * ================================================
 * Polls ESPN's scoreboard API every 30 seconds.
 * Detects when games transition to final/post status.
 * Auto-triggers the 500x scraper for newly completed games.
 * Logs everything in 500x fashion to both terminal and file.
 *
 * Usage:
 *   node server/wc2026/wc2026LiveWatcher.mjs [--dates 20260701,20260702]
 *
 * Default: watches today + tomorrow (UTC) for WC2026 matches.
 */

import { spawn } from 'child_process';
import { createWriteStream, mkdirSync, existsSync } from 'fs';
import { appendFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../../');

// ─── CONFIG ────────────────────────────────────────────────────────────────
const POLL_INTERVAL_MS = 30_000;          // 30 seconds
const SCRAPE_TIMEOUT_MS = 600_000;        // 10 minutes per scrape (R32 can take 7min+)
const ESPN_SCOREBOARD_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard';
const ESPN_SUMMARY_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary';
const LEAGUE_ID = 'fifa.world';

// WC2026 R32 season type
const SEASON_TYPE_TO_SLUG = {
  13802: 'group-stage',
  13801: 'round-of-32',
  13800: 'round-of-16',
  13799: 'quarterfinals',
  13798: 'semifinals',
  13797: 'third-place',
  13796: 'final',
};

// ─── LOG SETUP ─────────────────────────────────────────────────────────────
const LOG_DIR = path.join(PROJECT_ROOT, '.manus-logs');
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

const LOG_FILE = path.join(LOG_DIR, 'wc2026LiveWatcher.txt');
const SCRAPE_LOG_DIR = path.join('/tmp');

// Initialize log file with header
const startHeader = `
${'═'.repeat(80)}
  WC2026 LIVE GAME WATCHER — 500x EDITION
  Started: ${new Date().toISOString()}
  Poll Interval: ${POLL_INTERVAL_MS / 1000}s
  Scrape Timeout: ${SCRAPE_TIMEOUT_MS / 1000}s
  Log: ${LOG_FILE}
${'═'.repeat(80)}
`;
appendFileSync(LOG_FILE, startHeader);
process.stdout.write(startHeader);

// ─── LOGGER ────────────────────────────────────────────────────────────────
const LEVELS = {
  INFO:    'INFO   ',
  POLL:    'POLL   ',
  LIVE:    'LIVE   ',
  FINAL:   'FINAL  ',
  SCRAPE:  'SCRAPE ',
  PASS:    'PASS   ',
  FAIL:    'FAIL   ',
  WARN:    'WARN   ',
  STATUS:  'STATUS ',
  DETECT:  'DETECT ',
  SKIP:    'SKIP   ',
  TRIGGER: 'TRIGGER',
  ERROR:   'ERROR  ',
};

function log(level, tag, msg, data = null) {
  const ts = new Date().toISOString();
  const dataStr = data ? ` | ${typeof data === 'string' ? data : JSON.stringify(data)}` : '';
  const line = `[${ts}] [${level}] [${tag.padEnd(32)}] ${msg}${dataStr}\n`;
  process.stdout.write(line);
  appendFileSync(LOG_FILE, line);
}

// ─── STATE TRACKING ────────────────────────────────────────────────────────
// gameId → { status, score, lastSeen, scraped }
const gameState = new Map();
// gameId → true (currently being scraped)
const scraping = new Set();
// gameId → true (already scraped successfully)
const scraped = new Set();

// ─── ESPN API HELPERS ──────────────────────────────────────────────────────
async function fetchScoreboard(dateStr) {
  // dateStr: YYYYMMDD
  const url = `${ESPN_SCOREBOARD_BASE}?dates=${dateStr}&limit=50`;
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WC2026Watcher/1.0)' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) throw new Error(`ESPN scoreboard HTTP ${resp.status} for date ${dateStr}`);
  return resp.json();
}

async function fetchSummary(gameId) {
  const url = `${ESPN_SUMMARY_BASE}?event=${gameId}`;
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WC2026Watcher/1.0)' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) throw new Error(`ESPN summary HTTP ${resp.status} for game ${gameId}`);
  return resp.json();
}

// ─── DATE HELPERS ──────────────────────────────────────────────────────────
function getWatchDates() {
  // Parse --dates arg or default to today + tomorrow UTC
  const arg = process.argv.find(a => a.startsWith('--dates='));
  if (arg) {
    return arg.replace('--dates=', '').split(',').map(d => d.trim());
  }
  const dates = [];
  for (let offset = -1; offset <= 2; offset++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + offset);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    dates.push(`${y}${m}${day}`);
  }
  return dates;
}

function utcToEtTime(isoString) {
  // Convert UTC ISO string to ET time string (HH:MM)
  const d = new Date(isoString);
  // ET = UTC-4 (EDT) or UTC-5 (EST). WC2026 is June-July = EDT (UTC-4)
  const etOffset = -4 * 60; // minutes
  const etMs = d.getTime() + etOffset * 60_000;
  const etDate = new Date(etMs);
  const hh = String(etDate.getUTCHours()).padStart(2, '0');
  const mm = String(etDate.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function utcToPtDate(isoString) {
  // Convert UTC ISO string to PT date string (YYYY-MM-DD) — midnight rule
  const d = new Date(isoString);
  // PT = UTC-7 (PDT) during WC2026 (June-July)
  const ptOffset = -7 * 60; // minutes
  const ptMs = d.getTime() + ptOffset * 60_000;
  const ptDate = new Date(ptMs);
  const y = ptDate.getUTCFullYear();
  const m = String(ptDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(ptDate.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ─── GAME STATUS PARSER ────────────────────────────────────────────────────
function parseGameStatus(event) {
  const comp = (event.competitions || [])[0] || {};
  const status = comp.status || {};
  const statusType = status.type || {};

  return {
    gameId: String(event.id),
    name: event.name || event.shortName || '',
    statusName: statusType.name || '',        // e.g. STATUS_FINAL, STATUS_SECOND_HALF
    statusState: statusType.state || '',      // 'pre', 'in', 'post'
    statusShortDetail: status.type?.shortDetail || '',
    displayClock: status.displayClock || '',
    period: status.period || 0,
    isFinal: statusType.state === 'post',
    isLive: statusType.state === 'in',
    isPre: statusType.state === 'pre',
    competitors: (comp.competitors || []).map(c => ({
      abbrev: c.team?.abbreviation || '',
      name: c.team?.displayName || '',
      score: c.score || '0',
      homeAway: c.homeAway || '',
    })),
    startTime: event.date || '',
    seasonType: event.season?.type || null,
    seasonName: event.season?.slug || event.season?.name || '',
  };
}

// ─── SCRAPER TRIGGER ───────────────────────────────────────────────────────
async function triggerScrape(gameId, gameInfo) {
  if (scraping.has(gameId)) {
    log(LEVELS.SKIP, `SCRAPE/${gameId}`, `Already scraping — skipping duplicate trigger`);
    return;
  }
  if (scraped.has(gameId)) {
    log(LEVELS.SKIP, `SCRAPE/${gameId}`, `Already scraped successfully — skipping`);
    return;
  }

  scraping.add(gameId);
  const scrapeLogFile = path.join(SCRAPE_LOG_DIR, `watcher_scrape_${gameId}.txt`);
  const logStream = createWriteStream(scrapeLogFile, { flags: 'w' });

  log(LEVELS.TRIGGER, `SCRAPE/${gameId}`, `🚀 TRIGGERING 500x SCRAPE`, {
    match: gameInfo.name,
    score: gameInfo.competitors.map(c => `${c.abbrev}:${c.score}`).join(' vs '),
    status: gameInfo.statusName,
    logFile: scrapeLogFile,
  });

  const runnerScript = path.join(__dirname, 'espnIngest.test.live.mjs');
  const startMs = Date.now();

  return new Promise((resolve) => {
    const child = spawn('node', [runnerScript, gameId, '--force'], {
      cwd: PROJECT_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      logStream.write(text);
      // Stream key lines to watcher log
      const lines = text.split('\n').filter(l => l.trim());
      for (const line of lines) {
        if (/\[PHASE\]|\[PASS\]|\[FAIL\]|\[ERROR\]|\[SUCCESS\]|success=|rows=|errors=/.test(line)) {
          log(LEVELS.SCRAPE, `OUTPUT/${gameId}`, line.trim().substring(0, 120));
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      logStream.write(`[STDERR] ${text}`);
    });

    const timeoutHandle = setTimeout(() => {
      log(LEVELS.WARN, `SCRAPE/${gameId}`, `⏱ TIMEOUT after ${SCRAPE_TIMEOUT_MS / 1000}s — killing child`);
      child.kill('SIGKILL');
    }, SCRAPE_TIMEOUT_MS);

    child.on('close', (code) => {
      clearTimeout(timeoutHandle);
      logStream.end();
      const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);

      // Detect success: success=true | rows=N | errors=0
      const isIngestSuccess = /success=true/.test(stdout) && /errors=0/.test(stdout);
      const rowsMatch = stdout.match(/rows=(\d+)/);
      const rows = rowsMatch ? parseInt(rowsMatch[1]) : 0;

      if (isIngestSuccess && rows > 0) {
        scraped.add(gameId);
        scraping.delete(gameId);
        log(LEVELS.PASS, `SCRAPE/${gameId}`, `✅ SCRAPE COMPLETE — ${rows} rows in ${elapsed}s`, {
          match: gameInfo.name,
          exitCode: code,
          rows,
          elapsed: `${elapsed}s`,
          logFile: scrapeLogFile,
        });
        resolve({ success: true, rows, elapsed });
      } else {
        scraping.delete(gameId);
        log(LEVELS.FAIL, `SCRAPE/${gameId}`, `❌ SCRAPE FAILED — exitCode=${code} rows=${rows} elapsed=${elapsed}s`, {
          match: gameInfo.name,
          exitCode: code,
          rows,
          stdout: stdout.slice(-500),
        });
        // Schedule retry in 60 seconds
        log(LEVELS.WARN, `SCRAPE/${gameId}`, `🔄 Scheduling retry in 60s`);
        setTimeout(() => triggerScrape(gameId, gameInfo), 60_000);
        resolve({ success: false, rows, elapsed });
      }
    });

    child.on('error', (err) => {
      clearTimeout(timeoutHandle);
      logStream.end();
      scraping.delete(gameId);
      log(LEVELS.ERROR, `SCRAPE/${gameId}`, `❌ SPAWN ERROR: ${err.message}`);
      setTimeout(() => triggerScrape(gameId, gameInfo), 60_000);
      resolve({ success: false, error: err.message });
    });
  });
}

// ─── POLL CYCLE ────────────────────────────────────────────────────────────
let pollCount = 0;
let lastScoreboardSnapshot = {};  // gameId → statusState for change detection

async function pollCycle() {
  pollCount++;
  const dates = getWatchDates();
  const cycleStart = Date.now();

  log(LEVELS.POLL, `CYCLE/${pollCount}`, `🔄 Poll #${pollCount} — watching dates: ${dates.join(', ')}`);

  let totalGames = 0;
  let liveGames = 0;
  let finalGames = 0;
  let newFinals = 0;

  for (const dateStr of dates) {
    let data;
    try {
      data = await fetchScoreboard(dateStr);
    } catch (err) {
      log(LEVELS.ERROR, `SCOREBOARD/${dateStr}`, `❌ Fetch failed: ${err.message}`);
      continue;
    }

    const events = data.events || [];
    if (events.length === 0) continue;

    log(LEVELS.STATUS, `SCOREBOARD/${dateStr}`, `Found ${events.length} events`);

    for (const event of events) {
      const game = parseGameStatus(event);
      totalGames++;

      const prev = gameState.get(game.gameId);
      const prevState = prev?.statusState || 'unknown';

      // Update state
      gameState.set(game.gameId, {
        statusState: game.statusState,
        statusName: game.statusName,
        displayClock: game.displayClock,
        period: game.period,
        score: game.competitors.map(c => `${c.abbrev}:${c.score}`).join(' vs '),
        lastSeen: new Date().toISOString(),
        name: game.name,
      });

      if (game.isLive) {
        liveGames++;
        const home = game.competitors.find(c => c.homeAway === 'home');
        const away = game.competitors.find(c => c.homeAway === 'away');
        log(LEVELS.LIVE, `LIVE/${game.gameId}`, `⚽ ${game.name}`, {
          score: `${away?.abbrev || '?'} ${away?.score || '0'} - ${home?.score || '0'} ${home?.abbrev || '?'}`,
          clock: `${game.displayClock} | Period ${game.period}`,
          status: game.statusName,
        });
      }

      if (game.isFinal) {
        finalGames++;
        const home = game.competitors.find(c => c.homeAway === 'home');
        const away = game.competitors.find(c => c.homeAway === 'away');

        // Detect NEWLY final (was live or pre, now post)
        const isNewlyFinal = prevState !== 'post' && game.statusState === 'post';

        if (isNewlyFinal) {
          newFinals++;
          log(LEVELS.FINAL, `FINAL/${game.gameId}`, `🏁 GAME FINAL — NEWLY DETECTED`, {
            match: game.name,
            score: `${away?.abbrev || '?'} ${away?.score || '0'} - ${home?.score || '0'} ${home?.abbrev || '?'}`,
            statusDetail: game.statusShortDetail,
            prevState,
            seasonType: game.seasonType,
          });
          // Trigger scrape immediately
          triggerScrape(game.gameId, game);
        } else if (!scraped.has(game.gameId) && !scraping.has(game.gameId)) {
          // Final but not newly detected — check if it's in DB
          log(LEVELS.DETECT, `FINAL/${game.gameId}`, `🏁 FINAL (known) — checking DB status`, {
            match: game.name,
            score: `${away?.abbrev || '?'} ${away?.score || '0'} - ${home?.score || '0'} ${home?.abbrev || '?'}`,
          });
          // Trigger scrape for any final not yet scraped in this session
          triggerScrape(game.gameId, game);
        }
      }
    }
  }

  const elapsed = ((Date.now() - cycleStart) / 1000).toFixed(2);
  log(LEVELS.POLL, `CYCLE/${pollCount}`, `✅ Poll #${pollCount} complete — ${totalGames} total | ${liveGames} live | ${finalGames} final | ${newFinals} newly final | ${elapsed}s`);
}

// ─── MAIN LOOP ─────────────────────────────────────────────────────────────
async function main() {
  log(LEVELS.INFO, 'WATCHER/INIT', '🚀 WC2026 Live Watcher starting', {
    pollIntervalSec: POLL_INTERVAL_MS / 1000,
    scrapeTimeoutSec: SCRAPE_TIMEOUT_MS / 1000,
    watchDates: getWatchDates(),
    logFile: LOG_FILE,
  });

  // Run first poll immediately
  await pollCycle();

  // Then poll every 30 seconds
  const intervalHandle = setInterval(async () => {
    try {
      await pollCycle();
    } catch (err) {
      log(LEVELS.ERROR, 'WATCHER/POLL', `❌ Poll cycle error: ${err.message}`);
    }
  }, POLL_INTERVAL_MS);

  // Graceful shutdown
  process.on('SIGINT', () => {
    log(LEVELS.INFO, 'WATCHER/SHUTDOWN', '🛑 SIGINT received — shutting down gracefully');
    clearInterval(intervalHandle);
    const footer = `\n${'═'.repeat(80)}\n  WC2026 Live Watcher stopped: ${new Date().toISOString()}\n  Total polls: ${pollCount}\n${'═'.repeat(80)}\n`;
    appendFileSync(LOG_FILE, footer);
    process.stdout.write(footer);
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    log(LEVELS.INFO, 'WATCHER/SHUTDOWN', '🛑 SIGTERM received — shutting down gracefully');
    clearInterval(intervalHandle);
    process.exit(0);
  });

  log(LEVELS.INFO, 'WATCHER/RUNNING', `✅ Watcher running — polling every ${POLL_INTERVAL_MS / 1000}s | Press Ctrl+C to stop`);
}

main().catch(err => {
  log(LEVELS.ERROR, 'WATCHER/FATAL', `❌ FATAL: ${err.message}\n${err.stack}`);
  process.exit(1);
});
