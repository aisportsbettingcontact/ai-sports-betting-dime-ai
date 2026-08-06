#!/usr/bin/env python3
"""kprops-modeler-01-extract.py — MODELER extraction, kprops market group.

Full-population extraction (no sampling) for the K-props modeler audit:
  1. All final 2026 regular-season MLB games (2026-03-25..2026-07-24) — population census.
  2. ALL live K-prop rows (mlb_strikeout_props) joined to those games.
  3. ALL replay K-prop rows (mlb_replay_prop_projections, propType='K'), every
     modelVersion present at run time.
  4. Walk-forward calibration k_factor per month (and per date if a -p2d series
     exists) parsed from mlb_replay_projections.calibMeta of the calibrated pass.
  5. Run-time snapshot of mlb_replay_grades K-market series (ledger is being
     written by a live pipeline; snapshot documents what existed when we ran).

Read-only: SET SESSION TRANSACTION READ ONLY is issued first.

Outputs (granular/kprops/):
  kprops-modeler-games.csv
  kprops-modeler-live-props.csv
  kprops-modeler-replay-props.csv
  kprops-modeler-kfactors.csv
  kprops-modeler-grades-snapshot.csv
"""
from __future__ import annotations

import csv
import json
import os
import re
import sys

import pymysql
import pymysql.cursors

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, "..", "kprops"))
os.makedirs(OUT, exist_ok=True)

SEASON_START, SEASON_END = "2026-03-25", "2026-07-24"

_URL_RE = re.compile(r"mysql2?://([^:]+):([^@]+)@([^:/]+):?(\d+)?/([^?]+)")


def connect() -> pymysql.connections.Connection:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not set")
    m = _URL_RE.match(url)
    if not m:
        raise RuntimeError("DATABASE_URL did not match mysql:// shape")
    conn = pymysql.connect(
        host=m.group(3), port=int(m.group(4) or 3306), user=m.group(1),
        password=m.group(2), database=m.group(5), ssl={"ssl": {}},
        charset="utf8mb4", cursorclass=pymysql.cursors.DictCursor,
    )
    try:
        with conn.cursor() as cur:
            cur.execute("SET SESSION TRANSACTION READ ONLY")
    except pymysql.err.NotSupportedError:
        # TiDB: READ ONLY is a noop function; this script issues SELECTs only.
        pass
    return conn


def qall(conn, sql, params=None):
    with conn.cursor() as cur:
        cur.execute(sql, params or ())
        return cur.fetchall()


def write_csv(path, rows, cols):
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(cols)
        for r in rows:
            w.writerow([r.get(c) for c in cols])
    print(f"[out] {path}  rows={len(rows)}")


def main() -> int:
    conn = connect()

    # 1. population census: final 2026 regular-season games
    games = qall(conn, """
        SELECT id AS gameId, gameDate, mlbGamePk, awayTeam, homeTeam, gameStatus
        FROM games
        WHERE sport='MLB' AND gameStatus='final'
          AND gameDate BETWEEN %s AND %s
        ORDER BY gameDate, id""", (SEASON_START, SEASON_END))
    write_csv(os.path.join(OUT, "kprops-modeler-games.csv"), games,
              ["gameId", "gameDate", "mlbGamePk", "awayTeam", "homeTeam", "gameStatus"])
    print(f"[census] finals={len(games)} with_gamePk={sum(1 for g in games if g['mlbGamePk'] is not None)}")

    # 2. ALL live K props on those games
    live = qall(conn, """
        SELECT sp.id, sp.gameId, g.gameDate, sp.side, sp.pitcherName, sp.mlbamId,
               sp.kProj, sp.bookLine, sp.pOver, sp.pUnder, sp.anNoVigOverPct,
               sp.edgeOver, sp.edgeUnder, sp.verdict, sp.modelRunAt,
               sp.actualKs, sp.backtestResult, sp.modelError, sp.kLine
        FROM mlb_strikeout_props sp
        JOIN games g ON g.id = sp.gameId
        WHERE g.sport='MLB' AND g.gameStatus='final'
          AND g.gameDate BETWEEN %s AND %s
        ORDER BY g.gameDate, sp.gameId, sp.side""", (SEASON_START, SEASON_END))
    write_csv(os.path.join(OUT, "kprops-modeler-live-props.csv"), live,
              ["id", "gameId", "gameDate", "side", "pitcherName", "mlbamId", "kProj",
               "bookLine", "pOver", "pUnder", "anNoVigOverPct", "edgeOver", "edgeUnder",
               "verdict", "modelRunAt", "actualKs", "backtestResult", "modelError", "kLine"])
    # orphan check: live K prop rows attached to games OUTSIDE the population
    orphan = qall(conn, """
        SELECT COUNT(*) AS n FROM mlb_strikeout_props sp
        LEFT JOIN games g ON g.id = sp.gameId
        WHERE g.id IS NULL OR g.sport<>'MLB' OR g.gameStatus<>'final'
           OR g.gameDate < %s OR g.gameDate > %s""", (SEASON_START, SEASON_END))
    print(f"[live] rows_in_population={len(live)} rows_outside_population={orphan[0]['n']}")

    # 3. ALL replay K props (every modelVersion present right now)
    replay = qall(conn, """
        SELECT id, gameId, gameDate, propType, mlbamId, playerName, side,
               provenance, modelVersion, projValue, pOver, line, createdAt
        FROM mlb_replay_prop_projections
        WHERE propType='K'
        ORDER BY modelVersion, gameDate, gameId, side""")
    write_csv(os.path.join(OUT, "kprops-modeler-replay-props.csv"), replay,
              ["id", "gameId", "gameDate", "propType", "mlbamId", "playerName", "side",
               "provenance", "modelVersion", "projValue", "pOver", "line", "createdAt"])
    from collections import Counter
    vc = Counter(r["modelVersion"] for r in replay)
    print(f"[replay] versions at run time: {dict(vc)}")

    # 4. k_factor per calibration period from calibMeta of every non-p1 series
    kf_rows = []
    versions = sorted(vc.keys())
    calib_versions = qall(conn, """
        SELECT DISTINCT modelVersion FROM mlb_replay_projections
        WHERE calibMeta IS NOT NULL""")
    for v in [r["modelVersion"] for r in calib_versions]:
        metas = qall(conn, """
            SELECT gameId, gameDate, calibMeta FROM mlb_replay_projections
            WHERE modelVersion=%s AND calibMeta IS NOT NULL""", (v,))
        seen = {}
        for r in metas:
            try:
                meta = json.loads(r["calibMeta"])
            except Exception:
                continue
            if "k_factor" not in meta:
                continue
            key = meta.get("month") or meta.get("date") or str(r["gameDate"])[:7]
            entry = seen.setdefault(key, {
                "modelVersion": v, "period": key,
                "k_factor": meta.get("k_factor"), "seed": meta.get("seed"),
                "n_k_train": meta.get("n_k_train"), "k_method": meta.get("k_method"),
                "n_rows": 0, "k_factor_conflict": 0,
            })
            entry["n_rows"] += 1
            if entry["k_factor"] != meta.get("k_factor"):
                entry["k_factor_conflict"] += 1
        kf_rows.extend(sorted(seen.values(), key=lambda e: (e["modelVersion"], e["period"])))
    write_csv(os.path.join(OUT, "kprops-modeler-kfactors.csv"), kf_rows,
              ["modelVersion", "period", "k_factor", "seed", "n_k_train", "k_method",
               "n_rows", "k_factor_conflict"])

    # 5. mlb_replay_grades snapshot for the K market (running pipeline — snapshot only)
    grades = qall(conn, """
        SELECT market, source, modelVersion, COUNT(*) AS n,
               MIN(gameDate) AS minDate, MAX(gameDate) AS maxDate
        FROM mlb_replay_grades
        WHERE market LIKE '%%K%%' OR market LIKE '%%k_prop%%' OR market LIKE '%%prop%%'
        GROUP BY market, source, modelVersion
        ORDER BY market, source, modelVersion""")
    write_csv(os.path.join(OUT, "kprops-modeler-grades-snapshot.csv"), grades,
              ["market", "source", "modelVersion", "n", "minDate", "maxDate"])

    conn.close()
    print("[done] extraction complete")
    return 0


if __name__ == "__main__":
    sys.exit(main())
