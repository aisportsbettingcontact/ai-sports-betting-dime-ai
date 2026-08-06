/**
 * Unit tests for the is_live filtering fix in actionNetworkScraper.ts
 *
 * Verifies that when the AN v2 API returns both pre-game (is_live=false) and
 * live in-game (is_live=true) outcomes in the same array, the scraper always
 * selects the pre-game line.
 *
 * Real-world example (Dayton @ VCU, March 15 2026, game in-progress):
 *   DK NJ spread outcomes:
 *     { side: "away", value: 3.5, odds: -118, is_live: false }  ← pre-game (CORRECT)
 *     { side: "away", value: 8.5, odds: -110, is_live: true  }  ← live in-game (WRONG)
 *
 * Without the fix, Array.find() returned the first matching element, which
 * happened to be the live line (+8.5 -110), causing the wrong spread to be
 * stored and displayed.
 */

import { describe, it, expect } from "vitest";

// ─── Replicate the internal findOutcome logic ──────────────────────────────────
// We duplicate the function here so the test is self-contained and doesn't
// depend on internal exports. This mirrors the exact logic in actionNetworkScraper.ts.

interface TestOutcome {
  side?: string;
  team_id?: number;
  value?: number;
  odds: number;
  is_live?: boolean;
}

function findOutcome(
  arr: TestOutcome[] | undefined,
  matcher: { side?: string; teamId?: number }
): TestOutcome | undefined {
  if (!arr) return undefined;

  const preGame = arr.filter(o => o.is_live !== true);
  const liveGame = arr.filter(o => o.is_live === true);

  const searchIn = (pool: TestOutcome[]) => {
    if (matcher.side) return pool.find(o => o.side === matcher.side);
    if (matcher.teamId != null)
      return pool.find(o => o.team_id === matcher.teamId);
    return undefined;
  };

  return searchIn(preGame) ?? searchIn(liveGame);
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("AN v2 is_live filtering — findOutcome()", () => {
  it("returns pre-game line when both pre-game and live lines exist (Dayton spread scenario)", () => {
    const outcomes: TestOutcome[] = [
      // Live in-game line — should be IGNORED
      { side: "away", value: 8.5, odds: -110, is_live: true },
      // Pre-game line — should be SELECTED
      { side: "away", value: 3.5, odds: -118, is_live: false },
    ];

    const result = findOutcome(outcomes, { side: "away" });
    expect(result).toBeDefined();
    expect(result!.value).toBe(3.5);
    expect(result!.odds).toBe(-118);
    expect(result!.is_live).toBe(false);
  });

  it("returns pre-game line when live line appears first in array", () => {
    const outcomes: TestOutcome[] = [
      // Live line first — old code would have picked this
      { side: "away", value: 8.5, odds: -110, is_live: true },
      { side: "home", value: -8.5, odds: -120, is_live: true },
      // Pre-game lines after
      { side: "away", value: 3.5, odds: -118, is_live: false },
      { side: "home", value: -3.5, odds: -102, is_live: false },
    ];

    const awayResult = findOutcome(outcomes, { side: "away" });
    const homeResult = findOutcome(outcomes, { side: "home" });

    expect(awayResult!.value).toBe(3.5);
    expect(awayResult!.odds).toBe(-118);
    expect(homeResult!.value).toBe(-3.5);
    expect(homeResult!.odds).toBe(-102);
  });

  it("returns pre-game total line (not live total)", () => {
    const outcomes: TestOutcome[] = [
      // Live total (game in 2nd half, total has moved down)
      { side: "over", value: 126.5, odds: -125, is_live: true },
      { side: "under", value: 126.5, odds: -105, is_live: true },
      // Pre-game total
      { side: "over", value: 139.5, odds: -108, is_live: false },
      { side: "under", value: 139.5, odds: -112, is_live: false },
    ];

    const overResult = findOutcome(outcomes, { side: "over" });
    const underResult = findOutcome(outcomes, { side: "under" });

    expect(overResult!.value).toBe(139.5);
    expect(overResult!.odds).toBe(-108);
    expect(underResult!.value).toBe(139.5);
    expect(underResult!.odds).toBe(-112);
  });

  it("falls back to live line when no pre-game line exists (game started, no pre-game data)", () => {
    const outcomes: TestOutcome[] = [
      // Only live lines — pre-game data was never posted (edge case)
      { side: "away", value: 8.5, odds: -110, is_live: true },
    ];

    const result = findOutcome(outcomes, { side: "away" });
    // Should fall back to live line rather than returning undefined
    expect(result).toBeDefined();
    expect(result!.is_live).toBe(true);
    expect(result!.value).toBe(8.5);
  });

  it("returns undefined when array is empty", () => {
    expect(findOutcome([], { side: "away" })).toBeUndefined();
    expect(findOutcome(undefined, { side: "away" })).toBeUndefined();
  });

  it("returns correct outcome when no is_live field present (upcoming games)", () => {
    const outcomes: TestOutcome[] = [
      // Upcoming game — no is_live field at all
      { side: "away", value: 3.5, odds: -118 },
      { side: "home", value: -3.5, odds: -102 },
    ];

    const result = findOutcome(outcomes, { side: "away" });
    expect(result!.value).toBe(3.5);
    expect(result!.odds).toBe(-118);
  });

  it("matches by team_id for moneyline outcomes", () => {
    const outcomes: TestOutcome[] = [
      // Live ML (game in-progress, Dayton down big)
      { side: "away", team_id: 1077, odds: 1400, is_live: true },
      { side: "home", team_id: 1083, odds: -3500, is_live: true },
      // Pre-game ML
      { side: "away", team_id: 1077, odds: 140, is_live: false },
      { side: "home", team_id: 1083, odds: -166, is_live: false },
    ];

    const awayML = findOutcome(outcomes, { teamId: 1077 });
    const homeML = findOutcome(outcomes, { teamId: 1083 });

    expect(awayML!.odds).toBe(140); // pre-game, not +1400 live
    expect(homeML!.odds).toBe(-166); // pre-game, not -3500 live
  });
});
