/**
 * Unit tests for NHL feature additions (Mar 15, 2026 sprint):
 *  1. Hockey Reference rest-days computation
 *  2. NHL goalie watcher game matching (abbrev resolution via NHL_BY_DB_SLUG)
 *  3. Utah Hockey Club AN slug alias
 *  4. Sharp Edge Detection Engine helpers (americanOddsToBreakEven)
 */

import { describe, it, expect } from "vitest";
import { NHL_BY_DB_SLUG, getNhlTeamByAnSlug } from "../shared/nhlTeams";

// ─── 1. Hockey Reference rest-days helpers ────────────────────────────────────

/**
 * Inline the rest-days computation logic from nhlHockeyRefScraper.ts
 * so we can test it without HTTP calls.
 */
function computeRestDays(gameDates: string[], targetDateStr: string): number {
  const target = new Date(targetDateStr + "T00:00:00Z");
  const prior = gameDates
    .map(d => new Date(d + "T00:00:00Z"))
    .filter(d => d < target)
    .sort((a, b) => b.getTime() - a.getTime());

  if (prior.length === 0) return 3; // default when no prior game found

  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((target.getTime() - prior[0].getTime()) / msPerDay);
}

describe("computeRestDays", () => {
  it("returns 1 for back-to-back (played yesterday)", () => {
    expect(computeRestDays(["2026-03-14", "2026-03-12"], "2026-03-15")).toBe(1);
  });

  it("returns 2 for one day off", () => {
    expect(computeRestDays(["2026-03-13"], "2026-03-15")).toBe(2);
  });

  it("returns 3 for two days off", () => {
    expect(computeRestDays(["2026-03-12"], "2026-03-15")).toBe(3);
  });

  it("ignores future game dates", () => {
    expect(computeRestDays(["2026-03-16", "2026-03-13"], "2026-03-15")).toBe(2);
  });

  it("returns default 3 when no prior games found", () => {
    expect(computeRestDays([], "2026-03-15")).toBe(3);
  });

  it("picks the most recent prior game when multiple exist", () => {
    // Most recent prior is 2026-03-14 → 1 day rest
    expect(
      computeRestDays(["2026-03-10", "2026-03-12", "2026-03-14"], "2026-03-15")
    ).toBe(1);
  });
});

// ─── 2. NHL_BY_DB_SLUG abbrev resolution ─────────────────────────────────────

describe("NHL_BY_DB_SLUG abbrev resolution", () => {
  const cases: [string, string][] = [
    ["boston_bruins", "BOS"],
    ["tampa_bay_lightning", "TBL"],
    ["columbus_blue_jackets", "CBJ"],
    ["new_jersey_devils", "NJD"],
    ["new_york_islanders", "NYI"],
    ["new_york_rangers", "NYR"],
    ["los_angeles_kings", "LAK"],
    ["san_jose_sharks", "SJS"],
    ["vegas_golden_knights", "VGK"],
    ["utah_mammoth", "UTA"],
  ];

  for (const [dbSlug, expectedAbbrev] of cases) {
    it(`resolves ${dbSlug} → ${expectedAbbrev}`, () => {
      const team = NHL_BY_DB_SLUG.get(dbSlug);
      expect(team).toBeDefined();
      expect(team?.abbrev).toBe(expectedAbbrev);
    });
  }
});

// ─── 3. Utah Hockey Club AN slug alias ───────────────────────────────────────

describe("getNhlTeamByAnSlug alias resolution", () => {
  it("resolves utah-hockey-club to utah_mammoth", () => {
    const team = getNhlTeamByAnSlug("utah-hockey-club");
    expect(team).toBeDefined();
    expect(team?.dbSlug).toBe("utah_mammoth");
    expect(team?.abbrev).toBe("UTA");
  });

  it("still resolves utah-mammoth directly", () => {
    const team = getNhlTeamByAnSlug("utah-mammoth");
    expect(team).toBeDefined();
    expect(team?.dbSlug).toBe("utah_mammoth");
  });

  it("resolves boston-bruins correctly", () => {
    const team = getNhlTeamByAnSlug("boston-bruins");
    expect(team).toBeDefined();
    expect(team?.dbSlug).toBe("boston_bruins");
    expect(team?.abbrev).toBe("BOS");
  });
});

// ─── 4. Sharp Edge Detection — americanOddsToBreakEven ───────────────────────

/**
 * Inline the americanOddsToBreakEven function from nhlModelSync.ts
 * so we can test it in isolation.
 */
function americanOddsToBreakEven(odds: number): number {
  if (odds >= 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

describe("americanOddsToBreakEven", () => {
  it("returns 0.5 for even money (+100 / -100)", () => {
    expect(americanOddsToBreakEven(100)).toBeCloseTo(0.5, 4);
    expect(americanOddsToBreakEven(-100)).toBeCloseTo(0.5, 4);
  });

  it("returns ~0.5238 for -110 (standard juice)", () => {
    expect(americanOddsToBreakEven(-110)).toBeCloseTo(0.5238, 3);
  });

  it("returns ~0.4762 for +110", () => {
    expect(americanOddsToBreakEven(110)).toBeCloseTo(0.4762, 3);
  });

  it("returns ~0.6667 for -200 (heavy favorite)", () => {
    expect(americanOddsToBreakEven(-200)).toBeCloseTo(0.6667, 3);
  });

  it("returns ~0.3333 for +200 (underdog)", () => {
    expect(americanOddsToBreakEven(200)).toBeCloseTo(0.3333, 3);
  });

  it("returns ~0.7407 for -286 (DK puck line favorite)", () => {
    expect(americanOddsToBreakEven(-286)).toBeCloseTo(0.7407, 3);
  });
});

// ─── 5. Goalie watcher matchGameToDb abbrev resolution ───────────────────────

describe("matchGameToDb abbrev resolution", () => {
  /**
   * Simulate the matchGameToDb logic from nhlGoalieWatcher.ts:
   * convert dbSlug → abbrev via NHL_BY_DB_SLUG, then compare to rotoGame abbrev
   */
  function matchTeam(dbSlug: string, rotoAbbrev: string): boolean {
    const team = NHL_BY_DB_SLUG.get(dbSlug);
    if (!team) return false;
    return team.abbrev === rotoAbbrev;
  }

  it("correctly matches boston_bruins to BOS", () => {
    expect(matchTeam("boston_bruins", "BOS")).toBe(true);
  });

  it("correctly matches tampa_bay_lightning to TBL (not TAM)", () => {
    expect(matchTeam("tampa_bay_lightning", "TBL")).toBe(true);
    expect(matchTeam("tampa_bay_lightning", "TAM")).toBe(false);
  });

  it("correctly matches vegas_golden_knights to VGK (not VEG)", () => {
    expect(matchTeam("vegas_golden_knights", "VGK")).toBe(true);
    expect(matchTeam("vegas_golden_knights", "VEG")).toBe(false);
  });

  it("correctly matches new_jersey_devils to NJD (not NEW)", () => {
    expect(matchTeam("new_jersey_devils", "NJD")).toBe(true);
    expect(matchTeam("new_jersey_devils", "NEW")).toBe(false);
  });

  it("correctly matches utah_mammoth to UTA", () => {
    expect(matchTeam("utah_mammoth", "UTA")).toBe(true);
  });
});
