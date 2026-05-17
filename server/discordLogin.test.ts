/**
 * discordLogin.test.ts
 *
 * Enforces critical invariants for the Discord-as-primary-login flow:
 *   1. ROUTE_PREFIX must be /api/auth/discord-login (Manus proxy only routes /api/*)
 *   2. /connect and /callback routes are registered
 *   3. Schema has the discord_login_states table
 *   4. ENV has all required Discord keys
 *   5. /connect uses JWT state (zero DB operations)
 *   6. /callback uses parallel fetch for profile + guild member
 *   7. Role check is inline (no separate checkGuildRole function needed)
 *   8. Profile update is fire-and-forget (setImmediate)
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SRC = fs.readFileSync(
  path.resolve(__dirname, "discordLogin.ts"),
  "utf-8"
);

describe("Discord login route prefix invariant", () => {
  it("ROUTE_PREFIX must be /api/auth/discord-login", () => {
    const match = SRC.match(/const ROUTE_PREFIX\s*=\s*["']([^"']+)["']/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("/api/auth/discord-login");
    expect(match![1].startsWith("/api/")).toBe(true);
  });

  it("connect route is registered at /api/auth/discord-login/connect", () => {
    expect(SRC).toContain("`${ROUTE_PREFIX}/connect`");
  });

  it("callback route is registered at /api/auth/discord-login/callback", () => {
    expect(SRC).toContain("`${ROUTE_PREFIX}/callback`");
  });
});

describe("Discord login schema invariant", () => {
  it("schema exports discordLoginStates table", () => {
    const schema = fs.readFileSync(
      path.resolve(__dirname, "../drizzle/schema.ts"),
      "utf-8"
    );
    expect(schema).toContain("discordLoginStates");
    expect(schema).toContain("discord_login_states");
  });
});

describe("Discord login ENV invariant", () => {
  it("ENV has discordClientId", () => {
    const envSrc = fs.readFileSync(
      path.resolve(__dirname, "_core/env.ts"),
      "utf-8"
    );
    expect(envSrc).toContain("discordClientId");
    expect(envSrc).toContain("DISCORD_CLIENT_ID");
  });

  it("ENV has discordClientSecret", () => {
    const envSrc = fs.readFileSync(
      path.resolve(__dirname, "_core/env.ts"),
      "utf-8"
    );
    expect(envSrc).toContain("discordClientSecret");
    expect(envSrc).toContain("DISCORD_CLIENT_SECRET");
  });
});

describe("Discord login performance invariant — /connect zero-DB", () => {
  it("discordLogin.ts uses JWT state (createStateToken) — no DB write on /connect", () => {
    expect(SRC).toContain("createStateToken");
    expect(SRC).toContain("verifyStateToken");
  });

  it("/connect handler does NOT call getDb() or db.insert before redirect", () => {
    // The /connect handler must not contain a DB insert
    // Extract the /connect handler body (between /connect and /callback)
    const connectStart = SRC.indexOf("`${ROUTE_PREFIX}/connect`");
    const callbackStart = SRC.indexOf("`${ROUTE_PREFIX}/callback`");
    expect(connectStart).toBeGreaterThan(0);
    expect(callbackStart).toBeGreaterThan(connectStart);
    const connectBody = SRC.slice(connectStart, callbackStart);
    expect(connectBody).not.toContain("db.insert");
    expect(connectBody).not.toContain("db.delete");
    expect(connectBody).not.toContain("await getDb()");
  });

  it("JWT state uses HS256 algorithm", () => {
    expect(SRC).toContain(`alg: "HS256"`);
  });

  it("JWT state TTL is 10 minutes", () => {
    expect(SRC).toContain("STATE_TTL_MS");
    expect(SRC).toContain("10 * 60 * 1000");
  });
});

describe("Discord login performance invariant — /callback parallel fetch", () => {
  it("/callback uses Promise.allSettled for parallel Discord API calls", () => {
    expect(SRC).toContain("Promise.allSettled");
  });

  it("/callback profile update is fire-and-forget (setImmediate)", () => {
    expect(SRC).toContain("setImmediate");
  });

  it("/callback redirects BEFORE profile update (redirect before setImmediate)", () => {
    const redirectIdx = SRC.lastIndexOf("res.redirect(302, returnPath)");
    const setImmediateIdx = SRC.indexOf("setImmediate");
    expect(redirectIdx).toBeGreaterThan(0);
    expect(setImmediateIdx).toBeGreaterThan(0);
    expect(setImmediateIdx).toBeGreaterThan(redirectIdx);
  });
});

describe("Discord login role check invariant", () => {
  it("discordLogin.ts uses guilds.members.read scope", () => {
    expect(SRC).toContain("guilds.members.read");
  });

  it("discordLogin.ts checks ENV.discordGuildId and ENV.discordRoleAiModelSub", () => {
    expect(SRC).toContain("ENV.discordGuildId");
    expect(SRC).toContain("ENV.discordRoleAiModelSub");
  });

  it("discordLogin.ts redirects to missing_role and not_in_guild errors", () => {
    expect(SRC).toContain("missing_role");
    expect(SRC).toContain("not_in_guild");
  });

  it("discordLogin.ts uses /users/@me/guilds endpoint (no bot token required)", () => {
    expect(SRC).toContain("/users/@me/guilds/");
  });

  it("Home.tsx shows error messages for not_in_guild and missing_role", () => {
    const home = fs.readFileSync(
      path.resolve(__dirname, "../client/src/pages/Home.tsx"),
      "utf-8"
    );
    expect(home).toContain("not_in_guild");
    expect(home).toContain("missing_role");
    expect(home).toContain("AI Model Sub");
  });
});

describe("Discord login frontend invariant", () => {
  it("LoginModal uses /api/auth/discord-login/connect (not old /api/auth/discord/connect)", () => {
    const modal = fs.readFileSync(
      path.resolve(__dirname, "../client/src/components/LoginModal.tsx"),
      "utf-8"
    );
    expect(modal).toContain("/api/auth/discord-login/connect");
    expect(modal).not.toContain("appUsers.login");
    expect(modal).not.toContain("trpc.appUsers.login");
  });

  it("Home.tsx uses /api/auth/discord-login/connect", () => {
    const home = fs.readFileSync(
      path.resolve(__dirname, "../client/src/pages/Home.tsx"),
      "utf-8"
    );
    expect(home).toContain("/api/auth/discord-login/connect");
    expect(home).not.toContain("appUsers.login");
  });
});
