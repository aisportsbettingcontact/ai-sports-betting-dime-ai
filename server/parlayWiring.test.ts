/**
 * parlayWiring.test.ts — the integration decisions, asserted against source.
 *
 * parlayCore.test.ts proves the maths. This file guards the wiring choices
 * that no unit test would catch and that only fail in production, silently:
 *
 *   - a parlay parent must never be fed to the straight-bet grader
 *   - deleting a ticket must delete its legs (there is no FK to do it)
 *   - legCount must reach aggregateStats or every ticket files as moneyline
 *   - the ticket must be dated by its LAST leg or the stuck alarm misfires
 *   - legs must be batched into the page read, not fetched per ticket
 *
 * Source assertions are deliberate: these are structural guarantees, and a
 * refactor that quietly drops one would otherwise leave no failing test.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { aggregateStats, type StatRow } from "./betTrackerCore";

const read = (p: string) => readFileSync(join(__dirname, p), "utf8");
/** Source with comments stripped, so a comment mentioning a pattern can't satisfy an assertion. */
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const scheduler = code("betAutoGradeScheduler.ts");
const router = code("routers/betTracker.ts");
const grader = code("parlayGrader.ts");

describe("parlay parents never reach the straight-bet grader", () => {
  it("REGRESSION: every PENDING selection in the scheduler filters legCount=0", () => {
    // A ticket has no anGameId and no single pickSide. Fed to gradePendingRows
    // it resolves to no game and logs NO_MATCH every cycle — which is also how
    // real feed drift presents, so it would poison that alarm with noise.
    const selections = scheduler.match(/eq\(trackedBets\.result,\s*"PENDING"\)/g) ?? [];
    const guards = scheduler.match(/eq\(trackedBets\.legCount,\s*0\)/g) ?? [];
    expect(selections.length).toBeGreaterThanOrEqual(3);
    expect(guards.length).toBe(selections.length);
  });

  it("the cycle sweeps parlay legs alongside straight bets", () => {
    expect(scheduler).toMatch(/gradeParlaysForDate\(/);
  });

  it("a failing parlay sweep cannot take down the straight-bet cycle", () => {
    // The sweep is wrapped, because a parlay bug must not stop 205 straight
    // bets from settling.
    const cycle = scheduler.slice(scheduler.indexOf("runBetGradeCycle"));
    expect(cycle).toMatch(/try\s*\{[\s\S]*?gradeParlaysForDate[\s\S]*?catch/);
  });
});

describe("legs are grade-driven by their own date, not the ticket's", () => {
  it("the leg sweep selects legs by leg gameDate", () => {
    expect(grader).toMatch(/trackedBetLegs\.gameDate/);
    expect(grader).toMatch(/eq\(trackedBetLegs\.result,\s*"PENDING"\)/);
  });

  it("re-folding reads originalOdds, falling back to odds for older rows", () => {
    expect(grader).toMatch(/ticket\.originalOdds\s*\?\?\s*ticket\.odds/);
  });

  it("toWin is rewritten whenever the price moves, so the two cannot disagree", () => {
    expect(grader).toMatch(/calcParlayToWin\(/);
    expect(grader).toMatch(/patch\.toWin\s*=/);
  });

  it("settling a ticket invalidates its OWNER's stats cache, not the actor's", () => {
    expect(grader).toMatch(/invalidateStatsCacheForUser\(ticket\.userId\)/);
  });
});

describe("deleting a ticket deletes its legs", () => {
  it("REGRESSION: delete cascades to trackedBetLegs", () => {
    // No FK exists between the tables. An orphaned leg stays PENDING, so the
    // sweep would keep grading it and re-folding a ticket that is gone.
    expect(router).toMatch(/delete\(trackedBetLegs\)[\s\S]{0,120}trackedBetLegs\.betId/);
  });

  it("cascades before deleting the parent", () => {
    const del = router.slice(router.indexOf("delete: appUserProcedure"));
    const legPos = del.indexOf("delete(trackedBetLegs)");
    const betPos = del.indexOf("delete(trackedBets)");
    expect(legPos).toBeGreaterThan(-1);
    expect(legPos).toBeLessThan(betPos);
  });
});

describe("createParlay does not disturb the straight-bet write path", () => {
  it("is a separate procedure", () => {
    expect(router).toMatch(/createParlay:\s*appUserProcedure/);
    expect(router).toMatch(/\n  create:\s*appUserProcedure/);
  });

  it("stores the entered price twice — live and original", () => {
    expect(router).toMatch(/originalOdds:\s*input\.odds/);
  });

  it("REGRESSION: dates the ticket by its LAST leg", () => {
    // Dating it earlier would make checkStuckBets fire on a ticket that is
    // simply waiting for a game not yet played.
    expect(router).toMatch(/l\.gameDate > max \? l\.gameDate : max/);
  });

  it("keeps a 30-second idempotency window computed by the database", () => {
    // Same defect class as the straight-bet guard: a JS-side timestamp is
    // serialised in the Node process's timezone and compared against a column
    // in the DB's, which silently widened a 30s window to seven hours.
    expect(router).toMatch(/UTC_TIMESTAMP\(\) - INTERVAL 30 SECOND/);
    expect(router).not.toMatch(/Date\.now\(\)\s*-\s*30_?000/);
  });

  it("validates legs before writing anything", () => {
    const proc = router.slice(router.indexOf("createParlay:"), router.indexOf("delete: appUserProcedure"));
    const validatePos = proc.indexOf("validateParlayLegs");
    const insertPos = proc.indexOf("db.insert(trackedBets)");
    expect(validatePos).toBeGreaterThan(-1);
    expect(validatePos).toBeLessThan(insertPos);
  });
});

describe("legs reach the client without an N+1", () => {
  it("REGRESSION: the page read batches legs in one query", () => {
    // A round trip costs ~80ms regardless of size, so per-ticket fetches would
    // dominate the whole read.
    expect(router).toMatch(/inArray\(trackedBetLegs\.betId,\s*parlayIds\)/);
  });

  it("skips the query entirely for straight-bet pages", () => {
    expect(router).toMatch(/parlayIds\.length > 0/);
  });
});

describe("stats file a parlay as PARLAY, not moneyline", () => {
  const row = (over: Partial<StatRow>): StatRow => ({
    id: 1, gameDate: "2026-08-04", result: "WIN", sport: "MLB",
    market: "ML", betType: "ML", timeframe: "FULL_GAME", wagerType: "PREGAME",
    pick: "p", odds: -110, risk: "100.00", toWin: "90.91",
    riskUnits: "1.00", toWinUnits: "0.91", ...over,
  });

  it("REGRESSION: a ticket does not file under ML", () => {
    // The parent's `market` column carries the schema default "ML" because the
    // column is NOT NULL. Keying byType on market alone buried every ticket in
    // the moneyline row.
    const stats = aggregateStats(
      [row({ id: 1, betType: "PARLAY", legCount: 3 })],
      100,
    );
    const keys = stats.byType.map(b => b.key);
    expect(keys).toContain("PARLAY");
    expect(keys).not.toContain("ML");
  });

  it("keeps straight bets on their own market", () => {
    const stats = aggregateStats([row({ id: 1, legCount: 0 })], 100);
    expect(stats.byType.map(b => b.key)).toEqual(["ML"]);
  });

  it("separates the two when both are present", () => {
    const stats = aggregateStats(
      [row({ id: 1, legCount: 0 }), row({ id: 2, betType: "PARLAY", legCount: 4 })],
      100,
    );
    expect(stats.byType.map(b => b.key).sort()).toEqual(["ML", "PARLAY"]);
  });

  it("treats a missing legCount as a straight bet, so existing rows are unaffected", () => {
    const { legCount: _omitted, ...noLegCount } = row({});
    const stats = aggregateStats([noLegCount as StatRow], 100);
    expect(stats.byType.map(b => b.key)).toEqual(["ML"]);
  });

  it("counts the ticket's single stake once, not once per leg", () => {
    const stats = aggregateStats([row({ betType: "PARLAY", legCount: 5, riskUnits: "2.00", toWinUnits: "12.00" })], 100);
    expect(stats.wins).toBe(1);
    expect(stats.totalRisk).toBeCloseTo(2, 2);
    expect(stats.netProfit).toBeCloseTo(12, 2);
  });
});
