#!/usr/bin/env python
"""nrfi-evaluator-01-extract.py — NRFI EVALUATOR granular audit, step 1: full-population extraction.

Population: ALL final 2026 regular-season MLB games 2026-03-25..2026-07-24 with mlbGamePk
(expected 1,555; 1,556 finals total — the 2026-07-14 All-Star exhibition has no mlbGamePk and
is exempt per audit scope).

Pulls, READ-ONLY (SELECT only):
  1. games                   — live modelPNrfi, book NRFI/YRFI odds, actuals (binary + string),
                               stored grade columns, provenance timestamps
  2. mlb_replay_projections  — pNrfi for every wf-* series present at run time (versions recorded)
  3. mlb_replay_linescores   — inn1AwayRuns/inn1HomeRuns independent actual substrate
  4. mlb_replay_grades       — snapshot of market='nrfi_yrfi' rows (ledger being written by a
                               running pipeline; counts recorded as run context, incompleteness
                               there is not a defect)
  5. mlb_schedule_history    — anGameId -> startTimeUtc via census/game-universe.csv (for the
                               live-series provenance quarantine flag, P-001)

Output (JSON, consumed by nrfi-evaluator-02-ledger.py):
  granular/nrfi/nrfi-evaluator-raw.json
Run context printed to stdout.
"""
from __future__ import annotations

import csv
import datetime
import json
import os
import sys
from decimal import Decimal

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools", "replay"))
from replay_db import connect  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
AUDIT = os.path.normpath(os.path.join(HERE, "..", ".."))
OUT_DIR = os.path.join(AUDIT, "granular", "nrfi")
OUT_JSON = os.path.join(OUT_DIR, "nrfi-evaluator-raw.json")
CENSUS_CSV = os.path.join(AUDIT, "census", "game-universe.csv")

GAME_SQL = """
    SELECT id, gameDate, awayTeam, homeTeam, mlbGamePk, gameStatus, doubleHeader, gameNumber,
           modelRunAt, modelPNrfi, nrfiOverOdds, yrfiUnderOdds, modelNrfiOdds, modelYrfiOdds,
           nrfiActualResult, nrfiBacktestResult, nrfiCorrect, nrfiBacktestRunAt,
           actualNrfiBinary, brierNrfi, nrfiCombinedSignal, nrfiFilterPass
    FROM games
    WHERE sport='MLB' AND gameStatus='final'
      AND gameDate BETWEEN '2026-03-25' AND '2026-07-24'
      AND mlbGamePk IS NOT NULL
"""

EXEMPT_SQL = """
    SELECT id, gameDate, awayTeam, homeTeam
    FROM games
    WHERE sport='MLB' AND gameStatus='final'
      AND gameDate BETWEEN '2026-03-25' AND '2026-07-24'
      AND mlbGamePk IS NULL
"""

REPLAY_SQL = """
    SELECT gameId, gameDate, modelVersion, asOfCutoffMs, pNrfi
    FROM mlb_replay_projections
    WHERE modelVersion LIKE 'wf-%'
"""

LINESCORE_SQL = """
    SELECT gamePk, gameId, gameDate, inn1AwayRuns, inn1HomeRuns
    FROM mlb_replay_linescores
"""

GRADES_SQL = """
    SELECT gameId, gameDate, source, modelVersion, pick, prob, line, actual, result,
           correct, brier
    FROM mlb_replay_grades
    WHERE market='nrfi_yrfi'
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


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    conn = connect()
    try:
        with conn.cursor() as cur:
            # TiDB: SET SESSION TRANSACTION READ ONLY unsupported (noop-gated); this script
            # issues SELECT statements only.
            cur.execute(GAME_SQL)
            games = jsonable(cur.fetchall())
            cur.execute(EXEMPT_SQL)
            exempt = jsonable(cur.fetchall())
            cur.execute(REPLAY_SQL)
            replay = jsonable(cur.fetchall())
            cur.execute(LINESCORE_SQL)
            linescores = jsonable(cur.fetchall())
            cur.execute(GRADES_SQL)
            grades = jsonable(cur.fetchall())
            cur.execute(SCHED_SQL)
            sched = jsonable(cur.fetchall())
    finally:
        conn.close()

    # anGameId -> games.id mapping from the audited census
    an_to_games = {}
    with open(CENSUS_CSV, newline="") as fh:
        for row in csv.DictReader(fh):
            if row["gamesId"]:
                an_to_games[int(row["anGameId"])] = int(row["gamesId"])
    start_by_games_id = {}
    for s in sched:
        gid = an_to_games.get(s["anGameId"])
        if gid is not None:
            start_by_games_id[gid] = s["startTimeUtc"]

    versions = sorted({r["modelVersion"] for r in replay})
    grade_counts = {}
    for g in grades:
        key = f'{g["source"]}/{g["modelVersion"]}'
        grade_counts[key] = grade_counts.get(key, 0) + 1

    ctx = {
        "extracted_at_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "n_population_games": len(games),
        "n_exempt_no_gamepk": len(exempt),
        "exempt_games": exempt,
        "replay_versions_present": versions,
        "n_replay_rows": len(replay),
        "n_linescore_rows": len(linescores),
        "replay_grade_snapshot_nrfi_yrfi": grade_counts,
        "n_sched_rows": len(sched),
        "n_startTime_mapped": len(start_by_games_id),
    }
    payload = {
        "context": ctx,
        "games": games,
        "replay": replay,
        "linescores": linescores,
        "grades": grades,
        "startTimeUtcByGamesId": {str(k): v for k, v in start_by_games_id.items()},
    }
    with open(OUT_JSON, "w") as fh:
        json.dump(payload, fh)
    print(json.dumps(ctx, indent=2, default=str))


if __name__ == "__main__":
    main()
