import { describe, expect, it } from "vitest";
import { etKickoffToUtc } from "./cfbKickoff";

describe("etKickoffToUtc", () => {
  it("converts EDT (August) times: 12:00pm ET = 16:00Z", () => {
    expect(etKickoffToUtc("2026-08-29", "12:00pm")?.toISOString()).toBe(
      "2026-08-29T16:00:00.000Z"
    );
  });
  it("converts EST (December) times: 4:30pm ET = 21:30Z", () => {
    expect(etKickoffToUtc("2026-12-05", "4:30pm")?.toISOString()).toBe(
      "2026-12-05T21:30:00.000Z"
    );
  });
  it("handles 10:00pm late kickoffs without date rollover in the ET calendar", () => {
    expect(etKickoffToUtc("2026-08-29", "10:00pm")?.toISOString()).toBe(
      "2026-08-30T02:00:00.000Z"
    );
  });
  it("handles 12:15am as after midnight ET", () => {
    expect(etKickoffToUtc("2026-09-05", "12:15am")?.toISOString()).toBe(
      "2026-09-05T04:15:00.000Z"
    );
  });
  it("returns null for TBA and ranges", () => {
    expect(etKickoffToUtc("2026-10-03", "Time TBA")).toBeNull();
    expect(etKickoffToUtc("2026-10-03", "3:30-8:00pm")).toBeNull();
    expect(etKickoffToUtc("2026-10-03", "")).toBeNull();
    expect(etKickoffToUtc("2026-10-03", "25:99pm")).toBeNull();
    expect(etKickoffToUtc("2026-10-03", "0:30pm")).toBeNull();
  });
});
