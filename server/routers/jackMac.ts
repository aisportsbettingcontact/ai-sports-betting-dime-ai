/**
 * jackMac.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * tRPC router for JACK MAC features.
 * Access is restricted to the JACK_MAC_WHITELIST: @prez, @sippi, @lucianobets.
 *
 * Procedures:
 *   jackMac.syncToSheets    — fires a background sync job, returns { jobId } immediately
 *                             Returns { locked: true } if a run is already in progress
 *   jackMac.getSyncStatus   — polls the status of a background sync job by jobId
 *   jackMac.getLineups      — fetches MLB lineups for today + tomorrow (MLB Stats API)
 *   jackMac.getCacheStatus  — returns freshness status of all 6 cached tabs
 *   jackMac.getRunHistory   — returns the last 20 run summaries with per-step logs
 *   jackMac.getRunLockState — returns the current run lock state
 *
 * BACKGROUND JOB PATTERN (critical for platform proxy timeout avoidance):
 *   The full sync (4 CSV fetches + MLB ID resolution + 6 Sheets writes) can take
 *   60-120s. The platform proxy kills requests at ~120s with "Service Unavailable".
 *   Background job pattern: HTTP request completes in < 50ms, sync runs async.
 *   Frontend polls getSyncStatus every 2s until job reaches "success" or "error".
 *
 * RUN LOCK:
 *   Only one sync can run at a time (manual or scheduled).
 *   syncToSheets returns { locked: true, existingRunId } if a run is in progress.
 *   The scheduler also respects the run lock and skips if locked.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router } from "../_core/trpc";
import { appUserProcedure } from "./appUsers";
import {
  startSyncJob,
  getSyncJob,
  syncJackMacToSheets,
  type SyncJob,
} from "../jackMacSheetsSync";
import { scrapeFangraphsLineups, type FgScrapeResult } from "../fangraphsScraper";
import { invalidateFgCache } from "../fangraphsScraper";
import {
  generateRunId,
  acquireRunLock,
  releaseRunLock,
  getRunLockState,
  getAllCachedTabs,
  getRunHistory,
  getLatestRunSummary,
} from "../jackMacCore";

// ─── Server-side 15-min auto-sync scheduler ───────────────────────────────────
// Runs every 15 minutes on the server to keep Google Sheets and the RG cache
// fresh without requiring any user interaction.
// Starts 2 minutes after server boot to avoid hammering on cold start.
// Respects the run lock — skips if a manual sync is in progress.

const JACKMAC_SYNC_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const JACKMAC_SYNC_BOOT_DELAY_MS = 2 * 60 * 1000; // 2 min boot delay

let jackMacSyncIntervalId: ReturnType<typeof setInterval> | null = null;

async function runScheduledJackMacSync(): Promise<void> {
  const now = new Date().toISOString();
  console.log(`[JackMac][SCHEDULER] [INPUT] 15-min scheduled sync starting at ${now}`);
  const t0 = Date.now();

  // Invalidate Fangraphs cache so fresh lineup data is fetched
  invalidateFgCache();
  console.log(`[JackMac][SCHEDULER] [STEP] Fangraphs cache invalidated`);

  // Start background sync job (respects run lock)
  const jobResult = startSyncJob("scheduler", "scheduled");

  if ("locked" in jobResult) {
    console.warn(
      `[JackMac][SCHEDULER] [STATE] Scheduled sync SKIPPED — run lock held by runId=${jobResult.existingRunId}`
    );
    return;
  }

  const { jobId, runId } = jobResult;
  console.log(`[JackMac][SCHEDULER] [STEP] Background sync job started: jobId=${jobId} runId=${runId}`);

  // Poll for completion (max 8 minutes)
  const maxWaitMs = 8 * 60 * 1000;
  const pollIntervalMs = 5000;
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    const job = getSyncJob(jobId);
    if (!job) break;

    if (job.status === "success" || job.status === "error") {
      const elapsed = Date.now() - t0;
      if (job.status === "success" && job.result) {
        console.log(
          `[JackMac][SCHEDULER] [OUTPUT] Scheduled sync COMPLETE: runId=${runId} totalRows=${job.result.totalRowsWritten} elapsed=${elapsed}ms`
        );
        console.log(`[JackMac][SCHEDULER] [VERIFY] PASS — all ${job.result.tabs.length} tabs synced`);
        for (const tab of job.result.tabs) {
          console.log(
            `[JackMac][SCHEDULER] [STATE]   [${tab.status.toUpperCase()}] "${tab.sheetTab}" → ${tab.rowsWritten} rows readBack=${tab.readBackRowCount} (${tab.elapsedMs}ms)`
          );
        }
      } else {
        console.warn(
          `[JackMac][SCHEDULER] [VERIFY] ${job.status === "error" ? "FAIL" : "PARTIAL"} — runId=${runId} error="${job.error ?? "unknown"}" elapsed=${elapsed}ms`
        );
      }
      return;
    }
  }

  console.warn(`[JackMac][SCHEDULER] [VERIFY] WARN — runId=${runId} timed out after ${maxWaitMs / 1000}s`);
}

export function startJackMacScheduler(): void {
  if (jackMacSyncIntervalId !== null) {
    console.log(`[JackMac][SCHEDULER] Already running — skipping duplicate start`);
    return;
  }

  console.log(
    `[JackMac][SCHEDULER] Starting 15-min auto-sync scheduler (boot delay=${JACKMAC_SYNC_BOOT_DELAY_MS / 1000}s)`
  );

  setTimeout(() => {
    console.log(`[JackMac][SCHEDULER] Boot delay elapsed — running first scheduled sync now`);
    void runScheduledJackMacSync();

    jackMacSyncIntervalId = setInterval(() => {
      void runScheduledJackMacSync();
    }, JACKMAC_SYNC_INTERVAL_MS);

    console.log(`[JackMac][SCHEDULER] 15-min interval registered (id=${jackMacSyncIntervalId})`);
  }, JACKMAC_SYNC_BOOT_DELAY_MS);
}

// ─── Whitelist ────────────────────────────────────────────────────────────────

const JACK_MAC_WHITELIST = new Set(["prez", "sippi", "lucianobets"]);

// ─── jackMacProcedure — extends appUserProcedure with whitelist check ─────────

const jackMacProcedure = appUserProcedure.use(async ({ ctx, next }) => {
  const username = ctx.appUser?.username ?? "";
  if (!JACK_MAC_WHITELIST.has(username)) {
    console.warn(
      `[JackMac] [VERIFY] FAIL — @${username} is not in JACK_MAC_WHITELIST. Returning FORBIDDEN.`
    );
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Access denied: JACK MAC is restricted to authorized users only.",
    });
  }
  console.log(`[JackMac] [VERIFY] PASS — @${username} authorized for JACK MAC`);
  return next({ ctx });
});

// ─── Router ───────────────────────────────────────────────────────────────────

export const jackMacRouter = router({
  /**
   * syncToSheets
   * Fires a background sync job and returns { jobId, runId } IMMEDIATELY (< 50ms).
   * Returns { locked: true, existingRunId } if a run is already in progress.
   * The actual sync runs asynchronously. Use getSyncStatus to poll for completion.
   *
   * Restricted to: @prez, @sippi, @lucianobets
   */
  syncToSheets: jackMacProcedure.mutation(async ({ ctx }) => {
    const username = ctx.appUser?.username ?? "unknown";
    console.log(`[JackMac] [INPUT] syncToSheets triggered by @${username}`);

    const jobResult = startSyncJob(username, "manual");

    if ("locked" in jobResult) {
      console.warn(
        `[JackMac] [STATE] syncToSheets LOCKED — run already in progress: runId=${jobResult.existingRunId}`
      );
      return {
        locked: true as const,
        existingRunId: jobResult.existingRunId,
        jobId: null,
        runId: null,
      };
    }

    const { jobId, runId } = jobResult;
    console.log(
      `[JackMac] [OUTPUT] syncToSheets: background job started jobId=${jobId} runId=${runId} by @${username}`
    );
    console.log(`[JackMac] [VERIFY] PASS — sync job enqueued, returning jobId to client immediately`);

    return { locked: false as const, jobId, runId, existingRunId: null };
  }),

  /**
   * getSyncStatus
   * Polls the status of a background sync job by jobId.
   * Returns the full SyncJob object including result when complete.
   *
   * Frontend should poll every 2s until status is "success" or "error".
   *
   * Restricted to: @prez, @sippi, @lucianobets
   */
  getSyncStatus: jackMacProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ ctx, input }) => {
      const username = ctx.appUser?.username ?? "unknown";
      const job = getSyncJob(input.jobId);

      if (!job) {
        console.warn(
          `[JackMac] [VERIFY] WARN — getSyncStatus: jobId="${input.jobId}" not found for @${username} — returning not_found status (server may have restarted)`
        );
        // Return a sentinel instead of throwing — the client must handle this gracefully.
        // Throwing NOT_FOUND causes the tRPC query to enter error state, which the
        // polling useEffect does not watch, leaving the button stuck forever.
        return {
          jobId: input.jobId,
          runId: null,
          status: "not_found" as const,
          startedAt: new Date().toISOString(),
          executionMode: "manual" as const,
          triggeredBy: "unknown",
          error: `Job not found — the server may have restarted. jobId=${input.jobId}`,
        } as unknown as SyncJob;
      }

      console.log(
        `[JackMac] [STATE] getSyncStatus: jobId=${input.jobId} runId=${job.runId} status=${job.status} elapsed=${job.elapsedMs ?? "pending"}ms for @${username}`
      );

      return job as SyncJob;
    }),

  /**
   * getLineups
   * Fetches MLB lineups for today + tomorrow (PST dates) via the MLB Stats API.
   * Returns structured FgScrapeResult with game-level lineup and pitcher data.
   *
   * Restricted to: @prez, @sippi, @lucianobets
   */
  getLineups: jackMacProcedure
    .input(z.object({ forceRefresh: z.boolean().default(false) }))
    .query(async ({ ctx, input }) => {
      const username = ctx.appUser?.username ?? "unknown";
      console.log(
        `[JackMac] [INPUT] getLineups requested by @${username} forceRefresh=${input.forceRefresh}`
      );

      const t0 = Date.now();
      let result: FgScrapeResult;
      try {
        result = await scrapeFangraphsLineups(input.forceRefresh);
      } catch (err) {
        const msg = (err as Error).message;
        console.error(`[JackMac] [VERIFY] FAIL — getLineups error: ${msg}`);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to fetch lineups: ${msg}`,
        });
      }

      const elapsed = Date.now() - t0;
      console.log(
        `[JackMac] [OUTPUT] getLineups: today=${result.today.games.length} tomorrow=${result.tomorrow.games.length} elapsed=${elapsed}ms`
      );
      console.log(
        `[JackMac] [VERIFY] ${result.errors.length === 0 ? "PASS" : "PARTIAL"} — getLineups for @${username}`
      );

      return result;
    }),

  /**
   * getCacheStatus
   * Returns the freshness status of all 6 cached JACK MAC tabs.
   * Used by the frontend to show stale/fresh indicators and decide whether
   * to trigger a background refresh.
   *
   * Restricted to: @prez, @sippi, @lucianobets
   */
  getCacheStatus: jackMacProcedure.query(async ({ ctx }) => {
    const username = ctx.appUser?.username ?? "unknown";
    console.log(`[JackMac] [INPUT] getCacheStatus requested by @${username}`);

    const allCached = getAllCachedTabs();
    const runLock = getRunLockState();
    const latestRun = getLatestRunSummary();

    const tabs = Object.entries(allCached).map(([key, cached]) => ({
      tabKey: key,
      label: cached?.tabKey ?? key,
      rowCount: cached?.rowCount ?? 0,
      freshness: cached?.freshness ?? "missing",
      isStale: cached?.isStale ?? true,
      cacheTimestamp: cached?.cacheTimestamp ?? null,
      dataDate: cached?.dataDate ?? "",
      source: cached?.source ?? "",
      runId: cached?.runId ?? null,
      errors: cached?.errors ?? [],
      warnings: cached?.warnings ?? [],
    }));

    return {
      tabs,
      runLock: {
        isLocked: runLock.isLocked,
        runId: runLock.runId,
        executionMode: runLock.executionMode,
        lockedBy: runLock.lockedBy,
        lockedAt: runLock.lockedAt,
      },
      latestRunId: latestRun?.runId ?? null,
      latestRunStatus: latestRun?.status ?? null,
      latestRunCompletedAt: latestRun?.completedAt ?? null,
      latestRunTotalRowsWritten: latestRun?.totalRowsWritten ?? 0,
    };
  }),

  /**
   * getRunHistory
   * Returns the last 20 run summaries with per-step logs.
   * Used for diagnostics and audit trail.
   *
   * Restricted to: @prez, @sippi, @lucianobets
   */
  getRunHistory: jackMacProcedure.query(async ({ ctx }) => {
    const username = ctx.appUser?.username ?? "unknown";
    console.log(`[JackMac] [INPUT] getRunHistory requested by @${username}`);
    return getRunHistory();
  }),

  /**
   * getRunLockState
   * Returns the current run lock state.
   * Used by the frontend to show locked/refreshing states.
   *
   * Restricted to: @prez, @sippi, @lucianobets
   */
  getRunLockState: jackMacProcedure.query(async ({ ctx }) => {
    const username = ctx.appUser?.username ?? "unknown";
    const state = getRunLockState();
    console.log(
      `[JackMac] [STATE] getRunLockState: isLocked=${state.isLocked} runId=${state.runId} by=${state.lockedBy} for @${username}`
    );
    return state;
  }),
});
