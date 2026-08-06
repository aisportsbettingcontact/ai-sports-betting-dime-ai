/**
 * parlayPricing.ts — parlay price arithmetic, shared by client and server.
 *
 * This lives in shared/ for one reason: the entry UI has to show the user what
 * a ticket is worth BEFORE it is submitted, and the grader has to reprice it
 * afterwards. Those two numbers must come from the same code. A second copy in
 * the client would be a drift waiting to happen, and this codebase has already
 * paid for that once — three copies of the stats reducer had silently diverged,
 * with the one the UI actually called missing half its fields.
 *
 * Settlement itself (settleParlay, repriceParlay) stays server-side in
 * server/parlayCore.ts, which re-exports everything here so existing server
 * imports are unchanged.
 */

export type PricingMarket = "ML" | "RL" | "TOTAL";

/** Contract: ten legs maximum. */
export const MAX_PARLAY_LEGS = 10;

/** Contract: a parlay is only a parlay with at least two legs. */
export const MIN_PARLAY_LEGS = 2;

// ─── Exact arithmetic ─────────────────────────────────────────────────────────

/**
 * Parlay prices are computed as EXACT FRACTIONS, not floating point.
 *
 * IEEE-754 cannot represent most decimal odds. The failure is not theoretical:
 * a +115 and a +130 leg multiply to exactly 4.945, so the ticket is +394.5 and
 * rounds to +395 — but in floating point 2.15 * 2.30 is 4.944999999999999, the
 * profit lands on 394.49999999999994, and the ticket prices at +394. One point
 * wrong, on the number a user is quoted before committing money and the number
 * settlement later pays.
 *
 * American odds are all rationals with small denominators, so a BigInt fraction
 * represents them exactly and ten multiplications stay well inside range. The
 * only rounding happens once, at the end, where a whole-number American price
 * is required.
 */
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const HUNDRED = BigInt(100);

interface Frac {
  n: bigint;
  d: bigint;
}

function gcd(a: bigint, b: bigint): bigint {
  while (b) [a, b] = [b, a % b];
  return a || ONE;
}

function frac(n: bigint, d: bigint): Frac {
  if (d < ZERO) {
    n = -n;
    d = -d;
  }
  const g = gcd(n < ZERO ? -n : n, d);
  return { n: n / g, d: d / g };
}

/** American odds as an exact decimal-odds fraction (total return per unit). */
function decimalFrac(odds: number): Frac {
  if (!Number.isFinite(odds))
    throw new Error(`decimalFrac: not a number (${odds})`);
  const o = BigInt(Math.trunc(odds));
  if (odds >= 100) return frac(HUNDRED + o, HUNDRED); // 1 + odds/100
  if (odds <= -100) return frac(-o + HUNDRED, -o); // 1 + 100/|odds|
  throw new Error(
    `decimalFrac: ${odds} is not a valid American price (|odds| >= 100)`
  );
}

/** Round a positive rational half away from zero. */
function roundFrac(n: bigint, d: bigint): bigint {
  return (TWO * n + d) / (TWO * d);
}

/** Exact decimal-odds fraction back to a whole-number American price. */
function fracToAmerican(f: Frac): number {
  const profitN = f.n - f.d; // (dec - 1) as profitN/d
  if (profitN <= ZERO) {
    throw new Error(
      `fracToAmerican: ${Number(f.n) / Number(f.d)} is not a payout above 1.0`
    );
  }
  // dec >= 2  <=>  profit >= 1  <=>  profitN >= d
  if (profitN >= f.d) return Number(roundFrac(profitN * HUNDRED, f.d));
  return -Number(roundFrac(HUNDRED * f.d, profitN));
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
  if (!Number.isFinite(odds))
    throw new Error(`americanToDecimal: not a number (${odds})`);
  if (odds >= 100) return 1 + odds / 100;
  if (odds <= -100) return 1 + 100 / Math.abs(odds);
  throw new Error(
    `americanToDecimal: ${odds} is not a valid American price (|odds| >= 100)`
  );
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
  const product = legOdds
    .map(decimalFrac)
    .reduce((a, b) => frac(a.n * b.n, a.d * b.d), { n: ONE, d: ONE });
  return fracToAmerican(product);
}

/**
 * Divide dropped legs out of a ticket price, exactly.
 *
 * Settlement's counterpart to combineLegOdds, and exact for the same reason:
 * this is the number a repriced ticket actually pays.
 */
export function divideLegsOut(
  originalOdds: number,
  droppedLegOdds: number[]
): number {
  const original = decimalFrac(originalOdds);
  const dropped = droppedLegOdds
    .map(decimalFrac)
    .reduce((a, b) => frac(a.n * b.n, a.d * b.d), { n: ONE, d: ONE });
  // original / dropped
  const remaining = frac(original.n * dropped.d, original.d * dropped.n);
  if (remaining.n <= remaining.d) {
    throw new Error(
      `divideLegsOut: dropping those legs leaves no payout (decimal ${Number(remaining.n) / Number(remaining.d)})`
    );
  }
  return fracToAmerican(remaining);
}

// ─── Validation ───────────────────────────────────────────────────────────────

/** To-win for a ticket, derived from the SAME rounded price the user is shown. */
export function calcParlayToWin(risk: number, odds: number): number {
  return parseFloat((risk * (americanToDecimal(odds) - 1)).toFixed(2));
}

// ─── Validation ─────────────────────────────────────────────────────────────

export type ParlayValidation = { ok: true } | { ok: false; message: string };

/**
 * Reject a ticket that cannot be settled correctly.
 *
 * Same-game legs are explicitly allowed — the contract permits them with no
 * correlation restriction — so duplicate anGameIds are NOT an error. What is
 * rejected is a ticket that is structurally unsettleable.
 */
export function validateParlayLegs(
  legs: Array<{ odds: number; market: PricingMarket; line: number | null }>
): ParlayValidation {
  if (legs.length < MIN_PARLAY_LEGS) {
    return {
      ok: false,
      message: `A parlay needs at least ${MIN_PARLAY_LEGS} legs`,
    };
  }
  if (legs.length > MAX_PARLAY_LEGS) {
    return {
      ok: false,
      message: `A parlay can have at most ${MAX_PARLAY_LEGS} legs`,
    };
  }
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    try {
      americanToDecimal(leg.odds);
    } catch {
      return {
        ok: false,
        message: `Leg ${i + 1}: ${leg.odds} is not a valid American price`,
      };
    }
    // RL and TOTAL are graded against a number; without one the leg can never
    // settle, which would strand the whole ticket on PENDING forever.
    if ((leg.market === "RL" || leg.market === "TOTAL") && leg.line == null) {
      return {
        ok: false,
        message: `Leg ${i + 1}: a ${leg.market} leg needs a line`,
      };
    }
  }
  return { ok: true };
}
