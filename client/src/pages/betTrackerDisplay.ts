/**
 * betTrackerDisplay.ts — the pure functions behind everything the Bet Tracker
 * renders.
 *
 * WHY THIS FILE EXISTS
 *
 * BetTracker.tsx is 5,600 lines and exported nothing, so none of it could be
 * reached from a test. Every server-side invariant in this feature is guarded —
 * settlement, pricing, grading coverage, the unit pair — while the code that
 * turns those numbers into what a user actually sees had no coverage at all.
 * That was the largest unguarded surface in the tracker and the only one users
 * look at directly.
 *
 * These are lifted VERBATIM from BetTracker.tsx. Behaviour is deliberately
 * unchanged: the point of this pass is to get the money-rendering path under
 * test before anything about it is altered. Two known divergences are recorded
 * in the tests rather than silently "fixed" here.
 */

export type Market = "ML" | "RL" | "TOTAL";
export type PickSide = "AWAY" | "HOME" | "OVER" | "UNDER";
export type Result = "PENDING" | "WIN" | "LOSS" | "PUSH" | "VOID";

export interface OddsLeg {
  odds?: number | null;
  value?: number | null;
}
export interface GameOdds {
  awayMl?: OddsLeg | null;
  homeMl?: OddsLeg | null;
  awayRl?: OddsLeg | null;
  homeRl?: OddsLeg | null;
  over?: OddsLeg | null;
  under?: OddsLeg | null;
}

// ─── Dates ────────────────────────────────────────────────────────────────────

/** Today in America/New_York as YYYY-MM-DD. */
export function todayEst(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/** Today in America/Los_Angeles as YYYY-MM-DD — the tracker's grading day. */
export function todayPt(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

/**
 * Subtract N days from a YYYY-MM-DD string.
 *
 * Anchored at T12:00:00Z on purpose: parsing a bare date as UTC midnight and
 * then formatting it back can land on the previous day for any viewer behind
 * UTC, so date ranges would silently shift by one.
 */
export function subtractDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** YYYY-MM-DD to the US M/D/Y the cards display. */
export function fmtDate(d: string): string {
  const [y, m, day] = d.split("-");
  return `${m}/${day}/${y}`;
}

// ─── Money ────────────────────────────────────────────────────────────────────

/**
 * To-win from American odds and a risk amount.
 *
 * NOTE: rounds to FOUR places, while the server's `calcToWin` in
 * betTrackerCore rounds to TWO. Preserved exactly as it was — see the tests,
 * which pin the divergence rather than paper over it.
 */
export function calcToWin(odds: number, risk: number): number {
  if (!odds || !risk || risk <= 0) return 0;
  if (odds >= 100) return parseFloat((risk * (odds / 100)).toFixed(4));
  return parseFloat((risk * (100 / Math.abs(odds))).toFixed(4));
}

/** American odds with an explicit sign, as books quote them. */
export function fmtOdds(o: number): string {
  return o >= 0 ? `+${o}` : `${o}`;
}

/** Dollars with the sign OUTSIDE the currency symbol: -$12.50, not $-12.50. */
export function fmtDollar(n: number): string {
  const abs = Math.abs(n);
  const str = abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return n < 0 ? `-$${str}` : `$${str}`;
}

/** Units to two places with a trailing u. */
export function fmtUnits(n: number): string {
  const abs = Math.abs(n);
  const str = abs.toFixed(2);
  return n < 0 ? `-${str}u` : `${str}u`;
}

// ─── Book odds lookup ─────────────────────────────────────────────────────────

/** The price the book is showing for a given market and side. */
export function getPickOdds(
  odds: GameOdds | null,
  market: Market,
  pickSide: PickSide,
): number | null {
  if (!odds) return null;
  switch (market) {
    case "ML":
      return pickSide === "AWAY" ? (odds.awayMl?.odds ?? null) : (odds.homeMl?.odds ?? null);
    case "RL":
      return pickSide === "AWAY" ? (odds.awayRl?.odds ?? null) : (odds.homeRl?.odds ?? null);
    case "TOTAL":
      return pickSide === "OVER" ? (odds.over?.odds ?? null) : (odds.under?.odds ?? null);
  }
}

/**
 * The line the book is showing.
 *
 * Returns the RAW SIGNED value. Do not take its absolute value: a home
 * favourite's run line is -1.5 and an away underdog's is +1.5, and the grader
 * computes `pickedMargin + line > 0`. An earlier Math.abs() here graded
 * SEA -1.5 winning by one run as a WIN.
 *
 * ML has no line, by definition.
 */
export function getPickLine(
  odds: GameOdds | null,
  market: Market,
  pickSide: PickSide,
): number | null {
  if (!odds) return null;
  switch (market) {
    case "RL":
      return pickSide === "AWAY" ? (odds.awayRl?.value ?? null) : (odds.homeRl?.value ?? null);
    case "TOTAL":
      return pickSide === "OVER" ? (odds.over?.value ?? null) : (odds.under?.value ?? null);
    default:
      return null;
  }
}

// ─── Result presentation ──────────────────────────────────────────────────────

/**
 * Brand law v2: WIN is mint, LOSS is the scoped red token, and every
 * no-signal state (PUSH / PENDING / VOID) demotes to secondary grey so the
 * signal states pop.
 */
export function resultColor(r: Result): string {
  switch (r) {
    case "WIN":
      return "text-primary";
    case "LOSS":
      return "text-[color:var(--bt-red)]";
    case "PUSH":
    case "PENDING":
    case "VOID":
    default:
      return "bt-dim";
  }
}
