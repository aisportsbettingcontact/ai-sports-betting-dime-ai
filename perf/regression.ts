/**
 * regression.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure perf-budget evaluation for the CI perf harness. No Playwright, no I/O —
 * just the "did this run regress?" decision, so it is unit-testable in isolation
 * and becomes the TDD regression baseline the harness enforces.
 *
 * Two independent gates per metric:
 *   1. Hard budget: current value must not exceed `budget[metric]` (an absolute
 *      ceiling — a fresh, slow page fails even on the first run).
 *   2. Regression guard: current value must not exceed the recorded baseline by
 *      more than `tolerancePct` (catches gradual creep that stays under budget).
 *
 * Lower is better for every metric we track (times in ms, sizes in bytes). A
 * metric that improves never fails.
 */

export interface PerfSample {
  /** Route path measured, e.g. "/landingpage-v2". */
  route: string;
  /** Metric name → measured value (ms or bytes). Lower is better. */
  metrics: Record<string, number>;
}

export interface PerfBudget {
  /** Absolute ceilings per metric (applied to every route). */
  budget: Record<string, number>;
  /** Allowed regression over baseline, as a fraction (0.15 = 15%). */
  tolerancePct: number;
  /** Recorded baseline: route → metric → value. Optional (first run has none). */
  baseline?: Record<string, Record<string, number>>;
}

export interface PerfViolation {
  route: string;
  metric: string;
  kind: "budget" | "regression";
  current: number;
  limit: number;
  message: string;
}

export interface PerfEvaluation {
  pass: boolean;
  violations: PerfViolation[];
  checked: number;
}

/**
 * Evaluate a set of samples against budgets + baseline. Deterministic and pure.
 */
export function evaluatePerfRun(samples: PerfSample[], config: PerfBudget): PerfEvaluation {
  const violations: PerfViolation[] = [];
  let checked = 0;

  for (const sample of samples) {
    for (const [metric, value] of Object.entries(sample.metrics)) {
      // Hard budget gate.
      const budgetLimit = config.budget[metric];
      if (typeof budgetLimit === "number") {
        checked++;
        if (value > budgetLimit) {
          violations.push({
            route: sample.route,
            metric,
            kind: "budget",
            current: value,
            limit: budgetLimit,
            message: `${sample.route} ${metric}=${value} exceeds budget ${budgetLimit}`,
          });
        }
      }

      // Regression gate (only if we have a baseline for this route+metric).
      const baseValue = config.baseline?.[sample.route]?.[metric];
      if (typeof baseValue === "number" && baseValue > 0) {
        const regressionLimit = baseValue * (1 + config.tolerancePct);
        checked++;
        if (value > regressionLimit) {
          violations.push({
            route: sample.route,
            metric,
            kind: "regression",
            current: value,
            limit: regressionLimit,
            message:
              `${sample.route} ${metric}=${value} regressed >${Math.round(config.tolerancePct * 100)}% ` +
              `over baseline ${baseValue} (limit ${Math.round(regressionLimit)})`,
          });
        }
      }
    }
  }

  return { pass: violations.length === 0, violations, checked };
}
