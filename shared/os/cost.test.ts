import { describe, expect, it } from "vitest";
import { priceUsd, summarizeSession, type Usage } from "./cost";

const PRICES = { "claude-opus-5": { inUsdPerMTok: 5, outUsdPerMTok: 25, cacheWriteMult: 1.25, cacheReadMult: 0.1 } };

describe("priceUsd", () => {
  it("prices plain input and output tokens", () => {
    const u: Usage = { input: 1_000_000, output: 1_000_000, cacheWrite: 0, cacheRead: 0 };
    expect(priceUsd("claude-opus-5", u, PRICES)).toBeCloseTo(30, 6);
  });

  it("prices cache writes at a premium and cache reads at a discount", () => {
    const u: Usage = { input: 0, output: 0, cacheWrite: 1_000_000, cacheRead: 1_000_000 };
    // 5 * 1.25 + 5 * 0.1 = 6.25 + 0.5
    expect(priceUsd("claude-opus-5", u, PRICES)).toBeCloseTo(6.75, 6);
  });

  it("returns null for an unknown model rather than guessing a price", () => {
    expect(priceUsd("some-unlisted-model", { input: 1, output: 1, cacheWrite: 0, cacheRead: 0 }, PRICES)).toBeNull();
  });

  it("ignores the synthetic pseudo-model Claude Code emits", () => {
    expect(priceUsd("<synthetic>", { input: 10, output: 10, cacheWrite: 0, cacheRead: 0 }, PRICES)).toBeNull();
  });
});

describe("summarizeSession", () => {
  it("totals tokens across messages and prices what it can", () => {
    const msgs = [
      { model: "claude-opus-5", usage: { input: 1_000_000, output: 0, cacheWrite: 0, cacheRead: 0 } },
      { model: "claude-opus-5", usage: { input: 0, output: 1_000_000, cacheWrite: 0, cacheRead: 0 } },
    ];
    const s = summarizeSession("sess-1", msgs, PRICES);
    expect(s.sessionId).toBe("sess-1");
    expect(s.totals.input).toBe(1_000_000);
    expect(s.totals.output).toBe(1_000_000);
    expect(s.listUsd).toBeCloseTo(30, 6);
    expect(s.unpricedMessages).toBe(0);
  });

  it("counts unpriced messages instead of silently dropping them", () => {
    const msgs = [
      { model: "claude-opus-5", usage: { input: 1_000_000, output: 0, cacheWrite: 0, cacheRead: 0 } },
      { model: "<synthetic>", usage: { input: 500, output: 500, cacheWrite: 0, cacheRead: 0 } },
    ];
    const s = summarizeSession("s", msgs, PRICES);
    expect(s.unpricedMessages).toBe(1);
    expect(s.listUsd).toBeCloseTo(5, 6);
  });

  it("reports listUsd null when NOTHING could be priced — never a fabricated zero", () => {
    const s = summarizeSession("s", [{ model: "<synthetic>", usage: { input: 9, output: 9, cacheWrite: 0, cacheRead: 0 } }], PRICES);
    expect(s.listUsd).toBeNull();
    expect(s.usdReason).toMatch(/no priced/i);
  });
});
