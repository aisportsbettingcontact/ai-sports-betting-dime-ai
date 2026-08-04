/**
 * betTrackerParlay.db.test.ts — parlay ticket lifecycle against a real MySQL.
 *
 * The mocked parlay suites (parlayCore.test.ts, parlayWiring.test.ts) prove the
 * arithmetic. They cannot prove that the arithmetic survives a round trip
 * through `tracked_bets` / `tracked_bet_legs`, and that is where this feature
 * has actually broken: a leg line stored in a DECIMAL(6,1) comes back as the
 * STRING "8.5", an enum member missing from the DDL is not a type error, and
 * `$returningId()` hands back an insert id that nothing had ever checked
 * against the row it supposedly identifies. Every assertion below is one a
 * mock would have passed.
 *
 * ── Test surface ─────────────────────────────────────────────────────────────
 *  [PL-1] ticket + legs round-trip — legCount, originalOdds, line 8.5 AND -1.5,
 *         NULL line on an ML leg, enums, and $returningId identifying the row
 *  [PL-2] one PUSHED leg → WIN repriced BY DIVISION from originalOdds;
 *         originalOdds unchanged; toWin/toWinUnits follow the repriced price
 *  [PL-3] folding is idempotent, and a leg corrected PUSH→WIN restores the
 *         original price (proves the reprice is derived, not incremental)
 *  [PL-4] one LOSS settles the ticket LOSS while sibling legs are still PENDING
 *  [PL-5] all legs pushed → VOID with the price left alone (stake returned)
 *  [PL-6] a 10-leg ticket stores and settles, and a boosted price is preserved
 *
 * ── Isolation ────────────────────────────────────────────────────────────────
 *  CI runs the real-DB suites with --no-file-parallelism against ONE shared
 *  database, so this file may only touch rows it created. It writes under the
 *  reserved userId range 880001-880099 and a far-future gameDate namespace
 *  (2126-…), and deletes exactly those rows in beforeAll and afterAll. No
 *  TRUNCATE, no deletion by anything but this suite's own userIds.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
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
import { emptyParlaySummary, settleTickets } from "./parlayGrader";
import { MAX_PARLAY_LEGS, combineLegOdds, calcParlayToWin } from "./parlayCore";

// ── Reserved namespace ────────────────────────────────────────────────────────
/** Reserved for this suite alone (880001-880099); other suites own other ranges. */
const U = {
  create: 880001,
  push:   880002,
  idem:   880003,
  loss:   880004,
  void:   880005,
  ten:    880006,
  boost:  880007,
  boost2: 880008,
  units:  880009,
} as const;
const USER_IDS: number[] = Object.values(U);

/** Far-future dates — a real slate can never collide with these. */
const D1 = "2126-09-14";
const D2 = "2126-09-15";

// ── Row factories ─────────────────────────────────────────────────────────────

type LegSpec = {
  odds: number;
  market: "ML" | "RL" | "TOTAL";
  pickSide: "AWAY" | "HOME" | "OVER" | "UNDER";
  line: string | null;
  result?: "PENDING" | "WIN" | "LOSS" | "PUSH" | "VOID";
  sport?: string;
  gameDate?: string;
  timeframe?: "FULL_GAME" | "FIRST_5" | "FIRST_INNING" | "NRFI" | "YRFI";
};

/**
 * Insert a ticket and its legs the way createParlay does — `odds` and
 * `originalOdds` both set to the price as entered, `legCount` matching the leg
 * rows. Returns the id `$returningId()` reported, which [PL-1] then verifies.
 */
async function insertTicket(args: {
  userId: number;
  originalOdds: number;
  risk: string;
  riskUnits?: string | null;
  toWin: string;
  toWinUnits?: string | null;
  legs: LegSpec[];
  marker: string;
}): Promise<number> {
  const db = await getDb();
  const [inserted] = await db
    .insert(trackedBets)
    .values({
      userId:       args.userId,
      sport:        args.legs[0].sport ?? "MLB",
      gameDate:     D2, // dated by the LAST leg, as createParlay does
      betType:      "PARLAY" as const,
      market:       "ML" as const,
      timeframe:    "FULL_GAME" as const,
      pick:         `${args.legs.length}-leg parlay`,
      odds:         args.originalOdds,
      originalOdds: args.originalOdds,
      legCount:     args.legs.length,
      risk:         args.risk,
      toWin:        args.toWin,
      riskUnits:    args.riskUnits ?? null,
      toWinUnits:   args.toWinUnits ?? null,
      wagerType:    "PREGAME" as const,
      notes:        args.marker,
      result:       "PENDING" as const,
    })
    .$returningId();

  const betId: number = inserted.id;

  await db.insert(trackedBetLegs).values(
    args.legs.map((l, i) => ({
      betId,
      legIndex:   i,
      sport:      l.sport ?? "MLB",
      gameDate:   l.gameDate ?? (i === args.legs.length - 1 ? D2 : D1),
      awayTeam:   `AW${i}`,
      homeTeam:   `HM${i}`,
      anGameId:   8_800_000 + args.userId % 100 * 100 + i,
      gameNumber: 1,
      market:     l.market,
      pickSide:   l.pickSide,
      timeframe:  l.timeframe ?? "FULL_GAME",
      line:       l.line,
      odds:       l.odds,
      pick:       `leg ${i}`,
      result:     l.result ?? "PENDING",
    })),
  );

  console.log(`[insertTicket] [OUTPUT] betId=${betId} userId=${args.userId} legs=${args.legs.length} originalOdds=${args.originalOdds}`);
  return betId;
}

async function loadTicket(betId: number) {
  const db = await getDb();
  const [row] = await db.select().from(trackedBets).where(eq(trackedBets.id, betId));
  return row;
}

async function loadLegs(betId: number) {
  const db = await getDb();
  const rows = await db.select().from(trackedBetLegs).where(eq(trackedBetLegs.betId, betId));
  return rows.sort((a: { legIndex: number }, b: { legIndex: number }) => a.legIndex - b.legIndex);
}

/** Run the real settlement path — the same function the 30-minute sweep calls. */
async function fold(betId: number) {
  const summary = emptyParlaySummary("TEST");
  await settleTickets([betId], summary);
  expect(summary.errors, `fold(${betId}) reported errors`).toBe(0);
  return summary;
}

/** Delete only what this suite owns: rows under its reserved userIds. */
async function cleanup() {
  const db = await getDb();
  if (!db) return;
  const owned = await db
    .select({ id: trackedBets.id })
    .from(trackedBets)
    .where(inArray(trackedBets.userId, USER_IDS));
  const ids = owned.map((r: { id: number }) => r.id);
  if (ids.length > 0) {
    await db.delete(trackedBetLegs).where(inArray(trackedBetLegs.betId, ids));
    await db.delete(trackedBets).where(inArray(trackedBets.id, ids));
  }
  console.log(`[cleanup] [STEP] removed ${ids.length} ticket(s) under userIds ${USER_IDS.join(",")}`);
}

describe.skipIf(SKIP_DB_SUITE)("betTrackerParlay.db — parlay lifecycle (real database)", () => {
  beforeAll(async () => { await cleanup(); });
  afterAll(async () => { await cleanup(); });

  // ── [PL-1] Storage ──────────────────────────────────────────────────────────

  it("[PL-1] a ticket and its legs round-trip through MySQL intact", async () => {
    const marker = `pl1-${Date.now()}`;
    const betId = await insertTicket({
      userId: U.create,
      originalOdds: 650,
      risk: "100.00",
      toWin: "650.00",
      marker,
      legs: [
        // A total. DECIMAL(6,1) is the whole reason this test exists: 8.5 comes
        // back as the string "8.5", and code that compared it with === 8.5
        // graded every total as a loss.
        { odds: -115, market: "TOTAL", pickSide: "OVER", line: "8.5", timeframe: "FIRST_5" },
        // A run line. The sign is the payload: a column that ever ended up
        // unsigned, or a value stringified through Math.abs, turns a -1.5
        // favourite into a +1.5 dog and inverts the grade.
        { odds: 150, market: "RL", pickSide: "AWAY", line: "-1.5" },
        // An ML leg carries no line. NULL must stay NULL — coerced to 0.0 it
        // would grade as a pick'em spread rather than a moneyline.
        { odds: -110, market: "ML", pickSide: "HOME", line: null, sport: "NBA" },
      ],
    });

    // $returningId is an assumption, not a guarantee: it reports mysql2's
    // insertId, which nothing here had ever reconciled against the row it is
    // supposed to name. Find the row independently, by its marker.
    const db = await getDb();
    const [byMarker] = await db.select().from(trackedBets).where(eq(trackedBets.notes, marker));
    expect(byMarker.id).toBe(betId);
    console.log(`[VERIFY] [PL-1] PASS — $returningId id=${betId} resolves to the row carrying marker=${marker}`);

    const ticket = await loadTicket(betId);
    expect(ticket.legCount).toBe(3);
    expect(ticket.originalOdds).toBe(650);
    expect(ticket.odds).toBe(650);          // live price starts at the entered price
    expect(ticket.betType).toBe("PARLAY");
    expect(ticket.result).toBe("PENDING");
    console.log(`[VERIFY] [PL-1] PASS — legCount=${ticket.legCount} odds=${ticket.odds} originalOdds=${ticket.originalOdds}`);

    const legs = await loadLegs(betId);
    expect(legs).toHaveLength(3);
    expect(legs.map((l: { legIndex: number }) => l.legIndex)).toEqual([0, 1, 2]);

    expect(legs[0].market).toBe("TOTAL");
    expect(legs[0].pickSide).toBe("OVER");
    expect(legs[0].timeframe).toBe("FIRST_5");  // a non-default enum member really exists in the DDL
    expect(Number(legs[0].line)).toBe(8.5);
    expect(legs[0].odds).toBe(-115);

    expect(legs[1].market).toBe("RL");
    expect(legs[1].pickSide).toBe("AWAY");
    expect(Number(legs[1].line)).toBe(-1.5);
    expect(Number(legs[1].line)).toBeLessThan(0);

    expect(legs[2].market).toBe("ML");
    expect(legs[2].line).toBeNull();
    expect(legs[2].sport).toBe("NBA");         // a mixed-sport ticket keeps each leg's own sport
    expect(legs[2].result).toBe("PENDING");
    console.log(`[VERIFY] [PL-1] PASS — lines round-tripped: ${legs[0].line} / ${legs[1].line} / ${legs[2].line}`);
  });

  // ── [PL-2] Reprice on push ──────────────────────────────────────────────────

  it("[PL-2] a pushed leg reprices the ticket by DIVISION and leaves originalOdds alone", async () => {
    // +650 is deliberately NOT the product of the legs (-110/-110/+150 multiply
    // out to +811). That gap is what a correlated SGP or a boost looks like in
    // the data, and it is the whole reason repricing divides the dropped leg
    // out of the entered price instead of rebuilding the price from survivors.
    const betId = await insertTicket({
      userId: U.push,
      originalOdds: 650,
      risk: "100.00",
      riskUnits: "2.00",       // unit size = $50
      toWin: "650.00",
      toWinUnits: "13.00",
      marker: `pl2-${Date.now()}`,
      legs: [
        { odds: -110, market: "ML", pickSide: "AWAY", line: null, result: "WIN" },
        { odds: -110, market: "ML", pickSide: "HOME", line: null, result: "WIN" },
        { odds: 150,  market: "TOTAL", pickSide: "OVER", line: "8.5", result: "PUSH" },
      ],
    });
    console.log(`[INPUT] betId=${betId} originalOdds=650 pushed leg odds=+150`);

    await fold(betId);

    const ticket = await loadTicket(betId);
    expect(ticket.result).toBe("WIN");

    // 7.50 decimal / 2.50 decimal = 3.00 decimal = +200.
    expect(ticket.odds).toBe(200);
    // Rebuilding from the survivors instead would pay +264 and silently discard
    // the correlated price the user was actually quoted.
    expect(ticket.odds).not.toBe(combineLegOdds([-110, -110]));

    // The basis every future reprice divides from must never move.
    expect(ticket.originalOdds).toBe(650);

    // toWin has to follow the repriced price, or the ticket displays one number
    // and pays another; toWinUnits has to follow it or unit P&L keeps booking
    // the original odds forever.
    expect(Number(ticket.toWin)).toBe(200);
    expect(Number(ticket.toWinUnits)).toBe(4);   // $200 at a $50 unit
    console.log(`[VERIFY] [PL-2] PASS — 650 -> ${ticket.odds} (not ${combineLegOdds([-110, -110])}), originalOdds=${ticket.originalOdds}, toWin=${ticket.toWin}, toWinUnits=${ticket.toWinUnits}`);
  });

  // ── [PL-3] Idempotence ──────────────────────────────────────────────────────

  it("[PL-3] re-folding an unchanged ticket is a no-op; a corrected leg restores the price", async () => {
    // Grading re-runs every 30 minutes. A reprice that divided the CURRENT odds
    // rather than originalOdds would take this ticket 650 -> 200 -> -500 -> …
    // and decay it toward nothing over a weekend, with no error anywhere.
    const betId = await insertTicket({
      userId: U.idem,
      originalOdds: 650,
      risk: "100.00",
      toWin: "650.00",
      marker: `pl3-${Date.now()}`,
      legs: [
        { odds: -110, market: "ML", pickSide: "AWAY", line: null, result: "WIN" },
        { odds: -110, market: "ML", pickSide: "HOME", line: null, result: "WIN" },
        { odds: 150,  market: "TOTAL", pickSide: "OVER", line: "8.5", result: "PUSH" },
      ],
    });

    const seen: number[] = [];
    for (let i = 0; i < 3; i++) {
      await fold(betId);
      const t = await loadTicket(betId);
      seen.push(t.odds);
      expect(t.result).toBe("WIN");
      expect(t.originalOdds).toBe(650);
    }
    expect(seen).toEqual([200, 200, 200]);
    expect(seen).not.toContain(-500);   // the compounding-division failure
    console.log(`[VERIFY] [PL-3] PASS — three folds all produced odds=${seen.join(",")}`);

    // Settlement is a pure function of current leg state, so correcting the leg
    // must walk the price all the way back — not apply an inverse adjustment.
    const legs = await loadLegs(betId);
    const db = await getDb();
    await db.update(trackedBetLegs).set({ result: "WIN" }).where(eq(trackedBetLegs.id, legs[2].id));
    await fold(betId);
    const restored = await loadTicket(betId);
    expect(restored.result).toBe("WIN");
    expect(restored.odds).toBe(650);
    expect(Number(restored.toWin)).toBe(650);
    console.log(`[VERIFY] [PL-3] PASS — leg corrected PUSH->WIN restored odds to ${restored.odds}`);

    // …and flipping it back reproduces the reduced price exactly.
    await db.update(trackedBetLegs).set({ result: "PUSH" }).where(eq(trackedBetLegs.id, legs[2].id));
    await fold(betId);
    expect((await loadTicket(betId)).odds).toBe(200);
    console.log(`[VERIFY] [PL-3] PASS — flipped back to PUSH and the price returned to 200`);
  });

  // ── [PL-4] Loss short-circuit ───────────────────────────────────────────────

  it("[PL-4] a single LOSS settles the ticket even with legs still PENDING", async () => {
    // Legs settle on their own dates, days apart. Waiting for the last one
    // would leave a dead ticket counted as open risk on the user's page for the
    // rest of the week, and no later result can rescue it.
    const betId = await insertTicket({
      userId: U.loss,
      originalOdds: 650,
      risk: "100.00",
      toWin: "650.00",
      marker: `pl4-${Date.now()}`,
      legs: [
        { odds: -110, market: "ML", pickSide: "AWAY", line: null, result: "LOSS" },
        { odds: -110, market: "ML", pickSide: "HOME", line: null, result: "PENDING" },
        { odds: 150,  market: "TOTAL", pickSide: "OVER", line: "8.5", result: "WIN" },
      ],
    });

    await fold(betId);

    const ticket = await loadTicket(betId);
    expect(ticket.result).toBe("LOSS");
    expect(ticket.odds).toBe(650);          // a lost ticket is never repriced
    expect(ticket.originalOdds).toBe(650);

    const legs = await loadLegs(betId);
    expect(legs.filter((l: { result: string }) => l.result === "PENDING")).toHaveLength(1);
    console.log(`[VERIFY] [PL-4] PASS — ticket=${ticket.result} at odds=${ticket.odds} with 1 leg still PENDING`);
  });

  // ── [PL-5] All-push void ────────────────────────────────────────────────────

  it("[PL-5] every leg pushed voids the ticket and leaves the price untouched", async () => {
    // Dividing all three legs out would leave a decimal at or below 1.0 — a
    // negative price. VOID returns the stake instead, and writes no odds at all.
    const betId = await insertTicket({
      userId: U.void,
      originalOdds: 650,
      risk: "100.00",
      toWin: "650.00",
      marker: `pl5-${Date.now()}`,
      legs: [
        { odds: -110, market: "ML", pickSide: "AWAY", line: null, result: "PUSH" },
        { odds: -110, market: "RL", pickSide: "HOME", line: "-1.5", result: "PUSH" },
        { odds: 150,  market: "TOTAL", pickSide: "OVER", line: "8.5", result: "VOID" },
      ],
    });

    await fold(betId);

    const ticket = await loadTicket(betId);
    expect(ticket.result).toBe("VOID");
    expect(ticket.odds).toBe(650);
    expect(ticket.originalOdds).toBe(650);
    expect(Number(ticket.toWin)).toBe(650);
    console.log(`[VERIFY] [PL-5] PASS — all legs dropped -> VOID with odds left at ${ticket.odds}`);
  });

  // ── [PL-6] Maximum ticket ───────────────────────────────────────────────────

  it("[PL-6] a 10-leg ticket stores and settles at its boosted price", async () => {
    // Ten is the contract's ceiling, so this is the widest bulk leg insert that
    // can exist and the largest fold the sweep will ever do. +1900 is again a
    // boosted price — the nine surviving -110 legs multiply out to +33585, so
    // any code path that rebuilds from legs is off by an order of magnitude.
    const legs: LegSpec[] = Array.from({ length: MAX_PARLAY_LEGS }, (_, i) =>
      i === MAX_PARLAY_LEGS - 1
        ? { odds: 100, market: "TOTAL" as const, pickSide: "UNDER" as const, line: "7.5", result: "PUSH" as const }
        : { odds: -110, market: "ML" as const, pickSide: "AWAY" as const, line: null, result: "WIN" as const },
    );

    const betId = await insertTicket({
      userId: U.ten,
      originalOdds: 1900,
      risk: "50.00",
      toWin: "950.00",
      marker: `pl6-${Date.now()}`,
      legs,
    });

    const stored = await loadLegs(betId);
    expect(stored).toHaveLength(MAX_PARLAY_LEGS);
    expect(stored.map((l: { legIndex: number }) => l.legIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect((await loadTicket(betId)).legCount).toBe(MAX_PARLAY_LEGS);
    console.log(`[VERIFY] [PL-6] PASS — ${stored.length} leg rows stored with contiguous legIndex`);

    await fold(betId);

    const ticket = await loadTicket(betId);
    expect(ticket.result).toBe("WIN");
    // 20.00 decimal / 2.00 decimal = 10.00 decimal = +900.
    expect(ticket.odds).toBe(900);
    expect(ticket.odds).not.toBe(combineLegOdds(Array(9).fill(-110)));
    expect(ticket.originalOdds).toBe(1900);
    expect(Number(ticket.toWin)).toBe(450);
    console.log(`[VERIFY] [PL-6] PASS — 10-leg ticket settled ${ticket.result} at ${ticket.odds} from originalOdds=${ticket.originalOdds}`);
  });


  // ── [PL-7,8] A boosted payout ───────────────────────────────────────────────

  /**
   * `createParlay` accepts a `toWin`, so a ticket can carry a payout its odds
   * do not imply — a boost where the book pays more than the arithmetic.
   * Settlement recomputed toWin from odds on EVERY write, including a WIN with
   * no dropped legs where the price never moved, silently replacing the number
   * the user copied off their own bet slip. No edit, no log line.
   */
  it("[PL-7] a WIN with no dropped legs leaves a boosted payout untouched", async () => {
    const price = combineLegOdds([-110, -110]);            // +264
    const boosted = "700.00";                               // the book paid more than +264 implies
    expect(boosted).not.toBe(calcParlayToWin(100, price).toFixed(2));

    const betId = await insertTicket({
      userId: U.boost,
      originalOdds: price,
      risk: "100.00",
      toWin: boosted,
      marker: `pl7-${Date.now()}`,
      legs: [
        { odds: -110, market: "ML", pickSide: "AWAY", line: null, result: "WIN" },
        { odds: -110, market: "ML", pickSide: "HOME", line: null, result: "WIN" },
      ],
    });

    await fold(betId);

    const ticket = await loadTicket(betId);
    expect(ticket.result).toBe("WIN");
    expect(ticket.odds).toBe(price);              // nothing dropped, so nothing repriced
    expect(ticket.toWin).toBe(boosted);           // and therefore nothing overwritten
    console.log(`[VERIFY] [PL-7] PASS — payout ${ticket.toWin} survived settlement at unchanged odds ${ticket.odds}`);
  });

  /**
   * The opposite failure must not be traded for the first: when a leg IS
   * dropped the payout has to follow the reduced price, or the ticket displays
   * one number and pays another.
   */
  it("[PL-8] a pushed leg still reprices the payout on a boosted ticket", async () => {
    const betId = await insertTicket({
      userId: U.boost2,
      originalOdds: 596,
      risk: "100.00",
      toWin: "700.00",
      marker: `pl8-${Date.now()}`,
      legs: [
        { odds: -110, market: "ML", pickSide: "AWAY", line: null, result: "WIN" },
        { odds: -110, market: "ML", pickSide: "HOME", line: null, result: "WIN" },
        { odds: -110, market: "ML", pickSide: "AWAY", line: null, result: "PUSH" },
      ],
    });

    await fold(betId);

    const ticket = await loadTicket(betId);
    expect(ticket.result).toBe("WIN");
    // +265, not the +264 two -110s multiply to: repricing divides the dropped
    // leg out of the ENTERED price, carrying the rounding of 595.79 -> 596.
    expect(ticket.odds).toBe(265);
    expect(ticket.odds).not.toBe(596);            // the price moved
    expect(Number(ticket.toWin)).toBeCloseTo(calcParlayToWin(100, ticket.odds), 2);
    expect(ticket.toWin).not.toBe("700.00");      // so the payout followed it
    console.log(`[VERIFY] [PL-8] PASS — 596 -> ${ticket.odds}; payout followed to ${ticket.toWin}`);
  });

  /**
   * [PL-9] riskUnits and toWinUnits are stored as a pair.
   *
   * The first real production parlay stored riskUnits=0.25 with toWinUnits
   * NULL. riskUnits is authoritative regardless of the viewer's unit size, so
   * the pair disagreed: risk read the stored value while to-win fell back to
   * dollars ÷ today's unit size. Correct at the $100 unit it was created at,
   * and at $50 it showed 0.25u to win 1.37u — a 5.48x ratio on +274 odds.
   *
   * Asserted against a stored row rather than a hand-built object, because the
   * defect was in what reached the database.
   */
  it("[PL-9] a ticket with riskUnits also carries toWinUnits", async () => {
    const price = 274;                       // -104 and -110, the live ticket
    const riskDollars = 25, unitSize = 100;
    const betId = await insertTicket({
      userId: U.units,
      originalOdds: price,
      risk: riskDollars.toFixed(2),
      riskUnits: (riskDollars / unitSize).toFixed(2),
      toWin: calcParlayToWin(riskDollars, price).toFixed(2),
      toWinUnits: (calcParlayToWin(riskDollars, price) / unitSize).toFixed(4),
      marker: `pl9-${Date.now()}`,
      legs: [
        { odds: -104, market: "TOTAL", pickSide: "OVER", line: "11.5", result: "WIN" },
        { odds: -110, market: "ML", pickSide: "HOME", line: null, result: "WIN" },
      ],
    });

    const ticket = await loadTicket(betId);
    expect(ticket.riskUnits, "riskUnits stored").not.toBeNull();
    expect(ticket.toWinUnits, "toWinUnits MUST accompany riskUnits").not.toBeNull();

    // The pair must imply the ticket's own price, independent of any viewer.
    const ratio = Number(ticket.toWinUnits) / Number(ticket.riskUnits);
    const impliedProfit = ticket.odds >= 100 ? ticket.odds / 100 : 100 / Math.abs(ticket.odds);
    expect(Math.abs(ratio - impliedProfit)).toBeLessThan(0.001);

    // And the dollar figures agree with the unit figures at the original size.
    expect(Number(ticket.risk) / Number(ticket.riskUnits)).toBeCloseTo(unitSize, 6);
    expect(Number(ticket.toWin) / Number(ticket.toWinUnits)).toBeCloseTo(unitSize, 2);
    console.log(`[VERIFY] [PL-9] PASS — ${ticket.riskUnits}u to win ${ticket.toWinUnits}u at ${ticket.odds} (ratio ${ratio.toFixed(4)})`);
  });

  /** [PL-10] No ticket in this suite's namespace may carry a half-set pair. */
  it("[PL-10] no ticket stores riskUnits without toWinUnits", async () => {
    const db = await getDb();
    const rows = await db
      .select({ id: trackedBets.id, riskUnits: trackedBets.riskUnits, toWinUnits: trackedBets.toWinUnits })
      .from(trackedBets)
      .where(inArray(trackedBets.userId, USER_IDS));
    const halfSet = rows.filter(r => r.riskUnits != null && r.toWinUnits == null);
    expect(halfSet.map(r => r.id), "tickets with riskUnits but no toWinUnits").toEqual([]);
  });
});
