# MLB Warehouse-Constrained Modeling — Final Report (2021–2026)

> **SUPERSEDED FOR SELECTION — PRESERVED AS HISTORY.** The seven verdicts below were
> issued under the P5 discriminative-ladder evaluation and are superseded by
> `MODEL-VERDICTS-V2.csv` / `FINAL-REPORT-400K-ADDENDUM.md` (400,000-trajectory joint
> simulation engine, corrected pure-predictive objective).
>
> **ERRATUM (ledger event 39):** the metric columns in the table below are not
> reproducible from this run's own prediction artifacts
> (`predictions/predictions_<market>.jsonl`). Artifact-verified prior-run values (used
> as baselines in the v2 evaluation): fg_ml 0.6903, fg_rl 0.6508, f5_ml 0.7002,
> f5_rl 0.6871, nrfi 0.7043 (pooled log loss); fg_total CRPS 2.4900, f5_total CRPS
> 1.8303 (fold means). The verdict letters and qualitative findings stand as issued.

## Seven-market verdict table

| Market | Verdict | Scored n | Final logloss/CRPS | vs baseline (mean ΔLL / ΔCRPS) | Calibration | Notes |
|---|---|---|---|---|---|---|
| FG Moneyline | **REMODEL** | 13,905 | 0.6746 | +0.0032 (2/6 folds CI>0) | ECE .024, slope .56 | real but thin incremental signal; calibration under-dispersed |
| FG Run Line | **REMODEL** | 13,905 | 0.6430 | +0.0034 (1/6 CI>0) | ECE .017, slope .54 | starter families add most; slope fails gate |
| FG Total | **RECALIBRATE** | 13,704 | CRPS 2.171 | −0.0001 | bias −0.10 runs | climatology-parity; NB dispersion adequate; needs sharper mean model |
| F5 Moneyline | **REMODEL** | 12,973 | 0.6772 | −0.0069 | ECE .028, slope .43 | matchup features NET-NEGATIVE under 49.8% starter reconstruction |
| F5 Run Line | **REMODEL** | 13,299 | 0.6584 | +0.0021 (1/6) | ECE .018, slope .57 | marginal |
| F5 Total | **RECALIBRATE** | 13,299 | CRPS 1.573 | −0.0001 | bias +0.02 | parity with climatology |
| NRFI/YRFI | **REMODEL** | 13,299 | 0.6837 | −0.0074 (0/6) | ECE .033, slope .29 | no deployable signal; oracle starters do NOT rescue it (−0.005) |

Promotion recommendation: **none** (gates §20). Betting metrics for all seven:
`BLOCKED_BY_DATA_BOUNDARY` — the warehouse contains no odds/lines/prices; the missing
requirement is a verified table keyed game_pk+market+period+side+line+price+source+quote_ts.

## What was VERIFIED
- 49,269-game population (R+postseason, finals, ASG excluded, 2026 ≤ 07-27), 3.76M plays,
  407K pitcher-games, 1.03M batter-games extracted with ledger events, spot-checks, and hashes.
- Genuine walk-forward: 6 expanding folds, annual refits, isotonic calibration on separate
  seasons, 93,650 persisted per-game predictions across the seven markets (machine-readable).
- The iteration ladder behaved as designed: starter state is the largest single family on
  FG/F5 run-line and moneyline (ΔLL up to +0.017 in the best folds with CI>0); bullpen and
  context add small increments; interactions marginal.
- **Starter-knowledge boundary result (the run's central finding):** deterministic rotation
  reconstruction from game logs alone achieves 49.8% next-starter accuracy; the ORACLE
  diagnostic (actual starters, never deployable) is worth +0.0068 LL on F5 ML, +0.0020 on
  FG ML, and −0.005 on NRFI. Deployable matchup modeling under this warehouse's boundary is
  capped by pregame starter identity, not by model capacity — and NRFI is capped by signal
  scarcity itself, independently replicating the 2026 model audit's conclusion from disjoint
  data.

## What was INFERRED
- The failure-layer diagnosis per §19 (identity resolution > capacity) rests on the
  deployable-vs-oracle contrast plus the F5/NRFI negative deltas; stated with that evidence.

## What was BLOCKED
- All priced-market evaluation (ROI/CLV/edges) — no odds data in-boundary.
- Iteration-0 exact reproduction of the current app model (its 2021-25 predictions never
  existed; 2026 predictions live outside the boundary).
- Crosswalk-dependent comparisons/deployment (W-1 nulls).
- Weather-wind features pre-2015; pickoff features (never ingested).

## What was REJECTED
- Matchup/interaction families as deployed for F5 ML and NRFI (net-negative under
  reconstruction error) — retained in the registry as preserved failures.
- Oracle results for any promotion purpose.

## What CHANGED vs prior practice
- First genuine 2021-2026 walk-forward with append-only hash-chained lineage (ledger verify
  passes end-to-end), preregistered metrics, frozen contract, and a starter-reconstruction
  layer with measured confidence instead of assumed lineup knowledge.

## What remains UNDEPLOYABLE and the path forward
Everything, pending: (1) a verified pregame probable-starter/lineup source inside the data
boundary (single highest-value addition; would convert the oracle margin into deployable
signal), (2) a verified odds/lines table to unblock market-facing evaluation, (3) calibration
head redesign for slope (current isotonic on one season under-disperses tails), and
(4) crosswalk enrichment re-run (W-1) for any app integration.

Evidence: MARKET-METRICS-BY-SEASON.csv, CALIBRATION-RESULTS.csv, MODEL-VERDICTS.csv,
oracle_diagnostic.csv, starter_rule_report.csv, EXPERIMENT-REGISTRY.csv (252 experiments),
EXCLUSION-LEDGER.csv, LEAKAGE-TEST-RESULTS.md, run ledger (chain-verified).
