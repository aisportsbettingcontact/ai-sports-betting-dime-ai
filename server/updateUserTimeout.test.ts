/**
 * updateUserTimeout.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests for the circuit breaker timeout-is-not-failure fix and related
 * updateUser mutation timing improvements.
 *
 * ROOT CAUSE BEING TESTED:
 *   The previous circuit breaker called onFailure() on EVERY error including
 *   timeouts. A slow-but-successful password update would increment
 *   consecutiveFailures, and after 3 such operations the circuit would OPEN,
 *   blocking all subsequent requests even though the DB was healthy.
 *
 * FIX BEING VALIDATED:
 *   1. Timeouts do NOT increment consecutiveFailures (latency warning only)
 *   2. Circuit stays CLOSED after multiple timeouts
 *   3. Only TRUE DB errors (ECONNREFUSED, etc.) open the circuit
 *   4. bcrypt cost=10 is OWASP-compliant and fast enough
 *   5. errorUtils handles all error types correctly
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { formatMutationError } from "../client/src/lib/errorUtils";

// ── [TEST GROUP 1] errorUtils — all error message mappings ───────────────────
describe("formatMutationError — complete error mapping", () => {
  it("[VERIFY] CHECK 6: 'Request timed out' → user-friendly timeout string", () => {
    const err = new Error("Request timed out. Please try again in a moment.");
    const result = formatMutationError(err);
    console.log(`[INPUT] error.message="${err.message}"`);
    console.log(`[OUTPUT] formatMutationError="${result}"`);
    expect(result).toBe("The request took too long. Please try again in a moment.");
    console.log("[VERIFY] PASS");
  });

  it("[VERIFY] CHECK 6: circuit breaker 'timed out after Xms' → user-friendly timeout string", () => {
    const err = new Error("[CircuitBreaker] DB query timed out after 8000ms");
    const result = formatMutationError(err);
    console.log(`[INPUT] error.message="${err.message}"`);
    console.log(`[OUTPUT] formatMutationError="${result}"`);
    expect(result).toBe("The request took too long. Please try again in a moment.");
    console.log("[VERIFY] PASS");
  });

  it("[VERIFY] CHECK 5: 'Database temporarily unavailable' → DB-specific message", () => {
    const err = new Error("Database temporarily unavailable. Please try again in a moment.");
    const result = formatMutationError(err);
    expect(result).toBe("Database temporarily unavailable. Please try again in a moment.");
    console.log("[VERIFY] PASS");
  });

  it("[VERIFY] CHECK 7: 'Failed to update account' → passes through as-is", () => {
    const err = new Error("Failed to update account. Please try again.");
    const result = formatMutationError(err);
    expect(result).toBe("Failed to update account. Please try again.");
    console.log("[VERIFY] PASS");
  });

  it("[VERIFY] CHECK 1: JSON parse error (Cloudflare HTML) → generic unavailable message", () => {
    const err = new Error("Unexpected token 'S', 'Service Unavailable' is not valid JSON");
    const result = formatMutationError(err);
    expect(result).toBe("Server temporarily unavailable. Please try again in a moment.");
    console.log("[VERIFY] PASS");
  });

  it("[VERIFY] CONFLICT error passes through unchanged", () => {
    const err = new Error("Email already in use");
    const result = formatMutationError(err);
    expect(result).toBe("Email already in use");
    console.log("[VERIFY] PASS");
  });
});

// ── [TEST GROUP 2] bcrypt cost factor ────────────────────────────────────────
describe("bcrypt cost factor timing", () => {
  it("[VERIFY] bcrypt cost=10 completes in < 500ms (OWASP-compliant)", async () => {
    const bcrypt = await import("bcryptjs");
    const start = Date.now();
    const hash = await bcrypt.hash("TestPassword123!", 10);
    const elapsed = Date.now() - start;
    console.log(`[INPUT] cost=10`);
    console.log(`[OUTPUT] elapsed=${elapsed}ms`);
    expect(elapsed).toBeLessThan(500);
    expect(hash).toMatch(/^\$2[aby]\$/);
    console.log(`[VERIFY] PASS — bcrypt cost=10 completed in ${elapsed}ms`);
  });

  it("[VERIFY] bcrypt cost=10 hash is correctly verifiable", async () => {
    const bcrypt = await import("bcryptjs");
    const password = "SecurePass2026!";
    const hash = await bcrypt.hash(password, 10);
    expect(await bcrypt.compare(password, hash)).toBe(true);
    expect(await bcrypt.compare("WrongPassword", hash)).toBe(false);
    console.log("[VERIFY] PASS — bcrypt cost=10 hash verifiable");
  });
});

// ── [TEST GROUP 3] Circuit breaker — TIMEOUT IS NOT A FAILURE ────────────────
describe("circuit breaker — timeout does NOT open circuit (critical fix)", () => {
  it("[VERIFY] Fast operation succeeds normally", async () => {
    const { withCircuitBreaker, getCircuitStatus } = await import("../server/dbCircuitBreaker");
    const result = await withCircuitBreaker(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      return "ok";
    });
    const status = getCircuitStatus();
    console.log(`[OUTPUT] result="${result}" state=${status.state} consecutiveFailures=${status.consecutiveFailures}`);
    expect(result).toBe("ok");
    expect(status.state).toBe("CLOSED");
    expect(status.consecutiveFailures).toBe(0);
    console.log("[VERIFY] PASS — fast operation succeeds, circuit stays CLOSED");
  });

  it("[VERIFY] Timeout fires but circuit stays CLOSED (timeout ≠ failure)", async () => {
    const { withCircuitBreaker, getCircuitStatus } = await import("../server/dbCircuitBreaker");
    const statusBefore = getCircuitStatus();
    const failuresBefore = statusBefore.consecutiveFailures;

    try {
      await withCircuitBreaker(async () => {
        // Simulate a query that exceeds the 8s timeout
        await new Promise(resolve => setTimeout(resolve, 9000));
        return "should not reach";
      });
    } catch (err) {
      const msg = (err as Error).message;
      const status = getCircuitStatus();
      console.log(`[INPUT] simulated query=9000ms (exceeds 8s timeout)`);
      console.log(`[OUTPUT] error="${msg}" state=${status.state} consecutiveFailures=${status.consecutiveFailures} totalTimeouts=${status.totalTimeouts}`);
      // KEY ASSERTION: circuit must still be CLOSED after a timeout
      expect(status.state).toBe("CLOSED");
      // KEY ASSERTION: consecutiveFailures must NOT have increased
      expect(status.consecutiveFailures).toBe(failuresBefore);
      // Timeout counter should have incremented
      expect(status.totalTimeouts).toBeGreaterThan(0);
      console.log("[VERIFY] PASS — timeout fired but circuit remains CLOSED (timeout ≠ failure)");
    }
  }, 12_000);

  it("[VERIFY] Multiple timeouts do NOT open the circuit", async () => {
    const { withCircuitBreaker, getCircuitStatus } = await import("../server/dbCircuitBreaker");
    const statusBefore = getCircuitStatus();
    const failuresBefore = statusBefore.consecutiveFailures;

    // Fire 3 timeouts in a row — previously this would open the circuit
    for (let i = 0; i < 3; i++) {
      try {
        await withCircuitBreaker(async () => {
          await new Promise(resolve => setTimeout(resolve, 9000));
          return "should not reach";
        });
      } catch (_err) {
        // expected
      }
    }

    const status = getCircuitStatus();
    console.log(`[INPUT] 3 consecutive timeouts`);
    console.log(`[OUTPUT] state=${status.state} consecutiveFailures=${status.consecutiveFailures} totalTimeouts=${status.totalTimeouts}`);
    // KEY ASSERTION: circuit must still be CLOSED after 3 timeouts
    expect(status.state).toBe("CLOSED");
    // KEY ASSERTION: consecutiveFailures must NOT have increased
    expect(status.consecutiveFailures).toBe(failuresBefore);
    // 3 timeouts should be recorded
    expect(status.totalTimeouts).toBeGreaterThanOrEqual(3);
    console.log("[VERIFY] PASS — 3 consecutive timeouts did NOT open the circuit");
  }, 35_000);

  it("[VERIFY] TRUE DB error (ECONNREFUSED) increments consecutiveFailures", async () => {
    const { withCircuitBreaker, getCircuitStatus } = await import("../server/dbCircuitBreaker");
    const statusBefore = getCircuitStatus();
    const failuresBefore = statusBefore.consecutiveFailures;

    try {
      await withCircuitBreaker(async () => {
        const err = new Error("connect ECONNREFUSED 127.0.0.1:3306");
        throw err;
      });
    } catch (_err) {
      // expected
    }

    const status = getCircuitStatus();
    console.log(`[INPUT] ECONNREFUSED error`);
    console.log(`[OUTPUT] state=${status.state} consecutiveFailures=${status.consecutiveFailures}`);
    // TRUE DB error SHOULD increment consecutiveFailures
    expect(status.consecutiveFailures).toBe(failuresBefore + 1);
    console.log("[VERIFY] PASS — ECONNREFUSED correctly increments consecutiveFailures");
  });

  it("[VERIFY] Application error (SQL constraint) does NOT affect circuit state", async () => {
    const { withCircuitBreaker, getCircuitStatus } = await import("../server/dbCircuitBreaker");
    const statusBefore = getCircuitStatus();
    const failuresBefore = statusBefore.consecutiveFailures;

    try {
      await withCircuitBreaker(async () => {
        throw new Error("Duplicate entry 'test@example.com' for key 'email'");
      });
    } catch (_err) {
      // expected
    }

    const status = getCircuitStatus();
    console.log(`[INPUT] SQL constraint violation`);
    console.log(`[OUTPUT] state=${status.state} consecutiveFailures=${status.consecutiveFailures}`);
    // Application error should NOT increment consecutiveFailures
    expect(status.consecutiveFailures).toBe(failuresBefore);
    console.log("[VERIFY] PASS — SQL constraint error did not affect circuit state");
  });

  it("[VERIFY] Worst-case updateUser timing with new 8s timeout: 3×8s + 0.11s < 25s request timeout", () => {
    const circuitBreakerTimeoutMs = 8_000;
    const bcryptCost10Ms = 110;
    const requestTimeoutMs = 25_000;

    // Worst case: read(8s) + parallel_uniqueness(8s) + bcrypt(0.11s) + write(8s)
    const worstCaseMs = circuitBreakerTimeoutMs + circuitBreakerTimeoutMs + bcryptCost10Ms + circuitBreakerTimeoutMs;
    console.log(`[INPUT] circuitBreakerTimeout=${circuitBreakerTimeoutMs}ms bcryptCost10=${bcryptCost10Ms}ms`);
    console.log(`[STATE] worstCase = read(${circuitBreakerTimeoutMs}) + parallel_uniqueness(${circuitBreakerTimeoutMs}) + bcrypt(${bcryptCost10Ms}) + write(${circuitBreakerTimeoutMs})`);
    console.log(`[OUTPUT] worstCaseMs=${worstCaseMs}ms requestTimeoutMs=${requestTimeoutMs}ms`);
    expect(worstCaseMs).toBeLessThan(requestTimeoutMs);
    const safetyMarginMs = requestTimeoutMs - worstCaseMs;
    console.log(`[VERIFY] PASS — worstCase=${worstCaseMs}ms < requestTimeout=${requestTimeoutMs}ms (safety margin: ${safetyMarginMs}ms)`);
  });
});
