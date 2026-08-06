/**
 * kPropsBacktestService.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Automated K-Props backtest engine.
 *
 * Responsibilities:
 *   1. After games complete, fetch actual pitcher K totals from MLB Stats API
 *   2. Compare actual Ks against the book line and model projection
 *   3. Update mlb_strikeout_props rows with: actualKs, backtestResult,
 *      modelError, modelCorrect, backtestRunAt
 *   4. Compute and log rolling calibration metrics (MAE, bias, accuracy)
 *
 * Data sources:
 *   - Actual Ks: MLB Stats API (statsapi.mlb.com) — free, no auth required
 *   - Lines: already stored in mlb_strikeout_props.bookLine
 *   - Projections: already stored in mlb_strikeout_props.kProj
 *
 * Trigger: Called by MLBCycle every 10 minutes.
 *   - Only processes rows where backtestResult = 'PENDING' or null
 *   - Only processes games that are 'Final' or 'Game Over' status
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { getDb } from "./db";
import { mlbStrikeoutProps, games } from "../drizzle/schema";
import { eq, isNull, or, and, inArray } from "drizzle-orm";

/**
 * Sentinel values written to `mlb_strikeout_props.backtestResult`.
 *
 * The column is `varchar(16)` (drizzle/schema.ts, created at that width by
 * migration 0049 and never altered since). MySQL in strict mode REJECTS a
 * longer value outright — it does not truncate — so an oversized sentinel is
 * not a cosmetic problem: the UPDATE throws ER_DATA_TOO_LONG (errno 1406) and
 * the row silently keeps its previous state.
 *
 * That is exactly what happened to the previous `"NAME_MATCH_FAILED"` (17
 * chars): every write of it failed from the day it was introduced, so the
 * marker never persisted, the row was re-queued forever, and each cycle logged
 * a stack trace. `NAME_MISMATCH` is 13.
 *
 * `kPropsBacktestService.test.ts` reads the column width out of the schema and
 * asserts every value here fits, so this cannot regress and cannot drift if the
 * column is ever resized.
 */
export const K_BACKTEST_SENTINEL = {
  /** Queued, not yet graded. */
  PENDING: "PENDING",
  /** No book line to grade against. */
  NO_LINE: "NO_LINE",
  /** The pitcher could not be matched to a box-score name. Retryable. */
  NAME_MISMATCH: "NAME_MISMATCH",
} as const;

/**
 * Values the retry sweep must treat as "still needs grading".
 *
 * Includes two legacy forms of the name-mismatch marker that this codebase can
 * no longer produce. `NAME_MATCH_FAILED` could only have been stored by a
 * server whose sql_mode omitted STRICT_TRANS_TABLES, and `NAME_MATCH_FAIL` is
 * what MySQL would have truncated it to under that same non-strict mode. We
 * have no evidence either exists — production is strict, which is why the write
 * threw rather than truncating — but a stranded row costs one array entry to
 * rescue and would otherwise never be graded again.
 */
export const K_BACKTEST_RETRYABLE: readonly string[] = [
  K_BACKTEST_SENTINEL.PENDING,
  K_BACKTEST_SENTINEL.NAME_MISMATCH,
  "NAME_MATCH_FAILED",
  "NAME_MATCH_FAIL",
];

// ── Types ─────────────────────────────────────────────────────────────────────

interface MlbBoxScorePitcher {
  personId: number;
  fullName: string;
  stats: {
    pitching: {
      strikeOuts?: number;
      inningsPitched?: string;
      battersFaced?: number;
      pitchesThrown?: number;
    };
  };
  gameStatus?: {
    isCurrentPitcher?: boolean;
    isOnBench?: boolean;
  };
}

interface BacktestResult {
  propId: number;
  pitcherName: string;
  gameId: number;
  bookLine: number;
  kProj: number;
  actualKs: number;
  backtestResult: "OVER" | "UNDER" | "PUSH";
  modelError: number;
  modelCorrect: boolean;
  modelPrediction: "OVER" | "UNDER";
}

interface CalibrationMetrics {
  totalProps: number;
  completedProps: number;
  pendingProps: number;
  overCount: number;
  underCount: number;
  pushCount: number;
  modelAccuracy: number;
  modelOverAccuracy: number;
  modelUnderAccuracy: number;
  mae: number;
  meanBias: number;
  rmse: number;
  calibrationFactor: number;
}

// ── MLB Stats API helpers ─────────────────────────────────────────────────────

const MLB_STATS_BASE = "https://statsapi.mlb.com/api/v1";
const AN_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json",
};

/**
 * Fetch the box score for a given MLB game PK and extract pitcher K totals.
 * Returns a map of { pitcherName → actualKs } for the starting pitcher of each team.
 */
async function fetchGamePitcherKs(
  gamePk: number
): Promise<
  Map<string, { ks: number; ip: string; bf: number; pitches: number }>
> {
  const url = `${MLB_STATS_BASE}/game/${gamePk}/boxscore`;
  console.log(
    `[KBacktest] [STEP] Fetching box score for gamePk ${gamePk}: ${url}`
  );

  const res = await fetch(url, { headers: AN_HEADERS });
  if (!res.ok) {
    throw new Error(
      `[KBacktest] [ERROR] HTTP ${res.status} for gamePk ${gamePk}`
    );
  }

  const data = (await res.json()) as {
    teams: {
      away: {
        pitchers: number[];
        players: Record<
          string,
          {
            person: { id: number; fullName: string };
            stats: {
              pitching: {
                strikeOuts?: number;
                inningsPitched?: string;
                battersFaced?: number;
                numberOfPitches?: number;
              };
            };
          }
        >;
      };
      home: {
        pitchers: number[];
        players: Record<
          string,
          {
            person: { id: number; fullName: string };
            stats: {
              pitching: {
                strikeOuts?: number;
                inningsPitched?: string;
                battersFaced?: number;
                numberOfPitches?: number;
              };
            };
          }
        >;
      };
    };
  };

  const result = new Map<
    string,
    { ks: number; ip: string; bf: number; pitches: number }
  >();

  for (const side of ["away", "home"] as const) {
    const team = data.teams[side];
    if (!team || !team.pitchers || team.pitchers.length === 0) continue;

    // Starting pitcher is always index 0 in the pitchers array
    const starterId = team.pitchers[0];
    const starterKey = `ID${starterId}`;
    const starter = team.players[starterKey];

    if (!starter) {
      console.warn(
        `[KBacktest] [WARN] Starter ID ${starterId} not found in players for gamePk ${gamePk} ${side}`
      );
      continue;
    }

    const pitching = starter.stats?.pitching ?? {};
    const ks = pitching.strikeOuts ?? 0;
    const ip = pitching.inningsPitched ?? "0.0";
    const bf = pitching.battersFaced ?? 0;
    const pitches = pitching.numberOfPitches ?? 0;

    result.set(starter.person.fullName, { ks, ip, bf, pitches });

    console.log(
      `[KBacktest] [OUTPUT] gamePk ${gamePk} ${side} starter: ${starter.person.fullName} | ${ks} Ks | ${ip} IP | ${bf} BF | ${pitches} pitches`
    );
  }

  return result;
}

/**
 * Check if a game is final via the MLB Stats API schedule endpoint.
 */
async function isGameFinal(gamePk: number): Promise<boolean> {
  const url = `${MLB_STATS_BASE}/schedule?gamePk=${gamePk}&fields=dates,games,status,detailedState,abstractGameState`;
  const res = await fetch(url, { headers: AN_HEADERS });
  if (!res.ok) return false;

  const data = (await res.json()) as {
    dates: {
      games: { status: { abstractGameState: string; detailedState: string } }[];
    }[];
  };

  const game = data.dates?.[0]?.games?.[0];
  if (!game) return false;

  const state = game.status.abstractGameState;
  const detail = game.status.detailedState;

  const isFinal =
    state === "Final" || detail === "Final" || detail === "Game Over";
  console.log(
    `[KBacktest] [STATE] gamePk ${gamePk} status: ${state} / ${detail} → isFinal: ${isFinal}`
  );
  return isFinal;
}

// ── Name matching ─────────────────────────────────────────────────────────────

/**
 * Fuzzy match a pitcher name from the DB against names from the box score.
 * Handles "Last, First" vs "First Last" and common abbreviations.
 */
function matchPitcherName(
  dbName: string,
  boxScoreNames: string[]
): string | null {
  // NFD decomposition strips diacritics (é→e, ó→o, ú→u, etc.) before removing non-alpha
  const normalize = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // strip combining diacritical marks
      .toLowerCase()
      .replace(/[^a-z\s]/g, "")
      .trim();

  const dbNorm = normalize(dbName);

  // Exact match
  for (const n of boxScoreNames) {
    if (normalize(n) === dbNorm) return n;
  }

  // Last name match
  const dbLastName = dbNorm.split(" ").pop() ?? "";
  for (const n of boxScoreNames) {
    const nNorm = normalize(n);
    if (nNorm.includes(dbLastName) && dbLastName.length > 3) return n;
  }

  // First + last initial match
  const dbParts = dbNorm.split(" ");
  if (dbParts.length >= 2) {
    const dbFirst = dbParts[0];
    const dbLast = dbParts[dbParts.length - 1];
    for (const n of boxScoreNames) {
      const nParts = normalize(n).split(" ");
      if (
        nParts.length >= 2 &&
        nParts[0] === dbFirst &&
        nParts[nParts.length - 1] === dbLast
      )
        return n;
    }
  }

  return null;
}

// ── Backtest computation ──────────────────────────────────────────────────────

function computeBacktestResult(
  actualKs: number,
  bookLine: number
): "OVER" | "UNDER" | "PUSH" {
  if (actualKs > bookLine) return "OVER";
  if (actualKs < bookLine) return "UNDER";
  return "PUSH";
}

function computeModelPrediction(
  kProj: number,
  bookLine: number
): "OVER" | "UNDER" {
  return kProj >= bookLine ? "OVER" : "UNDER";
}

// ── Main backtest runner ──────────────────────────────────────────────────────

/**
 * Run the backtest for all pending K-prop rows.
 * Called by MLBCycle every 10 minutes.
 */
export async function runKPropsBacktest(dateStr: string): Promise<void> {
  console.log(`[KBacktest][${dateStr}] [STEP] Starting K-Props backtest run`);

  // 1. Fetch all PENDING K-prop rows for this date
  // We join with games to get the gamePk (mlbGamePk)
  const db = await getDb();
  const pendingRows = await db
    .select({
      id: mlbStrikeoutProps.id,
      gameId: mlbStrikeoutProps.gameId,
      side: mlbStrikeoutProps.side,
      pitcherName: mlbStrikeoutProps.pitcherName,
      bookLine: mlbStrikeoutProps.bookLine,
      kProj: mlbStrikeoutProps.kProj,
      backtestResult: mlbStrikeoutProps.backtestResult,
      mlbGamePk: games.mlbGamePk,
      gameDate: games.gameDate,
    })
    .from(mlbStrikeoutProps)
    .innerJoin(games, eq(mlbStrikeoutProps.gameId, games.id))
    .where(
      and(
        eq(games.gameDate, dateStr),
        or(
          isNull(mlbStrikeoutProps.backtestResult),
          inArray(mlbStrikeoutProps.backtestResult, [...K_BACKTEST_RETRYABLE])
        )
      )
    );

  console.log(
    `[KBacktest][${dateStr}] [STATE] Found ${pendingRows.length} pending K-prop rows to backtest`
  );

  if (pendingRows.length === 0) {
    console.log(`[KBacktest][${dateStr}] [VERIFY] No pending rows — skipping`);
    return;
  }

  // 2. Group by gamePk to minimize API calls
  const byGamePk = new Map<number, typeof pendingRows>();
  for (const row of pendingRows) {
    if (!row.mlbGamePk) {
      console.warn(
        `[KBacktest][${dateStr}] [WARN] Row ${row.id} (${row.pitcherName}) has no mlbGamePk — skipping`
      );
      continue;
    }
    if (!byGamePk.has(row.mlbGamePk)) byGamePk.set(row.mlbGamePk, []);
    byGamePk.get(row.mlbGamePk)!.push(row);
  }

  console.log(
    `[KBacktest][${dateStr}] [STATE] Processing ${byGamePk.size} unique games`
  );

  const backtestResults: BacktestResult[] = [];
  let processed = 0;
  let skippedNotFinal = 0;
  let skippedNoLine = 0;
  let nameMatchFailed = 0;

  // 3. Process each game
  for (const [gamePk, rows] of Array.from(byGamePk.entries())) {
    // Check if game is final
    const isFinal = await isGameFinal(gamePk);
    if (!isFinal) {
      console.log(
        `[KBacktest][${dateStr}] [SKIP] gamePk ${gamePk} — not yet final`
      );
      skippedNotFinal += rows.length;
      continue;
    }

    // Fetch pitcher Ks from box score
    let pitcherKsMap: Map<
      string,
      { ks: number; ip: string; bf: number; pitches: number }
    >;
    try {
      pitcherKsMap = await fetchGamePitcherKs(gamePk);
    } catch (err) {
      console.error(
        `[KBacktest][${dateStr}] [ERROR] Failed to fetch box score for gamePk ${gamePk}: ${err}`
      );
      continue;
    }

    const boxScoreNames = Array.from(pitcherKsMap.keys());

    // Match each row to a box score pitcher
    for (const row of rows) {
      // Skip if no book line
      if (!row.bookLine) {
        console.log(
          `[KBacktest][${dateStr}] [SKIP] ${row.pitcherName} — no book line`
        );
        skippedNoLine++;
        // Mark as NO_LINE so we don't retry
        await db
          .update(mlbStrikeoutProps)
          .set({
            backtestResult: K_BACKTEST_SENTINEL.NO_LINE,
            backtestRunAt: Date.now(),
          })
          .where(eq(mlbStrikeoutProps.id, row.id));
        continue;
      }

      let matchedName = matchPitcherName(row.pitcherName, boxScoreNames);
      if (!matchedName) {
        // ── Retroactive fallback: use side (home/away) to pick the correct starter
        //    when the projected pitcher was scratched and a different pitcher started.
        //    pitcherKsMap is built away-first, home-second by iteration order.
        const allStarters = Array.from(pitcherKsMap.keys());
        if (allStarters.length === 2) {
          const sideIndex = row.side === "home" ? 1 : 0;
          const fallback = allStarters[sideIndex];
          if (fallback) {
            console.log(
              `[KBacktest][${dateStr}] [STATE] Name match FALLBACK: side=${row.side} projected="${row.pitcherName}" → actual="${fallback}" (starter substitution)`
            );
            matchedName = fallback;
          }
        } else if (allStarters.length === 1) {
          console.log(
            `[KBacktest][${dateStr}] [STATE] Name match FALLBACK: only 1 starter in box score (${allStarters[0]}), using for "${row.pitcherName}"`
          );
          matchedName = allStarters[0];
        }
        if (!matchedName) {
          console.warn(
            `[KBacktest][${dateStr}] [WARN] Name match FAILED for "${row.pitcherName}" in gamePk ${gamePk}. Box score names: ${boxScoreNames.join(", ")} — marking ${K_BACKTEST_SENTINEL.NAME_MISMATCH} for retry`
          );
          nameMatchFailed++;
          await db
            .update(mlbStrikeoutProps)
            .set({
              backtestResult: K_BACKTEST_SENTINEL.NAME_MISMATCH,
              backtestRunAt: Date.now(),
            })
            .where(eq(mlbStrikeoutProps.id, row.id));
          continue;
        }
      }

      const pitcherData = pitcherKsMap.get(matchedName)!;
      const actualKs = pitcherData.ks;
      const bookLine = parseFloat(row.bookLine);
      const kProj = row.kProj ? parseFloat(row.kProj) : null;

      const backtestRes = computeBacktestResult(actualKs, bookLine);
      const modelPrediction =
        kProj !== null ? computeModelPrediction(kProj, bookLine) : null;
      const modelError = kProj !== null ? actualKs - kProj : null;
      const modelCorrect =
        modelPrediction !== null && backtestRes !== "PUSH"
          ? modelPrediction === backtestRes
            ? 1
            : 0
          : null;

      console.log(
        `[KBacktest][${dateStr}] [OUTPUT] ${row.pitcherName} | Line: ${bookLine} | Proj: ${kProj ?? "N/A"} | Actual: ${actualKs} | Result: ${backtestRes} | Model: ${modelPrediction ?? "N/A"} | Correct: ${modelCorrect ?? "N/A"} | Error: ${modelError !== null ? modelError.toFixed(2) : "N/A"}`
      );

      // Update DB
      const dbInner = await getDb();
      await dbInner
        .update(mlbStrikeoutProps)
        .set({
          actualKs,
          backtestResult: backtestRes,
          modelError: modelError !== null ? modelError.toFixed(3) : null,
          modelCorrect,
          backtestRunAt: Date.now(),
        })
        .where(eq(mlbStrikeoutProps.id, row.id));

      if (kProj !== null) {
        backtestResults.push({
          propId: row.id,
          pitcherName: row.pitcherName,
          gameId: row.gameId,
          bookLine,
          kProj,
          actualKs,
          backtestResult: backtestRes,
          modelError: modelError!,
          modelCorrect: modelCorrect === 1,
          modelPrediction: modelPrediction!,
        });
      }

      processed++;
    }

    // Small delay between game API calls
    await new Promise(r => setTimeout(r, 300));
  }

  // 4. Compute and log calibration metrics
  if (backtestResults.length > 0) {
    const metrics = computeCalibrationMetrics(backtestResults);
    console.log(`[KBacktest][${dateStr}] [OUTPUT] ─── Calibration Metrics ───`);
    console.log(
      `[KBacktest][${dateStr}] [OUTPUT] Processed: ${processed} | Skipped (not final): ${skippedNotFinal} | Skipped (no line): ${skippedNoLine} | Name match failed: ${nameMatchFailed}`
    );
    console.log(
      `[KBacktest][${dateStr}] [OUTPUT] OVER: ${metrics.overCount} | UNDER: ${metrics.underCount} | PUSH: ${metrics.pushCount}`
    );
    console.log(
      `[KBacktest][${dateStr}] [OUTPUT] Model Accuracy: ${(metrics.modelAccuracy * 100).toFixed(1)}%`
    );
    console.log(
      `[KBacktest][${dateStr}] [OUTPUT] OVER Accuracy: ${(metrics.modelOverAccuracy * 100).toFixed(1)}% | UNDER Accuracy: ${(metrics.modelUnderAccuracy * 100).toFixed(1)}%`
    );
    console.log(
      `[KBacktest][${dateStr}] [OUTPUT] MAE: ${metrics.mae.toFixed(3)} Ks | Bias: ${metrics.meanBias.toFixed(3)} Ks | RMSE: ${metrics.rmse.toFixed(3)} Ks`
    );
    console.log(
      `[KBacktest][${dateStr}] [OUTPUT] Calibration Factor: ${metrics.calibrationFactor.toFixed(4)}`
    );
    console.log(
      `[KBacktest][${dateStr}] [VERIFY] Backtest complete — ${processed} props updated | PASS`
    );
  } else {
    console.log(
      `[KBacktest][${dateStr}] [VERIFY] No props with projections to evaluate | processed=${processed} skippedNotFinal=${skippedNotFinal}`
    );
  }
}

// ── Rolling calibration metrics ───────────────────────────────────────────────

export function computeCalibrationMetrics(
  results: BacktestResult[]
): CalibrationMetrics {
  const completed = results.filter(r => r.backtestResult !== "PUSH");
  const overCount = results.filter(r => r.backtestResult === "OVER").length;
  const underCount = results.filter(r => r.backtestResult === "UNDER").length;
  const pushCount = results.filter(r => r.backtestResult === "PUSH").length;

  const correct = completed.filter(r => r.modelCorrect).length;
  const modelAccuracy = completed.length > 0 ? correct / completed.length : 0;

  const overPreds = completed.filter(r => r.modelPrediction === "OVER");
  const underPreds = completed.filter(r => r.modelPrediction === "UNDER");

  const modelOverAccuracy =
    overPreds.length > 0
      ? overPreds.filter(r => r.modelCorrect).length / overPreds.length
      : 0;
  const modelUnderAccuracy =
    underPreds.length > 0
      ? underPreds.filter(r => r.modelCorrect).length / underPreds.length
      : 0;

  const errors = results.map(r => r.modelError);
  const mae =
    errors.length > 0
      ? errors.reduce((a, b) => a + Math.abs(b), 0) / errors.length
      : 0;
  const meanBias =
    errors.length > 0 ? errors.reduce((a, b) => a + b, 0) / errors.length : 0;
  const rmse =
    errors.length > 0
      ? Math.sqrt(errors.reduce((a, b) => a + b * b, 0) / errors.length)
      : 0;

  // Calibration factor: actual/projected mean
  const projMean =
    results.length > 0
      ? results.reduce((a, r) => a + r.kProj, 0) / results.length
      : 1;
  const actualMean =
    results.length > 0
      ? results.reduce((a, r) => a + r.actualKs, 0) / results.length
      : 1;
  const calibrationFactor = projMean > 0 ? actualMean / projMean : 1;

  return {
    totalProps: results.length,
    completedProps: completed.length,
    pendingProps: 0,
    overCount,
    underCount,
    pushCount,
    modelAccuracy,
    modelOverAccuracy,
    modelUnderAccuracy,
    mae,
    meanBias,
    rmse,
    calibrationFactor,
  };
}

/**
 * Fetch rolling calibration metrics across all completed K-props in the DB.
 * Used to display model performance on the frontend.
 */
export async function getRollingCalibrationMetrics(): Promise<CalibrationMetrics | null> {
  const db = await getDb();
  const rows = await db
    .select({
      kProj: mlbStrikeoutProps.kProj,
      actualKs: mlbStrikeoutProps.actualKs,
      backtestResult: mlbStrikeoutProps.backtestResult,
      modelCorrect: mlbStrikeoutProps.modelCorrect,
      modelError: mlbStrikeoutProps.modelError,
    })
    .from(mlbStrikeoutProps)
    .where(
      and(
        // Only rows with actual results
        or(
          eq(mlbStrikeoutProps.backtestResult, "OVER"),
          eq(mlbStrikeoutProps.backtestResult, "UNDER"),
          eq(mlbStrikeoutProps.backtestResult, "PUSH")
        )
      )
    );

  if (rows.length === 0) return null;

  const results: BacktestResult[] = rows
    .filter(
      (r: (typeof rows)[0]) =>
        r.kProj && r.actualKs !== null && r.backtestResult
    )
    .map((r: (typeof rows)[0]) => ({
      propId: 0,
      pitcherName: "",
      gameId: 0,
      bookLine: 0,
      kProj: parseFloat(r.kProj!),
      actualKs: r.actualKs!,
      backtestResult: r.backtestResult as "OVER" | "UNDER" | "PUSH",
      modelError: r.modelError ? parseFloat(r.modelError) : 0,
      modelCorrect: r.modelCorrect === 1,
      modelPrediction: parseFloat(r.kProj!) >= 0 ? "OVER" : "UNDER",
    }));

  return computeCalibrationMetrics(results);
}

/**
 * Fetch all K-prop backtest results for a specific game date (YYYY-MM-DD).
 * Returns rows with actual Ks, backtest result, model error, and model correctness.
 */
export async function getDailyBacktestResults(gameDate: string): Promise<{
  date: string;
  total: number;
  completed: number;
  correct: number;
  accuracy: number | null;
  overCorrect: number;
  underCorrect: number;
  overTotal: number;
  underTotal: number;
  meanError: number | null;
  mae: number | null;
  props: Array<{
    id: number;
    pitcherName: string;
    side: string;
    bookLine: string | null;
    kProj: string | null;
    actualKs: number | null;
    backtestResult: string | null;
    modelCorrect: number | null;
    modelError: string | null;
    anNoVigOverPct: string | null;
  }>;
}> {
  const db = await getDb();
  const rows = await db
    .select({
      id: mlbStrikeoutProps.id,
      pitcherName: mlbStrikeoutProps.pitcherName,
      side: mlbStrikeoutProps.side,
      bookLine: mlbStrikeoutProps.bookLine,
      kProj: mlbStrikeoutProps.kProj,
      actualKs: mlbStrikeoutProps.actualKs,
      backtestResult: mlbStrikeoutProps.backtestResult,
      modelCorrect: mlbStrikeoutProps.modelCorrect,
      modelError: mlbStrikeoutProps.modelError,
      anNoVigOverPct: mlbStrikeoutProps.anNoVigOverPct,
    })
    .from(mlbStrikeoutProps)
    .innerJoin(games, eq(mlbStrikeoutProps.gameId, games.id))
    .where(eq(games.gameDate, gameDate))
    .orderBy(mlbStrikeoutProps.pitcherName);

  const completed = rows.filter(
    (r: (typeof rows)[0]) =>
      r.backtestResult === "OVER" ||
      r.backtestResult === "UNDER" ||
      r.backtestResult === "PUSH"
  );
  const correct = completed.filter(
    (r: (typeof rows)[0]) => r.modelCorrect === 1
  );
  const overRows = completed.filter(
    (r: (typeof rows)[0]) => r.backtestResult === "OVER"
  );
  const underRows = completed.filter(
    (r: (typeof rows)[0]) => r.backtestResult === "UNDER"
  );
  const overCorrect = overRows.filter(
    (r: (typeof rows)[0]) => r.modelCorrect === 1
  ).length;
  const underCorrect = underRows.filter(
    (r: (typeof rows)[0]) => r.modelCorrect === 1
  ).length;

  const errors: number[] = completed
    .filter((r: (typeof rows)[0]) => r.modelError !== null)
    .map((r: (typeof rows)[0]) => parseFloat(r.modelError!));
  const meanError =
    errors.length > 0
      ? errors.reduce((a: number, b: number) => a + b, 0) / errors.length
      : null;
  const mae =
    errors.length > 0
      ? errors.reduce((a: number, b: number) => a + Math.abs(b), 0) /
        errors.length
      : null;

  return {
    date: gameDate,
    total: rows.length,
    completed: completed.length,
    correct: correct.length,
    accuracy: completed.length > 0 ? correct.length / completed.length : null,
    overCorrect,
    underCorrect,
    overTotal: overRows.length,
    underTotal: underRows.length,
    meanError,
    mae,
    props: rows,
  };
}

/**
 * Fetch rich daily backtest results for a specific game date (YYYY-MM-DD).
 * Includes team names, mlbamId for headshots, verdict, and edge data.
 * Used exclusively by the owner-only Model Results backend page.
 */
export async function getRichDailyBacktestResults(gameDate: string): Promise<{
  date: string;
  total: number;
  completed: number;
  correct: number;
  accuracy: number | null;
  overCorrect: number;
  underCorrect: number;
  overTotal: number;
  underTotal: number;
  meanError: number | null;
  mae: number | null;
  props: Array<{
    id: number;
    gameId: number;
    pitcherName: string;
    side: string;
    mlbamId: number | null;
    awayTeam: string;
    homeTeam: string;
    startTimeEst: string | null;
    bookLine: string | null;
    kProj: string | null;
    verdict: string | null;
    bestSide: string | null;
    bestEdge: string | null;
    bestMlStr: string | null;
    pOver: string | null;
    pUnder: string | null;
    bookOverOdds: string | null;
    bookUnderOdds: string | null;
    anNoVigOverPct: string | null;
    actualKs: number | null;
    backtestResult: string | null;
    modelCorrect: number | null;
    modelError: string | null;
    backtestRunAt: number | null;
  }>;
}> {
  const db = await getDb();
  const rows = await db
    .select({
      id: mlbStrikeoutProps.id,
      gameId: mlbStrikeoutProps.gameId,
      pitcherName: mlbStrikeoutProps.pitcherName,
      side: mlbStrikeoutProps.side,
      mlbamId: mlbStrikeoutProps.mlbamId,
      awayTeam: games.awayTeam,
      homeTeam: games.homeTeam,
      startTimeEst: games.startTimeEst,
      bookLine: mlbStrikeoutProps.bookLine,
      kProj: mlbStrikeoutProps.kProj,
      verdict: mlbStrikeoutProps.verdict,
      bestSide: mlbStrikeoutProps.bestSide,
      bestEdge: mlbStrikeoutProps.bestEdge,
      bestMlStr: mlbStrikeoutProps.bestMlStr,
      pOver: mlbStrikeoutProps.pOver,
      pUnder: mlbStrikeoutProps.pUnder,
      bookOverOdds: mlbStrikeoutProps.bookOverOdds,
      bookUnderOdds: mlbStrikeoutProps.bookUnderOdds,
      anNoVigOverPct: mlbStrikeoutProps.anNoVigOverPct,
      actualKs: mlbStrikeoutProps.actualKs,
      backtestResult: mlbStrikeoutProps.backtestResult,
      modelCorrect: mlbStrikeoutProps.modelCorrect,
      modelError: mlbStrikeoutProps.modelError,
      backtestRunAt: mlbStrikeoutProps.backtestRunAt,
    })
    .from(mlbStrikeoutProps)
    .innerJoin(games, eq(mlbStrikeoutProps.gameId, games.id))
    .where(eq(games.gameDate, gameDate))
    .orderBy(games.startTimeEst, mlbStrikeoutProps.side);

  type RichRow = (typeof rows)[0];
  const completed = rows.filter(
    (r: RichRow) =>
      r.backtestResult === "OVER" ||
      r.backtestResult === "UNDER" ||
      r.backtestResult === "PUSH"
  );
  const correct = completed.filter((r: RichRow) => r.modelCorrect === 1);
  const overRows = completed.filter(
    (r: RichRow) => r.backtestResult === "OVER"
  );
  const underRows = completed.filter(
    (r: RichRow) => r.backtestResult === "UNDER"
  );
  const overCorrect = overRows.filter(
    (r: RichRow) => r.modelCorrect === 1
  ).length;
  const underCorrect = underRows.filter(
    (r: RichRow) => r.modelCorrect === 1
  ).length;
  const errors: number[] = completed
    .filter((r: RichRow) => r.modelError !== null)
    .map((r: RichRow) => parseFloat(r.modelError!));
  const meanError =
    errors.length > 0
      ? errors.reduce((a: number, b: number) => a + b, 0) / errors.length
      : null;
  const mae =
    errors.length > 0
      ? errors.reduce((a: number, b: number) => a + Math.abs(b), 0) /
        errors.length
      : null;

  return {
    date: gameDate,
    total: rows.length,
    completed: completed.length,
    correct: correct.length,
    accuracy: completed.length > 0 ? correct.length / completed.length : null,
    overCorrect,
    underCorrect,
    overTotal: overRows.length,
    underTotal: underRows.length,
    meanError,
    mae,
    props: rows as any,
  };
}

/**
 * Fetch aggregate K-Props backtest metrics for the last N days (default 7).
 *
 * Returns:
 *   - Per-day breakdown: date, total, completed, correct, accuracy, overTotal, underTotal, mae
 *   - Aggregate totals across all days in the window
 *   - OVER/UNDER bias: % of completed results that were OVER vs UNDER
 *   - Rolling MAE across the window
 *
 * Only includes days that have at least one prop in the window.
 */
export async function getLast7DaysBacktest(days = 7): Promise<{
  windowDays: number;
  totalProps: number;
  completedProps: number;
  correctProps: number;
  accuracy: number | null;
  overTotal: number;
  underTotal: number;
  pushTotal: number;
  overCorrect: number;
  underCorrect: number;
  overAccuracy: number | null;
  underAccuracy: number | null;
  overBiasPct: number | null;
  underBiasPct: number | null;
  mae: number | null;
  meanError: number | null;
  dailyBreakdown: Array<{
    date: string;
    total: number;
    completed: number;
    correct: number;
    accuracy: number | null;
    overTotal: number;
    underTotal: number;
    pushTotal: number;
    mae: number | null;
    meanError: number | null;
  }>;
}> {
  const db = await getDb();
  const { gte, lte } = await import("drizzle-orm");

  // Build date range: today back N days
  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - (days - 1));
  const startStr = startDate.toISOString().slice(0, 10);
  const todayStr = today.toISOString().slice(0, 10);

  console.log(
    `[KBacktest][Last7Days] Querying ${days}-day window: ${startStr} -> ${todayStr}`
  );

  const rows = await db
    .select({
      gameDate: games.gameDate,
      backtestResult: mlbStrikeoutProps.backtestResult,
      modelCorrect: mlbStrikeoutProps.modelCorrect,
      modelError: mlbStrikeoutProps.modelError,
    })
    .from(mlbStrikeoutProps)
    .innerJoin(games, eq(mlbStrikeoutProps.gameId, games.id))
    .where(and(gte(games.gameDate, startStr), lte(games.gameDate, todayStr)))
    .orderBy(games.gameDate);

  type Row = (typeof rows)[0];

  // Group by date
  const byDate = new Map<string, Row[]>();
  for (const row of rows) {
    const d = row.gameDate;
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d)!.push(row);
  }

  // Build per-day breakdown
  const dailyBreakdown = Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dayRows]) => {
      const completed = dayRows.filter(
        (r: Row) =>
          r.backtestResult === "OVER" ||
          r.backtestResult === "UNDER" ||
          r.backtestResult === "PUSH"
      );
      const correct = completed.filter((r: Row) => r.modelCorrect === 1);
      const overRows = completed.filter(
        (r: Row) => r.backtestResult === "OVER"
      );
      const underRows = completed.filter(
        (r: Row) => r.backtestResult === "UNDER"
      );
      const pushRows = completed.filter(
        (r: Row) => r.backtestResult === "PUSH"
      );
      const errors = completed
        .filter((r: Row) => r.modelError !== null)
        .map((r: Row) => parseFloat(r.modelError!));
      const mae =
        errors.length > 0
          ? errors.reduce((a: number, b: number) => a + Math.abs(b), 0) /
            errors.length
          : null;
      const meanError =
        errors.length > 0
          ? errors.reduce((a: number, b: number) => a + b, 0) / errors.length
          : null;
      return {
        date,
        total: dayRows.length,
        completed: completed.length,
        correct: correct.length,
        accuracy:
          completed.length > 0 ? correct.length / completed.length : null,
        overTotal: overRows.length,
        underTotal: underRows.length,
        pushTotal: pushRows.length,
        mae,
        meanError,
      };
    });

  // Aggregate totals
  const allCompleted = rows.filter(
    (r: Row) =>
      r.backtestResult === "OVER" ||
      r.backtestResult === "UNDER" ||
      r.backtestResult === "PUSH"
  );
  const allCorrect = allCompleted.filter((r: Row) => r.modelCorrect === 1);
  const allOvers = allCompleted.filter((r: Row) => r.backtestResult === "OVER");
  const allUnders = allCompleted.filter(
    (r: Row) => r.backtestResult === "UNDER"
  );
  const allPushes = allCompleted.filter(
    (r: Row) => r.backtestResult === "PUSH"
  );
  const overCorrect = allOvers.filter((r: Row) => r.modelCorrect === 1).length;
  const underCorrect = allUnders.filter(
    (r: Row) => r.modelCorrect === 1
  ).length;

  const allErrors = allCompleted
    .filter((r: Row) => r.modelError !== null)
    .map((r: Row) => parseFloat(r.modelError!));
  const mae =
    allErrors.length > 0
      ? allErrors.reduce((a: number, b: number) => a + Math.abs(b), 0) /
        allErrors.length
      : null;
  const meanError =
    allErrors.length > 0
      ? allErrors.reduce((a: number, b: number) => a + b, 0) / allErrors.length
      : null;

  // OVER/UNDER bias: % of non-push completed results that went OVER vs UNDER
  const nonPushCompleted = allOvers.length + allUnders.length;
  const overBiasPct =
    nonPushCompleted > 0 ? allOvers.length / nonPushCompleted : null;
  const underBiasPct =
    nonPushCompleted > 0 ? allUnders.length / nonPushCompleted : null;

  console.log(
    `[KBacktest][Last7Days] DONE: total=${rows.length} completed=${allCompleted.length} ` +
      `correct=${allCorrect.length} ` +
      `accuracy=${allCompleted.length > 0 ? ((allCorrect.length / allCompleted.length) * 100).toFixed(1) + "%" : "N/A"} ` +
      `mae=${mae?.toFixed(3) ?? "N/A"} ` +
      `bias=${overBiasPct !== null ? (overBiasPct * 100).toFixed(1) + "% OVER" : "N/A"}`
  );

  return {
    windowDays: days,
    totalProps: rows.length,
    completedProps: allCompleted.length,
    correctProps: allCorrect.length,
    accuracy:
      allCompleted.length > 0 ? allCorrect.length / allCompleted.length : null,
    overTotal: allOvers.length,
    underTotal: allUnders.length,
    pushTotal: allPushes.length,
    overCorrect,
    underCorrect,
    overAccuracy: allOvers.length > 0 ? overCorrect / allOvers.length : null,
    underAccuracy:
      allUnders.length > 0 ? underCorrect / allUnders.length : null,
    overBiasPct,
    underBiasPct,
    mae,
    meanError,
    dailyBreakdown,
  };
}
