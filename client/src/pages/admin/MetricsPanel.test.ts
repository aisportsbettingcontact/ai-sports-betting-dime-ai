import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * MetricsPanel honesty contract (owner directive 2026-07-23). The repo's client
 * vitest runs in node env, so these pin the render rules by source shape:
 * never a fabricated zero; membership reconciled, not overlapping totals.
 */
const src = fs.readFileSync(path.join(import.meta.dirname, "MetricsPanel.tsx"), "utf8");

describe("MetricsPanel — honest data-states", () => {
  it("renders data-state labels ('Not measured') instead of fabricated zeros", () => {
    expect(src).toMatch(/Not measured/);
    expect(src).toMatch(/point\.state === "ok"/);
  });
  it("only prints a KPI value when the metric is a valid ok measurement", () => {
    expect(src).toMatch(/point\.state === "ok" && point\.value !== null/);
  });
  it("surfaces the exact reason on hover for non-ok metrics", () => {
    expect(src).toMatch(/title=\{point\.reason/);
  });
});

describe("MetricsPanel — reconciled membership", () => {
  it("presents non-overlapping buckets that sum to the total", () => {
    expect(src).toMatch(/recurringPaid/);
    expect(src).toMatch(/noAccess/);
    expect(src).toMatch(/Lifetime \+ Recurring \+ No-access = Total/);
  });
  it("treats Discord as cross-cutting, never a separate slice of the total", () => {
    expect(src).toMatch(/Cross-cuts every bucket/);
    expect(src).toMatch(/discordConnected/);
  });
  it("renders membership as its data-state (not a fabricated 0) when the query did not succeed", () => {
    expect(src).toMatch(/const memberOk = memberData\?\.state === "ok"/);
    expect(src).toMatch(/!memberOk/);
  });
  it("does not resurrect the old overlapping fields (totalPaying/lifetimeMembers/nonPaying)", () => {
    expect(src).not.toMatch(/totalPaying/);
    expect(src).not.toMatch(/lifetimeMembers/);
    expect(src).not.toMatch(/nonPaying/);
  });
});

describe("MetricsPanel — histogram", () => {
  it("gates the chart on data-state (no all-zero fabricated distribution)", () => {
    expect(src).toMatch(/state !== "ok"/);
  });
});
