/**
 * discordLogin.test.ts
 *
 * Enforces critical invariants for the Discord-as-primary-login flow:
 *   1. ROUTE_PREFIX must be /api/auth/discord-login (Manus proxy only routes /api/*)
 *   2. /connect and /callback routes are registered
 *   3. Schema has the discord_login_states table
 *   4. ENV has all required Discord keys
 *   5. /connect uses JWT state (zero DB operations)
 *   6. /callback fetches Discord profile with access_token
 *   7. Access control is DB-level: discordId + hasAccess + expiryDate
 *   8. Profile update is fire-and-forget (setImmediate)
 *   9. Entire callback is wrapped in top-level try/catch (Express 4 async safety)
 *
 * NOTE: guilds.members.read scope has been intentionally removed.
 *   That scope requires the Discord bot to be in the guild. When the bot is not
 *   in the guild, Discord shows "Server Error" on the authorize page — blocking
 *   ALL users from logging in. Access control is enforced at the DB level instead.
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

describe("Discord login performance invariant — /callback fetch", () => {
  it("/callback fetches Discord profile via /users/@me", () => {
    expect(SRC).toContain("/users/@me");
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

describe("Discord login access control invariant — DB-level", () => {
  it("discordLogin.ts uses only 'identify' scope (no guilds.members.read)", () => {
    // guilds.members.read requires bot in guild — causes Discord 'Server Error'
    // when bot is not present. Scope intentionally removed; access controlled by DB.
    expect(SRC).toContain(`const OAUTH_SCOPES = "identify"`);
    expect(SRC).not.toContain(`"identify guilds.members.read"`);
  });

  it("discordLogin.ts looks up user by discordId in DB", () => {
    expect(SRC).toContain("appUsers.discordId");
    expect(SRC).toContain("discordId");
  });

  it("discordLogin.ts checks hasAccess before issuing session", () => {
    expect(SRC).toContain("hasAccess");
    expect(SRC).toContain("access_disabled");
  });

  it("discordLogin.ts checks expiryDate before issuing session", () => {
    expect(SRC).toContain("expiryDate");
    expect(SRC).toContain("account_expired");
  });

  it("discordLogin.ts redirects to no_account when discordId not in DB", () => {
    expect(SRC).toContain("no_account");
  });

  it("discordLogin.ts callback is wrapped in top-level try/catch (Express 4 async safety)", () => {
    // Express 4.x does NOT forward async errors to the error handler.
    // The callback MUST have a top-level try/catch to prevent raw 500 pages.
    expect(SRC).toContain("UNHANDLED_EXCEPTION");
    expect(SRC).toContain("server_error");
    // Verify the catch block checks headersSent before redirecting
    expect(SRC).toContain("headersSent");
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
