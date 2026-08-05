/**
 * aiCostMeter.ts — outcome-adjusted AI spend measurement (queue item Q5).
 *
 * Before this module the platform had zero USD measurement: token usage was
 * console-logged on the chat path and persisted (tokens only) on the WC2026
 * route; the only USD field in the repo (dimeAgent.totalCostUsd) was never
 * stored. Token-maxing cannot be evaluated without a meter.
 *
 * Honesty contract (mirrors metricDefinitions/{state,value,reason}):
 * - Unknown model → usd null with a stated reason, never a guessed price.
 * - Prices are a versioned table (defaults below are Anthropic first-party
 *   API rates, cached 2026-06-24 via the claude-api reference; the gateway in
 *   front of ANTHROPIC_BASE_URL may bill differently). Override with
 *   AI_PRICE_TABLE_JSON, e.g. '{"claude-opus-5":{"inputUsdPerMTok":5,"outputUsdPerMTok":25}}'.
 * - Persistence is deploy-gated (ai_workflow_costs ships via db-push.yml);
 *   until the table exists, events are still fully logged — measurement
 *   degrades to logs, never crashes a serving path.
 */
import { getDb } from "../db";
import { aiWorkflowCosts } from "../../drizzle/dime.schema";
import { tableColumns } from "../schemaCapabilities";

const TAG = "[AICost]";

export interface ModelPrice {
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
}

export const PRICE_TABLE_VERSION = "prices-2026-07-28";

/** Anthropic first-party rates (skill cache 2026-06-24). Sonnet 5 uses the standard rate, not the intro promo. */
export const DEFAULT_PRICES: Record<string, ModelPrice> = {
  "claude-fable-5": { inputUsdPerMTok: 10, outputUsdPerMTok: 50 },
  "claude-opus-5": { inputUsdPerMTok: 5, outputUsdPerMTok: 25 },
  "claude-opus-4-8": { inputUsdPerMTok: 5, outputUsdPerMTok: 25 },
  "claude-opus-4-7": { inputUsdPerMTok: 5, outputUsdPerMTok: 25 },
  "claude-opus-4-6": { inputUsdPerMTok: 5, outputUsdPerMTok: 25 },
  "claude-sonnet-5": { inputUsdPerMTok: 3, outputUsdPerMTok: 15 },
  "claude-sonnet-4-6": { inputUsdPerMTok: 3, outputUsdPerMTok: 15 },
  "claude-haiku-4-5": { inputUsdPerMTok: 1, outputUsdPerMTok: 5 },
};

let priceTableCache: { table: Record<string, ModelPrice>; source: string } | null = null;

export function resolvePriceTable(
  env: Record<string, string | undefined> = process.env,
): { table: Record<string, ModelPrice>; source: string } {
  if (priceTableCache) return priceTableCache;
  let table = DEFAULT_PRICES;
  let source = `defaults (${PRICE_TABLE_VERSION})`;
  if (env.AI_PRICE_TABLE_JSON) {
    try {
      const parsed = JSON.parse(env.AI_PRICE_TABLE_JSON) as Record<string, ModelPrice>;
      table = { ...DEFAULT_PRICES, ...parsed };
      source = `defaults (${PRICE_TABLE_VERSION}) + AI_PRICE_TABLE_JSON override (${Object.keys(parsed).length} model(s))`;
    } catch (err) {
      console.warn(`${TAG} [WARN] AI_PRICE_TABLE_JSON is not valid JSON — using defaults: ${err instanceof Error ? err.message : err}`);
    }
  }
  priceTableCache = { table, source };
  console.log(`${TAG} [STATE] price table: ${source}`);
  return priceTableCache;
}

export type UsdResult =
  | { priced: true; usd: number }
  | { priced: false; reason: string };

/** Pure: USD for a usage record. Model ids may arrive with date suffixes — longest-prefix match. */
export function computeUsd(
  model: string,
  inputTokens: number | null | undefined,
  outputTokens: number | null | undefined,
  table: Record<string, ModelPrice> = resolvePriceTable().table,
): UsdResult {
  if (inputTokens == null && outputTokens == null) {
    return { priced: false, reason: "NO_USAGE: no token counts reported" };
  }
  const key = Object.keys(table)
    .filter((k) => model === k || model.startsWith(`${k}-`) || model.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  if (!key) {
    return { priced: false, reason: `UNKNOWN_MODEL_PRICE: '${model}' not in price table ${PRICE_TABLE_VERSION} — refusing to guess; set AI_PRICE_TABLE_JSON` };
  }
  const price = table[key];
  const usd =
    ((inputTokens ?? 0) / 1_000_000) * price.inputUsdPerMTok +
    ((outputTokens ?? 0) / 1_000_000) * price.outputUsdPerMTok;
  return { priced: true, usd: Number(usd.toFixed(6)) };
}

export interface WorkflowCostEvent {
  workflow: string;
  model: string;
  requestId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  usd: number | null;
  usdReason: string | null;
  latencyMs: number | null;
  retries: number;
  outcomeRef: string | null;
  priceTableVersion: string;
}

export function buildCostEvent(input: {
  workflow: string;
  model: string;
  requestId?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  latencyMs?: number | null;
  retries?: number;
  outcomeRef?: string | null;
}): WorkflowCostEvent {
  const priced = computeUsd(input.model, input.inputTokens, input.outputTokens);
  return {
    workflow: input.workflow,
    model: input.model,
    requestId: input.requestId ?? null,
    inputTokens: input.inputTokens ?? null,
    outputTokens: input.outputTokens ?? null,
    usd: priced.priced ? priced.usd : null,
    usdReason: priced.priced ? null : priced.reason,
    latencyMs: input.latencyMs ?? null,
    retries: input.retries ?? 0,
    outcomeRef: input.outcomeRef ?? null,
    priceTableVersion: PRICE_TABLE_VERSION,
  };
}

/** Structured log line — always emitted, grep-able, one per AI call. */
export function logCostEvent(event: WorkflowCostEvent): void {
  console.log(
    `${TAG} [OUTPUT] workflow=${event.workflow} model=${event.model} req=${event.requestId ?? "-"} ` +
    `in=${event.inputTokens ?? "-"} out=${event.outputTokens ?? "-"} ` +
    `usd=${event.usd ?? `UNPRICED(${event.usdReason})`} latencyMs=${event.latencyMs ?? "-"} retries=${event.retries} ` +
    `prices=${event.priceTableVersion}`,
  );
}

/**
 * Persist (deploy-gated) + log. Fail-soft by design: cost measurement must
 * never break a serving path, so all persistence errors degrade to WARN.
 */
export async function recordCostEvent(event: WorkflowCostEvent): Promise<void> {
  logCostEvent(event);
  try {
    const columns = await tableColumns("ai_workflow_costs");
    if (columns.size === 0) {
      console.warn(`${TAG} [STATE] ai_workflow_costs table absent — event logged only (run db-push.yml to enable persistence)`);
      return;
    }
    const db = await getDb();
    await db.insert(aiWorkflowCosts).values({
      workflow: event.workflow,
      model: event.model,
      requestId: event.requestId,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      usd: event.usd !== null ? String(event.usd) : null,
      usdReason: event.usdReason,
      latencyMs: event.latencyMs,
      retries: event.retries,
      outcomeRef: event.outcomeRef,
      priceTableVersion: event.priceTableVersion,
    });
  } catch (err) {
    console.warn(`${TAG} [WARN] cost persistence failed (event already logged): ${err instanceof Error ? err.message : err}`);
  }
}

/** Test hook. */
export function clearPriceTableCache(): void {
  priceTableCache = null;
}
