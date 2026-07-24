import { describe, it, expect } from "vitest";
import {
  classifyEdge,
  expectedValue,
  scoreMarketSide,
  rankMarkets,
  primaryInsight,
  BET_THRESHOLD_PP,
  WATCH_THRESHOLD_PP,
  type MarketSideInput,
} from "./gameInsight";

// ── The screenshot's real game (Brewers @ Pirates, 2026-07-12) ──────────────
// Run line: MIL +1.5 book −198 / model −179 ; PIT −1.5 book +163 / model +179  → NO EDGE
// Total:    O 8.5 book −102 / model −109 ; U 8.5 book −117 / model +109
const RUN_LINE: MarketSideInput[] = [
  { marketKey: "runline", marketLabel: "Run line", sideLabel: "MIL +1.5", bookPrice: -198, bookOppPrice: 163, modelPrice: -179 },
  { marketKey: "runline", marketLabel: "Run line", sideLabel: "PIT -1.5", bookPrice: 163, bookOppPrice: -198, modelPrice: 179 },
];
const TOTAL: MarketSideInput[] = [
  { marketKey: "total", marketLabel: "Total", sideLabel: "Over 8.5", bookPrice: -102, bookOppPrice: -117, modelPrice: -109 },
  { marketKey: "total", marketLabel: "Total", sideLabel: "Under 8.5", bookPrice: -117, bookOppPrice: -102, modelPrice: 109 },
];

describe("classifyEdge", () => {
  it("maps edge to BET / WATCH / NO_EDGE at the documented thresholds", () => {
    expect(classifyEdge(3.0)).toBe("BET");
    expect(classifyEdge(BET_THRESHOLD_PP)).toBe("BET"); // 2.5 inclusive
    expect(classifyEdge(2.49)).toBe("WATCH");
    expect(classifyEdge(WATCH_THRESHOLD_PP)).toBe("WATCH"); // 1.5 inclusive
    expect(classifyEdge(1.49)).toBe("NO_EDGE");
    expect(classifyEdge(0)).toBe("NO_EDGE");
    expect(classifyEdge(-5)).toBe("NO_EDGE");
  });
  it("never invents a label from non-finite input", () => {
    expect(classifyEdge(NaN)).toBe("NO_EDGE");
    expect(classifyEdge(Infinity)).toBe("NO_EDGE"); // garbage data is not an infinite edge
  });
  it("honors configurable thresholds", () => {
    expect(classifyEdge(2.0, { bet: 4, watch: 2 })).toBe("WATCH");
    expect(classifyEdge(4.0, { bet: 4, watch: 2 })).toBe("BET");
    expect(classifyEdge(1.9, { bet: 4, watch: 2 })).toBe("NO_EDGE");
  });
});

describe("expectedValue", () => {
  it("is 0 at a fair coin flip on +100", () => {
    expect(expectedValue(0.5, 100)).toBeCloseTo(0, 6);
  });
  it("matches the Over 8.5 example (model 52.15% at -102 → +3.3% per unit)", () => {
    const p = 109 / 209; // model implied for -109
    expect(expectedValue(p, -102)).toBeCloseTo(0.0328, 3);
  });
  it("returns NaN on invalid input", () => {
    expect(Number.isNaN(expectedValue(NaN, -110))).toBe(true);
    expect(Number.isNaN(expectedValue(0.5, NaN))).toBe(true);
  });
});

describe("scoreMarketSide — reproduces the directive's worked example", () => {
  const over = scoreMarketSide(TOTAL[0])!;
  it("Over 8.5, best price -102, model fair -109 → +1.7pp, WATCH", () => {
    expect(over).not.toBeNull();
    expect(over.bookPrice).toBe(-102);
    expect(over.modelFairPrice).toBe(-109);
    expect(over.edgePP).toBeCloseTo(1.66, 1); // directive states +1.7pp
    expect(over.recommendation).toBe("WATCH");
    expect(over.evUnits).toBeGreaterThan(0);
  });
  it("exposes both raw implied and no-vig fair book probability", () => {
    expect(over.bookImpliedPct).toBeCloseTo(50.5, 1);
    expect(over.modelProbPct).toBeCloseTo(52.15, 1);
    expect(over.bookNoVigPct).toBeCloseTo(48.36, 1); // sportsbook margin removed
    expect(over.noVigEdgePP).toBeCloseTo(3.79, 1);
    expect(over.roiPct).toBeCloseTo(7.84, 1); // canonical no-vig display ROI
  });
  it("returns null for unavailable data (missing price), never a guess", () => {
    expect(scoreMarketSide({ ...TOTAL[0], bookPrice: null })).toBeNull();
    expect(scoreMarketSide({ ...TOTAL[0], modelPrice: undefined })).toBeNull();
  });
  it("computes no edge for the run line (model less confident than book)", () => {
    expect(scoreMarketSide(RUN_LINE[0])!.recommendation).toBe("NO_EDGE"); // MIL +1.5
    expect(scoreMarketSide(RUN_LINE[1])!.recommendation).toBe("NO_EDGE"); // PIT -1.5
  });
});

describe("rankMarkets / primaryInsight — strongest opportunity, not by position", () => {
  const all = [...RUN_LINE, ...TOTAL];
  it("surfaces Over 8.5 as the single strongest insight", () => {
    const top = primaryInsight(all)!;
    expect(top).not.toBeNull();
    expect(top.sideLabel).toBe("Over 8.5");
    expect(top.recommendation).toBe("WATCH");
  });
  it("is independent of input order (no position/color dependence)", () => {
    const shuffled = [TOTAL[1], RUN_LINE[1], TOTAL[0], RUN_LINE[0]];
    expect(rankMarkets(shuffled)[0].sideLabel).toBe("Over 8.5");
    expect(primaryInsight(shuffled)!.sideLabel).toBe("Over 8.5");
  });
  it("ranks strongest-edge first across the whole board", () => {
    const ranked = rankMarkets(all);
    expect(ranked[0].sideLabel).toBe("Over 8.5"); // +1.66
    // everything after the single positive edge is a fade
    expect(ranked.slice(1).every((m) => m.recommendation === "NO_EDGE")).toBe(true);
  });
  it("returns null when no market clears the WATCH threshold (fades never promoted)", () => {
    expect(primaryInsight(RUN_LINE)).toBeNull(); // run line only → all NO_EDGE
  });
  it("skips unavailable sides but still ranks the rest", () => {
    const withHole: MarketSideInput[] = [
      { ...TOTAL[0] },
      { marketKey: "moneyline", marketLabel: "Moneyline", sideLabel: "MIL ML", bookPrice: null, modelPrice: -140 },
    ];
    const ranked = rankMarkets(withHole);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].sideLabel).toBe("Over 8.5");
  });
});
