import { describe, it, expect, vi } from "vitest";

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
    const { __setMlbCycleWorkForTest, runMlbCycleOnce } = await import(
      "./vsinAutoRefresh"
    );
    let running = 0;
    let maxConcurrent = 0;
    __setMlbCycleWorkForTest(async () => {
      running += 1;
      maxConcurrent = Math.max(maxConcurrent, running);
      await new Promise(r => setTimeout(r, 50));
      running -= 1;
    });

    await Promise.all([runMlbCycleOnce(), runMlbCycleOnce(), runMlbCycleOnce()]);

    expect(maxConcurrent).toBe(1);
  });

  it("a later call runs normally once the prior one settles", async () => {
    const { __setMlbCycleWorkForTest, runMlbCycleOnce } = await import(
      "./vsinAutoRefresh"
    );
    let calls = 0;
    __setMlbCycleWorkForTest(async () => {
      calls += 1;
    });
    await runMlbCycleOnce();
    await runMlbCycleOnce();
    expect(calls).toBe(2);
  });

  it("the guard releases even when the work throws", async () => {
    const { __setMlbCycleWorkForTest, runMlbCycleOnce } = await import(
      "./vsinAutoRefresh"
    );
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
