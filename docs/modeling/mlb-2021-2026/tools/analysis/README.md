# Inline Execution Scripts

The fourteen scripts that ran between the main pipeline stages, in chronological order,
recovered verbatim from the session execution record. They are committed because several
of them changed the pipeline's behaviour or produced committed deliverables — omitting
them would leave the record incomplete and the deliverables unexplained.

They are preserved **exactly as executed**, including their absolute scratch-directory
paths. To run any of them, replace the run-directory path with your own:

```bash
sed -i '' "s|/private/tmp/[^\"']*/mlb-modeling-2021-2026-run|$YOUR_RUN_DIR|g" <script>
```

| # | Script | What it did | Re-runnable? |
|---|---|---|---|
| 01 | `01_write_feature_catalog.py` | Wrote `POINT-IN-TIME-FEATURE-CATALOG.csv` — every feature family with its source, availability class (REPLAY_SAFE / PRIOR_RECONSTRUCTABLE / ORACLE_ONLY / UNAVAILABLE), and era gate | yes |
| 02 | `02_patch_na_readers.py` | **Source patch.** Taught `build_datasets.py` and `walkforward.py` to read the extraction TSVs' `\N` null encoding and coerce numerics — without it, `batting_order % 100` raised `TypeError` on string nulls | **no — already applied** |
| 03 | `03_patch_seven_inning_exclusion.py` | **Source patch.** Excluded 2020–21 doubleheader games (scheduled 7 innings) from `fg_total` and `fg_rl`; kept for F5/NRFI, where innings 1–5 are unaffected, and for `fg_ml`, where a win is a win | **no — already applied** |
| 04 | `04_patch_merge_asof_dtypes.py` | **Source patch.** Fixed `merge_asof` by-key dtype mismatch (float64 vs int64) in `attach_pitcher`; casts both sides and drops null ids | **no — already applied** |
| 05 | `05_patch_extras_rate_block.py` | **Source patch.** Replaced a placeholder extras-rate expression in `fit_engine.py` with the documented league-rate × ghost-runner-era approximation | **no — already applied** |
| 06 | `06_patch_calib_and_score_roles.py` | **Source patch.** Made `fit_engine.py` emit both calibration-role and score-role parameter rows per fold — the change that made recalibration heads fittable without touching score-year data | **no — already applied** |
| 07 | `07_consolidate_p5_results.py` | Consolidated the P5 ladder results into the season-metrics and calibration deliverables | yes (needs P5 result CSVs) |
| 08 | `08_verify_sim_integrity_v1.py` | Population integrity verification of the v1 sweep: gate counts, trajectory counts, unique game-folds, capped-tie rates, checkpoint drift. Wrote ledger event 29 | yes (needs v1 artifacts) |
| 09 | `09_diagnose_v1_mean_model_collapse.py` | **The diagnostic that found the v1 defect.** Measured simulated-probability spread and per-game lambda variance against prior-run baselines, exposing lambdas that were near-constant (`lam_h25` std 0.0014 at mean 0.517) — the mean model had collapsed to intercept-only | yes (needs v1 artifacts) |
| 10 | `10_engine_smoke_check_v2.py` | Pre-sweep gate on the corrected candidate: 2,500-game, 20k-trajectory sample checked for real discriminative signal before committing 2.3 hours of compute. State A beat climatology by 0.0074 log loss, State B by 0.0117 | yes (needs `matrix_v2.parquet`) |
| 11 | `11_verify_sim_integrity_v2.py` | Same integrity verification for the v2 sweep. 80,193/80,193 gates PASS. Wrote ledger event 36 | yes (needs v2 artifacts) |
| 12 | `12_trace_baseline_discrepancy.py` | Traced why the P5 report's headline metrics did not match its own per-fold result files | yes (needs P5 artifacts) |
| 13 | `13_reconcile_prior_run_baselines.py` | **The reconciliation that produced the erratum.** Recomputed pooled log loss directly from the P5 per-game prediction files for all five binary markets; those artifact-verified values became the v2 baselines (ledger event 39) | yes (needs P5 predictions) |
| 14 | `14_build_deliverables.py` | Built `SIMULATION-MANIFEST.parquet` (80,193 rows), the convergence-drift statistics, the three `SIM-DISTRIBUTIONS-*.parquet` files, and the experiment-registry update | yes (needs v2 artifacts) |
| 15 | `15_patch_calibrator_close.py` | **Source patch, audit phase (P5 replay).** Added the missing `close()` method to the `SafeConn` reconnect wrapper in `tools/replay/calibrate_and_grade.py` — the TiDB-serverless connection hardening. Chronologically this ran *before* 01 | **no — already applied** |
| 16 | `16_rebuild_experiment_registry.py` | Rebuilt `EXPERIMENT-REGISTRY.csv` from the P5 per-market `results_*.csv` files. Ran at P5 consolidation, alongside 07 | yes (needs P5 result CSVs) |

Scripts 15 and 16 were written with a shell heredoc that interpolated `$WT`, `$RUN`, and
`$D` at execution time; the transcript preserves the pre-interpolation text, so those
variables appear literally. Substitute your worktree, run, and deliverables directories.

## Why the patches are committed but not runnable

Scripts 02–06 mutated pipeline source in place. Their effects are baked into the
committed versions of `build_datasets.py`, `walkforward.py`, and `fit_engine.py`, and
each carries assertions that would fail on a second application. They are here as
provenance — they document *what changed and why* at the point in the run where it
changed, which the final source alone cannot show.

Their correct application was verified during recovery: replaying all five against the
pre-patch sources reproduced the final file states, with every original assertion passing.
