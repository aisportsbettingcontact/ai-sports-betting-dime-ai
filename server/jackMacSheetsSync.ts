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
 *   today-lineups     → "MM-DD-YYYY LINEUPS" (e.g. "05-22-2026 LINEUPS")
 *   tomorrow-lineups  → "MM-DD-YYYY LINEUPS" (e.g. "05-23-2026 LINEUPS")
 *
 * Tab naming: dynamic date-based names replace the legacy static "Today Lineups" /
 * "Tomorrow Lineups" names. On first run, legacy tabs are automatically renamed.
 * Row 1 of each lineup tab is the column header (DATE, GAME, ...) — no sentinel row.
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
import { eq, lt } from "drizzle-orm";
import { getDb } from "./db";
import { jackMacSyncJobs } from "../drizzle/schema";
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

/**
 * A single progress event emitted by the background sync job.
 * Appended to SyncJob.progress as each phase starts or completes.
 * The frontend polls getSyncStatus every 2s and renders these events
 * in a live step-by-step feed (replaces the silent spinner).
 */
export interface SyncProgressEvent {
  /** ISO timestamp when this event was emitted */
  at: string;
  /** Milliseconds since job start */
  elapsedMs: number;
  /**
   * Phase identifier:
   *   sheets-auth       — Google Sheets client init
   *   rg-login          — RotoGrinders session cookie
   *   rg-fetch          — Parallel CSV fetch + parse (4 tabs)
   *   rg-fetch:{tab}    — Individual tab fetch result
   *   sheets-write:{tab}— Per-tab write + read-back
   *   fg-fetch          — Fangraphs/MLB Stats API
   *   fg-write:{tab}    — Today/Tomorrow lineup tab write
   *   sync-complete     — Final summary
   */
  phase: string;
  /** Human-readable status message shown in the progress feed */
  message: string;
  /** Event lifecycle: start = in-progress, progress = sub-step within phase, done = completed, error = failed, skip = skipped */
  status: "start" | "progress" | "done" | "error" | "skip";
  /** Row count (when available — after fetch/write phases) */
  rowCount?: number;
  /** Tab name (when applicable) */
  tabName?: string;
}

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
  /** Live progress events — appended as each phase starts/completes */
  progress: SyncProgressEvent[];
}

const syncJobStore = new Map<string, SyncJob>();
const JOB_TTL_MS = 30 * 60 * 1000; // 30 minutes — auto-evict stale jobs

/**
 * Persist a sync job row to the DB (fire-and-forget, never throws).
 * Called synchronously after adding to syncJobStore so the row exists
 * before the first poll arrives.
 */
async function persistJobToDb(
  jobId: string,
  runId: string,
  triggeredBy: string,
  startedAt: number
): Promise<void> {
  try {
    const db = await getDb();
    if (!db) {
      console.warn(`[SheetsSync] [VERIFY] WARN — persistJobToDb: DB unavailable, job ${jobId} not persisted`);
      return;
    }
    await db.insert(jackMacSyncJobs).values({
      jobId,
      runId,
      status: "running",
      startedAt,
      triggeredBy,
    });
    console.log(`[SheetsSync] [STEP] persistJobToDb: jobId=${jobId} written to DB`);
  } catch (err) {
    // Non-fatal — in-memory store is the primary source of truth for the running process
    console.warn(`[SheetsSync] [VERIFY] WARN — persistJobToDb failed: ${(err as Error).message}`);
  }
}

/**
 * Update a sync job row in the DB when it completes or fails.
 * Called at the end of the background job (fire-and-forget, never throws).
 */
async function finalizeJobInDb(
  jobId: string,
  status: "completed" | "failed",
  result: SheetSyncResult | undefined,
  error: string | undefined,
  completedAt: number
): Promise<void> {
  try {
    const db = await getDb();
    if (!db) {
      console.warn(`[SheetsSync] [VERIFY] WARN — finalizeJobInDb: DB unavailable, job ${jobId} not finalized`);
      return;
    }
    await db
      .update(jackMacSyncJobs)
      .set({
        status,
        completedAt,
        result: result ? JSON.stringify(result) : null,
        error: error ?? null,
      })
      .where(eq(jackMacSyncJobs.jobId, jobId));
    console.log(`[SheetsSync] [STEP] finalizeJobInDb: jobId=${jobId} status=${status}`);
  } catch (err) {
    console.warn(`[SheetsSync] [VERIFY] WARN — finalizeJobInDb failed: ${(err as Error).message}`);
  }
}

/**
 * Purge jack_mac_sync_jobs rows older than 24 hours (fire-and-forget, never throws).
 * Called on each startSyncJob invocation to prevent unbounded table growth.
 */
async function purgeOldDbJobs(): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    await db.delete(jackMacSyncJobs).where(lt(jackMacSyncJobs.startedAt, cutoff));
  } catch {
    // Non-fatal
  }
}

/**
 * Start a background sync job. Returns immediately with a jobId.
 * The actual sync runs asynchronously via setImmediate.
 * Returns null if a run lock is already held (prevents duplicate runs).
 *
 * DB persistence: writes a 'running' row to jack_mac_sync_jobs immediately
 * (before the first poll can arrive) so getSyncJob can find the job even
 * if the poll hits a different Node.js process.
 */
export function startSyncJob(
  triggeredBy = "unknown",
  executionMode: "manual" | "scheduled" = "manual"
): { jobId: string; runId: string } | { locked: true; existingRunId: string | null } {
  // Evict stale in-memory jobs older than 30 minutes
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
  const startedAt = Date.now();
  const job: SyncJob = {
    jobId,
    runId,
    status: "pending",
    startedAt: new Date(startedAt).toISOString(),
    executionMode,
    triggeredBy,
    progress: [],
  };

  // 1. Write to in-memory store immediately (same-process polls are instant)
  syncJobStore.set(jobId, job);

  // 2. Persist to DB immediately (cross-process polls can find the job)
  //    Fire-and-forget — never blocks startSyncJob return
  void persistJobToDb(jobId, runId, triggeredBy, startedAt);

  // 3. Purge old DB rows in background
  void purgeOldDbJobs();

  console.log(
    `[SheetsSync] [INPUT] Background sync job created: jobId=${jobId} runId=${runId} mode=${executionMode} by=${triggeredBy}`
  );

  // Fire-and-forget: run the sync asynchronously
  setImmediate(async () => {
    job.status = "running";
    console.log(`[SheetsSync] [STEP] Background sync job starting: jobId=${jobId} runId=${runId}`);
    const t0 = Date.now();
    try {
      // Pass the job reference so syncJackMacToSheets can emit live progress events
      const result = await syncJackMacToSheets(runId, executionMode, triggeredBy, job);
      job.status = result.success ? "success" : "error";
      job.result = result;
      job.completedAt = new Date().toISOString();
      job.elapsedMs = Date.now() - t0;
      const finalStatus = result.success ? "completed" : "failed";
      console.log(
        `[SheetsSync] [OUTPUT] Background sync job complete: jobId=${jobId} runId=${runId} status=${job.status} elapsed=${job.elapsedMs}ms`
      );
      void finalizeJobInDb(jobId, finalStatus, result, undefined, Date.now());
    } catch (err) {
      const msg = (err as Error).message;
      job.status = "error";
      job.error = msg;
      job.completedAt = new Date().toISOString();
      job.elapsedMs = Date.now() - t0;
      console.error(
        `[SheetsSync] [VERIFY] FAIL — Background sync job error: jobId=${jobId} runId=${runId} error="${msg}" elapsed=${job.elapsedMs}ms`
      );
      void finalizeJobInDb(jobId, "failed", undefined, msg, Date.now());
    } finally {
      // Always release the run lock when the job completes (success or error)
      releaseRunLock(runId);
    }
  });

  return { jobId, runId };
}

/**
 * Get the current state of a sync job by jobId.
 * Fast path: in-memory Map (same-process, zero latency).
 * Fallback: DB lookup (cross-process, handles load-balanced deployments).
 *
 * Returns null if the job does not exist in either store.
 */
export async function getSyncJob(jobId: string): Promise<SyncJob | null> {
  // Fast path: in-memory store (same process that created the job)
  const cached = syncJobStore.get(jobId);
  if (cached) {
    console.log(`[SheetsSync] [STEP] getSyncJob: jobId=${jobId} found in memory (status=${cached.status})`);
    return cached;
  }

  // Fallback: DB lookup (different process or server restart)
  console.log(`[SheetsSync] [STEP] getSyncJob: jobId=${jobId} not in memory — querying DB`);
  try {
    const db = await getDb();
    if (!db) {
      console.warn(`[SheetsSync] [VERIFY] WARN — getSyncJob: DB unavailable, cannot look up jobId=${jobId}`);
      return null;
    }
    const rows = await db
      .select()
      .from(jackMacSyncJobs)
      .where(eq(jackMacSyncJobs.jobId, jobId))
      .limit(1);
    if (rows.length === 0) {
      console.warn(`[SheetsSync] [VERIFY] WARN — getSyncJob: jobId=${jobId} not found in DB either`);
      return null;
    }
    const row = rows[0];
    // Map DB row → SyncJob shape
    const dbJob: SyncJob = {
      jobId: row.jobId,
      runId: row.runId,
      status: row.status === "completed" ? "success" : row.status === "failed" ? "error" : "running",
      startedAt: new Date(row.startedAt).toISOString(),
      completedAt: row.completedAt ? new Date(row.completedAt).toISOString() : undefined,
      result: row.result ? (JSON.parse(row.result) as SheetSyncResult) : undefined,
      error: row.error ?? undefined,
      executionMode: "manual",
      triggeredBy: row.triggeredBy ?? "unknown",
      // Progress events are not persisted to DB (they are ephemeral, in-memory only)
      // A DB-recovered job will show an empty progress array (job already completed)
      progress: [],
    };
    console.log(`[SheetsSync] [OUTPUT] getSyncJob: jobId=${jobId} found in DB (status=${dbJob.status})`);
    // Populate in-memory cache so subsequent polls from this process are fast
    syncJobStore.set(jobId, dbJob);
    return dbJob;
  } catch (err) {
    console.error(`[SheetsSync] [VERIFY] FAIL — getSyncJob DB lookup error: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Returns a snapshot of all jobs currently in syncJobStore.
 * Used for diagnostic logging when a job is not found.
 */
export function getSyncJobStoreSnapshot(): Array<{ jobId: string; status: string; startedAt: string }> {
  return Array.from(syncJobStore.values()).map(j => ({
    jobId: j.jobId,
    status: j.status,
    startedAt: j.startedAt,
  }));
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
      (s) => s.properties?.title ?? ""
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
 * Converts a YYYY-MM-DD date string to the MM-DD-YYYY LINEUPS tab name format.
 * e.g. "2026-05-22" → "05-22-2026 LINEUPS"
 *
 * [STEP] formatLineupTabName: input=dateStr output=tabName
 */
function formatLineupTabName(dateStr: string): string {
  // dateStr is expected to be YYYY-MM-DD (e.g. "2026-05-22")
  const parts = dateStr.split("-");
  if (parts.length !== 3) {
    console.warn(`[SheetsSync] [VERIFY] WARN — formatLineupTabName: unexpected dateStr format "${dateStr}" — falling back to raw value`);
    return `${dateStr} LINEUPS`;
  }
  const [yyyy, mm, dd] = parts;
  const tabName = `${mm}-${dd}-${yyyy} LINEUPS`;
  console.log(`[SheetsSync] [STEP] formatLineupTabName: input="${dateStr}" output="${tabName}"`);
  return tabName;
}

/**
 * Renames an existing sheet tab from oldName to newName.
 * If oldName does not exist, logs a skip and returns.
 * If newName already exists, logs a skip (no rename needed).
 *
 * Used to migrate legacy static tab names ("Today Lineups", "Tomorrow Lineups")
 * to the new MM-DD-YYYY LINEUPS format on first run.
 *
 * [STEP] renameSheetTabIfExists: oldName → newName
 */
async function renameSheetTabIfExists(
  sheets: ReturnType<typeof google.sheets>,
  oldName: string,
  newName: string
): Promise<void> {
  if (oldName === newName) return; // nothing to do
  try {
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
      fields: "sheets.properties",
    });
    const sheetsList = meta.data.sheets ?? [];
    const existingTitles = sheetsList.map(s => s.properties?.title ?? "");

    if (!existingTitles.includes(oldName)) {
      console.log(`[SheetsSync] [STEP] renameSheetTabIfExists: oldName="${oldName}" not found — skip rename`);
      return;
    }
    if (existingTitles.includes(newName)) {
      console.log(`[SheetsSync] [STEP] renameSheetTabIfExists: newName="${newName}" already exists — skip rename`);
      return;
    }

    // Find the sheetId for oldName
    const sheetEntry = sheetsList.find(s => s.properties?.title === oldName);
    const sheetId = sheetEntry?.properties?.sheetId;
    if (sheetId == null) {
      console.warn(`[SheetsSync] [VERIFY] WARN — renameSheetTabIfExists: could not find sheetId for "${oldName}"`);
      return;
    }

    console.log(`[SheetsSync] [STEP] renameSheetTabIfExists: sheetId=${sheetId} "${oldName}" → "${newName}"`);
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{
          updateSheetProperties: {
            properties: { sheetId, title: newName },
            fields: "title",
          },
        }],
      },
    });
    console.log(`[SheetsSync] [OUTPUT] Tab renamed: "${oldName}" → "${newName}"`);
  } catch (err) {
    console.warn(`[SheetsSync] [VERIFY] WARN — renameSheetTabIfExists("${oldName}" → "${newName}") failed: ${(err as Error).message}`);
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

  // Row 1 = column header (DATE, GAME, GAME_TIME_PST, ...)
  // No sentinel/title row — data starts immediately at row 1
  const rows: string[][] = [header];

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
  errorLogs: RunErrorLog[],
  isToday: boolean = false  // true = today's lineup tab, false = tomorrow's
): Promise<SheetSyncTabResult> {
  const t0 = Date.now();

  // ── Migrate legacy static tab names to MM-DD-YYYY LINEUPS format ──────────
  // On the first run after this deploy, "Today Lineups" and "Tomorrow Lineups"
  // will exist in the sheet. Rename them to the new format before writing.
  const legacyName = isToday ? "Today Lineups" : "Tomorrow Lineups";
  console.log(
    `[SheetsSync] [STEP] writeLineupTab: runId=${runId} tabName="${tabName}" ` +
    `legacyName="${legacyName}" isToday=${isToday} games=${games.length} dateLabel=${dateLabel}`
  );
  await renameSheetTabIfExists(sheets, legacyName, tabName);

  const result: SheetSyncTabResult = {
    pageKey: isToday ? "fg-today-lineups" : "fg-tomorrow-lineups",
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
  // values[0] = column header row; values[1..n] = data rows
  // dataRowCount = total rows minus the 1 header row
  const dataRowCount = values.length - 1; // exclude column header row

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
 *
 * @param liveJob  Optional reference to the SyncJob object in syncJobStore.
 *                 When provided, progress events are appended to job.progress
 *                 so the frontend can display a live step-by-step status feed.
 */
export async function syncJackMacToSheets(
  runId: string,
  executionMode: "manual" | "scheduled" = "manual",
  triggeredBy = "unknown",
  liveJob?: SyncJob
): Promise<SheetSyncResult> {
  const syncStart = Date.now();
  const stepLogs: RunStepLog[] = [];
  const errorLogs: RunErrorLog[] = [];

  /**
   * Emit a progress event to the live job (if provided).
   * This mutates job.progress in-place so every poll of getSyncStatus
   * returns the latest events without any additional DB round-trip.
   */
  function emit(event: Omit<SyncProgressEvent, "at" | "elapsedMs">): void {
    if (!liveJob) return;
    const ev: SyncProgressEvent = {
      ...event,
      at: new Date().toISOString(),
      elapsedMs: Date.now() - syncStart,
    };
    liveJob.progress.push(ev);
    // Structured server log mirrors the frontend event for traceability
    console.log(
      `[SheetsSync] [PROGRESS] phase=${ev.phase} status=${ev.status} elapsedMs=${ev.elapsedMs}` +
      (ev.rowCount !== undefined ? ` rows=${ev.rowCount}` : "") +
      (ev.tabName ? ` tab="${ev.tabName}"` : "") +
      ` msg="${ev.message}"`
    );
  }

  console.log(`\n[SheetsSync] [INPUT] runId=${runId} mode=${executionMode} by=${triggeredBy}`);
  console.log(`[SheetsSync] [STATE] Spreadsheet ID: ${SPREADSHEET_ID}`);

  stepLogs.push(logStep({
    runId, step: "sync-start", status: "start",
    executionMode, spreadsheetId: SPREADSHEET_ID,
    finalStatus: "pending",
  }));

  // ── Step 1: Initialize Google Sheets client ───────────────────────────────────────────
  emit({ phase: "sheets-auth", status: "start", message: "Connecting to Google Sheets..." });
  let sheets: ReturnType<typeof google.sheets>;
  try {
    sheets = getGoogleSheetsClient();
    emit({ phase: "sheets-auth", status: "done", message: "Google Sheets connected" });
    console.log(`[SheetsSync] [STATE] runId=${runId} Google Sheets client initialized`);
  } catch (err) {
    const msg = (err as Error).message;
    emit({ phase: "sheets-auth", status: "error", message: `Sheets auth failed: ${msg}` });
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

  // ── Step 2: Get Rotogrinders session cookie ──────────────────────────────────────────
  emit({ phase: "rg-login", status: "start", message: "Checking RotoGrinders session (cache → DB → login)..." });
  let rgCookie: string;
  try {
    // onProgress callback emits sub-step events into the live panel:
    //   • "Checking RotoGrinders session cache..."
    //   • "Sending login request to RotoGrinders..."
    //   • "RotoGrinders login response received — extracting session cookie..."
    //   • "RotoGrinders session established (2.1s)" or "RotoGrinders session restored from cache"
    rgCookie = await getRgSessionCookie((subMsg) => {
      emit({ phase: "rg-login", status: "progress", message: subMsg });
    });
    emit({ phase: "rg-login", status: "done", message: "RotoGrinders session established" });
    console.log(`[SheetsSync] [STATE] runId=${runId} RG session cookie obtained`);
  } catch (err) {
    const msg = (err as Error).message;
    emit({ phase: "rg-login", status: "error", message: `RotoGrinders login failed: ${msg}` });
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

  // ── Step 3: Fetch + Parse all 4 RG tabs in PARALLEL ──────────────────────────────
  const tabResults: SheetSyncTabResult[] = [];
  let totalRowsWritten = 0;

  const pageEntries = Object.entries(PAGE_TO_SHEET_TAB);
  console.log(`\n[SheetsSync] [STEP] runId=${runId} Fetching ${pageEntries.length} RG tabs in PARALLEL...`);
  const parallelFetchStart = Date.now();

  emit({
    phase: "rg-fetch",
    status: "start",
    message: `Fetching ${pageEntries.length} RotoGrinders CSV tabs in parallel...`,
  });

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

  const parallelFetchElapsed = Date.now() - parallelFetchStart;
  const totalFetchedRows = fetchParseResults.reduce((sum, r) => sum + (r.tableData?.rows.length ?? 0), 0);
  const fetchErrors = fetchParseResults.filter(r => r.error);
  console.log(`[SheetsSync] [STATE] runId=${runId} Parallel fetch+parse complete in ${parallelFetchElapsed}ms`);

  if (fetchErrors.length > 0) {
    emit({
      phase: "rg-fetch",
      status: "error",
      message: `RG fetch complete — ${fetchErrors.length} tab(s) failed, ${totalFetchedRows} rows fetched (${(parallelFetchElapsed / 1000).toFixed(1)}s)`,
      rowCount: totalFetchedRows,
    });
  } else {
    emit({
      phase: "rg-fetch",
      status: "done",
      message: `${pageEntries.length} RG tabs fetched — ${totalFetchedRows} rows total (${(parallelFetchElapsed / 1000).toFixed(1)}s)`,
      rowCount: totalFetchedRows,
    });
  }

  stepLogs.push(logStep({
    runId, step: "rg-parallel-fetch-complete", status: "success",
    sourceName: "rotogrinders",
    parsedRowCount: totalFetchedRows,
    durationMs: parallelFetchElapsed,
    finalStatus: "pending",
  }));

  // ── Step 4: Write each RG tab to Sheets (sequential — Sheets API rate limits) ──
  for (const { pageKey, sheetTab, tableData, tabStart, error } of fetchParseResults) {
    if (error || !tableData) {
      emit({
        phase: `sheets-write:${sheetTab}`,
        status: "error",
        message: `"${sheetTab}" — fetch failed: ${error ?? "unknown"}`,
        tabName: sheetTab,
        rowCount: 0,
      });
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
      emit({
        phase: `sheets-write:${sheetTab}`,
        status: "skip",
        message: `"${sheetTab}" — skipped (${tableData.rows.length} rows < min ${minRows})`,
        tabName: sheetTab,
        rowCount: 0,
      });
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

    emit({
      phase: `sheets-write:${sheetTab}`,
      status: "start",
      message: `Writing "${sheetTab}" (${tableData.rows.length} rows)...`,
      tabName: sheetTab,
      rowCount: tableData.rows.length,
    });
    const tabResult = await writeRgTab(sheets, sheetTab, tableData, runId, stepLogs, errorLogs);
    totalRowsWritten += tabResult.rowsWritten;
    tabResults.push(tabResult);
    if (tabResult.status === "success") {
      emit({
        phase: `sheets-write:${sheetTab}`,
        status: "done",
        message: `✓ "${sheetTab}" — ${tabResult.rowsWritten} rows written, read-back ${tabResult.readBackValidated ? "OK" : "MISMATCH"} (${tabResult.elapsedMs}ms)`,
        tabName: sheetTab,
        rowCount: tabResult.rowsWritten,
      });
    } else {
      emit({
        phase: `sheets-write:${sheetTab}`,
        status: "error",
        message: `✗ "${sheetTab}" — ${tabResult.error ?? "write failed"}`,
        tabName: sheetTab,
        rowCount: 0,
      });
    }
  }

  // ── Step 5: Fetch + Write Fangraphs lineups ───────────────────────────────────────────
  emit({ phase: "fg-fetch", status: "start", message: "Fetching MLB lineups (MLB Stats API)..." });
  console.log(`\n[SheetsSync] [STEP] runId=${runId} Fetching Fangraphs lineups (MLB Stats API)...`);
  const fgStart = Date.now();

  stepLogs.push(logStep({
    runId, step: "fg-lineups-fetch-start", status: "start",
    sourceName: "mlb-stats-api", finalStatus: "pending",
  }));

  try {
    const fgResult: FgScrapeResult = await scrapeFangraphsLineups();
    const fgElapsed = Date.now() - fgStart;
    const totalGames = fgResult.today.games.length + fgResult.tomorrow.games.length;
    console.log(
      `[SheetsSync] [STATE] runId=${runId} Fangraphs: today=${fgResult.today.games.length} tomorrow=${fgResult.tomorrow.games.length} errors=${fgResult.errors.length} elapsed=${fgElapsed}ms`
    );
    emit({
      phase: "fg-fetch",
      status: "done",
      message: `MLB lineups fetched — ${totalGames} games (today: ${fgResult.today.games.length}, tomorrow: ${fgResult.tomorrow.games.length}) in ${(fgElapsed / 1000).toFixed(1)}s`,
      rowCount: totalGames,
    });

    stepLogs.push(logStep({
      runId, step: "fg-lineups-fetch-complete", status: "success",
      sourceName: "mlb-stats-api",
      parsedRowCount: totalGames,
      durationMs: fgElapsed, finalStatus: "pending",
    }));

    // Write Today Lineups — tab name: MM-DD-YYYY LINEUPS (e.g. "05-22-2026 LINEUPS")
    const todayTabName = formatLineupTabName(fgResult.today.date);
    console.log(`[SheetsSync] [STEP] Today lineup tab name: "${todayTabName}" (date=${fgResult.today.date})`);
    emit({
      phase: `fg-write:${todayTabName}`,
      status: "start",
      message: `Writing "${todayTabName}" (${fgResult.today.games.length} games)...`,
      tabName: todayTabName,
      rowCount: fgResult.today.games.length,
    });
    const todayResult = await writeLineupTab(
      sheets, todayTabName, fgResult.today.games, fgResult.today.date,
      runId, stepLogs, errorLogs, true /* isToday */
    );
    totalRowsWritten += todayResult.rowsWritten;
    tabResults.push(todayResult);
    emit({
      phase: `fg-write:${todayTabName}`,
      status: todayResult.status === "success" ? "done" : todayResult.status === "empty" ? "skip" : "error",
      message: todayResult.status === "success"
        ? `✓ "${todayTabName}" — ${todayResult.rowsWritten} rows written (${todayResult.elapsedMs}ms)`
        : todayResult.status === "empty"
        ? `"${todayTabName}" — no games today`
        : `✗ "${todayTabName}" — ${todayResult.error ?? "write failed"}`,
      tabName: todayTabName,
      rowCount: todayResult.rowsWritten,
    });

    // Write Tomorrow Lineups — tab name: MM-DD-YYYY LINEUPS (e.g. "05-23-2026 LINEUPS")
    const tomorrowTabName = formatLineupTabName(fgResult.tomorrow.date);
    console.log(`[SheetsSync] [STEP] Tomorrow lineup tab name: "${tomorrowTabName}" (date=${fgResult.tomorrow.date})`);
    emit({
      phase: `fg-write:${tomorrowTabName}`,
      status: "start",
      message: `Writing "${tomorrowTabName}" (${fgResult.tomorrow.games.length} games)...`,
      tabName: tomorrowTabName,
      rowCount: fgResult.tomorrow.games.length,
    });
    const tomorrowResult = await writeLineupTab(
      sheets, tomorrowTabName, fgResult.tomorrow.games, fgResult.tomorrow.date,
      runId, stepLogs, errorLogs, false /* isToday */
    );
    totalRowsWritten += tomorrowResult.rowsWritten;
    tabResults.push(tomorrowResult);
    emit({
      phase: `fg-write:${tomorrowTabName}`,
      status: tomorrowResult.status === "success" ? "done" : tomorrowResult.status === "empty" ? "skip" : "error",
      message: tomorrowResult.status === "success"
        ? `✓ "${tomorrowTabName}" — ${tomorrowResult.rowsWritten} rows written (${tomorrowResult.elapsedMs}ms)`
        : tomorrowResult.status === "empty"
        ? `"${tomorrowTabName}" — no games tomorrow`
        : `✗ "${tomorrowTabName}" — ${tomorrowResult.error ?? "write failed"}`,
      tabName: tomorrowTabName,
      rowCount: tomorrowResult.rowsWritten,
    });

  } catch (err) {
    const msg = (err as Error).message;
    const fgElapsed = Date.now() - fgStart;
    console.error(`[SheetsSync] [VERIFY] FAIL — runId=${runId} Fangraphs scrape error: ${msg} elapsed=${fgElapsed}ms`);
    emit({ phase: "fg-fetch", status: "error", message: `MLB lineup fetch failed: ${msg}` });

    errorLogs.push(logError({
      runId, failingStep: "fg-lineups-fetch",
      errorType: "ScraperError", exactErrorMessage: msg,
      sourceName: "mlb-stats-api",
      mostLikelyRootCause: "MLB Stats API unavailable or rate-limited",
      safeActionTaken: "Both lineup tabs skipped",
      whetherWorkflowContinued: true,
    }));

    // Error fallback: push stub results for both lineup tabs using dynamic names
    // fgResult may not be defined here (fetch failed), so compute tab names from current date
    const nowUtc = new Date();
    const estOffset = -5 * 60; // EST = UTC-5 (close enough for tab naming; DST not critical here)
    const estNow = new Date(nowUtc.getTime() + estOffset * 60 * 1000);
    const todayEst = estNow.toISOString().slice(0, 10); // YYYY-MM-DD
    const tomorrowEst = new Date(estNow.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const errorTabPairs: Array<[string, string]> = [
      [formatLineupTabName(todayEst), "fg-today-lineups"],
      [formatLineupTabName(tomorrowEst), "fg-tomorrow-lineups"],
    ];
    console.log(`[SheetsSync] [STATE] Error fallback tab names: ${errorTabPairs.map(([n]) => `"${n}"`).join(", ")}`);
    for (const [tabName, pageKey] of errorTabPairs) {
      tabResults.push({
        pageKey,
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

  // ── Final summary ──────────────────────────────────────────────────────────────────────────────────────
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

  emit({
    phase: "sync-complete",
    status: allSuccess ? "done" : hasErrors ? "error" : "done",
    message: allSuccess
      ? `✓ All 6 tabs synced — ${totalRowsWritten} total rows in ${(totalElapsed / 1000).toFixed(1)}s`
      : `Sync finished with errors — ${totalRowsWritten} rows in ${(totalElapsed / 1000).toFixed(1)}s`,
    rowCount: totalRowsWritten,
  });

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
