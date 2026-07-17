/**
 * mlbEventIdentity.test.ts — Doubleheader event-identity test matrix (pure).
 *
 * Anchored on the 2026-07-17 TB@BOS split doubleheader incident: the feed
 * showed only the 7:10 PM game because nothing inserted the 1:35 PM makeup
 * game (rescheduled from May 9) into the `games` table, and matchup-keyed
 * matching could not distinguish the two events.
 *
 * Fixtures use SYNTHETIC gamePks (see mlbDoubleheaderFixtures.ts) — live
 * provider capture was network-blocked in the remediation environment.
 */
import { describe, it, expect } from "vitest";
import {
  classifyDoubleheaderGroup,
  classifySlate,
  compareProviderGames,
  doubleheaderGroupId,
  isStatusRegression,
  mapProviderStatus,
  planMlbScheduleSync,
  utcToEasternTimeString,
  type DbGameRow,
  type MlbProviderGame,
} from "./mlbEventIdentity";
import {
  G1_GAMEPK,
  G2_GAMEPK,
  G1_START_UTC,
  G2_START_UTC,
  SINGLE_GAMEPK,
  controlSingleGame,
  generateSlateCase,
  incidentSlate,
  postponedMay9Row,
  preSeededEveningRow,
  preSeededEveningRowWithPk,
  raysRedSoxGame1,
  raysRedSoxGame2,
} from "./mlbDoubleheaderFixtures";

/** Simulate applying a plan to a row set (models the DB write effects). */
function applyPlan(
  rows: DbGameRow[],
  plan: ReturnType<typeof planMlbScheduleSync>,
  nextId = 90000
): DbGameRow[] {
  const out = rows.map(r => ({ ...r }));
  for (const u of plan.updates) {
    const row = out.find(r => r.id === u.rowId);
    if (!row) throw new Error(`update targets missing row ${u.rowId}`);
    if (u.set.gameDate !== undefined) row.gameDate = u.set.gameDate;
    if (u.set.startTimeEst !== undefined) row.startTimeEst = u.set.startTimeEst;
    if (u.set.gameNumber !== undefined) row.gameNumber = u.set.gameNumber;
    if (u.set.doubleHeader !== undefined) row.doubleHeader = u.set.doubleHeader;
    if (u.set.mlbGamePk !== undefined) row.mlbGamePk = u.set.mlbGamePk;
    if (u.set.gameStatus !== undefined) row.gameStatus = u.set.gameStatus;
    if (u.set.venue !== undefined) row.venue = u.set.venue;
    if (u.set.rescheduledFrom !== undefined) row.rescheduledFrom = u.set.rescheduledFrom;
  }
  for (const ins of plan.inserts) {
    out.push({
      id: nextId++,
      gameDate: ins.gameDate,
      startTimeEst: ins.startTimeEst,
      awayTeam: ins.awayTeam,
      homeTeam: ins.homeTeam,
      sport: "MLB",
      mlbGamePk: ins.gamePk,
      gameNumber: ins.gameNumber,
      doubleHeader: ins.doubleHeader,
      gameStatus: ins.gameStatus,
      venue: ins.venue ?? null,
      rescheduledFrom: ins.rescheduledFrom ?? null,
    });
  }
  return out;
}

// ─── Incident reproduction ────────────────────────────────────────────────────

describe("2026-07-17 TB@BOS incident reproduction", () => {
  it("pre-fix DB state loses the 1:35 PM game (defect demonstrated), post-sync state preserves both", () => {
    // Pre-fix: the games table holds ONE TB@BOS row for 2026-07-17 (the
    // pre-seeded 7:10 PM game). The provider slate has TWO distinct events.
    const dbBefore = [preSeededEveningRow(), postponedMay9Row()];
    const feedBefore = dbBefore.filter(
      r => r.gameDate === "2026-07-17" && r.gameStatus !== "postponed"
    );
    expect(feedBefore).toHaveLength(1); // the defect: 1:35 PM game absent
    expect(feedBefore[0].startTimeEst).toBe("7:10 PM");

    // The remediation plan restores cardinality without touching May 9.
    const plan = planMlbScheduleSync(incidentSlate(), dbBefore);
    expect(plan.collisions).toEqual([]);
    const dbAfter = applyPlan(dbBefore, plan);
    const feedAfter = dbAfter.filter(
      r => r.gameDate === "2026-07-17" && r.gameStatus !== "postponed" &&
           r.awayTeam === "TB" && r.homeTeam === "BOS"
    );
    expect(feedAfter).toHaveLength(2);
    const times = feedAfter.map(r => r.startTimeEst).sort();
    expect(times).toEqual(["1:35 PM", "7:10 PM"]);
    // Postponed original stays, untouched:
    expect(dbAfter.find(r => r.id === 5091)?.gameStatus).toBe("postponed");
  });

  it("pairs the pre-seeded 7:10 PM legacy row with the 7:10 PM event (no odds hijack by the makeup game)", () => {
    const dbBefore = [preSeededEveningRow()];
    const plan = planMlbScheduleSync(incidentSlate(), dbBefore);
    // The legacy row must be adopted by G2 (same start time), G1 must be an insert.
    const adoption = plan.updates.find(u => u.adoptsLegacyRow);
    expect(adoption?.rowId).toBe(7101);
    expect(adoption?.gamePk).toBe(G2_GAMEPK);
    expect(adoption?.set.mlbGamePk).toBe(G2_GAMEPK);
    expect(adoption?.set.gameNumber).toBe(2);
    const insert = plan.inserts.find(i => i.awayTeam === "TB");
    expect(insert?.gamePk).toBe(G1_GAMEPK);
    expect(insert?.startTimeEst).toBe("1:35 PM");
    expect(insert?.gameNumber).toBe(1);
    expect(insert?.doubleHeader).toBe("S");
  });
});

// ─── Unit tests 1–10 (required matrix) ───────────────────────────────────────

describe("unit: event identity preservation", () => {
  it("1. two games with same teams+date but distinct provider IDs are both preserved", () => {
    const plan = planMlbScheduleSync([raysRedSoxGame1(), raysRedSoxGame2()], []);
    expect(plan.inserts).toHaveLength(2);
    expect(new Set(plan.inserts.map(i => i.gamePk))).toEqual(new Set([G1_GAMEPK, G2_GAMEPK]));
    expect(plan.collisions).toEqual([]);
  });

  it("2. re-ingesting one game updates only that game", () => {
    const db = applyPlan([], planMlbScheduleSync(incidentSlate(), []));
    // G1 start time slides 30 minutes
    const plan = planMlbScheduleSync(
      [raysRedSoxGame1({ startUtc: "2026-07-17T18:05:00Z" })],
      db
    );
    expect(plan.inserts).toHaveLength(0);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].gamePk).toBe(G1_GAMEPK);
    expect(plan.updates[0].set.startTimeEst).toBe("2:05 PM");
    const after = applyPlan(db, plan);
    expect(after.find(r => r.mlbGamePk === G2_GAMEPK)?.startTimeEst).toBe("7:10 PM"); // sibling untouched
  });

  it("3. re-ingesting both games is idempotent — no duplicates, no changes", () => {
    const db = applyPlan([], planMlbScheduleSync(incidentSlate(), []));
    const plan2 = planMlbScheduleSync(incidentSlate(), db);
    expect(plan2.inserts).toHaveLength(0);
    expect(plan2.updates).toHaveLength(0);
    expect(plan2.counts.unchanged).toBe(3);
    expect(applyPlan(db, plan2)).toHaveLength(db.length);
  });

  it("4. game 1 and game 2 retain distinct identities and gameNumbers", () => {
    const group = classifyDoubleheaderGroup([raysRedSoxGame1(), raysRedSoxGame2()]);
    expect(group.resolvedGameNumbers.get(G1_GAMEPK)).toBe(1);
    expect(group.resolvedGameNumbers.get(G2_GAMEPK)).toBe(2);
    expect(group.gamePks).toEqual([G1_GAMEPK, G2_GAMEPK]);
  });

  it("5. grouping associates both games without merging them", () => {
    const groups = classifySlate(incidentSlate());
    const dh = groups.get(doubleheaderGroupId("2026-07-17", "TB", "BOS"));
    expect(dh?.gamePks).toHaveLength(2);
    expect(dh?.confidence).toBe("EXPLICIT");
    const single = groups.get(doubleheaderGroupId("2026-07-17", "NYY", "DET"));
    expect(single?.confidence).toBe("NOT_DOUBLEHEADER");
  });

  it("6. sorting is chronological with gamePk as deterministic tie-breaker", () => {
    const sameTime = [
      raysRedSoxGame2({ startUtc: "2026-07-17T17:35:00Z", gamePk: 900999 }),
      raysRedSoxGame1(),
    ];
    const sorted = [...sameTime].sort(compareProviderGames);
    expect(sorted.map(g => g.gamePk)).toEqual([G1_GAMEPK, 900999]);
    const chrono = [raysRedSoxGame2(), raysRedSoxGame1()].sort(compareProviderGames);
    expect(chrono[0].gamePk).toBe(G1_GAMEPK);
  });

  it("7. missing doubleheader metadata never deletes the second event", () => {
    const g1 = raysRedSoxGame1({ doubleHeader: undefined, gameNumber: undefined });
    const g2 = raysRedSoxGame2({ doubleHeader: undefined, gameNumber: undefined });
    const plan = planMlbScheduleSync([g1, g2], []);
    expect(plan.inserts).toHaveLength(2);
    expect(plan.collisions).toEqual([]);
    const group = classifyDoubleheaderGroup([g1, g2]);
    expect(group.gamePks).toHaveLength(2);
    // chronological fallback still numbers them 1 and 2
    expect(group.resolvedGameNumbers.get(G1_GAMEPK)).toBe(1);
    expect(group.resolvedGameNumbers.get(G2_GAMEPK)).toBe(2);
    expect(["POSSIBLE", "CORROBORATED"]).toContain(group.confidence);
  });

  it("8. conflicting doubleheader metadata produces an observable warning, keeps both events", () => {
    const group = classifyDoubleheaderGroup([
      raysRedSoxGame1({ doubleHeader: "N" }),
      raysRedSoxGame2({ doubleHeader: "S" }),
    ]);
    expect(group.gamePks).toHaveLength(2);
    expect(group.warnings.some(w => w.includes("conflicting doubleheader flags"))).toBe(true);
    const plan = planMlbScheduleSync(
      [raysRedSoxGame1({ doubleHeader: "N" }), raysRedSoxGame2({ doubleHeader: "S" })],
      []
    );
    expect(plan.warnings.some(w => w.includes("conflicting doubleheader flags"))).toBe(true);
    expect(plan.inserts).toHaveLength(2);
  });

  it("9. reversed home/away orientation does not collide with the doubleheader", () => {
    // Hypothetical BOS@TB game the same date is a DIFFERENT group and never collides.
    const reversed = raysRedSoxGame1({ gamePk: 900555, awayAbbrev: "BOS", homeAbbrev: "TB" });
    const plan = planMlbScheduleSync([raysRedSoxGame1(), raysRedSoxGame2(), reversed], []);
    expect(plan.inserts).toHaveLength(3);
    expect(plan.collisions).toEqual([]);
    const groups = classifySlate([raysRedSoxGame1(), reversed]);
    expect(groups.size).toBe(2);
  });

  it("10. a normal single game is unchanged by doubleheader handling", () => {
    const plan = planMlbScheduleSync([controlSingleGame()], []);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0].gameNumber).toBe(1);
    expect(plan.inserts[0].doubleHeader).toBe("N");
    expect(plan.inserts[0].dhConfidence).toBe("NOT_DOUBLEHEADER");
    const db = applyPlan([], plan);
    const plan2 = planMlbScheduleSync([controlSingleGame()], db);
    expect(plan2.counts.unchanged).toBe(1);
  });
});

// ─── Status & scheduling (matrix 31–40 subset that is pure) ──────────────────

describe("status and scheduling", () => {
  it("31. postponed games remain identifiable (status mapping)", () => {
    expect(mapProviderStatus("Preview", "Postponed")).toBe("postponed");
    expect(mapProviderStatus("Final", "Cancelled")).toBe("postponed");
  });

  it("32. rescheduled games preserve original-date metadata through classification", () => {
    const g1 = raysRedSoxGame1();
    expect(g1.rescheduledFrom).toBe("2026-05-09");
    const plan = planMlbScheduleSync([g1, raysRedSoxGame2()], [postponedMay9Row()]);
    // The May 9 postponed row is never claimed/deleted by the July 17 events.
    expect(plan.updates.every(u => u.rowId !== 5091)).toBe(true);
    expect(plan.inserts).toHaveLength(2);
  });

  it("33/34. delayed and suspended games remain visible and distinct", () => {
    expect(mapProviderStatus("Live", "Delayed: Rain")).toBe("live");
    expect(mapProviderStatus("Live", "Suspended: Rain")).toBe("suspended");
    const plan = planMlbScheduleSync(
      [raysRedSoxGame1({ abstractGameState: "Live", detailedState: "Suspended: Rain" }), raysRedSoxGame2()],
      []
    );
    expect(plan.inserts).toHaveLength(2);
    expect(plan.inserts.find(i => i.gamePk === G1_GAMEPK)?.gameStatus).toBe("suspended");
  });

  it("35. cancelling one game never deletes the sibling", () => {
    const db = applyPlan([], planMlbScheduleSync([raysRedSoxGame1(), raysRedSoxGame2()], []));
    const plan = planMlbScheduleSync(
      [raysRedSoxGame1({ detailedState: "Cancelled" }), raysRedSoxGame2()],
      db
    );
    const after = applyPlan(db, plan);
    expect(after).toHaveLength(2);
    expect(after.find(r => r.mlbGamePk === G1_GAMEPK)?.gameStatus).toBe("postponed");
    expect(after.find(r => r.mlbGamePk === G2_GAMEPK)?.gameStatus).toBe("upcoming");
  });

  it("36. completed games remain correctly associated", () => {
    const db = applyPlan([], planMlbScheduleSync([raysRedSoxGame1(), raysRedSoxGame2()], []));
    const plan = planMlbScheduleSync(
      [raysRedSoxGame1({ abstractGameState: "Final", detailedState: "Final" }), raysRedSoxGame2()],
      db
    );
    const after = applyPlan(db, plan);
    expect(after.find(r => r.mlbGamePk === G1_GAMEPK)?.gameStatus).toBe("final");
    expect(after.find(r => r.mlbGamePk === G2_GAMEPK)?.gameStatus).toBe("upcoming");
  });

  it("37. start-time changes update in place — no duplicates", () => {
    const db = applyPlan([], planMlbScheduleSync([raysRedSoxGame1()], []));
    const plan = planMlbScheduleSync([raysRedSoxGame1({ startUtc: "2026-07-17T18:35:00Z" })], db);
    expect(plan.inserts).toHaveLength(0);
    expect(plan.updates).toHaveLength(1);
    expect(applyPlan(db, plan)).toHaveLength(1);
  });

  it("38. traditional (Y) and split (S) doubleheaders both classify EXPLICIT", () => {
    for (const flag of ["Y", "S"] as const) {
      const group = classifyDoubleheaderGroup([
        raysRedSoxGame1({ doubleHeader: flag }),
        raysRedSoxGame2({ doubleHeader: flag }),
      ]);
      expect(group.confidence).toBe("EXPLICIT");
      expect(group.gamePks).toHaveLength(2);
    }
  });

  it("39. a game crossing UTC midnight stays on its official (venue-local) schedule date", () => {
    // 10:10 PM ET on 2026-07-17 == 02:10 UTC on 2026-07-18
    const late = controlSingleGame({
      gamePk: 900301, awayAbbrev: "LAD", homeAbbrev: "SF",
      officialDate: "2026-07-17", startUtc: "2026-07-18T02:10:00Z",
    });
    const plan = planMlbScheduleSync([late], []);
    expect(plan.inserts[0].gameDate).toBe("2026-07-17"); // NOT 2026-07-18
    expect(plan.inserts[0].startTimeEst).toBe("10:10 PM");
  });

  it("40. daylight-saving boundaries do not create collisions", () => {
    // Fall-back day: 2026-11-01 in America/New_York.
    const d1 = controlSingleGame({
      gamePk: 900401, awayAbbrev: "TB", homeAbbrev: "BOS",
      officialDate: "2026-11-01", startUtc: "2026-11-01T17:35:00Z", doubleHeader: "S", gameNumber: 1,
    });
    const d2 = controlSingleGame({
      gamePk: 900402, awayAbbrev: "TB", homeAbbrev: "BOS",
      officialDate: "2026-11-01", startUtc: "2026-11-01T23:10:00Z", doubleHeader: "S", gameNumber: 2,
    });
    const plan = planMlbScheduleSync([d1, d2], []);
    expect(plan.inserts).toHaveLength(2);
    expect(plan.collisions).toEqual([]);
    // EST after fall-back: 17:35 UTC = 12:35 PM EST
    expect(plan.inserts.find(i => i.gamePk === 900401)?.startTimeEst).toBe("12:35 PM");
  });
});

// ─── Robustness (matrix 41–45 pure subset) ───────────────────────────────────

describe("robustness", () => {
  it("41. reverse provider payload order produces an identical outcome", () => {
    const forward = planMlbScheduleSync(incidentSlate(), []);
    const reverse = planMlbScheduleSync([...incidentSlate()].reverse(), []);
    const norm = (p: typeof forward) =>
      [...p.inserts].sort((a, b) => a.gamePk - b.gamePk).map(i => ({ ...i }));
    expect(norm(reverse)).toEqual(norm(forward));
  });

  it("42. duplicate network deliveries are idempotent (same payload repeated)", () => {
    const doubled = [...incidentSlate(), ...incidentSlate()];
    const plan = planMlbScheduleSync(doubled, []);
    expect(plan.counts.providerDistinct).toBe(3);
    expect(plan.inserts).toHaveLength(3);
    expect(plan.warnings.some(w => w.includes("duplicate provider delivery"))).toBe(true);
  });

  it("43. a partial provider response never deletes existing rows (plan is additive)", () => {
    const db = applyPlan([], planMlbScheduleSync(incidentSlate(), []));
    const plan = planMlbScheduleSync([raysRedSoxGame2()], db); // G1 + control missing from payload
    const after = applyPlan(db, plan);
    expect(after).toHaveLength(3); // nothing deleted
  });

  it("44. malformed event records are rejected individually with reasons, valid siblings survive", () => {
    const malformed = raysRedSoxGame1({ gamePk: NaN as unknown as number });
    const plan = planMlbScheduleSync([malformed, raysRedSoxGame2()], []);
    expect(plan.rejected).toHaveLength(1);
    expect(plan.rejected[0].reason).toContain("gamePk");
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0].gamePk).toBe(G2_GAMEPK);
  });

  it("46/48. sequential re-sync (restart/replay, interleaved order) preserves both games", () => {
    // Worker A syncs G1 only; worker B replays the full slate; then a restart replays again.
    let db = applyPlan([], planMlbScheduleSync([raysRedSoxGame1()], []));
    db = applyPlan(db, planMlbScheduleSync(incidentSlate(), db), 95000);
    db = applyPlan(db, planMlbScheduleSync(incidentSlate(), db), 97000);
    const tbbos = db.filter(r => r.awayTeam === "TB" && r.homeTeam === "BOS");
    expect(tbbos).toHaveLength(2);
    expect(new Set(tbbos.map(r => r.mlbGamePk))).toEqual(new Set([G1_GAMEPK, G2_GAMEPK]));
  });

  it("status regression guard: a stale snapshot cannot downgrade terminal state", () => {
    expect(isStatusRegression("final", "live")).toBe(true);
    expect(isStatusRegression("final", "upcoming")).toBe(true);
    expect(isStatusRegression("live", "upcoming")).toBe(true);
    expect(isStatusRegression("postponed", "upcoming")).toBe(true);
    expect(isStatusRegression("upcoming", "live")).toBe(false);
    expect(isStatusRegression("live", "final")).toBe(false);
    expect(isStatusRegression("postponed", "final")).toBe(false); // resumed/completed allowed

    const db = applyPlan([], planMlbScheduleSync(
      [raysRedSoxGame1({ abstractGameState: "Final", detailedState: "Final" })], []
    ));
    const stale = planMlbScheduleSync([raysRedSoxGame1()], db); // Preview/Scheduled snapshot
    expect(stale.updates.every(u => u.set.gameStatus === undefined)).toBe(true);
    expect(stale.warnings.some(w => w.includes("status regression blocked"))).toBe(true);
  });

  it("timezone helper: UTC instants render as correct Eastern wall times (DST-aware)", () => {
    expect(utcToEasternTimeString("2026-07-17T17:35:00Z")).toBe("1:35 PM"); // EDT
    expect(utcToEasternTimeString("2026-07-17T23:10:00Z")).toBe("7:10 PM"); // EDT
    expect(utcToEasternTimeString("2026-12-17T23:10:00Z")).toBe("6:10 PM"); // EST
    expect(utcToEasternTimeString("not-a-date")).toBe("TBD");
  });
});

// ─── Follow-up hardening (2026-07-17 live production findings) ───────────────

describe("follow-up hardening: live production findings", () => {
  it("same-pk reschedule relocates the old-date row instead of a blocked insert (the 824766 pattern)", () => {
    // Live incident: MLB reused the postponed May 9 gamePk for the July 17
    // makeup. The planner must MOVE the postponed row to the new date, not
    // plan an insert that collides on games_mlb_gamepk_unique forever.
    const may9 = postponedMay9Row(); // pk 900100, gameDate 2026-05-09, status postponed
    const evening = preSeededEveningRowWithPk();
    const makeupSamePk = raysRedSoxGame1({ gamePk: 900100 }); // provider kept the pk
    const plan = planMlbScheduleSync([makeupSamePk, raysRedSoxGame2()], [may9, evening]);

    expect(plan.inserts).toHaveLength(0);
    expect(plan.collisions).toEqual([]);
    const move = plan.updates.find(u => u.rowId === 5091);
    expect(move?.set.gameDate).toBe("2026-07-17");
    // gameNumber is already 1 on the stored row — correctly absent from the
    // delta set; the intended final number rides on finalGameNumber.
    expect(move?.set.gameNumber).toBeUndefined();
    expect(move?.finalGameNumber).toBe(1);
    expect(move?.set.doubleHeader).toBe("S");
    // The date move RESOLVES the postponement — this exact transition needed
    // a manual UPDATE in production on 2026-07-17.
    expect(move?.set.gameStatus).toBe("upcoming");
    expect(plan.warnings.some(w => w.includes("moved 2026-05-09 → 2026-07-17"))).toBe(true);

    const after = applyPlan([may9, evening], plan);
    const jul17 = after.filter(r => r.gameDate === "2026-07-17");
    expect(jul17).toHaveLength(2);
    expect(new Set(jul17.map(r => r.mlbGamePk))).toEqual(new Set([900100, G2_GAMEPK]));
    expect(new Set(jul17.map(r => r.gameNumber))).toEqual(new Set([1, 2]));
  });

  it("without a date move, postponed→upcoming remains a blocked regression (guard intact)", () => {
    const db = applyPlan([], planMlbScheduleSync(
      [raysRedSoxGame1({ detailedState: "Postponed" })], []
    ));
    expect(db[0].gameStatus).toBe("postponed");
    const stale = planMlbScheduleSync([raysRedSoxGame1()], db); // same date, Scheduled snapshot
    expect(stale.updates.every(u => u.set.gameStatus === undefined)).toBe(true);
    expect(stale.warnings.some(w => w.includes("status regression blocked"))).toBe(true);
  });

  it("a partial payload with only one DH sibling cannot renumber or unflag the stamped row", () => {
    const db = applyPlan([], planMlbScheduleSync([raysRedSoxGame1(), raysRedSoxGame2()], []));
    // Payload delivers ONLY game 2 (solo group resolves to gameNumber 1 —
    // which must NOT be applied to the stamped G2 row), with no DH flag.
    const plan = planMlbScheduleSync(
      [raysRedSoxGame2({ gameNumber: undefined, doubleHeader: undefined })],
      db
    );
    expect(plan.inserts).toHaveLength(0);
    expect(plan.collisions).toEqual([]);
    const g2Update = plan.updates.find(u => u.gamePk === G2_GAMEPK);
    expect(g2Update?.set.gameNumber).toBeUndefined();
    expect(g2Update?.set.doubleHeader).toBeUndefined();
    const after = applyPlan(db, plan);
    const g2Row = after.find(r => r.mlbGamePk === G2_GAMEPK)!;
    expect(g2Row.gameNumber).toBe(2);
    expect(g2Row.doubleHeader).toBe("S");
  });

  it("gameNumber permutation plans carry finalGameNumber for two-phase apply", () => {
    // Provider inverts the numbering/times of two stamped rows: the paired
    // updates are mutually blocking on games_matchup_unique, so the apply
    // layer parks and re-applies — it needs each row's intended final number.
    const db = applyPlan([], planMlbScheduleSync([raysRedSoxGame1(), raysRedSoxGame2()], []));
    const inverted = [
      raysRedSoxGame1({ startUtc: G2_START_UTC, gameNumber: 2, dayNight: "night" }),
      raysRedSoxGame2({ startUtc: G1_START_UTC, gameNumber: 1, dayNight: "day" }),
    ];
    const plan = planMlbScheduleSync(inverted, db);
    expect(plan.collisions).toEqual([]);
    const byPk = new Map(plan.updates.map(u => [u.gamePk, u]));
    expect(byPk.get(G1_GAMEPK)?.finalGameNumber).toBe(2);
    expect(byPk.get(G2_GAMEPK)?.finalGameNumber).toBe(1);
    const after = applyPlan(db, plan);
    expect(after.find(r => r.mlbGamePk === G1_GAMEPK)?.gameNumber).toBe(2);
    expect(after.find(r => r.mlbGamePk === G2_GAMEPK)?.gameNumber).toBe(1);
  });
});

// ─── Generated (property-style) invariant tests ──────────────────────────────

describe("generated doubleheader invariant (seeded, deterministic)", () => {
  it("for every generated slate: N distinct gamePks → exactly N stored events (or recorded rejections), idempotent on replay", () => {
    for (let seed = 1; seed <= 250; seed++) {
      const { slate, distinctPks } = generateSlateCase(seed);
      const plan = planMlbScheduleSync(slate, []);
      const accounted =
        plan.counts.matchedByGamePk + plan.counts.adoptedLegacyRows +
        plan.counts.inserts + plan.counts.unchanged;
      // Invariant: every distinct valid event accounted for, none lost.
      expect(plan.collisions, `seed=${seed} collisions`).toEqual([]);
      expect(accounted + plan.counts.rejected, `seed=${seed} accounting`).toBe(distinctPks.length);

      const db = applyPlan([], plan);
      expect(new Set(db.map(r => r.mlbGamePk)).size, `seed=${seed} distinct rows`).toBe(plan.inserts.length);

      // Replay idempotence: same slate again → no inserts, no collisions.
      const replay = planMlbScheduleSync(slate, db);
      expect(replay.inserts, `seed=${seed} replay inserts`).toHaveLength(0);
      expect(replay.collisions, `seed=${seed} replay collisions`).toEqual([]);

      // Payload-order independence.
      const reversedPlan = planMlbScheduleSync([...slate].reverse(), db);
      expect(reversedPlan.inserts).toHaveLength(0);
      expect(reversedPlan.collisions).toEqual([]);

      // Storage keys (gameDate:away:home:gameNumber) are unique across the applied DB.
      const keys = db.map(r => `${r.gameDate}:${r.awayTeam}:${r.homeTeam}:${r.gameNumber}`);
      expect(new Set(keys).size, `seed=${seed} unique storage keys`).toBe(keys.length);
    }
  });

  it("generated doubleheaders resolve unique gameNumbers within every group", () => {
    for (let seed = 300; seed <= 400; seed++) {
      const { slate } = generateSlateCase(seed);
      for (const group of classifySlate(slate).values()) {
        const nums = [...group.resolvedGameNumbers.values()];
        expect(new Set(nums).size, `seed=${seed} group=${group.groupId}`).toBe(nums.length);
        expect(group.gamePks.length).toBe(nums.length);
      }
    }
  });
});
