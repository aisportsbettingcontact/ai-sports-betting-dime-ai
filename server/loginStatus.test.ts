/**
 * loginStatus.test.ts
 *
 * Tests for:
 *   1. checkLoginRateLimit — verifies lockoutUntil is returned correctly
 *   2. appUsers.getLoginStatus tRPC procedure — verifies the full round-trip
 *
 * [INPUT]  Mocked TrpcContext with controlled IP address
 * [STEP]   Manipulate loginRateMap directly to simulate failure states
 * [OUTPUT] { remainingAttempts, lockoutUntil, maxAttempts, isLockedOut }
 * [VERIFY] All fields match expected values for each failure scenario
 *
 * Isolation: Each test clears loginRateMap before running to prevent cross-test pollution.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  checkLoginRateLimit,
  recordLoginFailure,
  loginRateMap,
  LOGIN_RATE_MAX_FAILURES,
  LOGIN_RATE_WINDOW_MS,
} from "./routers/appUsers";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { resolveClientIdentity } from "./_core/clientIdentity";

// ── Test IP constants ──────────────────────────────────────────────────────────
const TEST_IP = "10.0.0.1";
const CLEAN_IP = "10.0.0.2";

// ── Context factory ────────────────────────────────────────────────────────────
function createContext(ip: string = TEST_IP): TrpcContext {
  return {
    req: {
      headers: { "x-forwarded-for": ip },
      socket: { remoteAddress: ip },
      get: () => undefined,
      method: "GET",
      ip,
    } as unknown as TrpcContext["req"],
    res: {
      cookie: () => {},
      clearCookie: () => {},
    } as unknown as TrpcContext["res"],
    user: null,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function injectFailures(ip: string, count: number, ageMs = 0): void {
  const now = Date.now();
  loginRateMap.set(ip, {
    failTimestamps: Array.from({ length: count }, () => now - ageMs),
  });
}

// ── Setup ──────────────────────────────────────────────────────────────────────
beforeEach(() => {
  loginRateMap.clear();
  console.log("[TEST] loginRateMap cleared");
});

// ── checkLoginRateLimit unit tests ─────────────────────────────────────────────
describe("checkLoginRateLimit", () => {
  it("returns allowed=true and lockoutUntil=null for a fresh IP", () => {
    console.log("[INPUT] IP with no failures");
    const result = checkLoginRateLimit(CLEAN_IP);
    console.log(`[OUTPUT] ${JSON.stringify(result)}`);
    expect(result.allowed).toBe(true);
    expect(result.remainingAttempts).toBe(LOGIN_RATE_MAX_FAILURES);
    expect(result.lockoutUntil).toBeNull();
    console.log("[VERIFY] PASS");
  });

  it("decrements remainingAttempts correctly after failures", () => {
    console.log("[INPUT] 3 failures injected");
    injectFailures(TEST_IP, 3);
    const result = checkLoginRateLimit(TEST_IP);
    console.log(`[OUTPUT] ${JSON.stringify(result)}`);
    expect(result.allowed).toBe(true);
    expect(result.remainingAttempts).toBe(LOGIN_RATE_MAX_FAILURES - 3);
    expect(result.lockoutUntil).toBeNull();
    console.log("[VERIFY] PASS");
  });

  it("returns allowed=false and a valid lockoutUntil when at max failures", () => {
    const now = Date.now();
    console.log(
      `[INPUT] ${LOGIN_RATE_MAX_FAILURES} failures injected at t=now`
    );
    injectFailures(TEST_IP, LOGIN_RATE_MAX_FAILURES);
    const result = checkLoginRateLimit(TEST_IP);
    console.log(
      `[OUTPUT] ${JSON.stringify({ ...result, lockoutUntil: result.lockoutUntil ? new Date(result.lockoutUntil).toISOString() : null })}`
    );
    expect(result.allowed).toBe(false);
    expect(result.remainingAttempts).toBe(0);
    expect(result.lockoutUntil).not.toBeNull();
    const expectedLockout = now + LOGIN_RATE_WINDOW_MS;
    expect(result.lockoutUntil!).toBeGreaterThanOrEqual(expectedLockout - 1000);
    expect(result.lockoutUntil!).toBeLessThanOrEqual(expectedLockout + 1000);
    console.log("[VERIFY] PASS");
  });

  it("allows requests again after the window expires (expired timestamps pruned)", () => {
    const expiredAge = LOGIN_RATE_WINDOW_MS + 1000;
    console.log(
      `[INPUT] ${LOGIN_RATE_MAX_FAILURES} failures injected ${expiredAge}ms ago (expired)`
    );
    injectFailures(TEST_IP, LOGIN_RATE_MAX_FAILURES, expiredAge);
    const result = checkLoginRateLimit(TEST_IP);
    console.log(`[OUTPUT] ${JSON.stringify(result)}`);
    expect(result.allowed).toBe(true);
    expect(result.remainingAttempts).toBe(LOGIN_RATE_MAX_FAILURES);
    expect(result.lockoutUntil).toBeNull();
    console.log("[VERIFY] PASS — expired timestamps pruned correctly");
  });

  it("lockoutUntil is in the future when locked out", () => {
    console.log(`[INPUT] ${LOGIN_RATE_MAX_FAILURES} fresh failures`);
    injectFailures(TEST_IP, LOGIN_RATE_MAX_FAILURES);
    const result = checkLoginRateLimit(TEST_IP);
    console.log(`[OUTPUT] lockoutUntil=${result.lockoutUntil}`);
    expect(result.lockoutUntil).not.toBeNull();
    expect(result.lockoutUntil!).toBeGreaterThan(Date.now());
    console.log("[VERIFY] PASS — lockoutUntil is in the future");
  });
});

// ── recordLoginFailure unit tests ──────────────────────────────────────────────
describe("recordLoginFailure", () => {
  it("creates a new entry for a fresh IP", () => {
    console.log("[INPUT] recordLoginFailure on fresh IP");
    expect(loginRateMap.has(TEST_IP)).toBe(false);
    recordLoginFailure(TEST_IP);
    expect(loginRateMap.has(TEST_IP)).toBe(true);
    expect(loginRateMap.get(TEST_IP)!.failTimestamps).toHaveLength(1);
    console.log("[VERIFY] PASS");
  });

  it("appends to existing entry", () => {
    console.log("[INPUT] 2 existing failures, adding 1 more");
    injectFailures(TEST_IP, 2);
    recordLoginFailure(TEST_IP);
    expect(loginRateMap.get(TEST_IP)!.failTimestamps).toHaveLength(3);
    console.log("[VERIFY] PASS");
  });
});

// ── getLoginStatus tRPC procedure tests ────────────────────────────────────────
describe("appUsers.getLoginStatus", () => {
  it("returns full maxAttempts remaining for a fresh IP", async () => {
    console.log("[INPUT] getLoginStatus for fresh IP");
    const caller = appRouter.createCaller(createContext(CLEAN_IP));
    const result = await caller.appUsers.getLoginStatus();
    console.log(`[OUTPUT] ${JSON.stringify(result)}`);
    expect(result.remainingAttempts).toBe(LOGIN_RATE_MAX_FAILURES);
    expect(result.lockoutUntil).toBeNull();
    expect(result.maxAttempts).toBe(LOGIN_RATE_MAX_FAILURES);
    expect(result.isLockedOut).toBe(false);
    console.log("[VERIFY] PASS");
  });

  it("reflects failure count correctly after injected failures", async () => {
    const failureCount = 5;
    console.log(`[INPUT] ${failureCount} failures injected for ${TEST_IP}`);
    injectFailures(TEST_IP, failureCount);
    const caller = appRouter.createCaller(createContext(TEST_IP));
    const result = await caller.appUsers.getLoginStatus();
    console.log(`[OUTPUT] ${JSON.stringify(result)}`);
    expect(result.remainingAttempts).toBe(
      LOGIN_RATE_MAX_FAILURES - failureCount
    );
    expect(result.isLockedOut).toBe(false);
    expect(result.lockoutUntil).toBeNull();
    console.log("[VERIFY] PASS");
  });

  it("returns isLockedOut=true and valid lockoutUntil when at max failures", async () => {
    const now = Date.now();
    console.log(
      `[INPUT] ${LOGIN_RATE_MAX_FAILURES} failures injected for ${TEST_IP}`
    );
    injectFailures(TEST_IP, LOGIN_RATE_MAX_FAILURES);
    const caller = appRouter.createCaller(createContext(TEST_IP));
    const result = await caller.appUsers.getLoginStatus();
    console.log(
      `[OUTPUT] ${JSON.stringify({ ...result, lockoutUntil: result.lockoutUntil ? new Date(result.lockoutUntil).toISOString() : null })}`
    );
    expect(result.isLockedOut).toBe(true);
    expect(result.remainingAttempts).toBe(0);
    expect(result.lockoutUntil).not.toBeNull();
    expect(result.lockoutUntil!).toBeGreaterThan(now);
    expect(result.maxAttempts).toBe(LOGIN_RATE_MAX_FAILURES);
    console.log("[VERIFY] PASS");
  });

  it("does NOT consume an attempt when called (read-only)", async () => {
    const failureCount = 3;
    console.log(
      `[INPUT] ${failureCount} failures, calling getLoginStatus 5 times`
    );
    injectFailures(TEST_IP, failureCount);
    const caller = appRouter.createCaller(createContext(TEST_IP));
    for (let i = 0; i < 5; i++) {
      await caller.appUsers.getLoginStatus();
    }
    const entry = loginRateMap.get(TEST_IP);
    console.log(
      `[STATE] failTimestamps.length after 5 calls: ${entry?.failTimestamps.length}`
    );
    expect(entry?.failTimestamps.length).toBe(failureCount);
    console.log("[VERIFY] PASS — getLoginStatus is read-only");
  });
});

describe("login identity keying (2026-08-06 audit)", () => {
  const ORIGINAL_EDGE_MODE = process.env.EDGE_MODE;
  const ORIGINAL_EDGE_ORIGIN_SECRET = process.env.EDGE_ORIGIN_SECRET;

  afterEach(() => {
    if (ORIGINAL_EDGE_MODE === undefined) delete process.env.EDGE_MODE;
    else process.env.EDGE_MODE = ORIGINAL_EDGE_MODE;
    if (ORIGINAL_EDGE_ORIGIN_SECRET === undefined) delete process.env.EDGE_ORIGIN_SECRET;
    else process.env.EDGE_ORIGIN_SECRET = ORIGINAL_EDGE_ORIGIN_SECRET;
  });

  it("keys on the true visitor, not the Cloudflare PoP", () => {
    process.env.EDGE_ORIGIN_SECRET = "test-secret";
    process.env.EDGE_MODE = "on";
    // The PRODUCTION shape. Every prior test in this file used a bare
    // single-IP XFF, which is exactly why the PoP-keying defect survived.
    const req = {
      headers: {
        "x-forwarded-for": "172.71.156.192, 152.233.23.193",
        "cf-connecting-ip": "203.0.113.42",
        "x-dime-edge-secret": "test-secret",
      },
      ip: "152.233.23.193",
      socket: { remoteAddress: "152.233.23.193" },
    };
    expect(resolveClientIdentity(req)).toBe("203.0.113.42");
    expect(resolveClientIdentity(req)).not.toBe("172.71.156.192");
  });

  it("two visitors behind ONE PoP do not share a login budget", () => {
    process.env.EDGE_ORIGIN_SECRET = "test-secret";
    process.env.EDGE_MODE = "on";
    const pop = "172.71.156.192";
    const mk = (client: string) => ({
      headers: {
        "x-forwarded-for": `${pop}, 152.233.23.193`,
        "cf-connecting-ip": client,
        "x-dime-edge-secret": "test-secret",
      },
      ip: "152.233.23.193",
    });
    expect(resolveClientIdentity(mk("203.0.113.1"))).not.toBe(
      resolveClientIdentity(mk("203.0.113.2"))
    );
  });

  // ── Integration proof ──────────────────────────────────────────────────────
  // The two tests above exercise resolveClientIdentity() directly — they pass
  // regardless of whether appUsers.ts's call sites were ever migrated to use
  // it, so on their own they cannot prove the fix landed at the call site.
  // These two drive the ACTUAL login mutation and getLoginStatus query through
  // appRouter.createCaller with the production CF-shaped request, so they only
  // pass once `clientIp` / `ip` in appUsers.ts resolve through the same
  // identity as resolveClientIdentity().

  it("login mutation blocks the true (cf-connecting-ip) visitor when THEY are locked out, before any DB query", async () => {
    process.env.EDGE_ORIGIN_SECRET = "test-secret";
    process.env.EDGE_MODE = "on";
    const trueClient = "203.0.113.42";
    const pop = "172.71.156.192";
    // Only the true visitor is over the limit. Old (PoP-keyed) code would
    // check `pop`, find it clean, and NOT block.
    injectFailures(trueClient, LOGIN_RATE_MAX_FAILURES);

    const ctx: TrpcContext = {
      req: {
        headers: {
          "x-forwarded-for": `${pop}, 152.233.23.193`,
          "cf-connecting-ip": trueClient,
          "x-dime-edge-secret": "test-secret",
        },
        socket: { remoteAddress: "152.233.23.193" },
        get: () => undefined,
        method: "POST",
        ip: "152.233.23.193",
      } as unknown as TrpcContext["req"],
      res: {
        cookie: () => {},
        clearCookie: () => {},
      } as unknown as TrpcContext["res"],
      user: null,
    };
    const caller = appRouter.createCaller(ctx);

    // The rate-limit check runs BEFORE any DB lookup, so this assertion holds
    // with no DATABASE_URL present.
    await expect(
      caller.appUsers.login({
        emailOrUsername: "someone@example.com",
        password: "irrelevant",
        stayLoggedIn: false,
      })
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });

  it("getLoginStatus does not report a clean cf-connecting-ip visitor as locked out just because their Cloudflare PoP is", async () => {
    process.env.EDGE_ORIGIN_SECRET = "test-secret";
    process.env.EDGE_MODE = "on";
    const pop = "172.71.156.192";
    const cleanClient = "203.0.113.99";
    // Simulate OTHER visitors behind this PoP having maxed out the OLD
    // (PoP-keyed) shared budget. `cleanClient` themselves has no failures.
    injectFailures(pop, LOGIN_RATE_MAX_FAILURES);

    const ctx: TrpcContext = {
      req: {
        headers: {
          "x-forwarded-for": `${pop}, 152.233.23.193`,
          "cf-connecting-ip": cleanClient,
          "x-dime-edge-secret": "test-secret",
        },
        socket: { remoteAddress: "152.233.23.193" },
        get: () => undefined,
        method: "GET",
        ip: "152.233.23.193",
      } as unknown as TrpcContext["req"],
      res: {
        cookie: () => {},
        clearCookie: () => {},
      } as unknown as TrpcContext["res"],
      user: null,
    };
    const caller = appRouter.createCaller(ctx);

    const result = await caller.appUsers.getLoginStatus();
    expect(result.isLockedOut).toBe(false);
    expect(result.remainingAttempts).toBe(LOGIN_RATE_MAX_FAILURES);
  });
});
