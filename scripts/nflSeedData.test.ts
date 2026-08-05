import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(__dirname, "data", "nfl-2026");
const venues = JSON.parse(readFileSync(join(DIR, "venues.json"), "utf8"));
const teams = JSON.parse(readFileSync(join(DIR, "teams.json"), "utf8"));
const games = JSON.parse(readFileSync(join(DIR, "games.json"), "utf8"));
const players = JSON.parse(readFileSync(join(DIR, "players.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(DIR, "manifest.json"), "utf8"));

describe("nfl-2026 seed data integrity", () => {
  it("matches the verified golden counts", () => {
    expect(venues).toHaveLength(38);
    expect(teams).toHaveLength(32);
    expect(games).toHaveLength(285);
    expect(players).toHaveLength(2929);
    expect(manifest.counts).toEqual({
      venues: 38,
      teams: 32,
      games: 285,
      players: 2929,
    });
  });

  it("has unique primary keys everywhere", () => {
    expect(new Set(venues.map((v: any) => v.venueId)).size).toBe(38);
    expect(new Set(teams.map((t: any) => t.espnId)).size).toBe(32);
    expect(new Set(games.map((g: any) => g.eventId)).size).toBe(285);
    expect(new Set(players.map((p: any) => p.athleteId)).size).toBe(2929);
  });

  it("regular-season census: every one of the 32 teams appears in exactly 17 seasonType-2 games", () => {
    const regular = games.filter((g: any) => g.seasonType === 2);
    expect(regular).toHaveLength(272);
    const census = new Map<number, number>();
    for (const g of regular) {
      census.set(g.awayEspnId, (census.get(g.awayEspnId) ?? 0) + 1);
      census.set(g.homeEspnId, (census.get(g.homeEspnId) ?? 0) + 1);
    }
    expect(census.size).toBe(32);
    for (const t of teams) expect(census.get(t.espnId)).toBe(17);
  });

  it("per-week seasonType-2 counts equal the verified vector (weeks 1-18, sum 272)", () => {
    const vector = [
      16, 16, 16, 16, 15, 14, 14, 14, 15, 14, 13, 16, 14, 15, 16, 16, 16, 16,
    ];
    const regular = games.filter((g: any) => g.seasonType === 2);
    const byWeek = new Map<number, number>();
    for (const g of regular) byWeek.set(g.week, (byWeek.get(g.week) ?? 0) + 1);
    expect(vector.map((_, i) => byWeek.get(i + 1) ?? 0)).toEqual(vector);
    expect(vector.reduce((a, b) => a + b, 0)).toBe(272);
  });

  it("postseason counts by week match 6/4/2/1 (wild card/divisional/conference/Super Bowl)", () => {
    const post = games.filter((g: any) => g.seasonType === 3);
    expect(post).toHaveLength(13);
    const byWeek = new Map<number, number>();
    for (const g of post) byWeek.set(g.week, (byWeek.get(g.week) ?? 0) + 1);
    expect(Object.fromEntries(byWeek)).toEqual({ 1: 6, 2: 4, 3: 2, 5: 1 });
  });

  it("every player's teamEspnId is a known team", () => {
    const ids = new Set(teams.map((t: any) => t.espnId));
    for (const p of players) expect(ids.has(p.teamEspnId)).toBe(true);
  });

  it("every non-null game away/home espnId is a known team", () => {
    const ids = new Set(teams.map((t: any) => t.espnId));
    for (const g of games) {
      if (g.awayEspnId !== null) expect(ids.has(g.awayEspnId)).toBe(true);
      if (g.homeEspnId !== null) expect(ids.has(g.homeEspnId)).toBe(true);
    }
  });

  it("every team venueId, and every non-null game venueId, is a known venue", () => {
    const ids = new Set(venues.map((v: any) => v.venueId));
    for (const t of teams) expect(ids.has(t.venueId)).toBe(true);
    for (const g of games)
      if (g.venueId !== null) expect(ids.has(g.venueId)).toBe(true);
  });

  it("exactly 12 games have a null venueId, all seasonType 3 and week != 5 (NE6)", () => {
    const nullVenue = games.filter((g: any) => g.venueId === null);
    expect(nullVenue).toHaveLength(12);
    for (const g of nullVenue) {
      expect(g.seasonType).toBe(3);
      expect(g.week).not.toBe(5);
    }
  });

  it("exactly 24 regular-season games have a null broadcast, all in weeks 16-18 (NE1)", () => {
    const nullBroadcast = games.filter(
      (g: any) => g.seasonType === 2 && g.broadcast === null
    );
    expect(nullBroadcast).toHaveLength(24);
    const byWeek = new Map<number, number>();
    for (const g of nullBroadcast)
      byWeek.set(g.week, (byWeek.get(g.week) ?? 0) + 1);
    expect(Object.fromEntries(byWeek)).toEqual({ 16: 4, 17: 4, 18: 16 });
  });

  it("isTbd is set iff seasonType is postseason, and TBD rows carry null team ids and awayTeam==='TBD' (NE2)", () => {
    for (const g of games) expect(g.isTbd).toBe(g.seasonType === 3);
    const tbdRows = games.filter((g: any) => g.isTbd);
    expect(tbdRows).toHaveLength(13);
    for (const g of tbdRows) {
      expect(g.awayEspnId).toBeNull();
      expect(g.homeEspnId).toBeNull();
      expect(g.awayTeam).toBe("TBD");
    }
  });

  it("conference split is 16/16 across 8 divisions of 4 teams each", () => {
    expect(teams.filter((t: any) => t.conference === "AFC")).toHaveLength(16);
    expect(teams.filter((t: any) => t.conference === "NFC")).toHaveLength(16);
    const byDivision = new Map<string, number>();
    for (const t of teams)
      byDivision.set(t.division, (byDivision.get(t.division) ?? 0) + 1);
    expect(byDivision.size).toBe(8);
    for (const count of byDivision.values()) expect(count).toBe(4);
  });

  it("teams resolve to exactly 30 distinct venues, with SoFi (7065) and MetLife (3839) shared (NE4)", () => {
    expect(new Set(teams.map((t: any) => t.venueId)).size).toBe(30);
    const byVenue = new Map<number, number>();
    for (const t of teams)
      byVenue.set(t.venueId, (byVenue.get(t.venueId) ?? 0) + 1);
    expect(byVenue.get(7065)).toBe(2);
    expect(byVenue.get(3839)).toBe(2);
  });
});
