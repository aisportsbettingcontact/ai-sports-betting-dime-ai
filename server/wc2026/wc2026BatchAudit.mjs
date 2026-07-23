/**
 * wc2026BatchAudit.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * 500x Forensic Batch Audit Runner
 * Runs wc2026ESPNScraper.mjs for all 79 completed WC2026 matches:
 *   - 72 Group Stage (Jun 11 – Jun 28)
 *   - 7 Round of 32 (Jun 28 – Jul 1)
 *
 * Logs every execution, success, failure, and table validation result
 * to both terminal and /home/ubuntu/ai-sports-betting/.scraper-logs/wc2026_batch_audit.log
 *
 * Usage:
 *   node server/wc2026/wc2026BatchAudit.mjs [--dry-run] [--concurrency=N]
 *
 * Exit codes:
 *   0 = all matches scraped successfully
 *   1 = fatal error
 *   2 = partial failures (some matches failed)
 */

import { spawnSync } from "child_process";
import { writeFileSync, appendFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "../..");
const LOG_DIR = join(projectRoot, ".scraper-logs");
const LOG_FILE = join(LOG_DIR, "wc2026_batch_audit.log");
const TAG = "WC2026_BATCH_AUDIT";

// ─── CLI args ─────────────────────────────────────────────────────────────────
const DRY_RUN = process.argv.includes("--dry-run");
const concurrencyArg = process.argv.find(a => a.startsWith("--concurrency="));
const CONCURRENCY = concurrencyArg ? parseInt(concurrencyArg.split("=")[1]) : 4;

// ─── All 79 completed matches (ESPN-verified, 2026-07-01) ────────────────────
// Source: ESPN scoreboard API dates=20260611-20260701, state=post
// Format: { gameId, stage, date, home, away }
const ALL_MATCHES = [
  // ── GROUP STAGE (72 matches) ──────────────────────────────────────────────
  { gameId: "760415", stage: "group-stage", date: "2026-06-11", home: "MEX", away: "RSA" },
  { gameId: "760414", stage: "group-stage", date: "2026-06-12", home: "KOR", away: "CZE" },
  { gameId: "760416", stage: "group-stage", date: "2026-06-12", home: "CAN", away: "BIH" },
  { gameId: "760417", stage: "group-stage", date: "2026-06-13", home: "USA", away: "PAR" },
  { gameId: "760420", stage: "group-stage", date: "2026-06-13", home: "QAT", away: "SUI" },
  { gameId: "760419", stage: "group-stage", date: "2026-06-13", home: "BRA", away: "MAR" },
  { gameId: "760418", stage: "group-stage", date: "2026-06-14", home: "HAI", away: "SCO" },
  { gameId: "760421", stage: "group-stage", date: "2026-06-14", home: "AUS", away: "TUR" },
  { gameId: "760422", stage: "group-stage", date: "2026-06-14", home: "GER", away: "CUW" },
  { gameId: "760425", stage: "group-stage", date: "2026-06-14", home: "NED", away: "JPN" },
  { gameId: "760423", stage: "group-stage", date: "2026-06-14", home: "CIV", away: "ECU" },
  { gameId: "760424", stage: "group-stage", date: "2026-06-15", home: "SWE", away: "TUN" },
  { gameId: "760428", stage: "group-stage", date: "2026-06-15", home: "ESP", away: "CPV" },
  { gameId: "760426", stage: "group-stage", date: "2026-06-15", home: "BEL", away: "EGY" },
  { gameId: "760429", stage: "group-stage", date: "2026-06-15", home: "KSA", away: "URU" },
  { gameId: "760427", stage: "group-stage", date: "2026-06-16", home: "IRN", away: "NZL" },
  { gameId: "760432", stage: "group-stage", date: "2026-06-16", home: "FRA", away: "SEN" },
  { gameId: "760430", stage: "group-stage", date: "2026-06-16", home: "IRQ", away: "NOR" },
  { gameId: "760433", stage: "group-stage", date: "2026-06-17", home: "ARG", away: "ALG" },
  { gameId: "760431", stage: "group-stage", date: "2026-06-17", home: "AUT", away: "JOR" },
  { gameId: "760435", stage: "group-stage", date: "2026-06-17", home: "POR", away: "COD" },
  { gameId: "760437", stage: "group-stage", date: "2026-06-17", home: "ENG", away: "CRO" },
  { gameId: "760434", stage: "group-stage", date: "2026-06-17", home: "GHA", away: "PAN" },
  { gameId: "760436", stage: "group-stage", date: "2026-06-18", home: "UZB", away: "COL" },
  { gameId: "760438", stage: "group-stage", date: "2026-06-18", home: "CZE", away: "RSA" },
  { gameId: "760439", stage: "group-stage", date: "2026-06-18", home: "SUI", away: "BIH" },
  { gameId: "760440", stage: "group-stage", date: "2026-06-18", home: "CAN", away: "QAT" },
  { gameId: "760441", stage: "group-stage", date: "2026-06-19", home: "MEX", away: "KOR" },
  { gameId: "760442", stage: "group-stage", date: "2026-06-19", home: "USA", away: "AUS" },
  { gameId: "760445", stage: "group-stage", date: "2026-06-19", home: "SCO", away: "MAR" },
  { gameId: "760444", stage: "group-stage", date: "2026-06-20", home: "BRA", away: "HAI" },
  { gameId: "760443", stage: "group-stage", date: "2026-06-20", home: "TUR", away: "PAR" },
  { gameId: "760447", stage: "group-stage", date: "2026-06-20", home: "NED", away: "SWE" },
  { gameId: "760448", stage: "group-stage", date: "2026-06-20", home: "GER", away: "CIV" },
  { gameId: "760446", stage: "group-stage", date: "2026-06-21", home: "ECU", away: "CUW" },
  { gameId: "760449", stage: "group-stage", date: "2026-06-21", home: "TUN", away: "JPN" },
  { gameId: "760453", stage: "group-stage", date: "2026-06-21", home: "ESP", away: "KSA" },
  { gameId: "760451", stage: "group-stage", date: "2026-06-21", home: "BEL", away: "IRN" },
  { gameId: "760450", stage: "group-stage", date: "2026-06-21", home: "URU", away: "CPV" },
  { gameId: "760452", stage: "group-stage", date: "2026-06-22", home: "NZL", away: "EGY" },
  { gameId: "760456", stage: "group-stage", date: "2026-06-22", home: "ARG", away: "AUT" },
  { gameId: "760457", stage: "group-stage", date: "2026-06-22", home: "FRA", away: "IRQ" },
  { gameId: "760454", stage: "group-stage", date: "2026-06-23", home: "NOR", away: "SEN" },
  { gameId: "760455", stage: "group-stage", date: "2026-06-23", home: "JOR", away: "ALG" },
  { gameId: "760461", stage: "group-stage", date: "2026-06-23", home: "POR", away: "UZB" },
  { gameId: "760458", stage: "group-stage", date: "2026-06-23", home: "ENG", away: "GHA" },
  { gameId: "760460", stage: "group-stage", date: "2026-06-23", home: "PAN", away: "CRO" },
  { gameId: "760459", stage: "group-stage", date: "2026-06-24", home: "COL", away: "COD" },
  { gameId: "760462", stage: "group-stage", date: "2026-06-24", home: "BIH", away: "QAT" },
  { gameId: "760463", stage: "group-stage", date: "2026-06-24", home: "SUI", away: "CAN" },
  { gameId: "760464", stage: "group-stage", date: "2026-06-24", home: "MAR", away: "HAI" },
  { gameId: "760465", stage: "group-stage", date: "2026-06-24", home: "SCO", away: "BRA" },
  { gameId: "760467", stage: "group-stage", date: "2026-06-25", home: "CZE", away: "MEX" },
  { gameId: "760466", stage: "group-stage", date: "2026-06-25", home: "RSA", away: "KOR" },
  { gameId: "760473", stage: "group-stage", date: "2026-06-25", home: "CUW", away: "CIV" },
  { gameId: "760468", stage: "group-stage", date: "2026-06-25", home: "ECU", away: "GER" },
  { gameId: "760471", stage: "group-stage", date: "2026-06-25", home: "JPN", away: "SWE" },
  { gameId: "760472", stage: "group-stage", date: "2026-06-25", home: "TUN", away: "NED" },
  { gameId: "760469", stage: "group-stage", date: "2026-06-26", home: "PAR", away: "AUS" },
  { gameId: "760470", stage: "group-stage", date: "2026-06-26", home: "TUR", away: "USA" },
  { gameId: "760475", stage: "group-stage", date: "2026-06-26", home: "NOR", away: "FRA" },
  { gameId: "760474", stage: "group-stage", date: "2026-06-26", home: "SEN", away: "IRQ" },
  { gameId: "760478", stage: "group-stage", date: "2026-06-27", home: "CPV", away: "KSA" },
  { gameId: "760479", stage: "group-stage", date: "2026-06-27", home: "URU", away: "ESP" },
  { gameId: "760476", stage: "group-stage", date: "2026-06-27", home: "EGY", away: "IRN" },
  { gameId: "760477", stage: "group-stage", date: "2026-06-27", home: "NZL", away: "BEL" },
  { gameId: "760480", stage: "group-stage", date: "2026-06-27", home: "CRO", away: "GHA" },
  { gameId: "760485", stage: "group-stage", date: "2026-06-27", home: "PAN", away: "ENG" },
  { gameId: "760481", stage: "group-stage", date: "2026-06-27", home: "COL", away: "POR" },
  { gameId: "760482", stage: "group-stage", date: "2026-06-27", home: "COD", away: "UZB" },
  { gameId: "760484", stage: "group-stage", date: "2026-06-28", home: "ALG", away: "AUT" },
  { gameId: "760483", stage: "group-stage", date: "2026-06-28", home: "JOR", away: "ARG" },
  // ── ROUND OF 32 (7 completed matches) ────────────────────────────────────
  { gameId: "760486", stage: "round-of-32", date: "2026-06-28", home: "RSA", away: "CAN" },
  { gameId: "760487", stage: "round-of-32", date: "2026-06-29", home: "BRA", away: "JPN" },
  { gameId: "760489", stage: "round-of-32", date: "2026-06-29", home: "GER", away: "PAR" },
  { gameId: "760488", stage: "round-of-32", date: "2026-06-30", home: "NED", away: "MAR" },
  { gameId: "760490", stage: "round-of-32", date: "2026-06-30", home: "CIV", away: "NOR" },
  { gameId: "760492", stage: "round-of-32", date: "2026-06-30", home: "FRA", away: "SWE" },
  { gameId: "760491", stage: "round-of-32", date: "2026-07-01", home: "MEX", away: "ECU" },
];

// ─── Logging ──────────────────────────────────────────────────────────────────
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

// Initialize log file
const startTime = new Date().toISOString();
writeFileSync(LOG_FILE, `=== wc2026BatchAudit START ${startTime} ===\n`);
appendFileSync(LOG_FILE, `DRY_RUN=${DRY_RUN} | CONCURRENCY=${CONCURRENCY} | TOTAL_MATCHES=${ALL_MATCHES.length}\n\n`);

function log(level, msg) {
  const line = `[${new Date().toISOString()}] [${TAG}] [${level}] ${msg}`;
  console.log(line);
  appendFileSync(LOG_FILE, line + "\n");
}

function logSection(title) {
  const sep = "─".repeat(80);
  const line = `\n${sep}\n  ${title}\n${sep}`;
  console.log(line);
  appendFileSync(LOG_FILE, line + "\n");
}

// ─── Run single match scraper ─────────────────────────────────────────────────
function runScraper(match) {
  const { gameId, stage, date, home, away } = match;
  const label = `${gameId} | ${stage} | ${date} | ${home} vs ${away}`;

  if (DRY_RUN) {
    log("DRY", `[SKIP] ${label}`);
    return { gameId, success: true, dryRun: true };
  }

  log("STEP", `[SCRAPE] ${label}`);
  const start = Date.now();

  const result = spawnSync(
    "node",
    ["server/wc2026/wc2026ESPNScraper.mjs", gameId],
    {
      cwd: projectRoot,
      timeout: 120_000,
      encoding: "utf8",
      env: { ...process.env, NODE_ENV: "production" },
    }
  );

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  if (result.error) {
    log("ERROR", `[FAIL] ${label} | error=${result.error.message} | elapsed=${elapsed}s`);
    if (result.stdout) appendFileSync(LOG_FILE, `  STDOUT: ${result.stdout.slice(0, 500)}\n`);
    if (result.stderr) appendFileSync(LOG_FILE, `  STDERR: ${result.stderr.slice(0, 500)}\n`);
    return { gameId, success: false, error: result.error.message, elapsed };
  }

  if (result.status !== 0) {
    const stderr = result.stderr?.slice(-500) || "";
    const stdout = result.stdout?.slice(-500) || "";
    log("ERROR", `[FAIL] ${label} | exitCode=${result.status} | elapsed=${elapsed}s`);
    appendFileSync(LOG_FILE, `  STDOUT_TAIL: ${stdout}\n`);
    appendFileSync(LOG_FILE, `  STDERR_TAIL: ${stderr}\n`);
    return { gameId, success: false, exitCode: result.status, elapsed };
  }

  // Parse validation summary from stdout
  const stdout = result.stdout || "";
  const passMatch = stdout.match(/✅ PASS|ALL TABLES POPULATED|tables_populated=(\d+)/);
  const failMatch = stdout.match(/❌ FAIL|MISSING|tables_missing=(\d+)/);
  const tablesMatch = stdout.match(/tables_populated=(\d+)/);
  const tablesMissing = stdout.match(/tables_missing=(\d+)/);

  const tablesPopulated = tablesMatch ? parseInt(tablesMatch[1]) : null;
  const tablesMissingCount = tablesMissing ? parseInt(tablesMissing[1]) : null;

  if (failMatch || (tablesMissingCount && tablesMissingCount > 0)) {
    log("WARN", `[PARTIAL] ${label} | tables_populated=${tablesPopulated} tables_missing=${tablesMissingCount} | elapsed=${elapsed}s`);
    appendFileSync(LOG_FILE, `  STDOUT_TAIL: ${stdout.slice(-800)}\n`);
    return { gameId, success: false, partial: true, tablesPopulated, tablesMissingCount, elapsed };
  }

  log("VERIFY", `[PASS] ${label} | tables_populated=${tablesPopulated ?? "?"} | elapsed=${elapsed}s`);
  return { gameId, success: true, tablesPopulated, elapsed };
}

// ─── Batch runner with concurrency ───────────────────────────────────────────
async function runBatch(matches, concurrency) {
  const results = [];
  let idx = 0;

  async function worker() {
    while (idx < matches.length) {
      const match = matches[idx++];
      const result = runScraper(match);
      results.push(result);
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  return results;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  logSection(`wc2026BatchAudit — 500x Forensic Audit of ${ALL_MATCHES.length} Matches`);
  log("INPUT", `Total matches: ${ALL_MATCHES.length} | Group stage: 72 | Round of 32: 7`);
  log("INPUT", `DRY_RUN=${DRY_RUN} | CONCURRENCY=${CONCURRENCY}`);

  const groupStage = ALL_MATCHES.filter(m => m.stage === "group-stage");
  const roundOf32 = ALL_MATCHES.filter(m => m.stage === "round-of-32");

  // ── Phase 1: Group Stage ──────────────────────────────────────────────────
  logSection("PHASE 1 — Group Stage (72 matches)");
  log("STEP", `Scraping ${groupStage.length} group stage matches with concurrency=${CONCURRENCY}`);
  const gsResults = await runBatch(groupStage, CONCURRENCY);

  // ── Phase 2: Round of 32 ─────────────────────────────────────────────────
  logSection("PHASE 2 — Round of 32 (7 matches)");
  log("STEP", `Scraping ${roundOf32.length} R32 matches with concurrency=1 (sequential)`);
  const r32Results = await runBatch(roundOf32, 1);

  const allResults = [...gsResults, ...r32Results];

  // ── Summary ───────────────────────────────────────────────────────────────
  logSection("AUDIT SUMMARY");
  const passed = allResults.filter(r => r.success);
  const failed = allResults.filter(r => !r.success);
  const partial = allResults.filter(r => r.partial);

  log("OUTPUT", `Total: ${allResults.length} | Passed: ${passed.length} | Failed: ${failed.length} | Partial: ${partial.length}`);

  if (failed.length > 0) {
    log("OUTPUT", "─── FAILED MATCHES ───");
    failed.forEach(r => {
      const match = ALL_MATCHES.find(m => m.espnMatchId === r.espnMatchId);
      log("ERROR", `  gameId=${r.espnMatchId} | ${match?.stage} | ${match?.date} | ${match?.home} vs ${match?.away} | error=${r.error || r.exitCode}`);
    });
  }

  if (partial.length > 0) {
    log("OUTPUT", "─── PARTIAL MATCHES ───");
    partial.forEach(r => {
      const match = ALL_MATCHES.find(m => m.espnMatchId === r.espnMatchId);
      log("WARN", `  gameId=${r.espnMatchId} | ${match?.stage} | ${match?.date} | ${match?.home} vs ${match?.away} | tables_populated=${r.tablesPopulated} tables_missing=${r.tablesMissingCount}`);
    });
  }

  const totalElapsed = allResults.reduce((sum, r) => sum + parseFloat(r.elapsed || 0), 0).toFixed(1);
  log("OUTPUT", `Total elapsed: ${totalElapsed}s`);

  const endTime = new Date().toISOString();
  appendFileSync(LOG_FILE, `\n=== wc2026BatchAudit END ${endTime} ===\n`);
  appendFileSync(LOG_FILE, `RESULT: passed=${passed.length} failed=${failed.length} partial=${partial.length}\n`);

  if (failed.length > 0) {
    log("VERIFY", `❌ FAIL — ${failed.length} matches failed`);
    process.exit(2);
  }

  log("VERIFY", `✅ PASS — all ${allResults.length} matches scraped successfully`);
  process.exit(0);
}

main().catch(err => {
  log("ERROR", `Fatal: ${err.message}`);
  process.exit(1);
});
