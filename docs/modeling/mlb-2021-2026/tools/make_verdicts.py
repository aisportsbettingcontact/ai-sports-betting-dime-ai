#!/usr/bin/env python3
"""P5: consolidate ladder results into deliverable CSVs + seven-market verdicts (§20 gates)."""
import os, sys, json, subprocess
import numpy as np, pandas as pd

RUN = os.path.dirname(os.path.abspath(__file__))
MK = ["fg_ml","fg_rl","fg_total","f5_ml","f5_rl","f5_total","nrfi"]
D = sys.argv[1] if len(sys.argv) > 1 else RUN  # deliverables dir

def ledger(op, actual, status, artifacts, rows=None, warn=None):
    ev = {"phase": "P5-verdicts", "operation": op, "purpose": "verdict consolidation",
          "command": "make_verdicts.py", "expected": "consolidated metrics + verdicts",
          "actual": actual, "exit_status": status, "evidence": "VERIFIED",
          "artifacts": artifacts, "rows": rows or {}, "warnings": warn or [], "next": ""}
    subprocess.run([sys.executable, os.path.join(RUN, "ledger.py"), "append", json.dumps(ev)],
                   check=True, capture_output=True)

allres = []
for m in MK:
    f = os.path.join(RUN, f"results_{m}.csv")
    if os.path.exists(f):
        allres.append(pd.read_csv(f))
res = pd.concat(allres, ignore_index=True)
res.to_csv(os.path.join(D, "MARKET-METRICS-BY-SEASON.csv"), index=False)

# calibration table: final-iteration rows
final_it = res.groupby("market")["iteration"].max().to_dict()
cal = res[res.apply(lambda r: r["iteration"] == final_it[r["market"]], axis=1)]
cal.to_csv(os.path.join(D, "CALIBRATION-RESULTS.csv"), index=False)

verdicts = []
for m in MK:
    r = res[res["market"] == m]
    if not len(r):
        verdicts.append({"market": m, "verdict": "BLOCKED", "reason": "no results produced"}); continue
    fi = final_it[m]
    fin = r[r["iteration"] == fi]; base = r[r["iteration"] == 1]
    if m in ("fg_total","f5_total"):
        d_crps = base.set_index("fold")["crps"] - fin.set_index("fold")["crps"]
        improves = (d_crps.mean() > 0)
        all_seasons = (d_crps > -0.005).mean() >= 0.67
        bias_ok = fin["bias"].abs().mean() <= 0.25
        verdict = ("REINFORCE" if improves and all_seasons and bias_ok else
                   "RECALIBRATE" if bias_ok else "REMODEL")
        reason = (f"CRPS delta vs baseline mean {d_crps.mean():+.4f}; bias mean {fin['bias'].mean():+.3f}; "
                  f"seasons improved {int((d_crps>0).sum())}/{len(d_crps)}")
        stats = {"crps_final": round(float(fin["crps"].mean()), 4), "crps_base": round(float(base["crps"].mean()), 4),
                 "mae": round(float(fin["mae"].mean()), 3), "bias": round(float(fin["bias"].mean()), 3)}
    else:
        # paired dll vs iteration-1 baseline, date-clustered CI already per fold; pool via mean of folds
        dll = fin["dll_vs_baseline"]; lo = fin["dll_lo"]; hi = fin["dll_hi"]
        beats = (dll.mean() > 0) and ((lo > 0).sum() >= max(1, len(fin) // 3))
        never_worse = (hi >= 0).all()
        cal_ok = (fin["ece"].mean() <= 0.02) and (0.7 <= fin["cal_slope"].mean() <= 1.4)
        stable = (dll > 0).mean() >= 0.5
        if beats and cal_ok and stable: verdict = "REINFORCE"
        elif cal_ok and never_worse: verdict = "RECALIBRATE"
        elif cal_ok: verdict = "RETAIN"
        else: verdict = "REMODEL"
        reason = (f"mean dLL vs baseline {dll.mean():+.5f} (folds CI>0: {(lo>0).sum()}/{len(fin)}); "
                  f"ECE {fin['ece'].mean():.4f}; slope {fin['cal_slope'].mean():.2f}; "
                  f"seasons improved {(dll>0).sum()}/{len(fin)}")
        stats = {"logloss": round(float(fin["logloss"].mean()), 5), "brier": round(float(fin["brier"].mean()), 5),
                 "auc": round(float(fin["auc"].mean()), 4), "ece": round(float(fin["ece"].mean()), 4)}
    verdicts.append({"market": m, "verdict": verdict, "final_iteration": fi,
                     "n_scored": int(fin["n"].sum()), "reason": reason, **stats,
                     "betting_metrics": "BLOCKED_BY_DATA_BOUNDARY",
                     "promotion": "NOT_RECOMMENDED (deployable starter reconstruction ~50% hit rate caps"
                                  " matchup value; no priced-market proof possible in-boundary)"})
vdf = pd.DataFrame(verdicts)
vdf.to_csv(os.path.join(D, "MODEL-VERDICTS.csv"), index=False)
vdf.to_csv(os.path.join(RUN, "model-verdicts.csv"), index=False)
print(vdf[["market","verdict","reason"]].to_string(index=False))
ledger("consolidate-verdicts", f"{len(vdf)} market verdicts; {len(res)} result rows",
       "PASS", ["MODEL-VERDICTS.csv","MARKET-METRICS-BY-SEASON.csv","CALIBRATION-RESULTS.csv"],
       rows={"result_rows": int(len(res))})
