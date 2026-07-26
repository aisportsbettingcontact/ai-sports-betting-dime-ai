#!/usr/bin/env python
"""f5-reinforcer-02-env-total.py — Q1: is a single shared env-mult right for F5?

Inputs: granular/f5/f5-reinforcer-population.csv (1,555 rows, full population).

Computes:
  1. Per-month F5-specific env ratio (actual F5 runs / p1 projected F5 runs) vs the
     full-game env ratio (actual FG runs / p1 projected FG runs), in-month AND
     walk-forward expanding (months < m), plus validation that the walk-forward FG
     ratio reproduces the applied calibMeta league_env_mult.
  2. A walk-forward counterfactual pass-2' ("p2f5") that applies the F5-SPECIFIC env
     mult instead of the shared FG mult:
         projF5Total2' = projF5Total1 * env_f5_wf(m)
         pF5Over2'     = Phi(Phi^-1(pF5Over1) + (projF5Total2'-projF5Total1)/f5_total_sd(m))
     (identical transform family and identical f5_total_sd as the real p2 — the ONLY
     change is the mult, so the delta isolates the parameter-structure question).
  3. Metrics per month + overall + post-seed (May-Jul):
     - full population (n=1,555): signed bias and MAE of projF5Total vs actual F5 total
     - graded subset (book f5Total present, actual != line): hit, Brier, log loss
     - paired per-game Brier delta p2' - p2 with SE (post-seed graded subset)

Outputs:
  granular/f5/f5-reinforcer-env-by-month.csv
  granular/f5/f5-reinforcer-total-counterfactual.csv
"""
from __future__ import annotations

import csv
import math
import os

import numpy as np
from scipy.stats import norm

HERE = os.path.dirname(os.path.abspath(__file__))
F5_DIR = os.path.abspath(os.path.join(HERE, "..", "f5"))
POP = os.path.join(F5_DIR, "f5-reinforcer-population.csv")

EPS = 1e-6
MONTHS = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07"]
SEED_MONTHS = {"2026-03", "2026-04"}


def num(v):
    if v is None or v == "":
        return None
    return float(v)


def clamp_p(p):
    return min(1.0 - EPS, max(EPS, p))


def recenter(p1, d, sd):
    return float(norm.cdf(norm.ppf(clamp_p(p1)) + d / sd))


def main():
    rows = list(csv.DictReader(open(POP)))
    assert len(rows) == 1555, f"population must be 1555, got {len(rows)}"

    for r in rows:
        r["m"] = r["month"]
        r["aF5"] = num(r["actualF5Away"]) + num(r["actualF5Home"])
        r["aFG"] = num(r["actualAway"]) + num(r["actualHome"])
        r["p1t"] = num(r["p1_projTotal"])
        r["p1f5"] = num(r["p1_projF5Total"])
        r["p2f5"] = num(r["p2_projF5Total"])
        r["p1o"] = num(r["p1_pF5Over"])
        r["p2o"] = num(r["p2_pF5Over"])
        r["bookf5"] = num(r["book_f5Total"])
        r["sd"] = num(r["calib_f5_total_sd"])
        r["mult_applied"] = num(r["calib_league_env_mult"])

    by_month = {m: [r for r in rows if r["m"] == m] for m in MONTHS}
    assert sum(len(v) for v in by_month.values()) == 1555

    # ---------------- 1. env ratios ----------------
    env_rows = []
    for m in MONTHS:
        cur = by_month[m]
        prev = [r for r in rows if r["m"] < m]
        fg_in = sum(r["aFG"] for r in cur) / sum(r["p1t"] for r in cur)
        f5_in = sum(r["aF5"] for r in cur) / sum(r["p1f5"] for r in cur)
        if m in SEED_MONTHS:
            fg_wf = f5_wf = 1.0
        else:
            fg_wf = sum(r["aFG"] for r in prev) / sum(r["p1t"] for r in prev)
            f5_wf = sum(r["aF5"] for r in prev) / sum(r["p1f5"] for r in prev)
        applied = cur[0]["mult_applied"]
        # per-game share ratios for context
        share_act = sum(r["aF5"] for r in cur) / sum(r["aFG"] for r in cur)
        share_proj = sum(r["p1f5"] for r in cur) / sum(r["p1t"] for r in cur)
        env_rows.append({
            "month": m, "n": len(cur),
            "fg_env_inmonth": round(fg_in, 5), "f5_env_inmonth": round(f5_in, 5),
            "f5_minus_fg_inmonth": round(f5_in - fg_in, 5),
            "fg_env_wf": round(fg_wf, 5), "f5_env_wf": round(f5_wf, 5),
            "applied_league_env_mult": applied,
            "applied_matches_fg_wf": (abs(fg_wf - (applied or 1.0)) < 5e-4),
            "actual_f5_share_of_fg": round(share_act, 5),
            "p1_projected_f5_ratio": round(share_proj, 5),
        })
    with open(os.path.join(F5_DIR, "f5-reinforcer-env-by-month.csv"), "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(env_rows[0].keys()))
        w.writeheader()
        w.writerows(env_rows)
    print("[env] month table:")
    for e in env_rows:
        print("   ", e)

    # walk-forward F5 mult per month (the counterfactual parameter)
    f5_wf_mult = {e["month"]: (1.0 if e["month"] in SEED_MONTHS else e["f5_env_wf"])
                  for e in env_rows}

    # ---------------- 2. counterfactual p2' ----------------
    for r in rows:
        mult = f5_wf_mult[r["m"]]
        r["cf_f5t"] = r["p1f5"] * mult
        if r["m"] in SEED_MONTHS:
            r["cf_o"] = r["p1o"]
        else:
            r["cf_o"] = recenter(r["p1o"], r["cf_f5t"] - r["p1f5"], r["sd"])
        # sanity: replicate real p2 total from applied mult
        r["p2_check"] = abs(r["p2f5"] - r["p1f5"] * (r["mult_applied"] or 1.0))
    max_chk = max(r["p2_check"] for r in rows)
    print(f"[check] max |p2_projF5Total - p1*applied_mult| = {max_chk:.5f} (DB rounding only)")
    assert max_chk < 6e-4

    # ---------------- 3. metrics ----------------
    def metrics(sub, key_t, key_o):
        """sub: rows. Returns dict with population bias/mae and graded hit/brier/logloss."""
        bias = [r[key_t] - r["aF5"] for r in sub]
        out = {
            "n_pop": len(sub),
            "bias": round(float(np.mean(bias)), 4),
            "bias_se": round(float(np.std(bias, ddof=1) / math.sqrt(len(bias))), 4),
            "mae": round(float(np.mean(np.abs(bias))), 4),
            "bias_pct": round(100 * (sum(r[key_t] for r in sub) / sum(r["aF5"] for r in sub) - 1), 2),
        }
        graded = [r for r in sub if r["bookf5"] is not None and r["aF5"] != r["bookf5"]]
        if graded:
            hits = briers = lls = 0.0
            for r in graded:
                y = 1.0 if r["aF5"] > r["bookf5"] else 0.0
                p = clamp_p(r[key_o])
                pick_over = p > 0.5
                hits += 1.0 if (pick_over and y == 1) or (not pick_over and y == 0) else 0.0
                briers += (p - y) ** 2
                lls += -(y * math.log(p) + (1 - y) * math.log(1 - p))
            out.update({
                "n_graded": len(graded),
                "hit": round(hits / len(graded), 4),
                "brier": round(briers / len(graded), 4),
                "logloss": round(lls / len(graded), 4),
            })
        else:
            out.update({"n_graded": 0, "hit": None, "brier": None, "logloss": None})
        return out

    series = [("p1", "p1f5", "p1o"), ("p2_sharedenv", "p2f5", "p2o"),
              ("p2f5_f5env", "cf_f5t", "cf_o")]
    out_rows = []
    scopes = [(m, by_month[m]) for m in MONTHS]
    scopes.append(("ALL", rows))
    postseed = [r for r in rows if r["m"] not in SEED_MONTHS]
    scopes.append(("MAY-JUL(postseed)", postseed))
    for scope_name, sub in scopes:
        for sname, kt, ko in series:
            mrow = {"scope": scope_name, "series": sname}
            mrow.update(metrics(sub, kt, ko))
            out_rows.append(mrow)

    # paired Brier delta p2' vs p2 on post-seed graded subset
    graded_ps = [r for r in postseed if r["bookf5"] is not None and r["aF5"] != r["bookf5"]]
    deltas = []
    for r in graded_ps:
        y = 1.0 if r["aF5"] > r["bookf5"] else 0.0
        deltas.append((clamp_p(r["cf_o"]) - y) ** 2 - (clamp_p(r["p2o"]) - y) ** 2)
    d = np.array(deltas)
    print(f"[paired] post-seed graded n={len(d)}; mean Brier delta (p2f5env - p2shared) = "
          f"{d.mean():+.5f} (SE {d.std(ddof=1)/math.sqrt(len(d)):.5f})")

    with open(os.path.join(F5_DIR, "f5-reinforcer-total-counterfactual.csv"), "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(out_rows[0].keys()))
        w.writeheader()
        w.writerows(out_rows)
    print("[write] f5-reinforcer-total-counterfactual.csv")
    for r in out_rows:
        if r["scope"] in ("ALL", "MAY-JUL(postseed)"):
            print("   ", r)


if __name__ == "__main__":
    main()
