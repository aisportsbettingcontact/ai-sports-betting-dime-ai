# Seed & Reproducibility Specification — 400k Simulation Contract

## Seeding scheme (§8.3 of the governing directive)

Every batch of every game/state simulation is seeded deterministically and
independently:

```
payload   = "{global_seed}|{model_version}|{state}|{game_pk}|{fold}|{batch_index}"
          = "42|joint-nb-v2|B|718253|2024|37"          (example)
seed      = little-endian uint64 of SHA256(payload)[0:8]
generator = numpy.random.Generator(numpy.random.PCG64(seed))
```

- `global_seed` = `"42"` (frozen contract).
- `model_version` = `"joint-nb-v2"` for the final candidate. The superseded v1 sweep
  used `"joint-nb-v1"`; because the version string is inside the seed payload, the two
  sweeps share **no** random stream.
- `batch_index` ∈ 0..79; 80 batches × 5,000 = 400,000 trajectories.

Consequences:
- Any single batch of any game is reproducible in isolation (no sequential state).
- Shard layout, execution order, and parallelism cannot affect results.
- Per-game batch hashes (SHA256 chain over running counts) and the aggregate hash in
  each artifact allow third-party verification without re-running neighbors.

## Verification chain

1. Per-batch: hash of (home_win, f5_h, nrfi, ΣH, ΣA) running counts → 80 hashes/game.
2. Per-game: `agg_hash` = SHA256 over the concatenated batch hashes; stored in the
   artifact and in `SIMULATION-MANIFEST.parquet`.
3. Per-sweep: ledger events 35–36 (launch/completion) record population counts;
   `ledger.py verify` recomputes the event hash chain.

## Reproduction

```
# environment: python 3.14, numpy/pandas/scikit-learn/pyarrow (see REPRODUCTION-COMMANDS.md)
SIM_MODEL_VERSION=joint-nb-v2 \
SIM_PARAMS='engine_params_v2_{state}.parquet' \
SIM_OUTDIR=simulations_v2 \
python sim_engine.py <A|B|C> <shard 0..7> 8
```

Upstream determinism: feature extraction and matrix assembly are deterministic given
the frozen warehouse snapshot (max_loaded_at 2026-07-29T08:59:20Z); model fits use
`random_state=42` / deterministic lbfgs; recalibration heads are deterministic given
fold assignments from the frozen `WALK-FORWARD-CONFIG.yaml`.

## Non-reproducible elements

None in the scoring path. Wall-clock metadata (log timestamps) and shard-to-file
assignment are execution details that do not influence any stored statistic.
