import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DIME_PRICING_ATTESTATION_VERSION,
  formatDimePricingAttestationLog,
  getDimePricingAttestation,
  resolveDimeRuntimePricingIdentity,
  type DimeRuntimePricingIdentity,
} from "./dimePricingAttestation";
import {
  DIME_PRICING_REGISTRY_VERSION,
  checksumDimePricingEntry,
  type DimePricingEntry,
  type DimePricingRegistry,
} from "./dimePricingGovernance";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const routerSource = fs.readFileSync(
  path.join(import.meta.dirname, "..", "routers", "dimeRuntime.ts"),
  "utf8"
);
const startupSource = fs.readFileSync(
  path.join(import.meta.dirname, "index.ts"),
  "utf8"
);
const tempDirectories: string[] = [];

function approvedRegistry(): DimePricingRegistry {
  const entryInput = {
    provider: "example-provider",
    model: "dime-test-model",
    modelRevision: "model-revision-1",
    pricingRevision: "provider-price-2026-07-29",
    effectiveFrom: "2026-07-29T00:00:00Z",
    effectiveTo: null,
    inputUsdPerMillionTokens: 2,
    cachedInputUsdPerMillionTokens: null,
    outputUsdPerMillionTokens: 4,
    requestUsd: 0,
    toolRequestUsd: 0,
    currency: "USD" as const,
    source: "https://provider.example/pricing",
    sourceDocumentSha256: "a".repeat(64),
    reviewStatus: "approved" as const,
    reviewer: "independent-pricing-reviewer",
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
    status: "approved",
    entries: [entry],
  };
}

function writeRegistry(registry: DimePricingRegistry): {
  path: string;
  checksum: string;
} {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "dime-pricing-attestation-")
  );
  tempDirectories.push(directory);
  const registryPath = path.join(directory, "registry.json");
  const contents = JSON.stringify(registry);
  fs.writeFileSync(registryPath, contents, "utf8");
  return {
    path: registryPath,
    checksum: createHash("sha256").update(contents, "utf8").digest("hex"),
  };
}

describe("Dime pricing attestation", () => {
  afterEach(() => {
    for (const directory of tempDirectories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reports the exact frozen runtime as disabled and zero-cost", () => {
    expect(resolveDimeRuntimePricingIdentity({})).toEqual({
      provider: "frozen",
      model: "no-provider",
      modelRevision: "no-provider",
      deploymentTier: "disabled",
      currency: "USD",
      zeroCostRuntime: true,
    });
    expect(getDimePricingAttestation({ env: {} })).toMatchObject({
      version: DIME_PRICING_ATTESTATION_VERSION,
      pathConfigured: false,
      registryStatus: "not_configured",
      activeProvider: "frozen",
      activeModel: "no-provider",
      activeModelRevision: "no-provider",
      deploymentTier: "disabled",
      zeroCostRuntime: true,
      exactMatchAvailable: false,
    });
  });

  it("attests the packaged review-required registry checksum without approving it", () => {
    const registryPath = path.join(
      repositoryRoot,
      "ml/dime-1.0/configs/dime_observability_pricing_v1.json"
    );
    const expectedChecksum = createHash("sha256")
      .update(fs.readFileSync(registryPath, "utf8"), "utf8")
      .digest("hex");
    expect(
      getDimePricingAttestation({
        env: { DIME_PRICING_REGISTRY_PATH: registryPath },
      })
    ).toMatchObject({
      pathConfigured: true,
      expectedChecksumConfigured: false,
      registryChecksum: expectedChecksum,
      registryStatus: "review_required",
      approvedEntryCount: 0,
      exactMatchAvailable: false,
    });
  });

  it("reports an exact approved runtime match only for the pinned tuple", () => {
    const registry = approvedRegistry();
    const written = writeRegistry(registry);
    const identity: DimeRuntimePricingIdentity = {
      provider: registry.entries[0]!.provider,
      model: registry.entries[0]!.model,
      modelRevision: registry.entries[0]!.modelRevision,
      deploymentTier: "production",
      currency: "USD",
      zeroCostRuntime: false,
    };
    expect(
      getDimePricingAttestation({
        env: {
          DIME_PRICING_REGISTRY_PATH: written.path,
          DIME_PRICING_REGISTRY_SHA256: written.checksum,
        },
        identity,
        now: new Date("2026-07-29T12:00:00Z"),
      })
    ).toMatchObject({
      pathConfigured: true,
      expectedChecksumConfigured: true,
      registryChecksum: written.checksum,
      registryStatus: "approved",
      approvedEntryCount: 1,
      activeProvider: identity.provider,
      activeModel: identity.model,
      activeModelRevision: identity.modelRevision,
      exactMatchAvailable: true,
    });
  });

  it("fails attestation closed when the runtime checksum pin mismatches", () => {
    const written = writeRegistry(approvedRegistry());
    expect(
      getDimePricingAttestation({
        env: {
          DIME_PRICING_REGISTRY_PATH: written.path,
          DIME_PRICING_REGISTRY_SHA256: "f".repeat(64),
        },
      })
    ).toMatchObject({
      pathConfigured: true,
      expectedChecksumConfigured: true,
      registryChecksum: null,
      registryStatus: "checksum_mismatch",
      exactMatchAvailable: false,
    });
  });

  it("is exposed only through bounded startup and owner-only surfaces", () => {
    expect(startupSource).toContain(
      "formatDimePricingAttestationLog(getDimePricingAttestation())"
    );
    expect(routerSource).toMatch(
      /observability:\s*ownerProcedure\.query\(\(\) =>\s*getDimeTraceObservabilityReadiness\(\)\s*\)/
    );
    expect(routerSource).not.toContain("publicProcedure");

    const secret = "must-not-appear";
    const attestation = getDimePricingAttestation({
      env: {
        DIME_MODEL_API_SECRET: secret,
        RUNPOD_API_KEY: secret,
      },
    });
    const log = formatDimePricingAttestationLog(attestation);
    expect(log).toContain("provider=frozen");
    expect(log).toContain("registry_status=not_configured");
    expect(log).not.toContain(secret);
    expect(JSON.stringify(attestation)).not.toContain(secret);
  });
});
