import { describe, it, expect } from "vitest";
import { mintAlpha, mintRamp, fmtCompact, fmtDayTick, MINT_RGB } from "./chartTheme";

describe("mintAlpha", () => {
  it("renders the mint triple at the given alpha", () => {
    expect(mintAlpha(0.5)).toBe(`rgba(${MINT_RGB}, 0.5)`);
    expect(mintAlpha(0.12)).toBe("rgba(69, 224, 168, 0.12)");
  });
});

describe("mintRamp — single-hue ordinal ramp (Dime: never rainbow)", () => {
  it("returns exactly n entries", () => {
    expect(mintRamp(1)).toHaveLength(1);
    expect(mintRamp(7)).toHaveLength(7);
  });
  it("is strictly descending in opacity (strongest first)", () => {
    const alphas = mintRamp(5).map((s) => Number(/,\s*([\d.]+)\)$/.exec(s)![1]));
    for (let i = 1; i < alphas.length; i++) expect(alphas[i]).toBeLessThan(alphas[i - 1]);
  });
  it("stays on the single mint hue for every step", () => {
    for (const c of mintRamp(7)) expect(c).toContain(MINT_RGB);
  });
  it("floors the faintest step visibly above zero", () => {
    const ramp = mintRamp(7);
    const last = Number(/,\s*([\d.]+)\)$/.exec(ramp[ramp.length - 1])![1]);
    expect(last).toBeGreaterThanOrEqual(0.16);
  });
});

describe("fmtCompact", () => {
  it("passes small integers through", () => {
    expect(fmtCompact(0)).toBe("0");
    expect(fmtCompact(999)).toBe("999");
  });
  it("compacts thousands and millions", () => {
    expect(fmtCompact(1234)).toBe("1.2k");
    expect(fmtCompact(12345)).toBe("12k");
    expect(fmtCompact(2_400_000)).toBe("2.4M");
    expect(fmtCompact(12_000_000)).toBe("12M");
  });
  it("handles negatives and non-finite input honestly", () => {
    expect(fmtCompact(-1500)).toBe("-1.5k");
    expect(fmtCompact(Number.NaN)).toBe("—");
  });
});

describe("fmtDayTick", () => {
  it("shortens an ISO date to a compact tick", () => {
    expect(fmtDayTick("2026-07-03")).toBe("Jul 3");
    expect(fmtDayTick("2026-01-15")).toBe("Jan 15");
    expect(fmtDayTick("2026-12-31")).toBe("Dec 31");
  });
  it("returns the input unchanged when it is not an ISO date", () => {
    expect(fmtDayTick("not-a-date")).toBe("not-a-date");
  });
});
