/**
 * Per-ACCOUNT login lockout — DB-backed, keyed by the account, not the IP.
 *
 * The existing login limiter (loginRateMap in routers/appUsers.ts) is in-process
 * and per-IP: 10 failures / 15min from one IP. That stops a lone attacker but is
 * defeated by a botnet spreading guesses for one account across thousands of IPs
 * (credential stuffing). This module counts failures against the ACCOUNT itself,
 * persisted on `app_users`, so a distributed campaign against one login is capped
 * no matter how many source IPs it uses.
 *
 * This file is PURE (no DB, no env side effects beyond an injectable config) so
 * the decision logic is fully unit-testable. The login mutation wires it to the
 * row's persisted counters and to updateAccountLockoutState().
 *
 * Deliberate trade-off (documented): a time-boxed account lockout is a mild DoS
 * lever — an attacker who knows a username can lock that user out for the
 * cooldown by failing on purpose. Mitigations: the lock AUTO-EXPIRES (never
 * permanent), a password reset clears it, and every lock fires a security alert
 * so targeted lockout campaigns are visible. This is the standard, accepted
 * shape; the alternative (no account lockout) leaves credential stuffing wide
 * open, which is worse.
 */

export interface AccountLockoutConfig {
  /** Failed attempts within the window before the account locks. */
  threshold: number;
  /** Rolling window (ms) over which failures accumulate. */
  windowMs: number;
  /** How long (ms) a locked account stays locked. */
  cooldownMs: number;
  /** Kill-switch: when true, isLockedOut is always false and recordFailure is a no-op. */
  disabled: boolean;
}

export interface AccountLockoutState {
  failedLoginCount: number;
  /** Window anchor: ms timestamp of the first failure in the current window. */
  firstFailedLoginAt: number | null;
  /** Cooldown expiry: ms timestamp until which the account is locked. */
  lockedUntil: number | null;
}

const DEFAULTS: AccountLockoutConfig = {
  threshold: 10,
  windowMs: 15 * 60_000,
  cooldownMs: 15 * 60_000,
  disabled: false,
};

/** Positive-integer env parse; falls back to `dflt` on missing/invalid/zero. */
function posInt(raw: string | undefined, dflt: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : dflt;
}

export function accountLockoutConfig(
  env: Record<string, string | undefined> = process.env
): AccountLockoutConfig {
  return {
    threshold: posInt(env.ACCOUNT_LOCKOUT_THRESHOLD, DEFAULTS.threshold),
    windowMs: posInt(env.ACCOUNT_LOCKOUT_WINDOW_MS, DEFAULTS.windowMs),
    cooldownMs: posInt(env.ACCOUNT_LOCKOUT_COOLDOWN_MS, DEFAULTS.cooldownMs),
    disabled: (env.ACCOUNT_LOCKOUT_DISABLED ?? "").trim() === "1",
  };
}

/** True when the account is currently in its cooldown (blocks ALL attempts). */
export function isLockedOut(
  state: AccountLockoutState,
  now: number,
  config: AccountLockoutConfig
): boolean {
  if (config.disabled) return false;
  return state.lockedUntil != null && state.lockedUntil > now;
}

/**
 * Apply one failed attempt. Returns the new persisted state and whether this
 * failure is the one that crossed the threshold (so the caller alerts exactly
 * once per lock, not on every subsequent failure).
 */
export function recordFailure(
  state: AccountLockoutState,
  now: number,
  config: AccountLockoutConfig
): { next: AccountLockoutState; justLocked: boolean } {
  if (config.disabled) return { next: state, justLocked: false };

  // If a prior lock has already EXPIRED, the first post-cooldown failure starts
  // a fresh window — otherwise a config with windowMs > cooldownMs would leave
  // failedLoginCount ≥ threshold at unlock and re-lock on a single next failure,
  // giving a recovered user no grace and amplifying the DoS lever.
  const lockExpired = state.lockedUntil != null && state.lockedUntil <= now;
  const effective: AccountLockoutState = lockExpired
    ? { failedLoginCount: 0, firstFailedLoginAt: null, lockedUntil: null }
    : state;

  const windowActive =
    effective.firstFailedLoginAt != null &&
    now - effective.firstFailedLoginAt < config.windowMs;

  const failedLoginCount = windowActive ? effective.failedLoginCount + 1 : 1;
  const firstFailedLoginAt = windowActive ? effective.firstFailedLoginAt : now;

  const wasLocked =
    effective.lockedUntil != null && effective.lockedUntil > now;
  const crosses = failedLoginCount >= config.threshold;
  const lockedUntil = crosses
    ? now + config.cooldownMs
    : wasLocked
      ? effective.lockedUntil
      : null;

  return {
    next: { failedLoginCount, firstFailedLoginAt, lockedUntil },
    justLocked: crosses && !wasLocked,
  };
}

/** The zeroed state — set on successful login and on password reset. */
export function clearedLockout(): AccountLockoutState {
  return { failedLoginCount: 0, firstFailedLoginAt: null, lockedUntil: null };
}
