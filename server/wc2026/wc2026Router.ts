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
  wc2026ModelProjections,
  wc2026FrozenBookOdds,
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
      // [LOG] buildOddsMap: maps all 6 markets:
      //   1X2 (home/draw/away/no_draw), TOTAL (over/under), ASIAN_HANDICAP (home/away),
      //   DOUBLE_CHANCE (home_draw/away_draw), BTTS (yes/no)
      type OddsShape = {
        // 1X2
        home?: number; draw?: number; away?: number; noDraw?: number;
        // TOTAL
        overLine?: number; overOdds?: number; underOdds?: number;
        // ASIAN_HANDICAP (spread)
        homeSpreadLine?: number; homeSpreadOdds?: number;
        awaySpreadLine?: number; awaySpreadOdds?: number;
        // DOUBLE_CHANCE
        homeDrawOdds?: number; awayDrawOdds?: number;
        // BTTS
        bttsYes?: number; bttsNo?: number;
      };
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
              if (row.selection === "home") o["home"] = row.americanOdds;
              else if (row.selection === "draw") o["draw"] = row.americanOdds;
              else if (row.selection === "away") o["away"] = row.americanOdds;
              else if (row.selection === "no_draw") o["noDraw"] = row.americanOdds;
            } else if (row.market === "TOTAL") {
              if (row.selection === "over") { o["overLine"] = row.line != null ? parseFloat(row.line as unknown as string) : undefined; o["overOdds"] = row.americanOdds; }
              else if (row.selection === "under") { o["underOdds"] = row.americanOdds; }
            } else if (row.market === "ASIAN_HANDICAP") {
              if (row.selection === "home") { o["homeSpreadLine"] = row.line != null ? parseFloat(row.line as unknown as string) : undefined; o["homeSpreadOdds"] = row.americanOdds; }
              else if (row.selection === "away") { o["awaySpreadLine"] = row.line != null ? parseFloat(row.line as unknown as string) : undefined; o["awaySpreadOdds"] = row.americanOdds; }
            } else if (row.market === "DOUBLE_CHANCE") {
              if (row.selection === "home_draw") o["homeDrawOdds"] = row.americanOdds;
              else if (row.selection === "away_draw") o["awayDrawOdds"] = row.americanOdds;
            } else if (row.market === "BTTS") {
              if (row.selection === "yes") o["bttsYes"] = row.americanOdds;
              else if (row.selection === "no") o["bttsNo"] = row.americanOdds;
            }
          }
        }
        return map;
      };

      // [FIX 2026-06-24] PERFORMANCE: Filter odds by fixture_id IN (...) instead of full table scan.
      // Pre-fix: fetched ALL odds rows (3,724+) then filtered in-memory → O(N) per request.
      // Post-fix: fetches only rows for the 4-8 fixtures on this date → O(1) per request.
      // This eliminates the primary server-side latency cause for the blank WC feed on date change.
      // [FREEZE v7.0 2026-06-25] Also fetch frozen book odds — when a frozen row exists for a fixture,
      // it is served as dkOdds instead of the live snapshot, preventing any fluctuation.
      const [dkOddsRows, modelOddsRows, projRows, frozenBookRows] = await Promise.all([
        db.select().from(wc2026OddsSnapshots)
          .where(and(eq(wc2026OddsSnapshots.bookId, 68), inArray(wc2026OddsSnapshots.fixtureId, fixtureIds)))
          .orderBy(desc(wc2026OddsSnapshots.snapshotTs)),
        db.select().from(wc2026OddsSnapshots)
          .where(and(eq(wc2026OddsSnapshots.bookId, 0), inArray(wc2026OddsSnapshots.fixtureId, fixtureIds)))
          .orderBy(desc(wc2026OddsSnapshots.snapshotTs)),
        db.select().from(wc2026ModelProjections)
          .where(inArray(wc2026ModelProjections.fixtureId, fixtureIds)),
        db.select().from(wc2026FrozenBookOdds)
          .where(inArray(wc2026FrozenBookOdds.fixtureId, fixtureIds)),
      ]);

      const dkMap = buildOddsMap(dkOddsRows as WcOddsRow[], fixtureIds);
      const modelMap = buildOddsMap(modelOddsRows as WcOddsRow[], fixtureIds);
      const projMap = Object.fromEntries(
        (projRows as (typeof wc2026ModelProjections.$inferSelect)[]).map((p) => [p.fixtureId, p])
      );
      // [FREEZE v7.0] Build a map of frozen book odds — keyed by fixture_id.
      // When a frozen row exists, it is served as dkOdds, bypassing all live snapshot queries.
      type FrozenBookRow = typeof wc2026FrozenBookOdds.$inferSelect;
      const frozenBookMap = Object.fromEntries(
        (frozenBookRows as FrozenBookRow[]).map((r) => [r.fixtureId, r])
      );
      const frozenBookToOdds = (r: FrozenBookRow): Record<string, number | undefined> => ({
        home: r.bookHomeMl ?? undefined,
        draw: r.bookDrawMl ?? undefined,
        away: r.bookAwayMl ?? undefined,
        homeSpreadLine: r.bookSpreadLine ?? undefined,
        homeSpreadOdds: r.bookHomeSpreadOdds ?? undefined,
        awaySpreadLine: r.bookSpreadLine != null ? -r.bookSpreadLine : undefined,
        awaySpreadOdds: r.bookAwaySpreadOdds ?? undefined,
        overLine: r.bookTotalLine ?? undefined,
        overOdds: r.bookOverOdds ?? undefined,
        underOdds: r.bookUnderOdds ?? undefined,
        bttsYes: r.bookBttsYesOdds ?? undefined,
        bttsNo: r.bookBttsNoOdds ?? undefined,
        homeDrawOdds: r.bookDc1XOdds ?? undefined,
        awayDrawOdds: r.bookDcX2Odds ?? undefined,
        noDraw: r.bookNoDrawHomeOdds ?? undefined,
      });
      // [FIX v7.0] Build modelOdds from wc2026_model_projections when a projection row exists.
      // Previously: modelOdds was always read from wc2026_odds_snapshots book_id=0 (stale AI snapshot).
      // Now: projection row fields are mapped to the OddsShape the frontend expects.
      // Fallback: use book_id=0 snapshot only when no projection row is present.
      type ProjRow = typeof wc2026ModelProjections.$inferSelect;
      const projToModelOdds = (p: ProjRow): Record<string, number | undefined> => ({
        home: p.modelHomeML ?? undefined,
        draw: p.modelDrawML ?? undefined,
        away: p.modelAwayML ?? undefined,
        overLine: p.modelTotal ?? undefined,
        overOdds: p.overOdds ?? undefined,
        underOdds: p.underOdds ?? undefined,
        homeSpreadLine: p.modelSpread ?? undefined,
        homeSpreadOdds: p.homeSpreadOdds ?? undefined,
        awaySpreadLine: p.modelSpread != null ? -p.modelSpread : undefined,
        awaySpreadOdds: p.awaySpreadOdds ?? undefined,
        homeDrawOdds: p.dc1XOdds ?? undefined,
        awayDrawOdds: p.dcX2Odds ?? undefined,
        bttsYes: p.bttsYesOdds ?? undefined,
        bttsNo: p.bttsNoOdds ?? undefined,
        noDraw: p.noDrawHomeOdds ?? undefined,
        homeEdge: p.homeEdge ?? undefined,
        drawEdge: p.drawEdge ?? undefined,
        awayEdge: p.awayEdge ?? undefined,
        homeWinProb: p.homeWinProb ?? undefined,
        drawProb: p.drawProb ?? undefined,
        awayWinProb: p.awayWinProb ?? undefined,
        projHomeScore: p.projHomeScore ?? undefined,
        projAwayScore: p.projAwayScore ?? undefined,
        projTotal: p.projTotal ?? undefined,
      });
      return fixtures.map((f: WcFixture) => {
        const proj = projMap[f.fixtureId] ?? null;
        const frozenBook = frozenBookMap[f.fixtureId] ?? null;
        return {
          ...f,
          homeTeam: teamMap[f.homeTeamId] ?? null,
          awayTeam: teamMap[f.awayTeamId] ?? null,
          venue: venueMap[f.venueId] ?? null,
          // [FREEZE] Use frozen book odds when available, otherwise fall back to live DK snapshot
          dkOdds: frozenBook ? frozenBookToOdds(frozenBook) : (dkMap[f.fixtureId] ?? null),
          // [FREEZE] Use frozen model projection when is_frozen=1, otherwise fall back to book_id=0 snapshot
          modelOdds: proj ? projToModelOdds(proj) : (modelMap[f.fixtureId] ?? null),
          projection: proj,
          modelVersion: proj?.modelVersion ?? null,
          isFrozen: proj?.isFrozen ?? false,
          frozenAt: proj?.frozenAt ?? null,
        };
      });
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

    // [LOG] buildOddsMapT: maps all 6 markets (1X2/TOTAL/ASIAN_HANDICAP/DOUBLE_CHANCE/BTTS/NO_DRAW)
    type OddsShapeT = {
      home?: number; draw?: number; away?: number; noDraw?: number;
      overLine?: number; overOdds?: number; underOdds?: number;
      homeSpreadLine?: number; homeSpreadOdds?: number;
      awaySpreadLine?: number; awaySpreadOdds?: number;
      homeDrawOdds?: number; awayDrawOdds?: number;
      bttsYes?: number; bttsNo?: number;
    };
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
            if (row.selection === "home") o["home"] = row.americanOdds;
            else if (row.selection === "draw") o["draw"] = row.americanOdds;
            else if (row.selection === "away") o["away"] = row.americanOdds;
            else if (row.selection === "no_draw") o["noDraw"] = row.americanOdds;
          } else if (row.market === "TOTAL") {
            if (row.selection === "over") { o["overLine"] = row.line != null ? parseFloat(row.line as unknown as string) : undefined; o["overOdds"] = row.americanOdds; }
            else if (row.selection === "under") { o["underOdds"] = row.americanOdds; }
          } else if (row.market === "ASIAN_HANDICAP") {
            if (row.selection === "home") { o["homeSpreadLine"] = row.line != null ? parseFloat(row.line as unknown as string) : undefined; o["homeSpreadOdds"] = row.americanOdds; }
            else if (row.selection === "away") { o["awaySpreadLine"] = row.line != null ? parseFloat(row.line as unknown as string) : undefined; o["awaySpreadOdds"] = row.americanOdds; }
          } else if (row.market === "DOUBLE_CHANCE") {
            if (row.selection === "home_draw") o["homeDrawOdds"] = row.americanOdds;
            else if (row.selection === "away_draw") o["awayDrawOdds"] = row.americanOdds;
          } else if (row.market === "BTTS") {
            if (row.selection === "yes") o["bttsYes"] = row.americanOdds;
            else if (row.selection === "no") o["bttsNo"] = row.americanOdds;
          }
        }
      }
      return map;
    };

    // [FIX 2026-06-24] PERFORMANCE: Same fixture_id IN filter as fixturesByDate.
    // [FREEZE v7.0 2026-06-25] Also fetch frozen book odds.
    const [dkOddsRowsT, modelOddsRowsT, projRowsT, frozenBookRowsT] = await Promise.all([
      db.select().from(wc2026OddsSnapshots)
        .where(and(eq(wc2026OddsSnapshots.bookId, 68), inArray(wc2026OddsSnapshots.fixtureId, fixtureIds)))
        .orderBy(desc(wc2026OddsSnapshots.snapshotTs)),
      db.select().from(wc2026OddsSnapshots)
        .where(and(eq(wc2026OddsSnapshots.bookId, 0), inArray(wc2026OddsSnapshots.fixtureId, fixtureIds)))
        .orderBy(desc(wc2026OddsSnapshots.snapshotTs)),
      db.select().from(wc2026ModelProjections)
        .where(inArray(wc2026ModelProjections.fixtureId, fixtureIds)),
      db.select().from(wc2026FrozenBookOdds)
        .where(inArray(wc2026FrozenBookOdds.fixtureId, fixtureIds)),
    ]);

    const dkMapT = buildOddsMapT(dkOddsRowsT as WcOddsRow[], fixtureIds);
    const modelMapT = buildOddsMapT(modelOddsRowsT as WcOddsRow[], fixtureIds);
    const projMapT = Object.fromEntries(
      (projRowsT as (typeof wc2026ModelProjections.$inferSelect)[]).map((p) => [p.fixtureId, p])
    );
    // [FREEZE v7.0] Frozen book odds map for todayWithOdds procedure
    type FrozenBookRowT = typeof wc2026FrozenBookOdds.$inferSelect;
    const frozenBookMapT = Object.fromEntries(
      (frozenBookRowsT as FrozenBookRowT[]).map((r) => [r.fixtureId, r])
    );
    const frozenBookToOddsT = (r: FrozenBookRowT): Record<string, number | undefined> => ({
      home: r.bookHomeMl ?? undefined,
      draw: r.bookDrawMl ?? undefined,
      away: r.bookAwayMl ?? undefined,
      homeSpreadLine: r.bookSpreadLine ?? undefined,
      homeSpreadOdds: r.bookHomeSpreadOdds ?? undefined,
      awaySpreadLine: r.bookSpreadLine != null ? -r.bookSpreadLine : undefined,
      awaySpreadOdds: r.bookAwaySpreadOdds ?? undefined,
      overLine: r.bookTotalLine ?? undefined,
      overOdds: r.bookOverOdds ?? undefined,
      underOdds: r.bookUnderOdds ?? undefined,
      bttsYes: r.bookBttsYesOdds ?? undefined,
      bttsNo: r.bookBttsNoOdds ?? undefined,
      homeDrawOdds: r.bookDc1XOdds ?? undefined,
      awayDrawOdds: r.bookDcX2Odds ?? undefined,
      noDraw: r.bookNoDrawHomeOdds ?? undefined,
    });
    // [FIX v7.0] Same projection-first modelOdds logic as fixturesByDate
    type ProjRowT = typeof wc2026ModelProjections.$inferSelect;
    const projToModelOddsT = (p: ProjRowT): Record<string, number | undefined> => ({
      home: p.modelHomeML ?? undefined,
      draw: p.modelDrawML ?? undefined,
      away: p.modelAwayML ?? undefined,
      overLine: p.modelTotal ?? undefined,
      overOdds: p.overOdds ?? undefined,
      underOdds: p.underOdds ?? undefined,
      homeSpreadLine: p.modelSpread ?? undefined,
      homeSpreadOdds: p.homeSpreadOdds ?? undefined,
      awaySpreadLine: p.modelSpread != null ? -p.modelSpread : undefined,
      awaySpreadOdds: p.awaySpreadOdds ?? undefined,
      homeDrawOdds: p.dc1XOdds ?? undefined,
      awayDrawOdds: p.dcX2Odds ?? undefined,
      bttsYes: p.bttsYesOdds ?? undefined,
      bttsNo: p.bttsNoOdds ?? undefined,
      noDraw: p.noDrawHomeOdds ?? undefined,
      homeEdge: p.homeEdge ?? undefined,
      drawEdge: p.drawEdge ?? undefined,
      awayEdge: p.awayEdge ?? undefined,
      homeWinProb: p.homeWinProb ?? undefined,
      drawProb: p.drawProb ?? undefined,
      awayWinProb: p.awayWinProb ?? undefined,
      projHomeScore: p.projHomeScore ?? undefined,
      projAwayScore: p.projAwayScore ?? undefined,
      projTotal: p.projTotal ?? undefined,
    });
    return fixtures.map((f: WcFixture) => {
      const proj = projMapT[f.fixtureId] ?? null;
      const frozenBookT = frozenBookMapT[f.fixtureId] ?? null;
      return {
        ...f,
        homeTeam: teamMap[f.homeTeamId] ?? null,
        awayTeam: teamMap[f.awayTeamId] ?? null,
        venue: venueMap[f.venueId] ?? null,
        // [FREEZE] Use frozen book odds when available, otherwise fall back to live DK snapshot
        dkOdds: frozenBookT ? frozenBookToOddsT(frozenBookT) : (dkMapT[f.fixtureId] ?? null),
        // [FREEZE] Use frozen model projection when is_frozen=1, otherwise fall back to book_id=0 snapshot
        modelOdds: proj ? projToModelOddsT(proj) : (modelMapT[f.fixtureId] ?? null),
        projection: proj,
        modelVersion: proj?.modelVersion ?? null,
        isFrozen: proj?.isFrozen ?? false,
        frozenAt: proj?.frozenAt ?? null,
      };
    });
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
