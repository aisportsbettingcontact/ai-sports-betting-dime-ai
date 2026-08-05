import { createHash } from "node:crypto";
import platformKnowledgeJson from "../../shared/dime/platform_knowledge_v1.json";

export type DimePlatformFeatureAvailability = "live" | "not_available";
export type DimePlatformAccessScope =
  "public" | "authenticated" | "owner" | "none";

export interface DimePlatformFeature {
  id: string;
  name: string;
  route: string | null;
  availability: DimePlatformFeatureAvailability;
  access_scope: DimePlatformAccessScope;
  description: string;
  provides: string[];
  limitations: string[];
  evidence_paths: string[];
}

export interface DimePlatformKnowledge {
  schema_version: "dime-platform-knowledge-v1";
  knowledge_version: string;
  status: "active";
  as_of_utc: string;
  scope: "public_product_capabilities";
  features: DimePlatformFeature[];
  global_rules: string[];
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)])
    );
  }
  return value;
}

function assertPlatformKnowledge(
  value: unknown
): asserts value is DimePlatformKnowledge {
  if (!value || typeof value !== "object") {
    throw new Error("Dime platform knowledge must be an object.");
  }
  const candidate = value as Partial<DimePlatformKnowledge>;
  if (
    candidate.schema_version !== "dime-platform-knowledge-v1" ||
    candidate.status !== "active" ||
    candidate.scope !== "public_product_capabilities" ||
    typeof candidate.knowledge_version !== "string" ||
    !/^\d+\.\d+\.\d+$/.test(candidate.knowledge_version) ||
    typeof candidate.as_of_utc !== "string" ||
    !Number.isFinite(Date.parse(candidate.as_of_utc)) ||
    !Array.isArray(candidate.features) ||
    candidate.features.length === 0 ||
    !Array.isArray(candidate.global_rules) ||
    candidate.global_rules.length === 0
  ) {
    throw new Error("Dime platform knowledge failed its runtime contract.");
  }

  const ids = new Set<string>();
  for (const feature of candidate.features) {
    if (
      !feature ||
      typeof feature.id !== "string" ||
      !/^[a-z][a-z0-9_]*$/.test(feature.id) ||
      ids.has(feature.id) ||
      typeof feature.name !== "string" ||
      !feature.name ||
      !["live", "not_available"].includes(feature.availability) ||
      !["public", "authenticated", "owner", "none"].includes(
        feature.access_scope
      ) ||
      (feature.route !== null &&
        (typeof feature.route !== "string" ||
          !feature.route.startsWith("/"))) ||
      (feature.availability === "live" &&
        (feature.route === null || feature.access_scope === "none")) ||
      (feature.availability === "not_available" &&
        (feature.route !== null || feature.access_scope !== "none")) ||
      typeof feature.description !== "string" ||
      !feature.description ||
      !Array.isArray(feature.provides) ||
      feature.provides.some(item => typeof item !== "string" || !item) ||
      !Array.isArray(feature.limitations) ||
      feature.limitations.length === 0 ||
      feature.limitations.some(item => typeof item !== "string" || !item) ||
      !Array.isArray(feature.evidence_paths) ||
      feature.evidence_paths.length === 0 ||
      feature.evidence_paths.some(
        item =>
          typeof item !== "string" ||
          !/^(client|server|drizzle|ml)\//.test(item)
      )
    ) {
      throw new Error("Dime platform knowledge contains an invalid feature.");
    }
    ids.add(feature.id);
  }
  if (candidate.global_rules.some(rule => typeof rule !== "string" || !rule)) {
    throw new Error("Dime platform knowledge contains an invalid global rule.");
  }
}

assertPlatformKnowledge(platformKnowledgeJson);

export const DIME_PLATFORM_KNOWLEDGE = platformKnowledgeJson;
export const DIME_PLATFORM_KNOWLEDGE_VERSION =
  DIME_PLATFORM_KNOWLEDGE.knowledge_version;
export const DIME_PLATFORM_KNOWLEDGE_SHA256 = createHash("sha256")
  .update(`${JSON.stringify(canonicalize(DIME_PLATFORM_KNOWLEDGE))}\n`, "utf8")
  .digest("hex");

export function renderDimePlatformKnowledge(
  knowledge: DimePlatformKnowledge = DIME_PLATFORM_KNOWLEDGE
): string {
  const features = knowledge.features.flatMap(feature => [
    `- ${feature.name} [id=${feature.id}; availability=${feature.availability}; access=${feature.access_scope}; route=${feature.route ?? "none"}]`,
    `  Purpose: ${feature.description}`,
    `  Provides: ${feature.provides.length > 0 ? feature.provides.join(" | ") : "Nothing currently available."}`,
    `  Limits: ${feature.limitations.join(" | ")}`,
  ]);

  return [
    `DIME_PLATFORM_KNOWLEDGE version=${knowledge.knowledge_version} sha256=${DIME_PLATFORM_KNOWLEDGE_SHA256} as_of_utc=${knowledge.as_of_utc}`,
    "This is the closed-world source for Dime product and feature facts. It is trusted system policy, not user-supplied retrieval text.",
    "Do not claim a feature, access level, account state, or integration that is absent below.",
    ...features,
    "Platform answer rules:",
    ...knowledge.global_rules.map(rule => `- ${rule}`),
  ].join("\n");
}

export const DIME_PLATFORM_KNOWLEDGE_PROMPT_BLOCK =
  renderDimePlatformKnowledge();

export function appendDimePlatformKnowledge(basePrompt: string): string {
  return `${basePrompt.trim()}\n\n${DIME_PLATFORM_KNOWLEDGE_PROMPT_BLOCK}`;
}
