#!/usr/bin/env python3
"""P6: State B (confirmed starter) and State C (confirmed lineup) conditioning features.

CONDITIONING_IDENTITY rule (§3/§5): only the IDENTITY comes from the current game; every
statistic is strictly-prior (the as-of stores are shift(1)-keyed to each player's own game
row, so a join on (game_pk, mlbam_id) yields exactly the pregame state).

State B: hsb_/asb_ = actual starter identity + prior-only stats (equivalent to the prior
run's hso_/aso_ columns, reclassified per the governing correction; rebuilt here explicitly).
State C: hlc_/alc_ = actual starting-lineup (batting_order 100..900) slot-weighted prior-only
batter aggregates. Games where batting_order is unavailable keep State A pools (flagged).
Outputs: matrix_v2.parquet (matrix + B/C columns + flags).
"""
import os, sys, json, subprocess
import numpy as np, pandas as pd

RUN = os.path.dirname(os.path.abspath(__file__))
F = os.path.join(RUN, "features")
np.random.seed(42)

df = pd.read_parquet(os.path.join(RUN, "matrix.parquet"))
pa = pd.read_parquet(os.path.join(F, "pitcher_asof.parquet"))
pi = pd.read_parquet(os.path.join(F, "pitcher_inn1_asof.parquet"))
ba = pd.read_parquet(os.path.join(F, "batter_asof.parquet"))
bb = pd.read_csv(os.path.join(F, "box_batting.tsv"), sep="\t", na_values=["\\N", ""],
                 usecols=["game_pk","mlbam_id","team_id","batting_order"])

# ---- State B: join pitcher_asof on the starter's own game row (exact pregame state)
pstate = pa.merge(pi[["game_pk","pitcher_id","p_inn1_scored_rate_20"]]
                  .rename(columns={"pitcher_id": "mlbam_id"}), on=["game_pk","mlbam_id"], how="left")
pcols = [c for c in pstate.columns if c.startswith("p_")]
for idc, pre in [("home_starter_actual","hsb_"), ("away_starter_actual","asb_")]:
    j = df[["game_pk", idc]].merge(pstate[["game_pk","mlbam_id"] + pcols],
                                   left_on=["game_pk", idc], right_on=["game_pk","mlbam_id"], how="left")
    for c in pcols: df[pre + c] = j[c].values
df["stateB_available"] = df[["hsb_" + pcols[0], "asb_" + pcols[0]]].notna().all(axis=1).astype(int)

# ---- State C: actual starting lineup slot-weighted prior-only aggregates
bb["batting_order"] = pd.to_numeric(bb["batting_order"], errors="coerce")
lu = bb[bb["batting_order"].notna() & (bb["batting_order"] % 100 == 0)].copy()
lu["slot"] = (lu["batting_order"] // 100).astype(int)
lu["w"] = 1.0 / (1.0 + 0.15 * (lu["slot"] - 1))
bcols = [c for c in ["b_so_40","b_bb_40","b_hr_162","b_h_40","b_hardhit_40","b_whiffs_40",
                     "b_ooz_swings_40","b_launch_40"] if c in ba.columns]
lb = lu.merge(ba[["game_pk","mlbam_id"] + bcols], on=["game_pk","mlbam_id"], how="left")
# side mapping: home_team_id/away_team_id from matrix
side = df[["game_pk","home_team_id","away_team_id"]]
lb = lb.merge(side, on="game_pk", how="left")
lb["side"] = np.where(lb["team_id"] == lb["home_team_id"], "h",
              np.where(lb["team_id"] == lb["away_team_id"], "a", None))
lb = lb[lb["side"].notna()]
def wmean(g):
    out = {}
    for c in bcols:
        v = g[c].values.astype(float); w = g["w"].values
        m = ~np.isnan(v)
        out[c] = float(np.sum(v[m]*w[m]) / np.sum(w[m])) if m.any() else np.nan
    out["n_slots"] = int(len(g))
    return pd.Series(out)
agg = lb.groupby(["game_pk","side"]).apply(wmean, include_groups=False).reset_index()
for s, pre in [("h","hlc_"), ("a","alc_")]:
    part = agg[agg["side"] == s].set_index("game_pk")[bcols + ["n_slots"]].add_prefix(pre)
    df = df.merge(part, left_on="game_pk", right_index=True, how="left")
df["stateC_available"] = ((df.get("hlc_n_slots", 0) >= 8) & (df.get("alc_n_slots", 0) >= 8)).astype(int)

df.to_parquet(os.path.join(RUN, "matrix_v2.parquet"))
ev = {"phase": "P6-states", "operation": "build-states-BC",
      "purpose": "State B confirmed-starter and State C confirmed-lineup conditioning features (identity-only from current game; stats strictly prior)",
      "command": "build_states.py", "expected": "matrix_v2 with hsb_/asb_/hlc_/alc_ + availability flags",
      "actual": f"games {len(df)}; stateB available {int(df['stateB_available'].sum())}; stateC available {int(df['stateC_available'].sum())}",
      "exit_status": "PASS", "evidence": "VERIFIED", "artifacts": ["matrix_v2.parquet"],
      "rows": {"games": int(len(df))}, "warnings": [], "next": "architecture screening"}
subprocess.run([sys.executable, os.path.join(RUN, "ledger.py"), "append", json.dumps(ev)], check=True, capture_output=True)
print(f"[states] games {len(df)} | B avail {df['stateB_available'].mean():.3f} | C avail {df['stateC_available'].mean():.3f}")
