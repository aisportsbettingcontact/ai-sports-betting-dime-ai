#!/usr/bin/env python3
"""fullgame-assessor-groundtruth.py — external ground-truth spot check (sampling
is allowed here on top of the full-population DB computation).

Takes every k-th game (deterministic stride, seedless) from the per-game CSV and
compares (actual_away, actual_home) against the MLB StatsAPI schedule endpoint.

Usage: python3 fullgame-assessor-groundtruth.py <per-game.csv> [stride=35]
"""
import csv
import json
import sys
import urllib.request

rows = list(csv.DictReader(open(sys.argv[1])))
stride = int(sys.argv[2]) if len(sys.argv) > 2 else 35
sample = rows[::stride]
print(f"population={len(rows)} sample={len(sample)} (stride {stride})")

mismatch = 0
for g in sample:
    pk = g["gamePk"]
    url = f"https://statsapi.mlb.com/api/v1/schedule?gamePks={pk}"
    with urllib.request.urlopen(url, timeout=15) as r:
        data = json.load(r)
    game = data["dates"][0]["games"][0]
    a = game["teams"]["away"].get("score")
    h = game["teams"]["home"].get("score")
    if a is None or h is None:
        # some suspended/resumed games omit score on the schedule endpoint; use linescore
        url2 = f"https://statsapi.mlb.com/api/v1.1/game/{pk}/feed/live"
        with urllib.request.urlopen(url2, timeout=20) as r2:
            live = json.load(r2)
        ls = live["liveData"]["linescore"]["teams"]
        a, h = ls["away"]["runs"], ls["home"]["runs"]
    ok = float(a) == float(g["actual_away"]) and float(h) == float(g["actual_home"])
    if not ok:
        mismatch += 1
        print(f"MISMATCH {g['date']} {g['away']}@{g['home']} pk={pk} "
              f"db=({g['actual_away']},{g['actual_home']}) api=({a},{h})")
print(f"mismatches: {mismatch}/{len(sample)}")
