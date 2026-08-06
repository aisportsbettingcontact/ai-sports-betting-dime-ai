#!/usr/bin/env python
"""f5-reinforcer-01-extract.py — F5 REINFORCER granular audit, step 1: full-population extraction.

Population: ALL final 2026 regular-season MLB games 2026-03-25..2026-07-24 with mlbGamePk
(expected 1,555; the 2026-07-14 All-Star exhibition is scope-exempt).

Per game this joins:
  - games            (actual FG + F5 scores, live F5 push/ML/RL columns, book F5 lines)
  - mlb_replay_linescores (FG/F5 actual fallback, mirroring calibrate_and_grade.py)
  - mlb_replay_projections wf-19288f01-p1 (raw fixed model, FG + F5 fields)
  - mlb_replay_projections wf-19288f01-p2 (walk-forward calibrated) + parsed calibMeta

Output: granular/f5/f5-reinforcer-population.csv (one row per game, 1,555 rows)
Prints a run-context block (replay version counts incl. any -p2d, mlb_replay_grades f5 state).

READ-ONLY: only SELECT statements are issued.
"""
from __future__ import annotations

import csv
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "tools", "replay"))

# DATABASE_URL bootstrap (worktree .env), mirroring db tooling behaviour
if not os.environ.get("DATABASE_URL"):
    env_path = os.path.join(HERE, "..", "..", "..", "..", "..", ".env")
    env_path = os.path.abspath(env_path)
    if os.path.exists(env_path):
        for line in open(env_path):
            line = line.strip()
            if line.startswith("DATABASE_URL="):
                os.environ["DATABASE_URL"] = line.split("=", 1)[1].strip().strip('"').strip("'")
                break

from replay_db import connect  # noqa: E402

OUT_DIR = os.path.abspath(os.path.join(HERE, "..", "f5"))
OUT_CSV = os.path.join(OUT_DIR, "f5-reinforcer-population.csv")

P1 = "wf-19288f01-p1"
P2 = "wf-19288f01-p2"

GAME_SQL = """
    SELECT id, gameDate, awayTeam, homeTeam, mlbGamePk, gameStatus,
           actualAwayScore, actualHomeScore,
           actualF5AwayScore, actualF5HomeScore,
           modelF5AwayWinPct, modelF5HomeWinPct, modelF5PushPct, modelF5PushRaw,
           modelF5AwayRLCoverPct,
           f5Total, f5AwayRunLine, f5AwayML, f5HomeML, bookTotal
    FROM games
    WHERE sport='MLB' AND gameStatus='final'
      AND gameDate BETWEEN '2026-03-25' AND '2026-07-24'
      AND mlbGamePk IS NOT NULL
"""

REPLAY_SQL = """
    SELECT gameId, gameDate, modelVersion,
           pAwayMl, projAwayScore, projHomeScore, projTotal, pOver, pAwayRl,
           pF5AwayMl, projF5Total, pF5Over, pF5AwayRl, calibMeta
    FROM mlb_replay_projections
    WHERE modelVersion = %s
"""

LINESCORE_SQL = """
    SELECT gameId, f5AwayRuns, f5HomeRuns, awayFinalRuns, homeFinalRuns
    FROM mlb_replay_linescores
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

    # --- linescore fallback --------------------------------------------------
    cur.execute(LINESCORE_SQL)
    ls = {r["gameId"]: r for r in cur.fetchall()}
    print(f"[extract] mlb_replay_linescores rows: {len(ls)}")

    # --- replay p1 / p2 ------------------------------------------------------
    replay = {}
    for ver in (P1, P2):
        cur.execute(REPLAY_SQL, (ver,))
        rs = cur.fetchall()
        replay[ver] = {r["gameId"]: r for r in rs}
        missing = [gid for gid in games if gid not in replay[ver]]
        extra = [gid for gid in replay[ver] if gid not in games]
        print(f"[coverage] {ver}: {len(rs)} rows; missing-for-population={len(missing)} "
              f"extra={len(extra)}")
        assert not missing and not extra, f"{ver} coverage mismatch"
    conn.close()

    # --- merge and write -----------------------------------------------------
    os.makedirs(OUT_DIR, exist_ok=True)
    cols = [
        "gameId", "gameDate", "month", "awayTeam", "homeTeam", "mlbGamePk",
        "actualAway", "actualHome", "fg_actual_source",
        "actualF5Away", "actualF5Home", "f5_actual_source",
        "book_f5Total", "book_f5AwayRunLine", "book_f5AwayML", "book_bookTotal",
        "live_pushPct", "live_pushRaw", "live_awayWinPct", "live_homeWinPct", "live_awayRlCoverPct",
        "p1_pF5AwayMl", "p1_projF5Total", "p1_pF5Over", "p1_pF5AwayRl",
        "p1_projTotal", "p1_projAwayScore", "p1_projHomeScore", "p1_pAwayMl", "p1_pOver",
        "p2_pF5AwayMl", "p2_projF5Total", "p2_pF5Over", "p2_pF5AwayRl", "p2_projTotal",
        "calib_month", "calib_seed", "calib_league_env_mult", "calib_T_f5", "calib_f5_total_sd",
    ]
    n_written = 0
    n_fg_fallback = n_f5_fallback = 0
    with open(OUT_CSV, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(cols)
        for gid in sorted(games):
            g = games[gid]
            l = ls.get(gid)
            # FG actuals: games first, linescore fallback (mirrors calibrate_and_grade.py)
            fa, fh_ = g["actualAwayScore"], g["actualHomeScore"]
            fg_src = "games"
            if fa is None or fh_ is None:
                if l and l["awayFinalRuns"] is not None:
                    fa, fh_ = l["awayFinalRuns"], l["homeFinalRuns"]
                    fg_src = "linescore"
                    n_fg_fallback += 1
                else:
                    fg_src = "missing"
            # F5 actuals
            f5a, f5h = g["actualF5AwayScore"], g["actualF5HomeScore"]
            f5_src = "games"
            if f5a is None or f5h is None:
                if l and l["f5AwayRuns"] is not None:
                    f5a, f5h = l["f5AwayRuns"], l["f5HomeRuns"]
                    f5_src = "linescore"
                    n_f5_fallback += 1
                else:
                    f5_src = "missing"
            r1 = replay[P1][gid]
            r2 = replay[P2][gid]
            meta = json.loads(r2["calibMeta"]) if r2.get("calibMeta") else {}
            w.writerow([
                gid, g["gameDate"], g["gameDate"][:7], g["awayTeam"], g["homeTeam"], g["mlbGamePk"],
                fa, fh_, fg_src, f5a, f5h, f5_src,
                g["f5Total"], g["f5AwayRunLine"], g["f5AwayML"], g["bookTotal"],
                g["modelF5PushPct"], g["modelF5PushRaw"], g["modelF5AwayWinPct"],
                g["modelF5HomeWinPct"], g["modelF5AwayRLCoverPct"],
                r1["pF5AwayMl"], r1["projF5Total"], r1["pF5Over"], r1["pF5AwayRl"],
                r1["projTotal"], r1["projAwayScore"], r1["projHomeScore"], r1["pAwayMl"], r1["pOver"],
                r2["pF5AwayMl"], r2["projF5Total"], r2["pF5Over"], r2["pF5AwayRl"], r2["projTotal"],
                meta.get("month"), meta.get("seed"), meta.get("league_env_mult"),
                meta.get("T_f5"), meta.get("f5_total_sd"),
            ])
            n_written += 1
    print(f"[write] {OUT_CSV}: {n_written} rows "
          f"(FG fallback {n_fg_fallback}, F5 fallback {n_f5_fallback})")


if __name__ == "__main__":
    main()
