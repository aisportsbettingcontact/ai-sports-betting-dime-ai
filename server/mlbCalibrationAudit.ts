/**
 * mlbCalibrationAudit.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Calibration audit engine for the 10 approved MLB markets.
 *
 * METRICS COMPUTED:
 *   - Expected Calibration Error (ECE): weighted mean |predicted - actual| per bucket
 *   - Maximum Calibration Error (MCE): max |predicted - actual| across buckets
 *   - Reliability diagram data: per-bucket (predicted_prob, actual_freq, count)
 *   - Brier Score: mean((p - o)^2) — overall and per-market
 *   - Log Loss: -mean(o*log(p) + (1-o)*log(1-p))
 *   - Calibration bias: avg model prob - avg actual win rate
 *   - Overconfidence / underconfidence classification
 *   - Recalibration recommendation: Platt scaling factor if bias > threshold
 *
 * CALIBRATION BUCKETS:
 *   10 equal-width buckets: [0.0,0.1), [0.1,0.2), ..., [0.9,1.0]
 *   Minimum 10 samples per bucket to include in ECE.
 *
 * PUBLICATION GATE INPUTS:
 *   ECE < 0.05 → calibration acceptable
 *   Bias |avg_model_prob - avg_actual_rate| < 0.03 → bias acceptable
 *   Brier score < 0.25 → acceptable for binary outcomes
 *
 * LOGGING FORMAT (per spec Section 18):
 *   [LEVEL][MLB_BACKTEST][MARKET][TIMEFRAME][CALIBRATION][CHECK] message | ...
 */

import { getDb } from "./db";
import { mlbGameBacktest, mlbStrikeoutProps, mlbHrProps } from "../drizzle/schema";
import { and, eq, sql, isNotNull } from "drizzle-orm";
import {
  auditLog,
  brierScore,
  logLoss,
  type ApprovedMarket,
  MARKET_TIMEFRAME,
} from "./mlbBacktestAuditCore";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CalibrationBucket {
  /** Bucket label e.g. "0.50–0.60" */
  label:         string;
  minProb:       number;
  maxProb:       number;
  /** Number of rows in this bucket */
  count:         number;
  /** Average model probability in this bucket */
  avgModelProb:  number;
  /** Actual win rate in this bucket */
  actualWinRate: number;
  /** |avgModelProb - actualWinRate| */
  calibrationError: number;
  /** Weighted contribution to ECE */
  eceContribution:  number;
}

export interface CalibrationAuditResult {
  market:           ApprovedMarket;
  timeframe:        string;
  dateMin:          string | null;
  dateMax:          string | null;
  sampleSize:       number;
  /** Expected Calibration Error [0,1] — lower is better */
  ece:              number;
  /** Maximum Calibration Error across buckets */
  mce:              number;
  /** Overall Brier Score */
  brierScore:       number | null;
  /** Overall Log Loss */
  logLoss:          number | null;
  /** avg model prob - avg actual win rate (positive = overconfident) */
  calibrationBias:  number;
  /** Classification: OVERCONFIDENT | UNDERCONFIDENT | WELL_CALIBRATED */
  biasClassification: "OVERCONFIDENT" | "UNDERCONFIDENT" | "WELL_CALIBRATED";
  /** Reliability diagram data */
  buckets:          CalibrationBucket[];
  /** Platt scaling factor recommendation (null if not needed) */
  plattScaleFactor: number | null;
  /** Whether calibration passes publication gate */
  calibrationPasses: boolean;
  /** Reason for pass/fail */
  calibrationReason: string;
  generatedAt:      number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BUCKET_COUNT = 10;
const MIN_BUCKET_SAMPLES = 10;
const ECE_THRESHOLD = 0.05;
const BIAS_THRESHOLD = 0.03;
const BRIER_THRESHOLD = 0.25;

// ─── Fetch Rows ───────────────────────────────────────────────────────────────

interface CalibrationRow {
  gameDate:  string;
  modelProb: number;
  result:    string;
}

async function fetchCalibrationRows(
  market: ApprovedMarket,
  startDate?: string,
  endDate?: string,
): Promise<CalibrationRow[]> {
  const db = await getDb();

  const conditions = [
    eq(mlbGameBacktest.market, market),
    isNotNull(mlbGameBacktest.modelProb),
  ];
  if (startDate) conditions.push(sql`${mlbGameBacktest.gameDate} >= ${startDate}`);
  if (endDate)   conditions.push(sql`${mlbGameBacktest.gameDate} <= ${endDate}`);

  const rows = await db
    .select({
      gameDate:  mlbGameBacktest.gameDate,
      modelProb: mlbGameBacktest.modelProb,
      result:    mlbGameBacktest.result,
    })
    .from(mlbGameBacktest)
    .where(and(...conditions));

  type RawRow = { gameDate: string | null; modelProb: unknown; result: string | null };
  return (rows as RawRow[])
    .filter((r: RawRow) => r.result === "WIN" || r.result === "LOSS")
    .filter((r: RawRow) => r.modelProb !== null)
    .map((r: RawRow) => ({
      gameDate:  r.gameDate ?? "",
      modelProb: parseFloat(String(r.modelProb)),
      result:    r.result!,
    }));
}

// ─── Core Calibration Computation ────────────────────────────────────────────

export function computeCalibration(
  rows: CalibrationRow[],
  market: ApprovedMarket,
): Omit<CalibrationAuditResult, "generatedAt"> {
  const timeframe = MARKET_TIMEFRAME[market];

  if (rows.length === 0) {
    auditLog("WARN", market.toUpperCase(), timeframe, "CALIBRATION", "NO_DATA",
      `No graded rows available for calibration audit`,
      { records_checked: 0, failed: 1, impact: "calibration_skipped", action: "collect_more_data" });
    return {
      market, timeframe,
      dateMin: null, dateMax: null,
      sampleSize: 0,
      ece: 0, mce: 0,
      brierScore: null, logLoss: null,
      calibrationBias: 0,
      biasClassification: "WELL_CALIBRATED",
      buckets: [],
      plattScaleFactor: null,
      calibrationPasses: false,
      calibrationReason: "INSUFFICIENT_DATA: no graded rows available",
    };
  }

  const dates = rows.map(r => r.gameDate).filter(Boolean).sort();
  const probs    = rows.map(r => r.modelProb);
  const outcomes = rows.map(r => r.result === "WIN" ? 1 : 0);

  // Overall metrics
  const bs = brierScore(probs, outcomes);
  const ll = logLoss(probs, outcomes);
  const avgModelProb  = probs.reduce((a, b) => a + b, 0) / probs.length;
  const avgActualRate = (outcomes as number[]).reduce((a: number, b: number) => a + b, 0) / outcomes.length;
  const bias = parseFloat((avgModelProb - avgActualRate).toFixed(6));

  // Build calibration buckets
  const buckets: CalibrationBucket[] = [];
  for (let i = 0; i < BUCKET_COUNT; i++) {
    const minP = i / BUCKET_COUNT;
    const maxP = (i + 1) / BUCKET_COUNT;
    const label = `${(minP * 100).toFixed(0)}%–${(maxP * 100).toFixed(0)}%`;

    const bucketRows = rows.filter(r =>
      r.modelProb >= minP && (i === BUCKET_COUNT - 1 ? r.modelProb <= maxP : r.modelProb < maxP)
    );

    if (bucketRows.length === 0) continue;

    const bucketProbs    = bucketRows.map(r => r.modelProb);
    const bucketOutcomes = bucketRows.map(r => r.result === "WIN" ? 1 : 0);
    const avgBucketProb  = bucketProbs.reduce((a, b) => a + b, 0) / bucketProbs.length;
    const actualRate     = (bucketOutcomes as number[]).reduce((a: number, b: number) => a + b, 0) / bucketOutcomes.length;
    const calError       = Math.abs(avgBucketProb - actualRate);
    const eceContrib     = (bucketRows.length / rows.length) * calError;

    buckets.push({
      label, minProb: minP, maxProb: maxP,
      count:            bucketRows.length,
      avgModelProb:     parseFloat(avgBucketProb.toFixed(6)),
      actualWinRate:    parseFloat(actualRate.toFixed(6)),
      calibrationError: parseFloat(calError.toFixed(6)),
      eceContribution:  parseFloat(eceContrib.toFixed(6)),
    });
  }

  // ECE: weighted sum of calibration errors (only buckets with enough samples)
  const eligibleBuckets = buckets.filter(b => b.count >= MIN_BUCKET_SAMPLES);
  const totalEligible   = eligibleBuckets.reduce((s, b) => s + b.count, 0);
  const ece = totalEligible > 0
    ? parseFloat(eligibleBuckets.reduce((s, b) =>
        s + (b.count / totalEligible) * b.calibrationError, 0).toFixed(6))
    : 0;
  const mce = buckets.length > 0
    ? parseFloat(Math.max(...buckets.map(b => b.calibrationError)).toFixed(6))
    : 0;

  // Bias classification
  const biasClassification: CalibrationAuditResult["biasClassification"] =
    Math.abs(bias) < BIAS_THRESHOLD ? "WELL_CALIBRATED"
    : bias > 0 ? "OVERCONFIDENT"
    : "UNDERCONFIDENT";

  // Platt scaling factor: if overconfident, scale down model probs
  // Platt factor = avgActualRate / avgModelProb (multiplicative)
  const plattScaleFactor = Math.abs(bias) >= BIAS_THRESHOLD && avgModelProb > 0
    ? parseFloat((avgActualRate / avgModelProb).toFixed(4))
    : null;

  // Publication gate
  const ecePasses    = ece < ECE_THRESHOLD;
  const biasPasses   = Math.abs(bias) < BIAS_THRESHOLD;
  const brierPasses  = bs < BRIER_THRESHOLD;
  const calibrationPasses = ecePasses && biasPasses && brierPasses;

  const reasons: string[] = [];
  if (!ecePasses)   reasons.push(`ECE=${ece.toFixed(4)} ≥ threshold ${ECE_THRESHOLD}`);
  if (!biasPasses)  reasons.push(`bias=${bias.toFixed(4)} ≥ threshold ±${BIAS_THRESHOLD}`);
  if (!brierPasses) reasons.push(`Brier=${bs.toFixed(4)} ≥ threshold ${BRIER_THRESHOLD}`);
  const calibrationReason = calibrationPasses
    ? `PASS: ECE=${ece.toFixed(4)} bias=${bias.toFixed(4)} Brier=${bs.toFixed(4)} n=${rows.length}`
    : `FAIL: ${reasons.join("; ")}`;

  auditLog(
    calibrationPasses ? "INFO" : "WARN",
    market.toUpperCase(), timeframe, "CALIBRATION", "AUDIT_RESULT",
    calibrationReason,
    {
      records_checked: rows.length,
      passed: calibrationPasses ? rows.length : 0,
      failed: calibrationPasses ? 0 : rows.length,
      date_min: dates[0] ?? undefined,
      date_max: dates[dates.length - 1] ?? undefined,
      impact: calibrationPasses ? "none" : `${market}_calibration_needs_recalibration`,
      action: plattScaleFactor !== null ? `apply_platt_scale_factor=${plattScaleFactor}` : "none",
    }
  );

  return {
    market, timeframe,
    dateMin: dates[0] ?? null,
    dateMax: dates[dates.length - 1] ?? null,
    sampleSize: rows.length,
    ece, mce,
    brierScore: bs,
    logLoss: ll,
    calibrationBias: bias,
    biasClassification,
    buckets,
    plattScaleFactor,
    calibrationPasses,
    calibrationReason,
  };
}

// ─── Full Calibration Audit for a Market ─────────────────────────────────────

export async function runCalibrationAudit(
  market: ApprovedMarket,
  startDate?: string,
  endDate?: string,
): Promise<CalibrationAuditResult> {
  auditLog("INFO", market.toUpperCase(), MARKET_TIMEFRAME[market], "CALIBRATION", "AUDIT_START",
    `Starting calibration audit for ${market}`,
    { date_min: startDate, date_max: endDate });

  const rows = await fetchCalibrationRows(market, startDate, endDate);
  const result = computeCalibration(rows, market);
  return { ...result, generatedAt: Date.now() };
}

// ─── Batch Calibration Audit ──────────────────────────────────────────────────

export async function runCalibrationAuditAllMarkets(
  markets: ApprovedMarket[],
  startDate?: string,
  endDate?: string,
): Promise<CalibrationAuditResult[]> {
  auditLog("INFO", "ALL_MARKETS", "ALL_TIMEFRAMES", "CALIBRATION", "BATCH_START",
    `Starting calibration audit for ${markets.length} markets`,
    { records_checked: markets.length });

  const results: CalibrationAuditResult[] = [];
  for (const market of markets) {
    const result = await runCalibrationAudit(market, startDate, endDate);
    results.push(result);
  }

  const passCount = results.filter(r => r.calibrationPasses).length;
  const failCount = results.filter(r => !r.calibrationPasses && r.sampleSize > 0).length;
  const noDataCount = results.filter(r => r.sampleSize === 0).length;

  auditLog("INFO", "ALL_MARKETS", "ALL_TIMEFRAMES", "CALIBRATION", "BATCH_COMPLETE",
    `Calibration audit complete: ${passCount} PASS | ${failCount} FAIL | ${noDataCount} NO_DATA`,
    {
      records_checked: markets.length,
      passed: passCount,
      failed: failCount,
      impact: failCount > 0 ? "some_markets_need_recalibration" : "all_markets_calibrated",
      action: failCount > 0 ? "apply_platt_scaling_or_retrain" : "none",
    }
  );

  return results;
}

// ─── Recalibration Recommendation ────────────────────────────────────────────

export interface RecalibrationRecommendation {
  market:           ApprovedMarket;
  currentBias:      number;
  plattScaleFactor: number | null;
  recommendation:   "APPLY_PLATT_SCALING" | "RETRAIN_MODEL" | "NO_ACTION_REQUIRED";
  reason:           string;
  sampleSize:       number;
  priorVersionPreserved: boolean;
}

export function buildRecalibrationRecommendation(
  audit: CalibrationAuditResult,
): RecalibrationRecommendation {
  const { market, calibrationBias, plattScaleFactor, sampleSize, calibrationPasses } = audit;

  if (calibrationPasses) {
    return {
      market, currentBias: calibrationBias,
      plattScaleFactor: null,
      recommendation: "NO_ACTION_REQUIRED",
      reason: `Calibration within acceptable bounds: ECE=${audit.ece.toFixed(4)} bias=${calibrationBias.toFixed(4)}`,
      sampleSize,
      priorVersionPreserved: true,
    };
  }

  if (sampleSize < 50) {
    return {
      market, currentBias: calibrationBias,
      plattScaleFactor: null,
      recommendation: "NO_ACTION_REQUIRED",
      reason: `Insufficient sample size (${sampleSize} < 50) — recalibration deferred until more data available`,
      sampleSize,
      priorVersionPreserved: true,
    };
  }

  if (plattScaleFactor !== null && Math.abs(calibrationBias) < 0.10) {
    return {
      market, currentBias: calibrationBias,
      plattScaleFactor,
      recommendation: "APPLY_PLATT_SCALING",
      reason: `Systematic bias detected: ${calibrationBias > 0 ? "OVERCONFIDENT" : "UNDERCONFIDENT"} by ${Math.abs(calibrationBias * 100).toFixed(1)}pp — apply Platt scale factor ${plattScaleFactor}`,
      sampleSize,
      priorVersionPreserved: true,
    };
  }

  return {
    market, currentBias: calibrationBias,
    plattScaleFactor,
    recommendation: "RETRAIN_MODEL",
    reason: `Large calibration error: ECE=${audit.ece.toFixed(4)} bias=${calibrationBias.toFixed(4)} — Platt scaling insufficient, model retraining required`,
    sampleSize,
    priorVersionPreserved: true,
  };
}
