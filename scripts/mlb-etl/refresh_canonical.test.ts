// Unit coverage for the pure diff logic in refresh_canonical.mts (the nightly canonical delta
// refresh orchestrator). The orchestrator itself is I/O-heavy end to end (spawns python
// subprocesses, hits statsapi, writes/reads a live DATABASE_URL) — that path is proven by the
// live `railway run` proof documented in the task report, not by a unit test. This file covers
// the one piece of real branching logic that can be tested in isolation: "given the refreshed
// dataset finals and what mlb_games already has, which gamePks are missing."
//
// Precedent note: the sibling mlb-etl/mlb-crawl scripts are pure-Python and use plain-assert
// test files (test_transform.py, test_crawl.py) run directly via `python3 test_*.py`. This
// module is TypeScript (.mts), so it follows this repo's TS convention instead — a vitest spec
// under scripts/**/*.test.ts (already covered by vitest.config.ts's include glob) exercising an
// exported pure function, same shape as the Python plain-assert tests.
import { describe, expect, it } from "vitest";
import { computeMissingGames, type DatasetGame } from "./refresh_canonical.mts";

function game(gamePk: number, overrides: Partial<DatasetGame> = {}): DatasetGame {
  return {
    gamePk,
    officialDate: "2026-07-28",
    codedState: "F",
    awayScore: 3,
    homeScore: 4,
    ...overrides,
  };
}

describe("computeMissingGames", () => {
  it("returns nothing missing when the DB already has every final", () => {
    const finals = [game(1), game(2), game(3)];
    const dbPks = new Set([1, 2, 3]);
    expect(computeMissingGames(finals, dbPks)).toEqual([]);
  });

  it("returns only the finals not present in the DB set", () => {
    const finals = [game(1), game(2), game(3)];
    const dbPks = new Set([1, 3]);
    const missing = computeMissingGames(finals, dbPks);
    expect(missing.map((g) => g.gamePk)).toEqual([2]);
  });

  it("treats an empty DB set as everything missing (cold DB / first run)", () => {
    const finals = [game(10), game(11)];
    const missing = computeMissingGames(finals, new Set());
    expect(missing.map((g) => g.gamePk)).toEqual([10, 11]);
  });

  it("returns an empty array (not an error) when there are no finals at all", () => {
    expect(computeMissingGames([], new Set([1, 2]))).toEqual([]);
  });

  it("preserves dataset row shape (score fields) for downstream score cross-foot checks", () => {
    const finals = [game(5, { awayScore: 7, homeScore: 2 })];
    const missing = computeMissingGames(finals, new Set());
    expect(missing[0]).toMatchObject({ gamePk: 5, awayScore: 7, homeScore: 2 });
  });
});
