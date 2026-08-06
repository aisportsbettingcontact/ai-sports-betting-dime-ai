#!/usr/bin/env python
"""kprops-assessor-03-integrity.py — K-props ASSESSOR, step 3: wrong-pitcher contamination probe.

Step 2's per-pitcher table grouped live rows by SUBSTRATE starterId and surfaced slots
whose live pitcherName is a different pitcher (sometimes the OPPONENT's starter) while
the row's mlbamId equals the actual starter's id (backfilled). This script quantifies,
over the FULL population:

  A. name-identity classes for every live slot:
       SAME_STARTER   livePitcherName ~= actual starter (this side, replay p1 name)
       OPP_STARTER    livePitcherName ~= actual starter of the OTHER side (cross-side row)
       OTHER_PITCHER  matches neither (scratched/announced-but-replaced or alias miss)
  B. per-class signedError stats -> how much of the live residual tail is process noise
  C. stored actualKs vs substrate starterKs agreement per class
  D. worst-50 overlap: how many of the 50 worst live misses are non-SAME_STARTER rows

Inputs: granular/kprops/kprops-assessor-population.csv + DB (replay p1 names only).
Output: granular/kprops/kprops-assessor-integrity.csv (per-slot class + keys)
        stdout summary (quoted in the report).
READ-ONLY.
"""
from __future__ import annotations

import csv
import os
import sys
import unicodedata

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools", "replay"))
from replay_db import connect  # noqa: E402

BASE = os.path.join(os.path.dirname(__file__), "..", "kprops")
POP = os.path.join(BASE, "kprops-assessor-population.csv")
OUT = os.path.join(BASE, "kprops-assessor-integrity.csv")


def norm_name(s):
    if not s:
        return ""
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    for suf in (" jr", " sr", " ii", " iii", " iv"):
        if s.endswith(suf):
            s = s[: -len(suf)]
    return "".join(c for c in s if c.isalpha())


def f(row, k):
    v = row.get(k)
    if v in (None, "", "None"):
        return None
    try:
        return float(v)
    except ValueError:
        return None


def main():
    rows = list(csv.DictReader(open(POP)))
    assert len(rows) == 3110

    conn = connect()
    cur = conn.cursor()
    cur.execute(
        "SELECT gameId, side, mlbamId, playerName FROM mlb_replay_prop_projections "
        "WHERE propType='K' AND modelVersion='wf-19288f01-p1'")
    p1name = {}
    for r in cur.fetchall():
        p1name[(str(r["gameId"]), r["side"])] = (r["mlbamId"], r["playerName"])
    conn.close()

    classes = {}
    out_rows = []
    for r in rows:
        key = (r["gameId"], r["side"])
        okey = (r["gameId"], "home" if r["side"] == "away" else "away")
        if not r["liveRowId"]:
            cls = "NO_LIVE_ROW"
        else:
            same = p1name.get(key, (None, None))[1]
            opp = p1name.get(okey, (None, None))[1]
            ln = norm_name(r["livePitcherName"])
            if ln and ln == norm_name(same):
                cls = "SAME_STARTER"
            elif ln and ln == norm_name(opp):
                cls = "OPP_STARTER"
            else:
                cls = "OTHER_PITCHER"
        classes.setdefault(cls, []).append(r)
        out_rows.append([r["gameId"], r["side"], r["gameDate"], r["livePitcherName"],
                         r["liveMlbamId"], r["starterId"],
                         p1name.get(key, (None, None))[1], cls,
                         f(r, "kProj"), f(r, "bookLine"), f(r, "liveTruthKs"),
                         f(r, "liveSignedError"), r["liveStoredActualKs"], r["starterKs"],
                         r["verdict"], r["liveStoredResult"]])

    with open(OUT, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["gameId", "side", "gameDate", "livePitcherName", "liveMlbamId",
                    "substrateStarterId", "actualStarterName", "nameClass", "kProj",
                    "bookLine", "liveTruthKs", "liveSignedError", "liveStoredActualKs",
                    "substrateStarterKs", "verdict", "liveStoredResult"])
        w.writerows(out_rows)
    print(f"[write] {OUT}")

    print("\n[A] name-identity classes (all 3,110 slots):")
    for cls in ("SAME_STARTER", "OPP_STARTER", "OTHER_PITCHER", "NO_LIVE_ROW"):
        grp = classes.get(cls, [])
        print(f"    {cls:14s} {len(grp):5d}")

    print("\n[B] live signedError by class (graded slots only):")
    for cls in ("SAME_STARTER", "OPP_STARTER", "OTHER_PITCHER"):
        grp = classes.get(cls, [])
        errs = np.array([f(r, "liveSignedError") for r in grp
                         if f(r, "liveSignedError") is not None])
        if len(errs) == 0:
            continue
        se = errs.std(ddof=1) / np.sqrt(len(errs)) if len(errs) > 1 else float("nan")
        print(f"    {cls:14s} n={len(errs):4d} mean={errs.mean():+.3f} ±{1.96*se:.3f} "
              f"mae={np.abs(errs).mean():.3f} p(|e|>=4)={float((np.abs(errs) >= 4).mean()):.3f}")

    print("\n[C] stored actualKs vs substrate starterKs (rows with both):")
    for cls in ("SAME_STARTER", "OPP_STARTER", "OTHER_PITCHER"):
        grp = classes.get(cls, [])
        both = [(int(r["liveStoredActualKs"]), int(r["starterKs"])) for r in grp
                if r["liveStoredActualKs"] not in ("", "None") and r["starterKs"] not in ("", "None")]
        if not both:
            continue
        agree = sum(1 for a, b in both if a == b)
        print(f"    {cls:14s} n={len(both):4d} agree={agree} ({agree/len(both):.1%})")

    # graded-by-audit-truth vs a strict same-starter-only population
    all_errs = np.array([f(r, "liveSignedError") for r in rows
                         if f(r, "liveSignedError") is not None])
    ss_errs = np.array([f(r, "liveSignedError") for r in classes.get("SAME_STARTER", [])
                        if f(r, "liveSignedError") is not None])
    print(f"\n[B2] overall live bias {all_errs.mean():+.4f} (n={len(all_errs)}) vs "
          f"SAME_STARTER-only {ss_errs.mean():+.4f} (n={len(ss_errs)})")

    print("\n[D] worst-50 overlap:")
    w50 = list(csv.DictReader(open(os.path.join(BASE, "kprops-assessor-worst50.csv"))))
    cls_by_key = {}
    for ro in out_rows:
        cls_by_key[(ro[0], ro[1])] = ro[7]
    from collections import Counter
    c = Counter(cls_by_key.get((r["gameId"], r["side"]), "?") for r in w50)
    print(f"    {dict(c)}")


if __name__ == "__main__":
    main()
