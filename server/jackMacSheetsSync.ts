/**
 * jackMacSheetsSync.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Syncs all 4 Rotogrinders THE BAT X projection tables to the Jack Mac
 * Google Sheet: https://docs.google.com/spreadsheets/d/1lUlFy--SwMHrMKxRiJmvkFePbdBO4PDJvrw0OKDY3Hw
 *
 * Sheet tab mapping:
 *   today-pitchers    → "The Bat X"
 *   today-hitters     → "The Bat X Hitters"
 *   tomorrow-pitchers → "Tomorrow's Projections (The Bat X)"
 *   tomorrow-hitters  → "Tomorrow's Projections (The Bat X Hitters)"
 *
 * Uses Google Sheets API v4 with a service account (GOOGLE_SERVICE_ACCOUNT_JSON).
 *
 * Execution flow:
 *   1. Authenticate with Google Sheets API via service account
 *   2. Authenticate with Rotogrinders (cached session cookie)
 *   3. For each of the 4 pages:
 *      a. Fetch HTML from Rotogrinders
 *      b. Parse table → { columns, rows }
 *      c. Clear the corresponding sheet tab
 *      d. Write header row + all data rows
 *   4. Return a structured sync result with per-tab row counts and timestamps
 */

import { google } from "googleapis";
import {
  PAGE_CONFIG,
  getRgSessionCookie,
  fetchRgCsv,
  parseRgCsv,
  type RgTableData,
} from "./rotogrinderProxy";

// ─── Constants ────────────────────────────────────────────────────────────────

const SPREADSHEET_ID = "1lUlFy--SwMHrMKxRiJmvkFePbdBO4PDJvrw0OKDY3Hw";


// Maps PAGE_CONFIG keys → exact Google Sheet tab names
const PAGE_TO_SHEET_TAB: Record<string, string> = {
  "today-pitchers":    "The Bat X",
  "today-hitters":     "The Bat X Hitters",
  "tomorrow-pitchers": "Tomorrow's Projections (The Bat X)",
  "tomorrow-hitters":  "Tomorrow's Projections (The Bat X Hitters)",
};

// Columns to EXCLUDE from the Google Sheet (UI-only enrichment columns)
const EXCLUDED_COLUMNS = new Set(["HEADSHOT_URL", "TEAM_LOGO_URL", "OPP_LOGO_URL"]);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SheetSyncTabResult {
  pageKey: string;
  sheetTab: string;
  rowsWritten: number;
  columnsWritten: number;
  updatedAt: string;
  elapsedMs: number;
  status: "success" | "error";
  error?: string;
}

export interface SheetSyncResult {
  success: boolean;
  syncedAt: string;
  totalRowsWritten: number;
  tabs: SheetSyncTabResult[];
  elapsedMs: number;
}

// ─── Google Sheets Auth ───────────────────────────────────────────────────────

function getGoogleSheetsClient() {
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!saJson) {
    throw new Error("[SheetsSync] GOOGLE_SERVICE_ACCOUNT_JSON is not set in environment");
  }

  let credentials: Record<string, unknown>;
  try {
    credentials = JSON.parse(saJson);
  } catch (err) {
    throw new Error(`[SheetsSync] Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON: ${(err as Error).message}`);
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return google.sheets({ version: "v4", auth });
}

// ─── Sheet Write Helpers ──────────────────────────────────────────────────────

/**
 * Clears all content in a named sheet tab.
 */
async function clearSheetTab(
  sheets: ReturnType<typeof google.sheets>,
  tabName: string
): Promise<void> {
  console.log(`[SheetsSync] [STEP] Clearing tab: "${tabName}"`);
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${tabName}'`,
  });
  console.log(`[SheetsSync] [STATE] Tab "${tabName}" cleared`);
}

/**
 * Writes header + data rows to a named sheet tab starting at A1.
 * Strips excluded columns (HEADSHOT_URL, TEAM_LOGO_URL, OPP_LOGO_URL).
 */
async function writeSheetTab(
  sheets: ReturnType<typeof google.sheets>,
  tabName: string,
  tableData: RgTableData
): Promise<{ rowsWritten: number; columnsWritten: number }> {
  // Filter out UI-only enrichment columns
  const writeColumns = tableData.columns.filter(c => !EXCLUDED_COLUMNS.has(c));
  const colIndexMap = writeColumns.map(c => tableData.columns.indexOf(c));

  console.log(
    `[SheetsSync] [STATE] Tab "${tabName}": ${writeColumns.length} cols, ${tableData.rows.length} data rows`
  );

  if (writeColumns.length === 0 || tableData.rows.length === 0) {
    console.warn(`[SheetsSync] [VERIFY] WARN — No data to write for tab "${tabName}"`);
    return { rowsWritten: 0, columnsWritten: 0 };
  }

  // Build 2D array: header row + data rows
  const values: string[][] = [];

  // Header row
  values.push(writeColumns);

  // Data rows — preserve column order, use "" for missing values
  for (const row of tableData.rows) {
    const dataRow = writeColumns.map(col => {
      const val = row[col];
      if (val === undefined || val === null) return "";
      // Convert boolean strings to readable format
      if (val === "true") return "TRUE";
      if (val === "false") return "FALSE";
      return String(val);
    });
    values.push(dataRow);
  }

  console.log(`[SheetsSync] [STEP] Writing ${values.length} rows (incl. header) to "${tabName}"...`);

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${tabName}'!A1`,
    valueInputOption: "RAW",
    requestBody: { values },
  });

  const rowsWritten = values.length - 1; // exclude header
  console.log(`[SheetsSync] [OUTPUT] Tab "${tabName}": wrote ${rowsWritten} rows × ${writeColumns.length} cols`);

  return { rowsWritten, columnsWritten: writeColumns.length };
}

// ─── Main Sync Function ───────────────────────────────────────────────────────

/**
 * Syncs all 4 Rotogrinders pages to the Jack Mac Google Sheet.
 * Returns a structured result with per-tab status and row counts.
 */
export async function syncJackMacToSheets(): Promise<SheetSyncResult> {
  const syncStart = Date.now();
  console.log("[SheetsSync] [INPUT] Starting Jack Mac → Google Sheets sync");
  console.log(`[SheetsSync] [STATE] Spreadsheet ID: ${SPREADSHEET_ID}`);
  console.log(`[SheetsSync] [STATE] Pages to sync: ${Object.keys(PAGE_TO_SHEET_TAB).join(", ")}`);

  // ── Step 1: Initialize Google Sheets client ────────────────────────────────
  let sheets: ReturnType<typeof google.sheets>;
  try {
    sheets = getGoogleSheetsClient();
    console.log("[SheetsSync] [STATE] Google Sheets client initialized");
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`[SheetsSync] [VERIFY] FAIL — Sheets auth error: ${msg}`);
    return {
      success: false,
      syncedAt: new Date().toISOString(),
      totalRowsWritten: 0,
      tabs: [],
      elapsedMs: Date.now() - syncStart,
    };
  }

  // ── Step 2: Get Rotogrinders session cookie ────────────────────────────────
  let rgCookie: string;
  try {
    rgCookie = await getRgSessionCookie();
    console.log("[SheetsSync] [STATE] Rotogrinders session cookie obtained");
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`[SheetsSync] [VERIFY] FAIL — RG auth error: ${msg}`);
    return {
      success: false,
      syncedAt: new Date().toISOString(),
      totalRowsWritten: 0,
      tabs: [],
      elapsedMs: Date.now() - syncStart,
    };
  }

  // ── Step 3: Sync each page ─────────────────────────────────────────────────
  const tabResults: SheetSyncTabResult[] = [];
  let totalRowsWritten = 0;

  for (const [pageKey, sheetTab] of Object.entries(PAGE_TO_SHEET_TAB)) {
    const tabStart = Date.now();
    const pageConf = PAGE_CONFIG[pageKey];
    console.log(`\n[SheetsSync] [STEP] Processing page="${pageKey}" → tab="${sheetTab}"`);

    try {
      // 3a. Fetch CSV from Rotogrinders (complete dataset, no lazy-loading)
      console.log(`[SheetsSync] [INPUT] Fetching CSV for page="${pageKey}" csvId=${pageConf.csvId}`);
      const csvText = await fetchRgCsv(pageConf.csvId, rgCookie);
      console.log(`[SheetsSync] [STATE] Fetched ${csvText.length} bytes CSV for page="${pageKey}"`);

      // 3b. Parse CSV
      const tableData = await parseRgCsv(csvText, pageKey, pageConf.title, pageConf.type);
      console.log(
        `[SheetsSync] [STATE] Parsed CSV page="${pageKey}": ${tableData.rows.length} rows, ${tableData.columns.length} cols`
      );

      if (tableData.rows.length === 0) {
        console.warn(`[SheetsSync] [VERIFY] WARN — page="${pageKey}" returned 0 rows. Skipping write.`);
        tabResults.push({
          pageKey,
          sheetTab,
          rowsWritten: 0,
          columnsWritten: 0,
          updatedAt: tableData.updatedAt,
          elapsedMs: Date.now() - tabStart,
          status: "success",
        });
        continue;
      }

      // 3c. Clear existing sheet tab content
      await clearSheetTab(sheets, sheetTab);

      // 3d. Write header + data rows
      const { rowsWritten, columnsWritten } = await writeSheetTab(sheets, sheetTab, tableData);
      totalRowsWritten += rowsWritten;

      const tabElapsed = Date.now() - tabStart;
      console.log(
        `[SheetsSync] [VERIFY] PASS — page="${pageKey}" tab="${sheetTab}" rows=${rowsWritten} cols=${columnsWritten} elapsed=${tabElapsed}ms`
      );

      tabResults.push({
        pageKey,
        sheetTab,
        rowsWritten,
        columnsWritten,
        updatedAt: tableData.updatedAt,
        elapsedMs: tabElapsed,
        status: "success",
      });
    } catch (err) {
      const msg = (err as Error).message;
      const tabElapsed = Date.now() - tabStart;
      console.error(`[SheetsSync] [VERIFY] FAIL — page="${pageKey}" error: ${msg} elapsed=${tabElapsed}ms`);
      tabResults.push({
        pageKey,
        sheetTab,
        rowsWritten: 0,
        columnsWritten: 0,
        updatedAt: "",
        elapsedMs: tabElapsed,
        status: "error",
        error: msg,
      });
    }
  }

  const totalElapsed = Date.now() - syncStart;
  const allSuccess = tabResults.every(t => t.status === "success");

  console.log(`\n[SheetsSync] [OUTPUT] Sync complete:`);
  console.log(`  success=${allSuccess} totalRows=${totalRowsWritten} elapsed=${totalElapsed}ms`);
  for (const t of tabResults) {
    console.log(`  [${t.status.toUpperCase()}] "${t.sheetTab}" → ${t.rowsWritten} rows (${t.elapsedMs}ms)`);
  }
  console.log(`[SheetsSync] [VERIFY] ${allSuccess ? "PASS" : "PARTIAL"} — sync finished`);

  return {
    success: allSuccess,
    syncedAt: new Date().toISOString(),
    totalRowsWritten,
    tabs: tabResults,
    elapsedMs: totalElapsed,
  };
}
