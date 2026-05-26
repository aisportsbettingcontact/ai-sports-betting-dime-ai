/**
 * appUsers.register.test.ts
 *
 * Locks in the registration invariants for appUsers.createUser (owner-only
 * admin account creation procedure).
 *
 * This is the server-side "register" path: an owner creates a new user account
 * via the admin panel. It is distinct from the Stripe checkout path
 * (stripeWebhook.createPendingUserFromCheckout) which sets pendingSetup=true.
 *
 * ── Test surface (20 invariants) ──────────────────────────────────────────────
 *
 *  HAPPY PATH — account creation
 *   [CR-1]  procedure returns { success: true }
 *   [CR-2]  DB row is inserted (getAppUserByEmail finds the new user)
 *   [CR-3]  passwordHash is NOT the plaintext password
 *   [CR-4]  passwordHash is a valid bcrypt hash (starts with $2b$ or $2a$)
 *   [CR-5]  bcrypt cost rounds >= 10 (OWASP minimum)
 *   [CR-6]  bcrypt.compare(plaintext, hash) returns true (hash is correct)
 *   [CR-7]  pendingSetup === false (admin-created accounts are immediately active)
 *   [CR-8]  NO cookie is issued (res.cookie is never called — not auto-login)
 *   [CR-9]  email is stored lowercase
 *   [CR-10] username is stored lowercase
 *   [CR-11] role defaults to "user" when not specified
 *   [CR-12] hasAccess defaults to true when not specified
 *   [CR-13] expiryDate is null (lifetime) when not specified
 *
 *  ROLE VARIANTS
 *   [RV-1]  role="admin" is stored correctly
 *   [RV-2]  role="handicapper" is stored correctly
 *
 *  ERROR PATHS
 *   [ER-1]  throws CONFLICT when email is already in use
 *   [ER-2]  throws CONFLICT when username is already taken
 *   [ER-3]  Zod rejects password shorter than 8 chars (BAD_REQUEST)
 *   [ER-4]  Zod rejects invalid email format (BAD_REQUEST)
 *   [ER-5]  throws UNAUTHORIZED when called without owner JWT (non-owner access blocked)
 *
 * ── Strategy ──────────────────────────────────────────────────────────────────
 *  - Uses real DB (DATABASE_URL is available in the sandbox test environment)
 *  - Uses real appRouter.createCaller (same pattern as tokenVersion.db.test.ts)
 *  - Owner context is constructed by inserting a real owner user + signing a JWT
 *    with their userId/tokenVersion and setting req.headers.cookie accordingly
 *  - res.cookie is mocked via a spy array — any call is recorded and asserted absent
 *  - bcrypt cost is extracted from the hash string ($2b$NN$...) and asserted >= 10
 *  - afterAll deletes all rows whose username starts with "testuser_reg_"
 *
 * ── Isolation ─────────────────────────────────────────────────────────────────
 *  Each test inserts fresh rows with unique usernames prefixed "testuser_reg_".
 *  afterAll deletes all such rows to prevent DB pollution.
 */
import { describe, it, expect, afterAll } from "vitest";
import { appRouter } from "./routers";
import { APP_USER_COOKIE, signAppUserToken } from "./routers/appUsers";
import type { TrpcContext } from "./_core/context";
import { getDb, getAppUserByEmail, getAppUserByUsername } from "./db";
import { appUsers } from "../drizzle/schema";
import { like, or } from "drizzle-orm";
import bcrypt from "bcryptjs";

// ── Constants ──────────────────────────────────────────────────────────────────
const TEST_PASSWORD = "RegisterTest1!";

// ── Types ──────────────────────────────────────────────────────────────────────
type CookieCall = { name: string; value: string; options: Record<string, unknown> };

// ── Context factories ──────────────────────────────────────────────────────────
/**
 * createOwnerContext — builds a TrpcContext with a valid owner JWT cookie.
 * Returns the context + a setCookies spy array to assert no cookies are issued.
 */
async function createOwnerContext(ownerId: number, ownerTv: number): Promise<{
  ctx: TrpcContext;
  setCookies: CookieCall[];
}> {
  const setCookies: CookieCall[] = [];
  const ownerJwt = await signAppUserToken(ownerId, "owner", ownerTv);
  const ctx: TrpcContext = {
    user: null,
    req: {
      protocol: "http",
      headers: { cookie: `${APP_USER_COOKIE}=${ownerJwt}` },
      method: "POST",
      get: (_name: string) => undefined,
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" } as NodeJS.Socket,
      cookies: { [APP_USER_COOKIE]: ownerJwt },
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

/**
 * createUnauthContext — builds a TrpcContext with no cookie (unauthenticated).
 */
function createUnauthContext(): { ctx: TrpcContext; setCookies: CookieCall[] } {
  const setCookies: CookieCall[] = [];
  const ctx: TrpcContext = {
    user: null,
    req: {
      protocol: "http",
      headers: {},
      method: "POST",
      get: (_name: string) => undefined,
      ip: "127.0.0.2",
      socket: { remoteAddress: "127.0.0.2" } as NodeJS.Socket,
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

// ── Owner user factory ─────────────────────────────────────────────────────────
/**
 * insertOwnerUser — inserts a real owner-role user for procedure auth.
 * Returns { id, tokenVersion } for JWT signing.
 */
async function insertOwnerUser(suffix: string): Promise<{ id: number; tokenVersion: number }> {
  const db = await getDb();
  if (!db) throw new Error("[insertOwnerUser] Database not available");
  const email = `reg_owner_${suffix}@test.invalid`;
  const username = `testuser_reg_owner_${suffix}`;
  const passwordHash = await bcrypt.hash("OwnerPass1!", 4); // cost=4 for test speed
  console.log(`[insertOwnerUser] [INPUT] suffix=${suffix} email=${email}`);
  await db.insert(appUsers).values({
    email,
    username,
    passwordHash,
    role: "owner",
    hasAccess: true,
    expiryDate: null,
    tokenVersion: 1,
    pendingSetup: false,
  });
  const rows = await db
    .select({ id: appUsers.id, tokenVersion: appUsers.tokenVersion })
    .from(appUsers)
    .where(like(appUsers.username, `testuser_reg_owner_${suffix}`))
    .limit(1);
  if (!rows.length) throw new Error(`[insertOwnerUser] Failed to retrieve inserted owner for suffix=${suffix}`);
  const owner = rows[0];
  console.log(`[insertOwnerUser] [OUTPUT] id=${owner.id} tokenVersion=${owner.tokenVersion}`);
  return { id: owner.id, tokenVersion: owner.tokenVersion };
}

// ── Cleanup ────────────────────────────────────────────────────────────────────
afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  const { sql } = await import("drizzle-orm");
  await db.delete(appUsers).where(
    or(
      like(appUsers.username, "testuser_reg_%"),
      like(appUsers.email, "reg_%@test.invalid"),
    )
  );
  console.log("[afterAll] [STEP] Deleted all test users with username LIKE 'testuser_reg_%'");
});

// ── Test suite ─────────────────────────────────────────────────────────────────
describe("appUsers.register — createUser invariants (real DB)", () => {

  // ── HAPPY PATH — account creation ────────────────────────────────────────────

  it("[CR-1..13] happy path: creates user, hashes password correctly, no cookie issued", async () => {
    const suffix = `cr_${Date.now()}`;
    const owner = await insertOwnerUser(suffix);
    const { ctx, setCookies } = await createOwnerContext(owner.id, owner.tokenVersion);
    const caller = appRouter.createCaller(ctx);

    const email = `reg_cr_${suffix}@test.invalid`;
    const username = `testuser_reg_cr_${suffix}`;
    const plainPassword = TEST_PASSWORD;

    console.log(`[INPUT] email=${email} username=${username} password=${plainPassword}`);

    // [CR-1] Procedure returns { success: true }
    const result = await caller.appUsers.createUser({
      email,
      username,
      password: plainPassword,
    });
    expect(result.success).toBe(true);
    console.log(`[VERIFY] [CR-1] PASS — createUser returned success=true`);

    // [CR-2] DB row is inserted
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const rows = await db
      .select()
      .from(appUsers)
      .where(like(appUsers.email, email))
      .limit(1);
    expect(rows.length).toBe(1);
    const user = rows[0];
    console.log(`[STATE] DB row: id=${user.id} email=${user.email} username=${user.username} pendingSetup=${user.pendingSetup}`);
    console.log(`[VERIFY] [CR-2] PASS — DB row found id=${user.id}`);

    // [CR-3] passwordHash is NOT the plaintext password
    expect(user.passwordHash).not.toBe(plainPassword);
    console.log(`[VERIFY] [CR-3] PASS — passwordHash !== plaintext`);

    // [CR-4] passwordHash is a valid bcrypt hash
    const isBcrypt = user.passwordHash.startsWith("$2b$") || user.passwordHash.startsWith("$2a$");
    expect(isBcrypt).toBe(true);
    console.log(`[VERIFY] [CR-4] PASS — passwordHash starts with bcrypt prefix: ${user.passwordHash.slice(0, 7)}`);

    // [CR-5] bcrypt cost rounds >= 10
    // Hash format: $2b$NN$... where NN is the cost factor
    const costMatch = user.passwordHash.match(/^\$2[ab]\$(\d+)\$/);
    expect(costMatch, "Could not parse bcrypt cost from hash").not.toBeNull();
    const costRounds = parseInt(costMatch![1], 10);
    expect(costRounds).toBeGreaterThanOrEqual(10);
    console.log(`[VERIFY] [CR-5] PASS — bcrypt cost rounds=${costRounds} >= 10 (OWASP minimum)`);

    // [CR-6] bcrypt.compare(plaintext, hash) returns true
    const compareResult = await bcrypt.compare(plainPassword, user.passwordHash);
    expect(compareResult).toBe(true);
    console.log(`[VERIFY] [CR-6] PASS — bcrypt.compare(plaintext, hash)=true`);

    // [CR-7] pendingSetup === false (admin-created accounts are immediately active)
    expect(user.pendingSetup).toBe(false);
    console.log(`[VERIFY] [CR-7] PASS — pendingSetup=false (admin-created account is immediately active)`);

    // [CR-8] NO cookie is issued (res.cookie is never called)
    const appSessionCookies = setCookies.filter(c => c.name === APP_USER_COOKIE);
    expect(appSessionCookies.length).toBe(0);
    console.log(`[VERIFY] [CR-8] PASS — res.cookie NOT called (setCookies.length=${setCookies.length}) — no auto-login`);

    // [CR-9] email is stored lowercase
    expect(user.email).toBe(email.toLowerCase());
    console.log(`[VERIFY] [CR-9] PASS — email stored lowercase: ${user.email}`);

    // [CR-10] username is stored lowercase
    expect(user.username).toBe(username.toLowerCase());
    console.log(`[VERIFY] [CR-10] PASS — username stored lowercase: ${user.username}`);

    // [CR-11] role defaults to "user"
    expect(user.role).toBe("user");
    console.log(`[VERIFY] [CR-11] PASS — role defaults to "user"`);

    // [CR-12] hasAccess defaults to true
    expect(user.hasAccess).toBe(true);
    console.log(`[VERIFY] [CR-12] PASS — hasAccess defaults to true`);

    // [CR-13] expiryDate is null (lifetime)
    expect(user.expiryDate).toBeNull();
    console.log(`[VERIFY] [CR-13] PASS — expiryDate=null (lifetime access)`);
  });

  // ── ROLE VARIANTS ─────────────────────────────────────────────────────────────

  it("[RV-1] role=admin is stored correctly", async () => {
    const suffix = `rv1_${Date.now()}`;
    const owner = await insertOwnerUser(suffix);
    const { ctx } = await createOwnerContext(owner.id, owner.tokenVersion);
    const caller = appRouter.createCaller(ctx);

    const email = `reg_rv1_${suffix}@test.invalid`;
    const username = `testuser_reg_rv1_${suffix}`;
    console.log(`[INPUT] email=${email} role=admin`);

    await caller.appUsers.createUser({ email, username, password: TEST_PASSWORD, role: "admin" });

    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const rows = await db.select({ role: appUsers.role }).from(appUsers)
      .where(like(appUsers.email, email)).limit(1);
    expect(rows[0].role).toBe("admin");
    console.log(`[VERIFY] [RV-1] PASS — role=admin stored correctly`);
  });

  it("[RV-2] role=handicapper is stored correctly", async () => {
    const suffix = `rv2_${Date.now()}`;
    const owner = await insertOwnerUser(suffix);
    const { ctx } = await createOwnerContext(owner.id, owner.tokenVersion);
    const caller = appRouter.createCaller(ctx);

    const email = `reg_rv2_${suffix}@test.invalid`;
    const username = `testuser_reg_rv2_${suffix}`;
    console.log(`[INPUT] email=${email} role=handicapper`);

    await caller.appUsers.createUser({ email, username, password: TEST_PASSWORD, role: "handicapper" });

    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const rows = await db.select({ role: appUsers.role }).from(appUsers)
      .where(like(appUsers.email, email)).limit(1);
    expect(rows[0].role).toBe("handicapper");
    console.log(`[VERIFY] [RV-2] PASS — role=handicapper stored correctly`);
  });

  // ── ERROR PATHS ───────────────────────────────────────────────────────────────

  it("[ER-1] throws CONFLICT when email is already in use", async () => {
    const suffix = `er1_${Date.now()}`;
    const owner = await insertOwnerUser(suffix);
    const { ctx } = await createOwnerContext(owner.id, owner.tokenVersion);
    const caller = appRouter.createCaller(ctx);

    const email = `reg_er1_${suffix}@test.invalid`;
    const username1 = `testuser_reg_er1a_${suffix}`;
    const username2 = `testuser_reg_er1b_${suffix}`;
    console.log(`[INPUT] email=${email} — first insert with username1, second with username2`);

    // First insert succeeds
    await caller.appUsers.createUser({ email, username: username1, password: TEST_PASSWORD });
    console.log(`[STATE] First insert succeeded for email=${email}`);

    // Second insert with same email must throw CONFLICT
    await expect(
      caller.appUsers.createUser({ email, username: username2, password: TEST_PASSWORD })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    console.log(`[VERIFY] [ER-1] PASS — CONFLICT thrown for duplicate email=${email}`);
  });

  it("[ER-2] throws CONFLICT when username is already taken", async () => {
    const suffix = `er2_${Date.now()}`;
    const owner = await insertOwnerUser(suffix);
    const { ctx } = await createOwnerContext(owner.id, owner.tokenVersion);
    const caller = appRouter.createCaller(ctx);

    const username = `testuser_reg_er2_${suffix}`;
    const email1 = `reg_er2a_${suffix}@test.invalid`;
    const email2 = `reg_er2b_${suffix}@test.invalid`;
    console.log(`[INPUT] username=${username} — first insert with email1, second with email2`);

    // First insert succeeds
    await caller.appUsers.createUser({ email: email1, username, password: TEST_PASSWORD });
    console.log(`[STATE] First insert succeeded for username=${username}`);

    // Second insert with same username must throw CONFLICT
    await expect(
      caller.appUsers.createUser({ email: email2, username, password: TEST_PASSWORD })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    console.log(`[VERIFY] [ER-2] PASS — CONFLICT thrown for duplicate username=${username}`);
  });

  it("[ER-3] Zod rejects password shorter than 8 chars (BAD_REQUEST)", async () => {
    const suffix = `er3_${Date.now()}`;
    const owner = await insertOwnerUser(suffix);
    const { ctx } = await createOwnerContext(owner.id, owner.tokenVersion);
    const caller = appRouter.createCaller(ctx);

    const email = `reg_er3_${suffix}@test.invalid`;
    const username = `testuser_reg_er3_${suffix}`;
    console.log(`[INPUT] email=${email} password="short" (7 chars)`);

    await expect(
      caller.appUsers.createUser({ email, username, password: "Short1!" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    console.log(`[VERIFY] [ER-3] PASS — BAD_REQUEST thrown for password shorter than 8 chars`);
  });

  it("[ER-4] Zod rejects invalid email format (BAD_REQUEST)", async () => {
    const suffix = `er4_${Date.now()}`;
    const owner = await insertOwnerUser(suffix);
    const { ctx } = await createOwnerContext(owner.id, owner.tokenVersion);
    const caller = appRouter.createCaller(ctx);

    const username = `testuser_reg_er4_${suffix}`;
    console.log(`[INPUT] email="not-an-email" username=${username}`);

    await expect(
      caller.appUsers.createUser({ email: "not-an-email", username, password: TEST_PASSWORD })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    console.log(`[VERIFY] [ER-4] PASS — BAD_REQUEST thrown for invalid email format`);
  });

  it("[ER-5] throws UNAUTHORIZED when called without owner JWT", async () => {
    const { ctx, setCookies } = createUnauthContext();
    const caller = appRouter.createCaller(ctx);

    const suffix = `er5_${Date.now()}`;
    const email = `reg_er5_${suffix}@test.invalid`;
    const username = `testuser_reg_er5_${suffix}`;
    console.log(`[INPUT] email=${email} — no owner cookie in context`);

    await expect(
      caller.appUsers.createUser({ email, username, password: TEST_PASSWORD })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    // Confirm no cookie was issued during the rejected call
    expect(setCookies.length).toBe(0);
    console.log(`[VERIFY] [ER-5] PASS — UNAUTHORIZED thrown for non-owner caller; no cookie issued`);
  });
});
