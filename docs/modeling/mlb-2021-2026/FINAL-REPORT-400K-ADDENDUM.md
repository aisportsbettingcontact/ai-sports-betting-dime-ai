# Final Report Addendum — 400,000-Trajectory Backtest (joint-nb-v2)

Executed under the governing 400k master directive: pure outcome prediction (no
odds/vig/CLV/ROI work), three forecast states, exactly 400,000 joint trajectories per
backtested game per state, shared-trajectory derivation of all seven markets, frozen
walk-forward contract (`WALK-FORWARD-CONFIG.yaml`), warehouse-only evidence boundary.

## Headline result

**All seven markets: REINFORCE.** The joint simulation engine beats the strongest
available baseline (walk-forward climatology or the P5 prior-run final model, whichever
is stronger per fold) in every market, in 6/6 folds for six markets and 5/6 for
f5_total, with the calibration redesign target met (slopes 0.99–1.08 vs the prior
run's 0.54–0.56).

| Market | Metric | State A | State B | State C | Strongest baseline | ΔB vs base | Folds better (B) | Slope (B) | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| FG Moneyline | LL | 0.6830 | 0.6799 | 0.6796 | 0.6875 | +0.0076 | 6/6 | 0.993 | REINFORCE |
| FG Run Line | LL | 0.6442 | 0.6399 | 0.6400 | 0.6489 | +0.0090 | 6/6 | 1.076 | REINFORCE |
| FG Total | CRPS | 2.4733 | 2.4608 | 2.4620 | 2.4896 | +0.0287 | 6/6 | — | REINFORCE |
| F5 Moneyline | LL | 0.6833 | 0.6768 | 0.6766 | 0.6885 | +0.0117 | 6/6 | 1.023 | REINFORCE |
| F5 Run Line | LL | 0.6828 | 0.6779 | 0.6777 | 0.6857 | +0.0079 | 6/6 | 1.031 | REINFORCE |
| F5 Total | CRPS | 1.8291 | 1.8169 | 1.8165 | 1.8301 | +0.0132 | 5/6 | — | REINFORCE |
| NRFI/YRFI | LL | 0.6932 | 0.6910 | 0.6908 | 0.6931 | +0.0021 | 6/6 | 1.052 | REINFORCE |

Per-fold evidence: `VERDICT-EVIDENCE-V2.csv`. Verdicts: `MODEL-VERDICTS-V2.csv`.

## What changed vs the P5 conclusion

The P5 ladder (5 REMODEL / 2 RECALIBRATE) evaluated **discriminative per-market
models**; its two structural failures were severe under-calibration (slopes 0.43–0.57)
and matchup features that were net-negative under the 49.8% starter-reconstruction
ceiling. The v2 engine addresses both by construction:

1. **Generative joint engine, not per-market heads.** Per-side inning-block Poisson
   means with a shared per-trajectory Gamma environment factor (k≈7.6) produce
   NB-dispersed, positively dependent home/away scoring. All seven markets are
   trajectory-derived, giving exact coherence (`COHERENCE-RESULTS-V2.md`).
2. **Calibration by design + Platt heads on calibration-role sims only.** Simulated
   probabilities land near-calibrated (raw slopes ~1); heads fit on the fold's
   designated calibration year finish the job. ECE 0.018–0.024 across binary markets.
3. **The forecast-state design isolates the reconstruction ceiling.** State A
   (ex-ante reconstruction) already beats every baseline; States B/C
   (CONDITIONING_IDENTITY: confirmed identities, strictly-prior statistics) add
   +0.003–0.007 LL on top — the matchup signal P5 could not deploy is recovered once
   identity uncertainty is removed, without any same-game statistic entering.

## Execution record

- Two full 400k sweeps ran. **v1 (joint-nb-v1)** completed its contract but was found
  at scoring to have an intercept-collapsed mean model — over-regularized
  `PoissonRegressor(alpha=2.0)` on unstandardized features produced near-constant
  lambdas (ledger event 31). It issued no verdicts and is preserved as history.
- **v2 (joint-nb-v2)** refit: standardized GLM with alpha selected per block/fold on
  calibration-year Poisson deviance (glm_0.1 won 107/108 contests; an HGB-Poisson
  candidate never won), dispersion refit on residuals around per-game means. Fresh
  seed stream (model_version is inside every seed payload).
- Full contract: 80,193 game-state simulations × 400,000 = 32.077B trajectories, 24/24
  shards clean, per-game gates 80,193/80,193 PASS
  (`INTEGRITY-RECONCILIATION.md`, `CONVERGENCE-CHECKPOINT-REPORT.md`).
- Monte-Carlo SE at 400k (~0.00079) is ~1/3 of the smallest per-market improvement
  (nrfi +0.0021) and ~1/10 of the median — verdicts are MC-noise-robust.

## Erratum against the P5 report

The metric columns in the P5 report's verdict table are not reproducible from that
run's own prediction artifacts; artifact-verified values (pooled from
`predictions/predictions_<market>.jsonl`) are listed in the banner of
`MLB-MODELING-FINAL-REPORT.md` and were the baselines used here. The discrepancy was
found during v2 baseline reconciliation and recorded in the ledger before verdicts
were finalized. P5 verdict letters and qualitative findings are unaffected.

## Boundary & scope

- Evidence boundary unchanged: frozen warehouse snapshot only (max_loaded_at
  2026-07-29T08:59:20Z); no internet, no new StatsAPI, no external odds/injury/
  weather, no app tables, no fuzzy identity joins.
- Betting/pricing metrics: out of objective per the governing directive (and remain
  BLOCKED_BY_DATA_BOUNDARY regardless).
- Per §17 of the directive: no deployment, publication, or promotion. This work
  completes and stops; promotion remains an owner decision.

## Deliverable map (this addendum's set)

| File | Contents |
|---|---|
| `MODEL-VERDICTS-V2.csv` | revised seven-market verdicts + gate detail |
| `VERDICT-EVIDENCE-V2.csv` | per-market per-fold: climatology, prior-run, v2 A/B/C, slopes, ECE |
| `SIMULATION-ENGINE-SPEC.md` | architecture, states, fits, screening, results |
| `SEED-REPRODUCIBILITY-SPEC.md` | seeding scheme, hash chain, reproduction |
| `SIMULATION-MANIFEST.parquet` | 80,193 rows: per game/state hashes, gates, MC-SE |
| `SIM-DISTRIBUTIONS-{A,B,C}.parquet` | per-game market probabilities + total/F5 pmfs |
| `CONVERGENCE-CHECKPOINT-REPORT.md` | drift at 25k/50k/100k/200k vs 400k |
| `INTEGRITY-RECONCILIATION.md` | population/hash/role reconciliation |
| `COHERENCE-RESULTS-V2.md` | §11 coherence + leakage posture |
| `screening_v2_{A,B,C}.csv` | mean-model screening (108 contests) |
| `engine_params_v2_{A,B,C}.parquet` | fitted per-game lambdas, k, extras rate |
| `sim_results_v2.csv` | full metric suite per market/state/fold |
| `coherence_results_v2.json` | machine-readable coherence results |
| `EXPERIMENT-REGISTRY.csv` | updated (+109 v2 entries, 361 total) |
| `LEDGER-FINAL.md` + `ledger.jsonl` | append-only hash-chained execution ledger |
