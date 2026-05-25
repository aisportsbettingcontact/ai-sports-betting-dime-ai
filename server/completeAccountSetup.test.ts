/**
 * completeAccountSetup.test.ts
 *
 * Locks in the auto-login invariant for stripe.completeAccountSetup:
 * after a new user sets their email + password, the procedure MUST issue an
 * app_session JWT cookie so "Enter the Platform" navigates directly to /feed
 * without a re-login prompt.
 *
 * ── Test surface (22 invariants) ──────────────────────────────────────────────
 *
 *  HAPPY PATH — cookie issuance
 *   [HP-1] res.cookie is called with name === APP_USER_COOKIE ("app_session")
 *   [HP-2] cookie value is a parseable JWT (3-part dot-separated string)
 *   [HP-3] cookie options.httpOnly === true
 *   [HP-4] cookie options.path === "/"
 *   [HP-5] cookie options.maxAge === 90 * 24 * 60 * 60 * 1000 (90 days in ms)
 *   [HP-6] cookie options.secure === false for plain-HTTP req (dev/test)
 *   [HP-7] cookie options.sameSite === "lax" for plain-HTTP req (dev/test)
 *   [HP-8] procedure returns { success: true, username, alreadySetup: false }
 *   [HP-9] pendingSetup is cleared — second call returns alreadySetup: true
 *
 *  HAPPY PATH — JWT claim invariants (decoded from cookie value)
 *   [JW-1] JWT payload.sub === String(userId)
 *   [JW-2] JWT payload.role === user.role
 *   [JW-3] JWT payload.type === "app_user"
 *   [JW-4] JWT payload.tv === user.tokenVersion
 *   [JW-5] JWT header.alg === "HS256"
 *   [JW-6] JWT payload.exp is approximately 90 days from now (±60s tolerance)
 *
 *  HTTPS context — cookie security flags flip correctly
 *   [TLS-1] cookie options.secure === true for HTTPS req
 *   [TLS-2] cookie options.sameSite === "none" for HTTPS req
 *
 *  EDGE CASE — already set up
 *   [EC-1] if pendingSetup=false, returns alreadySetup: true and does NOT call res.cookie
 *
 *  ERROR PATHS
 *   [ER-1] throws NOT_FOUND when sessionId has no matching user
 *   [ER-2] throws CONFLICT when email is already used by a different user
 *   [ER-3] Zod rejects password shorter than 8 chars (BAD_REQUEST)
 *   [ER-4] Zod rejects password without uppercase letter (BAD_REQUEST)
 *   [ER-5] Zod rejects password without lowercase letter (BAD_REQUEST)
 *   [ER-6] Zod rejects password without special character (BAD_REQUEST)
 *
 * ── Strategy ──────────────────────────────────────────────────────────────────
 *  - Uses real DB (DATABASE_URL is available in the sandbox test environment)
 *  - Uses real appRouter.createCaller (same pattern as auth.logout.test.ts)
 *  - No vi.mock — the procedure is tested end-to-end through the real tRPC stack
 *  - syncDiscordRoleForUser silently skips when discordId is null (test user has none)
 *  - sendWelcomeEmail is fire-and-forget (import().then()) — does not block the test
 *  - afterEach cleans up test rows by pendingStripeSessionId prefix "test-session-"
 *  - JWT is decoded by splitting on "." and base64url-decoding header + payload
 *    (no jose import needed — avoids circular dependency with the module under test)
 *
 * ── Isolation ─────────────────────────────────────────────────────────────────
 *  Each test inserts a fresh row with a unique pendingStripeSessionId and username.
 *  afterAll deletes all rows whose pendingStripeSessionId starts with "test-session-"
 *  OR whose username starts with "testuser_cas_" to prevent DB pollution.
 */

import { describe, it, expect, afterAll } from "vitest";
import { appRouter } from "./routers";
import { APP_USER_COOKIE } from "./routers/appUsers";
import type { TrpcContext } from "./_core/context";
import { getDb } from "./db";
import { appUsers } from "../drizzle/schema";
import { like, or } from "drizzle-orm";
import bcrypt from "bcryptjs";

// ── Constants ──────────────────────────────────────────────────────────────────

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
/** Tolerance for JWT exp assertion — clock skew + test execution time */
const EXP_TOLERANCE_MS = 60_000;

// ── Types ──────────────────────────────────────────────────────────────────────

type CookieCall = {
  name: string;
  value: string;
  options: Record<string, unknown>;
};

// ── Context factories ──────────────────────────────────────────────────────────

/**
 * createHttpContext — simulates a plain HTTP request (dev / test environment).
 *
 * [INPUT]  protocol: "http" (default) or "https"
 * [OUTPUT] { ctx, setCookies } — ctx is a TrpcContext with mocked req/res
 *
 * Cookie security flags derived by getSessionCookieOptions(req):
 *   - HTTP:  secure=false, sameSite="lax"
 *   - HTTPS: secure=true,  sameSite="none"
 *
 * No Origin header → server-to-server pattern → CSRF middleware always allows.
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
      // No Origin header → CSRF check passes (server-to-server pattern)
      get: (_name: string) => undefined,
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" } as NodeJS.Socket,
    } as TrpcContext["req"],
    res: {
      cookie: (name: string, value: string, options: Record<string, unknown>) => {
        setCookies.push({ name, value, options });
      },
    } as unknown as TrpcContext["res"],
  };

  return { ctx, setCookies };
}

// ── JWT decode helper ──────────────────────────────────────────────────────────

/**
 * decodeJwt — splits a compact JWT and base64url-decodes header + payload.
 *
 * [INPUT]  token — compact JWT string (header.payload.signature)
 * [OUTPUT] { header, payload } — decoded JSON objects
 * [VERIFY] throws if token is not a 3-part dot-separated string
 *
 * NOTE: This does NOT verify the signature — signature verification is tested
 * implicitly by verifyAppUserToken in auth.logout.test.ts and the login flow.
 * Here we only need to inspect the claims to assert they are correct.
 */
function decodeJwt(token: string): {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
} {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error(`[decodeJwt] Expected 3 parts, got ${parts.length}: "${token.substring(0, 40)}..."`);
  }
  const decode = (b64url: string): Record<string, unknown> => {
    // base64url → base64 → Buffer → JSON
    const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(b64, "base64").toString("utf-8");
    return JSON.parse(json) as Record<string, unknown>;
  };
  return {
    header: decode(parts[0]),
    payload: decode(parts[1]),
  };
}

// ── DB test-row factory ────────────────────────────────────────────────────────

/**
 * insertTestPendingUser — inserts a minimal pending-setup app_user row.
 *
 * [INPUT]  suffix — unique suffix appended to sessionId and username
 * [OUTPUT] { id, username, role, tokenVersion, pendingStripeSessionId }
 *
 * The row mimics a user who just paid via Stripe but has not yet set their
 * email/password (pendingSetup=true). The email column is set to a placeholder
 * because it is NOT NULL in the schema — completeAccountSetup will overwrite it.
 *
 * hasAccess=true so syncDiscordRoleForUser is called, but it silently skips
 * because discordId is null (no Discord account linked).
 */
async function insertTestPendingUser(suffix: string): Promise<{
  id: number;
  username: string;
  role: string;
  tokenVersion: number;
  pendingStripeSessionId: string;
}> {
  const db = await getDb();
  if (!db) throw new Error("[insertTestPendingUser] Database not available");

  const sessionId = `test-session-${suffix}`;
  const username = `testuser_cas_${suffix}`;
  // Placeholder email — completeAccountSetup will overwrite it.
  // Must be unique per test run to satisfy the UNIQUE constraint.
  const placeholderEmail = `pending_${suffix}@test.invalid`;
  const passwordHash = await bcrypt.hash("placeholder_hash_not_used", 4); // cost=4 for speed

  console.log(`[insertTestPendingUser] [INPUT] suffix=${suffix} sessionId=${sessionId} username=${username}`);

  await db.insert(appUsers).values({
    email: placeholderEmail,
    username,
    passwordHash,
    role: "user",
    hasAccess: true,
    tokenVersion: 1,
    pendingSetup: true,
    pendingStripeSessionId: sessionId,
    pendingEmail: placeholderEmail,
    pendingUsername: username,
  });

  // Re-read to get the auto-incremented id
  const rows = await db
    .select({
      id: appUsers.id,
      username: appUsers.username,
      role: appUsers.role,
      tokenVersion: appUsers.tokenVersion,
      pendingStripeSessionId: appUsers.pendingStripeSessionId,
    })
    .from(appUsers)
    .where(like(appUsers.pendingStripeSessionId, `test-session-${suffix}`))
    .limit(1);

  if (!rows.length) throw new Error(`[insertTestPendingUser] Row not found after insert suffix=${suffix}`);
  const row = rows[0];
  console.log(`[insertTestPendingUser] [OUTPUT] userId=${row.id} username=${row.username} tokenVersion=${row.tokenVersion}`);
  return row as { id: number; username: string; role: string; tokenVersion: number; pendingStripeSessionId: string };
}

// ── Cleanup ────────────────────────────────────────────────────────────────────

afterAll(async () => {
  console.log("[CLEANUP] Deleting all test rows (pendingStripeSessionId LIKE 'test-session-%' OR username LIKE 'testuser_cas_%')");
  const db = await getDb();
  if (!db) {
    console.warn("[CLEANUP] DB unavailable — test rows may remain");
    return;
  }
  await db.delete(appUsers).where(
    or(
      like(appUsers.pendingStripeSessionId, "test-session-%"),
      like(appUsers.username, "testuser_cas_%")
    )
  );
  console.log("[CLEANUP] Test rows deleted");
});

// ── Test suite ─────────────────────────────────────────────────────────────────

describe("stripe.completeAccountSetup — auto-login cookie invariant", () => {

  // ── HAPPY PATH — cookie issuance ──────────────────────────────────────────────

  it("[HP-1..9] issues app_session cookie with correct flags and returns success", async () => {
    const suffix = `hp_${Date.now()}`;
    const user = await insertTestPendingUser(suffix);
    const { ctx, setCookies } = createContext("http");
    const caller = appRouter.createCaller(ctx);

    const testEmail = `setup_${suffix}@test.invalid`;
    const testPassword = "TestPass1!";

    console.log(`[INPUT] sessionId=${user.pendingStripeSessionId} email=${testEmail} userId=${user.id}`);

    // [STEP] Call completeAccountSetup
    const result = await caller.stripe.completeAccountSetup({
      sessionId: user.pendingStripeSessionId!,
      email: testEmail,
      password: testPassword,
    });

    console.log(`[STATE] result=${JSON.stringify(result)}`);
    console.log(`[STATE] setCookies.length=${setCookies.length}`);
    if (setCookies.length > 0) {
      console.log(`[STATE] cookie[0].name=${setCookies[0].name}`);
      console.log(`[STATE] cookie[0].options=${JSON.stringify(setCookies[0].options)}`);
      console.log(`[STATE] cookie[0].value (first 40 chars)=${setCookies[0].value.substring(0, 40)}...`);
    }

    // [HP-8] Return value
    expect(result.success).toBe(true);
    expect(result.username).toBe(user.username);
    expect(result.alreadySetup).toBe(false);
    console.log("[VERIFY] [HP-8] PASS — result.success=true alreadySetup=false");

    // [HP-1] Exactly one cookie set, named "app_session"
    expect(setCookies).toHaveLength(1);
    expect(setCookies[0].name).toBe(APP_USER_COOKIE);
    expect(setCookies[0].name).toBe("app_session");
    console.log(`[VERIFY] [HP-1] PASS — cookie name="${setCookies[0].name}"`);

    // [HP-2] Cookie value is a parseable JWT (3-part dot-separated)
    const token = setCookies[0].value;
    expect(token).toBeTruthy();
    expect(token.split(".")).toHaveLength(3);
    console.log("[VERIFY] [HP-2] PASS — cookie value is a 3-part JWT");

    const opts = setCookies[0].options;

    // [HP-3] httpOnly
    expect(opts.httpOnly).toBe(true);
    console.log("[VERIFY] [HP-3] PASS — httpOnly=true");

    // [HP-4] path
    expect(opts.path).toBe("/");
    console.log("[VERIFY] [HP-4] PASS — path=/");

    // [HP-5] maxAge = 90 days in ms
    expect(opts.maxAge).toBe(NINETY_DAYS_MS);
    console.log(`[VERIFY] [HP-5] PASS — maxAge=${opts.maxAge} (${NINETY_DAYS_MS}ms = 90 days)`);

    // [HP-6] secure=false for plain HTTP
    expect(opts.secure).toBe(false);
    console.log("[VERIFY] [HP-6] PASS — secure=false for HTTP request");

    // [HP-7] sameSite="lax" for plain HTTP
    expect(opts.sameSite).toBe("lax");
    console.log("[VERIFY] [HP-7] PASS — sameSite=lax for HTTP request");

    // [HP-9] Session is consumed — pendingStripeSessionId is set to NULL after setup.
    // A second call with the same sessionId MUST throw NOT_FOUND because the session
    // is a one-time token that is cleared atomically with pendingSetup=false.
    // This is the correct production behavior: prevents replay attacks.
    const { ctx: ctx2 } = createContext("http");
    const caller2 = appRouter.createCaller(ctx2);
    await expect(
      caller2.stripe.completeAccountSetup({
        sessionId: user.pendingStripeSessionId!,
        email: testEmail,
        password: testPassword,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    console.log("[VERIFY] [HP-9] PASS — session consumed: second call throws NOT_FOUND (one-time token cleared)");
  });

  // ── JWT CLAIM INVARIANTS ──────────────────────────────────────────────────────

  it("[JW-1..6] JWT claims are correct: sub, role, type, tv, alg, exp", async () => {
    const suffix = `jw_${Date.now()}`;
    const user = await insertTestPendingUser(suffix);
    const { ctx, setCookies } = createContext("http");
    const caller = appRouter.createCaller(ctx);

    const testEmail = `jwt_${suffix}@test.invalid`;

    console.log(`[INPUT] userId=${user.id} role=${user.role} tokenVersion=${user.tokenVersion}`);

    await caller.stripe.completeAccountSetup({
      sessionId: user.pendingStripeSessionId!,
      email: testEmail,
      password: "JwtTest1@",
    });

    expect(setCookies).toHaveLength(1);
    const token = setCookies[0].value;
    const { header, payload } = decodeJwt(token);

    console.log(`[STATE] JWT header=${JSON.stringify(header)}`);
    console.log(`[STATE] JWT payload=${JSON.stringify({ ...payload, exp: payload.exp })}`);

    // [JW-5] Algorithm
    expect(header.alg).toBe("HS256");
    console.log(`[VERIFY] [JW-5] PASS — alg=${header.alg}`);

    // [JW-1] Subject = userId
    expect(payload.sub).toBe(String(user.id));
    console.log(`[VERIFY] [JW-1] PASS — sub="${payload.sub}" === userId="${user.id}"`);

    // [JW-2] Role
    expect(payload.role).toBe(user.role);
    console.log(`[VERIFY] [JW-2] PASS — role="${payload.role}"`);

    // [JW-3] Type
    expect(payload.type).toBe("app_user");
    console.log(`[VERIFY] [JW-3] PASS — type="app_user"`);

    // [JW-4] Token version
    expect(payload.tv).toBe(user.tokenVersion);
    console.log(`[VERIFY] [JW-4] PASS — tv=${payload.tv} === tokenVersion=${user.tokenVersion}`);

    // [JW-6] Expiry ≈ 90 days from now
    const expMs = (payload.exp as number) * 1000; // JWT exp is in seconds
    const expectedExpMs = Date.now() + NINETY_DAYS_MS;
    const drift = Math.abs(expMs - expectedExpMs);
    console.log(`[STATE] exp=${new Date(expMs).toISOString()} expectedExp=${new Date(expectedExpMs).toISOString()} drift=${drift}ms`);
    expect(drift).toBeLessThan(EXP_TOLERANCE_MS);
    console.log(`[VERIFY] [JW-6] PASS — exp drift=${drift}ms < ${EXP_TOLERANCE_MS}ms tolerance`);
  });

  // ── HTTPS CONTEXT — security flags flip correctly ─────────────────────────────

  it("[TLS-1,2] HTTPS request produces secure=true, sameSite=none", async () => {
    const suffix = `tls_${Date.now()}`;
    const user = await insertTestPendingUser(suffix);
    // Simulate HTTPS: req.protocol="https" → isSecureRequest returns true
    const { ctx, setCookies } = createContext("https");
    const caller = appRouter.createCaller(ctx);

    const testEmail = `tls_${suffix}@test.invalid`;

    console.log(`[INPUT] protocol=https userId=${user.id}`);

    await caller.stripe.completeAccountSetup({
      sessionId: user.pendingStripeSessionId!,
      email: testEmail,
      password: "TlsTest1@",
    });

    expect(setCookies).toHaveLength(1);
    const opts = setCookies[0].options;

    console.log(`[STATE] cookie options for HTTPS: ${JSON.stringify(opts)}`);

    // [TLS-1] secure=true for HTTPS
    expect(opts.secure).toBe(true);
    console.log("[VERIFY] [TLS-1] PASS — secure=true for HTTPS request");

    // [TLS-2] sameSite="none" for HTTPS (required for cross-site cookie delivery)
    expect(opts.sameSite).toBe("none");
    console.log("[VERIFY] [TLS-2] PASS — sameSite=none for HTTPS request");
  });

  // ── EDGE CASE — already set up ────────────────────────────────────────────────

  it("[EC-1] already-setup user (pendingSetup=false, sessionId still set) returns alreadySetup=true without cookie", async () => {
    // Insert a user that simulates a duplicate webhook event:
    //   - pendingSetup=false  (account is fully set up)
    //   - pendingStripeSessionId still set (not yet cleared — race condition scenario)
    // This is the ONLY state that reaches the alreadySetup=true early return.
    // After a normal completeAccountSetup call, pendingStripeSessionId is set to NULL
    // atomically with pendingSetup=false, so the second call throws NOT_FOUND instead.
    const suffix = `ec_${Date.now()}`;
    const db = await getDb();
    if (!db) throw new Error("[EC-1] Database not available");

    const sessionId = `test-session-${suffix}`;
    const username = `testuser_cas_${suffix}`;
    const email = `ec_${suffix}@test.invalid`;
    const passwordHash = await (await import("bcryptjs")).default.hash("EdgeCase1!", 4);

    await db.insert(appUsers).values({
      email,
      username,
      passwordHash,
      role: "user",
      hasAccess: true,
      tokenVersion: 1,
      pendingSetup: false,          // Already set up
      pendingStripeSessionId: sessionId, // But sessionId not yet cleared (race condition)
    });

    console.log(`[INPUT] sessionId=${sessionId} pendingSetup=false (already-setup race condition)`);

    const { ctx, setCookies } = createContext("http");
    const result = await appRouter.createCaller(ctx).stripe.completeAccountSetup({
      sessionId,
      email: `ec_new_${suffix}@test.invalid`,
      password: "EdgeCase2!",
    });

    console.log(`[STATE] result=${JSON.stringify(result)}`);
    console.log(`[STATE] setCookies.length=${setCookies.length}`);

    // [EC-1a] Returns alreadySetup: true — early return before any DB writes
    expect(result.success).toBe(true);
    expect(result.alreadySetup).toBe(true);
    console.log("[VERIFY] [EC-1a] PASS — alreadySetup=true for pendingSetup=false user");

    // [EC-1b] NO cookie is set — the early return at pendingSetup=false check
    // exits before the cookie issuance block (line 437 in stripe.ts)
    expect(setCookies).toHaveLength(0);
    console.log("[VERIFY] [EC-1b] PASS — no cookie set for already-setup user");
  });

  // ── ERROR PATHS ───────────────────────────────────────────────────────────────

  it("[ER-1] throws NOT_FOUND for unknown sessionId", async () => {
    const { ctx } = createContext("http");
    const caller = appRouter.createCaller(ctx);

    console.log("[INPUT] sessionId=nonexistent-session-id-xyz");

    await expect(
      caller.stripe.completeAccountSetup({
        sessionId: "nonexistent-session-id-xyz",
        email: "nobody@test.invalid",
        password: "TestPass1!",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    console.log("[VERIFY] [ER-1] PASS — NOT_FOUND thrown for unknown sessionId");
  });

  it("[ER-2] throws CONFLICT when email is already used by a different user", async () => {
    // Insert two pending users; attempt to set the second one's email to the first one's email
    const suffix = `er2_${Date.now()}`;
    const user1 = await insertTestPendingUser(`${suffix}_a`);
    const user2 = await insertTestPendingUser(`${suffix}_b`);

    const sharedEmail = `conflict_${suffix}@test.invalid`;

    // Complete setup for user1 with sharedEmail
    const { ctx: ctx1 } = createContext("http");
    await appRouter.createCaller(ctx1).stripe.completeAccountSetup({
      sessionId: user1.pendingStripeSessionId!,
      email: sharedEmail,
      password: "Conflict1!",
    });

    // Attempt to complete setup for user2 with the same email
    const { ctx: ctx2 } = createContext("http");

    console.log(`[INPUT] user2.sessionId=${user2.pendingStripeSessionId} email=${sharedEmail} (already used by user1)`);

    await expect(
      appRouter.createCaller(ctx2).stripe.completeAccountSetup({
        sessionId: user2.pendingStripeSessionId!,
        email: sharedEmail,
        password: "Conflict2!",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });

    console.log("[VERIFY] [ER-2] PASS — CONFLICT thrown for duplicate email");
  });

  it("[ER-3] Zod rejects password shorter than 8 chars", async () => {
    const suffix = `er3_${Date.now()}`;
    const user = await insertTestPendingUser(suffix);
    const { ctx } = createContext("http");

    console.log("[INPUT] password=Ab1! (4 chars — below minimum 8)");

    await expect(
      appRouter.createCaller(ctx).stripe.completeAccountSetup({
        sessionId: user.pendingStripeSessionId!,
        email: `er3_${suffix}@test.invalid`,
        password: "Ab1!",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    console.log("[VERIFY] [ER-3] PASS — BAD_REQUEST for password < 8 chars");
  });

  it("[ER-4] Zod rejects password without uppercase letter", async () => {
    const suffix = `er4_${Date.now()}`;
    const user = await insertTestPendingUser(suffix);
    const { ctx } = createContext("http");

    console.log("[INPUT] password=testpass1! (no uppercase)");

    await expect(
      appRouter.createCaller(ctx).stripe.completeAccountSetup({
        sessionId: user.pendingStripeSessionId!,
        email: `er4_${suffix}@test.invalid`,
        password: "testpass1!",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    console.log("[VERIFY] [ER-4] PASS — BAD_REQUEST for missing uppercase");
  });

  it("[ER-5] Zod rejects password without lowercase letter", async () => {
    const suffix = `er5_${Date.now()}`;
    const user = await insertTestPendingUser(suffix);
    const { ctx } = createContext("http");

    console.log("[INPUT] password=TESTPASS1! (no lowercase)");

    await expect(
      appRouter.createCaller(ctx).stripe.completeAccountSetup({
        sessionId: user.pendingStripeSessionId!,
        email: `er5_${suffix}@test.invalid`,
        password: "TESTPASS1!",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    console.log("[VERIFY] [ER-5] PASS — BAD_REQUEST for missing lowercase");
  });

  it("[ER-6] Zod rejects password without special character", async () => {
    const suffix = `er6_${Date.now()}`;
    const user = await insertTestPendingUser(suffix);
    const { ctx } = createContext("http");

    console.log("[INPUT] password=TestPass1 (no special char)");

    await expect(
      appRouter.createCaller(ctx).stripe.completeAccountSetup({
        sessionId: user.pendingStripeSessionId!,
        email: `er6_${suffix}@test.invalid`,
        password: "TestPass1",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    console.log("[VERIFY] [ER-6] PASS — BAD_REQUEST for missing special character");
  });

});
