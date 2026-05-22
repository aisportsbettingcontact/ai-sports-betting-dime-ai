/**
 * test_jackmac_pipeline.mts
 * ─────────────────────────────────────────────────────────────────────────────
 * Live diagnostic test for the full Jack Mac pipeline:
 *   1. RotoGrinders auth + CSV fetch for all 4 tabs
 *   2. MLB ID resolution (DB-first) for sample players
 *   3. Fangraphs lineups scrape (today + tomorrow)
 *   4. Google Sheets API connectivity
 *   5. End-to-end syncJackMacToSheets (dry-run: fetch only, no write)
 */

import dotenv from "dotenv";
dotenv.config();

import { getRgSessionCookie, fetchRgCsv, parseRgCsv, PAGE_CONFIG } from "./server/rotogrinderProxy.js";
import { scrapeFangraphsLineups, getPstDate } from "./server/fangraphsScraper.js";
import { google } from "googleapis";

const SPREADSHEET_ID = "1lUlFy--SwMHrMKxRiJmvkFePbdBO4PDJvrw0OKDY3Hw";

// ─── Diagnostic: RotoGrinders Auth ───────────────────────────────────────────
async function testRgAuth(): Promise<string | null> {
  console.log("\n[DIAG] ═══════════════════════════════════════════════════════");
  console.log("[DIAG] TEST 1: RotoGrinders Authentication");
  console.log("[DIAG] ═══════════════════════════════════════════════════════");
  try {
    const cookie = await getRgSessionCookie();
    const cookieLen = cookie.length;
    const hasRguid = cookie.includes("rguid=");
    console.log(`[DIAG] [PASS] RG auth success: cookie=${cookieLen} chars, hasRguid=${hasRguid}`);
    console.log(`[DIAG] [STATE] Cookie preview: ${cookie.substring(0, 80)}...`);
    return cookie;
  } catch (err) {
    console.error(`[DIAG] [FAIL] RG auth error: ${(err as Error).message}`);
    return null;
  }
}

// ─── Diagnostic: RotoGrinders CSV Fetch ──────────────────────────────────────
async function testRgCsvFetch(cookie: string): Promise<void> {
  console.log("\n[DIAG] ═══════════════════════════════════════════════════════");
  console.log("[DIAG] TEST 2: RotoGrinders CSV Fetch (all 4 tabs)");
  console.log("[DIAG] ═══════════════════════════════════════════════════════");

  for (const [pageKey, conf] of Object.entries(PAGE_CONFIG)) {
    const t0 = Date.now();
    try {
      const csvText = await fetchRgCsv(conf.csvId, cookie);
      const lines = csvText.trim().split("\n");
      const elapsed = Date.now() - t0;
      console.log(`[DIAG] [PASS] ${pageKey}: ${csvText.length} bytes, ${lines.length} lines, elapsed=${elapsed}ms`);
      if (lines.length > 1) {
        console.log(`[DIAG] [STATE] ${pageKey} headers: ${lines[0].substring(0, 120)}`);
        console.log(`[DIAG] [STATE] ${pageKey} first row: ${lines[1].substring(0, 120)}`);
      }
    } catch (err) {
      const elapsed = Date.now() - t0;
      console.error(`[DIAG] [FAIL] ${pageKey}: ${(err as Error).message} elapsed=${elapsed}ms`);
    }
  }
}

// ─── Diagnostic: parseRgCsv (MLB ID resolution) ───────────────────────────────
async function testParseRgCsv(cookie: string): Promise<void> {
  console.log("\n[DIAG] ═══════════════════════════════════════════════════════");
  console.log("[DIAG] TEST 3: parseRgCsv (MLB ID resolution via DB-first lookup)");
  console.log("[DIAG] ═══════════════════════════════════════════════════════");

  // Test today-hitters only (largest dataset)
  const conf = PAGE_CONFIG["today-hitters"];
  const t0 = Date.now();
  try {
    const csvText = await fetchRgCsv(conf.csvId, cookie);
    const t1 = Date.now();
    console.log(`[DIAG] [STATE] CSV fetched in ${t1 - t0}ms (${csvText.length} bytes)`);

    const tableData = await parseRgCsv(csvText, "today-hitters", conf.title, conf.type);
    const elapsed = Date.now() - t0;

    const withMlbId = tableData.rows.filter(r => r["MLB_ID"] && r["MLB_ID"] !== "").length;
    const withoutMlbId = tableData.rows.filter(r => !r["MLB_ID"] || r["MLB_ID"] === "").length;
    const withHeadshot = tableData.rows.filter(r => r["HEADSHOT_URL"] && r["HEADSHOT_URL"] !== "").length;

    console.log(`[DIAG] [PASS] today-hitters: ${tableData.rows.length} rows, elapsed=${elapsed}ms`);
    console.log(`[DIAG] [STATE] MLB_ID resolved: ${withMlbId}/${tableData.rows.length} (${withoutMlbId} missing)`);
    console.log(`[DIAG] [STATE] Headshots: ${withHeadshot}/${tableData.rows.length}`);
    console.log(`[DIAG] [STATE] Columns (${tableData.columns.length}): ${tableData.columns.join(", ")}`);

    if (withoutMlbId > 0) {
      const missing = tableData.rows.filter(r => !r["MLB_ID"] || r["MLB_ID"] === "").map(r => r["NAME"]);
      console.warn(`[DIAG] [WARN] Missing MLB_ID for: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? ` (+${missing.length - 10} more)` : ""}`);
    }

    // Sample first 3 rows
    for (const row of tableData.rows.slice(0, 3)) {
      console.log(`[DIAG] [STATE] Sample row: NAME="${row["NAME"]}" MLB_ID=${row["MLB_ID"]} TEAM=${row["TEAM"]} FPTS=${row["FPTS"]}`);
    }
  } catch (err) {
    const elapsed = Date.now() - t0;
    console.error(`[DIAG] [FAIL] parseRgCsv error: ${(err as Error).message} elapsed=${elapsed}ms`);
  }
}

// ─── Diagnostic: Fangraphs Lineups ───────────────────────────────────────────
async function testFangraphsLineups(): Promise<void> {
  console.log("\n[DIAG] ═══════════════════════════════════════════════════════");
  console.log("[DIAG] TEST 4: Fangraphs Lineups (MLB Stats API)");
  console.log("[DIAG] ═══════════════════════════════════════════════════════");

  const todayDate = getPstDate(0);
  const tomorrowDate = getPstDate(1);
  console.log(`[DIAG] [INPUT] today=${todayDate} tomorrow=${tomorrowDate}`);

  const t0 = Date.now();
  try {
    const result = await scrapeFangraphsLineups(true); // forceRefresh=true
    const elapsed = Date.now() - t0;

    console.log(`[DIAG] [PASS] Fangraphs scrape complete: elapsed=${elapsed}ms`);
    console.log(`[DIAG] [STATE] Today (${result.today.date}): ${result.today.games.length} games`);
    console.log(`[DIAG] [STATE] Tomorrow (${result.tomorrow.date}): ${result.tomorrow.games.length} games`);
    console.log(`[DIAG] [STATE] Errors: ${result.errors.length}`);

    if (result.errors.length > 0) {
      console.warn(`[DIAG] [WARN] Errors: ${result.errors.join("; ")}`);
    }

    // Sample today games
    for (const game of result.today.games.slice(0, 3)) {
      const awayStatus = game.away.lineupStatus;
      const homeStatus = game.home.lineupStatus;
      const awayPitcher = game.away.pitcher?.name ?? "TBD";
      const homePitcher = game.home.pitcher?.name ?? "TBD";
      console.log(`[DIAG] [STATE] ${game.away.teamAbbr}@${game.home.teamAbbr}: away=${awayStatus}(${game.away.lineup.length}bat) home=${homeStatus}(${game.home.lineup.length}bat) pitchers: ${awayPitcher} vs ${homePitcher}`);
    }
  } catch (err) {
    const elapsed = Date.now() - t0;
    console.error(`[DIAG] [FAIL] Fangraphs scrape error: ${(err as Error).message} elapsed=${elapsed}ms`);
  }
}

// ─── Diagnostic: Google Sheets API ───────────────────────────────────────────
async function testGoogleSheetsApi(): Promise<void> {
  console.log("\n[DIAG] ═══════════════════════════════════════════════════════");
  console.log("[DIAG] TEST 5: Google Sheets API Connectivity");
  console.log("[DIAG] ═══════════════════════════════════════════════════════");

  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!saJson) {
    console.error("[DIAG] [FAIL] GOOGLE_SERVICE_ACCOUNT_JSON is not set");
    return;
  }

  let credentials: Record<string, unknown>;
  try {
    credentials = JSON.parse(saJson);
    console.log(`[DIAG] [STATE] Service account email: ${credentials.client_email}`);
  } catch (err) {
    console.error(`[DIAG] [FAIL] Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON: ${(err as Error).message}`);
    return;
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  const t0 = Date.now();
  try {
    // Read spreadsheet metadata (lightweight, no data)
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
      fields: "spreadsheetId,properties.title,sheets.properties.title",
    });
    const elapsed = Date.now() - t0;

    const sheetTabs = meta.data.sheets?.map(s => s.properties?.title) ?? [];
    console.log(`[DIAG] [PASS] Sheets API connected: "${meta.data.properties?.title}" elapsed=${elapsed}ms`);
    console.log(`[DIAG] [STATE] Sheet tabs (${sheetTabs.length}): ${sheetTabs.join(", ")}`);

    // Verify required tabs exist
    const requiredTabs = [
      "The Bat X",
      "The Bat X Hitters",
      "Tomorrow's Projections (The Bat X)",
      "Tomorrow's Projections (The Bat X Hitters)",
      "Today Lineups",
      "Tomorrow Lineups",
    ];
    const missingTabs = requiredTabs.filter(t => !sheetTabs.includes(t));
    if (missingTabs.length > 0) {
      console.warn(`[DIAG] [WARN] Missing required tabs: ${missingTabs.join(", ")}`);
    } else {
      console.log(`[DIAG] [PASS] All ${requiredTabs.length} required tabs present`);
    }
  } catch (err) {
    const elapsed = Date.now() - t0;
    console.error(`[DIAG] [FAIL] Sheets API error: ${(err as Error).message} elapsed=${elapsed}ms`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("\n[DIAG] ╔═══════════════════════════════════════════════════════╗");
  console.log("[DIAG] ║  JACK MAC PIPELINE DIAGNOSTIC — " + new Date().toISOString() + "  ║");
  console.log("[DIAG] ╚═══════════════════════════════════════════════════════╝");

  const totalStart = Date.now();

  // TEST 1: RG Auth
  const cookie = await testRgAuth();
  if (!cookie) {
    console.error("[DIAG] FATAL: RG auth failed — cannot proceed with CSV tests");
  } else {
    // TEST 2: RG CSV Fetch
    await testRgCsvFetch(cookie);
    // TEST 3: parseRgCsv (MLB ID resolution)
    await testParseRgCsv(cookie);
  }

  // TEST 4: Fangraphs Lineups
  await testFangraphsLineups();

  // TEST 5: Google Sheets API
  await testGoogleSheetsApi();

  const totalElapsed = Date.now() - totalStart;
  console.log(`\n[DIAG] ═══════════════════════════════════════════════════════`);
  console.log(`[DIAG] DIAGNOSTIC COMPLETE: total elapsed=${totalElapsed}ms`);
  console.log(`[DIAG] ═══════════════════════════════════════════════════════\n`);
}

main().catch(err => {
  console.error("[DIAG] FATAL:", err);
  process.exit(1);
});
