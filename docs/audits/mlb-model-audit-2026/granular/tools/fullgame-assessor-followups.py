#!/usr/bin/env python3
"""fullgame-assessor-followups.py — targeted 'why' probes behind the flagged slices.

Reads the per-game CSV emitted by fullgame-assessor-analyze.py (full population) and prints:
  1. ATH home games split by actual venue (Sutter Health vs Las Vegas Ballpark).
  2. ARI home games split by venue (Chase Field vs Estadio Alfredo Harp Helu).
  3. Away-favorite ML calibration by month (persistence of the away lean).
  4. COL as away team: predicted vs actual away win rate (worst-ML-miss cluster).
  5. z-scores for the away_fav mean-p vs actual gap per series.
  6. Hand-pair L-L / L-R p2 bias CIs (does hand structure survive calibration?).

Usage: python3 fullgame-assessor-followups.py <per-game.csv>
"""
import csv
import math
import sys
from collections import defaultdict

rows = list(csv.DictReader(open(sys.argv[1])))


def f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def mstats(xs):
    xs = [x for x in xs if x is not None]
    n = len(xs)
    if n == 0:
        return (0, None, None, None)
    m = sum(xs) / n
    if n < 2:
        return (n, m, None, None)
    s = math.sqrt(sum((x - m) ** 2 for x in xs) / (n - 1))
    h = 1.96 * s / math.sqrt(n)
    return (n, m, m - h, m + h)


def line(label, gs, key):
    n, m, lo, hi = mstats([f(g[key]) for g in gs])
    print(f"  {label:34s} n={n:4d}  mean={m if m is None else round(m,3)}"
          + (f"  ci=[{round(lo,3)},{round(hi,3)}]" if lo is not None else ""))


print("=== 1) ATH home games by venue ===")
ath = [g for g in rows if g["home"] == "ATH"]
by_venue = defaultdict(list)
for g in ath:
    by_venue[g["venue"]].append(g)
for v, gs in sorted(by_venue.items()):
    dates = sorted(g["date"] for g in gs)
    print(f" venue={v}  n={len(gs)}  dates {dates[0]}..{dates[-1]}")
    line("actual total", gs, "actual_total")
    line("live_rule signed error", gs, "se_live_rule")
    line("p1 signed error", gs, "se_p1")
    line("p2 signed error", gs, "se_p2")

print("\n=== 2) ARI home games by venue ===")
ari = [g for g in rows if g["home"] == "ARI"]
by_venue = defaultdict(list)
for g in ari:
    by_venue[g["venue"]].append(g)
for v, gs in sorted(by_venue.items()):
    dates = sorted(g["date"] for g in gs)
    print(f" venue={v}  n={len(gs)}  dates {dates[0]}..{dates[-1]}")
    line("actual total", gs, "actual_total")
    line("live_rule signed error", gs, "se_live_rule")
    line("p2 signed error", gs, "se_p2")

print("\n=== 3) away-favorite ML calibration by month ===")
for mo in ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07"]:
    gs = [g for g in rows if g["month"] == mo and g["fav"] == "away_fav"]
    lv = [(f(g["live_p_away"]), f(g["away_won"])) for g in gs if f(g["live_p_away"]) is not None]
    p2 = [(f(g["p2_p_away"]), f(g["away_won"])) for g in gs if f(g["p2_p_away"]) is not None]
    if lv:
        mp = sum(p for p, _ in lv) / len(lv)
        aw = sum(w for _, w in lv) / len(lv)
        print(f" {mo} live: n={len(lv):3d} mean_p_away={mp:.3f} actual={aw:.3f} gap={mp-aw:+.3f}", end="")
    if p2:
        mp2 = sum(p for p, _ in p2) / len(p2)
        aw2 = sum(w for _, w in p2) / len(p2)
        print(f" | p2: n={len(p2):3d} mean_p={mp2:.3f} actual={aw2:.3f} gap={mp2-aw2:+.3f}")

print("\n=== 4) COL as away team ===")
col = [g for g in rows if g["away"] == "COL"]
for tag, key in [("live", "live_p_away"), ("p1", "p1_p_away"), ("p2", "p2_p_away")]:
    pw = [(f(g[key]), f(g["away_won"])) for g in col if f(g[key]) is not None]
    mp = sum(p for p, _ in pw) / len(pw)
    aw = sum(w for _, w in pw) / len(pw)
    br = sum((p - w) ** 2 for p, w in pw) / len(pw)
    print(f" {tag:4s}: n={len(pw)} mean_p_away={mp:.3f} actual_away_win={aw:.3f} gap={mp-aw:+.3f} brier={br:.4f}")

print("\n=== 5) away_fav gap z-scores (mean_p vs actual, binomial SE) ===")
for tag, key in [("live", "live_p_away"), ("p1", "p1_p_away"), ("p2", "p2_p_away")]:
    gs = [g for g in rows if g["fav"] == "away_fav" and f(g[key]) is not None]
    mp = sum(f(g[key]) for g in gs) / len(gs)
    aw = sum(f(g["away_won"]) for g in gs) / len(gs)
    se = math.sqrt(aw * (1 - aw) / len(gs))
    print(f" {tag:4s}: n={len(gs)} gap={mp-aw:+.4f} se={se:.4f} z={(mp-aw)/se:+.2f}")
# same for home_fav
for tag, key in [("live", "live_p_away"), ("p2", "p2_p_away")]:
    gs = [g for g in rows if g["fav"] == "home_fav" and f(g[key]) is not None]
    mp = sum(f(g[key]) for g in gs) / len(gs)
    aw = sum(f(g["away_won"]) for g in gs) / len(gs)
    se = math.sqrt(aw * (1 - aw) / len(gs))
    print(f" {tag:4s} (home_fav): n={len(gs)} gap={mp-aw:+.4f} z={(mp-aw)/se:+.2f}")

print("\n=== 6) hand-pair p2/live bias CIs ===")
for hp in ["L-L", "L-R", "R-L", "R-R"]:
    gs = [g for g in rows if g["hand"] == hp]
    print(f" {hp}:")
    line("live_rule", gs, "se_live_rule")
    line("p2", gs, "se_p2")

print("\n=== 7) PIT park probe: months + PIT-as-home actual vs proj ===")
pit = [g for g in rows if g["home"] == "PIT"]
bym = defaultdict(list)
for g in pit:
    bym[g["month"]].append(g)
for mo, gs in sorted(bym.items()):
    n, m, _, _ = mstats([f(g["actual_total"]) for g in gs])
    _, se2, _, _ = mstats([f(g["se_p2"]) for g in gs])
    print(f" {mo}: n={n} mean_actual_total={round(m,2)} p2_bias={round(se2,2) if se2 is not None else None}")
