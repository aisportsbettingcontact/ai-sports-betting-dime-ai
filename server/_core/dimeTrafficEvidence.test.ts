import { describe, expect, it } from "vitest";
import {
  DIME_SANITIZED_TRAFFIC_RECORD_VERSION,
  aggregateDimeSanitizedTraffic,
  validateDimeSanitizedTrafficRecord,
} from "./dimeTrafficEvidence";

function record(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: DIME_SANITIZED_TRAFFIC_RECORD_VERSION,
    requestIdSha256: "a".repeat(64),
    occurredAt: "2026-07-29T20:00:00Z",
    route: "matchup",
    sport: "baseball",
    league: "mlb",
    messageLengthBucket: "50-199",
    multiTurnBucket: "2-3",
    toolRequired: true,
    temporalClass: "current",
    entityResolution: "exact",
    missingInformation: false,
    accessClass: "subscriber",
    platformSupport: true,
    routingConfidence: 0.95,
    toolCallCount: 1,
    toolSucceeded: true,
    staleEvidence: false,
    inputTokens: 800,
    outputTokens: 200,
    contextRecords: 3,
    contextTokens: 500,
    timeToFirstTokenMs: 250,
    endToEndMs: 900,
    estimatedCostUsd: null,
    completenessPassed: false,
    ...overrides,
  };
}

describe("Dime privacy-safe traffic evidence", () => {
  it("rejects prompt and response text at the collection boundary", () => {
    expect(() =>
      validateDimeSanitizedTrafficRecord({
        ...record(),
        rawPrompt: "Who should I bet on?",
      })
    ).toThrow();
    expect(() =>
      validateDimeSanitizedTrafficRecord({
        ...record(),
        servedResponse: "Bet this team.",
      })
    ).toThrow();
  });

  it("reports missing observations instead of dropping them", () => {
    const report = aggregateDimeSanitizedTraffic([
      record(),
      record({
        requestIdSha256: "b".repeat(64),
        timeToFirstTokenMs: null,
        estimatedCostUsd: 0.01,
      }),
    ]);
    expect(report.perRoute.matchup.timeToFirstTokenMs).toMatchObject({
      p50: 250,
      sampleCount: 1,
      missingCount: 1,
    });
    expect(report.perRoute.matchup.estimatedCostUsd).toMatchObject({
      p50: 0.01,
      sampleCount: 1,
      missingCount: 1,
    });
  });

  it("keeps every product route visible even with zero samples", () => {
    const report = aggregateDimeSanitizedTraffic([record()]);
    expect(Object.keys(report.perRoute)).toHaveLength(9);
    expect(report.perRoute.platform).toMatchObject({
      sampleCount: 0,
      endToEndMs: {
        p50: null,
        p90: null,
        p95: null,
        p99: null,
        maximum: null,
        sampleCount: 0,
        missingCount: 0,
      },
    });
  });

  it("stratifies subscriber, temporal, ambiguity, and tool dimensions", () => {
    const report = aggregateDimeSanitizedTraffic([
      record(),
      record({
        requestIdSha256: "c".repeat(64),
        accessClass: "public",
        temporalClass: "historical",
        entityResolution: "ambiguous",
      }),
    ]);
    expect(report.dimensions.accessClass).toEqual({
      public: 1,
      subscriber: 1,
    });
    expect(report.dimensions.temporalClass).toMatchObject({
      current: 1,
      historical: 1,
    });
    expect(report.perRoute.matchup.ambiguity).toMatchObject({
      rate: 0.5,
      sampleCount: 2,
      missingCount: 0,
    });
  });
});
