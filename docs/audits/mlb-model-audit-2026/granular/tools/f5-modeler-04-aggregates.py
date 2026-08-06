#!/usr/bin/env python
"""f5-modeler-04-aggregates.py — F5 MODELER, step 4: report aggregates.

Input: granular/f5/f5-modeler-population.csv (full 1,555-game population).
Output: granular/f5/f5-modeler-monthly.csv + stdout aggregates for the report:
  - walk-forward calibration parameters by month (T_f5, league_env_mult, f5_total_sd)
    with per-month game counts and per-month F5 ML/RL empirics
  - F5 ML side empirics: p1/p2 priced away mass vs actual away F5 win rate
    (absolute and conditional-on-decided), home/away symmetry check (HFA-skip evidence)
  - the games with no live modelF5* row (replay-only coverage)
  - actual F5 run share of full-game runs (DB, full population) + projF5Total/projTotal
    bias vs actuals for p1 and p2
"""
from __future__ import annotations

import csv
import math
import os
import statistics as st
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
F5_DIR = os.path.join(HERE, "..", "f5")
POP = os.path.join(F5_DIR, "f5-modeler-population.csv")
sys.path.insert(0, os.path.join(HERE, "..", "..", "tools", "replay"))
from replay_db import connect  # noqa: E402


def num(v):
    return None if v in (None, "") else float(v)


def main():
    rows = list(csv.DictReader(open(POP)))
    assert len(rows) == 1555
    n = len(rows)

    # ---- monthly calibration table + per-month empirics
    by_month = defaultdict(list)
    for r in rows:
        by_month[r["calib_month"]].append(r)
    month_rows = []
    for m in sorted(by_month):
        rs = by_month[m]
        p1rl = [num(r["p1_pF5AwayRl"]) for r in rs]
        covers = [1 if (num(r["actualF5Home"]) - num(r["actualF5Away"])) < 0.5 else 0 for r in rs]
        ties = [1 if num(r["actualF5Home"]) == num(r["actualF5Away"]) else 0 for r in rs]
        away_wins = [1 if num(r["actualF5Away"]) > num(r["actualF5Home"]) else 0 for r in rs]
        p1ml = [num(r["p1_pF5AwayMl"]) for r in rs]
        p2ml = [num(r["p2_pF5AwayMl"]) for r in rs]
        month_rows.append({
            "calib_month": m, "n_games": len(rs),
            "T_f5": rs[0]["calib_T_f5"], "league_env_mult": rs[0]["calib_league_env_mult"],
            "f5_total_sd": rs[0]["calib_f5_total_sd"], "seed": rs[0]["calib_seed"],
            "mean_p1_pF5AwayMl": round(st.mean(p1ml), 4),
            "mean_p2_pF5AwayMl": round(st.mean(p2ml), 4),
            "actual_away_f5_win": round(st.mean(away_wins), 4),
            "mean_p1_pF5AwayRl": round(st.mean(p1rl), 4),
            "actual_away_p05_cover": round(st.mean(covers), 4),
            "actual_f5_tie_rate": round(st.mean(ties), 4),
        })
    with open(os.path.join(F5_DIR, "f5-modeler-monthly.csv"), "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(month_rows[0].keys()))
        w.writeheader()
        w.writerows(month_rows)
    print("== MONTHLY WALK-FORWARD PARAMS + EMPIRICS (f5-modeler-monthly.csv) ==")
    for mr in month_rows:
        print(f"  {mr['calib_month']} n={mr['n_games']:3d} T_f5={mr['T_f5']} "
              f"mult={mr['league_env_mult']} f5_sd={mr['f5_total_sd']} seed={mr['seed']} | "
              f"ML p1={mr['mean_p1_pF5AwayMl']:.4f} p2={mr['mean_p2_pF5AwayMl']:.4f} "
              f"actual={mr['actual_away_f5_win']:.4f} | "
              f"RL p1={mr['mean_p1_pF5AwayRl']:.4f} actual={mr['actual_away_p05_cover']:.4f} "
              f"tie={mr['actual_f5_tie_rate']:.4f}")

    # ---- ML empirics / HFA-skip evidence
    away_win = sum(1 for r in rows if num(r["actualF5Away"]) > num(r["actualF5Home"])) / n
    home_win = sum(1 for r in rows if num(r["actualF5Home"]) > num(r["actualF5Away"])) / n
    tie = 1 - away_win - home_win
    p1ml = [num(r["p1_pF5AwayMl"]) for r in rows]
    p2ml = [num(r["p2_pF5AwayMl"]) for r in rows]
    # implied home = 1 - away - push_implied: use implied tie from partition file? approximate
    # with raw partition: home_raw = 1 - pF5AwayRl (RL partition, exact post-M-205)
    p1_home_raw = [1 - num(r["p1_pF5AwayRl"]) for r in rows]
    p1_away_raw = []
    part = {r["gameId"]: r for r in csv.DictReader(open(os.path.join(F5_DIR, "f5-modeler-partition.csv")))}
    for r in rows:
        p = part[r["gameId"]]
        p1_away_raw.append(num(p["implied_away_raw"]))
    se = lambda p: math.sqrt(p * (1 - p) / n)  # noqa: E731
    print("\n== F5 ML SIDE EMPIRICS (HFA-skip evidence, n=1555) ==")
    print(f"  actual F5: home win={home_win:.4f} away win={away_win:.4f} tie={tie:.4f} "
          f"(home-away edge {home_win - away_win:+.4f}, SE~{se(away_win):.4f})")
    print(f"  p1 raw sim (implied): home={st.mean(p1_home_raw):.4f} away={st.mean(p1_away_raw):.4f} "
          f"(home-away edge {st.mean(p1_home_raw) - st.mean(p1_away_raw):+.4f})")
    print(f"  p1 pF5AwayMl (absolute) mean={st.mean(p1ml):.4f} vs actual away win {away_win:.4f} "
          f"-> overprice {st.mean(p1ml) - away_win:+.4f}")
    cond_away = away_win / (1 - tie)
    print(f"  p2 pF5AwayMl mean={st.mean(p2ml):.4f}; conditional actual away|decided={cond_away:.4f} "
          f"(T_f5 was fitted on decided games vs the ABSOLUTE p1 prob)")

    # ---- actual F5 run share + projection bias (READ-ONLY DB pull for FG actuals)
    conn = connect()
    cur = conn.cursor()
    cur.execute("""
        SELECT id, actualAwayScore, actualHomeScore FROM games
        WHERE sport='MLB' AND gameStatus='final'
          AND gameDate BETWEEN '2026-03-25' AND '2026-07-24' AND mlbGamePk IS NOT NULL
    """)
    fg_actual = {r["id"]: float(r["actualAwayScore"]) + float(r["actualHomeScore"])
                 for r in cur.fetchall()}
    conn.close()
    f5_act = [num(r["actualF5Away"]) + num(r["actualF5Home"]) for r in rows]
    fg_act = [fg_actual[int(r["gameId"])] for r in rows]
    shares = [f / g for f, g in zip(f5_act, fg_act) if g > 0]
    p1f5 = [num(r["p1_projF5Total"]) for r in rows]
    p2f5 = [num(r["p2_projF5Total"]) for r in rows]
    p1fg = [num(r["p1_projTotal"]) for r in rows]
    p2fg = [num(r["p2_projTotal"]) for r in rows]
    print("\n== ACTUAL F5 RUN SHARE + PROJECTION BIAS (n=1555) ==")
    print(f"  actual: mean F5 total={st.mean(f5_act):.4f}, mean FG total={st.mean(fg_act):.4f}, "
          f"share-of-means={st.mean(f5_act)/st.mean(fg_act):.4f}, mean per-game share={st.mean(shares):.4f}")
    print(f"  p1: projF5Total mean={st.mean(p1f5):.4f} (bias {st.mean(p1f5)-st.mean(f5_act):+.4f}, "
          f"{(st.mean(p1f5)/st.mean(f5_act)-1)*100:+.2f}%); "
          f"projTotal mean={st.mean(p1fg):.4f} (bias {st.mean(p1fg)-st.mean(fg_act):+.4f}, "
          f"{(st.mean(p1fg)/st.mean(fg_act)-1)*100:+.2f}%)")
    print(f"  p2: projF5Total mean={st.mean(p2f5):.4f} (bias {st.mean(p2f5)-st.mean(f5_act):+.4f}, "
          f"{(st.mean(p2f5)/st.mean(f5_act)-1)*100:+.2f}%); "
          f"projTotal mean={st.mean(p2fg):.4f} (bias {st.mean(p2fg)-st.mean(fg_act):+.4f}, "
          f"{(st.mean(p2fg)/st.mean(fg_act)-1)*100:+.2f}%)")
    print("  (league_env_mult is fitted on FG totals, so it corrects FG and F5 by the same "
          "factor and cannot close the F5-specific gap)")

    # ---- games without live modelF5 rows
    missing = [r for r in rows if r["live_awayWinPct"] in (None, "")]
    print(f"\n== GAMES WITH NO LIVE modelF5* (replay-only), n={len(missing)} ==")
    for r in missing:
        print(f"  {r['gameId']} {r['gameDate']} {r['awayTeam']}@{r['homeTeam']}")


if __name__ == "__main__":
    main()
