#!/usr/bin/env python
"""f5-evaluator-01-extract.py — F5 EVALUATOR granular audit, step 1: full-population extraction.

Population: ALL final 2026 regular-season MLB games 2026-03-25..2026-07-24 with mlbGamePk
(expected 1,555; 1,556 finals total — the 2026-07-14 All-Star exhibition has no mlbGamePk and
is exempt per audit scope).

Pulls, READ-ONLY (SELECT only):
  1. games            — live F5 projections, book F5 lines, actual F5 scores, stored grades
  2. mlb_replay_projections — every wf-* series present at run time (recorded)
  3. mlb_replay_linescores  — f5AwayRuns/f5HomeRuns fallback actuals
  4. mlb_replay_grades      — snapshot of all f5_* rows (ledger being written by a running
                              pipeline; counts recorded as run context, incompleteness there
                              is not a defect)
  5. mlb_schedule_history   — anGameId -> startTimeUtc (for the live-series provenance
                              quarantine flag, P-001), joined via census/game-universe.csv

Outputs (JSON, consumed by f5-evaluator-02-ledger.py):
  granular/f5/f5-evaluator-raw.json
Run context printed to stdout.
"""
from __future__ import annotations

import csv
import json
import os
import sys
from decimal import Decimal

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools", "replay"))
from replay_db import connect  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
AUDIT = os.path.normpath(os.path.join(HERE, "..", ".."))
OUT_DIR = os.path.join(AUDIT, "granular", "f5")
OUT_JSON = os.path.join(OUT_DIR, "f5-evaluator-raw.json")
CENSUS_CSV = os.path.join(AUDIT, "census", "game-universe.csv")

GAME_SQL = """
    SELECT id, gameDate, awayTeam, homeTeam, mlbGamePk, gameStatus, modelRunAt,
           actualF5AwayScore, actualF5HomeScore, actualF5Total,
           modelF5AwayWinPct, modelF5HomeWinPct, modelF5PushPct, modelF5PushRaw,
           modelF5AwayRLCoverPct, modelF5HomeRLCoverPct,
           modelF5OverRate, modelF5UnderRate, modelF5Total,
           modelF5AwayScore, modelF5HomeScore,
           f5AwayML, f5HomeML, f5AwayRunLine, f5HomeRunLine, f5Total, bookTotal,
           awayRunLine, homeRunLine,
           f5MlResult, f5MlCorrect, f5RlResult, f5RlCorrect, f5TotalResult, f5TotalCorrect,
           brierF5Ml, brierF5Total
    FROM games
    WHERE sport='MLB' AND gameStatus='final'
      AND gameDate BETWEEN '2026-03-25' AND '2026-07-24'
      AND mlbGamePk IS NOT NULL
"""

REPLAY_SQL = """
    SELECT gameId, gameDate, modelVersion, asOfCutoffMs,
           pF5AwayMl, projF5Total, pF5Over, pF5AwayRl, calibMeta
    FROM mlb_replay_projections
    WHERE modelVersion LIKE 'wf-%'
"""

LINESCORE_SQL = "SELECT gamePk, gameId, f5AwayRuns, f5HomeRuns FROM mlb_replay_linescores"

GRADES_SQL = """
    SELECT gameId, gameDate, market, source, modelVersion, pick, prob, projValue,
           line, actual, result, correct, brier, signedError
    FROM mlb_replay_grades
    WHERE market IN ('f5_ml','f5_rl','f5_total')
"""

SCHED_SQL = "SELECT anGameId, startTimeUtc FROM mlb_schedule_history"


def jsonable(rows):
    out = []
    for r in rows:
        d = {}
        for k, v in r.items():
            d[k] = float(v) if isinstance(v, Decimal) else v
        out.append(d)
    return out


def main() -> None:
    conn = connect()
    cur = conn.cursor()

    ctx = {}
    cur.execute("""SELECT COUNT(*) n FROM games WHERE sport='MLB' AND gameStatus='final'
                   AND gameDate BETWEEN '2026-03-25' AND '2026-07-24'""")
    ctx["finals_total"] = cur.fetchone()["n"]

    cur.execute("SELECT modelVersion, COUNT(*) n FROM mlb_replay_projections GROUP BY modelVersion")
    ctx["replay_projection_series"] = {r["modelVersion"]: r["n"] for r in cur.fetchall()}

    cur.execute("""SELECT source, modelVersion, market, COUNT(*) n FROM mlb_replay_grades
                   WHERE market LIKE 'f5%%' GROUP BY source, modelVersion, market""")
    ctx["replay_grades_f5_counts_at_run"] = [dict(r) for r in cur.fetchall()]

    cur.execute(GAME_SQL)
    games = jsonable(cur.fetchall())
    ctx["population_n"] = len(games)

    cur.execute(REPLAY_SQL)
    replay = jsonable(cur.fetchall())

    cur.execute(LINESCORE_SQL)
    linescores = jsonable(cur.fetchall())

    cur.execute(GRADES_SQL)
    grades = jsonable(cur.fetchall())
    ctx["grades_f5_rows_snapshotted"] = len(grades)

    cur.execute(SCHED_SQL)
    sched = {r["anGameId"]: r["startTimeUtc"] for r in cur.fetchall()}

    # census link gamesId -> anGameId
    link = {}
    with open(CENSUS_CSV, newline="") as f:
        for row in csv.DictReader(f):
            if row["gamesId"]:
                link[int(row["gamesId"])] = int(row["anGameId"]) if row["anGameId"] else None

    start_by_game = {}
    for gid, an in link.items():
        if an is not None and an in sched:
            start_by_game[gid] = sched[an]
    ctx["games_with_startTimeUtc"] = len(start_by_game)

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(OUT_JSON, "w") as f:
        json.dump({"context": ctx, "games": games, "replay": replay,
                   "linescores": linescores, "grades": grades,
                   "startTimeUtc": {str(k): v for k, v in start_by_game.items()}}, f)

    print(json.dumps(ctx, indent=2))
    conn.close()


if __name__ == "__main__":
    main()
