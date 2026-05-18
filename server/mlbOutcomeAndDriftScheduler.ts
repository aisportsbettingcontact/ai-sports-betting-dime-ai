/**
 * mlbOutcomeAndDriftScheduler.ts — Automated outcome ingestion + drift detection scheduler.
 *
 * PIPELINE (runs nightly at 12:30 AM PST, after all games are final):
 *
 *   Step 1 — Outcome Ingestion (mlbOutcomeIngestor.ts)
 *     Fetches innings-level linescore from MLB Stats API for today's final games.
 *     Writes actualFgTotal, actualF5Total, actualNrfiBinary to games table.
 *     Computes and writes 5 Brier scores per game.
 *
 *   Step 2 — Drift Detection (mlbDriftDetector.ts)
 *     Computes rolling f5_share over last 50 games with outcomes.
 *     Compares against BASELINE_F5_SHARE=0.5618 with DRIFT_THRESHOLD=0.02.
 *     If drift detected: triggers recalibration (runMlbBacktest2.py → patch MLBAIModel.py).
 *     Respects 24h cooldown to prevent thrashing.
 *
 *   Step 3 — Monthly Scheduled Recalibration (1st of each month at 3:00 AM PST)
 *     Runs full recalibration regardless of drift detection.
 *     Ensures constants stay current even when drift is below threshold.
 *
 * TIMING:
 *   Nightly pipeline: 12:30 AM PST (00:30 PST = 08:30 UTC)
 *   Monthly recal:    1st of month, 3:00 AM PST (03:00 PST = 11:00 UTC)
 *   Check interval:   60 seconds (lightweight PST time check, no DB work unless triggered)
 *
 * LOGGING CONVENTION:
 *   [OutcomeDriftScheduler][INPUT]  — scheduler trigger + context
 *   [OutcomeDriftScheduler][STEP]   — operation in progress
 *   [OutcomeDriftScheduler][STATE]  — intermediate values
 *   [OutcomeDriftScheduler][OUTPUT] — pipeline result
 *   [OutcomeDriftScheduler][VERIFY] — validation pass/fail
 *   [OutcomeDriftScheduler][ERROR]  — failure with context
 */

import { ingestMlbOutcomes } from "./mlbOutcomeIngestor";
import { checkF5ShareDrift, triggerRecalibration } from "./mlbDriftDetector";

const TAG = "[OutcomeDriftScheduler]";

// ─── PST/PDT Helpers ──────────────────────────────────────────────────────────

interface PstTime {
  hour: number;
  minute: number;
  dayOfMonth: number;
  month: number; // 1-12
  dateStr: string; // YYYY-MM-DD
}

function nowPst(): PstTime {
  const now = new Date();
  const pstStr = now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
  const pst = new Date(pstStr);
  const y = pst.getFullYear();
  const m = String(pst.getMonth() + 1).padStart(2, "0");
  const d = String(pst.getDate()).padStart(2, "0");
  return {
    hour: pst.getHours(),
    minute: pst.getMinutes(),
    dayOfMonth: pst.getDate(),
    month: pst.getMonth() + 1,
    dateStr: `${y}-${m}-${d}`,
  };
}

function yesterdayPst(): string {
  const now = new Date();
  const pstStr = now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
  const pst = new Date(pstStr);
  pst.setDate(pst.getDate() - 1);
  const y = pst.getFullYear();
  const m = String(pst.getMonth() + 1).padStart(2, "0");
  const d = String(pst.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ─── State ────────────────────────────────────────────────────────────────────

/** Last date for which the nightly pipeline ran (YYYY-MM-DD) */
let lastNightlyRunDate: string | null = null;

/** Last month for which the monthly recalibration ran (YYYY-MM format) */
let lastMonthlyRecalMonth: string | null = null;

/** True if a pipeline run is currently in progress (prevents concurrent runs) */
let pipelineRunning = false;

// ─── Nightly Pipeline ─────────────────────────────────────────────────────────

/**
 * Runs the full nightly pipeline for a given date:
 *   1. Ingest outcomes for yesterday's final games
 *   2. Run drift detection (triggers recalibration if needed)
 *
 * @param dateStr  YYYY-MM-DD date to ingest outcomes for (typically yesterday)
 */
async function runNightlyPipeline(dateStr: string): Promise<void> {
  if (pipelineRunning) {
    console.log(`${TAG} [STATE] Pipeline already running — skipping duplicate trigger for ${dateStr}`);
    return;
  }

  pipelineRunning = true;
  const startMs = Date.now();

  console.log(`\n${TAG} ══════════════════════════════════════════════════════`);
  console.log(`${TAG} [INPUT] Nightly pipeline starting for date=${dateStr}`);

  try {
    // ── Step 1: Outcome Ingestion ───────────────────────────────────────────
    console.log(`${TAG} [STEP 1] Outcome ingestion for date=${dateStr}`);
    const ingestSummary = await ingestMlbOutcomes(dateStr);

    console.log(
      `${TAG} [STATE] Ingestion complete:` +
      ` total=${ingestSummary.totalGames}` +
      ` written=${ingestSummary.written}` +
      ` skipped_ingested=${ingestSummary.skippedAlreadyIngested}` +
      ` skipped_not_final=${ingestSummary.skippedNotFinal}` +
      ` skipped_no_match=${ingestSummary.skippedNoApiMatch}` +
      ` errors=${ingestSummary.errors}`
    );

    if (ingestSummary.errors > 0) {
      console.warn(`${TAG} [WARN] ${ingestSummary.errors} ingestion errors — drift check will still run`);
    }

    // ── Step 2: Drift Detection ─────────────────────────────────────────────
    console.log(`${TAG} [STEP 2] Running f5_share drift check`);
    const driftResult = await checkF5ShareDrift(true);

    console.log(
      `${TAG} [STATE] Drift check:` +
      ` rolling=${driftResult.rollingF5Share ?? "null"}` +
      ` delta=${driftResult.delta ?? "null"}` +
      ` driftDetected=${driftResult.driftDetected}` +
      ` recalibrationTriggered=${driftResult.recalibrationTriggered}` +
      ` cooldownSkipped=${driftResult.cooldownSkipped}`
    );

    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);

    if (driftResult.driftDetected && driftResult.recalibrationTriggered) {
      console.log(`${TAG} [OUTPUT] DRIFT DETECTED + RECALIBRATED — ${driftResult.message} | elapsed=${elapsed}s`);
    } else if (driftResult.driftDetected) {
      console.log(`${TAG} [OUTPUT] DRIFT DETECTED (no recal) — ${driftResult.message} | elapsed=${elapsed}s`);
    } else {
      console.log(`${TAG} [OUTPUT] PASS — no drift | ${driftResult.message} | elapsed=${elapsed}s`);
    }

    // ── Verify ──────────────────────────────────────────────────────────────
    const verifyPass = ingestSummary.errors === 0;
    console.log(
      `${TAG} [VERIFY] ${verifyPass ? "PASS" : "WARN"} — ingestion_errors=${ingestSummary.errors}` +
      ` written=${ingestSummary.written} drift_detected=${driftResult.driftDetected}`
    );

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${TAG} [ERROR] Nightly pipeline failed for date=${dateStr}: ${msg}`);
  } finally {
    pipelineRunning = false;
    console.log(`${TAG} ══════════════════════════════════════════════════════\n`);
  }
}

// ─── Monthly Recalibration ────────────────────────────────────────────────────

/**
 * Runs the monthly scheduled recalibration.
 * Fires on the 1st of each month at 3:00 AM PST.
 * Runs regardless of drift detection — ensures constants stay current.
 */
async function runMonthlyRecalibration(monthKey: string): Promise<void> {
  console.log(`\n${TAG} ══════════════════════════════════════════════════════`);
  console.log(`${TAG} [INPUT] Monthly recalibration starting for month=${monthKey}`);

  try {
    const result = await triggerRecalibration("SCHEDULED");

    if (result.success) {
      console.log(
        `${TAG} [OUTPUT] Monthly recalibration COMPLETE:` +
        ` newF5Share=${result.newF5Share}` +
        ` newNrfiRate=${result.newNrfiRate}` +
        ` constantsPatched=${result.constantsPatched}` +
        ` elapsed=${result.elapsedSec.toFixed(1)}s`
      );
      console.log(`${TAG} [VERIFY] PASS — ${result.constantsPatched} constants updated in MLBAIModel.py`);
    } else {
      console.error(`${TAG} [ERROR] Monthly recalibration FAILED: ${result.error}`);
      console.log(`${TAG} [VERIFY] FAIL — recalibration did not complete`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${TAG} [ERROR] Monthly recalibration threw: ${msg}`);
  }

  console.log(`${TAG} ══════════════════════════════════════════════════════\n`);
}

// ─── Scheduler Tick ──────────────────────────────────────────────────────────

/**
 * Called every 60 seconds. Checks PST time and fires the appropriate pipeline.
 *
 * Nightly trigger:  12:30 AM PST (hour=0, minute=30)
 * Monthly trigger:  1st of month, 3:00 AM PST (dayOfMonth=1, hour=3, minute=0)
 */
async function schedulerTick(): Promise<void> {
  const pst = nowPst();

  // ── Monthly recalibration check ─────────────────────────────────────────
  const monthKey = `${pst.dateStr.slice(0, 7)}`; // YYYY-MM
  if (
    pst.dayOfMonth === 1 &&
    pst.hour === 3 &&
    pst.minute === 0 &&
    lastMonthlyRecalMonth !== monthKey
  ) {
    lastMonthlyRecalMonth = monthKey;
    console.log(`${TAG} [INPUT] Monthly recalibration trigger: month=${monthKey}`);
    // Run async — don't await to avoid blocking the tick
    runMonthlyRecalibration(monthKey).catch(err => {
      console.error(`${TAG} [ERROR] Monthly recalibration uncaught: ${err instanceof Error ? err.message : String(err)}`);
    });
    return;
  }

  // ── Nightly pipeline check ──────────────────────────────────────────────
  if (
    pst.hour === 0 &&
    pst.minute === 30 &&
    lastNightlyRunDate !== pst.dateStr
  ) {
    lastNightlyRunDate = pst.dateStr;
    // Ingest yesterday's games (games from the previous calendar day in PST)
    const targetDate = yesterdayPst();
    console.log(`${TAG} [INPUT] Nightly pipeline trigger: pst=${pst.dateStr} 00:30 → ingesting date=${targetDate}`);
    // Run async — don't await to avoid blocking the tick
    runNightlyPipeline(targetDate).catch(err => {
      console.error(`${TAG} [ERROR] Nightly pipeline uncaught: ${err instanceof Error ? err.message : String(err)}`);
    });
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

let schedulerInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Starts the outcome ingestion + drift detection scheduler.
 * Called once at server boot from server/_core/index.ts.
 */
export function startMlbOutcomeAndDriftScheduler(): void {
  if (schedulerInterval) {
    console.log(`${TAG} [WARN] Scheduler already running — ignoring duplicate start`);
    return;
  }

  console.log(`${TAG} [INPUT] startMlbOutcomeAndDriftScheduler: STARTING`);
  console.log(`${TAG} [STATE] Nightly pipeline: 12:30 AM PST | Monthly recal: 1st of month 3:00 AM PST`);

  // Run tick immediately on start (catches up if server restarted mid-window)
  schedulerTick().catch(err => {
    console.error(`${TAG} [ERROR] Initial tick failed: ${err instanceof Error ? err.message : String(err)}`);
  });

  // Then tick every 60 seconds — .unref() prevents this from keeping the process alive
  schedulerInterval = setInterval(() => {
    schedulerTick().catch(err => {
      console.error(`${TAG} [ERROR] Tick failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }, 60_000).unref();

  console.log(`${TAG} [OUTPUT] startMlbOutcomeAndDriftScheduler: STARTED`);
  console.log(`${TAG} [VERIFY] PASS — scheduler running, tick interval=60s`);
}

/**
 * Stops the scheduler. Used in tests and graceful shutdown.
 */
function stopMlbOutcomeAndDriftScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log(`${TAG} [OUTPUT] Scheduler stopped`);
  }
}

/**
 * Manual trigger: run the nightly pipeline for a specific date.
 * Used by tRPC admin procedures and backfill scripts.
 */
async function manualRunNightlyPipeline(dateStr: string): Promise<void> {
  console.log(`${TAG} [INPUT] Manual nightly pipeline trigger: date=${dateStr}`);
  await runNightlyPipeline(dateStr);
}

/**
 * Manual trigger: run drift check only (no ingestion, no recalibration).
 * Returns the drift check result for diagnostics.
 */
async function manualDriftCheck(triggerRecal = false) {
  console.log(`${TAG} [INPUT] Manual drift check: triggerRecal=${triggerRecal}`);
  return checkF5ShareDrift(triggerRecal);
}
