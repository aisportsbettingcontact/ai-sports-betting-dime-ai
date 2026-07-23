import { describe, it, expect } from "vitest";
import {
  deriveActiveUserPoint,
  deriveAvgDurationPoint,
  reconcileMembership,
  METRIC_DEFINITION_VERSION,
} from "./metricDefinitions";

/**
 * Pure honesty helpers behind the User Activity metrics. These encode the
 * owner directive that missing instrumentation must read `Not measured`, never
 * a fabricated `0` / `00:00:00`, and that overlapping membership populations
 * must never be shown as separate totals.
 */

describe("deriveActiveUserPoint", () => {
  it("is not_measured when no engaged session has EVER been recorded (windowed 0 ≠ real zero)", () => {
    const p = deriveActiveUserPoint(0, 0);
    expect(p.state).toBe("not_measured");
    expect(p.value).toBeNull();
    expect(p.reason).toBeTruthy();
  });
  it("is a valid ok(0) once at least one engaged session exists", () => {
    expect(deriveActiveUserPoint(0, 5)).toEqual({ state: "ok", value: 0, reason: null });
  });
  it("returns ok(n) for a positive window count", () => {
    expect(deriveActiveUserPoint(3, 5)).toEqual({ state: "ok", value: 3, reason: null });
  });
});

describe("deriveAvgDurationPoint", () => {
  it("is not_measured (never 00:00:00) when there are no closed sessions", () => {
    const p = deriveAvgDurationPoint(0, 0);
    expect(p.state).toBe("not_measured");
    expect(p.value).toBeNull();
  });
  it("returns ok(avg) when closed sessions exist", () => {
    expect(deriveAvgDurationPoint(1234, 2)).toEqual({ state: "ok", value: 1234, reason: null });
  });
});

describe("reconcileMembership", () => {
  it("splits into mutually-exclusive buckets summing to total; lifetime ⊆ paying; discord cross-cuts", () => {
    // Observed prod-shape numbers: total 78, paying 77, lifetime 76, discord 77.
    const b = reconcileMembership(78, 77, 76, 77);
    expect(b.totalMembers).toBe(78);
    expect(b.lifetime).toBe(76);
    expect(b.recurringPaid).toBe(1); // 77 paying − 76 lifetime
    expect(b.noAccess).toBe(1); // 78 total − 77 paying
    expect(b.lifetime + b.recurringPaid + b.noAccess).toBe(b.totalMembers);
    expect(b.discordConnected).toBe(77); // cross-cutting, never part of the sum
  });
  it("clamps impossible inputs (lifetime>paying, discord>total) while staying self-consistent", () => {
    const b = reconcileMembership(10, 5, 8, 99);
    expect(b.lifetime).toBeLessThanOrEqual(5);
    expect(b.lifetime + b.recurringPaid + b.noAccess).toBe(10);
    expect(b.discordConnected).toBe(10);
  });
  it("all-zero (db unavailable) yields a consistent all-zero breakdown", () => {
    const b = reconcileMembership(0, 0, 0, 0);
    expect(b.totalMembers).toBe(0);
    expect(b.lifetime + b.recurringPaid + b.noAccess).toBe(0);
  });
});

describe("versioning", () => {
  it("exposes a metric-definition version tag", () => {
    expect(METRIC_DEFINITION_VERSION).toMatch(/^ua-metrics-v\d+$/);
  });
});
