import { describe, expect, it } from "vitest";
import {
  completeDimeIngestionLifecycleForResponse,
  dimeIngestionLifecycleNotApplicable,
  dimeProviderObservationNotApplicable,
  evaluateDimeIngestionLifecycle,
  resolveDimeProviderObservation,
} from "./dimeEvidenceProvenance";

const PROVIDER_OBSERVATION = {
  observedAt: "2026-07-29T20:00:00Z",
  timestampSource: "provider-payload.updated-at",
  providerName: "example-sportsbook",
  providerRevision: "odds-api-v4",
  confidence: 1,
  fallbackUsed: false,
};

describe("Dime provider observation provenance", () => {
  it("derives freshness only from an authoritative source timestamp", () => {
    const result = resolveDimeProviderObservation({
      requestAt: new Date("2026-07-29T20:03:00Z"),
      observations: [PROVIDER_OBSERVATION],
      currentThresholdMs: 60_000,
      delayedThresholdMs: 10 * 60_000,
    });
    expect(result).toMatchObject({
      status: "available",
      selectedObservedAt: PROVIDER_OBSERVATION.observedAt,
      freshnessAtRequest: "delayed",
    });
  });

  it("retains conflicting observations and refuses to pick one", () => {
    const result = resolveDimeProviderObservation({
      requestAt: new Date("2026-07-29T20:03:00Z"),
      observations: [
        PROVIDER_OBSERVATION,
        {
          ...PROVIDER_OBSERVATION,
          observedAt: "2026-07-29T20:01:00Z",
          providerName: "second-sportsbook",
        },
      ],
      currentThresholdMs: 60_000,
      delayedThresholdMs: 10 * 60_000,
    });
    expect(result.status).toBe("conflicting");
    expect(result.observations).toHaveLength(2);
    expect(result.selectedObservedAt).toBeNull();
  });

  it("rejects a provider observation from the future", () => {
    const result = resolveDimeProviderObservation({
      requestAt: new Date("2026-07-29T19:59:00Z"),
      observations: [PROVIDER_OBSERVATION],
      currentThresholdMs: 60_000,
      delayedThresholdMs: 10 * 60_000,
      futureToleranceMs: 0,
    });
    expect(result).toMatchObject({
      status: "rejected",
      freshnessAtRequest: "rejected",
      selectedObservedAt: null,
    });
  });

  it("represents no dynamic evidence without inventing provenance", () => {
    expect(dimeProviderObservationNotApplicable()).toMatchObject({
      status: "not_applicable",
      observations: [],
    });
  });
});

describe("Dime ingestion lifecycle provenance", () => {
  const LIFECYCLE = {
    sourceObservedAt: "2026-07-29T20:00:00Z",
    receivedAt: "2026-07-29T20:00:01Z",
    normalizedAt: "2026-07-29T20:00:02Z",
    persistedAt: "2026-07-29T20:00:03Z",
    retrievedAt: "2026-07-29T20:00:04Z",
    responseGeneratedAt: "2026-07-29T20:00:05Z",
    pipelineRevision: "odds-normalizer-v3",
    ingestionRunId: "ingestion-20260729-200000",
  };

  it("accepts a complete monotonic lifecycle", () => {
    expect(evaluateDimeIngestionLifecycle(LIFECYCLE)).toMatchObject({
      status: "available",
      issues: [],
    });
  });

  it("re-evaluates a persisted lifecycle when response time becomes known", () => {
    const pending = evaluateDimeIngestionLifecycle({
      ...LIFECYCLE,
      responseGeneratedAt: null,
    });
    expect(pending).toMatchObject({
      status: "unavailable",
      sourceObservedAt: LIFECYCLE.sourceObservedAt,
      persistedAt: LIFECYCLE.persistedAt,
      responseGeneratedAt: null,
    });

    expect(
      completeDimeIngestionLifecycleForResponse({
        lifecycle: pending,
        responseGeneratedAt: LIFECYCLE.responseGeneratedAt,
      })
    ).toMatchObject({
      status: "available",
      responseGeneratedAt: LIFECYCLE.responseGeneratedAt,
      issues: [],
    });
  });

  it("classifies declared clock skew without hiding the ordering defect", () => {
    const result = evaluateDimeIngestionLifecycle({
      ...LIFECYCLE,
      receivedAt: "2026-07-29T19:59:59Z",
      clockSkewClassification: "source_clock_ahead",
    });
    expect(result.status).toBe("clock_skew");
    expect(result.issues).toContain(
      "timestamp_order_violation:sourceObservedAt"
    );
  });

  it("rejects an unexplained ordering violation", () => {
    expect(
      evaluateDimeIngestionLifecycle({
        ...LIFECYCLE,
        normalizedAt: "2026-07-29T19:59:59Z",
      })
    ).toMatchObject({
      status: "rejected",
      clockSkewClassification: null,
    });
  });

  it("represents non-dynamic requests as not applicable", () => {
    expect(dimeIngestionLifecycleNotApplicable().status).toBe("not_applicable");
  });
});
