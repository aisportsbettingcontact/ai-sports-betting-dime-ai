# Reproduction

All execution code is committed at [`tools/`](tools/). Commands below assume you are in
this directory (`docs/modeling/mlb-2021-2026/`) with `numpy`, `pandas`, `pyarrow`,
`scikit-learn`, and `scipy` available. The original run used Python 3.14 with seed 42
throughout; the reproduction check has since been confirmed on numpy 2.5.1 / pandas 3.0.5 /
scikit-learn 1.9.0 as well.

Frozen contract: [`WALK-FORWARD-CONFIG.yaml`](WALK-FORWARD-CONFIG.yaml). Warehouse cutoff
`loaded_at <= 2026-07-29T08:59:20Z`; scored 2026 season through 2026-07-27.

---

## Tier 1 — engine reproduction (no database)

Everything this needs is committed. Start here.

```bash
# spot-check: replay committed simulations and compare recorded hashes
python tools/verify_reproduction.py --games 90
# expected: BIT-IDENTICAL REPRODUCTION CONFIRMED, all checks N/N

# ledger chain integrity
cp ledger.jsonl tools/mlb-modeling-ledger.jsonl
python tools/ledger.py verify
# expected: ledger OK: 41 events, chain intact, head=c30a8a090c1d6c61
```

`ledger.py` resolves its ledger file as `mlb-modeling-ledger.jsonl` **next to the script
itself**, not relative to the working directory — hence the copy. That path is unchanged
from the run, so the script is committed exactly as it executed.

Regenerate the full sweep rather than spot-checking it (≈2.3 h across 8 shards per state;
run from a directory holding the committed `engine_params_v2_*.parquet`):

```bash
SIM_MODEL_VERSION=joint-nb-v2 \
SIM_PARAMS='engine_params_v2_{state}.parquet' \
SIM_OUTDIR=simulations_v2 \
python tools/sim_engine.py <A|B|C> <shard 0..7> 8
```

---

## Tier 2 — full pipeline (warehouse required)

Requires read access to the MLB StatsAPI warehouse at the frozen snapshot. The derived
feature matrix is not committed (large and database-derived), so these stages cannot run
from the repository alone.

```bash
# 1. extraction workflow E1-E4 (queries in query-registry.csv; season-looped; read-only runner)
#    -> features/*.tsv : spine, game_outcomes, plays_compact, pitcher/batter_game_pitch,
#       box_pitching, box_batting, people, hp_umpires, venues

# 2. point-in-time feature stores + expected-starter reconstruction (seed 42)
python tools/build_datasets.py

# 3. design matrix (49,269 x 261)
python tools/walkforward.py assemble

# 4. P5 discriminative ladder — superseded for selection, preserved as history
for M in fg_ml fg_rl fg_total f5_ml f5_rl f5_total nrfi; do
  python tools/walkforward.py run $M
done
python tools/make_verdicts.py <deliverables-dir>
python tools/oracle_diag.py          # ORACLE_ONLY starter-knowledge ceiling

# 5. forecast States B and C -> matrix_v2.parquet
python tools/build_states.py

# 6. screened mean models -> engine_params_v2_{state}.parquet + screening_v2_{state}.csv
for ST in A B C; do python tools/fit_engine_v2.py $ST; done

# 7. the 400k sweep (see Tier 1 for the command)

# 8. recalibration heads (calibration-role simulations only), metrics, coherence
SIM_OUTDIR=simulations_v2 SIM_PARAMS='engine_params_v2_{state}.parquet' \
  SCORE_SUFFIX=_v2 python tools/score_sims.py

# 9. final gate evaluation vs strongest baselines
python tools/make_verdicts_v2.py <deliverables-dir>
```

---

## Superseded v1 sweep

`joint-nb-v1` ran the identical contract with `tools/fit_engine.py` and no environment
overrides (`simulations/`, `engine_params_{state}.parquet`). Its mean model was
intercept-collapsed; it issued no verdicts and is retained only as history (ledger event
31). To reproduce the defect diagnosis itself, see
[`tools/analysis/09_diagnose_v1_mean_model_collapse.py`](tools/analysis/09_diagnose_v1_mean_model_collapse.py).

## Notes

- Per-game P5 predictions (`predictions/predictions_<market>.jsonl`, 93,650 rows) were run
  artifacts and are not committed; the baseline values recomputed from them are recorded in
  the erratum banner of [`MLB-MODELING-FINAL-REPORT.md`](MLB-MODELING-FINAL-REPORT.md) and
  in [`VERDICT-EVIDENCE-V2.csv`](VERDICT-EVIDENCE-V2.csv).
- `MODEL_VERSION` is part of every simulation seed payload. Changing it re-randomizes the
  entire sweep and invalidates `SIMULATION-MANIFEST.parquet`. See
  [`SEED-REPRODUCIBILITY-SPEC.md`](SEED-REPRODUCIBILITY-SPEC.md).
- Full code provenance, execution order, and the four-way recovery verification:
  [`tools/README.md`](tools/README.md).
