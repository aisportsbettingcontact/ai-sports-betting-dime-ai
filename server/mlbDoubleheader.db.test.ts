/**
 * mlbDoubleheader.db.test.ts — Real-database invariants for MLB doubleheader
 * event identity (2026-07-17 TB@BOS incident remediation).
 *
 * Runs in the isolated-MySQL `db-tests` CI job (DB_TESTS=1) and locally via
 * scripts/test-db-local.sh. Uses a far-future date namespace (2126-07-17) and
 * a dedicated synthetic gamePk range (890100–890199) so it can never touch
 * real rows; all created rows are deleted in afterAll.
 *
 * ── Test surface ─────────────────────────────────────────────────────────────
 *  [DH-DB-1] Both doubleheader games coexist as rows (distinct gamePk + gameNumber)
 *  [DH-DB-2] games_matchup_unique rejects a duplicate (date, teams, gameNumber) row
 *  [DH-DB-3] games_mlb_gamepk_unique rejects a duplicate provider identity
 *  [DH-DB-4] Re-ingestion updates only the matching provider event (sibling untouched)
 *  [DH-DB-5] Concurrent ingestion cannot collapse the games (unique keys + applyErrors)
 *  [DH-DB-6] Out-of-order stale snapshot cannot regress terminal status
 *  [DH-DB-7] Incident shape end-to-end: legacy 7:10 row adopted by G2, G1 inserted
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { SKIP_DB_IN_CI } from "./_core/ciTestGuard";
import { getDb } from "./db";
import { games } from "../drizzle/schema";
import { planMlbScheduleSync, type DbGameRow } from "./mlbEventIdentity";
import { applyMlbScheduleSyncPlan } from "./mlbScheduleSync";
import { raysRedSoxGame1, raysRedSoxGame2 } from "./mlbDoubleheaderFixtures";

const NS_DATE = "2126-07-17"; // far-future namespace — never real data
const PK_G1 = 890101;
const PK_G2 = 890102;
const PK_TMP = 890150;

const g1 = () => raysRedSoxGame1({ gamePk: PK_G1, officialDate: NS_DATE, startUtc: `${NS_DATE}T17:35:00Z`, rescheduledFrom: "2126-05-09" });
const g2 = () => raysRedSoxGame2({ gamePk: PK_G2, officialDate: NS_DATE, startUtc: `${NS_DATE}T23:10:00Z` });

async function loadNsRows(db: NonNullable<Awaited<ReturnType<typeof getDb>>>): Promise<DbGameRow[]> {
  const rows = await db
    .select({
      id: games.id,
      gameDate: games.gameDate,
      startTimeEst: games.startTimeEst,
      awayTeam: games.awayTeam,
      homeTeam: games.homeTeam,
      sport: games.sport,
      mlbGamePk: games.mlbGamePk,
      gameNumber: games.gameNumber,
      doubleHeader: games.doubleHeader,
      gameStatus: games.gameStatus,
      venue: games.venue,
      rescheduledFrom: games.rescheduledFrom,
    })
    .from(games)
    .where(and(eq(games.sport, "MLB"), eq(games.gameDate, NS_DATE)));
  return rows.map((r: typeof rows[number]) => ({ ...r, mlbGamePk: r.mlbGamePk != null ? Number(r.mlbGamePk) : null }));
}

async function cleanup() {
  const db = await getDb();
  if (!db) return;
  await db.delete(games).where(eq(games.gameDate, NS_DATE));
  await db.delete(games).where(inArray(games.mlbGamePk, [PK_G1, PK_G2, PK_TMP]));
}

describe.skipIf(SKIP_DB_IN_CI)("MLB doubleheader DB invariants (real database)", () => {
  beforeAll(async () => { await cleanup(); });
  afterAll(async () => { await cleanup(); });

  it("[DH-DB-1] both doubleheader games coexist as distinct rows", async () => {
    const db = await getDb();
    expect(db).toBeTruthy();
    const plan = planMlbScheduleSync([g1(), g2()], await loadNsRows(db!));
    expect(plan.inserts).toHaveLength(2);
    const { inserted, applyErrors } = await applyMlbScheduleSyncPlan(db!, plan);
    expect(applyErrors).toEqual([]);
    expect(inserted).toBe(2);

    const rows = await loadNsRows(db!);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map(r => r.mlbGamePk))).toEqual(new Set([PK_G1, PK_G2]));
    expect(new Set(rows.map(r => r.gameNumber))).toEqual(new Set([1, 2]));
    const g1Row = rows.find(r => r.mlbGamePk === PK_G1)!;
    expect(g1Row.startTimeEst).toBe("1:35 PM");
    expect(g1Row.rescheduledFrom).toBe("2126-05-09");
    expect(g1Row.doubleHeader).toBe("S");
  });

  it("[DH-DB-2] matchup unique index rejects duplicate (date, teams, gameNumber)", async () => {
    const db = await getDb();
    await expect(
      db!.insert(games).values({
        fileId: 0, gameDate: NS_DATE, startTimeEst: "3:00 PM",
        awayTeam: "TB", homeTeam: "BOS", sport: "MLB",
        gameNumber: 1, mlbGamePk: PK_TMP,
      })
    ).rejects.toThrow(/[Dd]uplicate/);
  });

  it("[DH-DB-3] gamePk unique index rejects duplicate provider identity", async () => {
    const db = await getDb();
    await expect(
      db!.insert(games).values({
        fileId: 0, gameDate: "2126-07-18", startTimeEst: "1:05 PM",
        awayTeam: "TB", homeTeam: "BOS", sport: "MLB",
        gameNumber: 1, mlbGamePk: PK_G1, // PK_G1 already owns a row
      })
    ).rejects.toThrow(/[Dd]uplicate/);
  });

  it("[DH-DB-4] re-ingestion updates only the matching provider event", async () => {
    const db = await getDb();
    // G1 start time slides 30 minutes; G2 unchanged.
    const plan = planMlbScheduleSync(
      [g1({ startUtc: `${NS_DATE}T18:05:00Z` }), g2()],
      await loadNsRows(db!)
    );
    expect(plan.inserts).toHaveLength(0);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].gamePk).toBe(PK_G1);
    const { updated, applyErrors } = await applyMlbScheduleSyncPlan(db!, plan);
    expect(applyErrors).toEqual([]);
    expect(updated).toBe(1);

    const rows = await loadNsRows(db!);
    expect(rows.find(r => r.mlbGamePk === PK_G1)?.startTimeEst).toBe("2:05 PM");
    expect(rows.find(r => r.mlbGamePk === PK_G2)?.startTimeEst).toBe("7:10 PM");

    // Restore G1's original time and confirm full idempotence.
    const restore = planMlbScheduleSync([g1(), g2()], await loadNsRows(db!));
    await applyMlbScheduleSyncPlan(db!, restore);
    const replay = planMlbScheduleSync([g1(), g2()], await loadNsRows(db!));
    expect(replay.inserts).toHaveLength(0);
    expect(replay.updates).toHaveLength(0);
    expect(replay.counts.unchanged).toBe(2);
  });

  it("[DH-DB-5] concurrent ingestion cannot collapse or duplicate the games", async () => {
    const db = await getDb();
    // Both workers plan from the same (pre-insert-free) snapshot and race.
    await db!.delete(games).where(eq(games.gameDate, NS_DATE));
    const snapshot = await loadNsRows(db!);
    const planA = planMlbScheduleSync([g1(), g2()], snapshot);
    const planB = planMlbScheduleSync([g2(), g1()], snapshot);
    const [resA, resB] = await Promise.all([
      applyMlbScheduleSyncPlan(db!, planA),
      applyMlbScheduleSyncPlan(db!, planB),
    ]);
    // Unique indexes guarantee exactly 2 rows; the losing worker records
    // duplicate-key applyErrors instead of silently merging events.
    const rows = await loadNsRows(db!);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map(r => r.mlbGamePk))).toEqual(new Set([PK_G1, PK_G2]));
    expect(resA.inserted + resB.inserted).toBe(2);
    expect(resA.applyErrors.length + resB.applyErrors.length).toBe(2);
  });

  it("[DH-DB-6] a stale snapshot cannot regress terminal status", async () => {
    const db = await getDb();
    // G1 goes final…
    const finalPlan = planMlbScheduleSync(
      [g1({ abstractGameState: "Final", detailedState: "Final" }), g2()],
      await loadNsRows(db!)
    );
    await applyMlbScheduleSyncPlan(db!, finalPlan);
    expect((await loadNsRows(db!)).find(r => r.mlbGamePk === PK_G1)?.gameStatus).toBe("final");
    // …then a stale Preview snapshot replays: status must NOT revert.
    const stale = planMlbScheduleSync([g1(), g2()], await loadNsRows(db!));
    expect(stale.warnings.some(w => w.includes("status regression blocked"))).toBe(true);
    await applyMlbScheduleSyncPlan(db!, stale);
    expect((await loadNsRows(db!)).find(r => r.mlbGamePk === PK_G1)?.gameStatus).toBe("final");
  });

  it("[DH-DB-7] incident shape end-to-end: legacy 7:10 row adopted by G2, G1 inserted", async () => {
    const db = await getDb();
    await db!.delete(games).where(eq(games.gameDate, NS_DATE));
    // Pre-seed era: one legacy evening row, no provider identity.
    await db!.insert(games).values({
      fileId: 0, gameDate: NS_DATE, startTimeEst: "7:10 PM",
      awayTeam: "TB", homeTeam: "BOS", sport: "MLB",
    });
    const before = await loadNsRows(db!);
    expect(before).toHaveLength(1); // the defect state: only the 7:10 PM game exists

    const plan = planMlbScheduleSync([g1(), g2()], before);
    const { applyErrors } = await applyMlbScheduleSyncPlan(db!, plan);
    expect(applyErrors).toEqual([]);

    const after = await loadNsRows(db!);
    expect(after).toHaveLength(2);
    const adopted = after.find(r => r.startTimeEst === "7:10 PM")!;
    expect(adopted.id).toBe(before[0].id);      // same physical row — odds/model data preserved
    expect(adopted.mlbGamePk).toBe(PK_G2);      // stamped with the EVENING game's identity
    expect(adopted.gameNumber).toBe(2);
    const insertedRow = after.find(r => r.startTimeEst === "1:35 PM")!;
    expect(insertedRow.mlbGamePk).toBe(PK_G1);  // the makeup game gets its own new row
    expect(insertedRow.gameNumber).toBe(1);
  });
});
