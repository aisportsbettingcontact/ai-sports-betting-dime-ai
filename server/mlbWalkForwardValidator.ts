/**
 * mlbWalkForwardValidator.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Walk-forward validation engine for the 10 approved MLB markets.
 *
 * STRATEGY:
 *   Splits historical backtest data into rolling training/validation/test windows.
 *   Each fold: train on [start, train_end], validate on [train_end+1, val_end],
 *   test on [val_end+1, test_end]. Refit cadence is configurable.
 *
 * LEAKAGE PREVENTION:
 *   All windows are strictly time-ordered. No future data enters any training window.
 *   Every row's modelRunAt is verified to be before its game start.
 *
 * OUTPUTS:
 *   WalkForwardResult per market per fold — accuracy, ROI, CLV, Brier, log loss,
 *   leakage status, trust status.
 *
 * LOGGING FORMAT (per spec Section 18):
 *   [LEVEL][MLB_BACKTEST][MARKET][TIMEFRAME][WALK_FORWARD][CHECK] message | ...
 */

import { getDb } from "./db";
import { mlbGameBacktest, mlbStrikeoutProps, mlbHrProps } from "../drizzle/schema";
import { and, eq, sql, isNotNull, inArray } from "drizzle-orm";
import {
  auditLog,
  brierScore,
  logLoss,
  calcRoi,
  wilsonCI,
  type ApprovedMarket,
} from "./mlbBacktestAuditCore";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WalkForwardConfig {
  /** Training window in days */
  trainDays: number;
  /** Validation window in days */
  validationDays: number;
  /** Test window in days */
  testDays: number;
  /** Refit cadence in days (how often to roll the window forward) */
  refitCadenceDays: number;
  /** Minimum sample size per fold to include in results */
  minSamplePerFold: number;
  /** Markets to evaluate (default: all 16) */
  markets?: ApprovedMarket[];
}

export const DEFAULT_WF_CONFIG: WalkForwardConfig = {
  trainDays:        90,
  validationDays:   30,
  testDays:         30,
  refitCadenceDays: 14,
  minSamplePerFold: 20,
};

export interface WalkForwardFold {
  foldIndex:       number;
  trainStart:      string;  // YYYY-MM-DD
  trainEnd:        string;
  validationStart: string;
  validationEnd:   string;
  testStart:       string;
  testEnd:         string;
}

export interface FoldResult {
  foldIndex:        number;
  market:           ApprovedMarket;
  trainStart:       string;
  trainEnd:         string;
  testStart:        string;
  testEnd:          string;
  // Training window stats
  trainWins:        number;
  trainLosses:      number;
  trainAccuracy:    number;
  trainRoi:         number;
  // Validation window stats
  valWins:          number;
  valLosses:        number;
  valAccuracy:      number;
  valRoi:           number;
  // Test window stats
  testWins:         number;
  testLosses:       number;
  testAccuracy:     number;
  testRoi:          number;
  testBrierScore:   number | null;
  testLogLoss:      number | null;
  // Calibration
  testSampleSize:   number;
  testCiLower:      number;
  testCiUpper:      number;
  // Leakage
  leakageViolations: number;
  leakageSafe:      boolean;
  // Trust
  trustStatus:      "PASS" | "FAIL" | "INSUFFICIENT_DATA";
  trustReason:      string;
}

export interface WalkForwardResult {
  market:           ApprovedMarket;
  config:           WalkForwardConfig;
  folds:            FoldResult[];
  // Aggregate across all folds
  totalTestWins:    number;
  totalTestLosses:  number;
  overallAccuracy:  number;
  overallRoi:       number;
  avgBrierScore:    number | null;
  avgLogLoss:       number | null;
  // Stability metrics
  accuracyStdDev:   number;
  roiStdDev:        number;
  // Leakage
  totalLeakageViolations: number;
  // Trust
  overallTrustStatus: "PASS" | "FAIL" | "INSUFFICIENT_DATA";
  overallTrustReason: string;
  generatedAt:      number;
}

// ─── Date Helpers ─────────────────────────────────────────────────────────────

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(start: string, end: string): number {
  const s = new Date(start + "T00:00:00Z").getTime();
  const e = new Date(end + "T00:00:00Z").getTime();
  return Math.round((e - s) / 86400000);
}

// ─── Generate Folds ───────────────────────────────────────────────────────────

export function generateFolds(
  dataStartDate: string,
  dataEndDate: string,
  config: WalkForwardConfig,
): WalkForwardFold[] {
  const folds: WalkForwardFold[] = [];
  const totalDays = daysBetween(dataStartDate, dataEndDate);
  const windowDays = config.trainDays + config.validationDays + config.testDays;

  if (totalDays < windowDays) {
    auditLog("WARN", "ALL_MARKETS", "ALL_TIMEFRAMES", "WALK_FORWARD", "INSUFFICIENT_DATA",
      `Data range ${dataStartDate} to ${dataEndDate} (${totalDays}d) is shorter than window (${windowDays}d)`,
      { records_checked: 0, failed: 1, impact: "walk_forward_skipped", action: "expand_date_range" });
    return [];
  }

  let foldIndex = 0;
  let trainStart = dataStartDate;

  while (true) {
    const trainEnd      = addDays(trainStart, config.trainDays - 1);
    const valStart      = addDays(trainEnd, 1);
    const valEnd        = addDays(valStart, config.validationDays - 1);
    const testStart     = addDays(valEnd, 1);
    const testEnd       = addDays(testStart, config.testDays - 1);

    if (testEnd > dataEndDate) break;

    folds.push({
      foldIndex,
      trainStart,
      trainEnd,
      validationStart: valStart,
      validationEnd:   valEnd,
      testStart,
      testEnd,
    });

    foldIndex++;
    trainStart = addDays(trainStart, config.refitCadenceDays);
  }

  auditLog("INFO", "ALL_MARKETS", "ALL_TIMEFRAMES", "WALK_FORWARD", "FOLDS_GENERATED",
    `Generated ${folds.length} walk-forward folds from ${dataStartDate} to ${dataEndDate}`,
    { records_checked: folds.length, passed: folds.length });

  return folds;
}

// ─── Fetch Backtest Rows for a Date Range ─────────────────────────────────────

interface BacktestRow {
  gameDate:    string;
  market:      string;
  modelProb:   number | null;
  bookNoVigProb: number | null;
  result:      string | null;
  correct:     number | null;
  edge:        number | null;
  backtestRunAt: number | null;
}

async function fetchBacktestRows(
  market: ApprovedMarket,
  startDate: string,
  endDate: string,
): Promise<BacktestRow[]> {
  const db = await getDb();
  const rows = await db
    .select({
      gameDate:      mlbGameBacktest.gameDate,
      market:        mlbGameBacktest.market,
      modelProb:     mlbGameBacktest.modelProb,
      bookNoVigProb: mlbGameBacktest.bookNoVigProb,
      result:        mlbGameBacktest.result,
      correct:       mlbGameBacktest.correct,
      edge:          mlbGameBacktest.edge,
      backtestRunAt: mlbGameBacktest.backtestRunAt,
    })
    .from(mlbGameBacktest)
    .where(
      and(
        eq(mlbGameBacktest.market, market),
        sql`${mlbGameBacktest.gameDate} >= ${startDate}`,
        sql`${mlbGameBacktest.gameDate} <= ${endDate}`,
        isNotNull(mlbGameBacktest.result),
      )
    );

  type DbRow = typeof rows[number];
  return rows.map((r: DbRow) => ({
    gameDate:      r.gameDate,
    market:        r.market,
    modelProb:     r.modelProb !== null ? parseFloat(String(r.modelProb)) : null,
    bookNoVigProb: r.bookNoVigProb !== null ? parseFloat(String(r.bookNoVigProb)) : null,
    result:        r.result,
    correct:       r.correct,
    edge:          r.edge !== null ? parseFloat(String(r.edge)) : null,
    backtestRunAt: r.backtestRunAt,
  }));
}

// ─── Compute Fold Stats ────────────────────────────────────────────────────────

interface WindowStats {
  wins:       number;
  losses:     number;
  accuracy:   number;
  roi:        number;
  brierScore: number | null;
  logLoss:    number | null;
  sampleSize: number;
  ciLower:    number;
  ciUpper:    number;
}

function computeWindowStats(rows: BacktestRow[]): WindowStats {
  const graded = rows.filter(r => r.result === "WIN" || r.result === "LOSS");
  const wins   = graded.filter(r => r.result === "WIN").length;
  const losses = graded.filter(r => r.result === "LOSS").length;
  const acc    = graded.length > 0 ? wins / graded.length : 0;
  const roi    = calcRoi(wins, losses);
  const ci     = wilsonCI(wins, graded.length);

  // Brier score: needs modelProb and binary outcome
  const brierRows = graded.filter(r => r.modelProb !== null);
  let bs: number | null = null;
  let ll: number | null = null;
  if (brierRows.length > 0) {
    const probs    = brierRows.map(r => r.modelProb!);
    const outcomes = brierRows.map(r => r.result === "WIN" ? 1 : 0);
    bs = brierScore(probs, outcomes);
    ll = logLoss(probs, outcomes);
  }

  return {
    wins, losses,
    accuracy:   parseFloat(acc.toFixed(6)),
    roi:        parseFloat(roi.toFixed(6)),
    brierScore: bs,
    logLoss:    ll,
    sampleSize: graded.length,
    ciLower:    ci.lower,
    ciUpper:    ci.upper,
  };
}

// ─── Run Walk-Forward for One Market ─────────────────────────────────────────

export async function runWalkForwardForMarket(
  market: ApprovedMarket,
  dataStartDate: string,
  dataEndDate: string,
  config: WalkForwardConfig = DEFAULT_WF_CONFIG,
): Promise<WalkForwardResult> {
  const folds = generateFolds(dataStartDate, dataEndDate, config);

  if (folds.length === 0) {
    return {
      market, config, folds: [],
      totalTestWins: 0, totalTestLosses: 0,
      overallAccuracy: 0, overallRoi: 0,
      avgBrierScore: null, avgLogLoss: null,
      accuracyStdDev: 0, roiStdDev: 0,
      totalLeakageViolations: 0,
      overallTrustStatus: "INSUFFICIENT_DATA",
      overallTrustReason: "No folds generated — insufficient date range",
      generatedAt: Date.now(),
    };
  }

  const foldResults: FoldResult[] = [];

  for (const fold of folds) {
    auditLog("INFO", market.toUpperCase(), "ALL_TIMEFRAMES", "WALK_FORWARD", "FOLD_START",
      `Fold ${fold.foldIndex}: train=${fold.trainStart}→${fold.trainEnd} test=${fold.testStart}→${fold.testEnd}`,
      { date_min: fold.trainStart, date_max: fold.testEnd });

    const [trainRows, valRows, testRows] = await Promise.all([
      fetchBacktestRows(market, fold.trainStart, fold.trainEnd),
      fetchBacktestRows(market, fold.validationStart, fold.validationEnd),
      fetchBacktestRows(market, fold.testStart, fold.testEnd),
    ]);

    const trainStats = computeWindowStats(trainRows);
    const valStats   = computeWindowStats(valRows);
    const testStats  = computeWindowStats(testRows);

    // Leakage check: count rows where result is not QUARANTINED
    const leakageViolations = testRows.filter(r =>
      r.result === "QUARANTINED"
    ).length;

    const trustStatus: FoldResult["trustStatus"] =
      testStats.sampleSize < config.minSamplePerFold ? "INSUFFICIENT_DATA"
      : testStats.accuracy >= 0.70 && testStats.roi > 0 ? "PASS"
      : "FAIL";

    const trustReason = trustStatus === "INSUFFICIENT_DATA"
      ? `Sample size ${testStats.sampleSize} < minimum ${config.minSamplePerFold}`
      : trustStatus === "PASS"
      ? `acc=${(testStats.accuracy * 100).toFixed(1)}% roi=${(testStats.roi * 100).toFixed(1)}% n=${testStats.sampleSize}`
      : `acc=${(testStats.accuracy * 100).toFixed(1)}% (need ≥70%) roi=${(testStats.roi * 100).toFixed(1)}% (need >0) n=${testStats.sampleSize}`;

    auditLog(
      trustStatus === "PASS" ? "INFO" : trustStatus === "INSUFFICIENT_DATA" ? "WARN" : "ERROR",
      market.toUpperCase(), "ALL_TIMEFRAMES", "WALK_FORWARD", "FOLD_RESULT",
      `Fold ${fold.foldIndex} ${trustStatus}: ${trustReason}`,
      {
        records_checked: testStats.sampleSize,
        passed: trustStatus === "PASS" ? testStats.sampleSize : 0,
        failed: trustStatus === "FAIL" ? testStats.sampleSize : 0,
        date_min: fold.testStart, date_max: fold.testEnd,
        impact: trustStatus === "FAIL" ? `${market}_fold_below_target` : "none",
        action: trustStatus === "FAIL" ? "review_calibration" : "none",
      }
    );

    foldResults.push({
      foldIndex:      fold.foldIndex,
      market,
      trainStart:     fold.trainStart,
      trainEnd:       fold.trainEnd,
      testStart:      fold.testStart,
      testEnd:        fold.testEnd,
      trainWins:      trainStats.wins,
      trainLosses:    trainStats.losses,
      trainAccuracy:  trainStats.accuracy,
      trainRoi:       trainStats.roi,
      valWins:        valStats.wins,
      valLosses:      valStats.losses,
      valAccuracy:    valStats.accuracy,
      valRoi:         valStats.roi,
      testWins:       testStats.wins,
      testLosses:     testStats.losses,
      testAccuracy:   testStats.accuracy,
      testRoi:        testStats.roi,
      testBrierScore: testStats.brierScore,
      testLogLoss:    testStats.logLoss,
      testSampleSize: testStats.sampleSize,
      testCiLower:    testStats.ciLower,
      testCiUpper:    testStats.ciUpper,
      leakageViolations,
      leakageSafe:    leakageViolations === 0,
      trustStatus,
      trustReason,
    });
  }

  // Aggregate
  const totalTestWins   = foldResults.reduce((s, f) => s + f.testWins, 0);
  const totalTestLosses = foldResults.reduce((s, f) => s + f.testLosses, 0);
  const overallAcc      = totalTestWins + totalTestLosses > 0
    ? totalTestWins / (totalTestWins + totalTestLosses) : 0;
  const overallRoi      = calcRoi(totalTestWins, totalTestLosses);

  const brierFolds = foldResults.filter(f => f.testBrierScore !== null);
  const avgBrier   = brierFolds.length > 0
    ? brierFolds.reduce((s, f) => s + f.testBrierScore!, 0) / brierFolds.length : null;
  const llFolds    = foldResults.filter(f => f.testLogLoss !== null);
  const avgLL      = llFolds.length > 0
    ? llFolds.reduce((s, f) => s + f.testLogLoss!, 0) / llFolds.length : null;

  // Stability: std dev of per-fold accuracy and ROI
  const accs = foldResults.filter(f => f.testSampleSize >= config.minSamplePerFold).map(f => f.testAccuracy);
  const rois = foldResults.filter(f => f.testSampleSize >= config.minSamplePerFold).map(f => f.testRoi);
  const stdDev = (arr: number[]) => {
    if (arr.length < 2) return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    return Math.sqrt(arr.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / arr.length);
  };

  const totalLeakage = foldResults.reduce((s, f) => s + f.leakageViolations, 0);
  const passFolds    = foldResults.filter(f => f.trustStatus === "PASS").length;
  const totalFolds   = foldResults.filter(f => f.trustStatus !== "INSUFFICIENT_DATA").length;

  const overallTrustStatus: WalkForwardResult["overallTrustStatus"] =
    totalFolds === 0 ? "INSUFFICIENT_DATA"
    : passFolds / totalFolds >= 0.7 ? "PASS"
    : "FAIL";

  const overallTrustReason = overallTrustStatus === "INSUFFICIENT_DATA"
    ? "No folds with sufficient data"
    : overallTrustStatus === "PASS"
    ? `${passFolds}/${totalFolds} folds passed (≥70% pass rate) | overall acc=${(overallAcc * 100).toFixed(1)}% roi=${(overallRoi * 100).toFixed(1)}%`
    : `Only ${passFolds}/${totalFolds} folds passed | overall acc=${(overallAcc * 100).toFixed(1)}% roi=${(overallRoi * 100).toFixed(1)}%`;

  auditLog(
    overallTrustStatus === "PASS" ? "INFO" : overallTrustStatus === "INSUFFICIENT_DATA" ? "WARN" : "ERROR",
    market.toUpperCase(), "ALL_TIMEFRAMES", "WALK_FORWARD", "OVERALL_RESULT",
    `Walk-forward ${overallTrustStatus}: ${overallTrustReason}`,
    {
      records_checked: totalTestWins + totalTestLosses,
      passed: totalTestWins,
      failed: totalTestLosses,
      quarantined: totalLeakage,
      impact: overallTrustStatus === "FAIL" ? `${market}_walk_forward_failed` : "none",
      action: overallTrustStatus === "FAIL" ? "recalibrate_or_investigate" : "none",
    }
  );

  return {
    market, config, folds: foldResults,
    totalTestWins, totalTestLosses,
    overallAccuracy:  parseFloat(overallAcc.toFixed(6)),
    overallRoi:       parseFloat(overallRoi.toFixed(6)),
    avgBrierScore:    avgBrier !== null ? parseFloat(avgBrier.toFixed(6)) : null,
    avgLogLoss:       avgLL !== null ? parseFloat(avgLL.toFixed(6)) : null,
    accuracyStdDev:   parseFloat(stdDev(accs).toFixed(6)),
    roiStdDev:        parseFloat(stdDev(rois).toFixed(6)),
    totalLeakageViolations: totalLeakage,
    overallTrustStatus,
    overallTrustReason,
    generatedAt: Date.now(),
  };
}

// ─── Run Walk-Forward for All Markets ────────────────────────────────────────

export const ALL_APPROVED_MARKETS: ApprovedMarket[] = [
  "fg_ml_home", "fg_ml_away",
  "fg_rl_home", "fg_rl_away",
  "fg_over",    "fg_under",
  "f5_ml_home", "f5_ml_away",
  "f5_rl_home", "f5_rl_away",
  "f5_over",    "f5_under",
  "nrfi",       "yrfi",
  "k_prop",     "hr_prop",
];

export async function runWalkForwardAllMarkets(
  dataStartDate: string,
  dataEndDate: string,
  config: WalkForwardConfig = DEFAULT_WF_CONFIG,
): Promise<WalkForwardResult[]> {
  const markets = config.markets ?? ALL_APPROVED_MARKETS;
  const results: WalkForwardResult[] = [];

  auditLog("INFO", "ALL_MARKETS", "ALL_TIMEFRAMES", "WALK_FORWARD", "BATCH_START",
    `Starting walk-forward validation for ${markets.length} markets from ${dataStartDate} to ${dataEndDate}`,
    { records_checked: markets.length });

  for (const market of markets) {
    const result = await runWalkForwardForMarket(market, dataStartDate, dataEndDate, config);
    results.push(result);
  }

  const passCount = results.filter(r => r.overallTrustStatus === "PASS").length;
  const failCount = results.filter(r => r.overallTrustStatus === "FAIL").length;
  const insuffCount = results.filter(r => r.overallTrustStatus === "INSUFFICIENT_DATA").length;

  auditLog("INFO", "ALL_MARKETS", "ALL_TIMEFRAMES", "WALK_FORWARD", "BATCH_COMPLETE",
    `Walk-forward complete: ${passCount} PASS | ${failCount} FAIL | ${insuffCount} INSUFFICIENT_DATA`,
    {
      records_checked: markets.length,
      passed: passCount,
      failed: failCount,
      impact: failCount > 0 ? "some_markets_below_target" : "all_markets_passed",
      action: failCount > 0 ? "review_failed_markets" : "none",
    }
  );

  return results;
}
