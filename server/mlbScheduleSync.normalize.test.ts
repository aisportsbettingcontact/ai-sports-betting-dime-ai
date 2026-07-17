/**
 * mlbScheduleSync.normalize.test.ts — Provider-adapter boundary tests.
 *
 * Verifies that raw statsapi.mlb.com schedule payloads (the authoritative
 * provider shape: gamePk, officialDate, doubleHeader, gameNumber,
 * rescheduledFrom, status, team ids) normalize into canonical events without
 * losing doubleheader siblings, and that per-event rejections carry reasons.
 *
 * Payload shape mirrors statsapi exactly; gamePks are SYNTHETIC (live capture
 * was network-blocked in the remediation environment).
 */
import { describe, it, expect } from "vitest";
import { normalizeRawScheduleGame } from "./mlbScheduleSync";
import { planMlbScheduleSync } from "./mlbEventIdentity";
import { BOS_TEAM_ID, TB_TEAM_ID } from "./mlbDoubleheaderFixtures";

/** Raw statsapi-shaped schedule entry for the 2026-07-17 TB@BOS split DH. */
function rawG1() {
  return {
    gamePk: 900101,
    gameType: "R",
    gameDate: "2026-07-17T17:35:00Z",
    officialDate: "2026-07-17",
    rescheduledFrom: "2026-05-09T20:10:00Z",
    doubleHeader: "S",
    gameNumber: 1,
    seriesGameNumber: 1,
    dayNight: "day",
    scheduledInnings: 9,
    status: { abstractGameState: "Preview", detailedState: "Scheduled" },
    teams: {
      away: { team: { id: TB_TEAM_ID, name: "Tampa Bay Rays" } },
      home: { team: { id: BOS_TEAM_ID, name: "Boston Red Sox" } },
    },
    venue: { id: 3, name: "Fenway Park" },
  };
}

function rawG2() {
  const g = rawG1();
  return {
    ...g,
    gamePk: 900102,
    gameDate: "2026-07-17T23:10:00Z",
    rescheduledFrom: undefined,
    gameNumber: 2,
    seriesGameNumber: 2,
    dayNight: "night",
  };
}

describe("normalizeRawScheduleGame (provider adapter)", () => {
  it("normalizes both doubleheader games with full identity + DH metadata", () => {
    const r1 = normalizeRawScheduleGame(rawG1());
    const r2 = normalizeRawScheduleGame(rawG2());
    expect("event" in r1 && "event" in r2).toBe(true);
    if ("event" in r1 && "event" in r2) {
      expect(r1.event.gamePk).toBe(900101);
      expect(r1.event.awayAbbrev).toBe("TB");
      expect(r1.event.homeAbbrev).toBe("BOS");
      expect(r1.event.doubleHeader).toBe("S");
      expect(r1.event.gameNumber).toBe(1);
      expect(r1.event.rescheduledFrom).toBe("2026-05-09"); // ISO timestamp truncated to date
      expect(r1.event.venueName).toBe("Fenway Park");
      expect(r2.event.gamePk).toBe(900102);
      expect(r2.event.gameNumber).toBe(2);
      expect(r2.event.rescheduledFrom).toBeUndefined();
    }
  });

  it("rejects non-feed game types with a reason (spring/exhibition/All-Star)", () => {
    for (const gameType of ["S", "E", "A"]) {
      const r = normalizeRawScheduleGame({ ...rawG1(), gameType });
      expect("rejection" in r).toBe(true);
      if ("rejection" in r) {
        expect(r.rejection.gamePk).toBe(900101);
        expect(r.rejection.reason).toContain("gameType");
      }
    }
  });

  it("rejects unknown team ids individually without affecting siblings", () => {
    const bad = { ...rawG1(), teams: { away: { team: { id: 99999, name: "Mystery Nine" } }, home: rawG1().teams.home } };
    const r = normalizeRawScheduleGame(bad);
    expect("rejection" in r).toBe(true);
    const sibling = normalizeRawScheduleGame(rawG2());
    expect("event" in sibling).toBe(true);
  });

  it("rejects a missing gamePk (identity is mandatory, never inferred)", () => {
    const r = normalizeRawScheduleGame({ ...rawG1(), gamePk: undefined as unknown as number });
    expect("rejection" in r).toBe(true);
    if ("rejection" in r) expect(r.rejection.reason).toContain("gamePk");
  });

  it("falls back to the ET date (not the UTC calendar date) when officialDate is absent", () => {
    // 10:10 PM ET on 2026-07-17 = 02:10 UTC on 2026-07-18
    const late = { ...rawG2(), officialDate: undefined, gameDate: "2026-07-18T02:10:00Z" };
    const r = normalizeRawScheduleGame(late);
    expect("event" in r).toBe(true);
    if ("event" in r) expect(r.event.officialDate).toBe("2026-07-17");
  });

  it("end-to-end: raw payload → normalize → plan preserves both events (any order)", () => {
    for (const payload of [[rawG1(), rawG2()], [rawG2(), rawG1()]]) {
      const events = payload
        .map(normalizeRawScheduleGame)
        .flatMap(r => ("event" in r ? [r.event] : []));
      expect(events).toHaveLength(2);
      const plan = planMlbScheduleSync(events, []);
      expect(plan.inserts).toHaveLength(2);
      expect(plan.collisions).toEqual([]);
      expect(new Set(plan.inserts.map(i => i.gamePk))).toEqual(new Set([900101, 900102]));
      const g1 = plan.inserts.find(i => i.gamePk === 900101)!;
      expect(g1.startTimeEst).toBe("1:35 PM");
      expect(g1.rescheduledFrom).toBe("2026-05-09");
      const g2 = plan.inserts.find(i => i.gamePk === 900102)!;
      expect(g2.startTimeEst).toBe("7:10 PM");
    }
  });
});
