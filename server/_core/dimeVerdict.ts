import { z } from "zod";
import { DIME_CHAT_VERDICT_SCHEMA_VERSION } from "./dimeChatModel";

export const DIME_ODDS_FRESHNESS_MS = 15 * 60 * 1000;
export const DIME_PROJECTION_FRESHNESS_MS = 24 * 60 * 60 * 1000;
export const DIME_EDGE_TOLERANCE = 0.002;

export type DimeVerdictStatus =
  | "edge_detected"
  | "monitor"
  | "pass"
  | "wait_for_price"
  | "need_more_data"
  | "market_unavailable"
  | "data_conflict";

const confidenceSchema = z.enum(["low", "medium", "high"]);
const dataQualitySchema = z.enum(["platform_verified", "user_provided", "mixed", "stale", "missing", "conflict"]);
const marketTypeSchema = z.enum(["moneyline", "spread", "total", "player_prop"]);
const verdictStatusSchema = z.enum([
  "edge_detected",
  "monitor",
  "pass",
  "wait_for_price",
  "need_more_data",
  "market_unavailable",
  "data_conflict",
]);

const baseVerdictSchema = z.object({
  schema_version: z.literal(DIME_CHAT_VERDICT_SCHEMA_VERSION),
  verdict: verdictStatusSchema,
  event_id: z.string().min(1).optional(),
  sport: z.string().min(1).optional(),
  league: z.string().min(1).optional(),
  event_start_time: z.string().datetime().optional(),
  selection: z.string().min(1).optional(),
  period: z.string().min(1).default("full_game"),
  sportsbook: z.string().min(1).optional(),
  current_line: z.number().optional(),
  current_odds: z.number().int().min(-100000).max(100000).optional(),
  odds_format: z.literal("american").default("american"),
  odds_observed_at: z.string().datetime().optional(),
  model_id: z.string().min(1).optional(),
  model_version: z.string().min(1).optional(),
  projection_observed_at: z.string().datetime().optional(),
  model_probability: z.number().min(0).max(1).optional(),
  fair_probability: z.number().min(0).max(1).optional(),
  fair_odds: z.number().int().optional(),
  no_vig_market_probability: z.number().min(0).max(1).optional(),
  probability_edge: z.number().min(-1).max(1).optional(),
  expected_value: z.number().optional(),
  max_playable_price: z.number().int().optional(),
  max_playable_line: z.number().optional(),
  confidence: confidenceSchema.default("low"),
  data_quality: dataQualitySchema,
  primary_risk_code: z.string().min(1).optional(),
  source_ids: z.array(z.string().min(1)).default([]),
  missing_data_fields: z.array(z.string().min(1)).default([]),
  calculation_provenance: z.array(z.string().min(1)).default([]),
});

export const moneylineVerdictSchema = baseVerdictSchema.extend({ market_type: z.literal("moneyline") });
export const spreadVerdictSchema = baseVerdictSchema.extend({ market_type: z.literal("spread"), current_line: z.number().optional() });
export const totalVerdictSchema = baseVerdictSchema.extend({ market_type: z.literal("total"), selection: z.enum(["over", "under"]).optional(), current_line: z.number().optional() });
export const playerPropVerdictSchema = baseVerdictSchema.extend({ market_type: z.literal("player_prop"), player_id: z.string().min(1).optional(), prop_type: z.string().min(1).optional(), current_line: z.number().optional() });

export const dimeVerdictSchema = z.discriminatedUnion("market_type", [
  moneylineVerdictSchema,
  spreadVerdictSchema,
  totalVerdictSchema,
  playerPropVerdictSchema,
]);

export type DimeStructuredVerdict = z.infer<typeof dimeVerdictSchema>;

export interface DimeVerdictValidationResult {
  ok: boolean;
  verdict?: DimeStructuredVerdict;
  errors: string[];
  corrected?: DimeStructuredVerdict;
}

export function americanToImpliedProbability(odds: number): number {
  return odds < 0 ? Math.abs(odds) / (Math.abs(odds) + 100) : 100 / (odds + 100);
}

export function probabilityToAmericanOdds(probability: number): number {
  if (probability <= 0 || probability >= 1) throw new Error("probability must be between 0 and 1");
  return probability >= 0.5 ? Math.round((-100 * probability) / (1 - probability)) : Math.round((100 * (1 - probability)) / probability);
}

export function expectedValue(modelProbability: number, americanOdds: number): number {
  const payout = americanOdds < 0 ? 100 / Math.abs(americanOdds) : americanOdds / 100;
  return Number((modelProbability * payout - (1 - modelProbability)).toFixed(6));
}

function ageMs(timestamp: string, now: Date): number {
  const ms = Date.parse(timestamp);
  return Number.isFinite(ms) ? now.getTime() - ms : Number.POSITIVE_INFINITY;
}

function hasEdgeRequirements(verdict: DimeStructuredVerdict): string[] {
  const missing: string[] = [];
  if (!verdict.event_id) missing.push("event_id");
  if (!verdict.selection) missing.push("selection");
  if (verdict.current_odds === undefined) missing.push("current_odds");
  if (!verdict.odds_observed_at) missing.push("odds_observed_at");
  if (!verdict.model_version) missing.push("model_version");
  if (verdict.model_probability === undefined) missing.push("model_probability");
  if (!verdict.projection_observed_at) missing.push("projection_observed_at");
  if (verdict.source_ids.length === 0) missing.push("source_ids");
  return missing;
}

export function validateDimeStructuredVerdict(raw: unknown, now = new Date()): DimeVerdictValidationResult {
  const parsed = dimeVerdictSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) };

  const verdict = parsed.data;
  const errors: string[] = [];
  const corrected = { ...verdict } as DimeStructuredVerdict;

  if (verdict.verdict === "edge_detected") {
    for (const field of hasEdgeRequirements(verdict)) errors.push(`edge_detected_missing_${field}`);
    if (verdict.data_quality === "missing" || verdict.data_quality === "conflict" || verdict.data_quality === "stale") errors.push(`edge_detected_invalid_data_quality_${verdict.data_quality}`);
  }

  if (verdict.odds_observed_at && ageMs(verdict.odds_observed_at, now) > DIME_ODDS_FRESHNESS_MS && verdict.verdict === "edge_detected") {
    errors.push("edge_detected_stale_odds");
  }
  if (verdict.projection_observed_at && ageMs(verdict.projection_observed_at, now) > DIME_PROJECTION_FRESHNESS_MS && verdict.verdict === "edge_detected") {
    errors.push("edge_detected_stale_projection");
  }

  if (verdict.current_odds !== undefined && verdict.model_probability !== undefined) {
    const implied = americanToImpliedProbability(verdict.current_odds);
    const expectedEdge = Number((verdict.model_probability - (verdict.no_vig_market_probability ?? implied)).toFixed(6));
    const ev = expectedValue(verdict.model_probability, verdict.current_odds);
    const fairOdds = probabilityToAmericanOdds(verdict.model_probability);

    corrected.probability_edge = expectedEdge;
    corrected.expected_value = ev;
    corrected.fair_odds = fairOdds;
    corrected.fair_probability = verdict.model_probability;
    corrected.calculation_provenance = Array.from(new Set([...verdict.calculation_provenance, "deterministic_recalculation_v1"]));

    if (verdict.probability_edge !== undefined && Math.abs(verdict.probability_edge - expectedEdge) > DIME_EDGE_TOLERANCE) errors.push("probability_edge_mismatch");
    if (verdict.expected_value !== undefined && Math.abs(verdict.expected_value - ev) > DIME_EDGE_TOLERANCE) errors.push("expected_value_mismatch");
    if (verdict.fair_odds !== undefined && Math.abs(verdict.fair_odds - fairOdds) > 2) errors.push("fair_odds_mismatch");
  }

  if (verdict.verdict === "need_more_data" && verdict.missing_data_fields.length === 0) errors.push("need_more_data_requires_missing_fields");
  if (verdict.verdict === "data_conflict" && verdict.primary_risk_code === undefined) errors.push("data_conflict_requires_risk_code");

  return { ok: errors.length === 0, verdict, corrected, errors };
}

const verdictJsonPattern = /```(?:json)?\s*\{\s*"schema_version"[\s\S]*?\}\s*```|\{\s*"schema_version"[\s\S]*?\}/g;

export function extractDimeVerdictCandidates(text: string): unknown[] {
  const matches = text.match(verdictJsonPattern) ?? [];
  const candidates: unknown[] = [];
  for (const match of matches) {
    const json = match.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    try {
      candidates.push(JSON.parse(json));
    } catch {
      // Ignore malformed candidate; validator reports absence/invalidity at call site.
    }
  }
  return candidates;
}

export function validateDimeResponseText(text: string, now = new Date()): DimeVerdictValidationResult {
  const candidates = extractDimeVerdictCandidates(text);
  const hasLegacyEdge = text.includes("[EDGE]") || text.includes("edge_detected");
  if (candidates.length === 0) {
    return hasLegacyEdge ? { ok: false, errors: ["edge_claim_without_valid_structured_verdict"] } : { ok: true, errors: [] };
  }

  const results = candidates.map((candidate) => validateDimeStructuredVerdict(candidate, now));
  const firstFailure = results.find((result) => !result.ok);
  if (firstFailure) return firstFailure;
  return results[0] ?? { ok: true, errors: [] };
}
