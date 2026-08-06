#!/usr/bin/env python
"""nrfi-assessor-02-slices.py — NRFI ASSESSOR step 2: residual structure over every game.

Input: granular/nrfi/nrfi-assessor-features.csv (full 1,555-game population, step 1).

Emits:
  granular/nrfi/nrfi-assessor-slices.csv   — per (series x dimension x bucket) metrics:
      n, base_rate, mean_p, calib_gap (+z), Brier, Brier-skill vs slice-constant, logloss,
      hit rate on p!=0.5 picks
  granular/nrfi/nrfi-assessor-paired.csv   — paired per-game Brier deltas between series
      within every bucket (delta, SE, z), the uniformity test for "logistic beats live"
  stdout: run context + overall paired summaries

Series: live (games.modelPNrfi, 0-1), p1 (wf-19288f01-p1 prior-only fixed model),
p2 (wf-19288f01-p2 walk-forward logistic), live_clean (live minus P-001 leakage flags).
p==0.5 exactly => no pick (excluded from hit rate only; kept in Brier/logloss).
"""
from __future__ import annotations

import csv
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
AUDIT = os.path.normpath(os.path.join(HERE, "..", ".."))
NRFI_DIR = os.path.join(AUDIT, "granular", "nrfi")
IN_CSV = os.path.join(NRFI_DIR, "nrfi-assessor-features.csv")
OUT_SLICES = os.path.join(NRFI_DIR, "nrfi-assessor-slices.csv")
OUT_PAIRED = os.path.join(NRFI_DIR, "nrfi-assessor-paired.csv")

EPS = 1e-12


def f(v):
    return None if v in ("", None) else float(v)


def load():
    with open(IN_CSV, newline="") as fh:
        rows = list(csv.DictReader(fh))
    for r in rows:
        r["p_live"] = f(r["p_live"])
        r["p_p1"] = f(r["p_p1"])
        r["p_p2"] = f(r["p_p2"])
        r["actual_nrfi"] = int(r["actual_nrfi"])
        r["comb_sp_shrunk"] = f(r["comb_sp_shrunk"])
        r["comb_team_i1_rate"] = f(r["comb_team_i1_rate"])
        r["park_factor_3yr"] = f(r["park_factor_3yr"])
        r["leakage_flag"] = int(r["leakage_flag"])
        r["n_prior_missing"] = int(r["n_prior_missing"])
        for k in ("away_sp_starts26_asof", "home_sp_starts26_asof"):
            r[k] = int(r[k])
    return rows


def quantile_edges(vals, k):
    s = sorted(vals)
    return [s[int(len(s) * i / k)] for i in range(1, k)]


def bucketize(v, edges, labels):
    for e, lab in zip(edges, labels):
        if v < e:
            return lab
    return labels[-1]


def brier(p, y):
    return (p - y) ** 2


def logloss(p, y):
    p = min(max(p, EPS), 1 - EPS)
    return -(y * math.log(p) + (1 - y) * math.log(1 - p))


def slice_metrics(rows, pkey):
    sub = [r for r in rows if r[pkey] is not None]
    n = len(sub)
    if n == 0:
        return None
    ys = [r["actual_nrfi"] for r in sub]
    ps = [r[pkey] for r in sub]
    base = sum(ys) / n
    mean_p = sum(ps) / n
    br = sum(brier(p, y) for p, y in zip(ps, ys)) / n
    ll = sum(logloss(p, y) for p, y in zip(ps, ys)) / n
    br_const = base * (1 - base)  # Brier of the slice-constant forecast
    picks = [(p, y) for p, y in zip(ps, ys) if abs(p - 0.5) > 1e-9]
    hits = sum(1 for p, y in picks if (p > 0.5) == (y == 1))
    gap = mean_p - base
    gap_se = math.sqrt(max(base * (1 - base), 1e-9) / n)
    return {
        "n": n, "base_rate": round(base, 5), "mean_p": round(mean_p, 5),
        "calib_gap": round(gap, 5), "calib_gap_z": round(gap / gap_se, 2),
        "brier": round(br, 6), "brier_const_slice": round(br_const, 6),
        "brier_skill": round(br_const - br, 6),
        "logloss": round(ll, 6),
        "n_picks": len(picks), "hits": hits,
        "hit_rate": round(hits / len(picks), 5) if picks else "",
    }


def paired_delta(rows, pkey_a, pkey_b):
    sub = [r for r in rows if r[pkey_a] is not None and r[pkey_b] is not None]
    n = len(sub)
    if n < 2:
        return None
    diffs = [brier(r[pkey_a], r["actual_nrfi"]) - brier(r[pkey_b], r["actual_nrfi"]) for r in sub]
    mean = sum(diffs) / n
    var = sum((d - mean) ** 2 for d in diffs) / (n - 1)
    se = math.sqrt(var / n)
    ba = sum(brier(r[pkey_a], r["actual_nrfi"]) for r in sub) / n
    bb = sum(brier(r[pkey_b], r["actual_nrfi"]) for r in sub) / n
    return {"n": n, "brier_a": round(ba, 6), "brier_b": round(bb, 6),
            "delta_a_minus_b": round(mean, 6), "se": round(se, 6),
            "z": round(mean / se, 2) if se > 0 else ""}


def main():
    rows = load()
    assert len(rows) == 1555, f"population drift: {len(rows)}"

    # bucket definitions (population-wide quantiles; edges recorded in the CSV labels)
    sp_edges = quantile_edges([r["comb_sp_shrunk"] for r in rows], 5)
    ti_edges = quantile_edges([r["comb_team_i1_rate"] for r in rows], 5)
    pf_edges = quantile_edges([r["park_factor_3yr"] for r in rows if r["park_factor_3yr"]], 3)

    def sp_lab():
        e = ["%.3f" % x for x in sp_edges]
        return [f"Q1<{e[0]}", f"Q2[{e[0]},{e[1]})", f"Q3[{e[1]},{e[2]})",
                f"Q4[{e[2]},{e[3]})", f"Q5>={e[3]}"]

    def ti_lab():
        e = ["%.3f" % x for x in ti_edges]
        return [f"Q1<{e[0]}", f"Q2[{e[0]},{e[1]})", f"Q3[{e[1]},{e[2]})",
                f"Q4[{e[2]},{e[3]})", f"Q5>={e[3]}"]

    pf_labels = [f"low<{pf_edges[0]:.3f}", f"mid[{pf_edges[0]:.3f},{pf_edges[1]:.3f})",
                 f"high>={pf_edges[1]:.3f}"]

    def dim_value(r, dim):
        if dim == "month":
            return r["month"]
        if dim == "sp_shrunk_bucket":
            return bucketize(r["comb_sp_shrunk"], sp_edges, sp_lab())
        if dim == "team_i1_bucket":
            return bucketize(r["comb_team_i1_rate"], ti_edges, ti_lab())
        if dim == "park":
            return r["home"]
        if dim == "park_factor_bucket":
            return (bucketize(r["park_factor_3yr"], pf_edges, pf_labels)
                    if r["park_factor_3yr"] is not None else "unknown")
        if dim == "hand_pair":
            return r["hand_pair"]
        if dim == "day_night":
            return r["day_night"] or "unknown"
        if dim == "n_prior_missing":
            return str(r["n_prior_missing"])
        if dim == "min_sp_starts26":
            m = min(r["away_sp_starts26_asof"], r["home_sp_starts26_asof"])
            return "0" if m == 0 else ("1-4" if m <= 4 else ("5-9" if m <= 9 else "10+"))
        if dim == "ALL":
            return "ALL"
        raise ValueError(dim)

    dims = ["ALL", "month", "sp_shrunk_bucket", "team_i1_bucket", "park",
            "park_factor_bucket", "hand_pair", "day_night", "n_prior_missing",
            "min_sp_starts26"]
    series = [("live", "p_live", None), ("p1", "p_p1", None), ("p2", "p_p2", None),
              ("live_clean", "p_live", "clean")]

    slice_rows = []
    for dim in dims:
        buckets = {}
        for r in rows:
            buckets.setdefault(dim_value(r, dim), []).append(r)
        for bucket in sorted(buckets):
            for sname, pkey, filt in series:
                sub = buckets[bucket]
                if filt == "clean":
                    sub = [r for r in sub if r["leakage_flag"] == 0]
                m = slice_metrics(sub, pkey)
                if m:
                    slice_rows.append({"series": sname, "dimension": dim,
                                       "bucket": bucket, **m})

    with open(OUT_SLICES, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(slice_rows[0].keys()))
        w.writeheader()
        w.writerows(slice_rows)

    # paired comparisons within every bucket
    comps = [("live_vs_p2", "p_live", "p_p2", None),
             ("live_vs_p1", "p_live", "p_p1", None),
             ("p1_vs_p2", "p_p1", "p_p2", None),
             ("live_clean_vs_p2", "p_live", "p_p2", "clean")]
    paired_rows = []
    for dim in dims:
        buckets = {}
        for r in rows:
            buckets.setdefault(dim_value(r, dim), []).append(r)
        for bucket in sorted(buckets):
            for cname, ka, kb, filt in comps:
                sub = buckets[bucket]
                if filt == "clean":
                    sub = [r for r in sub if r["leakage_flag"] == 0]
                d = paired_delta(sub, ka, kb)
                if d:
                    paired_rows.append({"comparison": cname, "dimension": dim,
                                        "bucket": bucket, **d})
    with open(OUT_PAIRED, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(paired_rows[0].keys()))
        w.writeheader()
        w.writerows(paired_rows)

    # stdout summary: overall paired + uniformity scan
    overall = {c["comparison"]: c for c in paired_rows if c["dimension"] == "ALL"}
    uniformity = {}
    for cname, _, _, _ in comps:
        rows_c = [p for p in paired_rows
                  if p["comparison"] == cname and p["dimension"] != "ALL"
                  and p["dimension"] != "park" and p["n"] >= 40]
        pos = sum(1 for p in rows_c if p["delta_a_minus_b"] > 0)
        sig_pos = sum(1 for p in rows_c if p["z"] != "" and p["z"] >= 1.96)
        sig_neg = sum(1 for p in rows_c if p["z"] != "" and p["z"] <= -1.96)
        uniformity[cname] = {"n_buckets(n>=40, ex-park)": len(rows_c),
                             "delta>0 (a worse)": pos,
                             "sig z>=1.96": sig_pos, "sig z<=-1.96": sig_neg}
    print(json.dumps({
        "n_slice_rows": len(slice_rows), "n_paired_rows": len(paired_rows),
        "bucket_edges": {"comb_sp_shrunk": sp_edges, "comb_team_i1_rate": ti_edges,
                         "park_factor_3yr": pf_edges},
        "overall_paired": overall, "uniformity_scan": uniformity,
    }, indent=2))


if __name__ == "__main__":
    main()
