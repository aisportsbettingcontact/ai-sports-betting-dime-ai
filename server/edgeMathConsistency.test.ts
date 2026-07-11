import { describe, it, expect } from "vitest";
import * as edgeUtils from "../client/src/lib/edgeUtils";
import * as edgeHook from "../client/src/hooks/useEdgeCalculation";

/**
 * Cross-module identity guard for the duplicated edge math.
 *
 * Defect (P2): edge/odds conversion logic exists in two independent copies —
 * client/src/lib/edgeUtils.ts (the declared "single source of truth") and
 * client/src/hooks/useEdgeCalculation.ts. They are byte-identical today but a
 * fix applied to one and not the other would silently diverge. Rather than a
 * risky refactor, this test locks the two implementations to agree across a
 * grid of inputs, so any future drift fails CI.
 */

const AMERICAN_ODDS = [-500, -300, -200, -150, -110, -105, -100, 100, 105, 110, 150, 200, 300, 500];

describe("edge-math cross-module consistency", () => {
  it("americanToImplied agrees across both modules", () => {
    for (const odds of AMERICAN_ODDS) {
      expect(edgeHook.americanToImplied(odds)).toBeCloseTo(edgeUtils.americanToImplied(odds), 10);
    }
  });

  it("calculateEdge agrees across both modules", () => {
    for (const book of AMERICAN_ODDS) {
      for (const model of AMERICAN_ODDS) {
        expect(edgeHook.calculateEdge(book, model)).toBeCloseTo(
          edgeUtils.calculateEdge(book, model),
          10,
        );
      }
    }
  });

  it("getVerdict agrees across both modules", () => {
    for (const edge of [-5, -1, 0, 0.4, 0.5, 1, 2.5, 5, 8, 12]) {
      expect(edgeHook.getVerdict(edge)).toBe(edgeUtils.getVerdict(edge));
    }
  });

  it("americanToImplied is boundary-safe at ±100", () => {
    expect(edgeUtils.americanToImplied(-100)).toBeCloseTo(0.5, 10);
    expect(edgeUtils.americanToImplied(100)).toBeCloseTo(0.5, 10);
  });
});
