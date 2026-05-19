/**
 * jackMac.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * tRPC router for JACK MAC features.
 * Access is restricted to the JACK_MAC_WHITELIST: @prez, @sippi, @lucianobets.
 *
 * Procedures:
 *   jackMac.syncToSheets    — fires a background sync job, returns { jobId } immediately
 *   jackMac.getSyncStatus   — polls the status of a background sync job by jobId
 *   jackMac.getLineups      — fetches MLB lineups for today + tomorrow (MLB Stats API)
 *
 * BACKGROUND JOB PATTERN (critical for platform proxy timeout avoidance):
 *   The full sync (4 CSV fetches + MLB ID resolution + 6 Sheets writes) can take
 *   60-120s. The platform proxy kills requests at ~120s with "Service Unavailable".
 *   Background job pattern: HTTP request completes in < 50ms, sync runs async.
 *   Frontend polls getSyncStatus every 2s until job reaches "success" or "error".
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router } from "../_core/trpc";
import { appUserProcedure } from "./appUsers";
import {
  startSyncJob,
  getSyncJob,
  type SyncJob,
} from "../jackMacSheetsSync";
import { scrapeFangraphsLineups, type FgScrapeResult } from "../fangraphsScraper";

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
   * Fires a background sync job and returns { jobId } IMMEDIATELY (< 50ms).
   * The actual sync runs asynchronously. Use getSyncStatus to poll for completion.
   *
   * WHY BACKGROUND JOB:
   *   The full sync takes 60-120s. The platform proxy kills requests at ~120s
   *   with "Service Unavailable" which the tRPC client cannot JSON.parse.
   *   Background job pattern: HTTP request completes in < 50ms, sync runs async.
   *
   * Restricted to: @prez, @sippi, @lucianobets
   */
  syncToSheets: jackMacProcedure.mutation(async ({ ctx }) => {
    const username = ctx.appUser?.username ?? "unknown";
    console.log(`[JackMac] [INPUT] syncToSheets triggered by @${username}`);
    console.log(`[JackMac] [STEP] Starting background sync job...`);

    // Fire-and-forget: startSyncJob() returns immediately with a jobId.
    // The sync runs asynchronously via setImmediate in jackMacSheetsSync.ts.
    const jobId = startSyncJob();

    console.log(
      `[JackMac] [OUTPUT] syncToSheets: background job started jobId=${jobId} by @${username}`
    );
    console.log(
      `[JackMac] [VERIFY] PASS — sync job enqueued, returning jobId to client immediately`
    );

    return { jobId };
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
          `[JackMac] [VERIFY] WARN — getSyncStatus: jobId="${input.jobId}" not found (evicted or invalid) for @${username}`
        );
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Sync job not found: ${input.jobId}. It may have expired (jobs are retained for 30 minutes).`,
        });
      }

      console.log(
        `[JackMac] [STATE] getSyncStatus: jobId=${input.jobId} status=${job.status} elapsed=${job.elapsedMs ?? "pending"}ms for @${username}`
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
    .input(
      z.object({
        forceRefresh: z.boolean().default(false),
      })
    )
    .query(async ({ ctx, input }) => {
      const username = ctx.appUser?.username ?? "unknown";
      console.log(
        `[JackMac] [INPUT] getLineups requested by @${username} forceRefresh=${input.forceRefresh}`
      );
      console.log(`[JackMac] [STEP] Fetching lineups from MLB Stats API (cache-aware)...`);

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
});
