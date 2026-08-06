/**
 * Unit tests for PublishProjections UX logic:
 * - ML inverse (straight sign flip, always show + on positive)
 * - Spread inverse (sign flip with + prefix on positive)
 * - EditablePill input sanitization (allow negative numbers)
 */

import { describe, it, expect } from "vitest";

// ── ML inverse logic (mirrors the mlInverse function in PublishProjections.tsx) ──
function mlInverse(val: string): string {
  const n = parseFloat(val);
  if (isNaN(n) || val === "" || val === "-") return "";
  const inv = -n;
  return inv > 0 ? `+${inv}` : String(inv);
}

// ── Spread inverse logic (mirrors handleAwaySpreadChange) ──
function spreadInverse(val: string): string {
  const n = parseFloat(val);
  if (isNaN(n)) return "";
  if (n === 0) return "0";
  return n > 0 ? String(-n) : `+${-n}`;
}

// ── Input sanitization (mirrors EditablePill handleChange) ──
function sanitizeInput(raw: string): string {
  const cleaned = raw.replace(/[^\d.\-]/g, "");
  return cleaned.replace(/(?!^)-/g, "").replace(/(\..*)\./g, "$1");
}

describe("ML inverse logic", () => {
  it("flips -101 to +101", () => {
    expect(mlInverse("-101")).toBe("+101");
  });
  it("flips -130 to +130", () => {
    expect(mlInverse("-130")).toBe("+130");
  });
  it("flips +250 to -250", () => {
    expect(mlInverse("+250")).toBe("-250");
  });
  it("flips 250 (no sign) to -250", () => {
    expect(mlInverse("250")).toBe("-250");
  });
  it("flips -110 to +110", () => {
    expect(mlInverse("-110")).toBe("+110");
  });
  it("returns empty for empty string", () => {
    expect(mlInverse("")).toBe("");
  });
  it("returns empty for bare minus", () => {
    expect(mlInverse("-")).toBe("");
  });
  it("returns empty for non-numeric", () => {
    expect(mlInverse("abc")).toBe("");
  });
  it("handles -100 → +100", () => {
    expect(mlInverse("-100")).toBe("+100");
  });
  it("handles +100 → -100", () => {
    expect(mlInverse("+100")).toBe("-100");
  });
});

describe("Spread inverse logic", () => {
  it("flips +5.5 to -5.5", () => {
    expect(spreadInverse("+5.5")).toBe("-5.5");
  });
  it("flips -5.5 to +5.5", () => {
    expect(spreadInverse("-5.5")).toBe("+5.5");
  });
  it("flips 5.5 (no sign) to -5.5", () => {
    expect(spreadInverse("5.5")).toBe("-5.5");
  });
  it("handles 0 → 0", () => {
    expect(spreadInverse("0")).toBe("0");
  });
  it("returns empty for non-numeric", () => {
    expect(spreadInverse("abc")).toBe("");
  });
  it("flips -14.5 to +14.5", () => {
    expect(spreadInverse("-14.5")).toBe("+14.5");
  });
  it("flips +14.5 to -14.5", () => {
    expect(spreadInverse("+14.5")).toBe("-14.5");
  });
});

describe("EditablePill input sanitization", () => {
  it("allows negative numbers: -130", () => {
    expect(sanitizeInput("-130")).toBe("-130");
  });
  it("strips non-numeric characters", () => {
    expect(sanitizeInput("abc123")).toBe("123");
  });
  it("allows decimal: 148.5", () => {
    expect(sanitizeInput("148.5")).toBe("148.5");
  });
  it("strips duplicate dots: 14.8.5 → 14.85 (second dot removed, digit kept)", () => {
    // The regex removes the second dot but keeps the trailing digit
    expect(sanitizeInput("14.8.5")).toBe("14.85");
  });
  it("allows leading minus: -5.5", () => {
    expect(sanitizeInput("-5.5")).toBe("-5.5");
  });
  it("strips mid-string minus: 5-5", () => {
    expect(sanitizeInput("5-5")).toBe("55");
  });
  it("allows bare minus for in-progress typing: -", () => {
    expect(sanitizeInput("-")).toBe("-");
  });
  it("strips plus sign (handled by mlInverse output, not raw input)", () => {
    // The + prefix is added programmatically by mlInverse, not typed by user
    expect(sanitizeInput("+130")).toBe("130");
  });
});
