import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  compileDimeContext,
  DimeContextCompilerError,
  DIME_CONTEXT_ROUTE_POLICIES,
  type DimeContextCompilerInput,
  type DimeContextItem,
} from "./dimeContextCompiler";

const NOW = "2026-07-30T20:00:00.000Z";

function item(
  factId: string,
  overrides: Partial<DimeContextItem> = {}
): DimeContextItem {
  return {
    factId,
    claim: `Grounded claim for ${factId}`,
    sourceId: `source-${factId}`,
    sourceAuthority: "dime-authoritative-fixture",
    sourceObservedAt: NOW,
    retrievedAt: NOW,
    freshnessState: "current",
    required: false,
    contradicts: [],
    tokenCost: 20,
    decisionValue: 0.8,
    factClass: "optional_evidence",
    dynamic: false,
    ...overrides,
  };
}

function input(
  overrides: Partial<DimeContextCompilerInput> = {}
): DimeContextCompilerInput {
  return {
    route: "matchup",
    userIntent: "Analyze the exact matchup.",
    generatedAt: NOW,
    eventIdentity: {
      exactEventId: "event-1",
      candidateEventIds: [],
    },
    temporalFrame: { cutoffAt: null },
    dynamicRetrievalExplicit: true,
    items: [],
    ...overrides,
  };
}

describe("Route-Aware Context Compiler v1", () => {
  it("keeps the executable route policies equal to the governed config", () => {
    const configPath = new URL(
      "../../ml/dime-1.0/configs/route_context_compiler_v1.json",
      import.meta.url
    );
    const config = JSON.parse(readFileSync(configPath, "utf8")) as {
      routePolicies: unknown;
    };

    expect(config.routePolicies).toEqual(DIME_CONTEXT_ROUTE_POLICIES);
  });

  it("packs all required facts before the highest-value optional facts", () => {
    const packet = compileDimeContext(
      input({
        tokenBudget: 80,
        items: [
          item("required", {
            required: true,
            tokenCost: 40,
            factClass: "mandatory_constraint",
          }),
          item("high-value", { tokenCost: 40, decisionValue: 1 }),
          item("low-value", { tokenCost: 40, decisionValue: 0.2 }),
        ],
      })
    );

    expect(packet.items.map(value => value.factId)).toEqual([
      "required",
      "high-value",
    ]);
    expect(packet.omittedOptionalFactIds).toEqual(["low-value"]);
    expect(packet.metrics).toMatchObject({
      criticalFactRecall: 1,
      routePolicyViolations: 0,
      silentContextTruncations: 0,
      outputTokenCost: 80,
    });
    expect(packet.contextText).toContain("omitted_optional_fact_ids=low-value");
  });

  it("fails closed instead of silently truncating a required fact", () => {
    expect(() =>
      compileDimeContext(
        input({
          tokenBudget: 20,
          items: [
            item("required", {
              required: true,
              tokenCost: 21,
              factClass: "mandatory_constraint",
            }),
          ],
        })
      )
    ).toThrow(/required facts cost 21 tokens but budget is 20/);
  });

  it.each(["platform", "account"] as const)(
    "prohibits game retrieval for %s",
    route => {
      expect(() =>
        compileDimeContext(
          input({
            route,
            eventIdentity: { exactEventId: "event-1", candidateEventIds: [] },
            items: [item("event", { factClass: "event_identity" })],
          })
        )
      ).toThrow(new RegExp(`${route}: game retrieval is prohibited`));
    }
  );

  it("permits educational dynamic evidence only when explicitly requested", () => {
    const educational = input({
      route: "educational",
      eventIdentity: { exactEventId: null, candidateEventIds: [] },
      dynamicRetrievalExplicit: false,
      items: [item("dynamic", { dynamic: true })],
    });
    expect(() => compileDimeContext(educational)).toThrow(
      /dynamic retrieval was not explicitly requested/
    );

    expect(
      compileDimeContext({
        ...educational,
        dynamicRetrievalExplicit: true,
      }).items
    ).toHaveLength(1);
  });

  it("enforces the matchup candidate-event maximum", () => {
    expect(() =>
      compileDimeContext(
        input({
          eventIdentity: {
            exactEventId: null,
            candidateEventIds: ["event-1", "event-2", "event-3"],
          },
        })
      )
    ).toThrow(/candidate-event maximum exceeded/);
  });

  it("requires a point-in-time cutoff for historical context", () => {
    expect(() =>
      compileDimeContext(
        input({
          route: "historical",
          temporalFrame: { cutoffAt: null },
        })
      )
    ).toThrow(/point-in-time cutoff is required/);
  });

  it("requires authoritative observation timestamps for live evidence", () => {
    expect(() =>
      compileDimeContext(
        input({
          route: "live_data",
          items: [
            item("live", {
              dynamic: true,
              sourceObservedAt: null,
              factClass: "authoritative_current",
            }),
          ],
        })
      )
    ).toThrow(/authoritative observation timestamp is required/);
  });

  it("requires provider-observation timestamps for all dynamic facts", () => {
    expect(() =>
      compileDimeContext(
        input({
          route: "educational",
          items: [
            item("dynamic", {
              dynamic: true,
              sourceObservedAt: null,
            }),
          ],
        })
      )
    ).toThrow(/dynamic facts require a provider-observation timestamp/);
  });

  it("preserves explicit contradictions and their source identities", () => {
    const packet = compileDimeContext(
      input({
        items: [
          item("source-a", {
            required: true,
            contradicts: ["source-b"],
            factClass: "contradiction",
          }),
          item("source-b", {
            required: true,
            contradicts: ["source-a"],
            factClass: "contradiction",
          }),
        ],
      })
    );

    expect(packet.items).toEqual([
      expect.objectContaining({
        factId: "source-a",
        contradicts: ["source-b"],
      }),
      expect.objectContaining({
        factId: "source-b",
        contradicts: ["source-a"],
      }),
    ]);
  });

  it("makes contradiction groups atomic so packing cannot omit either side", () => {
    expect(() =>
      compileDimeContext(
        input({
          tokenBudget: 20,
          items: [
            item("source-a", {
              required: true,
              tokenCost: 20,
              contradicts: ["source-b"],
              factClass: "contradiction",
            }),
            item("source-b", {
              required: false,
              tokenCost: 20,
              contradicts: ["source-a"],
              factClass: "contradiction",
            }),
          ],
        })
      )
    ).toThrow(
      /source-b: contradiction participants must be required contradiction facts/
    );
  });

  it("rejects excessive duplicate context before packing", () => {
    expect(() =>
      compileDimeContext(
        input({
          items: [
            item("duplicate-a", { claim: "Same grounded claim" }),
            item("duplicate-b", { claim: " same   grounded CLAIM " }),
          ],
        })
      )
    ).toThrow(/duplicate context rate exceeds 0.02/);
  });

  it("never deduplicates away required or contradictory provenance", () => {
    const fillers = Array.from({ length: 100 }, (_, index) =>
      item(`filler-${index}`, { claim: `Unique claim ${index}` })
    );

    expect(() =>
      compileDimeContext(
        input({
          items: [
            ...fillers,
            item("required-duplicate", {
              required: true,
              claim: "Duplicated grounded claim",
            }),
            item("optional-duplicate", {
              claim: "duplicated grounded claim",
            }),
          ],
        })
      )
    ).toThrow(
      /deduplication would discard required or contradictory provenance/
    );
  });

  it("rejects excessive irrelevant context before packing", () => {
    expect(() =>
      compileDimeContext(
        input({
          items: [item("irrelevant", { decisionValue: 0 })],
        })
      )
    ).toThrow(/irrelevant context rate exceeds 0.05/);
  });

  it("rejects contradictions that reference absent facts", () => {
    expect(() =>
      compileDimeContext(
        input({
          items: [item("source-a", { contradicts: ["missing-source"] })],
        })
      )
    ).toThrow(/contradicted fact missing-source is not present/);
  });

  it("rejects route budgets above the approved maximum", () => {
    expect(() =>
      compileDimeContext(input({ route: "live_data", tokenBudget: 1_801 }))
    ).toThrow(/token budget exceeds the approved route budget/);
  });

  it("rejects temporal provenance that is impossible at generation time", () => {
    expect(() =>
      compileDimeContext(
        input({
          items: [
            item("future", {
              retrievedAt: "2026-07-30T20:00:01.000Z",
            }),
          ],
        })
      )
    ).toThrow(/retrieved_at is later than generated_at/);

    expect(() =>
      compileDimeContext(
        input({
          items: [
            item("reversed", {
              sourceObservedAt: "2026-07-30T20:00:01.000Z",
            }),
          ],
        })
      )
    ).toThrow(/source_observed_at is later than retrieved_at/);
  });

  it("uses structural estimates without claiming model-exact token counts", () => {
    const packet = compileDimeContext(
      input({ items: [item("required", { required: true })] })
    );

    expect(packet.tokenMeasurementStatus).toBe(
      "STRUCTURAL_ESTIMATE_NOT_MODEL_EXACT"
    );
  });

  it("exposes bounded, actionable validation issues", () => {
    try {
      compileDimeContext(input({ generatedAt: "not-a-time" }));
      throw new Error("expected compilation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(DimeContextCompilerError);
      expect((error as DimeContextCompilerError).issues).toEqual([
        "generated_at is not canonical UTC",
      ]);
    }
  });
});
