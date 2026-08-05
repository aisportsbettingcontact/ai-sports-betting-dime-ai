/**
 * Canonical loop-artifact envelope — the shared contract for every artifact the
 * closed-loop spine produces (observations, snapshots, projections, display
 * artifacts, results, grading records, evaluations, proposals, approvals, costs).
 *
 * Design constraints (docs/ai-native/target-architecture.md):
 * - Envelope is pure and DB-free so every consumer (server, scripts, tests) can
 *   validate artifacts without infrastructure.
 * - contentHash covers the semantic content (everything except createdAtMs and
 *   the hash itself) so replaying the same fact is byte-identical and the
 *   ledger can deduplicate it; processing time never changes identity.
 * - Timestamps are epoch-ms bigints-as-numbers, matching the repo convention
 *   (games.modelRunAt, odds_history.scrapedAt).
 */
import { createHash } from "node:crypto";
import { z } from "zod";

export const LOOP_SCHEMA_VERSION = "loop-envelope-v1";

export const artifactTypeSchema = z.enum([
  "provider_observation",
  "canonical_event",
  "odds_snapshot",
  "projection",
  "display_artifact",
  "result_observation",
  "grading_record",
  "evaluation_report",
  "improvement_proposal",
  "approval_decision",
  "workflow_cost",
]);
export type ArtifactType = z.infer<typeof artifactTypeSchema>;

/** Access classification: who may read the artifact. */
export const accessClassSchema = z.enum(["public", "internal", "owner"]);
export type AccessClass = z.infer<typeof accessClassSchema>;

/**
 * Freshness at creation time. "derived" = freshness is a function of the
 * artifact's sources (e.g. a display artifact is as fresh as its odds snapshot).
 */
export const freshnessSchema = z.enum(["live", "stale", "derived", "unknown"]);
export type Freshness = z.infer<typeof freshnessSchema>;

export const artifactLinksSchema = z
  .object({
    /** This artifact replaces an earlier one (regrade, re-evaluation). */
    supersedes: z.string().optional(),
    /** This artifact corrects an earlier observation of the same fact. */
    correctionOf: z.string().optional(),
    /** approval_decision → the improvement_proposal it decides. */
    decides: z.string().optional(),
    /** workflow_cost → the outcome artifact the spend produced. */
    outcomeRef: z.string().optional(),
  })
  .strict();
export type ArtifactLinks = z.infer<typeof artifactLinksSchema>;

/** Spend attribution for AI-economics (token-maxing must be outcome-adjusted). */
export const costBlockSchema = z
  .object({
    inputTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
    usd: z.number().nonnegative().nullable(),
    latencyMs: z.number().nonnegative().nullable(),
    retries: z.number().int().nonnegative(),
  })
  .strict();
export type CostBlock = z.infer<typeof costBlockSchema>;

/** Canonical entity references. gamePk is the MLB identity (mlbEventIdentity contract). */
export const entityRefsSchema = z
  .object({
    gamePk: z.number().int().positive().optional(),
    gameDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "gameDate must be YYYY-MM-DD")
      .optional(),
    market: z.string().optional(),
    selection: z.string().optional(),
    playerId: z.number().int().positive().optional(),
    modelVersion: z.string().optional(),
  })
  .strict();
export type EntityRefs = z.infer<typeof entityRefsSchema>;

export const versionsSchema = z
  .object({
    modelVersion: z.string().optional(),
    /** Hash of the parameter set that produced a projection (G1 fix). */
    paramsHash: z.string().optional(),
    codeRef: z.string().optional(),
    promptVersion: z.string().optional(),
  })
  .strict();
export type Versions = z.infer<typeof versionsSchema>;

export const loopArtifactSchema = z
  .object({
    artifactId: z.string().min(1),
    artifactType: artifactTypeSchema,
    schemaVersion: z.literal(LOOP_SCHEMA_VERSION),
    /** Processing time — when the artifact was created. Excluded from contentHash. */
    createdAtMs: z.number().int().positive(),
    /** Domain event time (e.g. scheduled first pitch), when meaningful. */
    eventTimeMs: z.number().int().positive().nullable(),
    /** When the underlying fact was observed at its source. */
    observedAtMs: z.number().int().positive().nullable(),
    /** When the fact takes effect, if different from observation. */
    effectiveAtMs: z.number().int().positive().nullable(),
    producer: z.string().min(1),
    /**
     * Provenance. Internal references are ledger artifact ids and MUST resolve;
     * external references use the "ext:" prefix (e.g. "ext:statsapi.mlb.com/...").
     */
    sources: z.array(z.string().min(1)),
    entityRefs: entityRefsSchema,
    versions: versionsSchema,
    accessClass: accessClassSchema,
    freshness: freshnessSchema,
    /** Free-text limitation note shown with the artifact; null = none declared. */
    uncertainty: z.string().nullable(),
    links: artifactLinksSchema,
    cost: costBlockSchema.nullable(),
    payload: z.unknown(),
    /** sha-256 hex over the canonical JSON of the hashable view. */
    contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
export type LoopArtifact = z.infer<typeof loopArtifactSchema>;

/** Deterministic JSON: recursively sorted object keys, undefined dropped. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
  return `{${entries.join(",")}}`;
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** The semantic view covered by contentHash — everything except processing time. */
function hashableView(a: Omit<LoopArtifact, "contentHash" | "createdAtMs">): unknown {
  return {
    artifactId: a.artifactId,
    artifactType: a.artifactType,
    schemaVersion: a.schemaVersion,
    eventTimeMs: a.eventTimeMs,
    observedAtMs: a.observedAtMs,
    effectiveAtMs: a.effectiveAtMs,
    producer: a.producer,
    sources: a.sources,
    entityRefs: a.entityRefs,
    versions: a.versions,
    accessClass: a.accessClass,
    freshness: a.freshness,
    uncertainty: a.uncertainty,
    links: a.links,
    cost: a.cost,
    payload: a.payload,
  };
}

export function computeContentHash(
  a: Omit<LoopArtifact, "contentHash" | "createdAtMs"> & { createdAtMs?: number },
): string {
  return sha256Hex(canonicalJson(hashableView(a)));
}

export interface MakeArtifactInput {
  artifactId: string;
  artifactType: ArtifactType;
  createdAtMs: number;
  eventTimeMs?: number | null;
  observedAtMs?: number | null;
  effectiveAtMs?: number | null;
  producer: string;
  sources?: string[];
  entityRefs?: EntityRefs;
  versions?: Versions;
  accessClass?: AccessClass;
  freshness?: Freshness;
  uncertainty?: string | null;
  links?: ArtifactLinks;
  cost?: CostBlock | null;
  payload: unknown;
}

/** Build and validate an artifact; throws ZodError on contract violation. */
export function makeArtifact(input: MakeArtifactInput): LoopArtifact {
  const base: Omit<LoopArtifact, "contentHash"> = {
    artifactId: input.artifactId,
    artifactType: input.artifactType,
    schemaVersion: LOOP_SCHEMA_VERSION,
    createdAtMs: input.createdAtMs,
    eventTimeMs: input.eventTimeMs ?? null,
    observedAtMs: input.observedAtMs ?? null,
    effectiveAtMs: input.effectiveAtMs ?? null,
    producer: input.producer,
    sources: input.sources ?? [],
    entityRefs: input.entityRefs ?? {},
    versions: input.versions ?? {},
    accessClass: input.accessClass ?? "internal",
    freshness: input.freshness ?? "unknown",
    uncertainty: input.uncertainty ?? null,
    links: input.links ?? {},
    cost: input.cost ?? null,
    payload: input.payload,
  };
  const contentHash = computeContentHash(base);
  return loopArtifactSchema.parse({ ...base, contentHash });
}

/** True when the reference points outside the ledger (never resolved internally). */
export function isExternalRef(ref: string): boolean {
  return ref.startsWith("ext:");
}
