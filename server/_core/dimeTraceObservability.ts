import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  DIME_PRODUCT_ROUTES,
  type DimeProductRoute,
} from "./dimeEngineeringControl";
import {
  dimeIngestionLifecycleNotApplicable,
  dimeProviderObservationNotApplicable,
  type DimeIngestionLifecycle,
  type DimeProviderObservation,
  validateDimeIngestionLifecycle,
  validateDimeProviderObservation,
} from "./dimeEvidenceProvenance";
import {
  dimePricingEntrySchema,
  loadDimePricingRegistry,
  resolveDimePricing,
  type DimePricingRegistry,
} from "./dimePricingGovernance";

export const DIME_TRACE_OBSERVABILITY_VERSION =
  "dime-trace-observability-v1" as const;
export const DIME_TRACE_SCHEMA_REVISION = "trace-v1-phase1-2026-07-29" as const;
export const DIME_APPLICATION_VERSION = "1.0.0" as const;

const MAX_LABEL_LENGTH = 160;
const MAX_TOOL_ARGUMENT_BYTES = 4_000;
const ISO_TIMESTAMP = z.string().datetime({ offset: true });
const SHA256 = z.string().regex(/^[0-9a-f]{64}$/);
const boundedLabel = z
  .string()
  .min(1)
  .max(MAX_LABEL_LENGTH)
  .regex(/^[a-z0-9][a-z0-9._:/@+-]*$/i);

const productRouteSchema = z.enum([
  "platform",
  "matchup",
  "full_slate",
  "educational",
  "bet_explanation",
  "historical",
  "account",
  "live_data",
  "general_sports",
]);

const traceIdentitySchema = z
  .object({
    observabilityRevision: z.literal(DIME_TRACE_OBSERVABILITY_VERSION),
    requestId: z.string().uuid(),
    applicationVersion: boundedLabel,
    gitCommit: z.string().regex(/^[0-9a-f]{7,64}$/i),
    environment: boundedLabel,
    modelProvider: boundedLabel,
    baseModel: boundedLabel,
    modelRevision: boundedLabel,
    adapterRevision: boundedLabel.nullable(),
    promptRevision: boundedLabel,
    route: productRouteSchema,
    routePolicyRevision: SHA256,
    controlPlaneRevision: boundedLabel,
    traceSchemaRevision: z.literal(DIME_TRACE_SCHEMA_REVISION),
  })
  .strict();

export type DimeTraceIdentity = z.infer<typeof traceIdentitySchema>;

export interface DimeTraceIdentityInput {
  requestId: string;
  modelProvider: string;
  baseModel: string;
  modelRevision?: string;
  adapterRevision?: string | null;
  promptRevision: string;
  route: DimeProductRoute;
  routePolicyRevision: string;
  controlPlaneRevision: string;
  env?: Record<string, string | undefined>;
}

export type DimeTraceIdentityResult =
  | { complete: true; value: DimeTraceIdentity }
  | { complete: false; missingFields: string[]; invalidFields: string[] };

const toolExecutionStateSchema = z.enum([
  "not_required",
  "selected_not_invoked",
  "succeeded",
  "empty",
  "failed",
  "timed_out",
  "stale",
  "malformed",
  "rejected",
]);

export type DimeToolExecutionState = z.infer<typeof toolExecutionStateSchema>;

const toolCallSchema = z
  .object({
    toolName: boundedLabel.nullable(),
    toolRevision: boundedLabel.nullable(),
    invocationId: z.string().uuid().nullable(),
    normalizedArguments: z.record(z.string(), z.unknown()),
    startedAt: ISO_TIMESTAMP.nullable(),
    completedAt: ISO_TIMESTAMP.nullable(),
    status: toolExecutionStateSchema,
    timeout: z.boolean(),
    retryCount: z.number().int().min(0).max(8),
    resultHash: SHA256.nullable(),
    sourceAuthority: boundedLabel.nullable(),
    sourceTimestamp: ISO_TIMESTAMP.nullable(),
    freshnessAtRequest: z
      .enum(["current", "delayed", "stale", "unknown", "not_applicable"])
      .nullable(),
    recordsReturned: z.number().int().min(0).max(10_000),
    validationResult: z.enum(["passed", "failed", "not_run", "not_applicable"]),
  })
  .strict()
  .superRefine((value, context) => {
    const invoked = !["not_required", "selected_not_invoked"].includes(
      value.status
    );
    if (invoked && (!value.invocationId || !value.startedAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invoked tools require invocation identity and start time.",
      });
    }
    if (value.status === "not_required" && value.toolName !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A not-required tool state cannot name a selected tool.",
      });
    }
    if (value.status === "succeeded" && value.validationResult !== "passed") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A successful tool result must pass validation.",
      });
    }
    if (value.status === "timed_out" && !value.timeout) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A timed-out tool result must set timeout=true.",
      });
    }
  });

export type DimeToolCallTrace = z.infer<typeof toolCallSchema>;

const evidenceTimestampSchema = z
  .object({
    scheduledEventTime: ISO_TIMESTAMP.nullable(),
    providerObservedAt: ISO_TIMESTAMP.nullable(),
    sourceUpdatedAt: ISO_TIMESTAMP.nullable(),
    databaseIngestedAt: ISO_TIMESTAMP.nullable(),
    retrievedAt: ISO_TIMESTAMP,
    responseGeneratedAt: ISO_TIMESTAMP.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const orderedPairs: Array<
      [keyof typeof value, keyof typeof value, string]
    > = [
      [
        "sourceUpdatedAt",
        "providerObservedAt",
        "source update cannot follow provider observation",
      ],
      [
        "providerObservedAt",
        "databaseIngestedAt",
        "provider observation cannot follow database ingestion",
      ],
      [
        "databaseIngestedAt",
        "retrievedAt",
        "database ingestion cannot follow retrieval",
      ],
      [
        "retrievedAt",
        "responseGeneratedAt",
        "retrieval cannot follow response generation",
      ],
    ];
    for (const [earlierField, laterField, message] of orderedPairs) {
      const earlier = value[earlierField];
      const later = value[laterField];
      if (earlier && later && Date.parse(earlier) > Date.parse(later)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message });
      }
    }
  });

export type DimeEvidenceTimestamps = z.infer<typeof evidenceTimestampSchema>;

const stageLatencySchema = z
  .object({
    classificationMs: z.number().int().min(0).max(120_000),
    entityResolutionMs: z.number().int().min(0).max(120_000).nullable(),
    retrievalMs: z.number().int().min(0).max(120_000).nullable(),
    toolMs: z.number().int().min(0).max(120_000).nullable(),
    contextConstructionMs: z.number().int().min(0).max(120_000).nullable(),
    modelTimeToFirstTokenMs: z.number().int().min(0).max(600_000).nullable(),
    modelCompletionMs: z.number().int().min(0).max(600_000).nullable(),
    validationMs: z.number().int().min(0).max(120_000).nullable(),
    endToEndMs: z.number().int().min(0).max(600_000).nullable(),
  })
  .strict();

export type DimeStageLatency = z.infer<typeof stageLatencySchema>;

const contextMetricsSchema = z
  .object({
    inputTokens: z.number().int().min(0).nullable(),
    retrievedRecords: z.number().int().min(0).max(10_000),
    retrievedEvents: z.number().int().min(0).max(1_000),
    duplicateContextRate: z.number().min(0).max(1),
    irrelevantContextRate: z.number().min(0).max(1).nullable(),
    contextFreshness: z.enum(["live", "delayed", "none"]),
    contextConstructionMs: z.number().int().min(0).max(120_000).nullable(),
    suppliedContextUsedRate: z.number().min(0).max(1).nullable(),
    contextBytes: z.number().int().min(0).max(1_000_000),
    truncationOccurred: z.boolean(),
  })
  .strict();

export type DimeContextMetrics = z.infer<typeof contextMetricsSchema>;

export interface DimeTraceContextObservability {
  toolCall: DimeToolCallTrace;
  timestamps: DimeEvidenceTimestamps;
  providerObservation: DimeProviderObservation;
  ingestionLifecycle: DimeIngestionLifecycle;
  stageLatency: DimeStageLatency;
  contextMetrics: DimeContextMetrics;
  dynamicEvidenceUsed: boolean;
}

const costEstimateSchema = z
  .object({
    inputTokens: z.number().int().min(0),
    outputTokens: z.number().int().min(0),
    cachedInputTokens: z.number().int().min(0),
    toolCostUsd: z.number().min(0).nullable(),
    modelCostUsd: z.number().min(0).nullable(),
    estimatedTotalCostUsd: z.number().min(0).nullable(),
    pricingRevision: boundedLabel.nullable(),
    pricingSource: boundedLabel.nullable(),
    pricingRegistryRevision: boundedLabel.nullable(),
    pricingEntry: dimePricingEntrySchema.nullable(),
    unavailabilityReason: z
      .enum([
        "pricing_identity_missing",
        "registry_not_configured",
        "registry_invalid",
        "registry_not_reviewed",
        "pricing_entry_not_found",
        "pricing_entry_ambiguous",
        "pricing_entry_checksum_invalid",
      ])
      .nullable(),
    status: z.enum(["estimated", "zero_cost_runtime", "cost_unavailable"]),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.status === "estimated" &&
      (!value.pricingRevision ||
        !value.pricingSource ||
        !value.pricingRegistryRevision ||
        !value.pricingEntry ||
        value.modelCostUsd === null ||
        value.estimatedTotalCostUsd === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Estimated cost requires versioned pricing provenance.",
      });
    }
    if (
      value.status === "cost_unavailable" &&
      (value.modelCostUsd !== null ||
        value.estimatedTotalCostUsd !== null ||
        value.pricingEntry !== null ||
        value.unavailabilityReason === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Unavailable pricing requires a reason and cannot emit a monetary estimate.",
      });
    }
  });

export type DimeCostEstimate = z.infer<typeof costEstimateSchema>;

export interface DimeTraceCompletenessInput {
  identity?: DimeTraceIdentity;
  toolCall?: DimeToolCallTrace;
  timestamps?: DimeEvidenceTimestamps;
  providerObservation?: DimeProviderObservation;
  ingestionLifecycle?: DimeIngestionLifecycle;
  stageLatency?: DimeStageLatency;
  contextMetrics?: DimeContextMetrics;
  cost?: DimeCostEstimate;
  dynamicEvidenceUsed: boolean;
}

export interface DimeTraceCompletenessAssessment {
  complete: boolean;
  missingFields: string[];
  issues: string[];
}

export interface DimeTraceObservabilityReadiness {
  version: typeof DIME_TRACE_OBSERVABILITY_VERSION;
  traceSchemaRevision: typeof DIME_TRACE_SCHEMA_REVISION;
  applicationVersion: string;
  identity: {
    gitCommitConfigured: boolean;
    environmentConfigured: boolean;
  };
  pricing: {
    complete: boolean;
    registryConfigured: boolean;
    registryLoaded: boolean;
    registryReviewed: boolean;
    entryCount: number;
  };
  measurement: {
    authoritativeDynamicTimestampCoverage: "requires_measurement";
    routeLatencyDistributions: "requires_measurement";
    routeContextDistributions: "requires_measurement";
    independentGateVerdict: "not_issued";
  };
  security: {
    exposesRawTraces: false;
    acceptsTraceIdentifiers: false;
    exposesCredentials: false;
  };
  readyForIndependentGate: false;
}

export interface DimeRouteObservation {
  route: DimeProductRoute;
  failed: boolean;
  stageLatency: DimeStageLatency;
  contextMetrics: DimeContextMetrics;
  cost: DimeCostEstimate;
  toolStatus: DimeToolExecutionState;
}

export interface DimeDistribution {
  p50: number | null;
  p90: number | null;
  p95: number | null;
  p99: number | null;
  maximum: number | null;
  sampleCount: number;
}

const TOOL_SECRET_KEYS = new Set([
  "authorization",
  "cookie",
  "credential",
  "credentials",
  "password",
  "secret",
  "session",
  "sessiontoken",
  "accesstoken",
  "refreshtoken",
  "token",
  "apikey",
]);
const TRACE_SECRET_KEYS = new Set([
  "authorization",
  "cookie",
  "credential",
  "credentials",
  "password",
  "secret",
  "sessiontoken",
  "accesstoken",
  "refreshtoken",
  "apikey",
]);
const SECRET_VALUE =
  /(?:\bBearer\s+[A-Za-z0-9._~-]+|(?:mysql|postgres(?:ql)?):\/\/|-----BEGIN [A-Z ]+PRIVATE KEY-----)/i;

function readEnv(
  env: Record<string, string | undefined>,
  ...names: string[]
): string | undefined {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

export function getDimeTraceObservabilityReadiness(
  env: Record<string, string | undefined> = process.env
): DimeTraceObservabilityReadiness {
  const registry = loadDimePricingRegistry(env);
  const registryLoaded = registry.status === "loaded";
  const registryReviewed =
    registryLoaded && registry.registry.status === "reviewed";
  const entryCount = registryLoaded ? registry.registry.entries.length : 0;
  return {
    version: DIME_TRACE_OBSERVABILITY_VERSION,
    traceSchemaRevision: DIME_TRACE_SCHEMA_REVISION,
    applicationVersion:
      env.DIME_APPLICATION_VERSION?.trim() || DIME_APPLICATION_VERSION,
    identity: {
      gitCommitConfigured: Boolean(
        env.RAILWAY_GIT_COMMIT_SHA?.trim() || env.GIT_COMMIT_SHA?.trim()
      ),
      environmentConfigured: Boolean(
        env.RAILWAY_ENVIRONMENT_NAME?.trim() || env.NODE_ENV?.trim()
      ),
    },
    pricing: {
      complete: registryReviewed && entryCount > 0,
      registryConfigured: Boolean(env.DIME_PRICING_REGISTRY_PATH?.trim()),
      registryLoaded,
      registryReviewed,
      entryCount,
    },
    measurement: {
      authoritativeDynamicTimestampCoverage: "requires_measurement",
      routeLatencyDistributions: "requires_measurement",
      routeContextDistributions: "requires_measurement",
      independentGateVerdict: "not_issued",
    },
    security: {
      exposesRawTraces: false,
      acceptsTraceIdentifiers: false,
      exposesCredentials: false,
    },
    readyForIndependentGate: false,
  };
}

function normalizedSensitiveKey(value: string): string {
  return value.replace(/[_-]/g, "").toLowerCase();
}

function distribution(values: Array<number | null>): DimeDistribution {
  const sorted = values
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right);
  const percentile = (value: number): number | null => {
    if (sorted.length === 0) return null;
    const index = Math.max(0, Math.ceil((value / 100) * sorted.length) - 1);
    return sorted[index];
  };
  return {
    p50: percentile(50),
    p90: percentile(90),
    p95: percentile(95),
    p99: percentile(99),
    maximum: sorted.at(-1) ?? null,
    sampleCount: sorted.length,
  };
}

export function summarizeDimeRouteObservations(
  observations: readonly DimeRouteObservation[]
) {
  return Object.fromEntries(
    DIME_PRODUCT_ROUTES.map(route => {
      const routeObservations = observations.filter(
        observation => observation.route === route
      );
      const stage = <K extends keyof DimeStageLatency>(field: K) =>
        distribution(
          routeObservations.map(observation => observation.stageLatency[field])
        );
      return [
        route,
        {
          sampleCount: routeObservations.length,
          failureRate:
            routeObservations.length === 0
              ? null
              : routeObservations.filter(observation => observation.failed)
                  .length / routeObservations.length,
          latencyMs: {
            classification: stage("classificationMs"),
            entityResolution: stage("entityResolutionMs"),
            retrieval: stage("retrievalMs"),
            tool: stage("toolMs"),
            contextConstruction: stage("contextConstructionMs"),
            modelTimeToFirstToken: stage("modelTimeToFirstTokenMs"),
            modelCompletion: stage("modelCompletionMs"),
            validation: stage("validationMs"),
            endToEnd: stage("endToEndMs"),
          },
          context: {
            inputTokens: distribution(
              routeObservations.map(
                observation => observation.contextMetrics.inputTokens
              )
            ),
            retrievedRecords: distribution(
              routeObservations.map(
                observation => observation.contextMetrics.retrievedRecords
              )
            ),
            retrievedEvents: distribution(
              routeObservations.map(
                observation => observation.contextMetrics.retrievedEvents
              )
            ),
            contextBytes: distribution(
              routeObservations.map(
                observation => observation.contextMetrics.contextBytes
              )
            ),
            truncationRate:
              routeObservations.length === 0
                ? null
                : routeObservations.filter(
                    observation => observation.contextMetrics.truncationOccurred
                  ).length / routeObservations.length,
          },
          costUsd: distribution(
            routeObservations.map(
              observation => observation.cost.estimatedTotalCostUsd
            )
          ),
          toolStates: Object.fromEntries(
            toolExecutionStateSchema.options.map(status => [
              status,
              routeObservations.filter(
                observation => observation.toolStatus === status
              ).length,
            ])
          ),
        },
      ];
    })
  );
}

export function resolveDimeTraceIdentity(
  input: DimeTraceIdentityInput
): DimeTraceIdentityResult {
  const env = input.env ?? process.env;
  const candidate = {
    observabilityRevision: DIME_TRACE_OBSERVABILITY_VERSION,
    requestId: input.requestId,
    applicationVersion:
      readEnv(env, "DIME_APPLICATION_VERSION") ?? DIME_APPLICATION_VERSION,
    gitCommit: readEnv(env, "RAILWAY_GIT_COMMIT_SHA", "GIT_COMMIT_SHA"),
    environment: readEnv(env, "RAILWAY_ENVIRONMENT_NAME", "NODE_ENV"),
    modelProvider: input.modelProvider,
    baseModel: input.baseModel,
    modelRevision: input.modelRevision ?? input.baseModel,
    adapterRevision: input.adapterRevision ?? null,
    promptRevision: input.promptRevision,
    route: input.route,
    routePolicyRevision: input.routePolicyRevision,
    controlPlaneRevision: input.controlPlaneRevision,
    traceSchemaRevision: DIME_TRACE_SCHEMA_REVISION,
  };
  const missingFields = Object.entries(candidate)
    .filter(([, value]) => value === undefined || value === "")
    .map(([field]) => field);
  if (missingFields.length > 0) {
    return { complete: false, missingFields, invalidFields: [] };
  }
  const parsed = traceIdentitySchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      complete: false,
      missingFields: [],
      invalidFields: Array.from(
        new Set(
          parsed.error.issues.map(issue => issue.path.join(".") || "identity")
        )
      ),
    };
  }
  return { complete: true, value: parsed.data };
}

export function requireDimeTraceIdentity(
  input: DimeTraceIdentityInput
): DimeTraceIdentity {
  const result = resolveDimeTraceIdentity(input);
  if (!result.complete) {
    throw new Error(
      `Dime trace identity is incomplete: ${[
        ...result.missingFields,
        ...result.invalidFields,
      ].join(",")}`
    );
  }
  return result.value;
}

function assertSecretSafe(value: unknown, path = "arguments"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSecretSafe(item, `${path}.${index}`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (TOOL_SECRET_KEYS.has(normalizedSensitiveKey(key))) {
        throw new Error(
          `Sensitive tool argument key rejected at ${path}.${key}.`
        );
      }
      assertSecretSafe(item, `${path}.${key}`);
    }
    return;
  }
  if (typeof value === "string" && SECRET_VALUE.test(value)) {
    throw new Error(`Sensitive tool argument value rejected at ${path}.`);
  }
}

function assertTraceMetadataSafe(value: unknown, path = "metadata"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertTraceMetadataSafe(item, `${path}.${index}`)
    );
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (TRACE_SECRET_KEYS.has(normalizedSensitiveKey(key))) {
        throw new Error(
          `Sensitive trace metadata key rejected at ${path}.${key}.`
        );
      }
      assertTraceMetadataSafe(item, `${path}.${key}`);
    }
    return;
  }
  if (typeof value === "string" && SECRET_VALUE.test(value)) {
    throw new Error(`Sensitive trace metadata value rejected at ${path}.`);
  }
}

export function validateDimeTraceMetadataSafety(
  value: Record<string, unknown>
): Record<string, unknown> {
  assertTraceMetadataSafe(value);
  return value;
}

export function validateDimeToolArguments(
  value: Record<string, unknown>
): Record<string, unknown> {
  assertSecretSafe(value);
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > MAX_TOOL_ARGUMENT_BYTES) {
    throw new Error("Normalized tool arguments exceed the trace contract.");
  }
  return JSON.parse(serialized) as Record<string, unknown>;
}

export function validateDimeToolCallTrace(value: unknown): DimeToolCallTrace {
  const parsed = toolCallSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("Tool-call trace failed its explicit-state contract.");
  }
  return {
    ...parsed.data,
    normalizedArguments: validateDimeToolArguments(
      parsed.data.normalizedArguments
    ),
  };
}

export function dimeNoToolRequiredTrace(): DimeToolCallTrace {
  return validateDimeToolCallTrace({
    toolName: null,
    toolRevision: null,
    invocationId: null,
    normalizedArguments: {},
    startedAt: null,
    completedAt: null,
    status: "not_required",
    timeout: false,
    retryCount: 0,
    resultHash: null,
    sourceAuthority: null,
    sourceTimestamp: null,
    freshnessAtRequest: "not_applicable",
    recordsReturned: 0,
    validationResult: "not_applicable",
  });
}

export function dimeNoDynamicContextObservability(
  classificationMs: number,
  observedAt = new Date()
): DimeTraceContextObservability {
  return {
    toolCall: dimeNoToolRequiredTrace(),
    timestamps: {
      scheduledEventTime: null,
      providerObservedAt: null,
      sourceUpdatedAt: null,
      databaseIngestedAt: null,
      retrievedAt: observedAt.toISOString(),
      responseGeneratedAt: null,
    },
    providerObservation: dimeProviderObservationNotApplicable(),
    ingestionLifecycle: dimeIngestionLifecycleNotApplicable(),
    stageLatency: {
      classificationMs,
      entityResolutionMs: null,
      retrievalMs: null,
      toolMs: null,
      contextConstructionMs: null,
      modelTimeToFirstTokenMs: null,
      modelCompletionMs: null,
      validationMs: null,
      endToEndMs: null,
    },
    contextMetrics: {
      inputTokens: null,
      retrievedRecords: 0,
      retrievedEvents: 0,
      duplicateContextRate: 0,
      irrelevantContextRate: null,
      contextFreshness: "none",
      contextConstructionMs: null,
      suppliedContextUsedRate: null,
      contextBytes: 0,
      truncationOccurred: false,
    },
    dynamicEvidenceUsed: false,
  };
}

export function assembleDimeContextObservability(input: {
  classificationMs: number;
  toolCall: DimeToolCallTrace;
  timestamps: DimeEvidenceTimestamps;
  providerObservation: DimeProviderObservation;
  ingestionLifecycle: DimeIngestionLifecycle;
  stageLatency: Pick<
    DimeStageLatency,
    "entityResolutionMs" | "retrievalMs" | "toolMs" | "contextConstructionMs"
  >;
  contextMetrics: DimeContextMetrics;
  dynamicEvidenceUsed: boolean;
}): DimeTraceContextObservability {
  return {
    toolCall: validateDimeToolCallTrace(input.toolCall),
    timestamps: validateDimeEvidenceTimestamps(input.timestamps),
    providerObservation: validateDimeProviderObservation(
      input.providerObservation
    ),
    ingestionLifecycle: validateDimeIngestionLifecycle(
      input.ingestionLifecycle
    ),
    stageLatency: validateDimeStageLatency({
      classificationMs: input.classificationMs,
      ...input.stageLatency,
      modelTimeToFirstTokenMs: null,
      modelCompletionMs: null,
      validationMs: null,
      endToEndMs: null,
    }),
    contextMetrics: validateDimeContextMetrics(input.contextMetrics),
    dynamicEvidenceUsed: input.dynamicEvidenceUsed,
  };
}

export function dimeToolCallTrace(input: {
  toolName: string;
  toolRevision: string;
  sourceAuthority: string;
  status: Exclude<DimeToolExecutionState, "not_required">;
  normalizedArguments: Record<string, unknown>;
  startedAt: Date;
  completedAt?: Date;
  recordsReturned?: number;
  resultText?: string;
  sourceTimestamp?: string | null;
  freshnessAtRequest?: DimeToolCallTrace["freshnessAtRequest"];
  validationResult?: DimeToolCallTrace["validationResult"];
  invocationId?: string;
}): DimeToolCallTrace {
  return validateDimeToolCallTrace({
    toolName: input.toolName,
    toolRevision: input.toolRevision,
    invocationId:
      input.status === "selected_not_invoked"
        ? null
        : (input.invocationId ?? randomUUID()),
    normalizedArguments: input.normalizedArguments,
    startedAt:
      input.status === "selected_not_invoked"
        ? null
        : input.startedAt.toISOString(),
    completedAt: input.completedAt?.toISOString() ?? null,
    status: input.status,
    timeout: input.status === "timed_out",
    retryCount: 0,
    resultHash:
      input.resultText === undefined
        ? null
        : createHash("sha256").update(input.resultText, "utf8").digest("hex"),
    sourceAuthority: input.sourceAuthority,
    sourceTimestamp: input.sourceTimestamp ?? null,
    freshnessAtRequest: input.freshnessAtRequest ?? "unknown",
    recordsReturned: input.recordsReturned ?? 0,
    validationResult:
      input.validationResult ??
      (input.status === "succeeded" ? "passed" : "not_run"),
  });
}

export function dimeContextToolTrace(
  input: Omit<
    Parameters<typeof dimeToolCallTrace>[0],
    "toolName" | "toolRevision" | "sourceAuthority"
  >
): DimeToolCallTrace {
  return dimeToolCallTrace({
    ...input,
    toolName: "read_game_context",
    toolRevision: "dime-chat-context-v1",
    sourceAuthority: "dime-platform-database",
  });
}

export function validateDimeEvidenceTimestamps(
  value: unknown
): DimeEvidenceTimestamps {
  return evidenceTimestampSchema.parse(value);
}

export function validateDimeStageLatency(value: unknown): DimeStageLatency {
  return stageLatencySchema.parse(value);
}

export function validateDimeContextMetrics(value: unknown): DimeContextMetrics {
  return contextMetricsSchema.parse(value);
}

export function estimateDimeTraceCost(input: {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  toolRequestCount?: number;
  zeroCostRuntime?: boolean;
  provider?: string;
  model?: string;
  modelRevision?: string;
  requestAt?: Date;
  pricingRegistry?: DimePricingRegistry;
  env?: Record<string, string | undefined>;
}): DimeCostEstimate {
  const env = input.env ?? process.env;
  const inputTokens = input.inputTokens ?? 0;
  const outputTokens = input.outputTokens ?? 0;
  const cachedInputTokens = input.cachedInputTokens ?? 0;
  const toolRequestCount = input.toolRequestCount ?? 0;
  for (const [field, value] of Object.entries({
    inputTokens,
    outputTokens,
    cachedInputTokens,
    toolRequestCount,
  })) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${field} must be a non-negative safe integer.`);
    }
  }
  if (cachedInputTokens > inputTokens) {
    throw new Error("cachedInputTokens cannot exceed inputTokens.");
  }
  if (input.zeroCostRuntime) {
    return costEstimateSchema.parse({
      inputTokens,
      outputTokens,
      cachedInputTokens,
      toolCostUsd: 0,
      modelCostUsd: 0,
      estimatedTotalCostUsd: 0,
      pricingRevision: "zero-cost-runtime-v1",
      pricingSource: "dime-runtime-contract",
      pricingRegistryRevision: null,
      pricingEntry: null,
      unavailabilityReason: null,
      status: "zero_cost_runtime",
    });
  }

  if (!input.provider || !input.model || !input.modelRevision) {
    return costEstimateSchema.parse({
      inputTokens,
      outputTokens,
      cachedInputTokens,
      toolCostUsd: null,
      modelCostUsd: null,
      estimatedTotalCostUsd: null,
      pricingRevision: null,
      pricingSource: null,
      pricingRegistryRevision: null,
      pricingEntry: null,
      unavailabilityReason: "pricing_identity_missing",
      status: "cost_unavailable",
    });
  }
  const loaded = input.pricingRegistry
    ? { status: "loaded" as const, registry: input.pricingRegistry }
    : loadDimePricingRegistry(env);
  if (loaded.status !== "loaded") {
    return costEstimateSchema.parse({
      inputTokens,
      outputTokens,
      cachedInputTokens,
      toolCostUsd: null,
      modelCostUsd: null,
      estimatedTotalCostUsd: null,
      pricingRevision: null,
      pricingSource: null,
      pricingRegistryRevision: null,
      pricingEntry: null,
      unavailabilityReason: loaded.reason,
      status: "cost_unavailable",
    });
  }
  const resolution = resolveDimePricing({
    registry: loaded.registry,
    provider: input.provider,
    model: input.model,
    modelRevision: input.modelRevision,
    requestAt: input.requestAt ?? new Date(),
  });
  if (resolution.status !== "resolved") {
    return costEstimateSchema.parse({
      inputTokens,
      outputTokens,
      cachedInputTokens,
      toolCostUsd: null,
      modelCostUsd: null,
      estimatedTotalCostUsd: null,
      pricingRevision: null,
      pricingSource: null,
      pricingRegistryRevision: loaded.registry.registryRevision,
      pricingEntry: null,
      unavailabilityReason: resolution.reason,
      status: "cost_unavailable",
    });
  }
  const entry = resolution.entry;
  const uncachedInputTokens = Math.max(0, inputTokens - cachedInputTokens);
  const modelCostUsd =
    (uncachedInputTokens * entry.inputUsdPerMillionTokens +
      cachedInputTokens * entry.cachedInputUsdPerMillionTokens +
      outputTokens * entry.outputUsdPerMillionTokens) /
      1_000_000 +
    entry.requestUsd;
  const toolCostUsd = toolRequestCount * entry.toolRequestUsd;
  return costEstimateSchema.parse({
    inputTokens,
    outputTokens,
    cachedInputTokens,
    toolCostUsd,
    modelCostUsd,
    estimatedTotalCostUsd: modelCostUsd + toolCostUsd,
    pricingRevision: entry.pricingRevision,
    pricingSource: entry.source,
    pricingRegistryRevision: resolution.registryRevision,
    pricingEntry: entry,
    unavailabilityReason: null,
    status: "estimated",
  });
}

export function assessDimeTraceCompleteness(
  input: DimeTraceCompletenessInput
): DimeTraceCompletenessAssessment {
  const missingFields = (
    [
      "identity",
      "toolCall",
      "timestamps",
      "providerObservation",
      "ingestionLifecycle",
      "stageLatency",
      "contextMetrics",
      "cost",
    ] as const
  ).filter(field => input[field] === undefined);
  const issues: string[] = [];

  if (input.dynamicEvidenceUsed && input.timestamps) {
    for (const field of [
      "scheduledEventTime",
      "providerObservedAt",
      "sourceUpdatedAt",
      "databaseIngestedAt",
    ] as const) {
      if (input.timestamps[field] === null) {
        issues.push(`dynamic_evidence_timestamp_missing:${field}`);
      }
    }
  }
  if (input.dynamicEvidenceUsed && input.providerObservation) {
    if (input.providerObservation.status !== "available") {
      issues.push(
        `provider_observation_not_available:${input.providerObservation.status}`
      );
    }
  }
  if (input.dynamicEvidenceUsed && input.ingestionLifecycle) {
    if (input.ingestionLifecycle.status !== "available") {
      issues.push(
        `ingestion_lifecycle_not_available:${input.ingestionLifecycle.status}`
      );
    }
  }
  if (input.dynamicEvidenceUsed && input.contextMetrics) {
    if (input.contextMetrics.irrelevantContextRate === null) {
      issues.push("dynamic_context_relevance_not_measured");
    }
    if (input.contextMetrics.suppliedContextUsedRate === null) {
      issues.push("dynamic_context_use_not_measured");
    }
  }
  if (input.dynamicEvidenceUsed && input.stageLatency) {
    for (const field of [
      "entityResolutionMs",
      "retrievalMs",
      "toolMs",
      "contextConstructionMs",
    ] as const) {
      if (input.stageLatency[field] === null) {
        issues.push(`dynamic_stage_latency_missing:${field}`);
      }
    }
  }
  if (
    input.toolCall &&
    input.dynamicEvidenceUsed &&
    input.toolCall.status !== "succeeded"
  ) {
    issues.push("dynamic_evidence_tool_state_not_successful");
  }
  if (input.cost?.status === "cost_unavailable") {
    issues.push(
      `cost_unavailable:${input.cost.unavailabilityReason ?? "unclassified"}`
    );
  }
  if (
    input.cost &&
    input.cost.status !== "zero_cost_runtime" &&
    input.stageLatency
  ) {
    for (const field of [
      "modelTimeToFirstTokenMs",
      "modelCompletionMs",
      "validationMs",
    ] as const) {
      if (input.stageLatency[field] === null) {
        issues.push(`model_stage_latency_missing:${field}`);
      }
    }
  }
  if (input.stageLatency && input.stageLatency.endToEndMs === null) {
    issues.push("end_to_end_latency_missing");
  }

  return {
    complete: missingFields.length === 0 && issues.length === 0,
    missingFields,
    issues,
  };
}
