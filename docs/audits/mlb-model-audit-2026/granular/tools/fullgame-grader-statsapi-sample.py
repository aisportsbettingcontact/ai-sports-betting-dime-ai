#!/usr/bin/env python3
"""GRADER role, fullgame: external ground-truthing sample.

Full-population grading integrity is proven from the DB by fullgame-grader-audit.mjs;
this script samples games against the MLB Stats API (the allowed external source) to
verify games.actualAwayScore/actualHomeScore against an authority independent of every
DB table. Sample = 30 seeded-random population games + the 5 games where a DB-internal
source disagreed (4 DH census-linkage cases + BOS@BAL 4/26) + the 3 score-corrected games.
Reads fullgame-grader-games-rederivation.csv; writes fullgame-grader-statsapi-sample.csv.
"""
import csv, json, random, sys, time, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "fullgame"
rows = list(csv.DictReader(open(OUT / "fullgame-grader-games-rederivation.csv")))
byid = {r["gameId"]: r for r in rows}

random.seed(20260725)
pool = [r for r in rows if r["mlbGamePk"]]
sample = {r["gameId"]: r for r in random.sample(pool, 30)}
for gid in ["2250386", "2250733", "2251130", "2251290", "2251337", "2250738"]:
    if gid in byid:
        sample[gid] = byid[gid]

out = []
mismatches = 0
for gid, r in sorted(sample.items()):
    pk = r["mlbGamePk"]
    url = f"https://statsapi.mlb.com/api/v1/game/{pk}/linescore"
    try:
        j = json.load(urllib.request.urlopen(url, timeout=20))
        api_away = j["teams"]["away"]["runs"]
        api_home = j["teams"]["home"]["runs"]
    except Exception as e:  # noqa: BLE001
        api_away = api_home = None
        print(f"fetch fail pk={pk}: {e}", file=sys.stderr)
    db = f"{r['actualAway']}-{r['actualHome']}"
    api = f"{api_away}-{api_home}" if api_away is not None else "FETCH_FAIL"
    ok = "MATCH" if db == api else "MISMATCH"
    if ok == "MISMATCH":
        mismatches += 1
    out.append({"gameId": gid, "gameDate": r["gameDate"], "matchup": r["matchup"],
                "mlbGamePk": pk, "db_actual": db, "statsapi_actual": api, "status": ok})
    time.sleep(0.3)

with open(OUT / "fullgame-grader-statsapi-sample.csv", "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(out[0].keys()))
    w.writeheader()
    w.writerows(out)
print(f"sampled={len(out)} mismatches={mismatches}")
