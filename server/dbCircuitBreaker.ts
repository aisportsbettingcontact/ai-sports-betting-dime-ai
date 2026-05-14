/**
 * dbCircuitBreaker.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * DB Circuit Breaker + In-Memory User Cache
 *
 * CRITICAL DESIGN PRINCIPLE — TIMEOUT ≠ FAILURE:
 * ────────────────────────────────────────────────
 * A slow DB query that eventually completes is NOT a DB failure.
 * The previous implementation called onFailure() on EVERY error including
 * timeouts. This caused the circuit to open after a few slow-but-successful
 * writes (e.g. password updates), blocking all subsequent requests even
 * though the DB was healthy.
 *
 * FIX: The circuit ONLY opens on TRUE DB connection errors:
 *   ECONNREFUSED, ETIMEDOUT (TCP level), ER_CON_COUNT_ERROR, etc.
 * Timeouts are logged as LATENCY WARNINGS but do NOT increment
 * consecutiveFailures and do NOT open the circuit.
 *
 * STATE MACHINE:
 * ──────────────
 *   CLOSED → OPEN      : after FAILURE_THRESHOLD consecutive TRUE DB errors
 *   OPEN   → HALF_OPEN : after OPEN_DURATION_MS
 *   HALF_OPEN → CLOSED : on first successful probe
 *   HALF_OPEN → OPEN   : on probe failure OR probe timeout
 *
 * TIMEOUT BEHAVIOR:
 * ─────────────────
 *   CLOSED state:    timeout = latency warning only, circuit stays CLOSED
 *   HALF_OPEN state: timeout = probe failure, circuit → OPEN
 *   (In HALF_OPEN we need a clean success to confirm recovery)
 *
 * Usage:
 *   import { withCircuitBreaker, getCachedAppUser, setCachedAppUser } from './dbCircuitBreaker';
 *   const result = await withCircuitBreaker(() => db.select()...);
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { AppUser } from "../drizzle/schema";

const TAG = "[CircuitBreaker]";

// ── Circuit Breaker Config ────────────────────────────────────────────────────
const FAILURE_THRESHOLD  = 5;         // consecutive TRUE DB errors before opening
const OPEN_DURATION_MS   = 60_000;    // 60 seconds in open state before retrying
const HALF_OPEN_TIMEOUT  = 10_000;    // probe timeout when in half-open state
const CLOSED_TIMEOUT_MS  = 8_000;     // per-query latency guard in CLOSED state

// ── User Cache Config ─────────────────────────────────────────────────────────
const USER_CACHE_TTL_MS  = 5 * 60 * 1000;  // 5 minutes

// ── Circuit Breaker State ─────────────────────────────────────────────────────
type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

let circuitState: CircuitState = "CLOSED";
let consecutiveFailures = 0;   // TRUE DB errors only — timeouts excluded
let consecutiveTimeouts = 0;   // latency events — does NOT open circuit
let openedAt: number | null = null;
let totalFailures = 0;
let totalSuccesses = 0;
let totalTimeouts = 0;

function getCircuitState(): CircuitState {
  if (circuitState === "OPEN" && openedAt !== null) {
    const elapsed = Date.now() - openedAt;
    if (elapsed >= OPEN_DURATION_MS) {
      circuitState = "HALF_OPEN";
      console.log(`${TAG} Circuit → HALF_OPEN (probe after ${Math.round(elapsed / 1000)}s)`);
    }
  }
  return circuitState;
}

function onSuccess(): void {
  totalSuccesses++;
  if (circuitState !== "CLOSED") {
    console.log(`${TAG} Circuit → CLOSED (DB recovered after ${totalFailures} total failures)`);
  }
  circuitState = "CLOSED";
  consecutiveFailures = 0;
  consecutiveTimeouts = 0;
  openedAt = null;
}

/**
 * Called ONLY on TRUE DB connection/protocol errors.
 * Timeouts are NOT passed here — they go to onTimeout() instead.
 */
function onTrueFailure(err: unknown): void {
  totalFailures++;
  consecutiveFailures++;
  consecutiveTimeouts = 0;
  if (consecutiveFailures >= FAILURE_THRESHOLD && circuitState === "CLOSED") {
    circuitState = "OPEN";
    openedAt = Date.now();
    console.error(
      `${TAG} Circuit → OPEN after ${consecutiveFailures} consecutive TRUE DB errors. ` +
      `Will retry in ${OPEN_DURATION_MS / 1000}s. Error: ${(err as Error)?.message ?? String(err)}`
    );
  } else {
    console.warn(
      `${TAG} TRUE DB error (${consecutiveFailures}/${FAILURE_THRESHOLD}): ` +
      `${(err as Error)?.message ?? String(err)}`
    );
  }
}

/**
 * Called when a query exceeds the timeout threshold.
 * This is a LATENCY WARNING only — does NOT increment consecutiveFailures.
 * The underlying DB operation may still complete successfully.
 */
function onTimeout(timeoutMs: number): void {
  totalTimeouts++;
  consecutiveTimeouts++;
  console.warn(
    `${TAG} LATENCY WARNING: query exceeded ${timeoutMs}ms ` +
    `(timeout #${consecutiveTimeouts} in a row, total=${totalTimeouts}). ` +
    `Circuit remains ${circuitState}. ` +
    `Timeout ≠ failure — DB may still be healthy.`
  );
}

/**
 * Returns true if the error is a TRUE DB connection/protocol error
 * that indicates the DB is genuinely unavailable.
 * Returns false for our own timeout sentinel and application-level errors.
 */
function isTrueDbError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? String(err);
  // Our own timeout sentinel — NOT a true DB error
  if (msg.includes(`${TAG} DB query timed out`)) return false;
  // True DB / network errors indicating DB unavailability
  return (
    msg.includes("ECONNREFUSED") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("ENOTFOUND") ||
    msg.includes("ECONNRESET") ||
    msg.includes("ER_CON_COUNT_ERROR") ||
    msg.includes("ER_ACCESS_DENIED") ||
    msg.includes("Access denied for user") ||
    msg.includes("connect ETIMEDOUT") ||
    msg.includes("Connection lost") ||
    msg.includes("Cannot enqueue") ||
    msg.includes("Pool is closed") ||
    msg.includes("getConnection") ||
    msg.includes("ER_TOO_MANY_CONNECTIONS") ||
    msg.includes("PROTOCOL_CONNECTION_LOST") ||
    msg.includes("PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR")
  );
}

/**
 * Wraps a DB call with circuit breaker protection.
 *
 * CLOSED:    Execute normally with 8s latency guard.
 *            Timeout → latency warning only (no failure count, circuit stays CLOSED).
 *            True DB error → increment consecutiveFailures (may open circuit).
 *            Application error (SQL syntax, constraint) → not a DB failure, ignored.
 *
 * OPEN:      Fast-fail immediately without executing.
 *
 * HALF_OPEN: Execute with 10s probe timeout.
 *            Success → CLOSED.
 *            Timeout or error → OPEN.
 *
 * KEY INVARIANT: A slow-but-successful DB operation NEVER opens the circuit.
 */
export async function withCircuitBreaker<T>(fn: () => Promise<T>): Promise<T> {
  const state = getCircuitState();

  if (state === "OPEN") {
    throw new Error(`${TAG} Circuit is OPEN — DB unavailable. Fast-failing to prevent hang.`);
  }

  const timeoutMs = state === "HALF_OPEN" ? HALF_OPEN_TIMEOUT : CLOSED_TIMEOUT_MS;
  let timeoutFired = false;

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => {
      timeoutFired = true;
      reject(new Error(`${TAG} DB query timed out after ${timeoutMs}ms`));
    }, timeoutMs)
  );

  try {
    const result = await Promise.race([fn(), timeoutPromise]);
    onSuccess();
    return result;
  } catch (err) {
    if (timeoutFired) {
      // LATENCY WARNING — do NOT count as a circuit-breaker failure in CLOSED state
      onTimeout(timeoutMs);
      // In HALF_OPEN state, a timeout means the probe failed → back to OPEN
      if (state === "HALF_OPEN") {
        console.error(`${TAG} HALF_OPEN probe timed out → Circuit → OPEN`);
        circuitState = "OPEN";
        openedAt = Date.now();
        consecutiveFailures++;
        totalFailures++;
      }
    } else if (isTrueDbError(err)) {
      // TRUE DB CONNECTION ERROR — may open circuit
      onTrueFailure(err);
    } else {
      // Application-level error (SQL constraint, NOT_FOUND, etc.)
      // These are NOT DB availability issues — do not affect circuit state
      console.log(
        `${TAG} Application-level error (circuit unchanged): ` +
        `${(err as Error)?.message ?? String(err)}`
      );
    }
    throw err;
  }
}

/** Returns current circuit breaker status for health endpoint */
export function getCircuitStatus(): {
  state: CircuitState;
  consecutiveFailures: number;
  consecutiveTimeouts: number;
  totalFailures: number;
  totalSuccesses: number;
  totalTimeouts: number;
  openedAt: number | null;
  openedSecondsAgo: number | null;
} {
  return {
    state: getCircuitState(),
    consecutiveFailures,
    consecutiveTimeouts,
    totalFailures,
    totalSuccesses,
    totalTimeouts,
    openedAt,
    openedSecondsAgo: openedAt ? Math.round((Date.now() - openedAt) / 1000) : null,
  };
}

// ── In-Memory User Cache ──────────────────────────────────────────────────────

interface CachedUser {
  user: AppUser;
  cachedAt: number;
}

const userCache = new Map<number, CachedUser>();

/** Cache an app user record (called after successful DB read) */
export function setCachedAppUser(user: AppUser): void {
  userCache.set(user.id, { user, cachedAt: Date.now() });
}

/** Get a cached app user by ID. Returns null if not found or expired. */
export function getCachedAppUser(userId: number): AppUser | null {
  const entry = userCache.get(userId);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > USER_CACHE_TTL_MS) {
    userCache.delete(userId);
    return null;
  }
  return entry.user;
}

/** Invalidate a specific user from cache (call on logout or role change) */
export function invalidateCachedAppUser(userId: number): void {
  userCache.delete(userId);
}

/** Clear the entire user cache */
export function clearUserCache(): void {
  userCache.clear();
}

/** Get cache stats for health endpoint */
export function getCacheStats(): { size: number; ttlMs: number } {
  return { size: userCache.size, ttlMs: USER_CACHE_TTL_MS };
}
