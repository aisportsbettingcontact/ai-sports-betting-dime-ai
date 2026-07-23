import { describe, it, expect } from "vitest";
import { overviewWindows, disabledOverview } from "./read";

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
});
