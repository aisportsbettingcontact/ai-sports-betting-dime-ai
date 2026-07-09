/**
 * cronRunner.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * TDD spec for CronJobRunner — the run-lock / idempotency state machine that
 * every cron endpoint shares.
 *
 * CONTRACT:
 *   - First trigger() → started:true, marks the job running, kicks off work().
 *   - Concurrent trigger() while running → started:false, skipped:true (no second
 *     invocation of work()). This is the idempotency guarantee: GitHub Actions can
 *     fire again before a slow job finishes and we must NOT overlap.
 *   - When work() settles (resolve OR reject) the lock releases and lastResult is
 *     recorded; a subsequent trigger() runs work() again.
 *   - A throwing work() is captured as lastResult.ok=false and never escapes as an
 *     unhandled rejection.
 *
 * The runner takes an injectable clock so timestamps are deterministic in tests.
 */

import { describe, expect, it, vi } from "vitest";
import { CronJobRunner } from "./cronRunner";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const clock = (iso: string) => () => iso;

describe("CronJobRunner", () => {
  it("starts the job on first trigger and reports running state", () => {
    const d = deferred<void>();
    const work = vi.fn(() => d.promise);
    const runner = new CronJobRunner("test-job", work, { now: clock("2026-07-09T00:00:00.000Z") });

    const r = runner.trigger();
    expect(r.started).toBe(true);
    expect(r.skipped).toBe(false);
    expect(work).toHaveBeenCalledTimes(1);
    expect(runner.state.isRunning).toBe(true);
    expect(runner.state.lastRunAt).toBe("2026-07-09T00:00:00.000Z");

    d.resolve();
  });

  it("skips a concurrent trigger without invoking work a second time", () => {
    const d = deferred<void>();
    const work = vi.fn(() => d.promise);
    const runner = new CronJobRunner("test-job", work, { now: clock("2026-07-09T00:00:00.000Z") });

    runner.trigger();
    const second = runner.trigger();

    expect(second.started).toBe(false);
    expect(second.skipped).toBe(true);
    expect(work).toHaveBeenCalledTimes(1);

    d.resolve();
  });

  it("releases the lock and records success when work resolves", async () => {
    const d = deferred<void>();
    const work = vi.fn(() => d.promise);
    const runner = new CronJobRunner("test-job", work, { now: clock("2026-07-09T00:00:00.000Z") });

    runner.trigger();
    d.resolve();
    await runner.lastRun();

    expect(runner.state.isRunning).toBe(false);
    expect(runner.state.lastResult?.ok).toBe(true);

    // A fresh trigger runs work again now that the lock is free.
    const third = runner.trigger();
    expect(third.started).toBe(true);
    expect(work).toHaveBeenCalledTimes(2);
  });

  it("captures a rejected work() as a failed result and releases the lock", async () => {
    const d = deferred<void>();
    const work = vi.fn(() => d.promise);
    const runner = new CronJobRunner("test-job", work, { now: clock("2026-07-09T00:00:00.000Z") });

    runner.trigger();
    d.reject(new Error("boom"));
    await runner.lastRun();

    expect(runner.state.isRunning).toBe(false);
    expect(runner.state.lastResult?.ok).toBe(false);
    expect(runner.state.lastResult?.error).toContain("boom");
  });
});
