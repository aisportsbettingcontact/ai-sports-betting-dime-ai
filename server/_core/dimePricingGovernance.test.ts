import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DIME_PRICING_REGISTRY_VERSION,
  checksumDimePricingEntry,
  loadDimePricingRegistry,
  resolveDimePricing,
  type DimePricingEntry,
} from "./dimePricingGovernance";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const productionRegistryPath =
  "ml/dime-1.0/configs/dime_observability_pricing_v1.json";

function reviewedEntry(
  overrides: Partial<DimePricingEntry> = {}
): DimePricingEntry {
  const entry = {
    provider: "example-provider",
    model: "dime-test-model",
    modelRevision: "2026-07-29",
    pricingRevision: "provider-price-2026-07-29",
    effectiveFrom: "2026-07-29T00:00:00Z",
    effectiveTo: null,
    inputUsdPerMillionTokens: 2,
    cachedInputUsdPerMillionTokens: 0.5,
    outputUsdPerMillionTokens: 4,
    requestUsd: 0.01,
    toolRequestUsd: 0.02,
    currency: "USD" as const,
    source: "https://provider.example/pricing",
    sourceDocumentSha256: "a".repeat(64),
    reviewer: "pricing-reviewer@example.com",
    reviewedAt: "2026-07-29T01:00:00Z",
    reviewEvidenceSha256: "b".repeat(64),
    ...overrides,
  };
  return {
    ...entry,
    entryChecksumSha256: checksumDimePricingEntry(entry),
  };
}

describe("Dime governed pricing registry", () => {
  it("ships the bounded fail-closed registry in the Railway image context", () => {
    const loaded = loadDimePricingRegistry({
      DIME_PRICING_REGISTRY_PATH: path.join(
        repositoryRoot,
        productionRegistryPath
      ),
    });
    expect(loaded).toMatchObject({
      status: "loaded",
      registry: {
        status: "review_required",
        entries: [],
      },
    });

    const dockerIgnore = fs.readFileSync(
      path.join(repositoryRoot, ".dockerignore"),
      "utf8"
    );
    expect(dockerIgnore).toContain("ml/dime-1.0/*");
    expect(dockerIgnore).toContain("!ml/dime-1.0/configs");
    expect(dockerIgnore).toContain(`!${productionRegistryPath}`);
  });

  it("selects one reviewed, effective, exact model revision", () => {
    const result = resolveDimePricing({
      registry: {
        schemaVersion: DIME_PRICING_REGISTRY_VERSION,
        registryRevision: "pricing-registry-2026-07-29",
        status: "reviewed",
        entries: [reviewedEntry()],
      },
      provider: "example-provider",
      model: "dime-test-model",
      modelRevision: "2026-07-29",
      requestAt: new Date("2026-07-29T12:00:00Z"),
    });
    expect(result).toMatchObject({
      status: "resolved",
      registryRevision: "pricing-registry-2026-07-29",
    });
  });

  it("never falls back to another model or revision", () => {
    const result = resolveDimePricing({
      registry: {
        schemaVersion: DIME_PRICING_REGISTRY_VERSION,
        registryRevision: "pricing-registry-2026-07-29",
        status: "reviewed",
        entries: [reviewedEntry()],
      },
      provider: "example-provider",
      model: "dime-test-model",
      modelRevision: "different-revision",
      requestAt: new Date("2026-07-29T12:00:00Z"),
    });
    expect(result).toEqual({
      status: "cost_unavailable",
      reason: "pricing_entry_not_found",
    });
  });

  it("rejects overlapping effective entries as ambiguous", () => {
    const result = resolveDimePricing({
      registry: {
        schemaVersion: DIME_PRICING_REGISTRY_VERSION,
        registryRevision: "pricing-registry-2026-07-29",
        status: "reviewed",
        entries: [
          reviewedEntry(),
          reviewedEntry({ pricingRevision: "second-review" }),
        ],
      },
      provider: "example-provider",
      model: "dime-test-model",
      modelRevision: "2026-07-29",
      requestAt: new Date("2026-07-29T12:00:00Z"),
    });
    expect(result).toEqual({
      status: "cost_unavailable",
      reason: "pricing_entry_ambiguous",
    });
  });

  it("rejects a modified entry whose review checksum no longer matches", () => {
    const entry = reviewedEntry();
    const result = resolveDimePricing({
      registry: {
        schemaVersion: DIME_PRICING_REGISTRY_VERSION,
        registryRevision: "pricing-registry-2026-07-29",
        status: "reviewed",
        entries: [{ ...entry, outputUsdPerMillionTokens: 100 }],
      },
      provider: "example-provider",
      model: "dime-test-model",
      modelRevision: "2026-07-29",
      requestAt: new Date("2026-07-29T12:00:00Z"),
    });
    expect(result).toEqual({
      status: "cost_unavailable",
      reason: "pricing_entry_checksum_invalid",
    });
  });
});
