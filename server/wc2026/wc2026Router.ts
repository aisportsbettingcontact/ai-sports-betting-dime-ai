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
import { eq, and, desc, sql } from "drizzle-orm";

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

      // Fetch latest DraftKings (book_id=68) 1X2 + TOTAL odds for this date's fixtures
      const oddsRows = await db
        .select()
        .from(wc2026OddsSnapshots)
        .where(eq(wc2026OddsSnapshots.bookId, 68))
        .orderBy(desc(wc2026OddsSnapshots.snapshotTs));

      // Build odds map: fixtureId → { home?, away?, draw?, overLine?, overOdds?, underOdds? }
      const oddsMap: Record<string, { home?: number; away?: number; draw?: number; overLine?: number; overOdds?: number; underOdds?: number }> = {};
      const seen = new Set<string>();
      for (const row of oddsRows as WcOddsRow[]) {
        if (!fixtureIds.includes(row.fixtureId)) continue;
        if (!oddsMap[row.fixtureId]) oddsMap[row.fixtureId] = {};
        const key = `${row.fixtureId}:${row.market}:${row.selection}`;
        if (!seen.has(key)) {
          seen.add(key);
          const o = oddsMap[row.fixtureId] as Record<string, number | undefined>;
          if (row.market === "1X2") {
            o[row.selection] = row.americanOdds;
          } else if (row.market === "TOTAL") {
            if (row.selection === "over") {
              o["overLine"] = row.line ?? undefined;
              o["overOdds"] = row.americanOdds;
            } else if (row.selection === "under") {
              o["underOdds"] = row.americanOdds;
            }
          }
        }
      }

      return fixtures.map((f: WcFixture) => ({
        ...f,
        homeTeam: teamMap[f.homeTeamId] ?? null,
        awayTeam: teamMap[f.awayTeamId] ?? null,
        venue: venueMap[f.venueId] ?? null,
        dkOdds: oddsMap[f.fixtureId] ?? null,
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

  // ─── Today's fixtures with DK 1X2 odds (main page feed) ──────────────────
  todayWithOdds: publicProcedure.query(async () => {
    const db = await getDb();
    const today = new Date().toISOString().split("T")[0];

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

    // Fetch latest DraftKings (book_id=68) 1X2 + TOTAL odds for today's fixtures
    const oddsRows = await db
      .select()
      .from(wc2026OddsSnapshots)
      .where(eq(wc2026OddsSnapshots.bookId, 68))
      .orderBy(desc(wc2026OddsSnapshots.snapshotTs));

    // Build odds map: fixtureId → { home?, away?, draw?, overLine?, overOdds?, underOdds? }
    const oddsMap: Record<string, { home?: number; away?: number; draw?: number; overLine?: number; overOdds?: number; underOdds?: number }> = {};
    const seen = new Set<string>();
    for (const row of oddsRows as WcOddsRow[]) {
      if (!fixtureIds.includes(row.fixtureId)) continue;
      if (!oddsMap[row.fixtureId]) oddsMap[row.fixtureId] = {};
      const key = `${row.fixtureId}:${row.market}:${row.selection}`;
      if (!seen.has(key)) {
        seen.add(key);
        const o = oddsMap[row.fixtureId] as Record<string, number | undefined>;
        if (row.market === "1X2") {
          o[row.selection] = row.americanOdds;
        } else if (row.market === "TOTAL") {
          if (row.selection === "over") {
            o["overLine"] = row.line ?? undefined;
            o["overOdds"] = row.americanOdds;
          } else if (row.selection === "under") {
            o["underOdds"] = row.americanOdds;
          }
        }
      }
    }

    return fixtures.map((f: WcFixture) => ({
      ...f,
      homeTeam: teamMap[f.homeTeamId] ?? null,
      awayTeam: teamMap[f.awayTeamId] ?? null,
      venue: venueMap[f.venueId] ?? null,
      dkOdds: oddsMap[f.fixtureId] ?? null,
    }));
  }),
});
