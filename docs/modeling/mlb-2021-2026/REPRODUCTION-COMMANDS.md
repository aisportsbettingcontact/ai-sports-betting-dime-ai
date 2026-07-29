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
