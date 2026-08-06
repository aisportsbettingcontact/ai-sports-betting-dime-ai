import { describe, expect, it } from "vitest";
import { deriveKickoffDate } from "./kickoffDate";

describe("deriveKickoffDate", () => {
  it("keeps a Sunday 1pm ET kickoff on its calendar day (PT path)", () => {
    expect(deriveKickoffDate("2026-09-13T17:00:00Z", true)).toBe("2026-09-13");
  });
  it("keeps a late Sunday-night game on football Sunday (PT path)", () => {
    // 8:20pm ET Sun = 00:20Z Mon — PT date is still Sunday
    expect(deriveKickoffDate("2026-09-14T00:20:00Z", true)).toBe("2026-09-13");
  });
  it("uses ET for TBD midnight-ET sentinels (amendment)", () => {
    // TBD playoff slot stored 05:00Z = midnight ET Jan 17 — ET date Jan 17, PT would wrongly say Jan 16
    expect(deriveKickoffDate("2027-01-17T05:00:00Z", false)).toBe("2027-01-17");
  });
  it("handles EST winter instants on the PT path", () => {
    expect(deriveKickoffDate("2027-02-14T23:30:00Z", true)).toBe("2027-02-14");
  });
});
