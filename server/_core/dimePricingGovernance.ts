import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";

export const DIME_PRICING_REGISTRY_VERSION =
  "dime-observability-pricing-registry-v1" as const;

const ISO_TIMESTAMP = z.string().datetime({ offset: true });
const SHA256 = z.string().regex(/^[0-9a-f]{64}$/);
const boundedLabel = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9][a-z0-9._:/@+-]*$/i);
const usdRate = z.number().min(0).max(1_000_000);
const pricingReviewStatus = z.enum([
  "review_required",
  "independently_reviewed",
  "approved",
]);

export const dimePricingEntrySchema = z
  .object({
    provider: boundedLabel,
    model: boundedLabel,
    modelRevision: boundedLabel,
    pricingRevision: boundedLabel,
    effectiveFrom: ISO_TIMESTAMP,
    effectiveTo: ISO_TIMESTAMP.nullable(),
    inputUsdPerMillionTokens: usdRate,
    cachedInputUsdPerMillionTokens: usdRate.nullable(),
    outputUsdPerMillionTokens: usdRate,
    requestUsd: usdRate,
    toolRequestUsd: usdRate,
    currency: z.literal("USD"),
    source: z.string().min(1).max(500),
    sourceDocumentSha256: SHA256,
    reviewStatus: pricingReviewStatus,
    reviewer: z.string().min(1).max(200),
    reviewedAt: ISO_TIMESTAMP,
    reviewEvidenceSha256: SHA256,
    entryChecksumSha256: SHA256,
  })
  .strict()
  .superRefine((entry, context) => {
    if (
      entry.effectiveTo &&
      Date.parse(entry.effectiveTo) <= Date.parse(entry.effectiveFrom)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Pricing effectiveTo must follow effectiveFrom.",
      });
    }
  });

export type DimePricingEntry = z.infer<typeof dimePricingEntrySchema>;

export const dimePricingRegistrySchema = z
  .object({
    schemaVersion: z.literal(DIME_PRICING_REGISTRY_VERSION),
    registryRevision: boundedLabel,
    status: pricingReviewStatus,
    entries: z.array(dimePricingEntrySchema).max(1_000),
  })
  .strict();

export type DimePricingRegistry = z.infer<typeof dimePricingRegistrySchema>;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)])
    );
  }
  return value;
}

export function checksumDimePricingEntry(
  entry: Omit<DimePricingEntry, "entryChecksumSha256">
): string {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(entry)), "utf8")
    .digest("hex");
}

export type DimePricingResolution =
  | {
      status: "resolved";
      registryRevision: string;
      entry: DimePricingEntry;
    }
  | {
      status: "cost_unavailable";
      reason:
        | "registry_not_configured"
        | "registry_invalid"
        | "registry_checksum_mismatch"
        | "registry_not_approved"
        | "pricing_entry_not_approved"
        | "pricing_entry_not_found"
        | "pricing_entry_ambiguous"
        | "pricing_entry_checksum_invalid";
    };

export function resolveDimePricing(input: {
  registry: unknown;
  provider: string;
  model: string;
  modelRevision: string;
  requestAt: Date;
}): DimePricingResolution {
  const parsed = dimePricingRegistrySchema.safeParse(input.registry);
  if (!parsed.success) {
    return { status: "cost_unavailable", reason: "registry_invalid" };
  }
  if (parsed.data.status !== "approved") {
    return { status: "cost_unavailable", reason: "registry_not_approved" };
  }
  const requestAt = input.requestAt.getTime();
  const matches = parsed.data.entries.filter(
    entry =>
      entry.provider === input.provider &&
      entry.model === input.model &&
      entry.modelRevision === input.modelRevision &&
      Date.parse(entry.effectiveFrom) <= requestAt &&
      (entry.effectiveTo === null || requestAt < Date.parse(entry.effectiveTo))
  );
  if (matches.length === 0) {
    return { status: "cost_unavailable", reason: "pricing_entry_not_found" };
  }
  if (matches.length > 1) {
    return {
      status: "cost_unavailable",
      reason: "pricing_entry_ambiguous",
    };
  }
  const entry = matches[0]!;
  if (entry.reviewStatus !== "approved") {
    return {
      status: "cost_unavailable",
      reason: "pricing_entry_not_approved",
    };
  }
  const { entryChecksumSha256, ...checksumInput } = entry;
  if (checksumDimePricingEntry(checksumInput) !== entryChecksumSha256) {
    return {
      status: "cost_unavailable",
      reason: "pricing_entry_checksum_invalid",
    };
  }
  return {
    status: "resolved",
    registryRevision: parsed.data.registryRevision,
    entry,
  };
}

export function loadDimePricingRegistry(
  env: Record<string, string | undefined> = process.env
):
  | {
      status: "loaded";
      registry: DimePricingRegistry;
      checksumSha256: string;
    }
  | {
      status: "cost_unavailable";
      reason:
        | "registry_not_configured"
        | "registry_invalid"
        | "registry_checksum_mismatch";
    } {
  const path = env.DIME_PRICING_REGISTRY_PATH?.trim();
  if (!path) {
    return { status: "cost_unavailable", reason: "registry_not_configured" };
  }
  try {
    const contents = readFileSync(path, "utf8");
    if (Buffer.byteLength(contents, "utf8") > 256_000) {
      return { status: "cost_unavailable", reason: "registry_invalid" };
    }
    const checksumSha256 = createHash("sha256")
      .update(contents, "utf8")
      .digest("hex");
    const expectedChecksum = env.DIME_PRICING_REGISTRY_SHA256?.trim();
    if (
      expectedChecksum &&
      (!SHA256.safeParse(expectedChecksum).success ||
        checksumSha256 !== expectedChecksum)
    ) {
      return {
        status: "cost_unavailable",
        reason: "registry_checksum_mismatch",
      };
    }
    const parsed = dimePricingRegistrySchema.safeParse(JSON.parse(contents));
    if (!parsed.success) {
      return { status: "cost_unavailable", reason: "registry_invalid" };
    }
    return { status: "loaded", registry: parsed.data, checksumSha256 };
  } catch {
    return { status: "cost_unavailable", reason: "registry_invalid" };
  }
}
