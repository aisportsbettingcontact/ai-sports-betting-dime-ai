/**
 * mlbHrPropsBacktestService.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Fetches actual HR results from MLB Stats API box scores and populates
 * mlb_hr_props.actualHr for completed games.
 *
 * Called by MLBCycle every 10 minutes (and by multi-market backtest on FINAL).
 *
 * Flow:
 *   1. Find all mlb_hr_props rows where actualHr IS NULL
 *      and the associated game is in 'Final' or 'Game Over' status
 *   2. For each unique game, fetch the MLB Stats API box score
 *   3. Extract each batter's HR count from batting stats
 *   4. Match by player name (normalized) and update actualHr
 *   5. Compute backtestResult: WIN/LOSS/NO_ACTION based on verdict vs actualHr
 *
 * [INPUT]  gameDate: string (YYYY-MM-DD) — only process games on this date
 * [OUTPUT] HrBacktestResult
 */

import * as dotenv from "dotenv";
dotenv.config();

import { getDb } from "./db";
import { mlbHrProps, games } from "../drizzle/schema";
import { eq, isNull, and, inArray } from "drizzle-orm";

const TAG = "[HrBacktest]";
const MLB_STATS_BASE = "https://statsapi.mlb.com/api/v1";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HrBacktestResult {
  date: string;
  gamesProcessed: number;
  propsUpdated: number;
  propsSkipped: number;
  errors: number;
}

interface BatterHrResult {
  fullName: string;
  normalizedName: string;
  homeRuns: number;
}

// ─── Name normalization ───────────────────────────────────────────────────────

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+jr\.?$|\s+sr\.?$|\s+ii$|\s+iii$|\s+iv$/i, "")
    .replace(/[^a-z\s]/g, "")
    .trim();
}

// ─── MLB Stats API: fetch box score batting HR results ────────────────────────

async function fetchGameBatterHrs(
  gamePk: number
): Promise<Map<string, number>> {
  const url = `${MLB_STATS_BASE}/game/${gamePk}/boxscore`;
  console.log(`${TAG} [STEP] Fetching box score for gamePk=${gamePk}`);

  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for gamePk=${gamePk}`);
  }

  const data = (await res.json()) as {
    teams?: {
      away?: {
        batters?: number[];
        players?: Record<
          string,
          {
            person?: { fullName?: string };
            stats?: { batting?: { homeRuns?: number } };
          }
        >;
      };
      home?: {
        batters?: number[];
        players?: Record<
          string,
          {
            person?: { fullName?: string };
            stats?: { batting?: { homeRuns?: number } };
          }
        >;
      };
    };
  };

  const hrMap = new Map<string, number>();

  for (const side of ["away", "home"] as const) {
    const team = data.teams?.[side];
    if (!team) continue;
    const batters = team.batters ?? [];
    const players = team.players ?? {};

    for (const batterId of batters) {
      const player = players[`ID${batterId}`];
      if (!player) continue;
      const fullName = player.person?.fullName;
      if (!fullName) continue;
      const hr = player.stats?.batting?.homeRuns ?? 0;
      hrMap.set(normalizeName(fullName), hr);
    }
  }

  console.log(`${TAG} [STATE] gamePk=${gamePk}: found ${hrMap.size} batters`);
  return hrMap;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Fetch actual HR results for all completed games on a given date
 * and update mlb_hr_props.actualHr + backtestResult.
 */
export async function fetchAndStoreActualHrResults(
  gameDate: string
): Promise<HrBacktestResult> {
  console.log(
    `\n${TAG} ============================================================`
  );
  console.log(`${TAG} [INPUT] date=${gameDate}`);

  const db = await getDb();
  if (!db) throw new Error("Database not available");

  let gamesProcessed = 0,
    propsUpdated = 0,
    propsSkipped = 0,
    errors = 0;

  // ── Step 1: Find HR Props rows with null actualHr for Final games ─────────
  const pendingRows = await db
    .select({
      id: mlbHrProps.id,
      gameId: mlbHrProps.gameId,
      playerName: mlbHrProps.playerName,
      verdict: mlbHrProps.verdict,
      modelPHr: mlbHrProps.modelPHr,
      mlbGamePk: games.mlbGamePk,
      gameStatus: games.gameStatus,
      awayTeam: games.awayTeam,
      homeTeam: games.homeTeam,
    })
    .from(mlbHrProps)
    .innerJoin(games, eq(mlbHrProps.gameId, games.id))
    .where(and(eq(games.gameDate, gameDate), isNull(mlbHrProps.actualHr)));

  // Filter to only Final/Game Over games
  const finalRows = (pendingRows as Array<(typeof pendingRows)[0]>).filter(
    (r: (typeof pendingRows)[0]) => {
      const status = (r.gameStatus ?? "").toLowerCase();
      return (
        status.includes("final") ||
        status.includes("game over") ||
        status.includes("completed")
      );
    }
  );

  console.log(
    `${TAG} [STATE] Found ${pendingRows.length} pending HR props | ${finalRows.length} in Final games`
  );

  if (finalRows.length === 0) {
    console.log(
      `${TAG} [STATE] No pending HR props in Final games — nothing to backtest`
    );
    return {
      date: gameDate,
      gamesProcessed: 0,
      propsUpdated: 0,
      propsSkipped: 0,
      errors: 0,
    };
  }

  // ── Step 2: Group by game ─────────────────────────────────────────────────
  const gameGroups = new Map<number, typeof finalRows>();
  for (const row of finalRows) {
    const existing = gameGroups.get(row.gameId) ?? [];
    existing.push(row);
    gameGroups.set(row.gameId, existing);
  }

  // ── Step 3: Process each game ─────────────────────────────────────────────
  for (const [gameId, props] of Array.from(gameGroups.entries())) {
    const firstProp = props[0];
    const gamePk = firstProp.mlbGamePk;

    if (!gamePk) {
      console.log(`${TAG} [SKIP] gameId=${gameId}: no mlbGamePk`);
      for (const p of props) propsSkipped++;
      continue;
    }

    try {
      // Fetch box score HR data
      const hrMap = await fetchGameBatterHrs(parseInt(gamePk));
      gamesProcessed++;

      // Match each prop player to the HR map
      for (const prop of props) {
        const playerNorm = normalizeName(prop.playerName);
        const actualHr = hrMap.get(playerNorm);

        if (actualHr === undefined) {
          console.log(
            `${TAG} [SKIP] ${prop.playerName} (gameId=${gameId}): not found in box score`
          );
          propsSkipped++;
          continue;
        }

        // Compute backtest result
        const hitHr = actualHr >= 1;
        const verdict = prop.verdict ?? "PASS";
        const modelPHr =
          prop.modelPHr !== null ? parseFloat(prop.modelPHr) : null;

        let backtestResult: string;
        let modelCorrect: number | null = null;

        if (verdict === "OVER") {
          backtestResult = hitHr ? "WIN" : "LOSS";
          // modelCorrect: 1 = model was right (predicted OVER, player hit HR)
          //               0 = model was wrong (predicted OVER, player did NOT hit HR)
          // CRITICAL FIX: was previously NULL for LOSS entries due to missing assignment.
          // Now explicitly set for both WIN and LOSS to enable Brier score computation.
          modelCorrect = hitHr ? 1 : 0;
        } else if (verdict === "PASS") {
          backtestResult = "NO_ACTION";
          // Model predicted PASS (low confidence) — correct if player didn't hit HR
          // modelCorrect: 1 = model was right to pass (player didn't hit HR)
          //               0 = model was wrong to pass (player hit HR)
          modelCorrect = hitHr ? 0 : 1;
        } else {
          backtestResult = "NO_ACTION";
          // Unknown verdict — set modelCorrect based on whether player hit HR
          // (conservative: treat as PASS logic)
          modelCorrect = hitHr ? 0 : 1;
        }
        // Validation: modelCorrect must always be 0 or 1 for graded entries
        if (backtestResult !== "NO_ACTION" && modelCorrect === null) {
          console.error(
            `${TAG} [VERIFY FAIL] id=${prop.id} ${prop.playerName}: modelCorrect is null for graded entry verdict=${verdict} backtestResult=${backtestResult}`
          );
          modelCorrect = 0; // Safe fallback — treat as incorrect rather than corrupt
        }

        // Update DB
        await db
          .update(mlbHrProps)
          .set({
            actualHr,
            backtestResult,
            modelCorrect,
            backtestRunAt: Date.now(),
          })
          .where(eq(mlbHrProps.id, prop.id));

        propsUpdated++;
        const resultStr =
          backtestResult === "WIN"
            ? "✅ WIN"
            : backtestResult === "LOSS"
              ? "❌ LOSS"
              : "⏭ NO_ACTION";
        console.log(
          `${TAG} [OUTPUT] ${prop.playerName}: actualHr=${actualHr} verdict=${verdict} → ${resultStr}`
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${TAG} [ERROR] gameId=${gameId} gamePk=${gamePk}: ${msg}`);
      errors++;
      for (const p of props) propsSkipped++;
    }
  }

  // ── Step 4: Calibration summary ───────────────────────────────────────────
  try {
    const [summary] = (await db.execute(`
      SELECT
        COUNT(*) as total,
        SUM(actualHr IS NOT NULL) as completed,
        SUM(actualHr >= 1) as hrHits,
        SUM(backtestResult = 'WIN') as wins,
        SUM(backtestResult = 'LOSS') as losses,
        SUM(backtestResult = 'NO_ACTION') as noAction
      FROM mlb_hr_props hp
      JOIN games g ON g.id = hp.gameId
      WHERE g.gameDate = '${gameDate}'
    `)) as [
      Array<{
        total: number;
        completed: number;
        hrHits: number;
        wins: number;
        losses: number;
        noAction: number;
      }>,
    ];

    const s = summary[0];
    const acc =
      s.wins + s.losses > 0
        ? ((s.wins / (s.wins + s.losses)) * 100).toFixed(1)
        : "N/A";
    console.log(`\n${TAG} ─── CALIBRATION SUMMARY (${gameDate}) ───`);
    console.log(`${TAG}   Total props:    ${s.total}`);
    console.log(`${TAG}   Completed:      ${s.completed}`);
    console.log(`${TAG}   HR hits:        ${s.hrHits}`);
    console.log(`${TAG}   WIN:            ${s.wins}`);
    console.log(`${TAG}   LOSS:           ${s.losses}`);
    console.log(`${TAG}   NO_ACTION:      ${s.noAction}`);
    console.log(`${TAG}   Accuracy:       ${acc}%`);
  } catch (err) {
    console.warn(`${TAG} [WARN] Calibration summary failed: ${err}`);
  }

  console.log(
    `\n${TAG} ============================================================`
  );
  console.log(
    `${TAG} [OUTPUT] date=${gameDate} gamesProcessed=${gamesProcessed} propsUpdated=${propsUpdated} propsSkipped=${propsSkipped} errors=${errors}`
  );
  console.log(
    `${TAG} [VERIFY] ${errors === 0 ? "PASS" : "WARN"} — ${errors} errors`
  );
  console.log(
    `${TAG} ============================================================\n`
  );

  return { date: gameDate, gamesProcessed, propsUpdated, propsSkipped, errors };
}
