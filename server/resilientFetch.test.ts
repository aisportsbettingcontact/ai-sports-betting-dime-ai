/**
 * Tests for the resilientFetch wrapper in client/src/main.tsx
 *
 * Since resilientFetch is a frontend module, we test the core logic
 * by extracting and testing the helper functions directly.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Replicate the core logic from main.tsx for testability ──────────────────

const RATE_LIMIT_PATTERNS = [
  "rate exceeded",
  "too many requests",
  "rate limit",
  "ratelimit",
  "throttled",
  "quota exceeded",
];

function isRateLimitBody(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return RATE_LIMIT_PATTERNS.some(p => lower.includes(p));
}

function synthesizeRateLimitResponse(bodyText: string): { status: number; contentType: string; body: string } {
  const errorBody = JSON.stringify([{
    error: {
      json: {
        message: "The server is temporarily busy. Please wait a moment and try again.",
        code: -32600,
        data: {
          code: "TOO_MANY_REQUESTS",
          httpStatus: 429,
          path: null,
        },
      },
    },
  }]);
  return { status: 429, contentType: "application/json", body: errorBody };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("isRateLimitBody", () => {
  it("detects 'Rate exceeded.' (exact platform message)", () => {
    expect(isRateLimitBody("Rate exceeded.")).toBe(true);
  });

  it("detects case-insensitive variants", () => {
    expect(isRateLimitBody("RATE EXCEEDED")).toBe(true);
    expect(isRateLimitBody("rate exceeded")).toBe(true);
    expect(isRateLimitBody("Rate Exceeded.")).toBe(true);
  });

  it("detects 'Too many requests'", () => {
    expect(isRateLimitBody("Too many requests")).toBe(true);
    expect(isRateLimitBody("429 Too Many Requests")).toBe(true);
  });

  it("detects 'rate limit' and 'ratelimit'", () => {
    expect(isRateLimitBody("You have exceeded the rate limit")).toBe(true);
    expect(isRateLimitBody("ratelimit exceeded")).toBe(true);
  });

  it("detects 'throttled' and 'quota exceeded'", () => {
    expect(isRateLimitBody("Request throttled")).toBe(true);
    expect(isRateLimitBody("Quota exceeded for this hour")).toBe(true);
  });

  it("does NOT flag normal JSON responses", () => {
    expect(isRateLimitBody('{"result":{"data":{"json":null}}}')).toBe(false);
    expect(isRateLimitBody("OK")).toBe(false);
    expect(isRateLimitBody("Internal Server Error")).toBe(false);
  });

  it("handles empty string", () => {
    expect(isRateLimitBody("")).toBe(false);
  });
});

describe("synthesizeRateLimitResponse", () => {
  it("returns status 429", () => {
    const result = synthesizeRateLimitResponse("Rate exceeded.");
    expect(result.status).toBe(429);
  });

  it("returns application/json content type", () => {
    const result = synthesizeRateLimitResponse("Rate exceeded.");
    expect(result.contentType).toBe("application/json");
  });

  it("returns valid JSON that can be parsed", () => {
    const result = synthesizeRateLimitResponse("Rate exceeded.");
    expect(() => JSON.parse(result.body)).not.toThrow();
  });

  it("returns a tRPC-compatible error structure", () => {
    const result = synthesizeRateLimitResponse("Rate exceeded.");
    const parsed = JSON.parse(result.body);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toHaveProperty("error");
    expect(parsed[0].error).toHaveProperty("json");
    expect(parsed[0].error.json).toHaveProperty("message");
    expect(parsed[0].error.json).toHaveProperty("code");
    expect(parsed[0].error.json.data.code).toBe("TOO_MANY_REQUESTS");
    expect(parsed[0].error.json.data.httpStatus).toBe(429);
  });

  it("includes a user-friendly message (no raw 'Rate exceeded.' exposed)", () => {
    const result = synthesizeRateLimitResponse("Rate exceeded.");
    const parsed = JSON.parse(result.body);
    const message = parsed[0].error.json.message as string;
    expect(message).not.toContain("Rate exceeded");
    expect(message.toLowerCase()).toContain("temporarily busy");
  });
});
