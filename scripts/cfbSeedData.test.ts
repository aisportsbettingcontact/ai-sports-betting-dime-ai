import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(__dirname, "data", "cfb-2026");
const teams = JSON.parse(readFileSync(join(DIR, "teams.json"), "utf8"));
const games = JSON.parse(readFileSync(join(DIR, "games.json"), "utf8"));
const players = JSON.parse(readFileSync(join(DIR, "players.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(DIR, "manifest.json"), "utf8"));

describe("cfb-2026 seed data integrity", () => {
  it("matches the verified golden counts", () => {
    expect(teams).toHaveLength(138);
    expect(games).toHaveLength(902);
    expect(players).toHaveLength(14933);
    expect(manifest.counts).toEqual({ teams: 138, games: 902, players: 14933 });
  });
  it("has unique primary keys everywhere", () => {
    expect(new Set(teams.map((t: any) => t.espnId)).size).toBe(138);
    expect(new Set(games.map((g: any) => g.gameId)).size).toBe(902);
    expect(new Set(players.map((p: any) => p.athleteId)).size).toBe(14933);
  });
  it("per-week game counts equal the verified vector", () => {
    const vector = [8, 91, 86, 75, 71, 59, 58, 62, 56, 56, 63, 67, 70, 69, 10, 1];
    const byWeek = new Map<number, number>();
    for (const g of games) byWeek.set(g.week, (byWeek.get(g.week) ?? 0) + 1);
    expect(vector.map((_, w) => byWeek.get(w) ?? 0)).toEqual(vector);
  });
  it("every player belongs to a known team, and roster counts agree", () => {
    const ids = new Set(teams.map((t: any) => t.espnId));
    const perTeam = new Map<number, number>();
    for (const p of players) {
      expect(ids.has(p.teamEspnId)).toBe(true);
      perTeam.set(p.teamEspnId, (perTeam.get(p.teamEspnId) ?? 0) + 1);
    }
    for (const t of teams) expect(perTeam.get(t.espnId)).toBe(t.rosterCount);
  });
  it("every game espnId reference is a known team; week-14 games are placeholders", () => {
    const ids = new Set(teams.map((t: any) => t.espnId));
    for (const g of games) {
      if (g.awayEspnId !== null) expect(ids.has(g.awayEspnId)).toBe(true);
      if (g.homeEspnId !== null) expect(ids.has(g.homeEspnId)).toBe(true);
      expect(g.isPlaceholder).toBe(g.week === 14);
    }
  });
  it("only Sun Belt teams carry a division", () => {
    for (const t of teams) {
      if (t.division !== null) expect(t.conference).toContain("Sun Belt");
    }
    expect(teams.filter((t: any) => t.division === "East")).toHaveLength(7);
    expect(teams.filter((t: any) => t.division === "West")).toHaveLength(7);
  });
});
