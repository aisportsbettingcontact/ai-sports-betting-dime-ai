/**
 * mlbLineupsWatcher.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * MLB Lineups Watcher — monitors Rotowire lineup data and triggers the model
 * whenever a meaningful lineup change is detected.
 *
 * ─── Trigger Rules ────────────────────────────────────────────────────────────
 *
 *  CASE A — First lineup (no DB row yet, or row exists but lineupVersion=0):
 *    → Compute hash from current scrape data
 *    → Write lineupVersion=1, lineupHash=hash to DB
 *    → Trigger model immediately
 *    → Set lineupModeledVersion=1, lineupModeledAt=now
 *
 *  CASE B — Lineup changed (hash differs from stored hash):
 *    → Both sides FULLY confirmed? → STOP (confirmed lineups don't change)
 *    → Otherwise: increment lineupVersion, update lineupHash
 *    → Trigger model
 *    → Set lineupModeledVersion=lineupVersion, lineupModeledAt=now
 *
 *  CASE C — Lineup unchanged (hash matches stored hash):
 *    → No action needed
 *
 *  CASE D — Already confirmed (awayLineupConfirmed AND homeLineupConfirmed):
 *    → Never trigger model again regardless of hash
 *    → This is the stop guard: once both batting orders are locked, the model
 *      has already run on the final confirmed lineup and no further re-models
 *      are needed
 *
 * ─── Hash Construction ────────────────────────────────────────────────────────
 *
 *  The fingerprint covers all lineup-relevant fields:
 *    SHA256(
 *      awayPitcherName  (or "" if null)
 *      awayPitcherHand  (or "")
 *      homePitcherName  (or "" if null)
 *      homePitcherHand  (or "")
 *      awayLineup_JSON  (sorted by battingOrder, or "[]" if empty)
 *      homeLineup_JSON  (sorted by battingOrder, or "[]" if empty)
 *    )
 *
 *  Pitcher hand is included so a same-name pitcher switch (L→R) triggers re-model.
 *  Weather and umpire are NOT included — they don't affect the model inputs.
 *
 * ─── Modelability Gate ────────────────────────────────────────────────────────
 *
 *  A game must have BOTH pitchers present before the model can run.
 *  If only one pitcher is known, we still update the hash and version (so we
 *  detect the second pitcher arriving) but we do NOT trigger the model yet.
 *  The model trigger fires only when BOTH awayPitcherName AND homePitcherName
 *  are non-null AND the game has book lines (bookTotal + awayML + homeML).
 *
 * ─── Confirmed Stop Guard ─────────────────────────────────────────────────────
 *
 *  "Confirmed" = awayLineupConfirmed=true AND homeLineupConfirmed=true
 *  Pitcher-only confirmation does NOT stop the watcher — batting orders can
 *  still change after a pitcher is confirmed.
 *  Once both batting orders are confirmed, the watcher marks the game as done
 *  and never triggers the model again for that game.
 *
 * ─── Integration ──────────────────────────────────────────────────────────────
 *
 *  Called from vsinAutoRefresh.ts AFTER upsertLineupsToDB() completes.
 *  The watcher reads the freshly-upserted mlb_lineups rows, computes hashes,
 *  detects changes, and fires the model for affected games.
 *
 * ─── Logging Protocol ─────────────────────────────────────────────────────────
 *
 *  [INPUT]  source + parsed values
 *  [STEP]   operation description
 *  [STATE]  intermediate computations
 *  [OUTPUT] result
 *  [VERIFY] pass/fail + reason
 */

import { createHash } from "crypto";
import { eq, and, gte, lte, inArray } from "drizzle-orm";
import { getDb } from "./db.js";
import { mlbLineups, games } from "../drizzle/schema.js";
import type { MlbLineupRow } from "../drizzle/schema.js";
import type { RotoLineupGame } from "./rotowireLineupScraper.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LineupWatcherResult {
  /** Total games processed by the watcher */
  total: number;
  /** Games where lineup was seen for the first time → model triggered */
  firstLineup: number;
  /** Games where lineup changed → model re-triggered */
  changed: number;
  /** Games where lineup was unchanged → no action */
  unchanged: number;
  /** Games skipped because both lineups are confirmed → stop guard active */
  confirmed: number;
  /** Games skipped because insufficient data (missing pitchers or book lines) */
  insufficientData: number;
  /** Games where model was triggered but failed */
  modelErrors: number;
  /** Per-game detail log for debugging */
  details: LineupWatcherGameDetail[];
}

export interface LineupWatcherGameDetail {
  gameId: number;
  matchup: string;
  action: "first_lineup" | "changed" | "unchanged" | "confirmed_stop" | "insufficient_data" | "error";
  lineupVersion: number;
  lineupHash: string | null;
  previousHash: string | null;
  modelTriggered: boolean;
  reason: string;
}

// ─── Hash computation ─────────────────────────────────────────────────────────

/**
 * Compute a deterministic SHA-256 fingerprint of the lineup state.
 *
 * Input components (pipe-delimited, then hashed):
 *   awayPitcherName | awayPitcherHand | homePitcherName | homePitcherHand
 *   | awayLineup_canonical_JSON | homeLineup_canonical_JSON
 *
 * Canonical JSON = players sorted by battingOrder, only name+position+bats fields
 * (rotowireId and mlbamId are excluded — they're lookup artifacts, not lineup data).
 */
export function computeLineupHash(
  awayPitcherName: string | null | undefined,
  awayPitcherHand: string | null | undefined,
  homePitcherName: string | null | undefined,
  homePitcherHand: string | null | undefined,
  awayLineupJson: string | null | undefined,
  homeLineupJson: string | null | undefined,
): string {
  // Normalize pitcher fields — null/undefined → empty string
  const ap = (awayPitcherName ?? "").trim().toLowerCase();
  const aph = (awayPitcherHand ?? "").trim().toUpperCase();
  const hp = (homePitcherName ?? "").trim().toLowerCase();
  const hph = (homePitcherHand ?? "").trim().toUpperCase();

  // Canonical lineup: parse JSON, sort by battingOrder, keep only stable fields
  const canonicalize = (json: string | null | undefined): string => {
    if (!json) return "[]";
    try {
      const players = JSON.parse(json) as Array<{
        battingOrder: number;
        position: string;
        name: string;
        bats: string;
        rotowireId?: number | null;
        mlbamId?: number | null;
      }>;
      // Sort by battingOrder (should already be sorted, but enforce it)
      const sorted = [...players].sort((a, b) => a.battingOrder - b.battingOrder);
      // Only include stable lineup fields — exclude lookup artifacts
      const stable = sorted.map(p => ({
        b: p.battingOrder,
        pos: p.position,
        n: p.name.trim().toLowerCase(),
        bats: p.bats,
      }));
      return JSON.stringify(stable);
    } catch {
      return "[]";
    }
  };

  const awayCanon = canonicalize(awayLineupJson);
  const homeCanon = canonicalize(homeLineupJson);

  // Build the hash input string
  const input = [ap, aph, hp, hph, awayCanon, homeCanon].join("|");

  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Returns true if the hash represents a "null lineup" (no pitchers, no batting orders).
 * We don't want to trigger the model for a null-lineup hash.
 */
export function isNullLineupHash(hash: string): boolean {
  return hash === computeLineupHash(null, null, null, null, null, null);
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

/**
 * Fetch existing mlb_lineups rows for a list of gameIds.
 * Returns a Map<gameId, MlbLineupRow> for O(1) lookup.
 */
async function fetchExistingLineups(gameIds: number[]): Promise<Map<number, MlbLineupRow>> {
  const db = await getDb();
  if (!db || gameIds.length === 0) return new Map();

  const rows = await db
    .select()
    .from(mlbLineups)
    .where(inArray(mlbLineups.gameId, gameIds));

  const map = new Map<number, MlbLineupRow>();
  for (const row of rows) {
    map.set(row.gameId, row);
  }
  return map;
}

/**
 * Fetch games rows for a list of gameIds to check modelability (book lines present).
 */
async function fetchGamesForModelability(gameIds: number[]): Promise<Map<number, {
  bookTotal: string | null;
  awayML: string | null;
  homeML: string | null;
  awayTeam: string | null;
  homeTeam: string | null;
  gameDate: string;
}>> {
  const db = await getDb();
  if (!db || gameIds.length === 0) return new Map();

  const rows = await db
    .select({
      id: games.id,
      bookTotal: games.bookTotal,
      awayML: games.awayML,
      homeML: games.homeML,
      awayTeam: games.awayTeam,
      homeTeam: games.homeTeam,
      gameDate: games.gameDate,
    })
    .from(games)
    .where(inArray(games.id, gameIds));

  const map = new Map<number, typeof rows[0]>();
  for (const row of rows) {
    map.set(row.id, row);
  }
  return map;
}

/**
 * Update lineupHash, lineupVersion, lineupModeledAt, lineupModeledVersion
 * for a given gameId after a model trigger.
 */
async function markLineupModeled(
  gameId: number,
  newHash: string,
  newVersion: number,
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db
    .update(mlbLineups)
    .set({
      lineupHash: newHash,
      lineupVersion: newVersion,
      lineupModeledAt: BigInt(Date.now()),
      lineupModeledVersion: newVersion,
      updatedAt: new Date(),
    })
    .where(eq(mlbLineups.gameId, gameId));
}

/**
 * Update lineupHash and lineupVersion WITHOUT triggering the model.
 * Used when lineup data changes but game is not yet modelable (missing pitchers/lines).
 */
async function updateLineupHashOnly(
  gameId: number,
  newHash: string,
  newVersion: number,
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db
    .update(mlbLineups)
    .set({
      lineupHash: newHash,
      lineupVersion: newVersion,
      updatedAt: new Date(),
    })
    .where(eq(mlbLineups.gameId, gameId));
}

// ─── Main watcher function ────────────────────────────────────────────────────

/**
 * Run the lineup watcher for a set of scraped games.
 *
 * @param scrapedGames - Array of RotoLineupGame from the scraper (already upserted to DB)
 * @param gameIdMap    - Exact scraped-game object → DB gameId (built by upsertLineupsToDB)
 *   Object identity preserves cardinality for same-matchup doubleheaders.
 * @param dateStr      - Date string "YYYY-MM-DD" for model runner scoping
 */
export async function runLineupWatcher(
  scrapedGames: RotoLineupGame[],
  gameIdMap: Map<RotoLineupGame, number>,
  dateStr: string,
): Promise<LineupWatcherResult> {
  const TAG = `[LineupWatcher][${dateStr}]`;
  console.log(`${TAG} Starting — ${scrapedGames.length} scraped games`);

  const result: LineupWatcherResult = {
    total: scrapedGames.length,
    firstLineup: 0,
    changed: 0,
    unchanged: 0,
    confirmed: 0,
    insufficientData: 0,
    modelErrors: 0,
    details: [],
  };

  if (scrapedGames.length === 0) {
    console.log(`${TAG} No games to process`);
    return result;
  }

  // ── Step 1: Collect all gameIds for this batch ───────────────────────────────
  const gameIds: number[] = [];
  const gameToId = new Map<RotoLineupGame, number>();

  for (const g of scrapedGames) {
    const gameId = gameIdMap.get(g);
    if (gameId !== undefined) {
      gameIds.push(gameId);
      gameToId.set(g, gameId);
    }
  }

  console.log(`${TAG} [STEP] Resolved ${gameIds.length}/${scrapedGames.length} gameIds`);

  if (gameIds.length === 0) {
    console.log(`${TAG} No gameIds resolved — all games unmatched in DB`);
    return result;
  }

  // ── Step 2: Batch-fetch existing lineup rows and game modelability ───────────
  const [existingLineups, gamesData] = await Promise.all([
    fetchExistingLineups(gameIds),
    fetchGamesForModelability(gameIds),
  ]);

  console.log(
    `${TAG} [STATE] Existing lineup rows: ${existingLineups.size} | ` +
    `Games with data: ${gamesData.size}`
  );

  // ── Step 3: Collect games that need model re-run ─────────────────────────────
  const gamesToModel: number[] = [];
  const pendingHashUpdates: Array<{
    gameId: number;
    hash: string;
    version: number;
    triggerModel: boolean;
  }> = [];
  // Pitcher writes: map gameId → { awayPitcherName, homeStartingPitcher }
  // Written to games table BEFORE model run so mlbModelRunner can read them.
  const pendingPitcherWrites = new Map<number, { away: string; home: string }>();

  for (const g of scrapedGames) {
    const gameId = gameToId.get(g);
    if (gameId === undefined) continue;

    const matchup = `${g.awayAbbrev}@${g.homeAbbrev}`;
    const gameTag = `${TAG}[${matchup}]`;
    const existing = existingLineups.get(gameId);
    const gameRow = gamesData.get(gameId);

    // Compute current hash from scraped data
    const currentHash = computeLineupHash(
      g.awayPitcher?.name,
      g.awayPitcher?.hand,
      g.homePitcher?.name,
      g.homePitcher?.hand,
      g.awayLineup.length > 0 ? JSON.stringify(g.awayLineup) : null,
      g.homeLineup.length > 0 ? JSON.stringify(g.homeLineup) : null,
    );

    const isNullHash = isNullLineupHash(currentHash);

    // ── CASE D: Both lineups confirmed → stop guard ──────────────────────────
    // P0 FIX: Only skip if lineupModeledAt is set (model has already run for this game).
    // If lineupModeledAt is null, the model never fired — fall through to trigger it
    // even though both lineups are confirmed (e.g. server restart after lineups posted).
    if (existing?.awayLineupConfirmed && existing?.homeLineupConfirmed && existing?.lineupModeledAt) {
      console.log(
        `${gameTag} [STATE] CONFIRMED_STOP — both lineups confirmed + model already ran ` +
        `(lineupModeledAt=${existing.lineupModeledAt}), no re-model needed`
      );
      result.confirmed++;
      result.details.push({
        gameId,
        matchup,
        action: "confirmed_stop",
        lineupVersion: existing.lineupVersion,
        lineupHash: existing.lineupHash ?? null,
        previousHash: existing.lineupHash ?? null,
        modelTriggered: false,
        reason: "Both batting orders confirmed + model already ran — stop guard active",
      });
      continue;
    }

     // ── CASE C: Lineup unchanged ─────────────────────────────────────────
    // P0 FIX: Only skip if lineupModeledAt is set (model has already run for this game).
    // If lineupModeledAt is null, the model never fired — fall through to trigger it
    // even though the hash hasn’t changed (e.g. server restart after first scrape).
    if (existing?.lineupHash && existing.lineupHash === currentHash && existing?.lineupModeledAt) {
      console.log(
        `${gameTag} [STATE] UNCHANGED — hash=${currentHash.slice(0, 12)}... ` +
        `model already ran (lineupModeledAt=${existing.lineupModeledAt}), no action`
      );
      result.unchanged++;
      result.details.push({
        gameId,
        matchup,
        action: "unchanged",
        lineupVersion: existing.lineupVersion,
        lineupHash: currentHash,
        previousHash: existing.lineupHash,
        modelTriggered: false,
        reason: "Hash unchanged + model already ran",
      });
      continue;
    }

    // ── Null lineup check: no pitchers AND no batting orders ─────────────────
    if (isNullHash) {
      console.log(`${gameTag} [STATE] NULL_LINEUP — no pitchers/batting orders yet, skipping`);
      result.insufficientData++;
      result.details.push({
        gameId,
        matchup,
        action: "insufficient_data",
        lineupVersion: existing?.lineupVersion ?? 0,
        lineupHash: null,
        previousHash: existing?.lineupHash ?? null,
        modelTriggered: false,
        reason: "No pitchers or batting orders available yet",
      });
      continue;
    }

    // ── Determine new version ────────────────────────────────────────────────
    const previousVersion = existing?.lineupVersion ?? 0;
    const newVersion = previousVersion === 0 ? 1 : previousVersion + 1;
    const isFirstLineup = previousVersion === 0;

    // ── Modelability check ───────────────────────────────────────────────────
    // Model requires: both pitchers + book lines (bookTotal + awayML + homeML)
    const hasBothPitchers = !!(g.awayPitcher?.name && g.homePitcher?.name);
    const hasBookLines = !!(gameRow?.bookTotal && gameRow?.awayML && gameRow?.homeML);
    const isModelable = hasBothPitchers && hasBookLines;

    if (!isModelable) {
      const missingParts: string[] = [];
      if (!g.awayPitcher?.name) missingParts.push("away pitcher");
      if (!g.homePitcher?.name) missingParts.push("home pitcher");
      if (!gameRow?.bookTotal) missingParts.push("bookTotal");
      if (!gameRow?.awayML) missingParts.push("awayML");
      if (!gameRow?.homeML) missingParts.push("homeML");

      console.log(
        `${gameTag} [STATE] ${isFirstLineup ? "FIRST_LINEUP" : "CHANGED"} ` +
        `v${previousVersion}→v${newVersion} hash=${currentHash.slice(0, 12)}... ` +
        `NOT_MODELABLE (missing: ${missingParts.join(", ")}) — updating hash only`
      );

      // Still update hash/version so we detect future changes
      pendingHashUpdates.push({ gameId, hash: currentHash, version: newVersion, triggerModel: false });

      result.insufficientData++;
      result.details.push({
        gameId,
        matchup,
        action: isFirstLineup ? "first_lineup" : "changed",
        lineupVersion: newVersion,
        lineupHash: currentHash,
        previousHash: existing?.lineupHash ?? null,
        modelTriggered: false,
        reason: `Lineup ${isFirstLineup ? "first seen" : "changed"} but not modelable — missing: ${missingParts.join(", ")}`,
      });
      continue;
    }

    // ── CASE A / B: First lineup or changed lineup → trigger model ───────────
    const actionLabel = isFirstLineup ? "FIRST_LINEUP" : "CHANGED";
    console.log(
      `${gameTag} [STATE] ${actionLabel} ` +
      `v${previousVersion}→v${newVersion} ` +
      `hash=${currentHash.slice(0, 12)}... ` +
      `awayP="${g.awayPitcher!.name}" (${g.awayPitcher!.hand}) ` +
      `homeP="${g.homePitcher!.name}" (${g.homePitcher!.hand}) ` +
      `awayLineup=${g.awayLineup.length}/9 (${g.awayLineupConfirmed ? "CONFIRMED" : "expected"}) ` +
      `homeLineup=${g.homeLineup.length}/9 (${g.homeLineupConfirmed ? "CONFIRMED" : "expected"}) ` +
      `→ TRIGGERING MODEL`
    );

    pendingHashUpdates.push({ gameId, hash: currentHash, version: newVersion, triggerModel: true });
    gamesToModel.push(gameId);
    // Register pitcher names for games-table write (bridge: Rotowire → games.awayStartingPitcher)
    pendingPitcherWrites.set(gameId, {
      away: g.awayPitcher!.name,
      home: g.homePitcher!.name,
    });

    if (isFirstLineup) {
      result.firstLineup++;
    } else {
      result.changed++;
    }

    result.details.push({
      gameId,
      matchup,
      action: isFirstLineup ? "first_lineup" : "changed",
      lineupVersion: newVersion,
      lineupHash: currentHash,
      previousHash: existing?.lineupHash ?? null,
      modelTriggered: true,
      reason: `${actionLabel}: awayP=${g.awayPitcher!.name}, homeP=${g.homePitcher!.name}, awayLineup=${g.awayLineup.length}/9, homeLineup=${g.homeLineup.length}/9`,
    });
  }

  // ── Step 4: Apply all hash updates ──────────────────────────────────────────
  if (pendingHashUpdates.length > 0) {
    console.log(`${TAG} [STEP] Applying ${pendingHashUpdates.length} hash updates to DB`);
    await Promise.all(
      pendingHashUpdates.map(u =>
        u.triggerModel
          ? markLineupModeled(u.gameId, u.hash, u.version)
          : updateLineupHashOnly(u.gameId, u.hash, u.version)
      )
    );
    console.log(`${TAG} [STATE] Hash updates applied`);
  }

  // ── Step 4b: Write pitcher names from Rotowire → games.awayStartingPitcher / homeStartingPitcher ──
  // This is the critical bridge: mlbModelRunner reads pitchers from games table, not mlb_lineups.
  // Without this write, games with Rotowire pitchers but no MLB Stats API probable pitcher
  // (common for tomorrow's games) will be skipped by the model with hasPitchers=false.
  if (pendingPitcherWrites.size > 0) {
    console.log(`${TAG} [STEP] Writing ${pendingPitcherWrites.size} pitcher pair(s) to games table`);
    const db = await getDb();
    if (db) {
      const pitcherWriteResults: string[] = [];
      for (const [gameId, pitchers] of Array.from(pendingPitcherWrites)) {
        try {
          await db
            .update(games)
            .set({
              awayStartingPitcher: pitchers.away,
              homeStartingPitcher: pitchers.home,
            })
            .where(eq(games.id, gameId));
          pitcherWriteResults.push(
            `gameId=${gameId} awayP="${pitchers.away}" homeP="${pitchers.home}" [WRITTEN]`
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`${TAG} [ERROR] Pitcher write failed for gameId=${gameId}: ${msg}`);
          pitcherWriteResults.push(`gameId=${gameId} [ERROR: ${msg}]`);
        }
      }
      console.log(
        `${TAG} [OUTPUT] Pitcher writes complete:\n` +
        pitcherWriteResults.map(r => `  ${r}`).join('\n')
      );
    } else {
      console.warn(`${TAG} [WARN] DB not available — pitcher writes skipped`);
    }
  }

  // ── Step 5: Trigger model for affected games ─────────────────────────────────
  if (gamesToModel.length > 0) {
    console.log(`${TAG} [STEP] Triggering model for ${gamesToModel.length} game(s): ${gamesToModel.join(", ")}`);
    try {
      const { runMlbModelForDate } = await import("./mlbModelRunner.js");
      const modelResult = await runMlbModelForDate(dateStr);
      console.log(
        `${TAG} [OUTPUT] Model run complete: ` +
        `written=${modelResult.written} skipped=${modelResult.skipped} errors=${modelResult.errors} ` +
        `validation=${modelResult.validation.passed ? "✅ PASSED" : "❌ FAILED (" + modelResult.validation.issues.length + " issues)"}`
      );
      if (!modelResult.validation.passed) {
        console.error(`${TAG} [VERIFY] FAIL — Model validation issues:`, modelResult.validation.issues);
      } else {
        console.log(`${TAG} [VERIFY] PASS — Model ran successfully for lineup-triggered games`);
      }
      if (modelResult.errors > 0) {
        result.modelErrors += modelResult.errors;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${TAG} [ERROR] Model run failed: ${msg}`);
      result.modelErrors += gamesToModel.length;
    }
  } else {
    console.log(`${TAG} [STEP] No model trigger needed this cycle`);
  }

  // ── Step 6: Summary ──────────────────────────────────────────────────────────
  console.log(
    `${TAG} [OUTPUT] Done — ` +
    `total=${result.total} ` +
    `firstLineup=${result.firstLineup} ` +
    `changed=${result.changed} ` +
    `unchanged=${result.unchanged} ` +
    `confirmed=${result.confirmed} ` +
    `insufficientData=${result.insufficientData} ` +
    `modelErrors=${result.modelErrors}`
  );

  return result;
}
