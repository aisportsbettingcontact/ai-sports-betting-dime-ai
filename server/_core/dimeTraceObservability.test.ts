import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DIME_TRACE_SCHEMA_REVISION,
  assessDimeTraceCompleteness,
  dimeContextToolTrace,
  dimeNoToolRequiredTrace,
  estimateDimeTraceCost,
  getDimeTraceObservabilityReadiness,
  parseDimeTraceIdentity,
  parsePersistedDimeTraceIdentity,
  requireDimeTraceIdentity,
  resolveDimeTraceIdentity,
  summarizeDimeRouteObservations,
  validateDimeEvidenceTimestamps,
  validateDimeTraceMetadataSafety,
  validateDimeToolArguments,
  validateDimeToolCallTrace,
} from "./dimeTraceObservability";
import {
  DIME_PRICING_REGISTRY_VERSION,
  checksumDimePricingEntry,
  type DimePricingEntry,
} from "./dimePricingGovernance";

const IDENTITY_INPUT = {
  requestId: randomUUID(),
  modelProvider: "frozen",
  baseModel: "no-provider",
  promptRevision: "1.0.0",
  route: "platform" as const,
  routePolicyRevision: "a".repeat(64),
  controlPlaneRevision: "dime-composite-llm-engineering-control-v1",
};

function pricingRegistry() {
  const entryInput = {
    provider: "example-provider",
    model: "dime-test-model",
    modelRevision: "2026-07-29",
    pricingRevision: "provider-price-2026-07-29",
    effectiveFrom: "2026-07-29T00:00:00Z",
    effectiveTo: null,
    inputUsdPerMillionTokens: 2,
    cachedInputUsdPerMillionTokens: 0.5,
    outputUsdPerMillionTokens: 4,
    requestUsd: 0,
    toolRequestUsd: 0,
    currency: "USD" as const,
    source: "https://provider.example/pricing",
    sourceDocumentSha256: "a".repeat(64),
    reviewStatus: "approved" as const,
    reviewer: "pricing-reviewer@example.com",
    reviewedAt: "2026-07-29T01:00:00Z",
    reviewEvidenceSha256: "b".repeat(64),
  };
  const entry: DimePricingEntry = {
    ...entryInput,
    entryChecksumSha256: checksumDimePricingEntry(entryInput),
  };
  return {
    schemaVersion: DIME_PRICING_REGISTRY_VERSION,
    registryRevision: "pricing-registry-2026-07-29",
    status: "approved" as const,
    entries: [entry],
  };
}

describe("Dime Phase 1 trace identity", () => {
  it("fails completeness when deployment identity is missing", () => {
    expect(resolveDimeTraceIdentity({ ...IDENTITY_INPUT, env: {} })).toEqual({
      complete: false,
      missingFields: ["gitCommit", "environment"],
      invalidFields: [],
    });
  });

  it("records every required revision without unknown placeholders", () => {
    const identity = requireDimeTraceIdentity({
      ...IDENTITY_INPUT,
      env: {
        GIT_COMMIT_SHA: "47e338fb",
        NODE_ENV: "test",
      },
    });
    expect(identity).toMatchObject({
      gitCommit: "47e338fb",
      environment: "test",
      adapterRevision: null,
      traceSchemaRevision: DIME_TRACE_SCHEMA_REVISION,
    });
    expect(JSON.stringify(identity)).not.toContain("unknown");
  });

  it("rejects a missing model identity while retaining the package application version", () => {
    const result = resolveDimeTraceIdentity({
      ...IDENTITY_INPUT,
      baseModel: "",
      env: {
        DIME_APPLICATION_VERSION: "",
        GIT_COMMIT_SHA: "47e338fb",
        NODE_ENV: "test",
      },
    });
    expect(result).toEqual({
      complete: false,
      missingFields: ["baseModel", "modelRevision"],
      invalidFields: [],
    });
  });

  it("accepts a strict historical identity only through the persisted parser", () => {
    const current = requireDimeTraceIdentity({
      ...IDENTITY_INPUT,
      env: {
        GIT_COMMIT_SHA: "47e338fb",
        NODE_ENV: "test",
      },
    });
    const historical = {
      ...current,
      observabilityRevision: "dime-trace-observability-v0",
      traceSchemaRevision: "trace-v1-phase0-2026-07-28",
    };

    expect(parseDimeTraceIdentity(historical)).toBeNull();
    expect(parsePersistedDimeTraceIdentity(historical)).toEqual(historical);
    expect(
      parsePersistedDimeTraceIdentity({
        ...historical,
        unexpectedField: "rejected",
      })
    ).toBeNull();
  });
});

describe("Dime Phase 1 explicit tool execution", () => {
  it("distinguishes no-tool-required from selected-but-not-invoked", () => {
    expect(dimeNoToolRequiredTrace().status).toBe("not_required");
    const selected = dimeContextToolTrace({
      status: "selected_not_invoked",
      normalizedArguments: { league: "MLB", date: "2026-07-29" },
      startedAt: new Date("2026-07-29T12:00:00Z"),
    });
    expect(selected).toMatchObject({
      status: "selected_not_invoked",
      toolName: "read_game_context",
      invocationId: null,
    });
  });

  it.each([
    ["empty", false],
    ["failed", false],
    ["timed_out", true],
    ["stale", false],
    ["malformed", false],
    ["rejected", false],
  ] as const)("preserves the %s state", (status, timeout) => {
    const trace = dimeContextToolTrace({
      status,
      normalizedArguments: { league: "MLB" },
      startedAt: new Date("2026-07-29T12:00:00Z"),
      completedAt: new Date("2026-07-29T12:00:01Z"),
    });
    expect(trace.status).toBe(status);
    expect(trace.timeout).toBe(timeout);
  });

  it("requires successful tool output to pass validation", () => {
    expect(() =>
      validateDimeToolCallTrace({
        ...dimeContextToolTrace({
          status: "failed",
          normalizedArguments: {},
          startedAt: new Date("2026-07-29T12:00:00Z"),
        }),
        status: "succeeded",
        validationResult: "failed",
      })
    ).toThrow("explicit-state contract");
  });

  it.each([
    { authorization: "Bearer highly-sensitive-value" },
    { apiKey: "abc" },
    { nested: { sessionToken: "abc" } },
    { database: "mysql://user:password@host/db" },
  ])("rejects sensitive arguments: $s", value => {
    expect(() => validateDimeToolArguments(value)).toThrow(/Sensitive/);
  });

  it("rejects adversarial trace metadata without confusing token counts for credentials", () => {
    expect(
      validateDimeTraceMetadataSafety({
        inputTokens: 12,
        outputTokens: 7,
        errorClass: 'Error"}\n{"forged":true',
      })
    ).toMatchObject({ inputTokens: 12 });
    expect(() =>
      validateDimeTraceMetadataSafety({
        nested: { accessToken: "do-not-record" },
      })
    ).toThrow(/Sensitive trace metadata key/);
    expect(() =>
      validateDimeTraceMetadataSafety({
        detail: "Bearer do-not-record",
      })
    ).toThrow(/Sensitive trace metadata value/);
  });
});

describe("Dime Phase 1 timestamp, cost, and completeness contracts", () => {
  it("keeps all authoritative timestamps semantically separate", () => {
    expect(
      validateDimeEvidenceTimestamps({
        scheduledEventTime: "2026-07-29T23:10:00Z",
        providerObservedAt: "2026-07-29T20:00:00Z",
        sourceUpdatedAt: "2026-07-29T19:59:00Z",
        databaseIngestedAt: "2026-07-29T20:00:05Z",
        retrievedAt: "2026-07-29T20:00:10Z",
        responseGeneratedAt: "2026-07-29T20:00:12Z",
      })
    ).toMatchObject({
      providerObservedAt: "2026-07-29T20:00:00Z",
      databaseIngestedAt: "2026-07-29T20:00:05Z",
    });
  });

  it("rejects conflicting provider and source timestamps", () => {
    expect(() =>
      validateDimeEvidenceTimestamps({
        scheduledEventTime: "2026-07-29T23:10:00Z",
        providerObservedAt: "2026-07-29T20:00:00Z",
        sourceUpdatedAt: "2026-07-29T20:01:00Z",
        databaseIngestedAt: "2026-07-29T20:00:05Z",
        retrievedAt: "2026-07-29T20:00:10Z",
        responseGeneratedAt: "2026-07-29T20:00:12Z",
      })
    ).toThrow();
  });

  it("will not invent dollar cost without versioned pricing", () => {
    expect(
      estimateDimeTraceCost({
        inputTokens: 1_000,
        outputTokens: 250,
        env: {},
      })
    ).toMatchObject({
      status: "cost_unavailable",
      modelCostUsd: null,
      pricingRevision: null,
      unavailabilityReason: "pricing_identity_missing",
    });
  });

  it("exposes only secret-safe readiness and never claims the independent gate passed", () => {
    const readiness = getDimeTraceObservabilityReadiness({
      GIT_COMMIT_SHA: "47e338fb",
      NODE_ENV: "test",
      DIME_MODEL_API_SECRET: "must-not-appear",
    });
    expect(readiness.pricing).toMatchObject({
      complete: false,
      registryConfigured: false,
      registryLoaded: false,
      registryReviewed: false,
      registryApproved: false,
      entryCount: 0,
      attestation: {
        pathConfigured: false,
        registryStatus: "not_configured",
        activeProvider: "anthropic",
        activeModel: "claude-fable-5",
        activeModelRevision: "claude-fable-5",
        deploymentTier: "production",
        zeroCostRuntime: false,
        exactMatchAvailable: false,
      },
    });
    expect(readiness.readyForIndependentGate).toBe(false);
    expect(readiness.security).toEqual({
      exposesRawTraces: false,
      acceptsTraceIdentifiers: false,
      exposesCredentials: false,
    });
    expect(JSON.stringify(readiness)).not.toContain("must-not-appear");
  });

  it("calculates cached and uncached inference from a versioned source", () => {
    const estimate = estimateDimeTraceCost({
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cachedInputTokens: 250_000,
      provider: "example-provider",
      model: "dime-test-model",
      modelRevision: "2026-07-29",
      requestAt: new Date("2026-07-29T12:00:00Z"),
      pricingRegistry: pricingRegistry(),
    });
    expect(estimate).toMatchObject({
      status: "estimated",
      modelCostUsd: 5.625,
      estimatedTotalCostUsd: 5.625,
    });
  });

  it("rejects impossible cached-token accounting", () => {
    expect(() =>
      estimateDimeTraceCost({
        inputTokens: 10,
        cachedInputTokens: 11,
        zeroCostRuntime: true,
      })
    ).toThrow("cannot exceed");
  });

  it("does not infer cached-token pricing from the input-token rate", () => {
    const registry = pricingRegistry();
    const entryInput = {
      ...registry.entries[0],
      cachedInputUsdPerMillionTokens: null,
    };
    const { entryChecksumSha256: _discardedChecksum, ...checksumInput } =
      entryInput;
    registry.entries[0] = {
      ...entryInput,
      entryChecksumSha256: checksumDimePricingEntry(checksumInput),
    };
    expect(
      estimateDimeTraceCost({
        inputTokens: 1_000,
        outputTokens: 100,
        cachedInputTokens: 500,
        provider: "example-provider",
        model: "dime-test-model",
        modelRevision: "2026-07-29",
        requestAt: new Date("2026-07-29T12:00:00Z"),
        pricingRegistry: registry,
      })
    ).toMatchObject({
      status: "cost_unavailable",
      modelCostUsd: null,
      unavailabilityReason: "cached_input_pricing_unavailable",
    });
  });

  it("fails dynamic-evidence completeness when provenance timestamps are absent", () => {
    const assessment = assessDimeTraceCompleteness({
      dynamicEvidenceUsed: true,
      timestamps: {
        scheduledEventTime: null,
        providerObservedAt: null,
        sourceUpdatedAt: null,
        databaseIngestedAt: null,
        retrievedAt: "2026-07-29T20:00:10Z",
        responseGeneratedAt: "2026-07-29T20:00:12Z",
      },
    });
    expect(assessment.complete).toBe(false);
    expect(assessment.issues).toContain(
      "dynamic_evidence_timestamp_missing:providerObservedAt"
    );
    expect(assessment.issues).toContain(
      "dynamic_evidence_timestamp_missing:databaseIngestedAt"
    );
  });

  it("produces p50/p90/p95/p99 route distributions without hiding empty routes", () => {
    const stageLatency = {
      classificationMs: 1,
      entityResolutionMs: 2,
      retrievalMs: 3,
      toolMs: 3,
      contextConstructionMs: 1,
      modelTimeToFirstTokenMs: 20,
      modelCompletionMs: 50,
      validationMs: 2,
      endToEndMs: 60,
    };
    const contextMetrics = {
      inputTokens: 100,
      retrievedRecords: 1,
      retrievedEvents: 1,
      duplicateContextRate: 0,
      irrelevantContextRate: null,
      contextFreshness: "delayed" as const,
      contextConstructionMs: 1,
      suppliedContextUsedRate: null,
      contextBytes: 500,
      truncationOccurred: false,
    };
    const cost = estimateDimeTraceCost({ zeroCostRuntime: true });
    const summary = summarizeDimeRouteObservations([
      {
        route: "matchup",
        failed: false,
        stageLatency,
        contextMetrics,
        cost,
        toolStatus: "stale",
      },
      {
        route: "matchup",
        failed: true,
        stageLatency: { ...stageLatency, endToEndMs: 120 },
        contextMetrics,
        cost,
        toolStatus: "failed",
      },
    ]);
    expect(summary.matchup).toMatchObject({
      sampleCount: 2,
      failureRate: 0.5,
      latencyMs: {
        endToEnd: {
          p50: 60,
          p90: 120,
          p95: 120,
          p99: 120,
          maximum: 120,
          sampleCount: 2,
        },
      },
      toolStates: { stale: 1, failed: 1 },
    });
    expect(summary.platform).toMatchObject({
      sampleCount: 0,
      failureRate: null,
      latencyMs: { endToEnd: { sampleCount: 0, p95: null } },
    });
  });
});
