# transcript inline snippet — Build manifest, convergence stats, distributions, and copy artifacts to worktree
import json, glob, os
import numpy as np, pandas as pd
RUN="$RUN"; DL="$WT/docs/modeling/mlb-2021-2026"
# 1) per-game simulation manifest + convergence drift stats from v2 artifacts
man=[]; drift={25000:[],50000:[],100000:[],200000:[]}
for st in ["A","B","C"]:
    for f in sorted(glob.glob(os.path.join(RUN,"simulations_v2",st,"sim_artifacts_shard*.jsonl"))):
        for line in open(f):
            a=json.loads(line)
            man.append({"game_pk":a["game_pk"],"fold":a["fold"],"state":st,
                        "model_version":a["model_version"],"n_trajectories":a["n_trajectories"],
                        "batches":a["batches"],"agg_hash":a["agg_hash"],"gates":a["gates"],
                        "p_home":round(a["p_home"],6),"mc_se_phome":round(a["mc_se_phome"],6),
                        "cap_tie_rate":a["cap_tie_rate"]})
            ck=a["checkpoints"]; pf=ck["400000"]["p_home"]
            for n in drift: drift[n].append(abs(ck[str(n)]["p_home"]-pf))
mdf=pd.DataFrame(man)
mdf.to_parquet(os.path.join(DL,"SIMULATION-MANIFEST.parquet"), index=False)
ds={str(n):{"mean":float(np.mean(v)),"p99":float(np.quantile(v,0.99)),"max":float(np.max(v)),
    "theory_bound_4sigma":float(4*np.sqrt(0.25*(1/n-1/400000)))} for n,v in drift.items()}
json.dump(ds,open(os.path.join(RUN,"convergence_drift_v2.json"),"w"),indent=1)
print("manifest rows:",len(mdf)); print(json.dumps(ds,indent=1))
# 2) consolidated per-game market distributions per state
for st in ["A","B","C"]:
    parts=[pd.read_parquet(p) for p in sorted(glob.glob(os.path.join(RUN,"simulations_v2",st,"market_outputs_shard*.parquet")))]
    allp=pd.concat(parts).sort_values(["fold","game_pk"])
    allp.to_parquet(os.path.join(DL,f"SIM-DISTRIBUTIONS-{st}.parquet"), index=False)
    print(st,"distributions:",len(allp))
# 3) copy verdicts/evidence/screening/results/params into deliverables
import shutil
for f in ["MODEL-VERDICTS-V2.csv","VERDICT-EVIDENCE-V2.csv","sim_results_v2.csv",
          "coherence_results_v2.json","screening_v2_A.csv","screening_v2_B.csv","screening_v2_C.csv",
          "engine_params_v2_A.parquet","engine_params_v2_B.parquet","engine_params_v2_C.parquet"]:
    src=os.path.join(RUN,f)
    if os.path.exists(src): shutil.copy(src, os.path.join(DL, f))
# 4) append v2 rows to experiment registry
reg=pd.read_csv(os.path.join(DL,"EXPERIMENT-REGISTRY.csv"))
new=[]
for st in ["A","B","C"]:
    s=pd.read_csv(os.path.join(RUN,f"screening_v2_{st}.csv"))
    for r in s.itertuples():
        new.append({"experiment_id":f"P6V2-SCREEN-{st}-{r.fold}-{r.block}","phase":"P6-v2",
                    "market":"joint-engine","description":f"mean-model screening state {st} fold {r.fold} block {r.block}",
                    "result":f"winner={r.winner}","status":"COMPLETE"})
new.append({"experiment_id":"P6V2-SWEEP-400K","phase":"P6-v2","market":"all7",
            "description":"joint-nb-v2 full 400k contract, 3 states x 26,731 game-folds, 32.08B trajectories",
            "result":"gates PASS 80,193/80,193; verdicts 7x REINFORCE","status":"COMPLETE"})
pd.concat([reg,pd.DataFrame(new)],ignore_index=True).to_csv(os.path.join(DL,"EXPERIMENT-REGISTRY.csv"),index=False)
print("registry rows:",len(reg)+len(new))
