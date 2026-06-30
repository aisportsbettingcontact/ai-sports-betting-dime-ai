/**
 * espnIngest.test.live.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Live integration test: scrape gameId 760487 + ingest all 9 wc2026_espn_* tables.
 * Uses spawnSync + tsx (same pattern as espnPageScraper.test.live.mjs).
 *
 * Usage:
 *   node server/wc2026/espnIngest.test.live.mjs
 */

import { spawnSync } from "child_process";
import { writeFileSync, existsSync, readFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "../..");
const LOG_FILE = join(projectRoot, ".manus-logs/espn_ingest_test.txt");
const RESULT_FILE = join(tmpdir(), "espn_ingest_result.json");
const GAME_ID = "760487";

// ─── Color helpers ────────────────────────────────────────────────────────────
const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m",
};

const logLines = [];
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  logLines.push(line);
}

function banner(msg, color = C.cyan) {
  const bar = "═".repeat(70);
  log(`${color}${bar}${C.reset}`);
  log(`${color}${C.bold}  ${msg}${C.reset}`);
  log(`${color}${bar}${C.reset}`);
}

let passed = 0;
let failed = 0;
const failures = [];

function check(label, value, expected) {
  const ok = value === expected ||
    (expected === ">0" && typeof value === "number" && value > 0) ||
    (expected === "truthy" && !!value);
  if (ok) {
    log(`  ${C.green}✓ PASS${C.reset}  ${label} = ${JSON.stringify(value)}`);
    passed++;
  } else {
    const msg = `  ${C.red}✗ FAIL${C.reset}  ${label} = ${JSON.stringify(value)} (expected ${JSON.stringify(expected)})`;
    log(msg);
    failed++;
    failures.push(`${label} = ${JSON.stringify(value)} (expected ${JSON.stringify(expected)})`);
  }
}

function checkGt(label, value, min) {
  if (typeof value === "number" && value > min) {
    log(`  ${C.green}✓ PASS${C.reset}  ${label} = ${value} (> ${min})`);
    passed++;
  } else {
    const msg = `  ${C.red}✗ FAIL${C.reset}  ${label} = ${JSON.stringify(value)} (expected > ${min})`;
    log(msg);
    failed++;
    failures.push(`${label} = ${JSON.stringify(value)} (expected > ${min})`);
  }
}

// ─── Temporary runner script ──────────────────────────────────────────────────
const tmpScript = join(projectRoot, "server/wc2026/_espn_ingest_runner_tmp.ts");
writeFileSync(tmpScript, `
import { scrapeAndIngest } from "${join(__dirname, "espnDbIngester.ts")}";
import { getDb } from "${join(projectRoot, "server/db.ts")}";
import { sql } from "drizzle-orm";
import { writeFileSync } from "fs";

const GAME_ID = "${GAME_ID}";
const RESULT_FILE = "${RESULT_FILE}";

async function run() {
  console.log("[RUNNER] Starting scrapeAndIngest for gameId=" + GAME_ID);
  const ingestResult = await scrapeAndIngest(GAME_ID, { dryRun: false });
  console.log("[RUNNER] Ingest complete — success=" + ingestResult.success);

  // DB row counts
  const db = await getDb();
  const tables = [
    "wc2026_espn_matches",
    "wc2026_espn_match_odds",
    "wc2026_espn_team_stats",
    "wc2026_espn_match_stats",
    "wc2026_espn_expected_goals",
    "wc2026_espn_shot_map",
    "wc2026_espn_player_stats",
    "wc2026_espn_lineups",
    "wc2026_espn_glossary",
  ];

  const rowCounts: Record<string, number> = {};
  for (const table of tables) {
    const isGlossary = table === "wc2026_espn_glossary";
    const query = isGlossary
      ? sql.raw(\`SELECT COUNT(*) as cnt FROM \${table}\`)
      : sql.raw(\`SELECT COUNT(*) as cnt FROM \${table} WHERE matchId = '${GAME_ID}'\`);
    const [rows] = await db.execute(query);
    rowCounts[table] = (rows as any)[0]?.cnt ?? 0;
  }

  // Spot checks
  const [matchData] = await db.execute(sql.raw(
    \`SELECT homeTeamName, awayTeamName, homeScore, awayScore, venue FROM wc2026_espn_matches WHERE matchId = '${GAME_ID}' LIMIT 1\`
  ));
  const [shotData] = await db.execute(sql.raw(
    \`SELECT shotType, fieldStartX, fieldStartY, goalPositionY, playerName FROM wc2026_espn_shot_map WHERE matchId = '${GAME_ID}' LIMIT 1\`
  ));
  const [defData] = await db.execute(sql.raw(
    \`SELECT homeTackles, awayTackles, homeInterceptions, awayInterceptions, homeClearances, awayClearances FROM wc2026_espn_match_stats WHERE matchId = '${GAME_ID}' LIMIT 1\`
  ));
  const [xgData] = await db.execute(sql.raw(
    \`SELECT homeXG, awayXG, homeXGOpenPlay, awayXGOpenPlay, homeXGOT, awayXGOT, perPlayerJson FROM wc2026_espn_expected_goals WHERE matchId = '${GAME_ID}' LIMIT 1\`
  ));
  const [oddsData] = await db.execute(sql.raw(
    \`SELECT provider, homeMoneylineCurrent, awayMoneylineCurrent, drawMoneylineCurrent, homeSpreadLine, homeTotalSide FROM wc2026_espn_match_odds WHERE matchId = '${GAME_ID}' LIMIT 1\`
  ));

  const output = {
    ingestResult,
    rowCounts,
    spotChecks: {
      match: (matchData as any)[0] ?? null,
      shot: (shotData as any)[0] ?? null,
      defense: (defData as any)[0] ?? null,
      xg: (xgData as any)[0] ?? null,
      odds: (oddsData as any)[0] ?? null,
    },
  };

  writeFileSync(RESULT_FILE, JSON.stringify(output, null, 2));
  console.log("[RUNNER] Result written to " + RESULT_FILE);
  process.exit(0);
}

run().catch(err => {
  console.error("[RUNNER] FATAL:", err);
  process.exit(1);
});
`);

// ─── RUN ─────────────────────────────────────────────────────────────────────
banner(`ESPN INGEST LIVE TEST — gameId=${GAME_ID}`);
log(`  Scraping + ingesting all 9 wc2026_espn_* tables...`);
log(`  (90-150s for 3 ESPN page loads + DB writes)`);

const t0 = Date.now();
const proc = spawnSync(
  join(projectRoot, "node_modules/.bin/tsx"),
  [tmpScript],
  {
    cwd: projectRoot,
    timeout: 300_000,
    maxBuffer: 50 * 1024 * 1024,
    stdio: ["inherit", "inherit", "inherit"],
  }
);

const elapsed = Date.now() - t0;

if (proc.status !== 0) {
  banner(`INGEST PROCESS FAILED (exit ${proc.status}, ${(elapsed/1000).toFixed(1)}s)`, C.red);
  if (proc.error) console.error(proc.error);
  process.exit(1);
}

if (!existsSync(RESULT_FILE)) {
  banner("RESULT FILE NOT FOUND", C.red);
  process.exit(1);
}

const { ingestResult, rowCounts, spotChecks } = JSON.parse(readFileSync(RESULT_FILE, "utf8"));

// ─── PHASE RESULTS ───────────────────────────────────────────────────────────
banner("Phase Results");
for (const phase of ingestResult.phases) {
  const status = phase.pass ? `${C.green}✓ PASS${C.reset}` : `${C.red}✗ FAIL${C.reset}`;
  log(`  Phase ${phase.phase}/9 [${status}] ${phase.table} — ${phase.rowsWritten} rows${phase.error ? ` | ERROR: ${phase.error}` : ""}`);
}

// ─── INGEST RESULT VALIDATION ─────────────────────────────────────────────────
banner("Ingest Result Validation");
check("result.success", ingestResult.success, true);
checkGt("result.totalRowsWritten", ingestResult.totalRowsWritten, 50);
check("result.errors.length", ingestResult.errors.length, 0);
check("result.phases.length", ingestResult.phases.length, 9);
const phasesPassed = ingestResult.phases.filter(p => p.pass).length;
check("phases all pass (9/9)", phasesPassed, 9);

// ─── DB ROW COUNTS ────────────────────────────────────────────────────────────
banner("Database Row Counts");
for (const [table, cnt] of Object.entries(rowCounts)) {
  checkGt(table, cnt, 0);
}

// ─── SPOT CHECKS ─────────────────────────────────────────────────────────────
banner("Spot Check Key Values");

if (spotChecks.match) {
  const m = spotChecks.match;
  log(`  Match: ${m.homeTeamName} ${m.homeScore}-${m.awayScore} ${m.awayTeamName} @ ${m.venue}`);
  check("homeTeamName populated", !!m.homeTeamName, true);
  check("awayTeamName populated", !!m.awayTeamName, true);
  check("venue populated", !!m.venue, true);
}

if (spotChecks.shot) {
  const s = spotChecks.shot;
  log(`  Shot: type=${s.shotType} fieldStart=(${s.fieldStartX},${s.fieldStartY}) goalY=${s.goalPositionY} player=${s.playerName}`);
  check("shot fieldStartX populated", s.fieldStartX !== null, true);
  check("shot playerName populated", !!s.playerName, true);
}

if (spotChecks.defense) {
  const d = spotChecks.defense;
  log(`  Defense: tackles H:${d.homeTackles} A:${d.awayTackles} | interceptions H:${d.homeInterceptions} A:${d.awayInterceptions} | clearances H:${d.homeClearances} A:${d.awayClearances}`);
  check("homeTackles populated", d.homeTackles !== null, true);
  check("homeClearances populated", d.homeClearances !== null, true);
}

if (spotChecks.xg) {
  const x = spotChecks.xg;
  const playerArr = x.perPlayerJson ? JSON.parse(x.perPlayerJson) : [];
  log(`  xG: home=${x.homeXG} away=${x.awayXG} xGOT home=${x.homeXGOT} players=${playerArr.length}`);
  check("homeXG populated", x.homeXG !== null, true);
  checkGt("perPlayer count", playerArr.length, 5);
}

if (spotChecks.odds) {
  const o = spotChecks.odds;
  log(`  Odds: provider=${o.provider} homeML=${o.homeMoneylineCurrent} awayML=${o.awayMoneylineCurrent} drawML=${o.drawMoneylineCurrent} spread=${o.homeSpreadLine} total=${o.homeTotalSide}`);
  check("odds provider populated", !!o.provider, true);
}

// ─── FINAL SUMMARY ───────────────────────────────────────────────────────────
banner("LIVE INGEST TEST COMPLETE");
log(`  ${C.bold}PASS: ${passed} | FAIL: ${failed} | TOTAL: ${passed + failed}${C.reset}`);
log(`  ${C.bold}PASS RATE: ${((passed / (passed + failed)) * 100).toFixed(1)}%${C.reset}`);
log(`  Duration: ${(elapsed / 1000).toFixed(1)}s`);
if (failures.length > 0) {
  log(`\n  ${C.red}FAILURES:${C.reset}`);
  for (const f of failures) log(`    ${C.red}✗${C.reset} ${f}`);
}

// Save log
try {
  mkdirSync(join(projectRoot, ".manus-logs"), { recursive: true });
  writeFileSync(LOG_FILE, logLines.join("\n") + "\n");
  log(`\n  Log saved to: ${LOG_FILE}`);
} catch {}

process.exit(failed > 0 ? 1 : 0);
