#!/usr/bin/env python3
"""Standing proof that the committed engine reproduces the committed simulation results.

Replays a sample of the 80,193 committed game-state simulations using the committed
`sim_engine.py` and the committed `engine_params_v2_{state}.parquet`, then compares each
replay against the values recorded in `SIMULATION-MANIFEST.parquet` at sweep time:

  * `agg_hash` — SHA-256 over the 80 per-batch hashes of the game's trajectory stream.
    A match means all 400,000 trajectories were regenerated identically, not merely that
    the summary probability landed in the same place.
  * `p_home` — compared at the 6-decimal precision the manifest stores.
  * trajectory count and per-game integrity gates.

This requires no database and no feature store: engine parameters and the manifest are
both committed. It is the check to run first when auditing this work, and after any
change to `sim_engine.py` (which must never change without a new `MODEL_VERSION`,
because the version string is part of every seed payload).

Usage:
    python tools/verify_reproduction.py [--games N] [--deliverables DIR] [--out CSV]

Exit status is 0 only if every replayed game matches on every check.
"""
import argparse, importlib.util, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DL = os.path.dirname(HERE)


def load_engine(tools_dir):
    """Import the committed sim_engine with the v2 model version pinned."""
    os.environ.setdefault("SIM_MODEL_VERSION", "joint-nb-v2")
    path = os.path.join(tools_dir, "sim_engine.py")
    spec = importlib.util.spec_from_file_location("sim_engine", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    if mod.MODEL_VERSION != "joint-nb-v2":
        sys.exit(f"FATAL: engine MODEL_VERSION is {mod.MODEL_VERSION!r}, expected 'joint-nb-v2'. "
                 "The version string seeds every batch; a mismatch cannot reproduce.")
    if (mod.N_TOTAL, mod.BATCH, mod.N_BATCHES) != (400_000, 5_000, 80):
        sys.exit(f"FATAL: contract altered — N_TOTAL={mod.N_TOTAL} BATCH={mod.BATCH} "
                 f"N_BATCHES={mod.N_BATCHES}; expected 400000/5000/80.")
    return mod


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--games", type=int, default=36,
                    help="games to replay, spread over 3 states x 6 folds (default 36)")
    ap.add_argument("--deliverables", default=DEFAULT_DL,
                    help="directory holding SIMULATION-MANIFEST.parquet and engine_params_v2_*.parquet")
    ap.add_argument("--out", default=os.path.join(HERE, "reproduction_check.csv"))
    ap.add_argument("--seed", type=int, default=1234, help="sampling seed (not a simulation seed)")
    args = ap.parse_args()

    engine = load_engine(HERE)
    print(f"engine: MODEL_VERSION={engine.MODEL_VERSION} "
          f"contract={engine.N_BATCHES}x{engine.BATCH}={engine.N_TOTAL}")

    man_path = os.path.join(args.deliverables, "SIMULATION-MANIFEST.parquet")
    manifest = pd.read_parquet(man_path)
    print(f"manifest: {len(manifest):,} game-state rows, states {sorted(manifest.state.unique())}")

    per_cell = max(1, args.games // 18)
    rows = []
    for state in ["A", "B", "C"]:
        params = pd.read_parquet(
            os.path.join(args.deliverables, f"engine_params_v2_{state}.parquet"))
        recorded = manifest[manifest.state == state].set_index(["game_pk", "fold"])
        for fold in sorted(params.fold.unique()):
            pool = params[params.fold == fold]
            if pool.empty:
                continue
            sample = pool.sample(min(per_cell, len(pool)), random_state=args.seed + int(fold))
            for row in sample.itertuples():
                art = engine.simulate_game(row, state)
                key = (int(row.game_pk), int(row.fold))
                if key not in recorded.index:
                    print(f"  WARN: {state}/{key} absent from manifest; skipped")
                    continue
                exp = recorded.loc[key]
                if isinstance(exp, pd.DataFrame):
                    exp = exp.iloc[0]
                rows.append({
                    "state": state,
                    "fold": int(fold),
                    "game_pk": int(row.game_pk),
                    "hash_recovered": art["agg_hash"],
                    "hash_committed": exp["agg_hash"],
                    "hash_match": art["agg_hash"] == exp["agg_hash"],
                    "p_home_recovered": round(art["p_home"], 6),
                    "p_home_committed": round(float(exp["p_home"]), 6),
                    "p_home_match_6dp": round(art["p_home"], 6) == round(float(exp["p_home"]), 6),
                    "n_traj": art["n_trajectories"],
                    "gates": art["gates"],
                })

    if not rows:
        sys.exit("FATAL: no games replayed — check --deliverables path.")

    df = pd.DataFrame(rows)
    df.to_csv(args.out, index=False)

    n = len(df)
    hash_ok = int(df.hash_match.sum())
    prob_ok = int(df.p_home_match_6dp.sum())
    traj_ok = int((df.n_traj == engine.N_TOTAL).sum())
    gate_ok = int((df.gates == "PASS").sum())

    print(f"\nreplayed {n} games across {df.state.nunique()} states x {df.fold.nunique()} folds")
    print(f"  aggregate-hash matches : {hash_ok}/{n}")
    print(f"  p_home matches (6 dp)  : {prob_ok}/{n}")
    print(f"  trajectory count 400k  : {traj_ok}/{n}")
    print(f"  per-game gates PASS    : {gate_ok}/{n}")
    print(f"  max |p_home| deviation : "
          f"{(df.p_home_recovered - df.p_home_committed).abs().max():.2e}")
    print(f"  detail written to      : {args.out}")

    if hash_ok == prob_ok == traj_ok == gate_ok == n:
        print("\nRESULT: BIT-IDENTICAL REPRODUCTION CONFIRMED")
        return 0
    print("\nRESULT: MISMATCH — the committed engine no longer reproduces the recorded sweep")
    return 1


if __name__ == "__main__":
    sys.exit(main())
