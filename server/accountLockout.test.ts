import { describe, expect, it } from "vitest";
import {
  accountLockoutConfig,
  clearedLockout,
  isLockedOut,
  recordFailure,
  type AccountLockoutConfig,
  type AccountLockoutState,
} from "./accountLockout";

const CFG: AccountLockoutConfig = {
  threshold: 10,
  windowMs: 15 * 60_000,
  cooldownMs: 15 * 60_000,
  disabled: false,
};
const fresh: AccountLockoutState = {
  failedLoginCount: 0,
  firstFailedLoginAt: null,
  lockedUntil: null,
};
const T0 = 1_000_000_000_000;

describe("isLockedOut", () => {
  it("is locked while lockedUntil is in the future", () => {
    expect(isLockedOut({ ...fresh, lockedUntil: T0 + 60_000 }, T0, CFG)).toBe(true);
  });
  it("is NOT locked once the cooldown has expired (auto-recovery)", () => {
    expect(isLockedOut({ ...fresh, lockedUntil: T0 - 1 }, T0, CFG)).toBe(false);
  });
  it("is never locked with no lockedUntil", () => {
    expect(isLockedOut(fresh, T0, CFG)).toBe(false);
  });
  it("is never locked when the kill-switch is on", () => {
    expect(
      isLockedOut({ ...fresh, lockedUntil: T0 + 60_000 }, T0, { ...CFG, disabled: true })
    ).toBe(false);
  });
});

describe("recordFailure", () => {
  it("starts a fresh window on the first failure", () => {
    const { next, justLocked } = recordFailure(fresh, T0, CFG);
    expect(next).toEqual({ failedLoginCount: 1, firstFailedLoginAt: T0, lockedUntil: null });
    expect(justLocked).toBe(false);
  });

  it("increments within the rolling window", () => {
    let s = fresh;
    let t = T0;
    for (let i = 1; i <= 5; i++) {
      ({ next: s } = recordFailure(s, t, CFG));
      t += 30_000; // 30s apart, all within the 15min window
    }
    expect(s.failedLoginCount).toBe(5);
    expect(s.firstFailedLoginAt).toBe(T0);
    expect(s.lockedUntil).toBeNull();
  });

  it("locks the account exactly at the threshold and flags justLocked once", () => {
    let s = fresh;
    let t = T0;
    let lockedFlags = 0;
    for (let i = 1; i <= 10; i++) {
      const r = recordFailure(s, t, CFG);
      s = r.next;
      if (r.justLocked) lockedFlags++;
      t += 10_000;
    }
    expect(s.failedLoginCount).toBe(10);
    expect(s.lockedUntil).toBe(t - 10_000 + CFG.cooldownMs); // locked at the 10th failure's time
    expect(lockedFlags).toBe(1); // fired exactly once, on crossing
  });

  it("resets the counter when the window has elapsed since the first failure", () => {
    const stale: AccountLockoutState = {
      failedLoginCount: 9,
      firstFailedLoginAt: T0,
      lockedUntil: null,
    };
    // A failure 16 minutes after the first — window expired → counter restarts at 1
    const { next, justLocked } = recordFailure(stale, T0 + 16 * 60_000, CFG);
    expect(next.failedLoginCount).toBe(1);
    expect(next.firstFailedLoginAt).toBe(T0 + 16 * 60_000);
    expect(justLocked).toBe(false);
  });

  it("is a no-op when the kill-switch is on", () => {
    const { next, justLocked } = recordFailure(fresh, T0, { ...CFG, disabled: true });
    expect(next).toEqual(fresh);
    expect(justLocked).toBe(false);
  });

  it("starts a fresh window after a prior lock has expired (no instant re-lock)", () => {
    // windowMs (60min) > cooldownMs (15min): at unlock the count is still ≥
    // threshold and the window still 'active'. The first post-cooldown failure
    // must reset to count=1, NOT re-cross the threshold and re-lock.
    const cfg: AccountLockoutConfig = { ...CFG, windowMs: 60 * 60_000, cooldownMs: 15 * 60_000 };
    const expiredLock: AccountLockoutState = {
      failedLoginCount: 10,
      firstFailedLoginAt: T0,
      lockedUntil: T0 + 15 * 60_000, // expired by the time below
    };
    const afterCooldown = T0 + 16 * 60_000; // 1 min after the lock lifted
    const { next, justLocked } = recordFailure(expiredLock, afterCooldown, cfg);
    expect(next.failedLoginCount).toBe(1);
    expect(next.firstFailedLoginAt).toBe(afterCooldown);
    expect(next.lockedUntil).toBeNull();
    expect(justLocked).toBe(false);
  });
});

describe("clearedLockout", () => {
  it("zeros all lockout state (used on successful login + password reset)", () => {
    expect(clearedLockout()).toEqual({
      failedLoginCount: 0,
      firstFailedLoginAt: null,
      lockedUntil: null,
    });
  });
});

describe("accountLockoutConfig", () => {
  it("uses safe production defaults when env is unset", () => {
    const c = accountLockoutConfig({});
    expect(c.threshold).toBe(10);
    expect(c.windowMs).toBe(15 * 60_000);
    expect(c.cooldownMs).toBe(15 * 60_000);
    expect(c.disabled).toBe(false);
  });
  it("honors env overrides and the kill-switch", () => {
    const c = accountLockoutConfig({
      ACCOUNT_LOCKOUT_THRESHOLD: "5",
      ACCOUNT_LOCKOUT_WINDOW_MS: "600000",
      ACCOUNT_LOCKOUT_COOLDOWN_MS: "1800000",
      ACCOUNT_LOCKOUT_DISABLED: "1",
    });
    expect(c).toEqual({ threshold: 5, windowMs: 600000, cooldownMs: 1800000, disabled: true });
  });
  it("ignores non-numeric / zero overrides and keeps the safe default", () => {
    const c = accountLockoutConfig({ ACCOUNT_LOCKOUT_THRESHOLD: "abc" });
    expect(c.threshold).toBe(10);
  });
});
