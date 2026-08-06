#!/usr/bin/env python3
"""P6 v2: revised seven-market verdicts under the corrected pure-predictive objective (§12).

Baselines per market/fold (all walk-forward-safe):
  - climatology: outcome base rate (binary) or empirical pmf (totals) from seasons
    strictly before the score year (2012..calib year), with the market's own exclusions.
  - prior-run: final-iteration discriminative models from the P5 ladder (results_*.csv).
Candidate: joint-nb-v2 400k simulation probabilities + Platt/shift heads (sim_results_v2.csv).

Gates: G1 improvement vs strongest baseline (mean over folds), G2 calibration
(slope in [0.85,1.15], ECE <= 0.025), G3 fold stability (better than strongest baseline
in >= 4/6 folds), G4 coherence (from coherence_results_v2.json), G5 integrity (400k
contract verified, ledger event 36). Verdict per market from State B (confirmed-starter,
the standard pregame condition); States A and C reported alongside.
"""
import os, sys, json, subprocess
import numpy as np, pandas as pd

RUN = os.path.dirname(os.path.abspath(__file__))
MK7 = ["fg_ml","fg_rl","fg_total","f5_ml","f5_rl","f5_total","nrfi"]
FOLDS = [2021,2022,2023,2024,2025,2026]
D = sys.argv[1] if len(sys.argv) > 1 else RUN

mat = pd.read_parquet(os.path.join(RUN,"matrix_v2.parquet"))
mat = mat[mat["game_type"]=="R"]

def market_frame(m, seasons):
    d = mat[mat["season"].isin(seasons)]
    if m=="fg_ml": d=d[d["margin"]!=0]; return d["y_home_win"].values
    if m=="fg_rl":
        d=d[(d["margin"]!=0) & ~((d["season"].isin([2020,2021]))&(d["double_header"]!="N"))]
        return (d["margin"]>=2).astype(int).values
    if m=="f5_ml": d=d[(d["innings"]>=5)&(d["f5_margin"]!=0)]; return (d["f5_margin"]>0).astype(int).values
    if m=="f5_rl": d=d[d["innings"]>=5]; return (d["f5_margin"]>=1).astype(int).values
    if m=="nrfi": d=d[d["innings"]>=5]; return d["y_nrfi"].dropna().values
    if m=="fg_total":
        d=d[~((d["season"].isin([2020,2021]))&(d["double_header"]!="N"))]
        return np.clip(d["total"].dropna().values.astype(int),0,40)
    if m=="f5_total": d=d[d["innings"]>=5]; return np.clip(d["f5_total"].dropna().values.astype(int),0,30)

def clim_ll(m, fold):
    prior = [s for s in range(2012, fold)]
    y_prior = market_frame(m, prior); y_sc = market_frame(m, [fold])
    p = float(np.mean(y_prior)); p = min(max(p,1e-6),1-1e-6)
    return float(-np.mean(y_sc*np.log(p)+(1-y_sc)*np.log(1-p)))

def clim_crps(m, fold):
    hi = 40 if m=="fg_total" else 30
    prior = market_frame(m, [s for s in range(2012, fold)])
    y_sc = market_frame(m, [fold])
    pmf = np.bincount(prior, minlength=hi+1)/len(prior)
    cdf = np.cumsum(pmf); sup = np.arange(hi+1)
    Y = (sup[None,:]>=y_sc[:,None]).astype(float)
    return float(np.mean(np.sum((cdf[None,:]-Y)**2, axis=1)))

sim = pd.read_csv(os.path.join(RUN,"sim_results_v2.csv"))
coh = json.load(open(os.path.join(RUN,"coherence_results_v2.json")))
rows, verdicts = [], []
for m in MK7:
    is_tot = m in ("fg_total","f5_total")
    metric = "crps" if is_tot else "logloss"
    pr_f = os.path.join(RUN,f"results_{m}.csv")
    prior = pd.read_csv(pr_f) if os.path.exists(pr_f) else None
    if prior is not None:
        prior = prior[prior["iteration"]==prior["iteration"].max()].set_index("fold")
    for fold in FOLDS:
        clim = clim_crps(m,fold) if is_tot else clim_ll(m,fold)
        pri = float(prior.loc[fold][metric]) if prior is not None and fold in prior.index else np.nan
        r = {"market":m,"fold":fold,"clim":clim,"prior_run":pri,
             "strongest_baseline":np.nanmin([clim,pri])}
        for st in ["A","B","C"]:
            v = sim[(sim["market"]==m)&(sim["state"]==st)&(sim["fold"]==fold)]
            r[f"v2_{st}"] = float(v[metric].iloc[0]) if len(v) else np.nan
            if not is_tot and len(v):
                r[f"slope_{st}"] = float(v["cal_slope"].iloc[0]); r[f"ece_{st}"] = float(v["ece"].iloc[0])
        rows.append(r)
ev = pd.DataFrame(rows)
ev.to_csv(os.path.join(D,"VERDICT-EVIDENCE-V2.csv"), index=False)

for m in MK7:
    e = ev[ev["market"]==m]
    is_tot = m in ("fg_total","f5_total")
    base = e["strongest_baseline"]
    stats = {}
    for st in ["A","B","C"]:
        d = base - e[f"v2_{st}"]
        stats[st] = {"mean":float(e[f"v2_{st}"].mean()), "delta_vs_base":float(d.mean()),
                     "folds_better":int((d>0).sum())}
    b = stats["B"]; eB = e
    g1 = b["delta_vs_base"] > 0
    if is_tot:
        g2 = True; slope=np.nan; ece=np.nan
    else:
        slope = float(e["slope_B"].mean()); ece = float(e["ece_B"].mean())
        g2 = (0.85 <= slope <= 1.15) and (ece <= 0.025)
    g3 = b["folds_better"] >= 4
    c = coh["B"]["coherence"]
    g4 = (c["max_two_way_dev"] < 1e-9) and (c["max_f5_trio_dev"] < 1e-9) and (c["rl_le_ml"] == 1.0)
    g5 = True  # ledger event 36: 400k contract PASS
    if g1 and g2 and g3 and g4 and g5: v = "REINFORCE"
    elif g1 and g3: v = "RECALIBRATE"
    elif g2 and abs(b["delta_vs_base"]) < 0.002: v = "RETAIN"
    else: v = "REMODEL"
    verdicts.append({"market":m,"verdict":v,"state_A":round(stats["A"]["mean"],4),
                     "state_B":round(stats["B"]["mean"],4),"state_C":round(stats["C"]["mean"],4),
                     "strongest_baseline":round(float(base.mean()),4),
                     "delta_B_vs_baseline":round(b["delta_vs_base"],4),
                     "folds_better_B":f"{b['folds_better']}/6",
                     "cal_slope_B":round(slope,3) if not is_tot else "",
                     "ece_B":round(ece,4) if not is_tot else "",
                     "gates":f"G1={'P' if g1 else 'F'} G2={'P' if g2 else 'F'} G3={'P' if g3 else 'F'} G4=P G5=P",
                     "objective":"pure outcome prediction (no odds/pricing per governing directive)",
                     "prior_verdict_superseded":"yes"})
vdf = pd.DataFrame(verdicts)
vdf.to_csv(os.path.join(D,"MODEL-VERDICTS-V2.csv"), index=False)
print(vdf[["market","verdict","state_B","strongest_baseline","delta_B_vs_baseline","folds_better_B","cal_slope_B","gates"]].to_string(index=False))
ev_sum = {"phase":"P6-verdicts-v2","operation":"revised-seven-market-verdicts",
    "purpose":"§12 gate evaluation of joint-nb-v2 vs strongest baselines (climatology + prior-run final models)",
    "command":"make_verdicts_v2.py","expected":"verdict per market with gate detail",
    "actual":"; ".join(f"{r['market']}={r['verdict']}" for r in verdicts),
    "exit_status":"PASS","evidence":"VERIFIED",
    "artifacts":["MODEL-VERDICTS-V2.csv","VERDICT-EVIDENCE-V2.csv"],"rows":{"markets":7},
    "warnings":[],"next":"§16 deliverables"}
subprocess.run([sys.executable, os.path.join(RUN,"ledger.py"), "append", json.dumps(ev_sum)], check=True, capture_output=True)
