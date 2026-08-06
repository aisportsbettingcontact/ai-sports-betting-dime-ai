# transcript inline snippet — Trace source of prior-run fg_ml logloss discrepancy
import pandas as pd, numpy as np, json, os
RUN="/private/tmp/claude-501/-Users-danielwalker-src-ai-sports-betting-dime-ai/e0e70461-6362-478c-8dcf-7469967be44b/scratchpad/mlb-modeling-2021-2026-run"
r=pd.read_csv(os.path.join(RUN,"results_fg_ml.csv"))
print("columns:", list(r.columns))
print(r[["market","iteration","fold","n","logloss"]].pivot_table(index="fold",columns="iteration",values="logloss").round(4))
print("n per fold:", r[r.iteration==r.iteration.max()][["fold","n"]].to_string(index=False))
# pooled from predictions file
f=os.path.join(RUN,"predictions","predictions_fg_ml.jsonl")
if os.path.exists(f):
    rows=[json.loads(l) for l in open(f)]
    d=pd.DataFrame(rows)
    print("pred cols:", list(d.columns)[:12], "n:", len(d))
    if "p" in d and "y" in d:
        p=np.clip(d["p"].astype(float),1e-6,1-1e-6); y=d["y"].astype(int)
        print("pooled LL from predictions:", round(float(-np.mean(y*np.log(p)+(1-y)*np.log(1-p))),4))
