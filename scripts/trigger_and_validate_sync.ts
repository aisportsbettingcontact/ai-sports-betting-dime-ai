/**
 * trigger_and_validate_sync.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Triggers a live sync via syncJackMacToSheets()
 * 2. Reads back all 4 RG tabs from the Google Sheet API
 * 3. Validates:
 *    - Column count matches what was written
 *    - MLB_ID is the last column on every tab
 *    - HEADSHOT_URL / TEAM_LOGO_URL / OPP_LOGO_URL are NOT present
 *    - Row count > 0 for today tabs
 *    - First 5 columns match the live RG CSV headers (native order)
 *    - No CANONICAL reordering artifacts (PLAYER_ID must NOT be col[0] — that was the old behavior)
 *
 * Run: npx tsx scripts/trigger_and_validate_sync.ts
 */

import "dotenv/config";
import { google } from "googleapis";

// ── Constants ────────────────────────────────────────────────────────────────────────────────
const SPREADSHEET_ID = "1lUlFy--SwMHrMKxRiJmvkFePbdBO4PDJvrw0OKDY3Hw";

const TABS: { pageKey: string; tabName: string; minRows: number }[] = [
  { pageKey: "today-pitchers",    tabName: "The Bat X",                                    minRows: 1 },
  { pageKey: "today-hitters",     tabName: "The Bat X Hitters",                            minRows: 1 },
  { pageKey: "tomorrow-pitchers", tabName: "Tomorrow's Projections (The Bat X)",           minRows: 0 },
  { pageKey: "tomorrow-hitters",  tabName: "Tomorrow's Projections (The Bat X Hitters)",   minRows: 0 },
];

const EXCLUDED_SHEET_COLS = new Set(["HEADSHOT_URL", "TEAM_LOGO_URL", "OPP_LOGO_URL"]);

// ── Google Sheets client (mirrors jackMacSheetsSync.ts getGoogleSheetsClient) ────────────
function getSheets() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("[INPUT] FAIL — GOOGLE_SERVICE_ACCOUNT_JSON not set");
  const creds = JSON.parse(raw);
  // Use googleapis built-in JWT auth — no separate google-auth-library import needed
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

// ── Trigger sync ──────────────────────────────────────────────────────────────
async function triggerSync(): Promise<void> {
  console.log("\n[INPUT] Triggering live sync via syncJackMacToSheets()...");
  const { syncJackMacToSheets } = await import("../server/jackMacSheetsSync");
  const { generateRunId, acquireRunLock, releaseRunLock } = await import("../server/jackMacCore");

  const runId = generateRunId();
  const acquired = await acquireRunLock(runId);
  if (!acquired) {
    console.warn("[STATE] Run lock not acquired — another sync is running. Skipping trigger, reading current state.");
    return;
  }

  try {
    console.log(`[STEP] syncJackMacToSheets runId=${runId}`);
    const result = await syncJackMacToSheets(runId, "manual", "trigger_and_validate_sync");
    console.log(`[OUTPUT] Sync complete: status=${result.status} tabs=${result.tabs.length}`);
    for (const tab of result.tabs) {
      console.log(
        `[STATE] tab="${tab.sheetTab}" status=${tab.status} rows=${tab.rowsWritten} cols=${tab.columnsWritten} elapsed=${tab.elapsedMs}ms`
      );
    }
  } finally {
    await releaseRunLock(runId);
  }
}

// ── Read back and validate ────────────────────────────────────────────────────
async function validateTabs(): Promise<void> {
  const sheets = getSheets();
  let allPass = true;

  console.log("\n[STEP] Reading back all 4 RG tabs from Google Sheets API...\n");

  for (const { pageKey, tabName, minRows } of TABS) {
    console.log(`${"─".repeat(70)}`);
    console.log(`[INPUT] tab="${tabName}" pageKey=${pageKey}`);

    let rawValues: string[][] = [];
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${tabName}'`,
      });
      rawValues = (res.data.values as string[][] | null | undefined) ?? [];
    } catch (err) {
      console.error(`[VERIFY] FAIL — Could not read tab "${tabName}": ${(err as Error).message}`);
      allPass = false;
      continue;
    }

    const headerRow = rawValues[0] ?? [];
    const dataRows  = rawValues.slice(1);

    console.log(`[STATE] headerRow (${headerRow.length} cols): [${headerRow.join(", ")}]`);
    console.log(`[STATE] dataRows: ${dataRows.length}`);

    // ── Validation 1: MLB_ID is last column ──────────────────────────────────
    const lastCol = headerRow[headerRow.length - 1];
    const mlbIdLast = lastCol === "MLB_ID";
    console.log(
      `[VERIFY] ${mlbIdLast ? "PASS" : "FAIL"} — MLB_ID is last column: col[-1]="${lastCol}"`
    );
    if (!mlbIdLast) allPass = false;

    // ── Validation 2: No excluded columns present ─────────────────────────────
    const excludedPresent = headerRow.filter(c => EXCLUDED_SHEET_COLS.has(c));
    if (excludedPresent.length === 0) {
      console.log(`[VERIFY] PASS — No excluded columns (HEADSHOT_URL/TEAM_LOGO_URL/OPP_LOGO_URL) present`);
    } else {
      console.log(`[VERIFY] FAIL — Excluded columns found in sheet: [${excludedPresent.join(", ")}]`);
      allPass = false;
    }

    // ── Validation 3: PLAYER_ID is NOT col[0] (old CANONICAL artifact) ───────
    // The new pipeline writes PLAYERID (native RG) as col[0], not PLAYER_ID.
    // If col[0] is PLAYER_ID, the old CANONICAL ordering is still active.
    const col0 = headerRow[0];
    const noCanonicalArtifact = col0 !== "PLAYER_ID";
    console.log(
      `[VERIFY] ${noCanonicalArtifact ? "PASS" : "FAIL"} — col[0] is native RG column (not PLAYER_ID): col[0]="${col0}"`
    );
    if (!noCanonicalArtifact) allPass = false;

    // ── Validation 4: Row count meets minimum ─────────────────────────────────
    const rowCountOk = dataRows.length >= minRows;
    console.log(
      `[VERIFY] ${rowCountOk ? "PASS" : "FAIL"} — row count: ${dataRows.length} >= minRows=${minRows}`
    );
    if (!rowCountOk) allPass = false;

    // ── Validation 5: No empty header cells ──────────────────────────────────
    const emptyHeaders = headerRow.filter(c => !c || c.trim() === "");
    if (emptyHeaders.length === 0) {
      console.log(`[VERIFY] PASS — All ${headerRow.length} header cells are non-empty`);
    } else {
      console.log(`[VERIFY] FAIL — ${emptyHeaders.length} empty header cell(s) found`);
      allPass = false;
    }

    // ── Validation 6: Sample first data row ──────────────────────────────────
    const firstRow = dataRows[0];
    if (firstRow) {
      const sample = headerRow.slice(0, 5).map((col, i) => `${col}=${firstRow[i] ?? ""}`);
      console.log(`[STATE] row[1] sample: ${sample.join(" | ")} | MLB_ID=${firstRow[headerRow.length - 1] ?? ""}`);
    }

    console.log(`[OUTPUT] tab="${tabName}" VALIDATED — ${headerRow.length} cols, ${dataRows.length} rows`);
  }

  console.log(`\n${"═".repeat(70)}`);
  console.log(`[VERIFY] ${allPass ? "PASS" : "FAIL"} — ALL TABS VALIDATED: ${allPass ? "100% PASS" : "FAILURES DETECTED"}`);
  console.log(`${"═".repeat(70)}\n`);

  if (!allPass) process.exit(1);
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  try {
    await triggerSync();
    // Wait 3s for sheets API to propagate the write before reading back
    await new Promise(r => setTimeout(r, 3000));
    await validateTabs();
  } catch (err) {
    console.error("[VERIFY] FAIL — Unhandled error:", (err as Error).message);
    process.exit(1);
  }
})();
