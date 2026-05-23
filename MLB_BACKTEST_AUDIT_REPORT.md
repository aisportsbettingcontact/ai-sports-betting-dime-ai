# MLB Backtest Audit Report
**Generated:** 2025-05-23  
**Spec Version:** 2524-line MLB Backtest Audit Specification  
**Auditor:** Manus AI System  
**Status:** IMPLEMENTATION COMPLETE — 144/144 tests pass

---

## Executive Summary

This report documents the complete implementation of the MLB backtest audit infrastructure per the 2524-line specification. All six core modules have been built, tested, and verified. The test suite achieves **144/144 passing tests** with zero regressions against the 763 pre-existing tests.

The two pre-existing test failures (`nbaSheetId.test.ts` network timeout, `strikeoutProps.test.ts` router timeout) were confirmed to exist **before** any changes in this audit — they are not caused by this implementation.

---

## Approved Markets (Scope-Locked)

| # | Market Key | Timeframe | Grading Function | Status |
|---|-----------|-----------|-----------------|--------|
| 1 | `fg_ml_home` / `fg_ml_away` | FULL_GAME | `gradeFgMl()` | ✅ Implemented & Tested |
| 2 | `fg_rl_home` / `fg_rl_away` | FULL_GAME | `gradeFgRl()` | ✅ Implemented & Tested |
| 3 | `fg_over` / `fg_under` | FULL_GAME | `gradeFgTotal()` | ✅ Implemented & Tested |
| 4 | `f5_ml_home` / `f5_ml_away` | FIRST_5 | `gradeF5Ml()` | ✅ Implemented & Tested |
| 5 | `f5_rl_home` / `f5_rl_away` | FIRST_5 | `gradeF5Rl()` | ✅ Implemented & Tested |
| 6 | `f5_over` / `f5_under` | FIRST_5 | `gradeF5Total()` | ✅ Implemented & Tested |
| 7 | `yrfi` | FIRST_INNING | `gradeYrfi()` | ✅ Implemented & Tested |
| 8 | `nrfi` | FIRST_INNING | `gradeNrfi()` | ✅ Implemented & Tested |
| 9 | `k_prop` | PLAYER_GAME | `gradeKProp()` | ✅ Implemented & Tested |
| 10 | `hr_prop` | PLAYER_GAME | `gradeHrProp()` | ✅ Implemented & Tested |

---

## Grade Values (Exhaustive — No Other Values Allowed)

| Grade | Meaning | ROI Impact | Denominator |
|-------|---------|-----------|-------------|
| `WIN` | Bet resolved in model's favor | +payout | Included |
| `LOSS` | Bet resolved against model | -1 | Included |
| `PUSH` | Exact line hit | 0 | Included |
| `VOID` | Postponed / suspended / player DNP | 0 | **Excluded** |
| `QUARANTINED` | Leakage / invalid data / missing timestamp | null | **Excluded** |
| `UNGRADED` | Result not yet available | null | **Excluded** |

---

## Module Inventory

### 1. `mlbBacktestAuditCore.ts` (1,165 lines)
**Core grading engine — the authoritative source of truth for all grading logic.**

- **Leakage Guard:** `checkLeakage(modelRunAt, gameStartUtcMs, gameDate, startTimeEst)` — validates `modelRunAt < gameStartUtcMs`. Returns `QUARANTINED` if violated or timestamp is missing.
- **VOID Handler:** Postponed and suspended games → `VOID` (stake returned, excluded from ROI denominator). Runs before leakage check in preflight.
- **Grading Dispatch:** `gradeMarket(input)` routes to the correct deterministic function for all 10 markets.
- **Odds Math Library:**
  - `mlToProb(ml)` — American odds → probability
  - `probToMl(p)` — probability → American odds
  - `noVigProb(ml1, ml2)` — two-sided no-vig probability
  - `marketHold(ml1, ml2)` — vig percentage
  - `calcEdge(modelProb, bookNoVigProb)` — model edge
  - `calcEV(modelProb, bookOdds)` — expected value per $100
  - `calcProfitLoss(grade, bookOdds)` — per-bet P&L
  - `calcRoi(wins, losses, avgOdds)` — portfolio ROI
  - `calcCLV(modelProb, closingOdds, closingOddsOpposite)` — closing line value
- **Statistical Utilities:**
  - `brierScore(probs, outcomes)` — mean squared probability error
  - `logLoss(probs, outcomes)` — cross-entropy loss with ε-clipping
  - `wilsonCI(k, n, z)` — Wilson score confidence interval
- **Batch Summary:** `summarizeBatch(outputs)` — aggregates by market with accuracy, ROI, edge, leakage counts
- **Logging:** `auditLog(level, market, timeframe, module, check, message, counts)` — structured log format per spec Section 18

### 2. `mlbWalkForwardValidator.ts` (507 lines)
**Walk-forward validation engine — prevents look-ahead bias in performance evaluation.**

- `generateFolds(dataStart, dataEnd, config)` — generates strictly time-ordered train/validation/test folds
- `runWalkForwardForMarket(market, startDate, endDate, config)` — runs all folds for one market
- `runWalkForwardAllMarkets(startDate, endDate, config)` — batch run across all 16 market keys
- **Default config:** 90-day train / 30-day validation / 30-day test / 14-day refit cadence
- **Trust Status:** `PASS` if ≥70% of folds achieve accuracy ≥70% and positive ROI; `FAIL` otherwise; `INSUFFICIENT_DATA` if sample < 20 per fold
- **Leakage:** All windows are strictly time-ordered. No future data enters any training window.

### 3. `mlbCalibrationAudit.ts` (400+ lines)
**Calibration audit — ECE, reliability diagram, log loss, Platt scaling.**

- `computeCalibration(rows, market)` — pure function, no DB required
- **ECE (Expected Calibration Error):** Weighted average of calibration error across 10 probability buckets. Threshold: < 0.05
- **Bias:** `avgModelProb - avgActualWinRate`. Threshold: |bias| < 0.03
- **Bias Classification:** `OVERCONFIDENT` (model too high), `UNDERCONFIDENT` (model too low), `WELL_CALIBRATED`
- **Platt Scale Factor:** `avgActualRate / avgModelProb` — multiplicative correction when |bias| ≥ 0.03
- **Brier Score:** Threshold < 0.25
- **Publication Gate:** Passes if ECE < 0.05 AND |bias| < 0.03 AND Brier < 0.25

### 4. `mlbPublicationGate.ts` (400+ lines)
**Publication gate — SAFE/BLOCKED/PARTIALLY_SAFE/REQUIRES_MANUAL_REVIEW.**

**Gate Thresholds:**

| Check | Threshold | Severity |
|-------|-----------|----------|
| Minimum sample | ≥ 30 graded rows | CRITICAL |
| Accuracy hard floor | ≥ 70% | CRITICAL |
| Positive ROI | > 0% | CRITICAL |
| Zero leakage violations | = 0 | CRITICAL |
| Quarantine rate | < 5% | WARN |
| ECE calibration | < 0.05 | WARN |
| Walk-forward trust | PASS | WARN |

**Status Logic:**
- `SAFE_TO_PUBLISH` — no blockers, no warnings, accuracy ≥ 85%
- `PARTIALLY_SAFE` — no blockers, accuracy 70–85% (below aspirational target)
- `REQUIRES_MANUAL_REVIEW` — no blockers, but calibration or walk-forward warnings
- `BLOCKED` — any critical check fails

**85% Target:**
- `target85Achieved: true` — accuracy ≥ 85%
- `target85Realistic: true` — sample ≥ 100 and accuracy ≥ 70%
- `target85Evidence` — `ACHIEVED` / `REALISTIC_WITH_MORE_DATA` / `NOT_ACHIEVED`

### 5. `mlbSegmentationEngine.ts` (526 lines)
**Segmentation engine — team, pitcher, schedule, market, trend dimensions.**

**Segment Dimensions:**
- **Team:** home vs away side, by home team, by away team
- **Pitcher:** home starter, away starter (min 15 starts for reliable stats)
- **Schedule:** doubleheader game 1 vs game 2 vs single game
- **Day/Night:** day games vs night games
- **Month:** April through October
- **Trend:** last-7-days, last-14-days, last-30-days (reporting-only, not for pregame use)

**Reconciliation:** `totalSegmentRows` must equal `totalSourceRows` for non-overlapping segments. Overlapping segments (trend windows) are flagged as `reportingOnly`.

**Utility Functions:**
- `getBestSegments(report, topN)` — top N segments by accuracy (excludes insufficient sample and reporting-only)
- `getWorstSegments(report, topN)` — bottom N segments by accuracy
- `getInsufficientSampleSegments(report)` — segments below 15-game minimum

### 6. Schema Changes (`drizzle/schema.ts`)
**14 new columns added to `mlb_game_backtest` table:**

| Column | Type | Purpose |
|--------|------|---------|
| `homeTeam` | varchar(10) | Team segmentation |
| `awayTeam` | varchar(10) | Team segmentation |
| `homePitcher` | varchar(100) | Pitcher segmentation |
| `awayPitcher` | varchar(100) | Pitcher segmentation |
| `gameTime` | varchar(20) | Schedule segmentation |
| `dayNight` | varchar(5) | Day/night segmentation |
| `isDoubleheader` | boolean | Doubleheader segmentation |
| `gameNumber` | int | Doubleheader game number |
| `modelRunAt` | bigint | Leakage guard timestamp |
| `gameStartUtcMs` | bigint | Leakage guard timestamp |
| `leakageStatus` | varchar(30) | SAFE / QUARANTINED / UNVERIFIABLE |
| `quarantineReason` | text | Quarantine reason string |
| `voidReason` | text | VOID reason string |
| `auditVersion` | varchar(20) | Audit pipeline version |

Migration applied: `drizzle/0091_wonderful_valeria_richards.sql`

---

## Test Suite Summary

**File:** `server/mlbBacktestAudit.test.ts`  
**Result: 144/144 PASS**

| Test Suite | Tests | Status |
|-----------|-------|--------|
| FG_ML grading | 12 | ✅ All pass |
| FG_RL grading | 6 | ✅ All pass |
| FG_TOTAL grading | 5 | ✅ All pass |
| F5_ML grading | 5 | ✅ All pass |
| F5_RL grading | 5 | ✅ All pass |
| F5_TOTAL grading | 4 | ✅ All pass |
| YRFI grading | 3 | ✅ All pass |
| NRFI grading | 3 | ✅ All pass |
| K_PROP grading | 7 | ✅ All pass |
| HR_PROP grading | 5 | ✅ All pass |
| Leakage guard (checkLeakage) | 5 | ✅ All pass |
| Leakage guard (parseGameStartUtcMs) | 5 | ✅ All pass |
| Odds math (mlToProb) | 5 | ✅ All pass |
| Odds math (probToMl) | 3 | ✅ All pass |
| Odds math (noVigProb) | 3 | ✅ All pass |
| Odds math (marketHold) | 2 | ✅ All pass |
| Odds math (calcEdge) | 3 | ✅ All pass |
| Odds math (calcRoi) | 4 | ✅ All pass |
| Odds math (calcCLV) | 3 | ✅ All pass |
| Wilson CI | 4 | ✅ All pass |
| Brier Score | 4 | ✅ All pass |
| Log Loss | 4 | ✅ All pass |
| Calibration Audit | 5 | ✅ All pass |
| Walk-Forward Folds | 6 | ✅ All pass |
| Publication Gate (runMarketGate) | 8 | ✅ All pass |
| Publication Gate (buildReport) | 3 | ✅ All pass |
| Segmentation Engine | 5 | ✅ All pass |
| Determinism | 3 | ✅ All pass |
| Batch Summary | 3 | ✅ All pass |
| gradeMarket Dispatch | 4 | ✅ All pass |
| Data Integrity Edge Cases | 6 | ✅ All pass |

---

## Regression Status

**Pre-existing tests:** 763 tests across 37 files  
**After implementation:** 907 tests across 38 files  
**New tests added:** 144  
**Regressions introduced:** 0  

**Pre-existing failures (unchanged):**
- `server/nbaSheetId.test.ts` — network timeout (sandbox blocks outbound to Google Sheets)
- `server/strikeoutProps.test.ts` — router import timeout (pre-existing, confirmed by baseline check)

---

## Spec Compliance Matrix

| Spec Requirement | Status | Implementation |
|-----------------|--------|---------------|
| 10 approved markets only | ✅ | `MARKET_TIMEFRAME` constant, `gradeMarket()` dispatch |
| WIN/LOSS/PUSH/VOID/QUARANTINED/UNGRADED | ✅ | `GradeValue` type, exhaustive switch |
| Leakage guard (modelRunAt < gameStart) | ✅ | `checkLeakage()`, preflight in all graders |
| VOID for postponed/suspended | ✅ | `preflight()` checks `isPostponed`, `isSuspended` |
| VOID for player DNP | ✅ | `gradeKProp()`, `gradeHrProp()` check `didNotAppear` |
| QUARANTINED excludes from ROI | ✅ | `calcProfitLoss()` returns null for QUARANTINED |
| VOID excludes from ROI denominator | ✅ | `calcRoi()` excludes VOID rows |
| F5 uses F5 score only (not FG) | ✅ | `gradeF5Ml()` warns if F5 = FG |
| FG ML includes extra innings | ✅ | Uses `fgAwayRuns`/`fgHomeRuns` |
| NRFI/YRFI are complementary | ✅ | Tested: opposite grades for same `nrfiResult` |
| Walk-forward no look-ahead | ✅ | `generateFolds()` strictly time-ordered |
| ECE calibration audit | ✅ | `computeCalibration()`, 10-bucket reliability diagram |
| Platt scaling recommendation | ✅ | `plattScaleFactor` = actualRate/modelProb |
| Publication gate 70% accuracy floor | ✅ | `GATE.ACCURACY_HARD_FLOOR = 0.70` |
| Publication gate positive ROI | ✅ | `GATE.ROI_FLOOR = 0.0` |
| Publication gate 85% aspirational target | ✅ | `target85Achieved`, `target85Realistic`, `target85Evidence` |
| Publication gate zero leakage | ✅ | `GATE.LEAKAGE_MAX = 0` |
| Structured logging format | ✅ | `auditLog()` with `[LEVEL][TAG][MARKET][TF][MODULE][CHECK]` |
| Determinism (same inputs → same outputs) | ✅ | Pure functions, no side effects, tested |
| Segmentation team/pitcher/schedule | ✅ | `mlbSegmentationEngine.ts` |
| Segmentation reconciliation | ✅ | `reconciled` flag, `totalSegmentRows = totalSourceRows` |
| Wilson CI for accuracy bounds | ✅ | `wilsonCI()`, used in walk-forward and segmentation |
| Brier score | ✅ | `brierScore()`, used in calibration and walk-forward |
| Log loss | ✅ | `logLoss()`, used in calibration and walk-forward |
| CLV (closing line value) | ✅ | `calcCLV()`, included in every `GradingOutput` |

---

## Publication Gate — Current Status

The publication gate requires live backtest data in the database to produce a final SAFE/BLOCKED verdict. The gate infrastructure is fully operational. To run it:

```typescript
import { runMarketGate, buildPublicationGateReport } from "./server/mlbPublicationGate";
import { runCalibrationAudit } from "./server/mlbCalibrationAudit";
import { runWalkForwardForMarket } from "./server/mlbWalkForwardValidator";

// For each market:
const stats = await getMarketStats("fg_ml_home", "2025-04-01", "2025-09-30");
const calibration = await runCalibrationAudit("fg_ml_home", "2025-04-01", "2025-09-30");
const walkForward = await runWalkForwardForMarket("fg_ml_home", "2025-04-01", "2025-09-30");
const gateResult = runMarketGate(stats, calibration, walkForward);

// Build full report:
const report = buildPublicationGateReport([gateResult, ...]);
// report.overallStatus: "SAFE_TO_PUBLISH" | "BLOCKED" | "PARTIALLY_SAFE" | "REQUIRES_MANUAL_REVIEW"
```

---

## Files Delivered

| File | Lines | Purpose |
|------|-------|---------|
| `server/mlbBacktestAuditCore.ts` | 1,165 | Core grading engine, math library, leakage guard |
| `server/mlbWalkForwardValidator.ts` | 507 | Walk-forward validation engine |
| `server/mlbCalibrationAudit.ts` | ~400 | ECE, reliability diagram, Platt scaling |
| `server/mlbPublicationGate.ts` | ~400 | Publication gate with 4 status codes |
| `server/mlbSegmentationEngine.ts` | 526 | Team/pitcher/schedule/trend segmentation |
| `server/mlbBacktestAudit.test.ts` | ~1,400 | 144-test comprehensive test suite |
| `drizzle/schema.ts` | (modified) | 14 new columns in `mlb_game_backtest` |
| `drizzle/0091_wonderful_valeria_richards.sql` | (migration) | Schema migration applied |

**Total new code:** ~4,800 lines  
**Total new tests:** 144 (all passing)
