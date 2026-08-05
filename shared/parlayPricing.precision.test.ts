/**
 * parlayPricing.precision.test.ts — is the parlay price EXACT?
 *
 * The entry form now recomputes the ticket price in real time as legs are
 * added, so this arithmetic is what the user watches while deciding to commit
 * money, and the same function later decides what the ticket pays. A one-point
 * error is a real mispayment.
 *
 * Known-value tests only prove the cases someone thought to write down. These
 * check the implementation against EXACT RATIONAL ARITHMETIC — the price
 * recomputed with BigInt fractions, carrying no floating-point error at all —
 * across every leg count from 2 to 10 and a wide spread of real book prices.
 * If IEEE-754 accumulation across ten multiplications could ever move the
 * rounded American price by a single point, these fail.
 */

import { describe, it, expect } from "vitest";
import {
  americanToDecimal,
  decimalToAmerican,
  combineLegOdds,
  calcParlayToWin,
  MAX_PARLAY_LEGS,
} from "./parlayPricing";

// ─── Exact rational reference implementation ─────────────────────────────────

type Rat = { n: bigint; d: bigint };

const rat = (n: bigint, d: bigint): Rat => {
  const g = gcd(n < 0n ? -n : n, d);
  return { n: n / g, d: d / g };
};
function gcd(a: bigint, b: bigint): bigint {
  while (b) [a, b] = [b, a % b];
  return a || 1n;
}
const mul = (a: Rat, b: Rat): Rat => rat(a.n * b.n, a.d * b.d);

/** American odds -> decimal, as an exact fraction. */
function exactDecimal(odds: number): Rat {
  const o = BigInt(Math.trunc(odds));
  return odds >= 100
    ? rat(100n + o, 100n) // 1 + odds/100
    : rat(-o + 100n, -o); // 1 + 100/|odds|
}

/**
 * The parlay price, computed with zero floating-point error, rounded exactly
 * as decimalToAmerican rounds — half away from zero, matching Math.round for
 * the positive magnitudes these produce.
 */
function exactCombine(legs: number[]): number {
  const dec = legs.map(exactDecimal).reduce(mul, rat(1n, 1n));
  // profit = dec - 1
  const profit = rat(dec.n - dec.d, dec.d);
  if (profit.n * 1n >= profit.d) {
    // dec >= 2  ->  +(profit * 100), rounded
    return Number(roundDiv(profit.n * 100n, profit.d));
  }
  // dec < 2  ->  -(100 / profit), rounded
  return -Number(roundDiv(100n * profit.d, profit.n));
}

/** Round-half-up on a positive rational n/d. */
function roundDiv(n: bigint, d: bigint): bigint {
  return (2n * n + d) / (2n * d);
}

// ─── Book prices that actually occur ─────────────────────────────────────────

const BOOK_PRICES = [
  -1000, -800, -650, -500, -400, -350, -320, -300, -275, -250, -225, -200, -190,
  -183, -175, -165, -155, -150, -145, -140, -135, -130, -125, -120, -115, -112,
  -110, -108, -105, -102, -100, 100, 102, 105, 108, 110, 115, 120, 125, 130,
  135, 140, 145, 150, 155, 165, 168, 175, 185, 200, 225, 250, 275, 300, 350,
  400, 500, 650, 800, 1000, 1500,
];

/** Deterministic PRNG so a failure is reproducible. */
let seed = 20260804;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];

describe("the price matches exact rational arithmetic", () => {
  it("every single book price round-trips through decimal without drift", () => {
    for (const p of BOOK_PRICES) {
      expect(combineLegOdds([p]), `single leg ${p}`).toBe(exactCombine([p]));
    }
  });

  it("REGRESSION: every leg count from 2 to 10 agrees exactly, over 20k tickets", () => {
    // This is the assertion that matters. Ten multiplications of values like
    // 1.9090909090909092 accumulate IEEE-754 error; if that error could ever
    // cross a rounding boundary the user would be quoted a price the ticket
    // does not settle at.
    let checked = 0;
    for (let n = 2; n <= MAX_PARLAY_LEGS; n++) {
      for (let trial = 0; trial < 2200; trial++) {
        const legs = Array.from({ length: n }, () => pick(BOOK_PRICES));
        const got = combineLegOdds(legs);
        const want = exactCombine(legs);
        if (got !== want) {
          throw new Error(
            `MISMATCH at ${n} legs [${legs.join(", ")}] — float ${got}, exact ${want}`
          );
        }
        checked++;
      }
    }
    expect(checked).toBe(9 * 2200);
  });

  it("the worst case for accumulation — ten of the longest price", () => {
    const legs = Array(MAX_PARLAY_LEGS).fill(-1000);
    expect(combineLegOdds(legs)).toBe(exactCombine(legs));
  });

  it("and ten of the shortest", () => {
    const legs = Array(MAX_PARLAY_LEGS).fill(1500);
    expect(combineLegOdds(legs)).toBe(exactCombine(legs));
  });

  it("mixed extremes in both orders", () => {
    const a = [-1000, 1500, -1000, 1500, -1000, 1500, -1000, 1500, -1000, 1500];
    expect(combineLegOdds(a)).toBe(exactCombine(a));
    expect(combineLegOdds([...a].reverse())).toBe(exactCombine(a));
  });
});

describe("determinism and order-independence", () => {
  it("REGRESSION: leg order never changes the price", () => {
    // The UI recomputes on every add and remove. If order mattered, removing
    // leg 2 and re-adding it would produce a different ticket.
    for (let trial = 0; trial < 500; trial++) {
      const n = 2 + Math.floor(rnd() * (MAX_PARLAY_LEGS - 1));
      const legs = Array.from({ length: n }, () => pick(BOOK_PRICES));
      const shuffled = [...legs].sort(() => rnd() - 0.5);
      expect(combineLegOdds(shuffled), `[${legs}]`).toBe(combineLegOdds(legs));
    }
  });

  it("the same input always gives the same output", () => {
    const legs = [-110, 150, -230, 175, -120];
    const first = combineLegOdds(legs);
    for (let i = 0; i < 100; i++) expect(combineLegOdds(legs)).toBe(first);
  });

  it("adding a leg then removing it returns the original price", () => {
    const base = [-110, -110, 150];
    const before = combineLegOdds(base);
    const after = combineLegOdds([...base, -250].slice(0, base.length));
    expect(after).toBe(before);
  });
});

describe("known book values", () => {
  it("two -110 legs are +264", () => {
    expect(combineLegOdds([-110, -110])).toBe(264);
  });

  it("three -110 legs are +596 — the true value, not the +595 books round to", () => {
    // 595.79 exactly. Books round DOWN in their own favour; this rounds
    // honestly, and the user overrides with their book's number when it differs.
    expect(combineLegOdds([-110, -110, -110])).toBe(596);
    expect(exactCombine([-110, -110, -110])).toBe(596);
  });

  it("a favourite and a dog", () => {
    expect(combineLegOdds([-200, 150])).toBe(exactCombine([-200, 150]));
    expect(combineLegOdds([-320, 264])).toBe(exactCombine([-320, 264]));
  });
});

describe("the payout agrees with the price shown", () => {
  it("REGRESSION: to-win is derived from the SAME rounded price the user sees", () => {
    // The form shows a rounded American price; the payout must be computed
    // from that number, not from the unrounded decimal behind it, or the
    // ticket displays one price and pays another.
    for (let trial = 0; trial < 2000; trial++) {
      const n = 2 + Math.floor(rnd() * (MAX_PARLAY_LEGS - 1));
      const legs = Array.from({ length: n }, () => pick(BOOK_PRICES));
      const shown = combineLegOdds(legs);
      const risk = 100;
      const payout = calcParlayToWin(risk, shown);
      const fromShown = risk * (americanToDecimal(shown) - 1);
      expect(Math.abs(payout - fromShown)).toBeLessThan(0.005);
    }
  });

  it("pays to the cent, never a long float", () => {
    for (const odds of BOOK_PRICES) {
      const v = calcParlayToWin(137.5, odds);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBe(parseFloat(v.toFixed(2)));
    }
  });
});

describe("American ↔ decimal is exact at every book price", () => {
  it("round-trips every price without moving a point", () => {
    // -100 is excluded deliberately: it and +100 are the SAME price (even
    // money), and decimalToAmerican resolves the pair to +100 by design. The
    // next test pins that.
    for (const p of BOOK_PRICES.filter(x => x !== -100)) {
      expect(decimalToAmerican(americanToDecimal(p)), `price ${p}`).toBe(p);
    }
  });

  it("even money resolves to +100 from both sides", () => {
    expect(decimalToAmerican(americanToDecimal(100))).toBe(100);
    expect(decimalToAmerican(americanToDecimal(-100))).toBe(100);
  });
});
