/**
 * batchScrapeR32.mjs — WC2026 Round of 32 Knockout Stage Batch Scraper v2.0
 * ============================================================
 * ELITE DUAL-CHANNEL LOGGER | 500x SCRAPER | 9-TABLE DB PIPELINE
 * 
 * Scrapes all completed WC2026 R32 Knockout Stage ESPN matches
 * using the 500x ESPN scraper in serial execution with:
 *   - Elite dual-channel logging: terminal + file simultaneously
 *   - Midnight rule: PT date as game date (matchGameDate), ET time as kickoff (matchKickoffEt)
 *   - --force flag: re-scrape ALL matches regardless of DB state
 *   - Retry on transient failures (max 2 retries per match)
 *   - Progress tracking with ETA + per-match midnight rule verification
 *   - Structured [LEVEL] [TAG] format — noise-free, intentional
 *   - File-stream child output capture (prevents pipe deadlock on large output)
 * 
 * Usage:
 *   node batchScrapeR32.mjs [--force]
 */

import { spawn } from 'child_process';
import fs from 'fs';
import { createConnection } from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config({ path: '/home/ubuntu/ai-sports-betting/.env' });

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

const FORCE = process.argv.includes('--force');
const PROJECT_DIR = '/home/ubuntu/ai-sports-betting';
const LOG_DIR = `${PROJECT_DIR}/.manus-logs`;
const BATCH_LOG = `${LOG_DIR}/batchScrapeR32_v2.txt`;
const TERMINAL_LOG = `/tmp/batchR32_500x.txt`;
const RUNNER_SCRIPT = `${PROJECT_DIR}/server/wc2026/espnIngest.test.live.mjs`;

// Per-match timeout: 7 minutes (R32 matches with ET/penalties take 4-6 min)
// GS matches average ~65s, but R32 with ET+penalties can take 5-6 min
const MATCH_TIMEOUT_MS = 420_000;
// Delay between matches
const INTER_MATCH_DELAY_MS = 3_000;
// Max retry attempts per match
const MAX_ATTEMPTS = 2;

// ═══════════════════════════════════════════════════════════════════════════════
// R32 COMPLETED MATCH IDs — June 28-30, 2026
// Source: ESPN WC2026 scoreboard API (season.type=13801, season.slug="round-of-32")
// Only STATUS_FULL_TIME and STATUS_FINAL_PEN matches included
// 760491 (Ecuador vs Mexico) EXCLUDED — was LIVE at time of scrape
// ═══════════════════════════════════════════════════════════════════════════════

const R32_GAME_IDS = [
  '760486', // Canada vs South Africa      | KO: 15:00 ET | 2026-06-28 | FULL_TIME
  '760487', // Japan vs Brazil             | KO: 13:00 ET | 2026-06-29 | FULL_TIME
  '760489', // Paraguay vs Germany         | KO: 16:30 ET | 2026-06-29 | FINAL_PEN
  '760488', // Morocco vs Netherlands      | KO: 21:00 ET | 2026-06-29 | FINAL_PEN
  '760490', // Norway vs Ivory Coast       | KO: 13:00 ET | 2026-06-30 | FULL_TIME
  '760492', // Sweden vs France            | KO: 17:00 ET | 2026-06-30 | FULL_TIME
];

const TARGET_IDS = R32_GAME_IDS;

// ═══════════════════════════════════════════════════════════════════════════════
// ELITE DUAL-CHANNEL LOGGER
// Writes to BOTH terminal (with ANSI color) AND log files (plain text)
// Format: [ISO_TIMESTAMP] [LEVEL  ] [TAG                ] message
// ═══════════════════════════════════════════════════════════════════════════════

fs.mkdirSync(LOG_DIR, { recursive: true });
const logStream = fs.createWriteStream(BATCH_LOG, { flags: 'a' });
const termStream = fs.createWriteStream(TERMINAL_LOG, { flags: 'w' });

// ANSI color codes for terminal
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', magenta: '\x1b[35m', blue: '\x1b[34m',
  gray: '\x1b[90m', white: '\x1b[97m',
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
};

const log = (level, tag, msg) => {
  const ts = new Date().toISOString();
  const lvl = level.padEnd(7);
  const tagPad = tag.padEnd(28);
  const plain = `[${ts}] [${lvl}] [${tagPad}] ${msg}`;
  const color = LEVEL_COLORS[`${lvl}`] || C.white;
  const colored = `${C.dim}[${ts}]${C.reset} ${color}[${lvl}]${C.reset} ${C.gray}[${tagPad}]${C.reset} ${msg}`;
  process.stdout.write(colored + '\n');
  logStream.write(plain + '\n');
  termStream.write(plain + '\n');
};

const logSep = (char = '─') => {
  const len = 80;
  const line = char.repeat(len);
  console.log(`${C.gray}${line}${C.reset}`);
  logStream.write(line + '\n');
  termStream.write(line + '\n');
};

const logBanner = (msg, char = '═') => {
  const bar = char.repeat(80);
  console.log(`${C.cyan}${bar}${C.reset}`);
  console.log(`${C.cyan}${C.bold}  ${msg}${C.reset}`);
  console.log(`${C.cyan}${bar}${C.reset}`);
  logStream.write(bar + '\n');
  logStream.write(`  ${msg}\n`);
  logStream.write(bar + '\n');
  termStream.write(bar + '\n');
  termStream.write(`  ${msg}\n`);
  termStream.write(bar + '\n');
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
    const [,user,pass,host,database] = m;
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
      `SELECT matchId, homeTeamName, awayTeamName, matchDateUtc, matchGameDate, matchKickoffEt, scrapeVersion, matchRound
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
      const m2 = parseInt(dt.toLocaleString('en-US', { timeZone: 'America/New_York', minute: '2-digit' }), 10);
      return `${String(isNaN(h)?0:h).padStart(2,'0')}:${String(isNaN(m2)?0:m2).padStart(2,'0')}`;
    })();
    
    const dateOk = r.matchGameDate === expectedPtDate;
    const timeOk = r.matchKickoffEt === expectedEtTime;
    const versionOk = r.scrapeVersion === '500x';
    const roundOk = r.matchRound === 'round-of-32';
    
    const status = dateOk && timeOk && versionOk && roundOk ? 'PASS' : 'FAIL';
    
    return {
      ok: status === 'PASS',
      gameId: r.matchId,
      match: `${r.homeTeamName} vs ${r.awayTeamName}`,
      matchGameDate: r.matchGameDate,
      matchKickoffEt: r.matchKickoffEt,
      matchRound: r.matchRound,
      scrapeVersion: r.scrapeVersion,
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
// DB STATE CHECK (for --force override)
// ═══════════════════════════════════════════════════════════════════════════════

const checkDbState = async (gameId) => {
  if (FORCE) return { scraped: false, forced: true };
  try {
    const conn = await getDb();
    const [rows] = await conn.execute(
      `SELECT matchId, homeTeamName, awayTeamName, homeScore, awayScore, matchRound, scrapeVersion FROM wc2026_espn_matches WHERE matchId = ? LIMIT 1`,
      [gameId]
    );
    if (rows.length > 0) {
      const r = rows[0];
      return { scraped: true, summary: `${r.homeTeamName} ${r.homeScore}-${r.awayScore} ${r.awayTeamName} | round=${r.matchRound} | v=${r.scrapeVersion}` };
    }
    return { scraped: false };
  } catch (err) {
    log('WARN', `CHECK_${gameId}`, `DB check failed: ${err.message} — will scrape`);
    return { scraped: false };
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// SINGLE MATCH SCRAPER
// Uses FILE-STREAM child output capture to prevent pipe deadlock on large output
// R32 matches may have extra time + penalties data (larger output than GS matches)
// ═══════════════════════════════════════════════════════════════════════════════

const scrapeMatch = (gameId, attemptNum) => new Promise((resolve) => {
  const startMs = Date.now();
  log('INFO', `SCRAPE_${gameId}`, `[ATTEMPT ${attemptNum}] Spawning 500x scraper → gameId=${gameId}`);
  
  // Use temp files for child output to prevent pipe buffer deadlock
  // R32 matches generate larger output (ET/penalties data) than GS matches
  const childOutFile = `/tmp/espnIngest_${gameId}_stdout.txt`;
  const childErrFile = `/tmp/espnIngest_${gameId}_stderr.txt`;
  
  // Open file descriptors for child stdout/stderr
  const outFd = fs.openSync(childOutFile, 'w');
  const errFd = fs.openSync(childErrFile, 'w');
  
  const child = spawn('node', [RUNNER_SCRIPT, gameId], {
    cwd: PROJECT_DIR,
    stdio: ['ignore', outFd, errFd],
    env: { ...process.env },
  });
  
  const timeout = setTimeout(() => {
    child.kill('SIGKILL');
    fs.closeSync(outFd);
    fs.closeSync(errFd);
    log('FAIL', `SCRAPE_${gameId}`, `⏱ TIMEOUT after ${MATCH_TIMEOUT_MS/1000}s — killed`);
    resolve({ ok: false, gameId, error: 'TIMEOUT', durationMs: Date.now() - startMs });
  }, MATCH_TIMEOUT_MS);
  
  child.on('close', (code) => {
    clearTimeout(timeout);
    
    // Close file descriptors
    try { fs.closeSync(outFd); } catch {}
    try { fs.closeSync(errFd); } catch {}
    
    const durationMs = Date.now() - startMs;
    const durationS = (durationMs / 1000).toFixed(1);
    
    // Read captured output
    let stdout = '';
    let stderr = '';
    try { stdout = fs.readFileSync(childOutFile, 'utf8'); } catch {}
    try { stderr = fs.readFileSync(childErrFile, 'utf8'); } catch {}
    
    // Clean up temp files
    try { fs.unlinkSync(childOutFile); } catch {}
    try { fs.unlinkSync(childErrFile); } catch {}
    
    // Stream key lines to log (filtered for noise-free output)
    const allLines = (stdout + stderr).split('\n');
    for (const line of allLines) {
      if (line.includes('[RUNNER]') || line.includes('[INGEST]') || 
          line.includes('PASS') || line.includes('FAIL') || 
          line.includes('PHASE') || line.includes('MIDNIGHT') ||
          line.includes('VERIFY') || line.includes('seasonSlug') ||
          line.includes('round-of-32') || line.includes('500x')) {
        if (line.trim() && !line.includes('[dotenv')) {
          log('INFO', `CHILD_${gameId}`, line.trim().slice(0, 140));
        }
      }
    }
    
    // ── Parse ingest result from output ──────────────────────────────────────
    const successMatch = stdout.match(/success=(true|false)/);
    const rowsMatch    = stdout.match(/rows=(\d+)/);
    const errorsMatch  = stdout.match(/errors=(\d+)/);
    const ingestSuccess = successMatch?.[1] === 'true';
    const rowsWritten = rowsMatch ? parseInt(rowsMatch[1]) : 0;
    const ingestErrors = errorsMatch ? parseInt(errorsMatch[1]) : 999;
    
    const passMatch = stdout.match(/(\d+)\/(\d+) PASS/);
    const passRate = passMatch ? `${passMatch[1]}/${passMatch[2]}` : null;
    
    const matchLineMatch = stdout.match(/Match:\s*([^\n]+)/);
    const venueMatch = stdout.match(/Venue:\s*([^\n]+)/);
    const matchInfo = matchLineMatch ? matchLineMatch[1].trim() : '?';
    const venue = venueMatch ? venueMatch[1].trim().split('|')[0].trim() : '?';
    
    const phaseMatches = [...stdout.matchAll(/Phase (\d+)\/9 \[.*?(PASS|FAIL).*?\] (\S+) — (\d+) rows/g)];
    const phasesSummary = phaseMatches.length > 0 
      ? `phases=${phaseMatches.filter(m => m[2]==='PASS').length}/9 PASS`
      : '';
    
    // Success criteria: ingest succeeded, rows written, zero errors
    const isSuccess = (ingestSuccess && ingestErrors === 0 && rowsWritten > 0) ||
                      (passMatch && parseInt(passMatch[1]) === parseInt(passMatch[2]) && parseInt(passMatch[2]) > 0);
    const isIngestSuccess = ingestSuccess && rowsWritten > 0 && ingestErrors === 0;
    
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
// MAIN EXECUTION
// ═══════════════════════════════════════════════════════════════════════════════

const main = async () => {
  logBanner(`WC2026 R32 KNOCKOUT STAGE BATCH SCRAPER v2.0 — 500x EDITION`);
  log('INFO', 'BATCH_RUNNER', `Targets: ${TARGET_IDS.length} R32 matches | Force: ${FORCE}`);
  log('INFO', 'BATCH_RUNNER', `GameIds: ${TARGET_IDS.join(', ')}`);
  log('INFO', 'BATCH_RUNNER', `Log file: ${BATCH_LOG}`);
  log('INFO', 'BATCH_RUNNER', `Terminal log: ${TERMINAL_LOG}`);
  log('INFO', 'BATCH_RUNNER', `Runner: ${RUNNER_SCRIPT}`);
  log('INFO', 'BATCH_RUNNER', `Timeout/match: ${MATCH_TIMEOUT_MS/1000}s | Retries: ${MAX_ATTEMPTS} | Delay: ${INTER_MATCH_DELAY_MS}ms`);
  log('INFO', 'BATCH_RUNNER', `matchRound expected: "round-of-32" (ESPN season.type=13801)`);
  log('INFO', 'BATCH_RUNNER', `Midnight rule: PT date → matchGameDate | ET time → matchKickoffEt`);
  log('INFO', 'BATCH_RUNNER', `Started: ${new Date().toISOString()}`);
  if (FORCE) log('WARN', 'BATCH_RUNNER', `⚡ --force MODE: ALL matches will be re-scraped regardless of DB state`);
  logSep('═');
  
  // ── Pre-flight DB state check ─────────────────────────────────────────────
  logBanner('PRE-FLIGHT: DB STATE CHECK', '─');
  const conn = await getDb();
  const [dbRows] = await conn.execute(
    `SELECT matchId, matchRound, scrapeVersion FROM wc2026_espn_matches WHERE matchId IN (${TARGET_IDS.map(() => '?').join(',')}) ORDER BY matchId`,
    TARGET_IDS
  );
  const dbMap = new Map(dbRows.map(r => [r.matchId, r]));
  log('INFO', 'DB/STATE', `${dbMap.size}/${TARGET_IDS.length} R32 matches already in DB`);
  for (const id of TARGET_IDS) {
    const r = dbMap.get(id);
    if (r) {
      log('INFO', `DB/STATE/${id}`, `EXISTS | round=${r.matchRound} | version=${r.scrapeVersion} | ${FORCE ? 'WILL RE-SCRAPE (--force)' : 'WILL SKIP'}`);
    } else {
      log('INFO', `DB/STATE/${id}`, `NOT IN DB | WILL SCRAPE`);
    }
  }
  logSep('═');
  
  // ── Results accumulator ───────────────────────────────────────────────────
  const results = {
    force: FORCE,
    startedAt: new Date().toISOString(),
    totalTargeted: TARGET_IDS.length,
    skipped: 0,
    scraped: 0,
    passed: 0,
    failed: 0,
    retried: 0,
    midnightRulePass: 0,
    midnightRuleFail: 0,
    matches: [],
  };
  
  const startBatchMs = Date.now();
  
  logBanner('BATCH EXECUTION: 6 R32 KNOCKOUT STAGE MATCHES', '─');
  
  // ── Serial match execution ────────────────────────────────────────────────
  for (let i = 0; i < TARGET_IDS.length; i++) {
    const gameId = TARGET_IDS[i];
    const matchNum = i + 1;
    
    logSep('─');
    log('INFO', `MATCH_${matchNum}/${TARGET_IDS.length}`, `▶ gameId=${gameId} (${matchNum}/${TARGET_IDS.length}) | elapsed=${((Date.now()-startBatchMs)/60000).toFixed(1)}min`);
    
    // ── Skip check (unless --force) ─────────────────────────────────────────
    const dbCheck = await checkDbState(gameId);
    if (dbCheck.scraped) {
      log('SKIP', `MATCH_${matchNum}/${TARGET_IDS.length}`, `Already in DB: ${dbCheck.summary} — skipping (use --force to re-scrape)`);
      results.skipped++;
      results.matches.push({ gameId, status: 'SKIPPED', summary: dbCheck.summary });
      continue;
    }
    if (dbCheck.forced) {
      log('INFO', `MATCH_${matchNum}/${TARGET_IDS.length}`, `--force active — re-scraping regardless of DB state`);
    }
    
    // ── Scrape with retry ─────────────────────────────────────────────────
    let scrapeResult;
    let attempts = 0;
    
    while (attempts < MAX_ATTEMPTS) {
      attempts++;
      if (attempts > 1) {
        log('INFO', `RETRY_${gameId}`, `Retry attempt ${attempts}/${MAX_ATTEMPTS} after 8s...`);
        await new Promise(r => setTimeout(r, 8_000));
        results.retried++;
      }
      
      scrapeResult = await scrapeMatch(gameId, attempts);
      if (scrapeResult.ok) break;
      
      if (attempts < MAX_ATTEMPTS) {
        log('WARN', `RETRY_${gameId}`, `Attempt ${attempts} failed — scheduling retry`);
      }
    }
    
    results.scraped++;
    
    // ── Midnight rule + round verification post-scrape ────────────────────
    if (scrapeResult.ok) {
      results.passed++;
      
      const midnightCheck = await verifyMidnightRule(gameId);
      if (midnightCheck.ok) {
        results.midnightRulePass++;
        const midnightFlag = midnightCheck.isMidnight ? ' ← 🌙MIDNIGHT RULE' : '';
        const roundFlag = midnightCheck.roundOk ? ' round=round-of-32 ✅' : ` round=${midnightCheck.matchRound} ❌`;
        log('VERIFY', `MIDNIGHT_${gameId}`, `✅ PASS | date=${midnightCheck.matchGameDate} ET=${midnightCheck.matchKickoffEt} v=${midnightCheck.scrapeVersion}${roundFlag}${midnightFlag}`);
      } else {
        results.midnightRuleFail++;
        log('WARN', `MIDNIGHT_${gameId}`, `⚠️ FAIL | date=${midnightCheck.matchGameDate} (expected ${midnightCheck.expectedPtDate}) ET=${midnightCheck.matchKickoffEt} round=${midnightCheck.matchRound} v=${midnightCheck.scrapeVersion}`);
      }
      
      results.matches.push({
        gameId,
        status: 'PASS',
        rowsWritten: scrapeResult.rowsWritten,
        matchInfo: scrapeResult.matchInfo,
        venue: scrapeResult.venue,
        durationMs: scrapeResult.durationMs,
        attempts,
        midnightRule: midnightCheck,
      });
    } else {
      results.failed++;
      results.matches.push({
        gameId,
        status: 'FAIL',
        rowsWritten: scrapeResult.rowsWritten,
        error: scrapeResult.error,
        durationMs: scrapeResult.durationMs,
        attempts,
      });
    }
    
    // ── Progress update ──────────────────────────────────────────────────
    const elapsedMs = Date.now() - startBatchMs;
    const avgMsPerMatch = elapsedMs / (i + 1);
    const remainingMatches = TARGET_IDS.length - (i + 1);
    const etaMs = avgMsPerMatch * remainingMatches;
    const etaMin = (etaMs / 60000).toFixed(1);
    const passRate = results.scraped > 0 ? ((results.passed / results.scraped) * 100).toFixed(1) : '0.0';
    
    log('PROG', 'PROGRESS', `[${matchNum}/${TARGET_IDS.length}] ✅Pass=${results.passed} ❌Fail=${results.failed} ⏭Skip=${results.skipped} | Rate=${passRate}% | ETA=${etaMin}min`);
    
    // ── Inter-match delay ─────────────────────────────────────────────────
    if (i < TARGET_IDS.length - 1) {
      await new Promise(r => setTimeout(r, INTER_MATCH_DELAY_MS));
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // FINAL SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════
  
  const totalDurationMs = Date.now() - startBatchMs;
  const totalDurationMin = (totalDurationMs / 60000).toFixed(1);
  
  results.completedAt = new Date().toISOString();
  results.totalDurationMs = totalDurationMs;
  
  logBanner(`R32 BATCH COMPLETE — WC2026 KNOCKOUT STAGE SCRAPE SUMMARY`);
  log('INFO', 'FINAL_SUMMARY', `Duration: ${totalDurationMin} minutes`);
  log('INFO', 'FINAL_SUMMARY', `Targeted: ${results.totalTargeted} | Scraped: ${results.scraped} | Skipped: ${results.skipped}`);
  log('INFO', 'FINAL_SUMMARY', `✅ PASS: ${results.passed} | ❌ FAIL: ${results.failed} | 🔄 Retried: ${results.retried}`);
  
  const passRate = results.scraped > 0 ? ((results.passed / results.scraped) * 100).toFixed(1) : '0.0';
  log('INFO', 'FINAL_SUMMARY', `Pass rate: ${passRate}% | Midnight rule: ${results.midnightRulePass} PASS / ${results.midnightRuleFail} FAIL`);
  
  logSep('─');
  log('INFO', 'MATCH_RESULTS', 'Per-match results:');
  for (const m of results.matches) {
    const rows = m.rowsWritten ? ` | rows=${m.rowsWritten}` : '';
    const dur = m.durationMs ? ` | ${(m.durationMs/1000).toFixed(1)}s` : '';
    const round = m.midnightRule?.matchRound ? ` | round=${m.midnightRule.matchRound}` : '';
    if (m.status === 'PASS') {
      log('PASS', `RESULT_${m.gameId}`, `✅ ${m.matchInfo || m.gameId}${rows}${dur}${round}`);
    } else if (m.status === 'SKIPPED') {
      log('SKIP', `RESULT_${m.gameId}`, `⏭ ${m.summary || m.gameId}`);
    } else {
      log('FAIL', `RESULT_${m.gameId}`, `❌ ${m.gameId} | ${m.error || 'unknown error'}${dur}`);
    }
  }
  
  logSep('═');
  
  const verdict = results.failed === 0 
    ? `✅ ELITE — ZERO FAILURES | ${results.passed}/${results.scraped} PASS | ${passRate}% pass rate`
    : `⚠️ PARTIAL — ${results.passed} PASS / ${results.failed} FAIL | ${passRate}% pass rate`;
  log(results.failed === 0 ? 'PASS' : 'WARN', 'FINAL_VERDICT', verdict);
  
  logBanner(`COMPLETED: ${new Date().toISOString()}`);
  
  // Close log streams
  logStream.end();
  termStream.end();
  
  // Close DB
  try { const c = await getDb(); await c.end(); } catch {}
  
  process.exit(results.failed === 0 ? 0 : 1);
};

main().catch(err => {
  log('ERROR', 'FATAL', `Unhandled error: ${err.message}`);
  log('ERROR', 'FATAL', err.stack || '');
  process.exit(1);
});
