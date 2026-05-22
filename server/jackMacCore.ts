/**
 * jackMacCore.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Core infrastructure for the JACK MAC pipeline:
 *
 *   1. Run Lock     — ensures only one sync runs at a time (manual or scheduled)
 *   2. Cache Layer  — per-tab freshness tracking (stale after 20 min)
 *   3. Run History  — last 20 run summaries with per-step structured logs
 *   4. Tab Contracts — canonical tab keys, labels, sources, and sheet names
 *   5. Logging helpers — logStep / logError with 30 structured fields
 *
 * Hard rules:
 *   - Run lock is always released in a finally block (never leaked)
 *   - Cache is never read from after a run lock is acquired (always fresh)
 *   - Tab contracts are the single source of truth for tab metadata
 *   - Logs never contain secrets, tokens, or OAuth payloads
 *   - All timestamps are UTC ISO-8601
 */

// ─── Tab Contracts ────────────────────────────────────────────────────────────

export type TabKey =
  | "the-bat-x"
  | "the-bat-x-hitters"
  | "tomorrow-pitchers"
  | "tomorrow-hitters"
  | "today-lineups"
  | "tomorrow-lineups";

export interface TabContract {
  tabKey: TabKey;
  label: string;
  sheetTabName: string;
  source: "rotogrinders" | "mlb-stats-api";
  pageKey?: string; // RG page key (for rotogrinderProxy)
  staleAfterMs: number; // cache TTL in ms
}

export const TAB_CONTRACTS: Record<TabKey, TabContract> = {
  "the-bat-x": {
    tabKey: "the-bat-x",
    label: "The BAT X (Today Pitchers)",
    sheetTabName: "The Bat X",
    source: "rotogrinders",
    pageKey: "today-pitchers",
    staleAfterMs: 20 * 60 * 1000, // 20 min
  },
  "the-bat-x-hitters": {
    tabKey: "the-bat-x-hitters",
    label: "The BAT X Hitters (Today)",
    sheetTabName: "The Bat X Hitters",
    source: "rotogrinders",
    pageKey: "today-hitters",
    staleAfterMs: 20 * 60 * 1000,
  },
  "tomorrow-pitchers": {
    tabKey: "tomorrow-pitchers",
    label: "Tomorrow's Projections (Pitchers)",
    sheetTabName: "Tomorrow's Projections (The Bat X)",
    source: "rotogrinders",
    pageKey: "tomorrow-pitchers",
    staleAfterMs: 20 * 60 * 1000,
  },
  "tomorrow-hitters": {
    tabKey: "tomorrow-hitters",
    label: "Tomorrow's Projections (Hitters)",
    sheetTabName: "Tomorrow's Projections (The Bat X Hitters)",
    source: "rotogrinders",
    pageKey: "tomorrow-hitters",
    staleAfterMs: 20 * 60 * 1000,
  },
  "today-lineups": {
    tabKey: "today-lineups",
    label: "Today Lineups",
    sheetTabName: "Today Lineups",
    source: "mlb-stats-api",
    staleAfterMs: 20 * 60 * 1000,
  },
  "tomorrow-lineups": {
    tabKey: "tomorrow-lineups",
    label: "Tomorrow Lineups",
    sheetTabName: "Tomorrow Lineups",
    source: "mlb-stats-api",
    staleAfterMs: 20 * 60 * 1000,
  },
};

export const ALL_TAB_KEYS = Object.keys(TAB_CONTRACTS) as TabKey[];

// ─── Run Lock ─────────────────────────────────────────────────────────────────

export interface RunLockState {
  isLocked: boolean;
  runId: string | null;
  executionMode: "manual" | "scheduled" | null;
  lockedBy: string | null;
  lockedAt: string | null;
}

let _runLock: RunLockState = {
  isLocked: false,
  runId: null,
  executionMode: null,
  lockedBy: null,
  lockedAt: null,
};

// Maximum time a run lock can be held before it is force-released
// (prevents deadlocks from crashed runs)
const RUN_LOCK_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

export interface AcquireLockResult {
  acquired: boolean;
  existingRunId: string | null;
  existingMode: "manual" | "scheduled" | null;
}

/**
 * Attempt to acquire the run lock.
 * Returns { acquired: true } if successful.
 * Returns { acquired: false, existingRunId, existingMode } if already locked.
 * Auto-releases stale locks older than RUN_LOCK_MAX_AGE_MS.
 */
export function acquireRunLock(
  runId: string,
  executionMode: "manual" | "scheduled",
  lockedBy: string
): AcquireLockResult {
  // Auto-release stale locks
  if (_runLock.isLocked && _runLock.lockedAt) {
    const age = Date.now() - new Date(_runLock.lockedAt).getTime();
    if (age > RUN_LOCK_MAX_AGE_MS) {
      console.warn(
        `[JackMacCore] [STATE] Run lock auto-released (stale): runId=${_runLock.runId} age=${age}ms`
      );
      _runLock = { isLocked: false, runId: null, executionMode: null, lockedBy: null, lockedAt: null };
    }
  }

  if (_runLock.isLocked) {
    return {
      acquired: false,
      existingRunId: _runLock.runId,
      existingMode: _runLock.executionMode,
    };
  }

  _runLock = {
    isLocked: true,
    runId,
    executionMode,
    lockedBy,
    lockedAt: new Date().toISOString(),
  };

  console.log(
    `[JackMacCore] [STATE] Run lock ACQUIRED: runId=${runId} mode=${executionMode} by=${lockedBy}`
  );

  return { acquired: true, existingRunId: null, existingMode: null };
}

/**
 * Release the run lock. Must be called in a finally block.
 * Only releases if the runId matches (prevents accidental release by a different run).
 */
export function releaseRunLock(runId: string): void {
  if (!_runLock.isLocked) {
    console.warn(`[JackMacCore] [STATE] releaseRunLock called but lock is not held (runId=${runId})`);
    return;
  }
  if (_runLock.runId !== runId) {
    console.warn(
      `[JackMacCore] [STATE] releaseRunLock runId mismatch: held=${_runLock.runId} caller=${runId}`
    );
    return;
  }
  _runLock = { isLocked: false, runId: null, executionMode: null, lockedBy: null, lockedAt: null };
  console.log(`[JackMacCore] [STATE] Run lock RELEASED: runId=${runId}`);
}

/**
 * Get the current run lock state (read-only snapshot).
 */
export function getRunLockState(): RunLockState {
  return { ..._runLock };
}

// ─── Run ID Generator ─────────────────────────────────────────────────────────

/**
 * Generates a unique run ID for a sync run.
 * Format: run-<timestamp>-<random6>
 */
export function generateRunId(): string {
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Cache Layer ──────────────────────────────────────────────────────────────

export type CacheFreshness = "fresh" | "stale" | "missing";

export interface CachedTabState {
  tabKey: TabKey;
  rowCount: number;
  columnCount: number;
  dataDate: string; // YYYY-MM-DD or empty
  source: string;
  cacheTimestamp: string; // ISO-8601 UTC
  runId: string;
  freshness: CacheFreshness;
  isStale: boolean;
  errors: string[];
  warnings: string[];
}

const _tabCache = new Map<TabKey, CachedTabState>();

/**
 * Update the cache for a specific tab after a successful write.
 */
export function updateTabCache(
  tabKey: TabKey,
  state: Omit<CachedTabState, "freshness" | "isStale">
): void {
  const contract = TAB_CONTRACTS[tabKey];
  const now = Date.now();
  const cacheAge = now - new Date(state.cacheTimestamp).getTime();
  const isStale = cacheAge > contract.staleAfterMs;

  _tabCache.set(tabKey, {
    ...state,
    freshness: isStale ? "stale" : "fresh",
    isStale,
  });

  console.log(
    `[JackMacCore] [STATE] Cache updated: tabKey=${tabKey} rows=${state.rowCount} runId=${state.runId} fresh=true`
  );
}

/**
 * Get the cached state for a specific tab.
 * Returns null if the tab has never been cached.
 */
export function getCachedTab(tabKey: TabKey): CachedTabState | null {
  const cached = _tabCache.get(tabKey);
  if (!cached) return null;

  // Refresh freshness based on current time
  const contract = TAB_CONTRACTS[tabKey];
  const cacheAge = Date.now() - new Date(cached.cacheTimestamp).getTime();
  const isStale = cacheAge > contract.staleAfterMs;

  return {
    ...cached,
    freshness: isStale ? "stale" : "fresh",
    isStale,
  };
}

/**
 * Get the cached state for all tabs.
 * Returns a record of tabKey → CachedTabState | null.
 */
export function getAllCachedTabs(): Record<TabKey, CachedTabState | null> {
  const result = {} as Record<TabKey, CachedTabState | null>;
  for (const key of ALL_TAB_KEYS) {
    result[key] = getCachedTab(key);
  }
  return result;
}

/**
 * Invalidate the cache for a specific tab (mark as stale).
 */
export function invalidateTabCache(tabKey: TabKey): void {
  const cached = _tabCache.get(tabKey);
  if (cached) {
    _tabCache.set(tabKey, {
      ...cached,
      freshness: "stale",
      isStale: true,
      // Set timestamp to epoch to force stale
      cacheTimestamp: new Date(0).toISOString(),
    });
    console.log(`[JackMacCore] [STATE] Cache invalidated: tabKey=${tabKey}`);
  }
}

/**
 * Invalidate all tab caches.
 */
export function invalidateAllTabCaches(): void {
  for (const key of ALL_TAB_KEYS) {
    invalidateTabCache(key);
  }
  console.log(`[JackMacCore] [STATE] All tab caches invalidated`);
}

// ─── Structured Logging Types ─────────────────────────────────────────────────

export interface RunStepLog {
  runId: string;
  step: string;
  status: "start" | "success" | "warn" | "error" | "skip" | "pending";
  timestampUtc: string;
  // Optional context fields
  executionMode?: string;
  spreadsheetId?: string;
  sourceName?: string;
  worksheetName?: string;
  sourceRowCount?: number;
  parsedRowCount?: number;
  writtenRowCount?: number;
  readBackRowCount?: number;
  durationMs?: number;
  finalStatus?: string;
  [key: string]: unknown;
}

export interface RunErrorLog {
  runId: string;
  timestampUtc: string;
  failingStep: string;
  errorType: string;
  exactErrorMessage: string;
  // Optional context fields
  sourceName?: string;
  worksheetName?: string;
  spreadsheetId?: string;
  mostLikelyRootCause?: string;
  safeActionTaken?: string;
  whetherWorkflowContinued?: boolean;
  whetherWorkflowAborted?: boolean;
  whetherRollbackAttempted?: boolean;
  whetherRollbackSucceeded?: boolean;
  [key: string]: unknown;
}

/**
 * Create a structured step log entry.
 */
export function logStep(fields: Omit<RunStepLog, "timestampUtc">): RunStepLog {
  return {
    ...fields,
    timestampUtc: new Date().toISOString(),
  } as RunStepLog;
}

/**
 * Create a structured error log entry.
 */
export function logError(fields: Omit<RunErrorLog, "timestampUtc">): RunErrorLog {
  return {
    ...fields,
    timestampUtc: new Date().toISOString(),
  } as RunErrorLog;
}

// ─── Tab Run Result ───────────────────────────────────────────────────────────

export interface TabRunResult {
  tabKey: TabKey;
  label: string;
  sheetTabName: string;
  status: "success" | "error" | "skip" | "empty" | "partial";
  rowsWritten: number;
  columnsWritten: number;
  dataDate: string;
  source: string;
  durationMs: number;
  error?: string;
  readBackRowCount: number;
  readBackValidated: boolean;
}

// ─── Run Summary ──────────────────────────────────────────────────────────────

export interface RunSummary {
  runId: string;
  executionMode: "manual" | "scheduled";
  startedAt: string; // ISO-8601 UTC
  completedAt: string; // ISO-8601 UTC
  durationMs: number;
  status: "success" | "error" | "partial";
  tabResults: TabRunResult[];
  totalRowsWritten: number;
  errors: string[];
  warnings: string[];
  stepLogs: RunStepLog[];
  errorLogs: RunErrorLog[];
}

const _runHistory: RunSummary[] = [];
const MAX_RUN_HISTORY = 20;

/**
 * Record a run summary into the run history.
 * Evicts oldest entries when history exceeds MAX_RUN_HISTORY.
 */
export function recordRunSummary(summary: RunSummary): void {
  _runHistory.unshift(summary); // newest first
  if (_runHistory.length > MAX_RUN_HISTORY) {
    _runHistory.splice(MAX_RUN_HISTORY);
  }

  // Update tab cache for all successful tabs
  for (const tabResult of summary.tabResults) {
    if (tabResult.status === "success") {
      updateTabCache(tabResult.tabKey, {
        tabKey: tabResult.tabKey,
        rowCount: tabResult.rowsWritten,
        columnCount: tabResult.columnsWritten,
        dataDate: tabResult.dataDate,
        source: tabResult.source,
        cacheTimestamp: summary.completedAt,
        runId: summary.runId,
        errors: [],
        warnings: [],
      });
    }
  }

  console.log(
    `[JackMacCore] [STATE] Run summary recorded: runId=${summary.runId} status=${summary.status} rows=${summary.totalRowsWritten} duration=${summary.durationMs}ms`
  );
}

/**
 * Get the last N run summaries (newest first).
 */
export function getRunHistory(limit = MAX_RUN_HISTORY): RunSummary[] {
  return _runHistory.slice(0, limit);
}

/**
 * Get the most recent run summary, or null if no runs have been recorded.
 */
export function getLatestRunSummary(): RunSummary | null {
  return _runHistory[0] ?? null;
}
