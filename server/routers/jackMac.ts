/**
 * jackMac.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * tRPC router for JACK MAC features.
 * Access is restricted to the JACK_MAC_WHITELIST: @prez, @sippi, @lucianobets.
 *
 * Procedures:
 *   jackMac.syncToSheets — scrapes all 4 RG pages + lineups and writes to Google Sheets
 *   jackMac.getLineups   — fetches MLB lineups for today + tomorrow (MLB Stats API)
 */

import { TRPCError } from "@trpc/server";
import { router } from "../_core/trpc";
import { appUserProcedure } from "./appUsers";
import { syncJackMacToSheets } from "../jackMacSheetsSync";
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
   * Scrapes all 4 Rotogrinders THE BAT X pages + Fangraphs lineups and writes
   * them to the Jack Mac Google Sheet. Returns a structured result with per-tab status.
   *
   * Restricted to: @prez, @sippi, @lucianobets
   */
  syncToSheets: jackMacProcedure.mutation(async ({ ctx }) => {
    const username = ctx.appUser?.username ?? "unknown";
    console.log(`[JackMac] [INPUT] syncToSheets triggered by @${username}`);
    console.log(`[JackMac] [STEP] Starting Rotogrinders + Fangraphs → Google Sheets sync...`);

    const result = await syncJackMacToSheets();

    console.log(
      `[JackMac] [OUTPUT] syncToSheets complete: success=${result.success} totalRows=${result.totalRowsWritten} elapsed=${result.elapsedMs}ms`
    );
    console.log(
      `[JackMac] [VERIFY] ${result.success ? "PASS" : "PARTIAL"} — sync triggered by @${username}`
    );

    return result;
  }),

  /**
   * getLineups
   * Fetches MLB lineups for today + tomorrow (PST dates) via the MLB Stats API.
   * Returns structured FgScrapeResult with game-level lineup and pitcher data.
   *
   * Restricted to: @prez, @sippi, @lucianobets
   */
  getLineups: jackMacProcedure.query(async ({ ctx }) => {
    const username = ctx.appUser?.username ?? "unknown";
    console.log(`[JackMac] [INPUT] getLineups requested by @${username}`);
    console.log(`[JackMac] [STEP] Fetching lineups from MLB Stats API...`);

    const t0 = Date.now();
    let result: FgScrapeResult;
    try {
      result = await scrapeFangraphsLineups();
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
