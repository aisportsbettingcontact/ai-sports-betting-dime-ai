/**
 * regression.test.ts — TDD spec for the perf-budget evaluator.
 *
 * [INPUT]  samples + budget/baseline config
 * [OUTPUT] { pass, violations[], checked }
 * [VERIFY] budget ceiling, regression-over-baseline, improvement never fails,
 *          missing baseline is tolerated, metrics with no budget are ignored.
 */

import { describe, expect, it } from "vitest";
import { evaluatePerfRun, type PerfBudget, type PerfSample } from "./regression";

const budget: PerfBudget = {
  budget: { ttfbMs: 800, lcpMs: 2500, transferBytes: 2_000_000 },
  tolerancePct: 0.15,
  baseline: {
    "/landingpage-v2": { ttfbMs: 300, lcpMs: 1800, transferBytes: 1_000_000 },
  },
};

function sample(route: string, metrics: Record<string, number>): PerfSample {
  return { route, metrics };
}

describe("evaluatePerfRun", () => {
  it("passes when every metric is within budget and near baseline", () => {
    const r = evaluatePerfRun(
      [sample("/landingpage-v2", { ttfbMs: 320, lcpMs: 1850, transferBytes: 1_050_000 })],
      budget
    );
    expect(r.pass).toBe(true);
    expect(r.violations).toHaveLength(0);
    expect(r.checked).toBeGreaterThan(0);
  });

  it("flags a hard-budget violation", () => {
    const r = evaluatePerfRun(
      [sample("/landingpage-v2", { lcpMs: 3200 })],
      budget
    );
    expect(r.pass).toBe(false);
    expect(r.violations.some((v) => v.kind === "budget" && v.metric === "lcpMs")).toBe(true);
  });

  it("flags a regression over baseline even when under the hard budget", () => {
    // baseline ttfb 300 → +15% = 345; 500 is under the 800 budget but a regression.
    const r = evaluatePerfRun(
      [sample("/landingpage-v2", { ttfbMs: 500 })],
      budget
    );
    expect(r.pass).toBe(false);
    const v = r.violations.find((x) => x.metric === "ttfbMs");
    expect(v?.kind).toBe("regression");
  });

  it("never fails on an improvement", () => {
    const r = evaluatePerfRun(
      [sample("/landingpage-v2", { ttfbMs: 100, lcpMs: 900, transferBytes: 500_000 })],
      budget
    );
    expect(r.pass).toBe(true);
  });

  it("tolerates a route with no baseline (first run) but still enforces budget", () => {
    const r = evaluatePerfRun(
      [sample("/new-route", { ttfbMs: 400, lcpMs: 3000 })],
      budget
    );
    // ttfb 400 < 800 budget → ok; lcp 3000 > 2500 budget → fail. No baseline crash.
    expect(r.violations.some((v) => v.kind === "regression")).toBe(false);
    expect(r.violations.some((v) => v.kind === "budget" && v.metric === "lcpMs")).toBe(true);
  });

  it("ignores metrics that have neither a budget nor a baseline", () => {
    const r = evaluatePerfRun(
      [sample("/landingpage-v2", { someUnbudgetedMetric: 9_999_999 })],
      budget
    );
    expect(r.pass).toBe(true);
    expect(r.checked).toBe(0);
  });
});
