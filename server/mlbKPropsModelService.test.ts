import { describe, expect, it } from "vitest";
import {
  poissonCdf,
  poissonPOver,
  poissonPUnder,
} from "./mlbKPropsModelService";

/**
 * First unit coverage of the K-props Poisson layer (audit K-6).
 *
 * The bug: pUnder was computed as `1 - poissonPOver(bookLine, λ)`, the exact
 * complement. That is correct on a HALF line, where no push is possible, but
 * on an INTEGER line a prop settles PUSH when the pitcher records exactly the
 * line — and the complement folds that entire mass into the under side.
 */

const LAMBDA = 5.2; // roughly a league-average starter's K expectation

/** P(X == k) — the push mass on an integer line. */
const pmf = (k: number, lambda: number) =>
  (Math.exp(-lambda) * lambda ** k) /
  Array.from({ length: k }, (_, i) => i + 1).reduce((a, b) => a * b, 1);

describe("poissonPUnder — integer lines carry a push", () => {
  it("is IDENTICAL to the old complement on a half line (no-op by construction)", () => {
    for (const line of [3.5, 4.5, 5.5, 6.5, 7.5]) {
      expect(poissonPUnder(line, LAMBDA)).toBeCloseTo(
        1 - poissonPOver(line, LAMBDA),
        12
      );
    }
  });

  it("excludes exactly the push mass on an integer line", () => {
    for (const line of [5, 6, 7]) {
      const oldWay = 1 - poissonPOver(line, LAMBDA);
      const fixed = poissonPUnder(line, LAMBDA);
      // The old expression overstated the under side by precisely P(X == line).
      expect(oldWay - fixed).toBeCloseTo(pmf(line, LAMBDA), 10);
      expect(fixed).toBeLessThan(oldWay);
    }
  });

  it("leaves a real, material gap — this was not a rounding concern", () => {
    // At line 5.0, λ 5.2 the push mass is ~17.5pp of probability.
    const oldWay = 1 - poissonPOver(5, LAMBDA);
    const fixed = poissonPUnder(5, LAMBDA);
    expect(oldWay - fixed).toBeGreaterThan(0.15);
  });

  it("over + under + push sums to 1 on an integer line", () => {
    const line = 5;
    const sum =
      poissonPOver(line, LAMBDA) +
      poissonPUnder(line, LAMBDA) +
      pmf(line, LAMBDA);
    expect(sum).toBeCloseTo(1, 10);
  });

  it("over + under sums to 1 on a half line (no push to account for)", () => {
    expect(
      poissonPOver(4.5, LAMBDA) + poissonPUnder(4.5, LAMBDA)
    ).toBeCloseTo(1, 10);
  });

  it("agrees with the CDF definition", () => {
    expect(poissonPUnder(5, LAMBDA)).toBeCloseTo(poissonCdf(4, LAMBDA), 12);
    expect(poissonPUnder(4.5, LAMBDA)).toBeCloseTo(poissonCdf(4, LAMBDA), 12);
  });
});
