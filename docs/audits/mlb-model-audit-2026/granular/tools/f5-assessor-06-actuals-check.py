#!/usr/bin/env python
"""f5-assessor-06-actuals-check.py — F5 ASSESSOR granular audit, step 6: per-side F5 actuals
integrity check with external ground truth.

Full-population comparison of games.actualF5AwayScore/HomeScore vs the mlb_replay_linescores
substrate (all 1,555 games), then MLB StatsAPI linescore ground-truth for every divergent row,
plus reconciliation of the stored brierF5Ml / f5MlResult against both candidate outcome sources.

READ-ONLY DB + read-only StatsAPI GETs.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools", "replay"))
from replay_db import connect  # noqa: E402

conn = connect()
cur = conn.cursor()
cur.execute("""
    SELECT g.id, g.gameDate, g.awayTeam, g.homeTeam, g.mlbGamePk,
           g.actualF5AwayScore a5, g.actualF5HomeScore h5, g.actualF5Total,
           g.modelF5AwayWinPct, g.modelF5HomeWinPct, g.brierF5Ml, g.f5MlResult, g.f5RlResult,
           l.f5AwayRuns lsA, l.f5HomeRuns lsH
    FROM games g JOIN mlb_replay_linescores l ON l.gameId = g.id
    WHERE g.sport='MLB' AND g.gameStatus='final'
      AND g.gameDate BETWEEN '2026-03-25' AND '2026-07-24' AND g.mlbGamePk IS NOT NULL
""")
rows = cur.fetchall()
conn.close()
assert len(rows) == 1555, len(rows)

bad = [r for r in rows
       if int(r["a5"]) != int(r["lsA"]) or int(r["h5"]) != int(r["lsH"])]
print(f"[check] games.actualF5* vs linescore substrate: {len(bad)}/1555 divergent")

for r in bad:
    url = f"https://statsapi.mlb.com/api/v1/game/{r['mlbGamePk']}/linescore"
    with urllib.request.urlopen(url, timeout=30) as resp:
        d = json.load(resp)
    inn = d.get("innings", [])
    sa = sum(i.get("away", {}).get("runs", 0) for i in inn[:5])
    sh = sum(i.get("home", {}).get("runs", 0) for i in inn[:5])
    p_away = float(r["modelF5AwayWinPct"]) / 100
    pick_away = float(r["modelF5AwayWinPct"]) >= float(r["modelF5HomeWinPct"])
    truth_away_win = sa > sh
    stored_away_win = int(r["a5"]) > int(r["h5"])
    exp_result_truth = ("WIN" if (pick_away == truth_away_win and sa != sh) else
                        ("PUSH" if sa == sh else "LOSS"))
    brier_stored_y1 = (p_away - 1) ** 2
    brier_stored_y0 = p_away ** 2
    b = float(r["brierF5Ml"]) if r["brierF5Ml"] is not None else None
    brier_src = ("games-actuals" if b is not None and
                 abs(b - (brier_stored_y1 if stored_away_win else brier_stored_y0)) < 1e-4
                 else ("truth" if b is not None and
                       abs(b - (brier_stored_y1 if truth_away_win else brier_stored_y0)) < 1e-4
                       else "?"))
    print(f"  game {r['id']} {r['gameDate']} {r['awayTeam']}@{r['homeTeam']} pk={r['mlbGamePk']}")
    print(f"    games row F5 {r['a5']}-{r['h5']} | linescores {r['lsA']}-{r['lsH']} | "
          f"StatsAPI {sa}-{sh} (truth) | actualF5Total={r['actualF5Total']}")
    print(f"    pick={'away' if pick_away else 'home'} f5MlResult={r['f5MlResult']} "
          f"(truth-consistent={r['f5MlResult'] == exp_result_truth}) | "
          f"brierF5Ml={b} matches outcome source: {brier_src}")
