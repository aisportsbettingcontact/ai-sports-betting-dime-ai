/**
 * client/src/lib/errorUtils.test.ts
 *
 * Locks the zod-issue humanization: tRPC input-validation failures arrive as
 * the raw JSON.stringify of the issue array, and that JSON reached a user's
 * screen verbatim (owner report, 2026-08-03 — invite-link toast). Backend JSON
 * must never render in a toast or panel again.
 */
import { describe, it, expect } from "vitest";
import { formatMutationError } from "./errorUtils";

describe("formatMutationError — zod issue arrays", () => {
  it("renders only the human message fields, never the raw JSON", () => {
    const raw = JSON.stringify(
      [
        {
          origin: "string",
          code: "too_small",
          minimum: 20,
          inclusive: true,
          path: ["token"],
          message: "Too small: expected string to have >=20 characters",
        },
      ],
      null,
      2
    );
    const out = formatMutationError(new Error(raw));
    expect(out).toBe(
      "token: Too small: expected string to have >=20 characters"
    );
    expect(out).not.toContain("{");
    expect(out).not.toContain("origin");
  });

  it("joins multiple issues readably", () => {
    const raw = JSON.stringify([
      { path: ["email"], message: "Invalid email address" },
      { path: ["password"], message: "Password must be at least 8 characters" },
    ]);
    expect(formatMutationError(new Error(raw))).toBe(
      "email: Invalid email address · password: Password must be at least 8 characters"
    );
  });

  it("leaves non-JSON bracket-leading messages alone", () => {
    expect(formatMutationError(new Error("[Stripe] payment failed"))).toContain(
      "payment failed"
    );
  });

  it("leaves ordinary server messages untouched", () => {
    expect(
      formatMutationError(new Error("Invalid or expired reset link."))
    ).toBe("Invalid or expired reset link.");
  });
});
