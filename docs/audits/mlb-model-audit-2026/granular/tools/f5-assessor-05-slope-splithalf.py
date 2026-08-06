#!/usr/bin/env python
"""f5-assessor-05-slope-splithalf.py — F5 ASSESSOR granular audit, step 5: artifact-free
compression tests.

(a) Per-game OLS of actual F5 total on projected F5 total (p1/p2/live): slope > 1 means the
    projection cross-section is under-dispersed (model under-differentiates environments)
    independent of any level bias. Same regression for the FG total as a control.
(b) Split-half team test: team actual-mean from even-indexed games, team bias from odd-indexed
    games (independent noise) — removes the regression-to-mean artifact from the
    corr(team scoring level, team bias) statistic.

Input: granular/f5/f5-assessor-population.csv. Output: stdout.
"""
from __future__ import annotations

import csv
import math
import os
import statistics as st
from collections import defaultdict

HERE = os.path.dirname(__file__)
rows = list(csv.DictReader(open(os.path.join(HERE, "..", "f5", "f5-assessor-population.csv"))))
assert len(rows) == 1555


def f(r, c):
    v = r.get(c)
    return None if v in (None, "", "None") else float(v)


def ols(pairs):
    xs = [x for x, _ in pairs]; ys = [y for _, y in pairs]
    mx, my = st.mean(xs), st.mean(ys)
    sxx = sum((x - mx) ** 2 for x in xs)
    sxy = sum((x - mx) * (y - my) for x, y in pairs)
    b = sxy / sxx
    a = my - b * mx
    resid = [y - (a + b * x) for x, y in pairs]
    se_b = math.sqrt(sum(e * e for e in resid) / (len(pairs) - 2) / sxx)
    return a, b, se_b, len(pairs)


print("[a] OLS actual = a + b * proj (b>1 => projections under-dispersed)")
for name, pcol, acol in (
    ("p1 F5 total", "p1_projF5Total", "actualF5Total"),
    ("p2 F5 total", "p2_projF5Total", "actualF5Total"),
    ("live F5 total", "live_projF5Total", "actualF5Total"),
    ("p1 FG total (control)", "p1_projTotal", None),
):
    if acol is None:
        # FG actual = away+home final; not in CSV — approximate via actualF5? skip if absent
        continue
    pairs = [(f(r, pcol), f(r, acol)) for r in rows if f(r, pcol) is not None]
    a, b, se_b, n = ols(pairs)
    print(f"    {name:<16} n={n:>4}  intercept={a:+.3f}  slope={b:.3f} (SE {se_b:.3f}, "
          f"z vs 1 = {(b-1)/se_b:+.1f})")

# cross-sectional sd of projections vs a binomial-noise-free actual sd is not directly
# comparable per game; the team-level split-half handles that.

print("\n[b] split-half team test (even games -> scoring level; odd games -> bias)")
team_games = defaultdict(list)
for r in rows:
    team_games[r["awayTeam"]].append(r)
    team_games[r["homeTeam"]].append(r)
lvl, bias = {}, {}
for t, sub in team_games.items():
    sub = sorted(sub, key=lambda r: (r["gameDate"], r["gameId"]))
    even = sub[0::2]; odd = sub[1::2]
    lvl[t] = st.mean([f(r, "actualF5Total") for r in even])
    bias[t] = st.mean([f(r, "p2_projF5Total") - f(r, "actualF5Total") for r in odd])


def corr(pairs):
    xs = [x for x, _ in pairs]; ys = [y for _, y in pairs]
    mx, my = st.mean(xs), st.mean(ys)
    cov = sum((x - mx) * (y - my) for x, y in pairs)
    return cov / math.sqrt(sum((x - mx) ** 2 for x in xs) * sum((y - my) ** 2 for y in ys))


pairs = [(lvl[t], bias[t]) for t in lvl]
print(f"    corr(team level [even half], team p2 bias [odd half]) = {corr(pairs):.3f} (n=30)")

# also split-half on staleGap side: 3yr table is fixed, so only bias side needs the odd half
import re
WORKTREE = os.path.abspath(os.path.join(HERE, "..", "..", "..", "..", ".."))
src = open(os.path.join(WORKTREE, "server", "MLBAIModel.py")).read()
m = re.search(r"TEAM_F5_RS\s*(?::[^=]+)?=\s*\{(.*?)\}", src, re.S)
table = {k: float(v) for k, v in re.findall(r'"([A-Z]{2,3})"\s*:\s*([0-9.]+)', m.group(1))}
scored_even = defaultdict(list)
for t, sub in team_games.items():
    sub = sorted(sub, key=lambda r: (r["gameDate"], r["gameId"]))
    for r in sub[0::2]:
        side = "actualF5Away" if r["awayTeam"] == t else "actualF5Home"
        scored_even[t].append(float(r[side]))
pairs2 = [(st.mean(scored_even[t]) - table[t], bias[t]) for t in lvl if t in table]
print(f"    corr(staleGap [even-half 2026 RS − 3yr table], team p2 bias [odd half]) = "
      f"{corr(pairs2):.3f} (n={len(pairs2)})")
