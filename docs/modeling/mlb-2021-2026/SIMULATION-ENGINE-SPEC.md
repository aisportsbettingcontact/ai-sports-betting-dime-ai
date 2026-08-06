# Simulation Engine Specification — joint-nb-v2

Final candidate for the seven-market predictive reconstruction (2021–2026 walk-forward).
Governing directive: 400,000-trajectory master execution prompt (pure outcome prediction;
no odds/pricing objectives). Prior P5 ladder verdicts are preserved as history and
superseded for selection.

## 1. Architecture

Per game, per forecast state, the engine simulates **complete joint game trajectories**;
all seven markets are derived from the same trajectories (never from separate marginal
models), which enforces §11 coherence by construction.

### Scoring process
- Per-side inning-block Poisson means, from three fitted blocks per side:
  - `lam_h1`, `lam_a1` — inning 1 (starter-dominated)
  - `lam_h25`, `lam_a25` — per-inning rate for innings 2–5 (exposure 4)
  - `lam_h69`, `lam_a69` — per-inning rate for innings 6–scheduled (exposure `sched−5`)
- **Shared environment factor** `G ~ Gamma(k_disp, scale=1/k_disp)` drawn once per
  trajectory and applied multiplicatively to both sides' lambdas. This produces
  negative-binomial marginals (overdispersion) **and** positive home/away scoring
  dependence — the mechanism that makes totals variance and margin variance jointly
  realistic from one latent variable.
- Runs per block ~ `Poisson(lam_block × G)`; final = sum of blocks.
- Regulation ties resolved by extra innings: per side per extra inning
  `Poisson(extra_rate × G)` until decided, cap 25 (residual capped ties broken toward
  the larger innings-6+ lambda; observed rate ≤ 8e-6, counted and reported per game).
- 2020–21 doubleheader games are simulated natively at 7 scheduled innings.

### Mean-model fit (v2 — corrects the v1 defect)
- Estimator: `StandardScaler + PoissonRegressor` (lbfgs), trained on seasons
  2012..train_end per the frozen walk-forward contract.
- Regularization alpha selected **per block, per fold, on the calibration year's mean
  Poisson deviance** from the grid {1e-4, 1e-3, 1e-2, 1e-1}; a
  `HistGradientBoostingRegressor(loss="poisson")` candidate competed in the same
  screening. Result: standardized GLM at alpha=0.1 won 107/108 block-fold contests
  (glm_0.01 won 1); HGB never won. See `screening_v2_{A,B,C}.csv`.
- v1 defect (ledger event 31): unstandardized features with alpha=2.0 collapsed the GLM
  to intercept-only (per-game lambda std 0.001–0.04 → climatology-level probabilities).
  v2 lambda stds: 0.044–0.111.
- Dispersion: `k_disp = mu_bar² / max(var(total − mu_hat) − mu_bar, 0.5)`, floor 2.0,
  fit on **residuals around per-game predicted means** (v1 used raw totals variance,
  conflating between-game mean variance with overdispersion). Fitted k ≈ 7.6.
- Extras rate: league per-side per-inning rate (`mean_total/18`) × 2.0 ghost-runner
  factor for training windows ending ≥2019 (documented approximation; validated by
  tail coverage).

## 2. Forecast states

| State | Starter identity | Starter stats | Lineup | Classification |
|---|---|---|---|---|
| A | reconstructed (rotation rules, 49.8% hit) | strictly prior | last-20 slot-frequency pools | fully ex-ante |
| B | actual starter (identity only) | strictly prior (join on starter's own game row in the shift(1) as-of store) | as A | CONDITIONING_IDENTITY |
| C | as B | as B | actual starting nine (batting_order 100–900), slot-weighted `1/(1+0.15·(slot−1))`, strictly prior stats | CONDITIONING_IDENTITY |

No same-game statistic enters any state (ORACLE_ONLY is excluded everywhere).

## 3. Recalibration heads

Fit exclusively on **calibration-role** simulations (the fold's designated calibration
year), applied to score-role games:
- Binary markets: Platt scaling on the simulated log-odds (`C=1e3`), identity fallback
  when the calibration year has <300 rows.
- Totals: additive mean shift from calibration-year residuals.

## 4. The 400,000-trajectory contract

- Exactly 400,000 trajectories per game per state, in 80 batches of 5,000.
- Checkpoints at 25k/50k/100k/200k/400k retained per game.
- Integrity gates per game: trajectory count == 400,000; FG home+away == N; F5
  home+away+tie == N; all four histograms sum to N. 80,193/80,193 PASS.
- Retained aggregates per game: seven market probabilities, margin/total/F5 pmfs,
  moments, quantiles, MC standard error (~0.00079 at p=0.5), batch-hash chain and
  aggregate hash.

## 5. Results (State B, mean over 6 folds, vs strongest baseline)

| Market | v2 | Strongest baseline | Delta | Folds better | Cal slope | Verdict |
|---|---|---|---|---|---|---|
| fg_ml | 0.6799 | 0.6875 | +0.0076 | 6/6 | 0.993 | REINFORCE |
| fg_rl | 0.6399 | 0.6489 | +0.0090 | 6/6 | 1.076 | REINFORCE |
| fg_total (CRPS) | 2.4608 | 2.4896 | +0.0287 | 6/6 | — | REINFORCE |
| f5_ml | 0.6768 | 0.6885 | +0.0117 | 6/6 | 1.023 | REINFORCE |
| f5_rl | 0.6779 | 0.6857 | +0.0079 | 6/6 | 1.031 | REINFORCE |
| f5_total (CRPS) | 1.8169 | 1.8301 | +0.0132 | 5/6 | — | REINFORCE |
| nrfi | 0.6910 | 0.6931 | +0.0021 | 6/6 | 1.052 | REINFORCE |

Strongest baseline = min(walk-forward climatology, prior-run final model) per fold.
State ordering C ≤ B < A throughout — confirmed-identity conditioning adds real signal.
The calibration redesign target (slopes 0.54–0.56 → ~1.00) is met: 0.99–1.08.

Full per-fold evidence: `VERDICT-EVIDENCE-V2.csv`. Per-game outputs:
`SIM-DISTRIBUTIONS-{A,B,C}.parquet`. Manifest: `SIMULATION-MANIFEST.parquet`.
