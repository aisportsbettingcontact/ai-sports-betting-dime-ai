#!/usr/bin/env python3
"""kprops-modeler-02-verify.py — MODELER verification, kprops market group.

Consumes the CSVs written by kprops-modeler-01-extract.py (full population, no
sampling) and verifies, for EVERY row:

A. Line-anchoring: OLS regression projValue ~ line per month for every replay
   series, vs live kProj ~ bookLine per month (the live "anchor R^2").
B. Poisson correctness of pOver for EVERY replay K prop row:
   - pass-1 series (-p1): pOver must equal round(clamp(1 - PoissonCDF(floor(line), mu),
     .03, .85), 5) with mu = projValue. Because the DB stores mu at 4dp while the
     writer used the unrounded lambda, the check is interval-based:
     stored must lie in [f(mu-5e-5), f(mu+5e-5)] +/- 5.01e-6 (DECIMAL(7,5) storage
     rounding). Strict |diff| > 1e-6 counts are ALSO reported at the recomputed
     point mu = stored projValue.
   - calibrated series (-p2 monthly / -p2d daily): mu2 = p1.projValue * k_factor(period)
     (both stored exactly: DECIMAL(7,4) and calibMeta 5dp — the writer used these
     same stored values, so recomputation is exact up to DECIMAL(7,5) rounding).
     pOver must equal poisson_over_prob(mu2, line): integer lines renormalized
     push-excluded (1-CDF(l))/(1-PMF(l)), half lines 1-CDF(floor(line)), mu2
     floored at 0.05, NO probability clamp. Line None -> passthrough of p1 pOver.
C. Row-wise p2 factor application: p2.projValue == p1.projValue * k_factor(period)
   within DECIMAL(7,4) storage rounding, for EVERY calibrated row.
D. Structural checks: pOver NULL iff line NULL (p1); p2 line == p1 line; 1:1 join
   between passes; clamp-saturation census; p1-vs-p2 push-convention divergence.

Outputs (granular/kprops/):
  kprops-modeler-line-anchor.csv        per series x month regression
  kprops-modeler-replay-recompute.csv   per-row recompute for every replay row
  kprops-modeler-poisson-summary.csv    per series verification tallies
  kprops-modeler-poisson-violations.csv rows failing the rounding-aware bound
  kprops-modeler-p2-factor-check.csv    per period row-wise factor verification
  kprops-modeler-aggregates.json        headline numbers used in the report
"""
from __future__ import annotations

import csv
import json
import math
import os
import sys
from collections import defaultdict

import numpy as np
from scipy.stats import poisson

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, "..", "kprops"))

K_MIN_P, K_MAX_P = 0.03, 0.85
MU_Q = 5.01e-5      # DECIMAL(7,4) storage quantization of projValue (half-away rounding)
P_Q = 5.01e-6       # DECIMAL(7,5) storage quantization of pOver
STRICT = 1e-6


def num(v):
    if v is None or v == "" or v == "\\N":
        return None
    try:
        return float(v)
    except ValueError:
        return None


def load(name):
    with open(os.path.join(OUT, name), newline="") as f:
        return list(csv.DictReader(f))


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


# ── formula replicas (scipy) ─────────────────────────────────────────────────
def p1_pover(mu, line):
    """Pass-1 / fixed live service: clamp(1 - CDF(floor(line), mu), .03, .85)."""
    return clamp(1.0 - float(poisson.cdf(math.floor(line), mu)), K_MIN_P, K_MAX_P)


def p2_pover(mu, line):
    """calibrate_and_grade.poisson_over_prob: push-excluded renormalized, no clamp."""
    if mu is None or line is None:
        return None
    mu = max(0.05, mu)
    if abs(line - round(line)) < 1e-9:
        li = int(round(line))
        p_push = float(poisson.pmf(li, mu))
        p_over = float(1.0 - poisson.cdf(li, mu))
        denom = 1.0 - p_push
        return p_over / denom if denom > 0 else 0.5
    return float(1.0 - poisson.cdf(math.floor(line), mu))


def ols(x, y):
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    n = len(x)
    if n < 3 or np.std(x) == 0 or np.std(y) == 0:
        return {"n": n, "slope": None, "intercept": None, "r2": None}
    slope, intercept = np.polyfit(x, y, 1)
    r = float(np.corrcoef(x, y)[0, 1])
    return {"n": n, "slope": round(float(slope), 4),
            "intercept": round(float(intercept), 4), "r2": round(r * r, 4)}


def month_of(d):
    return str(d)[:7]


def main() -> int:
    live = load("kprops-modeler-live-props.csv")
    replay = load("kprops-modeler-replay-props.csv")
    kfacts = load("kprops-modeler-kfactors.csv")
    games = load("kprops-modeler-games.csv")

    agg = {"population_finals": len(games),
           "live_rows": len(live), "replay_rows": len(replay)}

    versions = sorted({r["modelVersion"] for r in replay})
    agg["replay_versions"] = {v: sum(1 for r in replay if r["modelVersion"] == v)
                              for v in versions}

    # k_factor lookup: {(modelVersion, period): factor}
    kf = {}
    for r in kfacts:
        kf[(r["modelVersion"], r["period"])] = num(r["k_factor"])
    agg["k_factors"] = {f"{k[0]}|{k[1]}": v for k, v in sorted(kf.items())}
    agg["k_factor_conflicts"] = sum(int(r["k_factor_conflict"] or 0) for r in kfacts)

    # ── A. line-anchor regressions ───────────────────────────────────────────
    anchor_rows = []
    live_pairs_by_m = defaultdict(list)
    for r in live:
        k, b = num(r["kProj"]), num(r["bookLine"])
        if k is not None and b is not None:
            live_pairs_by_m[month_of(r["gameDate"])].append((b, k))
    for m in sorted(live_pairs_by_m):
        pairs = live_pairs_by_m[m]
        res = ols([p[0] for p in pairs], [p[1] for p in pairs])
        anchor_rows.append({"series": "live", "month": m, **res})
    all_live = [p for m in live_pairs_by_m for p in live_pairs_by_m[m]]
    anchor_rows.append({"series": "live", "month": "ALL",
                        **ols([p[0] for p in all_live], [p[1] for p in all_live])})

    for v in versions:
        by_m = defaultdict(list)
        for r in replay:
            if r["modelVersion"] != v:
                continue
            pv, ln = num(r["projValue"]), num(r["line"])
            if pv is not None and ln is not None:
                by_m[month_of(r["gameDate"])].append((ln, pv))
        for m in sorted(by_m):
            res = ols([p[0] for p in by_m[m]], [p[1] for p in by_m[m]])
            anchor_rows.append({"series": v, "month": m, **res})
        allv = [p for m in by_m for p in by_m[m]]
        anchor_rows.append({"series": v, "month": "ALL",
                            **ols([p[0] for p in allv], [p[1] for p in allv])})

    with open(os.path.join(OUT, "kprops-modeler-line-anchor.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["series", "month", "n", "slope", "intercept", "r2"])
        w.writeheader()
        w.writerows(anchor_rows)
    agg["anchor_r2"] = {f"{r['series']}|{r['month']}": r["r2"] for r in anchor_rows}

    # ── index p1 rows for the calibrated-series checks ───────────────────────
    p1v = [v for v in versions if v.endswith("-p1")]
    p1_idx = {}
    dup_p1 = 0
    for r in replay:
        if not r["modelVersion"].endswith("-p1"):
            continue
        key = (r["gameId"], r["mlbamId"], r["side"])
        if key in p1_idx:
            dup_p1 += 1
        p1_idx[key] = r
    agg["p1_duplicate_keys"] = dup_p1

    # ── B/C/D. per-row verification ──────────────────────────────────────────
    recompute_rows, violations = [], []
    summary = {v: {"series": v, "n": 0, "n_with_line": 0, "n_checked": 0,
                   "n_pover_null_line_null": 0, "n_pover_null_line_present": 0,
                   "n_pover_present_line_null": 0,
                   "strict_gt_1e-6": 0, "max_abs_diff": 0.0,
                   "rounding_aware_violations": 0,
                   "clamp_low": 0, "clamp_high": 0,
                   "factor_checked": 0, "factor_mismatch": 0, "max_factor_diff": 0.0,
                   "line_mismatch_vs_p1": 0, "missing_p1_partner": 0,
                   "missing_k_factor": 0}
               for v in versions}

    factor_by_period = defaultdict(lambda: {"n": 0, "max_diff": 0.0, "mismatch": 0,
                                            "ratio_min": None, "ratio_max": None})

    for r in replay:
        v = r["modelVersion"]
        s = summary[v]
        s["n"] += 1
        mu_stored = num(r["projValue"])
        line = num(r["line"])
        p_stored = num(r["pOver"])
        month = month_of(r["gameDate"])
        period = str(r["gameDate"]) if v.endswith("-p2d") else month
        is_p1 = v.endswith("-p1")

        if line is not None:
            s["n_with_line"] += 1
        if p_stored is None and line is None:
            s["n_pover_null_line_null"] += 1
        elif p_stored is None and line is not None:
            s["n_pover_null_line_present"] += 1
        elif p_stored is not None and line is None:
            s["n_pover_present_line_null"] += 1

        row_out = {"modelVersion": v, "gameId": r["gameId"], "gameDate": r["gameDate"],
                   "side": r["side"], "mlbamId": r["mlbamId"], "playerName": r["playerName"],
                   "projValue": r["projValue"], "line": r["line"], "pOver": r["pOver"],
                   "expected_pOver": None, "abs_diff": None, "check": None,
                   "mu_used": None, "k_factor": None,
                   "expected_projValue": None, "projValue_abs_diff": None}

        if is_p1:
            if mu_stored is not None and p_stored is not None and line is not None:
                s["n_checked"] += 1
                exp_center = p1_pover(mu_stored, line)
                diff = abs(p_stored - exp_center)
                s["max_abs_diff"] = max(s["max_abs_diff"], diff)
                if diff > STRICT:
                    s["strict_gt_1e-6"] += 1
                lo = p1_pover(mu_stored - 5e-5, line)
                hi = p1_pover(mu_stored + 5e-5, line)
                ok = (min(lo, hi) - P_Q) <= p_stored <= (max(lo, hi) + P_Q)
                if not ok:
                    s["rounding_aware_violations"] += 1
                if p_stored <= K_MIN_P + 1e-9:
                    s["clamp_low"] += 1
                if p_stored >= K_MAX_P - 1e-9:
                    s["clamp_high"] += 1
                row_out.update({"expected_pOver": round(exp_center, 6),
                                "abs_diff": round(diff, 8),
                                "check": "PASS" if ok else "FAIL",
                                "mu_used": mu_stored})
                if not ok:
                    violations.append(dict(row_out, reason="p1 pOver outside rounding-aware bound",
                                           bound_lo=round(min(lo, hi), 6), bound_hi=round(max(lo, hi), 6)))
        else:
            key = (r["gameId"], r["mlbamId"], r["side"])
            p1r = p1_idx.get(key)
            factor = kf.get((v, period))
            row_out["k_factor"] = factor
            if p1r is None:
                s["missing_p1_partner"] += 1
                violations.append(dict(row_out, reason="calibrated row has no p1 partner"))
            elif factor is None:
                s["missing_k_factor"] += 1
                violations.append(dict(row_out, reason=f"no k_factor for period {period}"))
            else:
                mu1 = num(p1r["projValue"])
                line1 = num(p1r["line"])
                # D: line passthrough
                if (line is None) != (line1 is None) or (
                        line is not None and abs(line - line1) > 1e-9):
                    s["line_mismatch_vs_p1"] += 1
                    violations.append(dict(row_out, reason=f"line {line} != p1 line {line1}"))
                # C: row-wise factor application on projValue
                if mu1 is not None and mu_stored is not None:
                    mu2 = mu1 * factor
                    fdiff = abs(mu_stored - mu2)
                    s["factor_checked"] += 1
                    s["max_factor_diff"] = max(s["max_factor_diff"], fdiff)
                    fp = factor_by_period[(v, period)]
                    fp["n"] += 1
                    fp["max_diff"] = max(fp["max_diff"], fdiff)
                    if mu1 > 0:
                        ratio = mu_stored / mu1
                        fp["ratio_min"] = ratio if fp["ratio_min"] is None else min(fp["ratio_min"], ratio)
                        fp["ratio_max"] = ratio if fp["ratio_max"] is None else max(fp["ratio_max"], ratio)
                    if fdiff > MU_Q:
                        s["factor_mismatch"] += 1
                        fp["mismatch"] += 1
                        violations.append(dict(row_out, expected_projValue=round(mu2, 6),
                                               projValue_abs_diff=round(fdiff, 8),
                                               reason="p2 projValue != p1 projValue * k_factor"))
                    row_out.update({"expected_projValue": round(mu2, 6),
                                    "projValue_abs_diff": round(fdiff, 8)})
                    # B: pOver recompute
                    if line is not None:
                        exp = p2_pover(mu2, line)
                        if p_stored is None:
                            s["n_pover_null_line_present"] += 0  # already counted above
                        else:
                            s["n_checked"] += 1
                            diff = abs(p_stored - exp)
                            s["max_abs_diff"] = max(s["max_abs_diff"], diff)
                            if diff > STRICT:
                                s["strict_gt_1e-6"] += 1
                            ok = diff <= P_Q
                            if not ok:
                                s["rounding_aware_violations"] += 1
                                violations.append(dict(row_out, expected_pOver=round(exp, 6),
                                                       abs_diff=round(diff, 8),
                                                       reason="p2 pOver != poisson_over_prob(p1*factor, line)"))
                            row_out.update({"expected_pOver": round(exp, 6),
                                            "abs_diff": round(diff, 8),
                                            "check": "PASS" if ok else "FAIL",
                                            "mu_used": round(mu2, 6)})
                    else:
                        # passthrough: p2 pOver must equal p1 stored pOver (both may be NULL)
                        p1p = num(p1r["pOver"])
                        if (p_stored is None) != (p1p is None) or (
                                p_stored is not None and abs(p_stored - p1p) > P_Q):
                            s["rounding_aware_violations"] += 1
                            violations.append(dict(row_out, expected_pOver=p1p,
                                                   reason="no-line passthrough pOver != p1 pOver"))
                        else:
                            s["n_checked"] += 1
                            row_out.update({"expected_pOver": p1p, "check": "PASS",
                                            "abs_diff": 0.0})
        recompute_rows.append(row_out)

    # ── outputs ──────────────────────────────────────────────────────────────
    rc_cols = ["modelVersion", "gameId", "gameDate", "side", "mlbamId", "playerName",
               "projValue", "line", "pOver", "mu_used", "k_factor", "expected_projValue",
               "projValue_abs_diff", "expected_pOver", "abs_diff", "check"]
    with open(os.path.join(OUT, "kprops-modeler-replay-recompute.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=rc_cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(recompute_rows)

    sum_cols = list(next(iter(summary.values())).keys())
    with open(os.path.join(OUT, "kprops-modeler-poisson-summary.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=sum_cols)
        w.writeheader()
        for v in versions:
            s = dict(summary[v])
            s["max_abs_diff"] = f"{s['max_abs_diff']:.2e}"
            s["max_factor_diff"] = f"{s['max_factor_diff']:.2e}"
            w.writerow(s)

    viol_cols = rc_cols + ["reason", "bound_lo", "bound_hi"]
    with open(os.path.join(OUT, "kprops-modeler-poisson-violations.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=viol_cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(violations)

    with open(os.path.join(OUT, "kprops-modeler-p2-factor-check.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["modelVersion", "period", "k_factor_calibMeta", "n_rows",
                    "max_abs_diff_projValue", "mismatches", "implied_ratio_min",
                    "implied_ratio_max"])
        for (v, period), fp in sorted(factor_by_period.items()):
            w.writerow([v, period, kf.get((v, period)), fp["n"],
                        f"{fp['max_diff']:.2e}", fp["mismatch"],
                        None if fp["ratio_min"] is None else round(fp["ratio_min"], 6),
                        None if fp["ratio_max"] is None else round(fp["ratio_max"], 6)])

    # push-convention divergence census (p1 clamp+non-renormalized vs p2 renormalized)
    int_lines = [r for r in replay if r["modelVersion"] in p1v
                 and num(r["line"]) is not None
                 and abs(num(r["line"]) - round(num(r["line"]))) < 1e-9]
    div = []
    for r in int_lines:
        mu, ln = num(r["projValue"]), num(r["line"])
        if mu is None:
            continue
        a = p1_pover(mu, ln)                      # convention used in p1 (clamped, unnormalized)
        b = p2_pover(mu, ln)                      # convention used in p2 (renormalized)
        div.append(b - a)
    agg["integer_line_rows_p1"] = len(int_lines)
    if div:
        agg["push_convention_delta_mean"] = round(float(np.mean(div)), 5)
        agg["push_convention_delta_max"] = round(float(np.max(np.abs(div))), 5)

    agg["summary"] = {v: summary[v] for v in versions}
    agg["n_violations_listed"] = len(violations)
    with open(os.path.join(OUT, "kprops-modeler-aggregates.json"), "w") as f:
        json.dump(agg, f, indent=2, default=str)

    print(json.dumps({k: v for k, v in agg.items() if k != "anchor_r2"},
                     indent=2, default=str))
    print("[done] verification complete")
    return 0


if __name__ == "__main__":
    sys.exit(main())
