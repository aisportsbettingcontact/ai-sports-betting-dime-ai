/**
 * espnScraper.test.live.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Live integration test for the ESPN match scraper + EspnLogger.
 *
 * Run with:
 *   cd /home/ubuntu/ai-sports-betting
 *   npx tsx server/wc2026/espnScraper.test.live.ts
 *
 * Validates:
 *   1. extractGameId() correctly parses URL and bare ID
 *   2. scrapeEspnScoreboard() returns events for today
 *   3. scrapeEspnMatch() returns full EspnMatchData for gameId 760487
 *   4. Log file is written to .manus-logs/espn-scraper.log
 *   5. Stats file is written to .manus-logs/espn-scraper-stats.json
 *   6. All validation gates pass (header, teamStats, keyEvents, rosters)
 */

import * as fs from "fs";
import { extractGameId, scrapeEspnMatch, scrapeEspnScoreboard } from "./espnMatchScraper";

const GAME_ID = "760487";
const ESPN_URL = `https://www.espn.com/soccer/player-stats/_/gameId/${GAME_ID}`;
const TODAY = new Date().toISOString().slice(0, 10).replace(/-/g, "");

// ─── ANSI helpers ─────────────────────────────────────────────────────────────

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[92m",
  red: "\x1b[91m",
  yellow: "\x1b[93m",
  cyan: "\x1b[96m",
  blue: "\x1b[94m",
};

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    console.log(`${C.green}${C.bold}  ✓ PASS${C.reset}  ${label}${detail ? ` — ${C.cyan}${detail}${C.reset}` : ""}`);
    passCount++;
  } else {
    console.log(`${C.red}${C.bold}  ✗ FAIL${C.reset}  ${label}${detail ? ` — ${C.red}${detail}${C.reset}` : ""}`);
    failCount++;
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`\n${C.bold}${C.blue}${"═".repeat(72)}${C.reset}`);
  console.log(`${C.bold}${C.blue}  ESPN SCRAPER — LIVE INTEGRATION TEST${C.reset}`);
  console.log(`${C.bold}${C.blue}  GameId: ${GAME_ID}  |  Date: ${TODAY}${C.reset}`);
  console.log(`${C.bold}${C.blue}${"═".repeat(72)}${C.reset}\n`);

  // ── Test 1: extractGameId ─────────────────────────────────────────────────
  console.log(`${C.bold}[TEST 1] extractGameId()${C.reset}`);
  try {
    const fromUrl = extractGameId(ESPN_URL);
    assert(fromUrl === GAME_ID, "extractGameId from full URL", `got=${fromUrl}`);
    const fromBare = extractGameId(GAME_ID);
    assert(fromBare === GAME_ID, "extractGameId from bare ID", `got=${fromBare}`);
  } catch (err) {
    assert(false, "extractGameId threw", String(err));
  }

  // ── Test 2: scrapeEspnScoreboard ──────────────────────────────────────────
  console.log(`\n${C.bold}[TEST 2] scrapeEspnScoreboard(${TODAY})${C.reset}`);
  try {
    const events = await scrapeEspnScoreboard(TODAY);
    assert(Array.isArray(events), "returns array", `length=${events.length}`);
    if (events.length > 0) {
      const ev = events[0];
      assert(typeof ev.id === "string" && ev.id.length > 0, "event.id is non-empty string", `id=${ev.id}`);
      assert(typeof ev.homeTeam?.abbreviation === "string", "event.homeTeam.abbreviation present", `abbr=${ev.homeTeam?.abbreviation}`);
      assert(typeof ev.awayTeam?.abbreviation === "string", "event.awayTeam.abbreviation present", `abbr=${ev.awayTeam?.abbreviation}`);
      console.log(`  ${C.cyan}First event: ${ev.shortName} — ${ev.statusDetail}${C.reset}`);
    } else {
      console.log(`  ${C.yellow}  ⚠ No events today (${TODAY}) — may be off-season or no soccer scheduled${C.reset}`);
    }
  } catch (err) {
    assert(false, "scrapeEspnScoreboard threw", String(err));
  }

  // ── Test 3: scrapeEspnMatch (full) ────────────────────────────────────────
  console.log(`\n${C.bold}[TEST 3] scrapeEspnMatch(${GAME_ID}) — full data extraction${C.reset}`);
  let data: Awaited<ReturnType<typeof scrapeEspnMatch>> | null = null;
  try {
    data = await scrapeEspnMatch(ESPN_URL, {
      includePlayerStats: true,
      includeCommentary: true,
    });

    // Core fields
    assert(data.gameId === GAME_ID, "data.gameId matches", `got=${data.gameId}`);
    assert(typeof data.scrapedAt === "string", "data.scrapedAt is string", data.scrapedAt);
    assert(data.scrapeDurationMs > 0, "scrapeDurationMs > 0", `${data.scrapeDurationMs}ms`);
    assert(data.apiCallCount > 0, "apiCallCount > 0", `calls=${data.apiCallCount}`);
    assert(Array.isArray(data.errors), "data.errors is array", `errors=${data.errors.length}`);

    // Header
    assert(data.header.competitors.length >= 2, "header has >= 2 competitors", `count=${data.header.competitors.length}`);
    const home = data.header.competitors.find((c) => c.homeAway === "home");
    const away = data.header.competitors.find((c) => c.homeAway === "away");
    assert(!!home, "home competitor found", `team=${home?.team.abbreviation}`);
    assert(!!away, "away competitor found", `team=${away?.team.abbreviation}`);
    assert(typeof home?.score === "string", "home.score is string", `score=${home?.score}`);
    assert(typeof away?.score === "string", "away.score is string", `score=${away?.score}`);
    console.log(`  ${C.cyan}Match: ${home?.team.displayName} ${home?.score} - ${away?.score} ${away?.team.displayName}${C.reset}`);
    console.log(`  ${C.cyan}Status: ${data.header.status.shortDetail}${C.reset}`);
    console.log(`  ${C.cyan}Venue: ${data.header.venue.fullName}, ${data.header.venue.city}${C.reset}`);

    // Team stats
    assert(data.teamStats.length > 0, "teamStats populated", `count=${data.teamStats.length}`);
    if (data.teamStats.length > 0) {
      assert(data.teamStats[0].statistics.length > 0, "teamStats[0].statistics populated", `count=${data.teamStats[0].statistics.length}`);
    }

    // Key events
    assert(Array.isArray(data.keyEvents), "keyEvents is array", `count=${data.keyEvents.length}`);
    const goals = data.keyEvents.filter((e) => e.type.toLowerCase().includes("goal"));
    console.log(`  ${C.cyan}Key events: ${data.keyEvents.length} total, ${goals.length} goals${C.reset}`);

    // Commentary
    assert(Array.isArray(data.commentary), "commentary is array", `count=${data.commentary.length}`);

    // Odds
    assert(Array.isArray(data.odds), "odds is array", `providers=${data.odds.map((o) => o.provider).join(", ") || "none"}`);

    // Rosters
    assert(Array.isArray(data.rosters), "rosters is array", `count=${data.rosters.length}`);
    const totalPlayers = data.rosters.reduce((a, r) => a + r.entries.length, 0);
    console.log(`  ${C.cyan}Rosters: ${data.rosters.map((r) => `${r.team.abbreviation}(${r.entries.length})`).join(", ")}${C.reset}`);
    assert(totalPlayers > 0, "total players > 0", `total=${totalPlayers}`);

    // Competitor stats
    assert(Array.isArray(data.competitorStats), "competitorStats is array", `count=${data.competitorStats.length}`);

    // Log + stats files
    assert(typeof data.logFile === "string" && data.logFile.length > 0, "logFile path returned", data.logFile);
    assert(typeof data.statsFile === "string" && data.statsFile.length > 0, "statsFile path returned", data.statsFile);

    // Verify files exist
    const logExists = fs.existsSync(data.logFile);
    const statsExists = fs.existsSync(data.statsFile);
    assert(logExists, "log file written to disk", data.logFile);
    assert(statsExists, "stats JSON file written to disk", data.statsFile);

    if (logExists) {
      const logSize = fs.statSync(data.logFile).size;
      assert(logSize > 1000, "log file has substantial content", `${(logSize / 1024).toFixed(1)}KB`);
    }

    if (statsExists) {
      const statsRaw = fs.readFileSync(data.statsFile, "utf-8");
      const statsArr = JSON.parse(statsRaw);
      assert(Array.isArray(statsArr) && statsArr.length > 0, "stats JSON has run entries", `runs=${statsArr.length}`);
      const latest = statsArr[0];
      assert(latest.gameId === GAME_ID, "latest run gameId matches", `got=${latest.gameId}`);
      assert(latest.outcome === "SUCCESS" || latest.outcome === "PARTIAL", "outcome is SUCCESS or PARTIAL", `got=${latest.outcome}`);
      console.log(`  ${C.cyan}Run stats: apiCalls=${latest.apiCallCount} retries=${latest.retryCount} errors=${latest.errorCount} players=${latest.playersScraped} bytes=${(latest.bytesTransferred / 1024).toFixed(1)}KB${C.reset}`);
    }

    // Game info
    assert(typeof data.gameInfo.venue === "string", "gameInfo.venue present", data.gameInfo.venue);

    // Format
    assert(data.format.periods > 0, "format.periods > 0", `periods=${data.format.periods}`);

    // RunId
    assert(typeof data.runId === "string" && data.runId.startsWith("ESPN-"), "runId has ESPN- prefix", data.runId);

  } catch (err) {
    assert(false, "scrapeEspnMatch threw unexpected error", String(err));
    console.error(err);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const total = passCount + failCount;
  const pct = total > 0 ? Math.round((passCount / total) * 100) : 0;
  console.log(`\n${C.bold}${"═".repeat(72)}${C.reset}`);
  console.log(`${C.bold}  TEST RESULTS: ${passCount}/${total} passed (${pct}%)${C.reset}`);
  if (failCount === 0) {
    console.log(`${C.green}${C.bold}  ALL TESTS PASSED ✓${C.reset}`);
  } else {
    console.log(`${C.red}${C.bold}  ${failCount} TEST(S) FAILED ✗${C.reset}`);
  }
  console.log(`${C.bold}${"═".repeat(72)}${C.reset}\n`);

  if (data) {
    console.log(`${C.bold}Log file:   ${C.reset}${data.logFile}`);
    console.log(`${C.bold}Stats file: ${C.reset}${data.statsFile}`);
    console.log();
  }

  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[FATAL] Test runner crashed:", err);
  process.exit(1);
});
