/**
 * mlbPlayerSync.ts
 *
 * Nightly MLB active-roster sync against the MLB Stats API.
 *
 * Schedule : 08:00 UTC every day (started from server/_core/index.ts)
 * API      : https://statsapi.mlb.com/api/v1/sports/1/players?season=YYYY&gameType=R
 * DB tables: mlb_players, mlb_teams (read-only for brAbbrev lookup)
 *
 * What it does on each run:
 *   1. Fetches all players the MLB Stats API considers active for the current season.
 *   2. Builds a lookup of mlbTeamId → brAbbrev from the mlb_teams table.
 *   3. For every API player:
 *        • If mlbamId is unknown (new player) → INSERT with isActive=true.
 *        • If mlbamId exists and team/status/position changed → UPDATE only changed fields.
 *        • If mlbamId exists and nothing changed → SKIP (no DB write, no log noise).
 *   4. For every DB player NOT seen in the API response → mark isActive=false.
 *   5. Emits a structured summary: fetched, inserted, updated, deactivated, skipped, errors.
 *
 * Logging conventions:
 *   [MlbPlayerSync] prefix on every line.
 *   ✓ inserted / ↻ updated / ✗ deactivated / ⚠ warning / ✕ error
 *   Final summary line always emitted even on partial failure.
 */

import { getDb } from "./db";
import { mlbPlayers, mlbTeams } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const TAG = "[MlbPlayerSync]";
const MLB_STATS_API = "https://statsapi.mlb.com/api/v1/sports/1/players";
const SYNC_TIMEOUT_MS = 30_000; // 30-second hard timeout on the API fetch

// ─── MLB Stats API response types ────────────────────────────────────────────

interface MlbApiPlayer {
  id: number;
  fullName: string;
  firstName: string;
  lastName: string;
  primaryNumber?: string;
  active: boolean;
  currentTeam?: { id: number };
  primaryPosition?: { name: string; abbreviation: string };
  batSide?: { code: string };
  pitchHand?: { code: string };
  nameSlug?: string;
}

interface MlbApiResponse {
  people: MlbApiPlayer[];
}

// ─── MLB team ID → brAbbrev lookup ───────────────────────────────────────────

async function buildTeamLookup(): Promise<Map<number, string>> {
  const db = await getDb();
  const teams = await db
    .select({ mlbId: mlbTeams.mlbId, brAbbrev: mlbTeams.brAbbrev })
    .from(mlbTeams);
  const map = new Map<number, string>();
  for (const t of teams) {
    map.set(t.mlbId, t.brAbbrev);
  }
  console.log(
    `${TAG} Team lookup built — ${map.size} MLB teams loaded from DB`
  );
  return map;
}

// ─── Fetch from MLB Stats API ─────────────────────────────────────────────────

async function fetchActivePlayers(season: number): Promise<MlbApiPlayer[]> {
  const url = `${MLB_STATS_API}?season=${season}&gameType=R`;
  console.log(
    `${TAG} Fetching active players from MLB Stats API — season=${season}`
  );
  console.log(`${TAG} URL: ${url}`);

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
    console.error(`${TAG} ✕ API fetch timed out after ${SYNC_TIMEOUT_MS}ms`);
  }, SYNC_TIMEOUT_MS);

  let resp: Response;
  try {
    resp = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    throw new Error(
      `MLB Stats API returned HTTP ${resp.status} ${resp.statusText}`
    );
  }

  const data = (await resp.json()) as MlbApiResponse;
  const players = data.people ?? [];
  console.log(
    `${TAG} API response received — ${players.length} players returned`
  );
  return players;
}

// ─── Core sync logic ──────────────────────────────────────────────────────────

export async function runMlbPlayerSync(): Promise<void> {
  const startMs = Date.now();
  const season = new Date().getFullYear();

  console.log(`${TAG} ─────────────────────────────────────────────`);
  console.log(
    `${TAG} Sync started at ${new Date().toISOString()} (season=${season})`
  );

  const stats = {
    fetched: 0,
    inserted: 0,
    updated: 0,
    deactivated: 0,
    skipped: 0,
    errors: 0,
  };

  // ── Step 1: Load team lookup ──────────────────────────────────────────────
  let teamLookup: Map<number, string>;
  try {
    teamLookup = await buildTeamLookup();
  } catch (err) {
    console.error(`${TAG} ✕ Failed to load team lookup from DB:`, err);
    console.error(
      `${TAG} Sync aborted — cannot resolve team abbreviations without team table`
    );
    return;
  }

  // ── Step 2: Fetch from MLB Stats API ─────────────────────────────────────
  let apiPlayers: MlbApiPlayer[];
  try {
    apiPlayers = await fetchActivePlayers(season);
  } catch (err) {
    console.error(`${TAG} ✕ MLB Stats API fetch failed:`, err);
    console.error(`${TAG} Sync aborted — no data to process`);
    return;
  }

  stats.fetched = apiPlayers.length;

  if (stats.fetched === 0) {
    console.warn(
      `${TAG} ⚠ API returned 0 players — this is unexpected for season=${season}. Aborting to avoid mass-deactivation.`
    );
    return;
  }

  // ── Step 3: Load all existing DB players ─────────────────────────────────
  const db = await getDb();

  type DbPlayer = {
    id: number;
    brId: string;
    mlbamId: number | null;
    name: string;
    position: string | null;
    bats: string | null;
    throws: string | null;
    currentTeamBrAbbrev: string | null;
    isActive: boolean;
  };

  let dbPlayerList: DbPlayer[];
  try {
    dbPlayerList = await db
      .select({
        id: mlbPlayers.id,
        brId: mlbPlayers.brId,
        mlbamId: mlbPlayers.mlbamId,
        name: mlbPlayers.name,
        position: mlbPlayers.position,
        bats: mlbPlayers.bats,
        throws: mlbPlayers.throws,
        currentTeamBrAbbrev: mlbPlayers.currentTeamBrAbbrev,
        isActive: mlbPlayers.isActive,
      })
      .from(mlbPlayers);
    console.log(
      `${TAG} DB snapshot loaded — ${dbPlayerList.length} existing player records`
    );
  } catch (err) {
    console.error(`${TAG} ✕ Failed to load existing players from DB:`, err);
    console.error(`${TAG} Sync aborted`);
    return;
  }

  // Build fast lookup: mlbamId → DB record
  const dbByMlbamId = new Map<number, DbPlayer>();
  for (const p of dbPlayerList) {
    if (p.mlbamId != null) dbByMlbamId.set(p.mlbamId, p);
  }

  // Track which mlbamIds we see from the API (for deactivation step)
  const seenMlbamIds = new Set<number>();

  // ── Step 4: Process each API player ──────────────────────────────────────
  for (const ap of apiPlayers) {
    const mlbamId = ap.id;
    seenMlbamIds.add(mlbamId);

    const teamId = ap.currentTeam?.id;
    const brAbbrev = teamId ? (teamLookup.get(teamId) ?? null) : null;
    const position = ap.primaryPosition?.name ?? null;
    const bats = ap.batSide?.code ?? null;
    const throwsVal = ap.pitchHand?.code ?? null;
    const name = ap.fullName;

    if (!brAbbrev && teamId) {
      console.warn(
        `${TAG} ⚠ Unknown MLB team ID ${teamId} for player "${name}" (mlbamId=${mlbamId}) — not in mlb_teams table`
      );
    }

    const existing = dbByMlbamId.get(mlbamId);

    if (!existing) {
      // ── INSERT: new player not yet in DB ──────────────────────────────
      // Use "mlbam_{id}" as a synthetic brId — unique constraint satisfied.
      // Can be updated later when cross-referenced with Baseball Reference.
      const syntheticBrId = `mlbam_${mlbamId}`;
      try {
        await db.insert(mlbPlayers).values({
          brId: syntheticBrId,
          mlbamId,
          name,
          position,
          bats,
          throws: throwsVal,
          currentTeamBrAbbrev: brAbbrev,
          isActive: true,
          lastSyncedAt: Date.now(),
        });
        console.log(
          `${TAG} ✓ inserted  mlbamId=${mlbamId} brId=${syntheticBrId} name="${name}" team=${brAbbrev ?? "?"} pos=${position ?? "?"}`
        );
        stats.inserted++;
      } catch (err) {
        console.error(
          `${TAG} ✕ insert failed for mlbamId=${mlbamId} name="${name}":`,
          (err as Error).message
        );
        stats.errors++;
      }
      continue;
    }

    // ── UPDATE or SKIP: player already in DB ─────────────────────────────
    const changes: Record<string, { from: unknown; to: unknown }> = {};

    if (existing.name !== name)
      changes.name = { from: existing.name, to: name };
    if (existing.position !== position)
      changes.position = { from: existing.position, to: position };
    if (existing.bats !== bats)
      changes.bats = { from: existing.bats, to: bats };
    if (existing.throws !== throwsVal)
      changes.throws = { from: existing.throws, to: throwsVal };
    if (existing.currentTeamBrAbbrev !== brAbbrev)
      changes.currentTeamBrAbbrev = {
        from: existing.currentTeamBrAbbrev,
        to: brAbbrev,
      };
    if (!existing.isActive) changes.isActive = { from: false, to: true }; // reactivate if back on roster

    if (Object.keys(changes).length === 0) {
      stats.skipped++;
      continue;
    }

    const changeDesc = Object.entries(changes)
      .map(
        ([field, { from, to }]) =>
          `${field}: ${JSON.stringify(from)} → ${JSON.stringify(to)}`
      )
      .join(", ");

    try {
      await db
        .update(mlbPlayers)
        .set({
          name,
          position,
          bats,
          throws: throwsVal,
          currentTeamBrAbbrev: brAbbrev,
          isActive: true,
          lastSyncedAt: Date.now(),
        })
        .where(eq(mlbPlayers.id, existing.id));
      console.log(
        `${TAG} ↻ updated   mlbamId=${mlbamId} brId=${existing.brId} name="${name}" — ${changeDesc}`
      );
      stats.updated++;
    } catch (err) {
      console.error(
        `${TAG} ✕ update failed for mlbamId=${mlbamId} brId=${existing.brId}:`,
        (err as Error).message
      );
      stats.errors++;
    }
  }

  // ── Step 5: Deactivate players absent from API response ──────────────────
  // Players who were active in DB but not returned by the API today —
  // released, 60-day IL, retired, or optioned to minors.
  const toDeactivate = dbPlayerList.filter(
    p => p.isActive && p.mlbamId != null && !seenMlbamIds.has(p.mlbamId!)
  );

  if (toDeactivate.length > 0) {
    console.log(
      `${TAG} Deactivating ${toDeactivate.length} players absent from API response…`
    );
    for (const p of toDeactivate) {
      try {
        await db
          .update(mlbPlayers)
          .set({ isActive: false, lastSyncedAt: Date.now() })
          .where(eq(mlbPlayers.id, p.id));
        console.log(
          `${TAG} ✗ deactivated mlbamId=${p.mlbamId ?? "?"} brId=${p.brId} name="${p.name}" (was team=${p.currentTeamBrAbbrev ?? "?"})`
        );
        stats.deactivated++;
      } catch (err) {
        console.error(
          `${TAG} ✕ deactivate failed for brId=${p.brId}:`,
          (err as Error).message
        );
        stats.errors++;
      }
    }
  }

  // ── Step 6: Summary ───────────────────────────────────────────────────────
  const elapsedMs = Date.now() - startMs;
  const status =
    stats.errors === 0
      ? "✓ SUCCESS"
      : `⚠ COMPLETED WITH ${stats.errors} ERROR(S)`;

  console.log(`${TAG} ─────────────────────────────────────────────`);
  console.log(`${TAG} ${status} in ${elapsedMs}ms`);
  console.log(
    `${TAG} fetched=${stats.fetched} inserted=${stats.inserted} updated=${stats.updated} deactivated=${stats.deactivated} skipped=${stats.skipped} errors=${stats.errors}`
  );
  console.log(`${TAG} ─────────────────────────────────────────────`);
}

// ─── Scheduler: 08:00 UTC daily ──────────────────────────────────────────────

/**
 * Returns milliseconds until the next 08:00:00 UTC.
 * If 08:00 UTC today has already passed, returns ms until 08:00 UTC tomorrow.
 */
function msUntilNext0800Utc(): number {
  const now = new Date();
  const target = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      8,
      0,
      0,
      0 // 08:00:00.000 UTC
    )
  );

  let ms = target.getTime() - now.getTime();
  if (ms <= 0) {
    // 08:00 UTC today already passed — schedule for tomorrow
    ms += 24 * 60 * 60 * 1000;
  }
  return ms;
}

/**
 * Start the nightly MLB player sync scheduler.
 *
 * First run fires at the next 08:00 UTC; subsequent runs every 24 hours.
 * Resilient: unhandled errors are caught so the next run is still scheduled.
 */
export function startMlbPlayerSyncScheduler(): void {
  const msToFirst = msUntilNext0800Utc();
  const nextRun = new Date(Date.now() + msToFirst);

  console.log(
    `${TAG} Scheduler registered — next sync at ${nextRun.toISOString()} UTC ` +
      `(in ${Math.round(msToFirst / 1000 / 60)} min)`
  );

  setTimeout(async () => {
    try {
      await runMlbPlayerSync();
    } catch (err) {
      console.error(`${TAG} ✕ Unhandled error in sync run:`, err);
    }

    // Repeat every 24 hours after the first run
    setInterval(
      async () => {
        try {
          await runMlbPlayerSync();
        } catch (err) {
          console.error(`${TAG} ✕ Unhandled error in sync run:`, err);
        }
      },
      24 * 60 * 60 * 1000
    );
  }, msToFirst);
}
