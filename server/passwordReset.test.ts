/**
 * passwordReset.test.ts
 *
 * Locks in the full password reset security chain:
 *
 *   requestPasswordReset → generates CSPRNG token, stores SHA-256 hash in DB,
 *                          calls sendPasswordResetEmail (mocked), returns success=true
 *                          always (anti-enumeration)
 *
 *   resetPassword        → validates token hash, updates passwordHash (bcrypt cost>=10),
 *                          increments tokenVersion (invalidates all sessions),
 *                          clears passwordResetToken + passwordResetExpiresAt from DB
 *
 * ── Test surface (24 invariants) ──────────────────────────────────────────────
 *
 *  requestPasswordReset — token generation
 *   [RQ-1]  returns { success: true } for a valid email
 *   [RQ-2]  returns { success: true } for a valid username
 *   [RQ-3]  returns { success: true } for unknown email (anti-enumeration — no error)
 *   [RQ-4]  DB row has passwordResetToken set (non-null) after the call
 *   [RQ-5]  passwordResetToken is a 64-char hex string (SHA-256 of the raw token)
 *   [RQ-6]  passwordResetExpiresAt is approximately 30 minutes from now (±5s)
 *   [RQ-7]  sendPasswordResetEmail is called with correct toEmail, username, resetUrl
 *   [RQ-8]  resetUrl contains the raw token (not the hash) and the user's uid
 *   [RQ-9]  @username prefix is stripped before lookup (@ is removed)
 *
 *  resetPassword — full security chain
 *   [RP-1]  returns { success: true } for a valid token + uid
 *   [RP-2]  new password is bcrypt-hashed (starts with $2b$ or $2a$)
 *   [RP-3]  bcrypt cost rounds >= 10 (OWASP minimum)
 *   [RP-4]  bcrypt.compare(newPassword, newHash) returns true
 *   [RP-5]  passwordResetToken is cleared to null after reset
 *   [RP-6]  passwordResetExpiresAt is cleared to null after reset
 *   [RP-7]  tokenVersion is incremented (old sessions invalidated)
 *   [RP-8]  old password no longer authenticates (bcrypt.compare returns false)
 *
 *  resetPassword — error paths
 *   [RE-1]  throws BAD_REQUEST for unknown uid
 *   [RE-2]  throws BAD_REQUEST for wrong token (hash mismatch)
 *   [RE-3]  throws BAD_REQUEST when no reset is pending (no token in DB)
 *   [RE-4]  throws BAD_REQUEST for expired token (expiresAt in the past)
 *   [RE-5]  expired token is cleared from DB after the BAD_REQUEST
 *   [RE-6]  Zod rejects password shorter than 8 chars (BAD_REQUEST)
 *   [RE-7]  Zod rejects token not matching 64-char hex format (BAD_REQUEST)
 *
 * ── Strategy ──────────────────────────────────────────────────────────────────
 *  - Uses real DB (DATABASE_URL is available in the sandbox test environment)
 *  - Uses real appRouter.createCaller (same pattern as completeAccountSetup.test.ts)
 *  - vi.mock("./email") stubs sendWelcomeEmail and sendPasswordResetEmail to prevent
 *    SMTP traffic and to enable call inspection via vi.mocked()
 *  - getDiscordClient() returns null in the test environment (bot is not running),
 *    so the Discord DM fallback path is silently skipped — no mock needed
 *  - resetRateMap is NOT exported, so rate-limit tests use unique identifiers per test
 *    to avoid cross-test interference (each test gets a fresh rate-limit slot)
 *  - The raw token is extracted from the resetUrl captured by the email mock spy
 *  - afterAll deletes all rows whose username starts with "testuser_pr_"
 *
 * ── Isolation ─────────────────────────────────────────────────────────────────
 *  Each test inserts a fresh row with a unique email/username prefixed "testuser_pr_".
 *  afterAll deletes all such rows to prevent DB pollution.
 */
import { describe, it, expect, afterAll, vi, beforeEach } from "vitest";
import { SKIP_DB_IN_CI } from "./_core/ciTestGuard";

// ── Email mock — prevent SMTP traffic during test runs ─────────────────────────
// requestPasswordReset calls import('../email') as a dynamic import.
// vi.mock intercepts it at module resolution time (hoisted before imports)
// so the SMTP transporter is never created and no emails are sent.
vi.mock("./email", () => ({
  sendWelcomeEmail: vi.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
}));

import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { getDb, getAppUserById, updateAppUser, invalidateAppUserByIdCache } from "./db";
import { appUsers } from "../drizzle/schema";
import { like, or } from "drizzle-orm";
import bcrypt from "bcryptjs";
import crypto from "crypto";

// ── Constants ──────────────────────────────────────────────────────────────────
const TEST_PASSWORD = "OldPass1!";
const NEW_PASSWORD = "NewPass2@";
const THIRTY_MIN_MS = 30 * 60 * 1000;
const RESET_TOKEN_TOLERANCE_MS = 5_000; // ±5s for expiresAt assertion

// ── Types ──────────────────────────────────────────────────────────────────────
type SendPasswordResetEmailArgs = {
  toEmail: string;
  username: string;
  resetUrl: string;
  expiresAt: Date;
};

// ── Context factory ────────────────────────────────────────────────────────────
/**
 * createContext — builds a minimal TrpcContext for password reset tests.
 * requestPasswordReset and resetPassword are publicProcedures — no auth needed.
 */
function createContext(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "http",
      headers: {},
      method: "POST",
      get: (_name: string) => undefined,
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" } as NodeJS.Socket,
      cookies: {},
    } as TrpcContext["req"],
    res: {
      cookie: () => {},
      clearCookie: () => {},
    } as unknown as TrpcContext["res"],
  };
}

// ── Test user factory ──────────────────────────────────────────────────────────
/**
 * insertTestUser — inserts a fully-set-up app user for password reset tests.
 * Returns { id, email, username, passwordHash, tokenVersion }
 */
async function insertTestUser(suffix: string): Promise<{
  id: number;
  email: string;
  username: string;
  passwordHash: string;
  tokenVersion: number;
}> {
  const db = await getDb();
  if (!db) throw new Error("[insertTestUser] Database not available");
  const email = `pr_${suffix}@test.invalid`;
  const username = `testuser_pr_${suffix}`;
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 4); // cost=4 for test speed
  console.log(`[insertTestUser] [INPUT] suffix=${suffix} email=${email} username=${username}`);
  await db.insert(appUsers).values({
    email,
    username,
    passwordHash,
    role: "user",
    hasAccess: true,
    expiryDate: null,
    tokenVersion: 1,
    pendingSetup: false,
  });
  const rows = await db
    .select({
      id: appUsers.id,
      email: appUsers.email,
      username: appUsers.username,
      passwordHash: appUsers.passwordHash,
      tokenVersion: appUsers.tokenVersion,
    })
    .from(appUsers)
    .where(like(appUsers.username, username))
    .limit(1);
  if (!rows.length) throw new Error(`[insertTestUser] Failed to retrieve inserted user for suffix=${suffix}`);
  const user = rows[0];
  console.log(`[insertTestUser] [OUTPUT] id=${user.id} email=${user.email} tokenVersion=${user.tokenVersion}`);
  return user;
}

// ── Cleanup ────────────────────────────────────────────────────────────────────
afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(appUsers).where(
    or(
      like(appUsers.username, "testuser_pr_%"),
      like(appUsers.email, "pr_%@test.invalid"),
    )
  );
  console.log("[afterAll] [STEP] Deleted all test users with username LIKE 'testuser_pr_%'");
});

// ── Reset email mock spy ───────────────────────────────────────────────────────
beforeEach(async () => {
  // Clear mock call history before each test for clean spy assertions
  const emailModule = await import("./email");
  vi.mocked(emailModule.sendPasswordResetEmail).mockClear();
  vi.mocked(emailModule.sendWelcomeEmail).mockClear();
});

// ── Test suite ─────────────────────────────────────────────────────────────────
// Uses a real database via getDb() — no DATABASE_URL in CI.
// TODO: wire dedicated CI test database, then re-enable.
describe.skipIf(SKIP_DB_IN_CI)("passwordReset — requestPasswordReset + resetPassword invariants (real DB)", () => {

  // ── requestPasswordReset — token generation ────────────────────────────────

  it("[RQ-1] returns { success: true } for a valid email", async () => {
    const suffix = `rq1_${Date.now()}`;
    const user = await insertTestUser(suffix);
    const caller = appRouter.createCaller(createContext());

    console.log(`[INPUT] emailOrUsername=${user.email} origin=http://localhost:3000`);
    const result = await caller.appUsers.requestPasswordReset({
      emailOrUsername: user.email,
      origin: "http://localhost:3000",
    });
    expect(result.success).toBe(true);
    console.log(`[VERIFY] [RQ-1] PASS — requestPasswordReset returned success=true for email=${user.email}`);
  });

  it("[RQ-2] returns { success: true } for a valid username", async () => {
    const suffix = `rq2_${Date.now()}`;
    const user = await insertTestUser(suffix);
    const caller = appRouter.createCaller(createContext());

    console.log(`[INPUT] emailOrUsername=${user.username} origin=http://localhost:3000`);
    const result = await caller.appUsers.requestPasswordReset({
      emailOrUsername: user.username,
      origin: "http://localhost:3000",
    });
    expect(result.success).toBe(true);
    console.log(`[VERIFY] [RQ-2] PASS — requestPasswordReset returned success=true for username=${user.username}`);
  });

  it("[RQ-3] returns { success: true } for unknown email (anti-enumeration)", async () => {
    const caller = appRouter.createCaller(createContext());
    const unknownEmail = `nonexistent_${Date.now()}@test.invalid`;
    console.log(`[INPUT] emailOrUsername=${unknownEmail} — user does not exist`);

    const result = await caller.appUsers.requestPasswordReset({
      emailOrUsername: unknownEmail,
      origin: "http://localhost:3000",
    });
    expect(result.success).toBe(true);
    console.log(`[VERIFY] [RQ-3] PASS — success=true for unknown email (anti-enumeration — no error thrown)`);
  });

  it("[RQ-4..8] DB token stored correctly + sendPasswordResetEmail called with correct args", async () => {
    const suffix = `rq48_${Date.now()}`;
    const user = await insertTestUser(suffix);
    const caller = appRouter.createCaller(createContext());
    const origin = "http://localhost:3000";
    const beforeCall = Date.now();

    console.log(`[INPUT] emailOrUsername=${user.email} origin=${origin}`);
    await caller.appUsers.requestPasswordReset({
      emailOrUsername: user.email,
      origin,
    });
    const afterCall = Date.now();

    // Invalidate cache so we read fresh DB values
    invalidateAppUserByIdCache(user.id);
    const dbUser = await getAppUserById(user.id);
    expect(dbUser, "DB user must exist after requestPasswordReset").not.toBeNull();

    // [RQ-4] passwordResetToken is non-null
    expect(dbUser!.passwordResetToken).not.toBeNull();
    console.log(`[VERIFY] [RQ-4] PASS — passwordResetToken is non-null: ${dbUser!.passwordResetToken?.slice(0, 16)}...`);

    // [RQ-5] passwordResetToken is a 64-char hex string (SHA-256 of raw token)
    const tokenHex = dbUser!.passwordResetToken!;
    expect(tokenHex).toMatch(/^[0-9a-f]{64}$/i);
    console.log(`[VERIFY] [RQ-5] PASS — passwordResetToken is 64-char hex: ${tokenHex.slice(0, 16)}...`);

    // [RQ-6] passwordResetExpiresAt is approximately 30 minutes from now (±5s)
    const expiresAt = dbUser!.passwordResetExpiresAt!;
    expect(expiresAt).not.toBeNull();
    const expectedExpiry = beforeCall + THIRTY_MIN_MS;
    expect(expiresAt).toBeGreaterThanOrEqual(expectedExpiry - RESET_TOKEN_TOLERANCE_MS);
    expect(expiresAt).toBeLessThanOrEqual(afterCall + THIRTY_MIN_MS + RESET_TOKEN_TOLERANCE_MS);
    console.log(`[VERIFY] [RQ-6] PASS — expiresAt=${new Date(expiresAt).toISOString()} ≈ now + 30min`);

    // [RQ-7] sendPasswordResetEmail was called with correct args
    const emailModule = await import("./email");
    const mockFn = vi.mocked(emailModule.sendPasswordResetEmail);
    // The call is fire-and-forget via dynamic import — give it a tick to resolve
    await new Promise(r => setTimeout(r, 100));
    expect(mockFn).toHaveBeenCalledTimes(1);
    const callArgs = mockFn.mock.calls[0][0] as SendPasswordResetEmailArgs;
    expect(callArgs.toEmail).toBe(user.email);
    expect(callArgs.username).toBe(user.username);
    console.log(`[VERIFY] [RQ-7] PASS — sendPasswordResetEmail called with toEmail=${callArgs.toEmail} username=${callArgs.username}`);

    // [RQ-8] resetUrl contains raw token (not hash) and uid
    const resetUrl: string = callArgs.resetUrl;
    expect(resetUrl).toContain(`uid=${user.id}`);
    // Extract raw token from URL
    const tokenMatch = resetUrl.match(/[?&]token=([0-9a-f]{64})/i);
    expect(tokenMatch, "resetUrl must contain a 64-char hex token param").not.toBeNull();
    const rawToken = tokenMatch![1];
    // Verify: SHA-256(rawToken) === stored hash
    const computedHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    expect(computedHash).toBe(tokenHex);
    console.log(`[VERIFY] [RQ-8] PASS — resetUrl contains raw token; SHA-256(rawToken)===storedHash verified`);
  });

  it("[RQ-9] @username prefix is stripped before lookup", async () => {
    const suffix = `rq9_${Date.now()}`;
    const user = await insertTestUser(suffix);
    const caller = appRouter.createCaller(createContext());

    // Pass @username — the @ prefix should be stripped and the user found
    const atUsername = `@${user.username}`;
    console.log(`[INPUT] emailOrUsername=${atUsername} — @ prefix should be stripped`);

    const result = await caller.appUsers.requestPasswordReset({
      emailOrUsername: atUsername,
      origin: "http://localhost:3000",
    });
    expect(result.success).toBe(true);

    // Confirm token was stored (user was found, not silently dropped)
    invalidateAppUserByIdCache(user.id);
    const dbUser = await getAppUserById(user.id);
    expect(dbUser!.passwordResetToken).not.toBeNull();
    console.log(`[VERIFY] [RQ-9] PASS — @username prefix stripped; token stored for userId=${user.id}`);
  });

  // ── resetPassword — full security chain ───────────────────────────────────

  it("[RP-1..8] full reset chain: new hash, cost>=10, tokenVersion++, old hash cleared", async () => {
    const suffix = `rp_${Date.now()}`;
    const user = await insertTestUser(suffix);
    const caller = appRouter.createCaller(createContext());

    // Step 1: Request reset to get a valid token
    await caller.appUsers.requestPasswordReset({
      emailOrUsername: user.email,
      origin: "http://localhost:3000",
    });
    // Give fire-and-forget email mock time to resolve
    await new Promise(r => setTimeout(r, 100));

    // Extract raw token from email mock spy
    const emailModule = await import("./email");
    const mockFn = vi.mocked(emailModule.sendPasswordResetEmail);
    const callArgs = mockFn.mock.calls[0][0] as SendPasswordResetEmailArgs;
    const tokenMatch = callArgs.resetUrl.match(/[?&]token=([0-9a-f]{64})/i);
    expect(tokenMatch, "resetUrl must contain a 64-char hex token param").not.toBeNull();
    const rawToken = tokenMatch![1];
    console.log(`[STATE] rawToken extracted from resetUrl: ${rawToken.slice(0, 16)}...`);

    // Capture tokenVersion before reset
    invalidateAppUserByIdCache(user.id);
    const beforeReset = await getAppUserById(user.id);
    const tvBefore = beforeReset!.tokenVersion;
    const oldPasswordHash = beforeReset!.passwordHash;
    console.log(`[STATE] tvBefore=${tvBefore} oldPasswordHash=${oldPasswordHash.slice(0, 20)}...`);

    // Step 2: Execute resetPassword
    console.log(`[INPUT] uid=${user.id} token=${rawToken.slice(0, 16)}... password=${NEW_PASSWORD}`);
    const result = await caller.appUsers.resetPassword({
      uid: user.id,
      token: rawToken,
      password: NEW_PASSWORD,
    });

    // [RP-1] Returns { success: true }
    expect(result.success).toBe(true);
    console.log(`[VERIFY] [RP-1] PASS — resetPassword returned success=true`);

    // Read fresh DB state
    invalidateAppUserByIdCache(user.id);
    const afterReset = await getAppUserById(user.id);
    expect(afterReset, "DB user must exist after resetPassword").not.toBeNull();
    const newPasswordHash = afterReset!.passwordHash;
    console.log(`[STATE] newPasswordHash=${newPasswordHash.slice(0, 20)}... tokenVersion=${afterReset!.tokenVersion}`);

    // [RP-2] New password is bcrypt-hashed
    const isBcrypt = newPasswordHash.startsWith("$2b$") || newPasswordHash.startsWith("$2a$");
    expect(isBcrypt).toBe(true);
    console.log(`[VERIFY] [RP-2] PASS — newPasswordHash is bcrypt: ${newPasswordHash.slice(0, 7)}`);

    // [RP-3] bcrypt cost rounds >= 10
    const costMatch = newPasswordHash.match(/^\$2[ab]\$(\d+)\$/);
    expect(costMatch, "Could not parse bcrypt cost from new hash").not.toBeNull();
    const costRounds = parseInt(costMatch![1], 10);
    expect(costRounds).toBeGreaterThanOrEqual(10);
    console.log(`[VERIFY] [RP-3] PASS — bcrypt cost rounds=${costRounds} >= 10 (OWASP minimum)`);

    // [RP-4] bcrypt.compare(newPassword, newHash) returns true
    const newHashValid = await bcrypt.compare(NEW_PASSWORD, newPasswordHash);
    expect(newHashValid).toBe(true);
    console.log(`[VERIFY] [RP-4] PASS — bcrypt.compare(NEW_PASSWORD, newHash)=true`);

    // [RP-5] passwordResetToken is cleared to null
    expect(afterReset!.passwordResetToken).toBeNull();
    console.log(`[VERIFY] [RP-5] PASS — passwordResetToken cleared to null`);

    // [RP-6] passwordResetExpiresAt is cleared to null
    expect(afterReset!.passwordResetExpiresAt).toBeNull();
    console.log(`[VERIFY] [RP-6] PASS — passwordResetExpiresAt cleared to null`);

    // [RP-7] tokenVersion is incremented (old sessions invalidated)
    expect(afterReset!.tokenVersion).toBe(tvBefore + 1);
    console.log(`[VERIFY] [RP-7] PASS — tokenVersion incremented: ${tvBefore} → ${afterReset!.tokenVersion}`);

    // [RP-8] Old password no longer authenticates
    const oldHashStillValid = await bcrypt.compare(TEST_PASSWORD, newPasswordHash);
    expect(oldHashStillValid).toBe(false);
    console.log(`[VERIFY] [RP-8] PASS — old password no longer authenticates against new hash`);
  });

  // ── resetPassword — error paths ────────────────────────────────────────────

  it("[RE-1] throws BAD_REQUEST for unknown uid", async () => {
    const caller = appRouter.createCaller(createContext());
    const fakeToken = "a".repeat(64); // valid format, wrong uid
    const fakeUid = 999_999_999;
    console.log(`[INPUT] uid=${fakeUid} token=${fakeToken.slice(0, 16)}...`);

    await expect(
      caller.appUsers.resetPassword({ uid: fakeUid, token: fakeToken, password: NEW_PASSWORD })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    console.log(`[VERIFY] [RE-1] PASS — BAD_REQUEST thrown for unknown uid=${fakeUid}`);
  });

  it("[RE-2] throws BAD_REQUEST for wrong token (hash mismatch)", async () => {
    const suffix = `re2_${Date.now()}`;
    const user = await insertTestUser(suffix);
    const caller = appRouter.createCaller(createContext());

    // Set a real token in DB
    const realRawToken = crypto.randomBytes(32).toString("hex");
    const realHash = crypto.createHash("sha256").update(realRawToken).digest("hex");
    await updateAppUser(user.id, {
      passwordResetToken: realHash,
      passwordResetExpiresAt: Date.now() + THIRTY_MIN_MS,
    });
    invalidateAppUserByIdCache(user.id);

    // Submit a different token
    const wrongToken = crypto.randomBytes(32).toString("hex");
    console.log(`[INPUT] uid=${user.id} wrongToken=${wrongToken.slice(0, 16)}... (mismatch)`);

    await expect(
      caller.appUsers.resetPassword({ uid: user.id, token: wrongToken, password: NEW_PASSWORD })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    console.log(`[VERIFY] [RE-2] PASS — BAD_REQUEST thrown for token hash mismatch`);
  });

  it("[RE-3] throws BAD_REQUEST when no reset is pending (no token in DB)", async () => {
    const suffix = `re3_${Date.now()}`;
    const user = await insertTestUser(suffix);
    const caller = appRouter.createCaller(createContext());

    // User has no passwordResetToken (fresh insert)
    const fakeToken = crypto.randomBytes(32).toString("hex");
    console.log(`[INPUT] uid=${user.id} — no pending reset in DB`);

    await expect(
      caller.appUsers.resetPassword({ uid: user.id, token: fakeToken, password: NEW_PASSWORD })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    console.log(`[VERIFY] [RE-3] PASS — BAD_REQUEST thrown when no reset is pending`);
  });

  it("[RE-4..5] throws BAD_REQUEST for expired token; expired token is cleared from DB", async () => {
    const suffix = `re45_${Date.now()}`;
    const user = await insertTestUser(suffix);
    const caller = appRouter.createCaller(createContext());

    // Set an expired token in DB (expiresAt = 1ms in the past)
    const expiredRawToken = crypto.randomBytes(32).toString("hex");
    const expiredHash = crypto.createHash("sha256").update(expiredRawToken).digest("hex");
    const expiredAt = Date.now() - 1; // already expired
    await updateAppUser(user.id, {
      passwordResetToken: expiredHash,
      passwordResetExpiresAt: expiredAt,
    });
    invalidateAppUserByIdCache(user.id);
    console.log(`[INPUT] uid=${user.id} expiredAt=${new Date(expiredAt).toISOString()} (1ms in the past)`);

    // [RE-4] Must throw BAD_REQUEST
    await expect(
      caller.appUsers.resetPassword({ uid: user.id, token: expiredRawToken, password: NEW_PASSWORD })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    console.log(`[VERIFY] [RE-4] PASS — BAD_REQUEST thrown for expired token`);

    // [RE-5] Expired token is cleared from DB
    invalidateAppUserByIdCache(user.id);
    const dbUser = await getAppUserById(user.id);
    expect(dbUser!.passwordResetToken).toBeNull();
    expect(dbUser!.passwordResetExpiresAt).toBeNull();
    console.log(`[VERIFY] [RE-5] PASS — expired token cleared from DB: passwordResetToken=null passwordResetExpiresAt=null`);
  });

});

// ── Input validation (no DB) ───────────────────────────────────────────────────
// Pure Zod-rejection tests: no fixtures inserted, nothing touches getDb(),
// so they run in CI where the DB-integration suite above is skipped.
describe("passwordReset — input validation (no DB)", () => {
  it("[RE-6] Zod rejects password shorter than 8 chars (BAD_REQUEST)", async () => {
    const caller = appRouter.createCaller(createContext());
    const fakeToken = "b".repeat(64);
    console.log(`[INPUT] uid=1 token=valid-format password="Short1!" (7 chars)`);

    await expect(
      caller.appUsers.resetPassword({ uid: 1, token: fakeToken, password: "Short1!" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    console.log(`[VERIFY] [RE-6] PASS — BAD_REQUEST thrown for password shorter than 8 chars`);
  });

  it("[RE-7] Zod rejects token not matching 64-char hex format (BAD_REQUEST)", async () => {
    const caller = appRouter.createCaller(createContext());
    console.log(`[INPUT] uid=1 token="not-hex-not-64-chars"`);

    await expect(
      caller.appUsers.resetPassword({ uid: 1, token: "not-hex-not-64-chars", password: NEW_PASSWORD })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    console.log(`[VERIFY] [RE-7] PASS — BAD_REQUEST thrown for invalid token format`);
  });
});
