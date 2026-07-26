#!/usr/bin/env python
"""f5-reinforcer-04-push-ml.py — Q3 (push prior 0.1507 vs observed by month) and the
T_f5 parameter-structure test (D-4 follow-through).

PUSH (tie) analysis, full population n=1,555:
  - observed F5 tie rate by month (+ cumulative walk-forward view) vs the 0.1507 prior
  - per-game implied raw sim tie mass t solved from the replay's own equations
    (rl = a + t ; ml = a*(1-(0.6t+0.4*0.1507))/(1-t)) — the replay analogue of
    modelF5PushRaw; validated against live modelF5PushRaw where both exist
  - tie-event Brier of: raw sim t | blend 0.6t+0.4*0.1507 (production rule) |
    constant 0.1507 | constant walk-forward observed | walk-forward refit blend
    (w, prior fitted on months < m by log loss)

ML structure test, decided games (evaluating P(away wins F5 | decided)):
  - current p2 (T_f5 fitted on ABSOLUTE p1 vs decided outcomes — the audited scheme)
  - altA_condT   : condition p1 first (p_c = p1/(1-(0.6t+0.4*0.1507))), then WF temperature
  - altB_condPlatt: sigma(a + b*logit(p_c)) fitted WF — intercept can restore the missing
    HFA tilt (D-1) that pure temperature cannot
  - altC_absPlatt : sigma(a + b*logit(p1_absolute)) fitted WF (lazy fix, no conditioning)
  Seed months: passthrough of the conditioned (A/B) or absolute (C) probability, T=1.

Outputs:
  granular/f5/f5-reinforcer-push-by-month.csv
  granular/f5/f5-reinforcer-ml-structures.csv
"""
from __future__ import annotations

import csv
import math
import os

import numpy as np
from scipy.optimize import brentq, minimize, minimize_scalar

HERE = os.path.dirname(os.path.abspath(__file__))
F5_DIR = os.path.abspath(os.path.join(HERE, "..", "f5"))
POP = os.path.join(F5_DIR, "f5-reinforcer-population.csv")

EPS = 1e-6
MONTHS = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07"]
SEED_MONTHS = {"2026-03", "2026-04"}
PUSH_PRIOR = 0.1507


def num(v):
    if v is None or v == "":
        return None
    return float(v)


def clamp_p(p):
    return min(1.0 - EPS, max(EPS, p))


def logit(p):
    p = clamp_p(p)
    return math.log(p / (1 - p))


def sigmoid(x):
    return 1.0 / (1.0 + math.exp(-x)) if x >= 0 else math.exp(x) / (1.0 + math.exp(x))


def implied_masses(rl, ml):
    def f(t):
        a = rl - t
        return a * (1 - (0.6 * t + 0.4 * PUSH_PRIOR)) / (1 - t) - ml
    try:
        t = brentq(f, 1e-6, rl - 1e-6)
        return rl - t, t
    except ValueError:
        return None, None


def brier_ll(ps, ys):
    ps = np.clip(np.array(ps, dtype=float), EPS, 1 - EPS)
    ys = np.array(ys, dtype=float)
    return (float(np.mean((ps - ys) ** 2)),
            float(-np.mean(ys * np.log(ps) + (1 - ys) * np.log(1 - ps))))


def fit_temperature(pairs):
    if len(pairs) < 20:
        return 1.0
    z = np.array([logit(p) for p, _ in pairs])
    y = np.array([yy for _, yy in pairs], dtype=float)

    def nll(t):
        q = 1 / (1 + np.exp(-z / t))
        q = np.clip(q, EPS, 1 - EPS)
        return -np.mean(y * np.log(q) + (1 - y) * np.log(1 - q))

    res = minimize_scalar(nll, bounds=(0.2, 10.0), method="bounded")
    return float(res.x)


def fit_platt(pairs):
    z = np.array([logit(p) for p, _ in pairs])
    y = np.array([yy for _, yy in pairs], dtype=float)

    def nll(ab):
        a, b = ab
        q = 1 / (1 + np.exp(-(a + b * z)))
        q = np.clip(q, EPS, 1 - EPS)
        return -np.mean(y * np.log(q) + (1 - y) * np.log(1 - q))

    res = minimize(nll, x0=[0.0, 1.0], method="Nelder-Mead")
    return float(res.x[0]), float(res.x[1])


def fit_blend(pairs):
    """pairs [(t_raw, y_tie)] -> (w, prior) minimizing logloss of w*t + (1-w)*prior."""
    t = np.array([tt for tt, _ in pairs])
    y = np.array([yy for _, yy in pairs], dtype=float)

    def nll(wp):
        w, pr = wp
        w = min(1.0, max(0.0, w))
        pr = min(0.4, max(0.02, pr))
        q = np.clip(w * t + (1 - w) * pr, EPS, 1 - EPS)
        return -np.mean(y * np.log(q) + (1 - y) * np.log(1 - q))

    res = minimize(nll, x0=[0.6, PUSH_PRIOR], method="Nelder-Mead")
    w = min(1.0, max(0.0, float(res.x[0])))
    pr = min(0.4, max(0.02, float(res.x[1])))
    return w, pr


def main():
    rows = list(csv.DictReader(open(POP)))
    assert len(rows) == 1555

    n_solved = 0
    for r in rows:
        r["m"] = r["month"]
        f5a, f5h = num(r["actualF5Away"]), num(r["actualF5Home"])
        r["tie"] = 1.0 if f5a == f5h else 0.0
        r["away_win"] = 1.0 if f5a > f5h else 0.0
        r["decided"] = f5a != f5h
        rl, ml = num(r["p1_pF5AwayRl"]), num(r["p1_pF5AwayMl"])
        a, t = implied_masses(rl, ml)
        r["t_raw"] = t
        r["a_raw"] = a
        if t is not None:
            n_solved += 1
        r["live_praw"] = num(r["live_pushRaw"])
        r["live_padj"] = num(r["live_pushPct"])
        r["p1_ml"] = ml
        r["p2_ml"] = num(r["p2_pF5AwayMl"])
        r["T_applied"] = num(r["calib_T_f5"])
    print(f"[push] implied raw tie mass solved for {n_solved}/1555 games")
    assert n_solved == 1555

    # validate implied t against live modelF5PushRaw where live model exists
    both = [r for r in rows if r["live_praw"] is not None]
    diffs = [abs(r["t_raw"] - r["live_praw"]) for r in both]
    print(f"[push] |implied_t - live_pushRaw| on n={len(both)}: mean {np.mean(diffs):.4f}, "
          f"p90 {np.quantile(diffs, 0.9):.4f} (live is a different run — agreement is "
          f"approximate by construction)")

    # ---------------- push table ----------------
    by_month = {m: [r for r in rows if r["m"] == m] for m in MONTHS}
    # walk-forward params
    tie_wf, blend_wf = {}, {}
    for m in MONTHS:
        prev = [r for r in rows if r["m"] < m]
        if m in SEED_MONTHS:
            tie_wf[m] = PUSH_PRIOR
            blend_wf[m] = (0.6, PUSH_PRIOR)
        else:
            tie_wf[m] = float(np.mean([r["tie"] for r in prev]))
            blend_wf[m] = fit_blend([(r["t_raw"], r["tie"]) for r in prev])
    for r in rows:
        w, pr = blend_wf[r["m"]]
        r["p_blend_prod"] = 0.6 * r["t_raw"] + 0.4 * PUSH_PRIOR
        r["p_blend_refit"] = w * r["t_raw"] + (1 - w) * pr
        r["p_const_prior"] = PUSH_PRIOR
        r["p_const_wf"] = tie_wf[r["m"]]

    push_rows = []
    scopes = [(m, by_month[m]) for m in MONTHS] + \
             [("ALL", rows), ("MAY-JUL(postseed)", [r for r in rows if r["m"] not in SEED_MONTHS])]
    for scope, sub in scopes:
        obs = float(np.mean([r["tie"] for r in sub]))
        se = math.sqrt(obs * (1 - obs) / len(sub))
        entry = {
            "scope": scope, "n": len(sub),
            "observed_tie_rate": round(obs, 4), "se": round(se, 4),
            "prior_0.1507_z": round((PUSH_PRIOR - obs) / se, 2),
            "mean_t_raw": round(float(np.mean([r["t_raw"] for r in sub])), 4),
            "wf_blend_w": round(blend_wf[sub[0]["m"]][0], 3) if scope in MONTHS else None,
            "wf_blend_prior": round(blend_wf[sub[0]["m"]][1], 4) if scope in MONTHS else None,
        }
        for name, key in [("brier_t_raw", "t_raw"), ("brier_blend_prod", "p_blend_prod"),
                          ("brier_const_prior", "p_const_prior"), ("brier_const_wf", "p_const_wf"),
                          ("brier_blend_refit", "p_blend_refit")]:
            b, _ = brier_ll([r[key] for r in sub], [r["tie"] for r in sub])
            entry[name] = round(b, 5)
        push_rows.append(entry)
    with open(os.path.join(F5_DIR, "f5-reinforcer-push-by-month.csv"), "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(push_rows[0].keys()))
        w.writeheader()
        w.writerows(push_rows)
    print("[write] f5-reinforcer-push-by-month.csv")
    for p_ in push_rows:
        print("   ", p_)

    # ---------------- ML structure ----------------
    for r in rows:
        p_adj = 0.6 * r["t_raw"] + 0.4 * PUSH_PRIOR
        r["p_cond1"] = r["p1_ml"] / (1 - p_adj)          # conditional away | decided (raw)

    T_cond, plattC, plattA = {}, {}, {}
    for m in MONTHS:
        prev = [r for r in rows if r["m"] < m and r["decided"]]
        if m in SEED_MONTHS:
            T_cond[m] = 1.0
            plattC[m] = (0.0, 1.0)
            plattA[m] = (0.0, 1.0)
        else:
            pairs_c = [(r["p_cond1"], r["away_win"]) for r in prev]
            pairs_a = [(r["p1_ml"], r["away_win"]) for r in prev]
            T_cond[m] = fit_temperature(pairs_c)
            plattC[m] = fit_platt(pairs_c)
            plattA[m] = fit_platt(pairs_a)
    print("[ml wf-params]")
    for m in MONTHS:
        print(f"    {m}: T_applied={by_month[m][0]['T_applied']} T_cond={T_cond[m]:.4f} "
              f"plattCond(a,b)=({plattC[m][0]:+.4f},{plattC[m][1]:.4f}) "
              f"plattAbs(a,b)=({plattA[m][0]:+.4f},{plattA[m][1]:.4f})")

    for r in rows:
        m = r["m"]
        r["ml_p2"] = r["p2_ml"]
        r["ml_altA"] = sigmoid(logit(r["p_cond1"]) / T_cond[m])
        a, b = plattC[m]
        r["ml_altB"] = sigmoid(a + b * logit(r["p_cond1"]))
        a, b = plattA[m]
        r["ml_altC"] = sigmoid(a + b * logit(r["p1_ml"]))

    ml_rows = []
    for scope, sub in scopes:
        dec = [r for r in sub if r["decided"]]
        obs = float(np.mean([r["away_win"] for r in dec]))
        for name in ["ml_p2", "ml_altA", "ml_altB", "ml_altC"]:
            b, ll = brier_ll([r[name] for r in dec], [r["away_win"] for r in dec])
            mean_p = float(np.mean([r[name] for r in dec]))
            hits = sum(1 for r in dec
                       if (r[name] > 0.5) == (r["away_win"] == 1.0)) / len(dec)
            ml_rows.append({
                "scope": scope, "series": name, "n_decided": len(dec),
                "obs_away_rate": round(obs, 4), "mean_p": round(mean_p, 4),
                "citl": round(mean_p - obs, 4), "hit": round(hits, 4),
                "brier": round(b, 5), "logloss": round(ll, 5),
            })
    with open(os.path.join(F5_DIR, "f5-reinforcer-ml-structures.csv"), "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(ml_rows[0].keys()))
        w.writeheader()
        w.writerows(ml_rows)
    print("[write] f5-reinforcer-ml-structures.csv")
    for r_ in ml_rows:
        if r_["scope"] in ("ALL", "MAY-JUL(postseed)"):
            print("   ", r_)

    # paired logloss deltas on post-seed decided games
    ps_dec = [r for r in rows if r["m"] not in SEED_MONTHS and r["decided"]]
    y = np.array([r["away_win"] for r in ps_dec])
    base = np.clip([r["ml_p2"] for r in ps_dec], EPS, 1 - EPS)
    ll_base = -(y * np.log(base) + (1 - y) * np.log(1 - base))
    for name in ["ml_altA", "ml_altB", "ml_altC"]:
        px = np.clip([r[name] for r in ps_dec], EPS, 1 - EPS)
        ll_x = -(y * np.log(px) + (1 - y) * np.log(1 - px))
        d = ll_x - ll_base
        print(f"[paired] {name} - p2 logloss delta: {d.mean():+.5f} "
              f"(SE {d.std(ddof=1)/math.sqrt(len(d)):.5f}) n={len(d)}")


if __name__ == "__main__":
    main()
