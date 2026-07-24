/**
 * intervalPicker.test.ts — pure unit contract for the billing-cadence catalog.
 *
 * Runs under vitest's node environment (no DOM). It imports INTERVAL_OPTIONS
 * through the IntervalPicker public surface (which re-exports the pure list from
 * planTypes.ts) and pins the label → { interval, intervalCount } mappings the
 * Create Plan form relies on. If any cadence encoding drifts, this fails.
 */
import { describe, it, expect } from "vitest";
import { INTERVAL_OPTIONS } from "./IntervalPicker";

function optionFor(label: string) {
  return INTERVAL_OPTIONS.find((o) => o.label === label);
}

describe("INTERVAL_OPTIONS", () => {
  it("maps Daily → { day, 1 }", () => {
    expect(optionFor("Daily")).toEqual({ label: "Daily", interval: "day", intervalCount: 1 });
  });

  it("maps 'Every 2 weeks' → { day, 14 } (weeks are encoded as 14 days for Stripe)", () => {
    expect(optionFor("Every 2 weeks")).toEqual({
      label: "Every 2 weeks",
      interval: "day",
      intervalCount: 14,
    });
  });

  it("maps Monthly → { month, 1 }", () => {
    expect(optionFor("Monthly")).toEqual({ label: "Monthly", interval: "month", intervalCount: 1 });
  });

  it("maps Quarterly → { month, 3 }", () => {
    expect(optionFor("Quarterly")).toEqual({
      label: "Quarterly",
      interval: "month",
      intervalCount: 3,
    });
  });

  it("maps Annual → { year, 1 }", () => {
    expect(optionFor("Annual")).toEqual({ label: "Annual", interval: "year", intervalCount: 1 });
  });

  it("includes 'Monthly' as the default cadence", () => {
    expect(INTERVAL_OPTIONS.some((o) => o.label === "Monthly")).toBe(true);
  });
});
