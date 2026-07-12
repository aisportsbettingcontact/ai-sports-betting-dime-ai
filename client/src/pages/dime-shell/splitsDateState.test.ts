import { describe, expect, it } from "vitest";
import { resolveSplitsServerDate } from "./splitsDateState";

describe("resolveSplitsServerDate", () => {
  it("never overwrites a URL-selected splits date", () => {
    expect(
      resolveSplitsServerDate("2026-07-04", "2026-07-11", "2026-07-04")
    ).toBe("2026-07-04");
  });

  it("still synchronizes a legacy dateless view", () => {
    expect(
      resolveSplitsServerDate(
        "2026-07-10",
        "2026-07-11",
        undefined,
        false
      )
    ).toBe("2026-07-11");
  });

  it("keeps a user-picked date in a legacy dateless view", () => {
    expect(
      resolveSplitsServerDate(
        "2026-07-09",
        "2026-07-11",
        undefined,
        true
      )
    ).toBe("2026-07-09");
  });
});
