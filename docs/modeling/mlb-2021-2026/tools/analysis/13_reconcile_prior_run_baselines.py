# transcript inline snippet — Reconcile prior-run baselines from predictions files for all binary markets
import pandas as pd, numpy as np, json, os
RUN="/private/tmp/claude-501/-Users-danielwalker-src-ai-sports-betting-dime-ai/e0e70461-6362-478c-8dcf-7469967be44b/scratchpad/mlb-modeling-2021-2026-run"
for m in ["fg_ml","fg_rl","f5_ml","f5_rl","nrfi"]:
    f=os.path.join(RUN,"predictions",f"predictions_{m}.jsonl")
    if not os.path.exists(f): print(m,"no predictions file"); continue
    d=pd.DataFrame([json.loads(l) for l in open(f)])
    p=np.clip(d["p"].astype(float),1e-6,1-1e-6); y=d["y"].astype(int)
    ll=float(-np.mean(y*np.log(p)+(1-y)*np.log(1-p)))
    r=pd.read_csv(os.path.join(RUN,f"results_{m}.csv"))
    fold_mean=float(r[r.iteration==r.iteration.max()].logloss.mean())
    print(f"{m}: pooled-from-predictions {ll:.4f} | fold-mean results.csv {fold_mean:.4f} | n {len(d)}")
