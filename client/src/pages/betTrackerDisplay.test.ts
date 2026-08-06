/**
 * betTrackerDisplay.test.ts — the money-rendering path, under test at last.
 *
 * BetTracker.tsx is 5,600 lines and exported nothing, so none of this could be
 * reached from a test. Every server invariant in this feature is guarded while
 * the code that turns those numbers into what a user SEES had no coverage —
 * the largest unguarded surface in the tracker, and the only one users look at.
 *
 * These pin current behaviour exactly, including two divergences from the
 * server that are recorded rather than quietly changed. Getting the path under
 * test comes first; altering it is a separate decision.
 */

import { describe, it, expect } from "vitest";
import {
  todayEst,
  todayPt,
  subtractDays,
  fmtDate,
  calcToWin,
  fmtOdds,
  fmtDollar,
  fmtUnits,
  getPickOdds,
  getPickLine,
  resultColor,
  type GameOdds,
} from "./betTrackerDisplay";
import { calcToWin as serverCalcToWin } from "../../../server/betTrackerCore";

describe("fmtDollar", () => {
  it("puts the sign OUTSIDE the currency symbol", () => {
    // -$12.50 reads as money; $-12.50 reads as a bug.
    expect(fmtDollar(-12.5)).toBe("-$12.50");
    expect(fmtDollar(12.5)).toBe("$12.50");
  });

  it("always shows exactly two decimals", () => {
    expect(fmtDollar(5)).toBe("$5.00");
    expect(fmtDollar(5.1)).toBe("$5.10");
    expect(fmtDollar(5.129)).toBe("$5.13");
  });

  it("groups thousands", () => {
    expect(fmtDollar(1234.5)).toBe("$1,234.50");
    expect(fmtDollar(-1234567.89)).toBe("-$1,234,567.89");
  });

  it("renders zero without a sign", () => {
    expect(fmtDollar(0)).toBe("$0.00");
    // Negative zero must not render as -$0.00.
    expect(fmtDollar(-0)).toBe("$0.00");
  });

  it("rounds half up at the cent", () => {
    expect(fmtDollar(0.005)).toBe("$0.01");
    expect(fmtDollar(2.675)).toMatch(/^\$2\.6[78]$/); // float repr, either is defensible
  });
});

describe("fmtUnits", () => {
  it("suffixes u and keeps two decimals", () => {
    expect(fmtUnits(2)).toBe("2.00u");
    expect(fmtUnits(0.685)).toBe("0.69u");
    expect(fmtUnits(-1.5)).toBe("-1.50u");
  });

  it("puts the sign before the number, not after", () => {
    expect(fmtUnits(-0.25)).toBe("-0.25u");
  });

  it("renders zero without a sign", () => {
    expect(fmtUnits(0)).toBe("0.00u");
    expect(fmtUnits(-0)).toBe("0.00u");
  });

  it("REGRESSION: sub-cent units still render, rather than collapsing to 0.00u", () => {
    // A 0.02u stake is real — bet 450010 in production is exactly that. It
    // rounds for display, but the display must not imply a zero stake.
    expect(fmtUnits(0.02)).toBe("0.02u");
    expect(fmtUnits(0.004)).toBe("0.00u"); // genuinely below display precision
  });
});

describe("fmtOdds", () => {
  it("signs a favourite and an underdog the way books do", () => {
    expect(fmtOdds(150)).toBe("+150");
    expect(fmtOdds(-110)).toBe("-110");
  });

  it("REGRESSION: even money shows +100, never a bare 100", () => {
    expect(fmtOdds(100)).toBe("+100");
  });

  it("treats zero as positive rather than emitting a bare 0", () => {
    expect(fmtOdds(0)).toBe("+0");
  });
});

describe("calcToWin", () => {
  it("pays the underdog price on the stake", () => {
    expect(calcToWin(150, 100)).toBe(150);
    expect(calcToWin(264, 25)).toBe(66);
  });

  it("pays the favourite price on the stake", () => {
    expect(calcToWin(-110, 110)).toBe(100);
    expect(calcToWin(-200, 100)).toBe(50);
  });

  it("REGRESSION: guards against a zero or negative stake", () => {
    // Without this the form renders NaN or a negative payout while the user
    // is still typing.
    expect(calcToWin(-110, 0)).toBe(0);
    expect(calcToWin(-110, -5)).toBe(0);
    expect(calcToWin(0, 100)).toBe(0);
  });

  it("DIVERGENCE: rounds to 4 places where the server rounds to 2", () => {
    // Recorded, not fixed. The client shows 90.9091 while the server stores
    // 90.91 — and the column is decimal(10,2), so the stored value wins. The
    // display is more precise than anything that can be persisted.
    //
    // Changing either side alters what users see or what gets written, so it
    // is a decision in its own right rather than a drive-by edit inside a
    // test-coverage pass.
    expect(calcToWin(-110, 100)).toBe(90.9091);
    expect(serverCalcToWin(-110, 100)).toBe(90.91);
    expect(calcToWin(-110, 100)).not.toBe(serverCalcToWin(-110, 100));
  });

  it("DIVERGENCE: the server has no zero-stake guard", () => {
    expect(calcToWin(-110, 0)).toBe(0);
    expect(serverCalcToWin(-110, 0)).toBe(0); // same answer, different route
    // The client returns early; the server multiplies by zero. Equivalent here,
    // but the client also guards a NEGATIVE stake and the server does not.
    expect(calcToWin(-110, -5)).toBe(0);
    expect(serverCalcToWin(-110, -5)).toBeLessThan(0);
  });

  it("agrees with the server everywhere the extra precision does not matter", () => {
    for (const [odds, risk] of [
      [150, 100],
      [-200, 100],
      [100, 50],
      [-400, 200],
    ] as const) {
      expect(calcToWin(odds, risk), `${odds} on ${risk}`).toBe(
        serverCalcToWin(odds, risk)
      );
    }
  });
});

describe("subtractDays", () => {
  it("walks back within a month", () => {
    expect(subtractDays("2026-08-15", 7)).toBe("2026-08-08");
  });

  it("crosses a month boundary", () => {
    expect(subtractDays("2026-08-03", 7)).toBe("2026-07-27");
  });

  it("crosses a year boundary", () => {
    expect(subtractDays("2026-01-02", 7)).toBe("2025-12-26");
  });

  it("handles a leap day", () => {
    expect(subtractDays("2028-03-01", 1)).toBe("2028-02-29");
  });

  it("REGRESSION: anchored at midday so no viewer's timezone shifts the range", () => {
    // Parsing a bare date as UTC midnight and formatting it back lands on the
    // previous day for anyone behind UTC, silently shifting every date filter.
    expect(subtractDays("2026-08-15", 0)).toBe("2026-08-15");
    for (let d = 0; d <= 40; d++) {
      expect(subtractDays("2026-03-15", d)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("matches the ranges the page offers", () => {
    // L7 / L14 / 1M are inclusive of today, so they subtract one less.
    expect(subtractDays("2026-08-15", 6)).toBe("2026-08-09");
    expect(subtractDays("2026-08-15", 13)).toBe("2026-08-02");
    expect(subtractDays("2026-08-15", 29)).toBe("2026-07-17");
  });
});

describe("fmtDate", () => {
  it("renders US month/day/year", () => {
    expect(fmtDate("2026-08-04")).toBe("08/04/2026");
  });

  it("keeps the zero padding the ISO string carries", () => {
    expect(fmtDate("2026-01-09")).toBe("01/09/2026");
  });
});

describe("today helpers", () => {
  it("both return an ISO date", () => {
    expect(todayEst()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(todayPt()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("PT is never AHEAD of ET", () => {
    // They differ only across the midnight window, and PT is the later zone.
    const [et, pt] = [todayEst(), todayPt()];
    expect(pt <= et).toBe(true);
  });
});

describe("getPickOdds", () => {
  const odds: GameOdds = {
    awayMl: { odds: 145 },
    homeMl: { odds: -165 },
    awayRl: { odds: -120, value: 1.5 },
    homeRl: { odds: 100, value: -1.5 },
    over: { odds: -105, value: 8.5 },
    under: { odds: -115, value: 8.5 },
  };

  it("reads each market and side", () => {
    expect(getPickOdds(odds, "ML", "AWAY")).toBe(145);
    expect(getPickOdds(odds, "ML", "HOME")).toBe(-165);
    expect(getPickOdds(odds, "RL", "AWAY")).toBe(-120);
    expect(getPickOdds(odds, "RL", "HOME")).toBe(100);
    expect(getPickOdds(odds, "TOTAL", "OVER")).toBe(-105);
    expect(getPickOdds(odds, "TOTAL", "UNDER")).toBe(-115);
  });

  it("returns null with no odds at all, rather than throwing", () => {
    expect(getPickOdds(null, "ML", "AWAY")).toBeNull();
  });

  it("REGRESSION: a missing leg is null, never 0", () => {
    // Zero is not a valid American price, and treating a gap as 0 would ship a
    // bet the grader cannot settle.
    expect(getPickOdds({}, "ML", "AWAY")).toBeNull();
    expect(getPickOdds({ awayMl: null }, "ML", "AWAY")).toBeNull();
    expect(getPickOdds({ awayMl: { odds: null } }, "ML", "AWAY")).toBeNull();
  });

  it("treats a genuine 0 in the feed as the value it is", () => {
    // ?? only falls through on null/undefined, so a real 0 survives — which is
    // what lets validation reject it downstream instead of hiding it.
    expect(getPickOdds({ awayMl: { odds: 0 } }, "ML", "AWAY")).toBe(0);
  });
});

describe("getPickLine", () => {
  const odds: GameOdds = {
    awayRl: { odds: -120, value: 1.5 },
    homeRl: { odds: 100, value: -1.5 },
    over: { odds: -105, value: 8.5 },
    under: { odds: -115, value: 8.5 },
  };

  it("REGRESSION: returns the SIGNED run line, not its magnitude", () => {
    // A home favourite is -1.5 and an away underdog is +1.5. The grader
    // computes pickedMargin + line > 0, so an earlier Math.abs() here graded
    // SEA -1.5 winning by one run as a WIN.
    expect(getPickLine(odds, "RL", "HOME")).toBe(-1.5);
    expect(getPickLine(odds, "RL", "AWAY")).toBe(1.5);
  });

  it("returns the total for both sides", () => {
    expect(getPickLine(odds, "TOTAL", "OVER")).toBe(8.5);
    expect(getPickLine(odds, "TOTAL", "UNDER")).toBe(8.5);
  });

  it("ML has no line, by definition", () => {
    expect(getPickLine(odds, "ML", "AWAY")).toBeNull();
    expect(getPickLine(odds, "ML", "HOME")).toBeNull();
  });

  it("returns null with no odds, and for a missing leg", () => {
    expect(getPickLine(null, "RL", "AWAY")).toBeNull();
    expect(getPickLine({}, "RL", "AWAY")).toBeNull();
    expect(getPickLine({ awayRl: { odds: -110 } }, "RL", "AWAY")).toBeNull();
  });

  it("preserves a pick'em line of 0 rather than nulling it", () => {
    expect(getPickLine({ homeRl: { value: 0 } }, "RL", "HOME")).toBe(0);
  });
});

describe("resultColor", () => {
  it("WIN is the mint accent and LOSS is the scoped red token", () => {
    expect(resultColor("WIN")).toBe("text-primary");
    expect(resultColor("LOSS")).toBe("text-[color:var(--bt-red)]");
  });

  it("every no-signal state demotes to grey", () => {
    // Brand law v2: only WIN and LOSS carry colour, so they pop.
    for (const r of ["PUSH", "PENDING", "VOID"] as const) {
      expect(resultColor(r), r).toBe("bt-dim");
    }
  });

  it("uses no raw hex — colour comes from tokens", () => {
    for (const r of ["WIN", "LOSS", "PUSH", "PENDING", "VOID"] as const) {
      expect(resultColor(r)).not.toMatch(/#[0-9a-f]{3,8}/i);
    }
  });
});
