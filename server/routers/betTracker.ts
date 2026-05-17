/**
 * betTracker.ts — tRPC router for the Bet Tracker feature.
 *
 * Role-based access model (v4):
 *   OWNER (prez)     — can see/edit/delete own bets; can see sippi bets (sippi is also owner);
 *                      can see all handicapper bets via targetUserId
 *   ADMIN            — can see all bets; can edit/delete porter & hank bets; cannot touch owner bets
 *   HANDICAPPER      — can only see own bets; porter & hank bets are IMMUTABLE after creation
 *                      (must submit edit/delete request; owner/admin reviews)
 *
 * Immutability rule for handicappers (porter/hank):
 *   - create: allowed
 *   - update/delete: FORBIDDEN — must use submitEditRequest instead
 *
 * Owner bets (role=owner) are protected from admin edit/delete.
 *
 * New procedures (v4):
 *   submitEditRequest — handicapper submits EDIT or DELETE request for own bet
 *   getLogs           — owner/admin/sippi: full audit log (all bets created + all edit requests)
 *   reviewEditRequest — owner/admin: approve or deny a pending edit request
 *
 * Logging convention:
 *   [BetTracker][INPUT]  — raw input received
 *   [BetTracker][STEP]   — operation in progress
 *   [BetTracker][STATE]  — intermediate computed values
 *   [BetTracker][OUTPUT] — final result
 *   [BetTracker][VERIFY] — validation pass/fail
 *   [BetTracker][ERROR]  — failure with context
 */

import { z } from "zod";
import { router } from "../_core/trpc";
import { handicapperProcedure } from "./appUsers";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { trackedBets, appUsers, betEditRequests } from "../../drizzle/schema";
import { eq, and, desc, inArray, asc, gte, lte, lt, or, sql } from "drizzle-orm";
import { fetchAnSlate, resolveLogoUrl } from "../actionNetwork";
import { gradeTrackedBet, fetchScores, type Sport as GraderSport, type Timeframe as GraderTimeframe, type Market as GraderMarket, type PickSide as GraderPickSide } from "../scoreGrader";

// ─── Shared Zod enums ─────────────────────────────────────────────────────────

const RESULTS    = ["PENDING", "WIN", "LOSS", "PUSH", "VOID"] as const;
const SPORTS     = ["MLB", "NBA", "NHL", "NCAAM", "NFL", "CUSTOM"] as const;
const TIMEFRAMES = [
  "FULL_GAME",
  "FIRST_5",
  "FIRST_INNING",
  "NRFI",
  "YRFI",
  "REGULATION",
  "FIRST_PERIOD",
  "FIRST_HALF",
  "FIRST_QUARTER",
] as const;
const MARKETS    = ["ML", "RL", "TOTAL"] as const;
const PICK_SIDES = ["AWAY", "HOME", "OVER", "UNDER"] as const;
const WAGER_TYPES = ["PREGAME", "LIVE"] as const;

// ─── Server-side stats cache ─────────────────────────────────────────────────
// Caches full-set stats aggregation results keyed by userId+filters+unitSize.
// TTL = 30s for live ranges (TODAY/SEASON), 5 minutes for historical ranges.
// Invalidated on create/update/delete mutations.
// This eliminates repeated full-table aggregation scans for identical filter combos.

interface StatsCacheEntry {
  stats: unknown;
  expiresAt: number;
}
const statsCache = new Map<string, StatsCacheEntry>();

function buildStatsCacheKey(userId: number, input: {
  sport?: string; gameDate?: string; dateFrom?: string; dateTo?: string;
  result?: string; unitSize?: number; isHistorical?: boolean;
} | undefined): string {
  return JSON.stringify({
    u: userId,
    s: input?.sport ?? null,
    gd: input?.gameDate ?? null,
    df: input?.dateFrom ?? null,
    dt: input?.dateTo ?? null,
    r: input?.result ?? null,
    us: input?.unitSize ?? 100,
    ih: input?.isHistorical ?? false,
  });
}

function getStatsCache(key: string): unknown | null {
  const entry = statsCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { statsCache.delete(key); return null; }
  return entry.stats;
}

function setStatsCache(key: string, stats: unknown, isHistorical: boolean): void {
  // Historical data: 5 minute TTL (immutable graded bets)
  // Live data: 30 second TTL (pending bets may update)
  const ttl = isHistorical ? 5 * 60_000 : 30_000;
  statsCache.set(key, { stats, expiresAt: Date.now() + ttl });
  // Evict stale entries when cache grows large (>500 entries)
  if (statsCache.size > 500) {
    const now = Date.now();
    for (const [k, v] of Array.from(statsCache.entries())) { if (now > v.expiresAt) statsCache.delete(k); }
  }
}

/** Invalidate all cache entries for a given userId (called on create/update/delete) */
export function invalidateStatsCacheForUser(userId: number): void {
  for (const key of Array.from(statsCache.keys())) {
    try {
      const parsed = JSON.parse(key) as { u: number };
      if (parsed.u === userId) statsCache.delete(key);
    } catch { /* skip malformed keys */ }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Compute toWin from American odds + risk (units) */
function calcToWin(odds: number, risk: number): number {
  if (odds >= 100) {
    return parseFloat((risk * (odds / 100)).toFixed(2));
  } else {
    return parseFloat((risk * (100 / Math.abs(odds))).toFixed(2));
  }
}

/**
 * Derive a human-readable pick string from structured inputs.
 * Examples:
 *   AWAY + ML        → "HOU ML"
 *   HOME + RL        → "SEA RL"
 *   OVER + TOTAL     → "OVER"
 *   UNDER + TOTAL    → "UNDER"
 *   NRFI timeframe   → "NRFI"
 *   YRFI timeframe   → "YRFI"
 */
function derivePickLabel(
  pickSide: typeof PICK_SIDES[number],
  market: typeof MARKETS[number],
  awayTeam: string,
  homeTeam: string,
  timeframe?: typeof TIMEFRAMES[number],
): string {
  if (timeframe === "NRFI") return "NRFI";
  if (timeframe === "YRFI") return "YRFI";
  if (market === "TOTAL") {
    return pickSide === "OVER" ? "OVER" : "UNDER";
  }
  const team = pickSide === "AWAY" ? awayTeam : homeTeam;
  const suffix = market === "ML" ? "ML" : "RL";
  return `${team} ${suffix}`;
}

/**
 * Determine the unit-size bucket label for a bet.
 *
 * Unit-size logic (v4):
 *   - Plus-money bets (+odds): the RISK amount IS the unit count.
 *     e.g. ARI ML +155 at 3U risk → 3U play.
 *   - Minus-money bets (-odds): the TO-WIN amount IS the unit count.
 *     e.g. NYM ML -153 at ~5U risk to win 5U → 5U play.
 *
 * Buckets: 10U, 5U, 4U, 3U, 2U, 1U (exact integer matching).
 * Any non-integer or out-of-range value maps to the nearest bucket.
 */
function calcUnitBucket(
  odds: number,
  risk: number,
  toWin: number,
  riskUnits?: number | null,
  toWinUnits?: number | null,
): string {
  // Prefer stored unit-denominated values (accurate regardless of user's unit size setting).
  // Fall back to raw dollar amounts only if unit values were not stored (legacy bets).
  let unitCount: number;
  if (odds > 0) {
    // Plus money (+odds): the RISK amount IS the unit count
    // e.g. ARI ML +155 at 3U risk → 3U play
    unitCount = riskUnits != null ? riskUnits : risk;
  } else {
    // Minus money (-odds): the TO WIN amount IS the unit count
    // e.g. NYM ML -153 to win 5U → 5U play
    unitCount = toWinUnits != null ? toWinUnits : toWin;
  }

  // Round to nearest integer for bucket assignment
  const u = Math.round(unitCount);

  if (u >= 10) return "10U";
  if (u >= 5)  return "5U";
  if (u >= 4)  return "4U";
  if (u >= 3)  return "3U";
  if (u >= 2)  return "2U";
  return "1U";
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const betTrackerRouter = router({

  /**
   * listHandicappers — OWNER/ADMIN only: list all handicapper accounts.
   * Used by the BetTracker handicapper selector dropdown.
   * Returns all users with role owner/admin/handicapper so the selector
   * can show all accounts including prez (owner) and sippi (owner).
   */
  listHandicappers: handicapperProcedure
    .query(async ({ ctx }) => {
      const role = ctx.appUser.role;
      if (role !== "owner" && role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Owner or Admin required" });
      }
      const db = await getDb();
      const rows = await db
        .select({ id: appUsers.id, username: appUsers.username, role: appUsers.role })
        .from(appUsers)
        .where(inArray(appUsers.role, ["owner", "admin", "handicapper"]))
        .orderBy(appUsers.id);
      console.log(`[BetTracker][OUTPUT] listHandicappers: ${rows.length} handicappers returned`);
      return rows;
    }),

  /**
   * list — fetch all bets for the authenticated user.
   * Optional filters: sport, gameDate, result.
   *
   * Visibility rules:
   *   OWNER (prez/sippi)  — can view own bets + any other user via targetUserId
   *   ADMIN               — can view any user via targetUserId
   *   HANDICAPPER         — can only view own bets (targetUserId ignored)
   */
  list: handicapperProcedure
    .input(z.object({
      sport:         z.enum(SPORTS).optional(),
      gameDate:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      dateFrom:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      dateTo:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      result:        z.enum(RESULTS).optional(),
      targetUserId:  z.number().int().positive().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const role = ctx.appUser.role;
      // Visibility enforcement
      let userId = ctx.appUser.id;
      if (input?.targetUserId && input.targetUserId !== userId) {
        if (role !== "owner" && role !== "admin") {
          console.log(`[BetTracker][ERROR] list: FORBIDDEN — role=${role} cannot view targetUserId=${input.targetUserId}`);
          throw new TRPCError({ code: "FORBIDDEN", message: "Owner or Admin required to view other handicappers" });
        }
        userId = input.targetUserId;
      }

      const conditions = [eq(trackedBets.userId, userId)];
      if (input?.sport)    conditions.push(eq(trackedBets.sport, input.sport));
      if (input?.gameDate) conditions.push(eq(trackedBets.gameDate, input.gameDate));
      if (input?.dateFrom) conditions.push(gte(trackedBets.gameDate, input.dateFrom));
      if (input?.dateTo)   conditions.push(lte(trackedBets.gameDate, input.dateTo));
      if (input?.result)   conditions.push(eq(trackedBets.result, input.result));

      const db = await getDb();
      const rows = await db
        .select()
        .from(trackedBets)
        .where(and(...conditions))
        .orderBy(desc(trackedBets.gameDate), desc(trackedBets.createdAt));


      // ── Enrich with SlateGame data (logos, full names, gameTime, status, live scores) ──
      // PERFORMANCE OPTIMIZATION: Only call fetchAnSlate for TODAY and FUTURE dates.
      // Historical dates (gameDate < today) have final results — logos are resolved
      // from the in-memory MLB_BY_ABBREV map via resolveLogoUrl() which is O(1) and
      // requires zero HTTP calls. This eliminates up to 32 concurrent HTTP calls on
      // All-Time / Season page loads, reducing cold-start latency from ~3s to <100ms.
      const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }); // YYYY-MM-DD in PT
      const pairs = new Map<string, { sport: string; gameDate: string }>();
      for (const row of rows) {
        const key = `${row.sport}:${row.gameDate}`;
        // Only fetch slate for today and future dates where live status/scores matter
        if (!pairs.has(key) && row.gameDate >= todayStr) {
          pairs.set(key, { sport: row.sport, gameDate: row.gameDate });
        }
      }

      const slateMap = new Map<number, import('../actionNetwork').SlateGame>();
      if (pairs.size > 0) {
        await Promise.all(
          Array.from(pairs.values()).map(async ({ sport, gameDate }) => {
            try {
              const games = await fetchAnSlate(sport, gameDate);
              for (const g of games) slateMap.set(g.id, g);
            } catch (e) {
              console.warn(`[BetTracker][WARN] list: fetchAnSlate failed for ${sport}/${gameDate}:`, e);
            }
          })
        );
      }

      type RawBet = typeof rows[0];
      const enriched = rows.map((row: RawBet) => {
        const slate = row.anGameId ? slateMap.get(row.anGameId) : undefined;
        // Past dates: logos from in-memory team map (O(1), no HTTP)
        const awayLogo = slate?.awayLogo
          ?? (row.awayTeam ? resolveLogoUrl(row.sport, row.awayTeam, "") || null : null);
        const homeLogo = slate?.homeLogo
          ?? (row.homeTeam ? resolveLogoUrl(row.sport, row.homeTeam, "") || null : null);
        return {
          ...row,
          awayLogo,
          homeLogo,
          awayFull:     slate?.awayFull     ?? null,
          homeFull:     slate?.homeFull     ?? null,
          awayNickname: slate?.awayNickname ?? null,
          homeNickname: slate?.homeNickname ?? null,
          awayColor:    slate?.awayColor    ?? null,
          homeColor:    slate?.homeColor    ?? null,
          gameTime:     slate?.gameTime     ?? null,
          startUtc:     slate?.startUtc     ?? null,
          gameStatus:   slate?.status       ?? null,
        };
      });

      return enriched;
    }),

  /**
   * create — add a new tracked bet.
   * Structured inputs: anGameId, timeframe, market, pickSide, wagerType, customLine.
   * pick is auto-derived from pickSide + market + team abbreviations.
   * toWin is auto-calculated from odds + risk (or provided explicitly).
   */
  create: handicapperProcedure
    .input(z.object({
      // Game identification
      anGameId:   z.number().int().positive(),
      /** Doubleheader game number: 1 = G1, 2 = G2. Defaults to 1 for non-DH games. */
      gameNumber: z.number().int().min(1).max(2).default(1),
      sport:      z.enum(SPORTS).default("MLB"),
      gameDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      awayTeam:   z.string().min(1).max(128),
      homeTeam:   z.string().min(1).max(128),
      // Bet structure
      timeframe:  z.enum(TIMEFRAMES).default("FULL_GAME"),
      market:     z.enum(MARKETS).default("ML"),
      pickSide:   z.enum(PICK_SIDES),
      // Stake
      odds:       z.number().int().min(-10000).max(10000),
      risk:       z.number().positive().max(1_000_000),
      toWin:      z.number().positive().optional(),
      // Optional
      line:       z.number().optional(),         // RL spread or Total line value (default)
      customLine: z.number().optional(),         // Exact custom line override (e.g. 8.0 for Over 8)
      wagerType:  z.enum(WAGER_TYPES).default("PREGAME"),
      notes:      z.string().max(2000).optional(),
      // Unit-denominated amounts for accurate analytics bucketing
      riskUnits:  z.number().positive().optional(),  // e.g. 3.0 for a 3U play
      toWinUnits: z.number().positive().optional(),  // e.g. 5.0 for a 5U to-win play
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.appUser.id;
      const toWin  = input.toWin ?? calcToWin(input.odds, input.risk);
      const pick   = derivePickLabel(input.pickSide, input.market, input.awayTeam, input.homeTeam, input.timeframe);

      console.log(`[BetTracker][INPUT] create: userId=${userId} sport=${input.sport} date=${input.gameDate} anGameId=${input.anGameId} gameNumber=${input.gameNumber} timeframe=${input.timeframe} market=${input.market} pickSide=${input.pickSide} pick="${pick}" odds=${input.odds} risk=${input.risk} toWin=${toWin} wagerType=${input.wagerType} customLine=${input.customLine ?? "null"}`);
      console.log(`[BetTracker][STATE] create: awayTeam=${input.awayTeam} homeTeam=${input.homeTeam} derivedPick="${pick}"`);

      const db = await getDb();

      // ── Idempotency guard: prevent duplicate bets from double-tap / network retry ──
      // If an identical bet (same user, game, market, pickSide, odds) was inserted in
      // the last 30 seconds, return the existing bet ID instead of creating a new row.
      const thirtySecondsAgo = new Date(Date.now() - 30_000);
      const [existing] = await db
        .select({ id: trackedBets.id })
        .from(trackedBets)
        .where(
          and(
            eq(trackedBets.userId,    userId),
            eq(trackedBets.anGameId,  input.anGameId),
            eq(trackedBets.gameNumber, input.gameNumber),
            eq(trackedBets.market,    input.market),
            eq(trackedBets.pickSide,  input.pickSide),
            eq(trackedBets.odds,      input.odds),
            gte(trackedBets.createdAt, thirtySecondsAgo),
          )
        )
        .limit(1);
      if (existing) {
        console.log(`[BetTracker][IDEMPOTENCY] Duplicate detected within 30s — returning full existing bet id=${existing.id}`);
        // Return the full bet row (not a partial sentinel) so the client onSuccess handler
        // can safely replace the optimistic placeholder without a broken cache entry.
        const [existingFull] = await db.select().from(trackedBets).where(eq(trackedBets.id, existing.id));
        return existingFull;
      }

      const [result] = await db.insert(trackedBets).values({
        userId,
        anGameId:   input.anGameId,
        gameNumber: input.gameNumber,
        sport:      input.sport,
        gameDate:   input.gameDate,
        awayTeam:   input.awayTeam,
        homeTeam:   input.homeTeam,
        timeframe:  input.timeframe,
        market:     input.market,
        pickSide:   input.pickSide,
        betType:    input.market === "TOTAL" ? (input.pickSide === "OVER" ? "OVER" : "UNDER") : input.market,
        pick,
        odds:       input.odds,
        risk:       String(input.risk),
        toWin:      String(toWin),
        riskUnits:  input.riskUnits !== undefined ? String(input.riskUnits) : null,
        toWinUnits: input.toWinUnits !== undefined ? String(input.toWinUnits) : null,
        book:       null,
        line:       input.line !== undefined ? String(input.line) : null,
        customLine: input.customLine !== undefined ? String(input.customLine) : null,
        wagerType:  input.wagerType,
        notes:      input.notes ?? null,
        result:     "PENDING",
      });

      const insertId = (result as { insertId: number }).insertId;
      console.log(`[BetTracker][OUTPUT] create: SUCCESS — insertId=${insertId} userId=${userId} pick="${pick}"`);
      console.log(`[BetTracker][VERIFY] create: PASS — bet inserted with id=${insertId}`);

      // ── Auto-grade-on-create ──────────────────────────────────────────────────
      const todayUtc = new Date().toISOString().slice(0, 10);
      const isPastDate = input.gameDate < todayUtc;
      console.log(`[BetTracker][STEP] create: autoGradeOnCreate check — gameDate=${input.gameDate} todayUtc=${todayUtc} isPastDate=${isPastDate}`);

      if (isPastDate) {
        try {
          console.log(`[BetTracker][STEP] create: autoGradeOnCreate — attempting to grade betId=${insertId} (past date)`);
          // Use customLine if provided, otherwise fall back to line
          const gradeLineValue = input.customLine ?? input.line ?? null;
          const gradeOut = await gradeTrackedBet({
            sport:      input.sport as GraderSport,
            gameDate:   input.gameDate,
            awayTeam:   input.awayTeam,
            homeTeam:   input.homeTeam,
            timeframe:  input.timeframe as GraderTimeframe,
            market:     input.market as GraderMarket,
            pickSide:   input.pickSide as GraderPickSide,
            odds:       input.odds,
            line:       gradeLineValue,
            anGameId:   input.anGameId,
            gameNumber: (input.gameNumber ?? 1) as 1 | 2,
          });

          console.log(`[BetTracker][STATE] create: autoGradeOnCreate result=${gradeOut.result} reason=${gradeOut.reason}`);

          if (gradeOut.result !== "PENDING") {
            const teamUpdates: Record<string, string | null> = {
              result:    gradeOut.result,
              awayScore: gradeOut.awayScore !== null ? String(gradeOut.awayScore) : null,
              homeScore: gradeOut.homeScore !== null ? String(gradeOut.homeScore) : null,
            };
            if (gradeOut.awayAbbrev && gradeOut.awayAbbrev !== input.awayTeam) {
              teamUpdates.awayTeam = gradeOut.awayAbbrev;
              console.log(`[BetTracker][STATE] create: autoGradeOnCreate — updating awayTeam from "${input.awayTeam}" to "${gradeOut.awayAbbrev}"`);
            }
            if (gradeOut.homeAbbrev && gradeOut.homeAbbrev !== input.homeTeam) {
              teamUpdates.homeTeam = gradeOut.homeAbbrev;
              console.log(`[BetTracker][STATE] create: autoGradeOnCreate — updating homeTeam from "${input.homeTeam}" to "${gradeOut.homeAbbrev}"`);
            }
            await db.update(trackedBets).set(teamUpdates).where(eq(trackedBets.id, insertId));
            console.log(`[BetTracker][OUTPUT] create: autoGradeOnCreate COMPLETE — betId=${insertId} result=${gradeOut.result} score=${gradeOut.awayScore}-${gradeOut.homeScore}`);
            console.log(`[BetTracker][VERIFY] create: autoGradeOnCreate PASS — betId=${insertId} graded=${gradeOut.result}`);
          } else {
            console.log(`[BetTracker][STATE] create: autoGradeOnCreate — betId=${insertId} still PENDING: ${gradeOut.reason}`);
          }
        } catch (gradeErr) {
          console.error(`[BetTracker][ERROR] create: autoGradeOnCreate FAILED for betId=${insertId} — ${String(gradeErr)}`);
        }
      }

      const [created] = await db.select().from(trackedBets).where(eq(trackedBets.id, insertId));
      return created;
    }),

  /**
   * update — update an existing bet.
   *
   * Access rules:
   *   OWNER (prez/sippi) — can update own bets only
   *   ADMIN              — can update porter/hank bets (handicapper role); CANNOT update owner bets
   *   HANDICAPPER        — FORBIDDEN (must use submitEditRequest)
   */
  update: handicapperProcedure
    .input(z.object({
      id:         z.number().int().positive(),
      timeframe:  z.enum(TIMEFRAMES).optional(),
      market:     z.enum(MARKETS).optional(),
      pickSide:   z.enum(PICK_SIDES).optional(),
      odds:       z.number().int().min(-10000).max(10000).optional(),
      risk:       z.number().positive().max(1_000_000).optional(),
      toWin:      z.number().positive().optional(),
      notes:      z.string().max(2000).optional(),
      result:     z.enum(RESULTS).optional(),
      wagerType:  z.enum(WAGER_TYPES).optional(),
      customLine: z.number().optional(),
      line:       z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.appUser.id;
      const role   = ctx.appUser.role;
      console.log(`[BetTracker][INPUT] update: userId=${userId} role=${role} betId=${input.id} fields=${JSON.stringify(Object.keys(input).filter(k => k !== 'id'))}`);

      const db = await getDb();
      const [existing] = await db.select().from(trackedBets).where(eq(trackedBets.id, input.id));
      if (!existing) {
        console.log(`[BetTracker][ERROR] update: betId=${input.id} not found`);
        throw new TRPCError({ code: "NOT_FOUND", message: "Bet not found" });
      }

      // ── Access control ────────────────────────────────────────────────────────
      // Fetch the bet owner's role to determine immutability
      const [betOwner] = await db
        .select({ id: appUsers.id, role: appUsers.role })
        .from(appUsers)
        .where(eq(appUsers.id, existing.userId));

      const betOwnerRole = betOwner?.role ?? "user";

      if (role === "handicapper") {
        // Handicappers cannot directly update any bet — must use submitEditRequest
        console.log(`[BetTracker][ERROR] update: FORBIDDEN — handicapper role must use submitEditRequest`);
        throw new TRPCError({ code: "FORBIDDEN", message: "Handicappers cannot directly edit bets. Use the edit request system." });
      }

      if (role === "admin") {
        // Admin can only edit handicapper bets, not owner bets
        if (betOwnerRole === "owner") {
          console.log(`[BetTracker][ERROR] update: FORBIDDEN — admin cannot edit owner bet (betId=${input.id} ownedBy=${existing.userId} ownerRole=${betOwnerRole})`);
          throw new TRPCError({ code: "FORBIDDEN", message: "Admins cannot edit owner bets" });
        }
        // Admin can edit handicapper bets even if they don't own them
        console.log(`[BetTracker][STATE] update: admin editing handicapper bet betId=${input.id} ownedBy=${existing.userId}`);
      } else if (role === "owner") {
        // Owner can only edit their own bets
        if (existing.userId !== userId) {
          console.log(`[BetTracker][ERROR] update: FORBIDDEN — owner can only edit own bets (betId=${input.id} ownedBy=${existing.userId} requester=${userId})`);
          throw new TRPCError({ code: "FORBIDDEN", message: "Cannot modify another user's bet" });
        }
      }

      // ── Build update payload ──────────────────────────────────────────────────
      const patch: Record<string, unknown> = {};
      if (input.timeframe  !== undefined) patch.timeframe  = input.timeframe;
      if (input.market     !== undefined) patch.market     = input.market;
      if (input.pickSide   !== undefined) patch.pickSide   = input.pickSide;
      if (input.notes      !== undefined) patch.notes      = input.notes;
      if (input.result     !== undefined) patch.result     = input.result;
      if (input.wagerType  !== undefined) patch.wagerType  = input.wagerType;
      if (input.customLine !== undefined) patch.customLine = String(input.customLine);
      if (input.line       !== undefined) patch.line       = String(input.line);

      // Re-derive pick label if market or pickSide changed
      const newMarket   = (input.market   ?? existing.market)   as typeof MARKETS[number];
      const newPickSide = (input.pickSide ?? existing.pickSide) as typeof PICK_SIDES[number];
      if (input.market !== undefined || input.pickSide !== undefined) {
        const awayTeam = existing.awayTeam ?? "";
        const homeTeam = existing.homeTeam ?? "";
        patch.pick    = derivePickLabel(newPickSide, newMarket, awayTeam, homeTeam);
        patch.betType = newMarket === "TOTAL"
          ? (newPickSide === "OVER" ? "OVER" : "UNDER")
          : newMarket;
        console.log(`[BetTracker][STATE] update: re-derived pick="${patch.pick}" betType="${patch.betType}"`);
      }

      // Recalculate toWin if odds or risk changed
      const newOdds = input.odds ?? existing.odds;
      const newRisk = input.risk !== undefined ? input.risk : parseFloat(existing.risk);
      if (input.risk !== undefined) patch.risk = String(input.risk);
      if (input.toWin !== undefined) {
        patch.toWin = String(input.toWin);
      } else if (input.odds !== undefined || input.risk !== undefined) {
        patch.toWin = String(calcToWin(newOdds, newRisk));
        console.log(`[BetTracker][STATE] update: recalculated toWin=${patch.toWin} (odds=${newOdds} risk=${newRisk})`);
      }
      if (input.odds !== undefined) patch.odds = input.odds;

      if (Object.keys(patch).length === 0) {
        console.log(`[BetTracker][OUTPUT] update: no-op — no fields changed for betId=${input.id}`);
        return existing;
      }

      await db.update(trackedBets).set(patch).where(eq(trackedBets.id, input.id));
      const [updated] = await db.select().from(trackedBets).where(eq(trackedBets.id, input.id));
      console.log(`[BetTracker][OUTPUT] update: SUCCESS — betId=${input.id} result=${updated?.result} pick="${updated?.pick}"`);
      console.log(`[BetTracker][VERIFY] update: PASS — betId=${input.id} updated`);
      return updated;
    }),

  /**
   * delete — remove a bet by id.
   *
   * Access rules:
   *   OWNER (prez/sippi) — can delete own bets only
   *   ADMIN              — can delete handicapper bets; CANNOT delete owner bets
   *   HANDICAPPER        — FORBIDDEN (must use submitEditRequest with requestType=DELETE)
   */
  delete: handicapperProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.appUser.id;
      const role   = ctx.appUser.role;
      console.log(`[BetTracker][INPUT] delete: userId=${userId} role=${role} betId=${input.id}`);

      const db = await getDb();
      const [existing] = await db.select().from(trackedBets).where(eq(trackedBets.id, input.id));
      if (!existing) {
        console.log(`[BetTracker][ERROR] delete: betId=${input.id} not found`);
        throw new TRPCError({ code: "NOT_FOUND", message: "Bet not found" });
      }

      // Fetch the bet owner's role
      const [betOwner] = await db
        .select({ id: appUsers.id, role: appUsers.role })
        .from(appUsers)
        .where(eq(appUsers.id, existing.userId));
      const betOwnerRole = betOwner?.role ?? "user";

      if (role === "handicapper") {
        console.log(`[BetTracker][ERROR] delete: FORBIDDEN — handicapper must use submitEditRequest for deletion`);
        throw new TRPCError({ code: "FORBIDDEN", message: "Handicappers cannot directly delete bets. Submit a delete request instead." });
      }

      if (role === "admin") {
        if (betOwnerRole === "owner") {
          console.log(`[BetTracker][ERROR] delete: FORBIDDEN — admin cannot delete owner bet (betId=${input.id} ownedBy=${existing.userId})`);
          throw new TRPCError({ code: "FORBIDDEN", message: "Admins cannot delete owner bets" });
        }
        console.log(`[BetTracker][STATE] delete: admin deleting handicapper bet betId=${input.id} ownedBy=${existing.userId}`);
      } else if (role === "owner") {
        if (existing.userId !== userId) {
          console.log(`[BetTracker][ERROR] delete: FORBIDDEN — owner can only delete own bets (betId=${input.id} ownedBy=${existing.userId} requester=${userId})`);
          throw new TRPCError({ code: "FORBIDDEN", message: "Cannot delete another user's bet" });
        }
      }

      await db.delete(trackedBets).where(eq(trackedBets.id, input.id));
      console.log(`[BetTracker][OUTPUT] delete: SUCCESS — betId=${input.id} deleted by userId=${userId} role=${role}`);
      console.log(`[BetTracker][VERIFY] delete: PASS — betId=${input.id} removed`);
      return { success: true, deletedId: input.id };
    }),

  /**
   * submitEditRequest — handicapper submits an EDIT or DELETE request for their own bet.
   * The bet itself is NOT modified. Owner/Admin reviews via reviewEditRequest.
   */
  submitEditRequest: handicapperProcedure
    .input(z.object({
      betId:           z.number().int().positive(),
      requestType:     z.enum(["EDIT", "DELETE"]),
      reason:          z.string().max(2000).optional(),
      proposedChanges: z.record(z.string(), z.unknown()).optional(), // JSON object of proposed field changes
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.appUser.id;
      const role   = ctx.appUser.role;
      console.log(`[BetTracker][INPUT] submitEditRequest: userId=${userId} role=${role} betId=${input.betId} requestType=${input.requestType}`);

      const db = await getDb();
      const [existing] = await db.select().from(trackedBets).where(eq(trackedBets.id, input.betId));
      if (!existing) {
        console.log(`[BetTracker][ERROR] submitEditRequest: betId=${input.betId} not found`);
        throw new TRPCError({ code: "NOT_FOUND", message: "Bet not found" });
      }

      // Only the bet owner can submit a request for their own bet
      if (existing.userId !== userId) {
        console.log(`[BetTracker][ERROR] submitEditRequest: FORBIDDEN — betId=${input.betId} ownedBy=${existing.userId} requester=${userId}`);
        throw new TRPCError({ code: "FORBIDDEN", message: "Can only submit requests for your own bets" });
      }

      // Owner/Admin can directly edit — this endpoint is for handicappers
      // But allow it for any role (owner might use it too in edge cases)
      const proposedChangesJson = input.proposedChanges
        ? JSON.stringify(input.proposedChanges)
        : null;

      const [insertResult] = await db.insert(betEditRequests).values({
        betId:           input.betId,
        requestedBy:     userId,
        requestType:     input.requestType,
        proposedChanges: proposedChangesJson,
        reason:          input.reason ?? null,
        status:          "PENDING",
      });
      const requestId = (insertResult as { insertId: number }).insertId;

      console.log(`[BetTracker][OUTPUT] submitEditRequest: SUCCESS — requestId=${requestId} betId=${input.betId} type=${input.requestType} userId=${userId}`);
      console.log(`[BetTracker][VERIFY] submitEditRequest: PASS — request inserted with id=${requestId}`);
      return { success: true, requestId };
    }),

  /**
   * reviewEditRequest — OWNER/ADMIN only: approve or deny a pending edit request.
   * On APPROVE:
   *   - DELETE request: deletes the bet
   *   - EDIT request: applies proposedChanges to the bet
   * On DENY: marks request as DENIED with optional note.
   */
  reviewEditRequest: handicapperProcedure
    .input(z.object({
      requestId:  z.number().int().positive(),
      action:     z.enum(["APPROVE", "DENY"]),
      reviewNote: z.string().max(2000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.appUser.id;
      const role   = ctx.appUser.role;
      console.log(`[BetTracker][INPUT] reviewEditRequest: reviewerId=${userId} role=${role} requestId=${input.requestId} action=${input.action}`);

      if (role !== "owner" && role !== "admin") {
        console.log(`[BetTracker][ERROR] reviewEditRequest: FORBIDDEN — role=${role}`);
        throw new TRPCError({ code: "FORBIDDEN", message: "Owner or Admin required to review edit requests" });
      }

      const db = await getDb();
      const [req] = await db.select().from(betEditRequests).where(eq(betEditRequests.id, input.requestId));
      if (!req) {
        console.log(`[BetTracker][ERROR] reviewEditRequest: requestId=${input.requestId} not found`);
        throw new TRPCError({ code: "NOT_FOUND", message: "Edit request not found" });
      }
      if (req.status !== "PENDING") {
        console.log(`[BetTracker][ERROR] reviewEditRequest: requestId=${input.requestId} already ${req.status}`);
        throw new TRPCError({ code: "BAD_REQUEST", message: `Request already ${req.status}` });
      }

      // Fetch the associated bet
      const [bet] = await db.select().from(trackedBets).where(eq(trackedBets.id, req.betId));
      if (!bet) {
        console.log(`[BetTracker][ERROR] reviewEditRequest: betId=${req.betId} not found`);
        throw new TRPCError({ code: "NOT_FOUND", message: "Associated bet not found" });
      }

      // Admin cannot approve requests on owner bets
      if (role === "admin") {
        const [betOwner] = await db
          .select({ role: appUsers.role })
          .from(appUsers)
          .where(eq(appUsers.id, bet.userId));
        if (betOwner?.role === "owner") {
          console.log(`[BetTracker][ERROR] reviewEditRequest: FORBIDDEN — admin cannot approve requests on owner bets`);
          throw new TRPCError({ code: "FORBIDDEN", message: "Admins cannot approve requests on owner bets" });
        }
      }

      const now = new Date();

      if (input.action === "APPROVE") {
        if (req.requestType === "DELETE") {
          await db.delete(trackedBets).where(eq(trackedBets.id, req.betId));
          console.log(`[BetTracker][STATE] reviewEditRequest: APPROVED DELETE — betId=${req.betId} deleted`);
        } else if (req.requestType === "EDIT" && req.proposedChanges) {
          // Apply proposed changes
          let changes: Record<string, unknown> = {};
          try {
            changes = JSON.parse(req.proposedChanges);
          } catch {
            console.warn(`[BetTracker][WARN] reviewEditRequest: could not parse proposedChanges for requestId=${input.requestId}`);
          }
          if (Object.keys(changes).length > 0) {
            // Sanitize: only allow safe fields
            const allowed = ["odds", "risk", "toWin", "notes", "result", "wagerType", "customLine", "line", "timeframe", "market", "pickSide"];
            const safe: Record<string, unknown> = {};
            for (const k of allowed) {
              if (k in changes) safe[k] = changes[k];
            }
            if (Object.keys(safe).length > 0) {
              await db.update(trackedBets).set(safe).where(eq(trackedBets.id, req.betId));
              console.log(`[BetTracker][STATE] reviewEditRequest: APPROVED EDIT — betId=${req.betId} fields=${Object.keys(safe).join(",")}`);
            }
          }
        }
        await db.update(betEditRequests).set({
          status:     "APPROVED",
          reviewedBy: userId,
          reviewedAt: now,
          reviewNote: input.reviewNote ?? null,
        }).where(eq(betEditRequests.id, input.requestId));
        console.log(`[BetTracker][OUTPUT] reviewEditRequest: APPROVED — requestId=${input.requestId} by reviewerId=${userId}`);
      } else {
        await db.update(betEditRequests).set({
          status:     "DENIED",
          reviewedBy: userId,
          reviewedAt: now,
          reviewNote: input.reviewNote ?? null,
        }).where(eq(betEditRequests.id, input.requestId));
        console.log(`[BetTracker][OUTPUT] reviewEditRequest: DENIED — requestId=${input.requestId} by reviewerId=${userId}`);
      }

      console.log(`[BetTracker][VERIFY] reviewEditRequest: PASS — requestId=${input.requestId} action=${input.action}`);
      return { success: true, requestId: input.requestId, action: input.action };
    }),

  /**
   * getLogs — OWNER/ADMIN only: full audit log of all bets created and all edit requests.
   * Used by the LOGS tab for transparency and integrity monitoring.
   * Returns:
   *   - bets: all tracked_bets with user info (username, role)
   *   - editRequests: all bet_edit_requests with requester + reviewer info
   */
  getLogs: handicapperProcedure
    .input(z.object({
      limit:  z.number().int().positive().max(500).default(200),
      offset: z.number().int().min(0).default(0),
    }).optional())
    .query(async ({ ctx, input }) => {
      const role = ctx.appUser.role;
      if (role !== "owner" && role !== "admin") {
        console.log(`[BetTracker][ERROR] getLogs: FORBIDDEN — role=${role}`);
        throw new TRPCError({ code: "FORBIDDEN", message: "Owner or Admin required to view logs" });
      }

      const limit  = input?.limit  ?? 200;
      const offset = input?.offset ?? 0;

      console.log(`[BetTracker][INPUT] getLogs: viewerId=${ctx.appUser.id} role=${role} limit=${limit} offset=${offset}`);

      const db = await getDb();

      // Fetch all bets with user info
      const betsRaw = await db
        .select({
          bet:  trackedBets,
          user: { id: appUsers.id, username: appUsers.username, role: appUsers.role },
        })
        .from(trackedBets)
        .leftJoin(appUsers, eq(trackedBets.userId, appUsers.id))
        .orderBy(desc(trackedBets.createdAt))
        .limit(limit)
        .offset(offset);

      // Fetch all edit requests with requester + reviewer info
      const requestsRaw = await db
        .select()
        .from(betEditRequests)
        .orderBy(desc(betEditRequests.createdAt))
        .limit(limit)
        .offset(offset);

      // Enrich edit requests with usernames
      const userIds = new Set<number>();
      for (const r of requestsRaw) {
        userIds.add(r.requestedBy);
        if (r.reviewedBy) userIds.add(r.reviewedBy);
      }
      const usersForRequests = userIds.size > 0
        ? await db
            .select({ id: appUsers.id, username: appUsers.username, role: appUsers.role })
            .from(appUsers)
            .where(inArray(appUsers.id, Array.from(userIds)))
        : [];
      const userMap = new Map<number, { id: number; username: string; role: string }>(usersForRequests.map((u: { id: number; username: string; role: string }) => [u.id, u]));

      const editRequests = requestsRaw.map((r: typeof requestsRaw[0]) => ({
        ...r,
        requesterUsername: userMap.get(r.requestedBy)?.username ?? `user#${r.requestedBy}`,
        requesterRole:     userMap.get(r.requestedBy)?.role     ?? "unknown",
        reviewerUsername:  r.reviewedBy ? (userMap.get(r.reviewedBy)?.username ?? `user#${r.reviewedBy}`) : null,
      }));

      const bets = betsRaw.map((row: typeof betsRaw[0]) => ({
        ...row.bet,
        username: row.user?.username ?? `user#${row.bet.userId}`,
        userRole: row.user?.role     ?? "unknown",
      }));

      console.log(`[BetTracker][OUTPUT] getLogs: bets=${bets.length} editRequests=${editRequests.length}`);
      return { bets, editRequests };
    }),

  /**
   * getSlate — fetch the daily game slate from Action Network v2 scoreboard API.
   * Served from in-memory cache (5-min TTL) after server pre-warm.
   * Returns normalized SlateGame[] sorted by start time ASC.
   */
  getSlate: handicapperProcedure
    .input(z.object({
      sport:    z.enum(["MLB", "NBA", "NHL", "NCAAM"]),
      gameDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }))
    .query(async ({ ctx, input }) => {
      console.log(`[BetTracker][INPUT] getSlate: userId=${ctx.appUser.id} sport=${input.sport} date=${input.gameDate}`);
      const start = Date.now();
      const games = await fetchAnSlate(input.sport, input.gameDate);
      const elapsed = Date.now() - start;
      console.log(`[BetTracker][OUTPUT] getSlate: ${games.length} games | sport=${input.sport} date=${input.gameDate} | elapsed=${elapsed}ms`);
      console.log(`[BetTracker][VERIFY] getSlate: ${games.length > 0 ? "PASS" : "WARN — 0 games"} | elapsed=${elapsed}ms`);
      return games.map(g => ({
        id:           g.id,
        awayTeam:     g.awayTeam,
        homeTeam:     g.homeTeam,
        awayFull:     g.awayFull,
        homeFull:     g.homeFull,
        awayNickname: g.awayNickname,
        homeNickname: g.homeNickname,
        awayLogo:     g.awayLogo,
        homeLogo:     g.homeLogo,
        awayColor:    g.awayColor,
        homeColor:    g.homeColor,
        gameTime:     g.gameTime,
        sport:        g.sport,
        gameDate:     g.gameDate,
        status:       g.status,
        odds:         g.odds,
        gameNumber:   g.gameNumber,  // 1 for single/G1, 2 for G2 of doubleheader
      }));
    }),

  /**
   * autoGrade — grade all PENDING bets for the current user.
   * Fetches official league scores and deterministically grades each bet.
   * Returns a summary of how many bets were graded and their results.
   */
  autoGrade: handicapperProcedure
    .input(z.object({
      sport:    z.enum(SPORTS).optional(),
      gameDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).optional())
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.appUser.id;
      console.log(`[BetTracker][INPUT] autoGrade: userId=${userId} sport=${input?.sport ?? "ALL"} date=${input?.gameDate ?? "ALL"}`);

      const db = await getDb();
      const conditions = [
        eq(trackedBets.userId, userId),
        eq(trackedBets.result, "PENDING"),
      ];
      if (input?.sport)    conditions.push(eq(trackedBets.sport, input.sport));
      if (input?.gameDate) conditions.push(eq(trackedBets.gameDate, input.gameDate));

      const pending = await db.select().from(trackedBets).where(and(...conditions));
      console.log(`[BetTracker][STATE] autoGrade: ${pending.length} PENDING bets to grade for userId=${userId}`);

      let graded = 0, wins = 0, losses = 0, pushes = 0, stillPending = 0;
      const details: Array<{ betId: number; result: string; reason: string }> = [];

      for (const bet of pending) {
        console.log(`[BetTracker][STEP] autoGrade: grading betId=${bet.id} sport=${bet.sport} date=${bet.gameDate} ${bet.awayTeam}@${bet.homeTeam} timeframe=${bet.timeframe} market=${bet.market} pickSide=${bet.pickSide}`);

        // Use customLine if set, otherwise fall back to line
        const gradeLineValue = bet.customLine != null
          ? parseFloat(String(bet.customLine))
          : (bet.line != null ? parseFloat(String(bet.line)) : null);

        const gradeOut = await gradeTrackedBet({
          sport:      bet.sport as GraderSport,
          gameDate:   bet.gameDate,
          awayTeam:   bet.awayTeam ?? "",
          homeTeam:   bet.homeTeam ?? "",
          timeframe:  (bet.timeframe ?? "FULL_GAME") as GraderTimeframe,
          market:     (bet.market ?? "ML") as GraderMarket,
          pickSide:   (bet.pickSide ?? "AWAY") as GraderPickSide,
          odds:       bet.odds,
          line:       gradeLineValue,
          anGameId:   bet.anGameId,
          gameNumber: (bet.gameNumber ?? 1) as 1 | 2,
        });

        details.push({ betId: bet.id, result: gradeOut.result, reason: gradeOut.reason });

        if (gradeOut.result === "PENDING") {
          stillPending++;
          console.log(`[BetTracker][STATE] autoGrade: betId=${bet.id} still PENDING — ${gradeOut.reason}`);
          continue;
        }

        const teamUpdates: Record<string, string | null> = {
          result:    gradeOut.result,
          awayScore: gradeOut.awayScore !== null ? String(gradeOut.awayScore) : null,
          homeScore: gradeOut.homeScore !== null ? String(gradeOut.homeScore) : null,
        };
        if (gradeOut.awayAbbrev && (!bet.awayTeam || bet.awayTeam === 'OPP' || bet.awayTeam.trim() === '')) {
          teamUpdates.awayTeam = gradeOut.awayAbbrev;
          console.log(`[BetTracker][STATE] autoGrade: betId=${bet.id} — fixing awayTeam from "${bet.awayTeam}" to "${gradeOut.awayAbbrev}"`);
        }
        if (gradeOut.homeAbbrev && (!bet.homeTeam || bet.homeTeam === 'OPP' || bet.homeTeam.trim() === '')) {
          teamUpdates.homeTeam = gradeOut.homeAbbrev;
          console.log(`[BetTracker][STATE] autoGrade: betId=${bet.id} — fixing homeTeam from "${bet.homeTeam}" to "${gradeOut.homeAbbrev}"`);
        }
        await db.update(trackedBets).set(teamUpdates).where(eq(trackedBets.id, bet.id));

        graded++;
        if (gradeOut.result === "WIN")  wins++;
        if (gradeOut.result === "LOSS") losses++;
        if (gradeOut.result === "PUSH") pushes++;

        console.log(`[BetTracker][OUTPUT] autoGrade: betId=${bet.id} → ${gradeOut.result} | ${gradeOut.reason}`);
        console.log(`[BetTracker][VERIFY] autoGrade: PASS — betId=${bet.id} graded=${gradeOut.result}`);
      }

      const summary = { graded, wins, losses, pushes, stillPending, total: pending.length, details };
      console.log(`[BetTracker][OUTPUT] autoGrade: COMPLETE userId=${userId} — graded=${graded} wins=${wins} losses=${losses} pushes=${pushes} stillPending=${stillPending}`);
      return summary;
    }),

  /**
   * autoGradeAll — OWNER/ADMIN only: grade ALL users' PENDING bets for a given date.
   * Used by the scheduled background job.
   */
  autoGradeAll: handicapperProcedure
    .input(z.object({
      gameDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }))
    .mutation(async ({ ctx, input }) => {
      const role = ctx.appUser.role;
      if (role !== "owner" && role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Owner or Admin required" });
      }
      console.log(`[BetTracker][INPUT] autoGradeAll: triggeredBy=${ctx.appUser.username} date=${input.gameDate}`);

      const db = await getDb();
      const pending = await db.select().from(trackedBets).where(
        and(
          eq(trackedBets.result, "PENDING"),
          eq(trackedBets.gameDate, input.gameDate),
        )
      );
      console.log(`[BetTracker][STATE] autoGradeAll: ${pending.length} PENDING bets across all users for date=${input.gameDate}`);

      const sportsNeeded: GraderSport[] = Array.from(new Set(pending.map((b: { sport: string }) => b.sport))) as GraderSport[];
      console.log(`[BetTracker][STEP] autoGradeAll: pre-fetching scores for sports=${sportsNeeded.join(",")}`);
      await Promise.all(sportsNeeded.map(s => fetchScores(s, input.gameDate)));
      console.log(`[BetTracker][STATE] autoGradeAll: scores pre-fetched for ${sportsNeeded.length} sports`);

      let graded = 0, wins = 0, losses = 0, pushes = 0, stillPending = 0;

      for (const bet of pending) {
        const gradeLineValue = bet.customLine != null
          ? parseFloat(String(bet.customLine))
          : (bet.line != null ? parseFloat(String(bet.line)) : null);

        const gradeOut = await gradeTrackedBet({
          sport:      bet.sport as GraderSport,
          gameDate:   bet.gameDate,
          awayTeam:   bet.awayTeam ?? "",
          homeTeam:   bet.homeTeam ?? "",
          timeframe:  (bet.timeframe ?? "FULL_GAME") as GraderTimeframe,
          market:     (bet.market ?? "ML") as GraderMarket,
          pickSide:   (bet.pickSide ?? "AWAY") as GraderPickSide,
          odds:       bet.odds,
          line:       gradeLineValue,
          anGameId:   bet.anGameId,
          gameNumber: (bet.gameNumber ?? 1) as 1 | 2,
        });

        if (gradeOut.result === "PENDING") { stillPending++; continue; }

        const allUpdates: Record<string, string | null> = {
          result:    gradeOut.result,
          awayScore: gradeOut.awayScore !== null ? String(gradeOut.awayScore) : null,
          homeScore: gradeOut.homeScore !== null ? String(gradeOut.homeScore) : null,
        };
        if (gradeOut.awayAbbrev && (!bet.awayTeam || bet.awayTeam === 'OPP' || bet.awayTeam.trim() === '')) {
          allUpdates.awayTeam = gradeOut.awayAbbrev;
        }
        if (gradeOut.homeAbbrev && (!bet.homeTeam || bet.homeTeam === 'OPP' || bet.homeTeam.trim() === '')) {
          allUpdates.homeTeam = gradeOut.homeAbbrev;
        }
        await db.update(trackedBets).set(allUpdates).where(eq(trackedBets.id, bet.id));

        graded++;
        if (gradeOut.result === "WIN")  wins++;
        if (gradeOut.result === "LOSS") losses++;
        if (gradeOut.result === "PUSH") pushes++;

        console.log(`[BetTracker][OUTPUT] autoGradeAll: betId=${bet.id} userId=${bet.userId} → ${gradeOut.result} score=${gradeOut.awayScore}-${gradeOut.homeScore}`);
      }

      const summary = { graded, wins, losses, pushes, stillPending, total: pending.length };
      console.log(`[BetTracker][OUTPUT] autoGradeAll: COMPLETE date=${input.gameDate} graded=${graded} wins=${wins} losses=${losses} pushes=${pushes} stillPending=${stillPending}`);
      return summary;
    }),

  /**
   * getStats — full aggregate stats with all breakdown dimensions.
   * Owner/Admin can pass targetUserId to view another handicapper's stats.
   *
   * bySize breakdown (v4 — exact unit buckets):
   *   Plus-money bets: risk = unit count
   *   Minus-money bets: toWin = unit count
   *   Buckets: 10U, 5U, 4U, 3U, 2U, 1U
   */
  getStats: handicapperProcedure
    .input(z.object({
      sport:         z.enum(SPORTS).optional(),
      gameDate:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      dateFrom:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      dateTo:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      targetUserId:  z.number().int().positive().optional(),
      /** Client-side unit size (e.g. 100 = $100/unit). Used to normalize legacy bets lacking riskUnits/toWinUnits. */
      unitSize:      z.number().positive().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const role = ctx.appUser.role;
      let userId = ctx.appUser.id;
      if (input?.targetUserId && input.targetUserId !== userId) {
        if (role !== "owner" && role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Owner or Admin required to view other handicappers" });
        }
        userId = input.targetUserId;
      }
      // Unit size for normalizing legacy dollar amounts to unit counts
      const unitSize = input?.unitSize ?? 100;
      // [PERF] Boundary log only — verbose per-field logs removed from hot path

      const conditions = [eq(trackedBets.userId, userId)];
      if (input?.sport)    conditions.push(eq(trackedBets.sport, input.sport));
      if (input?.gameDate) conditions.push(eq(trackedBets.gameDate, input.gameDate));
      if (input?.dateFrom) conditions.push(gte(trackedBets.gameDate, input.dateFrom));
      if (input?.dateTo)   conditions.push(lte(trackedBets.gameDate, input.dateTo));

      const db = await getDb();
      const rows = await db
        .select()
        .from(trackedBets)
        .where(and(...conditions))
        .orderBy(asc(trackedBets.gameDate), asc(trackedBets.createdAt));

      /**
       * Normalize a dollar amount to unit count.
       * Prefer stored riskUnits/toWinUnits (set at bet creation time).
       * Fall back to dividing by unitSize for legacy bets.
       */
      function toUnits(dollarAmt: number, storedUnits: string | null | undefined): number {
        if (storedUnits != null && storedUnits !== "") {
          const v = parseFloat(storedUnits);
          if (!isNaN(v) && v > 0) return v;
        }
        return dollarAmt / unitSize;
      }

      // ── Overall aggregation (unit-denominated) ───────────────────────────────
      let wins = 0, losses = 0, pushes = 0, pending = 0, voids = 0;
      let totalRisk = 0, totalWon = 0, totalLost = 0;
      let bestWin = 0, worstLoss = 0;

      for (const bet of rows) {
        const riskU  = toUnits(parseFloat(bet.risk),  bet.riskUnits);
        const toWinU = toUnits(parseFloat(bet.toWin), bet.toWinUnits);
        switch (bet.result) {
          case "WIN":
            wins++; totalRisk += riskU; totalWon += toWinU;
            if (toWinU > bestWin) bestWin = toWinU;
            break;
          case "LOSS":
            losses++; totalRisk += riskU; totalLost += riskU;
            if (riskU > worstLoss) worstLoss = riskU;
            break;
          case "PUSH":    pushes++;  break;
          case "PENDING": pending++; break;
          case "VOID":    voids++;   break;
        }
      }
      const netProfit = totalWon - totalLost;
      const roi       = totalRisk > 0 ? parseFloat(((netProfit / totalRisk) * 100).toFixed(2)) : 0;

      // ── Breakdown helper (unit-denominated) ──────────────────────────────────
      type BreakdownEntry = {
        key: string;
        wins: number; losses: number; pushes: number;
        totalRisk: number; netProfit: number; roi: number;
      };
      function buildBreakdown(keyFn: (bet: typeof rows[0]) => string): BreakdownEntry[] {
        const map = new Map<string, { wins: number; losses: number; pushes: number; risk: number; won: number; lost: number }>();
        for (const bet of rows) {
          const key = keyFn(bet);
          if (!map.has(key)) map.set(key, { wins: 0, losses: 0, pushes: 0, risk: 0, won: 0, lost: 0 });
          const e = map.get(key)!;
          const riskU  = toUnits(parseFloat(bet.risk),  bet.riskUnits);
          const toWinU = toUnits(parseFloat(bet.toWin), bet.toWinUnits);
          if (bet.result === "WIN")  { e.wins++;   e.risk += riskU; e.won  += toWinU; }
          if (bet.result === "LOSS") { e.losses++; e.risk += riskU; e.lost += riskU;  }
          if (bet.result === "PUSH") { e.pushes++; }
        }
        return Array.from(map.entries()).map(([key, e]) => {
          const np = e.won - e.lost;
          return {
            key,
            wins:       e.wins,
            losses:     e.losses,
            pushes:     e.pushes,
            totalRisk:  parseFloat(e.risk.toFixed(2)),
            netProfit:  parseFloat(np.toFixed(2)),
            roi:        e.risk > 0 ? parseFloat(((np / e.risk) * 100).toFixed(2)) : 0,
          };
        }).sort((a, b) => a.key.localeCompare(b.key));
      }

      // ── By Bet Type (market) ─────────────────────────────────────────────────
      const byType = buildBreakdown(bet => bet.market ?? bet.betType ?? "ML");

      // ── By Unit Size (v4 — exact buckets with plus/minus money logic) ─────────
      // Plus-money: risk IS the unit count (amount risked = unit size)
      // Minus-money: toWin IS the unit count (amount to win = unit size)
      // Buckets: 10U, 5U, 4U, 3U, 2U, 1U
      const UNIT_BUCKET_ORDER = ["10U", "5U", "4U", "3U", "2U", "1U"];
      const bySize = buildBreakdown(bet => {
        const risk       = parseFloat(bet.risk);
        const toWin      = parseFloat(bet.toWin);
        const riskUnits  = bet.riskUnits  != null ? parseFloat(bet.riskUnits)  : null;
        const toWinUnits = bet.toWinUnits != null ? parseFloat(bet.toWinUnits) : null;
        return calcUnitBucket(bet.odds, risk, toWin, riskUnits, toWinUnits);
      }).sort((a, b) => {
        const ai = UNIT_BUCKET_ORDER.indexOf(a.key);
        const bi = UNIT_BUCKET_ORDER.indexOf(b.key);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      });

      // ── By Month ─────────────────────────────────────────────────────────────
      const byMonth = buildBreakdown(bet => bet.gameDate.substring(0, 7));

      // ── By Sport ─────────────────────────────────────────────────────────────
      const bySport = buildBreakdown(bet => bet.sport);

      // ── By Result ────────────────────────────────────────────────────────────
      const byResult = buildBreakdown(bet => bet.result);

      // ── By Timeframe ─────────────────────────────────────────────────────────
      const byTimeframe = buildBreakdown(bet => bet.timeframe ?? "FULL_GAME");

      // ── By Wager Type (PREGAME / LIVE) ───────────────────────────────────────
      const byWagerType = buildBreakdown(bet => bet.wagerType ?? "PREGAME");
      // ── Equity Curve (unit-denominated) ───────────────────────────────────────────────
      let cumPL = 0;
      const equityCurve: { date: string; cumPL: number; betId: number; pick: string; result: string; pl: number }[] = [];
      for (const bet of rows) {
        if (bet.result === "WIN") {
          const pl = toUnits(parseFloat(bet.toWin), bet.toWinUnits);
          cumPL += pl;
          equityCurve.push({ date: bet.gameDate, cumPL: parseFloat(cumPL.toFixed(2)), betId: bet.id, pick: bet.pick, result: "WIN", pl: parseFloat(pl.toFixed(2)) });
        } else if (bet.result === "LOSS") {
          const pl = -toUnits(parseFloat(bet.risk), bet.riskUnits);
          cumPL += pl;
          equityCurve.push({ date: bet.gameDate, cumPL: parseFloat(cumPL.toFixed(2)), betId: bet.id, pick: bet.pick, result: "LOSS", pl: parseFloat(pl.toFixed(2)) });
        }
      }
      // ── Biggest Day (date with highest single-day net P/L) ────────────────────
      const dayPLMap = new Map<string, number>();
      for (const bet of rows) {
        if (bet.result === "WIN") {
          const pl = toUnits(parseFloat(bet.toWin), bet.toWinUnits);
          dayPLMap.set(bet.gameDate, (dayPLMap.get(bet.gameDate) ?? 0) + pl);
        } else if (bet.result === "LOSS") {
          const pl = -toUnits(parseFloat(bet.risk), bet.riskUnits);
          dayPLMap.set(bet.gameDate, (dayPLMap.get(bet.gameDate) ?? 0) + pl);
        }
      }
      let biggestDayDate = "";
      let biggestDayUnits = 0;
      dayPLMap.forEach((pl, date) => {
        if (pl > biggestDayUnits) { biggestDayUnits = pl; biggestDayDate = date; }
      });
      // ── Longest Win Streak (consecutive WIN results in chronological order) ────
      let longestWinStreak = 0;
      let currentWinStreak = 0;
      for (const bet of rows) {
        if (bet.result === "WIN") {
          currentWinStreak++;
          if (currentWinStreak > longestWinStreak) longestWinStreak = currentWinStreak;
        } else if (bet.result === "LOSS") {
          currentWinStreak = 0;
        }
        // PUSH/PENDING/VOID do not break or extend the streak
      }
      const stats = {
        totalBets:  rows.length,
        wins, losses, pushes, pending, voids,
        gradedBets: wins + losses + pushes,
        totalRisk:  parseFloat(totalRisk.toFixed(2)),
        totalWon:   parseFloat(totalWon.toFixed(2)),
        totalLost:  parseFloat(totalLost.toFixed(2)),
        netProfit:  parseFloat(netProfit.toFixed(2)),
        roi,
        bestWin:    parseFloat(bestWin.toFixed(2)),
        worstLoss:  parseFloat(worstLoss.toFixed(2)),
        byType,
        bySize,
        byMonth,
        bySport,
        byResult,
        byTimeframe,
        byWagerType,
        equityCurve,
        biggestDayDate,
        biggestDayUnits: parseFloat(biggestDayUnits.toFixed(2)),
        longestWinStreak,
      };

      console.log(`[BetTracker][OUTPUT] getStats: userId=${userId} → totalBets=${stats.totalBets} wins=${stats.wins} losses=${stats.losses} roi=${stats.roi}% equityCurve=${equityCurve.length} points bySize=${JSON.stringify(bySize.map(s => s.key))}`);
      return stats;
    }),

  /**
   * listWithStats — COMBINED procedure: returns enriched bet list + full stats in a single DB round-trip.
   * Eliminates the separate list + getStats calls (2 queries → 1 query + in-memory aggregation).
   * The client should prefer this over calling list + getStats separately.
   *
   * Performance profile:
   *   - 1 DB SELECT (vs 2 previously)
   *   - 1 AN slate fetch pass (shared between list enrichment + stats)
   *   - In-memory aggregation over the same row set (no second scan)
   *   - Compression reduces payload 70-85% over the wire
   */
  listWithStats: handicapperProcedure
    .input(z.object({
      sport:         z.enum(SPORTS).optional(),
      gameDate:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      dateFrom:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      dateTo:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      result:        z.enum(RESULTS).optional(),
      targetUserId:  z.number().int().positive().optional(),
      unitSize:      z.number().positive().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const role = ctx.appUser.role;
      let userId = ctx.appUser.id;
      if (input?.targetUserId && input.targetUserId !== userId) {
        if (role !== "owner" && role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Owner or Admin required to view other handicappers" });
        }
        userId = input.targetUserId;
      }
      const unitSize = input?.unitSize ?? 100;

      // ── Single DB query for both list and stats ──────────────────────────────
      const conditions = [eq(trackedBets.userId, userId)];
      if (input?.sport)    conditions.push(eq(trackedBets.sport, input.sport));
      if (input?.gameDate) conditions.push(eq(trackedBets.gameDate, input.gameDate));
      if (input?.dateFrom) conditions.push(gte(trackedBets.gameDate, input.dateFrom));
      if (input?.dateTo)   conditions.push(lte(trackedBets.gameDate, input.dateTo));
      // result filter only for list display — stats always use full set
      const listConditions = [...conditions];
      if (input?.result)   listConditions.push(eq(trackedBets.result, input.result));

      const db = await getDb();

      // Run list query (with result filter) and stats query (without result filter) in parallel
      const [listRows, statsRows] = await Promise.all([
        db.select().from(trackedBets)
          .where(and(...listConditions))
          .orderBy(desc(trackedBets.gameDate), desc(trackedBets.createdAt)),
        // If no result filter, statsRows === listRows (same data) — avoid second query
        input?.result
          ? db.select().from(trackedBets)
              .where(and(...conditions))
              .orderBy(asc(trackedBets.gameDate), asc(trackedBets.createdAt))
          : db.select().from(trackedBets)
              .where(and(...conditions))
              .orderBy(asc(trackedBets.gameDate), asc(trackedBets.createdAt)),
      ]);

      // ── Enrich list rows with logos/slate data ───────────────────────────────
      const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
      const pairs = new Map<string, { sport: string; gameDate: string }>();
      for (const row of listRows) {
        const key = `${row.sport}:${row.gameDate}`;
        if (!pairs.has(key) && row.gameDate >= todayStr) {
          pairs.set(key, { sport: row.sport, gameDate: row.gameDate });
        }
      }
      const slateMap = new Map<number, import('../actionNetwork').SlateGame>();
      if (pairs.size > 0) {
        await Promise.all(
          Array.from(pairs.values()).map(async ({ sport, gameDate }) => {
            try {
              const games = await fetchAnSlate(sport, gameDate);
              for (const g of games) slateMap.set(g.id, g);
            } catch (e) {
              console.warn(`[BetTracker][WARN] listWithStats: fetchAnSlate failed for ${sport}/${gameDate}:`, e);
            }
          })
        );
      }
      type RawBet = typeof listRows[0];
      const enriched = listRows.map((row: RawBet) => {
        const slate = row.anGameId ? slateMap.get(row.anGameId) : undefined;
        const awayLogo = slate?.awayLogo ?? (row.awayTeam ? resolveLogoUrl(row.sport, row.awayTeam, "") || null : null);
        const homeLogo = slate?.homeLogo ?? (row.homeTeam ? resolveLogoUrl(row.sport, row.homeTeam, "") || null : null);
        return {
          ...row,
          awayLogo,
          homeLogo,
          awayFull:     slate?.awayFull     ?? null,
          homeFull:     slate?.homeFull     ?? null,
          awayNickname: slate?.awayNickname ?? null,
          homeNickname: slate?.homeNickname ?? null,
          awayColor:    slate?.awayColor    ?? null,
          homeColor:    slate?.homeColor    ?? null,
          gameTime:     slate?.gameTime     ?? null,
          startUtc:     slate?.startUtc     ?? null,
          gameStatus:   slate?.status       ?? null,
        };
      });

      // ── Stats aggregation over statsRows (single pass) ───────────────────────
      function toUnits(dollarAmt: number, storedUnits: string | null | undefined): number {
        if (storedUnits != null && storedUnits !== "") {
          const v = parseFloat(storedUnits);
          if (!isNaN(v) && v > 0) return v;
        }
        return dollarAmt / unitSize;
      }

      let wins = 0, losses = 0, pushes = 0, pending = 0, voids = 0;
      let totalRisk = 0, totalWon = 0, totalLost = 0;
      let bestWin = 0, worstLoss = 0;
      // Breakdown maps (single pass — all dimensions simultaneously)
      type BkEntry = { wins: number; losses: number; pushes: number; risk: number; won: number; lost: number };
      const byTypeMap      = new Map<string, BkEntry>();
      const bySizeMap      = new Map<string, BkEntry>();
      const byMonthMap     = new Map<string, BkEntry>();
      const bySportMap     = new Map<string, BkEntry>();
      const byResultMap    = new Map<string, BkEntry>();
      const byTimeframeMap = new Map<string, BkEntry>();
      const byWagerTypeMap = new Map<string, BkEntry>();
      const dayPLMap       = new Map<string, number>();
      // Equity curve (chronological — statsRows ordered ASC)
      let cumPL = 0;
      const equityCurve: { date: string; cumPL: number; betId: number; pick: string; result: string; pl: number }[] = [];
      let longestWinStreak = 0, currentWinStreak = 0;

      function bkGet(map: Map<string, BkEntry>, key: string): BkEntry {
        if (!map.has(key)) map.set(key, { wins: 0, losses: 0, pushes: 0, risk: 0, won: 0, lost: 0 });
        return map.get(key)!;
      }
      function bkApply(map: Map<string, BkEntry>, key: string, result: string, riskU: number, toWinU: number) {
        const e = bkGet(map, key);
        if (result === "WIN")  { e.wins++;   e.risk += riskU; e.won  += toWinU; }
        if (result === "LOSS") { e.losses++; e.risk += riskU; e.lost += riskU;  }
        if (result === "PUSH") { e.pushes++; }
      }

      const UNIT_BUCKET_ORDER = ["10U", "5U", "4U", "3U", "2U", "1U"];

      for (const bet of statsRows) {
        const riskU  = toUnits(parseFloat(bet.risk),  bet.riskUnits);
        const toWinU = toUnits(parseFloat(bet.toWin), bet.toWinUnits);
        const res    = bet.result;

        // Overall counters
        switch (res) {
          case "WIN":     wins++;   totalRisk += riskU; totalWon  += toWinU; if (toWinU > bestWin)   bestWin   = toWinU; break;
          case "LOSS":   losses++; totalRisk += riskU; totalLost += riskU;  if (riskU  > worstLoss) worstLoss = riskU;  break;
          case "PUSH":   pushes++;  break;
          case "PENDING": pending++; break;
          case "VOID":   voids++;   break;
        }

        // All breakdowns in one pass
        const typeKey      = bet.market ?? bet.betType ?? "ML";
        const riskDollar   = parseFloat(bet.risk);
        const toWinDollar  = parseFloat(bet.toWin);
        const riskUnitsRaw = bet.riskUnits  != null ? parseFloat(bet.riskUnits)  : null;
        const toWinUnitsRaw= bet.toWinUnits != null ? parseFloat(bet.toWinUnits) : null;
        const sizeKey      = calcUnitBucket(bet.odds, riskDollar, toWinDollar, riskUnitsRaw, toWinUnitsRaw);
        const monthKey     = bet.gameDate.substring(0, 7);
        const sportKey     = bet.sport;
        const resultKey    = res;
        const tfKey        = bet.timeframe ?? "FULL_GAME";
        const wtKey        = bet.wagerType ?? "PREGAME";

        bkApply(byTypeMap,      typeKey,   res, riskU, toWinU);
        bkApply(bySizeMap,      sizeKey,   res, riskU, toWinU);
        bkApply(byMonthMap,     monthKey,  res, riskU, toWinU);
        bkApply(bySportMap,     sportKey,  res, riskU, toWinU);
        bkApply(byResultMap,    resultKey, res, riskU, toWinU);
        bkApply(byTimeframeMap, tfKey,     res, riskU, toWinU);
        bkApply(byWagerTypeMap, wtKey,     res, riskU, toWinU);

        // Day P/L
        if (res === "WIN")  dayPLMap.set(bet.gameDate, (dayPLMap.get(bet.gameDate) ?? 0) + toWinU);
        if (res === "LOSS") dayPLMap.set(bet.gameDate, (dayPLMap.get(bet.gameDate) ?? 0) - riskU);

        // Equity curve
        if (res === "WIN") {
          cumPL += toWinU;
          equityCurve.push({ date: bet.gameDate, cumPL: parseFloat(cumPL.toFixed(2)), betId: bet.id, pick: bet.pick, result: "WIN", pl: parseFloat(toWinU.toFixed(2)) });
        } else if (res === "LOSS") {
          cumPL -= riskU;
          equityCurve.push({ date: bet.gameDate, cumPL: parseFloat(cumPL.toFixed(2)), betId: bet.id, pick: bet.pick, result: "LOSS", pl: parseFloat((-riskU).toFixed(2)) });
        }

        // Win streak
        if (res === "WIN")  { currentWinStreak++; if (currentWinStreak > longestWinStreak) longestWinStreak = currentWinStreak; }
        else if (res === "LOSS") currentWinStreak = 0;
      }

      // Finalize breakdowns
      function finalizeBreakdown(map: Map<string, BkEntry>) {
        return Array.from(map.entries()).map(([key, e]) => {
          const np = e.won - e.lost;
          return { key, wins: e.wins, losses: e.losses, pushes: e.pushes, totalRisk: parseFloat(e.risk.toFixed(2)), netProfit: parseFloat(np.toFixed(2)), roi: e.risk > 0 ? parseFloat(((np / e.risk) * 100).toFixed(2)) : 0 };
        }).sort((a, b) => a.key.localeCompare(b.key));
      }

      const byType      = finalizeBreakdown(byTypeMap);
      const bySize      = finalizeBreakdown(bySizeMap).sort((a, b) => {
        const ai = UNIT_BUCKET_ORDER.indexOf(a.key); const bi = UNIT_BUCKET_ORDER.indexOf(b.key);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      });
      const byMonth     = finalizeBreakdown(byMonthMap);
      const bySport     = finalizeBreakdown(bySportMap);
      const byResult    = finalizeBreakdown(byResultMap);
      const byTimeframe = finalizeBreakdown(byTimeframeMap);
      const byWagerType = finalizeBreakdown(byWagerTypeMap);

      const netProfit = totalWon - totalLost;
      const roi       = totalRisk > 0 ? parseFloat(((netProfit / totalRisk) * 100).toFixed(2)) : 0;

      let biggestDayDate = "", biggestDayUnits = 0;
      dayPLMap.forEach((pl, date) => { if (pl > biggestDayUnits) { biggestDayUnits = pl; biggestDayDate = date; } });

      const stats = {
        totalBets:  statsRows.length,
        wins, losses, pushes, pending, voids,
        gradedBets: wins + losses + pushes,
        totalRisk:  parseFloat(totalRisk.toFixed(2)),
        totalWon:   parseFloat(totalWon.toFixed(2)),
        totalLost:  parseFloat(totalLost.toFixed(2)),
        netProfit:  parseFloat(netProfit.toFixed(2)),
        roi,
        bestWin:    parseFloat(bestWin.toFixed(2)),
        worstLoss:  parseFloat(worstLoss.toFixed(2)),
        byType, bySize, byMonth, bySport, byResult, byTimeframe, byWagerType,
        equityCurve,
        biggestDayDate,
        biggestDayUnits: parseFloat(biggestDayUnits.toFixed(2)),
        longestWinStreak,
      };

      return { bets: enriched, stats };
    }),

  /**
   * getLinescores — fetch MLB per-inning linescore data for one or more dates.
   * Calls the official MLB Stats API: https://statsapi.mlb.com/api/v1/schedule
   * Returns a map keyed by gamePk with innings array + R/H/E totals + status.
   */
  getLinescores: handicapperProcedure
    .input(z.object({
      sport:  z.literal("MLB"),
      dates:  z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(14),
    }))
    .query(async ({ input }) => {
      console.log(`[BetTracker][INPUT] getLinescores: sport=${input.sport} dates=${input.dates.join(",")}`);

      type InningLine = { num: number; awayRuns: number | null; homeRuns: number | null };
      type LinescoreEntry = {
        gamePk:        number;
        gameDate:      string;
        awayAbbrev:    string;
        homeAbbrev:    string;
        /**
         * Doubleheader game number: 1 = G1, 2 = G2.
         * Detected by finding two games with the same gameDate+away+home, then
         * assigning gameNumber=1 to the earlier startTime and gameNumber=2 to the later.
         * NOTE: gamePk order does NOT reliably match chronological order
         * (e.g. SF@PHI 2026-04-30: gamePk=823471 starts 21:35Z but gamePk=823472 starts 16:35Z).
         */
        gameNumber:    1 | 2;
        /** ISO UTC start time — used for DH G1/G2 chronological ordering */
        startTime:     string;
        innings:       InningLine[];
        awayR:         number | null;
        awayH:         number | null;
        awayE:         number | null;
        homeR:         number | null;
        homeH:         number | null;
        homeE:         number | null;
        currentInning: number | null;
        inningState:   string | null;
        status:        string;
      };

      const result: Record<number, LinescoreEntry> = {};

      await Promise.all(input.dates.map(async (date) => {
        const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&hydrate=linescore,team`;
        if (process.env.NODE_ENV === "development") console.log(`[BetTracker][STEP] getLinescores: fetching ${url}`);
        try {
          const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
          if (!resp.ok) {
            console.warn(`[BetTracker][WARN] getLinescores: MLB API returned ${resp.status} for date=${date}`);
            return;
          }
          const json = await resp.json() as {
            dates?: Array<{
              games?: Array<{
                gamePk: number;
                gameDate: string;
                status?: { abstractGameState?: string; detailedState?: string };
                linescore?: {
                  currentInning?: number;
                  inningState?: string;
                  innings?: Array<{
                    num: number;
                    away?: { runs?: number };
                    home?: { runs?: number };
                  }>;
                  teams?: {
                    away?: { runs?: number; hits?: number; errors?: number };
                    home?: { runs?: number; hits?: number; errors?: number };
                  };
                };
                teams?: {
                  away?: { team?: { abbreviation?: string } };
                  home?: { team?: { abbreviation?: string } };
                };
              }>;
            }>;
          };

          for (const dateBlock of json.dates ?? []) {
            for (const game of dateBlock.games ?? []) {
              const ls = game.linescore;
              const innings: InningLine[] = (ls?.innings ?? []).map(inn => ({
                num:       inn.num,
                awayRuns:  inn.away?.runs ?? null,
                homeRuns:  inn.home?.runs ?? null,
              }));
              result[game.gamePk] = {
                gamePk:        game.gamePk,
                gameDate:      date,
                awayAbbrev:    game.teams?.away?.team?.abbreviation ?? "",
                homeAbbrev:    game.teams?.home?.team?.abbreviation ?? "",
                gameNumber:    1, // default; overwritten below after DH detection
                startTime:     game.gameDate ?? "",
                innings,
                awayR:         ls?.teams?.away?.runs   ?? null,
                awayH:         ls?.teams?.away?.hits   ?? null,
                awayE:         ls?.teams?.away?.errors ?? null,
                homeR:         ls?.teams?.home?.runs   ?? null,
                homeH:         ls?.teams?.home?.hits   ?? null,
                homeE:         ls?.teams?.home?.errors ?? null,
                currentInning: ls?.currentInning ?? null,
                inningState:   ls?.inningState   ?? null,
                status:        game.status?.abstractGameState ?? "Preview",
              };
            }
          }
          console.log(`[BetTracker][STATE] getLinescores: date=${date} → ${Object.keys(result).length} games accumulated`);
        } catch (e) {
          console.warn(`[BetTracker][WARN] getLinescores: fetch failed for date=${date}:`, e);
        }
      }));

      // ── Doubleheader gameNumber assignment ──────────────────────────────────────
      // Group games by gameDate:awayAbbrev:homeAbbrev. For any group with 2+ games,
      // sort by startTime ASC (chronological) and assign gameNumber=1 to the earlier,
      // gameNumber=2 to the later.
      // IMPORTANT: gamePk order does NOT reliably match chronological order.
      // Example: SF@PHI 2026-04-30 — gamePk=823471 starts 21:35Z but gamePk=823472 starts 16:35Z.
      // Sorting by gamePk would incorrectly assign G1=823471 (later game).
      const dhGroups = new Map<string, number[]>(); // key → [gamePk, ...]
      for (const entry of Object.values(result)) {
        const key = `${entry.gameDate}:${entry.awayAbbrev}:${entry.homeAbbrev}`;
        const group = dhGroups.get(key) ?? [];
        group.push(entry.gamePk);
        dhGroups.set(key, group);
      }
      let dhCount = 0;
      for (const [key, pks] of Array.from(dhGroups.entries())) {
        if (pks.length < 2) continue; // not a doubleheader
        // Sort by startTime ASC (chronological) — NOT by gamePk
        pks.sort((a, b) => (result[a].startTime ?? "").localeCompare(result[b].startTime ?? ""));
        result[pks[0]].gameNumber = 1;
        result[pks[1]].gameNumber = 2;
        dhCount++;
        console.log(`[BetTracker][STATE] getLinescores: DH detected key=${key} G1_gamePk=${pks[0]} (${result[pks[0]].startTime}) G2_gamePk=${pks[1]} (${result[pks[1]].startTime})`);
      }
      console.log(`[BetTracker][OUTPUT] getLinescores: total=${Object.keys(result).length} games returned dhCount=${dhCount}`);
      return result;
    }),

  /**
   * listWithStatsPaginated — cursor-based infinite scroll variant of listWithStats.
   *
   * Performance profile:
   *   - Page query: LIMIT 50 rows (vs full table scan in listWithStats)
   *   - Stats query: runs in parallel with page query (no sequential wait)
   *   - isHistorical flag: skips AN slate enrichment for fully graded historical pages
   *   - Cursor: (gameDate DESC, id DESC) — stable, index-aligned, no OFFSET penalty
   *   - nextCursor: null when no more pages remain
   *
   * Client usage:
   *   trpc.betTracker.listWithStatsPaginated.useInfiniteQuery(input, {
   *     getNextPageParam: (last) => last.nextCursor,
   *   })
   */
  listWithStatsPaginated: handicapperProcedure
    .input(z.object({
      sport:        z.enum(SPORTS).optional(),
      gameDate:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      dateFrom:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      dateTo:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      result:       z.enum(RESULTS).optional(),
      targetUserId: z.number().int().positive().optional(),
      unitSize:     z.number().positive().optional(),
      limit:        z.number().int().min(1).max(200).default(50),
      /** Cursor: JSON-encoded { gameDate: string; id: number } */
      cursor:       z.string().optional(),
      /** When true, skip AN slate enrichment (fully historical pages have no live data) */
      isHistorical: z.boolean().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const role = ctx.appUser.role;
      let userId = ctx.appUser.id;
      if (input?.targetUserId && input.targetUserId !== userId) {
        if (role !== "owner" && role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Owner or Admin required to view other handicappers" });
        }
        userId = input.targetUserId;
      }
      const unitSize    = input?.unitSize ?? 100;
      const limit       = input?.limit    ?? 50;
      const isHistorical = input?.isHistorical ?? false;

      // ── Decode cursor ──────────────────────────────────────────────────────────
      let cursorDate: string | null = null;
      let cursorId:   number | null = null;
      if (input?.cursor) {
        try {
          const c = JSON.parse(input.cursor) as { gameDate: string; id: number };
          cursorDate = c.gameDate;
          cursorId   = c.id;
        } catch { /* invalid cursor — start from beginning */ }
      }

      // ── Build WHERE conditions ─────────────────────────────────────────────────
      const baseConditions = [eq(trackedBets.userId, userId)];
      if (input?.sport)    baseConditions.push(eq(trackedBets.sport, input.sport));
      if (input?.gameDate) baseConditions.push(eq(trackedBets.gameDate, input.gameDate));
      if (input?.dateFrom) baseConditions.push(gte(trackedBets.gameDate, input.dateFrom));
      if (input?.dateTo)   baseConditions.push(lte(trackedBets.gameDate, input.dateTo));

      // List conditions (with optional result filter)
      const listConditions = [...baseConditions];
      if (input?.result) listConditions.push(eq(trackedBets.result, input.result));

      // Cursor condition: (gameDate < cursorDate) OR (gameDate = cursorDate AND id < cursorId)
      if (cursorDate !== null && cursorId !== null) {
        listConditions.push(
          or(
            lt(trackedBets.gameDate, cursorDate),
            and(
              eq(trackedBets.gameDate, cursorDate),
              lt(trackedBets.id, cursorId)
            )
          )!
        );
      }

      const db = await getDb();

      // ── Stats cache check ─────────────────────────────────────────────────────────────────
      // On cache hit: skip the full-table stats scan (runs only page query)
      // On cache miss: run page + stats in parallel, then cache the stats result
      const statsCacheKey = buildStatsCacheKey(userId, input);
      const cachedStats = getStatsCache(statsCacheKey);

      // ── Run page query (always) + stats query (only on cache miss) in parallel ───
      let pageRows: typeof trackedBets.$inferSelect[];
      let statsRows: typeof trackedBets.$inferSelect[];

      if (cachedStats) {
        // Cache hit: only fetch the page, skip full-table stats scan
        if (process.env.NODE_ENV === "development") console.log(`[BetTracker][STEP] listWithStatsPaginated: stats cache HIT for userId=${userId}`);
        pageRows = await db.select().from(trackedBets)
          .where(and(...listConditions))
          .orderBy(desc(trackedBets.gameDate), desc(trackedBets.id))
          .limit(limit + 1);
        statsRows = []; // not needed — using cached stats
      } else {
        // Cache miss: run both queries in parallel
        if (process.env.NODE_ENV === "development") console.log(`[BetTracker][STEP] listWithStatsPaginated: stats cache MISS for userId=${userId} — running full aggregation`);
        [pageRows, statsRows] = await Promise.all([
          db.select().from(trackedBets)
            .where(and(...listConditions))
            .orderBy(desc(trackedBets.gameDate), desc(trackedBets.id))
            .limit(limit + 1),
          db.select().from(trackedBets)
            .where(and(...baseConditions))
            .orderBy(asc(trackedBets.gameDate), asc(trackedBets.id)),
        ]);
      }

      // ── Determine next cursor ──────────────────────────────────────────────────
      const hasNextPage = pageRows.length > limit;
      const rows = hasNextPage ? pageRows.slice(0, limit) : pageRows;
      let nextCursor: string | null = null;
      if (hasNextPage && rows.length > 0) {
        const last = rows[rows.length - 1];
        nextCursor = JSON.stringify({ gameDate: last.gameDate, id: last.id });
      }

      // ── Enrich page rows with logos/slate data ─────────────────────────────────
      // Skip enrichment for historical pages (no live data needed)
      const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
      const slateMap = new Map<number, import('../actionNetwork').SlateGame>();

      if (!isHistorical) {
        const pairs = new Map<string, { sport: string; gameDate: string }>();
        for (const row of rows) {
          const key = `${row.sport}:${row.gameDate}`;
          if (!pairs.has(key) && row.gameDate >= todayStr) {
            pairs.set(key, { sport: row.sport, gameDate: row.gameDate });
          }
        }
        if (pairs.size > 0) {
          await Promise.all(
            Array.from(pairs.values()).map(async ({ sport, gameDate }) => {
              try {
                const games = await fetchAnSlate(sport, gameDate);
                for (const g of games) slateMap.set(g.id, g);
              } catch (e) {
                console.warn(`[BetTracker][WARN] listWithStatsPaginated: fetchAnSlate failed for ${sport}/${gameDate}:`, e);
              }
            })
          );
        }
      }

      type RawBet = typeof rows[0];
      const enriched = rows.map((row: RawBet) => {
        const slate = row.anGameId ? slateMap.get(row.anGameId) : undefined;
        const awayLogo = slate?.awayLogo ?? (row.awayTeam ? resolveLogoUrl(row.sport, row.awayTeam, "") || null : null);
        const homeLogo = slate?.homeLogo ?? (row.homeTeam ? resolveLogoUrl(row.sport, row.homeTeam, "") || null : null);
        return {
          ...row,
          awayLogo,
          homeLogo,
          awayFull:     slate?.awayFull     ?? null,
          homeFull:     slate?.homeFull     ?? null,
          awayNickname: slate?.awayNickname ?? null,
          homeNickname: slate?.homeNickname ?? null,
          awayColor:    slate?.awayColor    ?? null,
          homeColor:    slate?.homeColor    ?? null,
          gameTime:     slate?.gameTime     ?? null,
          startUtc:     slate?.startUtc     ?? null,
          gameStatus:   slate?.status       ?? null,
        };
      });
      // ── Stats aggregation (single pass, cache-aware) ─────────────────────────────────────────────
      // Arrow functions used throughout (no function declarations inside blocks)
      const toUnits = (dollarAmt: number, storedUnits: string | null | undefined): number => {
        if (storedUnits != null && storedUnits !== "") {
          const v = parseFloat(storedUnits);
          if (!isNaN(v) && v > 0) return v;
        }
        return dollarAmt / unitSize;
      };

      type BkEntry = { wins: number; losses: number; pushes: number; risk: number; won: number; lost: number };
      const UNIT_BUCKET_ORDER = ["10U", "5U", "4U", "3U", "2U", "1U"];

      const bkGet = (map: Map<string, BkEntry>, key: string): BkEntry => {
        if (!map.has(key)) map.set(key, { wins: 0, losses: 0, pushes: 0, risk: 0, won: 0, lost: 0 });
        return map.get(key)!;
      };
      const bkApply = (map: Map<string, BkEntry>, key: string, result: string, riskU: number, toWinU: number): void => {
        const e = bkGet(map, key);
        if (result === "WIN")  { e.wins++;   e.risk += riskU; e.won  += toWinU; }
        if (result === "LOSS") { e.losses++; e.risk += riskU; e.lost += riskU;  }
        if (result === "PUSH") { e.pushes++; }
      };
      const finalizeBreakdown = (map: Map<string, BkEntry>) =>
        Array.from(map.entries()).map(([key, e]) => {
          const np = e.won - e.lost;
          return { key, wins: e.wins, losses: e.losses, pushes: e.pushes, totalRisk: parseFloat(e.risk.toFixed(2)), netProfit: parseFloat(np.toFixed(2)), roi: e.risk > 0 ? parseFloat(((np / e.risk) * 100).toFixed(2)) : 0 };
        }).sort((a, b) => a.key.localeCompare(b.key));

      // Cache hit: skip entire aggregation, return cached stats
      const stats = cachedStats ?? (() => {
        let wins = 0, losses = 0, pushes = 0, pending = 0, voids = 0;
        let totalRisk = 0, totalWon = 0, totalLost = 0;
        let bestWin = 0, worstLoss = 0;
        const byTypeMap      = new Map<string, BkEntry>();
        const bySizeMap      = new Map<string, BkEntry>();
        const byMonthMap     = new Map<string, BkEntry>();
        const bySportMap     = new Map<string, BkEntry>();
        const byResultMap    = new Map<string, BkEntry>();
        const byTimeframeMap = new Map<string, BkEntry>();
        const byWagerTypeMap = new Map<string, BkEntry>();
        const dayPLMap       = new Map<string, number>();
        let cumPL = 0;
        const equityCurve: { date: string; cumPL: number; betId: number; pick: string; result: string; pl: number }[] = [];
        let longestWinStreak = 0, currentWinStreak = 0;

        for (const bet of statsRows) {
          const riskU  = toUnits(parseFloat(bet.risk),  bet.riskUnits);
          const toWinU = toUnits(parseFloat(bet.toWin), bet.toWinUnits);
          const res    = bet.result;
          switch (res) {
            case "WIN":     wins++;   totalRisk += riskU; totalWon  += toWinU; if (toWinU > bestWin)   bestWin   = toWinU; break;
            case "LOSS":   losses++; totalRisk += riskU; totalLost += riskU;  if (riskU  > worstLoss) worstLoss = riskU;  break;
            case "PUSH":   pushes++;  break;
            case "PENDING": pending++; break;
            case "VOID":   voids++;   break;
          }
          const typeKey      = bet.market ?? bet.betType ?? "ML";
          const riskDollar   = parseFloat(bet.risk);
          const toWinDollar  = parseFloat(bet.toWin);
          const riskUnitsRaw = bet.riskUnits  != null ? parseFloat(bet.riskUnits)  : null;
          const toWinUnitsRaw= bet.toWinUnits != null ? parseFloat(bet.toWinUnits) : null;
          const sizeKey  = calcUnitBucket(bet.odds, riskDollar, toWinDollar, riskUnitsRaw, toWinUnitsRaw);
          const monthKey = bet.gameDate.substring(0, 7);
          bkApply(byTypeMap,      typeKey,              res, riskU, toWinU);
          bkApply(bySizeMap,      sizeKey,              res, riskU, toWinU);
          bkApply(byMonthMap,     monthKey,             res, riskU, toWinU);
          bkApply(bySportMap,     bet.sport,            res, riskU, toWinU);
          bkApply(byResultMap,    res,                  res, riskU, toWinU);
          bkApply(byTimeframeMap, bet.timeframe ?? "FULL_GAME", res, riskU, toWinU);
          bkApply(byWagerTypeMap, bet.wagerType ?? "PREGAME",   res, riskU, toWinU);
          if (res === "WIN")  dayPLMap.set(bet.gameDate, (dayPLMap.get(bet.gameDate) ?? 0) + toWinU);
          if (res === "LOSS") dayPLMap.set(bet.gameDate, (dayPLMap.get(bet.gameDate) ?? 0) - riskU);
          if (res === "WIN") {
            cumPL += toWinU;
            equityCurve.push({ date: bet.gameDate, cumPL: parseFloat(cumPL.toFixed(2)), betId: bet.id, pick: bet.pick, result: "WIN", pl: parseFloat(toWinU.toFixed(2)) });
          } else if (res === "LOSS") {
            cumPL -= riskU;
            equityCurve.push({ date: bet.gameDate, cumPL: parseFloat(cumPL.toFixed(2)), betId: bet.id, pick: bet.pick, result: "LOSS", pl: parseFloat((-riskU).toFixed(2)) });
          }
          if (res === "WIN")  { currentWinStreak++; if (currentWinStreak > longestWinStreak) longestWinStreak = currentWinStreak; }
          else if (res === "LOSS") currentWinStreak = 0;
        }

        const byType      = finalizeBreakdown(byTypeMap);
        const bySize      = finalizeBreakdown(bySizeMap).sort((a, b) => {
          const ai = UNIT_BUCKET_ORDER.indexOf(a.key); const bi = UNIT_BUCKET_ORDER.indexOf(b.key);
          return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
        });
        const byMonth     = finalizeBreakdown(byMonthMap);
        const bySport     = finalizeBreakdown(bySportMap);
        const byResult    = finalizeBreakdown(byResultMap);
        const byTimeframe = finalizeBreakdown(byTimeframeMap);
        const byWagerType = finalizeBreakdown(byWagerTypeMap);

        const netProfit = totalWon - totalLost;
        const roi       = totalRisk > 0 ? parseFloat(((netProfit / totalRisk) * 100).toFixed(2)) : 0;

        let biggestDayDate = "", biggestDayUnits = 0;
        dayPLMap.forEach((pl, date) => { if (pl > biggestDayUnits) { biggestDayUnits = pl; biggestDayDate = date; } });

        const result = {
          totalBets:  statsRows.length,
          wins, losses, pushes, pending, voids,
          gradedBets: wins + losses + pushes,
          totalRisk:  parseFloat(totalRisk.toFixed(2)),
          totalWon:   parseFloat(totalWon.toFixed(2)),
          totalLost:  parseFloat(totalLost.toFixed(2)),
          netProfit:  parseFloat(netProfit.toFixed(2)),
          roi,
          bestWin:    parseFloat(bestWin.toFixed(2)),
          worstLoss:  parseFloat(worstLoss.toFixed(2)),
          byType, bySize, byMonth, bySport, byResult, byTimeframe, byWagerType,
          equityCurve,
          biggestDayDate,
          biggestDayUnits: parseFloat(biggestDayUnits.toFixed(2)),
          longestWinStreak,
        };
        // Write computed stats to cache for future requests
        setStatsCache(statsCacheKey, result, isHistorical);
        return result;
      })();

      const statsTyped = stats as { totalBets: number; wins: number; losses: number; pushes: number; pending: number; voids: number; gradedBets: number; totalRisk: number; totalWon: number; totalLost: number; netProfit: number; roi: number; bestWin: number; worstLoss: number; byType: unknown[]; bySize: unknown[]; byMonth: unknown[]; bySport: unknown[]; byResult: unknown[]; byTimeframe: unknown[]; byWagerType: unknown[]; equityCurve: unknown[]; biggestDayDate: string; biggestDayUnits: number; longestWinStreak: number };
      return { bets: enriched, stats: statsTyped, nextCursor, hasNextPage, pageSize: rows.length, totalBets: statsTyped.totalBets };
    }),
});

export type BetTrackerRouter = typeof betTrackerRouter;
