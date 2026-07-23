import { describe, it, expect } from "vitest";
import { overviewWindows, disabledOverview, rowsOf, numAt } from "./read";

describe("mysql2 result extraction (rowsOf / numAt)", () => {
  it("reads rows from the mysql2 [rows, fields] tuple, not the tuple itself", () => {
    const result = [[{ n: 5 }], [{ name: "n" }]]; // [rows, fields]
    expect(rowsOf(result)).toEqual([{ n: 5 }]);
    expect(numAt(result)).toBe(5);
  });
  it("coerces a BIGINT/COUNT returned as a string", () => {
    expect(numAt([[{ n: "42" }], []])).toBe(42);
  });
  it("is safe on an empty result", () => {
    expect(rowsOf([[], []])).toEqual([]);
    expect(numAt([[], []])).toBe(0);
    expect(numAt(undefined)).toBe(0);
  });
  it("maps a multi-row device-mix result", () => {
    const mix = [[{ device_type: "mobile", users: 3, value_events: 9 }], []];
    expect(rowsOf(mix)).toHaveLength(1);
    expect(rowsOf(mix)[0].device_type).toBe("mobile");
  });
});

describe("overviewWindows", () => {
  it("computes half-open UTC windows from asOf", () => {
    const asOf = 1_000_000_000_000;
    const w = overviewWindows(asOf);
    expect(asOf - w.dayFrom).toBe(24 * 60 * 60 * 1000);
    expect(asOf - w.weekFrom).toBe(7 * 24 * 60 * 60 * 1000);
    expect(asOf - w.monthFrom).toBe(30 * 24 * 60 * 60 * 1000);
  });
});

describe("disabledOverview", () => {
  it("is an honest not_measured payload with no fabricated zeros", () => {
    const o = disabledOverview("analytics pipeline disabled");
    expect(o.state).toBe("not_measured");
    expect(o.dau.state).toBe("not_measured");
    expect(o.dau.value).toBeNull();
    expect(o.wau.value).toBeNull();
    expect(o.mau.value).toBeNull();
    expect(o.valueEventsTotal.value).toBeNull();
    expect(o.deviceMix).toEqual([]);
    expect(o.lastEventAt).toBeNull();
    expect(o.reason).toMatch(/disabled/);
  });
  it("carries honest not_measured action metrics (D3) — never fabricated zeros", () => {
    const o = disabledOverview("analytics pipeline disabled");
    expect(o.totalActions.state).toBe("not_measured");
    expect(o.totalActions.value).toBeNull();
    expect(o.uniqueActions.state).toBe("not_measured");
    expect(o.uniqueActions.value).toBeNull();
    expect(o.topActions).toEqual([]);
  });
});
