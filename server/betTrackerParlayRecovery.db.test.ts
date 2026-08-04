/**
 * betTrackerParlayRecovery.db.test.ts — real-database proof for the four states
 * that used to leave a parlay ticket stranded on PENDING forever.
 *
 * Each of these is a claim about what a *query* returns when run against real
 * rows, which is exactly the class of bug the mocked suite cannot reach: a mock
 * returns whatever the author expected the predicate to match, so a sweep that
 * silently misses a row still "passes". Every one of these four was found with a
 * throwaway MySQL harness, and every one of them presented the same way to the
 * user — a ticket visible on their page, counted as open risk, that nothing in
 * the system would ever revisit.
 *
 * ── Test surface ──────────────────────────────────────────────────────────────
 *  [PR-1] a leg dated 7 days back is invisible to the today/yesterday window
 *         sweep, and only the all-dates sweep reaches it
 *  [PR-2] a ticket whose legs are ALL terminal has no open leg to drive
 *         settlement; only the "still PENDING with legCount>0" query rescues it,
 *         and folding it pays the divided-down price (and re-folding is a no-op)
 *  [PR-3] a leg stranded on an early date sits inside the parent's 36h alarm
 *         window for the life of the ticket; only the leg-level join sees it
 *  [PR-4] a ticket whose result was set outside the grader is not walked back to
 *         PENDING by a re-fold, even though settleParlay computes PENDING
 *
 * ── Why the sweeps are mirrored rather than called ────────────────────────────
 *  gradeParlaysForDate / gradeAllParlaysAllDates select open legs table-wide and
 *  then WRITE to every one they can grade. Calling them here would mutate rows
 *  belonging to whichever suite ran alongside this one in the shared db-tests
 *  database, and would put the score feed on the critical path of a DB test. So
 *  their WHERE clauses are reproduced verbatim with one extra betId predicate
 *  for isolation, and the functions that take explicit ids or only read
 *  (settleTickets, findStuckLegs, settleParlay) are called for real.
 *
 * ── Isolation ─────────────────────────────────────────────────────────────────
 *  Runs with --no-file-parallelism against the one shared db-tests database, so
 *  it owns userIds 880101–880104 and touches nothing else. Every leg it writes
 *  carries a "PRECOV-" pick marker so legs are still reclaimable if a previous
 *  run died before its parent rows were deleted; beforeAll and afterAll remove
 *  exactly those rows.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq, gt, inArray, like, sql } from "drizzle-orm";
/**
 * Gate on DB_TESTS alone, not on CI detection.
 *
 * The shared `_core/ciTestGuard` computes `IS_CI && DB_TESTS !== "1"`, so it
 * only skips INSIDE CI — on a developer machine it evaluates false, the suite
 * runs, `getDb()` returns null, and every test fails on a null connection.
 * That is why the older DB suites are carried in the environment-failure
 * allowlist.
 *
 * DB_TESTS is set by exactly one place — the DB Tests job in ci.yml, which is
 * also the only place a migrated database exists. Gating on it means the suite
 * runs there, skips in the plain Vitest job, skips locally, and needs no
 * allowlist entry to keep in sync.
 */
const SKIP_DB_SUITE = process.env.DB_TESTS !== "1";
import { getDb } from "./db";
import { trackedBets, trackedBetLegs } from "../drizzle/schema";
import { settleTickets, findStuckLegs, emptyParlaySummary } from "./parlayGrader";
import { settleParlay, type ParlayLeg } from "./parlayCore";
import { STUCK_THRESHOLD_HOURS } from "./betGradingHealth";
import type { BetResult, Market, PickSide, Timeframe } from "./betTrackerCore";

// ── Reserved namespace ────────────────────────────────────────────────────────
const U_WINDOW = 880101;        // [PR-1] leg outside the two-day sweep window
const U_FOLD = 880102;          // [PR-2] all legs terminal, ticket never folded
const U_STRANDED = 880103;      // [PR-3] early leg under a late-dated parent
const U_NO_DOWNGRADE = 880104;  // [PR-4] result set outside the grader
const USER_IDS = [U_WINDOW, U_FOLD, U_STRANDED, U_NO_DOWNGRADE];

/** Prefix on every leg `pick` this suite writes — the cleanup handle. */
const MARK = "PRECOV-";

// ── Dates ─────────────────────────────────────────────────────────────────────

/**
 * YYYY-MM-DD in America/Los_Angeles. The grading window is built from PT
 * (betAutoGradeScheduler.nowPst), so "today" and "yesterday" for the window
 * tests have to be PT dates or the boundary case is tested against the wrong
 * pair of days.
 */
function ptDate(daysAgo: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(Date.now() - daysAgo * 86_400_000));
}

/**
 * YYYY-MM-DD in UTC. The parent stuck-bet alarm measures with MySQL's
 * TIMESTAMPDIFF against UTC_TIMESTAMP(), so the age arithmetic in [PR-3] only
 * lands where intended if the dates are UTC.
 */
function utcDate(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
}

// ── Row factories ─────────────────────────────────────────────────────────────

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

interface TicketSpec {
  userId: number;
  gameDate: string;
  legCount: number;
  odds: number;
  originalOdds: number;
  result: BetResult;
  risk: string;
  toWin: string;
  riskUnits?: string | null;
  toWinUnits?: string | null;
}

/**
 * Insert a parlay parent shaped exactly as betTracker.createParlay writes it,
 * and read its id back with a SELECT rather than $returningId(). The insertId a
 * batched driver hands back is not something this suite needs to trust to make
 * its point, and one of the harnesses that preceded this file was chasing that
 * exact assumption.
 */
async function insertTicket(db: Db, spec: TicketSpec): Promise<number> {
  await db.insert(trackedBets).values({
    userId:       spec.userId,
    sport:        "MLB",
    gameDate:     spec.gameDate,
    betType:      "PARLAY",
    market:       "ML",        // NOT NULL column; parlays are keyed off legCount
    timeframe:    "FULL_GAME",
    pick:         `${MARK}ticket-${spec.userId}`,
    odds:         spec.odds,
    originalOdds: spec.originalOdds,
    legCount:     spec.legCount,
    risk:         spec.risk,
    toWin:        spec.toWin,
    riskUnits:    spec.riskUnits ?? null,
    toWinUnits:   spec.toWinUnits ?? null,
    wagerType:    "PREGAME",
    book:         "DK NJ",
    result:       spec.result,
  });

  const rows = await db
    .select({ id: trackedBets.id })
    .from(trackedBets)
    .where(eq(trackedBets.userId, spec.userId))
    .limit(1);
  const id = rows[0]?.id;
  if (id == null) throw new Error(`[insertTicket] ticket for userId=${spec.userId} did not persist`);
  console.log(`[insertTicket] [OUTPUT] userId=${spec.userId} betId=${id} legCount=${spec.legCount} originalOdds=${spec.originalOdds}`);
  return id;
}

interface LegSpec {
  legIndex: number;
  gameDate: string;
  odds: number;
  result: BetResult;
  market?: Market;
  pickSide?: PickSide;
  timeframe?: Timeframe;
  line?: string | null;
  awayTeam?: string;
  homeTeam?: string;
}

async function insertLegs(db: Db, betId: number, legs: LegSpec[]): Promise<void> {
  await db.insert(trackedBetLegs).values(
    legs.map(l => ({
      betId,
      legIndex:   l.legIndex,
      sport:      "MLB",
      gameDate:   l.gameDate,
      awayTeam:   l.awayTeam ?? "TEX",
      homeTeam:   l.homeTeam ?? "ATH",
      anGameId:   null,
      gameNumber: 1,
      market:     l.market ?? "ML",
      pickSide:   l.pickSide ?? "AWAY",
      timeframe:  l.timeframe ?? "FULL_GAME",
      line:       l.line ?? null,
      odds:       l.odds,
      pick:       `${MARK}${betId}-leg${l.legIndex}`,
      result:     l.result,
    })),
  );
}

async function loadTicket(db: Db, betId: number) {
  const rows = await db.select().from(trackedBets).where(eq(trackedBets.id, betId)).limit(1);
  return rows[0];
}

async function loadLegs(db: Db, betId: number) {
  return db
    .select()
    .from(trackedBetLegs)
    .where(eq(trackedBetLegs.betId, betId))
    .orderBy(trackedBetLegs.legIndex);
}

/** The leg shape settleParlay consumes, built from real rows. */
function toModelLegs(rows: Awaited<ReturnType<typeof loadLegs>>): ParlayLeg[] {
  return rows.map(l => ({
    legIndex:  l.legIndex,
    sport:     l.sport,
    gameDate:  l.gameDate,
    awayTeam:  l.awayTeam ?? "",
    homeTeam:  l.homeTeam ?? "",
    market:    (l.market ?? "ML") as Market,
    pickSide:  (l.pickSide ?? "AWAY") as PickSide,
    timeframe: (l.timeframe ?? "FULL_GAME") as Timeframe,
    odds:      l.odds,
    line:      l.line != null ? Number(l.line) : null,
    result:    l.result as BetResult,
  }));
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

/**
 * Legs go first and by marker, not by betId: a run that dies between the two
 * inserts leaves legs whose parent is already gone, and a betId-only cleanup
 * would never find them again.
 */
async function cleanup(): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(trackedBetLegs).where(like(trackedBetLegs.pick, `${MARK}%`));
  await db.delete(trackedBets).where(inArray(trackedBets.userId, USER_IDS));
}

/**
 * Resolved per test rather than once in beforeAll: a throwing hook collapses the
 * whole file into one failure, and the environment-failure gate reconciles
 * allowlist entries against individual test ids.
 */
async function requireDb(): Promise<Db> {
  const db = await getDb();
  expect(db, "no database reachable — set DATABASE_URL").toBeTruthy();
  return db!;
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe.skipIf(SKIP_DB_SUITE)("bet tracker parlay recovery — real-database invariants", () => {
  beforeAll(async () => { await cleanup(); });

  afterAll(async () => {
    await cleanup();
    console.log(`[afterAll] [STEP] removed legs LIKE '${MARK}%' and tickets for userIds ${USER_IDS.join(",")}`);
  });

  // ── [PR-1] the two-day window ───────────────────────────────────────────────

  it("[PR-1] a leg 7 days old is missed by the today/yesterday sweep and found only by the all-dates sweep", async () => {
    const db = await requireDb();
    const betId = await insertTicket(db, {
      userId: U_WINDOW,
      // The parent carries the LAST leg's date, which is why nothing at the
      // ticket level looks wrong while the old leg rots.
      gameDate: ptDate(0),
      legCount: 2, odds: 264, originalOdds: 264, result: "PENDING",
      risk: "50.00", toWin: "132.00",
    });
    await insertLegs(db, betId, [
      { legIndex: 0, gameDate: ptDate(7), odds: -110, result: "PENDING" }, // the stranded one
      { legIndex: 1, gameDate: ptDate(0), odds: -110, result: "PENDING" },
    ]);

    const legs = await loadLegs(db, betId);
    const strandedId = legs[0].id;
    const todayLegId = legs[1].id;
    console.log(`[INPUT] betId=${betId} strandedLeg=${strandedId}@${ptDate(7)} todayLeg=${todayLegId}@${ptDate(0)}`);

    // gradeParlaysForDate's predicate, once per date in the window
    // runBetGradeCycle sweeps. The betId predicate is isolation only.
    const windowLegs = await db
      .select({ id: trackedBetLegs.id, gameDate: trackedBetLegs.gameDate })
      .from(trackedBetLegs)
      .where(and(
        eq(trackedBetLegs.result, "PENDING"),
        inArray(trackedBetLegs.gameDate, [ptDate(0), ptDate(1)]),
        eq(trackedBetLegs.betId, betId),
      ));
    const windowIds = windowLegs.map(l => l.id);

    // The sweep is not vacuously empty — it does pick up the same ticket's
    // in-window leg. Without this half, a typo'd predicate would also "pass".
    expect(windowIds).toContain(todayLegId);
    expect(windowIds).not.toContain(strandedId);
    console.log(`[VERIFY] [PR-1] PASS — window sweep found ${windowIds.length} leg(s), not the ${ptDate(7)} one`);

    // gradeAllParlaysAllDates' predicate: open legs, no date filter at all.
    const allDateLegs = await db
      .select({ id: trackedBetLegs.id })
      .from(trackedBetLegs)
      .where(and(eq(trackedBetLegs.result, "PENDING"), eq(trackedBetLegs.betId, betId)));
    const allIds = allDateLegs.map(l => l.id);

    expect(allIds).toContain(strandedId);
    expect(allIds).toContain(todayLegId);
    console.log(`[VERIFY] [PR-1] PASS — all-dates sweep found both legs including the stranded ${ptDate(7)} one`);

    // And the ticket really is unsettleable while that leg is open, so a sweep
    // that never reaches it holds the ticket open indefinitely.
    expect(settleParlay(toModelLegs(legs), 264).result).toBe("PENDING");
  });

  // ── [PR-2] all legs terminal, ticket never folded ───────────────────────────

  it("[PR-2] a ticket with zero open legs is reachable only by the still-PENDING query, and folds to the divided-down price", async () => {
    const db = await requireDb();
    // +600 as entered, one leg pushes at -110. Repricing divides that leg's
    // decimal price out of 7.00 → 3.6667 → +267. Rebuilding the price from the
    // survivors instead would produce a different number here and would destroy
    // a correlated or boosted ticket outright.
    const betId = await insertTicket(db, {
      userId: U_FOLD, gameDate: ptDate(2), legCount: 3,
      odds: 600, originalOdds: 600, result: "PENDING",
      risk: "100.00", toWin: "600.00", riskUnits: "2.00", toWinUnits: "12.00",
    });
    await insertLegs(db, betId, [
      { legIndex: 0, gameDate: ptDate(2), odds: -110, result: "WIN" },
      { legIndex: 1, gameDate: ptDate(2), odds: 150, result: "WIN" },
      { legIndex: 2, gameDate: ptDate(2), odds: -110, result: "PUSH",
        market: "TOTAL", pickSide: "OVER", line: "8.5" },
    ]);
    console.log(`[INPUT] betId=${betId} legs=WIN/WIN/PUSH originalOdds=600 risk=100 riskUnits=2`);

    // Settlement only ever happens as a side effect of grading a leg, so a
    // ticket with nothing left to grade is unreachable from the leg sweep.
    const openLegs = await db
      .select({ id: trackedBetLegs.id })
      .from(trackedBetLegs)
      .where(and(eq(trackedBetLegs.result, "PENDING"), eq(trackedBetLegs.betId, betId)));
    expect(openLegs).toHaveLength(0);
    console.log(`[VERIFY] [PR-2] PASS — no open legs, so no leg-driven sweep would ever touch ticket ${betId}`);

    // gradeAllParlaysAllDates' second pass — the only thing that finds it.
    const stillOpen = await db
      .select({ id: trackedBets.id })
      .from(trackedBets)
      .where(and(
        eq(trackedBets.result, "PENDING"),
        gt(trackedBets.legCount, 0),
        eq(trackedBets.id, betId),
      ));
    expect(stillOpen.map(t => t.id)).toEqual([betId]);
    console.log(`[VERIFY] [PR-2] PASS — still-PENDING/legCount>0 query found ticket ${betId}`);

    const summary = emptyParlaySummary("ALL");
    await settleTickets([betId], summary);

    const after = await loadTicket(db, betId);
    expect(after.result).toBe("WIN");
    expect(after.odds).toBe(267);                 // 7.00 / 1.9091 = 3.6667 → +267
    expect(after.originalOdds).toBe(600);         // the basis never moves
    expect(Number(after.toWin)).toBeCloseTo(267, 2);
    expect(Number(after.toWinUnits)).toBeCloseTo(5.34, 2); // 267 / (100/2)
    expect(summary.ticketsSettled).toBe(1);
    console.log(`[VERIFY] [PR-2] PASS — folded to WIN @ ${after.odds} (toWin=${after.toWin}, units=${after.toWinUnits})`);

    // Re-folding must not divide again. This is the whole reason originalOdds
    // exists: grading re-runs every cycle, and a reprice that mutated `odds` in
    // place would decay a pushed ticket toward nothing over a day.
    const replay = emptyParlaySummary("ALL");
    await settleTickets([betId], replay);
    const twice = await loadTicket(db, betId);
    expect(twice.odds).toBe(267);
    expect(Number(twice.toWin)).toBeCloseTo(267, 2);
    expect(replay.ticketsSettled).toBe(0);
    console.log(`[VERIFY] [PR-2] PASS — re-fold wrote nothing (odds still ${twice.odds})`);
  });

  // ── [PR-3] stranded leg under a late-dated parent ───────────────────────────

  it("[PR-3] an early stranded leg never trips the parent 36h alarm; only the leg-level join sees it", async () => {
    const db = await requireDb();
    const betId = await insertTicket(db, {
      userId: U_STRANDED,
      // Dated by the LAST leg on purpose, so the stuck-bet alarm stays quiet
      // while earlier legs wait on later games. That choice is exactly what
      // hides a leg that stopped settling five days ago.
      gameDate: utcDate(0),
      legCount: 2, odds: 300, originalOdds: 300, result: "PENDING",
      risk: "25.00", toWin: "75.00",
    });
    await insertLegs(db, betId, [
      { legIndex: 0, gameDate: utcDate(5), odds: 120, result: "PENDING" },
      { legIndex: 1, gameDate: utcDate(0), odds: 150, result: "PENDING" },
    ]);
    const legs = await loadLegs(db, betId);
    const strandedLegId = legs[0].id;
    console.log(`[INPUT] betId=${betId} parentDate=${utcDate(0)} strandedLeg=${strandedLegId}@${utcDate(5)}`);

    // checkStuckBets' query, verbatim apart from the userId scope. It reads
    // tracked_bets only, so the ticket's own age is all it can measure.
    const parentRows = await db.execute(sql`
      SELECT id, userId, sport, gameDate, awayTeam, homeTeam,
             TIMESTAMPDIFF(HOUR, CONCAT(gameDate, ' 00:00:00'), UTC_TIMESTAMP()) AS hoursPending
      FROM tracked_bets
      WHERE result = 'PENDING'
        AND userId = ${U_STRANDED}
        AND TIMESTAMPDIFF(HOUR, CONCAT(gameDate, ' 00:00:00'), UTC_TIMESTAMP()) >= ${STUCK_THRESHOLD_HOURS}
    `);
    const parentStuck = ((parentRows as unknown as Array<Array<Record<string, unknown>>>)[0] ?? []);
    expect(parentStuck).toHaveLength(0);
    console.log(`[VERIFY] [PR-3] PASS — parent alarm silent: ticket ${betId} is dated ${utcDate(0)}, inside the ${STUCK_THRESHOLD_HOURS}h window`);

    // findStuckLegs joins legs to their ticket and ages each leg on its OWN
    // date, which is the only way this row becomes visible to an operator.
    const stuckLegs = (await findStuckLegs(STUCK_THRESHOLD_HOURS)).filter(l => l.betId === betId);
    expect(stuckLegs.map(l => l.legId)).toEqual([strandedLegId]);
    expect(stuckLegs[0].userId).toBe(U_STRANDED);   // the join carries the owner through
    expect(stuckLegs[0].gameDate).toBe(utcDate(5));
    expect(stuckLegs[0].hoursPending).toBeGreaterThanOrEqual(STUCK_THRESHOLD_HOURS);
    console.log(`[VERIFY] [PR-3] PASS — leg-level join found leg ${strandedLegId} at ${Math.floor(stuckLegs[0].hoursPending)}h pending`);

    // The join requires BOTH sides PENDING: once the ticket settles the leg
    // stops being an alarm, since the money is no longer open.
    await db.update(trackedBets).set({ result: "LOSS" }).where(eq(trackedBets.id, betId));
    const afterSettle = (await findStuckLegs(STUCK_THRESHOLD_HOURS)).filter(l => l.betId === betId);
    expect(afterSettle).toHaveLength(0);
    console.log(`[VERIFY] [PR-3] PASS — leg alarm clears once the ticket itself is no longer PENDING`);
  });

  // ── [PR-4] no downgrade of a hand-set result ────────────────────────────────

  it("[PR-4] a WIN set outside the grader survives a re-fold that computes PENDING", async () => {
    const db = await requireDb();
    // The shape an owner leaves behind after resolving a ticket the score feed
    // never will: the ticket is terminal, a leg is still open. A sweep that
    // wrote settleParlay's answer back unconditionally would undo that
    // correction on the next cycle, silently, every 30 minutes, forever.
    const betId = await insertTicket(db, {
      userId: U_NO_DOWNGRADE, gameDate: ptDate(1), legCount: 2,
      odds: 260, originalOdds: 260, result: "WIN",
      risk: "40.00", toWin: "104.00",
    });
    await insertLegs(db, betId, [
      { legIndex: 0, gameDate: ptDate(1), odds: 120, result: "WIN" },
      { legIndex: 1, gameDate: ptDate(1), odds: 120, result: "PENDING" },
    ]);
    console.log(`[INPUT] betId=${betId} ticketResult=WIN legs=WIN/PENDING`);

    const legs = await loadLegs(db, betId);
    const settlement = settleParlay(toModelLegs(legs), 260);
    expect(settlement.result).toBe("PENDING");
    expect(settlement.odds).toBeNull();
    console.log(`[STATE] settleParlay says PENDING (${settlement.reason}) — the guard has to refuse this write`);

    const summary = emptyParlaySummary("ALL");
    await settleTickets([betId], summary);

    const after = await loadTicket(db, betId);
    expect(after.result).toBe("WIN");
    expect(after.odds).toBe(260);
    expect(Number(after.toWin)).toBeCloseTo(104, 2);
    // Examined but deliberately skipped — proves the ticket was loaded and the
    // guard fired, rather than the sweep simply never reaching it.
    expect(summary.ticketsExamined).toBe(1);
    expect(summary.ticketsSettled).toBe(0);
    console.log(`[VERIFY] [PR-4] PASS — ticket ${betId} examined and left at WIN @ ${after.odds}, nothing written`);
  });
});
