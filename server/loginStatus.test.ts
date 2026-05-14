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

import { describe, expect, it, beforeEach } from "vitest";
import {
  checkLoginRateLimit,
  recordLoginFailure,
  loginRateMap,
  LOGIN_RATE_MAX_FAILURES,
  LOGIN_RATE_WINDOW_MS,
} from "./routers/appUsers";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

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
    console.log(`[INPUT] ${LOGIN_RATE_MAX_FAILURES} failures injected at t=now`);
    injectFailures(TEST_IP, LOGIN_RATE_MAX_FAILURES);
    const result = checkLoginRateLimit(TEST_IP);
    console.log(`[OUTPUT] ${JSON.stringify({ ...result, lockoutUntil: result.lockoutUntil ? new Date(result.lockoutUntil).toISOString() : null })}`);
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
    console.log(`[INPUT] ${LOGIN_RATE_MAX_FAILURES} failures injected ${expiredAge}ms ago (expired)`);
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
    expect(result.remainingAttempts).toBe(LOGIN_RATE_MAX_FAILURES - failureCount);
    expect(result.isLockedOut).toBe(false);
    expect(result.lockoutUntil).toBeNull();
    console.log("[VERIFY] PASS");
  });

  it("returns isLockedOut=true and valid lockoutUntil when at max failures", async () => {
    const now = Date.now();
    console.log(`[INPUT] ${LOGIN_RATE_MAX_FAILURES} failures injected for ${TEST_IP}`);
    injectFailures(TEST_IP, LOGIN_RATE_MAX_FAILURES);
    const caller = appRouter.createCaller(createContext(TEST_IP));
    const result = await caller.appUsers.getLoginStatus();
    console.log(`[OUTPUT] ${JSON.stringify({ ...result, lockoutUntil: result.lockoutUntil ? new Date(result.lockoutUntil).toISOString() : null })}`);
    expect(result.isLockedOut).toBe(true);
    expect(result.remainingAttempts).toBe(0);
    expect(result.lockoutUntil).not.toBeNull();
    expect(result.lockoutUntil!).toBeGreaterThan(now);
    expect(result.maxAttempts).toBe(LOGIN_RATE_MAX_FAILURES);
    console.log("[VERIFY] PASS");
  });

  it("does NOT consume an attempt when called (read-only)", async () => {
    const failureCount = 3;
    console.log(`[INPUT] ${failureCount} failures, calling getLoginStatus 5 times`);
    injectFailures(TEST_IP, failureCount);
    const caller = appRouter.createCaller(createContext(TEST_IP));
    for (let i = 0; i < 5; i++) {
      await caller.appUsers.getLoginStatus();
    }
    const entry = loginRateMap.get(TEST_IP);
    console.log(`[STATE] failTimestamps.length after 5 calls: ${entry?.failTimestamps.length}`);
    expect(entry?.failTimestamps.length).toBe(failureCount);
    console.log("[VERIFY] PASS — getLoginStatus is read-only");
  });
});
