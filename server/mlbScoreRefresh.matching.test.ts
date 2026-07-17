/**
 * mlbScoreRefresh.matching.test.ts — Doubleheader-safe live-score matching.
 *
 * The pre-incident matcher used a single-slot `away@home` map: for the
 * 2026-07-17 TB@BOS split doubleheader, the second DB row overwrote the first
 * in the map and both API games matched the same row, cross-contaminating
 * status/scores between Game 1 and Game 2. These tests pin the claim-based
 * replacement (matchMlbLiveGamesToDbRows).
 */
import { describe, it, expect } from "vitest";
import {
  matchMlbLiveGamesToDbRows,
  type MatchableDbGame,
  type MlbLiveGame,
} from "./mlbScoreRefresh";
import { G1_GAMEPK, G2_GAMEPK, G1_START_UTC, G2_START_UTC } from "./mlbDoubleheaderFixtures";

function liveGame(overrides: Partial<MlbLiveGame>): MlbLiveGame {
  return {
    gamePk: 900001,
    awayAbbrev: "TB",
    homeAbbrev: "BOS",
    startUtc: G1_START_UTC,
    doubleHeader: "S",
    gameNumber: 1,
    awayRuns: null,
    homeRuns: null,
    gameStatus: "upcoming",
    gameClock: null,
    awayProbablePitcher: null,
    homeProbablePitcher: null,
    winningPitcher: null,
    losingPitcher: null,
    rawAbstractState: "Preview",
    rawDetailedState: "Scheduled",
    totalInnings: null,
    awayF5Runs: null,
    homeF5Runs: null,
    nrfiResult: null,
    ...overrides,
  };
}

function dbRow(overrides: Partial<MatchableDbGame>): MatchableDbGame {
  return {
    id: 1,
    awayTeam: "TB",
    homeTeam: "BOS",
    mlbGamePk: null,
    gameNumber: 1,
    startTimeEst: "7:10 PM",
    ...overrides,
  };
}

const apiG1 = () => liveGame({ gamePk: G1_GAMEPK, gameNumber: 1, startUtc: G1_START_UTC, gameStatus: "live" });
const apiG2 = () => liveGame({ gamePk: G2_GAMEPK, gameNumber: 2, startUtc: G2_START_UTC });

describe("matchMlbLiveGamesToDbRows — doubleheader safety", () => {
  it("matches both DH games to their own rows via gamePk (canonical identity)", () => {
    const rows = [
      dbRow({ id: 11, mlbGamePk: G1_GAMEPK, gameNumber: 1, startTimeEst: "1:35 PM" }),
      dbRow({ id: 12, mlbGamePk: G2_GAMEPK, gameNumber: 2, startTimeEst: "7:10 PM" }),
    ];
    const { matches } = matchMlbLiveGamesToDbRows([apiG1(), apiG2()], rows);
    expect(matches[0].dbGame?.id).toBe(11);
    expect(matches[0].matchMethod).toBe("gamePk");
    expect(matches[1].dbGame?.id).toBe(12);
    expect(matches[1].matchMethod).toBe("gamePk");
  });

  it("never lets two API games claim the same DB row (incident regression)", () => {
    // Pre-fix defect shape: one DB row for the matchup, two API games.
    const rows = [dbRow({ id: 21, mlbGamePk: null, startTimeEst: "7:10 PM" })];
    const { matches, warnings } = matchMlbLiveGamesToDbRows([apiG1(), apiG2()], rows);
    const matched = matches.filter(m => m.dbGame !== null);
    expect(matched).toHaveLength(1);
    // The 7:10 row belongs to the 7:10 game — NOT to whichever came first.
    expect(matched[0].apiGame.gamePk).toBe(G2_GAMEPK);
    // The other game is reported missing, not silently merged.
    const missing = matches.find(m => m.dbGame === null);
    expect(missing?.apiGame.gamePk).toBe(G1_GAMEPK);
    expect(warnings.some(w => w.includes("no DB row"))).toBe(true);
  });

  it("disambiguates legacy DH rows (no gamePk) by gameNumber", () => {
    const rows = [
      dbRow({ id: 31, gameNumber: 1, startTimeEst: "TBD" }),
      dbRow({ id: 32, gameNumber: 2, startTimeEst: "TBD" }),
    ];
    const { matches } = matchMlbLiveGamesToDbRows([apiG2(), apiG1()], rows);
    const byPk = new Map(matches.map(m => [m.apiGame.gamePk, m]));
    expect(byPk.get(G1_GAMEPK)?.dbGame?.id).toBe(31);
    expect(byPk.get(G1_GAMEPK)?.matchMethod).toBe("teams+gameNumber");
    expect(byPk.get(G2_GAMEPK)?.dbGame?.id).toBe(32);
  });

  it("disambiguates legacy DH rows (default gameNumber=1 on both) by closest start time", () => {
    // Both rows still carry the schema default gameNumber=1 — the pre-sync
    // legacy state. Times must decide, regardless of API order.
    const rows = [
      dbRow({ id: 41, gameNumber: 1, startTimeEst: "7:10 PM" }),
      dbRow({ id: 42, gameNumber: 1, startTimeEst: "1:35 PM" }),
    ];
    const { matches, warnings } = matchMlbLiveGamesToDbRows([apiG2(), apiG1()], rows);
    const byPk = new Map(matches.map(m => [m.apiGame.gamePk, m]));
    expect(byPk.get(G1_GAMEPK)?.dbGame?.id).toBe(42);
    expect(byPk.get(G2_GAMEPK)?.dbGame?.id).toBe(41);
    expect(warnings.some(w => w.includes("doubleheader fallback match"))).toBe(true);
  });

  it("single game with team fallback still matches (non-DH behavior unchanged)", () => {
    const rows = [dbRow({ id: 51, awayTeam: "NYY", homeTeam: "DET", startTimeEst: "6:40 PM" })];
    const api = liveGame({
      gamePk: 900201, awayAbbrev: "NYY", homeAbbrev: "DET",
      doubleHeader: "N", startUtc: "2026-07-17T22:40:00Z",
    });
    const { matches, warnings } = matchMlbLiveGamesToDbRows([api], rows);
    expect(matches[0].dbGame?.id).toBe(51);
    expect(warnings.filter(w => w.includes("doubleheader"))).toHaveLength(0);
  });

  it("reports duplicate mlbGamePk rows instead of guessing", () => {
    const rows = [
      dbRow({ id: 61, mlbGamePk: G1_GAMEPK }),
      dbRow({ id: 62, mlbGamePk: G1_GAMEPK }),
    ];
    const { warnings } = matchMlbLiveGamesToDbRows([apiG1()], rows);
    expect(warnings.some(w => w.includes("share mlbGamePk"))).toBe(true);
  });

  it("API order does not change the assignment (order independence)", () => {
    const rows = [
      dbRow({ id: 71, gameNumber: 1, startTimeEst: "1:35 PM" }),
      dbRow({ id: 72, gameNumber: 2, startTimeEst: "7:10 PM" }),
    ];
    const forward = matchMlbLiveGamesToDbRows([apiG1(), apiG2()], rows).matches;
    const reverse = matchMlbLiveGamesToDbRows([apiG2(), apiG1()], rows).matches;
    const pick = (ms: typeof forward, pk: number) => ms.find(m => m.apiGame.gamePk === pk)?.dbGame?.id;
    expect(pick(forward, G1_GAMEPK)).toBe(pick(reverse, G1_GAMEPK));
    expect(pick(forward, G2_GAMEPK)).toBe(pick(reverse, G2_GAMEPK));
  });
});
