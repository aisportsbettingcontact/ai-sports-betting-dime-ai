#!/usr/bin/env python3
"""Smoke-test fixture for calibrate_and_grade.py.

The real pass-1 rows come from the replay projection driver (sibling component). Until it
has populated mlb_replay_projections, this script inserts STAND-IN pass-1 rows under the
unmistakable modelVersion 'wf-smokefix-p1': the live stored projections (games /
mlb_strikeout_props / mlb_hr_props) copied into the replay tables so the walk-forward
calibration fit, pass-2 transformation, and unified grading can be exercised end-to-end on
real projections + real actuals. The fitted values against these fixtures are themselves
meaningful (they measure the LIVE model's residual calibration), but they are NOT the
replay series - `cleanup` removes every wf-smokefix% row from all three replay tables.

Usage:
  smoke_fixture.py create [--may-games 20]   # Mar+Apr (train) + first N May games
  smoke_fixture.py cleanup                   # delete modelVersion LIKE 'wf-smokefix%'
"""

import argparse
import sys

from calibrate_and_grade import (
    DataStore, connect_db, executemany, month_of, num, qall,
)

FIX_P1 = "wf-smokefix-p1"


def create(conn, may_games):
    data = DataStore(conn)
    games = data.games()
    targets = []
    may_count = 0
    for gid in sorted(games, key=lambda i: (games[i]["gameDate"], i)):
        g = games[gid]
        m = month_of(g["gameDate"])
        if m not in ("2026-03", "2026-04", "2026-05"):
            continue
        if g["modelAwayWinPct"] is None or not data.is_final(gid):
            continue
        if m == "2026-05":
            if may_count >= may_games:
                continue
            may_count += 1
        targets.append(gid)
    target_set = set(targets)
    print(f"[fixture] {len(targets)} target games ({may_count} in May)")

    game_rows = []
    for gid in targets:
        g = games[gid]
        cutoff = data.cutoff_ms(gid) or 0
        game_rows.append((
            gid, g["gameDate"], FIX_P1, cutoff,
            num(g["modelAwayWinPct"]) / 100 if g["modelAwayWinPct"] is not None else None,
            num(g["modelAwayScore"]), num(g["modelHomeScore"]),
            num(g["modelProjTotal"]) if g["modelProjTotal"] is not None else num(g["modelTotal"]),
            num(g["modelOverRate"]) / 100 if g["modelOverRate"] is not None else None,
            None,  # live stores no FG RL probability -> exercises the margin fallback
            num(g["modelF5AwayWinPct"]) / 100 if g["modelF5AwayWinPct"] is not None else None,
            num(g["modelF5Total"]),
            num(g["modelF5OverRate"]),  # already 0-1
            num(g["modelF5AwayRLCoverPct"]) / 100 if g["modelF5AwayRLCoverPct"] is not None else None,
            num(g["modelPNrfi"]),
        ))
    n = executemany(conn, """
        INSERT INTO mlb_replay_projections
          (gameId, gameDate, provenance, modelVersion, asOfCutoffMs, pAwayMl,
           projAwayScore, projHomeScore, projTotal, pOver, pAwayRl, pF5AwayMl,
           projF5Total, pF5Over, pF5AwayRl, pNrfi)
        VALUES (%s,%s,'walkforward_replay',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        ON DUPLICATE KEY UPDATE asOfCutoffMs=VALUES(asOfCutoffMs)""", game_rows)
    print(f"[fixture] game rows: {len(game_rows)} (affected {n})")

    prop_rows = []
    for r in data.load_live_kprops():
        if r["gameId"] in target_set and num(r["kProj"]) is not None \
                and r["mlbamId"] is not None:
            prop_rows.append((r["gameId"], r["gameDate"], "K", r["mlbamId"],
                              r["pitcherName"], r["side"], FIX_P1,
                              num(r["kProj"]), num(r["pOver"]), num(r["bookLine"])))
    for r in data.load_live_hrprops():
        if r["gameId"] in target_set and num(r["modelPHr"]) is not None \
                and r["mlbamId"] is not None:
            prop_rows.append((r["gameId"], r["gameDate"], "HR", r["mlbamId"],
                              r["playerName"], r["side"], FIX_P1,
                              None, num(r["modelPHr"]),
                              num(r["bookLine"]) if r["bookLine"] is not None else 0.5))
    n = executemany(conn, """
        INSERT INTO mlb_replay_prop_projections
          (gameId, gameDate, propType, mlbamId, playerName, side, provenance,
           modelVersion, projValue, pOver, line)
        VALUES (%s,%s,%s,%s,%s,%s,'walkforward_replay',%s,%s,%s,%s)
        ON DUPLICATE KEY UPDATE line=VALUES(line)""", prop_rows)
    print(f"[fixture] prop rows: {len(prop_rows)} (affected {n})")
    may_ids = [gid for gid in targets if month_of(games[gid]['gameDate']) == '2026-05']
    print(f"[fixture] May game ids: {','.join(str(i) for i in may_ids)}")


def cleanup(conn):
    for table in ("mlb_replay_grades", "mlb_replay_prop_projections",
                  "mlb_replay_projections"):
        with conn.cursor() as cur:
            n = cur.execute(
                f"DELETE FROM {table} WHERE modelVersion LIKE %s", ("wf-smokefix%",))
        print(f"[cleanup] {table}: deleted {n}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("command", choices=["create", "cleanup"])
    ap.add_argument("--may-games", type=int, default=20)
    args = ap.parse_args()
    conn = connect_db()
    if args.command == "create":
        create(conn, args.may_games)
    else:
        cleanup(conn)
    conn.close()


if __name__ == "__main__":
    main()
