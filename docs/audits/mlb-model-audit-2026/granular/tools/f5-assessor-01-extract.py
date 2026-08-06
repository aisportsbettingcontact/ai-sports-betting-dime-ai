#!/usr/bin/env python
"""f5-assessor-01-extract.py — F5 ASSESSOR granular audit, step 1: full-population extraction.

Residual-structure substrate: one row per game for ALL 1,555 final 2026 regular-season MLB
games (2026-03-25..2026-07-24, mlbGamePk NOT NULL; All-Star exhibition exempt).

Per game this joins/derives:
  - games: live modelF5* columns, actual F5 scores, book lines
  - mlb_replay_projections p1/p2 (wf-19288f01) + calibMeta
  - mlb_replay_linescores: starter ids/outs (this game) + inn1 runs; used to build
    AS-OF starter IP means (mean prior-start outs/3, strictly earlier gameDate) and
    AS-OF team starter-IP depth (mean starter outs/3 over the team's prior games)
  - mlb_park_factors: parkFactor3yr keyed by homeTeam
  - mlb_schedule_history: DK closing/pregame total fallback for the 13 games with NULL bookTotal
  - Derived per-game: p1 implied raw tie mass t_raw + raw away/home masses (solving the
    engine's own three-way blend equations), live raw masses (stored directly), the
    tie-inclusive "fixed" live away+0.5 cover probability, conditional ML probabilities.

Output: granular/f5/f5-assessor-population.csv
READ-ONLY: only SELECT statements are issued.
"""
from __future__ import annotations

import csv
import json
import math
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools", "replay"))
from replay_db import connect  # noqa: E402

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "f5")
OUT_CSV = os.path.join(OUT_DIR, "f5-assessor-population.csv")

P1 = "wf-19288f01-p1"
P2 = "wf-19288f01-p2"
PUSH_PRIOR = 0.1507  # EMPIRICAL_PRIORS["f5_push_rate"]


def num(x):
    if x is None:
        return None
    return float(x)


def solve_traw(A, R):
    """Solve for raw tie mass t from p1's stored absolute away ML (A) and tie-inclusive
    away RL (R = a_raw + t_raw), using the engine's own blend:
      push_adj = 0.6 t + 0.4*0.1507 ;  A = (R - t) * (1 - push_adj) / (1 - t)
    -> 0.6 t^2 + (A - 0.6R - (1 - 0.4*0.1507)) t + ((1 - 0.4*0.1507) R - A) = 0
    Returns t in (0, R) or None."""
    c1 = 1.0 - 0.4 * PUSH_PRIOR  # 0.93972
    a2 = 0.6
    b2 = A - 0.6 * R - c1
    c2 = c1 * R - A
    disc = b2 * b2 - 4 * a2 * c2
    if disc < 0:
        return None
    for sgn in (-1.0, 1.0):
        t = (-b2 + sgn * math.sqrt(disc)) / (2 * a2)
        if 0.0 < t < min(R, 0.5):
            return t
    return None


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

    # --- games population ----------------------------------------------------
    cur.execute("""
        SELECT id, gameDate, awayTeam, homeTeam, mlbGamePk,
               actualF5AwayScore, actualF5HomeScore, actualF5Total,
               modelF5AwayWinPct, modelF5HomeWinPct, modelF5PushPct, modelF5PushRaw,
               modelF5AwayRLCoverPct, modelF5OverRate, modelF5Total,
               modelF5AwayScore, modelF5HomeScore,
               f5Total, bookTotal
        FROM games
        WHERE sport='MLB' AND gameStatus='final'
          AND gameDate BETWEEN '2026-03-25' AND '2026-07-24'
          AND mlbGamePk IS NOT NULL
    """)
    games = {r["id"]: r for r in cur.fetchall()}
    assert len(games) == 1555, f"expected 1555 finals with mlbGamePk, got {len(games)}"
    print(f"[extract] games population: {len(games)}")

    # --- replay p1/p2 --------------------------------------------------------
    replay = {}
    for ver in (P1, P2):
        cur.execute(
            "SELECT gameId, pF5AwayMl, projF5Total, pF5Over, pF5AwayRl, projTotal, calibMeta "
            "FROM mlb_replay_projections WHERE modelVersion=%s", (ver,))
        replay[ver] = {r["gameId"]: r for r in cur.fetchall()}
        miss = [g for g in games if g not in replay[ver]]
        assert not miss, f"{ver} missing {len(miss)} population games"
        print(f"[extract] {ver}: {len(replay[ver])} rows, full population coverage")

    # --- linescores (starter substrate) --------------------------------------
    cur.execute("""
        SELECT gamePk, gameId, gameDate, awayStarterId, homeStarterId,
               awayStarterOuts, homeStarterOuts, awayStarterKs, homeStarterKs,
               inn1AwayRuns, inn1HomeRuns, f5AwayRuns, f5HomeRuns
        FROM mlb_replay_linescores
    """)
    ls_rows = cur.fetchall()
    ls_by_gid = {r["gameId"]: r for r in ls_rows}
    in_pop = sum(1 for g in games if g in ls_by_gid)
    print(f"[extract] linescores: {len(ls_rows)} rows, {in_pop}/{len(games)} population coverage")
    assert in_pop == 1555

    # cross-check actual F5 totals vs linescore substrate
    mism = 0
    for gid, g in games.items():
        ls = ls_by_gid[gid]
        if ls["f5AwayRuns"] is not None and ls["f5HomeRuns"] is not None:
            if (int(g["actualF5AwayScore"]) != int(ls["f5AwayRuns"])
                    or int(g["actualF5HomeScore"]) != int(ls["f5HomeRuns"])):
                mism += 1
    print(f"[check] games.actualF5* vs linescores f5*Runs mismatches: {mism}")

    # --- park factors --------------------------------------------------------
    cur.execute("SELECT teamAbbrev, venueName, parkFactor3yr FROM mlb_park_factors")
    parks = {r["teamAbbrev"]: r for r in cur.fetchall()}

    # --- schedule history totals fallback ------------------------------------
    cur.execute("""
        SELECT gameDate, awayAbbr, homeAbbr, dkTotal, dkClosingTotal
        FROM mlb_schedule_history
        WHERE gameDate BETWEEN '2026-03-25' AND '2026-07-24'
    """)
    sched = defaultdict(list)
    for r in cur.fetchall():
        sched[(r["gameDate"], r["awayAbbr"], r["homeAbbr"])].append(r)
    conn.close()

    # --- as-of starter IP means ----------------------------------------------
    # starter history: starterId -> sorted [(gameDate, outs)]
    starter_hist = defaultdict(list)
    team_hist = defaultdict(list)  # team -> [(gameDate, starterOuts of that team's starter)]
    for r in ls_rows:
        gid = r["gameId"]
        g = games.get(gid)
        d = r["gameDate"]
        if r["awayStarterId"] is not None and r["awayStarterOuts"] is not None:
            starter_hist[r["awayStarterId"]].append((d, r["awayStarterOuts"]))
        if r["homeStarterId"] is not None and r["homeStarterOuts"] is not None:
            starter_hist[r["homeStarterId"]].append((d, r["homeStarterOuts"]))
        if g is not None:
            if r["awayStarterOuts"] is not None:
                team_hist[g["awayTeam"]].append((d, r["awayStarterOuts"]))
            if r["homeStarterOuts"] is not None:
                team_hist[g["homeTeam"]].append((d, r["homeStarterOuts"]))
    for h in starter_hist.values():
        h.sort()
    for h in team_hist.values():
        h.sort()

    def asof_ip(hist_list, cutoff_date):
        prior = [outs / 3.0 for (d, outs) in hist_list if d < cutoff_date]
        if not prior:
            return None, 0
        return sum(prior) / len(prior), len(prior)

    # --- merge + derive ------------------------------------------------------
    os.makedirs(OUT_DIR, exist_ok=True)
    cols = [
        "gameId", "gameDate", "month", "awayTeam", "homeTeam", "mlbGamePk",
        "venue", "parkFactor3yr",
        "actualF5Away", "actualF5Home", "actualF5Total", "f5Tie", "awayF5Win",
        "awayCover",  # away +0.5 covers (home-away < +0.5, ties cover)
        "games_actualF5Away", "games_actualF5Home", "gamesF5Mismatch",
        "inn1Total",
        "awayStarterId", "homeStarterId", "awayStarterOutsGame", "homeStarterOutsGame",
        "awayStarterAsofIp", "awayStarterPriorStarts",
        "homeStarterAsofIp", "homeStarterPriorStarts", "matchupAsofIp",
        "awayTeamAsofDepth", "homeTeamAsofDepth", "matchupTeamAsofDepth",
        "bookTotal", "totalLineUsed", "totalLineSource", "book_f5Total",
        "live_awayAbs", "live_homeAbs", "live_pushAdj", "live_tRaw",
        "live_rlCoverStored", "live_rlCoverFixed", "live_condAway",
        "live_projF5Total", "live_synthLine", "live_overRate",
        "p1_pF5AwayMl", "p1_projF5Total", "p1_pF5Over", "p1_pF5AwayRl", "p1_projTotal",
        "p1_tRaw", "p1_pushAdj", "p1_homeAbs", "p1_condAway",
        "p2_pF5AwayMl", "p2_projF5Total", "p2_pF5Over", "p2_pF5AwayRl",
        "calib_month", "calib_T_f5", "calib_league_env_mult", "calib_f5_total_sd",
    ]

    n_live = 0
    n_t_solved = 0
    with open(OUT_CSV, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(cols)
        for gid in sorted(games):
            g = games[gid]
            ls = ls_by_gid[gid]
            r1 = replay[P1][gid]
            r2 = replay[P2][gid]
            meta = json.loads(r2["calibMeta"]) if r2.get("calibMeta") else {}
            date = g["gameDate"]

            # TRUTH actuals from the linescore substrate (StatsAPI-verified on the 3 rows
            # where games.actualF5* diverges — games row is the wrong one in all 3).
            ga5, gh5 = int(g["actualF5AwayScore"]), int(g["actualF5HomeScore"])
            if ls["f5AwayRuns"] is not None and ls["f5HomeRuns"] is not None:
                a5, h5 = int(ls["f5AwayRuns"]), int(ls["f5HomeRuns"])
            else:
                a5, h5 = ga5, gh5
            f5_mismatch = 1 if (a5 != ga5 or h5 != gh5) else 0
            tie = 1 if a5 == h5 else 0
            away_win = 1 if a5 > h5 else 0
            away_cover = 1 if (h5 - a5) < 0.5 else 0  # away +0.5, ties cover

            # as-of starter depth
            a_ip, a_n = asof_ip(starter_hist.get(ls["awayStarterId"], []), date)
            h_ip, h_n = asof_ip(starter_hist.get(ls["homeStarterId"], []), date)
            m_ip = (a_ip + h_ip) / 2 if (a_ip is not None and h_ip is not None) else None
            at_ip, _ = asof_ip(team_hist.get(g["awayTeam"], []), date)
            ht_ip, _ = asof_ip(team_hist.get(g["homeTeam"], []), date)
            mt_ip = (at_ip + ht_ip) / 2 if (at_ip is not None and ht_ip is not None) else None

            # total line used for bucketing: bookTotal else dkClosingTotal else dkTotal
            book_total = num(g["bookTotal"])
            line_used, line_src = book_total, "bookTotal"
            if line_used is None:
                cands = sched.get((date, g["awayTeam"], g["homeTeam"]), [])
                if len(cands) >= 1:
                    c = cands[0]
                    if len(cands) == 1 or all(
                        num(x["dkClosingTotal"]) == num(c["dkClosingTotal"]) for x in cands
                    ):
                        line_used = num(c["dkClosingTotal"])
                        line_src = "dkClosingTotal"
                        if line_used is None:
                            line_used, line_src = num(c["dkTotal"]), "dkTotal"
            if line_used is None:
                line_src = "none"

            # live derived
            la = num(g["modelF5AwayWinPct"])
            lh = num(g["modelF5HomeWinPct"])
            lp = num(g["modelF5PushPct"])
            lt = num(g["modelF5PushRaw"])
            lrl = num(g["modelF5AwayRLCoverPct"])
            live_a = la / 100 if la is not None else None
            live_h = lh / 100 if lh is not None else None
            live_rl = lrl / 100 if lrl is not None else None
            live_fixed = live_cond = None
            if live_a is not None and live_h is not None and lp is not None and lt is not None:
                n_live += 1
                a_raw = live_a * (1 - lt) / (1 - lp) if lp < 1 else None
                live_fixed = (a_raw + lt) if a_raw is not None else None
                live_cond = live_a / (live_a + live_h) if (live_a + live_h) > 0 else None
            live_proj = None
            if g["modelF5AwayScore"] is not None and g["modelF5HomeScore"] is not None:
                live_proj = num(g["modelF5AwayScore"]) + num(g["modelF5HomeScore"])

            # p1 derived
            A = num(r1["pF5AwayMl"])
            R = num(r1["pF5AwayRl"])
            t1 = solve_traw(A, R) if (A is not None and R is not None) else None
            p1_push = p1_habs = p1_cond = None
            if t1 is not None:
                n_t_solved += 1
                p1_push = 0.6 * t1 + 0.4 * PUSH_PRIOR
                p1_habs = 1.0 - A - p1_push
                p1_cond = A / (A + p1_habs) if (A + p1_habs) > 0 else None

            w.writerow([
                gid, date, date[:7], g["awayTeam"], g["homeTeam"], g["mlbGamePk"],
                parks.get(g["homeTeam"], {}).get("venueName"),
                parks.get(g["homeTeam"], {}).get("parkFactor3yr"),
                a5, h5, a5 + h5, tie, away_win, away_cover,
                ga5, gh5, f5_mismatch,
                (None if ls["inn1AwayRuns"] is None or ls["inn1HomeRuns"] is None
                 else int(ls["inn1AwayRuns"]) + int(ls["inn1HomeRuns"])),
                ls["awayStarterId"], ls["homeStarterId"],
                ls["awayStarterOuts"], ls["homeStarterOuts"],
                a_ip, a_n, h_ip, h_n, m_ip, at_ip, ht_ip, mt_ip,
                book_total, line_used, line_src, num(g["f5Total"]),
                live_a, live_h, lp, lt, live_rl, live_fixed, live_cond,
                live_proj, num(g["modelF5Total"]), num(g["modelF5OverRate"]),
                A, num(r1["projF5Total"]), num(r1["pF5Over"]), R, num(r1["projTotal"]),
                t1, p1_push, p1_habs, p1_cond,
                num(r2["pF5AwayMl"]), num(r2["projF5Total"]), num(r2["pF5Over"]),
                num(r2["pF5AwayRl"]),
                meta.get("month"), meta.get("T_f5"), meta.get("league_env_mult"),
                meta.get("f5_total_sd"),
            ])

    print(f"[write] {OUT_CSV}: 1555 rows; live-complete={n_live}; p1 t_raw solved={n_t_solved}/1555")


if __name__ == "__main__":
    main()
