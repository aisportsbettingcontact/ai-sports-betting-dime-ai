#!/usr/bin/env python
"""nrfi-assessor-01-extract.py — NRFI ASSESSOR step 1: full-population feature extraction.

Population: ALL final 2026 regular-season MLB games 2026-03-25..2026-07-24 with mlbGamePk
(1,555; the 2026-07-14 All-Star exhibition has no mlbGamePk and is exempt per audit scope).

Per game, one row with:
  - three probability series: live games.modelPNrfi (0-1, decimal(5,2)),
    replay wf-19288f01-p1 (prior-only fixed model), wf-19288f01-p2 (walk-forward logistic)
  - actual NRFI from mlb_replay_linescores inn1 runs (primary substrate), games binary crosscheck
  - residual-slice features, reconstructed with the EXACT as-of rules of
    tools/replay/asof_features.py (read this session; cutoff = strictly-before ET game date):
      * starter 2026 as-of NRFI rate/starts (away SP allowed = inn1HomeRuns, home SP = inn1AwayRuns)
      * 2025 seeded priors from mlb_pitcher_stats (nrfiRate/nrfiStarts, LIMIT-1 per mlbamId,
        mirroring AsOfFeatureStore._nrfi_prior)
      * shrunk rate = (nrfi26 + eff_prior*K)/(starts26 + K), K=10, eff_prior=prior or 0.8899
      * team as-of inning-1 score rates + league pooled rate shrunk toward 0.282 w/ 100 pseudo-halves
      * park factor (mlb_park_factors.parkFactor3yr by home abbrev)
      * starter hands (linescores substrate, null->R like game_meta)
  - context: startTimeUtc (census anGameId->gamesId link), local start hour via static team
    UTC-offset map (MLB season = DST everywhere except ARI), day/night (day = local hour < 17),
    P-001 leakage flag (modelRunAt >= startTimeUtc or start unknown), starter names.

READ-ONLY: SELECT statements only. Output: granular/nrfi/nrfi-assessor-features.csv
Run context printed to stdout.
"""
from __future__ import annotations

import csv
import datetime
import json
import math
import os
import sys
from decimal import Decimal

HERE = os.path.dirname(os.path.abspath(__file__))
AUDIT = os.path.normpath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(AUDIT, "tools", "replay"))
from replay_db import connect  # noqa: E402

OUT_DIR = os.path.join(AUDIT, "granular", "nrfi")
OUT_CSV = os.path.join(OUT_DIR, "nrfi-assessor-features.csv")
CENSUS_CSV = os.path.join(AUDIT, "census", "game-universe.csv")

P1 = "wf-19288f01-p1"
P2 = "wf-19288f01-p2"

# asof_features.py constants (mirrored; VERIFIED this session at lines 132-135, 1185)
LEAGUE_PITCHER_NRFI_PRIOR = 0.8899
NRFI_SHRINKAGE_K = 10
TEAM_NRFI_LEAGUE_MEAN = 0.5150
LEAGUE_TEAM_I1_SCORE_RATE = 1 - math.sqrt(TEAM_NRFI_LEAGUE_MEAN)  # ~0.28237

# Static home-team UTC offsets for Mar-Jul (DST everywhere except ARI/MST).
TEAM_UTC_OFFSET = {
    # Eastern (-4)
    "ATL": -4, "BAL": -4, "BOS": -4, "CIN": -4, "CLE": -4, "DET": -4, "MIA": -4,
    "NYM": -4, "NYY": -4, "PHI": -4, "PIT": -4, "TB": -4, "TOR": -4, "WSH": -4,
    # Central (-5)
    "CHC": -5, "CWS": -5, "HOU": -5, "KC": -5, "MIL": -5, "MIN": -5, "STL": -5, "TEX": -5,
    # Mountain (-6), Arizona no-DST (-7)
    "COL": -6, "ARI": -7,
    # Pacific (-7)
    "ATH": -7, "LAA": -7, "LAD": -7, "SD": -7, "SEA": -7, "SF": -7,
}


def fnum(v):
    if v is None:
        return None
    if isinstance(v, Decimal):
        return float(v)
    return float(v) if isinstance(v, (int, float)) else v


def iso_to_dt(s):
    if not s:
        return None
    try:
        return datetime.datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except ValueError:
        return None


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    conn = connect()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, gameDate, awayTeam, homeTeam, mlbGamePk, doubleHeader, gameNumber,
                       modelRunAt, modelPNrfi, nrfiOverOdds, yrfiUnderOdds,
                       nrfiActualResult, actualNrfiBinary
                FROM games
                WHERE sport='MLB' AND gameStatus='final'
                  AND gameDate BETWEEN '2026-03-25' AND '2026-07-24'
                  AND mlbGamePk IS NOT NULL""")
            games = cur.fetchall()
            cur.execute(
                "SELECT gameId, modelVersion, pNrfi FROM mlb_replay_projections "
                "WHERE modelVersion IN (%s, %s)", (P1, P2))
            replay = cur.fetchall()
            cur.execute("""
                SELECT gamePk, gameId, gameDate, awayStarterId, homeStarterId,
                       awayStarterHand, homeStarterHand, inn1AwayRuns, inn1HomeRuns
                FROM mlb_replay_linescores""")
            linescores = cur.fetchall()
            cur.execute("SELECT teamAbbrev, parkFactor3yr FROM mlb_park_factors")
            parks = {r["teamAbbrev"]: fnum(r["parkFactor3yr"]) for r in cur.fetchall()}
            # Mirror AsOfFeatureStore._nrfi_prior: first row with nrfiRate IS NOT NULL per id.
            cur.execute(
                "SELECT id, mlbamId, nrfiRate, nrfiStarts FROM mlb_pitcher_stats "
                "WHERE nrfiRate IS NOT NULL ORDER BY id")
            priors = {}
            for r in cur.fetchall():
                priors.setdefault(r["mlbamId"], (fnum(r["nrfiRate"]), r["nrfiStarts"]))
            cur.execute("SELECT mlbamId, name FROM mlb_players WHERE mlbamId IS NOT NULL")
            names = {r["mlbamId"]: r["name"] for r in cur.fetchall()}
            cur.execute("SELECT anGameId, startTimeUtc FROM mlb_schedule_history")
            sched = {r["anGameId"]: r["startTimeUtc"] for r in cur.fetchall()}
    finally:
        conn.close()

    # census link: gamesId -> anGameId -> startTimeUtc
    start_by_gid = {}
    with open(CENSUS_CSV, newline="") as fh:
        for row in csv.DictReader(fh):
            if row["gamesId"] and int(row["anGameId"]) in sched:
                start_by_gid[int(row["gamesId"])] = sched[int(row["anGameId"])]

    ls_by_gid = {r["gameId"]: r for r in linescores}
    p_by_ver = {P1: {}, P2: {}}
    for r in replay:
        p_by_ver[r["modelVersion"]][r["gameId"]] = fnum(r["pNrfi"])

    # ---- as-of substrates from the full linescore table (exact asof_features.py rules) ----
    # starter as-of: rows with gameDate < cutoff_date AND gameDate >= 'YYYY-01-01'
    ls_sorted = sorted(linescores, key=lambda r: r["gameDate"])
    # (a) per-starter list of (gameDate, allowed_runs)
    starter_rows = {}
    for r in ls_sorted:
        if r["awayStarterId"] is not None and r["inn1HomeRuns"] is not None:
            starter_rows.setdefault(r["awayStarterId"], []).append((r["gameDate"], r["inn1HomeRuns"]))
        if r["homeStarterId"] is not None and r["inn1AwayRuns"] is not None:
            starter_rows.setdefault(r["homeStarterId"], []).append((r["gameDate"], r["inn1AwayRuns"]))

    def starter_asof(pid, cutoff_date):
        if pid is None:
            return 0, 0
        starts = nrfi = 0
        for d, allowed in starter_rows.get(pid, []):
            if d < cutoff_date and d >= cutoff_date[:4] + "-01-01":
                starts += 1
                if allowed == 0:
                    nrfi += 1
        return starts, nrfi

    # (b) team inn-1 score rates as-of, memoized per cutoff_date
    team_rate_cache = {}

    def team_rates_asof(cutoff_date):
        if cutoff_date in team_rate_cache:
            return team_rate_cache[cutoff_date]
        acc, pooled = {}, [0, 0]
        for r in ls_sorted:
            if r["gameDate"] >= cutoff_date:
                continue
            # NOTE: asof_features._substrate_rows uses awayTeam/homeTeam columns of the
            # substrate; the linescores table here lacks team columns, so we join through
            # the games row (same gameId key) — identical team labels.
            g = games_by_id.get(r["gameId"])
            if g is None:
                continue
            for team, runs in ((g["awayTeam"], r["inn1AwayRuns"]), (g["homeTeam"], r["inn1HomeRuns"])):
                if runs is None:
                    continue
                a = acc.setdefault(team, [0, 0])
                a[0] += 1 if runs > 0 else 0
                a[1] += 1
                pooled[0] += 1 if runs > 0 else 0
                pooled[1] += 1
        rates = {t: (s / n, n) for t, (s, n) in acc.items() if n > 0}
        league = (pooled[0] + LEAGUE_TEAM_I1_SCORE_RATE * 100.0) / (pooled[1] + 100.0)
        team_rate_cache[cutoff_date] = (rates, league)
        return rates, league

    games_by_id = {g["id"]: g for g in games}

    n_no_linescore = n_actual_disagree = 0
    rows = []
    for g in sorted(games, key=lambda r: (r["gameDate"], r["id"])):
        gid = g["id"]
        ls = ls_by_gid.get(gid)
        cutoff_date = g["gameDate"][:10]

        # actual: linescore substrate primary; games binary crosscheck
        actual = None
        i1a = i1h = None
        if ls and ls["inn1AwayRuns"] is not None and ls["inn1HomeRuns"] is not None:
            i1a, i1h = ls["inn1AwayRuns"], ls["inn1HomeRuns"]
            actual = 1 if (i1a + i1h) == 0 else 0
        else:
            n_no_linescore += 1
        bin_g = g["actualNrfiBinary"]
        if bin_g is None and g["nrfiActualResult"] in ("NRFI", "YRFI"):
            bin_g = 1 if g["nrfiActualResult"] == "NRFI" else 0
        if actual is None:
            actual = bin_g
        elif bin_g is not None and int(bin_g) != actual:
            n_actual_disagree += 1

        away_sp = ls["awayStarterId"] if ls else None
        home_sp = ls["homeStarterId"] if ls else None
        away_hand = (ls["awayStarterHand"] if ls and ls["awayStarterHand"] else "R")
        home_hand = (ls["homeStarterHand"] if ls and ls["homeStarterHand"] else "R")

        a_starts26, a_nrfi26 = starter_asof(away_sp, cutoff_date)
        h_starts26, h_nrfi26 = starter_asof(home_sp, cutoff_date)
        a_prior, a_prior_starts = priors.get(away_sp, (None, None))
        h_prior, h_prior_starts = priors.get(home_sp, (None, None))
        a_eff = a_prior if a_prior is not None else LEAGUE_PITCHER_NRFI_PRIOR
        h_eff = h_prior if h_prior is not None else LEAGUE_PITCHER_NRFI_PRIOR
        a_shrunk = (a_nrfi26 + a_eff * NRFI_SHRINKAGE_K) / (a_starts26 + NRFI_SHRINKAGE_K)
        h_shrunk = (h_nrfi26 + h_eff * NRFI_SHRINKAGE_K) / (h_starts26 + NRFI_SHRINKAGE_K)

        t_rates, league_i1 = team_rates_asof(cutoff_date)
        away_t_rate, away_t_n = t_rates.get(g["awayTeam"], (league_i1, 0))
        home_t_rate, home_t_n = t_rates.get(g["homeTeam"], (league_i1, 0))

        start_iso = start_by_gid.get(gid)
        start_dt = iso_to_dt(start_iso)
        local_hour = None
        if start_dt is not None:
            off = TEAM_UTC_OFFSET.get(g["homeTeam"])
            if off is not None:
                local_hour = (start_dt.hour + start_dt.minute / 60.0 + off) % 24
        day_night = None if local_hour is None else ("day" if local_hour < 17 else "night")

        leakage = 1
        if start_dt is not None and g["modelRunAt"] is not None:
            leakage = 1 if (int(g["modelRunAt"]) >= start_dt.timestamp() * 1000) else 0

        rows.append({
            "game_id": gid,
            "game_pk": g["mlbGamePk"],
            "date": g["gameDate"][:10],
            "month": g["gameDate"][:7],
            "away": g["awayTeam"], "home": g["homeTeam"],
            "dh_game_no": g["gameNumber"],
            "p_live": fnum(g["modelPNrfi"]),
            "p_p1": p_by_ver[P1].get(gid),
            "p_p2": p_by_ver[P2].get(gid),
            "actual_nrfi": actual,
            "inn1_away": i1a, "inn1_home": i1h,
            "away_sp_id": away_sp, "home_sp_id": home_sp,
            "away_sp_name": names.get(away_sp, ""), "home_sp_name": names.get(home_sp, ""),
            "away_hand": away_hand, "home_hand": home_hand,
            "hand_pair": f"{away_hand}{home_hand}",
            "away_sp_starts26_asof": a_starts26, "away_sp_nrfi26_asof": a_nrfi26,
            "home_sp_starts26_asof": h_starts26, "home_sp_nrfi26_asof": h_nrfi26,
            "away_sp_prior25": a_prior, "away_sp_prior25_starts": a_prior_starts,
            "home_sp_prior25": h_prior, "home_sp_prior25_starts": h_prior_starts,
            "away_sp_shrunk": round(a_shrunk, 5), "home_sp_shrunk": round(h_shrunk, 5),
            "comb_sp_shrunk": round((a_shrunk + h_shrunk) / 2.0, 5),
            "n_prior_missing": (1 if a_prior is None else 0) + (1 if h_prior is None else 0),
            "away_team_i1_rate_asof": round(away_t_rate, 5), "away_team_i1_n_asof": away_t_n,
            "home_team_i1_rate_asof": round(home_t_rate, 5), "home_team_i1_n_asof": home_t_n,
            "comb_team_i1_rate": round((away_t_rate + home_t_rate) / 2.0, 5),
            "league_i1_rate_asof": round(league_i1, 5),
            "park_factor_3yr": parks.get(g["homeTeam"]),
            "start_utc": start_iso or "",
            "local_hour": None if local_hour is None else round(local_hour, 2),
            "day_night": day_night or "",
            "leakage_flag": leakage,
        })

    ctx = {
        "extracted_at_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "n_population_games": len(rows),
        "n_replay_p1": len(p_by_ver[P1]), "n_replay_p2": len(p_by_ver[P2]),
        "n_linescore_rows": len(linescores),
        "n_games_without_linescore_inn1": n_no_linescore,
        "n_actual_disagree_games_vs_linescore": n_actual_disagree,
        "n_priors_available": len(priors),
        "n_start_mapped": sum(1 for r in rows if r["start_utc"]),
        "n_leakage_flagged": sum(r["leakage_flag"] for r in rows),
        "n_missing_p_live": sum(1 for r in rows if r["p_live"] is None),
        "n_missing_p_p1": sum(1 for r in rows if r["p_p1"] is None),
        "n_missing_p_p2": sum(1 for r in rows if r["p_p2"] is None),
        "n_missing_actual": sum(1 for r in rows if r["actual_nrfi"] is None),
    }
    with open(OUT_CSV, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        for r in rows:
            w.writerow(r)
    print(json.dumps(ctx, indent=2))


if __name__ == "__main__":
    main()
