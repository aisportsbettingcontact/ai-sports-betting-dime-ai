/**
 * mlbScheduleSync.ts — Provider→DB schedule reconciliation for the MLB feed
 * ─────────────────────────────────────────────────────────────────────────────
 * ROOT-CAUSE REPAIR for the 2026-07-17 TB@BOS doubleheader incident: before
 * this module existed, NOTHING inserted an MLB game into the `games` table
 * after the season pre-seed. A makeup game (e.g. the 1:35 PM half of a split
 * doubleheader rescheduled from May 9) therefore never reached the feed —
 * mlbScoreRefresh logged it as NO_MATCH and dropped it every 10 minutes.
 *
 * This sync runs as Step 0.5 of runMlbCycleOnce (before the score refresh):
 *   1. Fetch the statsapi.mlb.com schedule for the feed window (ET today → +7).
 *   2. Normalize each game to a canonical MlbProviderGame (identity = gamePk).
 *   3. planMlbScheduleSync (pure): match by gamePk → adopt legacy rows by
 *      closest start time → insert new events. Distinct gamePks NEVER merge.
 *   4. Apply the plan (insert/update by row id), never deleting rows.
 *   5. Reconcile: every distinct provider gamePk must exist in the DB
 *      afterwards; anything missing raises a loud [RECONCILE] failure and an
 *      owner notification. Cardinality loss is never silent again.
 *
 * The same function is the backfill/replay tool: it is idempotent, so it can
 * be re-run for any window at any time (e.g. after an outage) without
 * creating duplicates.
 *
 * Logging convention (matches the rest of the repo):
 *   [MLBScheduleSync][INPUT|STEP|STATE|DH|OUTPUT|VERIFY|RECONCILE|ERROR]
 */

import { eq } from "drizzle-orm";
import { and, gte, inArray, lte } from "drizzle-orm";
import { games } from "../drizzle/schema";
import { MLB_BY_ID } from "../shared/mlbTeams";
import { getDb, invalidateGamesCache } from "./db";
import { notifyOwner } from "./_core/notification";
import {
  planMlbScheduleSync,
  type DbGameRow,
  type MlbProviderGame,
  type MlbScheduleSyncPlan,
} from "./mlbEventIdentity";

const TAG = "[MLBScheduleSync]";
const MLB_STATS_API_BASE = "https://statsapi.mlb.com/api/v1";
const FETCH_TIMEOUT_MS = 15_000;

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "application/json",
  Referer: "https://www.mlb.com/",
};

/**
 * Game types the feed carries: R = regular season, F/D/L/W = postseason rounds.
 * Spring (S), exhibition (E), and the All-Star Game (A — owned by
 * mlbAllStarGameSync with its AL/NL pseudo-teams) are rejected with a reason.
 */
const FEED_GAME_TYPES = new Set(["R", "F", "D", "L", "W"]);

// ─── Raw statsapi types (schedule endpoint) ──────────────────────────────────

interface RawScheduleGame {
  gamePk: number;
  gameType?: string;
  gameDate: string;        // UTC ISO instant
  officialDate?: string;   // venue-local schedule date "YYYY-MM-DD"
  rescheduledFrom?: string;
  doubleHeader?: string;   // "N" | "Y" | "S"
  gameNumber?: number;
  seriesGameNumber?: number;
  dayNight?: string;
  scheduledInnings?: number;
  status?: { abstractGameState?: string; detailedState?: string };
  teams?: {
    away?: { team?: { id?: number; name?: string } };
    home?: { team?: { id?: number; name?: string } };
  };
  venue?: { id?: number; name?: string };
}

interface RawScheduleResponse {
  dates?: Array<{ date: string; games?: RawScheduleGame[] }>;
}

// ─── Result shape (reconciliation ledger for one run) ────────────────────────

export interface MlbScheduleSyncResult {
  runId: string;
  window: { start: string; end: string };
  /** Raw games in the provider response. */
  fetched: number;
  /** Games normalized to canonical events. */
  parsed: number;
  /** Per-event rejections with contract-valid reasons (non-feed gameType, unknown team, malformed). */
  rejected: Array<{ gamePk: number | null; reason: string }>;
  inserted: number;
  updated: number;
  unchanged: number;
  adoptedLegacyRows: number;
  /** Insert/update failures at the DB layer (e.g. duplicate-key) — each one is an alarm. */
  applyErrors: Array<{ gamePk: number; error: string }>;
  /** Planner-detected identity collisions — must be empty in a healthy run. */
  collisions: MlbScheduleSyncPlan["collisions"];
  warnings: string[];
  /** Doubleheader groups observed this run (classification for observability). */
  doubleheaders: Array<{ groupId: string; confidence: string; gamePks: number[] }>;
  /** Provider→DB reconciliation: distinct provider events vs rows present after apply. */
  reconcile: { expected: number; present: number; missingGamePks: number[] };
  ok: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Today's date in ET as YYYY-MM-DD (the feed's schedule-date convention). */
export function todayEasternDate(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/** Normalize one raw schedule game to a canonical provider event (or a rejection). */
export function normalizeRawScheduleGame(
  g: RawScheduleGame
): { event: MlbProviderGame } | { rejection: { gamePk: number | null; reason: string } } {
  const gamePk = typeof g.gamePk === "number" && Number.isFinite(g.gamePk) ? g.gamePk : null;
  if (gamePk === null) return { rejection: { gamePk: null, reason: "missing gamePk" } };

  const gameType = g.gameType ?? "R";
  if (!FEED_GAME_TYPES.has(gameType)) {
    return { rejection: { gamePk, reason: `non-feed gameType "${gameType}"` } };
  }

  const awayId = g.teams?.away?.team?.id;
  const homeId = g.teams?.home?.team?.id;
  const away = awayId != null ? MLB_BY_ID.get(awayId) : undefined;
  const home = homeId != null ? MLB_BY_ID.get(homeId) : undefined;
  if (!away || !home) {
    return {
      rejection: {
        gamePk,
        reason: `unknown team id(s) away=${awayId ?? "∅"} home=${homeId ?? "∅"} (${g.teams?.away?.team?.name ?? "?"} @ ${g.teams?.home?.team?.name ?? "?"})`,
      },
    };
  }

  // officialDate is the venue-local schedule date. Fall back to the ET date of
  // the start instant — NEVER the UTC calendar date (late games cross UTC midnight).
  const officialDate =
    g.officialDate && /^\d{4}-\d{2}-\d{2}$/.test(g.officialDate)
      ? g.officialDate
      : new Date(g.gameDate).toLocaleDateString("en-CA", { timeZone: "America/New_York" });

  return {
    event: {
      gamePk,
      officialDate,
      startUtc: g.gameDate,
      awayAbbrev: away.abbrev,
      homeAbbrev: home.abbrev,
      doubleHeader: g.doubleHeader,
      gameNumber: g.gameNumber,
      seriesGameNumber: g.seriesGameNumber,
      dayNight: g.dayNight,
      abstractGameState: g.status?.abstractGameState ?? "Preview",
      detailedState: g.status?.detailedState ?? "Scheduled",
      rescheduledFrom: g.rescheduledFrom?.slice(0, 10),
      venueName: g.venue?.name,
    },
  };
}

/** Fetch + normalize the provider schedule for a window. */
export async function fetchMlbScheduleWindow(
  startDate: string,
  endDate: string
): Promise<{ fetched: number; events: MlbProviderGame[]; rejected: Array<{ gamePk: number | null; reason: string }> }> {
  const url =
    `${MLB_STATS_API_BASE}/schedule?sportId=1&startDate=${startDate}&endDate=${endDate}&language=en`;
  console.log(`${TAG}[INPUT] window ${startDate} → ${endDate}`);
  console.log(`${TAG}[STEP] GET ${url}`);

  const resp = await fetch(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!resp.ok) throw new Error(`statsapi schedule HTTP ${resp.status} for ${startDate}→${endDate}`);
  const data = (await resp.json()) as RawScheduleResponse;

  const raw: RawScheduleGame[] = [];
  for (const dateEntry of data.dates ?? []) for (const g of dateEntry.games ?? []) raw.push(g);

  const events: MlbProviderGame[] = [];
  const rejected: Array<{ gamePk: number | null; reason: string }> = [];
  for (const g of raw) {
    const result = normalizeRawScheduleGame(g);
    if ("event" in result) events.push(result.event);
    else {
      rejected.push(result.rejection);
      console.log(`${TAG}[STATE] REJECT gamePk=${result.rejection.gamePk ?? "∅"}: ${result.rejection.reason}`);
    }
  }
  console.log(`${TAG}[STATE] fetched=${raw.length} parsed=${events.length} rejected=${rejected.length}`);
  return { fetched: raw.length, events, rejected };
}

// ─── Apply (real DB write path — exported so DB tests exercise it) ───────────

/**
 * Apply a reconciliation plan to the games table. Inserts and updates are
 * per-row with individual error capture: a duplicate-key rejection (identity
 * or matchup collision) is recorded as an applyError — never a silent merge
 * and never a crash that drops the rest of the slate.
 */
export async function applyMlbScheduleSyncPlan(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  plan: MlbScheduleSyncPlan
): Promise<{ inserted: number; updated: number; applyErrors: Array<{ gamePk: number; error: string }> }> {
  const applyErrors: Array<{ gamePk: number; error: string }> = [];
  let inserted = 0;
  let updated = 0;

  // ORDER MATTERS: updates BEFORE inserts. Incident shape: the adopted legacy
  // row still occupies (gameDate, teams, gameNumber=1) until its update stamps
  // gameNumber=2 — inserting Game 1 (also gameNumber=1) first would collide on
  // games_matchup_unique and the makeup game's insert would fail (proven by
  // [DH-DB-7] in the first CI db-tests run). Updates free the storage keys the
  // inserts need.
  //
  // TWO-PHASE RENUMBERING: a gameNumber/gameDate permutation between existing
  // rows (e.g. provider inverts G1/G2 numbering) makes the pairwise updates
  // mutually blocking — each targets the matchup key the other still holds,
  // so single-pass application deadlocks every cycle (audit finding #1).
  // Failed key-moving updates are parked on a unique NEGATIVE gameNumber
  // (freeing their keys), then re-applied in full.
  const deferredUpdates: typeof plan.updates = [];
  for (const upd of plan.updates) {
    try {
      await db.update(games).set(upd.set).where(eq(games.id, upd.rowId));
      updated++;
      console.log(
        `${TAG}[STEP] UPDATE id=${upd.rowId} gamePk=${upd.gamePk}${upd.adoptsLegacyRow ? " (adopted legacy row)" : ""} ` +
        `set=${JSON.stringify(upd.set)}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (upd.set.gameNumber !== undefined || upd.set.gameDate !== undefined) {
        console.warn(`${TAG}[STATE] UPDATE deferred id=${upd.rowId} gamePk=${upd.gamePk} (two-phase renumber): ${msg}`);
        deferredUpdates.push(upd);
      } else {
        applyErrors.push({ gamePk: upd.gamePk, error: msg });
        console.error(`${TAG}[ERROR] UPDATE failed id=${upd.rowId} gamePk=${upd.gamePk}: ${msg}`);
      }
    }
  }
  if (deferredUpdates.length > 0) {
    // Phase A: park every deferred row on a unique negative gameNumber so all
    // contested matchup keys are simultaneously free.
    let park = -1;
    for (const upd of deferredUpdates) {
      try {
        await db.update(games).set({ gameNumber: park-- }).where(eq(games.id, upd.rowId));
        console.log(`${TAG}[STEP] PARK id=${upd.rowId} gameNumber=${park + 1} (renumber staging)`);
      } catch (err) {
        console.warn(`${TAG}[STATE] PARK failed id=${upd.rowId} (continuing):`, err instanceof Error ? err.message : err);
      }
    }
    // Phase B: re-apply the original updates in full, always restoring the
    // intended final gameNumber (the park in Phase A overwrote it).
    for (const upd of deferredUpdates) {
      try {
        await db.update(games).set({ ...upd.set, gameNumber: upd.finalGameNumber }).where(eq(games.id, upd.rowId));
        updated++;
        console.log(`${TAG}[STEP] UPDATE (two-phase) id=${upd.rowId} gamePk=${upd.gamePk} set=${JSON.stringify(upd.set)}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        applyErrors.push({ gamePk: upd.gamePk, error: msg });
        console.error(`${TAG}[ERROR] UPDATE failed (two-phase) id=${upd.rowId} gamePk=${upd.gamePk}: ${msg}`);
      }
    }
  }

  const insertOnce = async (ins: MlbScheduleSyncPlan["inserts"][number]): Promise<true | string> => {
    try {
      await db.insert(games).values({
        fileId: 0,
        gameDate: ins.gameDate,
        startTimeEst: ins.startTimeEst,
        awayTeam: ins.awayTeam,
        homeTeam: ins.homeTeam,
        sport: "MLB",
        gameStatus: ins.gameStatus,
        mlbGamePk: ins.gamePk,
        gameNumber: ins.gameNumber,
        doubleHeader: ins.doubleHeader,
        venue: ins.venue,
        rescheduledFrom: ins.rescheduledFrom,
        publishedToFeed: false,
        publishedModel: false,
      });
      return true;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  };

  const retryQueue: Array<MlbScheduleSyncPlan["inserts"][number]> = [];
  for (const ins of plan.inserts) {
    const result = await insertOnce(ins);
    if (result === true) {
      inserted++;
      console.log(
        `${TAG}[STEP] INSERT gamePk=${ins.gamePk} ${ins.awayTeam}@${ins.homeTeam} ${ins.gameDate} ` +
        `G${ins.gameNumber} DH=${ins.doubleHeader} ${ins.startTimeEst} status=${ins.gameStatus} (${ins.dhConfidence})`
      );
    } else {
      console.warn(`${TAG}[STATE] INSERT deferred gamePk=${ins.gamePk} G${ins.gameNumber} (will retry once): ${result}`);
      retryQueue.push(ins);
    }
  }
  // One retry pass after the whole batch: covers transient key occupancy from
  // interleaved concurrent workers. A second failure is a real collision.
  for (const ins of retryQueue) {
    const result = await insertOnce(ins);
    if (result === true) {
      inserted++;
      console.log(`${TAG}[STEP] INSERT (retry) gamePk=${ins.gamePk} ${ins.awayTeam}@${ins.homeTeam} G${ins.gameNumber}`);
    } else {
      applyErrors.push({ gamePk: ins.gamePk, error: result });
      console.error(`${TAG}[ERROR] INSERT failed gamePk=${ins.gamePk} ${ins.awayTeam}@${ins.homeTeam} G${ins.gameNumber}: ${result}`);
    }
  }

  return { inserted, updated, applyErrors };
}

// ─── Main sync ───────────────────────────────────────────────────────────────

/**
 * Reconcile the provider schedule into the `games` table for a window.
 * Idempotent — safe to re-run (backfill/replay) at any time.
 */
export async function syncMlbSchedule(opts?: {
  startDate?: string;
  endDate?: string;
  source?: string;
}): Promise<MlbScheduleSyncResult | null> {
  const start = opts?.startDate ?? todayEasternDate(-1); // include yesterday: pre-11:00-UTC feed still shows it
  const end = opts?.endDate ?? todayEasternDate(7);
  const runId = `mlbsync-${start.replace(/-/g, "")}-${Date.now().toString(36)}`;
  console.log(`${TAG}[INPUT] runId=${runId} source=${opts?.source ?? "manual"} window=${start}→${end}`);

  const db = await getDb();
  if (!db) {
    console.warn(`${TAG}[STATE] DB unavailable — sync skipped`);
    return null;
  }

  // ── Fetch + normalize ──────────────────────────────────────────────────────
  let fetched: Awaited<ReturnType<typeof fetchMlbScheduleWindow>>;
  try {
    fetched = await fetchMlbScheduleWindow(start, end);
  } catch (err) {
    console.error(`${TAG}[ERROR] provider fetch failed (sync skipped, nothing lost — additive-only):`, err instanceof Error ? err.message : err);
    return null;
  }

  // ── Load existing rows for the window ──────────────────────────────────────
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
    .where(and(eq(games.sport, "MLB"), gte(games.gameDate, start), lte(games.gameDate, end)));

  // ── Date-unbounded identity lookup ─────────────────────────────────────────
  // A provider event's row may live OUTSIDE the window when the provider moved
  // the game to a new officialDate while KEEPING its gamePk. Proven live on
  // 2026-07-17: the postponed 2026-05-09 TB@BOS row still owned gamePk 824766
  // when statsapi rescheduled that same pk to July 17 — a window-only view
  // planned an INSERT that bounced off games_mlb_gamepk_unique every cycle.
  // Fetching every row whose pk appears in the provider slate lets the planner
  // relocate the row (gameDate move) instead.
  const providerPksInSlate = Array.from(new Set(fetched.events.map(e => e.gamePk)));
  const pkRows = providerPksInSlate.length > 0
    ? await db
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
        .where(and(eq(games.sport, "MLB"), inArray(games.mlbGamePk, providerPksInSlate)))
    : [];

  const seenRowIds = new Set<number>();
  const dbRows: DbGameRow[] = [];
  for (const r of [...rows, ...pkRows]) {
    if (seenRowIds.has(r.id)) continue;
    seenRowIds.add(r.id);
    dbRows.push({ ...r, mlbGamePk: r.mlbGamePk != null ? Number(r.mlbGamePk) : null });
  }
  const outOfWindow = pkRows.filter((r: typeof pkRows[number]) => r.gameDate < start || r.gameDate > end).length;
  console.log(`${TAG}[STATE] db rows: ${dbRows.length} (window=${rows.length}, out-of-window pk matches=${outOfWindow})`);

  // ── Plan (pure) ────────────────────────────────────────────────────────────
  const plan = planMlbScheduleSync(fetched.events, dbRows);
  for (const w of plan.warnings) console.warn(`${TAG}[STATE] WARN: ${w}`);
  for (const grp of plan.groups) {
    if (grp.gamePks.length > 1) {
      console.log(
        `${TAG}[DH] ${grp.groupId} confidence=${grp.confidence} games=[${grp.gamePks.join(",")}] ` +
        `numbers=[${grp.gamePks.map(pk => grp.resolvedGameNumbers.get(pk)).join(",")}]`
      );
    }
  }

  // ── Apply ──────────────────────────────────────────────────────────────────
  const { applyErrors, inserted, updated } = await applyMlbScheduleSyncPlan(db, plan);
  if (inserted > 0 || updated > 0) invalidateGamesCache();

  // ── Reconcile: every distinct provider event must now exist in the DB ──────
  const providerPks = Array.from(new Set(fetched.events.map(e => e.gamePk)));
  let presentPks = new Set<number>();
  if (providerPks.length > 0) {
    const present = await db
      .select({ mlbGamePk: games.mlbGamePk })
      .from(games)
      .where(and(eq(games.sport, "MLB"), inArray(games.mlbGamePk, providerPks)));
    presentPks = new Set(
      present.map((r: { mlbGamePk: number | null }) => Number(r.mlbGamePk)).filter((n: number) => Number.isFinite(n))
    );
  }
  const missingGamePks = providerPks.filter(pk => !presentPks.has(pk));

  const ok = missingGamePks.length === 0 && plan.collisions.length === 0 && applyErrors.length === 0;
  const result: MlbScheduleSyncResult = {
    runId,
    window: { start, end },
    fetched: fetched.fetched,
    parsed: fetched.events.length,
    rejected: [...fetched.rejected, ...plan.rejected],
    inserted,
    updated,
    unchanged: plan.counts.unchanged,
    adoptedLegacyRows: plan.counts.adoptedLegacyRows,
    applyErrors,
    collisions: plan.collisions,
    warnings: plan.warnings,
    doubleheaders: plan.groups
      .filter(g => g.gamePks.length > 1)
      .map(g => ({ groupId: g.groupId, confidence: g.confidence, gamePks: g.gamePks })),
    reconcile: { expected: providerPks.length, present: presentPks.size, missingGamePks },
    ok,
  };

  console.log(
    `${TAG}[OUTPUT] runId=${runId} fetched=${result.fetched} parsed=${result.parsed} ` +
    `rejected=${result.rejected.length} inserted=${inserted} updated=${updated} unchanged=${result.unchanged} ` +
    `adopted=${result.adoptedLegacyRows} dhGroups=${result.doubleheaders.length}`
  );
  console.log(
    `${TAG}[RECONCILE] provider distinct=${result.reconcile.expected} present in DB=${result.reconcile.present} ` +
    `missing=[${missingGamePks.join(",")}]`
  );
  console.log(`${TAG}[VERIFY] ${ok ? "PASS" : "FAIL"} — collisions=${plan.collisions.length} applyErrors=${applyErrors.length} missing=${missingGamePks.length}`);

  // ── Alert on any event loss — this must never be silent again ──────────────
  if (!ok) {
    const detail =
      (missingGamePks.length ? `missing gamePks after sync: [${missingGamePks.join(", ")}]\n` : "") +
      (plan.collisions.length ? `identity collisions: ${plan.collisions.map(c => `${c.gamePk}: ${c.reason}`).join("; ")}\n` : "") +
      (applyErrors.length ? `apply errors: ${applyErrors.map(e => `${e.gamePk}: ${e.error}`).join("; ")}` : "");
    console.error(`${TAG}[RECONCILE] ❌ EVENT LOSS OR COLLISION DETECTED (runId=${runId})\n${detail}`);
    try {
      await notifyOwner({
        title: `⚠️ MLB schedule sync lost events (${runId})`,
        content: `Window ${start}→${end}\n${detail}\nThe feed may be missing games (doubleheader-class incident). Re-run syncMlbSchedule after fixing.`,
      });
    } catch (notifErr) {
      console.warn(`${TAG}[STATE] owner notification failed (non-fatal):`, notifErr instanceof Error ? notifErr.message : notifErr);
    }
  }

  return result;
}
