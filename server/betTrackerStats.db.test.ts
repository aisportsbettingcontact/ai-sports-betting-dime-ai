/**
 * betTrackerStats.db.test.ts — Real-database invariants for the Bet Tracker
 * stats block: rows are read back out of MySQL with the router's own
 * projection and handed to `aggregateStats` untouched.
 *
 * The mocked unit suites (parlayWiring.test.ts, betTrackerEquityCurve.test.ts)
 * hand-build `StatRow` literals, which silently repairs the two things that
 * actually broke in production: mysql2 hands DECIMAL back as a *string*, and a
 * parlay parent's `market` column is not null — it holds the schema default
 * "ML". A literal written by hand can carry `risk: 100` and `market: "PARLAY"`,
 * neither of which the database is capable of producing. Every row here comes
 * from a real SELECT so the real types, decimal strings and nulls are what the
 * aggregation sees.
 *
 * ── Test surface ─────────────────────────────────────────────────────────────
 *  [BTS-1] a parlay files under PARLAY in byType, not under its "ML" market
 *  [BTS-2] a straight bet still files under its own market column
 *  [BTS-3] the parlay's single stake is counted once, not once per leg
 *  [BTS-4] WIN/LOSS/PUSH/VOID/PENDING counts match what was inserted
 *  [BTS-5] DECIMAL columns arrive as strings and parse into risk/toWin/units
 *  [BTS-6] equity curve carries one point per P&L-moving bet
 *  [BTS-7] downsampleEquityCurve bounds the curve; ath/maxDrawdown stay
 *          computed over the FULL series and their points survive thinning
 *
 * ── Isolation ────────────────────────────────────────────────────────────────
 *  CI runs the db-tests job with --no-file-parallelism against ONE shared
 *  database, so this suite owns userId range 880301–880399 and far-future
 *  gameDates (2126-…). Every row it creates is deleted in afterAll; beforeAll
 *  repeats the delete so a previously crashed run cannot poison a fresh one.
 *  Nothing outside the reserved userId range is ever read or written.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, asc, eq, inArray } from "drizzle-orm";
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
import {
  aggregateStats,
  downsampleEquityCurve,
  type StatRow,
  type BetStats,
} from "./betTrackerCore";

// ── Reserved namespace ────────────────────────────────────────────────────────
const USER_MIXED = 880301;   // parlay + straights across every result
const USER_DECIMAL = 880302; // decimal-string / null-units parsing
const USER_CURVE = 880303;   // 40-point equity curve for thinning
const ALL_USERS = [USER_MIXED, USER_DECIMAL, USER_CURVE];

const UNIT_SIZE = 100;

/**
 * The exact projection `betTracker.listWithStatsPaginated` feeds to
 * `aggregateStats` (STAT_COLUMNS). Duplicated here on purpose: if the router
 * ever drops a column from it — `legCount` was added late, and its absence is
 * what filed every ticket under moneyline — this suite must keep reading the
 * full set so the drop shows up as a router bug and not as a silent pass.
 */
const STAT_COLUMNS = {
  id: trackedBets.id,
  gameDate: trackedBets.gameDate,
  result: trackedBets.result,
  sport: trackedBets.sport,
  market: trackedBets.market,
  betType: trackedBets.betType,
  timeframe: trackedBets.timeframe,
  wagerType: trackedBets.wagerType,
  pick: trackedBets.pick,
  odds: trackedBets.odds,
  risk: trackedBets.risk,
  toWin: trackedBets.toWin,
  riskUnits: trackedBets.riskUnits,
  toWinUnits: trackedBets.toWinUnits,
  legCount: trackedBets.legCount,
} as const;

type RawStatRow = Awaited<ReturnType<ReturnType<typeof selectStatRows>>>[number];

function selectStatRows(userId: number) {
  return async () => {
    const db = await getDb();
    // Same ORDER BY the router uses. aggregateStats documents that rows MUST
    // arrive (gameDate ASC, id ASC) — the equity curve, streaks and drawdown
    // are all order-dependent, and MySQL returns no order without one.
    return db!
      .select(STAT_COLUMNS)
      .from(trackedBets)
      .where(eq(trackedBets.userId, userId))
      .orderBy(asc(trackedBets.gameDate), asc(trackedBets.id));
  };
}

async function loadStats(userId: number): Promise<{ rows: RawStatRow[]; stats: BetStats }> {
  const rows = await selectStatRows(userId)();
  const stats = aggregateStats(rows as StatRow[], UNIT_SIZE);
  console.log(`[loadStats] [OUTPUT] userId=${userId} rows=${rows.length} totalBets=${stats.totalBets}`);
  return { rows, stats };
}

const entry = (stats: BetStats, key: string) => stats.byType.find(e => e.key === key);

// ── Cleanup ───────────────────────────────────────────────────────────────────
/**
 * Legs are deleted by looking their parent ids up first rather than by a
 * userId join: `tracked_bet_legs` has no userId column and no FK cascade, so a
 * ticket deleted on its own leaves orphan legs behind in the shared CI database
 * forever.
 */
async function cleanup(): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const ids = await db
    .select({ id: trackedBets.id })
    .from(trackedBets)
    .where(inArray(trackedBets.userId, ALL_USERS));
  if (ids.length > 0) {
    await db.delete(trackedBetLegs).where(inArray(trackedBetLegs.betId, ids.map(r => r.id)));
  }
  await db.delete(trackedBets).where(inArray(trackedBets.userId, ALL_USERS));
  console.log(`[cleanup] [STEP] removed ${ids.length} tracked_bets rows (+legs) for userIds ${ALL_USERS.join(",")}`);
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** One straight bet: legCount stays 0 and originalOdds stays NULL by omission. */
async function insertStraight(v: {
  userId: number;
  gameDate: string;
  market: "ML" | "RL" | "TOTAL";
  betType: "ML" | "RL" | "OVER" | "UNDER";
  result: "PENDING" | "WIN" | "LOSS" | "PUSH" | "VOID";
  odds: number;
  risk: string;
  toWin: string;
  riskUnits: string | null;
  toWinUnits: string | null;
  sport?: string;
}): Promise<void> {
  const db = await getDb();
  await db!.insert(trackedBets).values({
    userId: v.userId,
    sport: v.sport ?? "MLB",
    gameDate: v.gameDate,
    market: v.market,
    betType: v.betType,
    timeframe: "FULL_GAME",
    wagerType: "PREGAME",
    pick: `${v.market} ${v.odds}`,
    odds: v.odds,
    risk: v.risk,
    toWin: v.toWin,
    riskUnits: v.riskUnits,
    toWinUnits: v.toWinUnits,
    result: v.result,
  });
}

/**
 * A parlay ticket exactly as `betTracker.createParlay` writes it: `market` is
 * left at the NOT NULL default "ML", `originalOdds` holds the price as entered,
 * `legCount` is the leg count, and the stake lives ONLY on the parent.
 */
async function insertParlay(v: {
  userId: number;
  gameDate: string;
  result: "PENDING" | "WIN" | "LOSS" | "PUSH" | "VOID";
  odds: number;
  risk: string;
  toWin: string;
  riskUnits: string | null;
  toWinUnits: string | null;
  legs: { gameDate: string; odds: number; result: "PENDING" | "WIN" | "LOSS" | "PUSH" | "VOID" }[];
}): Promise<number> {
  const db = await getDb();
  // $returningId, not insertId off the ResultSetHeader tuple: the mysql2
  // adapter returns insert metadata as a tuple whose shape reads as a row.
  const [insertedRow] = await db!.insert(trackedBets).values({
    userId: v.userId,
    sport: "MLB",
    gameDate: v.gameDate,
    betType: "PARLAY",
    market: "ML", // NOT NULL column; PARLAY is not one of its enum values
    timeframe: "FULL_GAME",
    wagerType: "PREGAME",
    pick: `${v.legs.length}-leg parlay`,
    odds: v.odds,
    originalOdds: v.odds,
    legCount: v.legs.length,
    risk: v.risk,
    toWin: v.toWin,
    riskUnits: v.riskUnits,
    toWinUnits: v.toWinUnits,
    result: v.result,
  }).$returningId();

  const betId = insertedRow.id;
  expect(betId, "$returningId must yield the parent ticket id").toBeGreaterThan(0);

  await db!.insert(trackedBetLegs).values(
    v.legs.map((l, i) => ({
      betId,
      legIndex: i,
      sport: "MLB",
      gameDate: l.gameDate,
      awayTeam: "TB",
      homeTeam: "BOS",
      anGameId: 880000 + i,
      gameNumber: 1,
      market: "ML" as const,
      pickSide: "HOME" as const,
      timeframe: "FULL_GAME" as const,
      odds: l.odds,
      pick: `LEG${i} ML`,
      result: l.result,
    })),
  );
  console.log(`[insertParlay] [OUTPUT] betId=${betId} legCount=${v.legs.length} result=${v.result}`);
  return betId;
}

/** YYYY-MM-DD, `n` days after the base date. Far-future year, never real data. */
function nsDate(n: number): string {
  const d = new Date(Date.UTC(2126, 3, 1));
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

describe.skipIf(SKIP_DB_SUITE)("betTrackerStats.db — stats computed from real tracked_bets rows", () => {
  beforeAll(async () => {
    const db = await getDb();
    expect(db, "real-database suite requires a live DATABASE_URL").toBeTruthy();
    await cleanup();

    // ── USER_MIXED: one parlay + five straights, one per result ──────────────
    // Unit values are deliberately distinct from dollars/100 so an accidental
    // dollar-path fallback would move every figure below.
    await insertStraight({ userId: USER_MIXED, gameDate: "2126-03-01", market: "ML",    betType: "ML",    result: "WIN",     odds:  150, risk: "100.00", toWin: "150.00", riskUnits: "1.00", toWinUnits: "1.50" });
    await insertStraight({ userId: USER_MIXED, gameDate: "2126-03-02", market: "TOTAL", betType: "OVER",  result: "LOSS",    odds: -110, risk: "110.00", toWin: "100.00", riskUnits: "1.10", toWinUnits: "1.00" });
    await insertStraight({ userId: USER_MIXED, gameDate: "2126-03-03", market: "RL",    betType: "RL",    result: "PUSH",    odds: -105, risk: "105.00", toWin: "100.00", riskUnits: "1.05", toWinUnits: "1.00" });
    await insertStraight({ userId: USER_MIXED, gameDate: "2126-03-04", market: "ML",    betType: "ML",    result: "VOID",    odds: -120, risk: "120.00", toWin: "100.00", riskUnits: "1.20", toWinUnits: "1.00" });
    await insertStraight({ userId: USER_MIXED, gameDate: "2126-03-05", market: "TOTAL", betType: "UNDER", result: "PENDING", odds: -110, risk:  "55.00", toWin:  "50.00", riskUnits: "0.55", toWinUnits: "0.50" });
    await insertParlay({
      userId: USER_MIXED, gameDate: "2126-03-06", result: "WIN",
      odds: 600, risk: "100.00", toWin: "600.00", riskUnits: "1.00", toWinUnits: "6.00",
      legs: [
        { gameDate: "2126-03-06", odds: -110, result: "WIN" },
        { gameDate: "2126-03-06", odds: -120, result: "WIN" },
        { gameDate: "2126-03-06", odds: +140, result: "WIN" },
      ],
    });

    // ── USER_DECIMAL: fractional dollars, and stored units that disagree
    // with dollars/unitSize so the two code paths are distinguishable ────────
    await insertStraight({ userId: USER_DECIMAL, gameDate: "2126-03-10", market: "ML",    betType: "ML",   result: "WIN",  odds:   90, risk: "1234.56", toWin: "1111.11", riskUnits: null,   toWinUnits: null });
    await insertStraight({ userId: USER_DECIMAL, gameDate: "2126-03-11", market: "TOTAL", betType: "OVER", result: "LOSS", odds: -110, risk:  "250.00", toWin:  "227.27", riskUnits: "1.00", toWinUnits: "0.91" });

    // ── USER_CURVE: 40 settled bets, one per day, each worth exactly ±1 unit.
    // 20 WINs up to +20, 12 LOSSes down to +8, 8 WINs back to +16 — so the
    // all-time high (+20) sits in the interior and the max drawdown (12) is
    // measured between two interior points. Both must survive thinning.
    for (let i = 0; i < 40; i++) {
      const isWin = i < 20 || i >= 32;
      await insertStraight({
        userId: USER_CURVE, gameDate: nsDate(i), market: "ML", betType: "ML",
        result: isWin ? "WIN" : "LOSS", odds: isWin ? 100 : -100,
        risk: "100.00", toWin: "100.00", riskUnits: "1.00", toWinUnits: "1.00",
      });
    }
  });

  afterAll(async () => { await cleanup(); });

  // ── byType ──────────────────────────────────────────────────────────────────

  it("[BTS-1] a parlay files under PARLAY, not under the \"ML\" its market column actually holds", async () => {
    const { rows, stats } = await loadStats(USER_MIXED);

    // The premise the breakdown has to defeat: the database really did give us
    // market="ML" for the ticket, because the column is NOT NULL and "PARLAY"
    // is not one of its enum values. Only legCount tells the two kinds apart.
    const ticket = rows.find(r => (r.legCount ?? 0) > 0)!;
    expect(ticket.market).toBe("ML");
    expect(ticket.betType).toBe("PARLAY");
    expect(ticket.legCount).toBe(3);
    console.log(`[VERIFY] [BTS-1] ticket read back with market=${ticket.market} betType=${ticket.betType} legCount=${ticket.legCount}`);

    const parlay = entry(stats, "PARLAY");
    expect(parlay, "byType must carry a PARLAY row").toBeTruthy();
    expect(parlay!.wins).toBe(1);
    expect(parlay!.totalRisk).toBe(1);
    expect(parlay!.netProfit).toBe(6);
    console.log(`[VERIFY] [BTS-1] PASS — byType PARLAY wins=${parlay!.wins} risk=${parlay!.totalRisk}U net=${parlay!.netProfit}U`);

    // And the ticket's money must not have leaked into moneyline. ML holds the
    // two straight ML bets only: the +150 WIN and the VOID (which counts
    // nothing). If legCount were dropped, ML would show 2 wins and 7.5U won.
    const ml = entry(stats, "ML")!;
    expect(ml.wins).toBe(1);
    expect(ml.totalRisk).toBe(1);
    expect(ml.netProfit).toBe(1.5);
    console.log(`[VERIFY] [BTS-1] PASS — byType ML uncontaminated: wins=${ml.wins} risk=${ml.totalRisk}U net=${ml.netProfit}U`);
  });

  it("[BTS-2] a straight bet still files under its own market column", async () => {
    const { stats } = await loadStats(USER_MIXED);

    // Every market present in the fixture must appear under its own key, and
    // PARLAY must not have swallowed them.
    expect(stats.byType.map(e => e.key).sort()).toEqual(["ML", "PARLAY", "RL", "TOTAL"]);

    const total = entry(stats, "TOTAL")!;
    expect(total.losses).toBe(1);
    expect(total.totalRisk).toBe(1.1);
    expect(total.netProfit).toBe(-1.1);

    // RL's only row is a PUSH: counted as a push, but it stakes nothing and
    // returns nothing, so risk and net stay flat.
    const rl = entry(stats, "RL")!;
    expect(rl.pushes).toBe(1);
    expect(rl.wins).toBe(0);
    expect(rl.totalRisk).toBe(0);
    expect(rl.netProfit).toBe(0);
    console.log(`[VERIFY] [BTS-2] PASS — byType keys=${stats.byType.map(e => e.key).join(",")}; TOTAL risk=${total.totalRisk}U; RL pushes=${rl.pushes} risk=${rl.totalRisk}U`);
  });

  // ── Single stake ────────────────────────────────────────────────────────────

  it("[BTS-3] the parlay's single stake is counted once, not once per leg", async () => {
    const db = await getDb();
    const { rows, stats } = await loadStats(USER_MIXED);

    // The legs exist and carry no money of their own — the stake column lives
    // only on the parent. This is what makes counting-per-leg impossible as
    // long as the stats read never joins the leg table.
    const ticket = rows.find(r => (r.legCount ?? 0) > 0)!;
    const legs = await db!
      .select({ id: trackedBetLegs.id, odds: trackedBetLegs.odds, result: trackedBetLegs.result })
      .from(trackedBetLegs)
      .where(eq(trackedBetLegs.betId, ticket.id))
      .orderBy(asc(trackedBetLegs.legIndex));
    expect(legs).toHaveLength(3);
    expect(Object.keys(legs[0])).not.toContain("risk");

    // Six tracked_bets rows, six counted bets — the three leg rows must not
    // inflate the population.
    expect(stats.totalBets).toBe(6);
    expect(rows).toHaveLength(6);

    // 1.00 (ML win) + 1.10 (total loss) + 1.00 (parlay) = 3.10U at risk.
    // Counted per leg the parlay alone would add 3.00U and this would be 5.10.
    expect(stats.totalRisk).toBe(3.1);
    // 1.50 (ML win) + 6.00 (parlay) = 7.50U won; per-leg it would be 19.50.
    expect(stats.totalWon).toBe(7.5);
    expect(stats.totalLost).toBe(1.1);
    expect(stats.netProfit).toBe(6.4);
    expect(stats.dollarNetProfit).toBe(640);
    console.log(`[VERIFY] [BTS-3] PASS — 6 bets / ${legs.length} legs: risk=${stats.totalRisk}U won=${stats.totalWon}U net=${stats.netProfit}U ($${stats.dollarNetProfit})`);
  });

  // ── Result counts ───────────────────────────────────────────────────────────

  it("[BTS-4] W/L/PUSH/VOID/PENDING counts match what was inserted", async () => {
    const { rows, stats } = await loadStats(USER_MIXED);

    // Count straight off the DB rows so the expectation is the database's
    // answer, not the fixture's memory of it.
    const fromDb = rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.result] = (acc[r.result] ?? 0) + 1;
      return acc;
    }, {});
    expect(fromDb).toEqual({ WIN: 2, LOSS: 1, PUSH: 1, VOID: 1, PENDING: 1 });

    expect(stats.wins).toBe(2);       // one straight + the parlay ticket
    expect(stats.losses).toBe(1);
    expect(stats.pushes).toBe(1);
    expect(stats.voids).toBe(1);
    expect(stats.pending).toBe(1);
    expect(stats.totalBets).toBe(6);
    // PUSH is graded; VOID and PENDING are not.
    expect(stats.gradedBets).toBe(4);

    // byResult must agree with the scalars — it is a separate accumulator and
    // has drifted from them before.
    const byResult = Object.fromEntries(stats.byResult.map(e => [e.key, e]));
    expect(Object.keys(byResult).sort()).toEqual(["LOSS", "PENDING", "PUSH", "VOID", "WIN"]);
    expect(byResult.WIN.wins).toBe(2);
    expect(byResult.LOSS.losses).toBe(1);
    expect(byResult.PUSH.pushes).toBe(1);
    // VOID and PENDING are present but stake nothing — a voided bet never
    // happened, so it must not drag ROI down as a phantom loss.
    expect(byResult.VOID.totalRisk).toBe(0);
    expect(byResult.PENDING.totalRisk).toBe(0);
    console.log(`[VERIFY] [BTS-4] PASS — counts ${JSON.stringify(fromDb)} graded=${stats.gradedBets}`);
  });

  // ── Decimal strings ─────────────────────────────────────────────────────────

  it("[BTS-5] DECIMAL columns arrive as strings and parse into risk/toWin/units", async () => {
    const { rows, stats } = await loadStats(USER_DECIMAL);
    expect(rows).toHaveLength(2);
    const [win, loss] = rows;

    // The trap itself: mysql2 returns DECIMAL as a JS string to avoid the
    // precision loss of a double, which is why StatRow types risk/toWin as
    // `string`. A suite that hand-builds rows with numbers never sees this and
    // cannot catch a consumer that does arithmetic on the raw column.
    expect(typeof win.risk).toBe("string");
    expect(typeof win.toWin).toBe("string");
    expect(win.risk).toBe("1234.56");
    expect(win.toWin).toBe("1111.11");
    // Scale is preserved on the wire, trailing zeros and all.
    expect(loss.risk).toBe("250.00");
    expect(typeof loss.riskUnits).toBe("string");
    expect(loss.riskUnits).toBe("1.00");
    // A nullable DECIMAL comes back as null, not "" or "0.00".
    expect(win.riskUnits).toBeNull();
    expect(win.toWinUnits).toBeNull();
    console.log(`[VERIFY] [BTS-5] risk typeof=${typeof win.risk} value=${win.risk}; riskUnits typeof=${typeof loss.riskUnits} nullRow=${String(win.riskUnits)}`);

    // WIN row has no stored units, so it falls back to dollars/unitSize:
    // 1234.56/100 = 12.3456U risked, 1111.11/100 = 11.1111U won.
    // LOSS row stores 1.00U against a $250 stake — dollars/unitSize would say
    // 2.50U, so the two paths give different answers and this pins the right one.
    expect(stats.totalRisk).toBe(13.35);  // 12.3456 + 1.00
    expect(stats.totalWon).toBe(11.11);
    expect(stats.totalLost).toBe(1);      // stored units win over $250/100
    expect(stats.netProfit).toBe(10.11);

    // Dollar figures are the unit figures re-multiplied, so a string that
    // parsed to NaN would surface here as NaN rather than as a plausible number.
    expect(Number.isFinite(stats.dollarNetProfit)).toBe(true);
    // 1011.11, not 1011: the dollar figure is scaled from the UNROUNDED unit
    // net (10.1111 × 100), not from the rounded 10.11 shown beside it. Rounding
    // first would shed a cent per read on any account whose stake is not a
    // whole number of units.
    expect(stats.dollarNetProfit).toBe(1011.11);
    expect(stats.bestWin).toBe(11.11);
    expect(stats.worstLoss).toBe(1);
    console.log(`[VERIFY] [BTS-5] PASS — risk=${stats.totalRisk}U won=${stats.totalWon}U lost=${stats.totalLost}U net=${stats.netProfit}U ($${stats.dollarNetProfit})`);
  });

  // ── Equity curve ────────────────────────────────────────────────────────────

  it("[BTS-6] the equity curve carries one point per P&L-moving bet", async () => {
    const curve = (await loadStats(USER_CURVE)).stats.equityCurve;
    expect(curve).toHaveLength(40);
    expect(curve[0].cumPL).toBe(1);
    expect(curve[19].cumPL).toBe(20);   // peak
    expect(curve[31].cumPL).toBe(8);    // trough
    expect(curve[39].cumPL).toBe(16);   // close

    // PUSH, VOID and PENDING move no money, so they get no point — the mixed
    // account has 6 bets but only 3 that changed the balance. Without this the
    // chart draws flat segments for bets that never resolved.
    const mixed = (await loadStats(USER_MIXED)).stats;
    expect(mixed.totalBets).toBe(6);
    expect(mixed.equityCurve).toHaveLength(3);
    expect(mixed.equityCurve.map(p => p.result)).toEqual(["WIN", "LOSS", "WIN"]);
    expect(mixed.equityCurve.map(p => p.cumPL)).toEqual([1.5, 0.4, 6.4]);
    // Every point points back at a real row, which is what chart markers key on.
    const ids = new Set((await selectStatRows(USER_MIXED)()).map(r => r.id));
    expect(mixed.equityCurve.every(p => ids.has(p.betId))).toBe(true);
    console.log(`[VERIFY] [BTS-6] PASS — curve=40 pts for 40 settled; mixed=3 pts for 6 bets (${mixed.equityCurve.map(p => p.cumPL).join(" → ")})`);
  });

  it("[BTS-7] downsampling bounds the curve while ath/maxDrawdown stay computed over the FULL series", async () => {
    const { stats } = await loadStats(USER_CURVE);
    const full = stats.equityCurve;
    expect(full).toHaveLength(40);

    // Scalars are computed before any thinning, over all 40 points. The high
    // (+20 at bet 20) and the trough (+8 at bet 32) are both interior, so a
    // curve-derived implementation that only saw the transported points would
    // under-report both.
    expect(stats.ath).toBe(20);
    expect(stats.maxDrawdown).toBe(12);       // 20 → 8
    expect(stats.longestWinStreak).toBe(20);
    expect(stats.currentRunUnits).toBe(8);    // 16 back up from the 8 trough
    expect(stats.netProfit).toBe(16);

    const thinned = downsampleEquityCurve(full, 6);
    expect(thinned.length).toBeLessThanOrEqual(6);
    expect(thinned.length).toBeLessThan(full.length);   // thinning actually happened

    // The anchors: first, last, and every isSpecial point (all-time high,
    // max-drawdown trough, worst-day bet). Dropping one would leave a chart
    // marker pointing at a betId absent from the transported series.
    expect(thinned[0]).toEqual(full[0]);
    expect(thinned[thinned.length - 1]).toEqual(full[full.length - 1]);
    const specialIds = full.filter(p => p.isSpecial).map(p => p.betId);
    expect(specialIds.length).toBeGreaterThanOrEqual(2);
    const thinnedIds = new Set(thinned.map(p => p.betId));
    expect(specialIds.every(id => thinnedIds.has(id))).toBe(true);

    // So the scalars are still reachable from what the client receives: the
    // peak is the transported maximum, and the trough the drawdown was measured
    // to is present even though it is neither an endpoint nor the minimum of
    // the transported series (that is the opening +1).
    expect(Math.max(...thinned.map(p => p.cumPL))).toBe(stats.ath);
    expect(thinned.some(p => p.cumPL === 8)).toBe(true);
    expect(stats.ath - 8).toBe(stats.maxDrawdown);
    // …and the order the chart draws in is preserved.
    const dates = thinned.map(p => p.date);
    expect([...dates].sort()).toEqual(dates);

    // Recomputing over the full series must be a no-op — re-folding an
    // unchanged set changes nothing.
    expect(downsampleEquityCurve(full, 6)).toEqual(thinned);
    // A budget at or above the series length must return it untouched.
    expect(downsampleEquityCurve(full, 40)).toBe(full);
    console.log(`[VERIFY] [BTS-7] PASS — 40 → ${thinned.length} pts (${thinned.map(p => p.cumPL).join(",")}); ath=${stats.ath} maxDD=${stats.maxDrawdown} over the full series`);
  });
});
