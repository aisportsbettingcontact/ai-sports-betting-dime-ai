import { describe, expect, it } from "vitest";
import {
  buildMlbLineupPayload,
  combineRotowireLineupSlates,
  lineupTimeToMinutes,
  matchRotowireLineupsToDbRows,
  parseLineupHtml,
  rotowireDateInEastern,
  type MatchableLineupDbGame,
  type RotoLineupGame,
} from "./rotowireLineupScraper";

function lineupGame(
  startTime: string,
  awayPitcherName = "Away Starter",
  homePitcherName = "Home Starter",
): RotoLineupGame {
  return {
    awayAbbrev: "TB",
    homeAbbrev: "BOS",
    startTime,
    awayPitcher: {
      name: awayPitcherName,
      hand: "R",
      era: "4-2 · 3.10 ERA",
      rotowireId: 101,
      confirmed: false,
    },
    homePitcher: {
      name: homePitcherName,
      hand: "L",
      era: "5-1 · 2.80 ERA",
      rotowireId: 202,
      confirmed: true,
    },
    awayLineupConfirmed: false,
    homeLineupConfirmed: true,
    awayLineup: [],
    homeLineup: [],
    weather: null,
    umpire: null,
  };
}

function dbGame(overrides: Partial<MatchableLineupDbGame>): MatchableLineupDbGame {
  return {
    id: 1,
    awayTeam: "TB",
    homeTeam: "BOS",
    startTimeEst: "TBD",
    gameNumber: 1,
    mlbGamePk: null,
    ...overrides,
  };
}

describe("Rotowire lineup event matching", () => {
  it("parses Rotowire and DB Eastern-time labels", () => {
    expect(lineupTimeToMinutes("1:35 PM ET")).toBe(13 * 60 + 35);
    expect(lineupTimeToMinutes("1:35 PM EST")).toBe(13 * 60 + 35);
    expect(lineupTimeToMinutes("1:35 PM EDT")).toBe(13 * 60 + 35);
    expect(lineupTimeToMinutes("7:10 PM")).toBe(19 * 60 + 10);
    expect(lineupTimeToMinutes("12:00 AM ET")).toBe(0);
    expect(lineupTimeToMinutes("12:00 PM ET")).toBe(12 * 60);
    expect(lineupTimeToMinutes("13:00 PM ET")).toBeNull();
    expect(lineupTimeToMinutes("7:99 PM ET")).toBeNull();
    expect(lineupTimeToMinutes("TBD")).toBeNull();
  });

  it("derives Rotowire date scopes in Eastern Time, including after 9 PM Pacific", () => {
    const afterNinePacific = new Date("2026-07-24T04:30:00Z");
    expect(rotowireDateInEastern(afterNinePacific)).toBe("2026-07-24");
    expect(rotowireDateInEastern(afterNinePacific, 1)).toBe("2026-07-25");

    const fallBackDay = new Date("2026-11-01T05:30:00Z");
    expect(rotowireDateInEastern(fallBackDay, 1)).toBe("2026-11-02");
  });

  it("aligns a full doubleheader to distinct gameNumbers regardless of input order", () => {
    const early = lineupGame("1:35 PM ET", "Early Away", "Early Home");
    const late = lineupGame("7:10 PM ET", "Late Away", "Late Home");
    const rows = [
      dbGame({ id: 12, gameNumber: 2, mlbGamePk: 800002 }),
      dbGame({ id: 11, gameNumber: 1, mlbGamePk: 800001 }),
    ];

    const { matches } = matchRotowireLineupsToDbRows([late, early], rows);
    expect(matches.find(match => match.lineupGame === early)?.dbGame?.id).toBe(11);
    expect(matches.find(match => match.lineupGame === late)?.dbGame?.id).toBe(12);
    expect(matches.every(match => match.matchMethod === "teams+gameNumber")).toBe(true);
    expect(new Set(matches.map(match => match.dbGame?.id)).size).toBe(2);
  });

  it("uses closest first-pitch time for legacy rows with duplicate default gameNumbers", () => {
    const early = lineupGame("1:35 PM ET", "Early Away", "Early Home");
    const late = lineupGame("7:10 PM ET", "Late Away", "Late Home");
    const rows = [
      dbGame({ id: 22, gameNumber: 1, startTimeEst: "7:10 PM" }),
      dbGame({ id: 21, gameNumber: 1, startTimeEst: "1:35 PM" }),
    ];

    const { matches } = matchRotowireLineupsToDbRows([late, early], rows);
    expect(matches.find(match => match.lineupGame === early)?.dbGame?.id).toBe(21);
    expect(matches.find(match => match.lineupGame === late)?.dbGame?.id).toBe(22);
    expect(matches.every(match => match.matchMethod === "teams+time")).toBe(true);
  });

  it("never lets two Rotowire cards claim one DB event", () => {
    const early = lineupGame("1:35 PM ET", "Early Away", "Early Home");
    const late = lineupGame("7:10 PM ET", "Late Away", "Late Home");
    const { matches, warnings } = matchRotowireLineupsToDbRows(
      [early, late],
      [dbGame({ id: 31, gameNumber: 2, startTimeEst: "7:10 PM" })],
    );

    const claimed = matches.filter(match => match.dbGame);
    expect(claimed).toHaveLength(1);
    expect(claimed[0].lineupGame).toBe(late);
    expect(matches.find(match => match.lineupGame === early)?.dbGame).toBeNull();
    expect(warnings.some(warning => warning.includes("no unclaimed DB event"))).toBe(true);
  });

  it("uses time rather than assuming a lone doubleheader card is game one", () => {
    const late = lineupGame("7:10 PM ET", "Late Away", "Late Home");
    const rows = [
      dbGame({ id: 41, gameNumber: 1, startTimeEst: "1:35 PM" }),
      dbGame({ id: 42, gameNumber: 2, startTimeEst: "7:10 PM" }),
    ];

    const { matches } = matchRotowireLineupsToDbRows([late], rows);
    expect(matches[0].dbGame?.id).toBe(42);
    expect(matches[0].matchMethod).toBe("teams+time");
  });

  it("skips an ambiguous doubleheader instead of assigning TBD cards arbitrarily", () => {
    const first = lineupGame("TBD", "First Away", "First Home");
    const second = lineupGame("TBD", "Second Away", "Second Home");
    const rows = [
      dbGame({ id: 51, gameNumber: 1, startTimeEst: "TBD" }),
      dbGame({ id: 52, gameNumber: 2, startTimeEst: "TBD" }),
    ];

    const { matches, warnings } = matchRotowireLineupsToDbRows([first, second], rows);
    expect(matches.every(match => match.dbGame === null)).toBe(true);
    expect(warnings.some(warning => warning.includes("2 Rotowire card(s)"))).toBe(true);
  });

  it("skips duplicate Rotowire times instead of using pitcher identity as an order", () => {
    const first = lineupGame("1:35 PM ET", "First Away", "First Home");
    const second = lineupGame("1:35 PM ET", "Second Away", "Second Home");
    const rows = [
      dbGame({ id: 71, gameNumber: 1, startTimeEst: "1:35 PM" }),
      dbGame({ id: 72, gameNumber: 2, startTimeEst: "7:10 PM" }),
    ];

    const { matches } = matchRotowireLineupsToDbRows([first, second], rows);
    expect(matches.every(match => match.dbGame === null)).toBe(true);
  });

  it("skips a lone card that is equally close to both doubleheader rows", () => {
    const middle = lineupGame("4:00 PM ET");
    const rows = [
      dbGame({ id: 81, gameNumber: 1, startTimeEst: "3:00 PM" }),
      dbGame({ id: 82, gameNumber: 2, startTimeEst: "5:00 PM" }),
    ];

    const { matches } = matchRotowireLineupsToDbRows([middle], rows);
    expect(matches[0].dbGame).toBeNull();
  });

  it("skips a lone card when every doubleheader row is implausibly far away", () => {
    const late = lineupGame("10:30 PM ET");
    const rows = [
      dbGame({ id: 91, gameNumber: 1, startTimeEst: "1:00 PM" }),
      dbGame({ id: 92, gameNumber: 2, startTimeEst: "7:00 PM" }),
    ];

    const { matches } = matchRotowireLineupsToDbRows([late], rows);
    expect(matches[0].dbGame).toBeNull();
  });

  it("preserves an ordinary single-game match when both start times are TBD", () => {
    const game = lineupGame("TBD");
    const { matches } = matchRotowireLineupsToDbRows(
      [game],
      [dbGame({ id: 61, startTimeEst: "TBD" })],
    );

    expect(matches[0].dbGame?.id).toBe(61);
    expect(matches[0].matchMethod).toBe("teams");
  });

  it("preserves both cards in a same-day doubleheader when combining slates", () => {
    const early = lineupGame("1:35 PM ET", "Early Away", "Early Home");
    const late = lineupGame("7:10 PM ET", "Late Away", "Late Home");
    const duplicateTomorrowCard = lineupGame("7:10 PM ET", "Late Away", "Late Home");
    const otherTomorrowGame = {
      ...lineupGame("8:10 PM ET"),
      awayAbbrev: "NYY",
      homeAbbrev: "DET",
    };

    const combined = combineRotowireLineupSlates(
      [early, late],
      [duplicateTomorrowCard, otherTomorrowGame],
    );
    expect(combined).toEqual([early, late, duplicateTomorrowCard, otherTomorrowGame]);
  });
});

describe("Rotowire pitcher metadata integrity", () => {
  it("keeps omitted W-L/ERA and throwing hand null instead of fabricating values", () => {
    const html = `
      <div class="lineup is-mlb">
        <div class="lineup__time">7:10 PM ET</div>
        <div class="lineup__abbr">TB</div>
        <div class="lineup__abbr">BOS</div>
        <div class="lineup__list is-visit">
          <div class="lineup__player-highlight">
            <a title="Away Starter" href="/baseball/player/away-starter-101">A. Starter</a>
          </div>
          <div class="lineup__status">Expected Lineup</div>
        </div>
        <div class="lineup__list is-home">
          <div class="lineup__player-highlight">
            <a title="Home Starter" href="/baseball/player/home-starter-202">H. Starter</a>
          </div>
          <div class="lineup__status">Confirmed Lineup</div>
        </div>
      </div>
    `;

    const parsed = parseLineupHtml(html, "today", "[test]");
    expect(parsed.games).toHaveLength(1);
    expect(parsed.games[0].awayPitcher).toMatchObject({ hand: null, era: null });
    expect(parsed.games[0].homePitcher).toMatchObject({ hand: null, era: null });

    const payload = buildMlbLineupPayload(parsed.games[0], 77, 123456, () => null);
    expect(payload.awayPitcherHand).toBeNull();
    expect(payload.awayPitcherEra).toBeNull();
    expect(payload.homePitcherHand).toBeNull();
    expect(payload.homePitcherEra).toBeNull();
  });

  it("normalizes genuine Rotowire stats without inventing missing fields", () => {
    const game = lineupGame("7:10 PM ET");
    game.awayPitcher = { ...game.awayPitcher!, era: null, hand: null };
    const payload = buildMlbLineupPayload(game, 88, 654321, () => null);
    expect(payload.awayPitcherEra).toBeNull();
    expect(payload.awayPitcherHand).toBeNull();
    expect(payload.homePitcherEra).toBe("5-1 · 2.80 ERA");
  });
});

describe("Rotowire player identity and lineup status", () => {
  it("recovers abbreviated pitcher and batter names from slugs and maps status classes end to end", () => {
    const html = `
      <div class="lineup is-mlb">
        <div class="lineup__time">6:45 PM ET</div>
        <div class="lineup__abbr">TB</div>
        <div class="lineup__abbr">BOS</div>

        <div class="lineup__list is-visit">
          <div class="lineup__player-highlight">
            <a href="/baseball/player/eduardo-rodriguez-12783">E. Rodriguez</a>
            <span class="lineup__throws">LHP</span>
            <span class="lineup__player-highlight-stats">8-3 2.62 ERA</span>
          </div>
          <li class="lineup__status is-expected">
            <div class="dot is-medium is-yellow"></div>Expected Lineup
          </li>
          <div class="lineup__player">
            <span class="lineup__pos">RF</span>
            <a href="/baseball/player/ronald-acuna-jr-14106">R. Acuña Jr.</a>
            <span class="lineup__bats">R</span>
          </div>
          <div class="lineup__player">
            <span class="lineup__pos">LF</span>
            <a title="Tyler O'Neill" href="/baseball/player/tyler-oneill-11620">Tyler O'Neill</a>
            <span class="lineup__bats">R</span>
          </div>
        </div>

        <div class="lineup__list is-home">
          <div class="lineup__player-highlight">
            <a href="/baseball/player/zack-littell-13788">Z. Littell</a>
            <span class="lineup__throws">RHP</span>
            <span class="lineup__player-highlight-stats">7-7 5.34 ERA</span>
          </div>
          <li class="lineup__status is-confirmed">
            <div class="dot is-medium is-green"></div>Confirmed Lineup
          </li>
          <div class="lineup__player">
            <span class="lineup__pos">CF</span>
            <a href="/baseball/player/lars-nootbaar-14358">L. Nootbaar</a>
            <span class="lineup__bats">L</span>
          </div>
          <div class="lineup__player">
            <span class="lineup__pos">DH</span>
            <a href="/baseball/player.php?id=777">F. Fallback</a>
            <span class="lineup__bats">S</span>
          </div>
        </div>
      </div>
    `;

    const parsed = parseLineupHtml(html, "today", "[identity-test]");
    expect(parsed.games).toHaveLength(1);
    const game = parsed.games[0];

    expect(game.awayPitcher).toMatchObject({
      name: "Eduardo Rodriguez",
      rotowireId: 12783,
      confirmed: false,
    });
    expect(game.homePitcher).toMatchObject({
      name: "Zack Littell",
      rotowireId: 13788,
      confirmed: true,
    });
    expect(game.awayLineup.map((player) => [player.name, player.rotowireId])).toEqual([
      ["Ronald Acuña Jr.", 14106],
      ["Tyler O'Neill", 11620],
    ]);
    expect(game.homeLineup.map((player) => [player.name, player.rotowireId])).toEqual([
      ["Lars Nootbaar", 14358],
      ["F. Fallback", 777],
    ]);
    expect({
      awayPitcherConfirmed: game.awayPitcher?.confirmed,
      homePitcherConfirmed: game.homePitcher?.confirmed,
      awayLineupConfirmed: game.awayLineupConfirmed,
      homeLineupConfirmed: game.homeLineupConfirmed,
    }).toEqual({
      awayPitcherConfirmed: false,
      homePitcherConfirmed: true,
      awayLineupConfirmed: false,
      homeLineupConfirmed: true,
    });

    const mlbamByName = new Map([
      ["Eduardo Rodriguez", 593958],
      ["Zack Littell", 641793],
      ["Ronald Acuña Jr.", 660670],
      ["Tyler O'Neill", 641933],
      ["Lars Nootbaar", 663457],
    ]);
    const payload = buildMlbLineupPayload(
      game,
      901,
      123456,
      (name) => (name ? (mlbamByName.get(name) ?? null) : null),
    );
    expect(payload).toMatchObject({
      awayPitcherName: "Eduardo Rodriguez",
      awayPitcherRotowireId: 12783,
      awayPitcherMlbamId: 593958,
      awayPitcherConfirmed: false,
      homePitcherName: "Zack Littell",
      homePitcherMlbamId: 641793,
      homePitcherConfirmed: true,
      awayLineupConfirmed: false,
      homeLineupConfirmed: true,
    });
    expect(JSON.parse(payload.awayLineup ?? "[]")[0]).toMatchObject({
      name: "Ronald Acuña Jr.",
      mlbamId: 660670,
    });
  });

  it("treats the status class as authoritative when nested text is stale", () => {
    const html = `
      <div class="lineup is-mlb">
        <div class="lineup__abbr">TB</div>
        <div class="lineup__abbr">BOS</div>
        <div class="lineup__list is-visit">
          <li class="lineup__status is-expected">Confirmed Lineup</li>
        </div>
        <div class="lineup__list is-home">
          <li class="lineup__status is-confirmed">Expected Lineup</li>
        </div>
      </div>
    `;

    const game = parseLineupHtml(html, "today", "[status-class-test]").games[0];
    expect(game.awayLineupConfirmed).toBe(false);
    expect(game.homeLineupConfirmed).toBe(true);
  });
});
