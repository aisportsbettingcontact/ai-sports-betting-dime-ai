/**
 * parlayPayout.test.ts — the two defects the PR #335 audit confirmed and that
 * survived the #336/#337 fixes.
 *
 * 1. SETTLEMENT OVERWROTE A PAYOUT THE PRICE DID NOT JUSTIFY.
 *    `createParlay` accepts a `toWin`, so a ticket can legitimately carry a
 *    payout that is not what its odds imply — a boosted or promotional price
 *    where the book pays more than the arithmetic. Settlement recomputed
 *    `toWin` from `odds` on every write, including the common case of a WIN
 *    with no dropped legs where the price never moved at all. The figure the
 *    user copied off their own bet slip silently became a different figure,
 *    with no edit and no log line.
 *
 * 2. A BACKDATED TICKET DID NOT SETTLE ON CREATION.
 *    `create` grades a past-dated straight bet immediately; `createParlay` had
 *    no equivalent, so an identical-looking parlay sat PENDING until a sweep
 *    reached it.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { settleParlay, calcParlayToWin, combineLegOdds, type ParlayLeg } from "./parlayCore";
import type { BetResult } from "./betTrackerCore";

const code = (p: string) =>
  readFileSync(join(__dirname, p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const grader = code("parlayGrader.ts");
const router = code("routers/betTracker.ts");

const leg = (i: number, result: BetResult, odds = -110): ParlayLeg => ({
  legIndex: i, sport: "MLB", gameDate: "2026-08-04",
  awayTeam: "NYY", homeTeam: "BOS", market: "ML", pickSide: "AWAY",
  timeframe: "FULL_GAME", odds, line: null, result,
});

describe("a boosted payout survives settlement", () => {
  it("REGRESSION: the price is unchanged when no leg was dropped", () => {
    // This is the case the old code got wrong. All legs win, nothing is
    // dropped, so repriceParlay returns the original — and the guard must
    // therefore leave the payout alone.
    const price = combineLegOdds([-110, -110]);
    const s = settleParlay([leg(0, "WIN"), leg(1, "WIN")], price);
    expect(s.result).toBe("WIN");
    expect(s.odds).toBe(price);
  });

  it("REGRESSION: settlement only recomputes the payout when the price moved", () => {
    expect(grader).toMatch(/const priceMoved = settlement\.odds != null && settlement\.odds !== ticket\.odds/);
    expect(grader).toMatch(/if \(priceMoved\) \{/);
  });

  it("the odds column is still written even when the payout is not", () => {
    // A ticket settling from PENDING still needs its odds persisted; only the
    // PAYOUT is protected.
    expect(grader).toMatch(/if \(settlement\.odds != null\) patch\.odds = settlement\.odds;/);
  });

  it("a dropped leg DOES move the payout, or the ticket would misreport", () => {
    // Three -110 legs entered at +596; one pushes.
    //
    // The result is +265, NOT the +264 that two -110 legs multiply to. That one
    // point is the rounding of the true 595.79 up to the 596 the user entered,
    // carried through the division — and it is correct: repricing divides the
    // dropped leg out of the price the user was actually quoted, it does not
    // rebuild the price from the survivors. Asserting 264 here would be
    // asserting the multiply-back behaviour this design deliberately rejects.
    const s = settleParlay([leg(0, "WIN"), leg(1, "WIN"), leg(2, "PUSH")], 596);
    expect(s.odds).toBe(265);
    expect(s.odds).not.toBe(596);
    expect(s.odds).not.toBe(combineLegOdds([-110, -110]));  // 264 = rebuilt, wrong
    expect(calcParlayToWin(100, s.odds!)).toBeCloseTo(265, 0);
  });

  it("the reprice is logged, so a changed payout is never silent", () => {
    const block = grader.slice(grader.indexOf("if (priceMoved)"));
    expect(block).toMatch(/repriced[\s\S]*payout/);
  });

  it("a boosted ticket keeps a payout its odds do not imply", () => {
    // +650 entered on legs that multiply to +811, paying 700 on a 100 stake —
    // 50 more than the entered price implies. Nothing in settlement may
    // reconcile those two numbers.
    const entered = 650;
    const impliedByOdds = calcParlayToWin(100, entered);
    const bookPaid = 700;
    expect(bookPaid).not.toBeCloseTo(impliedByOdds, 0);
    const s = settleParlay([leg(0, "WIN", -110), leg(1, "WIN", -110), leg(2, "WIN", 150)], entered);
    expect(s.odds).toBe(entered);   // unchanged -> payout untouched
  });
});

describe("a backdated ticket settles on creation", () => {
  const proc = router.slice(
    router.indexOf("createParlay:"),
    router.indexOf("delete: appUserProcedure"),
  );

  it("REGRESSION: createParlay has an auto-grade hook, like create", () => {
    expect(proc).toMatch(/gradeParlaysForUser\(userId, "createParlay"\)/);
  });

  it("REGRESSION: it keys on the EARLIEST leg, not the ticket's gameDate", () => {
    // The ticket is dated by its LAST leg so the stuck alarm does not fire
    // early. Keying the auto-grade off that same date would make a ticket with
    // one played game and one tomorrow look entirely in the future, skipping
    // the leg that could already settle.
    expect(proc).toMatch(/earliestLeg/);
    expect(proc).toMatch(/l\.gameDate < min \? l\.gameDate : min/);
    expect(proc).toMatch(/earliestLeg < todayPtParlay/);
  });

  it("grading failure never fails the create", () => {
    // The ticket is already written by this point; throwing here would report
    // failure for a bet that exists.
    const hook = proc.slice(proc.indexOf("earliestLeg <"));
    expect(hook).toMatch(/try \{[\s\S]*?gradeParlaysForUser[\s\S]*?catch/);
  });

  it("it runs AFTER the legs are written", () => {
    // Grading before the legs exist would find a ticket with legCount=N and no
    // legs — the state createParlay's rollback exists to prevent.
    const legInsert = proc.indexOf("db.insert(trackedBetLegs)");
    const autoGrade = proc.indexOf("gradeParlaysForUser");
    expect(legInsert).toBeGreaterThan(-1);
    expect(autoGrade).toBeGreaterThan(legInsert);
  });

  it("matches the timezone convention create uses", () => {
    // A UTC "today" would misclassify an evening PT game as tomorrow.
    expect(proc).toMatch(/America\/Los_Angeles/);
  });
});
