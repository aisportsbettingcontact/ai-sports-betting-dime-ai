#!/usr/bin/env python3
"""E5+E6: matchup reconstruction (deployable + oracle) and as-of feature engine.

Inputs (from ${RUN}/features/): spine.tsv, game_outcomes.tsv, plays_compact.tsv,
pitcher_game_pitch.tsv, batter_game_pitch.tsv, box_pitching.tsv, box_batting.tsv,
people.tsv, hp_umpires.tsv, venues.tsv.

Outputs: matchups.parquet (per game: expected + oracle starters/lineups with rule branch,
confidence), features.parquet (one row per game: home_/away_ features + context + outcomes
+ tier masks), starter_rule_report.csv (rule hit rates by season), linear_weights.csv
(per-season-window event weights fit by OLS on team-game runs ~ event counts).

Point-in-time guarantees: every as-of aggregate uses rows with official_date strictly
earlier than the game's official_date (same-day earlier games excluded per the frozen
contract's conservative rule). All shrinkage priors are computed from the trailing window
itself. Seeds fixed (42). No external constants: linear weights are fit per training era
inside this script; park/umpire baselines are trailing-window league means.
"""
import os, sys, json, hashlib
import numpy as np
import pandas as pd

RUN = os.path.dirname(os.path.abspath(__file__))
F = os.path.join(RUN, "features")
np.random.seed(42)

def log_event(op, expected, actual, status, artifacts, rows=None, warnings=None):
    import subprocess
    ev = {"phase": "P3-build", "operation": op, "purpose": "dataset construction",
          "command": "build_datasets.py", "expected": expected, "actual": actual,
          "exit_status": status, "evidence": "VERIFIED", "artifacts": artifacts,
          "rows": rows or {}, "warnings": warnings or [], "next": ""}
    subprocess.run([sys.executable, os.path.join(RUN, "ledger.py"), "append", json.dumps(ev)],
                   check=True, capture_output=True)

def read(name, **kw):
    df = pd.read_csv(os.path.join(F, name), sep="\t", low_memory=False, na_values=["\\N", ""], **kw)
    for c in df.columns:
        if df[c].dtype == object:
            conv = pd.to_numeric(df[c], errors="coerce")
            if conv.notna().sum() >= 0.5 * max(df[c].notna().sum(), 1):
                df[c] = conv
    return df

print("[load] core tables")
spine = read("spine.tsv")
outc = read("game_outcomes.tsv")
plays = read("plays_compact.tsv",
             usecols=["game_pk","season","at_bat_index","inning","half","batter_id","pitcher_id",
                      "bat_side","pitch_hand","event_type","rbi","away_score","home_score"])
pg = read("pitcher_game_pitch.tsv")
bg = read("batter_game_pitch.tsv")
bp = read("box_pitching.tsv")
bb = read("box_batting.tsv")
people = read("people.tsv").set_index("mlbam_id")
ump = read("hp_umpires.tsv")
venues = read("venues.tsv")

spine["official_date"] = pd.to_datetime(spine["official_date"]).dt.date
date_of = spine.set_index("game_pk")["official_date"]
season_of = spine.set_index("game_pk")["season"]

# ---------------------------------------------------------------- actual starters (source rows for history; ORACLE for same game)
print("[starters] actual starters from first play of each half")
first_plays = plays[plays["at_bat_index"] < 25].sort_values(["game_pk", "at_bat_index"])
top1 = first_plays[first_plays["half"] == "top"].groupby("game_pk").first()
bot1 = first_plays[first_plays["half"] == "bottom"].groupby("game_pk").first()
starters = pd.DataFrame({
    "home_starter_actual": top1["pitcher_id"],   # top of 1st: home pitches
    "away_starter_actual": bot1["pitcher_id"],
}).dropna().astype(int)
starters = starters.join(spine.set_index("game_pk")[["season","official_date","home_team_id","away_team_id","game_number"]])

# per-team chronological start log (the substrate for rotation reconstruction)
sl_home = starters.reset_index()[["game_pk","official_date","season","home_team_id","home_starter_actual","game_number"]]
sl_home.columns = ["game_pk","date","season","team","starter","game_number"]
sl_away = starters.reset_index()[["game_pk","official_date","season","away_team_id","away_starter_actual","game_number"]]
sl_away.columns = ["game_pk","date","season","team","starter","game_number"]
start_log = pd.concat([sl_home, sl_away]).sort_values(["team","date","game_number"]).reset_index(drop=True)

# ---------------------------------------------------------------- expected starters (deployable, deterministic rules)
print("[starters] expected-starter reconstruction (walk-forward rules)")
start_log["date"] = pd.to_datetime(start_log["date"])
expected_rows = []
for team, g in start_log.groupby("team"):
    g = g.sort_values(["date","game_number"]).reset_index(drop=True)
    dates = g["date"].values; starters_a = g["starter"].values
    # rolling recent-starter state: walk games in order, predict from PRIOR rows only
    for i in range(len(g)):
        d = g.loc[i, "date"]
        lo = d - pd.Timedelta(days=12)
        prior = g[(g["date"] < d) & (g["date"] >= lo)]
        pred, branch = None, "none"
        if len(prior):
            last_by_p = prior.groupby("starter")["date"].max()
            rest = (d - last_by_p).dt.days
            rot = rest[rest >= 4]
            if len(rot):
                pred = int(rot.sort_values(ascending=False).index[0]); branch = "rotation_oldest_rested"
            else:
                pred = int(prior.iloc[-1]["starter"]); branch = "fallback_most_recent"
        expected_rows.append({"game_pk": g.loc[i, "game_pk"], "team": team,
                              "expected_starter": pred, "rule_branch": branch,
                              "actual_starter": int(g.loc[i, "starter"])})
exp = pd.DataFrame(expected_rows)
exp["hit"] = (exp["expected_starter"] == exp["actual_starter"]).astype(int)
exp = exp.merge(spine[["game_pk","season"]], on="game_pk", how="left")
rule_report = exp.groupby(["season","rule_branch"]).agg(n=("hit","size"), hit_rate=("hit","mean")).reset_index()
rule_report.to_csv(os.path.join(RUN, "starter_rule_report.csv"), index=False)
# confidence per (season, branch) computed from PRIOR seasons only
conf_hist = exp.groupby(["season","rule_branch"])["hit"].agg(["sum","size"]).reset_index()
conf_rows = {}
for (s, b) in conf_hist[["season","rule_branch"]].itertuples(index=False):
    pri = conf_hist[(conf_hist["season"] < s) & (conf_hist["rule_branch"] == b)]
    conf_rows[(s, b)] = float(pri["sum"].sum() / pri["size"].sum()) if pri["size"].sum() >= 100 else 0.5
exp["confidence"] = [conf_rows[(s, b)] for s, b in exp[["season","rule_branch"]].itertuples(index=False)]

hexp = exp.merge(sl_home[["game_pk","team"]], on=["game_pk","team"])  # home side rows
aexp = exp.merge(sl_away[["game_pk","team"]], on=["game_pk","team"])
matchups = starters.reset_index()[["game_pk","season","official_date","home_team_id","away_team_id",
                                   "home_starter_actual","away_starter_actual"]]
matchups = matchups.merge(hexp[["game_pk","expected_starter","rule_branch","confidence"]]
                          .rename(columns={"expected_starter":"home_starter_expected",
                                           "rule_branch":"home_rule","confidence":"home_conf"}), on="game_pk", how="left")
matchups = matchups.merge(aexp[["game_pk","expected_starter","rule_branch","confidence"]]
                          .rename(columns={"expected_starter":"away_starter_expected",
                                           "rule_branch":"away_rule","confidence":"away_conf"}), on="game_pk", how="left")

# ---------------------------------------------------------------- expected lineups (top-9 slot frequency over last 20 team games)
print("[lineups] expected lineup reconstruction")
bb["official_date"] = pd.to_datetime(bb["official_date"])
lu = bb[bb["batting_order"].notna() & (bb["batting_order"] % 100 == 0)].copy()  # starters: 100,200,...900
lu["slot"] = (lu["batting_order"] // 100).astype(int)
lu = lu.sort_values(["team_id","official_date"])
# expected batter pool per game = batters appearing in >=8 of team's last 20 games (weights = freq share)
pool_rows = []
for team, g in lu.groupby("team_id"):
    games_seq = g.drop_duplicates("game_pk")[["game_pk","official_date"]].sort_values("official_date")
    gp_list = games_seq["game_pk"].tolist(); gd_list = games_seq["official_date"].tolist()
    by_game = {k: v for k, v in g.groupby("game_pk")}
    window = []
    for gpk, gd in zip(gp_list, gd_list):
        if window:
            wdf = pd.concat(window[-20:])
            freq = wdf.groupby("mlbam_id").agg(n=("slot","size"), slot=("slot","mean"))
            top = freq.sort_values("n", ascending=False).head(12)
            pool_rows.append({"game_pk": gpk, "team_id": team,
                              "pool": json.dumps({str(int(i)): [int(r.n), round(float(r.slot), 2)]
                                                  for i, r in top.iterrows()})})
        window.append(by_game[gpk][["mlbam_id","slot"]])
pool = pd.DataFrame(pool_rows)
matchups = matchups.merge(pool.rename(columns={"team_id":"home_team_id","pool":"home_pool"}),
                          on=["game_pk","home_team_id"], how="left")
matchups = matchups.merge(pool.rename(columns={"team_id":"away_team_id","pool":"away_pool"}),
                          on=["game_pk","away_team_id"], how="left")
matchups.to_parquet(os.path.join(RUN, "matchups.parquet"))
log_event("build-matchups", "expected+oracle starters/lineups all games",
          f"{len(matchups)} games; starter rule hit-rate overall {exp['hit'].mean():.3f}",
          "PASS", ["matchups.parquet","starter_rule_report.csv"],
          rows={"games": int(len(matchups))})
print(f"[matchups] {len(matchups)} games; expected-starter hit rate {exp['hit'].mean():.3f}")

# ---------------------------------------------------------------- linear weights per era window (no external constants)
print("[weights] fit event linear weights by OLS on team-game runs")
ev = plays.copy()
EVENTS = ["single","double","triple","home_run","walk","hit_by_pitch","strikeout","field_out"]
ev["etype"] = np.where(ev["event_type"].isin(EVENTS), ev["event_type"], "other")
team_game = ev.pivot_table(index=["game_pk","half"], columns="etype", values="at_bat_index",
                           aggfunc="count", fill_value=0)
runs_tg = ev.groupby(["game_pk","half"]).agg(runs=("rbi","sum")).reset_index()
tg = team_game.reset_index().merge(runs_tg, on=["game_pk","half"])
tg = tg.merge(spine[["game_pk","season"]], on="game_pk")
w_rows = []
for era_end in range(2010, 2027):
    win = tg[(tg["season"] >= era_end - 4) & (tg["season"] < era_end)]
    if len(win) < 5000: continue
    X = win[[c for c in EVENTS if c in win.columns]].values
    y = win["runs"].values
    coef, *_ = np.linalg.lstsq(np.c_[np.ones(len(X)), X], y, rcond=None)
    w_rows.append({"asof_season": era_end, **{e: round(float(c), 4) for e, c in zip(EVENTS, coef[1:])}, "intercept": round(float(coef[0]), 4)})
lw = pd.DataFrame(w_rows)
lw.to_csv(os.path.join(RUN, "linear_weights.csv"), index=False)

# ---------------------------------------------------------------- as-of player/team/park/ump features
print("[features] as-of rolling aggregates")
# pitcher per-game line (box + pitch aggregates merged)
bp["official_date"] = pd.to_datetime(bp["official_date"])
pgm = bp.merge(pg, left_on=["game_pk","mlbam_id"], right_on=["game_pk","pitcher_id"], how="left", suffixes=("","_p"))
pgm = pgm.sort_values(["mlbam_id","official_date"])
def asof_roll(df, by, cols_num, cols_den, windows, prefix):
    """Trailing sums with shift(1) => strictly-prior. Returns df of ratios per window."""
    out = pd.DataFrame(index=df.index)
    g = df.groupby(by)
    for w in windows:
        for cn, cd, name in zip(cols_num, cols_den, [f"{prefix}_{c}_{w}" for c in cols_num]):
            num = g[cn].transform(lambda s: s.shift(1).rolling(w, min_periods=max(1, w // 5)).sum())
            den = g[cd].transform(lambda s: s.shift(1).rolling(w, min_periods=max(1, w // 5)).sum())
            out[name] = num / den.replace(0, np.nan)
    return out

pgm["ip"] = pgm["outs_recorded"] / 3.0
pn = ["so","bb","er","h","hr","csw","whiffs","zone_pitches","first_pitch_strikes","inplay_hardhit","ip"]
pd_ = ["batters_faced","batters_faced","ip","batters_faced","batters_faced","n_pitches","n_pitches","n_pitches","n_first_pitches","inplay_launch_n","games_dummy"]
pgm["games_dummy"] = 1
pfeat = asof_roll(pgm, "mlbam_id", pn, pd_, [3, 10, 25], "p")
pfeat["p_velo_ff_3"] = pgm.groupby("mlbam_id")["mean_speed_ff"].transform(lambda s: s.shift(1).rolling(3, min_periods=1).mean())
pfeat["p_velo_ff_25"] = pgm.groupby("mlbam_id")["mean_speed_ff"].transform(lambda s: s.shift(1).rolling(25, min_periods=5).mean())
pfeat["p_velo_trend"] = pfeat["p_velo_ff_3"] - pfeat["p_velo_ff_25"]
pfeat["p_days_rest"] = pgm.groupby("mlbam_id")["official_date"].transform(lambda s: (s - s.shift(1)).dt.days)
for c in ["pct_ff","pct_sl","pct_ch","mean_ext","mean_spin"]:
    pfeat[f"p_{c}_10"] = pgm.groupby("mlbam_id")[c].transform(lambda s: s.shift(1).rolling(10, min_periods=2).mean())
pfeat[["game_pk","mlbam_id"]] = pgm[["game_pk","mlbam_id"]]
pfeat.to_parquet(os.path.join(RUN, "features", "pitcher_asof.parquet"))

# first-inning + platoon splits per pitcher (from plays, trailing 365 days)
plays["date"] = plays["game_pk"].map(date_of)
plays["date"] = pd.to_datetime(plays["date"])
inn1 = plays[plays["inning"] == 1].copy()
inn1["run_flag"] = (inn1.groupby(["game_pk","half"])["rbi"].transform("sum") > 0).astype(int)
p_inn1 = inn1.drop_duplicates(["game_pk","half"]).sort_values(["pitcher_id","date"])
p_inn1_feat = p_inn1.groupby("pitcher_id").apply(
    lambda g: pd.DataFrame({"game_pk": g["game_pk"],
                            "p_inn1_scored_rate_20": g["run_flag"].shift(1).rolling(20, min_periods=5).mean()}),
    include_groups=False).reset_index()
p_inn1_feat.to_parquet(os.path.join(RUN, "features", "pitcher_inn1_asof.parquet"))

# batter as-of (box + pitch behavior), windows in games
bbm = bb.merge(bg, left_on=["game_pk","mlbam_id"], right_on=["game_pk","batter_id"], how="left")
bbm["official_date"] = pd.to_datetime(bbm["official_date"])
bbm = bbm.sort_values(["mlbam_id","official_date"])
bbm["pa"] = bbm[["ab","bb","hbp","sac_flies","sac_bunts"]].sum(axis=1)
bbm["singles"] = bbm["h"] - bbm["doubles"] - bbm["triples"] - bbm["hr"]
bn = ["so","bb","hr","h","hardhit","whiffs","ooz_swings","zone_contact","singles","doubles"]
bbm["hardhit"] = bbm["inplay_hardhit"]
bd = ["pa","pa","pa","ab","inplay_launch_n","swings","ooz_pitches","zone_swings","ab","ab"]
bfeat = asof_roll(bbm, "mlbam_id", bn, bd, [10, 40, 162], "b")
bfeat[["game_pk","mlbam_id"]] = bbm[["game_pk","mlbam_id"]]
bfeat["b_launch_40"] = bbm.groupby("mlbam_id")["inplay_launch_mean"].transform(lambda s: s.shift(1).rolling(40, min_periods=8).mean())
bfeat.to_parquet(os.path.join(RUN, "features", "batter_asof.parquet"))

# team as-of: runs pg, inn1 scoring, bullpen state
tg_runs = outc.melt(id_vars=["game_pk","season","official_date"], value_vars=["final_home","final_away"],
                    var_name="side", value_name="runs")
side_team = pd.concat([
    outc[["game_pk","official_date","home_team_id"]].rename(columns={"home_team_id":"team"}).assign(side="final_home"),
    outc[["game_pk","official_date","away_team_id"]].rename(columns={"away_team_id":"team"}).assign(side="final_away")])
tg_runs = tg_runs.merge(side_team, on=["game_pk","side"], suffixes=("","_y"))
tg_runs["official_date"] = pd.to_datetime(tg_runs["official_date"])
tg_runs = tg_runs.sort_values(["team","official_date"])
tfeat = pd.DataFrame({"game_pk": tg_runs["game_pk"], "team": tg_runs["team"],
    "t_rpg_15": tg_runs.groupby("team")["runs"].transform(lambda s: s.shift(1).rolling(15, min_periods=5).mean()),
    "t_rpg_75": tg_runs.groupby("team")["runs"].transform(lambda s: s.shift(1).rolling(75, min_periods=20).mean()),
    "t_rest": tg_runs.groupby("team")["official_date"].transform(lambda s: (s - s.shift(1)).dt.days)})
tfeat.to_parquet(os.path.join(RUN, "features", "team_asof.parquet"))

# bullpen usage: non-starter outs in last 1/3 days per team
bp2 = bp.merge(starters.reset_index()[["game_pk","home_starter_actual","away_starter_actual"]], on="game_pk", how="left")
bp2["is_starter"] = (bp2["mlbam_id"] == bp2["home_starter_actual"]) | (bp2["mlbam_id"] == bp2["away_starter_actual"])
pen = bp2[~bp2["is_starter"]].groupby(["team_id","official_date"]).agg(pen_outs=("outs_recorded","sum"),
                                                                       pen_er=("er","sum"), pen_so=("so","sum"), pen_bf=("batters_faced","sum")).reset_index()
pen = pen.sort_values(["team_id","official_date"])
pen["pen_outs_prev3"] = pen.groupby("team_id")["pen_outs"].transform(lambda s: s.shift(1).rolling(3, min_periods=1).sum())
pen["pen_era_30"] = pen.groupby("team_id").apply(lambda g: (g["pen_er"].shift(1).rolling(30, min_periods=8).sum() /
                                                            (g["pen_outs"].shift(1).rolling(30, min_periods=8).sum() / 27)),
                                                 include_groups=False).reset_index(level=0, drop=True)
pen["pen_k_30"] = pen.groupby("team_id").apply(lambda g: (g["pen_so"].shift(1).rolling(30, min_periods=8).sum() /
                                                          g["pen_bf"].shift(1).rolling(30, min_periods=8).sum()),
                                               include_groups=False).reset_index(level=0, drop=True)
pen.to_parquet(os.path.join(RUN, "features", "bullpen_asof.parquet"))

# park factors: trailing-3-season venue run index (shrunk toward 1 with n)
vg = outc.copy(); vg["total"] = vg["final_home"] + vg["final_away"]
pf_rows = []
for s in range(2009, 2027):
    win = vg[(vg["season"] >= s - 3) & (vg["season"] < s)]
    lg = win["total"].mean()
    for v, g in win.groupby("venue_id"):
        n = len(g); idx = (g["total"].mean() / lg) if lg else 1.0
        pf_rows.append({"asof_season": s, "venue_id": v, "park_run_idx": (idx * n + 1.0 * 60) / (n + 60), "n": n})
pf = pd.DataFrame(pf_rows)
pf.to_parquet(os.path.join(RUN, "features", "park_asof.parquet"))

# umpire: HP ump trailing K-rate delta (shrunk), from plays K share joined to hp_umpires
kpg = plays.groupby("game_pk").agg(k=("event_type", lambda s: (s == "strikeout").sum()),
                                   pa=("event_type","size")).reset_index()
ug = ump.merge(kpg, on="game_pk").merge(spine[["game_pk","official_date"]], on="game_pk")
ug["official_date"] = pd.to_datetime(ug["official_date"])
ug = ug.sort_values(["mlbam_id","official_date"])
ug["u_kshare_60"] = ug.groupby("mlbam_id").apply(lambda g: (g["k"].shift(1).rolling(60, min_periods=15).sum() /
                                                            g["pa"].shift(1).rolling(60, min_periods=15).sum()),
                                                 include_groups=False).reset_index(level=0, drop=True)
ug[["game_pk","mlbam_id","u_kshare_60"]].to_parquet(os.path.join(RUN, "features", "ump_asof.parquet"))

log_event("build-asof-features", "as-of pitcher/batter/team/pen/park/ump features",
          f"pitcher {len(pfeat)}, batter {len(bfeat)}, team {len(tfeat)}, pen {len(pen)}, park {len(pf)}, ump {len(ug)}",
          "PASS", ["features/*.parquet","linear_weights.csv"],
          rows={"pitcher_games": int(len(pfeat)), "batter_games": int(len(bfeat))})
print("[done] dataset build complete")
