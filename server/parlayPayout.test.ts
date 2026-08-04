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

describe("riskUnits and toWinUnits are stored as a PAIR", () => {
  const router = readFileSync(join(__dirname, "routers/betTracker.ts"), "utf8");

  it("REGRESSION: createParlay derives toWinUnits when only riskUnits is sent", () => {
    // The first real production parlay stored riskUnits=0.25 and toWinUnits
    // NULL. riskUnits is authoritative regardless of the viewer's unit size,
    // so the pair disagreed: risk read 0.25u from the stored value while
    // to-win fell back to dollars ÷ today's unit size. Correct at a $100 unit,
    // and at $50 it showed 0.25u to win 1.37u — a 5.48x ratio on +274 odds.
    expect(router).toMatch(/resolveToWinUnits\(input\.riskUnits, input\.toWinUnits/);
  });

  it("explicit input still wins over the derivation", () => {
    const fn = router.slice(router.indexOf("function resolveToWinUnits"));
    expect(fn).toMatch(/if \(toWinUnits != null\) return String\(toWinUnits\)/);
  });

  it("returns null when there is no unit basis, rather than guessing", () => {
    // Both figures then fall back to dollars ÷ the viewer's unit size, which
    // is consistent even though it is not authoritative. Inventing a unit size
    // would be worse than admitting there isn't one.
    const fn = router.slice(router.indexOf("function resolveToWinUnits"));
    expect(fn).toMatch(/if \(riskUnits == null \|\| riskUnits <= 0\) return null/);
  });

  it("guards against a degenerate unit size", () => {
    const fn = router.slice(router.indexOf("function resolveToWinUnits"));
    expect(fn).toMatch(/!Number\.isFinite\(unitSize\) \|\| unitSize <= 0/);
  });

  it("REGRESSION: the client sends both, matching the straight-bet path", () => {
    const page = readFileSync(join(__dirname, "../client/src/pages/BetTracker.tsx"), "utf8");
    const proc = page.slice(page.indexOf("createParlayMut.mutateAsync"));
    const block = proc.slice(0, proc.indexOf("});"));
    expect(block).toMatch(/riskUnits:/);
    expect(block).toMatch(/toWinUnits:/);
  });

  it("REGRESSION: the stored pair implies the same price at ANY unit size", () => {
    // The property the live parlay violated. Payouts are rounded to the cent,
    // so the ratio can differ from the exact decimal profit by up to half a
    // cent spread over the stake — the tolerance below is that rounding, not
    // slack. What must NOT happen is the ratio changing with unit size, which
    // is exactly what a NULL toWinUnits caused.
    for (const [odds, riskDollars] of [
      [274, 25], [-110, 100], [596, 50], [150, 10], [-320, 80],
    ] as Array<[number, number]>) {
      const toWin = calcParlayToWin(riskDollars, odds);
      const impliedProfit = americanToDecimalLocal(odds) - 1;
      const ratios: number[] = [];

      for (const unitSize of [5, 25, 50, 100, 200]) {
        const riskUnits = riskDollars / unitSize;
        const toWinUnits = toWin / unitSize;
        const ratio = toWinUnits / riskUnits;
        ratios.push(ratio);
        // Within the cent-rounding of the payout.
        const tolerance = 0.005 / riskDollars + 1e-9;
        expect(
          Math.abs(ratio - impliedProfit),
          `odds ${odds} risk ${riskDollars} unit ${unitSize}`,
        ).toBeLessThan(tolerance);
      }

      // And identical across unit sizes — the actual invariant.
      for (const r of ratios) expect(r).toBeCloseTo(ratios[0], 12);
    }
  });

  it("REGRESSION: a NULL toWinUnits makes the ratio move with unit size", () => {
    // Demonstrates the defect this pair prevents: with toWinUnits absent,
    // to-win falls back to dollars ÷ the viewer's unit size while risk keeps
    // reading the stored value, so the implied price drifts.
    const riskDollars = 25, storedRiskUnits = 0.25, toWin = 68.5;
    const at = (unitSize: number) => (toWin / unitSize) / storedRiskUnits;
    expect(at(100)).toBeCloseTo(2.74, 2);   // correct only at the original unit
    expect(at(50)).toBeCloseTo(5.48, 2);    // double
    expect(at(200)).toBeCloseTo(1.37, 2);   // half
    expect(at(50)).not.toBeCloseTo(at(200), 2);
  });
});

/** Local decimal conversion so this test does not depend on export shape. */
function americanToDecimalLocal(odds: number): number {
  return odds >= 100 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds);
}
