#!/usr/bin/env python
"""f5-modeler-02-analyze.py — F5 MODELER granular audit, step 2: full-population analysis.

Input:  granular/f5/f5-modeler-population.csv (1,555 rows, written by f5-modeler-01-extract.py)
Output: granular/f5/
  f5-modeler-ranges.csv                per-series distribution stats for every F5 probability field
  f5-modeler-partition.csv             per-game partition/tie audit (implied raw tie mass, actual
                                       margin, away+0.5 cover, live pre/post-fix classification)
  f5-modeler-partition-calibration.csv decile calibration of pF5AwayRl (p1) vs actual away+0.5 cover
  f5-modeler-p2-verify.csv             per-game recomputation of every p2 F5 field from p1+calibMeta
  f5-modeler-ratio.csv                 per-game projF5Total/projTotal ratio (p1 and p2)
Aggregates printed to stdout (captured into f5-modeler.md).

Checks (MODELER scope):
 1. p1 pF5AwayMl / pF5Over / pF5AwayRl ranges + bounds violations.
 2. F5 partition validity under the tie fix (M-205): pF5AwayRl must include tie mass.
    - replay p1: pF5AwayRl > pF5AwayMl everywhere; solve per-game implied raw tie mass t from
        RL = a + t   and   ML = a*(1 - (0.6t + 0.4*0.1507))/(1 - t)
      (engine equations: raw RL partition, 60/40 push blend for the three-way ML).
    - actuals: away+0.5 covers iff F5 margin (home-away) < +0.5, i.e. tie or away win.
      Compare priced cover mass vs realized cover rate; implied tie mass vs realized tie rate.
    - live games rows: reconstruct raw a/h from stored (awayWinPct, homeWinPct, pushPct, pushRaw);
      classify each stored modelF5AwayRLCoverPct as pre-fix (tie-excluded, a/(a+h)) or post-fix
      (tie-inclusive, a+t); quantify per-game understatement of the away+0.5 side.
 3. p2 transform verification for every row: pF5AwayMl2 = sigmoid(logit(p1)/T_f5),
    projF5Total2 = projF5Total1*mult, pF5Over2 = Phi(Phi^-1(pOver1)+(proj2-proj1)/f5_sd),
    pF5AwayRl2 = passthrough. Tolerance = DB decimal rounding (7,5)->5.5e-6 / (6,3)->5.5e-4.
 4. projF5Total/projTotal ratio distribution (expected center ~F5_RUN_SHARE=0.5618, hard
    engine bounds 0.5618*[0.90, 1.10] from the +-10% team F5-RS clamp).
"""
from __future__ import annotations

import csv
import math
import os
import statistics as st

import numpy as np
from scipy.optimize import brentq
from scipy.stats import norm

HERE = os.path.dirname(os.path.abspath(__file__))
F5_DIR = os.path.join(HERE, "..", "f5")
POP = os.path.join(F5_DIR, "f5-modeler-population.csv")

EPS = 1e-6
PUSH_PRIOR = 0.1507
F5_RUN_SHARE = 0.5618
TOL_P = 5.5e-6    # decimal(7,5) half-up rounding
TOL_T = 5.5e-4    # decimal(6,3)


def num(v):
    if v is None or v == "":
        return None
    return float(v)


def clamp_p(p):
    return min(1.0 - EPS, max(EPS, p))


def logit(p):
    p = clamp_p(p)
    return math.log(p / (1.0 - p))


def sigmoid(x):
    if x >= 0:
        return 1.0 / (1.0 + math.exp(-x))
    e = math.exp(x)
    return e / (1.0 + e)


def temperature_scale(p, t):
    if p is None:
        return None
    if not t or abs(t - 1.0) < 1e-9:
        return p
    return sigmoid(logit(p) / t)


def recenter_over_prob(p_over1, proj1, proj2, sd):
    if p_over1 is None:
        return None
    if proj1 is None or proj2 is None or sd is None or sd <= 0:
        return p_over1
    z1 = norm.ppf(clamp_p(p_over1))
    return float(norm.cdf(z1 + (proj2 - proj1) / sd))


def implied_tie_mass(rl, ml):
    """Solve raw tie mass t from stored p1 (pF5AwayRl, pF5AwayMl) under engine equations.

    RL = a + t (raw partition, post-M-205); ML = a*(1-t_adj)/(1-t), t_adj = 0.6t+0.4*0.1507.
    f(t) = (RL-t)*(1-0.6t-0.06028)/(1-t) - ML, root in [0, min(RL, 0.6)].
    """
    def f(t):
        return (rl - t) * (1.0 - 0.6 * t - 0.4 * PUSH_PRIOR) / (1.0 - t) - ml

    lo, hi = 0.0, min(rl - 1e-9, 0.6)
    try:
        if f(lo) < 0 or f(hi) > 0:
            return None  # no root in physical range
        return brentq(f, lo, hi, xtol=1e-10)
    except ValueError:
        return None


def pct_stats(name, vals):
    a = np.array(vals, dtype=float)
    qs = np.percentile(a, [0, 1, 5, 25, 50, 75, 95, 99, 100])
    return {
        "series": name, "n": len(a), "mean": round(float(a.mean()), 5),
        "sd": round(float(a.std(ddof=1)), 5),
        "min": round(float(qs[0]), 5), "p01": round(float(qs[1]), 5),
        "p05": round(float(qs[2]), 5), "p25": round(float(qs[3]), 5),
        "p50": round(float(qs[4]), 5), "p75": round(float(qs[5]), 5),
        "p95": round(float(qs[6]), 5), "p99": round(float(qs[7]), 5),
        "max": round(float(qs[8]), 5),
        "n_le0": int((a <= 0).sum()), "n_ge1": int((a >= 1).sum()),
    }


def main() -> None:
    rows = list(csv.DictReader(open(POP)))
    assert len(rows) == 1555, f"population file has {len(rows)} rows, expected 1555"
    print(f"[load] {len(rows)} games (full population)")

    # ------------------------------------------------------------------ 1. ranges
    range_rows = []
    for field, label in [
        ("p1_pF5AwayMl", "p1 pF5AwayMl"), ("p1_pF5Over", "p1 pF5Over"),
        ("p1_pF5AwayRl", "p1 pF5AwayRl"), ("p2_pF5AwayMl", "p2 pF5AwayMl"),
        ("p2_pF5Over", "p2 pF5Over"), ("p2_pF5AwayRl", "p2 pF5AwayRl"),
        ("p1_projF5Total", "p1 projF5Total"), ("p2_projF5Total", "p2 projF5Total"),
    ]:
        vals = [num(r[field]) for r in rows if num(r[field]) is not None]
        s = pct_stats(label, vals)
        s["n_null"] = len(rows) - len(vals)
        range_rows.append(s)
    # live series (0-100 -> 0-1)
    for field, label, scale in [
        ("live_awayWinPct", "live modelF5AwayWinPct/100", 100.0),
        ("live_awayRlCoverPct", "live modelF5AwayRLCoverPct/100", 100.0),
        ("live_overRate", "live modelF5OverRate (stored 0-1)", 1.0),
        ("live_pushPct", "live modelF5PushPct", 1.0),
        ("live_pushRaw", "live modelF5PushRaw", 1.0),
    ]:
        vals = [num(r[field]) / scale for r in rows if num(r[field]) is not None]
        s = pct_stats(label, vals)
        s["n_null"] = len(rows) - len(vals)
        range_rows.append(s)
    with open(os.path.join(F5_DIR, "f5-modeler-ranges.csv"), "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(range_rows[0].keys()))
        w.writeheader()
        w.writerows(range_rows)
    print("\n== 1. RANGES (see f5-modeler-ranges.csv) ==")
    for s in range_rows:
        print(f"  {s['series']:38s} n={s['n']:4d} null={s['n_null']:3d} "
              f"min={s['min']:.5f} p05={s['p05']:.5f} med={s['p50']:.5f} "
              f"p95={s['p95']:.5f} max={s['max']:.5f} mean={s['mean']:.5f} "
              f"oob(le0/ge1)={s['n_le0']}/{s['n_ge1']}")

    # ------------------------------------------------- 2. partition / tie audit
    part_rows = []
    n_rl_gt_ml = n_rl_le_ml = 0
    implied_ts, implied_as = [], []
    n_unsolvable = 0
    covers, ties = [], []
    briers_p1, briers_p2, briers_live = [], [], []
    live_class = {"postfix": 0, "prefix": 0, "ambiguous": 0, "missing": 0}
    live_sum_viol = 0
    threeway_viol = 0
    understate = []
    prefix_diffs, postfix_diffs = [], []

    for r in rows:
        gid = r["gameId"]
        p1ml, p1rl = num(r["p1_pF5AwayMl"]), num(r["p1_pF5AwayRl"])
        p2rl = num(r["p2_pF5AwayRl"])
        f5a, f5h = num(r["actualF5Away"]), num(r["actualF5Home"])
        margin = f5h - f5a  # home - away, F5
        away_cover = 1 if margin < 0.5 else 0  # away+0.5 prices tie AND away win
        tie = 1 if margin == 0 else 0
        covers.append(away_cover)
        ties.append(tie)

        if p1rl > p1ml:
            n_rl_gt_ml += 1
        else:
            n_rl_le_ml += 1
        t_imp = implied_tie_mass(p1rl, p1ml)
        if t_imp is None:
            n_unsolvable += 1
            a_imp = None
        else:
            a_imp = p1rl - t_imp
            implied_ts.append(t_imp)
            implied_as.append(a_imp)

        briers_p1.append((p1rl - away_cover) ** 2)
        briers_p2.append((p2rl - away_cover) ** 2)

        # live row reconstruction
        la, lh = num(r["live_awayWinPct"]), num(r["live_homeWinPct"])
        lpush, lpraw = num(r["live_pushPct"]), num(r["live_pushRaw"])
        lrl_a, lrl_h = num(r["live_awayRlCoverPct"]), num(r["live_homeRlCoverPct"])
        cls = "missing"
        pre = post = None
        if None not in (la, lh, lpush, lpraw, lrl_a, lrl_h):
            la, lh, lrl_a01, lrl_h01 = la / 100, lh / 100, lrl_a / 100, lrl_h / 100
            if abs(la + lh + lpush - 1.0) > 0.005:
                threeway_viol += 1
            if abs(lrl_a01 + lrl_h01 - 1.0) > 0.005:
                live_sum_viol += 1
            denom = 1.0 - lpush
            a_raw = la * (1.0 - lpraw) / denom if denom > 0 else None
            h_raw = lh * (1.0 - lpraw) / denom if denom > 0 else None
            if a_raw is not None and (a_raw + h_raw) > 0:
                pre = a_raw / (a_raw + h_raw)          # tie-excluded convention
                post = a_raw + lpraw                    # tie-inclusive (M-205)
                d_pre, d_post = abs(lrl_a01 - pre), abs(lrl_a01 - post)
                prefix_diffs.append(d_pre)
                postfix_diffs.append(d_post)
                if d_pre < d_post - 1e-4:
                    cls = "prefix"
                elif d_post < d_pre - 1e-4:
                    cls = "postfix"
                else:
                    cls = "ambiguous"
                understate.append(post - lrl_a01)
                briers_live.append((lrl_a01 - away_cover) ** 2)
        live_class[cls] += 1

        part_rows.append({
            "gameId": gid, "gameDate": r["gameDate"],
            "p1_pF5AwayMl": p1ml, "p1_pF5AwayRl": p1rl, "p2_pF5AwayRl": p2rl,
            "implied_tie_raw": None if t_imp is None else round(t_imp, 5),
            "implied_away_raw": None if a_imp is None else round(a_imp, 5),
            "actualF5Away": f5a, "actualF5Home": f5h, "f5_margin_home_minus_away": margin,
            "away_p05_cover": away_cover, "f5_tie": tie,
            "live_awayRl01": None if lrl_a is None else round(lrl_a / 100, 4),
            "live_pred_prefix": None if pre is None else round(pre, 5),
            "live_pred_postfix": None if post is None else round(post, 5),
            "live_class": cls,
            "live_understatement_vs_postfix": None if post is None or lrl_a is None
            else round(post - lrl_a / 100, 5),
        })

    with open(os.path.join(F5_DIR, "f5-modeler-partition.csv"), "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(part_rows[0].keys()))
        w.writeheader()
        w.writerows(part_rows)

    n = len(rows)
    cover_rate = sum(covers) / n
    tie_rate = sum(ties) / n
    se_cover = math.sqrt(cover_rate * (1 - cover_rate) / n)
    se_tie = math.sqrt(tie_rate * (1 - tie_rate) / n)
    p1rl_all = [num(r["p1_pF5AwayRl"]) for r in rows]
    p2rl_all = [num(r["p2_pF5AwayRl"]) for r in rows]
    print("\n== 2. PARTITION / TIE AUDIT (see f5-modeler-partition.csv) ==")
    print(f"  replay p1: pF5AwayRl > pF5AwayMl in {n_rl_gt_ml}/{n} games; violations={n_rl_le_ml}")
    print(f"  implied raw tie mass t solved for {len(implied_ts)}/{n} games "
          f"(unsolvable={n_unsolvable})")
    if implied_ts:
        print(f"    implied t: mean={st.mean(implied_ts):.4f} sd={st.pstdev(implied_ts):.4f} "
              f"min={min(implied_ts):.4f} max={max(implied_ts):.4f}")
        print(f"    implied raw away win a: mean={st.mean(implied_as):.4f} "
              f"min={min(implied_as):.4f} max={max(implied_as):.4f}")
    print(f"  actual F5: away+0.5 cover rate={cover_rate:.4f} (SE {se_cover:.4f}), "
          f"tie rate={tie_rate:.4f} (SE {se_tie:.4f}) over {n} games")
    print(f"  priced away cover mass: p1 mean={st.mean(p1rl_all):.4f}, p2 mean={st.mean(p2rl_all):.4f} "
          f"(p2 is documented passthrough)")
    print(f"  gap (p1 mean - actual cover rate) = {st.mean(p1rl_all) - cover_rate:+.4f}")
    print(f"  implied tie mass mean vs actual tie rate: "
          f"{st.mean(implied_ts):.4f} vs {tie_rate:.4f} (diff {st.mean(implied_ts) - tie_rate:+.4f})")
    print(f"  Brier away+0.5: p1={st.mean(briers_p1):.4f} p2={st.mean(briers_p2):.4f} "
          f"live={st.mean(briers_live):.4f} (n_live={len(briers_live)}) "
          f"coin-flip=0.25, always-p={cover_rate:.3f}-> {cover_rate*(1-cover_rate):.4f}")
    print(f"  live rows: classification postfix={live_class['postfix']} "
          f"prefix={live_class['prefix']} ambiguous={live_class['ambiguous']} "
          f"missing={live_class['missing']}")
    if prefix_diffs:
        print(f"    |stored - prefix_pred| mean={st.mean(prefix_diffs):.5f} max={max(prefix_diffs):.5f}")
        print(f"    |stored - postfix_pred| mean={st.mean(postfix_diffs):.5f} max={max(postfix_diffs):.5f}")
        print(f"    away+0.5 understatement (postfix_true - stored): mean={st.mean(understate):+.4f} "
              f"min={min(understate):+.4f} max={max(understate):+.4f}")
    print(f"  live three-way sum violations (>0.005): {threeway_viol}; "
          f"live RL away+home sum violations (>0.005): {live_sum_viol}")

    # decile calibration of p1 pF5AwayRl vs actual cover
    cal_rows = []
    order = np.argsort(p1rl_all)
    bins = np.array_split(order, 10)
    for i, b in enumerate(bins):
        ps = [p1rl_all[j] for j in b]
        cs = [covers[j] for j in b]
        cal_rows.append({
            "decile": i + 1, "n": len(b),
            "p_lo": round(min(ps), 4), "p_hi": round(max(ps), 4),
            "mean_pred": round(st.mean(ps), 4), "actual_cover": round(st.mean(cs), 4),
            "gap": round(st.mean(ps) - st.mean(cs), 4),
        })
    with open(os.path.join(F5_DIR, "f5-modeler-partition-calibration.csv"), "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(cal_rows[0].keys()))
        w.writeheader()
        w.writerows(cal_rows)
    print("  p1 pF5AwayRl decile calibration (pred vs actual cover):")
    for c in cal_rows:
        print(f"    d{c['decile']:2d} [{c['p_lo']:.3f},{c['p_hi']:.3f}] n={c['n']:3d} "
              f"pred={c['mean_pred']:.4f} actual={c['actual_cover']:.4f} gap={c['gap']:+.4f}")

    # ------------------------------------------------- 3. p2 transform verification
    ver_rows = []
    mism = {"pF5AwayMl": 0, "projF5Total": 0, "pF5Over": 0, "pF5AwayRl": 0}
    maxd = {k: 0.0 for k in mism}
    for r in rows:
        T = num(r["calib_T_f5"])
        mult = num(r["calib_league_env_mult"])
        sd = num(r["calib_f5_total_sd"])
        p1ml, p1t, p1o, p1rl = (num(r["p1_pF5AwayMl"]), num(r["p1_projF5Total"]),
                                num(r["p1_pF5Over"]), num(r["p1_pF5AwayRl"]))
        re_ml = temperature_scale(p1ml, T)
        re_t = p1t * mult
        re_o = recenter_over_prob(p1o, p1t, re_t, sd)
        re_rl = p1rl
        stored = {"pF5AwayMl": num(r["p2_pF5AwayMl"]), "projF5Total": num(r["p2_projF5Total"]),
                  "pF5Over": num(r["p2_pF5Over"]), "pF5AwayRl": num(r["p2_pF5AwayRl"])}
        recomp = {"pF5AwayMl": re_ml, "projF5Total": re_t, "pF5Over": re_o, "pF5AwayRl": re_rl}
        row = {"gameId": r["gameId"], "gameDate": r["gameDate"], "calib_month": r["calib_month"],
               "T_f5": T, "league_env_mult": mult, "f5_total_sd": sd}
        for k in mism:
            tol = TOL_T if k == "projF5Total" else TOL_P
            d = abs(stored[k] - recomp[k])
            row[f"stored_{k}"] = stored[k]
            row[f"recomputed_{k}"] = round(recomp[k], 6)
            row[f"absdiff_{k}"] = round(d, 7)
            maxd[k] = max(maxd[k], d)
            if d > tol:
                mism[k] += 1
                row[f"MISMATCH_{k}"] = 1
            else:
                row[f"MISMATCH_{k}"] = 0
        ver_rows.append(row)
    with open(os.path.join(F5_DIR, "f5-modeler-p2-verify.csv"), "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(ver_rows[0].keys()))
        w.writeheader()
        w.writerows(ver_rows)
    print("\n== 3. P2 TRANSFORM VERIFICATION, all 1555 rows (see f5-modeler-p2-verify.csv) ==")
    for k in mism:
        tol = TOL_T if k == "projF5Total" else TOL_P
        print(f"  {k:12s}: mismatches(> {tol:g}) = {mism[k]:4d} / {len(ver_rows)}   "
              f"max |stored-recomputed| = {maxd[k]:.7f}")

    # ------------------------------------------------- 4. F5/FG total ratio
    ratio_rows = []
    ratios = []
    lo_b, hi_b = F5_RUN_SHARE * 0.90, F5_RUN_SHARE * 1.10
    n_out = 0
    for r in rows:
        p1f5, p1fg = num(r["p1_projF5Total"]), num(r["p1_projTotal"])
        p2f5, p2fg = num(r["p2_projF5Total"]), num(r["p2_projTotal"])
        rat1 = p1f5 / p1fg
        rat2 = p2f5 / p2fg
        ratios.append(rat1)
        out = not (lo_b <= rat1 <= hi_b)
        if out:
            n_out += 1
        ratio_rows.append({
            "gameId": r["gameId"], "gameDate": r["gameDate"],
            "p1_projF5Total": p1f5, "p1_projTotal": p1fg, "ratio_p1": round(rat1, 5),
            "ratio_p2": round(rat2, 5), "ratio_p2_minus_p1": round(rat2 - rat1, 6),
            "outside_engine_bounds": int(out),
        })
    with open(os.path.join(F5_DIR, "f5-modeler-ratio.csv"), "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(ratio_rows[0].keys()))
        w.writeheader()
        w.writerows(ratio_rows)
    a = np.array(ratios)
    print("\n== 4. projF5Total / projTotal RATIO (see f5-modeler-ratio.csv) ==")
    print(f"  n={len(a)} mean={a.mean():.5f} sd={a.std(ddof=1):.5f} "
          f"min={a.min():.5f} p05={np.percentile(a,5):.5f} med={np.percentile(a,50):.5f} "
          f"p95={np.percentile(a,95):.5f} max={a.max():.5f}")
    print(f"  F5_RUN_SHARE=0.5618; engine bounds [{lo_b:.4f}, {hi_b:.4f}]; "
          f"outside bounds: {n_out}/{len(a)}")
    print(f"  mean deviation from 0.5618: {a.mean() - F5_RUN_SHARE:+.5f}; from 0.56: {a.mean() - 0.56:+.5f}")
    d21 = np.array([rr["ratio_p2_minus_p1"] for rr in ratio_rows])
    print(f"  p2 ratio - p1 ratio: max|diff|={np.abs(d21).max():.6f} "
          f"(should be ~0: both totals scale by the same league_env_mult)")


if __name__ == "__main__":
    main()
