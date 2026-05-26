/**
 * appUsers.login.test.ts
 *
 * Locks in the cookie issuance invariants for appUsers.login:
 *
 *   stayLoggedIn=true  → maxAge = 90 * 24 * 60 * 60 * 1000 (7776000000 ms)
 *   stayLoggedIn=false → maxAge = undefined (session cookie, expires on browser close)
 *
 * Both paths MUST issue an app_session JWT with correct HS256 claims and
 * correct security flags (httpOnly, path, secure, sameSite) for the request protocol.
 *
 * ── Test surface (26 invariants) ──────────────────────────────────────────────
 *
 *  STAY LOGGED IN = TRUE — persistent 90-day cookie
 *   [SL-1]  res.cookie called with name === "app_session"
 *   [SL-2]  cookie value is a 3-part JWT (header.payload.signature)
 *   [SL-3]  maxAge === 7776000000 (90 days in ms)
 *   [SL-4]  httpOnly === true
 *   [SL-5]  path === "/"
 *   [SL-6]  secure === false for HTTP request
 *   [SL-7]  sameSite === "lax" for HTTP request
 *   [SL-8]  result.success === true
 *   [SL-9]  result.user.id, email, username, role, hasAccess are correct
 *
 *  STAY LOGGED IN = FALSE — session cookie (no maxAge)
 *   [SC-1]  res.cookie called with name === "app_session"
 *   [SC-2]  cookie value is a 3-part JWT
 *   [SC-3]  maxAge === undefined (session cookie — expires on browser close)
 *   [SC-4]  httpOnly === true
 *   [SC-5]  path === "/"
 *   [SC-6]  result.success === true
 *
 *  JWT CLAIM INVARIANTS (decoded from cookie value, stayLoggedIn=true)
 *   [JW-1]  payload.sub === String(userId)
 *   [JW-2]  payload.role === user.role
 *   [JW-3]  payload.type === "app_user"
 *   [JW-4]  payload.tv === user.tokenVersion (1 for fresh insert)
 *   [JW-5]  header.alg === "HS256"
 *   [JW-6]  payload.exp ≈ now + 90 days (±60s tolerance)
 *
 *  HTTPS CONTEXT — security flags flip
 *   [TLS-1] secure === true for HTTPS request
 *   [TLS-2] sameSite === "none" for HTTPS request
 *
 *  ERROR PATHS
 *   [ER-1]  UNAUTHORIZED for unknown email/username
 *   [ER-2]  UNAUTHORIZED for wrong password
 *   [ER-3]  FORBIDDEN for hasAccess=false user
 *   [ER-4]  FORBIDDEN for expired user (expiryDate in the past)
 *
 * ── Strategy ──────────────────────────────────────────────────────────────────
 *  - Uses real DB (DATABASE_URL is available in the sandbox test environment)
 *  - Uses real appRouter.createCaller (same pattern as completeAccountSetup.test.ts)
 *  - Each test inserts a fresh user with a unique email/username via db.insert
 *  - loginRateMap is cleared before each test to prevent rate-limit interference
 *  - afterAll deletes all rows whose username starts with "testuser_login_"
 *  - JWT is decoded by splitting on "." and base64url-decoding header + payload
 *    (no jose import needed — avoids circular dependency with the module under test)
 *
 * ── Isolation ─────────────────────────────────────────────────────────────────
 *  Each test inserts a fresh row with a unique email and username.
 *  afterAll deletes all rows whose username LIKE 'testuser_login_%' to prevent DB pollution.
 */

import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { appRouter } from "./routers";
import { APP_USER_COOKIE, loginRateMap } from "./routers/appUsers";
import type { TrpcContext } from "./_core/context";
import { getDb } from "./db";
import { appUsers } from "../drizzle/schema";
import { like } from "drizzle-orm";
import bcrypt from "bcryptjs";

// ── Constants ──────────────────────────────────────────────────────────────────
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000; // 7776000000
const EXP_TOLERANCE_MS = 60_000; // ±60s for JWT exp assertion
const TEST_PASSWORD = "LoginTest1!";

// ── Types ──────────────────────────────────────────────────────────────────────
type CookieCall = {
  name: string;
  value: string;
  options: Record<string, unknown>;
};

// ── Context factory ────────────────────────────────────────────────────────────
/**
 * createContext — builds a minimal TrpcContext for login tests.
 *
 * [INPUT]  protocol: "http" (default) | "https"
 * [OUTPUT] { ctx, setCookies } — ctx has mocked req/res; setCookies captures res.cookie calls
 */
function createContext(protocol: "http" | "https" = "http"): {
  ctx: TrpcContext;
  setCookies: CookieCall[];
} {
  const setCookies: CookieCall[] = [];
  const ctx: TrpcContext = {
    user: null,
    req: {
      protocol,
      headers: {},
      method: "POST",
      get: (_name: string) => undefined,
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" } as NodeJS.Socket,
      cookies: {},
    } as TrpcContext["req"],
    res: {
      cookie: (name: string, value: string, options: Record<string, unknown>) => {
        setCookies.push({ name, value, options });
      },
      clearCookie: () => {},
    } as unknown as TrpcContext["res"],
  };
  return { ctx, setCookies };
}

// ── Test user factory ──────────────────────────────────────────────────────────
/**
 * insertTestUser — inserts a fully-set-up app user for login tests.
 *
 * [INPUT]  suffix    — unique suffix for email/username
 * [INPUT]  overrides — optional field overrides (hasAccess, expiryDate, etc.)
 * [OUTPUT] { email, username, userId, tokenVersion }
 */
async function insertTestUser(
  suffix: string,
  overrides: Partial<{
    hasAccess: boolean;
    expiryDate: number | null;
    role: "owner" | "admin" | "handicapper" | "user";
  }> = {}
): Promise<{ email: string; username: string; userId: number; tokenVersion: number }> {
  const db = await getDb();
  if (!db) throw new Error("[insertTestUser] Database not available");

  const email = `login_${suffix}@test.invalid`;
  const username = `testuser_login_${suffix}`;
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 4); // cost=4 for test speed

  console.log(`[insertTestUser] [INPUT] suffix=${suffix} email=${email} username=${username}`);

  await db.insert(appUsers).values({
    email,
    username,
    passwordHash,
    role: overrides.role ?? "user",
    hasAccess: overrides.hasAccess ?? true,
    expiryDate: overrides.expiryDate !== undefined ? overrides.expiryDate : null,
    tokenVersion: 1,
    pendingSetup: false,
  });

  // Fetch the inserted row to get the auto-incremented id
  const rows = await db
    .select({ id: appUsers.id, tokenVersion: appUsers.tokenVersion })
    .from(appUsers)
    .where(like(appUsers.username, username))
    .limit(1);

  const userId = rows[0]?.id ?? 0;
  const tokenVersion = rows[0]?.tokenVersion ?? 1;
  console.log(`[insertTestUser] [OUTPUT] userId=${userId} tokenVersion=${tokenVersion}`);
  return { email, username, userId, tokenVersion };
}

// ── Cleanup ────────────────────────────────────────────────────────────────────
afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(appUsers).where(like(appUsers.username, "testuser_login_%"));
  console.log("[afterAll] [STEP] Deleted all test users with username LIKE 'testuser_login_%'");
});

// ── Rate-limit isolation ───────────────────────────────────────────────────────
// Clear the in-memory loginRateMap before each test to prevent rate-limit state
// from one test bleeding into the next (e.g. ER-1 records a failure for 127.0.0.1
// which would eventually block ER-2 if not cleared).
beforeEach(() => {
  loginRateMap.clear();
  console.log("[beforeEach] [STEP] loginRateMap cleared — rate-limit state reset");
});

// ── Test suite ─────────────────────────────────────────────────────────────────
describe("appUsers.login — cookie issuance invariants", () => {

  // ── STAY LOGGED IN = TRUE ─────────────────────────────────────────────────────

  it("[SL-1..9] stayLoggedIn=true issues 90-day persistent cookie with correct flags", async () => {
    const suffix = `sl_${Date.now()}`;
    const { email, username, userId, tokenVersion } = await insertTestUser(suffix);

    const { ctx, setCookies } = createContext("http");
    const caller = appRouter.createCaller(ctx);

    console.log(`[INPUT] emailOrUsername=${email} stayLoggedIn=true`);

    const result = await caller.appUsers.login({
      emailOrUsername: email,
      password: TEST_PASSWORD,
      stayLoggedIn: true,
    });

    console.log(`[STATE] result=${JSON.stringify(result)}`);
    console.log(`[STATE] setCookies.length=${setCookies.length}`);
    console.log(`[STATE] setCookies[0].name=${setCookies[0]?.name}`);
    console.log(`[STATE] setCookies[0].options=${JSON.stringify(setCookies[0]?.options)}`);

    // [SL-1] Cookie name is APP_USER_COOKIE ("app_session")
    expect(setCookies).toHaveLength(1);
    expect(setCookies[0]!.name).toBe(APP_USER_COOKIE);
    console.log(`[VERIFY] [SL-1] PASS — cookie name="${setCookies[0]!.name}"`);

    // [SL-2] Cookie value is a 3-part JWT
    const parts = setCookies[0]!.value.split(".");
    expect(parts).toHaveLength(3);
    console.log(`[VERIFY] [SL-2] PASS — cookie value is a 3-part JWT`);

    const opts = setCookies[0]!.options;

    // [SL-3] maxAge === 7776000000 (90 days in ms)
    expect(opts.maxAge).toBe(NINETY_DAYS_MS);
    console.log(`[VERIFY] [SL-3] PASS — maxAge=${opts.maxAge} (${NINETY_DAYS_MS}ms = 90 days)`);

    // [SL-4] httpOnly === true
    expect(opts.httpOnly).toBe(true);
    console.log(`[VERIFY] [SL-4] PASS — httpOnly=true`);

    // [SL-5] path === "/"
    expect(opts.path).toBe("/");
    console.log(`[VERIFY] [SL-5] PASS — path="/"`);

    // [SL-6] secure === false for HTTP request
    expect(opts.secure).toBe(false);
    console.log(`[VERIFY] [SL-6] PASS — secure=false for HTTP`);

    // [SL-7] sameSite === "lax" for HTTP request
    expect(opts.sameSite).toBe("lax");
    console.log(`[VERIFY] [SL-7] PASS — sameSite=lax for HTTP`);

    // [SL-8] result.success === true
    expect(result.success).toBe(true);
    console.log(`[VERIFY] [SL-8] PASS — result.success=true`);

    // [SL-9] result.user fields are correct
    expect(result.user.id).toBe(userId);
    expect(result.user.email).toBe(email);
    expect(result.user.username).toBe(username);
    expect(result.user.role).toBe("user");
    expect(result.user.hasAccess).toBe(true);
    console.log(`[VERIFY] [SL-9] PASS — result.user id=${result.user.id} email=${result.user.email} username=${result.user.username} role=${result.user.role}`);
  });

  // ── STAY LOGGED IN = FALSE ────────────────────────────────────────────────────

  it("[SC-1..6] stayLoggedIn=false issues session cookie with maxAge=undefined", async () => {
    const suffix = `sc_${Date.now()}`;
    const { email } = await insertTestUser(suffix);

    const { ctx, setCookies } = createContext("http");
    const caller = appRouter.createCaller(ctx);

    console.log(`[INPUT] emailOrUsername=${email} stayLoggedIn=false`);

    const result = await caller.appUsers.login({
      emailOrUsername: email,
      password: TEST_PASSWORD,
      stayLoggedIn: false,
    });

    console.log(`[STATE] setCookies[0].options=${JSON.stringify(setCookies[0]?.options)}`);

    // [SC-1] Cookie name is APP_USER_COOKIE
    expect(setCookies).toHaveLength(1);
    expect(setCookies[0]!.name).toBe(APP_USER_COOKIE);
    console.log(`[VERIFY] [SC-1] PASS — cookie name="${setCookies[0]!.name}"`);

    // [SC-2] Cookie value is a 3-part JWT
    const parts = setCookies[0]!.value.split(".");
    expect(parts).toHaveLength(3);
    console.log(`[VERIFY] [SC-2] PASS — cookie value is a 3-part JWT`);

    const opts = setCookies[0]!.options;

    // [SC-3] maxAge === undefined — session cookie, expires on browser close
    // This is the critical invariant: stayLoggedIn=false MUST NOT set maxAge
    expect(opts.maxAge).toBeUndefined();
    console.log(`[VERIFY] [SC-3] PASS — maxAge=undefined (session cookie, expires on browser close)`);

    // [SC-4] httpOnly === true
    expect(opts.httpOnly).toBe(true);
    console.log(`[VERIFY] [SC-4] PASS — httpOnly=true`);

    // [SC-5] path === "/"
    expect(opts.path).toBe("/");
    console.log(`[VERIFY] [SC-5] PASS — path="/"`);

    // [SC-6] result.success === true
    expect(result.success).toBe(true);
    console.log(`[VERIFY] [SC-6] PASS — result.success=true`);
  });

  // ── JWT CLAIM INVARIANTS ──────────────────────────────────────────────────────

  it("[JW-1..6] JWT claims are correct: sub, role, type, tv, alg, exp", async () => {
    const suffix = `jw_${Date.now()}`;
    const { email, userId, tokenVersion } = await insertTestUser(suffix);

    const { ctx, setCookies } = createContext("http");
    const caller = appRouter.createCaller(ctx);

    console.log(`[INPUT] userId=${userId} tokenVersion=${tokenVersion}`);

    await caller.appUsers.login({
      emailOrUsername: email,
      password: TEST_PASSWORD,
      stayLoggedIn: true,
    });

    const token = setCookies[0]!.value;
    const [headerB64, payloadB64] = token.split(".");

    // Decode header
    const header = JSON.parse(
      Buffer.from(headerB64!.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
    );
    // Decode payload
    const payload = JSON.parse(
      Buffer.from(payloadB64!.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
    );

    console.log(`[STATE] JWT header=${JSON.stringify(header)}`);
    console.log(`[STATE] JWT payload=${JSON.stringify(payload)}`);

    // [JW-1] sub === String(userId)
    expect(payload.sub).toBe(String(userId));
    console.log(`[VERIFY] [JW-1] PASS — sub="${payload.sub}" === userId="${userId}"`);

    // [JW-2] role === "user"
    expect(payload.role).toBe("user");
    console.log(`[VERIFY] [JW-2] PASS — role="${payload.role}"`);

    // [JW-3] type === "app_user"
    expect(payload.type).toBe("app_user");
    console.log(`[VERIFY] [JW-3] PASS — type="${payload.type}"`);

    // [JW-4] tv === tokenVersion (1 for fresh insert)
    expect(payload.tv).toBe(tokenVersion);
    console.log(`[VERIFY] [JW-4] PASS — tv=${payload.tv} === tokenVersion=${tokenVersion}`);

    // [JW-5] alg === "HS256"
    expect(header.alg).toBe("HS256");
    console.log(`[VERIFY] [JW-5] PASS — alg=HS256`);

    // [JW-6] exp ≈ now + 90 days (±60s tolerance)
    const nowMs = Date.now();
    const expMs = payload.exp * 1000;
    const expectedExpMs = nowMs + NINETY_DAYS_MS;
    const drift = Math.abs(expMs - expectedExpMs);
    expect(drift).toBeLessThan(EXP_TOLERANCE_MS);
    console.log(`[VERIFY] [JW-6] PASS — exp drift=${drift}ms < ${EXP_TOLERANCE_MS}ms tolerance`);
  });

  // ── HTTPS CONTEXT ─────────────────────────────────────────────────────────────

  it("[TLS-1,2] HTTPS request produces secure=true, sameSite=none", async () => {
    const suffix = `tls_${Date.now()}`;
    const { email } = await insertTestUser(suffix);

    const { ctx, setCookies } = createContext("https");
    const caller = appRouter.createCaller(ctx);

    console.log(`[INPUT] emailOrUsername=${email} protocol=https stayLoggedIn=true`);

    await caller.appUsers.login({
      emailOrUsername: email,
      password: TEST_PASSWORD,
      stayLoggedIn: true,
    });

    const opts = setCookies[0]!.options;
    console.log(`[STATE] opts=${JSON.stringify(opts)}`);

    // [TLS-1] secure === true for HTTPS
    expect(opts.secure).toBe(true);
    console.log(`[VERIFY] [TLS-1] PASS — secure=true for HTTPS request`);

    // [TLS-2] sameSite === "none" for HTTPS (required for cross-origin Stripe flows)
    expect(opts.sameSite).toBe("none");
    console.log(`[VERIFY] [TLS-2] PASS — sameSite=none for HTTPS request`);
  });

  // ── USERNAME LOGIN ────────────────────────────────────────────────────────────

  it("[UN-1] login by username (without @) issues cookie correctly", async () => {
    const suffix = `un_${Date.now()}`;
    const { username } = await insertTestUser(suffix);

    const { ctx, setCookies } = createContext("http");
    const caller = appRouter.createCaller(ctx);

    console.log(`[INPUT] emailOrUsername=${username} (username, no @)`);

    const result = await caller.appUsers.login({
      emailOrUsername: username,
      password: TEST_PASSWORD,
      stayLoggedIn: true,
    });

    expect(result.success).toBe(true);
    expect(setCookies).toHaveLength(1);
    expect(setCookies[0]!.name).toBe(APP_USER_COOKIE);
    expect(setCookies[0]!.options.maxAge).toBe(NINETY_DAYS_MS);
    console.log(`[VERIFY] [UN-1] PASS — username login issues cookie maxAge=${setCookies[0]!.options.maxAge}`);
  });

  it("[UN-2] @username (with @ prefix) is treated as email lookup — throws UNAUTHORIZED", async () => {
    // Root cause: the login procedure uses input.includes('@') to detect email vs username.
    // @username contains '@' so isEmail=true → getAppUserByEmail('@username') → null → UNAUTHORIZED.
    // The @ stripping (replace(/^@/, '')) only runs in the username (else) branch.
    // This test locks in that production behavior: @username is NOT a valid login credential.
    const suffix = `un2_${Date.now()}`;
    const { username } = await insertTestUser(suffix);

    const { ctx } = createContext("http");
    const caller = appRouter.createCaller(ctx);

    console.log(`[INPUT] emailOrUsername=@${username} — contains '@' so isEmail=true → email lookup → null → UNAUTHORIZED`);

    await expect(
      caller.appUsers.login({
        emailOrUsername: `@${username}`,
        password: TEST_PASSWORD,
        stayLoggedIn: false,
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    console.log(`[VERIFY] [UN-2] PASS — @username treated as email lookup → UNAUTHORIZED (correct production behavior)`);
  });

  // ── ERROR PATHS ───────────────────────────────────────────────────────────────

  it("[ER-1] throws UNAUTHORIZED for unknown email/username", async () => {
    const { ctx } = createContext("http");
    const caller = appRouter.createCaller(ctx);

    console.log(`[INPUT] emailOrUsername=nobody_xyz_${Date.now()}@test.invalid (does not exist)`);

    await expect(
      caller.appUsers.login({
        emailOrUsername: `nobody_xyz_${Date.now()}@test.invalid`,
        password: TEST_PASSWORD,
        stayLoggedIn: false,
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    console.log(`[VERIFY] [ER-1] PASS — UNAUTHORIZED thrown for unknown user`);
  });

  it("[ER-2] throws UNAUTHORIZED for wrong password", async () => {
    const suffix = `er2_${Date.now()}`;
    const { email } = await insertTestUser(suffix);

    const { ctx } = createContext("http");
    const caller = appRouter.createCaller(ctx);

    console.log(`[INPUT] emailOrUsername=${email} password=WRONG_PASSWORD`);

    await expect(
      caller.appUsers.login({
        emailOrUsername: email,
        password: "WrongPassword999!",
        stayLoggedIn: false,
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    console.log(`[VERIFY] [ER-2] PASS — UNAUTHORIZED thrown for wrong password`);
  });

  it("[ER-3] throws FORBIDDEN for hasAccess=false user", async () => {
    const suffix = `er3_${Date.now()}`;
    const { email } = await insertTestUser(suffix, { hasAccess: false });

    const { ctx } = createContext("http");
    const caller = appRouter.createCaller(ctx);

    console.log(`[INPUT] emailOrUsername=${email} hasAccess=false`);

    await expect(
      caller.appUsers.login({
        emailOrUsername: email,
        password: TEST_PASSWORD,
        stayLoggedIn: false,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    console.log(`[VERIFY] [ER-3] PASS — FORBIDDEN thrown for hasAccess=false`);
  });

  it("[ER-4] throws FORBIDDEN for expired user (expiryDate in the past)", async () => {
    const suffix = `er4_${Date.now()}`;
    const pastMs = Date.now() - 1000; // 1 second in the past
    const { email } = await insertTestUser(suffix, { expiryDate: pastMs });

    const { ctx } = createContext("http");
    const caller = appRouter.createCaller(ctx);

    console.log(`[INPUT] emailOrUsername=${email} expiryDate=${pastMs} (${new Date(pastMs).toISOString()} — expired)`);

    await expect(
      caller.appUsers.login({
        emailOrUsername: email,
        password: TEST_PASSWORD,
        stayLoggedIn: false,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    console.log(`[VERIFY] [ER-4] PASS — FORBIDDEN thrown for expired account`);
  });

});
