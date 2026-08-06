/**
 * nhlSchedule.ts — tRPC router for NHL schedule history and Last 5 Games data
 *
 * Procedures:
 *   nhlSchedule.getLast5ForMatchup   — public — Last 5 completed games for both teams in a matchup
 *   nhlSchedule.getTeamSchedule      — public — Full schedule for a single team (all games)
 *   nhlSchedule.getSituationalStats  — public — Situational records (ML/Spread/Total) for a team
 *   nhlSchedule.refreshScheduleForDate — owner-only — Manually trigger a date refresh
 *   nhlSchedule.backfillSchedule     — owner-only — Backfill last N days
 *
 * Data source: Action Network v2 API, DraftKings NJ (book_id=68) exclusively
 *
 * Logging: [NhlScheduleRouter][PROCEDURE] plain-English, fully traceable
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { ownerProcedure, appUserProcedure } from "./appUsers";
import {
  getNhlLast5ForMatchup,
  getNhlFullScheduleForTeam,
  getNhlSituationalStats,
  refreshNhlScheduleForDate,
  backfillNhlScheduleHistory,
  type NhlScheduleRefreshResult,
} from "../nhlScheduleHistoryService";
import {
  seedNhlTomorrowGoalies,
  checkGoalieChanges,
} from "../nhlGoalieWatcher";

const TAG = "[NhlScheduleRouter]";

// ─── Zod validators ───────────────────────────────────────────────────────────
/** AN url_slug format: lowercase letters, digits, hyphens only */
const zodAnSlug = z
  .string()
  .min(2)
  .max(64)
  .regex(
    /^[a-z0-9-]+$/,
    "Invalid team slug — must be lowercase letters, digits, and hyphens only"
  );

/** YYYYMMDD date string for the AN API */
const zodAnDate = z
  .string()
  .length(8)
  .regex(/^\d{8}$/, "Date must be in YYYYMMDD format");

// ─── Router ───────────────────────────────────────────────────────────────────
export const nhlScheduleRouter = router({
  /**
   * Get the last 5 completed games for both teams in an NHL matchup.
   * Powers the "Last 5 Games" panel on each NHL matchup card.
   *
   * Input:
   *   awaySlug — Action Network url_slug for the away team (e.g. "boston-bruins")
   *   homeSlug — Action Network url_slug for the home team (e.g. "toronto-maple-leafs")
   *
   * Returns:
   *   awayLast5 — Array of up to 5 completed games for the away team (most recent first)
   *   homeLast5 — Array of up to 5 completed games for the home team (most recent first)
   */
  // SECURITY: appUserProcedure — NHL schedule history is authenticated-user content.
  getLast5ForMatchup: appUserProcedure
    .input(
      z.object({
        awaySlug: zodAnSlug,
        homeSlug: zodAnSlug,
      })
    )
    .query(async ({ input, ctx }) => {
      console.log(
        `${TAG}[getLast5ForMatchup] AUTHED userId=${ctx.appUser.id} Fetching Last 5 for matchup:` +
          ` away="${input.awaySlug}" vs home="${input.homeSlug}"`
      );
      try {
        const { awayLast5, homeLast5 } = await getNhlLast5ForMatchup(
          input.awaySlug,
          input.homeSlug
        );
        console.log(
          `${TAG}[getLast5ForMatchup] Returning` +
            ` away=${awayLast5.length} games, home=${homeLast5.length} games`
        );
        return { awayLast5, homeLast5 };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${TAG}[getLast5ForMatchup] ERROR: ${msg}`);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to fetch NHL Last 5 games: ${msg}`,
        });
      }
    }),

  /**
   * Get the full schedule for a single NHL team (all games, any status).
   * Powers the Team Schedule page when a user clicks on a team logo.
   *
   * Input:
   *   teamSlug — Action Network url_slug (e.g. "boston-bruins")
   *
   * Returns:
   *   games — Array of all games for this team (most recent first)
   *   teamSlug — Echo back the slug for the frontend to use
   */
  // SECURITY: appUserProcedure — NHL team schedule is authenticated-user content.
  getTeamSchedule: appUserProcedure
    .input(
      z.object({
        teamSlug: zodAnSlug,
      })
    )
    .query(async ({ input, ctx }) => {
      console.log(
        `${TAG}[getTeamSchedule] AUTHED userId=${ctx.appUser.id} Fetching full schedule for team="${input.teamSlug}"`
      );
      try {
        const games = await getNhlFullScheduleForTeam(input.teamSlug);
        console.log(
          `${TAG}[getTeamSchedule] Returning ${games.length} games for team="${input.teamSlug}"`
        );
        return { games, teamSlug: input.teamSlug };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${TAG}[getTeamSchedule] ERROR: ${msg}`);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to fetch NHL team schedule: ${msg}`,
        });
      }
    }),

  /**
   * Get situational records for a single NHL team.
   * Powers the "Situational Results" panel (ML/Puck Line/Total tabs).
   *
   * Input:
   *   teamSlug — Action Network url_slug (e.g. "boston-bruins")
   *
   * Returns:
   *   ml      — { overall, last10, home, away, favorite, underdog } win/loss records
   *   spread  — { overall, last10, home, away, favorite, underdog } puck line ATS records
   *   total   — { overall, last10, home, away, favorite, underdog } O/U records
   *   gamesAnalyzed — Total number of complete games used for computation
   */
  // SECURITY: appUserProcedure — NHL situational stats are authenticated-user content.
  getSituationalStats: appUserProcedure
    .input(
      z.object({
        teamSlug: zodAnSlug,
      })
    )
    .query(async ({ input, ctx }) => {
      console.log(
        `${TAG}[getSituationalStats] AUTHED userId=${ctx.appUser.id} Computing situational stats for team="${input.teamSlug}"`
      );
      try {
        const stats = await getNhlSituationalStats(input.teamSlug);
        console.log(
          `${TAG}[getSituationalStats] Returning stats for team="${input.teamSlug}"` +
            ` gamesAnalyzed=${stats.gamesAnalyzed}`
        );
        return stats;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${TAG}[getSituationalStats] ERROR: ${msg}`);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to compute NHL situational stats: ${msg}`,
        });
      }
    }),

  /**
   * Owner-only: Refresh NHL schedule history for a specific date.
   * Fetches from AN DK NJ API and upserts into nhl_schedule_history.
   *
   * Input:
   *   date — YYYYMMDD format (e.g. "20260410")
   */
  refreshScheduleForDate: ownerProcedure
    .input(
      z.object({
        date: zodAnDate,
      })
    )
    .mutation(async ({ input }) => {
      console.log(
        `${TAG}[refreshScheduleForDate] Manual refresh triggered for date=${input.date}`
      );
      try {
        const result = await refreshNhlScheduleForDate(input.date);
        console.log(
          `${TAG}[refreshScheduleForDate] Complete:` +
            ` fetched=${result.fetched} upserted=${result.upserted}` +
            ` errors=${result.errors.length}`
        );
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${TAG}[refreshScheduleForDate] ERROR: ${msg}`);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `NHL schedule refresh failed: ${msg}`,
        });
      }
    }),

  /**
   * Owner-only: Backfill NHL schedule history for the last N days.
   * Runs sequentially, fetching each date from the AN DK NJ API.
   *
   * Input:
   *   daysBack — Number of days to backfill (default: 30, max: 60)
   */
  backfillSchedule: ownerProcedure
    .input(
      z.object({
        daysBack: z.number().int().min(1).max(60).default(30),
      })
    )
    .mutation(async ({ input }) => {
      console.log(
        `${TAG}[backfillSchedule] Manual backfill triggered for last ${input.daysBack} days`
      );
      try {
        const results = await backfillNhlScheduleHistory(input.daysBack);
        const totalFetched = results.reduce(
          (s: number, r: NhlScheduleRefreshResult) => s + r.fetched,
          0
        );
        const totalUpserted = results.reduce(
          (s: number, r: NhlScheduleRefreshResult) => s + r.upserted,
          0
        );
        const totalErrors = results.reduce(
          (s: number, r: NhlScheduleRefreshResult) => s + r.errors.length,
          0
        );
        console.log(
          `${TAG}[backfillSchedule] Complete:` +
            ` dates=${results.length} totalFetched=${totalFetched}` +
            ` totalUpserted=${totalUpserted} totalErrors=${totalErrors}`
        );
        return { results, totalFetched, totalUpserted, totalErrors };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${TAG}[backfillSchedule] ERROR: ${msg}`);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `NHL backfill failed: ${msg}`,
        });
      }
    }),

  /**
   * Owner-only: Manually seed tomorrow's NHL games with goalie data from RotoWire.
   * Triggers the NHL model for any tomorrow game that has both goalies populated.
   */
  seedTomorrowGoalies: ownerProcedure.mutation(async () => {
    console.log(
      `${TAG}[seedTomorrowGoalies] Manual tomorrow goalie seed triggered`
    );
    try {
      const result = await seedNhlTomorrowGoalies("manual");
      console.log(
        `${TAG}[seedTomorrowGoalies] Complete:` +
          ` gamesChecked=${result.gamesChecked}` +
          ` changes=${result.changes.length}` +
          ` modelRerun=${result.modelRerun}` +
          ` errors=${result.errors.length}`
      );
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${TAG}[seedTomorrowGoalies] ERROR: ${msg}`);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Tomorrow goalie seed failed: ${msg}`,
      });
    }
  }),

  /**
   * Owner-only: Manually trigger today's goalie change check and model re-run.
   */
  checkGoaliesNow: ownerProcedure.mutation(async () => {
    console.log(`${TAG}[checkGoaliesNow] Manual goalie check triggered`);
    try {
      const result = await checkGoalieChanges("manual");
      console.log(
        `${TAG}[checkGoaliesNow] Complete:` +
          ` gamesChecked=${result.gamesChecked}` +
          ` changes=${result.changes.length}` +
          ` modelRerun=${result.modelRerun}` +
          ` errors=${result.errors.length}`
      );
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${TAG}[checkGoaliesNow] ERROR: ${msg}`);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Goalie check failed: ${msg}`,
      });
    }
  }),
});

export type NhlScheduleRouter = typeof nhlScheduleRouter;
