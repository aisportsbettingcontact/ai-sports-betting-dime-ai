#!/usr/bin/env python
"""f5-evaluator-04-statsapi.py — F5 EVALUATOR granular audit, step 4: external ground-truth.

Full-population DB computation is done in steps 1-3; per protocol, StatsAPI sampling here is
ONLY for external ground-truthing of stored F5 actuals:

  1. The 3 doubleheader-clobbered games (gamePks 824516, 824839, 823035) — decide which
     source is truth (games.actualF5* vs pk-keyed mlb_replay_linescores).
  2. A deterministic stratified sample of 60 population games (12 per month, seeded RNG) —
     verify games.actualF5AwayScore/HomeScore == sum of StatsAPI linescore innings 1-5.

Output: granular/f5/f5-evaluator-statsapi-check.csv + 'step4' block in summary JSON.
"""
from __future__ import annotations

import csv
import json
import os
import random
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
F5DIR = os.path.normpath(os.path.join(HERE, "..", "f5"))

CLOBBERED_PKS = [824516, 824839, 823035]


def fetch_f5(pk):
    url = f"https://statsapi.mlb.com/api/v1/game/{pk}/linescore"
    with urllib.request.urlopen(url, timeout=20) as resp:
        data = json.load(resp)
    innings = data.get("innings", [])
    a = sum(i.get("away", {}).get("runs", 0) or 0 for i in innings[:5])
    h = sum(i.get("home", {}).get("runs", 0) or 0 for i in innings[:5])
    n5 = len(innings[:5])
    return a, h, n5


def main() -> None:
    with open(os.path.join(F5DIR, "f5-evaluator-raw.json")) as f:
        raw = json.load(f)
    games = raw["games"]
    ls_by_gid = {r["gameId"]: r for r in raw["linescores"]}

    by_month = {}
    for g in games:
        by_month.setdefault(g["gameDate"][:7], []).append(g)
    rng = random.Random(42)
    sample = []
    for mon in sorted(by_month):
        pool = sorted(by_month[mon], key=lambda g: g["id"])
        sample.extend(rng.sample(pool, min(12, len(pool))))
    pks_clob = {g["mlbGamePk"]: g for g in games if g["mlbGamePk"] in CLOBBERED_PKS}
    for pk, g in pks_clob.items():
        if g not in sample:
            sample.append(g)

    rows = []
    n_match = n_mismatch = 0
    for g in sample:
        pk = g["mlbGamePk"]
        try:
            sa, sh, n5 = fetch_f5(pk)
        except Exception as e:  # noqa: BLE001
            rows.append({"gameId": g["id"], "gamePk": pk, "gameDate": g["gameDate"][:10],
                         "statsapi_f5": f"ERROR:{e}", "games_f5": "", "linescore_f5": "",
                         "verdict": "FETCH_ERROR"})
            continue
        ga, gh = g["actualF5AwayScore"], g["actualF5HomeScore"]
        ls = ls_by_gid.get(g["id"], {})
        la, lh = ls.get("f5AwayRuns"), ls.get("f5HomeRuns")
        games_ok = (ga is not None and float(ga) == sa and float(gh) == sh)
        ls_ok = (la is not None and float(la) == sa and float(lh) == sh)
        verdict = ("MATCH" if games_ok else "GAMES_MISMATCH") + \
                  ("" if ls_ok or la is None else "|LINESCORE_MISMATCH")
        if games_ok:
            n_match += 1
        else:
            n_mismatch += 1
        rows.append({"gameId": g["id"], "gamePk": pk, "gameDate": g["gameDate"][:10],
                     "statsapi_f5": f"{sa}-{sh}(n5={n5})",
                     "games_f5": f"{ga}-{gh}",
                     "linescore_f5": f"{la}-{lh}" if la is not None else "",
                     "verdict": verdict})
        time.sleep(0.2)

    out = os.path.join(F5DIR, "f5-evaluator-statsapi-check.csv")
    with open(out, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["gameId", "gamePk", "gameDate", "statsapi_f5",
                                          "games_f5", "linescore_f5", "verdict"])
        w.writeheader()
        w.writerows(rows)

    summ_path = os.path.join(F5DIR, "f5-evaluator-summary.json")
    with open(summ_path) as f:
        summary = json.load(f)
    summary["step4"] = {"sampled": len(rows), "games_col_match": n_match,
                        "games_col_mismatch": n_mismatch,
                        "mismatch_rows": [r for r in rows if r["verdict"] != "MATCH"]}
    with open(summ_path, "w") as f:
        json.dump(summary, f, indent=2)
    print(json.dumps(summary["step4"], indent=2))


if __name__ == "__main__":
    main()
