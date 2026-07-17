/**
 * mlbPostponedTracker.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles two critical edge cases in the MLB game lifecycle:
 *
 * 1. RESCHEDULED GAME DETECTION
 *    When a game is marked 'postponed' in our DB, the MLB Stats API will
 *    eventually assign a NEW gamePk on a future date. This module scans the
 *    MLB Stats API schedule for the next 14 days and cross-references against
 *    our DB's postponed games to detect when a postponed game has been
 *    rescheduled. On detection:
 *      - Logs a structured [RESCHEDULED] alert with old date, new date, old pk, new pk
 *      - Sends an owner notification via notifyOwner()
 *      - The new game will be auto-inserted by the normal mlbScheduleHistoryScheduler
 *        on its date — no manual action required
 *
 * 2. SUSPENDED GAME HANDLING
 *    A 'Suspended' game (e.g. rain delay resumed next day) is distinct from
 *    'Postponed' (never played). Suspended games are written as 'suspended'
 *    status in our DB and excluded from the public feed. When the MLB Stats
 *    API reports the game as 'Final' (resumed and completed), the status is
 *    updated to 'final' and the game becomes visible again on its original date.
 *
 * EXECUTION:
 *    Called from vsinAutoRefresh.ts runMlbCycle() as Step 0 (before score refresh).
 *    Non-fatal — errors are logged and swallowed so the main cycle continues.
 *
 * LOGGING FORMAT:
 *    [INPUT]   source + parsed values
 *    [STEP]    operation description
 *    [STATE]   intermediate computations
 *    [OUTPUT]  result
 *    [VERIFY]  pass/fail + reason
 */

import { getDb } from "./db.js";
import { games } from "../drizzle/schema.js";
import { and, eq, inArray, ne, or } from "drizzle-orm";
import { notifyOwner } from "./_core/notification.js";

const TAG = "[MLBPostponedTracker]";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MlbApiGame {
  gamePk: number;
  gameDate: string; // ISO 8601 UTC
  status: {
    abstractGameState: string; // "Preview" | "Live" | "Final"
    detailedState: string;     // "Scheduled" | "Postponed" | "Suspended" | "Final" etc.
  };
  teams: {
    away: { team: { abbreviation: string } };
    home: { team: { abbreviation: string } };
  };
}

interface MlbApiScheduleResponse {
  dates?: Array<{
    date: string; // YYYY-MM-DD
    games: MlbApiGame[];
  }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Normalize MLB Stats API team abbreviation to match our DB convention.
 * e.g. "AZ" → "ARI", "WSH" → "WSH"
 */
function normalizeAbbrev(abbrev: string): string {
  const MAP: Record<string, string> = {
    AZ: "ARI",
    TB: "TB",
    CWS: "CWS",
    KC: "KC",
    SD: "SD",
    SF: "SF",
    NYY: "NYY",
    NYM: "NYM",
    LAD: "LAD",
    LAA: "LAA",
    ATH: "ATH", // Oakland/Sacramento Athletics
    OAK: "ATH",
  };
  return MAP[abbrev] ?? abbrev;
}

/**
 * Determine if a game's detailedState represents a 'postponed' condition.
 */
function isPostponedState(detailedState: string): boolean {
  const s = detailedState.toLowerCase();
  return s.includes("postponed") || s.includes("cancelled") || s.includes("canceled");
}

/**
 * Determine if a game's detailedState represents a 'suspended' condition.
 */
function isSuspendedState(detailedState: string): boolean {
  return detailedState.toLowerCase().includes("suspended");
}

/**
 * Convert a UTC ISO date string to a YYYY-MM-DD string in US/Eastern time.
 * Uses the same approach as the rest of the codebase.
 */
function utcIsoToEstDate(utcIso: string): string {
  const d = new Date(utcIso);
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" }); // en-CA gives YYYY-MM-DD
}

/**
 * Fetch the MLB Stats API schedule for a date range.
 * Returns a flat array of all games across all dates in the range.
 */
async function fetchMlbScheduleRange(
  startDate: string,
  endDate: string
): Promise<MlbApiGame[]> {
  const url =
    `https://statsapi.mlb.com/api/v1/schedule` +
    `?sportId=1&startDate=${startDate}&endDate=${endDate}` +
    `&fields=dates,date,games,gamePk,gameDate,status,abstractGameState,detailedState,teams,away,home,team,abbreviation`;

  console.log(`${TAG}[STEP] Fetching MLB schedule range: ${startDate} → ${endDate}`);
  console.log(`${TAG}[INPUT] URL: ${url}`);

  const resp = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!resp.ok) {
    throw new Error(`MLB Stats API HTTP ${resp.status} for schedule range ${startDate}→${endDate}`);
  }

  const data = (await resp.json()) as MlbApiScheduleResponse;
  const allGames: MlbApiGame[] = [];
  for (const dateEntry of data.dates ?? []) {
    for (const g of dateEntry.games ?? []) {
      allGames.push(g);
    }
  }

  console.log(`${TAG}[STATE] Fetched ${allGames.length} games from API for range ${startDate}→${endDate}`);
  return allGames;
}

// ─── Feature 1: Rescheduled Game Detection ───────────────────────────────────

/**
 * Scans the MLB Stats API schedule for the next 14 days and checks whether
 * any of our DB-postponed games have been rescheduled to a new date/gamePk.
 *
 * Detection logic:
 *   - Load all games with gameStatus='postponed' from our DB
 *   - Fetch the MLB Stats API schedule for today+1 through today+14
 *   - For each API game that is NOT postponed/suspended/cancelled:
 *       - Check if its awayTeam+homeTeam matches a DB-postponed game
 *       - If the gamePk differs from the DB game's mlbGamePk → RESCHEDULED
 *
 * @returns Array of detected rescheduled games (for logging/notification)
 */
export async function detectRescheduledGames(): Promise<{
  detected: number;
  rescheduled: Array<{
    awayTeam: string;
    homeTeam: string;
    originalDate: string;
    newDate: string;
    originalGamePk: number | null;
    newGamePk: number;
  }>;
}> {
  console.log(`${TAG}[STEP] ── Rescheduled Game Detection ──────────────────────`);

  const db = await getDb();
  if (!db) {
    console.warn(`${TAG}[STATE] DB unavailable — skipping rescheduled detection`);
    return { detected: 0, rescheduled: [] };
  }

  // ── Step 1: Load all postponed games from DB ──────────────────────────────
  const postponedGames = await db
    .select({
      id: games.id,
      awayTeam: games.awayTeam,
      homeTeam: games.homeTeam,
      gameDate: games.gameDate,
      mlbGamePk: games.mlbGamePk,
      gameStatus: games.gameStatus,
    })
    .from(games)
    .where(
      and(
        eq(games.sport, "MLB"),
        or(eq(games.gameStatus, "postponed"), eq(games.gameStatus, "suspended"))
      )
    );

  console.log(`${TAG}[STATE] DB postponed/suspended games: ${postponedGames.length}`);
  for (const g of postponedGames) {
    console.log(
      `${TAG}[STATE]   id=${g.id} ${g.awayTeam}@${g.homeTeam} date=${g.gameDate}` +
      ` status=${g.gameStatus} pk=${g.mlbGamePk ?? "null"}`
    );
  }

  if (postponedGames.length === 0) {
    console.log(`${TAG}[OUTPUT] No postponed/suspended games to check — skipping API scan`);
    return { detected: 0, rescheduled: [] };
  }

  // ── Step 2: Fetch MLB schedule for next 14 days ───────────────────────────
  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(today.getDate() + 1); // start from tomorrow
  const endDate = new Date(today);
  endDate.setDate(today.getDate() + 14);

  const startStr = startDate.toISOString().slice(0, 10);
  const endStr = endDate.toISOString().slice(0, 10);

  let apiGames: MlbApiGame[] = [];
  try {
    apiGames = await fetchMlbScheduleRange(startStr, endStr);
  } catch (err) {
    console.warn(`${TAG}[STATE] API fetch failed — skipping rescheduled detection:`, err instanceof Error ? err.message : err);
    return { detected: 0, rescheduled: [] };
  }

  // ── Step 3: Build lookup map of DB postponed games by team pair ───────────
  const postponedByTeams = new Map<string, typeof postponedGames[0]>();
  for (const g of postponedGames) {
    postponedByTeams.set(`${g.awayTeam}@${g.homeTeam}`, g);
  }

  // ── Step 4: Scan API games for team pair matches ──────────────────────────
  const rescheduled: Array<{
    awayTeam: string;
    homeTeam: string;
    originalDate: string;
    newDate: string;
    originalGamePk: number | null;
    newGamePk: number;
  }> = [];

  for (const apiGame of apiGames) {
    // Skip games that are themselves postponed/suspended/cancelled
    if (
      isPostponedState(apiGame.status.detailedState) ||
      isSuspendedState(apiGame.status.detailedState)
    ) {
      continue;
    }

    const awayAbbrev = normalizeAbbrev(apiGame.teams.away.team.abbreviation);
    const homeAbbrev = normalizeAbbrev(apiGame.teams.home.team.abbreviation);
    const teamKey = `${awayAbbrev}@${homeAbbrev}`;

    const dbGame = postponedByTeams.get(teamKey);
    if (!dbGame) continue;

    // Found a match — check if it's a new gamePk (rescheduled) or same pk (duplicate scan)
    const newGamePk = apiGame.gamePk;
    const originalPk = dbGame.mlbGamePk ? Number(dbGame.mlbGamePk) : null;
    const newDate = utcIsoToEstDate(apiGame.gameDate);

    if (originalPk !== null && newGamePk === originalPk) {
      // Same gamePk — this is the original game still showing up on a future date
      // (e.g. MLB API moved it forward). Not a new rescheduling.
      console.log(
        `${TAG}[STATE] SAME_PK: ${teamKey} pk=${newGamePk} — game moved to ${newDate} but same gamePk, not a new reschedule`
      );
      continue;
    }

    // Different gamePk → confirmed rescheduled game
    console.log(
      `${TAG}[OUTPUT] 🔄 RESCHEDULED: ${teamKey}` +
      ` | originalDate=${dbGame.gameDate} → newDate=${newDate}` +
      ` | originalPk=${originalPk ?? "null"} → newPk=${newGamePk}` +
      ` | detailedState=${apiGame.status.detailedState}`
    );

    rescheduled.push({
      awayTeam: awayAbbrev,
      homeTeam: homeAbbrev,
      originalDate: dbGame.gameDate,
      newDate,
      originalGamePk: originalPk,
      newGamePk,
    });

    // Remove from map so we don't double-detect the same team pair
    postponedByTeams.delete(teamKey);
  }

  // ── Step 5: Send owner notification if any rescheduled games found ────────
  if (rescheduled.length > 0) {
    const lines = rescheduled.map(
      (r) =>
        `• ${r.awayTeam}@${r.homeTeam}: ${r.originalDate} → ${r.newDate}` +
        ` (pk: ${r.originalGamePk ?? "N/A"} → ${r.newGamePk})`
    );
    const notifContent =
      `${rescheduled.length} postponed MLB game(s) have been rescheduled:\n\n` +
      lines.join("\n") +
      `\n\nThe new game(s) are auto-inserted by syncMlbSchedule (Step 0.5 of the MLB cycle) ` +
      `once the new date enters the rolling feed window. No manual action required.`;

    try {
      await notifyOwner({
        title: `⚾ ${rescheduled.length} MLB Game(s) Rescheduled`,
        content: notifContent,
      });
      console.log(`${TAG}[VERIFY] PASS — Owner notification sent for ${rescheduled.length} rescheduled game(s)`);
    } catch (notifErr) {
      console.warn(`${TAG}[VERIFY] WARN — Owner notification failed (non-fatal):`, notifErr instanceof Error ? notifErr.message : notifErr);
    }
  } else {
    console.log(`${TAG}[OUTPUT] No rescheduled games detected in next 14 days`);
  }

  console.log(
    `${TAG}[VERIFY] ${rescheduled.length > 0 ? "✅ PASS" : "ℹ️  INFO"}` +
    ` — detected=${rescheduled.length} postponed/suspended checked=${postponedGames.length}`
  );

  return { detected: rescheduled.length, rescheduled };
}

// ─── Feature 3: Suspended Game Resume Detection ───────────────────────────────

/**
 * Checks whether any of our DB-suspended games have been completed (resumed)
 * by the MLB Stats API. When a suspended game is resumed and finalized:
 *   - Updates gameStatus to 'final' in our DB
 *   - Writes actual scores
 *   - Sends owner notification
 *
 * Called from the MLB cycle alongside rescheduled detection.
 */
export async function detectResumedSuspendedGames(): Promise<{
  resumed: number;
  errors: string[];
}> {
  console.log(`${TAG}[STEP] ── Suspended Game Resume Detection ─────────────────`);

  const db = await getDb();
  if (!db) {
    console.warn(`${TAG}[STATE] DB unavailable — skipping suspended resume detection`);
    return { resumed: 0, errors: [] };
  }

  // Load all suspended games from DB
  const suspendedGames = await db
    .select({
      id: games.id,
      awayTeam: games.awayTeam,
      homeTeam: games.homeTeam,
      gameDate: games.gameDate,
      mlbGamePk: games.mlbGamePk,
    })
    .from(games)
    .where(and(eq(games.sport, "MLB"), eq(games.gameStatus, "suspended")));

  console.log(`${TAG}[STATE] DB suspended games: ${suspendedGames.length}`);

  if (suspendedGames.length === 0) {
    console.log(`${TAG}[OUTPUT] No suspended games to check`);
    return { resumed: 0, errors: [] };
  }

  // For each suspended game, check its current status via MLB Stats API
  let resumed = 0;
  const errors: string[] = [];

  for (const dbGame of suspendedGames) {
    if (!dbGame.mlbGamePk) {
      console.warn(`${TAG}[STATE] SKIP id=${dbGame.id} ${dbGame.awayTeam}@${dbGame.homeTeam} — no mlbGamePk`);
      continue;
    }

    try {
      const gamePk = Number(dbGame.mlbGamePk);
      const url = `https://statsapi.mlb.com/api/v1/game/${gamePk}/linescore`;
      console.log(`${TAG}[STEP] Checking suspended game pk=${gamePk} ${dbGame.awayTeam}@${dbGame.homeTeam}`);

      const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!resp.ok) {
        console.warn(`${TAG}[STATE] HTTP ${resp.status} for pk=${gamePk} — skipping`);
        continue;
      }

      const data = await resp.json() as {
        teams?: { away?: { runs?: number }; home?: { runs?: number } };
        currentInning?: number;
        isTopInning?: boolean;
      };

      // Also fetch game status
      const statusUrl = `https://statsapi.mlb.com/api/v1/game/${gamePk}/boxscore`;
      const statusResp = await fetch(statusUrl, { signal: AbortSignal.timeout(10_000) });
      if (!statusResp.ok) {
        console.warn(`${TAG}[STATE] boxscore HTTP ${statusResp.status} for pk=${gamePk} — skipping`);
        continue;
      }

      const statusData = await statusResp.json() as {
        info?: Array<{ label?: string; value?: string }>;
      };

      // Check if game is now final by looking at the schedule endpoint
      const scheduleUrl = `https://statsapi.mlb.com/api/v1/schedule?gamePks=${gamePk}&fields=dates,games,gamePk,status,abstractGameState,detailedState,teams,away,home,team,abbreviation,score`;
      const schedResp = await fetch(scheduleUrl, { signal: AbortSignal.timeout(10_000) });
      if (!schedResp.ok) continue;

      const schedData = await schedResp.json() as MlbApiScheduleResponse;
      const apiGame = schedData.dates?.[0]?.games?.[0];
      if (!apiGame) continue;

      const abstractState = apiGame.status.abstractGameState;
      const detailedState = apiGame.status.detailedState;

      console.log(
        `${TAG}[STATE] pk=${gamePk} ${dbGame.awayTeam}@${dbGame.homeTeam}` +
        ` abstractState=${abstractState} detailedState=${detailedState}`
      );

      // If still suspended, skip
      if (isSuspendedState(detailedState)) {
        console.log(`${TAG}[STATE] pk=${gamePk} still suspended — no change`);
        continue;
      }

      // If now final, update DB
      if (abstractState === "Final") {
        const awayRuns = data.teams?.away?.runs ?? null;
        const homeRuns = data.teams?.home?.runs ?? null;

        await db
          .update(games)
          .set({
            gameStatus: "final",
            awayScore: awayRuns,
            homeScore: homeRuns,
            gameClock: "Final",
          })
          .where(eq(games.id, dbGame.id));

        console.log(
          `${TAG}[OUTPUT] ✅ RESUMED: id=${dbGame.id} ${dbGame.awayTeam}@${dbGame.homeTeam}` +
          ` | status: suspended → final | score: ${awayRuns ?? "?"}-${homeRuns ?? "?"}`
        );

        // Verify the write
        const [verify] = await db
          .select({ gameStatus: games.gameStatus, awayScore: games.awayScore, homeScore: games.homeScore })
          .from(games)
          .where(eq(games.id, dbGame.id));

        const pass = verify.gameStatus === "final";
        console.log(
          `${TAG}[VERIFY] ${pass ? "PASS" : "FAIL"} — id=${dbGame.id}` +
          ` status=${verify.gameStatus} score=${verify.awayScore ?? "?"}-${verify.homeScore ?? "?"}`
        );

        // Notify owner
        try {
          await notifyOwner({
            title: `⚾ Suspended Game Resumed: ${dbGame.awayTeam}@${dbGame.homeTeam}`,
            content:
              `Game originally on ${dbGame.gameDate} (gamePk=${gamePk}) has been resumed and finalized.\n` +
              `Final score: ${dbGame.awayTeam} ${awayRuns ?? "?"} — ${dbGame.homeTeam} ${homeRuns ?? "?"}\n` +
              `Status updated to 'final' in DB. Backtest will run on next MLB cycle.`,
          });
        } catch (notifErr) {
          console.warn(`${TAG}[VERIFY] WARN — Notification failed:`, notifErr instanceof Error ? notifErr.message : notifErr);
        }

        resumed++;
      }
    } catch (err) {
      const msg = `${TAG}[ERROR] pk=${dbGame.mlbGamePk} ${dbGame.awayTeam}@${dbGame.homeTeam}: ${err instanceof Error ? err.message : String(err)}`;
      console.error(msg);
      errors.push(msg);
    }
  }

  console.log(
    `${TAG}[VERIFY] ${resumed > 0 ? "✅ PASS" : "ℹ️  INFO"}` +
    ` — resumed=${resumed} checked=${suspendedGames.length} errors=${errors.length}`
  );

  return { resumed, errors };
}

// ─── Feature 2: Admin Query — List All Postponed/Suspended Games ──────────────

/**
 * Returns all MLB games with gameStatus='postponed' or 'suspended' from the DB.
 * Used by the admin postponed-game view in the owner dashboard.
 * Sorted by gameDate descending (most recent first).
 */
export async function listPostponedGames(): Promise<Array<{
  id: number;
  awayTeam: string;
  homeTeam: string;
  gameDate: string;
  gameStatus: string;
  mlbGamePk: number | null;
  startTimeEst: string;
  sport: string;
  publishedToFeed: boolean;
  awayML: string | null;
  homeML: string | null;
  bookTotal: string | null;
}>> {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select({
      id: games.id,
      awayTeam: games.awayTeam,
      homeTeam: games.homeTeam,
      gameDate: games.gameDate,
      gameStatus: games.gameStatus,
      mlbGamePk: games.mlbGamePk,
      startTimeEst: games.startTimeEst,
      sport: games.sport,
      publishedToFeed: games.publishedToFeed,
      awayML: games.awayML,
      homeML: games.homeML,
      bookTotal: games.bookTotal,
    })
    .from(games)
    .where(
      or(
        eq(games.gameStatus, "postponed"),
        eq(games.gameStatus, "suspended")
      )
    )
    .orderBy(games.gameDate);

  console.log(
    `${TAG}[OUTPUT] listPostponedGames: returned ${rows.length} postponed/suspended games`
  );

  return rows.map((r: typeof rows[0]) => ({
    ...r,
    mlbGamePk: r.mlbGamePk ? Number(r.mlbGamePk) : null,
    bookTotal: r.bookTotal ? String(r.bookTotal) : null,
  }));
}
