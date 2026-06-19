/**
 * wc2026Router.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * tRPC procedures for WC2026 data access.
 *
 * Procedures:
 *   wc2026.allGroups        → all 48 teams grouped by group letter
 *   wc2026.fixturesByDate   → fixtures for a given date with team + venue info
 *   wc2026.fixturesByGroup  → all fixtures for a given group letter
 *   wc2026.latestOdds       → most recent odds snapshot per fixture × book × market
 *   wc2026.closingOdds      → is_closing=true snapshots per fixture
 *   wc2026.latestSplits     → most recent betting splits per fixture
 *   wc2026.latestLineups    → most recent lineup rows per fixture
 *   wc2026.todayWithOdds    → today's fixtures with DraftKings 1X2 odds
 */

import { z } from "zod";
import { router, publicProcedure } from "../_core/trpc";
import { getDb } from "../db";
import {
  wc2026Fixtures,
  wc2026Teams,
  wc2026Venues,
  wc2026OddsSnapshots,
  wc2026BettingSplits,
  wc2026Lineups,
} from "../../drizzle/wc2026.schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";

type WcTeam = typeof wc2026Teams.$inferSelect;
type WcVenue = typeof wc2026Venues.$inferSelect;
type WcFixture = typeof wc2026Fixtures.$inferSelect;
type WcOddsRow = typeof wc2026OddsSnapshots.$inferSelect;

export const wc2026Router = router({
  // ─── All groups + teams ────────────────────────────────────────────────────
  allGroups: publicProcedure.query(async () => {
    const db = await getDb();
    const teams = await db
      .select()
      .from(wc2026Teams)
      .orderBy(wc2026Teams.groupLetter, wc2026Teams.name);

    const grouped: Record<string, typeof teams> = {};
    for (const t of teams) {
      if (!grouped[t.groupLetter]) grouped[t.groupLetter] = [];
      grouped[t.groupLetter].push(t);
    }
    return grouped;
  }),

  // ─── Fixtures by date ─────────────────────────────────────────────────────
  fixturesByDate: publicProcedure
    .input(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .query(async ({ input }) => {
      const db = await getDb();
      const fixtures = await db
        .select()
        .from(wc2026Fixtures)
        .where(eq(wc2026Fixtures.matchDate, sql`${input.date}`))
        .orderBy(wc2026Fixtures.kickoffUtc, wc2026Fixtures.fixtureId);

      if (fixtures.length === 0) return [];

      const [teams, venues] = await Promise.all([
        db.select().from(wc2026Teams),
        db.select().from(wc2026Venues),
      ]);

      const teamMap = Object.fromEntries(teams.map((t: WcTeam) => [t.teamId, t]));
      const venueMap = Object.fromEntries(venues.map((v: WcVenue) => [v.venueId, v]));
      const fixtureIds = fixtures.map((f: WcFixture) => f.fixtureId);

      // Fetch latest DraftKings (book_id=68) AND AI Model (book_id=0) 1X2 + TOTAL + DOUBLE_CHANCE odds
      // [LOG] buildOddsMap: maps 1X2 (home/draw/away), TOTAL (over/under), DOUBLE_CHANCE (home_draw/away_draw)
      // [LOG] homeDrawOdds = 1X (Home Win-Draw), awayDrawOdds = X2 (Away Win-Draw)
      type OddsShape = { home?: number; away?: number; draw?: number; overLine?: number; overOdds?: number; underOdds?: number; homeDrawOdds?: number; awayDrawOdds?: number };
      const buildOddsMap = (rows: WcOddsRow[], ids: string[]): Record<string, OddsShape> => {
        const map: Record<string, OddsShape> = {};
        const seen = new Set<string>();
        for (const row of rows) {
          if (!ids.includes(row.fixtureId)) continue;
          if (!map[row.fixtureId]) map[row.fixtureId] = {};
          const key = `${row.fixtureId}:${row.market}:${row.selection}`;
          if (!seen.has(key)) {
            seen.add(key);
            const o = map[row.fixtureId] as Record<string, number | undefined>;
            if (row.market === "1X2") {
              o[row.selection] = row.americanOdds;
            } else if (row.market === "TOTAL") {
              if (row.selection === "over") { o["overLine"] = row.line ?? undefined; o["overOdds"] = row.americanOdds; }
              else if (row.selection === "under") { o["underOdds"] = row.americanOdds; }
            } else if (row.market === "DOUBLE_CHANCE") {
              // [LOG] DOUBLE_CHANCE: home_draw=1X (Home Win-Draw), away_draw=X2 (Away Win-Draw)
              if (row.selection === "home_draw") { o["homeDrawOdds"] = row.americanOdds; }
              else if (row.selection === "away_draw") { o["awayDrawOdds"] = row.americanOdds; }
            }
          }
        }
        return map;
      };

      const [dkOddsRows, modelOddsRows] = await Promise.all([
        db.select().from(wc2026OddsSnapshots).where(eq(wc2026OddsSnapshots.bookId, 68)).orderBy(desc(wc2026OddsSnapshots.snapshotTs)),
        db.select().from(wc2026OddsSnapshots).where(eq(wc2026OddsSnapshots.bookId, 0)).orderBy(desc(wc2026OddsSnapshots.snapshotTs)),
      ]);

      const dkMap = buildOddsMap(dkOddsRows as WcOddsRow[], fixtureIds);
      const modelMap = buildOddsMap(modelOddsRows as WcOddsRow[], fixtureIds);

      return fixtures.map((f: WcFixture) => ({
        ...f,
        homeTeam: teamMap[f.homeTeamId] ?? null,
        awayTeam: teamMap[f.awayTeamId] ?? null,
        venue: venueMap[f.venueId] ?? null,
        dkOdds: dkMap[f.fixtureId] ?? null,
        modelOdds: modelMap[f.fixtureId] ?? null,
      }));
    }),

  // ─── Fixtures by group ────────────────────────────────────────────────────
  fixturesByGroup: publicProcedure
    .input(z.object({ group: z.string().length(1) }))
    .query(async ({ input }) => {
      const db = await getDb();
      const fixtures = await db
        .select()
        .from(wc2026Fixtures)
        .where(eq(wc2026Fixtures.groupLetter, input.group.toUpperCase()))
        .orderBy(wc2026Fixtures.matchday, wc2026Fixtures.kickoffUtc);

      const [teams, venues] = await Promise.all([
        db.select().from(wc2026Teams),
        db.select().from(wc2026Venues),
      ]);

      const teamMap = Object.fromEntries(teams.map((t: WcTeam) => [t.teamId, t]));
      const venueMap = Object.fromEntries(venues.map((v: WcVenue) => [v.venueId, v]));

      return fixtures.map((f: WcFixture) => ({
        ...f,
        homeTeam: teamMap[f.homeTeamId] ?? null,
        awayTeam: teamMap[f.awayTeamId] ?? null,
        venue: venueMap[f.venueId] ?? null,
      }));
    }),

  // ─── Latest odds per fixture ──────────────────────────────────────────────
  latestOdds: publicProcedure
    .input(z.object({ fixtureId: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      const latest = await db
        .select({ maxTs: sql<Date>`MAX(snapshot_ts)` })
        .from(wc2026OddsSnapshots)
        .where(eq(wc2026OddsSnapshots.fixtureId, input.fixtureId));

      const maxTs = latest[0]?.maxTs;
      if (!maxTs) return [];

      return db
        .select()
        .from(wc2026OddsSnapshots)
        .where(
          and(
            eq(wc2026OddsSnapshots.fixtureId, input.fixtureId),
            eq(wc2026OddsSnapshots.snapshotTs, maxTs)
          )
        )
        .orderBy(wc2026OddsSnapshots.bookId, wc2026OddsSnapshots.market);
    }),

  // ─── Closing odds per fixture ─────────────────────────────────────────────
  closingOdds: publicProcedure
    .input(z.object({ fixtureId: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      return db
        .select()
        .from(wc2026OddsSnapshots)
        .where(
          and(
            eq(wc2026OddsSnapshots.fixtureId, input.fixtureId),
            eq(wc2026OddsSnapshots.isClosing, true)
          )
        )
        .orderBy(desc(wc2026OddsSnapshots.snapshotTs), wc2026OddsSnapshots.bookId);
    }),

  // ─── Latest splits per fixture ────────────────────────────────────────────
  latestSplits: publicProcedure
    .input(z.object({ fixtureId: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      const latest = await db
        .select({ maxTs: sql<Date>`MAX(snapshot_ts)` })
        .from(wc2026BettingSplits)
        .where(eq(wc2026BettingSplits.fixtureId, input.fixtureId));

      const maxTs = latest[0]?.maxTs;
      if (!maxTs) return [];

      return db
        .select()
        .from(wc2026BettingSplits)
        .where(
          and(
            eq(wc2026BettingSplits.fixtureId, input.fixtureId),
            eq(wc2026BettingSplits.snapshotTs, maxTs)
          )
        )
        .orderBy(wc2026BettingSplits.teamId, wc2026BettingSplits.market);
    }),

  // ─── Latest lineups per fixture ───────────────────────────────────────────
  latestLineups: publicProcedure
    .input(z.object({ fixtureId: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      const latest = await db
        .select({ maxTs: sql<Date>`MAX(scraped_at)` })
        .from(wc2026Lineups)
        .where(eq(wc2026Lineups.fixtureId, input.fixtureId));

      const maxTs = latest[0]?.maxTs;
      if (!maxTs) return [];

      return db
        .select()
        .from(wc2026Lineups)
        .where(
          and(
            eq(wc2026Lineups.fixtureId, input.fixtureId),
            eq(wc2026Lineups.scrapedAt, maxTs)
          )
        )
        .orderBy(wc2026Lineups.teamId, wc2026Lineups.isStarter, wc2026Lineups.position);
    }),

  // ─── Lineups by date ──────────────────────────────────────────────────────
  lineupsByDate: publicProcedure
    .input(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .query(async ({ input }) => {
      const db = await getDb();
      // Get all fixtures for this date
      const fixtures = await db
        .select()
        .from(wc2026Fixtures)
        .where(eq(wc2026Fixtures.matchDate, sql`${input.date}`))
        .orderBy(wc2026Fixtures.kickoffUtc, wc2026Fixtures.fixtureId);

      if (fixtures.length === 0) return [];

      const [teams, venues] = await Promise.all([
        db.select().from(wc2026Teams),
        db.select().from(wc2026Venues),
      ]);

      const teamMap = Object.fromEntries(teams.map((t: WcTeam) => [t.teamId, t]));
      const venueMap = Object.fromEntries(venues.map((v: WcVenue) => [v.venueId, v]));
      const fixtureIds = fixtures.map((f: WcFixture) => f.fixtureId);

      // Get all lineups for these fixtures in one query
      const allLineups = fixtureIds.length > 0
        ? await db
            .select()
            .from(wc2026Lineups)
            .where(inArray(wc2026Lineups.fixtureId, fixtureIds))
            .orderBy(wc2026Lineups.fixtureId, wc2026Lineups.teamId, wc2026Lineups.isStarter, wc2026Lineups.position)
        : [];

      // Group lineups by fixtureId
      const lineupMap: Record<string, typeof allLineups> = {};
      for (const row of allLineups) {
        if (!lineupMap[row.fixtureId]) lineupMap[row.fixtureId] = [];
        lineupMap[row.fixtureId].push(row);
      }

      return fixtures.map((f: WcFixture) => ({
        ...f,
        homeTeam: teamMap[f.homeTeamId] ?? null,
        awayTeam: teamMap[f.awayTeamId] ?? null,
        venue: venueMap[f.venueId] ?? null,
        lineups: lineupMap[f.fixtureId] ?? [],
      }));
    }),

  // ─── Today's fixtures with DK 1X2 odds (main page feed) ──────────────────
  todayWithOdds: publicProcedure.query(async () => {
    const db = await getDb();
    // [FIX] Use the same 11:00 UTC cutoff gate as CalendarPicker.todayUTC().
    // Raw `new Date().toISOString().split('T')[0]` returns the UTC calendar date,
    // which causes late-night matches (kickoff_utc crossing midnight UTC, e.g.
    // MEX vs KOR at 01:00 UTC = June 18 EDT) to disappear from todayWithOdds
    // after midnight UTC because their match_date is the local date (June 18)
    // but the server was computing today as June 19.
    //
    // The fix: if the current UTC hour is before 11:00 (the feed cutoff), use
    // yesterday's date — matching the exact logic in CalendarPicker.todayUTC().
    const nowUtc = new Date();
    const FEED_CUTOFF_UTC_HOUR = 11;
    const isBeforeCutoff = nowUtc.getUTCHours() < FEED_CUTOFF_UTC_HOUR;
    let today: string;
    if (isBeforeCutoff) {
      // Before 11:00 UTC — use previous calendar day (same as client CalendarPicker)
      const prev = new Date(nowUtc);
      prev.setUTCDate(prev.getUTCDate() - 1);
      today = prev.toISOString().split("T")[0];
    } else {
      today = nowUtc.toISOString().split("T")[0];
    }
    console.log(`[wc2026.todayWithOdds] utcHour=${nowUtc.getUTCHours()} isBeforeCutoff=${isBeforeCutoff} effectiveDate=${today}`);

    const fixtures = await db
      .select()
      .from(wc2026Fixtures)
      .where(eq(wc2026Fixtures.matchDate, sql`${today}`))
      .orderBy(wc2026Fixtures.kickoffUtc, wc2026Fixtures.fixtureId);

    if (fixtures.length === 0) return [];

    const [teams, venues] = await Promise.all([
      db.select().from(wc2026Teams),
      db.select().from(wc2026Venues),
    ]);

    const teamMap = Object.fromEntries(teams.map((t: WcTeam) => [t.teamId, t]));
    const venueMap = Object.fromEntries(venues.map((v: WcVenue) => [v.venueId, v]));
    const fixtureIds = fixtures.map((f: WcFixture) => f.fixtureId);

    // Fetch latest DraftKings (book_id=68) AND AI Model (book_id=0) 1X2 + TOTAL + DOUBLE_CHANCE odds
    // [LOG] buildOddsMapT: maps 1X2 (home/draw/away), TOTAL (over/under), DOUBLE_CHANCE (home_draw/away_draw)
    // [LOG] homeDrawOdds = 1X (Home Win-Draw), awayDrawOdds = X2 (Away Win-Draw)
    type OddsShapeT = { home?: number; away?: number; draw?: number; overLine?: number; overOdds?: number; underOdds?: number; homeDrawOdds?: number; awayDrawOdds?: number };
    const buildOddsMapT = (rows: WcOddsRow[], ids: string[]): Record<string, OddsShapeT> => {
      const map: Record<string, OddsShapeT> = {};
      const seen = new Set<string>();
      for (const row of rows) {
        if (!ids.includes(row.fixtureId)) continue;
        if (!map[row.fixtureId]) map[row.fixtureId] = {};
        const key = `${row.fixtureId}:${row.market}:${row.selection}`;
        if (!seen.has(key)) {
          seen.add(key);
          const o = map[row.fixtureId] as Record<string, number | undefined>;
          if (row.market === "1X2") {
            o[row.selection] = row.americanOdds;
          } else if (row.market === "TOTAL") {
            if (row.selection === "over") { o["overLine"] = row.line ?? undefined; o["overOdds"] = row.americanOdds; }
            else if (row.selection === "under") { o["underOdds"] = row.americanOdds; }
          } else if (row.market === "DOUBLE_CHANCE") {
            // [LOG] DOUBLE_CHANCE: home_draw=1X (Home Win-Draw), away_draw=X2 (Away Win-Draw)
            if (row.selection === "home_draw") { o["homeDrawOdds"] = row.americanOdds; }
            else if (row.selection === "away_draw") { o["awayDrawOdds"] = row.americanOdds; }
          }
        }
      }
      return map;
    };

    const [dkOddsRowsT, modelOddsRowsT] = await Promise.all([
      db.select().from(wc2026OddsSnapshots).where(eq(wc2026OddsSnapshots.bookId, 68)).orderBy(desc(wc2026OddsSnapshots.snapshotTs)),
      db.select().from(wc2026OddsSnapshots).where(eq(wc2026OddsSnapshots.bookId, 0)).orderBy(desc(wc2026OddsSnapshots.snapshotTs)),
    ]);

    const dkMapT = buildOddsMapT(dkOddsRowsT as WcOddsRow[], fixtureIds);
    const modelMapT = buildOddsMapT(modelOddsRowsT as WcOddsRow[], fixtureIds);

    return fixtures.map((f: WcFixture) => ({
      ...f,
      homeTeam: teamMap[f.homeTeamId] ?? null,
      awayTeam: teamMap[f.awayTeamId] ?? null,
      venue: venueMap[f.venueId] ?? null,
      dkOdds: dkMapT[f.fixtureId] ?? null,
      modelOdds: modelMapT[f.fixtureId] ?? null,
    }));
  }),

  /**
   * splitsByDate — returns fixtures for a given date with their latest DraftKings
   * betting splits (tickets % and money %) for HOME_ML, DRAW_ML, AWAY_ML, OVER, UNDER.
   */
  splitsByDate: publicProcedure
    .input(z.object({ date: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      const { date } = input;

      const fixtures = await db
        .select()
        .from(wc2026Fixtures)
        .where(eq(wc2026Fixtures.matchDate, sql`${date}`))
        .orderBy(wc2026Fixtures.kickoffUtc, wc2026Fixtures.fixtureId);

      if (fixtures.length === 0) return [];

      const fixtureIds = fixtures.map((f: WcFixture) => f.fixtureId);

      const [teams, splitsRows] = await Promise.all([
        db.select().from(wc2026Teams),
        db
          .select()
          .from(wc2026BettingSplits)
          .where(inArray(wc2026BettingSplits.fixtureId, fixtureIds))
          .orderBy(desc(wc2026BettingSplits.snapshotTs)),
      ]);

      const teamMap = Object.fromEntries(teams.map((t: WcTeam) => [t.teamId, t]));

      // Keep only the most-recent split per fixture × teamId × market
      type SplitRow = typeof wc2026BettingSplits.$inferSelect;
      const splitsMap: Record<string, SplitRow[]> = {};
      const seenSplit = new Set<string>();
      for (const row of splitsRows as SplitRow[]) {
        const key = `${row.fixtureId}:${row.teamId}:${row.market}`;
        if (!seenSplit.has(key)) {
          seenSplit.add(key);
          if (!splitsMap[row.fixtureId]) splitsMap[row.fixtureId] = [];
          splitsMap[row.fixtureId].push(row);
        }
      }

      return fixtures.map((f: WcFixture) => ({
        fixtureId: f.fixtureId,
        matchDate: f.matchDate,
        kickoffUtc: f.kickoffUtc,
        homeTeam: teamMap[f.homeTeamId] ?? null,
        awayTeam: teamMap[f.awayTeamId] ?? null,
        splits: splitsMap[f.fixtureId] ?? [],
      }));
    }),
});
