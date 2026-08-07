import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * runMlbCycleOnce had NO re-entrancy guard. The in-process setInterval fires
 * every 300s regardless of whether the prior invocation finished, and cycle
 * duration drifted to 4-9 minutes — so three cycles ran concurrently in
 * production on 2026-08-06 (12 STARTs vs 10 DONEs in 56 minutes).
 *
 * The guard must live in the FUNCTION, not at one call site: CronJobRunner's
 * lock is a per-instance field and only covers calls through .trigger().
 */
describe("runMlbCycleOnce re-entrancy guard", () => {
  it("a second concurrent call is skipped, not run", async () => {
    const { __setMlbCycleWorkForTest, runMlbCycleOnce } =
      await import("./vsinAutoRefresh");
    let running = 0;
    let maxConcurrent = 0;
    __setMlbCycleWorkForTest(async () => {
      running += 1;
      maxConcurrent = Math.max(maxConcurrent, running);
      await new Promise(r => setTimeout(r, 50));
      running -= 1;
    });

    await Promise.all([
      runMlbCycleOnce(),
      runMlbCycleOnce(),
      runMlbCycleOnce(),
    ]);

    expect(maxConcurrent).toBe(1);
  });

  it("a later call runs normally once the prior one settles", async () => {
    const { __setMlbCycleWorkForTest, runMlbCycleOnce } =
      await import("./vsinAutoRefresh");
    let calls = 0;
    __setMlbCycleWorkForTest(async () => {
      calls += 1;
    });
    await runMlbCycleOnce();
    await runMlbCycleOnce();
    expect(calls).toBe(2);
  });

  it("the guard releases even when the work throws", async () => {
    const { __setMlbCycleWorkForTest, runMlbCycleOnce } =
      await import("./vsinAutoRefresh");
    let calls = 0;
    __setMlbCycleWorkForTest(async () => {
      calls += 1;
      throw new Error("upstream feed down");
    });
    // runMlbCycleOnce does not swallow the work's error — only the finally
    // resets the in-flight guard — so each call is expected to reject. What
    // this test proves is that the SECOND call still reaches the work (and
    // therefore still rejects) instead of being silently [SKIP]-short-
    // circuited by a guard left wedged shut from the first call's throw.
    await expect(runMlbCycleOnce()).rejects.toThrow("upstream feed down");
    await expect(runMlbCycleOnce()).rejects.toThrow("upstream feed down");
    expect(calls).toBe(2);
  });
});

/**
 * 2026-08-06 CRITICAL remediation: the `finally` above only runs once
 * mlbCycleWork() SETTLES. Six fetch() calls in the unconditional every-cycle
 * path (mlbScoreRefresh, vsinBettingSplitsScraper, actionNetworkScraper,
 * anKPropsService, kPropsBacktestService x2) carried no AbortSignal — a hang
 * at the TCP/HTTP layer meant the promise never settled, `finally` never ran,
 * and mlbCycleInFlight stayed true for the process lifetime: every later
 * call (the 300s setInterval AND the HTTP /api/cron/mlb-cycle route) hit
 * [SKIP] forever. That is strictly worse than the duplicate-work bug the
 * re-entrancy guard above was written to fix — a silent, permanent MLB
 * ingestion outage.
 *
 * The watchdog is the load-bearing fix: it releases the guard on a deadline
 * regardless of what the work does, including any future unbounded fetch
 * nobody has audited yet (the six sites above are additionally bounded with
 * AbortSignal.timeout as defense in depth, but that is hygiene, not the
 * guarantee).
 */
describe("runMlbCycleOnce watchdog", () => {
  afterEach(() => {
    // Reset the test-only override back to the production default (20 min)
    // so later tests in this file are unaffected.
    vi.restoreAllMocks();
  });

  it("releases the guard after the deadline when work never settles (the wedge case), and a subsequent call runs", async () => {
    const {
      __setMlbCycleWorkForTest,
      __setMlbCycleWatchdogMsForTest,
      runMlbCycleOnce,
    } = await import("./vsinAutoRefresh");

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      __setMlbCycleWatchdogMsForTest(20); // test-shortened deadline
      // Simulates a fetch() that hangs forever at the TCP/HTTP layer with no
      // AbortSignal — the promise this returns NEVER settles.
      __setMlbCycleWorkForTest(() => new Promise<void>(() => {}));

      // Must resolve (not hang forever, not reject) once the watchdog fires.
      await runMlbCycleOnce();

      // Deadline firing is operationally significant — must log at error severity.
      expect(
        errorSpy.mock.calls.some(call =>
          String(call[0]).includes("[MLBCycle] [WATCHDOG]")
        )
      ).toBe(true);

      // This is the actual regression assertion: the guard must be released,
      // not wedged shut — a subsequent call must reach the work, not [SKIP].
      let secondCallRan = false;
      __setMlbCycleWorkForTest(async () => {
        secondCallRan = true;
      });
      await runMlbCycleOnce();
      expect(secondCallRan).toBe(true);
    } finally {
      __setMlbCycleWatchdogMsForTest(null);
    }
  });

  it("does not fire the watchdog (no false positive) when a normal cycle completes well within the deadline", async () => {
    const {
      __setMlbCycleWorkForTest,
      __setMlbCycleWatchdogMsForTest,
      runMlbCycleOnce,
    } = await import("./vsinAutoRefresh");

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      __setMlbCycleWatchdogMsForTest(5_000); // generous relative to the work below
      __setMlbCycleWorkForTest(async () => {
        await new Promise(r => setTimeout(r, 5));
      });

      await runMlbCycleOnce();

      expect(
        errorSpy.mock.calls.some(call =>
          String(call[0]).includes("[MLBCycle] [WATCHDOG]")
        )
      ).toBe(false);
    } finally {
      __setMlbCycleWatchdogMsForTest(null);
    }
  });
});
