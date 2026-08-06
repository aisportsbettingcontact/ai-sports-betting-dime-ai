#!/usr/bin/env python
"""kprops-assessor-01-extract.py — K-props ASSESSOR granular audit, step 1: full-population extraction.

Unit of analysis: (gameId, side) starter K-prop slots over ALL 1,555 final 2026
regular-season MLB games (2026-03-25..2026-07-24, mlbGamePk NOT NULL; All-Star
exhibition exempt). 2 slots per game = 3,110 slots; each slot row merges:

  - substrate truth: mlb_replay_linescores starter id/hand/Ks/outs for the side
  - live model row:  mlb_strikeout_props (kProj, bookLine, pOver/pUnder, verdict,
                     anNoVigOverPct, stored actualKs/backtestResult, timestamps)
  - replay rows:     mlb_replay_prop_projections propType='K' for wf-19288f01-p1
                     (raw fixed model, factor 1.0) and -p2 (walk-forward calibrated)
  - as-of features derived strictly from prior-dated substrate rows:
      * pitcher as-of K/9 (cum prior Ks / cum prior outs*3*9), prior-start count
      * days rest (gameDate - previous start date), season-debut flag
      * opponent-team as-of K-allowed per 27 outs vs starters
  - snapshot features (END-OF-WINDOW state, staleness documented in the report):
      * mlb_pitcher_stats k9/xfip/throwsHand by mlbamId
      * mlb_team_batting_splits k9 keyed (oppTeam, starterHand)
      * mlb_lineups.umpire -> mlb_umpire_modifiers.kModifier

signedError convention (matches the audit ledger): proj - actualKs
(negative = model projected too few Ks).

Output: granular/kprops/kprops-assessor-population.csv
READ-ONLY: only SELECT statements are issued.
"""
from __future__ import annotations

import csv
import os
import sys
import unicodedata
from collections import defaultdict
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools", "replay"))
from replay_db import connect  # noqa: E402

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "kprops")
OUT_CSV = os.path.join(OUT_DIR, "kprops-assessor-population.csv")

P1 = "wf-19288f01-p1"
P2 = "wf-19288f01-p2"


def num(x):
    if x is None:
        return None
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def norm_name(s):
    if not s:
        return ""
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    for suf in (" jr", " sr", " ii", " iii", " iv"):
        if s.endswith(suf):
            s = s[: -len(suf)]
    return "".join(c for c in s if c.isalpha())


def dparse(s):
    y, m, d = s.split("-")
    return date(int(y), int(m), int(d))


def main() -> None:
    conn = connect()
    cur = conn.cursor()

    # --- run context (replay ledger is BEING WRITTEN; record state now) ------
    print("[context] state at run time:")
    cur.execute(
        "SELECT modelVersion, COUNT(*) n FROM mlb_replay_prop_projections "
        "WHERE propType='K' GROUP BY modelVersion")
    for r in cur.fetchall():
        print(f"    mlb_replay_prop_projections K / {r['modelVersion']}: {r['n']}")
    cur.execute(
        "SELECT source, modelVersion, COUNT(*) n FROM mlb_replay_grades "
        "WHERE market='k_prop' GROUP BY source, modelVersion")
    for r in cur.fetchall():
        print(f"    mlb_replay_grades k_prop / {r['source']} / {r['modelVersion']}: {r['n']}")

    # --- games population ----------------------------------------------------
    cur.execute("""
        SELECT id, gameDate, awayTeam, homeTeam, mlbGamePk, doubleHeader, gameNumber
        FROM games
        WHERE sport='MLB' AND gameStatus='final'
          AND gameDate BETWEEN '2026-03-25' AND '2026-07-24'
          AND mlbGamePk IS NOT NULL
    """)
    games = {r["id"]: r for r in cur.fetchall()}
    assert len(games) == 1555, f"expected 1555 finals with mlbGamePk, got {len(games)}"
    print(f"[extract] games population: {len(games)}")

    # --- substrate ------------------------------------------------------------
    cur.execute("""
        SELECT gamePk, gameId, gameDate, awayStarterId, homeStarterId,
               awayStarterHand, homeStarterHand,
               awayStarterKs, homeStarterKs, awayStarterOuts, homeStarterOuts
        FROM mlb_replay_linescores
    """)
    ls_rows = cur.fetchall()
    ls_by_gid = {r["gameId"]: r for r in ls_rows}
    in_pop = sum(1 for g in games if g in ls_by_gid)
    print(f"[extract] linescores: {len(ls_rows)} rows, {in_pop}/{len(games)} population coverage")
    assert in_pop == 1555

    # --- live props -----------------------------------------------------------
    cur.execute("""
        SELECT id, gameId, side, pitcherName, mlbamId, kProj, bookLine,
               bookOverOdds, bookUnderOdds, pOver, pUnder, anNoVigOverPct, verdict,
               bestSide, bestEdge, edgeOver, edgeUnder,
               actualKs, backtestResult, modelError, modelCorrect,
               modelRunAt, backtestRunAt, createdAt
        FROM mlb_strikeout_props
    """)
    live_all = cur.fetchall()
    live = {}
    live_out_of_pop = 0
    live_dupes = 0
    for r in live_all:
        if r["gameId"] not in games:
            live_out_of_pop += 1
            continue
        key = (r["gameId"], r["side"])
        if key in live:
            live_dupes += 1
        live[key] = r
    print(f"[extract] live props: {len(live_all)} total rows; {len(live)} slots in population "
          f"({live_out_of_pop} rows outside population; {live_dupes} dup (gameId,side) collisions)")

    # --- replay props ---------------------------------------------------------
    replay = {}
    for ver in (P1, P2):
        cur.execute(
            "SELECT gameId, side, mlbamId, playerName, projValue, pOver, line "
            "FROM mlb_replay_prop_projections WHERE propType='K' AND modelVersion=%s", (ver,))
        rows = cur.fetchall()
        replay[ver] = {}
        oop = 0
        for r in rows:
            if r["gameId"] not in games:
                oop += 1
                continue
            replay[ver][(r["gameId"], r["side"])] = r
        print(f"[extract] replay {ver}: {len(rows)} rows, {len(replay[ver])} in population ({oop} outside)")

    # --- snapshot: pitcher stats ---------------------------------------------
    cur.execute("SELECT mlbamId, fullName, k9, xfip, throwsHand, ip, gamesStarted "
                "FROM mlb_pitcher_stats")
    pstats_rows = cur.fetchall()
    pstats_by_id = {}
    pstats_by_name = {}
    for r in pstats_rows:
        pstats_by_id[r["mlbamId"]] = r
        pstats_by_name[norm_name(r["fullName"])] = r

    # --- snapshot: team batting splits ---------------------------------------
    cur.execute("SELECT teamAbbrev, hand, k9 FROM mlb_team_batting_splits")
    splits = {(r["teamAbbrev"], r["hand"]): num(r["k9"]) for r in cur.fetchall()}

    # --- umpires --------------------------------------------------------------
    cur.execute("SELECT gameId, umpire FROM mlb_lineups")
    ump_by_gid = {r["gameId"]: (r["umpire"] or "").strip() for r in cur.fetchall()}
    cur.execute("SELECT umpireName, kModifier FROM mlb_umpire_modifiers")
    kmod_by_name = {r["umpireName"].strip().lower(): num(r["kModifier"]) for r in cur.fetchall()}
    conn.close()

    # --- as-of substrate features --------------------------------------------
    # starter history: starterId -> sorted list of (date, ks, outs)
    starter_hist = defaultdict(list)
    # team batting history (K allowed to opposing starter): team -> [(date, ks, outs)]
    team_khist = defaultdict(list)
    for r in ls_rows:
        d = r["gameDate"]
        g = games.get(r["gameId"])
        if r["awayStarterId"] is not None and r["awayStarterOuts"] is not None:
            starter_hist[r["awayStarterId"]].append((d, r["awayStarterKs"], r["awayStarterOuts"]))
        if r["homeStarterId"] is not None and r["homeStarterOuts"] is not None:
            starter_hist[r["homeStarterId"]].append((d, r["homeStarterKs"], r["homeStarterOuts"]))
        if g is not None:
            # home team bats against away starter and vice versa
            if r["awayStarterKs"] is not None and r["awayStarterOuts"]:
                team_khist[g["homeTeam"]].append((d, r["awayStarterKs"], r["awayStarterOuts"]))
            if r["homeStarterKs"] is not None and r["homeStarterOuts"]:
                team_khist[g["awayTeam"]].append((d, r["homeStarterKs"], r["homeStarterOuts"]))
    for h in starter_hist.values():
        h.sort(key=lambda t: t[0])
    for h in team_khist.values():
        h.sort(key=lambda t: t[0])

    def asof_pitcher(sid, cutoff):
        """(asofK9, priorStarts, daysRest, asofIpPerStart) strictly before cutoff date."""
        hist = starter_hist.get(sid, [])
        prior = [(d, k, o) for (d, k, o) in hist if d < cutoff]
        if not prior:
            return None, 0, None, None
        ks = sum(k for _, k, _ in prior if k is not None)
        outs = sum(o for _, _, o in prior)
        k9 = ks / (outs / 3.0) * 9.0 if outs > 0 else None
        rest = (dparse(cutoff) - dparse(prior[-1][0])).days
        ip_ps = outs / 3.0 / len(prior)
        return k9, len(prior), rest, ip_ps

    def asof_team_k27(team, cutoff):
        hist = team_khist.get(team, [])
        prior = [(d, k, o) for (d, k, o) in hist if d < cutoff]
        if not prior:
            return None, 0
        ks = sum(k for _, k, _ in prior)
        outs = sum(o for _, _, o in prior)
        return (ks / outs * 27.0 if outs > 0 else None), len(prior)

    # --- merge ----------------------------------------------------------------
    os.makedirs(OUT_DIR, exist_ok=True)
    cols = [
        "gameId", "side", "gameDate", "month", "awayTeam", "homeTeam", "mlbGamePk",
        "oppTeam",
        # substrate truth
        "starterId", "starterHand", "starterKs", "starterOuts",
        # live row
        "liveRowId", "livePitcherName", "liveMlbamId", "liveStarterMismatch",
        "kProj", "bookLine", "lineIsInteger", "pOver", "pUnder", "anNoVigOverPct",
        "verdict", "bestSide", "edgeOver", "edgeUnder",
        "liveStoredActualKs", "liveStoredResult", "liveStoredModelError", "liveStoredModelCorrect",
        "liveTruthKs", "liveTruthSource", "liveSignedError",
        # replay p1/p2
        "p1MlbamId", "p1ProjValue", "p1POver", "p1Line", "p1SignedError",
        "p2ProjValue", "p2POver", "p2Line", "p2SignedError",
        # as-of features
        "asofK9", "asofPriorStarts", "daysRest", "asofIpPerStart",
        "oppAsofK27", "oppAsofPriorGames",
        # snapshot features
        "snapK9", "snapXfip", "snapHand", "snapJoinVia",
        "oppSplitK9VsHand", "umpire", "umpKMod",
    ]

    n_rows = 0
    n_live = 0
    n_live_err = 0
    n_p1_err = 0
    n_p2_err = 0
    n_truth_from_live = 0
    n_starter_missing = 0
    with open(OUT_CSV, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(cols)
        for gid in sorted(games):
            g = games[gid]
            ls = ls_by_gid[gid]
            d = g["gameDate"]
            for side in ("away", "home"):
                sid = ls[f"{side}StarterId"]
                shand = ls[f"{side}StarterHand"]
                sks = ls[f"{side}StarterKs"]
                souts = ls[f"{side}StarterOuts"]
                opp = g["homeTeam"] if side == "away" else g["awayTeam"]
                if sid is None:
                    n_starter_missing += 1

                lv = live.get((gid, side))
                r1 = replay[P1].get((gid, side))
                r2 = replay[P2].get((gid, side))

                kproj = num(lv["kProj"]) if lv else None
                bline = num(lv["bookLine"]) if lv else None
                line_int = (1 if bline is not None and float(bline).is_integer() else
                            (0 if bline is not None else None))

                # live truth Ks: substrate when the live row's pitcher IS the actual
                # starter (or has no id), else the live row's own stored actualKs
                live_truth = None
                truth_src = None
                mismatch = None
                if lv:
                    lmid = lv["mlbamId"]
                    mismatch = 0
                    if lmid is not None and sid is not None and int(lmid) != int(sid):
                        mismatch = 1
                    if sks is not None and (lmid is None or mismatch == 0):
                        live_truth, truth_src = float(sks), "substrate"
                    elif lv["actualKs"] is not None:
                        live_truth, truth_src = float(lv["actualKs"]), "live_actualKs"
                        n_truth_from_live += 1
                live_err = (kproj - live_truth) if (kproj is not None and live_truth is not None) else None

                # replay truth: replay rows are keyed to the actual starter by construction
                p1_err = None
                if r1 and num(r1["projValue"]) is not None and sks is not None \
                        and r1["mlbamId"] is not None and sid is not None \
                        and int(r1["mlbamId"]) == int(sid):
                    p1_err = num(r1["projValue"]) - float(sks)
                p2_err = None
                if r2 and num(r2["projValue"]) is not None and sks is not None \
                        and r2["mlbamId"] is not None and sid is not None \
                        and int(r2["mlbamId"]) == int(sid):
                    p2_err = num(r2["projValue"]) - float(sks)

                a_k9, a_n, rest, a_ip = asof_pitcher(sid, d) if sid is not None else (None, 0, None, None)
                o_k27, o_n = asof_team_k27(opp, d)

                # snapshot pitcher stats: id join first, then normalized name
                ps = None
                join_via = None
                if sid is not None and sid in pstats_by_id:
                    ps, join_via = pstats_by_id[sid], "id"
                elif lv and lv["mlbamId"] is not None and int(lv["mlbamId"]) in pstats_by_id:
                    ps, join_via = pstats_by_id[int(lv["mlbamId"])], "liveId"
                elif lv and norm_name(lv["pitcherName"]) in pstats_by_name:
                    ps, join_via = pstats_by_name[norm_name(lv["pitcherName"])], "name"
                hand_for_split = (shand or (ps["throwsHand"] if ps else None) or "R")
                osplit = splits.get((opp, hand_for_split))

                ump = ump_by_gid.get(gid) or None
                kmod = kmod_by_name.get(ump.lower()) if ump else None

                if lv:
                    n_live += 1
                if live_err is not None:
                    n_live_err += 1
                if p1_err is not None:
                    n_p1_err += 1
                if p2_err is not None:
                    n_p2_err += 1
                n_rows += 1
                w.writerow([
                    gid, side, d, d[:7], g["awayTeam"], g["homeTeam"], g["mlbGamePk"], opp,
                    sid, shand, sks, souts,
                    lv["id"] if lv else None,
                    lv["pitcherName"] if lv else None,
                    lv["mlbamId"] if lv else None,
                    mismatch,
                    kproj, bline, line_int,
                    num(lv["pOver"]) if lv else None,
                    num(lv["pUnder"]) if lv else None,
                    num(lv["anNoVigOverPct"]) if lv else None,
                    lv["verdict"] if lv else None,
                    lv["bestSide"] if lv else None,
                    num(lv["edgeOver"]) if lv else None,
                    num(lv["edgeUnder"]) if lv else None,
                    lv["actualKs"] if lv else None,
                    lv["backtestResult"] if lv else None,
                    num(lv["modelError"]) if lv else None,
                    lv["modelCorrect"] if lv else None,
                    live_truth, truth_src, live_err,
                    r1["mlbamId"] if r1 else None,
                    num(r1["projValue"]) if r1 else None,
                    num(r1["pOver"]) if r1 else None,
                    num(r1["line"]) if r1 else None,
                    p1_err,
                    num(r2["projValue"]) if r2 else None,
                    num(r2["pOver"]) if r2 else None,
                    num(r2["line"]) if r2 else None,
                    p2_err,
                    a_k9, a_n, rest, a_ip, o_k27, o_n,
                    num(ps["k9"]) if ps else None,
                    num(ps["xfip"]) if ps else None,
                    ps["throwsHand"] if ps else None,
                    join_via,
                    osplit, ump, kmod,
                ])

    print(f"[write] {OUT_CSV}: {n_rows} slot rows (2x1555={2*1555})")
    print(f"    live rows merged: {n_live}; live signedError computable: {n_live_err}")
    print(f"    p1 signedError computable: {n_p1_err}; p2: {n_p2_err}")
    print(f"    substrate starter missing: {n_starter_missing} slots")
    print(f"    live truth fell back to stored actualKs: {n_truth_from_live}")
    assert n_rows == 3110


if __name__ == "__main__":
    main()
