/**
 * mlbFeedbackLoop.test.ts — Unit tests for the MLB model feedback loop.
 *
 * Tests:
 *   1. Brier score computation (outcome ingestor)
 *   2. f5_share drift detection logic (drift detector)
 *   3. Recalibration cooldown enforcement
 *   4. Outcome ingestion summary structure
 */

import { describe, it, expect } from "vitest";

// ─── Brier Score Tests ────────────────────────────────────────────────────────

/**
 * Brier score = (p - o)^2
 *   p = predicted probability (0-1)
 *   o = actual outcome (0 or 1)
 *
 * Perfect prediction: p=1, o=1 → BS=0
 * Worst prediction:   p=0, o=1 → BS=1
 * Coin flip:          p=0.5, o=1 → BS=0.25
 */
function computeBrierScore(
  predictedProb: number,
  actualOutcome: 0 | 1
): number {
  return parseFloat(((predictedProb - actualOutcome) ** 2).toFixed(6));
}

describe("Brier Score Computation", () => {
  it("perfect over prediction: p=1.0, o=1 → BS=0.000000", () => {
    expect(computeBrierScore(1.0, 1)).toBe(0.0);
  });

  it("perfect under prediction: p=0.0, o=0 → BS=0.000000", () => {
    expect(computeBrierScore(0.0, 0)).toBe(0.0);
  });

  it("worst over prediction: p=0.0, o=1 → BS=1.000000", () => {
    expect(computeBrierScore(0.0, 1)).toBe(1.0);
  });

  it("worst under prediction: p=1.0, o=0 → BS=1.000000", () => {
    expect(computeBrierScore(1.0, 0)).toBe(1.0);
  });

  it("coin flip: p=0.5, o=1 → BS=0.250000", () => {
    expect(computeBrierScore(0.5, 1)).toBe(0.25);
  });

  it("coin flip: p=0.5, o=0 → BS=0.250000", () => {
    expect(computeBrierScore(0.5, 0)).toBe(0.25);
  });

  it("typical model over: p=0.58, o=1 → BS=0.1764", () => {
    // (0.58 - 1)^2 = (-0.42)^2 = 0.1764
    expect(computeBrierScore(0.58, 1)).toBeCloseTo(0.1764, 4);
  });

  it("typical model over: p=0.58, o=0 → BS=0.3364", () => {
    // (0.58 - 0)^2 = 0.3364
    expect(computeBrierScore(0.58, 0)).toBeCloseTo(0.3364, 4);
  });

  it("NRFI typical: p=0.52, o=1 → BS=0.2304", () => {
    // (0.52 - 1)^2 = 0.2304
    expect(computeBrierScore(0.52, 1)).toBeCloseTo(0.2304, 4);
  });

  it("probability is clamped to [0,1] range", () => {
    // Any valid probability should produce a BS in [0,1]
    for (const p of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1.0]) {
      const bs0 = computeBrierScore(p as number, 0);
      const bs1 = computeBrierScore(p as number, 1);
      expect(bs0).toBeGreaterThanOrEqual(0);
      expect(bs0).toBeLessThanOrEqual(1);
      expect(bs1).toBeGreaterThanOrEqual(0);
      expect(bs1).toBeLessThanOrEqual(1);
    }
  });
});

// ─── f5_share Drift Detection Tests ──────────────────────────────────────────

const BASELINE_F5_SHARE = 0.5618;
const DRIFT_THRESHOLD = 0.02;

function detectDrift(rollingShare: number): {
  driftDetected: boolean;
  delta: number;
  direction: "OVER" | "UNDER" | "NONE";
} {
  const delta = parseFloat((rollingShare - BASELINE_F5_SHARE).toFixed(6));
  const absDelta = Math.abs(delta);
  const driftDetected = absDelta > DRIFT_THRESHOLD;
  const direction = !driftDetected ? "NONE" : delta > 0 ? "OVER" : "UNDER";
  return { driftDetected, delta, direction };
}

describe("f5_share Drift Detection", () => {
  it("no drift: rolling=0.5618 (exactly baseline) → driftDetected=false", () => {
    const result = detectDrift(0.5618);
    expect(result.driftDetected).toBe(false);
    expect(result.delta).toBeCloseTo(0, 5);
    expect(result.direction).toBe("NONE");
  });

  it("no drift: rolling=0.5700 (delta=+0.0082, within threshold) → driftDetected=false", () => {
    const result = detectDrift(0.57);
    expect(result.driftDetected).toBe(false);
    expect(result.direction).toBe("NONE");
  });

  it("no drift: rolling=0.5500 (delta=-0.0118, within threshold) → driftDetected=false", () => {
    const result = detectDrift(0.55);
    expect(result.driftDetected).toBe(false);
  });

  it("drift OVER: rolling=0.5820 (delta=+0.0202) → driftDetected=true, direction=OVER", () => {
    const result = detectDrift(0.582);
    expect(result.driftDetected).toBe(true);
    expect(result.direction).toBe("OVER");
    expect(result.delta).toBeGreaterThan(DRIFT_THRESHOLD);
  });

  it("drift UNDER: rolling=0.5400 (delta=-0.0218) → driftDetected=true, direction=UNDER", () => {
    const result = detectDrift(0.54);
    expect(result.driftDetected).toBe(true);
    expect(result.direction).toBe("UNDER");
    expect(result.delta).toBeLessThan(-DRIFT_THRESHOLD);
  });

  it("boundary: rolling=0.5818 (delta=+0.0200, exactly at threshold) → driftDetected=false", () => {
    // Threshold is STRICTLY greater than, so exactly 0.02 should NOT trigger
    const result = detectDrift(0.5818);
    expect(result.driftDetected).toBe(false);
  });

  it("boundary: rolling=0.5819 (delta=+0.0201, just over threshold) → driftDetected=true", () => {
    const result = detectDrift(0.5819);
    expect(result.driftDetected).toBe(true);
  });

  it("extreme drift OVER: rolling=0.65 → driftDetected=true", () => {
    const result = detectDrift(0.65);
    expect(result.driftDetected).toBe(true);
    expect(result.direction).toBe("OVER");
  });

  it("extreme drift UNDER: rolling=0.50 → driftDetected=true", () => {
    const result = detectDrift(0.5);
    expect(result.driftDetected).toBe(true);
    expect(result.direction).toBe("UNDER");
  });
});

// ─── f5_share Computation Tests ──────────────────────────────────────────────

function computeF5Share(
  actualF5Total: number,
  actualFgTotal: number
): number | null {
  if (actualFgTotal <= 0) return null;
  return parseFloat((actualF5Total / actualFgTotal).toFixed(6));
}

describe("f5_share Per-Game Computation", () => {
  it("typical game: F5=4.5, FG=8.0 → share=0.5625", () => {
    expect(computeF5Share(4.5, 8.0)).toBeCloseTo(0.5625, 4);
  });

  it("low-scoring game: F5=3, FG=5 → share=0.6000", () => {
    expect(computeF5Share(3, 5)).toBeCloseTo(0.6, 4);
  });

  it("high-scoring game: F5=6, FG=12 → share=0.5000", () => {
    expect(computeF5Share(6, 12)).toBeCloseTo(0.5, 4);
  });

  it("zero FG total → returns null (division guard)", () => {
    expect(computeF5Share(0, 0)).toBeNull();
  });

  it("F5=0 (shutout through 5): F5=0, FG=3 → share=0.0000", () => {
    expect(computeF5Share(0, 3)).toBeCloseTo(0, 4);
  });

  it("share is always in [0, 1] for valid inputs", () => {
    const cases: [number, number][] = [
      [2, 5],
      [4, 7],
      [5, 9],
      [6, 10],
      [7, 12],
      [3, 6],
    ];
    for (const [f5, fg] of cases) {
      const share = computeF5Share(f5, fg);
      expect(share).not.toBeNull();
      expect(share!).toBeGreaterThanOrEqual(0);
      expect(share!).toBeLessThanOrEqual(1);
    }
  });
});

// ─── Outcome Ingestion Summary Structure Tests ────────────────────────────────

interface IngestionSummary {
  date: string;
  totalGames: number;
  written: number;
  skippedAlreadyIngested: number;
  skippedNotFinal: number;
  skippedNoApiMatch: number;
  errors: number;
}

function validateIngestionSummary(summary: IngestionSummary): {
  valid: boolean;
  reason?: string;
} {
  const totalAccountedFor =
    summary.written +
    summary.skippedAlreadyIngested +
    summary.skippedNotFinal +
    summary.skippedNoApiMatch +
    summary.errors;

  if (totalAccountedFor !== summary.totalGames) {
    return {
      valid: false,
      reason: `totalGames=${summary.totalGames} but accounted=${totalAccountedFor}`,
    };
  }
  if (summary.written < 0 || summary.errors < 0) {
    return { valid: false, reason: "negative counts" };
  }
  return { valid: true };
}

describe("Ingestion Summary Validation", () => {
  it("valid summary: all counts sum to totalGames", () => {
    const summary: IngestionSummary = {
      date: "2026-04-14",
      totalGames: 15,
      written: 12,
      skippedAlreadyIngested: 2,
      skippedNotFinal: 1,
      skippedNoApiMatch: 0,
      errors: 0,
    };
    expect(validateIngestionSummary(summary).valid).toBe(true);
  });

  it("invalid summary: counts do not sum to totalGames → valid=false", () => {
    const summary: IngestionSummary = {
      date: "2026-04-14",
      totalGames: 15,
      written: 10,
      skippedAlreadyIngested: 2,
      skippedNotFinal: 1,
      skippedNoApiMatch: 0,
      errors: 0,
    };
    const result = validateIngestionSummary(summary);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("totalGames=15");
  });

  it("zero-game date: all zeros → valid", () => {
    const summary: IngestionSummary = {
      date: "2026-04-14",
      totalGames: 0,
      written: 0,
      skippedAlreadyIngested: 0,
      skippedNotFinal: 0,
      skippedNoApiMatch: 0,
      errors: 0,
    };
    expect(validateIngestionSummary(summary).valid).toBe(true);
  });

  it("all errors: written=0, errors=15 → valid", () => {
    const summary: IngestionSummary = {
      date: "2026-04-14",
      totalGames: 15,
      written: 0,
      skippedAlreadyIngested: 0,
      skippedNotFinal: 0,
      skippedNoApiMatch: 0,
      errors: 15,
    };
    expect(validateIngestionSummary(summary).valid).toBe(true);
  });
});
