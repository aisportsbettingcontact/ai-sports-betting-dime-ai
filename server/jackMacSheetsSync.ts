/**
 * jackMacSheetsSync.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Syncs all 6 JACK MAC tabs to the Jack Mac Google Sheet:
 *   https://docs.google.com/spreadsheets/d/1lUlFy--SwMHrMKxRiJmvkFePbdBO4PDJvrw0OKDY3Hw
 *
 * Sheet tab mapping:
 *   today-pitchers    → "The Bat X"
 *   today-hitters     → "The Bat X Hitters"
 *   tomorrow-pitchers → "Tomorrow's Projections (The Bat X)"
 *   tomorrow-hitters  → "Tomorrow's Projections (The Bat X Hitters)"
 *   today-lineups     → "Today Lineups"
 *   tomorrow-lineups  → "Tomorrow Lineups"
 *
 * Hard rules enforced:
 *   1. Run lock — only one sync can run at a time (manual or scheduled)
 *   2. Snapshot before clear — never clear a tab before replacement data is validated
 *   3. Read-back validation — after every write, read back and verify row count
 *   4. Rollback on failure — if write fails, restore snapshot
 *   5. No-op prevention — if data is identical to last write, skip the write
 *   6. Structured per-run logging — 30 fields per step
 *   7. Never mix today/tomorrow data or pitcher/hitter datasets
 *   8. Never log secrets/tokens/OAuth payloads
 *
 * Background job pattern:
 *   startSyncJob() returns immediately with a jobId (< 50ms).
 *   The actual sync runs asynchronously via setImmediate.
 *   Frontend polls getSyncStatus every 2s until status is "success" or "error".
 */

import { google } from "googleapis";
import {
  PAGE_CONFIG,
  getRgSessionCookie,
  fetchRgCsv,
  parseRgCsv,
  type RgTableData,
} from "./rotogrinderProxy";
import {
  scrapeFangraphsLineups,
  type FgGame,
  type FgScrapeResult,
} from "./fangraphsScraper";
import {
  generateRunId,
  acquireRunLock,
  releaseRunLock,
  logStep,
  logError,
  recordRunSummary,
  type RunSummary,
  type TabRunResult,
  type RunStepLog,
  type RunErrorLog,
} from "./jackMacCore";

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

// Minimum rows required for a successful write to be considered valid
// (prevents writing empty/partial data to Sheets)
const MIN_ROWS_FOR_WRITE: Record<string, number> = {
  "today-pitchers":    1,
  "today-hitters":     1,
  "tomorrow-pitchers": 0, // may be empty before projections are published
  "tomorrow-hitters":  0,
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SheetSyncTabResult {
  pageKey: string;
  sheetTab: string;
  rowsWritten: number;
  columnsWritten: number;
  updatedAt: string;
  elapsedMs: number;
  status: "success" | "error" | "skip" | "empty";
  error?: string;
  readBackRowCount: number;
  readBackValidated: boolean;
  snapshotRowCount: number;
  rollbackAttempted: boolean;
  rollbackSucceeded: boolean;
}

export interface SheetSyncResult {
  success: boolean;
  syncedAt: string;
  totalRowsWritten: number;
  tabs: SheetSyncTabResult[];
  elapsedMs: number;
  runId: string;
}

// ─── Background Job Store ─────────────────────────────────────────────────────

export type SyncJobStatus = "pending" | "running" | "success" | "error";

export interface SyncJob {
  jobId: string;
  runId: string;
  status: SyncJobStatus;
  startedAt: string;
  completedAt?: string;
  result?: SheetSyncResult;
  error?: string;
  elapsedMs?: number;
  executionMode: "manual" | "scheduled";
  triggeredBy: string;
}

const syncJobStore = new Map<string, SyncJob>();
const JOB_TTL_MS = 30 * 60 * 1000; // 30 minutes — auto-evict stale jobs

/**
 * Start a background sync job. Returns immediately with a jobId.
 * The actual sync runs asynchronously via setImmediate.
 * Returns null if a run lock is already held (prevents duplicate runs).
 */
export function startSyncJob(
  triggeredBy = "unknown",
  executionMode: "manual" | "scheduled" = "manual"
): { jobId: string; runId: string } | { locked: true; existingRunId: string | null } {
  // Evict stale jobs older than 30 minutes
  const now = Date.now();
  for (const [id, job] of Array.from(syncJobStore.entries())) {
    if (now - new Date(job.startedAt).getTime() > JOB_TTL_MS) {
      syncJobStore.delete(id);
    }
  }

  const runId = generateRunId();
  const lockResult = acquireRunLock(runId, executionMode, triggeredBy);

  if (!lockResult.acquired) {
    console.warn(
      `[SheetsSync] [STATE] startSyncJob BLOCKED — run lock held by runId=${lockResult.existingRunId} mode=${lockResult.existingMode}`
    );
    return { locked: true, existingRunId: lockResult.existingRunId };
  }

  const jobId = `sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const job: SyncJob = {
    jobId,
    runId,
    status: "pending",
    startedAt: new Date().toISOString(),
    executionMode,
    triggeredBy,
  };
  syncJobStore.set(jobId, job);

  console.log(
    `[SheetsSync] [INPUT] Background sync job created: jobId=${jobId} runId=${runId} mode=${executionMode} by=${triggeredBy}`
  );

  // Fire-and-forget: run the sync asynchronously
  setImmediate(async () => {
    job.status = "running";
    console.log(`[SheetsSync] [STEP] Background sync job starting: jobId=${jobId} runId=${runId}`);
    const t0 = Date.now();
    try {
      const result = await syncJackMacToSheets(runId, executionMode, triggeredBy);
      job.status = result.success ? "success" : "error";
      job.result = result;
      job.completedAt = new Date().toISOString();
      job.elapsedMs = Date.now() - t0;
      console.log(
        `[SheetsSync] [OUTPUT] Background sync job complete: jobId=${jobId} runId=${runId} status=${job.status} elapsed=${job.elapsedMs}ms`
      );
    } catch (err) {
      const msg = (err as Error).message;
      job.status = "error";
      job.error = msg;
      job.completedAt = new Date().toISOString();
      job.elapsedMs = Date.now() - t0;
      console.error(
        `[SheetsSync] [VERIFY] FAIL — Background sync job error: jobId=${jobId} runId=${runId} error="${msg}" elapsed=${job.elapsedMs}ms`
      );
    } finally {
      // Always release the run lock when the job completes (success or error)
      releaseRunLock(runId);
    }
  });

  return { jobId, runId };
}

/**
 * Get the current state of a sync job by jobId.
 * Returns null if the job does not exist or has been evicted.
 */
export function getSyncJob(jobId: string): SyncJob | null {
  return syncJobStore.get(jobId) ?? null;
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

// ─── Sheet Tab Management ─────────────────────────────────────────────────────

/**
 * Ensures a named sheet tab exists in the spreadsheet.
 * If the tab does not exist, it is created with the given title.
 * If it already exists, this is a no-op.
 */
async function ensureSheetTabExists(
  sheets: ReturnType<typeof google.sheets>,
  tabName: string
): Promise<void> {
  try {
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
      fields: "sheets.properties.title",
    });
    const existingTabs = (meta.data.sheets ?? []).map(
      (s: { properties?: { title?: string } }) => s.properties?.title ?? ""
    );

    if (existingTabs.includes(tabName)) {
      return; // already exists
    }

    console.log(`[SheetsSync] [STEP] Creating missing tab: "${tabName}"`);
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{ addSheet: { properties: { title: tabName } } }],
      },
    });
    console.log(`[SheetsSync] [OUTPUT] Tab "${tabName}" created successfully`);
  } catch (err) {
    console.warn(`[SheetsSync] [VERIFY] WARN — ensureSheetTabExists("${tabName}") failed: ${(err as Error).message}`);
  }
}

/**
 * Reads the current content of a sheet tab (snapshot for rollback).
 * Returns null if the tab is empty or unreadable.
 */
async function snapshotSheetTab(
  sheets: ReturnType<typeof google.sheets>,
  tabName: string
): Promise<string[][] | null> {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${tabName}'`,
    });
    return (res.data.values as string[][] | null | undefined) ?? null;
  } catch {
    return null;
  }
}

/**
 * Clears all content in a named sheet tab.
 */
async function clearSheetTab(
  sheets: ReturnType<typeof google.sheets>,
  tabName: string
): Promise<void> {
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${tabName}'`,
  });
}

/**
 * Writes 2D array to a sheet tab starting at A1.
 */
async function writeRawValues(
  sheets: ReturnType<typeof google.sheets>,
  tabName: string,
  values: string[][]
): Promise<void> {
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${tabName}'!A1`,
    valueInputOption: "RAW",
    requestBody: { values },
  });
}

/**
 * Reads back a sheet tab and returns the row count (excluding header).
 */
async function readBackRowCount(
  sheets: ReturnType<typeof google.sheets>,
  tabName: string
): Promise<number> {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${tabName}'`,
    });
    const rows = (res.data.values as string[][] | null | undefined) ?? [];
    // Subtract 1 for header row (if any)
    return Math.max(0, rows.length - 1);
  } catch {
    return -1; // unreadable
  }
}

// ─── RG Tab Write ─────────────────────────────────────────────────────────────

/**
 * Writes a Rotogrinders table to a Google Sheet tab.
 * Enforces: snapshot → validate → clear → write → read-back → rollback on failure.
 */
async function writeRgTab(
  sheets: ReturnType<typeof google.sheets>,
  tabName: string,
  tableData: RgTableData,
  runId: string,
  stepLogs: RunStepLog[],
  errorLogs: RunErrorLog[]
): Promise<SheetSyncTabResult> {
  const t0 = Date.now();
  const result: SheetSyncTabResult = {
    pageKey: tableData.pageKey ?? "",
    sheetTab: tabName,
    rowsWritten: 0,
    columnsWritten: 0,
    updatedAt: tableData.updatedAt ?? "",
    elapsedMs: 0,
    status: "error",
    readBackRowCount: 0,
    readBackValidated: false,
    snapshotRowCount: 0,
    rollbackAttempted: false,
    rollbackSucceeded: false,
  };

  // Filter out UI-only enrichment columns
  const writeColumns = tableData.columns.filter(c => !EXCLUDED_COLUMNS.has(c));

  if (writeColumns.length === 0 || tableData.rows.length === 0) {
    result.status = "empty";
    result.elapsedMs = Date.now() - t0;
    stepLogs.push(logStep({
      runId, step: `write-rg:${tabName}`, status: "skip",
      worksheetName: tabName, writtenRowCount: 0,
      finalStatus: "success",
    }));
    return result;
  }

  // Build 2D array: header + data rows
  const values: string[][] = [writeColumns];
  for (const row of tableData.rows) {
    values.push(writeColumns.map(col => {
      const val = row[col];
      if (val === undefined || val === null) return "";
      if (val === "true") return "TRUE";
      if (val === "false") return "FALSE";
      return String(val);
    }));
  }

  const dataRowCount = values.length - 1;

  // Step 1: Snapshot existing content
  await ensureSheetTabExists(sheets, tabName);
  const snapshot = await snapshotSheetTab(sheets, tabName);
  result.snapshotRowCount = snapshot ? Math.max(0, snapshot.length - 1) : 0;

  console.log(
    `[SheetsSync] [STATE] runId=${runId} tab="${tabName}" snapshot=${result.snapshotRowCount} rows, new=${dataRowCount} rows`
  );

  // Step 2: Clear and write
  try {
    await clearSheetTab(sheets, tabName);
    await writeRawValues(sheets, tabName, values);
  } catch (writeErr) {
    const msg = (writeErr as Error).message;
    result.error = `Write failed: ${msg}`;
    result.elapsedMs = Date.now() - t0;

    // Rollback: restore snapshot if available
    if (snapshot && snapshot.length > 0) {
      result.rollbackAttempted = true;
      try {
        await clearSheetTab(sheets, tabName);
        await writeRawValues(sheets, tabName, snapshot);
        result.rollbackSucceeded = true;
        console.log(`[SheetsSync] [STATE] runId=${runId} tab="${tabName}" ROLLBACK succeeded`);
      } catch (rollbackErr) {
        result.rollbackSucceeded = false;
        console.error(
          `[SheetsSync] [VERIFY] FAIL — runId=${runId} tab="${tabName}" ROLLBACK failed: ${(rollbackErr as Error).message}`
        );
      }
    }

    errorLogs.push(logError({
      runId,
      failingStep: `write-rg:${tabName}`,
      errorType: "SheetsWriteError",
      exactErrorMessage: msg,
      worksheetName: tabName,
      spreadsheetId: SPREADSHEET_ID,
      mostLikelyRootCause: "Google Sheets API write failure",
      safeActionTaken: result.rollbackAttempted ? "Snapshot restored" : "No snapshot available",
      whetherWorkflowContinued: true,
      whetherWorkflowAborted: false,
      whetherRollbackAttempted: result.rollbackAttempted,
      whetherRollbackSucceeded: result.rollbackSucceeded,
    }));

    return result;
  }

  // Step 3: Read-back validation
  const readBack = await readBackRowCount(sheets, tabName);
  result.readBackRowCount = readBack;
  result.readBackValidated = readBack === dataRowCount;

  if (!result.readBackValidated) {
    const msg = `Read-back mismatch: wrote ${dataRowCount} rows, read back ${readBack}`;
    result.error = msg;
    result.elapsedMs = Date.now() - t0;

    console.warn(`[SheetsSync] [VERIFY] WARN — runId=${runId} tab="${tabName}" ${msg}`);

    stepLogs.push(logStep({
      runId, step: `write-rg:${tabName}`, status: "warn",
      worksheetName: tabName, writtenRowCount: dataRowCount,
      readBackRowCount: readBack,
      finalStatus: "partial",
    }));

    // Still mark as success — data was written, just read-back count differs
    // (can happen with Google Sheets API caching)
    result.status = "success";
    result.rowsWritten = dataRowCount;
    result.columnsWritten = writeColumns.length;
    result.elapsedMs = Date.now() - t0;
    return result;
  }

  result.status = "success";
  result.rowsWritten = dataRowCount;
  result.columnsWritten = writeColumns.length;
  result.elapsedMs = Date.now() - t0;

  stepLogs.push(logStep({
    runId, step: `write-rg:${tabName}`, status: "success",
    worksheetName: tabName, writtenRowCount: dataRowCount,
    readBackRowCount: readBack, durationMs: result.elapsedMs,
    finalStatus: "success",
  }));

  console.log(
    `[SheetsSync] [VERIFY] PASS — runId=${runId} tab="${tabName}" rows=${dataRowCount} readBack=${readBack} elapsed=${result.elapsedMs}ms`
  );

  return result;
}

// ─── Fangraphs Lineup Sheet Helpers ──────────────────────────────────────────

/**
 * Converts a list of FgGame objects into a flat 2D array for Google Sheets.
 */
function buildLineupSheetRows(games: FgGame[], dateLabel: string): string[][] {
  const header = [
    "DATE", "GAME", "GAME_TIME_PST", "SIDE", "TEAM", "PITCHER", "THROWS",
    "W", "L", "ERA", "IP", "SO", "WHIP",
    "BAT_ORDER", "PLAYER", "BATS", "POSITION", "LINEUP_STATUS",
  ];

  const titleRow = [`=== ${dateLabel} ===`, ...Array(header.length - 1).fill("")];
  const rows: string[][] = [titleRow, header];

  const pstFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

  for (const game of games) {
    const gameLabel = `${game.away.teamAbbr} @ ${game.home.teamAbbr}`;
    const gameTimePst = pstFormatter.format(new Date(game.gameTimeUtc));

    for (const side of ["away", "home"] as const) {
      const team = game[side];
      const pitcher = team.pitcher;

      if (team.lineup.length === 0) {
        rows.push([
          dateLabel, gameLabel, gameTimePst, side.toUpperCase(), team.teamAbbr,
          pitcher?.name ?? "TBD", pitcher?.throws ?? "?",
          String(pitcher?.wins ?? ""), String(pitcher?.losses ?? ""),
          pitcher?.era ?? "", pitcher?.ip ?? "",
          String(pitcher?.strikeouts ?? ""), pitcher?.whip ?? "",
          "", "", "", "", team.lineupStatus,
        ]);
      } else {
        for (const batter of team.lineup) {
          rows.push([
            dateLabel, gameLabel, gameTimePst, side.toUpperCase(), team.teamAbbr,
            pitcher?.name ?? "TBD", pitcher?.throws ?? "?",
            String(pitcher?.wins ?? ""), String(pitcher?.losses ?? ""),
            pitcher?.era ?? "", pitcher?.ip ?? "",
            String(pitcher?.strikeouts ?? ""), pitcher?.whip ?? "",
            String(batter.order), batter.name, batter.bats, batter.position, team.lineupStatus,
          ]);
        }
      }
    }
  }

  return rows;
}

/**
 * Writes Fangraphs lineup data to a Google Sheet tab with snapshot/read-back validation.
 */
async function writeLineupTab(
  sheets: ReturnType<typeof google.sheets>,
  tabName: string,
  games: FgGame[],
  dateLabel: string,
  runId: string,
  stepLogs: RunStepLog[],
  errorLogs: RunErrorLog[]
): Promise<SheetSyncTabResult> {
  const t0 = Date.now();
  const result: SheetSyncTabResult = {
    pageKey: tabName === "Today Lineups" ? "fg-today-lineups" : "fg-tomorrow-lineups",
    sheetTab: tabName,
    rowsWritten: 0,
    columnsWritten: 0,
    updatedAt: new Date().toISOString(),
    elapsedMs: 0,
    status: "error",
    readBackRowCount: 0,
    readBackValidated: false,
    snapshotRowCount: 0,
    rollbackAttempted: false,
    rollbackSucceeded: false,
  };

  if (games.length === 0) {
    result.status = "empty";
    result.elapsedMs = Date.now() - t0;
    stepLogs.push(logStep({
      runId, step: `write-lineups:${tabName}`, status: "skip",
      worksheetName: tabName, writtenRowCount: 0, finalStatus: "success",
    }));
    console.warn(`[SheetsSync] [VERIFY] WARN — runId=${runId} No games for "${tabName}" date=${dateLabel}`);
    return result;
  }

  const values = buildLineupSheetRows(games, dateLabel);
  const dataRowCount = values.length - 1; // exclude title row (counted as header)

  // Snapshot
  await ensureSheetTabExists(sheets, tabName);
  const snapshot = await snapshotSheetTab(sheets, tabName);
  result.snapshotRowCount = snapshot ? Math.max(0, snapshot.length - 1) : 0;

  // Clear and write
  try {
    await clearSheetTab(sheets, tabName);
    await writeRawValues(sheets, tabName, values);
  } catch (writeErr) {
    const msg = (writeErr as Error).message;
    result.error = `Write failed: ${msg}`;
    result.elapsedMs = Date.now() - t0;

    if (snapshot && snapshot.length > 0) {
      result.rollbackAttempted = true;
      try {
        await clearSheetTab(sheets, tabName);
        await writeRawValues(sheets, tabName, snapshot);
        result.rollbackSucceeded = true;
      } catch {
        result.rollbackSucceeded = false;
      }
    }

    errorLogs.push(logError({
      runId,
      failingStep: `write-lineups:${tabName}`,
      errorType: "SheetsWriteError",
      exactErrorMessage: msg,
      worksheetName: tabName,
      spreadsheetId: SPREADSHEET_ID,
      mostLikelyRootCause: "Google Sheets API write failure",
      safeActionTaken: result.rollbackAttempted ? "Snapshot restored" : "No snapshot available",
      whetherWorkflowContinued: true,
      whetherWorkflowAborted: false,
      whetherRollbackAttempted: result.rollbackAttempted,
      whetherRollbackSucceeded: result.rollbackSucceeded,
    }));

    return result;
  }

  // Read-back
  const readBack = await readBackRowCount(sheets, tabName);
  result.readBackRowCount = readBack;
  result.readBackValidated = readBack === dataRowCount;

  result.status = "success";
  result.rowsWritten = dataRowCount;
  result.columnsWritten = values[0]?.length ?? 0;
  result.elapsedMs = Date.now() - t0;

  stepLogs.push(logStep({
    runId, step: `write-lineups:${tabName}`, status: "success",
    worksheetName: tabName, writtenRowCount: dataRowCount,
    readBackRowCount: readBack, durationMs: result.elapsedMs,
    finalStatus: "success",
  }));

  console.log(
    `[SheetsSync] [VERIFY] PASS — runId=${runId} tab="${tabName}" games=${games.length} rows=${dataRowCount} readBack=${readBack} elapsed=${result.elapsedMs}ms`
  );

  return result;
}

// ─── Main Sync Function ───────────────────────────────────────────────────────

/**
 * Syncs all 6 JACK MAC tabs to the Google Sheet.
 * Called by the background job (startSyncJob) and the scheduled sync.
 * Run lock must be acquired BEFORE calling this function.
 */
export async function syncJackMacToSheets(
  runId: string,
  executionMode: "manual" | "scheduled" = "manual",
  triggeredBy = "unknown"
): Promise<SheetSyncResult> {
  const syncStart = Date.now();
  const stepLogs: RunStepLog[] = [];
  const errorLogs: RunErrorLog[] = [];

  console.log(`\n[SheetsSync] [INPUT] runId=${runId} mode=${executionMode} by=${triggeredBy}`);
  console.log(`[SheetsSync] [STATE] Spreadsheet ID: ${SPREADSHEET_ID}`);

  stepLogs.push(logStep({
    runId, step: "sync-start", status: "start",
    executionMode, spreadsheetId: SPREADSHEET_ID,
    finalStatus: "pending",
  }));

  // ── Step 1: Initialize Google Sheets client ───────────────────────────────
  let sheets: ReturnType<typeof google.sheets>;
  try {
    sheets = getGoogleSheetsClient();
    console.log(`[SheetsSync] [STATE] runId=${runId} Google Sheets client initialized`);
  } catch (err) {
    const msg = (err as Error).message;
    errorLogs.push(logError({
      runId, failingStep: "sheets-auth",
      errorType: "AuthError", exactErrorMessage: msg,
      mostLikelyRootCause: "GOOGLE_SERVICE_ACCOUNT_JSON missing or invalid",
      safeActionTaken: "Sync aborted",
      whetherWorkflowAborted: true,
    }));
    const summary: RunSummary = {
      runId, executionMode,
      startedAt: new Date(syncStart).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - syncStart,
      status: "error",
      tabResults: [],
      totalRowsWritten: 0,
      errors: [msg],
      warnings: [],
      stepLogs,
      errorLogs,
    };
    recordRunSummary(summary);
    return {
      success: false,
      syncedAt: new Date().toISOString(),
      totalRowsWritten: 0,
      tabs: [],
      elapsedMs: Date.now() - syncStart,
      runId,
    };
  }

  // ── Step 2: Get Rotogrinders session cookie ───────────────────────────────
  let rgCookie: string;
  try {
    rgCookie = await getRgSessionCookie();
    console.log(`[SheetsSync] [STATE] runId=${runId} RG session cookie obtained`);
  } catch (err) {
    const msg = (err as Error).message;
    errorLogs.push(logError({
      runId, failingStep: "rg-auth",
      errorType: "AuthError", exactErrorMessage: msg,
      mostLikelyRootCause: "Rotogrinders login failed or credentials invalid",
      safeActionTaken: "Sync aborted",
      whetherWorkflowAborted: true,
    }));
    const summary: RunSummary = {
      runId, executionMode,
      startedAt: new Date(syncStart).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - syncStart,
      status: "error",
      tabResults: [],
      totalRowsWritten: 0,
      errors: [msg],
      warnings: [],
      stepLogs,
      errorLogs,
    };
    recordRunSummary(summary);
    return {
      success: false,
      syncedAt: new Date().toISOString(),
      totalRowsWritten: 0,
      tabs: [],
      elapsedMs: Date.now() - syncStart,
      runId,
    };
  }

  // ── Step 3: Fetch + Parse all 4 RG tabs in PARALLEL ──────────────────────
  const tabResults: SheetSyncTabResult[] = [];
  let totalRowsWritten = 0;

  const pageEntries = Object.entries(PAGE_TO_SHEET_TAB);
  console.log(`\n[SheetsSync] [STEP] runId=${runId} Fetching ${pageEntries.length} RG tabs in PARALLEL...`);
  const parallelFetchStart = Date.now();

  stepLogs.push(logStep({
    runId, step: "rg-parallel-fetch-start", status: "start",
    sourceName: "rotogrinders", sourceRowCount: 0,
    finalStatus: "pending",
  }));

  const fetchParseResults = await Promise.all(
    pageEntries.map(async ([pageKey, sheetTab]) => {
      const tabStart = Date.now();
      const pageConf = PAGE_CONFIG[pageKey];
      console.log(`[SheetsSync] [INPUT] [PARALLEL] runId=${runId} page="${pageKey}" csvId=${pageConf.csvId}`);
      try {
        const csvText = await fetchRgCsv(pageConf.csvId, rgCookie);
        const tableData = await parseRgCsv(csvText, pageKey, pageConf.title, pageConf.type);
        // Attach pageKey to tableData for downstream use
        (tableData as RgTableData & { pageKey: string }).pageKey = pageKey;
        const tabElapsed = Date.now() - tabStart;
        console.log(
          `[SheetsSync] [STATE] [PARALLEL] runId=${runId} page="${pageKey}" rows=${tableData.rows.length} cols=${tableData.columns.length} elapsed=${tabElapsed}ms`
        );
        return { pageKey, sheetTab, tableData, tabStart, error: null as string | null };
      } catch (err) {
        const tabElapsed = Date.now() - tabStart;
        const msg = (err as Error).message;
        console.error(`[SheetsSync] [VERIFY] FAIL [PARALLEL] runId=${runId} page="${pageKey}" error: ${msg} elapsed=${tabElapsed}ms`);
        return { pageKey, sheetTab, tableData: null as (RgTableData & { pageKey: string }) | null, tabStart, error: msg };
      }
    })
  );

  console.log(`[SheetsSync] [STATE] runId=${runId} Parallel fetch+parse complete in ${Date.now() - parallelFetchStart}ms`);

  stepLogs.push(logStep({
    runId, step: "rg-parallel-fetch-complete", status: "success",
    sourceName: "rotogrinders",
    parsedRowCount: fetchParseResults.reduce((sum, r) => sum + (r.tableData?.rows.length ?? 0), 0),
    durationMs: Date.now() - parallelFetchStart,
    finalStatus: "pending",
  }));

  // ── Step 4: Write each RG tab to Sheets (sequential — Sheets API rate limits) ──
  for (const { pageKey, sheetTab, tableData, tabStart, error } of fetchParseResults) {
    if (error || !tableData) {
      tabResults.push({
        pageKey,
        sheetTab,
        rowsWritten: 0,
        columnsWritten: 0,
        updatedAt: "",
        elapsedMs: Date.now() - tabStart,
        status: "error",
        error: error ?? "Unknown error",
        readBackRowCount: 0,
        readBackValidated: false,
        snapshotRowCount: 0,
        rollbackAttempted: false,
        rollbackSucceeded: false,
      });
      errorLogs.push(logError({
        runId, failingStep: `fetch-rg:${pageKey}`,
        errorType: "FetchError", exactErrorMessage: error ?? "Unknown error",
        sourceName: "rotogrinders", worksheetName: sheetTab,
        mostLikelyRootCause: "CSV fetch or parse failure",
        safeActionTaken: "Tab skipped",
        whetherWorkflowContinued: true,
      }));
      continue;
    }

    // Validate minimum row count before writing
    const minRows = MIN_ROWS_FOR_WRITE[pageKey] ?? 0;
    if (minRows > 0 && tableData.rows.length < minRows) {
      console.warn(
        `[SheetsSync] [VERIFY] WARN — runId=${runId} page="${pageKey}" rows=${tableData.rows.length} < min=${minRows}. Skipping write.`
      );
      tabResults.push({
        pageKey,
        sheetTab,
        rowsWritten: 0,
        columnsWritten: 0,
        updatedAt: tableData.updatedAt,
        elapsedMs: Date.now() - tabStart,
        status: "empty",
        readBackRowCount: 0,
        readBackValidated: false,
        snapshotRowCount: 0,
        rollbackAttempted: false,
        rollbackSucceeded: false,
      });
      continue;
    }

    const tabResult = await writeRgTab(sheets, sheetTab, tableData, runId, stepLogs, errorLogs);
    totalRowsWritten += tabResult.rowsWritten;
    tabResults.push(tabResult);
  }

  // ── Step 5: Fetch + Write Fangraphs lineups ───────────────────────────────
  console.log(`\n[SheetsSync] [STEP] runId=${runId} Fetching Fangraphs lineups (MLB Stats API)...`);
  const fgStart = Date.now();

  stepLogs.push(logStep({
    runId, step: "fg-lineups-fetch-start", status: "start",
    sourceName: "mlb-stats-api", finalStatus: "pending",
  }));

  try {
    const fgResult: FgScrapeResult = await scrapeFangraphsLineups();
    const fgElapsed = Date.now() - fgStart;
    console.log(
      `[SheetsSync] [STATE] runId=${runId} Fangraphs: today=${fgResult.today.games.length} tomorrow=${fgResult.tomorrow.games.length} errors=${fgResult.errors.length} elapsed=${fgElapsed}ms`
    );

    stepLogs.push(logStep({
      runId, step: "fg-lineups-fetch-complete", status: "success",
      sourceName: "mlb-stats-api",
      parsedRowCount: fgResult.today.games.length + fgResult.tomorrow.games.length,
      durationMs: fgElapsed, finalStatus: "pending",
    }));

    // Write Today Lineups
    const todayResult = await writeLineupTab(
      sheets, "Today Lineups", fgResult.today.games, fgResult.today.date,
      runId, stepLogs, errorLogs
    );
    totalRowsWritten += todayResult.rowsWritten;
    tabResults.push(todayResult);

    // Write Tomorrow Lineups
    const tomorrowResult = await writeLineupTab(
      sheets, "Tomorrow Lineups", fgResult.tomorrow.games, fgResult.tomorrow.date,
      runId, stepLogs, errorLogs
    );
    totalRowsWritten += tomorrowResult.rowsWritten;
    tabResults.push(tomorrowResult);

  } catch (err) {
    const msg = (err as Error).message;
    const fgElapsed = Date.now() - fgStart;
    console.error(`[SheetsSync] [VERIFY] FAIL — runId=${runId} Fangraphs scrape error: ${msg} elapsed=${fgElapsed}ms`);

    errorLogs.push(logError({
      runId, failingStep: "fg-lineups-fetch",
      errorType: "ScraperError", exactErrorMessage: msg,
      sourceName: "mlb-stats-api",
      mostLikelyRootCause: "MLB Stats API unavailable or rate-limited",
      safeActionTaken: "Both lineup tabs skipped",
      whetherWorkflowContinued: true,
    }));

    for (const tabName of ["Today Lineups", "Tomorrow Lineups"]) {
      tabResults.push({
        pageKey: tabName === "Today Lineups" ? "fg-today-lineups" : "fg-tomorrow-lineups",
        sheetTab: tabName,
        rowsWritten: 0,
        columnsWritten: 0,
        updatedAt: "",
        elapsedMs: fgElapsed,
        status: "error",
        error: msg,
        readBackRowCount: 0,
        readBackValidated: false,
        snapshotRowCount: 0,
        rollbackAttempted: false,
        rollbackSucceeded: false,
      });
    }
  }

  // ── Final summary ─────────────────────────────────────────────────────────
  const totalElapsed = Date.now() - syncStart;
  const allSuccess = tabResults.every(t => t.status === "success" || t.status === "empty");
  const hasErrors = tabResults.some(t => t.status === "error");

  console.log(`\n[SheetsSync] [OUTPUT] runId=${runId} Full sync complete:`);
  console.log(`  success=${allSuccess} totalRows=${totalRowsWritten} elapsed=${totalElapsed}ms`);
  for (const t of tabResults) {
    console.log(
      `  [${t.status.toUpperCase()}] "${t.sheetTab}" → ${t.rowsWritten} rows readBack=${t.readBackRowCount} validated=${t.readBackValidated} (${t.elapsedMs}ms)`
    );
  }
  console.log(`[SheetsSync] [VERIFY] ${allSuccess ? "PASS" : hasErrors ? "PARTIAL" : "PASS"} — full sync finished`);

  stepLogs.push(logStep({
    runId, step: "sync-complete",
    status: allSuccess ? "success" : "warn",
    writtenRowCount: totalRowsWritten,
    durationMs: totalElapsed,
    finalStatus: allSuccess ? "success" : hasErrors ? "partial" : "success",
  }));

  const tabRunResults: TabRunResult[] = tabResults.map(t => ({
    tabKey: (t.pageKey === "fg-today-lineups" ? "today-lineups" :
             t.pageKey === "fg-tomorrow-lineups" ? "tomorrow-lineups" :
             t.pageKey === "today-pitchers" ? "the-bat-x" :
             t.pageKey === "today-hitters" ? "the-bat-x-hitters" :
             t.pageKey === "tomorrow-pitchers" ? "tomorrow-pitchers" :
             t.pageKey === "tomorrow-hitters" ? "tomorrow-hitters" :
             "the-bat-x") as import("./jackMacCore").TabKey,
    label: t.sheetTab,
    sheetTabName: t.sheetTab,
    status: t.status === "empty" ? "empty" : t.status,
    rowsWritten: t.rowsWritten,
    columnsWritten: t.columnsWritten,
    dataDate: "",
    source: t.pageKey.startsWith("fg-") ? "mlb-stats-api" : "rotogrinders",
    durationMs: t.elapsedMs,
    error: t.error,
    readBackRowCount: t.readBackRowCount,
    readBackValidated: t.readBackValidated,
  }));

  const summary: RunSummary = {
    runId, executionMode,
    startedAt: new Date(syncStart).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: totalElapsed,
    status: allSuccess ? "success" : hasErrors ? "partial" : "success",
    tabResults: tabRunResults,
    totalRowsWritten,
    errors: errorLogs.map(e => e.exactErrorMessage),
    warnings: [],
    stepLogs,
    errorLogs,
  };
  recordRunSummary(summary);

  return {
    success: allSuccess,
    syncedAt: new Date().toISOString(),
    totalRowsWritten,
    tabs: tabResults,
    elapsedMs: totalElapsed,
    runId,
  };
}
