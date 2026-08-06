#!/usr/bin/env python3
"""Emit the flagged-slice table (markdown) from fullgame-assessor-flagged-slices.csv.

Flag legend: B = bias 95% CI excludes 0 (n>=40), b = centered bias flag (slice mean
differs from series mean, diagnostic), R = |slice Brier - series Brier| > 0.01 (n>=40).

Usage: python3 fullgame-assessor-mdtable.py <flagged-slices.csv>
"""
import csv
import sys

rows = list(csv.DictReader(open(sys.argv[1])))
print("| dim | slice | n | live bias [95% CI] | p1 bias | p2 bias [95% CI] | live Brier dev | p2 Brier dev | flags (live / p2) |")
print("|---|---|---|---|---|---|---|---|---|")
for r in rows:
    def fl(series_b, series_c, series_r):
        out = ""
        if r.get(series_b) == "1":
            out += "B"
        if r.get(series_c) == "1":
            out += "b"
        if series_r and r.get(series_r) == "1":
            out += "R"
        return out or "-"
    live = fl("live_rule_flag_bias", "live_rule_flag_bias_centered", "live_flag_brier")
    p2 = fl("p2_flag_bias", "p2_flag_bias_centered", "p2_flag_brier")
    print(
        f"| {r['dim']} | {r['slice']} | {r['n_games']} "
        f"| {r['live_rule_bias']} [{r['live_rule_ci_lo']}, {r['live_rule_ci_hi']}] "
        f"| {r['p1_bias']} "
        f"| {r['p2_bias']} [{r['p2_ci_lo']}, {r['p2_ci_hi']}] "
        f"| {r['live_brier_dev']} | {r['p2_brier_dev']} "
        f"| {live} / {p2} |"
    )
