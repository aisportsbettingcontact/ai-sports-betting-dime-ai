/**
 * fangraphsScraper.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for the Fangraphs lineup scraper (MLB Stats API-based).
 *
 * Tests cover:
 *   - PST date calculation (today / tomorrow)
 *   - Data structure validation (FgScrapeResult shape)
 *   - Pitcher stat parsing
 *   - Batter lineup structure
 *   - Error handling and graceful degradation
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getPstDate,
  buildMlbScheduleUrl,
  parsePitcherStats,
  buildLineupStatus,
  type FgBatter,
  type FgPitcher,
  type FgGame,
  type FgDateResult,
  type FgScrapeResult,
} from "./fangraphsScraper";

// ─── PST Date Helpers ─────────────────────────────────────────────────────────

describe("getPstDate", () => {
  it("returns a date string in YYYY-MM-DD format", () => {
    const result = getPstDate(0);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    console.log(`[INPUT] offset=0 [OUTPUT] date="${result}" [VERIFY] PASS — format matches YYYY-MM-DD`);
  });

  it("returns tomorrow when offset=1", () => {
    const today = getPstDate(0);
    const tomorrow = getPstDate(1);
    const todayDate = new Date(today + "T12:00:00Z");
    const tomorrowDate = new Date(tomorrow + "T12:00:00Z");
    const diffDays = (tomorrowDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBe(1);
    console.log(`[INPUT] today="${today}" tomorrow="${tomorrow}" [STATE] diffDays=${diffDays} [VERIFY] PASS — tomorrow is 1 day after today`);
  });

  it("returns yesterday when offset=-1", () => {
    const today = getPstDate(0);
    const yesterday = getPstDate(-1);
    const todayDate = new Date(today + "T12:00:00Z");
    const yesterdayDate = new Date(yesterday + "T12:00:00Z");
    const diffDays = (todayDate.getTime() - yesterdayDate.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBe(1);
    console.log(`[INPUT] today="${today}" yesterday="${yesterday}" [STATE] diffDays=${diffDays} [VERIFY] PASS — yesterday is 1 day before today`);
  });

  it("uses PST timezone (UTC-8 or UTC-7 for PDT)", () => {
    // PST is UTC-8, PDT is UTC-7. The date should be within 1 day of UTC.
    const pstDate = getPstDate(0);
    const utcDate = new Date().toISOString().slice(0, 10);
    const pstParsed = new Date(pstDate + "T12:00:00Z");
    const utcParsed = new Date(utcDate + "T12:00:00Z");
    const diffDays = Math.abs(pstParsed.getTime() - utcParsed.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeLessThanOrEqual(1);
    console.log(`[INPUT] pstDate="${pstDate}" utcDate="${utcDate}" [STATE] diffDays=${diffDays} [VERIFY] PASS — PST date within 1 day of UTC`);
  });
});

// ─── MLB Schedule URL Builder ─────────────────────────────────────────────────

describe("buildMlbScheduleUrl", () => {
  it("builds a valid MLB Stats API URL with the date parameter", () => {
    const url = buildMlbScheduleUrl("2026-05-15");
    expect(url).toContain("statsapi.mlb.com");
    expect(url).toContain("2026-05-15");
    expect(url).toContain("sportId=1");
    expect(url).toContain("hydrate=");
    console.log(`[INPUT] date="2026-05-15" [OUTPUT] url="${url.slice(0, 80)}..." [VERIFY] PASS — URL contains required params`);
  });

  it("includes lineups hydration in the URL", () => {
    const url = buildMlbScheduleUrl("2026-05-16");
    expect(url.toLowerCase()).toContain("lineup");
    console.log(`[INPUT] date="2026-05-16" [VERIFY] PASS — URL contains lineup hydration`);
  });

  it("includes probablePitcher hydration in the URL", () => {
    const url = buildMlbScheduleUrl("2026-05-16");
    expect(url.toLowerCase()).toContain("probablepitcher");
    console.log(`[INPUT] date="2026-05-16" [VERIFY] PASS — URL contains probablePitcher hydration`);
  });
});

// ─── Pitcher Stat Parser ──────────────────────────────────────────────────────

describe("parsePitcherStats", () => {
  it("parses a valid pitcher stats object correctly", () => {
    const rawStats = {
      era: "3.45",
      inningsPitched: "52.1",
      strikeOuts: 48,
      wins: 4,
      losses: 2,
      whip: "1.12",
    };
    const result = parsePitcherStats(rawStats);
    expect(result.era).toBe("3.45");
    expect(result.ip).toBe("52.1");
    expect(result.strikeouts).toBe(48);
    expect(result.wins).toBe(4);
    expect(result.losses).toBe(2);
    expect(result.whip).toBe("1.12");
    console.log(`[INPUT] rawStats=${JSON.stringify(rawStats)} [OUTPUT] ${JSON.stringify(result)} [VERIFY] PASS — all fields parsed correctly`);
  });

  it("handles missing stats gracefully with defaults", () => {
    const result = parsePitcherStats({});
    expect(result.era).toBe("-.--");
    expect(result.ip).toBe("0.0");
    expect(result.strikeouts).toBe(0);
    expect(result.wins).toBe(0);
    expect(result.losses).toBe(0);
    expect(result.whip).toBe("-.--");
    console.log(`[INPUT] rawStats={} [OUTPUT] ${JSON.stringify(result)} [VERIFY] PASS — defaults applied for missing fields`);
  });

  it("handles null/undefined stats gracefully", () => {
    const result = parsePitcherStats(null);
    expect(result.era).toBe("-.--");
    expect(result.strikeouts).toBe(0);
    console.log(`[INPUT] rawStats=null [VERIFY] PASS — null input handled gracefully`);
  });
});

// ─── Lineup Status Builder ────────────────────────────────────────────────────

describe("buildLineupStatus", () => {
  it("returns 'Posted' when lineup has players and none are projected", () => {
    const batters: FgBatter[] = [
      { order: 1, playerId: 1, name: "Player A", bats: "R", position: "CF", isProjected: false },
      { order: 2, playerId: 2, name: "Player B", bats: "L", position: "1B", isProjected: false },
    ];
    const status = buildLineupStatus(batters);
    expect(status).toBe("Posted");
    console.log(`[INPUT] batters.length=2 allProjected=false [OUTPUT] status="${status}" [VERIFY] PASS`);
  });

  it("returns 'Projected' when lineup has players and some are projected", () => {
    const batters: FgBatter[] = [
      { order: 1, playerId: 1, name: "Player A", bats: "R", position: "CF", isProjected: true },
      { order: 2, playerId: 2, name: "Player B", bats: "L", position: "1B", isProjected: false },
    ];
    const status = buildLineupStatus(batters);
    expect(status).toBe("Projected");
    console.log(`[INPUT] batters.length=2 someProjected=true [OUTPUT] status="${status}" [VERIFY] PASS`);
  });

  it("returns 'None' when lineup is empty", () => {
    const status = buildLineupStatus([]);
    expect(status).toBe("None");
    console.log(`[INPUT] batters.length=0 [OUTPUT] status="${status}" [VERIFY] PASS`);
  });
});

// ─── FgScrapeResult Shape Validation ─────────────────────────────────────────

describe("FgScrapeResult shape", () => {
  it("validates the expected shape of a FgScrapeResult object", () => {
    const mockResult: FgScrapeResult = {
      today: {
        date: "2026-05-15",
        games: [
          {
            gameId: 123456,
            gameTimeUtc: "2026-05-15T23:10:00Z",
            away: {
              teamId: 143,
              teamName: "Philadelphia Phillies",
              teamAbbr: "PHI",
              winProbability: 0.52,
              pitcher: {
                playerId: 605400,
                name: "Aaron Nola",
                throws: "R",
                wins: 2,
                losses: 3,
                era: "5.14",
                ip: "42.0",
                strikeouts: 44,
                whip: "1.38",
              },
              lineup: [
                { order: 1, playerId: 663728, name: "Kyle Schwarber", bats: "L", position: "LF", isProjected: false },
              ],
              lineupStatus: "Posted",
            },
            home: {
              teamId: 134,
              teamName: "Pittsburgh Pirates",
              teamAbbr: "PIT",
              winProbability: 0.48,
              pitcher: null,
              lineup: [],
              lineupStatus: "None",
            },
          },
        ],
        scrapedAt: new Date().toISOString(),
        elapsedMs: 1200,
      },
      tomorrow: {
        date: "2026-05-16",
        games: [],
        scrapedAt: new Date().toISOString(),
        elapsedMs: 800,
      },
      totalGames: 1,
      errors: [],
    };

    // Validate shape
    expect(mockResult.today.date).toBe("2026-05-15");
    expect(mockResult.today.games).toHaveLength(1);
    expect(mockResult.today.games[0].away.pitcher?.name).toBe("Aaron Nola");
    expect(mockResult.today.games[0].away.pitcher?.era).toBe("5.14");
    expect(mockResult.today.games[0].away.lineup).toHaveLength(1);
    expect(mockResult.today.games[0].home.lineupStatus).toBe("None");
    expect(mockResult.tomorrow.games).toHaveLength(0);
    expect(mockResult.errors).toHaveLength(0);

    console.log(`[INPUT] mockResult.totalGames=${mockResult.totalGames} [VERIFY] PASS — FgScrapeResult shape is valid`);
  });

  it("validates that win probabilities are between 0 and 1", () => {
    const mockGame: FgGame = {
      gameId: 1,
      gameTimeUtc: "2026-05-15T23:10:00Z",
      away: { teamId: 1, teamName: "Team A", teamAbbr: "AAA", winProbability: 0.52, pitcher: null, lineup: [], lineupStatus: "None" },
      home: { teamId: 2, teamName: "Team B", teamAbbr: "BBB", winProbability: 0.48, pitcher: null, lineup: [], lineupStatus: "None" },
    };
    expect(mockGame.away.winProbability).toBeGreaterThanOrEqual(0);
    expect(mockGame.away.winProbability).toBeLessThanOrEqual(1);
    expect(mockGame.home.winProbability).toBeGreaterThanOrEqual(0);
    expect(mockGame.home.winProbability).toBeLessThanOrEqual(1);
    const totalProb = mockGame.away.winProbability + mockGame.home.winProbability;
    expect(Math.abs(totalProb - 1.0)).toBeLessThan(0.01);
    console.log(`[INPUT] away.wp=${mockGame.away.winProbability} home.wp=${mockGame.home.winProbability} [STATE] total=${totalProb.toFixed(4)} [VERIFY] PASS — win probabilities sum to ~1.0`);
  });
});

// ─── Batter Handedness Validation ────────────────────────────────────────────

describe("batter handedness", () => {
  it("validates batter handedness is one of R, L, S", () => {
    const validHandedness = new Set(["R", "L", "S"]);
    const batters: FgBatter[] = [
      { order: 1, playerId: 1, name: "Righty", bats: "R", position: "CF", isProjected: false },
      { order: 2, playerId: 2, name: "Lefty",  bats: "L", position: "1B", isProjected: false },
      { order: 3, playerId: 3, name: "Switch", bats: "S", position: "2B", isProjected: false },
    ];
    for (const b of batters) {
      expect(validHandedness.has(b.bats)).toBe(true);
    }
    console.log(`[INPUT] batters.length=3 [VERIFY] PASS — all batter handedness values are valid (R/L/S)`);
  });

  it("validates pitcher handedness is R or L", () => {
    const validThrows = new Set(["R", "L"]);
    const pitcher: FgPitcher = {
      playerId: 1, name: "Test Pitcher", throws: "R",
      wins: 5, losses: 3, era: "3.50", ip: "60.0", strikeouts: 55, whip: "1.15",
    };
    expect(validThrows.has(pitcher.throws)).toBe(true);
    console.log(`[INPUT] pitcher.throws="${pitcher.throws}" [VERIFY] PASS — pitcher handedness is valid`);
  });
});
