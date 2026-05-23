/**
 * DEEP AUDIT: Google Sheet Version Comparison
 * 
 * Fetches the current state of all 4 RG tabs + 2 lineup tabs from the live sheet.
 * Also fetches the Drive revision history to identify what was written at
 * 6:32pm PDT (01:32 UTC May 23) and 6:59pm PDT (01:59 UTC May 23).
 *
 * [INPUT]  SPREADSHEET_ID = 1lUlFy--SwMHrMKxRiJmvkFePbdBO4PDJvrw0OKDY3Hw
 * [INPUT]  GOOGLE_SERVICE_ACCOUNT_JSON from env
 * [OUTPUT] Per-tab: rowCount, colCount, column headers, first 3 data rows, last 3 data rows
 * [OUTPUT] Drive revision list with timestamps
 * [VERIFY] PASS/FAIL per tab
 */

import { google } from "googleapis";
import * as dotenv from "dotenv";

dotenv.config({ path: "/home/ubuntu/ai-sports-betting/.env" });

const SPREADSHEET_ID = "1lUlFy--SwMHrMKxRiJmvkFePbdBO4PDJvrw0OKDY3Hw";

// All 6 tabs we care about
const TABS = [
  { key: "today-pitchers",    name: "The Bat X" },
  { key: "today-hitters",     name: "The Bat X Hitters" },
  { key: "tomorrow-pitchers", name: "Tomorrow's Projections (The Bat X)" },
  { key: "tomorrow-hitters",  name: "Tomorrow's Projections (The Bat X Hitters)" },
];

// PDT = UTC-7
// 6:32pm PDT = 01:32 UTC May 23 2026
// 6:59pm PDT = 01:59 UTC May 23 2026
const TARGET_632_UTC = new Date("2026-05-23T01:32:00.000Z");
const TARGET_659_UTC = new Date("2026-05-23T01:59:00.000Z");

async function main() {
  console.log("=".repeat(80));
  console.log("[INPUT] SPREADSHEET_ID:", SPREADSHEET_ID);
  console.log("[INPUT] TARGET_632_PDT = 6:32pm PDT =", TARGET_632_UTC.toISOString(), "UTC");
  console.log("[INPUT] TARGET_659_PDT = 6:59pm PDT =", TARGET_659_UTC.toISOString(), "UTC");
  console.log("=".repeat(80));

  // ── Auth ──────────────────────────────────────────────────────────────────
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!saJson) {
    console.error("[VERIFY] FAIL — GOOGLE_SERVICE_ACCOUNT_JSON not set in environment");
    process.exit(1);
  }

  let serviceAccount: Record<string, string>;
  try {
    serviceAccount = JSON.parse(saJson);
    console.log("[INPUT] Service account email:", serviceAccount.client_email);
  } catch (e) {
    console.error("[VERIFY] FAIL — Could not parse GOOGLE_SERVICE_ACCOUNT_JSON:", (e as Error).message);
    process.exit(1);
  }

  const auth = new google.auth.GoogleAuth({
    credentials: serviceAccount,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets.readonly",
      "https://www.googleapis.com/auth/drive.readonly",
    ],
  });

  const sheets = google.sheets({ version: "v4", auth });
  const drive = google.drive({ version: "v3", auth });

  // ── Step 1: Get spreadsheet metadata (all tab names + sheetIds) ───────────
  console.log("\n" + "─".repeat(80));
  console.log("[STEP] Fetching spreadsheet metadata...");
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: "sheets.properties",
  });

  const allTabs = (meta.data.sheets ?? []).map(s => ({
    title: s.properties?.title ?? "?",
    sheetId: s.properties?.sheetId ?? -1,
    rowCount: s.properties?.gridProperties?.rowCount ?? 0,
    colCount: s.properties?.gridProperties?.columnCount ?? 0,
  }));

  console.log("[STATE] Total tabs in spreadsheet:", allTabs.length);
  for (const t of allTabs) {
    console.log(`  [TAB] "${t.title}" | sheetId=${t.sheetId} | grid=${t.rowCount}×${t.colCount}`);
  }

  // ── Step 2: For each RG tab, fetch full data ───────────────────────────────
  console.log("\n" + "─".repeat(80));
  console.log("[STEP] Fetching data from all 4 RG tabs...\n");

  const tabResults: Array<{
    key: string;
    name: string;
    exists: boolean;
    rowCount: number;
    colCount: number;
    headers: string[];
    firstRow: string[];
    lastRow: string[];
    sampleRows: string[][];
    rawRowCount: number;
  }> = [];

  for (const tab of TABS) {
    console.log(`[STEP] Reading tab: "${tab.name}"`);
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${tab.name}'`,
        valueRenderOption: "FORMATTED_VALUE",
      });

      const rows = (res.data.values as string[][] | null | undefined) ?? [];
      const headers = rows[0] ?? [];
      const dataRows = rows.slice(1);
      const rawRowCount = rows.length;

      console.log(`  [STATE] "${tab.name}": rawRows=${rawRowCount} (1 header + ${dataRows.length} data) cols=${headers.length}`);
      console.log(`  [STATE] Headers[0..4]: ${headers.slice(0, 5).join(" | ")}`);
      console.log(`  [STATE] Headers[-3..]: ${headers.slice(-3).join(" | ")}`);

      if (dataRows.length > 0) {
        console.log(`  [STATE] First data row: ${dataRows[0]?.slice(0, 5).join(" | ")}`);
        console.log(`  [STATE] Last data row:  ${dataRows[dataRows.length - 1]?.slice(0, 5).join(" | ")}`);
      }

      // Verify PLAYER_ID is col[0], NAME is col[1], MLB_ID is col[-1]
      const playerIdIdx = headers.indexOf("PLAYER_ID");
      const nameIdx = headers.indexOf("NAME");
      const mlbIdIdx = headers.indexOf("MLB_ID");
      const lastColName = headers[headers.length - 1];

      if (playerIdIdx === 0 && nameIdx === 1 && lastColName === "MLB_ID") {
        console.log(`  [VERIFY] PASS — PLAYER_ID[0] NAME[1] MLB_ID[last] ✓`);
      } else {
        console.log(`  [VERIFY] FAIL — Column order violation!`);
        console.log(`    PLAYER_ID at index: ${playerIdIdx} (expected 0)`);
        console.log(`    NAME at index: ${nameIdx} (expected 1)`);
        console.log(`    MLB_ID at index: ${mlbIdIdx} (expected ${headers.length - 1})`);
        console.log(`    Last column: "${lastColName}" (expected "MLB_ID")`);
      }

      tabResults.push({
        key: tab.key,
        name: tab.name,
        exists: true,
        rowCount: dataRows.length,
        colCount: headers.length,
        headers,
        firstRow: dataRows[0] ?? [],
        lastRow: dataRows[dataRows.length - 1] ?? [],
        sampleRows: dataRows.slice(0, 3),
        rawRowCount,
      });

    } catch (err) {
      const msg = (err as Error).message;
      console.log(`  [VERIFY] FAIL — Could not read "${tab.name}": ${msg}`);
      tabResults.push({
        key: tab.key,
        name: tab.name,
        exists: false,
        rowCount: 0,
        colCount: 0,
        headers: [],
        firstRow: [],
        lastRow: [],
        sampleRows: [],
        rawRowCount: 0,
      });
    }
  }

  // ── Step 3: Drive revision history ────────────────────────────────────────
  console.log("\n" + "─".repeat(80));
  console.log("[STEP] Fetching Drive revision history for the spreadsheet...");

  try {
    const revisions = await drive.revisions.list({
      fileId: SPREADSHEET_ID,
      fields: "revisions(id,modifiedTime,lastModifyingUser)",
      pageSize: 100,
    });

    const revList = revisions.data.revisions ?? [];
    console.log(`[STATE] Total revisions found: ${revList.length}`);
    console.log("\n[STATE] All revisions (newest first):");

    // Sort newest first
    const sorted = [...revList].sort((a, b) =>
      new Date(b.modifiedTime ?? 0).getTime() - new Date(a.modifiedTime ?? 0).getTime()
    );

    for (const rev of sorted.slice(0, 30)) {
      const ts = new Date(rev.modifiedTime ?? 0);
      const pdt = new Date(ts.getTime() - 7 * 3600 * 1000);
      const pdtStr = pdt.toISOString().replace("T", " ").slice(0, 19) + " PDT";
      const user = rev.lastModifyingUser?.displayName ?? rev.lastModifyingUser?.emailAddress ?? "unknown";
      console.log(`  [REV] id=${rev.id} | ${ts.toISOString()} UTC | ${pdtStr} | user=${user}`);
    }

    // Find revisions closest to 6:32pm and 6:59pm PDT
    console.log("\n[STEP] Finding revisions closest to target times...");

    const t632 = TARGET_632_UTC.getTime();
    const t659 = TARGET_659_UTC.getTime();

    // Revision that was ACTIVE at 6:32pm = latest revision BEFORE or AT 6:32pm
    const rev632 = sorted
      .filter(r => new Date(r.modifiedTime ?? 0).getTime() <= t632)
      .sort((a, b) => new Date(b.modifiedTime ?? 0).getTime() - new Date(a.modifiedTime ?? 0).getTime())[0];

    // Revision that was ACTIVE at 6:59pm = latest revision BEFORE or AT 6:59pm
    const rev659 = sorted
      .filter(r => new Date(r.modifiedTime ?? 0).getTime() <= t659)
      .sort((a, b) => new Date(b.modifiedTime ?? 0).getTime() - new Date(a.modifiedTime ?? 0).getTime())[0];

    if (rev632) {
      const ts = new Date(rev632.modifiedTime ?? 0);
      const pdt = new Date(ts.getTime() - 7 * 3600 * 1000);
      console.log(`\n[OUTPUT] Revision ACTIVE at 6:32pm PDT:`);
      console.log(`  id=${rev632.id} | saved at ${ts.toISOString()} UTC = ${pdt.toISOString().slice(0, 19)} PDT`);
      console.log(`  user=${rev632.lastModifyingUser?.displayName ?? "unknown"}`);
    } else {
      console.log("\n[OUTPUT] No revision found before 6:32pm PDT");
    }

    if (rev659) {
      const ts = new Date(rev659.modifiedTime ?? 0);
      const pdt = new Date(ts.getTime() - 7 * 3600 * 1000);
      console.log(`\n[OUTPUT] Revision ACTIVE at 6:59pm PDT:`);
      console.log(`  id=${rev659.id} | saved at ${ts.toISOString()} UTC = ${pdt.toISOString().slice(0, 19)} PDT`);
      console.log(`  user=${rev659.lastModifyingUser?.displayName ?? "unknown"}`);
    } else {
      console.log("\n[OUTPUT] No revision found before 6:59pm PDT");
    }

    if (rev632 && rev659) {
      if (rev632.id === rev659.id) {
        console.log("\n[STATE] SAME revision was active at both 6:32pm and 6:59pm PDT");
        console.log("        → The sheet did NOT change between those two times");
        console.log("        → Any difference in what users saw was NOT from a sheet write");
      } else {
        console.log("\n[STATE] DIFFERENT revisions at 6:32pm vs 6:59pm PDT");
        console.log(`        → Sheet was modified between 6:32pm and 6:59pm PDT`);
        console.log(`        → rev at 6:32pm: ${rev632.id}`);
        console.log(`        → rev at 6:59pm: ${rev659.id}`);

        // Find all revisions between the two times
        const between = sorted.filter(r => {
          const t = new Date(r.modifiedTime ?? 0).getTime();
          return t > t632 && t <= t659;
        });
        console.log(`\n[STATE] Revisions written BETWEEN 6:32pm and 6:59pm PDT (${between.length} total):`);
        for (const r of between) {
          const ts = new Date(r.modifiedTime ?? 0);
          const pdt = new Date(ts.getTime() - 7 * 3600 * 1000);
          console.log(`  [REV] id=${r.id} | ${ts.toISOString()} UTC = ${pdt.toISOString().slice(0, 19)} PDT`);
        }
      }
    }

  } catch (err) {
    const msg = (err as Error).message;
    console.log(`[VERIFY] WARN — Drive revisions API failed: ${msg}`);
    console.log("         (Service account may not have Drive read access — checking sheet directly)");
  }

  // ── Step 4: Summary table ─────────────────────────────────────────────────
  console.log("\n" + "=".repeat(80));
  console.log("[OUTPUT] CURRENT STATE SUMMARY (as of now):");
  console.log("─".repeat(80));
  console.log(
    "TAB".padEnd(50) +
    "EXISTS".padEnd(8) +
    "DATA ROWS".padEnd(12) +
    "COLS".padEnd(8) +
    "PLAYER_ID[0]".padEnd(14) +
    "NAME[1]".padEnd(10) +
    "MLB_ID[last]"
  );
  console.log("─".repeat(80));

  for (const t of tabResults) {
    const playerIdOk = t.headers[0] === "PLAYER_ID" ? "✓" : `✗(${t.headers[0]})`;
    const nameOk = t.headers[1] === "NAME" ? "✓" : `✗(${t.headers[1]})`;
    const mlbIdOk = t.headers[t.headers.length - 1] === "MLB_ID" ? "✓" : `✗(${t.headers[t.headers.length - 1]})`;
    console.log(
      t.name.padEnd(50) +
      (t.exists ? "YES" : "NO").padEnd(8) +
      String(t.rowCount).padEnd(12) +
      String(t.colCount).padEnd(8) +
      playerIdOk.padEnd(14) +
      nameOk.padEnd(10) +
      mlbIdOk
    );
  }

  console.log("=".repeat(80));
  console.log("[VERIFY] Audit complete.");
}

main().catch(err => {
  console.error("[VERIFY] FAIL — Unhandled error:", err.message);
  process.exit(1);
});
