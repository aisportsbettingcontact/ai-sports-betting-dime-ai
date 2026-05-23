/**
 * mlbPublicationGate.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Publication gate for the 10 approved MLB markets.
 *
 * GATE STATUS (per spec Section 21):
 *   SAFE_TO_PUBLISH         — all checks pass
 *   BLOCKED                 — one or more critical checks fail
 *   PARTIALLY_SAFE          — some markets pass, some fail
 *   REQUIRES_MANUAL_REVIEW  — borderline or ambiguous results
 *
 * GATE CRITERIA (per spec):
 *   1. Minimum sample size ≥ 30 graded rows per market
 *   2. Accuracy ≥ 70% (not 85% — 85% is aspirational, 70% is the hard gate)
 *   3. ROI > 0 (positive expected value)
 *   4. ECE < 0.05 (calibration acceptable)
 *   5. Leakage violations = 0 (no future data in predictions)
 *   6. Quarantine rate < 5% of total rows
 *   7. Walk-forward trust status = PASS or INSUFFICIENT_DATA (not FAIL)
 *   8. No CRITICAL log events unresolved
 *
 * ACCURACY TARGET REVIEW (per spec Section 21):
 *   85% is the aspirational target. The gate uses 70% as the hard floor.
 *   If accuracy is between 70–85%, status = PARTIALLY_SAFE with explanation.
 *   If accuracy < 70%, status = BLOCKED.
 *
 * LOGGING FORMAT (per spec Section 18):
 *   [LEVEL][MLB_BACKTEST][MARKET][TIMEFRAME][PUBLICATION_GATE][CHECK] message | ...
 */

import {
  auditLog,
  type ApprovedMarket,
  MARKET_TIMEFRAME,
} from "./mlbBacktestAuditCore";
import type { CalibrationAuditResult } from "./mlbCalibrationAudit";
import type { WalkForwardResult } from "./mlbWalkForwardValidator";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PublicationGateStatus =
  | "SAFE_TO_PUBLISH"
  | "BLOCKED"
  | "PARTIALLY_SAFE"
  | "REQUIRES_MANUAL_REVIEW";

export interface MarketStats {
  market:           ApprovedMarket;
  gradedCount:      number;
  wins:             number;
  losses:           number;
  pushes:           number;
  voids:            number;
  quarantined:      number;
  ungraded:         number;
  accuracy:         number;
  roi:              number;
  avgEdge:          number;
  leakageViolations: number;
  dateMin:          string | null;
  dateMax:          string | null;
}

export interface GateCheck {
  checkName:    string;
  passed:       boolean;
  value:        string;
  threshold:    string;
  severity:     "CRITICAL" | "WARN" | "INFO";
  reason:       string;
}

export interface MarketGateResult {
  market:           ApprovedMarket;
  timeframe:        string;
  status:           PublicationGateStatus;
  checks:           GateCheck[];
  blockers:         string[];
  warnings:         string[];
  accuracy:         number;
  roi:              number;
  sampleSize:       number;
  leakageViolations: number;
  quarantineRate:   number;
  ece:              number | null;
  walkForwardStatus: string | null;
  target85Achieved: boolean;
  target85Realistic: boolean;
  target85Evidence: string;
  reason:           string;
}

export interface PublicationGateReport {
  overallStatus:    PublicationGateStatus;
  overallReason:    string;
  marketResults:    MarketGateResult[];
  safeMarkets:      ApprovedMarket[];
  blockedMarkets:   ApprovedMarket[];
  partialMarkets:   ApprovedMarket[];
  reviewMarkets:    ApprovedMarket[];
  finalTrustStatus: string;
  finalTrustReason: string;
  generatedAt:      number;
}

// ─── Gate Thresholds ──────────────────────────────────────────────────────────

const GATE = {
  MIN_SAMPLE:          30,
  ACCURACY_HARD_FLOOR: 0.70,
  ACCURACY_TARGET:     0.85,
  ROI_FLOOR:           0.0,
  ECE_THRESHOLD:       0.05,
  QUARANTINE_RATE_MAX: 0.05,
  LEAKAGE_MAX:         0,
} as const;

// ─── Run Gate for One Market ──────────────────────────────────────────────────

export function runMarketGate(
  stats: MarketStats,
  calibration: CalibrationAuditResult | null,
  walkForward: WalkForwardResult | null,
): MarketGateResult {
  const market    = stats.market;
  const timeframe = MARKET_TIMEFRAME[market];
  const checks: GateCheck[] = [];
  const blockers: string[] = [];
  const warnings: string[] = [];

  // ── Check 1: Minimum sample size ──
  const sampleCheck: GateCheck = {
    checkName: "MINIMUM_SAMPLE_SIZE",
    passed:    stats.gradedCount >= GATE.MIN_SAMPLE,
    value:     String(stats.gradedCount),
    threshold: `≥ ${GATE.MIN_SAMPLE}`,
    severity:  "CRITICAL",
    reason:    stats.gradedCount >= GATE.MIN_SAMPLE
      ? `${stats.gradedCount} graded rows meets minimum ${GATE.MIN_SAMPLE}`
      : `Only ${stats.gradedCount} graded rows — need ≥ ${GATE.MIN_SAMPLE} for reliable statistics`,
  };
  checks.push(sampleCheck);
  if (!sampleCheck.passed) blockers.push(sampleCheck.reason);

  // ── Check 2: Accuracy ≥ 70% ──
  const accCheck: GateCheck = {
    checkName: "ACCURACY_HARD_FLOOR",
    passed:    stats.accuracy >= GATE.ACCURACY_HARD_FLOOR,
    value:     `${(stats.accuracy * 100).toFixed(1)}%`,
    threshold: `≥ ${(GATE.ACCURACY_HARD_FLOOR * 100).toFixed(0)}%`,
    severity:  "CRITICAL",
    reason:    stats.accuracy >= GATE.ACCURACY_HARD_FLOOR
      ? `Accuracy ${(stats.accuracy * 100).toFixed(1)}% meets hard floor ${(GATE.ACCURACY_HARD_FLOOR * 100).toFixed(0)}%`
      : `Accuracy ${(stats.accuracy * 100).toFixed(1)}% below hard floor ${(GATE.ACCURACY_HARD_FLOOR * 100).toFixed(0)}%`,
  };
  checks.push(accCheck);
  if (!accCheck.passed) blockers.push(accCheck.reason);

  // ── Check 3: ROI > 0 ──
  const roiCheck: GateCheck = {
    checkName: "POSITIVE_ROI",
    passed:    stats.roi > GATE.ROI_FLOOR,
    value:     `${(stats.roi * 100).toFixed(1)}%`,
    threshold: `> ${(GATE.ROI_FLOOR * 100).toFixed(0)}%`,
    severity:  "CRITICAL",
    reason:    stats.roi > GATE.ROI_FLOOR
      ? `ROI ${(stats.roi * 100).toFixed(1)}% is positive`
      : `ROI ${(stats.roi * 100).toFixed(1)}% is negative or zero — not profitable`,
  };
  checks.push(roiCheck);
  if (!roiCheck.passed) blockers.push(roiCheck.reason);

  // ── Check 4: Leakage violations = 0 ──
  const leakageCheck: GateCheck = {
    checkName: "ZERO_LEAKAGE_VIOLATIONS",
    passed:    stats.leakageViolations === 0,
    value:     String(stats.leakageViolations),
    threshold: "= 0",
    severity:  "CRITICAL",
    reason:    stats.leakageViolations === 0
      ? "No leakage violations detected — all predictions pre-game"
      : `${stats.leakageViolations} leakage violation(s) detected — predictions after game start contaminate results`,
  };
  checks.push(leakageCheck);
  if (!leakageCheck.passed) blockers.push(leakageCheck.reason);

  // ── Check 5: Quarantine rate < 5% ──
  const totalRows = stats.gradedCount + stats.quarantined + stats.ungraded + stats.voids + stats.pushes;
  const quarantineRate = totalRows > 0 ? stats.quarantined / totalRows : 0;
  const quarantineCheck: GateCheck = {
    checkName: "QUARANTINE_RATE",
    passed:    quarantineRate < GATE.QUARANTINE_RATE_MAX,
    value:     `${(quarantineRate * 100).toFixed(1)}%`,
    threshold: `< ${(GATE.QUARANTINE_RATE_MAX * 100).toFixed(0)}%`,
    severity:  "WARN",
    reason:    quarantineRate < GATE.QUARANTINE_RATE_MAX
      ? `Quarantine rate ${(quarantineRate * 100).toFixed(1)}% within acceptable range`
      : `Quarantine rate ${(quarantineRate * 100).toFixed(1)}% exceeds threshold — ${stats.quarantined} rows quarantined`,
  };
  checks.push(quarantineCheck);
  if (!quarantineCheck.passed) warnings.push(quarantineCheck.reason);

  // ── Check 6: Calibration ECE ──
  let eceValue: number | null = null;
  if (calibration) {
    eceValue = calibration.ece;
    const eceCheck: GateCheck = {
      checkName: "CALIBRATION_ECE",
      passed:    calibration.calibrationPasses,
      value:     `ECE=${calibration.ece.toFixed(4)} bias=${calibration.calibrationBias.toFixed(4)}`,
      threshold: `ECE < ${GATE.ECE_THRESHOLD}`,
      severity:  "WARN",
      reason:    calibration.calibrationReason,
    };
    checks.push(eceCheck);
    if (!eceCheck.passed) warnings.push(eceCheck.reason);
  }

  // ── Check 7: Walk-forward trust ──
  let wfStatus: string | null = null;
  if (walkForward) {
    wfStatus = walkForward.overallTrustStatus;
    const wfCheck: GateCheck = {
      checkName: "WALK_FORWARD_TRUST",
      passed:    walkForward.overallTrustStatus !== "FAIL",
      value:     walkForward.overallTrustStatus,
      threshold: "PASS or INSUFFICIENT_DATA",
      severity:  "CRITICAL",
      reason:    walkForward.overallTrustReason,
    };
    checks.push(wfCheck);
    if (!wfCheck.passed) blockers.push(wfCheck.reason);
  }

  // ── 85% target review ──
  const target85Achieved  = stats.accuracy >= GATE.ACCURACY_TARGET;
  const target85Realistic = stats.gradedCount >= 100; // need ≥100 samples for reliable 85% claim
  const target85Evidence  = target85Achieved
    ? `ACHIEVED: ${(stats.accuracy * 100).toFixed(1)}% ≥ 85% target (n=${stats.gradedCount})`
    : stats.gradedCount < 100
    ? `NOT_EVALUATED: insufficient sample size (${stats.gradedCount} < 100) for reliable 85% assessment`
    : `NOT_ACHIEVED: ${(stats.accuracy * 100).toFixed(1)}% < 85% target — improvement path: increase model edge or expand feature set`;

  // ── Determine gate status ──
  let status: PublicationGateStatus;
  let reason: string;

  if (blockers.length > 0) {
    status = "BLOCKED";
    reason = `BLOCKED: ${blockers.join(" | ")}`;
  } else if (warnings.length > 0 && stats.accuracy < GATE.ACCURACY_TARGET) {
    status = "PARTIALLY_SAFE";
    reason = `PARTIALLY_SAFE: accuracy ${(stats.accuracy * 100).toFixed(1)}% meets 70% floor but below 85% target | warnings: ${warnings.join(" | ")}`;
  } else if (warnings.length > 0) {
    status = "REQUIRES_MANUAL_REVIEW";
    reason = `REQUIRES_MANUAL_REVIEW: ${warnings.join(" | ")}`;
  } else if (stats.accuracy >= GATE.ACCURACY_TARGET) {
    status = "SAFE_TO_PUBLISH";
    reason = `SAFE_TO_PUBLISH: acc=${(stats.accuracy * 100).toFixed(1)}% roi=${(stats.roi * 100).toFixed(1)}% n=${stats.gradedCount} leakage=0`;
  } else {
    // Accuracy between 70–85%, no blockers, no warnings
    status = "PARTIALLY_SAFE";
    reason = `PARTIALLY_SAFE: accuracy ${(stats.accuracy * 100).toFixed(1)}% meets 70% floor but below 85% aspirational target`;
  }

  auditLog(
    status === "SAFE_TO_PUBLISH" ? "INFO"
    : status === "BLOCKED" ? "CRITICAL"
    : status === "PARTIALLY_SAFE" ? "WARN"
    : "WARN",
    market.toUpperCase(), timeframe, "PUBLICATION_GATE", "GATE_RESULT",
    `${market} gate status: ${status} | ${reason}`,
    {
      records_checked: stats.gradedCount,
      passed: status === "SAFE_TO_PUBLISH" ? stats.gradedCount : 0,
      failed: status === "BLOCKED" ? stats.gradedCount : 0,
      quarantined: stats.quarantined,
      date_min: stats.dateMin ?? undefined,
      date_max: stats.dateMax ?? undefined,
      impact: status === "BLOCKED" ? `${market}_publication_blocked` : "none",
      action: status === "BLOCKED" ? "resolve_blockers_before_publication" : "none",
    }
  );

  return {
    market, timeframe, status, checks, blockers, warnings,
    accuracy:          stats.accuracy,
    roi:               stats.roi,
    sampleSize:        stats.gradedCount,
    leakageViolations: stats.leakageViolations,
    quarantineRate:    parseFloat(quarantineRate.toFixed(6)),
    ece:               eceValue,
    walkForwardStatus: wfStatus,
    target85Achieved,
    target85Realistic,
    target85Evidence,
    reason,
  };
}

// ─── Full Publication Gate Report ─────────────────────────────────────────────

export function buildPublicationGateReport(
  marketResults: MarketGateResult[],
): PublicationGateReport {
  const safeMarkets    = marketResults.filter(r => r.status === "SAFE_TO_PUBLISH").map(r => r.market);
  const blockedMarkets = marketResults.filter(r => r.status === "BLOCKED").map(r => r.market);
  const partialMarkets = marketResults.filter(r => r.status === "PARTIALLY_SAFE").map(r => r.market);
  const reviewMarkets  = marketResults.filter(r => r.status === "REQUIRES_MANUAL_REVIEW").map(r => r.market);

  let overallStatus: PublicationGateStatus;
  let overallReason: string;

  if (blockedMarkets.length === marketResults.length) {
    overallStatus = "BLOCKED";
    overallReason = `All ${marketResults.length} markets blocked — no markets safe for publication`;
  } else if (blockedMarkets.length > 0) {
    overallStatus = "PARTIALLY_SAFE";
    overallReason = `${safeMarkets.length} markets safe, ${blockedMarkets.length} blocked: ${blockedMarkets.join(", ")}`;
  } else if (safeMarkets.length === marketResults.length) {
    overallStatus = "SAFE_TO_PUBLISH";
    overallReason = `All ${marketResults.length} markets passed publication gate`;
  } else {
    overallStatus = "PARTIALLY_SAFE";
    overallReason = `${safeMarkets.length} safe, ${partialMarkets.length} partially safe, ${reviewMarkets.length} require review`;
  }

  // Final trust status
  const allSafe = blockedMarkets.length === 0 && reviewMarkets.length === 0;
  const finalTrustStatus = allSafe
    ? "FULLY_PRODUCTION_TRUSTWORTHY_FOR_ALL_APPROVED_MARKETS"
    : safeMarkets.length > 0
    ? "PRODUCTION_TRUSTWORTHY_ONLY_FOR_SPECIFIC_APPROVED_MARKETS"
    : "NOT_PRODUCTION_TRUSTWORTHY_YET";

  const finalTrustReason = allSafe
    ? `All ${marketResults.length} approved markets passed accuracy, ROI, leakage, calibration, and walk-forward gates`
    : safeMarkets.length > 0
    ? `Safe markets: ${safeMarkets.join(", ")} | Blocked: ${blockedMarkets.join(", ")} | Partial: ${partialMarkets.join(", ")}`
    : `No markets passed all publication gate checks — system not ready for production use`;

  auditLog(
    overallStatus === "SAFE_TO_PUBLISH" ? "INFO" : overallStatus === "BLOCKED" ? "CRITICAL" : "WARN",
    "ALL_MARKETS", "ALL_TIMEFRAMES", "PUBLICATION_GATE", "FINAL_STATUS",
    `Overall gate status: ${overallStatus} | Trust: ${finalTrustStatus}`,
    {
      records_checked: marketResults.length,
      passed: safeMarkets.length,
      failed: blockedMarkets.length,
      impact: overallStatus === "BLOCKED" ? "all_markets_blocked" : "partial_publication_possible",
      action: blockedMarkets.length > 0 ? "resolve_blockers_for_blocked_markets" : "none",
    }
  );

  return {
    overallStatus, overallReason,
    marketResults,
    safeMarkets, blockedMarkets, partialMarkets, reviewMarkets,
    finalTrustStatus, finalTrustReason,
    generatedAt: Date.now(),
  };
}

// ─── Unresolved Blocker Report ────────────────────────────────────────────────

export interface UnresolvedBlocker {
  severity:         "CRITICAL" | "HIGH" | "MEDIUM";
  market:           ApprovedMarket;
  timeframe:        string;
  dependency:       string;
  whyUnresolved:    string;
  whatMustHappen:   string;
  publicationBlocked: boolean;
}

export function extractUnresolvedBlockers(
  report: PublicationGateReport,
): UnresolvedBlocker[] {
  const blockers: UnresolvedBlocker[] = [];

  for (const mr of report.marketResults) {
    for (const b of mr.blockers) {
      blockers.push({
        severity:         "CRITICAL",
        market:           mr.market,
        timeframe:        mr.timeframe,
        dependency:       b.split(":")[0] ?? "UNKNOWN",
        whyUnresolved:    b,
        whatMustHappen:   b.includes("LEAKAGE")
          ? "Remove or rebuild predictions with correct pre-game timestamps"
          : b.includes("ACCURACY")
          ? "Improve model accuracy through feature engineering or recalibration"
          : b.includes("ROI")
          ? "Improve edge or threshold — current model has negative expected value"
          : b.includes("SAMPLE")
          ? "Collect more graded rows before publication"
          : b.includes("WALK_FORWARD")
          ? "Investigate walk-forward failures — model may be overfitting"
          : "Investigate and resolve the specific blocker",
        publicationBlocked: true,
      });
    }

    for (const w of mr.warnings) {
      blockers.push({
        severity:         "HIGH",
        market:           mr.market,
        timeframe:        mr.timeframe,
        dependency:       w.split(":")[0] ?? "UNKNOWN",
        whyUnresolved:    w,
        whatMustHappen:   w.includes("QUARANTINE")
          ? "Investigate quarantined rows and resolve data quality issues"
          : w.includes("CALIBRATION")
          ? "Apply Platt scaling or retrain model to reduce calibration error"
          : "Investigate and resolve the specific warning",
        publicationBlocked: false,
      });
    }
  }

  return blockers;
}
