#!/usr/bin/env python
"""f5-assessor-04-followups.py — F5 ASSESSOR granular audit, step 4: mechanism follow-ups.

1. Distribution compression: percentiles of p2 projF5Total vs actual F5 totals; tail rates.
2. Team-identity vs depth confound: corr(per-team actual F5-total mean, per-team p2 bias);
   same for parks; which matchups populate the anomalous team-depth Q2 bucket.
3. TEAM_F5_RS staleness: parse the hardcoded 3-yr table from server/MLBAIModel.py, compare with
   as-played 2026 per-team F5 runs scored, correlate the staleness gap with per-team bias.

Input: granular/f5/f5-assessor-population.csv + server/MLBAIModel.py (read-only)
Output: stdout stats + granular/f5/f5-assessor-team-rs-staleness.csv
"""
from __future__ import annotations

import csv
import math
import os
import re
import statistics as st
from collections import defaultdict, Counter

HERE = os.path.dirname(__file__)
F5_DIR = os.path.join(HERE, "..", "f5")
WORKTREE = os.path.abspath(os.path.join(HERE, "..", "..", "..", "..", ".."))
rows = list(csv.DictReader(open(os.path.join(F5_DIR, "f5-assessor-population.csv"))))
assert len(rows) == 1555


def f(r, c):
    v = r.get(c)
    return None if v in (None, "", "None") else float(v)


def pct(vals, q):
    v = sorted(vals)
    return v[int(q * (len(v) - 1))]


def corr(pairs):
    xs = [x for x, _ in pairs]; ys = [y for _, y in pairs]
    mx, my = st.mean(xs), st.mean(ys)
    cov = sum((x - mx) * (y - my) for x, y in pairs)
    return cov / math.sqrt(sum((x - mx) ** 2 for x in xs) * sum((y - my) ** 2 for y in ys))


# 1. compression --------------------------------------------------------------
act = [f(r, "actualF5Total") for r in rows]
p2 = [f(r, "p2_projF5Total") for r in rows]
print("[1] F5 total distribution: actual vs p2 projection (n=1555)")
print(f"    {'':>10}{'p05':>7}{'p25':>7}{'p50':>7}{'p75':>7}{'p95':>7}{'mean':>7}{'sd':>7}")
for name, v in (("actual", act), ("p2 proj", p2)):
    print(f"    {name:>10}" + "".join(f"{pct(v,q):>7.2f}" for q in (.05, .25, .5, .75, .95))
          + f"{st.mean(v):>7.2f}{st.pstdev(v):>7.2f}")
for thr in (8, 10, 12):
    print(f"    P(actual >= {thr}) = {sum(1 for x in act if x >= thr)/len(act):.4f} ; "
          f"P(p2 proj >= {thr}) = {sum(1 for x in p2 if x >= thr)/len(p2):.4f}")

# 2. team-identity vs depth ---------------------------------------------------
team_games = defaultdict(list)
for r in rows:
    team_games[r["awayTeam"]].append(r)
    team_games[r["homeTeam"]].append(r)
team_stats = {}
for t, sub in team_games.items():
    bias = st.mean([f(r, "p2_projF5Total") - f(r, "actualF5Total") for r in sub])
    team_stats[t] = {"n": len(sub), "actual_mean": st.mean([f(r, "actualF5Total") for r in sub]),
                     "bias": bias}
pairs = [(v["actual_mean"], v["bias"]) for v in team_stats.values()]
print(f"\n[2] corr(team actual F5-total mean, team p2 bias) over 30 teams = {corr(pairs):.3f}")

park_stats = {}
for t in sorted(set(r["homeTeam"] for r in rows)):
    sub = [r for r in rows if r["homeTeam"] == t]
    park_stats[t] = (st.mean([f(r, "actualF5Total") for r in sub]),
                     st.mean([f(r, "p2_projF5Total") - f(r, "actualF5Total") for r in sub]))
print(f"    corr(park actual F5-total mean, park p2 bias) over 30 parks = "
      f"{corr(list(park_stats.values())):.3f}")

# who populates depth-Q2 (matchupTeamAsofDepth in (4.83, 5.02])?
q2 = [r for r in rows if f(r, "matchupTeamAsofDepth") is not None
      and 4.83 < f(r, "matchupTeamAsofDepth") <= 5.02]
cnt = Counter([r["awayTeam"] for r in q2] + [r["homeTeam"] for r in q2])
print(f"    depth-Q2 bucket n={len(q2)}; top teams: {cnt.most_common(8)}")

# 3. TEAM_F5_RS staleness -----------------------------------------------------
src = open(os.path.join(WORKTREE, "server", "MLBAIModel.py")).read()
m = re.search(r"TEAM_F5_RS\s*(?::[^=]+)?=\s*\{(.*?)\}", src, re.S)
table = dict(re.findall(r'"([A-Z]{2,3})"\s*:\s*([0-9.]+)', m.group(1)))
table = {k: float(v) for k, v in table.items()}
print(f"\n[3] TEAM_F5_RS table parsed: {len(table)} teams "
      f"(min {min(table.values()):.3f}, max {max(table.values()):.3f})")

# actual 2026 F5 runs scored per team per game (team perspective)
scored = defaultdict(list)
for r in rows:
    scored[r["awayTeam"]].append(int(r["actualF5Away"]))
    scored[r["homeTeam"]].append(int(r["actualF5Home"]))
out_rows = []
for t in sorted(scored):
    a2026 = st.mean(scored[t])
    tab = table.get(t)
    out_rows.append([t, len(scored[t]), f"{a2026:.4f}",
                     ("" if tab is None else f"{tab:.4f}"),
                     ("" if tab is None else f"{a2026-tab:+.4f}"),
                     f"{team_stats[t]['bias']:+.4f}", f"{team_stats[t]['actual_mean']:.3f}"])
with open(os.path.join(F5_DIR, "f5-assessor-team-rs-staleness.csv"), "w", newline="") as fh:
    w = csv.writer(fh)
    w.writerow(["team", "n_games", "actualF5RS2026", "TEAM_F5_RS_3yr", "staleGap",
                "p2_totalBias_teamGames", "actualF5Total_teamGames"])
    w.writerows(out_rows)
print("    wrote f5-assessor-team-rs-staleness.csv")

haveboth = [(float(r[4]), float(r[5])) for r in out_rows if r[4] != ""]
print(f"    corr(staleGap = actual2026 − 3yrTable, team p2 bias) = {corr(haveboth):.3f} "
      f"(n={len(haveboth)} teams)")
biggest = sorted(out_rows, key=lambda r: -abs(float(r[4]) if r[4] != "" else 0))[:6]
print("    biggest stale gaps:", [(r[0], r[4], "bias " + r[5]) for r in biggest])

# clamp analysis: implied adjustment if the engine had used true 2026 rates
LEAGUE = 2.484
W = 0.10
n_clamped_table = sum(1 for t, v in table.items()
                      if abs((v - LEAGUE) / LEAGUE * W) >= W - 1e-9)
n_clamp_true = sum(1 for t in scored
                   if t in table and abs((st.mean(scored[t]) - LEAGUE) / LEAGUE * W) >= W - 1e-9)
print(f"    teams whose table adj hits the ±10% clamp: {n_clamped_table}; "
      f"with true-2026 rates it would be: {n_clamp_true}")
mean_adj_table = st.mean([max(-W, min(W, (table[t] - LEAGUE) / LEAGUE * W))
                          for t in scored if t in table])
print(f"    note: max possible tendency adj is ±{W*100:.0f}% of mu but the multiplier is "
      f"(rate−league)/league × 0.10 → a team 20% above league mean gets only +2% mu; "
      f"mean table adj across teams = {mean_adj_table*100:+.2f}%")
