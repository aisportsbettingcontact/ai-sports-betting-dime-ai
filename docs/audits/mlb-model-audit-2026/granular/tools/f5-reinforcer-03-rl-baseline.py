#!/usr/bin/env python
"""f5-reinforcer-03-rl-baseline.py — Q2: F5 RL probability accuracy vs simple baselines.

Event graded (all 1,555 games): away +0.5 covers = {F5 margin home-away < +0.5}
= {actualF5Away >= actualF5Home} (ties cover) — exactly the event the M-205-fixed
replay `pF5AwayRl` prices. p1 == p2 (passthrough, asserted).

Series compared, all walk-forward-legitimate (seed months use only pre-season constants):
  model      : stored replay pF5AwayRl (400k-sim NB-Gamma resample, no HFA — D-1)
  const_wf   : expanding-window observed cover rate; seed = 0.5489 (the engine's own
               EMPIRICAL_F5 away-RL prior, MLBAIModel.py:377-385 — pre-season constant)
  skellam    : P(Skellam(mu_h, mu_a) <= 0), mu_side = p1_projSideScore * r_wf(m),
               r_wf(m) = expanding (actual F5 total / p1 projected FG total); seed r = 0.5618
               (the engine's own F5_RUN_SHARE constant). Uses FG projections which INCLUDE
               HFA — tests whether a dead-simple margin distribution on HFA-bearing mus
               beats the elaborate simulation that dropped HFA.
  platt_wf   : sigma(a + b*logit(model)) fitted on months < m (log loss); seed = passthrough.
               The cheap calibration-layer repair of the stored probability.
  live (subpop n with live modelF5AwayRLCoverPct/100, tie-excluded pre-fix series) for
               reference on its subpopulation only.

Also: quantifies the f5_rl grading mispairing — book away lines != +0.5 (n and Brier
impact of pairing the +0.5-cover probability with a -0.5 book event where the correct
probability of the booked event is the implied raw away-win mass a).

Outputs:
  granular/f5/f5-reinforcer-rl-baselines.csv     (metrics by month/scope x series)
  granular/f5/f5-reinforcer-rl-reliability.csv   (decile reliability, model vs skellam)
  granular/f5/f5-reinforcer-rl-mispairing.csv    (book-line pairing audit)
"""
from __future__ import annotations

import csv
import math
import os

import numpy as np
from scipy.optimize import brentq, minimize
from scipy.stats import skellam

HERE = os.path.dirname(os.path.abspath(__file__))
F5_DIR = os.path.abspath(os.path.join(HERE, "..", "f5"))
POP = os.path.join(F5_DIR, "f5-reinforcer-population.csv")

EPS = 1e-6
MONTHS = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07"]
SEED_MONTHS = {"2026-03", "2026-04"}
SEED_COVER = 0.5489          # EMPIRICAL_F5 away RL prior (pre-season, in the code)
SEED_SHARE = 0.5618          # F5_RUN_SHARE (pre-season, in the code)
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
    """Solve raw (a, t): rl = a + t ; ml = a*(1-(0.6t+0.4*0.1507))/(1-t)."""
    def f(t):
        a = rl - t
        return a * (1 - (0.6 * t + 0.4 * PUSH_PRIOR)) / (1 - t) - ml
    lo, hi = 1e-6, rl - 1e-6
    try:
        t = brentq(f, lo, hi)
        return rl - t, t
    except ValueError:
        return None, None


def fit_platt(pairs):
    """pairs [(p,y)] -> (a,b) minimizing logloss of sigmoid(a + b*logit(p))."""
    z = np.array([logit(p) for p, _ in pairs])
    y = np.array([yy for _, yy in pairs], dtype=float)

    def nll(ab):
        a, b = ab
        q = 1 / (1 + np.exp(-(a + b * z)))
        q = np.clip(q, EPS, 1 - EPS)
        return -np.mean(y * np.log(q) + (1 - y) * np.log(1 - q))

    res = minimize(nll, x0=[0.0, 1.0], method="Nelder-Mead")
    return float(res.x[0]), float(res.x[1])


def brier_ll(ps, ys):
    ps = np.clip(np.array(ps, dtype=float), EPS, 1 - EPS)
    ys = np.array(ys, dtype=float)
    b = float(np.mean((ps - ys) ** 2))
    ll = float(-np.mean(ys * np.log(ps) + (1 - ys) * np.log(1 - ps)))
    return b, ll


def main():
    rows = list(csv.DictReader(open(POP)))
    assert len(rows) == 1555

    for r in rows:
        r["m"] = r["month"]
        f5a, f5h = num(r["actualF5Away"]), num(r["actualF5Home"])
        r["cover"] = 1.0 if f5a >= f5h else 0.0          # away +0.5 covers (ties cover)
        r["tie"] = 1.0 if f5a == f5h else 0.0
        r["p_model"] = num(r["p1_pF5AwayRl"])
        assert abs(num(r["p2_pF5AwayRl"]) - r["p_model"]) < 1e-9, "RL passthrough violated"
        r["pa"] = num(r["p1_projAwayScore"])
        r["ph"] = num(r["p1_projHomeScore"])
        r["p1t"] = num(r["p1_projTotal"])
        r["aF5"] = f5a + f5h
        r["live_rl"] = num(r["live_awayRlCoverPct"])
        r["book_rl"] = num(r["book_f5AwayRunLine"])
        r["p1_ml"] = num(r["p1_pF5AwayMl"])

    by_month = {m: [r for r in rows if r["m"] == m] for m in MONTHS}

    # walk-forward parameters per month
    cover_wf, share_wf, platt_wf = {}, {}, {}
    for m in MONTHS:
        prev = [r for r in rows if r["m"] < m]
        if m in SEED_MONTHS:
            cover_wf[m] = SEED_COVER
            share_wf[m] = SEED_SHARE
            platt_wf[m] = (0.0, 1.0)
        else:
            cover_wf[m] = float(np.mean([r["cover"] for r in prev]))
            share_wf[m] = sum(r["aF5"] for r in prev) / sum(r["p1t"] for r in prev)
            platt_wf[m] = fit_platt([(r["p_model"], r["cover"]) for r in prev])
    print("[wf-params]")
    for m in MONTHS:
        print(f"    {m}: cover_wf={cover_wf[m]:.4f} share_wf={share_wf[m]:.4f} "
              f"platt(a,b)=({platt_wf[m][0]:+.4f},{platt_wf[m][1]:.4f})")

    # per-game series
    for r in rows:
        m = r["m"]
        r["p_const"] = cover_wf[m]
        s = share_wf[m]
        r["p_skellam"] = float(skellam.cdf(0, mu1=r["ph"] * s, mu2=r["pa"] * s))
        a, b = platt_wf[m]
        r["p_platt"] = sigmoid(a + b * logit(r["p_model"]))

    # ---------------- metrics table ----------------
    series = [("model_p1p2", "p_model"), ("const_wf", "p_const"),
              ("skellam_wf", "p_skellam"), ("platt_wf", "p_platt")]
    out = []
    scopes = [(m, by_month[m]) for m in MONTHS]
    scopes += [("ALL", rows), ("MAY-JUL(postseed)", [r for r in rows if r["m"] not in SEED_MONTHS])]
    for scope, sub in scopes:
        cov = float(np.mean([r["cover"] for r in sub]))
        for name, key in series:
            b, ll = brier_ll([r[key] for r in sub], [r["cover"] for r in sub])
            out.append({
                "scope": scope, "series": name, "n": len(sub),
                "actual_cover_rate": round(cov, 4),
                "mean_p": round(float(np.mean([r[key] for r in sub])), 4),
                "citl": round(float(np.mean([r[key] for r in sub])) - cov, 4),
                "brier": round(b, 5), "logloss": round(ll, 5),
            })
        # live reference on its subpopulation
        live_sub = [r for r in sub if r["live_rl"] is not None]
        if live_sub:
            b, ll = brier_ll([r["live_rl"] / 100 for r in live_sub],
                             [r["cover"] for r in live_sub])
            cov_l = float(np.mean([r["cover"] for r in live_sub]))
            out.append({
                "scope": scope, "series": "live_tie_excl(subpop)", "n": len(live_sub),
                "actual_cover_rate": round(cov_l, 4),
                "mean_p": round(float(np.mean([r["live_rl"] / 100 for r in live_sub])), 4),
                "citl": round(float(np.mean([r["live_rl"] / 100 for r in live_sub])) - cov_l, 4),
                "brier": round(b, 5), "logloss": round(ll, 5),
            })
    with open(os.path.join(F5_DIR, "f5-reinforcer-rl-baselines.csv"), "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(out[0].keys()))
        w.writeheader()
        w.writerows(out)
    print("[write] f5-reinforcer-rl-baselines.csv")
    for r_ in out:
        if r_["scope"] in ("ALL", "MAY-JUL(postseed)"):
            print("   ", r_)

    # paired Brier deltas vs model (full population)
    ys = np.array([r["cover"] for r in rows])
    pm = np.clip([r["p_model"] for r in rows], EPS, 1 - EPS)
    for name, key in series[1:]:
        px = np.clip([r[key] for r in rows], EPS, 1 - EPS)
        d = (px - ys) ** 2 - (pm - ys) ** 2
        print(f"[paired] {name} - model: mean Brier delta {d.mean():+.5f} "
              f"(SE {d.std(ddof=1)/math.sqrt(len(d)):.5f}) n={len(d)}")

    # ---------------- reliability deciles ----------------
    rel = []
    for name, key in [("model_p1p2", "p_model"), ("skellam_wf", "p_skellam")]:
        ps = np.array([r[key] for r in rows])
        yv = np.array([r["cover"] for r in rows])
        qs = np.quantile(ps, np.linspace(0, 1, 11))
        for i in range(10):
            lo, hi = qs[i], qs[i + 1]
            mask = (ps >= lo) & (ps <= hi if i == 9 else ps < hi)
            if mask.sum() == 0:
                continue
            rel.append({
                "series": name, "decile": i + 1, "n": int(mask.sum()),
                "p_lo": round(float(lo), 4), "p_hi": round(float(hi), 4),
                "mean_p": round(float(ps[mask].mean()), 4),
                "obs_cover": round(float(yv[mask].mean()), 4),
                "gap": round(float(ps[mask].mean() - yv[mask].mean()), 4),
            })
    with open(os.path.join(F5_DIR, "f5-reinforcer-rl-reliability.csv"), "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rel[0].keys()))
        w.writeheader()
        w.writerows(rel)
    print("[write] f5-reinforcer-rl-reliability.csv")

    # ---------------- grading mispairing audit ----------------
    mis = []
    lined = [r for r in rows if r["book_rl"] is not None]
    from collections import Counter
    line_counts = Counter(r["book_rl"] for r in lined)
    print(f"[mispair] lined games n={len(lined)}; line distribution: {dict(line_counts)}")
    n_solved = 0
    for r in lined:
        line = r["book_rl"]
        f5a, f5h = num(r["actualF5Away"]), num(r["actualF5Home"])
        cover_evt = f5a + line - f5h                      # book event
        y = None if cover_evt == 0 else (1.0 if cover_evt > 0 else 0.0)
        # correct probability of the booked event where derivable:
        p_correct = None
        if line == 0.5:
            p_correct = r["p_model"]
        elif line == -0.5:
            a, t = implied_masses(r["p_model"], r["p1_ml"])
            if a is not None:
                p_correct = a                            # P(away wins strictly)
                n_solved += 1
        mis.append({
            "gameId": r["gameId"], "month": r["m"], "book_line": line,
            "p_stored_plus05": r["p_model"], "p_correct_for_book_event": p_correct,
            "y_book_event": y,
        })
    with open(os.path.join(F5_DIR, "f5-reinforcer-rl-mispairing.csv"), "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(mis[0].keys()))
        w.writeheader()
        w.writerows(mis)
    sub_m05 = [m_ for m_ in mis if m_["book_line"] == -0.5 and m_["y_book_event"] is not None
               and m_["p_correct_for_book_event"] is not None]
    if sub_m05:
        b_wrong, ll_w = brier_ll([m_["p_stored_plus05"] for m_ in sub_m05],
                                 [m_["y_book_event"] for m_ in sub_m05])
        b_right, ll_r = brier_ll([m_["p_correct_for_book_event"] for m_ in sub_m05],
                                 [m_["y_book_event"] for m_ in sub_m05])
        mean_gap = float(np.mean([m_["p_stored_plus05"] - m_["p_correct_for_book_event"]
                                  for m_ in sub_m05]))
        print(f"[mispair] book line=-0.5 graded n={len(sub_m05)} (implied-mass solved {n_solved}): "
              f"stored(+0.5) Brier {b_wrong:.5f} vs correct-event Brier {b_right:.5f}; "
              f"mean probability overstatement {mean_gap:+.4f}")
    n_not_half = sum(1 for m_ in mis if abs(m_["book_line"]) != 0.5)
    print(f"[mispair] lines beyond +/-0.5 (probability not derivable from stored fields): "
          f"{n_not_half}")


if __name__ == "__main__":
    main()
