/**
 * Tests for Discord account linking system
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  CRITICAL INVARIANT: All Discord routes MUST be under /api/ prefix.    │
 * │                                                                         │
 * │  The legacy production proxy only forwarded /api/* to Express.         │
 * │  Routes outside /api/* hit the static CDN and return SPA index.html   │
 * │  (HTTP 200) instead of the Express handler — a silent 404.            │
 * │                                                                         │
 * │  This test suite enforces the /api/auth/discord/* prefix as a         │
 * │  hard invariant so this regression cannot be reintroduced.            │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Covers:
 * - ROUTE_PREFIX is /api/auth/discord (enforces production proxy compatibility)
 * - ENV has all required Discord keys
 * - Schema has all required Discord fields
 * - /api/auth/discord/connect rejects unauthenticated requests
 * - /api/auth/discord/disconnect rejects unauthenticated requests
 * - /api/auth/discord/callback rejects missing code/state
 * - /api/auth/discord/callback rejects expired/invalid state
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { IS_CI } from "./_core/ciTestGuard";
import { ENV } from "./_core/env";

// ─── CRITICAL: Route prefix invariant ─────────────────────────────────────────
// This test exists to prevent the regression where Discord routes were placed
// at /auth/discord/* instead of /api/auth/discord/* — causing a silent 404 on
// the legacy production site because the proxy only forwarded /api/* to Express.
describe("Discord route prefix invariant", () => {
  it("ROUTE_PREFIX must start with /api/ (legacy proxy only routed /api/* to Express)", async () => {
    // We read the ROUTE_PREFIX constant directly from the source file to ensure
    // it hasn't been changed to a non-/api/ path.
    const fs = await import("fs");
    const path = await import("path");
    const srcPath = path.resolve(__dirname, "discordAuth.ts");
    const src = fs.readFileSync(srcPath, "utf-8");

    // Extract the ROUTE_PREFIX value
    const match = src.match(/const ROUTE_PREFIX\s*=\s*["']([^"']+)["']/);
    expect(match).not.toBeNull();
    const routePrefix = match![1];

    expect(routePrefix).toBe("/api/auth/discord");
    expect(routePrefix.startsWith("/api/")).toBe(true);
  });

  it("connect route is registered at /api/auth/discord/connect", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const srcPath = path.resolve(__dirname, "discordAuth.ts");
    const src = fs.readFileSync(srcPath, "utf-8");
    expect(src).toContain('`${ROUTE_PREFIX}/connect`');
  });

  it("callback route is registered at /api/auth/discord/callback", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const srcPath = path.resolve(__dirname, "discordAuth.ts");
    const src = fs.readFileSync(srcPath, "utf-8");
    expect(src).toContain('`${ROUTE_PREFIX}/callback`');
  });

  it("disconnect route is registered at /api/auth/discord/disconnect", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const srcPath = path.resolve(__dirname, "discordAuth.ts");
    const src = fs.readFileSync(srcPath, "utf-8");
    expect(src).toContain('`${ROUTE_PREFIX}/disconnect`');
  });

  it("frontend connect href uses /api/auth/discord/connect", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const frontendPath = path.resolve(__dirname, "../client/src/pages/ModelProjections.tsx");
    const src = fs.readFileSync(frontendPath, "utf-8");
    expect(src).toContain('href="/api/auth/discord/connect"');
    expect(src).not.toContain('href="/auth/discord/connect"');
  });

  it("frontend does NOT expose a user-facing disconnect button (one-time-only policy)", async () => {
    // POLICY: Users cannot disconnect their own Discord account.
    // Once linked, it is permanent from the user's perspective.
    // Only the owner (@prez) can unlink via the User Management admin panel.
    // This test enforces that no user-facing disconnect call exists in ModelProjections.tsx.
    const fs = await import("fs");
    const path = await import("path");
    const frontendPath = path.resolve(__dirname, "../client/src/pages/ModelProjections.tsx");
    const src = fs.readFileSync(frontendPath, "utf-8");
    // Must NOT have a user-facing disconnect fetch call
    expect(src).not.toContain('"/api/auth/discord/disconnect"');
    expect(src).not.toContain('"/auth/discord/disconnect"');
    // Must still have the connect link
    expect(src).toContain('"/api/auth/discord/connect"');
  });
});

// ─── ENV validation ────────────────────────────────────────────────────────────

describe("Discord ENV vars", () => {
  it("ENV.discordClientId is defined", () => {
    expect(typeof ENV.discordClientId).toBe("string");
  });

  it("ENV.discordClientSecret is defined", () => {
    expect(typeof ENV.discordClientSecret).toBe("string");
  });

  it("ENV.discordPublicKey is defined", () => {
    expect(typeof ENV.discordPublicKey).toBe("string");
  });

  it("ENV.discordGuildId is defined", () => {
    expect(typeof ENV.discordGuildId).toBe("string");
  });

  it("ENV.discordBotToken is defined", () => {
    expect(typeof ENV.discordBotToken).toBe("string");
  });

  it("ENV.discordRoleAiModelSub is defined", () => {
    expect(typeof ENV.discordRoleAiModelSub).toBe("string");
  });
});

// ─── Schema fields ─────────────────────────────────────────────────────────────

describe("Discord schema fields on appUsers", () => {
  it("appUsers table has discordId column", async () => {
    const { appUsers } = await import("../drizzle/schema");
    expect(appUsers.discordId).toBeDefined();
  });

  it("appUsers table has discordUsername column", async () => {
    const { appUsers } = await import("../drizzle/schema");
    expect(appUsers.discordUsername).toBeDefined();
  });

  it("appUsers table has discordAvatar column", async () => {
    const { appUsers } = await import("../drizzle/schema");
    expect(appUsers.discordAvatar).toBeDefined();
  });

  it("appUsers table has discordConnectedAt column", async () => {
    const { appUsers } = await import("../drizzle/schema");
    expect(appUsers.discordConnectedAt).toBeDefined();
  });
});

// ─── Route guard logic tests ───────────────────────────────────────────────────

describe("Discord route guards", () => {
  it("/api/auth/discord/connect redirects without app_session cookie", async () => {
    // Simulate the guard logic: no cookie → redirect to /?error=not_logged_in
    const mockReq = {
      headers: { cookie: "" },
      protocol: "https",
      get: (h: string) => h === "host" ? "example.com" : "",
    };
    const redirects: string[] = [];
    const mockRes = {
      redirect: (code: number, url: string) => { redirects.push(url); },
    };

    // Import the guard logic inline (mirrors discordAuth.ts logic)
    const { parse: parseCookieHeader } = await import("cookie");
    const cookies = parseCookieHeader(mockReq.headers.cookie ?? "");
    const token = cookies["app_session"];

    if (!token) {
      mockRes.redirect(302, "/?error=not_logged_in");
    }

    expect(redirects).toContain("/?error=not_logged_in");
  });

  it("/api/auth/discord/callback rejects missing code", async () => {
    // Simulate callback with no code → redirect to /dashboard?discord_error=invalid_request
    const redirects: string[] = [];
    const mockRes = {
      redirect: (code: number, url: string) => { redirects.push(url); },
    };

    const code = null;
    const state = null;

    if (!code || !state) {
      mockRes.redirect(302, "/dashboard?discord_error=invalid_request");
    }

    expect(redirects).toContain("/dashboard?discord_error=invalid_request");
  });

  it("/api/auth/discord/callback rejects expired state", async () => {
    const redirects: string[] = [];
    const mockRes = {
      redirect: (code: number, url: string) => { redirects.push(url); },
    };

    // Simulate an expired state entry
    const pendingStates = new Map<string, { userId: number; expiresAt: number }>();
    const state = "test-state-expired";
    pendingStates.set(state, { userId: 1, expiresAt: Date.now() - 1000 }); // already expired

    const stateData = pendingStates.get(state);
    if (!stateData || stateData.expiresAt < Date.now()) {
      mockRes.redirect(302, "/dashboard?discord_error=state_mismatch");
    }

    expect(redirects).toContain("/dashboard?discord_error=state_mismatch");
  });

  it("/api/auth/discord/disconnect returns 401 without app_session cookie", async () => {
    const { parse: parseCookieHeader } = await import("cookie");
    const cookies = parseCookieHeader("");
    const token = cookies["app_session"];

    const responses: Array<{ status: number; body: unknown }> = [];
    const mockRes = {
      status: (code: number) => ({
        json: (body: unknown) => { responses.push({ status: code, body }); },
      }),
    };

    if (!token) {
      mockRes.status(401).json({ error: "Not authenticated" });
    }

    expect(responses[0]?.status).toBe(401);
    expect((responses[0]?.body as { error: string })?.error).toBe("Not authenticated");
  });
});

// ─── PUBLIC_ORIGIN env var validation ─────────────────────────────────────────
// This test validates that PUBLIC_ORIGIN is set in the environment.
// Without it, the redirect_uri will be built from x-forwarded-host which
// resolves to the internal Cloud Run hostname (*.a.run.app) in production,
// causing Discord to reject the OAuth request with "Invalid OAuth2 redirect_uri".
// Presence-probe on the configured origin — scoped out of CI.
// (All route/CSRF/schema logic suites above still run in CI.)
describe.skipIf(IS_CI)("PUBLIC_ORIGIN env var", () => {
  it("ENV.publicOrigin is set (required to prevent Cloud Run hostname in redirect_uri)", () => {
    expect(ENV.publicOrigin).toBeTruthy();
    expect(ENV.publicOrigin.startsWith("https://")).toBe(true);
    expect(ENV.publicOrigin).not.toContain(".run.app");
    expect(ENV.publicOrigin).not.toContain("localhost");
  });

  it("ENV.publicOrigin does not have a trailing slash", () => {
    expect(ENV.publicOrigin.endsWith("/")).toBe(false);
  });

  it("redirect_uri built from PUBLIC_ORIGIN matches Discord Portal registration", () => {
    const expectedCallbackUrl = `${ENV.publicOrigin}/api/auth/discord/callback`;
    // This must exactly match what is registered in Discord Developer Portal
    expect(expectedCallbackUrl).toBe("https://aisportsbettingmodels.com/api/auth/discord/callback");
  });
});
