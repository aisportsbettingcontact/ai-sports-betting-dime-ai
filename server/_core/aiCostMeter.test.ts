/** AI cost meter tests (Q5) — pure pricing logic; no DB, no network. */
import { afterEach, describe, expect, it } from "vitest";
import {
  buildCostEvent,
  clearPriceTableCache,
  computeUsd,
  DEFAULT_PRICES,
  PRICE_TABLE_VERSION,
  resolvePriceTable,
} from "./aiCostMeter";

afterEach(() => clearPriceTableCache());

describe("computeUsd", () => {
  it("prices known models at the versioned first-party rates", () => {
    // claude-opus-5: $5/MTok in, $25/MTok out
    const opus = computeUsd("claude-opus-5", 1_000_000, 100_000, DEFAULT_PRICES);
    expect(opus).toEqual({ priced: true, usd: 5 + 2.5 });
    // claude-fable-5: $10/$50
    const fable = computeUsd("claude-fable-5", 12_000, 900, DEFAULT_PRICES);
    expect(fable.priced && fable.usd).toBeCloseTo(0.12 + 0.045, 6);
    // claude-haiku-4-5: $1/$5
    const haiku = computeUsd("claude-haiku-4-5", 2_000_000, 0, DEFAULT_PRICES);
    expect(haiku).toEqual({ priced: true, usd: 2 });
  });

  it("matches date-suffixed model ids by longest prefix", () => {
    const result = computeUsd("claude-haiku-4-5-20251001", 1_000_000, 1_000_000, DEFAULT_PRICES);
    expect(result).toEqual({ priced: true, usd: 6 });
  });

  it("refuses to guess a price for unknown models (honest null)", () => {
    const result = computeUsd("gateway-custom-model", 1000, 1000, DEFAULT_PRICES);
    expect(result.priced).toBe(false);
    if (!result.priced) {
      expect(result.reason).toContain("UNKNOWN_MODEL_PRICE");
      expect(result.reason).toContain(PRICE_TABLE_VERSION);
    }
  });

  it("reports NO_USAGE when no token counts exist", () => {
    const result = computeUsd("claude-opus-5", null, undefined, DEFAULT_PRICES);
    expect(result.priced).toBe(false);
    if (!result.priced) expect(result.reason).toContain("NO_USAGE");
  });
});

describe("price table override", () => {
  it("merges AI_PRICE_TABLE_JSON over defaults", () => {
    const { table, source } = resolvePriceTable({
      AI_PRICE_TABLE_JSON: JSON.stringify({
        "gateway-custom-model": { inputUsdPerMTok: 2, outputUsdPerMTok: 4 },
      }),
    });
    expect(table["gateway-custom-model"]).toEqual({ inputUsdPerMTok: 2, outputUsdPerMTok: 4 });
    expect(table["claude-opus-5"]).toEqual(DEFAULT_PRICES["claude-opus-5"]);
    expect(source).toContain("override");
  });

  it("falls back to defaults on malformed override JSON", () => {
    const { table, source } = resolvePriceTable({ AI_PRICE_TABLE_JSON: "{not json" });
    expect(table).toEqual(DEFAULT_PRICES);
    expect(source).toContain("defaults");
  });
});

describe("buildCostEvent", () => {
  it("carries usage, latency, and the price-table version", () => {
    clearPriceTableCache();
    const event = buildCostEvent({
      workflow: "dime-chat",
      model: "claude-fable-5",
      requestId: "req-123",
      inputTokens: 10_000,
      outputTokens: 500,
      latencyMs: 4200,
    });
    expect(event.usd).toBeCloseTo(0.1 + 0.025, 6);
    expect(event.usdReason).toBeNull();
    expect(event.priceTableVersion).toBe(PRICE_TABLE_VERSION);
    expect(event.retries).toBe(0);
  });

  it("records the un-priceable reason instead of a fabricated USD", () => {
    clearPriceTableCache();
    const event = buildCostEvent({
      workflow: "wc2026-answer",
      model: "totally-unknown",
      inputTokens: 1,
      outputTokens: 1,
    });
    expect(event.usd).toBeNull();
    expect(event.usdReason).toContain("UNKNOWN_MODEL_PRICE");
  });
});
