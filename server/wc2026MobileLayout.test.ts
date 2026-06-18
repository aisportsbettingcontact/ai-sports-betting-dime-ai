/**
 * wc2026MobileLayout.test.ts
 * Validates:
 *   1. calculate3WayResult — full 3-way EV math (all 3 outcomes in denominator)
 *   2. Edge detection correctness for June 18 WC2026 matches
 *   3. Edge threshold gate — no false positives
 *   4. TOTAL 2-way ROI unchanged
 */

import { describe, it, expect } from 'vitest';
import {
  calculateEdge,
  calculateRoi,
  calculate3WayResult,
  EDGE_THRESHOLD_PP,
  americanToImplied,
} from '../client/src/lib/edgeUtils';

// ─── 1. calculate3WayResult — Math Correctness ───────────────────────────────
describe('calculate3WayResult — 3-way EV math', () => {
  it('normalizes book probabilities across all 3 outcomes (sum = 1.0)', () => {
    const book  = { home: -115, draw: 255, away: 360 };
    const model = { home: -50,  draw: 206, away: 237 };
    const result = calculate3WayResult(book, model);

    const bHome = americanToImplied(-115);
    const bDraw = americanToImplied(255);
    const bAway = americanToImplied(360);
    const bTotal = bHome + bDraw + bAway;

    expect(result.home.bookFairProb).toBeCloseTo(bHome / bTotal, 4);
    expect(result.draw.bookFairProb).toBeCloseTo(bDraw / bTotal, 4);
    expect(result.away.bookFairProb).toBeCloseTo(bAway / bTotal, 4);

    // All 3 fair probs must sum to 1.0
    const bookSum = result.home.bookFairProb + result.draw.bookFairProb + result.away.bookFairProb;
    const modelSum = result.home.modelFairProb + result.draw.modelFairProb + result.away.modelFairProb;
    expect(bookSum).toBeCloseTo(1.0, 4);
    expect(modelSum).toBeCloseTo(1.0, 4);

    console.log(`[TEST][3WAY] CZE vs RSA book fair: H=${(result.home.bookFairProb*100).toFixed(2)}% D=${(result.draw.bookFairProb*100).toFixed(2)}% A=${(result.away.bookFairProb*100).toFixed(2)}% sum=${(bookSum*100).toFixed(2)}%`);
  });

  it('RSA ML ROI is positive (model +237 vs DK +360 — model sees more value)', () => {
    const book  = { home: -115, draw: 255, away: 360 };
    const model = { home: -50,  draw: 206, away: 237 };
    const result = calculate3WayResult(book, model);
    expect(result.away.roiPct).toBeGreaterThan(0);
    console.log(`[TEST][3WAY] RSA ML ROI: ${result.away.roiPct.toFixed(2)}% edgePP: ${result.away.edgePP.toFixed(2)}pp`);
  });

  it('DRAW ROI uses all 3 outcomes in denominator (differs from 2-way)', () => {
    const book  = { home: -360, draw: 475, away: 1000 };
    const model = { home: -157, draw: 303, away: 609  };
    const result = calculate3WayResult(book, model);
    const twoWayRoi = calculateRoi(model.draw, book.draw, book.home);
    // 3-way must differ from 2-way (away odds excluded in 2-way)
    expect(Math.abs(result.draw.roiPct - twoWayRoi)).toBeGreaterThan(0.01);
    console.log(`[TEST][3WAY] CAN vs QAT DRAW ROI: 3-way=${result.draw.roiPct.toFixed(2)}% vs 2-way=${twoWayRoi.toFixed(2)}%`);
  });

  it('returns NaN-safe result when one odds is NaN', () => {
    const book  = { home: NaN, draw: 255, away: 360 };
    const model = { home: -50, draw: 206, away: 237 };
    const result = calculate3WayResult(book, model);
    // With NaN home, total is NaN → all fair probs NaN → hasEdge false
    expect(result.home.hasEdge).toBe(false);
    expect(result.draw.hasEdge).toBe(false);
    expect(result.away.hasEdge).toBe(false);
  });
});

// ─── 2. Edge Detection — June 18 WC2026 Matches ──────────────────────────────
describe('Edge detection — June 18 WC2026 matches', () => {
  it('CZE vs RSA: RSA ML edge detected (model +237 vs DK +360)', () => {
    const book  = { home: -115, draw: 255, away: 360 };
    const model = { home: -50,  draw: 206, away: 237 };
    const result = calculate3WayResult(book, model);
    expect(result.away.edgePP).toBeGreaterThan(EDGE_THRESHOLD_PP);
    expect(result.away.hasEdge).toBe(true);
    expect(result.away.roiPct).toBeGreaterThan(0);
    console.log(`[TEST][EDGE] CZE vs RSA — RSA ML: edgePP=${result.away.edgePP.toFixed(2)}pp ROI=${result.away.roiPct.toFixed(2)}%`);
  });

  it('SUI vs BIH: SUI ML edge detected (model -240 vs DK -180)', () => {
    const book  = { home: -180, draw: 310, away: 500 };
    const model = { home: -240, draw: 515, away: 662 };
    const result = calculate3WayResult(book, model);
    expect(result.home.edgePP).toBeGreaterThan(EDGE_THRESHOLD_PP);
    expect(result.home.hasEdge).toBe(true);
    expect(result.home.roiPct).toBeGreaterThan(0);
    console.log(`[TEST][EDGE] SUI vs BIH — SUI ML: edgePP=${result.home.edgePP.toFixed(2)}pp ROI=${result.home.roiPct.toFixed(2)}%`);
  });

  it('CAN vs QAT: DRAW edge detected (model +303 vs DK +475)', () => {
    const book  = { home: -360, draw: 475, away: 1000 };
    const model = { home: -157, draw: 303, away: 609  };
    const result = calculate3WayResult(book, model);
    expect(result.draw.edgePP).toBeGreaterThan(EDGE_THRESHOLD_PP);
    expect(result.draw.hasEdge).toBe(true);
    expect(result.draw.roiPct).toBeGreaterThan(0);
    console.log(`[TEST][EDGE] CAN vs QAT — DRAW: edgePP=${result.draw.edgePP.toFixed(2)}pp ROI=${result.draw.roiPct.toFixed(2)}%`);
  });

  it('MEX vs KOR: KOR ML edge detected (model +174 vs DK +295)', () => {
    const book  = { home: 105, draw: 230, away: 295 };
    const model = { home: 215, draw: 216, away: 174 };
    const result = calculate3WayResult(book, model);
    expect(result.away.edgePP).toBeGreaterThan(EDGE_THRESHOLD_PP);
    expect(result.away.hasEdge).toBe(true);
    expect(result.away.roiPct).toBeGreaterThan(0);
    console.log(`[TEST][EDGE] MEX vs KOR — KOR ML: edgePP=${result.away.edgePP.toFixed(2)}pp ROI=${result.away.roiPct.toFixed(2)}%`);
  });
});

// ─── 3. Edge threshold gate — no false positives ─────────────────────────────
describe('Edge threshold gate', () => {
  it('no edge when model and book are identical', () => {
    const same = { home: -110, draw: 300, away: 300 };
    const result = calculate3WayResult(same, same);
    expect(result.home.edgePP).toBeCloseTo(0, 2);
    expect(result.home.hasEdge).toBe(false);
    expect(result.draw.hasEdge).toBe(false);
    expect(result.away.hasEdge).toBe(false);
  });

  it('no edge when model difference is below 1.5pp threshold', () => {
    const book  = { home: -110, draw: 300, away: 300 };
    const model = { home: -111, draw: 299, away: 299 };
    const result = calculate3WayResult(book, model);
    expect(result.home.hasEdge).toBe(false);
  });

  it('EDGE_THRESHOLD_PP is 1.5', () => {
    expect(EDGE_THRESHOLD_PP).toBe(1.5);
  });
});

// ─── 4. TOTAL 2-way ROI (unchanged) ──────────────────────────────────────────
describe('TOTAL 2-way ROI', () => {
  it('calculateRoi returns finite number for TOTAL market', () => {
    // CZE vs RSA: O2.5 +115 (book) vs O2.5 -250 (model)
    const overEdgePP = calculateEdge(115, -250);
    expect(overEdgePP).toBeGreaterThan(EDGE_THRESHOLD_PP);
    const overRoi = calculateRoi(-250, 115, -140);
    expect(isFinite(overRoi)).toBe(true);
    console.log(`[TEST][TOTAL] CZE vs RSA OVER: edgePP=${overEdgePP.toFixed(2)}pp ROI=${overRoi.toFixed(2)}%`);
  });

  it('calculateEdge is symmetric — edge(A,B) = -edge(B,A)', () => {
    const e1 = calculateEdge(115, -250);
    const e2 = calculateEdge(-250, 115);
    expect(e1).toBeCloseTo(-e2, 2);
  });
});
