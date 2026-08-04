/**
 * parlayCore.test.ts — the rules that decide what a parlay ticket pays.
 *
 * A parlay is the highest-leverage thing in the tracker to get wrong: one
 * ticket can carry ten legs, its price is not fixed at write time (a push
 * reprices it), and grading re-runs on a schedule, so a settlement routine
 * that is not idempotent will quietly drift a user's record every 30 minutes.
 *
 * These tests encode the owner-confirmed contract:
 *   push/void drops the leg and reprices; SGP allowed; 10 legs max; one stake.
 */

import { describe, it, expect } from "vitest";
import {
  MAX_PARLAY_LEGS,
  MIN_PARLAY_LEGS,
  americanToDecimal,
  decimalToAmerican,
  combineLegOdds,
  settleParlay,
  repriceParlay,
  calcParlayToWin,
  validateParlayLegs,
  describeLeg,
  type ParlayLeg,
} from "./parlayCore";
import type { BetResult } from "./betTrackerCore";

const leg = (i: number, result: BetResult, odds = -110, over: Partial<ParlayLeg> = {}): ParlayLeg => ({
  legIndex: i,
  sport: "MLB",
  gameDate: "2026-08-04",
  awayTeam: "NYY",
  homeTeam: "BOS",
  market: "ML",
  pickSide: "AWAY",
  timeframe: "FULL_GAME",
  odds,
  line: null,
  result,
  ...over,
});

describe("American ↔ decimal", () => {
  it("converts favourites and underdogs", () => {
    expect(americanToDecimal(100)).toBeCloseTo(2.0, 10);
    expect(americanToDecimal(-100)).toBeCloseTo(2.0, 10);
    expect(americanToDecimal(150)).toBeCloseTo(2.5, 10);
    expect(americanToDecimal(-110)).toBeCloseTo(1.909090909, 8);
    expect(americanToDecimal(-200)).toBeCloseTo(1.5, 10);
  });

  it("rejects the gap between -100 and +100, which is not a price", () => {
    for (const bad of [0, 50, -50, 99, -99]) {
      expect(() => americanToDecimal(bad)).toThrow(/valid American price/);
    }
  });

  it("rejects non-numbers rather than producing NaN payouts", () => {
    expect(() => americanToDecimal(NaN)).toThrow();
    expect(() => americanToDecimal(Infinity)).toThrow();
  });

  it("round-trips, resolving even money to +100", () => {
    expect(decimalToAmerican(2.0)).toBe(100);
    for (const o of [100, 150, 250, 1000, -110, -150, -200, -500]) {
      expect(decimalToAmerican(americanToDecimal(o))).toBe(o);
    }
  });

  it("rejects a decimal that pays nothing", () => {
    expect(() => decimalToAmerican(1.0)).toThrow(/above 1.0/);
    expect(() => decimalToAmerican(0.5)).toThrow();
  });
});

describe("combineLegOdds", () => {
  it("prices a two-leg parlay of -110s at the familiar +264", () => {
    // 1.90909^2 = 3.6446 -> +264
    expect(combineLegOdds([-110, -110])).toBe(264);
  });

  it("prices a three-leg parlay of -110s at +596, the true rounded value", () => {
    // Books quote this ticket at +595. The exact figure is 595.79, and they
    // round DOWN in their own favour. This helper rounds honestly, because it
    // only ever SUGGESTS a price — the user enters what their book actually
    // gave them, and that entered price is what the ticket settles at.
    expect(combineLegOdds([-110, -110, -110])).toBe(596);
  });

  it("is order-independent", () => {
    expect(combineLegOdds([-110, 150, -200])).toBe(combineLegOdds([-200, -110, 150]));
  });
});

describe("settleParlay — the settlement state machine", () => {
  it("WIN when every leg wins", () => {
    const s = settleParlay([leg(0, "WIN"), leg(1, "WIN")], 264);
    expect(s.result).toBe("WIN");
    expect(s.odds).toBe(264);
    expect(s.survivingLegs).toBe(2);
    expect(s.droppedLegs).toBe(0);
  });

  it("LOSS the moment any leg loses", () => {
    const s = settleParlay([leg(0, "WIN"), leg(1, "LOSS"), leg(2, "WIN")], 595);
    expect(s.result).toBe("LOSS");
    expect(s.reason).toMatch(/leg 2 lost/);
  });

  it("REGRESSION: LOSS even while other legs are still pending", () => {
    // A lost leg is terminal. Reporting PENDING here would overstate open risk
    // on the user's page and delay the ticket showing as settled.
    const s = settleParlay([leg(0, "LOSS"), leg(1, "PENDING"), leg(2, "PENDING")], 595);
    expect(s.result).toBe("LOSS");
    expect(s.reason).toMatch(/cannot rescue/);
  });

  it("PENDING while any leg is open and none has lost", () => {
    const s = settleParlay([leg(0, "WIN"), leg(1, "PENDING")], 264);
    expect(s.result).toBe("PENDING");
    expect(s.odds).toBeNull();
  });

  it("VOID when every leg pushes — the stake comes back", () => {
    const s = settleParlay([leg(0, "PUSH"), leg(1, "PUSH")], 264);
    expect(s.result).toBe("VOID");
    expect(s.droppedLegs).toBe(2);
    expect(s.survivingLegs).toBe(0);
  });

  it("VOID when every leg is a mix of PUSH and VOID", () => {
    expect(settleParlay([leg(0, "PUSH"), leg(1, "VOID")], 264).result).toBe("VOID");
  });

  it("drops a pushed leg and reprices the rest", () => {
    // Three -110 legs priced +595; one pushes -> two legs -> +264.
    const s = settleParlay([leg(0, "WIN"), leg(1, "WIN"), leg(2, "PUSH")], 595);
    expect(s.result).toBe("WIN");
    expect(s.odds).toBe(264);
    expect(s.survivingLegs).toBe(2);
    expect(s.droppedLegs).toBe(1);
    expect(s.reason).toMatch(/repriced 595 -> 264/);
  });

  it("a single surviving winner pays that leg's own price", () => {
    const s = settleParlay(
      [leg(0, "WIN", 150), leg(1, "PUSH", -110), leg(2, "PUSH", -110)],
      combineLegOdds([150, -110, -110]),
    );
    expect(s.result).toBe("WIN");
    expect(s.odds).toBe(150);
  });

  it("treats VOID legs the same as pushes for repricing", () => {
    const s = settleParlay([leg(0, "WIN"), leg(1, "WIN"), leg(2, "VOID")], 595);
    expect(s.odds).toBe(264);
  });

  it("refuses to settle a ticket with no legs", () => {
    expect(() => settleParlay([], 264)).toThrow(/must have legs/);
  });

  it("handles a full ten-leg ticket", () => {
    const legs = Array.from({ length: MAX_PARLAY_LEGS }, (_, i) => leg(i, "WIN"));
    const price = combineLegOdds(legs.map(l => l.odds));
    const s = settleParlay(legs, price);
    expect(s.result).toBe("WIN");
    expect(s.survivingLegs).toBe(10);
  });
});

describe("repriceParlay — idempotent by construction", () => {
  it("is a no-op when nothing was dropped", () => {
    expect(repriceParlay(595, [])).toBe(595);
  });

  it("REGRESSION: repricing twice gives the same answer", () => {
    // Grading re-runs every 30 minutes. If repricing mutated incrementally,
    // a ticket's odds would decay on every sweep.
    const once = repriceParlay(595, [-110]);
    const twice = repriceParlay(595, [-110]);
    expect(once).toBe(twice);
    expect(once).toBe(264);
  });

  it("is order-independent across dropped legs", () => {
    const price = combineLegOdds([-110, 150, -200, 120]);
    expect(repriceParlay(price, [150, -200])).toBe(repriceParlay(price, [-200, 150]));
  });

  it("restores the original price if a leg stops being dropped", () => {
    // A leg corrected from PUSH back to WIN must give the full price back,
    // not a compounded one.
    expect(repriceParlay(595, [])).toBe(595);
  });

  it("preserves a boosted or correlated price rather than recomputing it", () => {
    // An SGP priced +400 whose legs multiply to +595. Dropping a -110 leg must
    // divide the ENTERED price, keeping the user's basis, not rebuild from legs.
    const entered = 400;
    const out = repriceParlay(entered, [-110]);
    const rebuiltFromLegs = combineLegOdds([-110, -110]);
    expect(out).not.toBe(rebuiltFromLegs);
    expect(out).toBe(decimalToAmerican(americanToDecimal(400) / americanToDecimal(-110)));
  });

  it("refuses to produce a price that pays nothing", () => {
    // Dropping legs worth more than the whole ticket is a corrupt ticket, not
    // a negative payout.
    expect(() => repriceParlay(-110, [500, 500])).toThrow(/no payout/);
  });
});

describe("calcParlayToWin", () => {
  it("pays the ticket price on the single stake", () => {
    expect(calcParlayToWin(100, 264)).toBeCloseTo(264, 2);
    expect(calcParlayToWin(50, -110)).toBeCloseTo(45.45, 2);
  });

  it("agrees with the odds the user is shown", () => {
    // toWin is derived from the same rounded price that is displayed, so the
    // ticket never shows +264 while paying a different number.
    const odds = repriceParlay(595, [-110]);
    expect(calcParlayToWin(100, odds)).toBeCloseTo(264, 2);
  });
});

describe("validateParlayLegs", () => {
  const ml = (odds = -110) => ({ odds, market: "ML" as const, line: null });

  it("accepts a normal ticket", () => {
    expect(validateParlayLegs([ml(), ml()])).toEqual({ ok: true });
  });

  it("rejects fewer than two legs", () => {
    expect(validateParlayLegs([ml()])).toMatchObject({ ok: false });
    expect(validateParlayLegs([])).toMatchObject({ ok: false });
  });

  it(`rejects more than ${MAX_PARLAY_LEGS} legs`, () => {
    const legs = Array.from({ length: MAX_PARLAY_LEGS + 1 }, () => ml());
    expect(validateParlayLegs(legs)).toMatchObject({ ok: false, message: /at most 10/ });
  });

  it(`accepts exactly ${MAX_PARLAY_LEGS} legs`, () => {
    expect(validateParlayLegs(Array.from({ length: MAX_PARLAY_LEGS }, () => ml()))).toEqual({ ok: true });
  });

  it("rejects an unparseable price", () => {
    expect(validateParlayLegs([ml(0), ml()])).toMatchObject({ ok: false, message: /Leg 1/ });
  });

  it("REGRESSION: rejects RL/TOTAL legs with no line", () => {
    // Without a line these can never settle, so the whole ticket would sit
    // PENDING forever and eventually trip the stuck-bet alarm.
    expect(validateParlayLegs([{ odds: -110, market: "TOTAL", line: null }, ml()]))
      .toMatchObject({ ok: false, message: /needs a line/ });
    expect(validateParlayLegs([{ odds: -110, market: "RL", line: null }, ml()]))
      .toMatchObject({ ok: false, message: /needs a line/ });
  });

  it("accepts RL/TOTAL legs that carry a line, including 0", () => {
    expect(validateParlayLegs([{ odds: -110, market: "TOTAL", line: 8.5 }, ml()])).toEqual({ ok: true });
    expect(validateParlayLegs([{ odds: -110, market: "RL", line: 0 }, ml()])).toEqual({ ok: true });
  });

  it("ALLOWS same-game legs — the contract puts no correlation restriction on SGPs", () => {
    expect(validateParlayLegs([ml(), ml(), ml()])).toEqual({ ok: true });
  });

  it("MIN and MAX are the contract's numbers", () => {
    expect(MIN_PARLAY_LEGS).toBe(2);
    expect(MAX_PARLAY_LEGS).toBe(10);
  });
});

describe("describeLeg", () => {
  it("labels the markets the product actually has", () => {
    expect(describeLeg(leg(0, "WIN"))).toBe("AWAY ML NYY@BOS");
    expect(describeLeg(leg(0, "WIN", -110, { market: "TOTAL", pickSide: "OVER", line: 8.5 })))
      .toBe("OVER 8.5 NYY@BOS");
    expect(describeLeg(leg(0, "WIN", -110, { market: "RL", pickSide: "HOME", line: -1.5 })))
      .toBe("HOME -1.5 NYY@BOS");
  });

  it("labels NRFI/YRFI by timeframe, since they are not separate markets", () => {
    expect(describeLeg(leg(0, "WIN", -110, { timeframe: "NRFI" }))).toBe("NRFI NYY@BOS");
    expect(describeLeg(leg(0, "WIN", -110, { timeframe: "YRFI" }))).toBe("YRFI NYY@BOS");
  });
});
