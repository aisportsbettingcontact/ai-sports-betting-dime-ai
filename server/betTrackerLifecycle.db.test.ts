/**
 * betTrackerLifecycle.db.test.ts — real-database invariants for bet deletion,
 * per-user isolation, orphaned legs, and keyset paging.
 *
 * These five behaviours have no FK, no unique index and no constraint holding
 * them up. `tracked_bet_legs` has no `userId` and no foreign key to
 * `tracked_bets` (the schema uses none anywhere), so the ONLY thing that keeps a
 * ticket's legs deleted, private and reachable is application code. A mocked
 * suite cannot fail when that code is wrong, because the mock is written from
 * the same assumption as the code.
 *
 * Runs in the isolated-MySQL `db-tests` CI job (DB_TESTS=1). Confined to
 * userIds 880201–880205 and a far-future date namespace (2126-03-xx) so it can
 * never see or touch real rows. The far-future dates are also load-bearing for
 * a second reason: `create` auto-grades any bet dated before today, which would
 * pull the score feed over the network into a database test.
 *
 * ── Test surface ──────────────────────────────────────────────────────────────
 *  [DEL-1]  betTracker.delete removes the ticket AND every one of its leg rows
 *  [DEL-2]  no leg in the namespace points at a ticket that no longer exists
 *  [ORPH-1] a leg orphaned by a parent-only delete is still returned by the sweep
 *  [ORPH-2] …and is invisible to findStuckLegs, so it is graded forever, silently
 *  [ISO-1]  a per-user query returns only that user's rows
 *  [ISO-2]  a non-privileged caller cannot scope a read to another user
 *  [ISO-3]  legs are reachable only through their own owner's ticket ids
 *  [LC-1]   the straight-bet sweep selection returns ONLY the straight bet
 *  [LC-2]   …and returns the ticket too once legCount=0 is dropped
 *  [PAGE-1] keyset paging emits the true settled set exactly once, in order
 *  [PAGE-2] page sizes and the terminal cursor match the true total
 *  [PAGE-3] settledOnly narrows the list without narrowing stats
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
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
import { appUsers, trackedBets, trackedBetLegs } from "../drizzle/schema";
import { appRouter } from "./routers";
import { APP_USER_COOKIE, signAppUserToken } from "./routers/appUsers";
import { findStuckLegs, settleTickets, emptyParlaySummary } from "./parlayGrader";
import type { TrpcContext } from "./_core/context";
import bcrypt from "bcryptjs";

// ── Namespace ─────────────────────────────────────────────────────────────────
// CI replays the full migration chain into ONE shared database and runs the
// db suites with --no-file-parallelism, so isolation between suites is by
// reserved id range, not by table ownership. Nothing outside these ids is read
// or written.
const U_PAGER    = 880201; // owns the stable paging fixture — no test mutates it
const U_NEIGHBOR = 880202; // the other side of every isolation assertion
const U_CASCADE  = 880203; // delete / orphan tests create and destroy rows here
const U_FILTER   = 880204; // the legCount=0 sweep filter
const U_OWNER    = 880205; // privileged control for [ISO-2]
const NS_USERS = [U_PAGER, U_NEIGHBOR, U_CASCADE, U_FILTER, U_OWNER];

const D1 = "2126-03-01";
const D2 = "2126-03-02";
const D3 = "2126-03-03";
const D4 = "2126-03-04"; // the 9-row tie group that page boundaries must cut through
const D5 = "2126-03-05";
const D_PARLAY = "2126-03-06";
const D_FILTER = "2126-03-07";
const D_ORPHAN = "2126-03-08";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Result = "PENDING" | "WIN" | "LOSS" | "PUSH" | "VOID";

/** Every ticket id this suite has created, so afterAll can reach legs whose parent is already gone. */
const createdBetIds = new Set<number>();

// ── Fixtures ──────────────────────────────────────────────────────────────────

async function insertUser(db: Db, id: number, role: "owner" | "user"): Promise<void> {
  await db.insert(appUsers).values({
    id,
    email: `btlife_${id}@test.invalid`,
    username: `testuser_btlife_${id}`,
    passwordHash: await bcrypt.hash("BtLife1!Test", 4),
    role,
    hasAccess: true,
    expiryDate: null,
    tokenVersion: 1,
    pendingSetup: false,
  });
}

/** A straight bet, written directly: legCount stays 0 and originalOdds stays NULL. */
function straight(userId: number, gameDate: string, result: Result, odds: number) {
  return {
    userId,
    sport: "MLB",
    gameDate,
    anGameId: 8802000 + Math.abs(odds),
    betType: "ML" as const,
    market: "ML" as const,
    pickSide: "AWAY" as const,
    timeframe: "FULL_GAME" as const,
    pick: `NS ${gameDate} ${result}`,
    odds,
    risk: "100.00",
    toWin: "90.91",
    riskUnits: "1.00",
    toWinUnits: "0.91",
    result,
  };
}

/** Two ML legs and one TOTAL leg — a shape createParlay actually accepts. */
function parlayInput(gameDate: string, anBase: number) {
  return {
    legs: [
      { anGameId: anBase + 1, sport: "MLB" as const, gameDate, awayTeam: "NYY", homeTeam: "BOS", market: "ML" as const,    pickSide: "AWAY" as const, odds: -110, line: null },
      { anGameId: anBase + 2, sport: "MLB" as const, gameDate, awayTeam: "LAD", homeTeam: "SF",  market: "ML" as const,    pickSide: "HOME" as const, odds: +120, line: null },
      { anGameId: anBase + 3, sport: "MLB" as const, gameDate, awayTeam: "HOU", homeTeam: "SEA", market: "TOTAL" as const, pickSide: "OVER" as const, odds: -105, line: 8.5 },
    ],
    odds: +595,
    risk: 50,
  };
}

/**
 * A caller authenticated as a real app_user, exactly as tokenVersion.db.test.ts
 * builds one. No Origin header, so the CSRF check takes its server-to-server
 * exemption rather than rejecting every mutation.
 */
async function callerFor(userId: number, role: "owner" | "user") {
  const jwt = await signAppUserToken(userId, role, 1);
  const ctx: TrpcContext = {
    req: {
      protocol: "http",
      headers: { cookie: `${APP_USER_COOKIE}=${jwt}` },
      method: "POST",
      get: (_name: string) => undefined,
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" } as unknown as NodeJS.Socket,
      cookies: {},
    } as TrpcContext["req"],
    res: { cookie: () => {}, clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
  return appRouter.createCaller(ctx);
}

// ── Sweep-query mirrors ───────────────────────────────────────────────────────
//
// Deliberately re-stated here rather than invoked: both real entry points
// (betAutoGradeScheduler.gradeAllPendingForDate, parlayGrader.gradeParlaysForDate)
// call the score feed on the row they select, which a database test must not do.
// What is under test is the SELECT, and these are that SELECT verbatim.

/** parlayGrader.gradeParlaysForDate — open legs on a date, no join to the parent. */
async function sweepOpenLegs(db: Db, date: string) {
  return db.select().from(trackedBetLegs)
    .where(and(eq(trackedBetLegs.result, "PENDING"), eq(trackedBetLegs.gameDate, date)));
}

/** betAutoGradeScheduler.gradeAllPendingForDate — pending straight bets on a date. */
async function sweepPendingStraights(db: Db, date: string) {
  return db.select({ id: trackedBets.id, legCount: trackedBets.legCount }).from(trackedBets)
    .where(and(
      eq(trackedBets.result, "PENDING"),
      eq(trackedBets.gameDate, date),
      eq(trackedBets.legCount, 0),
    ));
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

async function cleanup(): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const owned = await db.select({ id: trackedBets.id }).from(trackedBets)
    .where(inArray(trackedBets.userId, NS_USERS));
  const legParents = new Set<number>([
    ...Array.from(createdBetIds),
    ...owned.map((r: { id: number }) => r.id),
  ]);
  if (legParents.size > 0) {
    await db.delete(trackedBetLegs).where(inArray(trackedBetLegs.betId, Array.from(legParents)));
  }
  await db.delete(trackedBets).where(inArray(trackedBets.userId, NS_USERS));
  await db.delete(appUsers).where(inArray(appUsers.id, NS_USERS));
}

/** The stable fixture: nothing below this line may mutate U_PAGER or U_NEIGHBOR. */
let pagerParlayId = 0;
let neighborParlayId = 0;

describe.skipIf(SKIP_DB_SUITE)("betTracker lifecycle — deletion, isolation and orphans (real database)", () => {
  beforeAll(async () => {
    const db = await getDb();
    expect(db).toBeTruthy();
    await cleanup(); // a crashed earlier run must not poison this one

    for (const id of NS_USERS) await insertUser(db!, id, id === U_OWNER ? "owner" : "user");

    // 23 settled + 7 unsettled for the pager. Nine rows share D4 so that a
    // page boundary lands INSIDE a tie group: that is the only arrangement in
    // which a cursor missing its id tiebreaker misbehaves, by re-emitting the
    // whole date (duplicates) or skipping the rest of it (omissions).
    await db!.insert(trackedBets).values([
      ...Array.from({ length: 3 }, (_, i) => straight(U_PAGER, D5, i === 1 ? "LOSS" : "WIN", -110 - i)),
      ...Array.from({ length: 9 }, (_, i) => straight(U_PAGER, D4, i % 3 === 0 ? "LOSS" : "WIN", -120 - i)),
      straight(U_PAGER, D3, "WIN", -130),
      ...Array.from({ length: 7 }, (_, i) => straight(U_PAGER, D2, i % 2 === 0 ? "WIN" : "LOSS", -140 - i)),
      ...Array.from({ length: 3 }, (_, i) => straight(U_PAGER, D1, "LOSS", -150 - i)),
      // Excluded by settledOnly, counted by stats — [PAGE-3] turns on the gap.
      straight(U_PAGER, D5, "PENDING", -160),
      straight(U_PAGER, D4, "PENDING", -161),
      straight(U_PAGER, D3, "PENDING", -162),
      straight(U_PAGER, D1, "PENDING", -163),
      straight(U_PAGER, D4, "PUSH", -164),
      straight(U_PAGER, D2, "PUSH", -165),
      straight(U_PAGER, D3, "VOID", -166),
      // The neighbour, for [ISO-1].
      straight(U_NEIGHBOR, D4, "WIN", -111),
      straight(U_NEIGHBOR, D2, "LOSS", -112),
    ]);

    // Both parlays go through the real write path, so legCount and the leg rows
    // are whatever production actually stores rather than what a fixture asserts.
    pagerParlayId    = (await (await callerFor(U_PAGER, "user")).betTracker.createParlay(parlayInput(D_PARLAY, 8802100))).id;
    neighborParlayId = (await (await callerFor(U_NEIGHBOR, "user")).betTracker.createParlay(parlayInput(D_PARLAY, 8802200))).id;
    createdBetIds.add(pagerParlayId).add(neighborParlayId);
  });

  afterAll(async () => { await cleanup(); });

  // ── Deletion cascade ────────────────────────────────────────────────────────

  it("[DEL-1] delete removes the ticket and every leg row it owned", async () => {
    const db = await getDb();
    const caller = await callerFor(U_CASCADE, "user");

    const { id: betId } = await caller.betTracker.createParlay(parlayInput(D_PARLAY, 8802300));
    createdBetIds.add(betId);

    const before = await db!.select().from(trackedBetLegs).where(eq(trackedBetLegs.betId, betId));
    expect(before).toHaveLength(3);
    expect(before.every((l: { result: string }) => l.result === "PENDING")).toBe(true);

    const res = await caller.betTracker.delete({ id: betId });
    expect(res).toMatchObject({ success: true, deletedId: betId });

    const ticket = await db!.select({ id: trackedBets.id }).from(trackedBets).where(eq(trackedBets.id, betId));
    expect(ticket).toHaveLength(0);
    const legs = await db!.select({ id: trackedBetLegs.id }).from(trackedBetLegs).where(eq(trackedBetLegs.betId, betId));
    expect(legs).toHaveLength(0); // the whole point: no FK would have done this
  });

  it("[DEL-2] no leg in the namespace points at a ticket that no longer exists", async () => {
    const db = await getDb();
    const parents = Array.from(createdBetIds);
    const legs = await db!
      .select({ id: trackedBetLegs.id, betId: trackedBetLegs.betId })
      .from(trackedBetLegs)
      .where(inArray(trackedBetLegs.betId, parents));
    const live = new Set(
      (await db!.select({ id: trackedBets.id }).from(trackedBets).where(inArray(trackedBets.id, parents)))
        .map((r: { id: number }) => r.id),
    );
    const orphans = legs.filter((l: { betId: number }) => !live.has(l.betId));
    expect(orphans).toEqual([]);
  });

  // ── Why the cascade matters ─────────────────────────────────────────────────

  it("[ORPH-1,2] a parent-only delete strands legs the sweep still grades and the alarm cannot see", async () => {
    const db = await getDb();
    const caller = await callerFor(U_CASCADE, "user");

    const { id: betId } = await caller.betTracker.createParlay(parlayInput(D_ORPHAN, 8802400));
    createdBetIds.add(betId);
    // Exactly what delete would do without its `if (existing.legCount > 0)`
    // block: drop the parent, leave the children.
    await db!.delete(trackedBets).where(eq(trackedBets.id, betId));

    // [ORPH-1] The leg sweep reads tracked_bet_legs alone, so a missing parent
    // changes nothing about what it picks up. Every cycle, forever, this leg is
    // re-fetched from the score feed and re-graded.
    const swept = await sweepOpenLegs(db!, D_ORPHAN);
    expect(swept.filter((l: { betId: number }) => l.betId === betId)).toHaveLength(3);

    // …and the work is thrown away: settleTickets loads the parent by id and
    // finds nothing, so the ticket is never examined, never settled, never
    // errored on.
    const summary = emptyParlaySummary(D_ORPHAN);
    await settleTickets([betId], summary);
    expect(summary.ticketsExamined).toBe(0);
    expect(summary.errors).toBe(0);

    // [ORPH-2] findStuckLegs is the alarm that would otherwise catch a leg
    // pending too long — but it INNER JOINs to tracked_bets, so the orphan is
    // the one open leg it structurally cannot report. The pager's live ticket
    // proves the query itself is not simply returning nothing.
    const stuck = await findStuckLegs(Number.NEGATIVE_INFINITY);
    const stuckBetIds = new Set(stuck.map((r: { betId: number }) => r.betId));
    expect(stuckBetIds.has(betId)).toBe(false);
    expect(stuckBetIds.has(pagerParlayId)).toBe(true);
    console.log(`[ORPH] betId=${betId} — swept legs=3, ticketsExamined=0, visible to findStuckLegs=false`);

    await db!.delete(trackedBetLegs).where(eq(trackedBetLegs.betId, betId));
    expect(await sweepOpenLegs(db!, D_ORPHAN)).toHaveLength(0); // a correct cascade ends the sweep
  });

  // ── User isolation ──────────────────────────────────────────────────────────

  it("[ISO-1] a per-user query returns only that user's rows", async () => {
    const db = await getDb();
    const pagerRows    = await db!.select({ id: trackedBets.id, userId: trackedBets.userId }).from(trackedBets).where(eq(trackedBets.userId, U_PAGER));
    const neighborRows = await db!.select({ id: trackedBets.id, userId: trackedBets.userId }).from(trackedBets).where(eq(trackedBets.userId, U_NEIGHBOR));

    expect(pagerRows).toHaveLength(31);   // 23 settled + 7 unsettled + 1 ticket
    expect(neighborRows).toHaveLength(3); // 2 settled + 1 ticket
    expect(pagerRows.every((r: { userId: number }) => r.userId === U_PAGER)).toBe(true);
    expect(neighborRows.every((r: { userId: number }) => r.userId === U_NEIGHBOR)).toBe(true);

    const overlap = new Set(neighborRows.map((r: { id: number }) => r.id));
    expect(pagerRows.filter((r: { id: number }) => overlap.has(r.id))).toEqual([]);

    // The same through the procedure the UI calls, which is where a dropped
    // userId predicate would actually leak.
    const page = await (await callerFor(U_NEIGHBOR, "user")).betTracker.listWithStatsPaginated({ limit: 200, isHistorical: true });
    expect(page.bets.map(b => b.id).sort()).toEqual(neighborRows.map((r: { id: number }) => r.id).sort());
  });

  it("[ISO-2] a non-privileged caller cannot scope a read to another user", async () => {
    await expect(
      (await callerFor(U_NEIGHBOR, "user")).betTracker.listWithStatsPaginated({ targetUserId: U_PAGER, limit: 10, isHistorical: true }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // The control: the gate is a permission decision, not a query that returns
    // nothing. An owner asking for the same rows gets them — and gets ONLY them.
    const asOwner = await (await callerFor(U_OWNER, "owner")).betTracker.listWithStatsPaginated({ targetUserId: U_NEIGHBOR, limit: 200, isHistorical: true });
    expect(asOwner.bets).toHaveLength(3);
    expect(asOwner.bets.every(b => b.userId === U_NEIGHBOR)).toBe(true);
  });

  it("[ISO-3] legs are reachable only through their own owner's ticket ids", async () => {
    const db = await getDb();
    // tracked_bet_legs has no userId column. A leg's owner is defined SOLELY by
    // its parent's userId, so any leg read that forgets to constrain betId to
    // the caller's tickets returns other people's selections with no error.
    const legsOf = async (userId: number) =>
      (await db!
        .select({ id: trackedBetLegs.id, betId: trackedBetLegs.betId })
        .from(trackedBetLegs)
        .innerJoin(trackedBets, eq(trackedBets.id, trackedBetLegs.betId))
        .where(eq(trackedBets.userId, userId))).map((r: { id: number }) => r.id);

    const pagerLegs = await legsOf(U_PAGER);
    const neighborLegs = await legsOf(U_NEIGHBOR);
    expect(pagerLegs).toHaveLength(3);
    expect(neighborLegs).toHaveLength(3);
    expect(pagerLegs.filter((id: number) => neighborLegs.includes(id))).toEqual([]);

    // The page read's own leg-attachment query, scoped to the pager's ticket
    // ids: it must not reach the neighbour's ticket even though both tickets
    // sit on the same date with identically shaped legs.
    const attached = await db!.select().from(trackedBetLegs).where(inArray(trackedBetLegs.betId, [pagerParlayId]));
    expect(attached.map((l: { betId: number }) => l.betId)).toEqual([pagerParlayId, pagerParlayId, pagerParlayId]);
    expect(attached.some((l: { betId: number }) => l.betId === neighborParlayId)).toBe(false);

    // And the counterfactual that makes the scoping load-bearing rather than
    // decorative: the two tickets were created with the SAME date, market,
    // side, line and price, so a leg query keyed on what a leg looks like
    // returns both users' selections. Shape is not identity here — betId is
    // the only column that separates one person's ticket from another's.
    const byShape = await db!
      .select({ id: trackedBetLegs.id, betId: trackedBetLegs.betId })
      .from(trackedBetLegs)
      .where(and(
        eq(trackedBetLegs.gameDate, D_PARLAY),
        eq(trackedBetLegs.market, "TOTAL"),
        eq(trackedBetLegs.pickSide, "OVER"),
        eq(trackedBetLegs.odds, -105),
      ));
    expect(new Set(byShape.map((l: { betId: number }) => l.betId))).toEqual(new Set([pagerParlayId, neighborParlayId]));

    const page = await (await callerFor(U_PAGER, "user")).betTracker.listWithStatsPaginated({ gameDate: D_PARLAY, limit: 50, isHistorical: true });
    const ticket = page.bets.find(b => b.id === pagerParlayId)!;
    expect(ticket.legs.map((l: { id: number }) => l.id).sort()).toEqual(pagerLegs.sort());
  });

  // ── The legCount=0 sweep filter ─────────────────────────────────────────────

  it("[LC-1,2] the straight-bet sweep selection excludes the parlay parent", async () => {
    const db = await getDb();
    const caller = await callerFor(U_FILTER, "user");

    // Both PENDING, both on the SAME date — otherwise the date predicate alone
    // would separate them and the test would pass without legCount doing
    // anything. A ticket is dated by its last leg, so this collision is normal.
    const bet = await caller.betTracker.create({
      anGameId: 8802501, sport: "MLB", gameDate: D_FILTER,
      awayTeam: "NYM", homeTeam: "ATL", market: "ML", pickSide: "AWAY",
      odds: -115, risk: 100,
    });
    const straightId = (bet as { id: number }).id;
    createdBetIds.add(straightId);
    const { id: ticketId } = await caller.betTracker.createParlay(parlayInput(D_FILTER, 8802600));
    createdBetIds.add(ticketId);

    const [ticketRow] = await db!.select().from(trackedBets).where(eq(trackedBets.id, ticketId));
    const [straightRow] = await db!.select().from(trackedBets).where(eq(trackedBets.id, straightId));
    expect(ticketRow.gameDate).toBe(straightRow.gameDate);
    expect(ticketRow.legCount).toBe(3);
    expect(ticketRow.originalOdds).toBe(595);
    expect(straightRow.legCount).toBe(0);
    expect(straightRow.originalOdds).toBeNull();

    // Both sweep mirrors below are the production SELECT verbatim, which means
    // they are NOT scoped to a user — so the assertions are narrowed to this
    // suite's own ids instead. Asserting on the raw global result would make
    // this test fail the day another suite in the shared CI database happens to
    // leave a PENDING row on 2126-03-07, in a file that did nothing wrong.
    const ours = (rows: { id: number }[]) =>
      rows.map(r => r.id).filter(id => createdBetIds.has(id)).sort((a, b) => a - b);

    // [LC-1] The ticket has no anGameId and no pickSide; graded as a straight
    // bet it resolves to no game and logs NO_MATCH on every cycle.
    const swept = await sweepPendingStraights(db!, D_FILTER);
    expect(ours(swept)).toEqual([straightId]);

    // [LC-2] Drop legCount=0 and the ticket comes back — the filter is doing
    // the work, not the WHERE clause around it.
    const unfiltered = await db!.select({ id: trackedBets.id }).from(trackedBets)
      .where(and(eq(trackedBets.result, "PENDING"), eq(trackedBets.gameDate, D_FILTER)));
    expect(ours(unfiltered)).toEqual([straightId, ticketId].sort((a, b) => a - b));
  });

  // ── Keyset pagination ───────────────────────────────────────────────────────

  it("[PAGE-1,2] paging the settled set emits every row exactly once, in order", async () => {
    const db = await getDb();
    // The truth, computed independently of the pager: the same ordering the
    // procedure claims, from one unpaged query.
    const truth = (await db!
      .select({ id: trackedBets.id })
      .from(trackedBets)
      .where(and(eq(trackedBets.userId, U_PAGER), inArray(trackedBets.result, ["WIN", "LOSS"])))
      .orderBy(desc(trackedBets.gameDate), desc(trackedBets.id))).map((r: { id: number }) => r.id);
    expect(truth).toHaveLength(23);

    const caller = await callerFor(U_PAGER, "user");
    const limit = 4; // 23 = 5×4 + 3, so boundaries fall inside the 9-row D4 group
    const seen: number[] = [];
    const pageSizes: number[] = [];
    let cursor: string | undefined;
    let guard = 0;

    for (;;) {
      const page = await caller.betTracker.listWithStatsPaginated({ settledOnly: true, limit, cursor, isHistorical: true });
      seen.push(...page.bets.map(b => b.id));
      pageSizes.push(page.bets.length);
      if (++guard > 20) throw new Error("pager did not terminate — cursor is not advancing");
      if (!page.hasNextPage) { expect(page.nextCursor).toBeNull(); break; }
      expect(page.nextCursor).toBeTruthy();
      cursor = page.nextCursor!;
    }

    // Sequence equality, not set equality: a cursor that drops the id
    // tiebreaker re-emits or skips the rest of a shared date, and both show up
    // here as a mismatch rather than as an off-by-one in a count.
    expect(seen).toEqual(truth);
    expect(new Set(seen).size).toBe(seen.length);
    expect(pageSizes).toEqual([4, 4, 4, 4, 4, 3]);
  });

  it("[PAGE-3] settledOnly narrows the list without narrowing stats", async () => {
    const caller = await callerFor(U_PAGER, "user");
    const settled = await caller.betTracker.listWithStatsPaginated({ settledOnly: true, limit: 200, isHistorical: true });
    const all     = await caller.betTracker.listWithStatsPaginated({ limit: 200, isHistorical: true });

    expect(settled.bets).toHaveLength(23);
    expect(all.bets).toHaveLength(31);
    // The header must not move when the table is filtered, so both reads
    // aggregate the same 31 rows.
    expect(settled.stats.totalBets).toBe(31);
    expect(settled.stats.totalBets).toBe(all.stats.totalBets);
    expect(settled.bets.every(b => b.result === "WIN" || b.result === "LOSS")).toBe(true);
    expect(settled.bets.some(b => b.id === pagerParlayId)).toBe(false); // PENDING ticket
    expect(all.bets.some(b => b.id === pagerParlayId)).toBe(true);
  });
});
