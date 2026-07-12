import { describe, expect, it } from "vitest";
import { resolveSplitsServerDate, shouldAutoAdvance } from "./splitsDateState";

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

describe("shouldAutoAdvance", () => {
  const base = {
    dateSource: "app-default" as const,
    userSelected: false,
    datesLoaded: true,
    hasGamesOnSelectedDate: false,
    blockedByEffectiveWindow: false,
  };

  // Regression control for PR #70: both production mount paths always supply
  // initialDate, so the old `if (initialDate) return;` guard made auto-advance
  // unreachable. An app-default date MUST advance even though a date prop exists.
  it("advances an app-default date with no games", () => {
    expect(shouldAutoAdvance(base)).toBe(true);
  });

  it("never overrides an explicit deep-linked date", () => {
    expect(shouldAutoAdvance({ ...base, dateSource: "url-explicit" })).toBe(
      false
    );
  });

  it("never overrides a user-selected date", () => {
    expect(shouldAutoAdvance({ ...base, userSelected: true })).toBe(false);
  });

  it("waits until available dates have loaded", () => {
    expect(shouldAutoAdvance({ ...base, datesLoaded: false })).toBe(false);
  });

  it("stays put when the selected date has games", () => {
    expect(shouldAutoAdvance({ ...base, hasGamesOnSelectedDate: true })).toBe(
      false
    );
  });

  it("stays put inside a stale effective window", () => {
    expect(
      shouldAutoAdvance({ ...base, blockedByEffectiveWindow: true })
    ).toBe(false);
  });
});
