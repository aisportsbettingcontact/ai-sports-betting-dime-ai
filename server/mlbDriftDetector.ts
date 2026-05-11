/**
 * mlbDriftDetector.ts — Rolling f5_share drift detection + auto-recalibration trigger.
 *
 * PURPOSE:
 *   Monitors the rolling empirical f5_share (F5 runs / FG runs) over the last N games
 *   and compares it against the 3-year calibrated baseline of 0.5618.
 *   If the delta exceeds DRIFT_THRESHOLD (0.02), triggers a recalibration event.
 *
 * DRIFT DEFINITION:
 *   f5_share = actualF5Total / actualFgTotal  (per game)
 *   rolling_f5_share = mean(f5_share) over last WINDOW_SIZE games
 *   drift = |rolling_f5_share - BASELINE_F5_SHARE|
 *   DRIFT_DETECTED if drift > DRIFT_THRESHOLD
 *
 * CONSTANTS (from MLBAIModel.py EMPIRICAL_PRIORS, calibrated 2026-04-14):
 *   BASELINE_F5_SHARE = 0.5618  (3yr, n=5,103 games)
 *   DRIFT_THRESHOLD   = 0.02    (2% absolute delta = ~1 run per 50-run game)
 *   WINDOW_SIZE       = 50      (rolling window: ~3-4 days of MLB games)
 *   MIN_SAMPLE        = 20      (minimum games before drift detection fires)
 *
 * RECALIBRATION TRIGGER:
 *   On drift detection, this module:
 *   1. Writes a row to mlb_model_learning_log with triggerReason='DRIFT_DETECTED'
 *   2. Emits a structured [DRIFT] log line for monitoring
 *   3. Calls triggerRecalibration() which spawns runMlbBacktest2.py asynchronously
 *   4. After backtest completes, calls migrateCalibrationConstants() to patch MLBAIModel.py
 *
 * IDEMPOTENCY:
 *   Drift detection runs after every outcome ingestion batch.
 *   A recalibration is NOT triggered if one ran within the last 24 hours
 *   (prevents thrashing on noisy short windows).
 *
 * LOGGING CONVENTION:
 *   [DriftDetector][INPUT]  — trigger context
 *   [DriftDetector][STEP]   — operation in progress
 *   [DriftDetector][STATE]  — intermediate values
 *   [DriftDetector][OUTPUT] — drift result
 *   [DriftDetector][DRIFT]  — drift event (high-signal, always logged)
 *   [DriftDetector][VERIFY] — validation pass/fail
 *   [DriftDetector][ERROR]  — failure with context
 */

import { and, eq, isNotNull, sql, desc } from "drizzle-orm";
import { getDb } from "./db";
import { games, mlbModelLearningLog, mlbDriftState, mlbCalibrationConstants } from "../drizzle/schema";
import { spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Constants ────────────────────────────────────────────────────────────────

const TAG = "[DriftDetector]";

/** 3-year calibrated F5 run share baseline (MLBAIModel.py EMPIRICAL_PRIORS.f5_share) */
export const BASELINE_F5_SHARE = 0.5618;

/** Absolute delta threshold to trigger recalibration (from MLBAIModel.py DRIFT_THRESHOLD) */
export const DRIFT_THRESHOLD = 0.02;

/** Rolling window size in games */
export const WINDOW_SIZE = 50;

/** Minimum games before drift detection fires (prevents false positives on small samples) */
export const MIN_SAMPLE = 20;

/** Minimum hours between recalibration runs (prevents thrashing) */
const RECAL_COOLDOWN_HOURS = 24;

/** Path to the backtest script */
const BACKTEST_SCRIPT = path.resolve(__dirname, "../scripts/runMlbBacktest2.py");

/** Path to the calibration constants output */
const CALIBRATION_JSON = "/home/ubuntu/mlb_calibration_constants.json";

/** Path to MLBAIModel.py */
const MODEL_PY = path.resolve(__dirname, "MLBAIModel.py");

// ─── Drift State Persistence ─────────────────────────────────────────────────────────────────────────────────

/**
 * Upserts the current drift check result into mlb_drift_state.
 * Called at every return point in checkF5ShareDrift() to ensure the state
 * table always reflects the latest check, regardless of drift outcome.
 */
async function persistDriftState(
  market: string,
  rollingValue: number | null,
  baselineValue: number,
  delta: number | null,
  direction: "HIGH" | "LOW" | "STABLE",
  driftDetected: boolean,
  sampleSize: number,
  recalibrationTriggered: boolean,
): Promise<void> {
  try {
    const db = await getDb();
    const now = Date.now();
    const existing = await db
      .select()
      .from(mlbDriftState)
      .where(eq(mlbDriftState.market, market))
      .limit(1);
    const prev = existing[0];
    const consecutiveDriftCount = driftDetected
      ? (prev?.consecutiveDriftCount ?? 0) + 1
      : 0;
    const lastRecalibrationAt = recalibrationTriggered
      ? now
      : (prev?.lastRecalibrationAt ?? null);
    if (prev) {
      await db
        .update(mlbDriftState)
        .set({
          windowSize: WINDOW_SIZE,
          rollingValue: rollingValue !== null ? String(rollingValue) : null,
          baselineValue: String(baselineValue),
          delta: delta !== null ? String(delta) : null,
          direction,
          driftDetected: driftDetected ? 1 : 0,
          sampleSize,
          lastCheckedAt: now,
          lastRecalibrationAt,
          consecutiveDriftCount,
        })
        .where(eq(mlbDriftState.market, market));
    } else {
      await db.insert(mlbDriftState).values({
        market,
        windowSize: WINDOW_SIZE,
        rollingValue: rollingValue !== null ? String(rollingValue) : null,
        baselineValue: String(baselineValue),
        delta: delta !== null ? String(delta) : null,
        direction,
        driftDetected: driftDetected ? 1 : 0,
        sampleSize,
        lastCheckedAt: now,
        lastRecalibrationAt: recalibrationTriggered ? now : null,
        consecutiveDriftCount,
      });
    }
    console.log(
      `${TAG} [STATE] persistDriftState: market=${market} rolling=${rollingValue} delta=${delta} driftDetected=${driftDetected} consecutiveDrift=${consecutiveDriftCount}`
    );
  } catch (err) {
    console.error(`${TAG} [ERROR] persistDriftState failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ─── Calibration Constants Seeder ─────────────────────────────────────────────────────────────────────────────────

/**
 * Seeds mlb_calibration_constants with baseline values derived from the
 * 3-year backtest (MLBAIModel.py EMPIRICAL_PRIORS, calibrated 2026-04-14).
 * Uses INSERT-if-not-exists semantics — safe to call on every startup.
 */
export async function seedCalibrationConstants(): Promise<void> {
  const TAG_SEED = "[CalibrationSeed]";
  const db = await getDb();
  const now = Date.now();
  const BASELINE_PARAMS = [
    { paramName: "f5_share",             currentValue: "0.56180000", baselineValue: "0.56180000", sampleSize: 5103, ciLower: "0.55800000", ciUpper: "0.56560000" },
    { paramName: "nrfi_rate",            currentValue: "0.48820000", baselineValue: "0.48820000", sampleSize: 5103, ciLower: "0.47900000", ciUpper: "0.49740000" },
    { paramName: "k_calibration_factor", currentValue: "1.00000000", baselineValue: "1.00000000", sampleSize: 0,    ciLower: "0.95000000", ciUpper: "1.05000000" },
    { paramName: "hr_base_rate",         currentValue: "0.10090238", baselineValue: "0.10090238", sampleSize: 2438, ciLower: "0.09590238", ciUpper: "0.10590238" },
    { paramName: "f5_under_bias",        currentValue: "0.00000000", baselineValue: "0.00000000", sampleSize: 0,    ciLower: "-0.05000000", ciUpper: "0.05000000" },
    { paramName: "fg_ml_home_edge",      currentValue: "0.00000000", baselineValue: "0.00000000", sampleSize: 0,    ciLower: "-0.05000000", ciUpper: "0.05000000" },
  ];
  let seeded = 0, skipped = 0;
  for (const param of BASELINE_PARAMS) {
    const existing = await db
      .select({ id: mlbCalibrationConstants.id })
      .from(mlbCalibrationConstants)
      .where(eq(mlbCalibrationConstants.paramName, param.paramName))
      .limit(1);
    if (existing.length > 0) { skipped++; continue; }
    await db.insert(mlbCalibrationConstants).values({
      paramName: param.paramName,
      currentValue: param.currentValue,
      baselineValue: param.baselineValue,
      sampleSize: param.sampleSize,
      ciLower: param.ciLower,
      ciUpper: param.ciUpper,
      updateSource: "INIT",
      lastUpdatedAt: now,
    });
    seeded++;
    console.log(`${TAG_SEED} [OUTPUT] Seeded param=${param.paramName} value=${param.currentValue}`);
  }
  console.log(`${TAG_SEED} [VERIFY] Seeded ${seeded} params, skipped ${skipped} (already exist)`);
}

// ─── Types ─────────────────────────────────────────────────────────────────────────────────

export interface DriftCheckResult {
  /** Number of games in the rolling window */
  windowSize: number;
  /** Rolling f5_share over the window */
  rollingF5Share: number | null;
  /** Baseline f5_share (3yr calibrated) */
  baselineF5Share: number;
  /** Absolute delta: |rolling - baseline| */
  delta: number | null;
  /** True if drift detected (delta > DRIFT_THRESHOLD and windowSize >= MIN_SAMPLE) */
  driftDetected: boolean;
  /** True if recalibration was triggered */
  recalibrationTriggered: boolean;
  /** True if recalibration was skipped due to cooldown */
  cooldownSkipped: boolean;
  /** ISO timestamp of last recalibration (null if never) */
  lastRecalibrationAt: string | null;
  /** Detailed message for logging */
  message: string;
}

export interface RecalibrationResult {
  /** True if backtest completed successfully */
  success: boolean;
  /** Path to the generated calibration constants JSON */
  calibrationJsonPath: string;
  /** New f5_share value from the backtest */
  newF5Share: number | null;
  /** New nrfi_rate value from the backtest */
  newNrfiRate: number | null;
  /** Number of constants patched in MLBAIModel.py */
  constantsPatched: number;
  /** Error message if failed */
  error?: string;
  /** Elapsed time in seconds */
  elapsedSec: number;
}

// ─── Rolling f5_share Computation ────────────────────────────────────────────

/**
 * Computes the rolling f5_share over the last WINDOW_SIZE games that have
 * both actualFgTotal and actualF5Total populated.
 *
 * Returns null if fewer than MIN_SAMPLE games are available.
 */
async function computeRollingF5Share(windowSize = WINDOW_SIZE): Promise<{
  share: number | null;
  sampleSize: number;
  games: Array<{ id: number; date: string; f5: number; fg: number; share: number }>;
}> {
  const db = await getDb();

  // Fetch the most recent WINDOW_SIZE games with both totals populated
  const rows = await db
    .select({
      id: games.id,
      gameDate: games.gameDate,
      actualF5Total: games.actualF5Total,
      actualFgTotal: games.actualFgTotal,
    })
    .from(games)
    .where(
      and(
        eq(games.sport, "MLB"),
        isNotNull(games.actualF5Total),
        isNotNull(games.actualFgTotal),
        sql`${games.actualFgTotal} > 0`,
      )
    )
    .orderBy(desc(games.outcomeIngestedAt))
    .limit(windowSize);

  if (rows.length < MIN_SAMPLE) {
    return { share: null, sampleSize: rows.length, games: [] };
  }

  type RowType = { id: number; gameDate: string | null; actualF5Total: string | null; actualFgTotal: string | null };
  const gameData: Array<{ id: number; date: string; f5: number; fg: number; share: number }> = (rows as RowType[]).map(r => {
    const f5 = parseFloat(String(r.actualF5Total));
    const fg = parseFloat(String(r.actualFgTotal));
    const share = fg > 0 ? f5 / fg : 0;
    return {
      id: r.id,
      date: r.gameDate ?? "",
      f5,
      fg,
      share: parseFloat(share.toFixed(6)),
    };
  });

  const meanShare = gameData.reduce((s: number, g: { share: number }) => s + g.share, 0) / gameData.length;

  return {
    share: parseFloat(meanShare.toFixed(6)),
    sampleSize: gameData.length,
    games: gameData,
  };
}

// ─── Last Recalibration Check ─────────────────────────────────────────────────

/**
 * Returns the UTC ms timestamp of the most recent recalibration run,
 * or null if no recalibration has ever run.
 */
async function getLastRecalibrationAt(): Promise<number | null> {
  const db = await getDb();
  const rows = await db
    .select({ runAt: mlbModelLearningLog.runAt })
    .from(mlbModelLearningLog)
    .where(
      sql`${mlbModelLearningLog.triggerReason} IN ('DRIFT_DETECTED', 'SCHEDULED', 'MANUAL')`
    )
    .orderBy(desc(mlbModelLearningLog.runAt))
    .limit(1);

  return rows.length > 0 ? rows[0].runAt : null;
}

// ─── Main Drift Check ─────────────────────────────────────────────────────────

/**
 * Runs the rolling f5_share drift check and triggers recalibration if needed.
 *
 * Called after every outcome ingestion batch by mlbNightlyCron.
 * Also callable manually for diagnostics.
 *
 * @param triggerRecal  If false, drift is detected and logged but recalibration is NOT triggered.
 *                      Useful for dry-run diagnostics.
 */
export async function checkF5ShareDrift(triggerRecal = true): Promise<DriftCheckResult> {
  const startMs = Date.now();
  console.log(`\n${TAG} ══════════════════════════════════════════════════════`);
  console.log(`${TAG} [INPUT] BASELINE_F5_SHARE=${BASELINE_F5_SHARE} DRIFT_THRESHOLD=${DRIFT_THRESHOLD} WINDOW_SIZE=${WINDOW_SIZE} MIN_SAMPLE=${MIN_SAMPLE} triggerRecal=${triggerRecal}`);

  // ── Step 1: Compute rolling f5_share ─────────────────────────────────────
  console.log(`${TAG} [STEP 1] Computing rolling f5_share over last ${WINDOW_SIZE} games`);
  const { share: rollingF5Share, sampleSize, games: gameData } = await computeRollingF5Share();

  console.log(`${TAG} [STATE] sampleSize=${sampleSize} rollingF5Share=${rollingF5Share ?? "null (insufficient data)"}`);

  if (rollingF5Share === null) {
    const msg = `INSUFFICIENT DATA — ${sampleSize}/${MIN_SAMPLE} games with outcomes (need ${MIN_SAMPLE} minimum)`;
    console.log(`${TAG} [OUTPUT] ${msg}`);
    await persistDriftState("F5_SHARE", null, BASELINE_F5_SHARE, null, "STABLE", false, sampleSize, false);
    return {
      windowSize: sampleSize,
      rollingF5Share: null,
      baselineF5Share: BASELINE_F5_SHARE,
      delta: null,
      driftDetected: false,
      recalibrationTriggered: false,
      cooldownSkipped: false,
      lastRecalibrationAt: null,
      message: msg,
    };
  }

  // ── Step 2: Compute delta ─────────────────────────────────────────────────
  const delta = parseFloat(Math.abs(rollingF5Share - BASELINE_F5_SHARE).toFixed(6));
  const direction = rollingF5Share > BASELINE_F5_SHARE ? "HIGH" : "LOW";
  const driftDetected = delta > DRIFT_THRESHOLD;

  console.log(
    `${TAG} [STATE] rollingF5Share=${rollingF5Share} baseline=${BASELINE_F5_SHARE}` +
    ` delta=${delta} threshold=${DRIFT_THRESHOLD} direction=${direction}` +
    ` driftDetected=${driftDetected}`
  );

  // Log the per-game distribution for diagnostics
  if (gameData.length > 0) {
    const shares = gameData.map(g => g.share);
    const min = Math.min(...shares).toFixed(4);
    const max = Math.max(...shares).toFixed(4);
    const std = parseFloat(
      Math.sqrt(shares.reduce((s, v) => s + Math.pow(v - rollingF5Share, 2), 0) / shares.length).toFixed(6)
    );
    console.log(`${TAG} [STATE] Distribution: min=${min} max=${max} std=${std} n=${gameData.length}`);
  }

  if (!driftDetected) {
    const msg = `PASS — delta=${delta} ≤ threshold=${DRIFT_THRESHOLD} | rolling=${rollingF5Share} baseline=${BASELINE_F5_SHARE} (n=${sampleSize})`;
    console.log(`${TAG} [VERIFY] ${msg}`);
    console.log(`${TAG} ══════════════════════════════════════════════════════\n`);
    await persistDriftState("F5_SHARE", rollingF5Share, BASELINE_F5_SHARE, delta, direction as "HIGH" | "LOW" | "STABLE", false, sampleSize, false);
    return {
      windowSize: sampleSize,
      rollingF5Share,
      baselineF5Share: BASELINE_F5_SHARE,
      delta,
      driftDetected: false,
      recalibrationTriggered: false,
      cooldownSkipped: false,
      lastRecalibrationAt: null,
      message: msg,
    };
  }

  // ── Step 3: Drift detected — check cooldown ───────────────────────────────
  console.log(`${TAG} [DRIFT] DRIFT DETECTED — delta=${delta} > threshold=${DRIFT_THRESHOLD}`);
  console.log(`${TAG} [DRIFT] rolling=${rollingF5Share} baseline=${BASELINE_F5_SHARE} direction=${direction} n=${sampleSize}`);

  const lastRecalAt = await getLastRecalibrationAt();
  const lastRecalIso = lastRecalAt ? new Date(lastRecalAt).toISOString() : null;
  let cooldownSkipped = false;

  if (lastRecalAt !== null) {
    const hoursSinceLast = (Date.now() - lastRecalAt) / (1000 * 60 * 60);
    if (hoursSinceLast < RECAL_COOLDOWN_HOURS) {
      cooldownSkipped = true;
      const msg = `DRIFT DETECTED but cooldown active — last recal ${hoursSinceLast.toFixed(1)}h ago (cooldown=${RECAL_COOLDOWN_HOURS}h) | delta=${delta} rolling=${rollingF5Share}`;
      console.log(`${TAG} [STATE] ${msg}`);

      // Still log the drift event to learning log for tracking
      await writeDriftEvent(rollingF5Share, delta, sampleSize, "cooldown_skipped");
      await persistDriftState("F5_SHARE", rollingF5Share, BASELINE_F5_SHARE, delta, direction as "HIGH" | "LOW" | "STABLE", true, sampleSize, false);
      return {
        windowSize: sampleSize,
        rollingF5Share,
        baselineF5Share: BASELINE_F5_SHARE,
        delta,
        driftDetected: true,
        recalibrationTriggered: false,
        cooldownSkipped: true,
        lastRecalibrationAt: lastRecalIso,
        message: msg,
      };
    }
  }

  // ── Step 4: Write drift event to learning log ─────────────────────────────
  await writeDriftEvent(rollingF5Share, delta, sampleSize, "drift_detected");

  if (!triggerRecal) {
    const msg = `DRIFT DETECTED (dry-run) — delta=${delta} rolling=${rollingF5Share} n=${sampleSize} | recalibration NOT triggered (triggerRecal=false)`;
    console.log(`${TAG} [OUTPUT] ${msg}`);
    await persistDriftState("F5_SHARE", rollingF5Share, BASELINE_F5_SHARE, delta, direction as "HIGH" | "LOW" | "STABLE", true, sampleSize, false);
    return {
      windowSize: sampleSize,
      rollingF5Share,
      baselineF5Share: BASELINE_F5_SHARE,
      delta,
      driftDetected: true,
      recalibrationTriggered: false,
      cooldownSkipped: false,
      lastRecalibrationAt: lastRecalIso,
      message: msg,
    };
  }

  // ── Step 5: Trigger recalibration ────────────────────────────────────────
  console.log(`${TAG} [STEP 5] Triggering recalibration`);
  const recalResult = await triggerRecalibration("DRIFT_DETECTED");

  const msg = recalResult.success
    ? `DRIFT DETECTED + RECALIBRATED — delta=${delta} rolling=${rollingF5Share} → new_f5_share=${recalResult.newF5Share} | ${recalResult.constantsPatched} constants patched`
    : `DRIFT DETECTED + RECALIBRATION FAILED — delta=${delta} rolling=${rollingF5Share} | error=${recalResult.error}`;

  console.log(`${TAG} [OUTPUT] ${msg}`);
  console.log(`${TAG} ══════════════════════════════════════════════════════\n`);
  await persistDriftState("F5_SHARE", rollingF5Share, BASELINE_F5_SHARE, delta, direction as "HIGH" | "LOW" | "STABLE", true, sampleSize, recalResult.success);
  return {
    windowSize: sampleSize,
    rollingF5Share,
    baselineF5Share: BASELINE_F5_SHARE,
    delta,
    driftDetected: true,
    recalibrationTriggered: recalResult.success,
    cooldownSkipped: false,
    lastRecalibrationAt: lastRecalIso,
    message: msg,
  };
}

// ─── Drift Event Logger ───────────────────────────────────────────────────────

async function writeDriftEvent(
  rollingF5Share: number,
  delta: number,
  sampleSize: number,
  reason: string,
): Promise<void> {
  try {
    const db = await getDb();
    await db.insert(mlbModelLearningLog).values({
      market: "F5_SHARE",
      windowDays: 0, // window is in games, not days
      accuracyBefore: String(BASELINE_F5_SHARE),
      accuracyAfter: String(rollingF5Share),
      maeBefore: String(delta),
      maeAfter: "0",
      paramChanges: JSON.stringify({
        metric: "f5_share",
        baseline: BASELINE_F5_SHARE,
        rolling: rollingF5Share,
        delta,
        direction: rollingF5Share > BASELINE_F5_SHARE ? "HIGH" : "LOW",
        windowGames: sampleSize,
        threshold: DRIFT_THRESHOLD,
      }),
      triggerReason: reason,
      sampleSize,
      runAt: Date.now(),
    });
    console.log(`${TAG} [STATE] Drift event written to mlb_model_learning_log (reason=${reason})`);
  } catch (err) {
    console.error(`${TAG} [ERROR] Failed to write drift event: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ─── Recalibration Trigger ────────────────────────────────────────────────────

/**
 * Triggers a full recalibration run:
 *   1. Runs runMlbBacktest2.py (3yr backtest, ~15-20 min)
 *   2. Reads the output mlb_calibration_constants.json
 *   3. Patches the EMPIRICAL_PRIORS dict in MLBAIModel.py
 *   4. Writes a completion row to mlb_model_learning_log
 *
 * @param reason  'DRIFT_DETECTED' | 'SCHEDULED' | 'MANUAL'
 */
export async function triggerRecalibration(
  reason: "DRIFT_DETECTED" | "SCHEDULED" | "MANUAL" = "MANUAL",
): Promise<RecalibrationResult> {
  const startMs = Date.now();
  console.log(`${TAG} [STEP] triggerRecalibration: reason=${reason}`);

  // Verify backtest script exists
  if (!fs.existsSync(BACKTEST_SCRIPT)) {
    const err = `Backtest script not found: ${BACKTEST_SCRIPT}`;
    console.error(`${TAG} [ERROR] ${err}`);
    return { success: false, calibrationJsonPath: CALIBRATION_JSON, newF5Share: null, newNrfiRate: null, constantsPatched: 0, error: err, elapsedSec: 0 };
  }

  // ── Run backtest ──────────────────────────────────────────────────────────
  console.log(`${TAG} [STEP] Spawning runMlbBacktest2.py`);
  const backtestResult = await runBacktestScript();

  if (!backtestResult.success) {
    return {
      success: false,
      calibrationJsonPath: CALIBRATION_JSON,
      newF5Share: null,
      newNrfiRate: null,
      constantsPatched: 0,
      error: backtestResult.error,
      elapsedSec: (Date.now() - startMs) / 1000,
    };
  }

  // ── Read calibration constants ────────────────────────────────────────────
  console.log(`${TAG} [STEP] Reading calibration constants from ${CALIBRATION_JSON}`);
  let calibration: Record<string, unknown>;
  try {
    const raw = fs.readFileSync(CALIBRATION_JSON, "utf-8");
    calibration = JSON.parse(raw);
  } catch (err) {
    const msg = `Failed to read ${CALIBRATION_JSON}: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`${TAG} [ERROR] ${msg}`);
    return { success: false, calibrationJsonPath: CALIBRATION_JSON, newF5Share: null, newNrfiRate: null, constantsPatched: 0, error: msg, elapsedSec: (Date.now() - startMs) / 1000 };
  }

  const overall = calibration.overall as Record<string, number> | undefined;
  if (!overall) {
    const msg = "Calibration JSON missing 'overall' key";
    console.error(`${TAG} [ERROR] ${msg}`);
    return { success: false, calibrationJsonPath: CALIBRATION_JSON, newF5Share: null, newNrfiRate: null, constantsPatched: 0, error: msg, elapsedSec: (Date.now() - startMs) / 1000 };
  }

  const newF5Share = typeof overall.f5_run_share === "number" ? overall.f5_run_share : null;
  const newNrfiRate = typeof overall.nrfi_rate === "number" ? overall.nrfi_rate : null;

  console.log(`${TAG} [STATE] New calibration: f5_share=${newF5Share} nrfi_rate=${newNrfiRate}`);

  // ── Patch MLBAIModel.py ───────────────────────────────────────────────────
  console.log(`${TAG} [STEP] Patching MLBAIModel.py constants`);
  const patchResult = await migrateCalibrationConstants(calibration, reason);

  // ── Write completion to learning log ─────────────────────────────────────
  try {
    const db = await getDb();
    await db.insert(mlbModelLearningLog).values({
      market: "ALL_MARKETS",
      windowDays: 0,
      accuracyBefore: String(BASELINE_F5_SHARE),
      accuracyAfter: String(newF5Share ?? BASELINE_F5_SHARE),
      maeBefore: "0",
      maeAfter: "0",
      paramChanges: JSON.stringify({
        newF5Share,
        newNrfiRate,
        constantsPatched: patchResult.patched,
        backtestElapsedSec: backtestResult.elapsedSec,
        calibrationJsonPath: CALIBRATION_JSON,
      }),
      triggerReason: reason,
      sampleSize: 0,
      runAt: Date.now(),
    });
    console.log(`${TAG} [STATE] Recalibration completion written to mlb_model_learning_log`);
  } catch (err) {
    console.error(`${TAG} [ERROR] Failed to write recalibration log: ${err instanceof Error ? err.message : String(err)}`);
  }

  const elapsed = (Date.now() - startMs) / 1000;
  console.log(`${TAG} [OUTPUT] Recalibration complete: newF5Share=${newF5Share} newNrfiRate=${newNrfiRate} constantsPatched=${patchResult.patched} elapsed=${elapsed.toFixed(1)}s`);

  return {
    success: true,
    calibrationJsonPath: CALIBRATION_JSON,
    newF5Share,
    newNrfiRate,
    constantsPatched: patchResult.patched,
    elapsedSec: elapsed,
  };
}

// ─── Backtest Script Runner ───────────────────────────────────────────────────

async function runBacktestScript(): Promise<{ success: boolean; error?: string; elapsedSec: number }> {
  const startMs = Date.now();
  return new Promise((resolve) => {
    const proc = spawn("python3", [BACKTEST_SCRIPT], {
      cwd: path.dirname(BACKTEST_SCRIPT),
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      const line = chunk.toString();
      stdout += line;
      // Relay key lines to server log
      if (line.includes("[OUTPUT]") || line.includes("[VERIFY]") || line.includes("[ERROR]")) {
        process.stdout.write(`${TAG} [BACKTEST] ${line}`);
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      const elapsedSec = (Date.now() - startMs) / 1000;
      if (code === 0) {
        console.log(`${TAG} [STATE] Backtest completed successfully in ${elapsedSec.toFixed(1)}s`);
        resolve({ success: true, elapsedSec });
      } else {
        const errMsg = `Backtest exited with code ${code}: ${stderr.slice(-500)}`;
        console.error(`${TAG} [ERROR] ${errMsg}`);
        resolve({ success: false, error: errMsg, elapsedSec });
      }
    });

    proc.on("error", (err) => {
      const elapsedSec = (Date.now() - startMs) / 1000;
      console.error(`${TAG} [ERROR] Failed to spawn backtest: ${err.message}`);
      resolve({ success: false, error: err.message, elapsedSec });
    });
  });
}

// ─── Constants Migration ──────────────────────────────────────────────────────

/**
 * Patches the EMPIRICAL_PRIORS dict in MLBAIModel.py with new calibration values.
 *
 * Strategy: regex-based line replacement for each constant.
 * Each constant has a comment with the old value for traceability.
 * A backup of the original file is written to MLBAIModel.py.bak before patching.
 *
 * @param calibration  Parsed mlb_calibration_constants.json
 * @param reason       Trigger reason for the comment
 */
export async function migrateCalibrationConstants(
  calibration: Record<string, unknown>,
  reason: string,
): Promise<{ patched: number; backup: string }> {
  const overall = calibration.overall as Record<string, number> | undefined;
  if (!overall) {
    console.warn(`${TAG} [WARN] migrateCalibrationConstants: no 'overall' key in calibration JSON`);
    return { patched: 0, backup: "" };
  }

  // Read current MLBAIModel.py
  let modelSrc: string;
  try {
    modelSrc = fs.readFileSync(MODEL_PY, "utf-8");
  } catch (err) {
    console.error(`${TAG} [ERROR] Cannot read MLBAIModel.py: ${err instanceof Error ? err.message : String(err)}`);
    return { patched: 0, backup: "" };
  }

  // Write backup
  const backupPath = MODEL_PY + ".bak";
  fs.writeFileSync(backupPath, modelSrc, "utf-8");
  console.log(`${TAG} [STATE] Backup written: ${backupPath}`);

  const dateStr = new Date().toISOString().slice(0, 10);
  let patched = 0;
  let src = modelSrc;

  /**
   * Patch a single constant in EMPIRICAL_PRIORS.
   * Matches lines like:  '    'key':           0.5618,   # comment'
   * Replaces the value while preserving the key name and appending an update comment.
   */
  function patchConstant(key: string, newValue: number, comment: string): void {
    // Match the key line inside EMPIRICAL_PRIORS dict
    // Pattern: '    'key':' followed by whitespace, a number, a comma, and optional comment
    const regex = new RegExp(
      `('${key}':\\s*)([-\\d.]+)(,\\s*#[^\\n]*)`,
      "g"
    );
    const oldMatch = regex.exec(src);
    if (!oldMatch) {
      console.warn(`${TAG} [WARN] Could not find constant '${key}' in MLBAIModel.py`);
      return;
    }
    const oldValue = oldMatch[2];
    const replacement = `$1${newValue.toFixed(4)}$3 → updated ${dateStr} (${reason}, was ${oldValue})`;
    src = src.replace(regex, replacement);
    console.log(`${TAG} [STATE] Patched '${key}': ${oldValue} → ${newValue.toFixed(4)} (${comment})`);
    patched++;
  }

  // Patch each constant from the calibration output
  if (typeof overall.f5_run_share === "number") {
    patchConstant("f5_share", overall.f5_run_share, "F5 runs / FG runs 3yr empirical");
  }
  if (typeof overall.nrfi_rate === "number") {
    patchConstant("nrfi_rate", overall.nrfi_rate, "NRFI rate 3yr empirical");
  }
  if (typeof overall.fg_mean === "number") {
    patchConstant("fg_mean", overall.fg_mean, "mean FG total 3yr empirical");
  }
  if (typeof overall.i1_run_share === "number") {
    patchConstant("i1_share", overall.i1_run_share, "I1 runs / FG runs 3yr empirical");
  }
  if (typeof overall.fg_home_win_rate === "number") {
    patchConstant("fg_home_win_rate", overall.fg_home_win_rate, "FG ML home win rate 3yr empirical");
    patchConstant("fg_away_win_rate", 1 - overall.fg_home_win_rate, "FG ML away win rate 3yr empirical");
  }
  if (typeof overall.f5_push_rate === "number") {
    patchConstant("f5_push_rate", overall.f5_push_rate, "F5 push rate 3yr empirical");
  }
  if (typeof overall.fg_rl_away_cover === "number") {
    patchConstant("fg_rl_away_cover", overall.fg_rl_away_cover, "FG RL away +1.5 cover rate 3yr empirical");
    patchConstant("fg_rl_home_cover", 1 - overall.fg_rl_away_cover, "FG RL home -1.5 cover rate 3yr empirical");
  }

  // Update the "Updated YYYY-MM-DD" comment in the EMPIRICAL_PRIORS block
  src = src.replace(
    /# Updated \d{4}-\d{2}-\d{2} from mlbBacktestV2\.py/,
    `# Updated ${dateStr} from mlbBacktestV2.py (auto-recalibration: ${reason})`
  );

  // Write patched file
  try {
    fs.writeFileSync(MODEL_PY, src, "utf-8");
    console.log(`${TAG} [OUTPUT] MLBAIModel.py patched: ${patched} constants updated`);
  } catch (err) {
    console.error(`${TAG} [ERROR] Failed to write MLBAIModel.py: ${err instanceof Error ? err.message : String(err)}`);
    // Restore backup
    fs.writeFileSync(MODEL_PY, modelSrc, "utf-8");
    console.log(`${TAG} [STATE] Backup restored`);
    return { patched: 0, backup: backupPath };
  }

  return { patched, backup: backupPath };
}
