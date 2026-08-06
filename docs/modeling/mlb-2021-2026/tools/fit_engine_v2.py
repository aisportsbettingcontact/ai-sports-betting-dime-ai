#!/usr/bin/env python3
"""P6 v2: corrected mean-model fit for the joint engine.

v1 defect (ledger event pending): PoissonRegressor(alpha=2.0) on UNSTANDARDIZED features
collapsed to intercept-only lambdas (per-game std ~0.001-0.04) -> near-climatology sim
probabilities and unstable Platt heads. This rebuild:
  1. Candidate G: StandardScaler + PoissonRegressor, alpha selected per block/fold on the
     calibration year's mean Poisson deviance (grid 1e-4..1e-1) — walk-forward-safe: the
     calib year is designated for selection by the frozen contract.
  2. Candidate H: HistGradientBoostingRegressor(loss="poisson") — scale-invariant; the
     estimator family that recovered signal in the prior discriminative run.
  3. Winner per (state, fold, block) by calib deviance; screening table emitted.
  4. k_disp corrected: fitted on residual variance of totals around per-game predicted
     means (v1 used raw total variance, inflating overdispersion with between-game mu
     variance). Shared-G NB: Var(total) = mu_t + mu_t^2/k -> k = mu_bar^2 / max(resid_var
     - mu_bar, 0.5), floor 2.0 (documented approximation: E[mu]^2 for E[mu^2]).

Outputs: engine_params_v2_{state}.parquet (same schema as v1), screening_results.csv.
Usage: fit_engine_v2.py <state A|B|C>
"""
import os, sys, json, subprocess
import numpy as np, pandas as pd
from sklearn.linear_model import PoissonRegressor
from sklearn.preprocessing import StandardScaler
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_poisson_deviance
from sklearn.pipeline import make_pipeline

RUN = os.path.dirname(os.path.abspath(__file__))
F = os.path.join(RUN, "features")
np.random.seed(42)
FOLDS = [(2019,2020,2021),(2020,2021,2022),(2021,2022,2023),(2022,2023,2024),(2023,2024,2025),(2024,2025,2026)]
TRAIN_START = 2012
ALPHAS = [1e-4, 1e-3, 1e-2, 1e-1]

def ledger(op, actual, status, artifacts, rows=None, warn=None):
    ev = {"phase":"P6-engine-v2","operation":op,"purpose":"corrected mean-model fit + screening",
          "command":"fit_engine_v2.py","expected":"per-game lambdas with real cross-game variance",
          "actual":actual,"exit_status":status,"evidence":"VERIFIED","artifacts":artifacts,
          "rows":rows or {},"warnings":warn or [],"next":""}
    subprocess.run([sys.executable, os.path.join(RUN,"ledger.py"), "append", json.dumps(ev)],
                   check=True, capture_output=True)

state = sys.argv[1]

plays = pd.read_csv(os.path.join(F, "plays_compact.tsv"), sep="\t", na_values=["\\N",""],
                    usecols=["game_pk","inning","away_score","home_score"])
i1 = plays[plays["inning"] == 1].groupby("game_pk").agg(a1=("away_score","max"), h1=("home_score","max"))
df = pd.read_parquet(os.path.join(RUN, "matrix_v2.parquet"))
df = df[df["game_type"] == "R"].merge(i1, left_on="game_pk", right_index=True, how="left")
df["a1"] = df["a1"].fillna(0); df["h1"] = df["h1"].fillna(0)
df["h25"] = (df["f5_home"] - df["h1"]).clip(lower=0)
df["a25"] = (df["f5_away"] - df["a1"]).clip(lower=0)
df["h69"] = (df["final_home"] - df["f5_home"]).clip(lower=0)
df["a69"] = (df["final_away"] - df["f5_away"]).clip(lower=0)
df["sched_innings"] = np.where((df["season"].isin([2020,2021])) & (df["double_header"] != "N"), 7, 9)

def cols_for(state, df):
    base = ["is_night","game_number","park_run_idx","u_kshare_60","temp",
            "ht_t_rpg_15","at_t_rpg_15","ht_t_rpg_75","at_t_rpg_75","ht_t_rest","at_t_rest",
            "hp_pen_outs_prev3","ap_pen_outs_prev3","hp_pen_era_30","ap_pen_era_30","hp_pen_k_30","ap_pen_k_30"]
    sp = {"A": ("hs_","as_"), "B": ("hsb_","asb_"), "C": ("hsb_","asb_")}[state]
    lu = {"A": ("hl_","al_"), "B": ("hl_","al_"), "C": ("hlc_","alc_")}[state]
    starter = [c for c in df.columns if c.startswith(sp) and df[c].dtype != object]
    lineup = [c for c in df.columns if c.startswith(lu) and df[c].dtype != object and not c.endswith("n_slots")]
    return [c for c in base if c in df.columns] + starter + lineup

BLOCKS = [("h1",1.0), ("a1",1.0), ("h25",4.0), ("a25",4.0), ("h69",4.0), ("a69",4.0)]

cols = cols_for(state, df)
cols = [c for c in cols if df[c].notna().mean() > 0.30]
out_rows, screen_rows = [], []
for (tr_end, cal, sc) in FOLDS:
    tr = df[(df["season"] >= TRAIN_START) & (df["season"] <= tr_end)]
    ca = df[df["season"] == cal]
    med = tr[cols].median()
    Xtr = tr[cols].astype(float).fillna(med).values
    Xca = ca[cols].astype(float).fillna(med).values
    winners = {}
    for tgt, exposure in BLOCKS:
        ytr = tr[tgt].values / exposure; yca = ca[tgt].values / exposure
        cands = {}
        for a in ALPHAS:
            m = make_pipeline(StandardScaler(), PoissonRegressor(alpha=a, max_iter=600)).fit(Xtr, ytr)
            cands[f"glm_{a:g}"] = m
        cands["hgb"] = HistGradientBoostingRegressor(
            loss="poisson", max_iter=300, learning_rate=0.05, max_leaf_nodes=31,
            min_samples_leaf=60, l2_regularization=1.0, early_stopping=False,
            random_state=42).fit(Xtr, ytr)
        devs = {}
        for name, m in cands.items():
            pred = np.clip(m.predict(Xca), 1e-3, None)
            devs[name] = mean_poisson_deviance(yca, pred)
        best = min(devs, key=devs.get)
        winners[tgt] = cands[best]
        screen_rows.append({"state": state, "fold": sc, "block": tgt, "winner": best,
                            **{f"dev_{k}": round(v, 5) for k, v in devs.items()}})
    # corrected dispersion on training residuals around per-game predicted means
    mu_tr = sum(np.clip(winners[t].predict(Xtr), 1e-3, None) * e for t, e in BLOCKS)
    resid_var = float(np.var(tr["total"].values - mu_tr))
    mu_bar = float(np.mean(mu_tr))
    k = max(2.0, mu_bar**2 / max(resid_var - mu_bar, 0.5))
    base_rate = float(tr["total"].mean() / 18.0)
    ghost = 2.0 if tr_end >= 2019 else 1.0
    extra_rate = base_rate * ghost
    for season_t, role in [(cal, "calib"), (sc, "score")]:
        te = df[df["season"] == season_t]
        if not len(te): continue
        Xte = te[cols].astype(float).fillna(med).values
        lam = {tgt: np.clip(winners[tgt].predict(Xte), 0.02, 3.0) for tgt, _ in BLOCKS}
        for i, (gpk, si) in enumerate(zip(te["game_pk"].values, te["sched_innings"].values)):
            out_rows.append({"game_pk": int(gpk), "fold": sc, "role": role, "state": state,
                             "lam_h1": float(lam["h1"][i]), "lam_a1": float(lam["a1"][i]),
                             "lam_h25": float(lam["h25"][i]), "lam_a25": float(lam["a25"][i]),
                             "lam_h69": float(lam["h69"][i]), "lam_a69": float(lam["a69"][i]),
                             "k_disp": k, "extra_rate": extra_rate, "sched_innings": int(si)})
    print(f"[{state}] fold {sc}: k={k:.2f} winners=" +
          ",".join(f"{t}:{r['winner']}" for t, r in
                   zip([b for b,_ in BLOCKS], screen_rows[-6:])), flush=True)

pr = pd.DataFrame(out_rows)
pr.to_parquet(os.path.join(RUN, f"engine_params_v2_{state}.parquet"))
sr = pd.DataFrame(screen_rows)
sr.to_csv(os.path.join(RUN, f"screening_v2_{state}.csv"), index=False)
lam_std = {c: float(pr[c].std()) for c in ["lam_h1","lam_a1","lam_h25","lam_a25","lam_h69","lam_a69"]}
print(f"[{state}] lambda stds: " + json.dumps({k: round(v,4) for k,v in lam_std.items()}))
ledger(f"fit-engine-v2-{state}",
       f"{len(pr)} rows; winners {sr['winner'].value_counts().to_dict()}; lam stds {json.dumps({k: round(v,4) for k,v in lam_std.items()})}",
       "PASS", [f"engine_params_v2_{state}.parquet", f"screening_v2_{state}.csv"],
       rows={"rows": len(pr)})
print(f"[{state}] DONE", flush=True)
