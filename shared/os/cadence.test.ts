import { describe, expect, it } from "vitest";
import {
  expectedRunsOnDate,
  cadenceVerdict,
  parseCronField,
  defaultMeasureDate,
  isCompleteDay,
} from "./cadence";

describe("cron expressions, evaluated rather than guessed", () => {
  // A representative non-special day: Thursday 2026-08-06.
  const D = "2026-08-06";

  it.each([
    ["*/5 * * * *", 288],
    ["*/10 * * * *", 144],
    ["*/15 * * * *", 96],
    ["*/30 * * * *", 48],
    ["0 9 * * *", 1],
    ["23 9 * * *", 1],
    ["17 6 1 * *", 0], // the 1st of the month; 2026-08-06 is not the 1st
    ["0 * * * *", 24],
    ["0 0 * * *", 1],
  ])("%s -> %i runs on 2026-08-06", (expr, want) => {
    expect(expectedRunsOnDate(expr, D)).toBe(want);
  });

  it("counts a monthly expression on the day it actually fires", () => {
    expect(expectedRunsOnDate("17 6 1 * *", "2026-09-01")).toBe(1);
  });

  it("handles day-of-week (2026-08-06 is a Thursday)", () => {
    expect(expectedRunsOnDate("17 6 * * 1", "2026-08-06")).toBe(0); // Monday
    expect(expectedRunsOnDate("17 6 * * 4", "2026-08-06")).toBe(1); // Thursday
  });

  it("sums multiple schedule expressions on one workflow", () => {
    // cron-bet-grade declares both */30 and a nightly sweep.
    const both = ["*/30 * * * *", "15 8 * * *"].reduce((n, e) => n + expectedRunsOnDate(e, D), 0);
    expect(both).toBe(49);
  });

  it("refuses an unparseable expression rather than scoring it zero", () => {
    // Silently returning 0 would make a malformed schedule look perfectly honoured.
    expect(() => expectedRunsOnDate("not a cron", D)).toThrow(/cron/i);
    expect(() => expectedRunsOnDate("*/5 * * *", D)).toThrow(/five fields/i);
  });
});

describe("parseCronField", () => {
  it("expands steps, ranges, lists and wildcards", () => {
    expect(parseCronField("*/15", 0, 59)).toEqual([0, 15, 30, 45]);
    expect(parseCronField("1-4", 0, 59)).toEqual([1, 2, 3, 4]);
    expect(parseCronField("1,5,9", 0, 59)).toEqual([1, 5, 9]);
    expect(parseCronField("*", 0, 6)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(parseCronField("2-10/4", 0, 59)).toEqual([2, 6, 10]);
  });

  it("rejects out-of-range values instead of clamping them", () => {
    expect(() => parseCronField("99", 0, 59)).toThrow(/range/i);
  });
});

describe("the verdict", () => {
  it("flags a workflow running far below its declared cadence", () => {
    const v = cadenceVerdict({ workflow: "cron-mlb-cycle.yml", expected: 288, actual: 12 });
    expect(v.honoured).toBe(false);
    expect(v.ratio).toBeCloseTo(12 / 288, 5);
  });

  it("passes a workflow meeting its cadence", () => {
    expect(cadenceVerdict({ workflow: "x", expected: 1, actual: 1 }).honoured).toBe(true);
  });

  it("passes a workflow that over-runs — extra runs are not this loop's concern", () => {
    expect(cadenceVerdict({ workflow: "x", expected: 24, actual: 30 }).honoured).toBe(true);
  });

  it("does NOT judge a workflow expected to run zero times today", () => {
    // A monthly job on the 6th. Scoring it 0/0 would either divide by zero or
    // report a false failure every day of the month except one.
    const v = cadenceVerdict({ workflow: "refresh-cf-cidrs.yml", expected: 0, actual: 0 });
    expect(v.honoured).toBe(true);
    expect(v.ratio).toBeNull();
    expect(v.note).toMatch(/not scheduled/i);
  });

  it("flags a daily job that did not run at all", () => {
    const v = cadenceVerdict({ workflow: "12-nightly-verification.yml", expected: 1, actual: 0 });
    expect(v.honoured).toBe(false);
  });
});

describe("the measured window must be a COMPLETE day", () => {
  // Found auditing LOOP-002. The observer defaulted to TODAY and the daily
  // workflow fires at 10:40 UTC, so a perfectly-honoured */5 job could reach at
  // most 129 of a full day's 288 runs — 45%, below the 0.5 floor. Every
  // high-frequency workflow would have been reported unhonoured EVERY DAY,
  // forever, regardless of reality: a permanently red alarm, which is the same
  // as no alarm.
  it("defaults to the previous complete UTC day, never a partial one", () => {
    expect(defaultMeasureDate("2026-08-06T10:40:00Z")).toBe("2026-08-05");
    expect(defaultMeasureDate("2026-08-06T00:00:01Z")).toBe("2026-08-05");
    expect(defaultMeasureDate("2026-08-06T23:59:59Z")).toBe("2026-08-05");
  });

  it("rolls back across a month boundary", () => {
    expect(defaultMeasureDate("2026-09-01T10:40:00Z")).toBe("2026-08-31");
    expect(defaultMeasureDate("2026-03-01T10:40:00Z")).toBe("2026-02-28");
  });

  it("refuses a measured date that is not yet complete", () => {
    // Asked to measure today, the instrument must say so rather than report a
    // partial count as if it were a full one.
    expect(isCompleteDay("2026-08-05", "2026-08-06T10:40:00Z")).toBe(true);
    expect(isCompleteDay("2026-08-06", "2026-08-06T10:40:00Z")).toBe(false);
    expect(isCompleteDay("2026-08-07", "2026-08-06T10:40:00Z")).toBe(false);
  });
});
