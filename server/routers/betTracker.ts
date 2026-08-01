/**
 * betTracker.ts — tRPC router for the Bet Tracker feature.
 *
 * Role-based access model (v5 — 2026-07-31):
 *   USER         — every authenticated subscriber. Sees and manages ONLY their own
 *                  bets. `targetUserId` is rejected for this role.
 *   HANDICAPPER  — own bets only; bets are IMMUTABLE after creation (must submit
 *                  an edit/delete request for owner/admin review).
 *   ADMIN        — own bets, plus read/edit/delete of any non-owner user's bets.
 *   OWNER        — own bets, plus read of any user's bets. Owner bets are
 *                  protected from admin edit/delete.
 *
 * v5 changed the base procedure from `handicapperProcedure` to
 * `appUserProcedure`. Before, role=user was rejected outright, so a regular
 * subscriber could not read even their OWN bets. Two properties come with the
 * swap and are load-bearing:
 *   1. `appUserProcedure` enforces account expiry; `handicapperProcedure` did not.
 *   2. Widening the door does NOT widen visibility. Every read resolves its
 *      scope through `resolveScope`, which only ever returns a different userId
 *      for owner/admin. See betTrackerCore.resolveViewUserId + its test matrix.
 *
 * Owner/admin-only procedures: listHandicappers, getLogs, reviewEditRequest,
 * autoGradeAll.
 *
 * Grading is NOT implemented here. Every settle path (interactive, scheduled,
 * cron) calls the single engine in ../betAutoGradeScheduler.
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
import { appUserProcedure } from "./appUsers";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { trackedBets, appUsers, betEditRequests } from "../../drizzle/schema";
import { eq, and, desc, inArray, asc, gte, lte, lt, or } from "drizzle-orm";
import { fetchAnSlate, resolveLogoUrl } from "../actionNetwork";
import { gradePendingForUser, gradeAllPendingForDate } from "../betAutoGradeScheduler";
import {
  buildStatsCacheKey,
  getStatsCache,
  setStatsCache,
  invalidateStatsCacheForUser,
} from "../betTrackerStatsCache";
import {
  aggregateStats,
  calcToWin,
  decideBetMutation,
  decidePrivilegedAccess,
  decodeCursor,
  derivePickLabel,
  effectiveLine,
  encodeCursor,
  marketRequiresLine,
  resolveLineForUpdate,
  resolveViewUserId,
  toUnits as coreToUnits,
  type BetStats,
  type Market as CoreMarket,
  type PickSide as CorePickSide,
  type StatRow,
  type Timeframe as CoreTimeframe,
} from "../betTrackerCore";

// Re-exported for the scheduler's historical import path and for tests that
// assert cache behaviour through the router's public surface.
export { invalidateStatsCacheForUser } from "../betTrackerStatsCache";

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

// ─── Shared plumbing ──────────────────────────────────────────────────────────
//
// The stats cache lives in ../betTrackerStatsCache and the domain rules
// (permissions, stake math, line invariants, cursor codec, aggregation) live in
// ../betTrackerCore. Both are pure/dependency-light so they are unit-testable
// without a database — see server/betTrackerCore.test.ts.

/** Columns the stats aggregation actually reads. See StatRow in betTrackerCore. */
const STAT_COLUMNS = {
  id:         trackedBets.id,
  gameDate:   trackedBets.gameDate,
  result:     trackedBets.result,
  sport:      trackedBets.sport,
  market:     trackedBets.market,
  betType:    trackedBets.betType,
  timeframe:  trackedBets.timeframe,
  wagerType:  trackedBets.wagerType,
  pick:       trackedBets.pick,
  odds:       trackedBets.odds,
  risk:       trackedBets.risk,
  toWin:      trackedBets.toWin,
  riskUnits:  trackedBets.riskUnits,
  toWinUnits: trackedBets.toWinUnits,
} as const;

/** Throw the tRPC error a core decision describes, or fall through. */
function assertDecision(d: { allowed: boolean; code?: string; message?: string }): void {
  if (d.allowed) return;
  throw new TRPCError({ code: "FORBIDDEN", message: d.message ?? "Forbidden" });
}

/**
 * Resolve which user's rows a read may touch, throwing FORBIDDEN when a
 * non-privileged caller asks for someone else's. Every read procedure funnels
 * through this so the visibility rule has exactly one implementation.
 */
function resolveScope(ctx: { appUser: { id: number; role: string } }, targetUserId?: number): number {
  const res = resolveViewUserId({ role: ctx.appUser.role, viewerId: ctx.appUser.id, targetUserId });
  if (!res.ok) {
    console.log(`[BetTracker][ERROR] scope: FORBIDDEN — role=${ctx.appUser.role} viewer=${ctx.appUser.id} target=${targetUserId}`);
    throw new TRPCError({ code: "FORBIDDEN", message: res.message });
  }
  return res.userId;
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const betTrackerRouter = router({

  /**
   * listHandicappers — OWNER/ADMIN only: list all handicapper accounts.
   * Used by the BetTracker handicapper selector dropdown.
   * Returns all users with role owner/admin/handicapper so the selector
   * can show all accounts including prez (owner) and sippi (owner).
   */
  listHandicappers: appUserProcedure
    .query(async ({ ctx }) => {
      assertDecision(decidePrivilegedAccess(ctx.appUser.role, "list other users"));
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
   * create — add a new tracked bet for the calling user.
   *
   * Always self-scoped: there is no targetUserId. `pick` is derived from
   * pickSide + market + team abbreviations, `toWin` from odds + risk.
   *
   * INVARIANT (enforced by the .superRefine below): an RL or TOTAL bet must
   * carry a line. There is no safe default — guessing -1.5 inverts every
   * underdog run line on a one-run margin, and guessing 0 grades a spread as a
   * moneyline. Rejecting at write time is the only way the grader can be
   * trusted later.
   */
  create: appUserProcedure
    .input(z.object({
      // Game identification
      anGameId:   z.number().int().positive(),
      /** Doubleheader game number: 1 = G1, 2 = G2. Defaults to 1 for non-DH games. */
      gameNumber: z.number().int().min(1).max(2).default(1),
      sport:      z.enum(SPORTS).default("MLB"),
      // [FIX] Normalize gameDate: strip any time component (iOS Safari sends ISO datetime).
      // Transform runs BEFORE regex validation, so "2026-05-16T12:00:00" → "2026-05-16" passes.
      gameDate:   z.string()
        .transform(v => (v || "").slice(0, 10))
        .pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "gameDate must be YYYY-MM-DD")),
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
    }).superRefine((val, ctx) => {
      if (marketRequiresLine(val.market as CoreMarket) && effectiveLine(val.line, val.customLine) === null) {
        ctx.addIssue({
          code: "custom",
          path: ["line"],
          message: `${val.market} bets require a line (send line or customLine)`,
        });
      }
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
      // A bet logged for a past date can usually settle immediately. Delegated to
      // the shared engine rather than reimplemented here: the old inline copy had
      // already drifted from the scheduler's (it overwrote team abbreviations
      // whenever they differed, while the scheduler only filled blanks).
      const todayPt = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
      if (input.gameDate < todayPt) {
        try {
          const summary = await gradePendingForUser(userId, { gameDate: input.gameDate }, "create");
          console.log(`[BetTracker][STATE] create: autoGradeOnCreate — graded=${summary.graded} stillPending=${summary.stillPending} for date=${input.gameDate}`);
        } catch (gradeErr) {
          // Never fail the create because grading failed; the scheduler retries.
          console.error(`[BetTracker][ERROR] create: autoGradeOnCreate FAILED for betId=${insertId} — ${String(gradeErr)}`);
        }
      }

      const [created] = await db.select().from(trackedBets).where(eq(trackedBets.id, insertId));
      // Reflect the new bet in the next paginated read immediately.
      invalidateStatsCacheForUser(userId);
      return created;
    }),

  /**
   * update — update an existing bet.
   *
   * Access: see betTrackerCore.decideBetMutation (owner/user self-only, admin
   * may touch any non-owner bet, handicapper must use submitEditRequest).
   *
   * INVARIANT: the stored `line` is a SIGNED spread for RL and an UNSIGNED total
   * for TOTAL. Changing pickSide flips the spread's sign; changing market
   * invalidates the stored line entirely. Both are resolved here by
   * `resolveLineForUpdate` — previously neither was, so flipping AWAY↔HOME on a
   * run line silently inverted the grade on every one-run margin, and switching
   * RL→TOTAL reused "-1.5" as a total so every OVER won.
   */
  update: appUserProcedure
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
      const [betOwner] = await db
        .select({ id: appUsers.id, role: appUsers.role })
        .from(appUsers)
        .where(eq(appUsers.id, existing.userId));
      const betOwnerRole = betOwner?.role ?? "user";

      assertDecision(decideBetMutation({
        actorRole: role,
        actorId: userId,
        betOwnerId: existing.userId,
        betOwnerRole,
        action: "update",
      }));

      // ── Build update payload ──────────────────────────────────────────────────
      const patch: Record<string, unknown> = {};
      if (input.timeframe  !== undefined) patch.timeframe  = input.timeframe;
      if (input.market     !== undefined) patch.market     = input.market;
      if (input.pickSide   !== undefined) patch.pickSide   = input.pickSide;
      if (input.notes      !== undefined) patch.notes      = input.notes;
      if (input.result     !== undefined) patch.result     = input.result;
      if (input.wagerType  !== undefined) patch.wagerType  = input.wagerType;

      const newMarket   = (input.market   ?? existing.market)   as typeof MARKETS[number];
      const newPickSide = (input.pickSide ?? existing.pickSide) as typeof PICK_SIDES[number];

      // ── Line resolution (the RL/TOTAL invariant) ──────────────────────────────
      const lineRes = resolveLineForUpdate({
        prevMarket:     existing.market as CoreMarket,
        nextMarket:     newMarket as CoreMarket,
        prevPickSide:   existing.pickSide as CorePickSide,
        nextPickSide:   newPickSide as CorePickSide,
        prevLine:       existing.line,
        prevCustomLine: existing.customLine,
        nextLine:       input.line,
        nextCustomLine: input.customLine,
      });
      if (!lineRes.ok) {
        console.log(`[BetTracker][ERROR] update: betId=${input.id} ${lineRes.message}`);
        throw new TRPCError({ code: "BAD_REQUEST", message: lineRes.message });
      }
      // Only patch the line columns when they actually change, so an unrelated
      // edit (a note, say) stays a no-op instead of rewriting the row.
      const nextLineStr   = lineRes.line === null ? null : String(lineRes.line);
      const nextCustomStr = lineRes.customLine === null ? null : String(lineRes.customLine);
      const sameDecimal = (a: string | null, b: string | null): boolean => {
        if (a === null || b === null) return a === b;
        return Math.abs(parseFloat(a) - parseFloat(b)) < 1e-9;
      };
      if (!sameDecimal(nextLineStr, existing.line ?? null)) patch.line = nextLineStr;
      if (!sameDecimal(nextCustomStr, existing.customLine ?? null)) patch.customLine = nextCustomStr;
      if (lineRes.flipped) {
        console.log(`[BetTracker][STATE] update: betId=${input.id} RL side flip ${existing.pickSide}→${newPickSide} — line sign inverted to ${lineRes.line}`);
      }

      // Re-derive pick label if market, pickSide or timeframe changed.
      // Timeframe matters: an NRFI/YRFI bet's label is the timeframe, not the
      // team, and the previous version dropped it so editing an NRFI bet
      // relabelled it "<TEAM> ML".
      const newTimeframe = (input.timeframe ?? existing.timeframe) as CoreTimeframe;
      if (input.market !== undefined || input.pickSide !== undefined || input.timeframe !== undefined) {
        const awayTeam = existing.awayTeam ?? "";
        const homeTeam = existing.homeTeam ?? "";
        patch.pick    = derivePickLabel(newPickSide as CorePickSide, newMarket as CoreMarket, awayTeam, homeTeam, newTimeframe);
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
      // Invalidate the cache of the bet's OWNER, not the actor. An admin editing
      // a handicapper's bet used to clear its own (empty) entries and leave the
      // handicapper staring at stale W/L and ROI for the full TTL.
      invalidateStatsCacheForUser(existing.userId);
      if (existing.userId !== userId) invalidateStatsCacheForUser(userId);
      return updated;
    }),

  /**
   * delete — remove a bet by id.
   * Access: see betTrackerCore.decideBetMutation.
   */
  delete: appUserProcedure
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

      assertDecision(decideBetMutation({
        actorRole: role,
        actorId: userId,
        betOwnerId: existing.userId,
        betOwnerRole,
        action: "delete",
      }));

      await db.delete(trackedBets).where(eq(trackedBets.id, input.id));
      console.log(`[BetTracker][OUTPUT] delete: SUCCESS — betId=${input.id} ownedBy=${existing.userId} deletedBy=${userId} role=${role}`);
      // Invalidate the OWNER's cache (see the same note on update).
      invalidateStatsCacheForUser(existing.userId);
      if (existing.userId !== userId) invalidateStatsCacheForUser(userId);
      return { success: true, deletedId: input.id };
    }),

  /**
   * submitEditRequest — handicapper submits an EDIT or DELETE request for their own bet.
   * The bet itself is NOT modified. Owner/Admin reviews via reviewEditRequest.
   */
  submitEditRequest: appUserProcedure
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
  reviewEditRequest: appUserProcedure
    .input(z.object({
      requestId:  z.number().int().positive(),
      action:     z.enum(["APPROVE", "DENY"]),
      reviewNote: z.string().max(2000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.appUser.id;
      const role   = ctx.appUser.role;
      console.log(`[BetTracker][INPUT] reviewEditRequest: reviewerId=${userId} role=${role} requestId=${input.requestId} action=${input.action}`);

      assertDecision(decidePrivilegedAccess(role, "review edit requests"));

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
        // APPROVED: hard-delete the request row — approved requests are removed immediately.
        // No orphaned APPROVED records ever accumulate in the table.
        // DENIED requests are kept as permanent audit trail (see else branch below).
        await db.delete(betEditRequests).where(eq(betEditRequests.id, input.requestId));
        console.log(`[BetTracker][OUTPUT] reviewEditRequest: APPROVED — requestId=${input.requestId} hard-deleted from bet_edit_requests by reviewerId=${userId}`);
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
      // Invalidate stats cache for the bet owner so approved changes are reflected immediately
      invalidateStatsCacheForUser(bet.userId);
      return { success: true, requestId: input.requestId, action: input.action };
    }),

  /**
   * getLogs — OWNER/ADMIN only: full audit log of all bets created and all edit requests.
   * Used by the LOGS tab for transparency and integrity monitoring.
   * Returns:
   *   - bets: all tracked_bets with user info (username, role)
   *   - editRequests: all bet_edit_requests with requester + reviewer info
   */
  getLogs: appUserProcedure
    .input(z.object({
      limit:  z.number().int().positive().max(500).default(200),
      offset: z.number().int().min(0).default(0),
    }).optional())
    .query(async ({ ctx, input }) => {
      const role = ctx.appUser.role;
      assertDecision(decidePrivilegedAccess(role, "view audit logs"));

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
  getSlate: appUserProcedure
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
   * autoGrade — settle the calling user's PENDING bets.
   *
   * Thin delegate to the ONE grading engine in ../betAutoGradeScheduler. The
   * previous inline copy of the loop had drifted from the scheduler's, so the
   * same bet could settle differently depending on which path reached it first.
   *
   * Always self-scoped. Grading another user's bets is autoGradeAll (owner/admin).
   */
  autoGrade: appUserProcedure
    .input(z.object({
      sport:    z.enum(SPORTS).optional(),
      gameDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).optional())
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.appUser.id;
      const summary = await gradePendingForUser(
        userId,
        { sport: input?.sport, gameDate: input?.gameDate },
        "trpc_autoGrade",
      );
      return {
        graded:       summary.graded,
        wins:         summary.wins,
        losses:       summary.losses,
        pushes:       summary.pushes,
        voids:        summary.voids,
        stillPending: summary.stillPending,
        total:        summary.total,
        details:      summary.details,
      };
    }),

  /**
   * autoGradeAll — OWNER/ADMIN only: settle every user's PENDING bets for a date.
   * Same engine as autoGrade and as the background scheduler.
   */
  autoGradeAll: appUserProcedure
    .input(z.object({
      gameDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }))
    .mutation(async ({ ctx, input }) => {
      assertDecision(decidePrivilegedAccess(ctx.appUser.role, "grade every user's bets"));
      console.log(`[BetTracker][INPUT] autoGradeAll: triggeredBy=${ctx.appUser.username} date=${input.gameDate}`);
      const summary = await gradeAllPendingForDate(input.gameDate, "trpc_autoGradeAll");
      return {
        graded:       summary.graded,
        wins:         summary.wins,
        losses:       summary.losses,
        pushes:       summary.pushes,
        voids:        summary.voids,
        stillPending: summary.stillPending,
        total:        summary.total,
      };
    }),


  /**
   * getLinescores — fetch MLB per-inning linescore data for one or more dates.
   * Calls the official MLB Stats API: https://statsapi.mlb.com/api/v1/schedule
   * Returns a map keyed by gamePk with innings array + R/H/E totals + status.
   */
  getLinescores: appUserProcedure
    .input(z.object({
      sport:  z.literal("MLB"),
      // max(14) bounds the per-request MLB API fan-out (Promise.all below).
      // Clients spanning more dates MUST batch into ≤14-date chunks and merge
      // (see BetTracker.tsx mlbDateChunks) — an oversized array 400s.
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
   * listWithStatsPaginated — THE Bet Tracker read. One procedure, one aggregation.
   *
   * Returns a cursor page of enriched bets plus the full stats block computed
   * over the WHOLE filtered set (not just the page). `getStats`, `list` and
   * `listWithStats` used to sit alongside this with three separate copies of the
   * aggregation; they had drifted, and the copy the UI actually called was the
   * thinnest — silently omitting dollar P&L, drawdown, ATH, current-run,
   * worst-day and the equity-point metadata the charts read. All three are gone;
   * aggregation now happens exactly once, in betTrackerCore.aggregateStats.
   *
   * Query shape:
   *   - Page query: LIMIT n+1 on (gameDate DESC, id DESC) — keyset, no OFFSET.
   *     Served by idx_tb_user_date / idx_tb_user_sport_date.
   *   - Stats query: the full filtered set, but projected to the 14 columns the
   *     aggregation reads instead of SELECT * (which dragged notes, book, scores
   *     and timestamps across the wire on every cache miss).
   *   - Stats are memoized per (resolved user × filters × unitSize), so pages
   *     2..n never re-scan.
   *
   * On why the aggregation is not a GROUP BY: the block spans seven independent
   * breakdown dimensions plus an order-dependent equity curve, drawdown and
   * streak walk. MySQL/TiDB has no GROUPING SETS, so that would be 7+ round
   * trips plus a row fetch for the curve — strictly more work than one indexed
   * narrow scan folded in a single pass. The projection is where the win is.
   *
   * Client usage:
   *   trpc.betTracker.listWithStatsPaginated.useInfiniteQuery(input, {
   *     getNextPageParam: (last) => last.nextCursor,
   *   })
   */
  listWithStatsPaginated: appUserProcedure
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
      const userId = resolveScope(ctx, input?.targetUserId);
      const unitSize     = input?.unitSize ?? 100;
      const limit        = input?.limit    ?? 50;
      const isHistorical = input?.isHistorical ?? false;

      const cursor = decodeCursor(input?.cursor);

      // ── WHERE ──────────────────────────────────────────────────────────────────
      const baseConditions = [eq(trackedBets.userId, userId)];
      if (input?.sport)    baseConditions.push(eq(trackedBets.sport, input.sport));
      if (input?.gameDate) baseConditions.push(eq(trackedBets.gameDate, input.gameDate));
      if (input?.dateFrom) baseConditions.push(gte(trackedBets.gameDate, input.dateFrom));
      if (input?.dateTo)   baseConditions.push(lte(trackedBets.gameDate, input.dateTo));

      // The result filter narrows the LIST only. Stats are always computed over
      // the unfiltered set so the header does not change when the user filters
      // the table to "losses".
      const listConditions = [...baseConditions];
      if (input?.result) listConditions.push(eq(trackedBets.result, input.result));

      if (cursor) {
        listConditions.push(
          or(
            lt(trackedBets.gameDate, cursor.gameDate),
            and(eq(trackedBets.gameDate, cursor.gameDate), lt(trackedBets.id, cursor.id)),
          )!
        );
      }

      const db = await getDb();

      const statsCacheKey = buildStatsCacheKey(userId, { ...input, unitSize });
      const cachedStats = getStatsCache<BetStats>(statsCacheKey);

      const pageQuery = db.select().from(trackedBets)
        .where(and(...listConditions))
        .orderBy(desc(trackedBets.gameDate), desc(trackedBets.id))
        .limit(limit + 1);

      let pageRows: typeof trackedBets.$inferSelect[];
      let stats: BetStats;

      if (cachedStats) {
        pageRows = await pageQuery;
        stats = cachedStats;
      } else {
        const [page, statRows] = await Promise.all([
          pageQuery,
          db.select(STAT_COLUMNS).from(trackedBets)
            .where(and(...baseConditions))
            .orderBy(asc(trackedBets.gameDate), asc(trackedBets.id)),
        ]);
        pageRows = page;
        stats = aggregateStats(statRows as StatRow[], unitSize);
        setStatsCache(statsCacheKey, stats, isHistorical);
      }

      // ── Cursor for the next page ───────────────────────────────────────────────
      const hasNextPage = pageRows.length > limit;
      const rows = hasNextPage ? pageRows.slice(0, limit) : pageRows;
      const nextCursor = hasNextPage && rows.length > 0
        ? encodeCursor({ gameDate: rows[rows.length - 1].gameDate, id: rows[rows.length - 1].id })
        : null;

      // ── Enrich page rows with logos / live slate data ──────────────────────────
      // Historical pages skip the Action Network round trip entirely; past dates
      // resolve logos from the in-memory team map (O(1), no HTTP).
      const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
      const slateMap = new Map<number, import("../actionNetwork").SlateGame>();

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

      const enriched = rows.map((row) => {
        const slate = row.anGameId ? slateMap.get(row.anGameId) : undefined;
        return {
          ...row,
          awayLogo: slate?.awayLogo ?? (row.awayTeam ? resolveLogoUrl(row.sport, row.awayTeam, "") || null : null),
          homeLogo: slate?.homeLogo ?? (row.homeTeam ? resolveLogoUrl(row.sport, row.homeTeam, "") || null : null),
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

      return {
        bets: enriched,
        stats,
        nextCursor,
        hasNextPage,
        pageSize: rows.length,
        totalBets: stats.totalBets,
      };
    }),


  /**
   * getCalendarData — returns per-day unit P/L for a given year-month and user.
   * Used by the Pikkit-style calendar recap component.
   *
   * Returns:
   *   days: Array<{ date: string; units: number; wins: number; losses: number; pushes: number; pending: number }>
   *   monthRecord: { wins: number; losses: number; pushes: number; netUnits: number }
   */
  getCalendarData: appUserProcedure
    .input(z.object({
      /** YYYY-MM — the month to compute calendar data for */
      yearMonth:    z.string().regex(/^\d{4}-\d{2}$/),
      targetUserId: z.number().int().positive().optional(),
      unitSize:     z.number().positive().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const userId = resolveScope(ctx, input.targetUserId);
      const unitSize = input.unitSize ?? 100;
      const dateFrom = `${input.yearMonth}-01`;
      // Last day of month: go to first day of next month then subtract 1 day
      const [y, m] = input.yearMonth.split("-").map(Number);
      const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
      const dateTo = (() => {
        const d = new Date(`${nextMonth}-01T12:00:00Z`);
        d.setUTCDate(d.getUTCDate() - 1);
        return d.toISOString().slice(0, 10);
      })();

      console.log(`[BetTracker][INPUT] getCalendarData: userId=${userId} yearMonth=${input.yearMonth} dateFrom=${dateFrom} dateTo=${dateTo}`);

      const db = await getDb();
      const rows = await db
        .select({
          id:          trackedBets.id,
          gameDate:    trackedBets.gameDate,
          result:      trackedBets.result,
          risk:        trackedBets.risk,
          toWin:       trackedBets.toWin,
          riskUnits:   trackedBets.riskUnits,
          toWinUnits:  trackedBets.toWinUnits,
        })
        .from(trackedBets)
        .where(
          and(
            eq(trackedBets.userId, userId),
            gte(trackedBets.gameDate, dateFrom),
            lte(trackedBets.gameDate, dateTo),
          )
        )
        .orderBy(asc(trackedBets.gameDate), asc(trackedBets.id));

      console.log(`[BetTracker][STATE] getCalendarData: ${rows.length} bets found for ${input.yearMonth}`);

      // Unit normalization comes from betTrackerCore so the calendar can never
      // disagree with the stats block about what a bet is worth in units.
      const toUnits = (dollarAmt: number, storedUnits: string | null | undefined): number =>
        coreToUnits(dollarAmt, storedUnits, unitSize);

      // Per-day aggregation
      type DayEntry = { units: number; wins: number; losses: number; pushes: number; pending: number; betCount: number; totalRisk: number };
      const dayMap = new Map<string, DayEntry>();

      let monthWins = 0, monthLosses = 0, monthPushes = 0, monthNetUnits = 0, monthTotalRisk = 0;

      for (const bet of rows) {
        const riskU  = toUnits(parseFloat(bet.risk),  bet.riskUnits);
        const toWinU = toUnits(parseFloat(bet.toWin), bet.toWinUnits);
        const res    = bet.result as string;
        const date   = bet.gameDate;

        if (!dayMap.has(date)) dayMap.set(date, { units: 0, wins: 0, losses: 0, pushes: 0, pending: 0, betCount: 0, totalRisk: 0 });
        const day = dayMap.get(date)!;
        day.betCount++;

        if (res === "WIN") {
          day.units += toWinU;
          day.wins++;
          day.totalRisk += riskU;
          monthWins++;
          monthNetUnits += toWinU;
          monthTotalRisk += riskU;
        } else if (res === "LOSS") {
          day.units -= riskU;
          day.losses++;
          day.totalRisk += riskU;
          monthLosses++;
          monthNetUnits -= riskU;
          monthTotalRisk += riskU;
        } else if (res === "PUSH") {
          day.pushes++;
          monthPushes++;
        } else if (res === "PENDING") {
          day.pending++;
        }
      }

      const sortedDays = Array.from(dayMap.entries())
        .map(([date, d]) => ({
          date,
          units:     parseFloat(d.units.toFixed(2)),
          wins:      d.wins,
          losses:    d.losses,
          pushes:    d.pushes,
          pending:   d.pending,
          betCount:  d.betCount,
          totalRisk: parseFloat(d.totalRisk.toFixed(2)),
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      // Equity curve: cumulative units per day (only graded days)
      let cumulative = 0;
      const equityCurve: { date: string; cumUnits: number }[] = [];
      for (const d of sortedDays) {
        if (d.wins > 0 || d.losses > 0) {
          cumulative += d.units;
          equityCurve.push({ date: d.date, cumUnits: parseFloat(cumulative.toFixed(2)) });
        }
      }

      // Best / worst day
      let bestDay: string | null = null, bestDayUnits = -Infinity;
      let worstDay: string | null = null, worstDayUnits = Infinity;
      for (const d of sortedDays) {
        if (d.wins > 0 || d.losses > 0) {
          if (d.units > bestDayUnits)  { bestDayUnits  = d.units; bestDay  = d.date; }
          if (d.units < worstDayUnits) { worstDayUnits = d.units; worstDay = d.date; }
        }
      }

      // Streaks: computed over graded bets in chronological order
      const gradedBets = rows.filter((b: typeof rows[number]) => b.result === "WIN" || b.result === "LOSS");
      let longestWinStreak = 0, longestLossStreak = 0;
      let curWin = 0, curLoss = 0;
      let currentStreakType: "W" | "L" | null = null;
      let currentStreakCount = 0;
      for (const bet of gradedBets) {
        if (bet.result === "WIN") {
          curWin++; curLoss = 0;
          if (curWin > longestWinStreak) longestWinStreak = curWin;
          currentStreakType = "W"; currentStreakCount = curWin;
        } else {
          curLoss++; curWin = 0;
          if (curLoss > longestLossStreak) longestLossStreak = curLoss;
          currentStreakType = "L"; currentStreakCount = curLoss;
        }
      }
      const currentStreak = currentStreakType ? `${currentStreakType}${currentStreakCount}` : null;

      const gradedCount = monthWins + monthLosses;
      const winPct = gradedCount > 0 ? parseFloat(((monthWins / gradedCount) * 100).toFixed(1)) : 0;
      const roi    = monthTotalRisk > 0 ? parseFloat(((monthNetUnits / monthTotalRisk) * 100).toFixed(1)) : 0;

      const monthRecord = {
        wins:              monthWins,
        losses:            monthLosses,
        pushes:            monthPushes,
        netUnits:          parseFloat(monthNetUnits.toFixed(2)),
        winPct,
        roi,
        longestWinStreak,
        longestLossStreak,
        currentStreak,
        bestDay,
        bestDayUnits:      bestDay  ? parseFloat(bestDayUnits.toFixed(2))  : null,
        worstDay,
        worstDayUnits:     worstDay ? parseFloat(worstDayUnits.toFixed(2)) : null,
      };

      console.log(`[BetTracker][OUTPUT] getCalendarData: ${sortedDays.length} active days monthRecord=${JSON.stringify(monthRecord)} equityCurve=${equityCurve.length} points`);
      return { days: sortedDays, monthRecord, equityCurve };
    }),
});

export type BetTrackerRouter = typeof betTrackerRouter;
