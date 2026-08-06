#!/usr/bin/env python
"""kprops-assessor-02-slices.py — K-props ASSESSOR, step 2: residual-structure slices.

Input:  granular/kprops/kprops-assessor-population.csv (from step 1; full population)
Output: granular/kprops/
    kprops-assessor-slices.csv        signedError by tier x series (live/p1/p2)
    kprops-assessor-regression.csv    OLS structure regressions per series
    kprops-assessor-pitcher-bias.csv  per-pitcher bias table (n>=5), live vs replay
    kprops-assessor-earlyhook.csv     outs-tier analysis + IP-normalized residuals
    kprops-assessor-worst50.csv       worst-50 live misses with cause tags + replay comparison

signedError = proj - actualKs (negative = model too low).
All numbers computed over the FULL population CSV; no sampling.
"""
from __future__ import annotations

import csv
import math
import os

import numpy as np

BASE = os.path.join(os.path.dirname(__file__), "..", "kprops")
POP = os.path.join(BASE, "kprops-assessor-population.csv")

SERIES = [("live", "liveSignedError"), ("p1", "p1SignedError"), ("p2", "p2SignedError")]


def f(row, k):
    v = row.get(k)
    if v in (None, "", "None"):
        return None
    try:
        return float(v)
    except ValueError:
        return None


def load():
    with open(POP) as fh:
        return list(csv.DictReader(fh))


def stats(vals):
    a = np.array(vals, dtype=float)
    n = len(a)
    if n == 0:
        return dict(n=0, mean=None, sd=None, ci95=None, tstat=None, mae=None,
                    median=None, pct_under=None)
    mean = float(a.mean())
    sd = float(a.std(ddof=1)) if n > 1 else 0.0
    se = sd / math.sqrt(n) if n > 1 else float("nan")
    return dict(
        n=n, mean=round(mean, 4), sd=round(sd, 4),
        ci95=round(1.96 * se, 4) if n > 1 else None,
        tstat=round(mean / se, 2) if n > 1 and se > 0 else None,
        mae=round(float(np.abs(a).mean()), 4),
        median=round(float(np.median(a)), 4),
        pct_under=round(float((a < 0).mean()), 4),
    )


# ---------------------------------------------------------------- tier functions
def tier_month(r):
    return r["month"]


def tier_asof_k9(r):
    v = f(r, "asofK9")
    if v is None:
        return "no-prior-2026"
    if v < 7:
        return "1: <7"
    if v < 8.5:
        return "2: 7-8.5"
    if v < 10:
        return "3: 8.5-10"
    return "4: >=10"


def tier_snap_k9(r):
    v = f(r, "snapK9")
    if v is None:
        return "no-snap"
    if v < 7:
        return "1: <7"
    if v < 8.5:
        return "2: 7-8.5"
    if v < 10:
        return "3: 8.5-10"
    return "4: >=10"


def tier_line(r):
    v = f(r, "bookLine")
    if v is None:
        return "no-line"
    if v <= 3.5:
        return "1: <=3.5"
    if v <= 4.5:
        return "2: 4-4.5"
    if v <= 5.5:
        return "3: 5-5.5"
    if v <= 6.5:
        return "4: 6-6.5"
    return "5: >=7"


def tier_line_int(r):
    v = r.get("lineIsInteger")
    if v in ("", "None", None):
        return "no-line"
    return "integer" if v == "1" else "half"


def tier_ump(r):
    v = f(r, "umpKMod")
    if v is None:
        return "unknown"
    if v <= 0.97:
        return "1: <=0.97"
    if v < 1.03:
        return "2: 0.97-1.03"
    return "3: >=1.03"


def tier_rest(r):
    v = f(r, "daysRest")
    if v is None:
        return "no-prior-2026"
    if v <= 4:
        return "1: <=4"
    if v == 5:
        return "2: 5"
    if v == 6:
        return "3: 6"
    if v <= 10:
        return "4: 7-10"
    return "5: >10"


def tier_outs(r):
    v = f(r, "starterOuts")
    if v is None:
        return "unknown"
    if v <= 9:
        return "1: <=9 (<=3 IP)"
    if v <= 14:
        return "2: 10-14"
    if v <= 17:
        return "3: 15-17 (5-6 IP)"
    if v <= 20:
        return "4: 18-20 (6-7 IP)"
    return "5: >=21 (7+ IP)"


def tier_verdict(r):
    return r.get("verdict") or "none"


def tier_side(r):
    return r["side"]


def make_tier_opp(rows):
    vals = sorted(v for v in (f(r, "oppAsofK27") for r in rows) if v is not None)
    q = [vals[int(len(vals) * p)] for p in (0.25, 0.5, 0.75)]

    def tier(r):
        v = f(r, "oppAsofK27")
        if v is None:
            return "no-prior-2026"
        if v < q[0]:
            return f"1: <{q[0]:.2f}"
        if v < q[1]:
            return f"2: {q[0]:.2f}-{q[1]:.2f}"
        if v < q[2]:
            return f"3: {q[1]:.2f}-{q[2]:.2f}"
        return f"4: >={q[2]:.2f}"
    return tier, q


def main():
    rows = load()
    assert len(rows) == 3110, f"population must be 3110 slots, got {len(rows)}"
    tier_opp, opp_q = make_tier_opp(rows)
    print(f"[slices] population {len(rows)} slots; oppAsofK27 quartile cuts: {opp_q}")

    dims = [
        ("overall", lambda r: "all"),
        ("month", tier_month),
        ("pitcher_asof_k9", tier_asof_k9),
        ("pitcher_snap_k9", tier_snap_k9),
        ("opp_asof_k27", tier_opp),
        ("line_level", tier_line),
        ("line_integer", tier_line_int),
        ("ump_kmod", tier_ump),
        ("days_rest", tier_rest),
        ("starter_outs", tier_outs),
        ("verdict_live", tier_verdict),
        ("side", tier_side),
        ("halves", lambda r: "H1: Mar-May" if r["month"] <= "2026-05" else "H2: Jun-Jul"),
    ]

    out = os.path.join(BASE, "kprops-assessor-slices.csv")
    with open(out, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["dimension", "tier", "series", "n", "meanErr", "ci95", "tstat",
                    "sd", "mae", "medianErr", "pctUnderProj", "meanActualKs", "meanProj"])
        for dim, fn in dims:
            groups = {}
            for r in rows:
                groups.setdefault(fn(r), []).append(r)
            for tier in sorted(groups):
                grp = groups[tier]
                for sname, scol in SERIES:
                    errs = [f(r, scol) for r in grp]
                    pairs = [(e, r) for e, r in zip(errs, grp) if e is not None]
                    st = stats([e for e, _ in pairs])
                    acts = [f(r, "starterKs") if sname != "live" else f(r, "liveTruthKs")
                            for _, r in pairs]
                    projcol = {"live": "kProj", "p1": "p1ProjValue", "p2": "p2ProjValue"}[sname]
                    projs = [f(r, projcol) for _, r in pairs]
                    w.writerow([dim, tier, sname, st["n"], st["mean"], st["ci95"], st["tstat"],
                                st["sd"], st["mae"], st["median"], st["pct_under"],
                                round(float(np.mean([a for a in acts if a is not None])), 3) if pairs else None,
                                round(float(np.mean([p for p in projs if p is not None])), 3) if pairs else None])
    print(f"[write] {out}")

    # ---------------------------------------------------------------- regressions
    # per series: signedError ~ outs_c + asofK9_c + oppK27_c + umpKMod_c + line_c
    regout = os.path.join(BASE, "kprops-assessor-regression.csv")
    with open(regout, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["series", "model", "n", "term", "coef", "se", "tstat"])
        for sname, scol in SERIES:
            # univariate: outs only (early hook), then full multivariate
            for model_name, feats in [
                ("outs_only", ["starterOuts"]),
                ("full", ["starterOuts", "asofK9", "oppAsofK27", "umpKMod", "bookLine"]),
            ]:
                X, y = [], []
                for r in rows:
                    e = f(r, scol)
                    if e is None:
                        continue
                    fv = [f(r, ft) for ft in feats]
                    if any(v is None for v in fv):
                        continue
                    X.append(fv)
                    y.append(e)
                X = np.array(X)
                y = np.array(y)
                if len(y) < 30:
                    continue
                Xc = X - X.mean(axis=0)
                Xd = np.hstack([np.ones((len(y), 1)), Xc])
                beta, *_ = np.linalg.lstsq(Xd, y, rcond=None)
                resid = y - Xd @ beta
                dof = len(y) - Xd.shape[1]
                s2 = float(resid @ resid) / dof
                cov = s2 * np.linalg.inv(Xd.T @ Xd)
                ses = np.sqrt(np.diag(cov))
                terms = ["intercept(at means)"] + feats
                for t, b, se in zip(terms, beta, ses):
                    w.writerow([sname, model_name, len(y), t, round(float(b), 5),
                                round(float(se), 5), round(float(b / se), 2) if se > 0 else None])
    print(f"[write] {regout}")

    # ---------------------------------------------------------------- pitcher bias
    pit = {}
    for r in rows:
        sid = r["starterId"]
        name = r.get("p1MlbamId") and r.get("livePitcherName")
        key = sid
        d = pit.setdefault(key, {"names": set(), "live": [], "p1": [], "p2": [],
                                 "acts": [], "projs": [], "outs": []})
        if r.get("livePitcherName"):
            d["names"].add(r["livePitcherName"])
        for sname, scol in SERIES:
            e = f(r, scol)
            if e is not None:
                d[sname].append(e)
        a = f(r, "starterKs")
        if a is not None:
            d["acts"].append(a)
        p = f(r, "kProj")
        if p is not None:
            d["projs"].append(p)
        o = f(r, "starterOuts")
        if o is not None:
            d["outs"].append(o)

    pout = os.path.join(BASE, "kprops-assessor-pitcher-bias.csv")
    n_ge5 = 0
    with open(pout, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["starterId", "pitcherName", "nLive", "meanLiveErr", "ci95LiveErr",
                    "nP1", "meanP1Err", "nP2", "meanP2Err",
                    "meanActualKs", "meanKProj", "meanOuts"])
        rows_out = []
        for sid, d in pit.items():
            if len(d["live"]) < 5:
                continue
            n_ge5 += 1
            st = stats(d["live"])
            rows_out.append([
                sid, "|".join(sorted(d["names"])) or None,
                st["n"], st["mean"], st["ci95"],
                len(d["p1"]), round(float(np.mean(d["p1"])), 3) if d["p1"] else None,
                len(d["p2"]), round(float(np.mean(d["p2"])), 3) if d["p2"] else None,
                round(float(np.mean(d["acts"])), 3) if d["acts"] else None,
                round(float(np.mean(d["projs"])), 3) if d["projs"] else None,
                round(float(np.mean(d["outs"])), 2) if d["outs"] else None,
            ])
        rows_out.sort(key=lambda x: x[3])
        for ro in rows_out:
            w.writerow(ro)
    print(f"[write] {pout}: {n_ge5} pitchers with n>=5 live-graded slots")

    # summary of pitcher-bias distribution
    means = [ro[3] for ro in rows_out]
    sig_low = sum(1 for ro in rows_out if ro[3] is not None and ro[4] is not None and ro[3] + ro[4] < 0)
    sig_high = sum(1 for ro in rows_out if ro[3] is not None and ro[4] is not None and ro[3] - ro[4] > 0)
    print(f"    pitcher mean-bias distribution: min={min(means):.2f} median={np.median(means):.2f} "
          f"max={max(means):.2f}; CI-below-zero={sig_low}/{n_ge5}, CI-above-zero={sig_high}/{n_ge5}")

    # ---------------------------------------------------------------- early hook
    # per outs tier and per series: raw meanErr, plus rate-normalized residual
    # normErr = proj - actualRate*medianOuts  (what the error would be had the starter
    # recorded the population-median outs at his in-game K rate)
    all_outs = [f(r, "starterOuts") for r in rows if f(r, "starterOuts") is not None]
    med_outs = float(np.median(all_outs))
    ehout = os.path.join(BASE, "kprops-assessor-earlyhook.csv")
    with open(ehout, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["outsTier", "series", "n", "meanErr", "ci95", "meanNormErr",
                    "meanActualKs", "meanOuts", "meanProj", "shareOfSlots"])
        groups = {}
        for r in rows:
            groups.setdefault(tier_outs(r), []).append(r)
        for tier in sorted(groups):
            grp = groups[tier]
            for sname, scol in SERIES:
                projcol = {"live": "kProj", "p1": "p1ProjValue", "p2": "p2ProjValue"}[sname]
                sel = [r for r in grp if f(r, scol) is not None]
                errs = [f(r, scol) for r in sel]
                norm = []
                for r in sel:
                    o = f(r, "starterOuts")
                    a = f(r, "starterKs") if sname != "live" else f(r, "liveTruthKs")
                    p = f(r, projcol)
                    if o and o > 0 and a is not None and p is not None:
                        norm.append(p - a / o * med_outs)
                st = stats(errs)
                w.writerow([
                    tier, sname, st["n"], st["mean"], st["ci95"],
                    round(float(np.mean(norm)), 4) if norm else None,
                    round(float(np.mean([f(r, "starterKs") for r in sel if f(r, "starterKs") is not None])), 3) if sel else None,
                    round(float(np.mean([f(r, "starterOuts") for r in sel if f(r, "starterOuts") is not None])), 2) if sel else None,
                    round(float(np.mean([f(r, projcol) for r in sel if f(r, projcol) is not None])), 3) if sel else None,
                    round(len(grp) / len(rows), 4),
                ])
    print(f"[write] {ehout} (median outs = {med_outs})")

    # ---------------------------------------------------------------- worst 50
    scored = [r for r in rows if f(r, "liveSignedError") is not None]
    scored.sort(key=lambda r: -abs(f(r, "liveSignedError")))
    worst = scored[:50]

    def causes(r):
        c = []
        e = f(r, "liveSignedError")
        o = f(r, "starterOuts")
        a = f(r, "liveTruthKs")
        k9 = f(r, "asofK9")
        if r.get("liveStarterMismatch") == "1":
            c.append("STARTER_MISMATCH")
        if o is not None and o <= 9 and e is not None and e > 0:
            c.append("SHORT_OUTING")
        if o is not None and o >= 18 and e is not None and e < 0:
            c.append("LONG_OUTING_UNDERSHOOT")
        if k9 is not None and k9 >= 10 and e is not None and e < 0:
            c.append("HIGH_K9_UNDERSHOOT")
        if f(r, "asofPriorStarts") == 0 or f(r, "asofPriorStarts") is None:
            c.append("NO_2026_PRIOR")
        km = f(r, "umpKMod")
        if km is not None and km >= 1.05 and e is not None and e < 0:
            c.append("HIGH_K_UMP")
        if km is not None and km <= 0.95 and e is not None and e > 0:
            c.append("LOW_K_UMP")
        ok = f(r, "oppAsofK27")
        if ok is not None and opp_q and ok >= opp_q[2] and e is not None and e < 0:
            c.append("HIGH_K_OPP")
        if a is not None and a >= 10:
            c.append("ACTUAL_10PLUS")
        if not c:
            c.append("UNTAGGED")
        return ";".join(c)

    wout = os.path.join(BASE, "kprops-assessor-worst50.csv")
    with open(wout, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["rank", "gameId", "gameDate", "side", "pitcher", "opp", "kProj",
                    "bookLine", "liveTruthKs", "liveSignedError", "starterOuts",
                    "asofK9", "daysRest", "umpKMod", "oppAsofK27", "verdict",
                    "pOver", "pUnder", "p1ProjValue", "p1SignedError", "p2ProjValue",
                    "p2SignedError", "causeTags"])
        for i, r in enumerate(worst, 1):
            w.writerow([
                i, r["gameId"], r["gameDate"], r["side"], r.get("livePitcherName"),
                r["oppTeam"], f(r, "kProj"), f(r, "bookLine"), f(r, "liveTruthKs"),
                f(r, "liveSignedError"), f(r, "starterOuts"), f(r, "asofK9"),
                f(r, "daysRest"), f(r, "umpKMod"), f(r, "oppAsofK27"),
                r.get("verdict"), f(r, "pOver"), f(r, "pUnder"),
                f(r, "p1ProjValue"), f(r, "p1SignedError"),
                f(r, "p2ProjValue"), f(r, "p2SignedError"),
                causes(r),
            ])
    print(f"[write] {wout}")

    # quick cause histogram for the report
    from collections import Counter
    hist = Counter()
    for r in worst:
        for c in causes(r).split(";"):
            hist[c] += 1
    print("[worst50] cause tag histogram:", dict(hist.most_common()))
    n_under = sum(1 for r in worst if f(r, "liveSignedError") < 0)
    print(f"[worst50] under-projections (err<0): {n_under}/50")


if __name__ == "__main__":
    main()
