import { describe, expect, it } from "vitest";
import {
  DEFAULT_DIME_CHAT_AVENUE,
  DIME_CHAT_AVENUES,
  DIME_CHAT_AVENUE_STORAGE_KEY,
  applyDimeAvenueScope,
  buildDimeChatRequestBody,
  getDimeChatAvenueMeta,
  isDimeChatAvenue,
  loadDimeChatAvenue,
  saveDimeChatAvenue,
  type DimeAvenueStorage,
} from "./dimeChatAvenue";

function stubStorage(
  initial: Record<string, string> = {}
): DimeAvenueStorage & {
  data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    getItem: key => (key in data ? data[key]! : null),
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

describe("avenue metadata", () => {
  it("defines exactly the three owner-directed avenues, in header order", () => {
    expect(DIME_CHAT_AVENUES.map(meta => meta.id)).toEqual([
      "model_projections",
      "betting_splits",
      "odds_line_movement",
    ]);
    expect(DIME_CHAT_AVENUES.map(meta => meta.label)).toEqual([
      "AI MODEL PROJECTIONS",
      "BETTING SPLITS",
      "ODDS + LINE MOVEMENT",
    ]);
  });

  it("every avenue has a compact label and a distinct, visible scope suffix", () => {
    const suffixes = new Set<string>();
    for (const meta of DIME_CHAT_AVENUES) {
      expect(meta.compactLabel.length).toBeGreaterThan(0);
      expect(meta.compactLabel.length).toBeLessThanOrEqual(meta.label.length);
      expect(meta.scopeSuffix.startsWith(" — scope:")).toBe(true);
      suffixes.add(meta.scopeSuffix);
    }
    expect(suffixes.size).toBe(DIME_CHAT_AVENUES.length);
  });

  it("guards and lookups agree with the union", () => {
    for (const meta of DIME_CHAT_AVENUES) {
      expect(isDimeChatAvenue(meta.id)).toBe(true);
      expect(getDimeChatAvenueMeta(meta.id)).toBe(meta);
    }
    expect(isDimeChatAvenue("everything")).toBe(false);
    expect(isDimeChatAvenue(null)).toBe(false);
  });
});

describe("persistence", () => {
  it("round-trips through storage", () => {
    const storage = stubStorage();
    saveDimeChatAvenue("betting_splits", storage);
    expect(storage.data[DIME_CHAT_AVENUE_STORAGE_KEY]).toBe("betting_splits");
    expect(loadDimeChatAvenue(storage)).toBe("betting_splits");
  });

  it("falls back to the default on missing, absent, or corrupt storage", () => {
    expect(loadDimeChatAvenue(stubStorage())).toBe(DEFAULT_DIME_CHAT_AVENUE);
    expect(loadDimeChatAvenue(null)).toBe(DEFAULT_DIME_CHAT_AVENUE);
    expect(
      loadDimeChatAvenue(
        stubStorage({ [DIME_CHAT_AVENUE_STORAGE_KEY]: "not-an-avenue" })
      )
    ).toBe(DEFAULT_DIME_CHAT_AVENUE);
  });

  it("treats throwing storage as a no-op", () => {
    const hostile: DimeAvenueStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(loadDimeChatAvenue(hostile)).toBe(DEFAULT_DIME_CHAT_AVENUE);
    expect(() => saveDimeChatAvenue("betting_splits", hostile)).not.toThrow();
  });
});

describe("scope application", () => {
  it("appends the active avenue's visible suffix", () => {
    const scoped = applyDimeAvenueScope(
      "best plays tonight?",
      "betting_splits"
    );
    expect(scoped).toBe(
      "best plays tonight? — scope: betting splits (bets % and money %)"
    );
  });

  it("is idempotent for the same avenue (retry never stacks)", () => {
    const once = applyDimeAvenueScope("scan the board", "model_projections");
    expect(applyDimeAvenueScope(once, "model_projections")).toBe(once);
  });

  it("never mixes suffixes when the toggle moved between attempts", () => {
    const first = applyDimeAvenueScope("scan the board", "model_projections");
    const retried = applyDimeAvenueScope(first, "odds_line_movement");
    expect(retried).toBe(first);
  });
});

describe("request body", () => {
  it("carries messages plus the forward-compatible avenue field", () => {
    const messages = [
      { role: "user" as const, content: "hello" },
      { role: "assistant" as const, content: "hi" },
    ];
    const body = buildDimeChatRequestBody(messages, "odds_line_movement");
    expect(body).toEqual({ messages, avenue: "odds_line_movement" });
    // Defensive copy: mutating the body must not touch the caller's array.
    body.messages.push({ role: "user", content: "extra" });
    expect(messages).toHaveLength(2);
  });
});
