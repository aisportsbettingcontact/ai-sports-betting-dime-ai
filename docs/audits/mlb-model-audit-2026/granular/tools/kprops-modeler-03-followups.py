#!/usr/bin/env python3
"""kprops-modeler-03-followups.py — MODELER follow-up diagnostics, kprops.

Consumes the extraction CSVs (full population). Produces:
  1. Weekly live anchor regression kProj ~ bookLine (dates the v1->P2A transition).
  2. kProj/bookLine (live) and projValue/line (replay p1) ratio concentration by
     month — the M-204 mechanical-anchor signature is a tight ratio distribution.
  3. p2 probability-range census: the calibrated series is written WITHOUT the
     live/p1 [0.03, 0.85] clamp — count rows outside that band per month.
  4. Integer-line census + the 8-row p1-vs-p2 push-convention divergence detail.
  5. Replay projValue vs line level context by month (mean projValue, mean line,
     mean live kProj on the same month).

Outputs (granular/kprops/):
  kprops-modeler-live-weekly-anchor.csv
  kprops-modeler-ratio-concentration.csv
  kprops-modeler-p2-range-census.csv
  kprops-modeler-integer-lines.csv
  kprops-modeler-followups.json
"""
from __future__ import annotations

import csv
import json
import os
import sys
from collections import defaultdict
from datetime import date

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, "..", "kprops"))


def num(v):
    if v is None or v in ("", "\\N"):
        return None
    try:
        return float(v)
    except ValueError:
        return None


def load(name):
    with open(os.path.join(OUT, name), newline="") as f:
        return list(csv.DictReader(f))


def ols(x, y):
    x = np.asarray(x, float)
    y = np.asarray(y, float)
    n = len(x)
    if n < 5 or np.std(x) == 0 or np.std(y) == 0:
        return {"n": n, "slope": None, "intercept": None, "r2": None}
    slope, intercept = np.polyfit(x, y, 1)
    r = float(np.corrcoef(x, y)[0, 1])
    return {"n": n, "slope": round(float(slope), 4),
            "intercept": round(float(intercept), 4), "r2": round(r * r, 4)}


def week_of(ds):
    y, m, d = (int(p) for p in str(ds).split("-"))
    iso = date(y, m, d).isocalendar()
    return f"{iso[0]}-W{iso[1]:02d}"


def main() -> int:
    live = load("kprops-modeler-live-props.csv")
    replay = load("kprops-modeler-replay-props.csv")
    agg = {}

    # 1. weekly live anchor
    by_w = defaultdict(list)
    for r in live:
        k, b = num(r["kProj"]), num(r["bookLine"])
        if k is not None and b is not None:
            by_w[week_of(r["gameDate"])].append((b, k, r["gameDate"]))
    rows = []
    for w in sorted(by_w):
        pairs = by_w[w]
        res = ols([p[0] for p in pairs], [p[1] for p in pairs])
        ratios = [p[1] / p[0] for p in pairs if p[0] > 0]
        rows.append({"week": w, "minDate": min(p[2] for p in pairs),
                     "maxDate": max(p[2] for p in pairs), **res,
                     "ratio_mean": round(float(np.mean(ratios)), 4),
                     "ratio_sd": round(float(np.std(ratios)), 4)})
    with open(os.path.join(OUT, "kprops-modeler-live-weekly-anchor.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    # 2. ratio concentration by month (live vs replay p1)
    conc = []
    for label, data, kf, lf in (
            ("live", live, "kProj", "bookLine"),
            ("replay-p1", [r for r in replay if r["modelVersion"].endswith("-p1")],
             "projValue", "line")):
        by_m = defaultdict(list)
        for r in data:
            k, b = num(r[kf]), num(r[lf])
            if k is not None and b is not None and b > 0:
                by_m[str(r["gameDate"])[:7]].append(k / b)
        for m in sorted(by_m):
            arr = np.asarray(by_m[m])
            conc.append({"series": label, "month": m, "n": len(arr),
                         "ratio_mean": round(float(arr.mean()), 4),
                         "ratio_sd": round(float(arr.std()), 4),
                         "ratio_cv": round(float(arr.std() / arr.mean()), 4),
                         "p5": round(float(np.percentile(arr, 5)), 4),
                         "p95": round(float(np.percentile(arr, 95)), 4)})
    with open(os.path.join(OUT, "kprops-modeler-ratio-concentration.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(conc[0].keys()))
        w.writeheader()
        w.writerows(conc)

    # 3. p2 probability-range census (no clamp in the calibrated writer)
    p2rows = [r for r in replay if not r["modelVersion"].endswith("-p1")]
    rng = []
    for m in sorted({str(r["gameDate"])[:7] for r in p2rows}):
        sub = [num(r["pOver"]) for r in p2rows
               if str(r["gameDate"])[:7] == m and num(r["pOver"]) is not None]
        arr = np.asarray(sub)
        rng.append({"month": m, "n": len(arr),
                    "n_above_0.85": int((arr > 0.85 + 1e-12).sum()),
                    "n_below_0.03": int((arr < 0.03 - 1e-12).sum()),
                    "max_pOver": round(float(arr.max()), 5),
                    "min_pOver": round(float(arr.min()), 5)})
    with open(os.path.join(OUT, "kprops-modeler-p2-range-census.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rng[0].keys()))
        w.writeheader()
        w.writerows(rng)
    agg["p2_above_live_clamp"] = int(sum(r["n_above_0.85"] for r in rng))
    agg["p2_below_live_clamp"] = int(sum(r["n_below_0.03"] for r in rng))

    # 4. integer-line census (replay + live)
    def is_int(x):
        return x is not None and abs(x - round(x)) < 1e-9
    p1_int = [r for r in replay if r["modelVersion"].endswith("-p1") and is_int(num(r["line"]))]
    live_int = [r for r in live if is_int(num(r["bookLine"]))]
    agg["replay_integer_line_rows_per_pass"] = len(p1_int)
    agg["live_integer_line_rows"] = len(live_int)
    p2_idx = {(r["gameId"], r["mlbamId"], r["side"]): r for r in p2rows}
    det = []
    for r in p1_int:
        p2r = p2_idx.get((r["gameId"], r["mlbamId"], r["side"]))
        det.append({"gameId": r["gameId"], "gameDate": r["gameDate"], "side": r["side"],
                    "playerName": r["playerName"], "line": r["line"],
                    "p1_projValue": r["projValue"], "p1_pOver": r["pOver"],
                    "p2_projValue": p2r["projValue"] if p2r else None,
                    "p2_pOver": p2r["pOver"] if p2r else None})
    with open(os.path.join(OUT, "kprops-modeler-integer-lines.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(det[0].keys()) if det else
                           ["gameId", "gameDate", "side", "playerName", "line",
                            "p1_projValue", "p1_pOver", "p2_projValue", "p2_pOver"])
        w.writeheader()
        w.writerows(det)

    # 5. level context by month
    level = []
    for m in sorted({str(r["gameDate"])[:7] for r in replay}):
        p1m = [r for r in replay if r["modelVersion"].endswith("-p1")
               and str(r["gameDate"])[:7] == m]
        p2m = [r for r in p2rows if str(r["gameDate"])[:7] == m]
        lvm = [r for r in live if str(r["gameDate"])[:7] == m]
        pv1 = [num(r["projValue"]) for r in p1m if num(r["projValue"]) is not None]
        pv2 = [num(r["projValue"]) for r in p2m if num(r["projValue"]) is not None]
        ln = [num(r["line"]) for r in p1m if num(r["line"]) is not None]
        kp = [num(r["kProj"]) for r in lvm if num(r["kProj"]) is not None]
        bl = [num(r["bookLine"]) for r in lvm if num(r["bookLine"]) is not None]
        ak = [num(r["actualKs"]) for r in lvm if num(r["actualKs"]) is not None]
        level.append({
            "month": m,
            "p1_mean_projValue": round(float(np.mean(pv1)), 3),
            "p2_mean_projValue": round(float(np.mean(pv2)), 3),
            "replay_mean_line": round(float(np.mean(ln)), 3) if ln else None,
            "live_mean_kProj": round(float(np.mean(kp)), 3) if kp else None,
            "live_mean_bookLine": round(float(np.mean(bl)), 3) if bl else None,
            "live_mean_actualKs": round(float(np.mean(ak)), 3) if ak else None,
            "n_p1": len(pv1), "n_live_kProj": len(kp), "n_live_actuals": len(ak)})
    agg["level_by_month"] = level

    with open(os.path.join(OUT, "kprops-modeler-followups.json"), "w") as f:
        json.dump(agg, f, indent=2)
    print(json.dumps(agg, indent=2))
    print("[done] followups complete")
    return 0


if __name__ == "__main__":
    sys.exit(main())
