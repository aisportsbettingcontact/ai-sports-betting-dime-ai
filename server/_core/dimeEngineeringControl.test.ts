import { describe, expect, it } from "vitest";
import {
  DIME_CONTROL_AGENTS,
  DIME_FAILURE_LAYERS,
  DIME_PRODUCT_ROUTES,
  DIME_ROUTE_POLICIES,
  assessDimePromotion,
  assessDimeTrainingStrategy,
  calculateDimeIntelligenceEfficiency,
  classifyDimeProductRoute,
  getDimeEngineeringControlSummary,
  scoreDimeProductionTrace,
  type DimeIntelligenceEfficiencyMetrics,
  type DimeTrainingStrategy,
} from "./dimeEngineeringControl";

const BASELINE: DimeIntelligenceEfficiencyMetrics = {
  correctness: 0.9,
  usefulness: 0.9,
  groundedness: 0.9,
  calibration: 0.9,
  reliability: 0.9,
  latency: 1,
  cost: 1,
  complexity: 1,
  regressionRisk: 1,
};

const TRAINING_STRATEGY: DimeTrainingStrategy = {
  failureClass: "reasoning",
  evidence: ["eval-case-42"],
  rootCause:
    "Multi-step probability comparison fails after verified retrieval.",
  trainingNecessity: "required",
  simplerInterventionsRejected: [
    "runtime_fix",
    "prompt_or_schema",
    "retrieval_improvement",
  ],
  capabilityTarget: "Multi-step calibrated market comparison",
  falsifiableHypothesis:
    "Increase locked multi-step reasoning accuracy from 0.72 to at least 0.82.",
  trainingMethod: "QLoRA supervised instruction tuning",
  curriculum: ["single_step_reasoning", "multi_step_reasoning"],
  dataRequirements: ["200 reviewed comparison traces"],
  expectedGain: "At least 10 percentage points on the target slice.",
  regressionRisks: ["General instruction-following regression"],
  stopConditions: ["Stop after two evaluations without target-slice gain."],
  acceptanceThresholds: ["Locked target-slice accuracy >= 0.82"],
  deterministicCausesEliminated: true,
};

describe("Dime Composite LLM Engineering Control", () => {
  it("encodes the complete failure, route, and controlled-agent taxonomies", () => {
    expect(DIME_FAILURE_LAYERS).toHaveLength(11);
    expect(DIME_PRODUCT_ROUTES).toHaveLength(9);
    expect(DIME_CONTROL_AGENTS).toHaveLength(11);
    expect(Object.keys(DIME_ROUTE_POLICIES).sort()).toEqual(
      [...DIME_PRODUCT_ROUTES].sort()
    );
  });

  it("does not invent route token or latency targets before benchmarks exist", () => {
    for (const policy of Object.values(DIME_ROUTE_POLICIES)) {
      expect(policy.latencyTarget).toEqual({
        p95Ms: null,
        status: "requires_benchmark",
      });
      expect(policy.contextBudget.maxTokens).toBeNull();
    }
  });

  it("refines the active four-mode router into the complete product taxonomy", () => {
    expect(
      classifyDimeProductRoute("Update my payment method", "platform")
    ).toBe("account");
    expect(
      classifyDimeProductRoute("What are the live odds right now?", "matchup")
    ).toBe("live_data");
    expect(
      classifyDimeProductRoute("Show yesterday's closing line", "matchup")
    ).toBe("historical");
    expect(
      classifyDimeProductRoute("Explain this bet to me", "educational")
    ).toBe("bet_explanation");
    expect(classifyDimeProductRoute("Rank tonight's slate", "slate")).toBe(
      "full_slate"
    );
    expect(
      classifyDimeProductRoute(
        "Who is the greatest center ever?",
        "educational"
      )
    ).toBe("general_sports");
  });

  it("computes the multiplicative system-level objective", () => {
    expect(calculateDimeIntelligenceEfficiency(BASELINE)).toBeCloseTo(0.9 ** 5);
  });

  it("rejects invalid normalized quality and non-positive burden metrics", () => {
    expect(() =>
      calculateDimeIntelligenceEfficiency({
        ...BASELINE,
        correctness: 1.01,
      })
    ).toThrow(/correctness/);
    expect(() =>
      calculateDimeIntelligenceEfficiency({ ...BASELINE, cost: 0 })
    ).toThrow(/cost/);
  });

  it("marks a training strategy eligible only after deterministic causes are eliminated", () => {
    expect(assessDimeTrainingStrategy(TRAINING_STRATEGY)).toEqual({
      accepted: true,
      trainingEligibleForAuthorization: true,
      issues: [],
    });

    const assessment = assessDimeTrainingStrategy({
      ...TRAINING_STRATEGY,
      deterministicCausesEliminated: false,
    });
    expect(assessment.trainingEligibleForAuthorization).toBe(false);
    expect(assessment.issues).toContain("deterministic_causes_not_eliminated");
  });

  it("rejects vague training objectives and runtime failures disguised as training work", () => {
    const assessment = assessDimeTrainingStrategy({
      ...TRAINING_STRATEGY,
      failureClass: "routing",
      falsifiableHypothesis: "Make the model smarter.",
    });
    expect(assessment).toMatchObject({
      accepted: false,
      trainingEligibleForAuthorization: false,
    });
    expect(assessment.issues).toEqual(
      expect.arrayContaining([
        "hypothesis_not_falsifiable",
        "failure_layer_not_training_eligible",
      ])
    );
  });

  it("blocks promotion unless efficiency, target capability, independence, and rollback gates pass", () => {
    const candidate = {
      ...BASELINE,
      correctness: 0.94,
      groundedness: 0.94,
    };
    const passing = assessDimePromotion({
      baseline: BASELINE,
      candidate,
      minimumEfficiencyGain: 0.05,
      targetedCapabilityImproved: true,
      zeroToleranceFailures: 0,
      regressionLimitsPassed: true,
      independentEvaluator: true,
      lockedEvaluationPassed: true,
      rollbackReady: true,
    });
    expect(passing.verdict).toBe("SHADOW");
    expect(passing.relativeGain).toBeGreaterThan(0.05);

    const selfApproved = assessDimePromotion({
      baseline: BASELINE,
      candidate,
      minimumEfficiencyGain: 0.05,
      targetedCapabilityImproved: true,
      zeroToleranceFailures: 0,
      regressionLimitsPassed: true,
      independentEvaluator: false,
      lockedEvaluationPassed: true,
      rollbackReady: true,
    });
    expect(selfApproved.verdict).toBe("REVISE");
    expect(selfApproved.issues).toContain("evaluation_not_independent");
  });

  it("scores production traces by required diagnostic field coverage", () => {
    const partial = scoreDimeProductionTrace({
      requestId: "request-1",
      modelVersion: "model-1",
      route: "matchup",
      latencyMs: 800,
    });
    expect(partial.complete).toBe(false);
    expect(partial.score).toBeCloseTo(4 / 12);
    expect(partial.missingFields).toContain("estimatedCost");

    const complete = scoreDimeProductionTrace({
      requestId: "request-1",
      applicationVersion: "commit-1",
      modelVersion: "model-1",
      adapterVersion: null,
      promptVersion: "prompt-1",
      route: "matchup",
      retrievedRecords: ["event-1"],
      dataTimestamps: ["2026-07-29T12:00:00Z"],
      toolCalls: ["read_game_context"],
      validatorResults: ["completeness:passed"],
      latencyMs: 800,
      tokenUsage: 500,
      estimatedCost: 0.01,
    });
    expect(complete).toMatchObject({ complete: true, score: 1 });
  });

  it("exposes a stable, non-authorizing owner summary", () => {
    const first = getDimeEngineeringControlSummary();
    const second = getDimeEngineeringControlSummary();
    expect(first.routePolicySha256).toMatch(/^[0-9a-f]{64}$/);
    expect(first.routePolicySha256).toBe(second.routePolicySha256);
    expect(first.authorization).toEqual({
      changesProvider: false,
      authorizesTraining: false,
      authorizesRelease: false,
      authorizesServing: false,
    });
  });
});
