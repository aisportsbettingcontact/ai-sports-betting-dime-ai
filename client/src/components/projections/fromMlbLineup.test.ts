import { describe, expect, it } from "vitest";
import {
  mlbLineupToProjectionPregame,
  parseRotowireBattingOrder,
} from "./fromMlbLineup";

describe("parseRotowireBattingOrder", () => {
  it("validates, sorts, and caps scraper JSON at the nine batting slots", () => {
    const rows = Array.from({ length: 11 }, (_, index) => ({
      battingOrder: 11 - index,
      position: index % 2 ? "RF" : "CF",
      name: `Player ${11 - index}`,
      bats: "R",
      rotowireId: 1000 + index,
      mlbamId: 2000 + index,
    }));
    rows.push({ battingOrder: 3, position: "SS", name: "", bats: "L", rotowireId: 1, mlbamId: 2 });

    const parsed = parseRotowireBattingOrder(JSON.stringify(rows));
    expect(parsed).toHaveLength(9);
    expect(parsed.map((player) => player.battingOrder)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(parsed.every((player) => player.name.length > 0)).toBe(true);
  });

  it("returns an empty order for malformed or non-array payloads", () => {
    expect(parseRotowireBattingOrder("{not-json")).toEqual([]);
    expect(parseRotowireBattingOrder(JSON.stringify({ battingOrder: 1 }))).toEqual([]);
    expect(parseRotowireBattingOrder(null)).toEqual([]);
  });
});

describe("mlbLineupToProjectionPregame", () => {
  it("maps expected/confirmed starters, season lines, and lineup state", () => {
    const result = mlbLineupToProjectionPregame({
      scrapedAt: 1_721_740_000_000,
      awayPitcherName: "Logan Webb",
      awayPitcherHand: "R",
      awayPitcherEra: "7-4 · 3.21 ERA",
      awayPitcherRotowireId: 14222,
      awayPitcherMlbamId: 657277,
      awayPitcherConfirmed: true,
      homePitcherName: "George Kirby",
      homePitcherHand: "R",
      homePitcherEra: "8-5 · 3.62 ERA",
      homePitcherConfirmed: false,
      awayLineup: JSON.stringify([
        { battingOrder: 1, position: "CF", name: "Jung Hoo Lee", bats: "L", rotowireId: 1, mlbamId: 808982 },
      ]),
      awayLineupConfirmed: true,
      homeLineup: "[]",
      homeLineupConfirmed: false,
    });

    expect(result.away.pitcher).toMatchObject({
      name: "Logan Webb",
      hand: "R",
      seasonStats: "7-4 · 3.21 ERA",
      confirmed: true,
    });
    expect(result.home.pitcher.confirmed).toBe(false);
    expect(result.away.confirmed).toBe(true);
    expect(result.away.battingOrder[0].name).toBe("Jung Hoo Lee");
    expect(result.home.battingOrder).toEqual([]);
  });

  it("returns a stable pending shape before Rotowire posts the game", () => {
    const result = mlbLineupToProjectionPregame(undefined);
    expect(result.source).toBe("Rotowire");
    expect(result.scrapedAt).toBeNull();
    expect(result.away.pitcher.name).toBeNull();
    expect(result.home.pitcher.name).toBeNull();
    expect(result.away.battingOrder).toEqual([]);
    expect(result.home.battingOrder).toEqual([]);
  });
});
