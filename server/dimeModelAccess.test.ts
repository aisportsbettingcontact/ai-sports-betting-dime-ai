import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { canAccessDimeModel, DIME_MODEL_ACCESS_MESSAGE } from "./dimeModelAccess";

/**
 * Owner-only lockdown tests (2026-07-12).
 *
 * Policy under test: the Dime Chat AI model answers role="owner" accounts only
 * (@prez, @sippi). Every other account — active subscribers included — must be
 * refused before any Anthropic call. These tests lock both the pure decision
 * function and the wiring of every Claude-invoking route so a future refactor
 * cannot silently reopen the model to non-owners.
 */

const chatRouteSrc = fs.readFileSync(
  path.join(import.meta.dirname, "dime-chat.route.ts"),
  "utf8"
);
const wc2026RouteSrc = fs.readFileSync(
  path.join(import.meta.dirname, "dime-wc2026.route.ts"),
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

describe("POST /api/dime/chat — owner-only wiring", () => {
  it("routes the entitlement decision through canAccessDimeModel", () => {
    expect(chatRouteSrc).toMatch(
      /import \{ canAccessDimeModel, DIME_MODEL_ACCESS_MESSAGE \} from "\.\/dimeModelAccess"/
    );
    expect(chatRouteSrc).toMatch(/return canAccessDimeModel\(user\)/);
  });

  it("no longer trusts the JWT role claim or bare hasAccess for entitlement", () => {
    expect(chatRouteSrc).not.toMatch(/if \(role === "owner"\) return true/);
    expect(chatRouteSrc).not.toMatch(/return !!user\?\.hasAccess/);
  });

  it("rejects non-owners with 403 + the hardcoded copy BEFORE the Anthropic stream", () => {
    const gateIdx = chatRouteSrc.indexOf("checkDimeChatEntitlement(authedUser.userId)");
    const rejectIdx = chatRouteSrc.indexOf(
      "res.status(403).json({ error: DIME_MODEL_ACCESS_MESSAGE })"
    );
    const streamIdx = chatRouteSrc.indexOf("anthropic.messages.stream");
    expect(gateIdx).toBeGreaterThan(-1);
    expect(rejectIdx).toBeGreaterThan(gateIdx);
    expect(streamIdx).toBeGreaterThan(rejectIdx);
  });
});

describe("POST /api/dime/wc2026 — owner-only wiring", () => {
  it("routes the entitlement decision through canAccessDimeModel", () => {
    expect(wc2026RouteSrc).toMatch(
      /import \{ canAccessDimeModel, DIME_MODEL_ACCESS_MESSAGE \} from "\.\/dimeModelAccess"/
    );
    expect(wc2026RouteSrc).toMatch(
      /if \(!canAccessDimeModel\(user\)\) return \{ valid: false, reason: "OWNER_ONLY" \}/
    );
  });

  it("no longer grants access to admins or Stripe subscribers", () => {
    expect(wc2026RouteSrc).not.toMatch(
      /user\.role === "owner" \|\| user\.role === "admin"/
    );
    expect(wc2026RouteSrc).not.toMatch(/stripeSubscriptionId\) return \{ valid: true \}/);
  });

  it("rejects non-owners with the hardcoded copy BEFORE the Anthropic stream", () => {
    const rejectIdx = wc2026RouteSrc.indexOf("error: DIME_MODEL_ACCESS_MESSAGE");
    const streamIdx = wc2026RouteSrc.indexOf("anthropic.messages.stream");
    expect(rejectIdx).toBeGreaterThan(-1);
    expect(streamIdx).toBeGreaterThan(rejectIdx);
  });
});

describe("trpc claude.chat — owner-only wiring", () => {
  it("is built on ownerProcedure (DB-authoritative role check)", () => {
    expect(claudeRouterSrc).toMatch(
      /import \{ ownerProcedure \} from "\.\/routers\/appUsers"/
    );
    expect(claudeRouterSrc).toMatch(/chat: ownerProcedure/);
  });
});
