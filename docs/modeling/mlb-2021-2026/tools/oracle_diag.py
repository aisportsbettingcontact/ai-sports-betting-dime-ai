#!/usr/bin/env python3
"""ORACLE-ONLY diagnostic: same ladder features with ACTUAL starters (hso_/aso_) replacing
reconstructed (hs_/as_). Measures the value of perfect starter knowledge. Never deployable."""
import os, sys, json, subprocess
import numpy as np, pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.isotonic import IsotonicRegression
RUN = os.path.dirname(os.path.abspath(__file__))
np.random.seed(42)
FOLDS = [(2019,2020,2021),(2020,2021,2022),(2021,2022,2023),(2022,2023,2024),(2023,2024,2025),(2024,2025,2026)]
def _ll(y,p): p=np.clip(p,1e-6,1-1e-6); return float(-np.mean(y*np.log(p)+(1-y)*np.log(1-p)))
df = pd.read_parquet(os.path.join(RUN,"matrix.parquet")); df = df[df["game_type"]=="R"]
rows=[]
for market in ["fg_ml","f5_ml","nrfi"]:
    d = df.copy()
    if market=="fg_ml": d=d[d["margin"]!=0]; d["y"]=d["y_home_win"]
    elif market=="f5_ml": d=d[(d["innings"]>=5)&(d["f5_margin"]!=0)]; d["y"]=(d["f5_margin"]>0).astype(int)
    else: d=d[d["innings"]>=5]; d["y"]=d["y_nrfi"]
    dep_cols=[c for c in d.columns if (c.startswith(("hs_","as_","hl_","al_","x_","hp_","ap_")) or c in
              ("is_night","game_number","park_run_idx","u_kshare_60","ht_t_rpg_15","at_t_rpg_15","ht_t_rest","at_t_rest")) and d[c].dtype!=object]
    orc_cols=[("hso_"+c[3:] if c.startswith("hs_") and ("hso_"+c[3:]) in d.columns else
               "aso_"+c[3:] if c.startswith("as_") and ("aso_"+c[3:]) in d.columns else c) for c in dep_cols]
    for label, cols in [("deployable",dep_cols),("oracle",orc_cols)]:
        cols=[c for c in dict.fromkeys(cols) if d[c].notna().mean()>0.3]
        for (tr_e,ca_s,sc) in FOLDS:
            tr=d[(d["season"]>=2012)&(d["season"]<=tr_e)]; ca=d[d["season"]==ca_s]; te=d[d["season"]==sc]
            if not len(te): continue
            med=tr[cols].median()
            gb=HistGradientBoostingClassifier(max_iter=250,learning_rate=0.06,max_depth=4,random_state=42).fit(tr[cols].fillna(med),tr["y"])
            pca=gb.predict_proba(ca[cols].fillna(med))[:,1]; pte=gb.predict_proba(te[cols].fillna(med))[:,1]
            iso=IsotonicRegression(out_of_bounds="clip").fit(pca,ca["y"])
            p=np.clip(iso.predict(pte),1e-4,1-1e-4)
            rows.append({"market":market,"series":label,"fold":sc,"n":len(te),"logloss":_ll(te["y"].values,p)})
r=pd.DataFrame(rows); r.to_csv(os.path.join(RUN,"oracle_diagnostic.csv"),index=False)
piv=r.pivot_table(index=["market","fold"],columns="series",values="logloss").reset_index()
piv["oracle_gain_dll"]=piv["deployable"]-piv["oracle"]
print(piv.groupby("market")["oracle_gain_dll"].agg(["mean","min","max"]).round(5).to_string())
summ=piv.groupby("market")["oracle_gain_dll"].mean().to_dict()
ev={"phase":"P4-walkforward","operation":"oracle-starter-diagnostic","purpose":"upper bound of perfect starter knowledge (ORACLE_ONLY, never deployable)","command":"oracle_diag.py","expected":"oracle vs deployable dLL","actual":json.dumps({k:round(v,5) for k,v in summ.items()}),"exit_status":"PASS","evidence":"VERIFIED","artifacts":["oracle_diagnostic.csv"],"warnings":["ORACLE results excluded from all promotion/verdict logic"],"next":"final report"}
subprocess.run([sys.executable,os.path.join(RUN,"ledger.py"),"append",json.dumps(ev)],check=True,capture_output=True)
