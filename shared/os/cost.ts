/**
 * shared/os/cost.ts — token-ledger pricing and session summarisation (ISSUE-008).
 *
 * D10 requires spend to be compared against "the full cost of the human
 * organization otherwise required", not against zero. At Dime the measurable
 * spend does NOT sit in the server runtime — interactive work runs on
 * subscription auth and is never billed per token, so a DB meter would
 * instrument an empty pipe. It sits in Claude Code session transcripts, which
 * carry full cache-aware usage blocks.
 *
 * THE DECLARED NUMERATOR IS `listUsd`: first-party list-price replacement cost,
 * cache-aware. It is deliberately NOT the cash bill, because there frequently
 * isn't one. It answers "what would this work have cost to buy", which is the
 * comparison D10 actually asks for.
 *
 * Honesty contract, mirroring server/analytics/metricDefinitions.ts:
 *   - unknown model -> null with a stated reason, never a guessed price
 *   - nothing priceable -> null, never a fabricated zero
 *   - unpriced messages are COUNTED, never silently dropped
 */

export interface Usage {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export interface ModelPrice {
  inUsdPerMTok: number;
  outUsdPerMTok: number;
  /** Cache writes cost more than plain input. */
  cacheWriteMult: number;
  /** Cache reads cost far less than plain input — this is where savings show. */
  cacheReadMult: number;
}

export type PriceTable = Record<string, ModelPrice>;

export interface SessionMessage {
  model: string;
  usage: Usage;
}

export interface SessionSummary {
  sessionId: string;
  totals: Usage;
  /** Cache-aware list-price replacement cost; null when nothing could be priced. */
  listUsd: number | null;
  usdReason: string | null;
  pricedMessages: number;
  unpricedMessages: number;
}

/** Claude Code emits this pseudo-model for local/synthetic turns. Not billable. */
const SYNTHETIC = "<synthetic>";

const M = 1_000_000;

/**
 * Price one usage block. Returns null — never a guess — when the model is not
 * in the table, so an unlisted model shows up as unpriced rather than free.
 */
export function priceUsd(model: string, u: Usage, prices: PriceTable): number | null {
  if (model === SYNTHETIC) return null;
  const p = prices[model];
  if (!p) return null;
  return (
    (u.input / M) * p.inUsdPerMTok +
    (u.output / M) * p.outUsdPerMTok +
    (u.cacheWrite / M) * p.inUsdPerMTok * p.cacheWriteMult +
    (u.cacheRead / M) * p.inUsdPerMTok * p.cacheReadMult
  );
}

export function summarizeSession(
  sessionId: string,
  messages: SessionMessage[],
  prices: PriceTable,
): SessionSummary {
  const totals: Usage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  let usd = 0;
  let priced = 0;
  let unpriced = 0;

  for (const m of messages) {
    totals.input += m.usage.input;
    totals.output += m.usage.output;
    totals.cacheWrite += m.usage.cacheWrite;
    totals.cacheRead += m.usage.cacheRead;

    const v = priceUsd(m.model, m.usage, prices);
    if (v === null) unpriced++;
    else {
      usd += v;
      priced++;
    }
  }

  return {
    sessionId,
    totals,
    listUsd: priced > 0 ? usd : null,
    usdReason: priced > 0 ? null : "no priced messages — every model was unlisted or synthetic",
    pricedMessages: priced,
    unpricedMessages: unpriced,
  };
}
