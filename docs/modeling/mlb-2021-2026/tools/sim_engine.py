#!/usr/bin/env python3
"""P6 §8: the 400,000-trajectory simulation contract.

Per game/state: exactly 400,000 complete game trajectories in 80 batches of 5,000.
Trajectory: shared environment factor G ~ Gamma(k, scale=1/k) per trajectory (overdispersion +
home/away dependence); inning runs ~ Poisson(lam_block * G) for inning 1, innings 2..5, and
innings 6..sched; ties after regulation resolved by extra innings at extra_rate*G per side
until decided (cap 25, residual ties decided by larger lambda — counted + reported).
Preserves per-trajectory: inning-1 runs (both halves), F5 score, final score.
Derives all seven market outputs from the same trajectories.

Seeding (§8.3): PCG64 seeded from SHA256("42|{model_version}|{state}|{game_pk}|{fold}|{batch}").
Checkpoints (§8.4) at 25k/50k/100k/200k/400k. Integrity gates (§8.5): counts sum to 400k,
batch hashes, normalization, F5/FG/NRFI reconciliation. Artifacts (§8.6): per-game JSON with
aggregates, checkpoints, hashes, MC-SE; market outputs parquet.

Usage: sim_engine.py <state A|B|C> <shard_idx> <n_shards>
"""
import os, sys, json, hashlib
import numpy as np, pandas as pd

RUN = os.path.dirname(os.path.abspath(__file__))
MODEL_VERSION = os.environ.get("SIM_MODEL_VERSION", "joint-nb-v1")
PARAMS_TMPL = os.environ.get("SIM_PARAMS", "engine_params_{state}.parquet")
SIM_OUTDIR = os.environ.get("SIM_OUTDIR", "simulations")
GLOBAL_SEED = "42"
N_TOTAL, BATCH, N_BATCHES = 400_000, 5_000, 80
CHECKPOINTS = {25_000, 50_000, 100_000, 200_000, 400_000}

def rng_for(state, game_pk, fold, batch):
    payload = f"{GLOBAL_SEED}|{MODEL_VERSION}|{state}|{game_pk}|{fold}|{batch}"
    h = hashlib.sha256(payload.encode()).digest()
    return np.random.Generator(np.random.PCG64(int.from_bytes(h[:8], "little")))

def simulate_game(row, state):
    gpk, fold = int(row.game_pk), int(row.fold)
    k, xr, si = row.k_disp, row.extra_rate, int(row.sched_innings)
    n25, n69 = 4, si - 5
    counts = {"home_win": 0, "away_win": 0, "f5_h": 0, "f5_a": 0, "f5_t": 0, "nrfi": 0, "cap_ties": 0}
    m_hist = np.zeros(61, dtype=np.int64)   # margin -30..30
    t_hist = np.zeros(41, dtype=np.int64)   # total 0..40
    f5m_hist = np.zeros(41, dtype=np.int64) # f5 margin -20..20
    f5t_hist = np.zeros(31, dtype=np.int64)
    sums = np.zeros(6)  # h_runs, a_runs, margin, total, f5t, f5m
    sq = np.zeros(4)    # margin^2, total^2, f5m^2, f5t^2
    batch_hashes = []
    checkpoints = {}
    done = 0
    for b in range(N_BATCHES):
        rng = rng_for(state, gpk, fold, b)
        G = rng.gamma(k, 1.0 / k, BATCH)
        h1 = rng.poisson(row.lam_h1 * G); a1 = rng.poisson(row.lam_a1 * G)
        h25 = rng.poisson(row.lam_h25 * G[:, None] * np.ones(n25)).sum(1) if n25 else 0
        a25 = rng.poisson(row.lam_a25 * G[:, None] * np.ones(n25)).sum(1) if n25 else 0
        h69 = rng.poisson(row.lam_h69 * G[:, None] * np.ones(n69)).sum(1) if n69 > 0 else np.zeros(BATCH, int)
        a69 = rng.poisson(row.lam_a69 * G[:, None] * np.ones(n69)).sum(1) if n69 > 0 else np.zeros(BATCH, int)
        H = h1 + h25 + h69; A = a1 + a25 + a69
        tie = H == A
        n_extra = 0
        while tie.any() and n_extra < 25:
            n_extra += 1
            he = rng.poisson(xr * G[tie]); ae = rng.poisson(xr * G[tie])
            H = H.copy(); A = A.copy()
            H[tie] += he; A[tie] += ae
            tie = H == A
        if tie.any():
            counts["cap_ties"] += int(tie.sum())
            edge = row.lam_h69 >= row.lam_a69
            H[tie] += 1 if edge else 0; A[tie] += 0 if edge else 1
        f5h = h1 + h25; f5a = a1 + a25
        counts["home_win"] += int((H > A).sum()); counts["away_win"] += int((A > H).sum())
        counts["f5_h"] += int((f5h > f5a).sum()); counts["f5_a"] += int((f5a > f5h).sum())
        counts["f5_t"] += int((f5h == f5a).sum())
        counts["nrfi"] += int(((h1 + a1) == 0).sum())
        m = np.clip(H - A, -30, 30) + 30; np.add.at(m_hist, m, 1)
        t = np.clip(H + A, 0, 40); np.add.at(t_hist, t, 1)
        fm = np.clip(f5h - f5a, -20, 20) + 20; np.add.at(f5m_hist, fm, 1)
        ft = np.clip(f5h + f5a, 0, 30); np.add.at(f5t_hist, ft, 1)
        sums += [H.sum(), A.sum(), (H - A).sum(), (H + A).sum(), (f5h + f5a).sum(), (f5h - f5a).sum()]
        sq += [((H - A) ** 2).sum(), ((H + A) ** 2).sum(), ((f5h - f5a) ** 2).sum(), ((f5h + f5a) ** 2).sum()]
        bh = hashlib.sha256(np.array([counts["home_win"], counts["f5_h"], counts["nrfi"], H.sum(), A.sum()]).tobytes()).hexdigest()[:12]
        batch_hashes.append(bh)
        done += BATCH
        if done in CHECKPOINTS:
            checkpoints[done] = {"p_home": counts["home_win"] / done, "p_f5h": counts["f5_h"] / done,
                                 "p_f5t": counts["f5_t"] / done, "p_nrfi": counts["nrfi"] / done,
                                 "mean_total": sums[3] / done, "mean_margin": sums[2] / done,
                                 "mean_f5t": sums[4] / done}
    # integrity gates
    N = done
    assert N == N_TOTAL, f"trajectory count {N}"
    assert counts["home_win"] + counts["away_win"] == N, "FG reconcile"
    assert counts["f5_h"] + counts["f5_a"] + counts["f5_t"] == N, "F5 reconcile"
    assert m_hist.sum() == N and t_hist.sum() == N and f5m_hist.sum() == N and f5t_hist.sum() == N
    p_home = counts["home_win"] / N
    mc_se = float(np.sqrt(p_home * (1 - p_home) / N))
    def q(hist, offset, probs=(0.05, 0.5, 0.95)):
        c = np.cumsum(hist) / N
        return [int(np.searchsorted(c, p) - offset) for p in probs]
    art = {"game_pk": gpk, "fold": fold, "state": state, "model_version": MODEL_VERSION,
           "n_trajectories": N, "batches": N_BATCHES, "batch_size": BATCH,
           "generator": "numpy PCG64", "seed_scheme": "sha256(42|mv|state|game|fold|batch)[:8]",
           "counts": counts, "checkpoints": checkpoints,
           "p_home": p_home, "p_away": counts["away_win"] / N,
           "p_f5_home": counts["f5_h"] / N, "p_f5_away": counts["f5_a"] / N, "p_f5_tie": counts["f5_t"] / N,
           "p_nrfi": counts["nrfi"] / N,
           "mean_home": sums[0] / N, "mean_away": sums[1] / N,
           "mean_margin": sums[2] / N, "var_margin": sq[0] / N - (sums[2] / N) ** 2,
           "mean_total": sums[3] / N, "var_total": sq[1] / N - (sums[3] / N) ** 2,
           "mean_f5_total": sums[4] / N, "var_f5_total": sq[3] / N - (sums[4] / N) ** 2,
           "q_margin": q(m_hist, 30), "q_total": q(t_hist, 0), "q_f5_total": q(f5t_hist, 0),
           "p_home_rl_cover": float(m_hist[32:].sum() / N),        # margin >= 2
           "p_f5_home_rl_cover": float(f5m_hist[21:].sum() / N),   # f5 margin >= 1
           "total_pmf": (t_hist / N).round(6).tolist(),
           "f5_total_pmf": (f5t_hist / N).round(6).tolist(),
           "margin_pmf": (m_hist / N).round(6).tolist(),
           "mc_se_phome": mc_se, "cap_tie_rate": counts["cap_ties"] / N,
           "agg_hash": hashlib.sha256(("".join(batch_hashes)).encode()).hexdigest()[:16],
           "gates": "PASS"}
    return art

if __name__ == "__main__":
    state, shard, n_shards = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
    params = pd.read_parquet(os.path.join(RUN, PARAMS_TMPL.format(state=state)))
    params = params.iloc[shard::n_shards]
    outdir = os.path.join(RUN, SIM_OUTDIR, state); os.makedirs(outdir, exist_ok=True)
    outputs = []
    fname = os.path.join(outdir, f"sim_artifacts_shard{shard}.jsonl")
    with open(fname, "w") as f:
        for i, row in enumerate(params.itertuples()):
            art = simulate_game(row, state)
            f.write(json.dumps(art) + "\n")
            outputs.append({k: art[k] for k in ["game_pk","fold","state","p_home","p_away","p_f5_home",
                            "p_f5_away","p_f5_tie","p_nrfi","mean_total","var_total","mean_f5_total",
                            "mean_margin","p_home_rl_cover","p_f5_home_rl_cover","mc_se_phome","agg_hash"]}
                           | {"total_pmf": art["total_pmf"], "f5_total_pmf": art["f5_total_pmf"]})
            if (i + 1) % 200 == 0:
                print(f"[{state}/s{shard}] {i+1}/{len(params)}", flush=True)
    pd.DataFrame(outputs).to_parquet(os.path.join(outdir, f"market_outputs_shard{shard}.parquet"))
    print(f"[{state}/s{shard}] DONE {len(params)} games -> {fname}", flush=True)
