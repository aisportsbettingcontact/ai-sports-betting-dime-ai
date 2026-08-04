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
import {
  MAX_PARLAY_LEGS,
  MIN_PARLAY_LEGS,
  americanToDecimal,
  decimalToAmerican,
  combineLegOdds,
  calcParlayToWin,
  validateParlayLegs,
  type ParlayValidation,
} from "@shared/parlayPricing";

// Re-exported so every existing server import of parlayCore is unchanged, and
// so there is exactly one implementation of the price arithmetic.
export {
  MAX_PARLAY_LEGS,
  MIN_PARLAY_LEGS,
  americanToDecimal,
  decimalToAmerican,
  combineLegOdds,
  calcParlayToWin,
  validateParlayLegs,
};
export type { ParlayValidation };

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


/** Short human label for a leg, used in grading reasons. */
export function describeLeg(leg: Pick<ParlayLeg, "awayTeam" | "homeTeam" | "market" | "pickSide" | "line" | "timeframe">): string {
  const game = `${leg.awayTeam}@${leg.homeTeam}`;
  if (leg.timeframe === "NRFI" || leg.timeframe === "YRFI") return `${leg.timeframe} ${game}`;
  if (leg.market === "TOTAL") return `${leg.pickSide} ${leg.line ?? "?"} ${game}`;
  if (leg.market === "RL") return `${leg.pickSide} ${leg.line ?? "?"} ${game}`;
  return `${leg.pickSide} ML ${game}`;
}
