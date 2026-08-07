/**
 * mlbLoopJobs.test.ts — BEHAVIORAL tests for the MLB learning-loop jobs (M-208).
 *
 * These execute the code rather than asserting on its source text. The first
 * version of this suite read cronRoutes.ts as a string and matched substrings;
 * the patch-coverage gate correctly rejected that, because text matching proves
 * what the code SAYS and never what it DOES. The logic moved into an injectable
 * module so the windowing, aggregation and fail-loud rules could be run.
 */
import { describe, expect, it, vi } from "vitest";
import {
  lastNDates,
  parseCronDateParam,
  runBacktestJob,
  runOutcomesJob,
  makeOutcomesWork,
  makeBacktestWork,
  resolveDateJobRequest,
  type OutcomeSummaryLike,
} from "./mlbLoopJobs";

const summary = (
  over: Partial<OutcomeSummaryLike> = {}
): OutcomeSummaryLike => ({
  written: 0,
  skippedAlreadyIngested: 0,
  skippedNotFinal: 0,
  skippedNoGamePk: 0,
  skippedNoApiMatch: 0,
  errors: 0,
  ...over,
});

describe("lastNDates", () => {
  // 2026-08-07T06:30:00Z is 2026-08-06 23:30 PT but already 2026-08-07 in UTC —
  // the exact window where a late West Coast final would be filed under the
  // wrong day if the zone were ignored.
  const AT = Date.parse("2026-08-07T06:30:00Z");

  it("returns N dates oldest-first", () => {
    expect(lastNDates(3, "America/New_York", AT)).toHaveLength(3);
    const d = lastNDates(3, "America/New_York", AT);
    expect([...d].sort()).toEqual(d);
  });

  it("PT and UTC disagree about the current day at this instant", () => {
    const pt = lastNDates(1, "America/Los_Angeles", AT)[0];
    const utc = lastNDates(1, "UTC", AT)[0];
    expect(pt).toBe("2026-08-06");
    expect(utc).toBe("2026-08-07");
    expect(pt).not.toBe(utc);
  });

  it("gives the 2-date PT window the outcomes job uses", () => {
    expect(lastNDates(2, "America/Los_Angeles", AT)).toEqual([
      "2026-08-05",
      "2026-08-06",
    ]);
  });

  it("gives the 3-date ET window the backtest job uses", () => {
    expect(lastNDates(3, "America/New_York", AT)).toEqual([
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
    ]);
  });

  it("emits no duplicate dates across a DST boundary", () => {
    // 2026-11-01 is the US DST fallback.
    const across = lastNDates(
      4,
      "America/New_York",
      Date.parse("2026-11-02T12:00:00Z")
    );
    expect(new Set(across).size).toBe(4);
  });
});

describe("parseCronDateParam", () => {
  it("absent means default window, not an error", () => {
    expect(parseCronDateParam(undefined)).toEqual({ ok: true, date: null });
    expect(parseCronDateParam(null)).toEqual({ ok: true, date: null });
  });

  it("accepts a well-formed date", () => {
    expect(parseCronDateParam("2026-08-07")).toEqual({
      ok: true,
      date: "2026-08-07",
    });
  });

  it("REJECTS malformed input rather than silently using the default window", () => {
    for (const bad of [
      "08-07-2026",
      "2026-8-7",
      "yesterday",
      "",
      "2026-08-07T00:00:00Z",
    ]) {
      expect(
        parseCronDateParam(bad),
        `should reject ${JSON.stringify(bad)}`
      ).toEqual({
        ok: false,
      });
    }
  });
});

describe("runOutcomesJob", () => {
  it("aggregates written / skipped / rowErrors across the window", async () => {
    const ingest = vi
      .fn()
      .mockResolvedValueOnce(
        summary({ written: 3, skippedNotFinal: 2, errors: 1 })
      )
      .mockResolvedValueOnce(
        summary({ written: 5, skippedAlreadyIngested: 4 })
      );
    const r = await runOutcomesJob(["2026-08-06", "2026-08-07"], ingest);
    expect(r.written).toBe(8);
    expect(r.skipped).toBe(6);
    expect(r.rowErrors).toBe(1);
    expect(r.errors).toEqual([]);
    expect(ingest).toHaveBeenCalledTimes(2);
  });

  it("tolerates ONE bad date — a single upstream blip is not a job failure", async () => {
    const ingest = vi
      .fn()
      .mockRejectedValueOnce(new Error("statsapi 503"))
      .mockResolvedValueOnce(summary({ written: 4 }));
    const r = await runOutcomesJob(["a", "b"], ingest);
    expect(r.written).toBe(4);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain("statsapi 503");
  });

  it("THROWS when every date failed, so the run records ok:false", async () => {
    const ingest = vi.fn().mockRejectedValue(new Error("db down"));
    await expect(runOutcomesJob(["a", "b"], ingest)).rejects.toThrow(
      /all 2 outcome ingests failed/
    );
  });

  it("stringifies a non-Error throw instead of losing it", async () => {
    // A rejected promise carrying a bare string is not hypothetical: mysql2 and
    // some fetch wrappers reject with non-Error values.
    const ingest = vi
      .fn()
      .mockRejectedValueOnce("socket hang up")
      .mockResolvedValueOnce(summary());
    const r = await runOutcomesJob(["a", "b"], ingest);
    expect(r.errors[0]).toContain("socket hang up");
  });

  it("an empty window is not a failure", async () => {
    const r = await runOutcomesJob([], vi.fn());
    expect(r.written).toBe(0);
    expect(r.errors).toEqual([]);
  });
});

describe("runBacktestJob", () => {
  it("sums enrollments across the window", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ processed: 2, errors: 0 })
      .mockResolvedValueOnce({ processed: 1, errors: 0 });
    const r = await runBacktestJob(["a", "b"], run);
    expect(r.processed).toBe(3);
    expect(r.enrollErrors).toBe(0);
  });

  it("ZERO unenrolled games is SUCCESS — the normal steady state of a self-heal", async () => {
    const run = vi.fn().mockResolvedValue({ processed: 0, errors: 0 });
    const r = await runBacktestJob(["a", "b", "c"], run);
    expect(r.processed).toBe(0);
    expect(r.enrollErrors).toBe(0);
    expect(r.errors).toEqual([]);
  });

  it("THROWS when work was attempted and all of it failed", async () => {
    const run = vi.fn().mockResolvedValue({ processed: 0, errors: 4 });
    await expect(runBacktestJob(["a"], run)).rejects.toThrow(
      /all 4 backtest enrollments failed/
    );
  });

  it("does NOT throw when some enrollments succeeded alongside failures", async () => {
    const run = vi.fn().mockResolvedValue({ processed: 3, errors: 2 });
    const r = await runBacktestJob(["a"], run);
    expect(r.processed).toBe(3);
    expect(r.enrollErrors).toBe(2);
  });

  it("stringifies a non-Error throw from a backtest date", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce("deadlock found")
      .mockResolvedValueOnce({ processed: 1, errors: 0 });
    const r = await runBacktestJob(["a", "b"], run);
    expect(r.errors[0]).toContain("deadlock found");
    expect(r.processed).toBe(1);
  });

  it("THROWS when every date threw outright", async () => {
    const run = vi.fn().mockRejectedValue(new Error("pool exhausted"));
    await expect(runBacktestJob(["a", "b"], run)).rejects.toThrow(
      /all 2 backtest dates threw/
    );
  });
});

describe("runner work factories", () => {
  const AT = Date.parse("2026-08-07T06:30:00Z");
  const silent = () => {};

  it("outcomes: uses the 2-date PT window when no ?date= was stashed", async () => {
    const ingest = vi.fn().mockResolvedValue(summary({ written: 1 }));
    const work = makeOutcomesWork(() => null, ingest, silent, () => AT);
    const r = await work();
    expect(r.dates).toEqual(["2026-08-05", "2026-08-06"]);
    expect(ingest).toHaveBeenCalledTimes(2);
    expect(r.written).toBe(2);
  });

  it("outcomes: a stashed ?date= REPLACES the window, it does not extend it", async () => {
    const ingest = vi.fn().mockResolvedValue(summary());
    const work = makeOutcomesWork(() => "2026-07-04", ingest, silent, () => AT);
    const r = await work();
    expect(r.dates).toEqual(["2026-07-04"]);
    expect(ingest).toHaveBeenCalledExactlyOnceWith("2026-07-04");
  });

  it("outcomes: reads the stash at RUN time, not at construction time", async () => {
    // The route stashes the date just before trigger(); binding it at
    // construction would pin whatever was there when the module loaded.
    let stash: string | null = null;
    const ingest = vi.fn().mockResolvedValue(summary());
    const work = makeOutcomesWork(() => stash, ingest, silent, () => AT);
    stash = "2026-01-01";
    expect((await work()).dates).toEqual(["2026-01-01"]);
    stash = null;
    expect((await work()).dates).toHaveLength(2);
  });

  it("backtest: uses the 3-date ET window and forwards the self-heal options", async () => {
    const runForDate = vi.fn().mockResolvedValue({ processed: 1, errors: 0 });
    const work = makeBacktestWork(() => null, runForDate, silent, () => AT);
    const r = await work();
    expect(r.dates).toEqual(["2026-08-05", "2026-08-06", "2026-08-07"]);
    expect(r.processed).toBe(3);
  });

  it("backtest: propagates the fail-loud throw out of the work fn", async () => {
    const work = makeBacktestWork(
      () => null,
      vi.fn().mockResolvedValue({ processed: 0, errors: 2 }),
      silent,
      () => AT
    );
    await expect(work()).rejects.toThrow(/all 6 backtest enrollments failed/);
  });

  it("logs one OUTPUT line per run", async () => {
    const lines: string[] = [];
    const work = makeOutcomesWork(
      () => null,
      vi.fn().mockResolvedValue(summary()),
      m => lines.push(m),
      () => AT
    );
    await work();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("[Cron:mlb-outcomes] [OUTPUT]");
  });
});

describe("resolveDateJobRequest — the route's decision, without Express", () => {
  it("rejects a malformed date with a 400 body", () => {
    expect(resolveDateJobRequest("07-04-2026")).toEqual({
      action: "reject",
      status: 400,
      body: { ok: false, error: "invalid-date", expected: "YYYY-MM-DD" },
    });
  });

  it("runs the default window when no date is supplied", () => {
    expect(resolveDateJobRequest(undefined)).toEqual({
      action: "run",
      date: null,
    });
  });

  it("runs the supplied date when it is well-formed", () => {
    expect(resolveDateJobRequest("2026-08-07")).toEqual({
      action: "run",
      date: "2026-08-07",
    });
  });
});
