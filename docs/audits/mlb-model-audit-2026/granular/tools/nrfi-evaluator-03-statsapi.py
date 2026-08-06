#!/usr/bin/env python
"""nrfi-evaluator-03-statsapi.py — NRFI EVALUATOR step 3: external ground-truth sample.

Full-population grading uses DB substrates (step 2). This step SAMPLES the population
(allowed for external ground-truthing only) and checks first-inning runs against MLB
StatsAPI directly: GET /api/v1/game/{gamePk}/linescore.

Sample: deterministic seed 42, 40 games stratified across months + the 2 games where
nrfiActualResult contradicts actualNrfiBinary (games 2250738, 2251290).

Output: granular/nrfi/nrfi-evaluator-statsapi-sample.csv
"""
from __future__ import annotations

import csv
import json
import os
import random
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
AUDIT = os.path.normpath(os.path.join(HERE, "..", ".."))
OUT_DIR = os.path.join(AUDIT, "granular", "nrfi")
RAW = os.path.join(OUT_DIR, "nrfi-evaluator-raw.json")
OUT = os.path.join(OUT_DIR, "nrfi-evaluator-statsapi-sample.csv")

FORCE_GAME_IDS = {2250738, 2251290}


def fetch_inn1(game_pk):
    url = f"https://statsapi.mlb.com/api/v1/game/{game_pk}/linescore"
    with urllib.request.urlopen(url, timeout=20) as resp:
        data = json.load(resp)
    innings = data.get("innings", [])
    if not innings:
        return None, None
    first = innings[0]
    return first.get("away", {}).get("runs"), first.get("home", {}).get("runs")


def main():
    with open(RAW) as fh:
        raw = json.load(fh)
    games = {g["id"]: g for g in raw["games"]}
    ls_by_gid = {ls["gameId"]: ls for ls in raw["linescores"]}

    by_month = {}
    for g in raw["games"]:
        by_month.setdefault(g["gameDate"][:7], []).append(g["id"])
    rng = random.Random(42)
    sample_ids = set(FORCE_GAME_IDS)
    months = sorted(by_month)
    per_month = max(1, (40 - len(sample_ids)) // len(months))
    for m in months:
        pool = sorted(by_month[m])
        take = min(per_month, len(pool))
        sample_ids.update(rng.sample(pool, take))
    while len(sample_ids) < 40:
        m = rng.choice(months)
        sample_ids.add(rng.choice(sorted(by_month[m])))

    rows = []
    n_match = n_mismatch = n_fail = 0
    for gid in sorted(sample_ids):
        g = games[gid]
        ls = ls_by_gid.get(gid, {})
        try:
            a, h = fetch_inn1(g["mlbGamePk"])
            err = ""
        except Exception as e:  # noqa: BLE001
            a = h = None
            err = str(e)[:120]
        api_nrfi = None
        if a is not None and h is not None:
            api_nrfi = 1 if (a == 0 and h == 0) else 0
        db_nrfi = None
        if ls.get("inn1AwayRuns") is not None and ls.get("inn1HomeRuns") is not None:
            db_nrfi = 1 if (ls["inn1AwayRuns"] == 0 and ls["inn1HomeRuns"] == 0) else 0
        match = None if (api_nrfi is None or db_nrfi is None) else int(api_nrfi == db_nrfi)
        if match == 1:
            n_match += 1
        elif match == 0:
            n_mismatch += 1
        else:
            n_fail += 1
        rows.append({
            "game_id": gid, "mlb_game_pk": g["mlbGamePk"], "date": g["gameDate"],
            "teams": f'{g["awayTeam"]}@{g["homeTeam"]}',
            "api_inn1_away": a, "api_inn1_home": h, "api_nrfi": api_nrfi,
            "db_inn1_away": ls.get("inn1AwayRuns"), "db_inn1_home": ls.get("inn1HomeRuns"),
            "db_nrfi": db_nrfi,
            "games_actualNrfiBinary": g["actualNrfiBinary"],
            "games_nrfiActualResult": g["nrfiActualResult"],
            "api_vs_db_match": match,
            "forced_contradiction_case": int(gid in FORCE_GAME_IDS),
            "fetch_error": err,
        })

    with open(OUT, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        for r in rows:
            w.writerow({k: ("" if v is None else v) for k, v in r.items()})
    print(json.dumps({"sampled": len(rows), "match": n_match,
                      "mismatch": n_mismatch, "fetch_failed": n_fail}, indent=2))
    for r in rows:
        if r["api_vs_db_match"] == 0 or r["forced_contradiction_case"]:
            print("CASE:", r["game_id"], r["date"], r["teams"],
                  "api:", r["api_inn1_away"], r["api_inn1_home"],
                  "db:", r["db_inn1_away"], r["db_inn1_home"],
                  "bin:", r["games_actualNrfiBinary"], "str:", r["games_nrfiActualResult"])


if __name__ == "__main__":
    main()
