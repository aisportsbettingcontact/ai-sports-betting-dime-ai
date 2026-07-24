import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.join(import.meta.dirname, "DeviceActivityPanel.tsx"), "utf8");

describe("DeviceActivityPanel (source contract)", () => {
  it("reads the owner-gated overview query", () => {
    expect(src).toMatch(/trpc\.analytics\.overview\.useQuery/);
  });
  it("renders honest states and a device mix — never a fabricated zero", () => {
    expect(src).toMatch(/not_measured/);
    expect(src).toMatch(/Not measured/);
    expect(src).toMatch(/deviceMix/);
  });
  it("gates the device-mix chart on measured, non-empty data", () => {
    expect(src).toMatch(/!notOk && mix\.length > 0/);
  });
});

describe("DeviceActivityPanel — engagement composition (charts)", () => {
  it("is the composition card, not the old KPI/leaderboard grid", () => {
    expect(src).toMatch(/Engagement composition/);
    // The KPI tiles + Power-Users leaderboard moved to their own panels.
    expect(src).not.toMatch(/Power Users/);
    expect(src).not.toMatch(/topUsers/);
  });
  it("shows which features are used via a top-actions read, gated on data", () => {
    expect(src).toMatch(/topActions/);
    expect(src).toMatch(/topActions\.length > 0/);
  });
  it("keeps the single-hue mint discipline (ramp, not a rainbow)", () => {
    expect(src).toMatch(/mintRamp/);
    expect(src).toMatch(/SIGNAL_SERIES/);
  });
});
