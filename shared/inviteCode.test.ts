/**
 * shared/inviteCode.test.ts — codec round-trip + rejection cases for the
 * compact /invite/<code> links (see shared/inviteCode.ts).
 */
import { describe, it, expect } from "vitest";
import { buildInviteCode, parseInviteCode } from "./inviteCode";

describe("invite code codec", () => {
  it("round-trips uid + token", () => {
    const code = buildInviteCode(1680001, "invite_token_fixture-0");
    expect(code).toBe("100ap.invite_token_fixture-0");
    expect(parseInviteCode(code)).toEqual({
      uid: 1680001,
      token: "invite_token_fixture-0",
    });
  });

  it("round-trips every uid shape including small ids", () => {
    for (const uid of [1, 12, 480001, 1680001, 9007199254740]) {
      const parsed = parseInviteCode(
        buildInviteCode(uid, "aaaaaaaaaaaaaaaaaaaaaa")
      );
      expect(parsed?.uid).toBe(uid);
    }
  });

  it("accepts legacy-length 64-hex tokens too (single codec, both eras)", () => {
    const hex =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    expect(parseInviteCode(buildInviteCode(7, hex))?.token).toBe(hex);
  });

  it("rejects malformed codes", () => {
    for (const bad of [
      "",
      "nodot",
      ".leading",
      "trailing.",
      "0.token1234567890123456789",
      "-1.aaaaaaaaaaaaaaaaaaaaaa",
      "abc.short",
      "a b.aaaaaaaaaaaaaaaaaaaaaa",
      "abc.aaaaaaaaaaaaaaaaaaaaaa.extra",
    ]) {
      expect(parseInviteCode(bad), bad).toBeNull();
    }
  });
});
