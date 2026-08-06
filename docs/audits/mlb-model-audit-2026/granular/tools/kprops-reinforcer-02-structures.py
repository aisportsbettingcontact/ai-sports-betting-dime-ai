#!/usr/bin/env python3
"""kprops-reinforcer-02-structures.py — REINFORCER analysis, kprops market group.

Offline analysis over kprops-reinforcer-population.csv (full population, one row
per replay K-prop side). Everything is WALK-FORWARD: any parameter used for
month m (or date d) is fitted strictly on rows earlier than m (or d). Seed
months 2026-03/2026-04 always use factor 1.0 (protocol parity).

Candidate calibration structures (all applied to the fixed-formula p1 lambda):
  S0_raw        factor 1.0 (pass-1 baseline)
  S1_month      single k_factor, expanding window, monthly refit (== published p2)
  S1_daily      single k_factor, expanding window, DAILY refit (p2d analog;
                seed until >=300 train rows with actuals)
  S1_trail28    single k_factor, trailing-28-day window, monthly refit
                (>=200 train rows else expanding fallback)
  S2_line       k_factor per book-line bucket (<=4.5 / 5.0-5.5 / >=6.0),
                monthly expanding; bucket needs >=100 train rows else global
  S3_k9         k_factor per as-of K/9 tier (<8.0 / 8.0-9.5 / >9.5), same rules
  S4_src        k_factor per pitcher-stat source (2026-asof vs 2025-prior vs
                league-default), same rules
  S5_ip         two-stage: IP factor g = sum(actualOuts)/sum(3*ip_expected) on
                train, then residual k on IP-corrected lambda (monthly expanding)
  S6_affine     lambda' = a*lambda + b, OLS on train (monthly expanding)
  S7_ump        S1_month with the (currently unused) umpire kModifier applied
  S8_negbin     S1_month means, Negative-Binomial probabilities with dispersion
                r fitted on train (pooled moment estimator), monthly expanding
  S9_ip_daily   S5_ip with daily refit (minimal recommended structure candidate)

Grading mirrors tools/replay/calibrate_and_grade.py::grade_k_prop and the
Phase-7 gate (tools/gate-eval.mjs): actual = substrate starter Ks; grading line
= replay line else live book line; push excluded; P(over) push-conditioned
Poisson (pass-2 convention); gate window May-Jul, MIN_N 300, Brier baseline
0.25, bias band +/-0.15 K.

Outputs (granular/kprops/):
  kprops-reinforcer-fits.csv               fitted params per structure/period
  kprops-reinforcer-structure-monthly.csv  per-structure per-month metrics
  kprops-reinforcer-structure-gate.csv     gate simulation May-Jul per structure
  kprops-reinforcer-residual-slices.csv    S0/S1 residual bias slices
  kprops-reinforcer-ip-calibration.csv     ip_expected vs realized outs
  kprops-reinforcer-bias-decomposition.csv IP-term vs rate-term of the bias
  kprops-reinforcer-dispersion.csv         Poisson dispersion diagnostics
"""
from __future__ import annotations

import csv
import math
import os
import sys
from collections import defaultdict

import numpy as np
from scipy.stats import nbinom, poisson

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, "..", "kprops"))
POP = os.path.join(OUT, "kprops-reinforcer-population.csv")

SEED_MONTHS = {"2026-03", "2026-04"}
MONTHS = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07"]
EVAL_MONTHS = ["2026-05", "2026-06", "2026-07"]  # gate window
GATE_MIN_N = 300
GATE_BIAS_BAND = 0.15
DAILY_MIN_TRAIN = 300
TRAIL_DAYS = 28
TRAIL_MIN = 200
BUCKET_MIN = 100

EPS = 1e-9


def fnum(v):
    if v is None or v == "":
        return None
    try:
        return float(v)
    except ValueError:
        return None


def load_rows():
    with open(POP) as f:
        rows = list(csv.DictReader(f))
    out = []
    for r in rows:
        d = dict(r)
        for c in ("projValue_p1", "pOver_p1", "line", "projValue_p2", "pOver_p2",
                  "actualKs", "actualOuts", "live_kProj", "live_bookLine",
                  "live_actualKs", "pitcher_k9_blend", "xfip_adj", "opp_adj",
                  "ip_expected", "ip_expected_raw", "umpire_k_mod",
                  "book_line_re", "lam_re", "ip_2026"):
            d[c] = fnum(r.get(c))
        d["month"] = r["month"]
        d["gameDate"] = r["gameDate"]
        # grading line rule (calibrate_and_grade): replay line else live line
        d["grade_line"] = d["line"] if d["line"] is not None else d["live_bookLine"]
        out.append(d)
    return out


def p_over_cond(mu, line):
    """Push-conditioned Poisson P(over) — pass-2 convention."""
    if mu is None or line is None:
        return None
    mu = max(0.05, mu)
    if abs(line - round(line)) < 1e-9:
        li = int(round(line))
        p_push = float(poisson.pmf(li, mu))
        p_over = float(1.0 - poisson.cdf(li, mu))
        den = 1.0 - p_push
        return p_over / den if den > 0 else 0.5
    return float(1.0 - poisson.cdf(math.floor(line), mu))


def p_over_cond_nb(mu, line, r):
    """Push-conditioned Negative-Binomial P(over), size r, mean mu."""
    if mu is None or line is None:
        return None
    mu = max(0.05, mu)
    p = r / (r + mu)
    if abs(line - round(line)) < 1e-9:
        li = int(round(line))
        p_push = float(nbinom.pmf(li, r, p))
        po = float(1.0 - nbinom.cdf(li, r, p))
        den = 1.0 - p_push
        return po / den if den > 0 else 0.5
    return float(1.0 - nbinom.cdf(math.floor(line), r, p))


def mean_ci(xs):
    xs = np.asarray(xs, dtype=float)
    if len(xs) == 0:
        return None, None
    m = float(xs.mean())
    if len(xs) < 2:
        return m, None
    ci = 1.96 * float(xs.std(ddof=1)) / math.sqrt(len(xs))
    return m, ci


# ── bucket helpers ──────────────────────────────────────────────────────────

def line_bucket(line):
    if line is None:
        return "noline"
    if line <= 4.5:
        return "le4.5"
    if line <= 5.5:
        return "5.0-5.5"
    return "ge6.0"


def k9_tier(k9):
    if k9 is None:
        return "na"
    if k9 < 8.0:
        return "lt8.0"
    if k9 <= 9.5:
        return "8.0-9.5"
    return "gt9.5"


def src_group(src):
    if not src:
        return "na"
    if src.startswith("2026"):
        return "2026-asof"
    if src == "2025-prior":
        return "2025-prior"
    return "league-default"


# ── walk-forward factor machinery ───────────────────────────────────────────

def ratio_of_means(train):
    ps = sum(t["projValue_p1"] for t in train)
    as_ = sum(t["actualKs"] for t in train)
    return (as_ / ps) if ps > 0 else 1.0


def fit_structures(rows):
    """Return dict: structure -> {rowIndex -> lambda'} plus fitted-param log,
    and probability overrides for S8 (NegBin)."""
    idx_all = list(range(len(rows)))
    with_actual = [i for i in idx_all if rows[i]["actualKs"] is not None
                   and rows[i]["projValue_p1"] is not None]
    by_month_train = {m: [i for i in with_actual if rows[i]["month"] < m]
                      for m in MONTHS}
    fits = []          # param log rows
    lam = {}           # structure -> np.array of lambda' (None -> np.nan)
    n = len(rows)

    def base_lam():
        return np.array([rows[i]["projValue_p1"] if rows[i]["projValue_p1"]
                         is not None else np.nan for i in idx_all])

    lam0 = base_lam()

    # S0
    lam["S0_raw"] = lam0.copy()

    # S1_month (replicates p2)
    f_month = {}
    lam1 = lam0.copy()
    for m in MONTHS:
        if m in SEED_MONTHS:
            f_month[m] = 1.0
        else:
            train = [rows[i] for i in by_month_train[m]]
            f_month[m] = ratio_of_means(train)
        fits.append({"structure": "S1_month", "period": m, "param": "k_factor",
                     "value": round(f_month[m], 5),
                     "n_train": 0 if m in SEED_MONTHS else len(by_month_train[m])})
    for i in idx_all:
        lam1[i] = lam0[i] * f_month[rows[i]["month"]]
    lam["S1_month"] = lam1

    # S1_daily
    dates = sorted({rows[i]["gameDate"] for i in idx_all})
    lam1d = lam0.copy()
    train_pool = []
    by_date = defaultdict(list)
    for i in with_actual:
        by_date[rows[i]["gameDate"]].append(i)
    all_by_date = defaultdict(list)
    for i in idx_all:
        all_by_date[rows[i]["gameDate"]].append(i)
    n_seed_daily = 0
    for d in dates:
        if len(train_pool) >= DAILY_MIN_TRAIN:
            f = ratio_of_means([rows[i] for i in train_pool])
        else:
            f = 1.0
            n_seed_daily += len(all_by_date[d])
        for i in all_by_date[d]:
            lam1d[i] = lam0[i] * f
        train_pool.extend(by_date[d])
    fits.append({"structure": "S1_daily", "period": "rule", "param": "seed_until",
                 "value": DAILY_MIN_TRAIN, "n_train": n_seed_daily})
    lam["S1_daily"] = lam1d

    # S1_trail28
    lam1t = lam0.copy()
    for m in MONTHS:
        if m in SEED_MONTHS:
            f = 1.0
            nt = 0
        else:
            m_start = f"{m}-01"
            import datetime as _dt
            d0 = _dt.date.fromisoformat(m_start) - _dt.timedelta(days=TRAIL_DAYS)
            trail = [i for i in by_month_train[m]
                     if rows[i]["gameDate"] >= d0.isoformat()]
            if len(trail) >= TRAIL_MIN:
                f = ratio_of_means([rows[i] for i in trail])
                nt = len(trail)
            else:
                f = ratio_of_means([rows[i] for i in by_month_train[m]])
                nt = len(by_month_train[m])
        fits.append({"structure": "S1_trail28", "period": m, "param": "k_factor",
                     "value": round(f, 5), "n_train": nt})
        for i in all_by_date_month(rows, idx_all, m):
            lam1t[i] = lam0[i] * f
    lam["S1_trail28"] = lam1t

    # S2_line / S3_k9 / S4_src — grouped monthly expanding factors
    for name, keyer in (("S2_line", lambda r: line_bucket(r["grade_line"])),
                        ("S3_k9", lambda r: k9_tier(r["pitcher_k9_blend"])),
                        ("S4_src", lambda r: src_group(r["src"]))):
        lam_s = lam0.copy()
        for m in MONTHS:
            month_rows = all_by_date_month(rows, idx_all, m)
            if m in SEED_MONTHS:
                for i in month_rows:
                    lam_s[i] = lam0[i] * 1.0
                continue
            train_idx = by_month_train[m]
            glob = ratio_of_means([rows[i] for i in train_idx])
            groups = defaultdict(list)
            for i in train_idx:
                groups[keyer(rows[i])].append(rows[i])
            fac = {}
            for gkey, grp in groups.items():
                fac[gkey] = ratio_of_means(grp) if len(grp) >= BUCKET_MIN else glob
                fits.append({"structure": name, "period": m,
                             "param": f"k_factor[{gkey}]",
                             "value": round(fac[gkey], 5), "n_train": len(grp)})
            fits.append({"structure": name, "period": m, "param": "k_factor[global]",
                         "value": round(glob, 5), "n_train": len(train_idx)})
            for i in month_rows:
                lam_s[i] = lam0[i] * fac.get(keyer(rows[i]), glob)
        lam[name] = lam_s

    # S5_ip (monthly) and S9_ip_daily
    def ip_factor(train_rows):
        num_ = sum(r["actualOuts"] for r in train_rows if r["actualOuts"] is not None
                   and r["ip_expected"] is not None)
        den_ = sum(3.0 * r["ip_expected"] for r in train_rows
                   if r["actualOuts"] is not None and r["ip_expected"] is not None)
        return (num_ / den_) if den_ > 0 else 1.0

    lam5 = lam0.copy()
    for m in MONTHS:
        month_rows = all_by_date_month(rows, idx_all, m)
        if m in SEED_MONTHS:
            continue
        train_rows = [rows[i] for i in by_month_train[m]]
        g = ip_factor(train_rows)
        # residual k on IP-corrected lambda over the same train rows
        ps = sum(t["projValue_p1"] * g for t in train_rows)
        as_ = sum(t["actualKs"] for t in train_rows)
        f = (as_ / ps) if ps > 0 else 1.0
        fits.append({"structure": "S5_ip", "period": m, "param": "ip_factor",
                     "value": round(g, 5), "n_train": len(train_rows)})
        fits.append({"structure": "S5_ip", "period": m, "param": "resid_k",
                     "value": round(f, 5), "n_train": len(train_rows)})
        for i in month_rows:
            lam5[i] = lam0[i] * g * f
    lam["S5_ip"] = lam5

    lam9 = lam0.copy()
    train_pool = []
    for d in dates:
        if len(train_pool) >= DAILY_MIN_TRAIN:
            tr = [rows[i] for i in train_pool]
            g = ip_factor(tr)
            ps = sum(t["projValue_p1"] * g for t in tr)
            as_ = sum(t["actualKs"] for t in tr)
            f = (as_ / ps) if ps > 0 else 1.0
        else:
            g = f = 1.0
        for i in all_by_date[d]:
            lam9[i] = lam0[i] * g * f
        train_pool.extend(by_date[d])
    lam["S9_ip_daily"] = lam9

    # S6_affine (monthly expanding OLS actual ~ lambda)
    lam6 = lam0.copy()
    for m in MONTHS:
        month_rows = all_by_date_month(rows, idx_all, m)
        if m in SEED_MONTHS:
            continue
        tr = [rows[i] for i in by_month_train[m]]
        x = np.array([t["projValue_p1"] for t in tr])
        y = np.array([t["actualKs"] for t in tr])
        if len(x) >= 50:
            b, a = np.polyfit(x, y, 1)
        else:
            a, b = 0.0, 1.0
        fits.append({"structure": "S6_affine", "period": m, "param": "slope",
                     "value": round(float(b), 5), "n_train": len(tr)})
        fits.append({"structure": "S6_affine", "period": m, "param": "intercept",
                     "value": round(float(a), 5), "n_train": len(tr)})
        for i in month_rows:
            lam6[i] = max(0.1, b * lam0[i] + a)
    lam["S6_affine"] = lam6

    # S7_ump: umpire modifier applied, residual k refit on train WITH ump applied
    lam7 = lam0.copy()
    ump = np.array([rows[i]["umpire_k_mod"] if rows[i]["umpire_k_mod"] is not None
                    else 1.0 for i in idx_all])
    for m in MONTHS:
        month_rows = all_by_date_month(rows, idx_all, m)
        if m in SEED_MONTHS:
            for i in month_rows:
                lam7[i] = lam0[i] * ump[i]
            continue
        tr_idx = by_month_train[m]
        ps = sum(rows[i]["projValue_p1"] * (rows[i]["umpire_k_mod"] or 1.0)
                 for i in tr_idx)
        as_ = sum(rows[i]["actualKs"] for i in tr_idx)
        f = (as_ / ps) if ps > 0 else 1.0
        fits.append({"structure": "S7_ump", "period": m, "param": "k_factor",
                     "value": round(f, 5), "n_train": len(tr_idx)})
        for i in month_rows:
            lam7[i] = lam0[i] * ump[i] * f
    lam["S7_ump"] = lam7

    # S8_negbin: same means as S1_month; dispersion r fitted walk-forward
    r_month = {}
    for m in MONTHS:
        if m in SEED_MONTHS:
            r_month[m] = None  # Poisson in seed months
            continue
        tr_idx = by_month_train[m]
        mus = np.array([rows[i]["projValue_p1"] * f_month[m] for i in tr_idx])
        ys = np.array([rows[i]["actualKs"] for i in tr_idx])
        num_ = float((mus ** 2).sum())
        den_ = float(((ys - mus) ** 2 - mus).sum())
        r_month[m] = (num_ / den_) if den_ > 1e-6 else None
        fits.append({"structure": "S8_negbin", "period": m, "param": "r_dispersion",
                     "value": round(r_month[m], 3) if r_month[m] else None,
                     "n_train": len(tr_idx)})
    lam["S8_negbin"] = lam["S1_month"].copy()

    return lam, fits, f_month, r_month


def all_by_date_month(rows, idx_all, m):
    return [i for i in idx_all if rows[i]["month"] == m]


# ── metric computation ──────────────────────────────────────────────────────

def compute_metrics(rows, lam_arr, months, prob_fn=None, r_month=None):
    """Metrics over the given months. prob_fn(mu, line, month) -> p_over."""
    if prob_fn is None:
        prob_fn = lambda mu, line, m: p_over_cond(mu, line)  # noqa: E731
    errs_all, errs_graded, hits, briers, probs_y = [], [], [], [], []
    n_push = 0
    for i, r in enumerate(rows):
        if r["month"] not in months:
            continue
        mu = lam_arr[i]
        if not np.isfinite(mu) or r["actualKs"] is None:
            continue
        errs_all.append(mu - r["actualKs"])
        line = r["grade_line"]
        if line is None:
            continue
        aks = r["actualKs"]
        if abs(aks - line) < 1e-9:
            n_push += 1
            continue
        y = 1 if aks > line else 0
        po = prob_fn(mu, line, r["month"])
        pick = 1 if (po is not None and po > 0.5) else 0
        hits.append(1 if pick == y else 0)
        errs_graded.append(mu - aks)
        if po is not None:
            briers.append((po - y) ** 2)
            probs_y.append((po, y))
    out = {}
    out["n_actual"], (out["bias_all"], out["bias_all_ci"]) = len(errs_all), mean_ci(errs_all)
    out["mae_all"] = float(np.mean(np.abs(errs_all))) if errs_all else None
    out["n_graded"] = len(errs_graded)
    out["n_push"] = n_push
    out["bias_graded"], out["bias_graded_ci"] = mean_ci(errs_graded)
    out["mae_graded"] = float(np.mean(np.abs(errs_graded))) if errs_graded else None
    out["hit"], out["hit_ci"] = mean_ci(hits)
    out["brier"], _ = mean_ci(briers)
    out["n_brier"] = len(briers)
    if briers:
        skills = [0.25 - b for b in briers]
        out["skill"], out["skill_ci"] = mean_ci(skills)
        ll = [-(y * math.log(max(p, 1e-12)) + (1 - y) * math.log(max(1 - p, 1e-12)))
              for p, y in probs_y]
        out["logloss"] = float(np.mean(ll))
    else:
        out["skill"] = out["skill_ci"] = out["logloss"] = None
    # reliability (gate rule: 5 bins, n>=25, inversion if obs drops >0.05)
    bins = [{"n": 0, "p": 0.0, "y": 0.0} for _ in range(5)]
    for p, y in probs_y:
        b = min(4, int(p * 5))
        bins[b]["n"] += 1
        bins[b]["p"] += p
        bins[b]["y"] += y
    used = [(b["p"] / b["n"], b["y"] / b["n"], b["n"]) for b in bins if b["n"] >= 25]
    inversions = sum(1 for j in range(1, len(used))
                     if used[j][1] < used[j - 1][1] - 0.05)
    out["reliability"] = " ".join(f"{p:.2f}->{o:.2f}(n={n_})" for p, o, n_ in used)
    out["inversions"] = inversions
    return out


def gate_verdict(mm):
    reasons = []
    if mm["n_graded"] < GATE_MIN_N:
        reasons.append(f"n {mm['n_graded']} < {GATE_MIN_N}")
    skill_ok = mm["skill"] is not None and mm["skill"] >= 0
    baseline_ok = (mm["skill"] is not None and mm["skill_ci"] is not None
                   and mm["skill"] - mm["skill_ci"] > 0)
    if not baseline_ok:
        reasons.append("skill CI does not exclude zero")
    if not skill_ok:
        reasons.append("negative Brier skill vs 0.25")
    rel_ok = mm["inversions"] == 0
    if not rel_ok:
        reasons.append(f"reliability inversions: {mm['inversions']}")
    bias_ok = True
    if mm["bias_graded"] is not None:
        b, ci = mm["bias_graded"], (mm["bias_graded_ci"] or 0)
        bias_ok = abs(b) <= GATE_BIAS_BAND or abs(b) - ci <= 0
        if not bias_ok:
            reasons.append(f"bias {b:.3f} outside +/-{GATE_BIAS_BAND}")
    verdict = ("PUBLISH" if (mm["n_graded"] >= GATE_MIN_N and baseline_ok and skill_ok
                             and rel_ok and bias_ok) else "BACKTEST-ONLY")
    return verdict, "; ".join(reasons)


def main():
    rows = load_rows()
    print(f"[load] population rows={len(rows)}")
    n_actual = sum(1 for r in rows if r["actualKs"] is not None)
    n_line = sum(1 for r in rows if r["line"] is not None)
    n_gline = sum(1 for r in rows if r["grade_line"] is not None)
    print(f"[load] with_actual={n_actual} replay_line={n_line} grade_line={n_gline}")

    lam, fits, f_month, r_month = fit_structures(rows)

    # fidelity: S1_month factors vs published calibMeta factors
    print("[fidelity] S1_month k_factors:",
          {m: round(f_month[m], 5) for m in MONTHS})
    # fidelity: stored p2 == p1 * k_factor(month)
    diffs = []
    for i, r in enumerate(rows):
        if r["projValue_p1"] is not None and r["projValue_p2"] is not None:
            diffs.append(abs(r["projValue_p1"] * f_month[r["month"]] - r["projValue_p2"]))
    print(f"[fidelity] p2 projValue reproduction: max_abs_diff={max(diffs):.5f} "
          f"n={len(diffs)}")

    # structure metrics
    monthly_rows, gate_rows = [], []
    for name, arr in lam.items():
        prob_fn = None
        if name == "S8_negbin":
            def prob_fn(mu, line, m, _r=r_month):  # noqa: E731
                r_ = _r.get(m)
                return p_over_cond(mu, line) if r_ is None else p_over_cond_nb(mu, line, r_)
        for m in MONTHS:
            mm = compute_metrics(rows, arr, [m], prob_fn)
            mm.update({"structure": name, "period": m})
            monthly_rows.append(mm)
        mm = compute_metrics(rows, arr, EVAL_MONTHS, prob_fn)
        mm.update({"structure": name, "period": "MayJul"})
        monthly_rows.append(mm)
        verdict, reasons = gate_verdict(mm)
        gate_rows.append({"structure": name, "window": "2026-05-01..2026-07-24",
                          "n_graded": mm["n_graded"], "hit": r4(mm["hit"]),
                          "hit_ci": r4(mm["hit_ci"]), "brier": r5(mm["brier"]),
                          "skill": r5(mm["skill"]), "skill_ci": r5(mm["skill_ci"]),
                          "logloss": r5(mm["logloss"]),
                          "bias": r4(mm["bias_graded"]),
                          "bias_ci": r4(mm["bias_graded_ci"]),
                          "mae": r4(mm["mae_graded"]),
                          "bias_all": r4(mm["bias_all"]),
                          "inversions": mm["inversions"],
                          "reliability": mm["reliability"],
                          "verdict": verdict, "reasons": reasons})

    mcols = ["structure", "period", "n_actual", "bias_all", "bias_all_ci", "mae_all",
             "n_graded", "n_push", "bias_graded", "bias_graded_ci", "mae_graded",
             "hit", "hit_ci", "n_brier", "brier", "skill", "skill_ci", "logloss",
             "inversions", "reliability"]
    for r in monthly_rows:
        for c in mcols:
            if isinstance(r.get(c), float):
                r[c] = round(r[c], 5)
    write_csv("kprops-reinforcer-structure-monthly.csv", monthly_rows, mcols)
    write_csv("kprops-reinforcer-structure-gate.csv", gate_rows,
              ["structure", "window", "n_graded", "hit", "hit_ci", "brier", "skill",
               "skill_ci", "logloss", "bias", "bias_ci", "mae", "bias_all",
               "inversions", "reliability", "verdict", "reasons"])
    write_csv("kprops-reinforcer-fits.csv", fits,
              ["structure", "period", "param", "value", "n_train"])

    # residual slices for S0 and S1 (is a single factor structurally sufficient?)
    slice_rows = []
    for sname in ("S0_raw", "S1_month", "S1_daily"):
        arr = lam[sname]
        for dim, keyer in (("line_bucket", lambda r: line_bucket(r["grade_line"])),
                           ("k9_tier", lambda r: k9_tier(r["pitcher_k9_blend"])),
                           ("src", lambda r: src_group(r["src"])),
                           ("side", lambda r: r["side"]),
                           ("month", lambda r: r["month"]),
                           ("ump", lambda r: "mod!=1" if (r["umpire_k_mod"] or 1.0) != 1.0 else "mod=1")):
            groups = defaultdict(list)
            for i, r in enumerate(rows):
                if r["month"] in EVAL_MONTHS and r["actualKs"] is not None \
                        and np.isfinite(arr[i]):
                    groups[keyer(r)].append(arr[i] - r["actualKs"])
            for gkey, errs in sorted(groups.items()):
                m, ci = mean_ci(errs)
                slice_rows.append({"structure": sname, "window": "MayJul",
                                   "dim": dim, "bucket": gkey, "n": len(errs),
                                   "bias": r4(m), "bias_ci": r4(ci),
                                   "mae": r4(float(np.mean(np.abs(errs))))})
    write_csv("kprops-reinforcer-residual-slices.csv", slice_rows,
              ["structure", "window", "dim", "bucket", "n", "bias", "bias_ci", "mae"])

    # IP-input calibration (population-wide, rows with realized starter outs)
    ip_rows = []
    sub = [r for r in rows if r["actualOuts"] is not None and r["ip_expected"] is not None]
    x = np.array([3.0 * r["ip_expected"] for r in sub])   # expected outs
    y = np.array([r["actualOuts"] for r in sub])
    b, a = np.polyfit(x, y, 1)
    corr = float(np.corrcoef(x, y)[0, 1])
    ip_rows.append({"slice": "ALL", "n": len(sub),
                    "mean_ip_expected": r4(float(x.mean()) / 3),
                    "mean_ip_realized": r4(float(y.mean()) / 3),
                    "ratio_outs": r4(float(y.sum() / x.sum())),
                    "ols_slope": r4(float(b)), "ols_intercept_outs": r4(float(a)),
                    "corr": r4(corr)})
    for m in MONTHS:
        s2 = [r for r in sub if r["month"] == m]
        if not s2:
            continue
        x2 = np.array([3.0 * r["ip_expected"] for r in s2])
        y2 = np.array([r["actualOuts"] for r in s2])
        ip_rows.append({"slice": f"month:{m}", "n": len(s2),
                        "mean_ip_expected": r4(float(x2.mean()) / 3),
                        "mean_ip_realized": r4(float(y2.mean()) / 3),
                        "ratio_outs": r4(float(y2.sum() / x2.sum())),
                        "ols_slope": None, "ols_intercept_outs": None, "corr": None})
    for g in ("2026-asof", "2025-prior", "league-default"):
        s2 = [r for r in sub if src_group(r["src"]) == g]
        if not s2:
            continue
        x2 = np.array([3.0 * r["ip_expected"] for r in s2])
        y2 = np.array([r["actualOuts"] for r in s2])
        ip_rows.append({"slice": f"src:{g}", "n": len(s2),
                        "mean_ip_expected": r4(float(x2.mean()) / 3),
                        "mean_ip_realized": r4(float(y2.mean()) / 3),
                        "ratio_outs": r4(float(y2.sum() / x2.sum())),
                        "ols_slope": None, "ols_intercept_outs": None, "corr": None})
    # deciles of expected IP
    order = np.argsort(x)
    for q in range(10):
        seg = order[int(q * len(sub) / 10):int((q + 1) * len(sub) / 10)]
        ip_rows.append({"slice": f"decile:{q + 1}", "n": len(seg),
                        "mean_ip_expected": r4(float(x[seg].mean()) / 3),
                        "mean_ip_realized": r4(float(y[seg].mean()) / 3),
                        "ratio_outs": r4(float(y[seg].sum() / x[seg].sum())),
                        "ols_slope": None, "ols_intercept_outs": None, "corr": None})
    write_csv("kprops-reinforcer-ip-calibration.csv", ip_rows,
              ["slice", "n", "mean_ip_expected", "mean_ip_realized", "ratio_outs",
               "ols_slope", "ols_intercept_outs", "corr"])

    # bias decomposition: lambda - K = K9eff*(ip_exp - ip_real)/9  +  (K9eff*ip_real/9 - K)
    dec_rows = []
    for m in MONTHS + ["ALL"]:
        s2 = [r for r in rows if r["actualOuts"] is not None
              and r["actualKs"] is not None and r["projValue_p1"] is not None
              and r["ip_expected"] and (m == "ALL" or r["month"] == m)]
        if not s2:
            continue
        tot, ipt, rat = [], [], []
        for r in s2:
            k9eff = r["projValue_p1"] / (r["ip_expected"] / 9.0)
            ip_real = r["actualOuts"] / 3.0
            t_ip = k9eff * (r["ip_expected"] - ip_real) / 9.0
            t_rate = k9eff * ip_real / 9.0 - r["actualKs"]
            tot.append(r["projValue_p1"] - r["actualKs"])
            ipt.append(t_ip)
            rat.append(t_rate)
        dec_rows.append({"period": m, "n": len(s2),
                         "bias_total": r4(float(np.mean(tot))),
                         "bias_ip_term": r4(float(np.mean(ipt))),
                         "bias_rate_term": r4(float(np.mean(rat)))})
    write_csv("kprops-reinforcer-bias-decomposition.csv", dec_rows,
              ["period", "n", "bias_total", "bias_ip_term", "bias_rate_term"])

    # dispersion diagnostics on S1_month means (eval window)
    disp_rows = []
    arr = lam["S1_month"]
    sub_i = [i for i, r in enumerate(rows) if r["month"] in EVAL_MONTHS
             and r["actualKs"] is not None and np.isfinite(arr[i])]
    mus = np.array([arr[i] for i in sub_i])
    ys = np.array([rows[i]["actualKs"] for i in sub_i])
    pooled_r = float((mus ** 2).sum() / max(((ys - mus) ** 2 - mus).sum(), 1e-9))
    disp_rows.append({"bucket": "ALL", "n": len(sub_i),
                      "mean_mu": r4(float(mus.mean())),
                      "var_resid": r4(float(((ys - mus) ** 2).mean())),
                      "dispersion_index": r4(float(((ys - mus) ** 2).mean() / mus.mean())),
                      "pooled_r": r4(pooled_r)})
    qs = np.quantile(mus, [0.25, 0.5, 0.75])
    labels = [f"mu<= {qs[0]:.2f}", f"mu {qs[0]:.2f}-{qs[1]:.2f}",
              f"mu {qs[1]:.2f}-{qs[2]:.2f}", f"mu> {qs[2]:.2f}"]
    edges = [-np.inf, *qs, np.inf]
    for j in range(4):
        sel = (mus > edges[j]) & (mus <= edges[j + 1])
        if sel.sum() < 10:
            continue
        disp_rows.append({"bucket": labels[j], "n": int(sel.sum()),
                          "mean_mu": r4(float(mus[sel].mean())),
                          "var_resid": r4(float(((ys[sel] - mus[sel]) ** 2).mean())),
                          "dispersion_index": r4(float(((ys[sel] - mus[sel]) ** 2).mean()
                                                       / mus[sel].mean())),
                          "pooled_r": None})
    write_csv("kprops-reinforcer-dispersion.csv", disp_rows,
              ["bucket", "n", "mean_mu", "var_resid", "dispersion_index", "pooled_r"])

    print("[done]")


def r4(v):
    return None if v is None else round(float(v), 4)


def r5(v):
    return None if v is None else round(float(v), 5)


def write_csv(name, rows, cols):
    path = os.path.join(OUT, name)
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(cols)
        for r in rows:
            w.writerow([r.get(c) for c in cols])
    print(f"[out] {path}  rows={len(rows)}")


if __name__ == "__main__":
    sys.exit(main())
