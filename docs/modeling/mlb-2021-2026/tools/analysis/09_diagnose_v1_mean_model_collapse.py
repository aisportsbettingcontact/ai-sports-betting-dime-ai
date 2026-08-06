# transcript inline snippet — Diagnose probability spread and lambda variance vs prior-run baselines
import pandas as pd, numpy as np, glob, os
RUN="/private/tmp/claude-501/-Users-danielwalker-src-ai-sports-betting-dime-ai/e0e70461-6362-478c-8dcf-7469967be44b/scratchpad/mlb-modeling-2021-2026-run"
# 1) spread of simulated probabilities
for st in ["A","B","C"]:
    mo=pd.concat([pd.read_parquet(p) for p in glob.glob(os.path.join(RUN,"simulations",st,"market_outputs_shard*.parquet"))])
    print(st, "p_home std %.4f  min %.3f  max %.3f | p_nrfi std %.4f | mean_total std %.3f" % (
        mo.p_home.std(), mo.p_home.min(), mo.p_home.max(), mo.p_nrfi.std(), mo.mean_total.std()))
# 2) lambda spread in engine params
ep=pd.read_parquet(os.path.join(RUN,"engine_params_A.parquet"))
for c in ["lam_h1","lam_a1","lam_h25","lam_a25","lam_h69","lam_a69","k_disp"]:
    print(c, "mean %.4f std %.4f" % (ep[c].mean(), ep[c].std()))
# 3) prior-run final loglosses for comparison (strongest baseline)
for m in ["fg_ml","f5_ml","fg_rl","f5_rl","nrfi"]:
    f=os.path.join(RUN,f"results_{m}.csv")
    if os.path.exists(f):
        r=pd.read_csv(f); fi=r.iteration.max()
        print(m, "prior-run final LL %.4f (iter %d) | iter1 LL %.4f" % (
            r[r.iteration==fi].logloss.mean(), fi, r[r.iteration==1].logloss.mean()))
for m in ["fg_total","f5_total"]:
    f=os.path.join(RUN,f"results_{m}.csv")
    if os.path.exists(f):
        r=pd.read_csv(f); fi=r.iteration.max()
        print(m, "prior-run final CRPS %.4f | iter1 %.4f" % (r[r.iteration==fi].crps.mean(), r[r.iteration==1].crps.mean()))
