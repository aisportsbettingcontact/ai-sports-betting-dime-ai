#!/usr/bin/env python
"""f5-modeler-01-extract.py — F5 MODELER granular audit, step 1: full-population extraction.

Population: ALL final 2026 regular-season MLB games 2026-03-25..2026-07-24 with mlbGamePk
(1,555; the 2026-07-14 AL@NL All-Star exhibition is exempt per audit scope).

Joins, per game:
  - games (live projections + actual F5 scores + live F5 model columns)
  - mlb_replay_projections wf-19288f01-p1 (raw fixed model)
  - mlb_replay_projections wf-19288f01-p2 (walk-forward calibrated) + parsed calibMeta params

Output: granular/f5/f5-modeler-population.csv  (one row per game)
Also prints a run-context block (replay version counts, mlb_replay_grades f5 state at run time).

READ-ONLY: only SELECT statements are issued.
"""
from __future__ import annotations

import csv
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools", "replay"))
from replay_db import connect  # noqa: E402

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "f5")
OUT_CSV = os.path.join(OUT_DIR, "f5-modeler-population.csv")

P1 = "wf-19288f01-p1"
P2 = "wf-19288f01-p2"

GAME_SQL = """
    SELECT id, gameDate, awayTeam, homeTeam, mlbGamePk, gameStatus, modelRunAt,
           actualF5AwayScore, actualF5HomeScore, actualF5Total,
           modelF5AwayWinPct, modelF5HomeWinPct, modelF5PushPct, modelF5PushRaw,
           modelF5AwayRLCoverPct, modelF5HomeRLCoverPct,
           modelF5OverRate, modelF5UnderRate, modelF5Total, modelF5AwayScore, modelF5HomeScore,
           f5Total, f5AwayRunLine, f5AwayML, f5HomeML, bookTotal
    FROM games
    WHERE sport='MLB' AND gameStatus='final'
      AND gameDate BETWEEN '2026-03-25' AND '2026-07-24'
      AND mlbGamePk IS NOT NULL
"""

REPLAY_SQL = """
    SELECT gameId, gameDate, modelVersion, asOfCutoffMs,
           pAwayMl, projAwayScore, projHomeScore, projTotal, pOver, pAwayRl,
           pF5AwayMl, projF5Total, pF5Over, pF5AwayRl, calibMeta
    FROM mlb_replay_projections
    WHERE modelVersion = %s
"""


def main() -> None:
    conn = connect()
    cur = conn.cursor()

    # --- run context ---------------------------------------------------------
    cur.execute("SELECT modelVersion, COUNT(*) n FROM mlb_replay_projections GROUP BY modelVersion")
    print("[context] mlb_replay_projections versions at run time:")
    for r in cur.fetchall():
        print(f"    {r['modelVersion']}: {r['n']}")
    cur.execute(
        "SELECT market, source, modelVersion, COUNT(*) n FROM mlb_replay_grades "
        "WHERE market IN ('f5_ml','f5_rl','f5_total') GROUP BY market, source, modelVersion"
    )
    rows = cur.fetchall()
    print(f"[context] mlb_replay_grades f5 rows at run time: {sum(r['n'] for r in rows)}")
    for r in rows:
        print(f"    {r['market']} / {r['source']} / {r['modelVersion']}: {r['n']}")

    # --- games ---------------------------------------------------------------
    cur.execute(GAME_SQL)
    games = {r["id"]: r for r in cur.fetchall()}
    print(f"[extract] games population: {len(games)}")
    assert len(games) == 1555, f"expected 1555 finals with mlbGamePk, got {len(games)}"

    # --- replay p1 / p2 ------------------------------------------------------
    replay = {}
    for ver in (P1, P2):
        cur.execute(REPLAY_SQL, (ver,))
        rs = cur.fetchall()
        replay[ver] = {r["gameId"]: r for r in rs}
        ingame = sum(1 for gid in replay[ver] if gid in games)
        print(f"[extract] {ver}: {len(rs)} rows, {ingame} matching population gameIds")

    conn.close()

    # coverage checks
    for ver in (P1, P2):
        missing = [gid for gid in games if gid not in replay[ver]]
        extra = [gid for gid in replay[ver] if gid not in games]
        print(f"[coverage] {ver}: missing-for-population={len(missing)} extra-outside-population={len(extra)}")
        if missing:
            print(f"    missing gameIds: {sorted(missing)[:20]}")
        if extra:
            print(f"    extra gameIds: {sorted(extra)[:20]}")

    # --- merge and write -----------------------------------------------------
    os.makedirs(OUT_DIR, exist_ok=True)
    cols = [
        "gameId", "gameDate", "awayTeam", "homeTeam", "mlbGamePk", "modelRunAt",
        "actualF5Away", "actualF5Home", "actualF5Total",
        "live_awayWinPct", "live_homeWinPct", "live_pushPct", "live_pushRaw",
        "live_awayRlCoverPct", "live_homeRlCoverPct",
        "live_overRate", "live_underRate", "live_f5Total",
        "book_f5Total", "book_f5AwayRunLine", "book_bookTotal",
        "p1_pF5AwayMl", "p1_projF5Total", "p1_pF5Over", "p1_pF5AwayRl",
        "p1_projTotal", "p1_projAwayScore", "p1_projHomeScore", "p1_pAwayMl",
        "p2_pF5AwayMl", "p2_projF5Total", "p2_pF5Over", "p2_pF5AwayRl", "p2_projTotal",
        "calib_month", "calib_seed", "calib_league_env_mult", "calib_T_f5", "calib_f5_total_sd",
    ]
    n_written = 0
    with open(OUT_CSV, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(cols)
        for gid in sorted(games):
            g = games[gid]
            r1 = replay[P1].get(gid, {})
            r2 = replay[P2].get(gid, {})
            meta = json.loads(r2["calibMeta"]) if r2.get("calibMeta") else {}
            w.writerow([
                gid, g["gameDate"], g["awayTeam"], g["homeTeam"], g["mlbGamePk"], g["modelRunAt"],
                g["actualF5AwayScore"], g["actualF5HomeScore"], g["actualF5Total"],
                g["modelF5AwayWinPct"], g["modelF5HomeWinPct"], g["modelF5PushPct"], g["modelF5PushRaw"],
                g["modelF5AwayRLCoverPct"], g["modelF5HomeRLCoverPct"],
                g["modelF5OverRate"], g["modelF5UnderRate"], g["modelF5Total"],
                g["f5Total"], g["f5AwayRunLine"], g["bookTotal"],
                r1.get("pF5AwayMl"), r1.get("projF5Total"), r1.get("pF5Over"), r1.get("pF5AwayRl"),
                r1.get("projTotal"), r1.get("projAwayScore"), r1.get("projHomeScore"), r1.get("pAwayMl"),
                r2.get("pF5AwayMl"), r2.get("projF5Total"), r2.get("pF5Over"), r2.get("pF5AwayRl"),
                r2.get("projTotal"),
                meta.get("month"), meta.get("seed"), meta.get("league_env_mult"),
                meta.get("T_f5"), meta.get("f5_total_sd"),
            ])
            n_written += 1
    print(f"[write] {OUT_CSV}: {n_written} rows")


if __name__ == "__main__":
    main()
