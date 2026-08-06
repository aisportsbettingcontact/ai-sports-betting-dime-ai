# Execution Code — MLB 2021–2026 Warehouse-Constrained Modeling Program

Every script that produced the deliverables in this directory. These ran from a scratch
run directory during execution; that directory was ephemeral and has since been cleared,
so the code is committed here to make the reproduction path real rather than nominal.

**Provenance.** These files were recovered verbatim from the session execution record —
not paraphrased from the specs, and not rewritten from memory. Recovery was validated
four independent ways before commit; see [Verification](#verification) below.

---

## Execution order

The program ran in seven phases. Phases P0–P4 (the 2026 season audit, repair, and replay
backtest) used a separate toolchain committed at
[`docs/audits/mlb-model-audit-2026/tools/`](../../../audits/mlb-model-audit-2026/tools/).
The scripts here cover the warehouse-constrained modeling program (P5) and the
400,000-trajectory backtest (P6).

| # | Script | Phase | What it does |
|---|---|---|---|
| 1 | `ledger.py` | all | Append-only hash-chained execution ledger. `append '<json>'` / `verify`. Every operation below writes an event; the chain is the audit trail. |
| 2 | `build_datasets.py` | P5 | Expected-starter reconstruction (rotation rules), lineup pools, and all point-in-time as-of feature stores (pitcher, batter, team, bullpen, park, umpire) as shift(1) rolling windows. |
| 3 | `walkforward.py` | P5 | `assemble` builds `matrix.parquet` (49,269 × 261); `run <market>` executes the discriminative iteration ladder for one of the seven markets with isotonic calibration and date-clustered bootstrap CIs. |
| 4 | `make_verdicts.py` | P5 | Consolidates ladder results into the P5 verdict table. **Superseded** by `make_verdicts_v2.py`; retained because its verdicts are preserved as history. |
| 5 | `oracle_diag.py` | P5 | ORACLE_ONLY diagnostic — reruns the ladder with actual starters to measure the ceiling that perfect starter knowledge would buy. Never deployable; quantifies the reconstruction penalty. |
| 6 | `build_states.py` | P6 | Forecast States B and C: confirmed-starter and confirmed-lineup conditioning columns. Identity comes from the current game; every statistic is joined from the strictly-prior as-of stores. Emits `matrix_v2.parquet`. |
| 7 | `fit_engine.py` | P6 | Joint-engine mean-model fit, **v1**. Superseded — its `PoissonRegressor(alpha=2.0)` on unstandardized features collapsed to intercept-only. Retained as the record of the defect (ledger event 31). |
| 8 | `fit_engine_v2.py` | P6 | Corrected fit: standardized GLM with alpha screened per block/fold against a HistGradientBoosting-Poisson candidate on calibration-year deviance; dispersion refit on residuals around per-game means. Produces the committed `engine_params_v2_*.parquet`. |
| 9 | `sim_engine.py` | P6 | **The 400,000-trajectory contract.** Joint game simulation, deterministic per-batch seeding, checkpoints, per-game integrity gates, artifact emission. |
| 10 | `score_sims.py` | P6 | Recalibration heads fit on calibration-role simulations only, full metric suite, coherence tests. |
| 11 | `make_verdicts_v2.py` | P6 | §12 gate evaluation against the strongest available baseline per fold. Produces `MODEL-VERDICTS-V2.csv`. |
| 12 | `verify_reproduction.py` | — | Standing proof harness (added at commit time, not part of the original run). Replays committed simulations and checks their recorded hashes. |

`analysis/` holds the fourteen inline scripts that ran between these stages — source
patches, integrity verifications, diagnostics, and the deliverable builder. See
[`analysis/README.md`](analysis/README.md); the patches there are **already applied** to
the scripts above and must not be re-run.

---

## Reproducing

### Tier 1 — engine reproduction (no database required)

Everything needed is committed. This is the check to run first:

```bash
python tools/verify_reproduction.py --games 90
```

Expected: `BIT-IDENTICAL REPRODUCTION CONFIRMED`, with aggregate-hash, probability,
trajectory-count, and gate matches all N/N. Requires `numpy`, `pandas`, `pyarrow`.

To regenerate the full sweep rather than spot-check it (≈2.3 h on 8 shards):

```bash
SIM_MODEL_VERSION=joint-nb-v2 \
SIM_PARAMS='engine_params_v2_{state}.parquet' \
SIM_OUTDIR=simulations_v2 \
python tools/sim_engine.py <A|B|C> <shard 0..7> 8
```

Run it from a directory containing the committed `engine_params_v2_*.parquet`.

### Tier 2 — full pipeline (warehouse required)

Scoring, verdicts, and everything upstream of the engine need `matrix_v2.parquet`, which
carries the observed outcomes and the point-in-time features. That file is derived from
the MLB StatsAPI warehouse and is **not committed** — it is large and database-derived.
Rebuilding it requires warehouse access at the frozen snapshot
(`loaded_at <= 2026-07-29T08:59:20Z`) plus the extraction workflow described in
[`../REPRODUCTION-COMMANDS.md`](../REPRODUCTION-COMMANDS.md):

```bash
cp ../ledger.jsonl mlb-modeling-ledger.jsonl && python ledger.py verify   # chain check first
# extraction workflow E1-E4 -> features/*.tsv  (read-only DB runner)
python tools/build_datasets.py          # as-of stores + starter reconstruction
python tools/walkforward.py assemble    # matrix.parquet
python tools/build_states.py            # matrix_v2.parquet (States B/C)
for ST in A B C; do python tools/fit_engine_v2.py $ST; done
# ... 400k sweep (above) ...
SIM_OUTDIR=simulations_v2 SIM_PARAMS='engine_params_v2_{state}.parquet' \
  SCORE_SUFFIX=_v2 python tools/score_sims.py
python tools/make_verdicts_v2.py <deliverables-dir>
```

**This boundary is stated plainly rather than papered over:** the engine layer is proven
reproducible from the repository alone; the feature and scoring layers are committed
verbatim but cannot be re-executed without the warehouse.

---

## Verification

The recovery was validated four ways before this commit. All four passed.

| Check | Method | Result |
|---|---|---|
| Extraction fidelity | Recovered `WALK-FORWARD-CONFIG.yaml` byte-compared against the copy committed weeks earlier | **Identical** |
| Ledger integrity | Recovered `ledger.py verify` run against the committed 41-event `ledger.jsonl` | **`chain intact, head=c30a8a090c1d6c61`** — the exact hash recorded in `LEDGER-FINAL.md` |
| Engine equivalence | 90 committed game-state simulations replayed and compared to `SIMULATION-MANIFEST.parquet` | **90/90 aggregate hashes, 90/90 probabilities, max deviation 0.00e+00** |
| Structural | All 11 scripts parse clean; line counts match the recorded file states; all 5 source patches re-applied with their original assertions passing | **Pass** |

The aggregate-hash check is the strong one. `agg_hash` is a SHA-256 over the 80 per-batch
hashes of a game's trajectory stream, where each batch hash covers running counts of home
wins, first-five home leads, no-run-first-innings, and total runs scored by each side. It
cannot match unless all 400,000 trajectories were regenerated in exactly the same order
with exactly the same values. Ninety games matching across all three forecast states and
all six folds is not consistent with a paraphrase or a near-miss.

Evidence detail: [`reproduction_check.csv`](reproduction_check.csv).

Environment note: the verification ran on numpy 2.5.1 / pandas 3.0.5 / scikit-learn 1.9.0,
which are **not** the versions the original sweep used. The hashes match anyway, which
additionally demonstrates that the PCG64 streams and the Poisson/Gamma samplers used here
are stable across those version boundaries.

---

## Determinism contract

`sim_engine.py` seeds every batch independently:

```text
seed = uint64(SHA256("42|{model_version}|{state}|{game_pk}|{fold}|{batch_index}")[0:8])
```

Consequences that matter when modifying anything here:

- **Never change `MODEL_VERSION` in place.** It is inside every seed payload, so a
  version bump re-randomizes the entire sweep — which is exactly what made the v1→v2
  transition clean (no shared random stream between a defective candidate and its
  replacement), and exactly what would silently invalidate `SIMULATION-MANIFEST.parquet`
  if done casually.
- Shard count, execution order, and parallelism cannot affect results; there is no
  sequential RNG state between games or batches.
- Any single batch of any game can be regenerated in isolation for audit.

Full specification: [`../SEED-REPRODUCIBILITY-SPEC.md`](../SEED-REPRODUCIBILITY-SPEC.md).

---

## Secret hygiene

No script here contains credentials. Database access in the P0–P4 audit toolchain went
through a read-only runner that reads connection settings from the environment by
variable name. Scanned clean before commit.
