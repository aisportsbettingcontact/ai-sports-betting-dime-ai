import { describe, expect, it } from "vitest";
import { identifyMlbEvents, reconcileMlbEventIds } from "./mlbEventIdentity";

const raysRedSox = [
  { gamePk: 900001, scheduledStartUtc: "2026-07-17T17:35:00Z", officialDate: "2026-07-17", awayTeamId: 139, homeTeamId: 111, venueId: 3, doubleHeader: "Y", gameNumber: 1, dayNight: "day" },
  { gamePk: 900002, scheduledStartUtc: "2026-07-17T23:10:00Z", officialDate: "2026-07-17", awayTeamId: 139, homeTeamId: 111, venueId: 3, doubleHeader: "S", gameNumber: 2, dayNight: "night" },
] as const;

describe("MLB canonical event identity", () => {
  it("preserves a split doubleheader with same teams and official date", () => {
    const events = identifyMlbEvents(raysRedSox);
    expect(events.map(e => e.canonicalEventId)).toEqual(["mlb-stats:MLB:900001", "mlb-stats:MLB:900002"]);
    expect(new Set(events.map(e => e.doubleheaderGroupId)).size).toBe(1);
    expect(events.every(e => e.doubleheaderConfidence === "EXPLICIT")).toBe(true);
  });
  it("is idempotent for duplicate deliveries and retains a metadata-poor sibling", () => {
    const events = identifyMlbEvents([raysRedSox[1], { ...raysRedSox[0], doubleHeader: null, gameNumber: null }, raysRedSox[0]]);
    expect(events).toHaveLength(2);
    expect(events[0].gamePk).toBe(900001);
  });
  it("does not collide reversed orientation or equal start times, and has deterministic sorting", () => {
    const events = identifyMlbEvents([
      { ...raysRedSox[0], gamePk: 4, scheduledStartUtc: "2026-11-01T05:00:00Z" },
      { ...raysRedSox[0], gamePk: 3, awayTeamId: 111, homeTeamId: 139, scheduledStartUtc: "2026-11-01T05:00:00Z" },
    ]);
    expect(events.map(e => e.gamePk)).toEqual([3, 4]);
  });
  it("reports a cardinality loss instead of silently accepting it", () => {
    const ids = identifyMlbEvents(raysRedSox).map(e => e.canonicalEventId);
    expect(reconcileMlbEventIds(ids, [ids[1]])).toMatchObject({ ok: false, missing: [ids[0]], duplicates: 0 });
  });
});
