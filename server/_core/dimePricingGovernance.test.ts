import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
const tempDirectories: string[] = [];

function approvedEntry(
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
    reviewStatus: "approved" as const,
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

function writeRegistry(registry: unknown): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dime-pricing-"));
  tempDirectories.push(directory);
  const registryPath = path.join(directory, "registry.json");
  fs.writeFileSync(registryPath, JSON.stringify(registry), "utf8");
  return registryPath;
}

describe("Dime governed pricing registry", () => {
  afterEach(() => {
    for (const directory of tempDirectories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

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
        status: "approved",
        entries: [approvedEntry()],
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

  it.each([
    ["different-model", "2026-07-29"],
    ["dime-test-model", "different-revision"],
  ])("never falls back to model %s revision %s", (model, modelRevision) => {
    const result = resolveDimePricing({
      registry: {
        schemaVersion: DIME_PRICING_REGISTRY_VERSION,
        registryRevision: "pricing-registry-2026-07-29",
        status: "approved",
        entries: [approvedEntry()],
      },
      provider: "example-provider",
      model,
      modelRevision,
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
        status: "approved",
        entries: [
          approvedEntry(),
          approvedEntry({ pricingRevision: "second-review" }),
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
    const entry = approvedEntry();
    const result = resolveDimePricing({
      registry: {
        schemaVersion: DIME_PRICING_REGISTRY_VERSION,
        registryRevision: "pricing-registry-2026-07-29",
        status: "approved",
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

  it("fails closed when the path or registry file is missing", () => {
    expect(loadDimePricingRegistry({})).toEqual({
      status: "cost_unavailable",
      reason: "registry_not_configured",
    });
    expect(
      loadDimePricingRegistry({
        DIME_PRICING_REGISTRY_PATH: path.join(
          os.tmpdir(),
          "dime-pricing-missing.json"
        ),
      })
    ).toEqual({
      status: "cost_unavailable",
      reason: "registry_invalid",
    });
  });

  it("fails closed when the configured registry checksum mismatches", () => {
    const registryPath = writeRegistry({
      schemaVersion: DIME_PRICING_REGISTRY_VERSION,
      registryRevision: "pricing-registry-2026-07-29",
      status: "approved",
      entries: [approvedEntry()],
    });
    expect(
      loadDimePricingRegistry({
        DIME_PRICING_REGISTRY_PATH: registryPath,
        DIME_PRICING_REGISTRY_SHA256: "f".repeat(64),
      })
    ).toEqual({
      status: "cost_unavailable",
      reason: "registry_checksum_mismatch",
    });
  });

  it("requires both registry and entry approval", () => {
    const entry = approvedEntry({
      reviewStatus: "independently_reviewed",
    });
    expect(
      resolveDimePricing({
        registry: {
          schemaVersion: DIME_PRICING_REGISTRY_VERSION,
          registryRevision: "pricing-registry-2026-07-29",
          status: "approved",
          entries: [entry],
        },
        provider: entry.provider,
        model: entry.model,
        modelRevision: entry.modelRevision,
        requestAt: new Date("2026-07-29T12:00:00Z"),
      })
    ).toEqual({
      status: "cost_unavailable",
      reason: "pricing_entry_not_approved",
    });
    expect(
      resolveDimePricing({
        registry: {
          schemaVersion: DIME_PRICING_REGISTRY_VERSION,
          registryRevision: "pricing-registry-2026-07-29",
          status: "independently_reviewed",
          entries: [approvedEntry()],
        },
        provider: "example-provider",
        model: "dime-test-model",
        modelRevision: "2026-07-29",
        requestAt: new Date("2026-07-29T12:00:00Z"),
      })
    ).toEqual({
      status: "cost_unavailable",
      reason: "registry_not_approved",
    });
  });

  it("does not resolve an expired entry", () => {
    const entry = approvedEntry({
      effectiveTo: "2026-07-29T06:00:00Z",
    });
    expect(
      resolveDimePricing({
        registry: {
          schemaVersion: DIME_PRICING_REGISTRY_VERSION,
          registryRevision: "pricing-registry-2026-07-29",
          status: "approved",
          entries: [entry],
        },
        provider: entry.provider,
        model: entry.model,
        modelRevision: entry.modelRevision,
        requestAt: new Date("2026-07-29T12:00:00Z"),
      })
    ).toEqual({
      status: "cost_unavailable",
      reason: "pricing_entry_not_found",
    });
  });
});
