/**
 * tokenVersion.db.test.ts
 *
 * DB-level and procedure-level tests for the force-logout / tokenVersion
 * invalidation system. Complements tokenVersion.test.ts (which covers
 * verifyAppUserToken + mismatch logic in pure unit tests without DB).
 *
 * This file adds the missing end-to-end and DB-level invariants:
 *
 * ── Test surface (14 invariants) ──────────────────────────────────────────────
 *
 *  DB-LEVEL incrementTokenVersion
 *   [TV-1]  tokenVersion starts at 1 for a fresh insert
 *   [TV-2]  incrementTokenVersion returns newTv = oldTv + 1
 *   [TV-3]  DB row reflects the incremented value after the call
 *   [TV-4]  calling incrementTokenVersion twice increments by 2 total
 *
 *  END-TO-END JWT REJECTION via appUserProcedure (real DB)
 *   [JR-1]  JWT with stale tv is rejected by appUserProcedure (UNAUTHORIZED)
 *   [JR-2]  JWT with fresh tv is accepted by appUserProcedure
 *   [JR-3]  JWT without tv claim (tv=null) is accepted — null skips the check
 *
 *  forceLogoutUser procedure (ownerProcedure — real DB)
 *   [FL-1]  forceLogoutUser returns success=true and newTokenVersion=oldTv+1
 *   [FL-2]  DB tokenVersion matches newTokenVersion after the call
 *   [FL-3]  forceLogoutUser throws BAD_REQUEST for self-logout
 *   [FL-4]  forceLogoutUser throws NOT_FOUND for unknown userId
 *   [FL-5]  end-to-end: old JWT rejected after forceLogoutUser
 *   [FL-6]  end-to-end: new JWT (re-signed with newTv) accepted after forceLogoutUser
 *
 *  incrementAllTokenVersions
 *   [FA-1]  increments tokenVersion for all users except the excluded owner
 *   [FA-2]  returns count of affected users (>= 1 for the target user)
 *   [FA-3]  excluded owner's tokenVersion is NOT incremented
 *
 * ── Strategy ──────────────────────────────────────────────────────────────────
 *  - Uses real DB (DATABASE_URL is available in the sandbox test environment)
 *  - Uses real appRouter.createCaller for procedure-level tests
 *  - Owner context is constructed by inserting a real owner user + signing a JWT
 *    with their userId/tokenVersion and setting req.headers.cookie accordingly
 *  - appUserProcedure is tested via appUsers.me (a publicProcedure that reads
 *    the app_session cookie and returns the current user — simplest auth gate test)
 *  - afterAll deletes all rows whose username starts with "testuser_tvdb_"
 *
 * ── Isolation ─────────────────────────────────────────────────────────────────
 *  Each test inserts fresh rows with unique usernames prefixed "testuser_tvdb_".
 *  afterAll deletes all such rows to prevent DB pollution.
 */

import { describe, it, expect, afterAll } from "vitest";
import { appRouter } from "./routers";
import { APP_USER_COOKIE, signAppUserToken } from "./routers/appUsers";
import type { TrpcContext } from "./_core/context";
import { getDb, getAppUserById, incrementTokenVersion, incrementAllTokenVersions } from "./db";
import { appUsers } from "../drizzle/schema";
import { like, eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

// ── Constants ──────────────────────────────────────────────────────────────────
const TEST_PASSWORD = "TvDb1!Test";

// ── Types ──────────────────────────────────────────────────────────────────────
type InsertedUser = {
  id: number;
  username: string;
  email: string;
  tokenVersion: number;
};

// ── User factory ───────────────────────────────────────────────────────────────
async function insertUser(
  suffix: string,
  role: "owner" | "admin" | "handicapper" | "user" = "user"
): Promise<InsertedUser> {
  const db = await getDb();
  if (!db) throw new Error("[insertUser] Database not available");

  const email = `tvdb_${suffix}@test.invalid`;
  const username = `testuser_tvdb_${suffix}`;
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 4);

  console.log(`[insertUser] [INPUT] suffix=${suffix} role=${role} email=${email}`);

  await db.insert(appUsers).values({
    email,
    username,
    passwordHash,
    role,
    hasAccess: true,
    expiryDate: null,
    tokenVersion: 1,
    pendingSetup: false,
  });

  const rows = await db
    .select({ id: appUsers.id, tokenVersion: appUsers.tokenVersion })
    .from(appUsers)
    .where(eq(appUsers.username, username))
    .limit(1);

  const id = rows[0]?.id ?? 0;
  const tokenVersion = rows[0]?.tokenVersion ?? 1;
  console.log(`[insertUser] [OUTPUT] id=${id} tokenVersion=${tokenVersion}`);
  return { id, username, email, tokenVersion };
}

// ── Context factory ────────────────────────────────────────────────────────────
function createContextWithCookie(jwt: string, protocol: "http" | "https" = "http"): TrpcContext {
  return {
    user: null,
    req: {
      protocol,
      headers: {
        cookie: `${APP_USER_COOKIE}=${jwt}`,
      },
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

// ── Cleanup ────────────────────────────────────────────────────────────────────
afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(appUsers).where(like(appUsers.username, "testuser_tvdb_%"));
  console.log("[afterAll] [STEP] Deleted all test users with username LIKE 'testuser_tvdb_%'");
});

// ── Test suite ─────────────────────────────────────────────────────────────────
describe("tokenVersion.db — DB-level and procedure-level force-logout invariants", () => {

  // ── DB-LEVEL incrementTokenVersion ───────────────────────────────────────────

  it("[TV-1..4] incrementTokenVersion increments DB tokenVersion atomically", async () => {
    const suffix = `tv_${Date.now()}`;
    const user = await insertUser(suffix, "user");

    console.log(`[INPUT] userId=${user.id} initial tokenVersion=${user.tokenVersion}`);

    // [TV-1] tokenVersion starts at 1 for a fresh insert
    expect(user.tokenVersion).toBe(1);
    console.log(`[VERIFY] [TV-1] PASS — initial tokenVersion=1`);

    // [TV-2] incrementTokenVersion returns newTv = oldTv + 1
    const newTv = await incrementTokenVersion(user.id);
    expect(newTv).toBe(2);
    console.log(`[VERIFY] [TV-2] PASS — incrementTokenVersion returned newTv=${newTv}`);

    // [TV-3] DB row reflects the incremented value
    const freshRow = await getAppUserById(user.id);
    expect(freshRow?.tokenVersion).toBe(2);
    console.log(`[VERIFY] [TV-3] PASS — DB tokenVersion=${freshRow?.tokenVersion} after increment`);

    // [TV-4] calling incrementTokenVersion twice increments by 2 total
    const newTv2 = await incrementTokenVersion(user.id);
    expect(newTv2).toBe(3);
    const freshRow2 = await getAppUserById(user.id);
    expect(freshRow2?.tokenVersion).toBe(3);
    console.log(`[VERIFY] [TV-4] PASS — second increment: DB tokenVersion=${freshRow2?.tokenVersion}`);
  });

  // ── END-TO-END JWT REJECTION via appUserProcedure ────────────────────────────

  it("[JR-1,2] stale tv JWT rejected; fresh tv JWT accepted by appUserProcedure (real DB)", async () => {
    const suffix = `jr_${Date.now()}`;
    const user = await insertUser(suffix, "user");

    console.log(`[INPUT] userId=${user.id} tokenVersion=${user.tokenVersion}`);

    // Sign JWT with CURRENT tokenVersion (tv=1)
    const oldJwt = await signAppUserToken(user.id, "user", user.tokenVersion);
    console.log(`[STATE] oldJwt signed with tv=${user.tokenVersion}`);

    // Increment tokenVersion in DB — old JWT is now stale
    const newTv = await incrementTokenVersion(user.id);
    console.log(`[STATE] DB tokenVersion incremented to ${newTv} — oldJwt is now stale`);

    // [JR-1] Old JWT is rejected by appUserProcedure (UNAUTHORIZED)
    // NOTE: appUsers.me is a publicProcedure — it returns null for stale tokens, not UNAUTHORIZED.
    // Use metrics.sessionHeartbeat which is an appUserProcedure mutation — it throws UNAUTHORIZED.
    const staleCtx = createContextWithCookie(oldJwt);
    const staleCaller = appRouter.createCaller(staleCtx);
    await expect(staleCaller.metrics.sessionHeartbeat()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    console.log(`[VERIFY] [JR-1] PASS — stale JWT (tv=${user.tokenVersion}) rejected by appUserProcedure with UNAUTHORIZED`);

    // Sign JWT with NEW tokenVersion
    const newJwt = await signAppUserToken(user.id, "user", newTv);
    console.log(`[STATE] newJwt signed with tv=${newTv}`);

    // [JR-2] New JWT is accepted by appUserProcedure
    const freshCtx = createContextWithCookie(newJwt);
    const freshCaller = appRouter.createCaller(freshCtx);
    const heartbeatResult = await freshCaller.metrics.sessionHeartbeat();
    expect(heartbeatResult.ok).toBe(true);
    console.log(`[VERIFY] [JR-2] PASS — fresh JWT (tv=${newTv}) accepted by appUserProcedure; heartbeat.ok=${heartbeatResult.ok}`);
  });

  it("[JR-3] JWT without tv claim (tv=null) is accepted — null skips the tokenVersion check", async () => {
    const suffix = `jr3_${Date.now()}`;
    const user = await insertUser(suffix, "user");

    console.log(`[INPUT] userId=${user.id} — signing JWT without tv claim`);

    // Craft a JWT without the tv field using jose directly
    const { SignJWT } = await import("jose");
    const { ENV } = await import("./_core/env");
    const secret = new TextEncoder().encode(ENV.cookieSecret);
    const jwtWithoutTv = await new SignJWT({ sub: String(user.id), role: "user", type: "app_user" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("90d")
      .sign(secret);

    console.log(`[STATE] JWT signed without tv claim`);

    // Increment tokenVersion — if tv=null skips the check, this JWT should still work
    const newTv = await incrementTokenVersion(user.id);
    console.log(`[STATE] DB tokenVersion incremented to ${newTv} — JWT without tv should still be accepted`);

    const ctx = createContextWithCookie(jwtWithoutTv);
    const caller = appRouter.createCaller(ctx);
    const meResult = await caller.appUsers.me();
    expect(meResult).not.toBeNull();
    expect(meResult?.id).toBe(user.id);
    console.log(`[VERIFY] [JR-3] PASS — JWT without tv accepted (null tv skips tokenVersion check); me().id=${meResult?.id}`);
  });

  // ── forceLogoutUser procedure ─────────────────────────────────────────────────

  it("[FL-1,2] forceLogoutUser increments tokenVersion and returns newTokenVersion", async () => {
    const ownerSuffix = `fl_owner_${Date.now()}`;
    const targetSuffix = `fl_target_${Date.now()}`;

    const owner = await insertUser(ownerSuffix, "owner");
    const target = await insertUser(targetSuffix, "user");

    console.log(`[INPUT] owner.id=${owner.id} target.id=${target.id} target.tokenVersion=${target.tokenVersion}`);

    const ownerJwt = await signAppUserToken(owner.id, "owner", owner.tokenVersion);
    const ownerCtx = createContextWithCookie(ownerJwt);
    const ownerCaller = appRouter.createCaller(ownerCtx);

    // [FL-1] forceLogoutUser returns success=true and newTokenVersion=oldTv+1
    const result = await ownerCaller.appUsers.forceLogoutUser({ id: target.id });
    expect(result.success).toBe(true);
    expect(result.newTokenVersion).toBe(target.tokenVersion + 1);
    console.log(`[VERIFY] [FL-1] PASS — forceLogoutUser returned success=true newTokenVersion=${result.newTokenVersion}`);

    // [FL-2] DB tokenVersion matches newTokenVersion after the call
    const freshRow = await getAppUserById(target.id);
    expect(freshRow?.tokenVersion).toBe(target.tokenVersion + 1);
    console.log(`[VERIFY] [FL-2] PASS — DB tokenVersion=${freshRow?.tokenVersion} === newTokenVersion=${result.newTokenVersion}`);
  });

  it("[FL-3] forceLogoutUser throws BAD_REQUEST when owner tries to logout themselves", async () => {
    const ownerSuffix = `fl3_${Date.now()}`;
    const owner = await insertUser(ownerSuffix, "owner");

    console.log(`[INPUT] owner.id=${owner.id} — attempting self-logout`);

    const ownerJwt = await signAppUserToken(owner.id, "owner", owner.tokenVersion);
    const ownerCtx = createContextWithCookie(ownerJwt);
    const ownerCaller = appRouter.createCaller(ownerCtx);

    await expect(
      ownerCaller.appUsers.forceLogoutUser({ id: owner.id })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    console.log(`[VERIFY] [FL-3] PASS — BAD_REQUEST thrown for self-logout attempt`);
  });

  it("[FL-4] forceLogoutUser throws NOT_FOUND for unknown userId", async () => {
    const ownerSuffix = `fl4_${Date.now()}`;
    const owner = await insertUser(ownerSuffix, "owner");

    const ownerJwt = await signAppUserToken(owner.id, "owner", owner.tokenVersion);
    const ownerCtx = createContextWithCookie(ownerJwt);
    const ownerCaller = appRouter.createCaller(ownerCtx);

    const nonExistentId = 999999999;
    console.log(`[INPUT] nonExistentId=${nonExistentId}`);

    await expect(
      ownerCaller.appUsers.forceLogoutUser({ id: nonExistentId })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    console.log(`[VERIFY] [FL-4] PASS — NOT_FOUND thrown for unknown userId=${nonExistentId}`);
  });

  it("[FL-5,6] end-to-end: old JWT rejected after forceLogoutUser; new JWT accepted", async () => {
    const ownerSuffix = `fl56_owner_${Date.now()}`;
    const targetSuffix = `fl56_target_${Date.now()}`;

    const owner = await insertUser(ownerSuffix, "owner");
    const target = await insertUser(targetSuffix, "user");

    console.log(`[INPUT] owner.id=${owner.id} target.id=${target.id}`);

    // Sign old JWT for target BEFORE force-logout
    const oldTargetJwt = await signAppUserToken(target.id, "user", target.tokenVersion);
    console.log(`[STATE] oldTargetJwt signed with tv=${target.tokenVersion}`);

    // Force-logout the target
    const ownerJwt = await signAppUserToken(owner.id, "owner", owner.tokenVersion);
    const ownerCtx = createContextWithCookie(ownerJwt);
    const ownerCaller = appRouter.createCaller(ownerCtx);
    const forceResult = await ownerCaller.appUsers.forceLogoutUser({ id: target.id });
    const newTv = forceResult.newTokenVersion;
    console.log(`[STATE] forceLogoutUser complete — newTv=${newTv}`);

    // [FL-5] Old JWT is rejected after force-logout
    // NOTE: appUsers.me is publicProcedure — returns null for stale tokens, not UNAUTHORIZED.
    // Use metrics.sessionHeartbeat (appUserProcedure) to assert UNAUTHORIZED is thrown.
    const staleCtx = createContextWithCookie(oldTargetJwt);
    const staleCaller = appRouter.createCaller(staleCtx);
    await expect(staleCaller.metrics.sessionHeartbeat()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    console.log(`[VERIFY] [FL-5] PASS — old JWT (tv=${target.tokenVersion}) rejected by appUserProcedure after forceLogoutUser`);

    // [FL-6] New JWT (re-signed with newTv) is accepted by appUserProcedure
    const newTargetJwt = await signAppUserToken(target.id, "user", newTv);
    const freshCtx = createContextWithCookie(newTargetJwt);
    const freshCaller = appRouter.createCaller(freshCtx);
    const heartbeatResult = await freshCaller.metrics.sessionHeartbeat();
    expect(heartbeatResult.ok).toBe(true);
    console.log(`[VERIFY] [FL-6] PASS — new JWT (tv=${newTv}) accepted by appUserProcedure after forceLogoutUser; heartbeat.ok=${heartbeatResult.ok}`);
  });

  // ── incrementAllTokenVersions ─────────────────────────────────────────────────

  it("[FA-1..3] incrementAllTokenVersions increments all users except the excluded owner", async () => {
    const ownerSuffix = `fa_owner_${Date.now()}`;
    const userSuffix = `fa_user_${Date.now()}`;

    const owner = await insertUser(ownerSuffix, "owner");
    const target = await insertUser(userSuffix, "user");

    const ownerTvBefore = owner.tokenVersion;
    const targetTvBefore = target.tokenVersion;

    console.log(`[INPUT] owner.id=${owner.id} tv=${ownerTvBefore} | target.id=${target.id} tv=${targetTvBefore}`);

    // [FA-1,2] increments tokenVersion for all users except owner; returns count >= 1
    const count = await incrementAllTokenVersions(owner.id);
    expect(count).toBeGreaterThanOrEqual(1);
    console.log(`[VERIFY] [FA-1] PASS — incrementAllTokenVersions affected ${count} users`);
    console.log(`[VERIFY] [FA-2] PASS — count=${count} >= 1`);

    // [FA-1] target's tokenVersion is incremented
    const targetAfter = await getAppUserById(target.id);
    expect(targetAfter?.tokenVersion).toBe(targetTvBefore + 1);
    console.log(`[VERIFY] [FA-1] PASS — target tokenVersion: ${targetTvBefore} → ${targetAfter?.tokenVersion}`);

    // [FA-3] owner's tokenVersion is NOT incremented
    const ownerAfter = await getAppUserById(owner.id);
    expect(ownerAfter?.tokenVersion).toBe(ownerTvBefore);
    console.log(`[VERIFY] [FA-3] PASS — owner tokenVersion unchanged: ${ownerAfter?.tokenVersion} === ${ownerTvBefore}`);
  });

});
