#!/usr/bin/env python
"""f5-assessor-03-worst50.py — F5 ASSESSOR granular audit, step 3: worst-50 autopsies.

Scores every one of the 1,555 population games on a combined F5 miss score:
  z(|p2 projF5Total - actual|) + z(p1 three-way ML Brier) + z(p1 away+0.5 RL Brier)
(p2 is the published replay series for the total; ML/RL use the p1-derived three-way masses
since p2's ML is a hybrid scale and RL is a p1 passthrough.)

Takes the top 50, attaches an autopsy row per game (starters, as-of IP, park, line, model vs
actual, driver market) with mechanical cause tags, then compares tag frequency in the worst-50
vs the population base rate.

Input:  granular/f5/f5-assessor-population.csv
Output: granular/f5/f5-assessor-worst50.csv  (+ tag-frequency table on stdout)
"""
from __future__ import annotations

import csv
import math
import os
import statistics as st

HERE = os.path.dirname(__file__)
F5_DIR = os.path.join(HERE, "..", "f5")
rows = list(csv.DictReader(open(os.path.join(F5_DIR, "f5-assessor-population.csv"))))
assert len(rows) == 1555


def f(r, c):
    v = r.get(c)
    return None if v in (None, "", "None") else float(v)


# per-game components
for r in rows:
    a5, h5, tie = int(r["actualF5Away"]), int(r["actualF5Home"]), int(r["f5Tie"])
    outcome = "tie" if tie else ("away" if a5 > h5 else "home")
    A = f(r, "p1_pF5AwayMl")
    H = f(r, "p1_homeAbs")
    T = f(r, "p1_pushAdj")
    r["_ml3"] = ((A - (outcome == "away")) ** 2 + (H - (outcome == "home")) ** 2
                 + (T - (outcome == "tie")) ** 2)
    r["_rlb"] = (f(r, "p1_pF5AwayRl") - int(r["awayCover"])) ** 2
    r["_tot"] = abs(f(r, "p2_projF5Total") - f(r, "actualF5Total"))
    r["_outcome"] = outcome

for comp in ("_ml3", "_rlb", "_tot"):
    vals = [r[comp] for r in rows]
    mu, sd = st.mean(vals), st.pstdev(vals)
    for r in rows:
        r[comp + "_z"] = (r[comp] - mu) / sd
for r in rows:
    r["_score"] = r["_ml3_z"] + r["_rlb_z"] + r["_tot_z"]
    r["_driver"] = max(("ml", r["_ml3_z"]), ("rl", r["_rlb_z"]), ("total", r["_tot_z"]),
                       key=lambda kv: kv[1])[0]


def tags(r):
    out = []
    ao, ho = f(r, "awayStarterOutsGame"), f(r, "homeStarterOutsGame")
    if (ao is not None and ao < 9) or (ho is not None and ho < 9):
        out.append("EARLY_KO")
    at = f(r, "actualF5Total")
    if at >= 10:
        out.append("F5_BLOWUP")
    if at <= 1:
        out.append("F5_DEAD")
    if int(r["f5Tie"]):
        out.append("TIE")
    pc = f(r, "p1_condAway")
    if pc is not None and int(r["f5Tie"]) == 0:
        fav_away = pc >= 0.5
        p_fav = max(pc, 1 - pc)
        won = int(r["awayF5Win"]) == 1
        if p_fav >= 0.58 and (won != fav_away):
            out.append("FAV58_LOST")
    pf = f(r, "parkFactor3yr")
    if pf is not None and pf >= 1.08:
        out.append("HIGH_PARK")
    if pf is not None and pf <= 0.90:
        out.append("LOW_PARK")
    if f(r, "awayStarterAsofIp") is None or f(r, "homeStarterAsofIp") is None:
        out.append("NO_PRIOR_START")
    elif f(r, "matchupAsofIp") is not None and f(r, "matchupAsofIp") < 4.5:
        out.append("SHORT_DEPTH")
    lu = f(r, "totalLineUsed")
    if lu is not None and lu >= 10:
        out.append("HIGH_LINE")
    if at - f(r, "p2_projF5Total") >= 4:
        out.append("MISS_OVER4+")
    return out


for r in rows:
    r["_tags"] = tags(r)

worst = sorted(rows, key=lambda r: -r["_score"])[:50]

cols = ["rank", "score", "driver", "gameId", "gameDate", "awayTeam", "homeTeam", "venue",
        "parkFactor3yr", "totalLineUsed", "actualF5", "p2_projF5Total", "p1_condAway",
        "p1_pF5AwayRl", "awayCover", "outcome",
        "awayStarterOutsGame", "homeStarterOutsGame", "matchupAsofIp",
        "ml3_z", "rl_z", "tot_z", "tags"]
with open(os.path.join(F5_DIR, "f5-assessor-worst50.csv"), "w", newline="") as fh:
    w = csv.writer(fh)
    w.writerow(cols)
    for i, r in enumerate(worst, 1):
        w.writerow([
            i, f"{r['_score']:.2f}", r["_driver"], r["gameId"], r["gameDate"],
            r["awayTeam"], r["homeTeam"], r["venue"],
            f"{f(r,'parkFactor3yr'):.3f}", r["totalLineUsed"],
            f"{r['actualF5Away']}-{r['actualF5Home']}", r["p2_projF5Total"],
            f"{f(r,'p1_condAway'):.3f}", r["p1_pF5AwayRl"], r["awayCover"], r["_outcome"],
            r["awayStarterOutsGame"], r["homeStarterOutsGame"],
            ("" if f(r, "matchupAsofIp") is None else f"{f(r,'matchupAsofIp'):.2f}"),
            f"{r['_ml3_z']:.2f}", f"{r['_rlb_z']:.2f}", f"{r['_tot_z']:.2f}",
            "|".join(r["_tags"])])
print(f"[write] f5-assessor-worst50.csv: 50 rows")

# tag frequency: worst-50 vs population
all_tags = sorted(set(t for r in rows for t in r["_tags"]))
print(f"\n{'tag':<16}{'worst50':>8}{'popRate':>9}{'lift':>7}")
for t in all_tags:
    w50 = sum(1 for r in worst if t in r["_tags"]) / 50
    pop = sum(1 for r in rows if t in r["_tags"]) / len(rows)
    print(f"{t:<16}{w50:>8.2f}{pop:>9.3f}{(w50/pop if pop else float('nan')):>7.1f}x")

# driver distribution + direction of total misses in worst-50
from collections import Counter
print("\n[worst50] driver:", dict(Counter(r["_driver"] for r in worst)))
over = sum(1 for r in worst if f(r, "actualF5Total") > f(r, "p2_projF5Total"))
print(f"[worst50] total-miss direction: actual>proj in {over}/50")
print("[worst50] months:", dict(sorted(Counter(r["month"] for r in worst).items())))
print("[worst50] top teams:", Counter([r["awayTeam"] for r in worst] + [r["homeTeam"] for r in worst]).most_common(8))
print("[worst50] mean actualF5Total:", st.mean([f(r, 'actualF5Total') for r in worst]))
print("[population] mean:", st.mean([f(r, 'actualF5Total') for r in rows]))
