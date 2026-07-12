import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { canAccessDimeModel, DIME_MODEL_ACCESS_MESSAGE } from "./dimeModelAccess";

/**
 * Owner-only Dime Chat entitlement (restored per plan A1, 2026-07-12).
 *
 * Policy under test: the Dime Chat AI model answers role="owner" accounts
 * only. Every other account — active subscribers included — must be refused
 * with a 403 before any Anthropic call, any SSE stream, and (deliberately)
 * before the provider-freeze branch, so the policy still holds when the
 * provider is unfrozen. These tests lock both the pure decision function and
 * the chat-route wiring so a refactor cannot silently reopen the model.
 *
 * Scope note: unlike the original 2026-07-12 lockdown, only POST
 * /api/dime/chat and trpc claude.chat are gated — the wc2026 route and Bet
 * Tracker lockdowns reverted by PR #76 stay reverted (plan "out of scope").
 */

const chatRouteSrc = fs.readFileSync(
  path.join(import.meta.dirname, "dime-chat.route.ts"),
  "utf8"
);
const claudeRouterSrc = fs.readFileSync(
  path.join(import.meta.dirname, "claudeRouter.ts"),
  "utf8"
);

describe("canAccessDimeModel — owner-only decision", () => {
  it("grants access to an enabled owner account", () => {
    expect(canAccessDimeModel({ role: "owner", hasAccess: true })).toBe(true);
  });

  it("denies a disabled owner account (hasAccess=false)", () => {
    expect(canAccessDimeModel({ role: "owner", hasAccess: false })).toBe(false);
  });

  it.each(["admin", "handicapper", "user"])(
    "denies role=%s even with hasAccess=true (subscribers are NOT entitled)",
    role => {
      expect(canAccessDimeModel({ role, hasAccess: true })).toBe(false);
    }
  );

  it("denies missing/unknown users", () => {
    expect(canAccessDimeModel(null)).toBe(false);
    expect(canAccessDimeModel(undefined)).toBe(false);
  });

  it("denies lookalike role strings — exact match only", () => {
    expect(canAccessDimeModel({ role: "Owner", hasAccess: true })).toBe(false);
    expect(canAccessDimeModel({ role: "owner ", hasAccess: true })).toBe(false);
    expect(canAccessDimeModel({ role: "co-owner", hasAccess: true })).toBe(false);
  });

  it("exposes the hardcoded non-owner copy", () => {
    expect(DIME_MODEL_ACCESS_MESSAGE).toBe("AI Model access will be available soon");
  });
});

describe("POST /api/dime/chat — route wiring", () => {
  it("derives entitlement from the shared policy against the DB user (not the JWT role)", () => {
    expect(chatRouteSrc).toMatch(
      /import \{ canAccessDimeModel, DIME_MODEL_ACCESS_MESSAGE \} from "\.\/dimeModelAccess"/
    );
    expect(chatRouteSrc).toMatch(
      /async function checkDimeChatEntitlement\(userId: number\): Promise<boolean> \{\s*const user = await getAppUserById\(userId\);\s*return canAccessDimeModel\(user\);/
    );
    // The old JWT-role shortcut must not come back.
    expect(chatRouteSrc).not.toMatch(/if \(role === "owner"\) return true/);
  });

  it("refuses non-owners with a 403 carrying the hardcoded copy", () => {
    expect(chatRouteSrc).toMatch(
      /res\.status\(403\)\.json\(\{ error: DIME_MODEL_ACCESS_MESSAGE \}\)/
    );
  });

  it("orders the gates: auth → entitlement → rate limit → provider freeze", () => {
    const authIdx = chatRouteSrc.indexOf("await authenticateDimeRequest(req)");
    const entitlementIdx = chatRouteSrc.indexOf(
      "await checkDimeChatEntitlement(authedUser.userId)"
    );
    const rateIdx = chatRouteSrc.indexOf(
      "checkDimeChatRateLimit(authedUser.userId)"
    );
    const freezeIdx = chatRouteSrc.indexOf(
      'DIME_CHAT_LLM_PROVIDER !== "anthropic"'
    );
    expect(authIdx).toBeGreaterThan(-1);
    expect(entitlementIdx).toBeGreaterThan(authIdx);
    expect(rateIdx).toBeGreaterThan(entitlementIdx);
    // Non-owners must 403 BEFORE the frozen-notice stream can answer them.
    expect(freezeIdx).toBeGreaterThan(entitlementIdx);
  });
});

describe("trpc claude.chat — stays owner-only", () => {
  it("runs on ownerProcedure", () => {
    expect(claudeRouterSrc).toMatch(/chat: ownerProcedure/);
  });
});
