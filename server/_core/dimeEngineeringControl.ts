import { createHash } from "node:crypto";

export const DIME_ENGINEERING_CONTROL_VERSION =
  "dime-composite-engineering-control-v1" as const;

export const DIME_FAILURE_LAYERS = [
  "product_logic",
  "routing",
  "retrieval",
  "tool_use",
  "context_construction",
  "data_quality",
  "reasoning",
  "knowledge",
  "instruction_following",
  "calibration_uncertainty",
  "model_capacity",
] as const;

export type DimeFailureLayer = (typeof DIME_FAILURE_LAYERS)[number];

export const DIME_PRODUCT_ROUTES = [
  "platform",
  "matchup",
  "full_slate",
  "educational",
  "bet_explanation",
  "historical",
  "account",
  "live_data",
  "general_sports",
] as const;

export type DimeProductRoute = (typeof DIME_PRODUCT_ROUTES)[number];

export const DIME_INTERVENTIONS = [
  "runtime_fix",
  "prompt_or_schema",
  "retrieval_improvement",
  "small_adapter",
  "large_adapter",
  "continued_pretraining",
  "new_architecture",
] as const;

export type DimeIntervention = (typeof DIME_INTERVENTIONS)[number];

export const DIME_RELEASE_VERDICTS = [
  "REJECT",
  "REVISE",
  "SHADOW",
  "CANARY",
  "RELEASE",
  "ROLLBACK",
] as const;

export type DimeReleaseVerdict = (typeof DIME_RELEASE_VERDICTS)[number];

export const DIME_CONTROL_AGENTS = [
  "model_strategy_governor",
  "failure_diagnosis_agent",
  "data_and_pretraining_agent",
  "architecture_research_agent",
  "scaling_science_agent",
  "post_training_agent",
  "training_systems_agent",
  "evaluation_authority",
  "release_controller",
  "developer_platform_agent",
  "production_learning_agent",
] as const;

export interface DimeRoutePolicy {
  route: DimeProductRoute;
  lifecycle: "active" | "partial" | "planned";
  legacyAnswerMode: "platform" | "matchup" | "slate" | "educational" | null;
  contextBudget: {
    maxRetrievedRecords: number | null;
    maxTokens: number | null;
    status: "active" | "requires_benchmark";
  };
  retrievalPolicy:
    | "none"
    | "platform_catalog"
    | "event_exact_only"
    | "slate_bounded"
    | "historical_timestamped"
    | "live_authoritative"
    | "account_authoritative"
    | "planned";
  modelTier: "deterministic" | "configured_provider" | "unassigned";
  toolPermissions: readonly string[];
  outputSchema: string;
  latencyTarget: {
    p95Ms: number | null;
    status: "approved" | "requires_benchmark";
  };
  evaluationSuite: string;
}

export type DimeLegacyAnswerMode =
  | "platform"
  | "matchup"
  | "slate"
  | "educational";

export const DIME_ROUTE_POLICIES: Readonly<
  Record<DimeProductRoute, DimeRoutePolicy>
> = {
  platform: {
    route: "platform",
    lifecycle: "active",
    legacyAnswerMode: "platform",
    contextBudget: {
      maxRetrievedRecords: 0,
      maxTokens: null,
      status: "requires_benchmark",
    },
    retrievalPolicy: "platform_catalog",
    modelTier: "configured_provider",
    toolPermissions: [],
    outputSchema: "dime-platform-answer-v1",
    latencyTarget: { p95Ms: null, status: "requires_benchmark" },
    evaluationSuite: "platform_understanding",
  },
  matchup: {
    route: "matchup",
    lifecycle: "active",
    legacyAnswerMode: "matchup",
    contextBudget: {
      maxRetrievedRecords: 2,
      maxTokens: null,
      status: "requires_benchmark",
    },
    retrievalPolicy: "event_exact_only",
    modelTier: "configured_provider",
    toolPermissions: ["read_game_context"],
    outputSchema: "dime-matchup-answer-v1",
    latencyTarget: { p95Ms: null, status: "requires_benchmark" },
    evaluationSuite: "matchup_game_live",
  },
  full_slate: {
    route: "full_slate",
    lifecycle: "active",
    legacyAnswerMode: "slate",
    contextBudget: {
      maxRetrievedRecords: 12,
      maxTokens: null,
      status: "requires_benchmark",
    },
    retrievalPolicy: "slate_bounded",
    modelTier: "configured_provider",
    toolPermissions: ["read_game_context"],
    outputSchema: "dime-slate-answer-v1",
    latencyTarget: { p95Ms: null, status: "requires_benchmark" },
    evaluationSuite: "full_slate_analysis",
  },
  educational: {
    route: "educational",
    lifecycle: "active",
    legacyAnswerMode: "educational",
    contextBudget: {
      maxRetrievedRecords: 0,
      maxTokens: null,
      status: "requires_benchmark",
    },
    retrievalPolicy: "none",
    modelTier: "deterministic",
    toolPermissions: ["deterministic_market_math"],
    outputSchema: "dime-educational-answer-v1",
    latencyTarget: { p95Ms: null, status: "requires_benchmark" },
    evaluationSuite: "market_math",
  },
  bet_explanation: {
    route: "bet_explanation",
    lifecycle: "partial",
    legacyAnswerMode: "educational",
    contextBudget: {
      maxRetrievedRecords: 0,
      maxTokens: null,
      status: "requires_benchmark",
    },
    retrievalPolicy: "none",
    modelTier: "configured_provider",
    toolPermissions: ["deterministic_market_math"],
    outputSchema: "dime-bet-explanation-answer-v1",
    latencyTarget: { p95Ms: null, status: "requires_benchmark" },
    evaluationSuite: "bet_explanation",
  },
  historical: {
    route: "historical",
    lifecycle: "planned",
    legacyAnswerMode: null,
    contextBudget: {
      maxRetrievedRecords: null,
      maxTokens: null,
      status: "requires_benchmark",
    },
    retrievalPolicy: "historical_timestamped",
    modelTier: "unassigned",
    toolPermissions: ["read_odds_history", "read_historical_results"],
    outputSchema: "dime-historical-answer-v1",
    latencyTarget: { p95Ms: null, status: "requires_benchmark" },
    evaluationSuite: "temporal_historical",
  },
  account: {
    route: "account",
    lifecycle: "planned",
    legacyAnswerMode: null,
    contextBudget: {
      maxRetrievedRecords: 0,
      maxTokens: null,
      status: "requires_benchmark",
    },
    retrievalPolicy: "account_authoritative",
    modelTier: "unassigned",
    toolPermissions: ["read_own_account"],
    outputSchema: "dime-account-answer-v1",
    latencyTarget: { p95Ms: null, status: "requires_benchmark" },
    evaluationSuite: "account_authorization",
  },
  live_data: {
    route: "live_data",
    lifecycle: "planned",
    legacyAnswerMode: null,
    contextBudget: {
      maxRetrievedRecords: null,
      maxTokens: null,
      status: "requires_benchmark",
    },
    retrievalPolicy: "live_authoritative",
    modelTier: "unassigned",
    toolPermissions: [
      "read_current_odds",
      "read_live_scores",
      "read_current_injuries",
      "read_current_lineups",
    ],
    outputSchema: "dime-live-answer-v1",
    latencyTarget: { p95Ms: null, status: "requires_benchmark" },
    evaluationSuite: "temporal_live",
  },
  general_sports: {
    route: "general_sports",
    lifecycle: "planned",
    legacyAnswerMode: null,
    contextBudget: {
      maxRetrievedRecords: null,
      maxTokens: null,
      status: "requires_benchmark",
    },
    retrievalPolicy: "planned",
    modelTier: "unassigned",
    toolPermissions: [],
    outputSchema: "dime-general-sports-answer-v1",
    latencyTarget: { p95Ms: null, status: "requires_benchmark" },
    evaluationSuite: "general_sports",
  },
};

export interface DimeIntelligenceEfficiencyMetrics {
  correctness: number;
  usefulness: number;
  groundedness: number;
  calibration: number;
  reliability: number;
  latency: number;
  cost: number;
  complexity: number;
  regressionRisk: number;
}

export interface DimeTrainingStrategy {
  failureClass: DimeFailureLayer;
  evidence: readonly string[];
  rootCause: string;
  trainingNecessity: "required" | "conditional" | "not_required";
  simplerInterventionsRejected: readonly DimeIntervention[];
  capabilityTarget: string;
  falsifiableHypothesis: string;
  trainingMethod: string;
  curriculum: readonly string[];
  dataRequirements: readonly string[];
  expectedGain: string;
  regressionRisks: readonly string[];
  stopConditions: readonly string[];
  acceptanceThresholds: readonly string[];
  deterministicCausesEliminated: boolean;
}

export interface DimeTrainingStrategyAssessment {
  accepted: boolean;
  trainingEligibleForAuthorization: boolean;
  issues: string[];
}

export interface DimePromotionInput {
  baseline: DimeIntelligenceEfficiencyMetrics;
  candidate: DimeIntelligenceEfficiencyMetrics;
  minimumEfficiencyGain: number;
  targetedCapabilityImproved: boolean;
  zeroToleranceFailures: number;
  regressionLimitsPassed: boolean;
  independentEvaluator: boolean;
  lockedEvaluationPassed: boolean;
  rollbackReady: boolean;
}

export interface DimePromotionAssessment {
  verdict: Extract<DimeReleaseVerdict, "REJECT" | "REVISE" | "SHADOW">;
  baselineEfficiency: number;
  candidateEfficiency: number;
  relativeGain: number;
  issues: string[];
}

export interface DimeProductionTraceContract {
  requestId?: string;
  applicationVersion?: string;
  modelVersion?: string;
  adapterVersion?: string | null;
  promptVersion?: string;
  route?: DimeProductRoute;
  retrievedRecords?: readonly string[];
  dataTimestamps?: readonly string[];
  toolCalls?: readonly string[];
  validatorResults?: readonly string[];
  latencyMs?: number;
  tokenUsage?: number;
  estimatedCost?: number;
}

export interface DimeTraceQualityAssessment {
  score: number;
  presentFields: string[];
  missingFields: string[];
  complete: boolean;
}

const TRAINABLE_FAILURE_LAYERS = new Set<DimeFailureLayer>([
  "tool_use",
  "reasoning",
  "knowledge",
  "instruction_following",
  "calibration_uncertainty",
  "model_capacity",
]);

const VAGUE_HYPOTHESIS =
  /\b(make|become|get)\s+(?:the\s+model\s+)?(?:smarter|better|stronger)\b/i;

function normalizedRouteQuery(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9+.-]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Additive product taxonomy for diagnosis and evaluation.
 *
 * Runtime Answer Routing v1 remains authoritative for current behavior. This
 * classifier refines that four-route mode into the complete product taxonomy
 * without activating planned retrieval paths or tool permissions.
 */
export function classifyDimeProductRoute(
  query: string,
  legacyMode: DimeLegacyAnswerMode
): DimeProductRoute {
  const normalized = normalizedRouteQuery(query);

  if (
    /\b(account|billing|subscription|password|profile|sign in|log in|login|email address|payment method)\b/.test(
      normalized
    )
  ) {
    return "account";
  }
  if (
    /\b(live|right now|in progress|current score|current odds|latest odds|latest line|injury update|starting lineup|confirmed lineup)\b/.test(
      normalized
    )
  ) {
    return "live_data";
  }
  if (
    /\b(historical|previous season|last season|past game|past games|game history|closing line|line movement|odds history|yesterday)\b/.test(
      normalized
    )
  ) {
    return "historical";
  }
  if (
    /\b(explain (?:this |the )?bet|what does .{0,32}(?:mean|pay)|how does .{0,32}(?:bet|wager|parlay|spread|moneyline|total) work)\b/.test(
      normalized
    )
  ) {
    return "bet_explanation";
  }

  if (legacyMode === "platform") return "platform";
  if (legacyMode === "matchup") return "matchup";
  if (legacyMode === "slate") return "full_slate";
  if (
    /\b(probability|implied probability|expected value|ev|vig|hold|roi|convert|calculate|calculation)\b/.test(
      normalized
    )
  ) {
    return "educational";
  }
  return "general_sports";
}

function assertUnitInterval(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${name} must be finite and between 0 and 1.`);
  }
}

function assertPositive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be finite and greater than 0.`);
  }
}

export function calculateDimeIntelligenceEfficiency(
  metrics: DimeIntelligenceEfficiencyMetrics
): number {
  for (const name of [
    "correctness",
    "usefulness",
    "groundedness",
    "calibration",
    "reliability",
  ] as const) {
    assertUnitInterval(name, metrics[name]);
  }
  for (const name of [
    "latency",
    "cost",
    "complexity",
    "regressionRisk",
  ] as const) {
    assertPositive(name, metrics[name]);
  }

  const quality =
    metrics.correctness *
    metrics.usefulness *
    metrics.groundedness *
    metrics.calibration *
    metrics.reliability;
  const burden =
    metrics.latency *
    metrics.cost *
    metrics.complexity *
    metrics.regressionRisk;
  return quality / burden;
}

export function assessDimeTrainingStrategy(
  strategy: DimeTrainingStrategy
): DimeTrainingStrategyAssessment {
  const issues: string[] = [];
  const trimmedHypothesis = strategy.falsifiableHypothesis.trim();

  if (strategy.evidence.length === 0) issues.push("evidence_missing");
  if (!strategy.rootCause.trim()) issues.push("root_cause_missing");
  if (!strategy.capabilityTarget.trim())
    issues.push("capability_target_missing");
  if (
    !trimmedHypothesis ||
    VAGUE_HYPOTHESIS.test(trimmedHypothesis) ||
    !/\b(?:from|to|by|at least|no more than|less than|greater than)\b/i.test(
      trimmedHypothesis
    )
  ) {
    issues.push("hypothesis_not_falsifiable");
  }
  if (strategy.acceptanceThresholds.length === 0) {
    issues.push("acceptance_thresholds_missing");
  }
  if (strategy.stopConditions.length === 0) {
    issues.push("stop_conditions_missing");
  }

  if (strategy.trainingNecessity === "required") {
    if (!TRAINABLE_FAILURE_LAYERS.has(strategy.failureClass)) {
      issues.push("failure_layer_not_training_eligible");
    }
    if (!strategy.deterministicCausesEliminated) {
      issues.push("deterministic_causes_not_eliminated");
    }
    if (strategy.simplerInterventionsRejected.length === 0) {
      issues.push("simpler_interventions_not_tested");
    }
    if (!strategy.trainingMethod.trim()) issues.push("training_method_missing");
    if (strategy.curriculum.length === 0) issues.push("curriculum_missing");
    if (strategy.dataRequirements.length === 0) {
      issues.push("data_requirements_missing");
    }
  }

  const accepted = issues.length === 0;
  return {
    accepted,
    trainingEligibleForAuthorization:
      accepted && strategy.trainingNecessity === "required",
    issues,
  };
}

export function assessDimePromotion(
  input: DimePromotionInput
): DimePromotionAssessment {
  assertPositive("minimumEfficiencyGain", input.minimumEfficiencyGain);
  const baselineEfficiency = calculateDimeIntelligenceEfficiency(
    input.baseline
  );
  const candidateEfficiency = calculateDimeIntelligenceEfficiency(
    input.candidate
  );
  const relativeGain =
    baselineEfficiency === 0
      ? candidateEfficiency > 0
        ? Number.POSITIVE_INFINITY
        : 0
      : (candidateEfficiency - baselineEfficiency) / baselineEfficiency;
  const issues: string[] = [];

  if (input.zeroToleranceFailures > 0) {
    issues.push("zero_tolerance_failure");
  }
  if (!input.targetedCapabilityImproved) {
    issues.push("targeted_capability_not_improved");
  }
  if (relativeGain < input.minimumEfficiencyGain) {
    issues.push("system_efficiency_gain_below_threshold");
  }
  if (!input.regressionLimitsPassed) {
    issues.push("regression_limit_exceeded");
  }
  if (!input.independentEvaluator) {
    issues.push("evaluation_not_independent");
  }
  if (!input.lockedEvaluationPassed) {
    issues.push("locked_evaluation_not_passed");
  }
  if (!input.rollbackReady) {
    issues.push("rollback_not_ready");
  }

  return {
    verdict:
      input.zeroToleranceFailures > 0 ||
      relativeGain < input.minimumEfficiencyGain ||
      !input.targetedCapabilityImproved
        ? "REJECT"
        : issues.length > 0
          ? "REVISE"
          : "SHADOW",
    baselineEfficiency,
    candidateEfficiency,
    relativeGain,
    issues,
  };
}

export function scoreDimeProductionTrace(
  trace: DimeProductionTraceContract
): DimeTraceQualityAssessment {
  const required: Array<keyof DimeProductionTraceContract> = [
    "requestId",
    "applicationVersion",
    "modelVersion",
    "promptVersion",
    "route",
    "retrievedRecords",
    "dataTimestamps",
    "toolCalls",
    "validatorResults",
    "latencyMs",
    "tokenUsage",
    "estimatedCost",
  ];
  const presentFields = required.filter(field => trace[field] !== undefined);
  const missingFields = required.filter(field => trace[field] === undefined);
  return {
    score: presentFields.length / required.length,
    presentFields,
    missingFields,
    complete: missingFields.length === 0,
  };
}

export function getDimeEngineeringControlSummary() {
  const serializedPolicies = JSON.stringify(DIME_ROUTE_POLICIES);
  return {
    version: DIME_ENGINEERING_CONTROL_VERSION,
    objective:
      "(correctness * usefulness * groundedness * calibration * reliability) / (latency * cost * complexity * regressionRisk)",
    failureLayers: DIME_FAILURE_LAYERS,
    interventions: DIME_INTERVENTIONS,
    releaseVerdicts: DIME_RELEASE_VERDICTS,
    agents: DIME_CONTROL_AGENTS,
    routePolicies: DIME_ROUTE_POLICIES,
    routePolicySha256: createHash("sha256")
      .update(serializedPolicies, "utf8")
      .digest("hex"),
    authorization: {
      changesProvider: false,
      authorizesTraining: false,
      authorizesRelease: false,
      authorizesServing: false,
    },
  };
}
