import {
  DIME1_BASE_MODEL_REVISION,
  DIME1_DEFAULT_SERVED_MODEL,
  DIME_RESEARCH_ALPHA_BASE_MODEL,
  DIME_RESEARCH_ALPHA_BASE_MODEL_REVISION,
} from "./dime1Model";
import {
  DIME_CHAT_LLM_PROVIDER,
  type DimeChatLlmProvider,
} from "./dimeChatModel";
import {
  loadDimePricingRegistry,
  resolveDimePricing,
} from "./dimePricingGovernance";
import { resolveDimeResearchAlphaGate } from "./dimeResearchAlpha";

export const DIME_PRICING_ATTESTATION_VERSION =
  "dime-pricing-attestation-v1" as const;

export interface DimeRuntimePricingIdentity {
  provider: string;
  model: string;
  modelRevision: string;
  deploymentTier: "disabled" | "production" | "research-alpha";
  currency: "USD";
  zeroCostRuntime: boolean;
}

export interface DimePricingAttestation {
  version: typeof DIME_PRICING_ATTESTATION_VERSION;
  pathConfigured: boolean;
  expectedChecksumConfigured: boolean;
  registryRevision: string | null;
  registryChecksum: string | null;
  registryStatus:
    | "not_configured"
    | "invalid"
    | "checksum_mismatch"
    | "review_required"
    | "independently_reviewed"
    | "approved";
  approvedEntryCount: number;
  activeProvider: string;
  activeModel: string;
  activeModelRevision: string;
  deploymentTier: DimeRuntimePricingIdentity["deploymentTier"];
  currency: "USD";
  zeroCostRuntime: boolean;
  exactMatchAvailable: boolean;
}

function envValue(
  env: Record<string, string | undefined>,
  name: string
): string | undefined {
  const value = env[name]?.trim();
  return value || undefined;
}

export function resolveDimeRuntimePricingIdentity(
  env: Record<string, string | undefined> = process.env,
  provider: DimeChatLlmProvider = DIME_CHAT_LLM_PROVIDER
): DimeRuntimePricingIdentity {
  const alphaGate = resolveDimeResearchAlphaGate(env);
  if (alphaGate.active) {
    return {
      provider: "dime1-research-alpha",
      model: DIME_RESEARCH_ALPHA_BASE_MODEL,
      modelRevision: DIME_RESEARCH_ALPHA_BASE_MODEL_REVISION,
      deploymentTier: "research-alpha",
      currency: "USD",
      zeroCostRuntime: false,
    };
  }
  if (provider === "dime1") {
    return {
      provider: "dime1",
      model: envValue(env, "DIME_MODEL_VERSION") || DIME1_DEFAULT_SERVED_MODEL,
      modelRevision: DIME1_BASE_MODEL_REVISION,
      deploymentTier: "production",
      currency: "USD",
      zeroCostRuntime: false,
    };
  }
  if (provider === "anthropic") {
    const model = envValue(env, "DIME_CHAT_MODEL") || "claude-fable-5";
    return {
      provider: "anthropic",
      model,
      modelRevision: model,
      deploymentTier: "production",
      currency: "USD",
      zeroCostRuntime: false,
    };
  }
  return {
    provider: "frozen",
    model: "no-provider",
    modelRevision: "no-provider",
    deploymentTier: "disabled",
    currency: "USD",
    zeroCostRuntime: true,
  };
}

export function getDimePricingAttestation(
  options: {
    env?: Record<string, string | undefined>;
    identity?: DimeRuntimePricingIdentity;
    now?: Date;
  } = {}
): DimePricingAttestation {
  const env = options.env ?? process.env;
  const identity = options.identity ?? resolveDimeRuntimePricingIdentity(env);
  const loaded = loadDimePricingRegistry(env);
  const pathConfigured = Boolean(envValue(env, "DIME_PRICING_REGISTRY_PATH"));
  const expectedChecksumConfigured = Boolean(
    envValue(env, "DIME_PRICING_REGISTRY_SHA256")
  );

  if (loaded.status !== "loaded") {
    const registryStatus =
      loaded.reason === "registry_not_configured"
        ? "not_configured"
        : loaded.reason === "registry_checksum_mismatch"
          ? "checksum_mismatch"
          : "invalid";
    return {
      version: DIME_PRICING_ATTESTATION_VERSION,
      pathConfigured,
      expectedChecksumConfigured,
      registryRevision: null,
      registryChecksum: null,
      registryStatus,
      approvedEntryCount: 0,
      activeProvider: identity.provider,
      activeModel: identity.model,
      activeModelRevision: identity.modelRevision,
      deploymentTier: identity.deploymentTier,
      currency: identity.currency,
      zeroCostRuntime: identity.zeroCostRuntime,
      exactMatchAvailable: false,
    };
  }

  const approvedEntryCount = loaded.registry.entries.filter(
    entry => entry.reviewStatus === "approved"
  ).length;
  const resolution = resolveDimePricing({
    registry: loaded.registry,
    provider: identity.provider,
    model: identity.model,
    modelRevision: identity.modelRevision,
    requestAt: options.now ?? new Date(),
  });
  return {
    version: DIME_PRICING_ATTESTATION_VERSION,
    pathConfigured,
    expectedChecksumConfigured,
    registryRevision: loaded.registry.registryRevision,
    registryChecksum: loaded.checksumSha256,
    registryStatus: loaded.registry.status,
    approvedEntryCount,
    activeProvider: identity.provider,
    activeModel: identity.model,
    activeModelRevision: identity.modelRevision,
    deploymentTier: identity.deploymentTier,
    currency: identity.currency,
    zeroCostRuntime: identity.zeroCostRuntime,
    exactMatchAvailable: resolution.status === "resolved",
  };
}

export function formatDimePricingAttestationLog(
  attestation: DimePricingAttestation
): string {
  return [
    `[DIME_PRICING] version=${attestation.version}`,
    `path_configured=${attestation.pathConfigured}`,
    `expected_checksum_configured=${attestation.expectedChecksumConfigured}`,
    `registry_revision=${attestation.registryRevision ?? "none"}`,
    `registry_checksum=${attestation.registryChecksum ?? "none"}`,
    `registry_status=${attestation.registryStatus}`,
    `approved_entries=${attestation.approvedEntryCount}`,
    `provider=${attestation.activeProvider}`,
    `model=${attestation.activeModel}`,
    `model_revision=${attestation.activeModelRevision}`,
    `tier=${attestation.deploymentTier}`,
    `currency=${attestation.currency}`,
    `zero_cost=${attestation.zeroCostRuntime}`,
    `exact_match=${attestation.exactMatchAvailable}`,
  ].join(" ");
}
