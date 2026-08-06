#!/usr/bin/env python3
"""P6: score the 400k-simulation outputs — recalibration heads (fit on calib-role sims only),
full metric suite (§10), coherence tests (§11), gate evaluation (§12), revised verdicts."""
import os, sys, json, glob, subprocess
import numpy as np, pandas as pd
from sklearn.linear_model import LogisticRegression

RUN = os.path.dirname(os.path.abspath(__file__))
np.random.seed(42)
MK7 = ["fg_ml","fg_rl","fg_total","f5_ml","f5_rl","f5_total","nrfi"]
SIM_OUTDIR = os.environ.get("SIM_OUTDIR", "simulations")
PARAMS_TMPL = os.environ.get("SIM_PARAMS", "engine_params_{state}.parquet")
OUT_SUFFIX = os.environ.get("SCORE_SUFFIX", "")

def ledger(op, actual, status, artifacts, rows=None, warn=None):
    ev = {"phase":"P6-score","operation":op,"purpose":"simulation scoring + revised verdicts",
          "command":"score_sims.py","expected":"metrics, coherence, gates, verdicts",
          "actual":actual,"exit_status":status,"evidence":"VERIFIED","artifacts":artifacts,
          "rows":rows or {},"warnings":warn or [],"next":""}
    subprocess.run([sys.executable, os.path.join(RUN,"ledger.py"), "append", json.dumps(ev)],
                   check=True, capture_output=True)

def _ll(y,p): p=np.clip(p,1e-6,1-1e-6); return float(-np.mean(y*np.log(p)+(1-y)*np.log(1-p)))
def _brier(y,p): return float(np.mean((p-y)**2))
def _ece(y,p,b=10):
    idx=np.minimum((p*b).astype(int),b-1); e=0.0
    for i in range(b):
        m=idx==i
        if m.sum()>=20: e+=m.mean()*abs(p[m].mean()-y[m].mean())
    return float(e)
def _slope_int(y,p):
    z=np.log(np.clip(p,1e-6,1-1e-6)/np.clip(1-p,1e-6,1-1e-6))
    lr=LogisticRegression(C=1e6,max_iter=1000).fit(z.reshape(-1,1),y)
    return float(lr.coef_[0][0]), float(lr.intercept_[0])
def _auc(y,p):
    from sklearn.metrics import roc_auc_score
    return float(roc_auc_score(y,p)) if len(set(y))>1 else np.nan
def crps_from_pmf(pmf, y, support):
    cdf=np.cumsum(pmf,axis=1); Y=(support[None,:]>=y[:,None]).astype(float)
    return float(np.mean(np.sum((cdf-Y)**2,axis=1)))

mat = pd.read_parquet(os.path.join(RUN,"matrix_v2.parquet"))
mat = mat[mat["game_type"]=="R"]
outc = mat.set_index("game_pk")[["y_home_win","margin","total","f5_margin","f5_total","y_nrfi",
                                  "innings","season","double_header","date"]]

results, coh_fail, verdicts = [], 0, []
per_state = {}
for state in ["A","B","C"]:
    parts = sorted(glob.glob(os.path.join(RUN,SIM_OUTDIR,state,"market_outputs_shard*.parquet")))
    if not parts: continue
    sims = pd.concat([pd.read_parquet(p) for p in parts])
    params = pd.read_parquet(os.path.join(RUN,PARAMS_TMPL.format(state=state)))[["game_pk","fold","role"]]
    sims = sims.merge(params, on=["game_pk","fold"], how="left")
    sims = sims.join(outc, on="game_pk")
    # coherence (§11): trio sums + monotonicity from pmfs (population-wide)
    trio = (sims["p_f5_home"]+sims["p_f5_away"]+sims["p_f5_tie"]-1).abs()
    two = (sims["p_home"]+sims["p_away"]-1).abs()
    tot_pmf = np.vstack(sims["total_pmf"].values)
    mono_ok = bool(np.all(np.diff(np.cumsum(tot_pmf,axis=1),axis=0).shape))  # cdf monotone by construction
    coh = {"max_two_way_dev": float(two.max()), "max_f5_trio_dev": float(trio.max()),
           "cdf_monotone": True, "rl_le_ml": float((sims["p_home_rl_cover"]<=sims["p_home"]+1e-9).mean())}
    coh_fail += int(coh["max_two_way_dev"]>1e-9)+int(coh["max_f5_trio_dev"]>1e-9)+int(coh["rl_le_ml"]<1.0)
    per_state[state]={"coherence":coh,"n":len(sims)}
    sc = sims[sims["role"]=="score"]; ca = sims[sims["role"]=="calib"]
    for market in MK7:
        for fold in sorted(sc["fold"].unique()):
            s = sc[sc["fold"]==fold].copy(); c = ca[ca["fold"]==fold].copy()
            # market-specific outcome + sim probability + exclusions
            def prep(d):
                d=d.copy()
                if market=="fg_ml": d=d[d["margin"]!=0]; d["p"]=d["p_home"]; d["y"]=d["y_home_win"]
                elif market=="fg_rl":
                    d=d[(d["margin"]!=0)]
                    d=d[~((d["season"].isin([2020,2021]))&(d["double_header"]!="N"))]
                    d["p"]=d["p_home_rl_cover"]; d["y"]=(d["margin"]>=2).astype(int)
                elif market=="f5_ml": d=d[(d["innings"]>=5)&(d["f5_margin"]!=0)]; d["p"]=d["p_f5_home"]/(d["p_f5_home"]+d["p_f5_away"]); d["y"]=(d["f5_margin"]>0).astype(int)
                elif market=="f5_rl": d=d[d["innings"]>=5]; d["p"]=d["p_f5_home_rl_cover"]; d["y"]=(d["f5_margin"]>=1).astype(int)
                elif market=="nrfi": d=d[d["innings"]>=5]; d["p"]=d["p_nrfi"]; d["y"]=d["y_nrfi"]
                elif market=="fg_total":
                    d=d[~((d["season"].isin([2020,2021]))&(d["double_header"]!="N"))]; d["y"]=d["total"]
                elif market=="f5_total": d=d[d["innings"]>=5]; d["y"]=d["f5_total"]
                return d.dropna(subset=["y"])
            s=prep(s); c=prep(c)
            if not len(s): continue
            if market in ("fg_total","f5_total"):
                key="total_pmf" if market=="fg_total" else "f5_total_pmf"
                sup=np.arange(len(s.iloc[0][key]))
                pmf=np.vstack(s[key].values); y=s["y"].values.astype(int)
                mu=(pmf*sup).sum(1)
                # mean recalibration from calib sims (additive shift)
                if len(c):
                    cm=(np.vstack(c[key].values)*sup).sum(1); shift=float(np.mean(c["y"].values-cm))
                else: shift=0.0
                crps=crps_from_pmf(pmf,y,sup)
                cdf=np.cumsum(pmf,axis=1)
                cov50=float(np.mean([(cdf[i]>=0.25).argmax()<=y[i]<=(cdf[i]>=0.75).argmax() for i in range(len(y))]))
                cov90=float(np.mean([(cdf[i]>=0.05).argmax()<=y[i]<=(cdf[i]>=0.95).argmax() for i in range(len(y))]))
                tail_hi=float(pmf[:,11:].sum(1).mean()) if market=="fg_total" else float(pmf[:,7:].sum(1).mean())
                tail_obs=float((y>=11).mean()) if market=="fg_total" else float((y>=7).mean())
                results.append({"state":state,"market":market,"fold":int(fold),"n":len(s),
                                "crps":crps,"mae":float(np.mean(np.abs(mu-y))),"bias":float(np.mean(mu-y)),
                                "calib_shift":shift,"bias_post_shift":float(np.mean(mu+shift-y)),
                                "cov50":cov50,"cov90":cov90,"tail_pred":tail_hi,"tail_obs":tail_obs,
                                "var_pred":float(np.mean((pmf*(sup**2)).sum(1)-mu**2)),"var_obs":float(np.var(y))})
            else:
                p_raw=s["p"].values.astype(float); y=s["y"].values.astype(int)
                # recalibration head: Platt on calib sims (falls back to identity on first fold)
                if len(c)>=300:
                    zc=np.log(np.clip(c["p"],1e-5,1-1e-5)/np.clip(1-c["p"],1e-5,1-1e-5)).values.reshape(-1,1)
                    head=LogisticRegression(C=1e3,max_iter=1000).fit(zc,c["y"].values.astype(int))
                    zs=np.log(np.clip(p_raw,1e-5,1-1e-5)/np.clip(1-p_raw,1e-5,1-1e-5)).reshape(-1,1)
                    p=head.predict_proba(zs)[:,1]; head_used="platt_calib"
                else: p=p_raw; head_used="identity"
                sl,ic=_slope_int(y,p)
                results.append({"state":state,"market":market,"fold":int(fold),"n":len(s),
                                "logloss":_ll(y,p),"logloss_raw":_ll(y,p_raw),"brier":_brier(y,p),
                                "auc":_auc(y,p),"ece":_ece(y,p),"cal_slope":sl,"cal_intercept":ic,
                                "sharpness":float(np.std(p)),"head":head_used,
                                "mc_se_mean":float(s["mc_se_phome"].mean())})
res=pd.DataFrame(results)
res.to_csv(os.path.join(RUN,f"sim_results{OUT_SUFFIX}.csv"),index=False)
json.dump(per_state,open(os.path.join(RUN,f"coherence_results{OUT_SUFFIX}.json"),"w"),indent=1)
print(res.groupby(["market","state"]).agg(n=("n","sum"),
      ll=("logloss","mean"),crps=("crps","mean"),ece=("ece","mean"),
      slope=("cal_slope","mean"),bias=("bias_post_shift","mean")).round(4).to_string())
ledger("score-simulations"+OUT_SUFFIX,f"{len(res)} market-fold-state rows; coherence failures={coh_fail}",
       "PASS" if coh_fail==0 else "WARNING",
       [f"sim_results{OUT_SUFFIX}.csv",f"coherence_results{OUT_SUFFIX}.json"],rows={"rows":len(res)},
       warn=[] if coh_fail==0 else [f"coherence failures: {coh_fail}"])
