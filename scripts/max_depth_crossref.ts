/**
 * MAXIMUM-DEPTH CROSS-REFERENCE AUDIT
 * =====================================
 * Uses the EXACT same fetch path as the live sync:
 *   fetchRgCsv(csvId, cookie) → parseRgCsv(csvText, ...) → compare vs live sheet
 *
 * For each of the 4 RG pages:
 *   1. Fetch raw CSV bytes via fetchRgCsv (same URL, same auth, same retry logic)
 *   2. Run through parseRgCsv — get exact columns + rows
 *   3. Read the live Google Sheet tab
 *   4. Deep cross-reference: PLAYERID presence, SALARY/POS/TEAM/OPP population,
 *      column order, row counts, MLB_ID placement, border state
 */

import * as dotenv from "dotenv";
dotenv.config();

import { google } from "googleapis";
import { fetchRgCsv, parseRgCsv, PAGE_CONFIG, getRgSessionCookie } from "../server/rotogrinderProxy";

// ─── Config ──────────────────────────────────────────────────────────────────

const SPREADSHEET_ID = "1lUlFy--SwMHrMKxRiJmvkFePbdBO4PDJvrw0OKDY3Hw";

const AUDIT_PAGES = [
  { pageKey: "today-pitchers",    sheetTab: "The Bat X",                                    minRows: 1 },
  { pageKey: "today-hitters",     sheetTab: "The Bat X Hitters",                            minRows: 1 },
  { pageKey: "tomorrow-pitchers", sheetTab: "Tomorrow's Projections (The Bat X)",           minRows: 0 },
  { pageKey: "tomorrow-hitters",  sheetTab: "Tomorrow's Projections (The Bat X Hitters)",   minRows: 0 },
] as const;

// ─── Google Sheets client ────────────────────────────────────────────────────

function getGoogleSheetsClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "";
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON not set");
  const credentials = JSON.parse(raw);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

// ─── Read sheet tab values ────────────────────────────────────────────────────

async function readSheetTab(
  sheets: ReturnType<typeof google.sheets>,
  tabName: string
): Promise<{ headers: string[]; rows: string[][] }> {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${tabName}'`,
  });
  const values = (res.data.values as string[][] | null | undefined) ?? [];
  const headers = values[0] ?? [];
  const rows = values.slice(1);
  return { headers, rows };
}

// ─── Read border state for A1:C3 ─────────────────────────────────────────────

async function readSheetBorderState(
  sheets: ReturnType<typeof google.sheets>,
  tabName: string
): Promise<{ hasBorders: boolean; detail: string }> {
  try {
    const res = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
      ranges: [`'${tabName}'!A1:C3`],
      includeGridData: true,
    });
    const rowData = res.data.sheets?.[0]?.data?.[0]?.rowData;
    if (!rowData || rowData.length === 0) return { hasBorders: false, detail: "NO_DATA" };
    const cell = rowData[0]?.values?.[0];
    const borders = cell?.effectiveFormat?.borders;
    if (!borders) return { hasBorders: false, detail: "NO_BORDERS_FIELD" };
    const top    = borders.top?.style    ?? "NONE";
    const bottom = borders.bottom?.style ?? "NONE";
    const left   = borders.left?.style   ?? "NONE";
    const right  = borders.right?.style  ?? "NONE";
    const hasBorders = [top, bottom, left, right].some(s => s !== "NONE");
    return { hasBorders, detail: `top=${top} bottom=${bottom} left=${left} right=${right}` };
  } catch (err) {
    return { hasBorders: false, detail: `ERROR: ${(err as Error).message}` };
  }
}

// ─── Parse raw CSV (same logic as parseRgCsv internal parser) ────────────────

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parseRawCsv(csvText: string): { headers: string[]; rows: string[][] } {
  const lines = csvText.trim().split("\n").filter(l => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map(parseCsvLine);
  return { headers, rows };
}

// ─── Main audit ───────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════════════════════");
  console.log("[INPUT] MAXIMUM-DEPTH CROSS-REFERENCE AUDIT — 4 RG pages");
  console.log(`[STATE] SPREADSHEET_ID=${SPREADSHEET_ID}`);
  console.log("═══════════════════════════════════════════════════════════════════════");

  const sheets = getGoogleSheetsClient();

  console.log("\n[STEP] Obtaining RG session cookie...");
  const cookie = await getRgSessionCookie();
  console.log("[STATE] RG session cookie obtained");

  let totalIssues = 0;
  const summaryLines: string[] = [];

  for (const cfg of AUDIT_PAGES) {
    const pageConf = PAGE_CONFIG[cfg.pageKey];
    if (!pageConf) {
      console.error(`[FAIL] No PAGE_CONFIG entry for pageKey=${cfg.pageKey}`);
      continue;
    }

    console.log(`\n${"─".repeat(72)}`);
    console.log(`[INPUT] pageKey=${cfg.pageKey}  tab="${cfg.sheetTab}"`);
    console.log(`[STATE] csvId=${pageConf.csvId}  csvUrl=https://rotogrinders.com/grids/${pageConf.csvId}.csv`);
    console.log(`${"─".repeat(72)}`);

    const issues: string[] = [];
    const passes: string[] = [];

    // ── 1. Fetch raw CSV (same path as live sync) ─────────────────────────────
    let rawCsvText = "";
    try {
      rawCsvText = await fetchRgCsv(pageConf.csvId, cookie);
      console.log(`[STATE] Raw CSV fetched: ${rawCsvText.length} bytes, ${rawCsvText.split("\n").length} lines`);
    } catch (err) {
      issues.push(`RAW_CSV_FETCH_FAILED: ${(err as Error).message}`);
      console.error(`[VERIFY] FAIL — fetchRgCsv failed: ${(err as Error).message}`);
    }

    // ── 2. Parse raw CSV directly (bypass parseRgCsv enrichment) ─────────────
    const { headers: rawHeaders, rows: rawRows } = parseRawCsv(rawCsvText);
    console.log(`\n[STATE] RAW CSV PARSE:`);
    console.log(`  headers (${rawHeaders.length}): [${rawHeaders.slice(0, 12).join(", ")}${rawHeaders.length > 12 ? ", ..." : ""}]`);
    console.log(`  data rows: ${rawRows.length}`);

    // PLAYERID in raw CSV
    const rawHasPlayerId = rawHeaders.includes("PLAYERID");
    console.log(`  PLAYERID in raw CSV: ${rawHasPlayerId}`);

    // SALARY/POS/TEAM/OPP/SCHEDULE_ID population in raw CSV
    const checkCols = ["SALARY", "POS", "TEAM", "OPP", "SCHEDULE_ID", "SLATE", "TM", "OPP_TM"];
    for (const col of checkCols) {
      const idx = rawHeaders.indexOf(col);
      if (idx === -1) continue;
      const nonEmpty = rawRows.filter(r => (r[idx] ?? "").trim().length > 0).length;
      const pct = rawRows.length > 0 ? ((nonEmpty / rawRows.length) * 100).toFixed(1) : "0.0";
      const status = nonEmpty === rawRows.length ? "FULL" : nonEmpty === 0 ? "ALL_EMPTY" : `PARTIAL(${pct}%)`;
      console.log(`  ${col}: ${nonEmpty}/${rawRows.length} rows populated [${status}]`);
      if (nonEmpty === 0 && rawRows.length > 0) {
        // Only flag as issue if the column exists but is completely empty
        // (SALARY/POS/TEAM/OPP being empty for non-DFS-slate pitchers is expected)
        console.log(`  [NOTE] ${col} is ALL_EMPTY in raw CSV — this is source data, not a parse bug`);
      }
    }

    // Sample row[0] from raw CSV
    if (rawRows.length > 0) {
      const row0 = rawRows[0];
      const sample = rawHeaders.slice(0, 8).map((h, i) => `${h}="${row0[i] ?? ""}"`).join(" | ");
      console.log(`  row[0] sample: ${sample}`);
    }

    // ── 3. Run through parseRgCsv (same path as live sync) ───────────────────
    let parsedColumns: string[] = [];
    let parsedRows: Record<string, string>[] = [];
    try {
      const result = await parseRgCsv(rawCsvText, cfg.pageKey, pageConf.title, pageConf.type);
      parsedColumns = result.columns;
      parsedRows = result.rows;
      console.log(`\n[STATE] PARSED OUTPUT (parseRgCsv):`);
      console.log(`  columns (${parsedColumns.length}): [${parsedColumns.slice(0, 12).join(", ")}${parsedColumns.length > 12 ? ", ..." : ""}]`);
      console.log(`  data rows: ${parsedRows.length}`);
    } catch (err) {
      issues.push(`PARSE_FAILED: ${(err as Error).message}`);
      console.error(`[VERIFY] FAIL — parseRgCsv failed: ${(err as Error).message}`);
    }

    // The sheet-visible columns exclude HEADSHOT_URL, TEAM_LOGO_URL, OPP_LOGO_URL
    const EXCLUDED = new Set(["HEADSHOT_URL", "TEAM_LOGO_URL", "OPP_LOGO_URL"]);
    const sheetVisibleCols = parsedColumns.filter(c => !EXCLUDED.has(c));
    console.log(`  sheet-visible columns (${sheetVisibleCols.length}): [${sheetVisibleCols.slice(0, 12).join(", ")}${sheetVisibleCols.length > 12 ? ", ..." : ""}]`);
    console.log(`  last column: "${sheetVisibleCols[sheetVisibleCols.length - 1]}"`);

    // PLAYERID in parsed output
    const parsedHasPlayerId = sheetVisibleCols.includes("PLAYERID");
    console.log(`  PLAYERID in parsed output: ${parsedHasPlayerId}`);

    // ── 4. Read live Google Sheet ─────────────────────────────────────────────
    let sheetHeaders: string[] = [];
    let sheetRows: string[][] = [];
    try {
      const sheet = await readSheetTab(sheets, cfg.sheetTab);
      sheetHeaders = sheet.headers;
      sheetRows = sheet.rows;
      console.log(`\n[STATE] LIVE SHEET ("${cfg.sheetTab}"):`);
      console.log(`  headers (${sheetHeaders.length}): [${sheetHeaders.slice(0, 12).join(", ")}${sheetHeaders.length > 12 ? ", ..." : ""}]`);
      console.log(`  data rows: ${sheetRows.length}`);
      console.log(`  last column: "${sheetHeaders[sheetHeaders.length - 1]}"`);
    } catch (err) {
      issues.push(`SHEET_READ_FAILED: ${(err as Error).message}`);
      console.error(`[VERIFY] FAIL — Sheet read failed: ${(err as Error).message}`);
    }

    // ── 5. Border check ───────────────────────────────────────────────────────
    const borderState = await readSheetBorderState(sheets, cfg.sheetTab);
    console.log(`\n[STATE] BORDER CHECK: ${borderState.detail}`);
    if (borderState.hasBorders) {
      passes.push(`BORDERS_PRESENT`);
      console.log(`[VERIFY] PASS — Borders present on A1`);
    } else {
      issues.push(`BORDERS_MISSING: ${borderState.detail}`);
      console.log(`[VERIFY] FAIL — Borders MISSING on A1`);
    }

    // ── 6. PLAYERID cross-reference ───────────────────────────────────────────
    console.log(`\n[STATE] PLAYERID CROSS-REFERENCE:`);
    console.log(`  raw CSV: ${rawHasPlayerId}`);
    console.log(`  parsed output: ${parsedHasPlayerId}`);
    console.log(`  sheet: ${sheetHeaders.includes("PLAYERID")}`);

    if (!rawHasPlayerId) {
      issues.push(`PLAYERID_ABSENT_FROM_SOURCE: RG CSV for ${cfg.pageKey} does not include PLAYERID`);
      console.log(`[VERIFY] FAIL — PLAYERID not in raw CSV for ${cfg.pageKey} — source data limitation`);
    } else if (rawHasPlayerId && !parsedHasPlayerId) {
      issues.push(`PLAYERID_DROPPED_IN_PARSE: raw CSV has PLAYERID but parseRgCsv dropped it`);
      console.log(`[VERIFY] FAIL — PLAYERID present in raw CSV but DROPPED by parseRgCsv`);
    } else if (parsedHasPlayerId && !sheetHeaders.includes("PLAYERID")) {
      issues.push(`PLAYERID_DROPPED_IN_WRITE: parsed output has PLAYERID but sheet does not`);
      console.log(`[VERIFY] FAIL — PLAYERID in parsed output but DROPPED in sheet write`);
    } else if (rawHasPlayerId && parsedHasPlayerId && sheetHeaders.includes("PLAYERID")) {
      passes.push(`PLAYERID_PRESENT_END_TO_END`);
      console.log(`[VERIFY] PASS — PLAYERID present in raw CSV, parsed output, and sheet`);
    }

    // ── 7. MLB_ID last column check ───────────────────────────────────────────
    const lastSheetCol = sheetHeaders[sheetHeaders.length - 1];
    if (lastSheetCol === "MLB_ID") {
      passes.push(`MLB_ID_LAST`);
      console.log(`[VERIFY] PASS — MLB_ID is last column`);
    } else {
      issues.push(`MLB_ID_NOT_LAST: last="${lastSheetCol}"`);
      console.log(`[VERIFY] FAIL — MLB_ID is NOT last column: last="${lastSheetCol}"`);
    }

    // ── 8. Column order: raw CSV vs sheet ─────────────────────────────────────
    console.log(`\n[STATE] COLUMN ORDER CROSS-REFERENCE (raw CSV vs sheet, excluding MLB_ID):`);
    // The sheet should have: rawHeaders (with PLAYER→NAME rename) + MLB_ID
    const expectedSheetCols = rawHeaders.map(h => h === "PLAYER" ? "NAME" : h).concat(["MLB_ID"]);
    const sheetColsForCompare = sheetHeaders; // already includes MLB_ID at end

    let orderMismatch = false;
    for (let i = 0; i < Math.max(expectedSheetCols.length, sheetColsForCompare.length); i++) {
      const exp = expectedSheetCols[i] ?? "(missing)";
      const got = sheetColsForCompare[i] ?? "(missing)";
      if (exp !== got) {
        issues.push(`COL_ORDER_MISMATCH[${i}]: expected="${exp}" got="${got}"`);
        console.log(`[VERIFY] FAIL — col[${i}]: expected="${exp}" got="${got}"`);
        orderMismatch = true;
      }
    }
    if (!orderMismatch && rawHeaders.length > 0) {
      passes.push(`COLUMN_ORDER_EXACT_MATCH`);
      console.log(`[VERIFY] PASS — Column order matches raw CSV exactly (${rawHeaders.length} cols + MLB_ID)`);
    }

    // ── 9. Row count cross-reference ─────────────────────────────────────────
    console.log(`\n[STATE] ROW COUNT: raw=${rawRows.length} parsed=${parsedRows.length} sheet=${sheetRows.length}`);
    if (rawRows.length > 0 && parsedRows.length !== rawRows.length) {
      issues.push(`ROW_COUNT_MISMATCH: raw=${rawRows.length} parsed=${parsedRows.length}`);
      console.log(`[VERIFY] FAIL — Row count mismatch: raw=${rawRows.length} parsed=${parsedRows.length}`);
    } else if (rawRows.length > 0 && sheetRows.length !== parsedRows.length) {
      issues.push(`SHEET_ROW_COUNT_MISMATCH: parsed=${parsedRows.length} sheet=${sheetRows.length}`);
      console.log(`[VERIFY] FAIL — Sheet row count mismatch: parsed=${parsedRows.length} sheet=${sheetRows.length}`);
    } else if (rawRows.length > 0) {
      passes.push(`ROW_COUNT_MATCH: ${rawRows.length}`);
      console.log(`[VERIFY] PASS — Row count matches: ${rawRows.length}`);
    }

    // ── 10. Sample row value comparison (raw vs sheet) ────────────────────────
    if (rawRows.length > 0 && sheetRows.length > 0) {
      console.log(`\n[STATE] SAMPLE ROW[0] VALUE COMPARISON (raw CSV vs sheet):`);
      const rawRow0 = rawRows[0];
      const sheetRow0 = sheetRows[0];
      // Compare first 10 columns
      for (let i = 0; i < Math.min(10, rawHeaders.length); i++) {
        const rawCol = rawHeaders[i];
        const sheetCol = rawCol === "PLAYER" ? "NAME" : rawCol;
        const sheetColIdx = sheetHeaders.indexOf(sheetCol);
        const rawVal = rawRow0[i] ?? "";
        const sheetVal = sheetColIdx >= 0 ? (sheetRow0[sheetColIdx] ?? "") : "(col not in sheet)";
        // Normalize for comparison: booleans, case
        const rawNorm = rawVal.toLowerCase();
        const sheetNorm = sheetVal.toLowerCase();
        const match = rawNorm === sheetNorm || rawVal === sheetVal;
        const flag = match ? "✓" : "✗";
        console.log(`  ${flag} col[${i}] "${sheetCol}": raw="${rawVal}" sheet="${sheetVal}"`);
        if (!match) {
          issues.push(`ROW0_VALUE_MISMATCH col="${sheetCol}": raw="${rawVal}" sheet="${sheetVal}"`);
        }
      }
    }

    // ── Summary ───────────────────────────────────────────────────────────────
    const status = issues.length === 0 ? "✓ PASS" : `✗ FAIL (${issues.length} issues)`;
    console.log(`\n[OUTPUT] ${cfg.pageKey} — ${status}`);
    console.log(`  PASSES: ${passes.join(" | ") || "none"}`);
    if (issues.length > 0) {
      console.log(`  ISSUES:`);
      for (const issue of issues) console.log(`    ✗ ${issue}`);
    }

    totalIssues += issues.length;
    summaryLines.push(`  ${status} — ${cfg.pageKey} ("${cfg.sheetTab}")`);
    if (issues.length > 0) {
      for (const issue of issues) summaryLines.push(`    ✗ ${issue}`);
    }
  }

  // ── Final summary ─────────────────────────────────────────────────────────
  console.log(`\n${"═".repeat(72)}`);
  console.log("[OUTPUT] FINAL AUDIT SUMMARY");
  console.log(`${"═".repeat(72)}`);
  for (const line of summaryLines) console.log(line);
  console.log(`\n[VERIFY] ${totalIssues === 0 ? "PASS — ALL CHECKS PASSED" : `FAIL — ${totalIssues} total issues`}`);
  console.log(`${"═".repeat(72)}`);
}

main().catch(err => {
  console.error("[FATAL]", err);
  process.exit(1);
});
