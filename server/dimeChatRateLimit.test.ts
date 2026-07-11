import { describe, it, expect } from "vitest";
import {
  checkDimeChatRateLimit,
  DIME_CHAT_RATE_LIMIT_MAX_REQUESTS,
  DIME_CHAT_RATE_LIMIT_WINDOW_MS,
} from "./dimeChatRateLimit";

/**
 * Regression tests for the per-user rate limiter on POST /api/dime/chat.
 *
 * Defect (P1): the chat route enforced auth + entitlement but had NO per-user
 * rate limit, so an entitled subscriber could drive unbounded claude-fable-5
 * streaming spend (the only throttle was the shared 200/min/IP global limiter).
 * These tests lock the fixed-window semantics that close that gap.
 */
describe("Dime chat per-user rate limit", () => {
  type Store = Map<number, { count: number; windowStart: number }>;
  const newStore = (): Store => new Map();

  it("allows requests up to the per-user maximum within one window", () => {
    const store = newStore();
    const now = 1_000_000;
    for (let i = 0; i < DIME_CHAT_RATE_LIMIT_MAX_REQUESTS; i++) {
      expect(checkDimeChatRateLimit(1, store, now)).toBe(true);
    }
  });

  it("blocks the request that exceeds the per-user maximum", () => {
    const store = newStore();
    const now = 1_000_000;
    for (let i = 0; i < DIME_CHAT_RATE_LIMIT_MAX_REQUESTS; i++) {
      checkDimeChatRateLimit(2, store, now);
    }
    expect(checkDimeChatRateLimit(2, store, now)).toBe(false);
    // Still blocked while inside the same window.
    expect(checkDimeChatRateLimit(2, store, now + DIME_CHAT_RATE_LIMIT_WINDOW_MS - 1)).toBe(false);
  });

  it("resets after the window elapses", () => {
    const store = newStore();
    const start = 5_000_000;
    for (let i = 0; i < DIME_CHAT_RATE_LIMIT_MAX_REQUESTS; i++) {
      checkDimeChatRateLimit(3, store, start);
    }
    expect(checkDimeChatRateLimit(3, store, start)).toBe(false);
    // One millisecond past the window → fresh allowance.
    expect(checkDimeChatRateLimit(3, store, start + DIME_CHAT_RATE_LIMIT_WINDOW_MS + 1)).toBe(true);
  });

  it("tracks each user independently", () => {
    const store = newStore();
    const now = 9_000_000;
    for (let i = 0; i < DIME_CHAT_RATE_LIMIT_MAX_REQUESTS; i++) {
      checkDimeChatRateLimit(10, store, now);
    }
    expect(checkDimeChatRateLimit(10, store, now)).toBe(false);
    // A different user is unaffected by user 10 exhausting their window.
    expect(checkDimeChatRateLimit(11, store, now)).toBe(true);
  });

  it("exposes a sane default window and maximum", () => {
    expect(DIME_CHAT_RATE_LIMIT_WINDOW_MS).toBe(60_000);
    expect(DIME_CHAT_RATE_LIMIT_MAX_REQUESTS).toBeGreaterThan(0);
    expect(DIME_CHAT_RATE_LIMIT_MAX_REQUESTS).toBeLessThanOrEqual(60);
  });
});
