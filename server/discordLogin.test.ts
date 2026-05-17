/**
 * discordLogin.test.ts
 *
 * Enforces critical invariants for the Discord-as-primary-login flow:
 *   1. ROUTE_PREFIX must be /api/auth/discord-login (Manus proxy only routes /api/*)
 *   2. /connect and /callback routes are registered
 *   3. Schema has the discord_login_states table
 *   4. ENV has all required Discord keys
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
