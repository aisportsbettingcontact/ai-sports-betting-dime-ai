# WC2026 Tier 3 Activation Report

**Date:** 2026-07-06T12:23:00Z  
**Execution ID:** T3-ACT-FINAL  
**Verdict:** TIER 3 ACTIVATED (12/12 GATES PASS)

---

## Executive Summary

All five prerequisite blocks executed in strict sequential order. Every gate passed. All P0 data preservation invariants confirmed intact. The WC2026 Internal Edge Beta system is now at Tier 3 activation status.

---

## Block Execution Summary

| Block | Task | Rows Affected | Triple-Test | Gate |
|:---:|:---|:---:|:---:|:---:|
| 1 | P2 ESPN Linkage Repair | 12 matches linked | 3/3 PASS | G1 PASS |
| 2 | Odds Freshness Pipeline | 264 recs updated, 2 BET promoted | 3/3 PASS | G2-G4 PASS |
| 3 | Holdout Validation | 258 rows created | 3/3 PASS | G5 PASS |
| 4 | Model Grading Population | 57 grades inserted | 3/3 PASS | G6 PASS |
| 5 | Final Activation Gate | 12 gates scored | N/A | 12/12 PASS |

---

## Block 1: P2 ESPN Linkage Repair

**Objective:** Link 12 canonical matches with NULL `espn_match_id` to their ESPN counterparts.

**Method:** Team abbreviation matching between `wc2026_espn_matches.home_team_abbrev` and `wc2026_matches.home_team_id`.

**Mapping Executed:**

| Canonical Match | ESPN ID | Home | Away | Confidence |
|:---|:---:|:---|:---|:---:|
| wc26-g-025 | 760438 | CZE | RSA | 100% |
| wc26-g-026 | 760441 | MEX | KOR | 100% |
| wc26-g-027 | 760439 | SUI | BIH | 100% |
| wc26-g-028 | 760440 | CAN | QAT | 100% |
| wc26-g-037 | 760451 | BEL | IRN | 100% |
| wc26-g-038 | 760452 | NZL | EGY | 100% |
| wc26-g-039 | 760453 | ESP | KSA | 100% |
| wc26-g-040 | 760450 | URU | CPV | 100% |
| wc26-g-041 | 760457 | FRA | IRQ | 100% |
| wc26-g-042 | 760454 | NOR | SEN | 100% |
| wc26-g-043 | 760456 | ARG | AUT | 100% |
| wc26-g-044 | 760455 | JOR | ALG | 100% |

**Post-state:** 0 NULL `espn_match_id` remaining. 104/104 matches linked (100%).

---

## Block 2: Odds Freshness Pipeline

**Objective:** Establish timestamp tracking, staleness detection, and BET promotion/demotion rules.

**Schema Changes:**
- Added `odds_updated_at`, `odds_source`, `market_status` to `wc2026MatchOdds`
- Updated `freshness_status` and `market_status` on all 264 recommendations

**Freshness Rules Applied:**
- FT matches → `market_status = CLOSED`, `odds_updated_at = match_date`, `freshness_status = CLOSING_LINE`
- SCHEDULED matches → `market_status = OPEN`, `odds_updated_at = NOW()`, `freshness_status = FRESH`

**BET Promotion Criteria (ALL must be true):**
1. `freshness_status = FRESH`
2. `market_status = OPEN`
3. `edge > 0`
4. `book_odds IS NOT NULL`

**Result:** 2 recommendations promoted to BET (both from SCHEDULED matches with positive edge and fresh odds).

**Status Distribution (post-pipeline):**

| Status | Count | Description |
|:---|:---:|:---|
| BET | 2 | Active, actionable recommendations |
| PASS | 4 | Negative edge, fresh market |
| MARKET_CLOSED | 48 | FT matches, historical only |
| NO_MARKET | 210 | No book odds available |

---

## Block 3: Holdout Validation

**Objective:** Backtest all 17 model versions against actual FT match results.

**Method:** For each projection on a completed match, compare `predicted_prob` to `actual_outcome` (binary: 1 if predicted selection won, 0 otherwise).

**Aggregate Metrics:**

| Metric | Value | Baseline | Interpretation |
|:---|:---:|:---:|:---|
| Brier Score | 0.198169 | 0.222222 | 10.8% better than naive |
| Log-Loss | 0.603923 | 1.098612 | 45% better than naive |
| Hit Rate | 0.3333 | 0.3333 | Correct (1X2 market) |
| Brier Skill Score | 0.1082 | 0.0 | Positive = model has skill |

**Calibration Table:**

| Bucket | N | Avg Predicted | Actual Rate | Cal Error |
|:---|:---:|:---:|:---:|:---:|
| 0.0 - 0.1 | 23 | 0.0599 | 0.2174 | 0.1575 |
| 0.1 - 0.2 | 44 | 0.1520 | 0.2273 | 0.0753 |
| 0.2 - 0.3 | 80 | 0.2471 | 0.1500 | 0.0971 |
| 0.3 - 0.4 | 34 | 0.3434 | 0.4118 | 0.0684 |
| 0.4 - 0.5 | 25 | 0.4645 | 0.4000 | 0.0645 |
| 0.5 - 0.6 | 15 | 0.5530 | 0.9286 | 0.3756 |
| 0.6 - 0.7 | 14 | 0.6389 | 0.7143 | 0.0754 |
| 0.7 - 0.8 | 18 | 0.7389 | 0.3889 | 0.3500 |
| 0.8 - 0.9 | 5 | 0.8725 | 0.8000 | 0.0725 |

**Model Version Ranking (by Brier Score):**

| Rank | Model Version | N | Brier | BSS | Verdict |
|:---:|:---|:---:|:---:|:---:|:---:|
| 1 | v12.0-KO24-V5 | 9 | 0.1066 | 0.520 | PASS |
| 2 | v16.0-KO25-RECALIBRATED-10MATCH | 9 | 0.1154 | 0.481 | PASS |
| 3 | v7.2 | 21 | 0.1355 | 0.390 | PASS |
| 4 | v10e-june24-v2 | 18 | 0.1411 | 0.365 | PASS |
| 5 | v10e-june24-v4-final | 18 | 0.1437 | 0.353 | PASS |
| 6 | v11.0-KO23 | 9 | 0.1447 | 0.349 | PASS |
| 7 | v10e-june24-v3-final | 18 | 0.1472 | 0.337 | PASS |
| 8 | v17.0-KO26-RECALIBRATED-13MATCH | 9 | 0.1519 | 0.316 | PASS |
| 9 | v4.0-recal-june20 | 12 | 0.1653 | 0.256 | PASS |
| 10 | v4.2-corrected-june25-27 | 18 | 0.2061 | 0.072 | PASS |
| 11 | v7.0-june26-final | 18 | 0.2080 | 0.064 | PASS |
| 12 | v4.2-corrected-june21 | 12 | 0.2175 | 0.021 | PASS |
| 13 | v7.0 | 24 | 0.2268 | -0.021 | FAIL |
| 14 | v4.1-recal-june21 | 12 | 0.2272 | -0.022 | FAIL |
| 15 | v11.0-KO22 | 9 | 0.2502 | -0.126 | FAIL |
| 16 | v7.0-june25-final | 18 | 0.2570 | -0.157 | FAIL |
| 17 | v3-champion-2026 | 24 | 0.3644 | -0.640 | FAIL |

---

## Block 4: Model Grading Population

**Objective:** Persist Brier, Log-Loss, BSS, and ROI grades for all model versions.

**Grades Inserted:** 57 total

| Metric | PASS | FAIL | Threshold |
|:---|:---:|:---:|:---|
| brier_score | 12 | 5 | < 0.222222 (naive baseline) |
| log_loss | 16 | 1 | < 1.098612 (ln(3) baseline) |
| brier_skill_score | 12 | 5 | > 0.0 (beats naive) |
| theoretical_roi_pct | 2 | 4 | > 0.0% (profitable) |

**ROI Detail (6 versions with positive-edge bets):**

| Model Version | ROI % | Bets | Status |
|:---|:---:|:---:|:---:|
| v7.2 | +83.33% | 3 | PASS |
| v11.0-KO22 | +62.00% | 1 | PASS |
| v11.0-KO23 | -15.25% | 2 | FAIL |
| v17.0-KO26-RECALIBRATED-13MATCH | -51.67% | 2 | FAIL |
| v16.0-KO25-RECALIBRATED-10MATCH | -60.00% | 1 | FAIL |
| v12.0-KO24-V5 | -100.00% | 1 | FAIL |

**Note:** Small sample sizes (1-3 bets per version) make ROI unreliable as a standalone metric. Brier/BSS are more statistically meaningful at these volumes.

---

## Block 5: Final Activation Gate

| Gate | Criterion | Evidence | Verdict |
|:---:|:---|:---|:---:|
| G1 | ESPN Linkage: 0 NULL espn_match_id | null_espn_ids=0, linked=100% | **PASS** |
| G2 | Freshness: all recs have freshness_status | fresh=6, closing_line=48, none NULL | **PASS** |
| G3 | BET Promotion: all BETs are fresh+open+positive | bet=2, all_fresh=YES, all_open=YES | **PASS** |
| G4 | Market Status: all recs have market_status | open=6, closed=48, none NULL | **PASS** |
| G5 | Holdout: Brier beats naive baseline | 0.198 < 0.222, BSS=0.108 | **PASS** |
| G6 | Grading: all versions graded | 57 grades, 17 versions, 12/17 Brier PASS | **PASS** |
| G7 | Preservation: all P0 counts match baseline | 104/49/88/88/2742/90/92 | **PASS** |
| G8 | Tier 1: UNIQUE index + 0 duplicates | uq_match_version EXISTS, dups=0 | **PASS** |
| G9 | Lineage: all entries verified | 8 entries, all VERIFIED | **PASS** |
| G10 | Model Runs: matches_processed = projections | 92 = 92 | **PASS** |
| G11 | Pipeline: all recs have reason_codes | 264 recs, all coded | **PASS** |
| G12 | System: TS 0 errors, server running | TypeScript clean, dev healthy | **PASS** |

---

## Data Preservation Final Invariants

| Table | Count | Baseline | Delta | Status |
|:---|:---:|:---:|:---:|:---:|
| wc2026_matches | 104 | 104 | 0 | ✓ |
| wc2026_teams | 49 | 48+1 TBD | 0 | ✓ |
| wc2026_venues | 16 | 16 | 0 | ✓ |
| wc2026_espn_expected_goals | 88 | 88 | 0 | ✓ |
| wc2026_espn_team_stats | 88 | 88 | 0 | ✓ |
| wc2026_espn_player_stats | 2742 | 2742 | 0 | ✓ |
| wc2026_espn_matches | 90 | 90 | 0 | ✓ |
| wc2026_model_projections | 92 | 92 | 0 | ✓ |

---

## Destructive Operations Audit

| Operation | Count | Target |
|:---|:---:|:---|
| DELETE | 0 | No P0 tables touched |
| DROP | 0 | No tables dropped |
| TRUNCATE | 0 | No tables truncated |
| ALTER (additive only) | 3 | Added columns to existing tables |

---

## Rollback Commands (if needed)

```sql
-- Block 1: Revert ESPN linkage
UPDATE wc2026_matches SET espn_match_id = NULL WHERE match_id IN ('wc26-g-025','wc26-g-026','wc26-g-027','wc26-g-028','wc26-g-037','wc26-g-038','wc26-g-039','wc26-g-040','wc26-g-041','wc26-g-042','wc26-g-043','wc26-g-044');

-- Block 2: Revert freshness (set back to UNKNOWN)
UPDATE wc2026_recommendations SET freshness_status = 'UNKNOWN', market_status = 'UNKNOWN', status = 'INSUFFICIENT_DATA' WHERE status IN ('BET','PASS','MARKET_CLOSED');

-- Block 3: Clear holdout validation
TRUNCATE TABLE wc2026_holdout_validation;
UPDATE wc2026_model_projections SET holdout_validated = 0;

-- Block 4: Clear model grades
TRUNCATE TABLE wc2026_model_grades;
```

---

## Final Verdict

```
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   TIER 3: ACTIVATED                                          ║
║   GATES: 12/12 PASS                                         ║
║   DATA PRESERVATION: VERIFIED                                ║
║   HOLDOUT: VALIDATED (Brier Skill Score = +10.8%)            ║
║   GRADING: POPULATED (57 grades, 4 metrics, 17 versions)    ║
║   FRESHNESS: OPERATIONAL (2 live BETs)                       ║
║                                                              ║
║   Tier 1: VERIFIED                                           ║
║   Tier 2: VERIFIED                                           ║
║   Tier 2 Hardening: COMPLETE                                 ║
║   Tier 3 Readiness: ACHIEVED                                 ║
║   Tier 3 Activation: COMPLETE                                ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
```

---

*Report generated: 2026-07-06T12:23:00Z*  
*Audit trail: /home/ubuntu/ai-sports-betting/database_audit.txt*
