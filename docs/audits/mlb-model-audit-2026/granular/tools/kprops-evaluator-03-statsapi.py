#!/usr/bin/env python
"""kprops-evaluator-03-statsapi.py — K-props EVALUATOR, step 3: external ground-truthing.

Samples N population games (stratified across months, deterministic seed) and fetches the MLB
StatsAPI boxscore (the same source-of-truth the live grader uses: starter = pitchers[0] per
side). For each sampled game x side, compares:
  statsapi starter id + strikeOuts  vs  mlb_replay_linescores starter id/Ks (my primary
  substrate)  vs  mlb_strikeout_props.actualKs (stored).
Sampling here is permitted: it ground-truths the substrate; all grading in the ledger is
full-population DB computation.

Output: granular/kprops/kprops-evaluator-statsapi-sample.csv
"""
from __future__ import annotations

import csv
import json
import os
import random
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
AUDIT = os.path.normpath(os.path.join(HERE, "..", ".."))
OUT_DIR = os.path.join(AUDIT, "granular", "kprops")
RAW_JSON = os.path.join(OUT_DIR, "kprops-evaluator-raw.json")
OUT_CSV = os.path.join(OUT_DIR, "kprops-evaluator-statsapi-sample.csv")

N_PER_MONTH = 6


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "dime-audit/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def starter_ks(box, side):
    t = box["teams"][side]
    pitchers = t.get("pitchers") or []
    if not pitchers:
        return None, None
    pid = pitchers[0]
    pdata = t["players"].get(f"ID{pid}", {})
    ks = pdata.get("stats", {}).get("pitching", {}).get("strikeOuts")
    return pid, ks


def main():
    with open(RAW_JSON) as fh:
        raw = json.load(fh)
    games = {g["id"]: g for g in raw["games"]}
    pop = [g for g in raw["games"]
           if g["gameStatus"] == "final" and g["mlbGamePk"] is not None]
    ls_by_gid = {r["gameId"]: r for r in raw["linescores"]}
    live_by_key_side = {(r["gameId"], r["side"]): r for r in raw["live"]}

    by_month = {}
    for g in pop:
        by_month.setdefault(g["gameDate"][5:7], []).append(g)
    rng = random.Random(42)
    sample = []
    for m in sorted(by_month):
        pool = sorted(by_month[m], key=lambda g: g["id"])
        rng.shuffle(pool)
        sample.extend(pool[:N_PER_MONTH])

    rows = []
    mismatches = 0
    for g in sample:
        try:
            box = fetch(f"https://statsapi.mlb.com/api/v1/game/{g['mlbGamePk']}/boxscore")
        except Exception as e:  # noqa: BLE001
            print(f"[warn] fetch failed gamePk={g['mlbGamePk']}: {e}", file=sys.stderr)
            continue
        ls = ls_by_gid.get(g["id"]) or {}
        for side in ("away", "home"):
            api_id, api_ks = starter_ks(box, side)
            ls_id = ls.get(f"{side}StarterId")
            ls_ks = ls.get(f"{side}StarterKs")
            live = live_by_key_side.get((g["id"], side)) or {}
            ok_id = (api_id == ls_id) if (api_id is not None and ls_id is not None) else None
            ok_ks = (api_ks == ls_ks) if (api_ks is not None and ls_ks is not None) else None
            if ok_id is False or ok_ks is False:
                mismatches += 1
            rows.append({
                "gameId": g["id"], "gamePk": g["mlbGamePk"], "gameDate": g["gameDate"][:10],
                "side": side,
                "statsapi_starter_id": api_id, "statsapi_starter_ks": api_ks,
                "linescore_starter_id": ls_id, "linescore_starter_ks": ls_ks,
                "stored_actualKs": live.get("actualKs"),
                "stored_pitcherName": live.get("pitcherName"),
                "stored_mlbamId": live.get("mlbamId"),
                "id_match": ok_id, "ks_match": ok_ks,
                "stored_matches_api": (live.get("actualKs") == api_ks)
                if (live.get("actualKs") is not None and api_ks is not None) else None,
            })
    with open(OUT_CSV, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    print(json.dumps({
        "sampled_games": len(sample), "rows": len(rows),
        "substrate_mismatches": mismatches,
        "ks_match_true": sum(1 for r in rows if r["ks_match"] is True),
        "ks_match_false": sum(1 for r in rows if r["ks_match"] is False),
        "ks_match_null": sum(1 for r in rows if r["ks_match"] is None),
        "id_match_false": sum(1 for r in rows if r["id_match"] is False),
        "stored_vs_api_false": sum(1 for r in rows if r["stored_matches_api"] is False),
    }, indent=2))


if __name__ == "__main__":
    main()
