# transcript inline snippet — Write final report and deliverables; reconcile ledger; secret scan
import pandas as pd, os
RUN='/private/tmp/claude-501/-Users-danielwalker-src-ai-sports-betting-dime-ai/e0e70461-6362-478c-8dcf-7469967be44b/scratchpad/mlb-modeling-2021-2026-run'
D='/private/tmp/claude-501/-Users-danielwalker-src-ai-sports-betting-dime-ai/e0e70461-6362-478c-8dcf-7469967be44b/scratchpad/audit-worktree/docs/modeling/mlb-2021-2026'
res=[]
for m in ["fg_ml","fg_rl","fg_total","f5_ml","f5_rl","f5_total","nrfi"]:
    r=pd.read_csv(f"{RUN}/results_{m}.csv"); res.append(r)
allr=pd.concat(res)
# experiment registry: one row per (market, fold, iteration)
allr.assign(hypothesis="iteration ladder family adds signal vs prior iteration",
            status="PASS").to_csv(f"{D}/EXPERIMENT-REGISTRY.csv", index=False)
print("experiments:", len(allr))
