/**
 * betTrackerEquityCurve.test.ts — the equity curve must stay bounded in
 * transport while every figure derived from it stays exact.
 *
 * WHY THIS EXISTS
 *
 * The curve carried one point per settled bet, so it grew with no ceiling.
 * Measured against a real MySQL at 50,000 bets, the stats block was 4,045 KB
 * and 3,992 KB of it (99%) was the curve — everything else, including all
 * seven breakdowns, totalled 53 KB and stays flat.
 *
 * Thinning it is only safe if two things hold, and both are easy to break by
 * accident:
 *
 *   1. The headline numbers (ath, maxDrawdown, streaks, day records) are
 *      computed over the COMPLETE series, never the thinned one.
 *   2. Points the rest of the payload points AT — the all-time high and the
 *      max-drawdown trough, flagged `isSpecial` — survive thinning, or the
 *      chart renders a marker for a bet that is not in the series.
 */

import { describe, it, expect } from "vitest";
import {
  aggregateStats,
  downsampleEquityCurve,
  EQUITY_CURVE_MAX_POINTS,
  type EquityPoint,
  type StatRow,
} from "./betTrackerCore";

function point(i: number, cumPL: number, isSpecial = false): EquityPoint {
  return {
    date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
    cumPL,
    betId: i,
    label: `Pick ${i}`,
    pick: `Pick ${i}`,
    result: cumPL >= 0 ? "WIN" : "LOSS",
    pl: 1,
    odds: -110,
    units: 1,
    ...(isSpecial ? { isSpecial: true } : {}),
  };
}

/** A curve with a clear peak and trough so shape loss is detectable. */
function curveWithExtremes(n: number): EquityPoint[] {
  const out: EquityPoint[] = [];
  for (let i = 0; i < n; i++) {
    // Gentle sawtooth, plus one dominant spike and one dominant crash.
    let v = Math.sin(i / 7) * 3;
    if (i === Math.floor(n * 0.4)) v = 500;
    if (i === Math.floor(n * 0.7)) v = -500;
    out.push(point(i, parseFloat(v.toFixed(2))));
  }
  return out;
}

describe("downsampleEquityCurve", () => {
  it("returns the curve untouched when it already fits", () => {
    const c = curveWithExtremes(100);
    expect(downsampleEquityCurve(c, 750)).toBe(c);
  });

  it("returns the curve untouched at exactly the cap", () => {
    const c = curveWithExtremes(750);
    expect(downsampleEquityCurve(c, 750)).toBe(c);
  });

  it("never exceeds the cap, at any scale", () => {
    for (const n of [751, 1_000, 10_000, 50_000]) {
      const out = downsampleEquityCurve(curveWithExtremes(n), 750);
      expect(out.length).toBeLessThanOrEqual(750);
    }
  });

  it("keeps the first and last points, which anchor the chart's axes", () => {
    const c = curveWithExtremes(10_000);
    const out = downsampleEquityCurve(c, 750);
    expect(out[0].betId).toBe(c[0].betId);
    expect(out[out.length - 1].betId).toBe(c[c.length - 1].betId);
  });

  it("preserves chronological order", () => {
    const out = downsampleEquityCurve(curveWithExtremes(10_000), 750);
    const ids = out.map(p => p.betId);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  it("REGRESSION: keeps every isSpecial point, or markers dangle", () => {
    // The ATH and max-drawdown markers are keyed by betId. If thinning drops
    // one, the chart references a bet that is not in the series it was handed.
    const c = curveWithExtremes(20_000);
    c[7_777].isSpecial = true;   // stand-in for the all-time high
    c[15_004].isSpecial = true;  // stand-in for the max-drawdown trough
    const out = downsampleEquityCurve(c, 750);
    const kept = new Set(out.map(p => p.betId));
    expect(kept.has(7_777)).toBe(true);
    expect(kept.has(15_004)).toBe(true);
  });

  it("keeps the anchors even when they alone would blow the budget", () => {
    const c = curveWithExtremes(1_000);
    for (let i = 0; i < 1_000; i += 2) c[i].isSpecial = true;
    const out = downsampleEquityCurve(c, 10);
    // Every special point survives; the cap yields to correctness.
    expect(out.every((p, i) => i === 0 || p.betId > out[i - 1].betId)).toBe(true);
    expect(out.filter(p => p.isSpecial).length).toBe(500);
  });

  it("retains the peak and the crash rather than averaging them away", () => {
    // A mean-based reducer would smooth these out; a bettor reads the curve
    // precisely for them.
    const c = curveWithExtremes(10_000);
    const out = downsampleEquityCurve(c, 750);
    const vals = out.map(p => p.cumPL);
    expect(Math.max(...vals)).toBe(500);
    expect(Math.min(...vals)).toBe(-500);
  });

  it("rejects a nonsensical cap rather than returning a degenerate curve", () => {
    expect(() => downsampleEquityCurve(curveWithExtremes(10), 1)).toThrow(/maxPoints/);
  });

  it("handles an empty curve", () => {
    expect(downsampleEquityCurve([], 750)).toEqual([]);
  });

  it("ships a cap that is sane for a chart under ~900px", () => {
    expect(EQUITY_CURVE_MAX_POINTS).toBeGreaterThanOrEqual(250);
    expect(EQUITY_CURVE_MAX_POINTS).toBeLessThanOrEqual(2_000);
  });
});

describe("scalars are computed over the complete series", () => {
  const rows: StatRow[] = [];
  for (let i = 0; i < 5_000; i++) {
    // Deterministic alternating book with one huge win late in the series, so
    // the all-time high sits at a point a thinned curve would likely drop.
    const win = i % 3 !== 0;
    rows.push({
      id: i + 1,
      gameDate: `2026-${String((i % 12) + 1).padStart(2, "0")}-15`,
      result: win ? "WIN" : "LOSS",
      sport: "MLB",
      market: "ML",
      betType: "ML",
      timeframe: "FULL_GAME",
      wagerType: "PREGAME",
      pick: `Pick ${i}`,
      odds: -110,
      risk: "100.00",
      toWin: i === 4_321 ? "9000.00" : "90.91",
      riskUnits: "1.00",
      toWinUnits: i === 4_321 ? "90.00" : "0.91",
    } as StatRow);
  }

  const stats = aggregateStats(rows, 100);

  it("produces one raw point per settled bet before any thinning", () => {
    expect(stats.equityCurve.length).toBe(5_000);
  });

  it("the thinned curve is bounded but the scalars are unchanged", () => {
    const thinned = downsampleEquityCurve(stats.equityCurve, 750);
    expect(thinned.length).toBeLessThanOrEqual(750);

    // Recomputing from the thinned curve would give a different maximum; these
    // must come from the full series.
    const maxOfThinned = Math.max(...thinned.map(p => p.cumPL));
    const maxOfFull = Math.max(...stats.equityCurve.map(p => p.cumPL));
    expect(stats.ath).toBeCloseTo(maxOfFull, 2);
    expect(maxOfFull).toBeGreaterThanOrEqual(maxOfThinned);
  });

  it("counts every settled bet in the totals regardless of curve length", () => {
    expect(stats.wins + stats.losses).toBe(5_000);
  });
});
