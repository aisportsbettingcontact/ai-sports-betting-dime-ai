#!/usr/bin/env python
"""f5-assessor-02-slices.py — F5 ASSESSOR granular audit, step 2: residual-structure slices.

Input: granular/f5/f5-assessor-population.csv (1,555 rows, full population).
Outputs (granular/f5/):
  f5-assessor-total-bias-slices.csv   F5 total level bias by starter IP-depth, team bullpen
                                      depth, park (per home team + pf tercile), month
  f5-assessor-ml-brier-favstrength.csv  F5 ML Brier/calibration by favorite strength x series,
                                      incl. home-fav vs away-fav (HFA residual)
  f5-assessor-rl-tie-totalline.csv    RL cover error + tie frequency by matchup total-line bucket

Series: live (games.modelF5*, n=1536), p1 (raw fixed replay), p2 (walk-forward calibrated).
"p2@live" columns restrict p2 to the live-covered subset so live-vs-p2 deltas are exact.
No DB access — pure analysis of the extracted population CSV.
"""
from __future__ import annotations

import csv
import math
import os
import statistics as st
from collections import defaultdict

HERE = os.path.dirname(__file__)
F5_DIR = os.path.join(HERE, "..", "f5")
POP = os.path.join(F5_DIR, "f5-assessor-population.csv")


def f(r, c):
    v = r.get(c)
    if v in (None, "", "None"):
        return None
    return float(v)


def mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def se_mean(xs):
    xs = [x for x in xs if x is not None]
    if len(xs) < 2:
        return None
    return st.pstdev(xs) / math.sqrt(len(xs))


def fmt(x, d=4):
    return "" if x is None else f"{x:.{d}f}"


rows = list(csv.DictReader(open(POP)))
assert len(rows) == 1555, len(rows)

# ---------------------------------------------------------------- helpers ----
def total_bias_metrics(sub):
    """F5 total level bias for a slice."""
    out = {}
    out["n"] = len(sub)
    act = [f(r, "actualF5Total") for r in sub]
    out["actual_mean"] = mean(act)
    for ser, col in (("p1", "p1_projF5Total"), ("p2", "p2_projF5Total")):
        resid = [f(r, col) - f(r, "actualF5Total") for r in sub if f(r, col) is not None]
        out[f"{ser}_proj_mean"] = mean([f(r, col) for r in sub])
        out[f"{ser}_bias"] = mean(resid)
        out[f"{ser}_bias_se"] = se_mean(resid)
        out[f"{ser}_bias_pct"] = (out[f"{ser}_bias"] / out["actual_mean"] * 100
                                  if out["actual_mean"] else None)
    live_sub = [r for r in sub if f(r, "live_projF5Total") is not None]
    out["live_n"] = len(live_sub)
    if live_sub:
        lresid = [f(r, "live_projF5Total") - f(r, "actualF5Total") for r in live_sub]
        out["live_bias"] = mean(lresid)
        out["live_bias_se"] = se_mean(lresid)
        p2resid = [f(r, "p2_projF5Total") - f(r, "actualF5Total") for r in live_sub]
        out["p2atlive_bias"] = mean(p2resid)
    else:
        out["live_bias"] = out["live_bias_se"] = out["p2atlive_bias"] = None
    return out


TB_COLS = ["sliceType", "sliceKey", "n", "actual_mean",
           "p1_proj_mean", "p1_bias", "p1_bias_se", "p1_bias_pct",
           "p2_proj_mean", "p2_bias", "p2_bias_se", "p2_bias_pct",
           "live_n", "live_bias", "live_bias_se", "p2atlive_bias"]


def tb_row(st_, key, sub):
    m = total_bias_metrics(sub)
    return [st_, key, m["n"], fmt(m["actual_mean"], 3),
            fmt(m["p1_proj_mean"], 3), fmt(m["p1_bias"], 3), fmt(m["p1_bias_se"], 3),
            fmt(m["p1_bias_pct"], 2),
            fmt(m["p2_proj_mean"], 3), fmt(m["p2_bias"], 3), fmt(m["p2_bias_se"], 3),
            fmt(m["p2_bias_pct"], 2),
            m["live_n"], fmt(m["live_bias"], 3), fmt(m["live_bias_se"], 3),
            fmt(m["p2atlive_bias"], 3)]


# ------------------------------------------------- 1. F5 total bias slices ----
tb_out = []

# (a) starter IP-depth (matchup mean as-of IP)
def ip_bucket(r):
    v = f(r, "matchupAsofIp")
    if f(r, "awayStarterAsofIp") is None or f(r, "homeStarterAsofIp") is None:
        return "no-prior-start"
    if v < 4.5:
        return "1_lt4.5"
    if v < 5.0:
        return "2_4.5-5.0"
    if v < 5.5:
        return "3_5.0-5.5"
    return "4_ge5.5"

for b in ("1_lt4.5", "2_4.5-5.0", "3_5.0-5.5", "4_ge5.5", "no-prior-start"):
    tb_out.append(tb_row("starterIpDepth", b, [r for r in rows if ip_bucket(r) == b]))

# (b) team bullpen-depth quintiles (matchup mean of the two teams' as-of starter IP depth)
depth_vals = sorted(f(r, "matchupTeamAsofDepth") for r in rows
                    if f(r, "matchupTeamAsofDepth") is not None)
qs = [depth_vals[int(q * (len(depth_vals) - 1))] for q in (0.2, 0.4, 0.6, 0.8)]

def depth_bucket(r):
    v = f(r, "matchupTeamAsofDepth")
    if v is None:
        return "none"
    for i, q in enumerate(qs):
        if v <= q:
            return f"Q{i+1}_le{q:.2f}"
    return f"Q5_gt{qs[-1]:.2f}"

for b in sorted(set(depth_bucket(r) for r in rows)):
    tb_out.append(tb_row("teamBullpenDepthQ", b, [r for r in rows if depth_bucket(r) == b]))

# (c) per-team bullpen table (games involving the team; depth = that team's season starter IP)
team_outs = defaultdict(list)
team_games = defaultdict(list)
for r in rows:
    for side, outs_col in (("awayTeam", "awayStarterOutsGame"), ("homeTeam", "homeStarterOutsGame")):
        t = r[side]
        team_games[t].append(r)
        if f(r, outs_col) is not None:
            team_outs[t].append(f(r, outs_col) / 3.0)
for t in sorted(team_outs, key=lambda t: mean(team_outs[t])):
    m = total_bias_metrics(team_games[t])
    tb_out.append([f"team(seasonStarterIp={mean(team_outs[t]):.2f})", t, m["n"],
                   fmt(m["actual_mean"], 3), fmt(m["p1_proj_mean"], 3), fmt(m["p1_bias"], 3),
                   fmt(m["p1_bias_se"], 3), fmt(m["p1_bias_pct"], 2), fmt(m["p2_proj_mean"], 3),
                   fmt(m["p2_bias"], 3), fmt(m["p2_bias_se"], 3), fmt(m["p2_bias_pct"], 2),
                   m["live_n"], fmt(m["live_bias"], 3), fmt(m["live_bias_se"], 3),
                   fmt(m["p2atlive_bias"], 3)])

# (d) park: per home team + pf tercile
pf_sorted = sorted(rows, key=lambda r: f(r, "parkFactor3yr"))
n3 = len(pf_sorted) // 3
terciles = [("pf_low", pf_sorted[:n3]), ("pf_mid", pf_sorted[n3:2 * n3]),
            ("pf_high", pf_sorted[2 * n3:])]
for name, sub in terciles:
    lo, hi = f(sub[0], "parkFactor3yr"), f(sub[-1], "parkFactor3yr")
    tb_out.append(tb_row("parkPfTercile", f"{name}[{lo:.3f}-{hi:.3f}]", sub))
for t in sorted(set(r["homeTeam"] for r in rows)):
    sub = [r for r in rows if r["homeTeam"] == t]
    pf = f(sub[0], "parkFactor3yr")
    tb_out.append(tb_row("park", f"{t}(pf={pf:.3f})", sub))

# (e) month
for m_ in sorted(set(r["month"] for r in rows)):
    tb_out.append(tb_row("month", m_, [r for r in rows if r["month"] == m_]))

tb_out.append(tb_row("ALL", "ALL", rows))

with open(os.path.join(F5_DIR, "f5-assessor-total-bias-slices.csv"), "w", newline="") as fh:
    w = csv.writer(fh)
    w.writerow(TB_COLS)
    w.writerows(tb_out)
print(f"[write] f5-assessor-total-bias-slices.csv: {len(tb_out)} slices")

# park-factor vs bias correlation (p2, per home team)
per_park = [(f(sub[0], "parkFactor3yr"),
             mean([f(r, "p2_projF5Total") - f(r, "actualF5Total") for r in sub]))
            for t in sorted(set(r["homeTeam"] for r in rows))
            for sub in [[r for r in rows if r["homeTeam"] == t]]]
xs = [p for p, _ in per_park]; ys = [b for _, b in per_park]
mx, my = mean(xs), mean(ys)
cov = sum((x - mx) * (y - my) for x, y in per_park)
corr = cov / math.sqrt(sum((x - mx) ** 2 for x in xs) * sum((y - my) ** 2 for y in ys))
print(f"[stat] corr(parkFactor3yr, per-park p2 F5-total bias) over 30 parks = {corr:.3f}")

# depth-gradient significance: Q1 vs Q5 p2 bias
def sub_bias(bucket):
    sub = [r for r in rows if depth_bucket(r) == bucket]
    res = [f(r, "p2_projF5Total") - f(r, "actualF5Total") for r in sub]
    return mean(res), se_mean(res), len(res)
b1 = sub_bias(sorted(set(depth_bucket(r) for r in rows))[0])
b5 = sub_bias(sorted(set(depth_bucket(r) for r in rows))[-2] if "none" in set(depth_bucket(r) for r in rows) else sorted(set(depth_bucket(r) for r in rows))[-1])
z = (b1[0] - b5[0]) / math.sqrt(b1[1] ** 2 + b5[1] ** 2)
print(f"[stat] team-depth Q1 vs Q5 p2 bias: {b1[0]:.3f} vs {b5[0]:.3f} (z={z:.2f})")

# ------------------------------------- 2. F5 ML Brier by favorite strength ----
def ml_metrics(sub, pcol, cond=True):
    """Evaluate P(away wins F5 | decided). sub must be decided games with pcol non-null."""
    n = len(sub)
    if n == 0:
        return None
    briers, lls = [], []
    pf_sum, favwin = 0.0, 0
    for r in sub:
        p_away = f(r, pcol)
        y = int(r["awayF5Win"])
        briers.append((p_away - y) ** 2)
        p_clip = min(max(p_away, 1e-6), 1 - 1e-6)
        lls.append(-(y * math.log(p_clip) + (1 - y) * math.log(1 - p_clip)))
        p_fav = max(p_away, 1 - p_away)
        pf_sum += p_fav
        fav_is_away = p_away >= 0.5
        favwin += int(y == 1) if fav_is_away else int(y == 0)
    return {"n": n, "brier": mean(briers), "brier_se": se_mean(briers),
            "logloss": mean(lls), "mean_pfav": pf_sum / n, "fav_winrate": favwin / n}


def strength_bucket(p_cond_away):
    p_fav = max(p_cond_away, 1 - p_cond_away)
    if p_fav < 0.525:
        return "1_tossup[.500-.525)"
    if p_fav < 0.55:
        return "2_[.525-.550)"
    if p_fav < 0.60:
        return "3_[.550-.600)"
    if p_fav < 0.65:
        return "4_[.600-.650)"
    return "5_[.650+]"


ML_COLS = ["bucketBy", "bucket", "series", "n", "mean_pfav", "fav_winrate",
           "brier", "brier_se", "logloss"]
ml_out = []
decided = [r for r in rows if int(r["f5Tie"]) == 0]
print(f"[info] decided F5 games: {len(decided)}/1555 (tie rate {1 - len(decided)/1555:.4f})")

series_defs = [
    ("live_cond", "live_condAway"),   # conditional two-way from stored three-way
    ("p1_cond", "p1_condAway"),       # conditional two-way from solved three-way
    ("p2_raw", "p2_pF5AwayMl"),       # p2 as stored (hybrid scale, D-4)
]
for ser, col in series_defs:
    sub_all = [r for r in decided if f(r, col) is not None]
    # buckets from that series' own conditional/fav strength
    for b in ("1_tossup[.500-.525)", "2_[.525-.550)", "3_[.550-.600)", "4_[.600-.650)", "5_[.650+]"):
        sub = [r for r in sub_all if strength_bucket(f(r, col)) == b]
        m = ml_metrics(sub, col)
        if m:
            ml_out.append(["favStrength", b, ser, m["n"], fmt(m["mean_pfav"]), fmt(m["fav_winrate"]),
                           fmt(m["brier"]), fmt(m["brier_se"]), fmt(m["logloss"])])
    # fav side split (HFA residual)
    for side, pred in (("homeFav", lambda p: p < 0.5), ("awayFav", lambda p: p >= 0.5)):
        sub = [r for r in sub_all if pred(f(r, col))]
        m = ml_metrics(sub, col)
        if m:
            ml_out.append(["favSide", side, ser, m["n"], fmt(m["mean_pfav"]), fmt(m["fav_winrate"]),
                           fmt(m["brier"]), fmt(m["brier_se"]), fmt(m["logloss"])])
    m = ml_metrics(sub_all, col)
    ml_out.append(["ALL", "ALL", ser, m["n"], fmt(m["mean_pfav"]), fmt(m["fav_winrate"]),
                   fmt(m["brier"]), fmt(m["brier_se"]), fmt(m["logloss"])])

# home-side calibration overall (decided): mean P(home|decided) vs home win rate
for ser, col in series_defs:
    sub = [r for r in decided if f(r, col) is not None]
    mean_phome = mean([1 - f(r, col) for r in sub])
    home_rate = mean([1 - int(r["awayF5Win"]) for r in sub])
    print(f"[stat] {ser}: mean P(home|decided)={mean_phome:.4f} vs actual home rate "
          f"{home_rate:.4f} (n={len(sub)}, gap {100*(home_rate-mean_phome):+.2f}pp)")

with open(os.path.join(F5_DIR, "f5-assessor-ml-brier-favstrength.csv"), "w", newline="") as fh:
    w = csv.writer(fh)
    w.writerow(ML_COLS)
    w.writerows(ml_out)
print(f"[write] f5-assessor-ml-brier-favstrength.csv: {len(ml_out)} rows")

# --------------------------- 3. RL cover error + ties by total-line bucket ----
def line_bucket(r):
    v = f(r, "totalLineUsed")
    if v is None:
        return "none"
    v = round(v * 2) / 2
    if v <= 7.0:
        return "1_le7.0"
    if v <= 7.5:
        return "2_7.5"
    if v <= 8.0:
        return "3_8.0"
    if v <= 8.5:
        return "4_8.5"
    if v <= 9.0:
        return "5_9.0"
    if v <= 9.5:
        return "6_9.5"
    return "7_ge10.0"


RL_COLS = ["bucket", "n", "line_mean", "tie_actual", "tie_actual_se",
           "tie_p1_traw", "tie_live_traw", "tie_live_pushAdj",
           "cover_actual", "cover_p1", "cover_p1_err",
           "cover_live_stored", "cover_live_stored_err",
           "cover_live_fixed", "cover_live_fixed_err",
           "rlbrier_p1", "rlbrier_live_stored", "rlbrier_live_fixed"]
rl_out = []
buckets = sorted(set(line_bucket(r) for r in rows))
for b in buckets + ["ALL"]:
    sub = rows if b == "ALL" else [r for r in rows if line_bucket(r) == b]
    ties = [int(r["f5Tie"]) for r in sub]
    cov = [int(r["awayCover"]) for r in sub]
    live_sub = [r for r in sub if f(r, "live_rlCoverStored") is not None]
    row = [b, len(sub), fmt(mean([f(r, "totalLineUsed") for r in sub]), 2),
           fmt(mean(ties)), fmt(se_mean(ties)),
           fmt(mean([f(r, "p1_tRaw") for r in sub])),
           fmt(mean([f(r, "live_tRaw") for r in live_sub])),
           fmt(mean([f(r, "live_pushAdj") for r in live_sub])),
           fmt(mean(cov)), fmt(mean([f(r, "p1_pF5AwayRl") for r in sub])),
           fmt(mean([f(r, "p1_pF5AwayRl") for r in sub]) - mean(cov)),
           fmt(mean([f(r, "live_rlCoverStored") for r in live_sub])),
           (fmt(mean([f(r, "live_rlCoverStored") for r in live_sub])
                - mean([int(r["awayCover"]) for r in live_sub])) if live_sub else ""),
           fmt(mean([f(r, "live_rlCoverFixed") for r in live_sub])),
           (fmt(mean([f(r, "live_rlCoverFixed") for r in live_sub])
                - mean([int(r["awayCover"]) for r in live_sub])) if live_sub else ""),
           fmt(mean([(f(r, "p1_pF5AwayRl") - int(r["awayCover"])) ** 2 for r in sub])),
           fmt(mean([(f(r, "live_rlCoverStored") - int(r["awayCover"])) ** 2 for r in live_sub])),
           fmt(mean([(f(r, "live_rlCoverFixed") - int(r["awayCover"])) ** 2 for r in live_sub]))]
    rl_out.append(row)

with open(os.path.join(F5_DIR, "f5-assessor-rl-tie-totalline.csv"), "w", newline="") as fh:
    w = csv.writer(fh)
    w.writerow(RL_COLS)
    w.writerows(rl_out)
print(f"[write] f5-assessor-rl-tie-totalline.csv: {len(rl_out)} rows")

# tie-vs-total regression slopes (per game, actual tie 0/1 and model tie masses vs line)
def slope(ycol_fn, sub):
    pts = [(f(r, "totalLineUsed"), ycol_fn(r)) for r in sub
           if f(r, "totalLineUsed") is not None and ycol_fn(r) is not None]
    mx = mean([x for x, _ in pts]); my = mean([y for _, y in pts])
    num_ = sum((x - mx) * (y - my) for x, y in pts)
    den = sum((x - mx) ** 2 for x, _ in pts)
    return num_ / den, len(pts)

s_act, n_act = slope(lambda r: float(int(r["f5Tie"])), rows)
s_p1, _ = slope(lambda r: f(r, "p1_tRaw"), rows)
s_live, _ = slope(lambda r: f(r, "live_tRaw"), rows)
s_livepa, _ = slope(lambda r: f(r, "live_pushAdj"), rows)
print(f"[stat] tie-vs-totalLine slope per run of line: actual={s_act:+.4f} (n={n_act}), "
      f"p1_traw={s_p1:+.4f}, live_traw={s_live:+.4f}, live_pushAdj={s_livepa:+.4f}")

# live synthetic-line reconstruction check + live F5 total-market calibration at its own line
recon_ok = recon_n = 0
overs, unders, pushes = 0, 0, 0
p_over_sum = 0.0
for r in rows:
    bt = f(r, "bookTotal"); syn = f(r, "live_synthLine")
    if bt is not None and syn is not None:
        recon_n += 1
        if abs(round(bt * 0.555 * 2) / 2 - syn) < 1e-9:
            recon_ok += 1
    if syn is not None and f(r, "live_overRate") is not None:
        at = f(r, "actualF5Total")
        if at > syn:
            overs += 1
        elif at < syn:
            unders += 1
        else:
            pushes += 1
        p_over_sum += f(r, "live_overRate")
n_ou = overs + unders
print(f"[stat] live synthLine == round(bookTotal*0.555*2)/2 in {recon_ok}/{recon_n}")
print(f"[stat] live F5 total at its own synthetic line: mean pOver={p_over_sum/(n_ou+pushes):.4f} "
      f"(2dp-truncated), actual over rate (excl push)={overs/n_ou:.4f} "
      f"(n={n_ou}, pushes={pushes})")
