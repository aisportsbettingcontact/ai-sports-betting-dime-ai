/**
 * server/discord/roleMap.test.ts
 *
 * Pure tests for the plan→Discord-role mapping engine, plus source contracts
 * that discordRoleSync.ts actually consumes it and that every entitlement
 * path still routes through the sync module.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  computeDesiredRoleIds,
  managedRoleIds,
  parseRoleRegistry,
  planSlugForEnvKey,
} from "./roleMap";

const SUB = "10000000000000000001";
const TEAM = "10000000000000000002";
const SHARP = "10000000000000000003";
const PRO = "10000000000000000004";
const LEGACY = "10000000000000000005";

const ENV_FIXTURE = {
  DIME_AI_SUB: SUB,
  DIME_AI_TEAM: TEAM,
  DIME_AI_SHARP: SHARP,
  DIME_AI_PRO: PRO,
  DISCORD_ROLE_AI_MODEL_SUB: LEGACY,
  DIME_AI_URL: "https://aisportsbettingmodels.com", // NOT a role — must be filtered
  DIME_AI_MAX: "not-a-snowflake",                    // malformed — must be filtered
};

const REG = parseRoleRegistry(ENV_FIXTURE);
const NOW = Date.UTC(2026, 7, 4);

describe("parseRoleRegistry", () => {
  it("maps env keys to plan slugs by convention", () => {
    expect(planSlugForEnvKey("DIME_AI_SHARP")).toBe("dime-sharp");
    expect(planSlugForEnvKey("DIME_AI_PRO")).toBe("dime-pro");
  });

  it("builds baseline (new + legacy), team, and plan roles", () => {
    expect(REG.baselineRoleIds.sort()).toEqual([SUB, LEGACY].sort());
    expect(REG.teamRoleId).toBe(TEAM);
    expect(REG.planRoleIds).toEqual({ "dime-sharp": SHARP, "dime-pro": PRO });
  });

  it("rejects non-snowflake values — DIME_AI_URL can never become a 'role'", () => {
    const all = managedRoleIds(REG);
    expect([...all].every((id) => /^\d{17,20}$/.test(id))).toBe(true);
    expect(all.has("https://aisportsbettingmodels.com")).toBe(false);
    expect(REG.planRoleIds["dime-max"]).toBeUndefined();
  });

  it("empty env → empty registry (sync becomes a no-op, never an error)", () => {
    const empty = parseRoleRegistry({});
    expect(managedRoleIds(empty).size).toBe(0);
  });
});

describe("computeDesiredRoleIds", () => {
  const sharpUser = { role: "user", hasAccess: true, expiryDate: null, pendingSetup: false, stripePlanId: "dime-sharp" };

  it("entitled sharp member → baseline + legacy + SHARP", () => {
    expect([...computeDesiredRoleIds(sharpUser, REG, NOW)].sort()).toEqual([SUB, LEGACY, SHARP].sort());
  });

  it("owner/admin → adds TEAM; plain user does not get TEAM", () => {
    const admin = { ...sharpUser, role: "admin", stripePlanId: null };
    expect(computeDesiredRoleIds(admin, REG, NOW).has(TEAM)).toBe(true);
    expect(computeDesiredRoleIds(sharpUser, REG, NOW).has(TEAM)).toBe(false);
  });

  it("unknown plan slug → baseline only, never a guessed role", () => {
    const mystery = { ...sharpUser, stripePlanId: "dime-galactic" };
    expect([...computeDesiredRoleIds(mystery, REG, NOW)].sort()).toEqual([SUB, LEGACY].sort());
  });

  it("expiry in the past → nothing (roles will be revoked)", () => {
    expect(computeDesiredRoleIds({ ...sharpUser, expiryDate: NOW - 1 }, REG, NOW).size).toBe(0);
  });

  it("expiry exactly now is NOT expired (matches appUserProcedure's strict >)", () => {
    expect(computeDesiredRoleIds({ ...sharpUser, expiryDate: NOW }, REG, NOW).size).toBeGreaterThan(0);
  });

  it("hasAccess=false or pendingSetup=true → nothing", () => {
    expect(computeDesiredRoleIds({ ...sharpUser, hasAccess: false }, REG, NOW).size).toBe(0);
    expect(computeDesiredRoleIds({ ...sharpUser, pendingSetup: true }, REG, NOW).size).toBe(0);
  });

  it("entitledOverride=false forces empty even for a fully entitled row (stale-row revoke)", () => {
    expect(computeDesiredRoleIds(sharpUser, REG, NOW, false).size).toBe(0);
  });
});

// ─── Source contracts ────────────────────────────────────────────────────────

describe("wiring contracts", () => {
  const syncSrc = fs.readFileSync(path.join(__dirname, "discordRoleSync.ts"), "utf8");

  it("discordRoleSync consumes the roleMap engine and diffs within the managed set only", () => {
    expect(syncSrc).toContain("computeDesiredRoleIds(");
    expect(syncSrc).toContain("managedRoleIds(");
    expect(syncSrc).toContain("managed.has(r) && !desired.has(r)");
  });

  it("Authorization header is merged LAST (the 401 header-clobber bug class)", () => {
    expect(syncSrc).toMatch(/\.\.\.init,\s*\n\s*headers:\s*{\s*\n\s*Authorization/);
  });

  it("every entitlement path still routes through the sync module", () => {
    const webhook = fs.readFileSync(path.join(__dirname, "..", "stripeWebhook.ts"), "utf8");
    const oauth = fs.readFileSync(path.join(__dirname, "..", "discordAuth.ts"), "utf8");
    const stripeRouter = fs.readFileSync(path.join(__dirname, "..", "routers", "stripe.ts"), "utf8");
    expect(webhook).toContain("syncDiscordRoleForUser(user, true)");
    expect(webhook).toContain("syncDiscordRoleForUser(user, false)");
    expect(oauth).toContain("syncDiscordRole(");
    expect(stripeRouter).toContain("syncDiscordRoleForUser(");
  });

  it("resetPassword auto-logs-in (seamless claim → Connect Discord)", () => {
    const appUsersSrc = fs.readFileSync(path.join(__dirname, "..", "routers", "appUsers.ts"), "utf8");
    const block = appUsersSrc.slice(appUsersSrc.indexOf("resetPassword: publicProcedure"), appUsersSrc.indexOf("setManualDiscordId:"));
    expect(block).toContain("signAppUserToken(input.uid, user.role, newTokenVersion)");
    expect(block).toContain("ctx.res.cookie(APP_USER_COOKIE");
  });
});
