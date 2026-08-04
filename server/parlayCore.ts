/**
 * parlayCore.ts — parlay pricing and settlement, as pure functions.
 *
 * No DB, no clock, no network — same discipline as betTrackerCore.ts, for the
 * same reason: the rules that decide what a ticket pays are the ones that must
 * be provable without a database.
 *
 * THE CONTRACT (owner-confirmed, 2026-08-04)
 *
 *   - A parlay carries ONE stake. Legs have no independent risk or to-win;
 *     each leg contributes only its own WIN/LOSS/PUSH/VOID outcome.
 *   - A pushed or voided leg is DROPPED and the ticket is repriced at the
 *     reduced odds. Every surviving leg must still win.
 *   - Same-game parlays are allowed with no correlation restriction.
 *   - Ten legs maximum.
 *   - Legs use the existing market vocabulary — ML / RL / TOTAL, with
 *     NRFI/YRFI expressed as timeframes. There are no player or game props in
 *     the product, so a same-game parlay means "TEX ML + OVER 8.5", not a
 *     prop combination.
 *
 * WHY REPRICING DIVIDES RATHER THAN MULTIPLIES
 *
 * The obvious implementation reprices by multiplying the surviving legs'
 * prices together. That is wrong whenever the ticket's price is not the plain
 * product of its legs — which is exactly the case for a same-game parlay
 * (correlation-adjusted) or a boosted price. Those tickets are allowed here,
 * so recomputing from the legs would silently overwrite the price the user
 * actually got.
 *
 * Instead the ticket keeps the price as entered (`originalOdds`) and repricing
 * divides out the dropped legs' decimal prices. When the entered price IS the
 * product, the two approaches agree exactly. When it is not, dividing
 * preserves the user's basis — which is the best available approximation,
 * since a book's true SGP re-pricing is not derivable from the leg prices.
 *
 * IDEMPOTENCE
 *
 * Grading re-runs on a schedule, so settlement must be a pure function of
 * current leg state, never an incremental mutation. Every price here is
 * derived from `originalOdds` and the CURRENT set of dropped legs. Repricing
 * the same ticket twice yields the same number; a leg that flips from PUSH
 * back to WIN restores the original price rather than compounding.
 */

import type { BetResult, Market, PickSide, Timeframe } from "./betTrackerCore";

/** Contract: ten legs maximum. */
export const MAX_PARLAY_LEGS = 10;

/** Contract: a parlay is only a parlay with at least two legs. */
export const MIN_PARLAY_LEGS = 2;

export interface ParlayLeg {
  /** Position in the ticket, 0-based. Display order only; pricing is order-free. */
  legIndex: number;
  sport: string;
  gameDate: string;
  awayTeam: string;
  homeTeam: string;
  market: Market;
  pickSide: PickSide;
  timeframe: Timeframe;
  /** The leg's own American price. Needed to drop it out of the ticket price. */
  odds: number;
  line: number | null;
  result: BetResult;
}

// ─── American ↔ decimal ───────────────────────────────────────────────────────

/**
 * American odds to decimal (total return per unit staked, stake included).
 *
 * ±100 both mean even money. American odds have no representation strictly
 * between -100 and +100, so anything in that gap is a corrupt row rather than
 * a price; reject it instead of silently returning a payout nobody agreed to.
 */
export function americanToDecimal(odds: number): number {
  if (!Number.isFinite(odds)) throw new Error(`americanToDecimal: not a number (${odds})`);
  if (odds >= 100) return 1 + odds / 100;
  if (odds <= -100) return 1 + 100 / Math.abs(odds);
  throw new Error(`americanToDecimal: ${odds} is not a valid American price (|odds| >= 100)`);
}

/**
 * Decimal back to American, rounded to a whole number as books quote it.
 *
 * Even money resolves to +100, not -100. Both are the same price; picking one
 * consistently keeps round-tripping stable.
 */
export function decimalToAmerican(dec: number): number {
  if (!Number.isFinite(dec) || dec <= 1) {
    throw new Error(`decimalToAmerican: ${dec} is not a payout above 1.0`);
  }
  if (dec >= 2) return Math.round((dec - 1) * 100);
  return -Math.round(100 / (dec - 1));
}

/** The plain product price of a set of legs — what a straight parlay is worth. */
export function combineLegOdds(legOdds: number[]): number {
  if (legOdds.length === 0) throw new Error("combineLegOdds: no legs");
  const dec = legOdds.reduce((acc, o) => acc * americanToDecimal(o), 1);
  return decimalToAmerican(dec);
}

// ─── Settlement ───────────────────────────────────────────────────────────────

/** A leg that is dropped from the ticket rather than settled. */
function isDropped(result: BetResult): boolean {
  return result === "PUSH" || result === "VOID";
}

export interface ParlaySettlement {
  /** The ticket's result. */
  result: BetResult;
  /** Price after dropping pushed/voided legs. Null while the ticket is open. */
  odds: number | null;
  /** Legs still counted toward the ticket. */
  survivingLegs: number;
  /** Legs dropped as PUSH/VOID. */
  droppedLegs: number;
  /** Human-readable account of the decision, for the grading log. */
  reason: string;
}

/**
 * Settle a parlay from its legs.
 *
 * The order of these branches is the contract:
 *
 *   1. ANY leg LOSS  → the ticket is LOST, immediately, even with legs still
 *      pending. There is no sequence of later results that can rescue it, and
 *      leaving it PENDING would misreport open risk on the user's page.
 *   2. ALL legs dropped → VOID. Every leg pushed, so the stake comes back and
 *      the ticket never really happened.
 *   3. ANY leg PENDING → PENDING. Nothing is decided yet.
 *   4. Otherwise every surviving leg WON → WIN at the repriced odds.
 */
export function settleParlay(legs: ParlayLeg[], originalOdds: number): ParlaySettlement {
  if (legs.length === 0) throw new Error("settleParlay: a parlay must have legs");

  const lost = legs.filter(l => l.result === "LOSS");
  const dropped = legs.filter(l => isDropped(l.result));
  const pending = legs.filter(l => l.result === "PENDING");
  const survivors = legs.filter(l => !isDropped(l.result));

  if (lost.length > 0) {
    return {
      result: "LOSS",
      odds: originalOdds,
      survivingLegs: survivors.length,
      droppedLegs: dropped.length,
      reason:
        `leg ${lost[0].legIndex + 1} lost (${describeLeg(lost[0])})` +
        (pending.length > 0 ? ` — ${pending.length} leg(s) still open but cannot rescue the ticket` : ""),
    };
  }

  if (dropped.length === legs.length) {
    return {
      result: "VOID",
      odds: null,
      survivingLegs: 0,
      droppedLegs: dropped.length,
      reason: `all ${legs.length} legs pushed or voided — stake returned`,
    };
  }

  if (pending.length > 0) {
    return {
      result: "PENDING",
      odds: null,
      survivingLegs: survivors.length,
      droppedLegs: dropped.length,
      reason: `${pending.length} of ${legs.length} leg(s) still open`,
    };
  }

  const odds = repriceParlay(originalOdds, dropped.map(l => l.odds));
  return {
    result: "WIN",
    odds,
    survivingLegs: survivors.length,
    droppedLegs: dropped.length,
    reason:
      dropped.length === 0
        ? `all ${legs.length} legs won`
        : `${survivors.length} leg(s) won, ${dropped.length} pushed — repriced ${originalOdds} -> ${odds}`,
  };
}

/**
 * Remove dropped legs from a ticket price.
 *
 * Pure division on the decimal price, so it is idempotent and order-free:
 * repricing from the same original with the same dropped set always yields the
 * same number, no matter how many times grading re-runs.
 *
 * If dropping the legs would leave nothing to pay (decimal at or below 1.0),
 * the ticket has no value left and the caller should VOID it rather than book
 * a negative price.
 */
export function repriceParlay(originalOdds: number, droppedLegOdds: number[]): number {
  if (droppedLegOdds.length === 0) return originalOdds;
  const dropped = droppedLegOdds.reduce((acc, o) => acc * americanToDecimal(o), 1);
  const remaining = americanToDecimal(originalOdds) / dropped;
  if (remaining <= 1) {
    throw new Error(
      `repriceParlay: dropping those legs leaves no payout (decimal ${remaining.toFixed(4)})`,
    );
  }
  return decimalToAmerican(remaining);
}

/** To-win for a ticket, derived from the SAME rounded price the user is shown. */
export function calcParlayToWin(risk: number, odds: number): number {
  return parseFloat((risk * (americanToDecimal(odds) - 1)).toFixed(2));
}

// ─── Validation ───────────────────────────────────────────────────────────────

export type ParlayValidation = { ok: true } | { ok: false; message: string };

/**
 * Reject a ticket that cannot be settled correctly.
 *
 * Same-game legs are explicitly allowed — the contract permits them with no
 * correlation restriction — so duplicate anGameIds are NOT an error. What is
 * rejected is a ticket that is structurally unsettleable.
 */
export function validateParlayLegs(legs: Array<Pick<ParlayLeg, "odds" | "market" | "line">>): ParlayValidation {
  if (legs.length < MIN_PARLAY_LEGS) {
    return { ok: false, message: `A parlay needs at least ${MIN_PARLAY_LEGS} legs` };
  }
  if (legs.length > MAX_PARLAY_LEGS) {
    return { ok: false, message: `A parlay can have at most ${MAX_PARLAY_LEGS} legs` };
  }
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    try {
      americanToDecimal(leg.odds);
    } catch {
      return { ok: false, message: `Leg ${i + 1}: ${leg.odds} is not a valid American price` };
    }
    // RL and TOTAL are graded against a number; without one the leg can never
    // settle, which would strand the whole ticket on PENDING forever.
    if ((leg.market === "RL" || leg.market === "TOTAL") && leg.line == null) {
      return { ok: false, message: `Leg ${i + 1}: a ${leg.market} leg needs a line` };
    }
  }
  return { ok: true };
}

/** Short human label for a leg, used in grading reasons. */
export function describeLeg(leg: Pick<ParlayLeg, "awayTeam" | "homeTeam" | "market" | "pickSide" | "line" | "timeframe">): string {
  const game = `${leg.awayTeam}@${leg.homeTeam}`;
  if (leg.timeframe === "NRFI" || leg.timeframe === "YRFI") return `${leg.timeframe} ${game}`;
  if (leg.market === "TOTAL") return `${leg.pickSide} ${leg.line ?? "?"} ${game}`;
  if (leg.market === "RL") return `${leg.pickSide} ${leg.line ?? "?"} ${game}`;
  return `${leg.pickSide} ML ${game}`;
}
