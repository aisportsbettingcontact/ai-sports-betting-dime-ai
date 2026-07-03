/**
 * wc2026Router.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * tRPC procedures for WC2026 data access.
 *
 * Procedures:
 *   wc2026.allGroups        → all 48 teams grouped by group letter
 *   wc2026.matchesByDate   → matches for a given date with team + venue info
 *   wc2026.matchesByGroup  → all matches for a given group letter
 *   wc2026.latestOdds       → most recent odds snapshot per match × book × market
 *   wc2026.closingOdds      → is_closing=true snapshots per match
 *   wc2026.latestLineups    → most recent lineup rows per match
 *   wc2026.todayWithOdds    → today's matches with DraftKings 1X2 odds
 */

import { z } from "zod";
import { router, publicProcedure } from "../_core/trpc";
import { ownerProcedure } from "../routers/appUsers";
import { scrapeEspnMatch, scrapeEspnScoreboard, extractGameId } from "./espnMatchScraper";
import { scrapeEspnMatchPage } from "./espnPageScraper";
import { scrapeAndIngest } from "./espnDbIngester";
import { getDb } from "../db";
import {
  wc2026Fixtures,
  wc2026Teams,
  wc2026Venues,
  wc2026OddsSnapshots,
  wc2026Lineups,
  wc2026ModelProjections,
} from "../../drizzle/wc2026.schema";
import { eq, and, asc, desc, sql, inArray } from "drizzle-orm";
import { wc2026MatchOdds, wc2026EspnMatches, type Wc2026MatchOddsRow } from "../../drizzle/schema";

type WcTeam = typeof wc2026Teams.$inferSelect;
type WcVenue = typeof wc2026Venues.$inferSelect;
type WcMatch = typeof wc2026Fixtures.$inferSelect;
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

  // ─── Matches by date ─────────────────────────────────────────────────────
  matchesByDate: publicProcedure
    .input(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .query(async ({ input }) => {
      const db = await getDb();
      console.log(`[wc2026.matchesByDate] INPUT date='${input.date}'`);
      const matches = await db
        .select()
        .from(wc2026Fixtures)
        .where(eq(wc2026Fixtures.matchDate, sql`${input.date}`))
        .orderBy(
          sql`CASE WHEN ${wc2026Fixtures.displayOrder} IS NOT NULL THEN 0 ELSE 1 END`,
          asc(wc2026Fixtures.displayOrder),
          asc(wc2026Fixtures.kickoffUtc),
          asc(wc2026Fixtures.matchId)
        );

      console.log(`[wc2026.matchesByDate] RESULT date='${input.date}' matches=${matches.length} ids=[${matches.map((f: WcMatch) => f.matchId).join(',')}]`);
      if (matches.length === 0) {
        console.log(`[wc2026.matchesByDate] EMPTY — no matches found for date='${input.date}'. Checking raw matchDate values...`);
        // Diagnostic: dump first 5 rows to see what match_date looks like
        const sample = await db.select({ matchId: wc2026Fixtures.matchId, matchDate: wc2026Fixtures.matchDate }).from(wc2026Fixtures).limit(5);
        console.log(`[wc2026.matchesByDate] SAMPLE rows:`, JSON.stringify(sample));
        return [];
      }

      const [teams, venues] = await Promise.all([
        db.select().from(wc2026Teams),
        db.select().from(wc2026Venues),
      ]);

      const teamMap = Object.fromEntries(teams.map((t: WcTeam) => [t.teamId, t]));
      const venueMap = Object.fromEntries(venues.map((v: WcVenue) => [v.venueId, v]));
      const matchIds = matches.map((f: WcMatch) => f.matchId);

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
          if (!ids.includes(row.matchId)) continue;
          if (!map[row.matchId]) map[row.matchId] = {};
          const key = `${row.matchId}:${row.market}:${row.selection}`;
          if (!seen.has(key)) {
            seen.add(key);
            const o = map[row.matchId] as Record<string, number | undefined>;
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

      // [FIX 2026-06-24] PERFORMANCE: Filter odds by match_id IN (...) instead of full table scan.
      // Pre-fix: fetched ALL odds rows (3,724+) then filtered in-memory → O(N) per request.
      // Post-fix: fetches only rows for the 4-8 matches on this date → O(1) per request.
      // This eliminates the primary server-side latency cause for the blank WC feed on date change.
      // [v8.0 2026-07-02] Book odds now sourced from wc2026MatchOdds (replaces wc2026FrozenBookOdds).
      // wc2026FrozenBookOdds had mismatched column names vs DB schema causing 500 errors.
      // wc2026MatchOdds is the authoritative source for all book + model odds.
      const [dkOddsRows, modelOddsRows, projRows, matchOddsRows] = await Promise.all([
        db.select().from(wc2026OddsSnapshots)
          .where(and(eq(wc2026OddsSnapshots.bookId, 68), inArray(wc2026OddsSnapshots.matchId, matchIds)))
          .orderBy(desc(wc2026OddsSnapshots.snapshotTs)),
        db.select().from(wc2026OddsSnapshots)
          .where(and(eq(wc2026OddsSnapshots.bookId, 0), inArray(wc2026OddsSnapshots.matchId, matchIds)))
          .orderBy(desc(wc2026OddsSnapshots.snapshotTs)),
        db.select().from(wc2026ModelProjections)
          .where(inArray(wc2026ModelProjections.matchId, matchIds)),
        db.select().from(wc2026MatchOdds)
          .where(inArray(wc2026MatchOdds.matchId, matchIds)),
      ]);

      const dkMap = buildOddsMap(dkOddsRows as WcOddsRow[], matchIds);
      const modelMap = buildOddsMap(modelOddsRows as WcOddsRow[], matchIds);
      const projMap = Object.fromEntries(
        (projRows as (typeof wc2026ModelProjections.$inferSelect)[]).map((p) => [p.matchId, p])
      );
      // [v8.0 2026-07-02] wc2026MatchOdds book odds map — keyed by match_id.
      // Field mapping: wc2026MatchOdds Drizzle camelCase → OddsShape keys.
      type MatchOddsRow = typeof wc2026MatchOdds.$inferSelect;
      const matchOddsMap = Object.fromEntries(
        (matchOddsRows as MatchOddsRow[]).map((r) => [r.matchId, r])
      );
      const matchOddsToBookOdds = (r: MatchOddsRow): Record<string, number | undefined> => ({
        home:           r.bookHomeMl ?? undefined,
        draw:           r.bookDraw ?? undefined,
        away:           r.bookAwayMl ?? undefined,
        homeSpreadLine: r.bookPrimarySpread ?? undefined,
        homeSpreadOdds: r.bookHomePrimarySpreadOdds ?? undefined,
        awaySpreadLine: r.bookPrimarySpread != null ? -r.bookPrimarySpread : undefined,
        awaySpreadOdds: r.bookAwayPrimarySpreadOdds ?? undefined,
        overLine:       r.bookTotal ?? undefined,
        overOdds:       r.bookOverOdds ?? undefined,
        underOdds:      r.bookUnderOdds ?? undefined,
        bttsYes:        r.bookBttsYes ?? undefined,
        bttsNo:         r.bookBttsNo ?? undefined,
        homeDrawOdds:   r.bookHomeWd ?? undefined,
        awayDrawOdds:   r.bookAwayWd ?? undefined,
        noDraw:         r.bookNoDraw ?? undefined,
        toAdvanceHome:  r.bookHomeToAdvance ?? undefined,
        toAdvanceAway:  r.bookAwayToAdvance ?? undefined,
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
        toAdvanceHome: p.toAdvanceHomeOdds ?? undefined,
        toAdvanceAway: p.toAdvanceAwayOdds ?? undefined,
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
      return matches.map((f: WcMatch) => {
        const proj = projMap[f.matchId] ?? null;
        return {
          ...f,
          homeTeam: teamMap[f.homeTeamId] ?? null,
          awayTeam: teamMap[f.awayTeamId] ?? null,
          venue: venueMap[f.venueId] ?? null,
          // [FIX 2026-06-30] advancingTeamId: team_id of the team that advanced past this KO match.
          // Populated by seedAdvancingTeams.ts after each completed knockout match.
          // Null for group stage matches and unplayed knockout matches.
          // [SCHEMA v2 2026-06-30] Now a proper Drizzle column — no (f as any) cast needed.
          advancingTeamId: f.advancingTeamId ?? null,
          // [LIVE 2026-06-30] matchMinute: live match minute string ("18", "45+2", "ETHT") or null.
          // Set by fifaLiveScraper.ts Heartbeat handler. Null when not live.
          // [SCHEMA v2 2026-06-30] Now a proper Drizzle column — no (f as any) cast needed.
          matchMinute: f.matchMinute ?? null,
          // [LIVE 2026-06-30] fifaMatchId: FIFA official match ID for live scraping correlation.
          // [SCHEMA v2 2026-06-30] Now a proper Drizzle column — no (f as any) cast needed.
          fifaMatchId: f.fifaMatchId ?? null,
          // [v8.0] Use wc2026MatchOdds book odds when available, otherwise fall back to live DK snapshot
          dkOdds: matchOddsMap[f.matchId] ? matchOddsToBookOdds(matchOddsMap[f.matchId]!) : (dkMap[f.matchId] ?? null),
          // [v8.0] Use wc2026_model_projections when available, otherwise fall back to book_id=0 snapshot
          modelOdds: proj ? projToModelOdds(proj) : (modelMap[f.matchId] ?? null),
          projection: proj,
          modelVersion: proj?.modelVersion ?? null,
          isFrozen: proj?.isFrozen ?? false,
          frozenAt: proj?.frozenAt ?? null,
        };
      });
    }),

  // ─── Matches by group ────────────────────────────────────────────────────
  matchesByGroup: publicProcedure
    .input(z.object({ group: z.string().length(1) }))
    .query(async ({ input }) => {
      const db = await getDb();
      const matches = await db
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

      return matches.map((f: WcMatch) => ({
        ...f,
        homeTeam: teamMap[f.homeTeamId] ?? null,
        awayTeam: teamMap[f.awayTeamId] ?? null,
        venue: venueMap[f.venueId] ?? null,
      }));
    }),

  // ─── Latest odds per match ──────────────────────────────────────────────
  latestOdds: publicProcedure
    .input(z.object({ matchId: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      const latest = await db
        .select({ maxTs: sql<Date>`MAX(snapshot_ts)` })
        .from(wc2026OddsSnapshots)
        .where(eq(wc2026OddsSnapshots.matchId, input.matchId));

      const maxTs = latest[0]?.maxTs;
      if (!maxTs) return [];

      return db
        .select()
        .from(wc2026OddsSnapshots)
        .where(
          and(
            eq(wc2026OddsSnapshots.matchId, input.matchId),
            eq(wc2026OddsSnapshots.snapshotTs, maxTs)
          )
        )
        .orderBy(wc2026OddsSnapshots.bookId, wc2026OddsSnapshots.market);
    }),

  // ─── Closing odds per match ─────────────────────────────────────────────
  closingOdds: publicProcedure
    .input(z.object({ matchId: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      return db
        .select()
        .from(wc2026OddsSnapshots)
        .where(
          and(
            eq(wc2026OddsSnapshots.matchId, input.matchId),
            eq(wc2026OddsSnapshots.isClosing, true)
          )
        )
        .orderBy(desc(wc2026OddsSnapshots.snapshotTs), wc2026OddsSnapshots.bookId);
    }),


  // ─── Latest lineups per match ───────────────────────────────────────────
  latestLineups: publicProcedure
    .input(z.object({ matchId: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      const latest = await db
        .select({ maxTs: sql<Date>`MAX(scraped_at)` })
        .from(wc2026Lineups)
        .where(eq(wc2026Lineups.matchId, input.matchId));

      const maxTs = latest[0]?.maxTs;
      if (!maxTs) return [];

      return db
        .select()
        .from(wc2026Lineups)
        .where(
          and(
            eq(wc2026Lineups.matchId, input.matchId),
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
      // Get all matches for this date
      const matches = await db
        .select()
        .from(wc2026Fixtures)
        .where(eq(wc2026Fixtures.matchDate, sql`${input.date}`))
        .orderBy(
          sql`CASE WHEN ${wc2026Fixtures.displayOrder} IS NOT NULL THEN 0 ELSE 1 END`,
          asc(wc2026Fixtures.displayOrder),
          asc(wc2026Fixtures.kickoffUtc),
          asc(wc2026Fixtures.matchId)
        );

      if (matches.length === 0) return [];

      const [teams, venues] = await Promise.all([
        db.select().from(wc2026Teams),
        db.select().from(wc2026Venues),
      ]);

      const teamMap = Object.fromEntries(teams.map((t: WcTeam) => [t.teamId, t]));
      const venueMap = Object.fromEntries(venues.map((v: WcVenue) => [v.venueId, v]));
      const matchIds = matches.map((f: WcMatch) => f.matchId);

      // Get all lineups for these matches in one query
      const allLineups = matchIds.length > 0
        ? await db
            .select()
            .from(wc2026Lineups)
            .where(inArray(wc2026Lineups.matchId, matchIds))
            .orderBy(wc2026Lineups.matchId, wc2026Lineups.teamId, wc2026Lineups.isStarter, wc2026Lineups.position)
        : [];

      // Group lineups by matchId
      const lineupMap: Record<string, typeof allLineups> = {};
      for (const row of allLineups) {
        if (!lineupMap[row.matchId]) lineupMap[row.matchId] = [];
        lineupMap[row.matchId].push(row);
      }

      return matches.map((f: WcMatch) => ({
        ...f,
        homeTeam: teamMap[f.homeTeamId] ?? null,
        awayTeam: teamMap[f.awayTeamId] ?? null,
        venue: venueMap[f.venueId] ?? null,
        lineups: lineupMap[f.matchId] ?? [],
      }));
    }),

  // ─── Today's matches with DK 1X2 odds (main page feed) ──────────────────
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

    const matches = await db
      .select()
      .from(wc2026Fixtures)
      .where(eq(wc2026Fixtures.matchDate, sql`${today}`))
      .orderBy(
          sql`CASE WHEN ${wc2026Fixtures.displayOrder} IS NOT NULL THEN 0 ELSE 1 END`,
          asc(wc2026Fixtures.displayOrder),
          asc(wc2026Fixtures.kickoffUtc),
          asc(wc2026Fixtures.matchId)
        );

    if (matches.length === 0) return [];

    const [teams, venues] = await Promise.all([
      db.select().from(wc2026Teams),
      db.select().from(wc2026Venues),
    ]);

    const teamMap = Object.fromEntries(teams.map((t: WcTeam) => [t.teamId, t]));
    const venueMap = Object.fromEntries(venues.map((v: WcVenue) => [v.venueId, v]));
    const matchIds = matches.map((f: WcMatch) => f.matchId);

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
        if (!ids.includes(row.matchId)) continue;
        if (!map[row.matchId]) map[row.matchId] = {};
        const key = `${row.matchId}:${row.market}:${row.selection}`;
        if (!seen.has(key)) {
          seen.add(key);
          const o = map[row.matchId] as Record<string, number | undefined>;
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

    // [FIX 2026-06-24] PERFORMANCE: Same match_id IN filter as matchesByDate.
    // [v8.0 2026-07-02] Book odds now sourced from wc2026MatchOdds (replaces wc2026FrozenBookOdds).
    const [dkOddsRowsT, modelOddsRowsT, projRowsT, matchOddsRowsT] = await Promise.all([
      db.select().from(wc2026OddsSnapshots)
        .where(and(eq(wc2026OddsSnapshots.bookId, 68), inArray(wc2026OddsSnapshots.matchId, matchIds)))
        .orderBy(desc(wc2026OddsSnapshots.snapshotTs)),
      db.select().from(wc2026OddsSnapshots)
        .where(and(eq(wc2026OddsSnapshots.bookId, 0), inArray(wc2026OddsSnapshots.matchId, matchIds)))
        .orderBy(desc(wc2026OddsSnapshots.snapshotTs)),
      db.select().from(wc2026ModelProjections)
        .where(inArray(wc2026ModelProjections.matchId, matchIds)),
      db.select().from(wc2026MatchOdds)
        .where(inArray(wc2026MatchOdds.matchId, matchIds)),
    ]);

    const dkMapT = buildOddsMapT(dkOddsRowsT as WcOddsRow[], matchIds);
    const modelMapT = buildOddsMapT(modelOddsRowsT as WcOddsRow[], matchIds);
    const projMapT = Object.fromEntries(
      (projRowsT as (typeof wc2026ModelProjections.$inferSelect)[]).map((p) => [p.matchId, p])
    );
    // [v8.0 2026-07-02] wc2026MatchOdds book odds map for todayWithOdds procedure
    type MatchOddsRowT = typeof wc2026MatchOdds.$inferSelect;
    const matchOddsMapT = Object.fromEntries(
      (matchOddsRowsT as MatchOddsRowT[]).map((r) => [r.matchId, r])
    );
    const matchOddsToBookOddsT = (r: MatchOddsRowT): Record<string, number | undefined> => ({
      home:           r.bookHomeMl ?? undefined,
      draw:           r.bookDraw ?? undefined,
      away:           r.bookAwayMl ?? undefined,
      homeSpreadLine: r.bookPrimarySpread ?? undefined,
      homeSpreadOdds: r.bookHomePrimarySpreadOdds ?? undefined,
      awaySpreadLine: r.bookPrimarySpread != null ? -r.bookPrimarySpread : undefined,
      awaySpreadOdds: r.bookAwayPrimarySpreadOdds ?? undefined,
      overLine:       r.bookTotal ?? undefined,
      overOdds:       r.bookOverOdds ?? undefined,
      underOdds:      r.bookUnderOdds ?? undefined,
      bttsYes:        r.bookBttsYes ?? undefined,
      bttsNo:         r.bookBttsNo ?? undefined,
      homeDrawOdds:   r.bookHomeWd ?? undefined,
      awayDrawOdds:   r.bookAwayWd ?? undefined,
      noDraw:         r.bookNoDraw ?? undefined,
      toAdvanceHome:  r.bookHomeToAdvance ?? undefined,
      toAdvanceAway:  r.bookAwayToAdvance ?? undefined,
    });
        // [FIX v7.1-NODRAW] Same projection-first modelOdds logic as matchesByDate
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
        // [FIX v7.1-NODRAW] noDrawAwayOdds = combined home+away win prob → American odds
        noDraw: p.noDrawAwayOdds ?? p.noDrawHomeOdds ?? undefined,
        toAdvanceHome: p.toAdvanceHomeOdds ?? undefined,
        toAdvanceAway: p.toAdvanceAwayOdds ?? undefined,
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
    return matches.map((f: WcMatch) => {
      const proj = projMapT[f.matchId] ?? null;
        return {
        ...f,
        homeTeam: teamMap[f.homeTeamId] ?? null,
        awayTeam: teamMap[f.awayTeamId] ?? null,
        venue: venueMap[f.venueId] ?? null,
        // [v8.0] Use wc2026MatchOdds book odds when available, otherwise fall back to live DK snapshot
        dkOdds: matchOddsMapT[f.matchId] ? matchOddsToBookOddsT(matchOddsMapT[f.matchId]!) : (dkMapT[f.matchId] ?? null),
        // [v8.0] Use wc2026_model_projections when available, otherwise fall back to book_id=0 snapshot
        modelOdds: proj ? projToModelOddsT(proj) : (modelMapT[f.matchId] ?? null),
        projection: proj,
        modelVersion: proj?.modelVersion ?? null,
        isFrozen: proj?.isFrozen ?? false,
        frozenAt: proj?.frozenAt ?? null,
      };
    });
  }),


  // ─── ESPN Match Scraper ───────────────────────────────────────────────────
  /**
   * Scrape full match data from ESPN for any soccer gameId.
   *
   * Input:
   *   urlOrGameId         — ESPN URL or bare gameId ("760487")
   *   includePlayerStats  — fetch per-player stat splits (default: true)
   *   includeCommentary   — include full play-by-play commentary (default: true)
   *
   * Returns: EspnMatchData — full structured match object with dual-channel logs
   */
  espnMatch: publicProcedure
    .input(
      z.object({
        urlOrGameId: z.string().min(1),
        includePlayerStats: z.boolean().optional().default(true),
        includeCommentary: z.boolean().optional().default(true),
      })
    )
    .query(async ({ input }) => {
      const { urlOrGameId, includePlayerStats, includeCommentary } = input;

      // [INPUT] Validate gameId is extractable before hitting ESPN
      const gameId = extractGameId(urlOrGameId);
      console.log(`[ESPN] espnMatch called | gameId=${gameId} | includePlayerStats=${includePlayerStats} | includeCommentary=${includeCommentary}`);

      const t0 = Date.now();
      try {
        const data = await scrapeEspnMatch(urlOrGameId, {
          includePlayerStats,
          includeCommentary,
        });
        const elapsed = Date.now() - t0;
        console.log(`[ESPN] espnMatch complete | gameId=${gameId} | elapsed=${elapsed}ms | apiCalls=${data.apiCallCount} | errors=${data.errors.length} | logFile=${data.logFile}`);
        return { success: true as const, data, error: null };
      } catch (err) {
        const elapsed = Date.now() - t0;
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[ESPN] espnMatch FAILED | gameId=${gameId} | elapsed=${elapsed}ms | error=${errMsg}`);
        return { success: false as const, data: null, error: errMsg };
      }
    }),

  /**
   * Scrape ESPN soccer scoreboard for a given date.
   *
   * Input:
   *   date — YYYYMMDD or YYYY-MM-DD (e.g. "20260629" or "2026-06-29")
   *
   * Returns: array of EspnScoreboardEvent
   */
  espnScoreboard: publicProcedure
    .input(
      z.object({
        date: z.string().min(6),
      })
    )
    .query(async ({ input }) => {
      const dateParam = input.date.replace(/-/g, "");
      console.log(`[ESPN] espnScoreboard called | date=${dateParam}`);

      const t0 = Date.now();
      try {
        const events = await scrapeEspnScoreboard(dateParam);
        const elapsed = Date.now() - t0;
        console.log(`[ESPN] espnScoreboard complete | date=${dateParam} | events=${events.length} | elapsed=${elapsed}ms`);
        return { success: true as const, events, error: null };
      } catch (err) {
        const elapsed = Date.now() - t0;
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[ESPN] espnScoreboard FAILED | date=${dateParam} | error=${errMsg}`);
        return { success: false as const, events: [], error: errMsg };
      }
    }),

  /**
   * espnMatchPage — 100x direct Playwright page scraper (ZERO API fallback)
   *
   * Loads 3 ESPN pages directly and extracts all 13 tables:
   *   1. Game Strip        6. Team Stats       11. Passes
   *   2. Boxscore          7. Expected Goals   12. Duels
   *   3. Goalkeeping       8. Shot Map         13. Fouls
   *   4. Formations        9. Shots            14. Attack
   *   5. Lineups          10. Full Team Stats
   *
   * Input:
   *   urlOrGameId — ESPN game URL or numeric gameId (e.g. "760487")
   *   saveHtml    — save raw HTML to .manus-logs/ for debugging (default false)
   */
  espnMatchPage: publicProcedure
    .input(
      z.object({
        urlOrGameId: z.string().min(1),
        saveHtml: z.boolean().optional().default(false),
      })
    )
    .query(async ({ input }) => {
      const { urlOrGameId, saveHtml } = input;
      const gameIdMatch = urlOrGameId.match(/gameId[=/](\d+)/);
      const gameId = gameIdMatch ? gameIdMatch[1] : urlOrGameId.replace(/\D/g, "");
      console.log(`[ESPN_PAGE] espnMatchPage called | gameId=${gameId} | saveHtml=${saveHtml}`);
      const t0 = Date.now();
      try {
        const data = await scrapeEspnMatchPage(urlOrGameId, {
          logDir: ".manus-logs",
          saveHtml,
        });
        const elapsed = Date.now() - t0;
        const homePlayers = data.boxscore.homeTeam.outfieldPlayers.length;
        const awayPlayers = data.boxscore.awayTeam.outfieldPlayers.length;
        console.log(
          `[ESPN_PAGE] espnMatchPage complete | gameId=${gameId} | elapsed=${elapsed}ms | ` +
          `players=${homePlayers + awayPlayers} | shots=${data.shotMap.shots.length} | ` +
          `teamStats=${data.teamStats.stats.length} | ` +
          `homeFormation=${data.lineups.home.formation} | awayFormation=${data.lineups.away.formation}`
        );
        return { success: true as const, data, error: null };
      } catch (err) {
        const elapsed = Date.now() - t0;
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[ESPN_PAGE] espnMatchPage FAILED | gameId=${gameId} | elapsed=${elapsed}ms | error=${errMsg}`);
        return { success: false as const, data: null, error: errMsg };
      }
    }),

  /**
   * espnIngest — scrape ESPN match page + ingest all 9 wc2026_espn_* tables in one call.
   * Returns per-phase PASS/FAIL with row counts for all 9 tables.
   */
  espnIngest: publicProcedure
    .input(
      z.object({
        urlOrGameId: z.string().min(1),
        dryRun: z.boolean().optional().default(false),
      })
    )
    .mutation(async ({ input }) => {
      const { urlOrGameId, dryRun } = input;
      const gameIdMatch = urlOrGameId.match(/gameId[=/](\d+)/);
      const gameId = gameIdMatch ? gameIdMatch[1] : urlOrGameId.replace(/\D/g, "");
      console.log(`[ESPN_INGEST] espnIngest called | gameId=${gameId} | dryRun=${dryRun}`);
      const t0 = Date.now();
      try {
        const result = await scrapeAndIngest(gameId, { dryRun });
        const elapsed = Date.now() - t0;
        const passCount = result.phases.filter(p => p.pass).length;
        console.log(
          `[ESPN_INGEST] complete | gameId=${gameId} | elapsed=${elapsed}ms | ` +
          `phases=${passCount}/9 PASS | rows=${result.totalRowsWritten} | success=${result.success}`
        );
        return { success: true as const, result, error: null };
      } catch (err) {
        const elapsed = Date.now() - t0;
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[ESPN_INGEST] FAILED | gameId=${gameId} | elapsed=${elapsed}ms | error=${errMsg}`);
        return { success: false as const, result: null, error: errMsg };
      }
    }),

  // ─── wc2026MatchOdds: listMatchOdds ─────────────────────────────────────────
  // Owner-only. Returns all rows from wc2026MatchOdds for a given round.
  // Queries ONLY the wc2026MatchOdds table — no joins, no other tables.
  listMatchOdds: ownerProcedure
    .input(z.object({
      round: z.enum(["r32", "quarterfinals", "semifinals", "third_place", "finals"]).optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const t0 = Date.now();
      const userId = ctx.appUser.id;
      const username = ctx.appUser.username;
      const round = input?.round ?? "r32";
      console.log(`[WC2026_MATCH_ODDS] listMatchOdds START | userId=${userId} username=${username} round=${round}`);

      const db = await getDb();
      if (!db) {
        console.error(`[WC2026_MATCH_ODDS] listMatchOdds FATAL | DB unavailable | userId=${userId}`);
        throw new Error("[WC2026_MATCH_ODDS] Database connection unavailable");
      }
      console.log(`[WC2026_MATCH_ODDS] listMatchOdds DB_READY | querying wc2026MatchOdds WHERE world_cup_round='${round}'`);

      const rows = await db
        .select()
        .from(wc2026MatchOdds)
        .where(eq(wc2026MatchOdds.worldCupRound, round))
        .orderBy(asc(wc2026MatchOdds.matchId));

      // Enrich with team names from wc2026_espn_matches (join on espn_match_id)
      // This is a secondary query to avoid a complex Drizzle join — wc2026MatchOdds
      // is the source of truth; espn_matches provides display names only.
      const espnMatchIds = rows
        .map((r: Wc2026MatchOddsRow) => r.espnMatchId)
        .filter((id: string | null | undefined): id is string => !!id);
      let teamNameMap: Record<string, { awayTeamName: string; homeTeamName: string; awayTeamAbbrev: string; homeTeamAbbrev: string; awayTeamLogo: string | null; homeTeamLogo: string | null }> = {};
      if (espnMatchIds.length > 0) {
        const espnRows = await db
          .select({
            matchId:       wc2026EspnMatches.matchId,
            awayTeamName:  wc2026EspnMatches.awayTeamName,
            homeTeamName:  wc2026EspnMatches.homeTeamName,
            awayTeamAbbrev: wc2026EspnMatches.awayTeamAbbrev,
            homeTeamAbbrev: wc2026EspnMatches.homeTeamAbbrev,
            awayTeamLogo:  wc2026EspnMatches.awayTeamLogo,
            homeTeamLogo:  wc2026EspnMatches.homeTeamLogo,
          })
          .from(wc2026EspnMatches)
          .where(inArray(wc2026EspnMatches.matchId, espnMatchIds));
        teamNameMap = Object.fromEntries(espnRows.map((r: typeof espnRows[0]) => [r.matchId, r]));
        console.log(`[WC2026_MATCH_ODDS] listMatchOdds ENRICH | espnMatchIds=${espnMatchIds.length} resolved=${espnRows.length}`);
      }

      const elapsed = Date.now() - t0;
      console.log(
        `[WC2026_MATCH_ODDS] listMatchOdds COMPLETE | userId=${userId} round=${round}` +
        ` rows=${rows.length} elapsed=${elapsed}ms`
      );

      // Integrity check: flag any rows missing match_id
      const invalid = rows.filter((r: Wc2026MatchOddsRow) => !r.matchId);
      if (invalid.length > 0) {
        console.error(`[WC2026_MATCH_ODDS] listMatchOdds INTEGRITY_WARN | ${invalid.length} rows missing match_id`);
      }

      // Audit: count rows with all core book_ columns populated
      const fullyPopulated = rows.filter((r: Wc2026MatchOddsRow) =>
        r.bookAwayMl !== null && r.bookHomeMl !== null && r.bookDraw !== null &&
        r.bookPrimarySpread !== null && r.bookTotal !== null &&
        r.bookBttsYes !== null && r.bookBttsNo !== null
      );
      console.log(
        `[WC2026_MATCH_ODDS] listMatchOdds AUDIT | total=${rows.length}` +
        ` fully_populated=${fullyPopulated.length}` +
        ` partial=${rows.length - fullyPopulated.length}` +
        ` invalid_match_id=${invalid.length}`
      );

      // Attach team names to each row
      const enrichedRows = rows.map((r: Wc2026MatchOddsRow) => ({
        ...r,
        awayTeamName:   teamNameMap[r.espnMatchId ?? '']?.awayTeamName   ?? null,
        homeTeamName:   teamNameMap[r.espnMatchId ?? '']?.homeTeamName   ?? null,
        awayTeamAbbrev: teamNameMap[r.espnMatchId ?? '']?.awayTeamAbbrev ?? null,
        homeTeamAbbrev: teamNameMap[r.espnMatchId ?? '']?.homeTeamAbbrev ?? null,
        awayTeamLogo:   teamNameMap[r.espnMatchId ?? '']?.awayTeamLogo   ?? null,
        homeTeamLogo:   teamNameMap[r.espnMatchId ?? '']?.homeTeamLogo   ?? null,
      }));

      return { rows: enrichedRows, meta: { total: rows.length, round, fullyPopulated: fullyPopulated.length, elapsedMs: elapsed } };
    }),

  // ─── wc2026MatchOdds: updateMatchOdds ───────────────────────────────────────
  // Owner-only. Updates model_* columns for a single match in wc2026MatchOdds.
  // Writes ONLY to wc2026MatchOdds — no other tables touched.
  updateMatchOdds: ownerProcedure
    .input(z.object({
      matchId:                   z.string().min(1).max(16),
      // To Advance
      modelAwayToAdvance:          z.number().int().nullable().optional(),
      modelHomeToAdvance:          z.number().int().nullable().optional(),
      // Moneyline
      modelAwayMl:                 z.number().int().nullable().optional(),
      modelHomeMl:                 z.number().int().nullable().optional(),
      // Draw / No Draw
      modelDraw:                   z.number().int().nullable().optional(),
      modelNoDraw:                 z.number().int().nullable().optional(),
      // Double Chance
      modelAwayWd:                 z.number().int().nullable().optional(),
      modelHomeWd:                 z.number().int().nullable().optional(),
      // Spread
      modelPrimarySpread:          z.number().nullable().optional(),
      modelAwayPrimarySpreadOdds:  z.number().int().nullable().optional(),
      modelHomePrimarySpreadOdds:  z.number().int().nullable().optional(),
      // Total
      modelTotal:                  z.number().nullable().optional(),
      modelOverOdds:               z.number().int().nullable().optional(),
      modelUnderOdds:              z.number().int().nullable().optional(),
      // BTTS
      modelBttsYes:                z.number().int().nullable().optional(),
      modelBttsNo:                 z.number().int().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const t0 = Date.now();
      const userId = ctx.appUser.id;
      const username = ctx.appUser.username;
      const { matchId, ...fields } = input;

      const definedKeys = Object.keys(fields).filter(
        k => (fields as Record<string, unknown>)[k] !== undefined
      );
      console.log(
        `[WC2026_MATCH_ODDS] updateMatchOdds START | userId=${userId} username=${username}` +
        ` matchId=${matchId} fields=[${definedKeys.join(",")}]`
      );

      const db = await getDb();
      if (!db) {
        console.error(`[WC2026_MATCH_ODDS] updateMatchOdds FATAL | DB unavailable | userId=${userId} matchId=${matchId}`);
        throw new Error("[WC2026_MATCH_ODDS] Database connection unavailable");
      }

      // Build update payload — only include fields that were explicitly provided
      type UpdatePayload = Partial<{
        modelAwayToAdvance: number | null;
        modelHomeToAdvance: number | null;
        modelAwayMl: number | null;
        modelHomeMl: number | null;
        modelDraw: number | null;
        modelNoDraw: number | null;
        modelAwayWd: number | null;
        modelHomeWd: number | null;
        modelPrimarySpread: number | null;
        modelAwayPrimarySpreadOdds: number | null;
        modelHomePrimarySpreadOdds: number | null;
        modelTotal: number | null;
        modelOverOdds: number | null;
        modelUnderOdds: number | null;
        modelBttsYes: number | null;
        modelBttsNo: number | null;
      }>;
      const payload: UpdatePayload = {};
      if (fields.modelAwayToAdvance          !== undefined) payload.modelAwayToAdvance          = fields.modelAwayToAdvance;
      if (fields.modelHomeToAdvance          !== undefined) payload.modelHomeToAdvance          = fields.modelHomeToAdvance;
      if (fields.modelAwayMl                !== undefined) payload.modelAwayMl                = fields.modelAwayMl;
      if (fields.modelHomeMl                !== undefined) payload.modelHomeMl                = fields.modelHomeMl;
      if (fields.modelDraw                  !== undefined) payload.modelDraw                  = fields.modelDraw;
      if (fields.modelNoDraw                !== undefined) payload.modelNoDraw                = fields.modelNoDraw;
      if (fields.modelAwayWd                !== undefined) payload.modelAwayWd                = fields.modelAwayWd;
      if (fields.modelHomeWd                !== undefined) payload.modelHomeWd                = fields.modelHomeWd;
      if (fields.modelPrimarySpread         !== undefined) payload.modelPrimarySpread         = fields.modelPrimarySpread;
      if (fields.modelAwayPrimarySpreadOdds !== undefined) payload.modelAwayPrimarySpreadOdds = fields.modelAwayPrimarySpreadOdds;
      if (fields.modelHomePrimarySpreadOdds !== undefined) payload.modelHomePrimarySpreadOdds = fields.modelHomePrimarySpreadOdds;
      if (fields.modelTotal                 !== undefined) payload.modelTotal                 = fields.modelTotal;
      if (fields.modelOverOdds              !== undefined) payload.modelOverOdds              = fields.modelOverOdds;
      if (fields.modelUnderOdds             !== undefined) payload.modelUnderOdds             = fields.modelUnderOdds;
      if (fields.modelBttsYes               !== undefined) payload.modelBttsYes               = fields.modelBttsYes;
      if (fields.modelBttsNo                !== undefined) payload.modelBttsNo                = fields.modelBttsNo;

      if (Object.keys(payload).length === 0) {
        console.warn(`[WC2026_MATCH_ODDS] updateMatchOdds NOOP | matchId=${matchId} — no fields to update`);
        return { success: true, matchId, updated: 0, elapsedMs: 0 };
      }

      console.log(
        `[WC2026_MATCH_ODDS] updateMatchOdds EXECUTING | matchId=${matchId}` +
        ` payload=${JSON.stringify(payload)}`
      );

      const result = await db
        .update(wc2026MatchOdds)
        .set(payload)
        .where(eq(wc2026MatchOdds.matchId, matchId));

      const elapsed = Date.now() - t0;
      // result[0] is the OkPacket from mysql2
      const affectedRows = (result as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? -1;
      console.log(
        `[WC2026_MATCH_ODDS] updateMatchOdds COMPLETE | matchId=${matchId}` +
        ` affectedRows=${affectedRows} elapsed=${elapsed}ms userId=${userId}`
      );

      if (affectedRows === 0) {
        console.warn(`[WC2026_MATCH_ODDS] updateMatchOdds WARN | matchId=${matchId} — 0 rows affected (match may not exist)`);
      }

      return { success: true, matchId, updated: affectedRows, elapsedMs: elapsed };
    }),
});
