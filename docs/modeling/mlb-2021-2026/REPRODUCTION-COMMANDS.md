# Reproduction

Run dir: scratchpad/mlb-modeling-2021-2026-run (ledger + registries + engines + artifacts).
1. `python3 ledger.py verify` — chain check.
2. Extraction: workflow E1-E4 (queries in query-registry.csv; season-looped; read-only runner).
3. `python build_datasets.py` — matchups + as-of features (seed 42).
4. `python walkforward.py assemble && for M in fg_ml fg_rl fg_total f5_ml f5_rl f5_total nrfi; do python walkforward.py run $M; done`
5. `python make_verdicts.py <deliverables-dir>`; `python oracle_diag.py`.
Frozen contract: WALK-FORWARD-CONFIG.yaml. DB cutoff: loaded_at <= 2026-07-29T08:59:20Z,
scored 2026 <= 2026-07-27. Per-game predictions: predictions/predictions_<market>.jsonl
(93,650 rows). Venv: numpy/scipy/pandas/scikit-learn, Python 3.14, seeds 42.

# Reproduction — 400k contract (joint-nb-v2 addendum)

6. `python build_states.py` — State B/C conditioning columns (matrix_v2.parquet).
7. `for ST in A B C; do python fit_engine_v2.py $ST; done` — screened mean models
   (glm alpha grid + HGB-Poisson candidate, winner by calib-year Poisson deviance),
   corrected k_disp; emits engine_params_v2_{state}.parquet + screening_v2_{state}.csv.
8. Full sweep (3 states x 8 shards, ~2.3h):
   `SIM_MODEL_VERSION=joint-nb-v2 SIM_PARAMS='engine_params_v2_{state}.parquet' \
    SIM_OUTDIR=simulations_v2 python sim_engine.py <A|B|C> <0..7> 8`
9. `SIM_OUTDIR=simulations_v2 SIM_PARAMS='engine_params_v2_{state}.parquet' \
    SCORE_SUFFIX=_v2 python score_sims.py` — Platt/shift heads (calib-role only),
    metrics, coherence.
10. `python make_verdicts_v2.py <deliverables-dir>` — §12 gates vs strongest baselines.
Superseded v1 sweep (joint-nb-v1, intercept-collapsed mean model, no verdicts issued):
same commands without the env overrides; preserved in simulations/ for history.
