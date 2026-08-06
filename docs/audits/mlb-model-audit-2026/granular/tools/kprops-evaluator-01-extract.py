#!/usr/bin/env python
"""kprops-evaluator-01-extract.py — K-props EVALUATOR granular audit, step 1: full-population extraction.

Population: ALL final 2026 regular-season MLB games 2026-03-25..2026-07-24 with mlbGamePk
(expected 1,555; 1,556 finals total — the 2026-07-14 All-Star exhibition has no mlbGamePk and
is exempt per audit scope). Prop population = every mlb_strikeout_props row attached to those
games (live series) plus every mlb_replay_prop_projections propType='K' row for every wf-*
modelVersion present at run time (replay series).

Pulls, READ-ONLY (SELECT only):
  1. games                        — population + window props host games (any status, for
                                    postponed-slate prop accounting)
  2. mlb_strikeout_props          — live series: projections, book lines, published probs,
                                    stored grades (actualKs/backtestResult/modelError/
                                    modelCorrect), provenance timestamps
  3. mlb_replay_prop_projections  — propType='K', all wf-* versions present at run time
  4. mlb_replay_linescores        — independent actual substrate: starter ids + starter Ks
  5. mlb_replay_grades            — snapshot of market='k_prop' rows (ledger being written by
                                    a running pipeline; counts recorded as run context,
                                    incompleteness there is NOT a defect)
  6. mlb_pitcher_stats            — mlbamId -> throwsHand (+ normalized-name map) for the
                                    hand metric split
  7. mlb_schedule_history         — startTimeUtc context via census/game-universe.csv

Output (JSON, consumed by kprops-evaluator-02-ledger.py):
  granular/kprops/kprops-evaluator-raw.json
Run context printed to stdout.
"""
from __future__ import annotations

import csv
import datetime
import json
import os
import sys
import unicodedata
from decimal import Decimal

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools", "replay"))
from replay_db import connect  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
AUDIT = os.path.normpath(os.path.join(HERE, "..", ".."))
OUT_DIR = os.path.join(AUDIT, "granular", "kprops")
OUT_JSON = os.path.join(OUT_DIR, "kprops-evaluator-raw.json")
CENSUS_CSV = os.path.join(AUDIT, "census", "game-universe.csv")

GAME_SQL = """
    SELECT id, gameDate, awayTeam, homeTeam, mlbGamePk, gameStatus, doubleHeader, gameNumber
    FROM games
    WHERE sport='MLB'
      AND gameDate BETWEEN '2026-03-25' AND '2026-07-24'
"""

LIVE_SQL = """
    SELECT p.id, p.gameId, g.gameDate, p.side, p.pitcherName, p.pitcherHand, p.mlbamId,
           p.kProj, p.bookLine, p.bookOverOdds, p.bookUnderOdds, p.pOver, p.pUnder,
           p.edgeOver, p.edgeUnder, p.verdict, p.bestEdge, p.bestSide, p.anNoVigOverPct,
           p.actualKs, p.backtestResult, p.modelError, p.modelCorrect,
           p.modelRunAt, p.backtestRunAt, p.createdAt, p.updatedAt, p.kLine
    FROM mlb_strikeout_props p
    JOIN games g ON g.id = p.gameId
    WHERE g.sport='MLB' AND g.gameDate BETWEEN '2026-03-25' AND '2026-07-24'
"""

REPLAY_SQL = """
    SELECT id, gameId, gameDate, propType, mlbamId, playerName, side, provenance,
           modelVersion, projValue, pOver, line
    FROM mlb_replay_prop_projections
    WHERE propType='K' AND modelVersion LIKE 'wf-%'
"""

LINESCORE_SQL = """
    SELECT gamePk, gameId, gameDate, awayStarterId, homeStarterId,
           awayStarterKs, homeStarterKs, awayFinalRuns, homeFinalRuns
    FROM mlb_replay_linescores
"""

GRADES_SQL = """
    SELECT gameId, gameDate, refId, source, modelVersion, pick, prob, projValue, line,
           actual, result, correct, brier, signedError
    FROM mlb_replay_grades
    WHERE market='k_prop'
"""

HANDS_SQL = "SELECT mlbamId, fullName, throwsHand FROM mlb_pitcher_stats"

SCHED_SQL = "SELECT anGameId, startTimeUtc FROM mlb_schedule_history WHERE gameDate >= '2026-03-25'"


def norm_name(name: str) -> str:
    """Replicates server/mlbamIdCache.ts normalizeMlbamName: lowercase, NFD-strip diacritics,
    strip Jr/Sr/II/III/IV suffixes, strip non-alpha."""
    s = unicodedata.normalize("NFD", (name or "").lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    for suf in (" jr.", " jr", " sr.", " sr", " iii", " ii", " iv"):
        if s.endswith(suf):
            s = s[: -len(suf)]
    return "".join(c for c in s if c.isalpha())


def jsonable(rows):
    out = []
    for r in rows:
        d = {}
        for k, v in r.items():
            if isinstance(v, Decimal):
                d[k] = float(v)
            elif isinstance(v, (datetime.datetime, datetime.date)):
                d[k] = v.isoformat()
            else:
                d[k] = v
        out.append(d)
    return out


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    conn = connect()
    try:
        with conn.cursor() as cur:
            # SELECT-only script; read-only enforcement is statement discipline here
            cur.execute(GAME_SQL)
            games = jsonable(cur.fetchall())
            cur.execute(LIVE_SQL)
            live = jsonable(cur.fetchall())
            cur.execute(REPLAY_SQL)
            replay = jsonable(cur.fetchall())
            cur.execute(LINESCORE_SQL)
            linescores = jsonable(cur.fetchall())
            cur.execute(GRADES_SQL)
            grades = jsonable(cur.fetchall())
            cur.execute(HANDS_SQL)
            hands = jsonable(cur.fetchall())
            cur.execute(SCHED_SQL)
            sched = jsonable(cur.fetchall())
    finally:
        conn.close()

    pop = [g for g in games if g["gameStatus"] == "final" and g["mlbGamePk"] is not None]
    finals_no_pk = [g for g in games if g["gameStatus"] == "final" and g["mlbGamePk"] is None]
    nonfinal = [g for g in games if g["gameStatus"] != "final"]

    # anGameId -> games.id from the audited census, then startTimeUtc per games.id
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

    hand_by_mlbam = {}
    hand_by_name = {}
    for h in hands:
        if h["throwsHand"]:
            if h["mlbamId"] is not None:
                hand_by_mlbam[h["mlbamId"]] = h["throwsHand"]
            hand_by_name[norm_name(h["fullName"])] = h["throwsHand"]
    name_by_mlbam = {h["mlbamId"]: h["fullName"] for h in hands if h["mlbamId"] is not None}

    versions = sorted({r["modelVersion"] for r in replay})
    grade_counts = {}
    for g in grades:
        key = f'{g["source"]}/{g["modelVersion"]}'
        grade_counts[key] = grade_counts.get(key, 0) + 1

    ctx = {
        "extracted_at_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "n_population_games": len(pop),
        "n_final_no_gamepk_exempt": len(finals_no_pk),
        "final_no_gamepk_games": finals_no_pk,
        "n_nonfinal_window_games": len(nonfinal),
        "n_live_prop_rows_window": len(live),
        "replay_versions_present": versions,
        "n_replay_k_rows": len(replay),
        "n_linescore_rows": len(linescores),
        "replay_grade_snapshot_k_prop": grade_counts,
        "n_hand_rows": len(hands),
        "n_startTime_mapped": len(start_by_games_id),
    }
    payload = {
        "context": ctx,
        "games": games,
        "live": live,
        "replay": replay,
        "linescores": linescores,
        "grades": grades,
        "handByMlbam": {str(k): v for k, v in hand_by_mlbam.items()},
        "handByName": hand_by_name,
        "nameByMlbam": {str(k): v for k, v in name_by_mlbam.items()},
        "startTimeUtcByGamesId": {str(k): v for k, v in start_by_games_id.items()},
    }
    with open(OUT_JSON, "w") as fh:
        json.dump(payload, fh)
    print(json.dumps(ctx, indent=2, default=str))


if __name__ == "__main__":
    main()
