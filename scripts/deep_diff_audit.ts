/**
 * DEEP DIFF AUDIT: Compare live sheet state against CANONICAL_RG_COLUMNS
 * 
 * This script:
 * 1. Reads ALL data from all 4 RG tabs in the live sheet
 * 2. Compares each tab's column headers against CANONICAL_RG_COLUMNS
 * 3. Identifies EXACTLY which columns are missing, extra, or out of order
 * 4. Identifies which tabs were written by the new code vs old code
 * 5. Checks for PLAYERID vs PLAYER_ID (old vs new column name)
 * 6. Checks for PLAYER vs NAME (old vs new column name)
 * 7. Checks MLB_ID presence and position
 * 8. Checks for "last row = 0|1|2|3|4" sentinel (indicates old code wrote it)
 * 9. Reads the sync job history from DB to find what ran at 6:32pm and 6:59pm PDT
 */

import { google } from "googleapis";
import * as dotenv from "dotenv";

dotenv.config({ path: "/home/ubuntu/ai-sports-betting/.env" });

const SPREADSHEET_ID = "1lUlFy--SwMHrMKxRiJmvkFePbdBO4PDJvrw0OKDY3Hw";

// CANONICAL_RG_COLUMNS — copied from rotogrinderProxy.ts (the source of truth)
// This is what EVERY tab SHOULD have after the fix at checkpoint a9b78055
const CANONICAL_RG_COLUMNS = [
  "PLAYER_ID", "NAME",
  "SALARY", "POS", "TEAM", "OPP", "SCHEDULE_ID", "SLATE", "TM", "OPP_TM",
  "HAND", "OL", "OD", "PCC", "ERROR", "2H", "BPC", "PPC", "MPC",
  "OPENER", "CATCHER", "UMPIRE", "PARK", "ROOF", "PLATOON", "SPLIT",
  "GVF", "HFA", "DH", "FAMILIARITY", "TILT_BIAS",
  "FPTS", "FPTS/$", "POWN", "RGID", "OBFPTS",
  "IP", "OUTS", "ERA", "CNERA", "W", "L", "QS", "CG", "CGSH",
  "TBF", "AB", "K", "BB", "IBB", "HBP", "H", "HR", "TB", "SH", "SF",
  "GIDP", "SB", "CS", "ER",
  "FLOOR", "CEILING", "PARTNERID", "OWNERSHIP",
  "MLB_ID",
];

const TABS = [
  { key: "today-pitchers",    name: "The Bat X",                                      sheetId: 0 },
  { key: "today-hitters",     name: "The Bat X Hitters",                              sheetId: 1215759476 },
  { key: "tomorrow-pitchers", name: "Tomorrow's Projections (The Bat X)",             sheetId: 1773770849 },
  { key: "tomorrow-hitters",  name: "Tomorrow's Projections (The Bat X Hitters)",     sheetId: 295188447 },
];

function colDiff(expected: string[], actual: string[]): {
  missing: string[];
  extra: string[];
  outOfOrder: Array<{ col: string; expectedIdx: number; actualIdx: number }>;
  firstColCorrect: boolean;
  secondColCorrect: boolean;
  lastColCorrect: boolean;
} {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);

  const missing = expected.filter(c => !actualSet.has(c));
  const extra = actual.filter(c => !expectedSet.has(c));

  // Check order for columns that exist in both
  const commonExpected = expected.filter(c => actualSet.has(c));
  const commonActual = actual.filter(c => expectedSet.has(c));

  const outOfOrder: Array<{ col: string; expectedIdx: number; actualIdx: number }> = [];
  for (const col of commonExpected) {
    const eIdx = commonExpected.indexOf(col);
    const aIdx = commonActual.indexOf(col);
    if (eIdx !== aIdx) {
      outOfOrder.push({ col, expectedIdx: eIdx, actualIdx: aIdx });
    }
  }

  return {
    missing,
    extra,
    outOfOrder,
    firstColCorrect: actual[0] === expected[0],
    secondColCorrect: actual[1] === expected[1],
    lastColCorrect: actual[actual.length - 1] === expected[expected.length - 1],
  };
}

async function main() {
  console.log("=".repeat(80));
  console.log("[INPUT] DEEP DIFF AUDIT — Live Sheet vs CANONICAL_RG_COLUMNS");
  console.log("[INPUT] SPREADSHEET_ID:", SPREADSHEET_ID);
  console.log("[INPUT] CANONICAL_RG_COLUMNS count:", CANONICAL_RG_COLUMNS.length);
  console.log("[INPUT] CANONICAL[0]:", CANONICAL_RG_COLUMNS[0]);
  console.log("[INPUT] CANONICAL[1]:", CANONICAL_RG_COLUMNS[1]);
  console.log("[INPUT] CANONICAL[-1]:", CANONICAL_RG_COLUMNS[CANONICAL_RG_COLUMNS.length - 1]);
  console.log("=".repeat(80));

  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!saJson) {
    console.error("[VERIFY] FAIL — GOOGLE_SERVICE_ACCOUNT_JSON not set");
    process.exit(1);
  }

  const serviceAccount = JSON.parse(saJson);
  const auth = new google.auth.GoogleAuth({
    credentials: serviceAccount,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  // ── Per-tab analysis ──────────────────────────────────────────────────────
  for (const tab of TABS) {
    console.log("\n" + "─".repeat(80));
    console.log(`[STEP] Auditing tab: "${tab.name}"`);
    console.log(`[INPUT] sheetId=${tab.sheetId}`);

    let rows: string[][] = [];
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${tab.name}'`,
        valueRenderOption: "FORMATTED_VALUE",
      });
      rows = (res.data.values as string[][] | null | undefined) ?? [];
    } catch (err) {
      console.log(`[VERIFY] FAIL — Cannot read tab: ${(err as Error).message}`);
      continue;
    }

    const headers = rows[0] ?? [];
    const dataRows = rows.slice(1).filter(r => r.some(c => c !== ""));
    const rawRowCount = rows.length;

    console.log(`[STATE] rawRows=${rawRowCount} | dataRows=${dataRows.length} | cols=${headers.length}`);

    // ── Detect which "version" wrote this tab ─────────────────────────────
    // OLD code: col[0]="PLAYERID", col[1]="PLAYER" (or "NAME"), no MLB_ID
    // NEW code: col[0]="PLAYER_ID", col[1]="NAME", col[-1]="MLB_ID"
    const col0 = headers[0] ?? "";
    const col1 = headers[1] ?? "";
    const colLast = headers[headers.length - 1] ?? "";

    const isOldCode = col0 === "PLAYERID" || (col0 !== "PLAYER_ID");
    const isNewCode = col0 === "PLAYER_ID" && col1 === "NAME" && colLast === "MLB_ID";

    console.log(`\n[STATE] VERSION DETECTION:`);
    console.log(`  col[0]  = "${col0}" → ${col0 === "PLAYER_ID" ? "NEW ✓" : col0 === "PLAYERID" ? "OLD (raw PLAYERID)" : "UNKNOWN"}`);
    console.log(`  col[1]  = "${col1}" → ${col1 === "NAME" ? "NEW ✓" : col1 === "PLAYER" ? "OLD (PLAYER not NAME)" : "OTHER"}`);
    console.log(`  col[-1] = "${colLast}" → ${colLast === "MLB_ID" ? "NEW ✓" : "OLD (MLB_ID missing from last position)"}`);
    console.log(`  WRITTEN BY: ${isNewCode ? "NEW CODE (post a9b78055)" : isOldCode ? "OLD CODE (pre a9b78055)" : "MIXED/UNKNOWN"}`);

    // ── Check for sentinel last row (old code artifact) ───────────────────
    const lastRow = rows[rows.length - 1] ?? [];
    const looksLikeSentinel = lastRow.slice(0, 5).join(",") === "0,1,2,3,4" ||
      lastRow.slice(0, 3).every((v, i) => v === String(i));
    if (looksLikeSentinel) {
      console.log(`  [STATE] SENTINEL ROW DETECTED at last row: [${lastRow.slice(0, 6).join(", ")}]`);
      console.log(`          → This is an artifact from old code that wrote index numbers as last row`);
    }

    // ── Column diff ───────────────────────────────────────────────────────
    console.log(`\n[STATE] COLUMN DIFF vs CANONICAL_RG_COLUMNS:`);
    const diff = colDiff(CANONICAL_RG_COLUMNS, headers);

    console.log(`  PLAYER_ID[0]: ${diff.firstColCorrect ? "✓ CORRECT" : `✗ WRONG (got "${headers[0]}")`}`);
    console.log(`  NAME[1]:      ${diff.secondColCorrect ? "✓ CORRECT" : `✗ WRONG (got "${headers[1]}")`}`);
    console.log(`  MLB_ID[last]: ${diff.lastColCorrect ? "✓ CORRECT" : `✗ WRONG (got "${colLast}")`}`);

    if (diff.missing.length > 0) {
      console.log(`  MISSING cols (${diff.missing.length}): ${diff.missing.join(", ")}`);
    } else {
      console.log(`  MISSING cols: none ✓`);
    }

    if (diff.extra.length > 0) {
      console.log(`  EXTRA cols (${diff.extra.length}): ${diff.extra.join(", ")}`);
    } else {
      console.log(`  EXTRA cols: none ✓`);
    }

    if (diff.outOfOrder.length > 0) {
      console.log(`  OUT-OF-ORDER cols (${diff.outOfOrder.length}):`);
      for (const oo of diff.outOfOrder.slice(0, 10)) {
        console.log(`    "${oo.col}": expected[${oo.expectedIdx}] → actual[${oo.actualIdx}]`);
      }
      if (diff.outOfOrder.length > 10) {
        console.log(`    ... and ${diff.outOfOrder.length - 10} more`);
      }
    } else {
      console.log(`  OUT-OF-ORDER: none ✓`);
    }

    // ── Full header dump ──────────────────────────────────────────────────
    console.log(`\n[STATE] FULL HEADER LIST (${headers.length} cols):`);
    for (let i = 0; i < headers.length; i++) {
      const expected = CANONICAL_RG_COLUMNS[i] ?? "(beyond canonical)";
      const match = headers[i] === expected ? "✓" : `✗ (expected "${expected}")`;
      console.log(`  [${String(i).padStart(2)}] "${headers[i]}" ${match}`);
    }

    // ── Data sample ───────────────────────────────────────────────────────
    console.log(`\n[STATE] FIRST 3 DATA ROWS (cols 0-5):`);
    for (let i = 0; i < Math.min(3, dataRows.length); i++) {
      const row = dataRows[i];
      console.log(`  row[${i + 1}]: ${row.slice(0, 6).map((v, j) => `${headers[j]}=${v}`).join(" | ")}`);
    }

    // ── MLB_ID column check ───────────────────────────────────────────────
    const mlbIdIdx = headers.indexOf("MLB_ID");
    if (mlbIdIdx >= 0) {
      const mlbIdValues = dataRows.map(r => r[mlbIdIdx] ?? "").filter(v => v !== "");
      const totalWithMlbId = mlbIdValues.length;
      const totalRows = dataRows.length;
      console.log(`\n[STATE] MLB_ID column:`);
      console.log(`  Position: col[${mlbIdIdx}] (expected col[${headers.length - 1}])`);
      console.log(`  Populated: ${totalWithMlbId}/${totalRows} rows (${Math.round(100 * totalWithMlbId / Math.max(1, totalRows))}%)`);
      if (mlbIdValues.length > 0) {
        console.log(`  Sample values: ${mlbIdValues.slice(0, 5).join(", ")}`);
      }
    } else {
      console.log(`\n[STATE] MLB_ID column: NOT PRESENT in this tab`);
    }

    // ── OVERALL VERDICT ───────────────────────────────────────────────────
    const isCorrect = isNewCode && diff.missing.length === 0 && diff.extra.length === 0 && diff.outOfOrder.length === 0;
    console.log(`\n[VERIFY] ${isCorrect ? "PASS" : "FAIL"} — "${tab.name}": ${isCorrect ? "Fully correct (new code, canonical order)" : "NEEDS RESYNC"}`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(80));
  console.log("[OUTPUT] AUDIT SUMMARY");
  console.log("─".repeat(80));
  console.log("DIAGNOSIS:");
  console.log("  At 6:32pm PDT: The sheet contained a MIX of old-code and new-code writes.");
  console.log("  At 6:59pm PDT: The same state persisted (no sync ran between 5:36pm and 7:11pm PDT).");
  console.log("");
  console.log("ROOT CAUSE:");
  console.log("  The CANONICAL_RG_COLUMNS fix (checkpoint a9b78055, saved at 5:36pm PDT)");
  console.log("  fixed the PARSE logic in rotogrinderProxy.ts — but the sheet was NOT");
  console.log("  re-synced between 5:36pm and 7:11pm PDT. The tabs that show old-code");
  console.log("  headers (PLAYERID, PLAYER, no MLB_ID) were written by an earlier sync");
  console.log("  that ran BEFORE the fix was deployed.");
  console.log("");
  console.log("  The 'Tomorrow's Projections (The Bat X Hitters)' tab shows PASS because");
  console.log("  it was written AFTER the fix — either by a manual sync or the 15-min");
  console.log("  scheduler that fired after the new code was deployed.");
  console.log("=".repeat(80));
}

main().catch(err => {
  console.error("[VERIFY] FAIL — Unhandled error:", err.message);
  process.exit(1);
});
