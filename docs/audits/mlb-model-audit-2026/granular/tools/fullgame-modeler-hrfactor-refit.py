#!/usr/bin/env python3
"""fullgame MODELER — hr_factor closure. The pipeline's hr-factor fit backfills
actual-HR labels from StatsAPI boxscores where the live mlb_hr_props index has no
row; a DB-only refit therefore under-covers (and mis-states) the factor. This
script reproduces the exact pipeline estimator including the boxscore fallback:

  hr_factor(m) = (mean actual HR>=1) / (mean p1 pOver) over p1 HR prop rows of
                 months < m, labels: live index (mlbamId, then lower(playerName))
                 -> StatsAPI boxscore homeRuns for the row's mlbamId.

Cache: local JSON per gamePk (never touches the DB; StatsAPI is public read-only).
Usage: fullgame-modeler-hrfactor-refit.py <snapshot_dir> <cache_dir> <out_csv>
"""

import csv
import hashlib
import json
import os
import sys
import time
import urllib.request
from collections import defaultdict

SNAP, CACHE, OUT_CSV = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(CACHE, exist_ok=True)
SEED_MONTHS = {"2026-03", "2026-04"}

STORED = {"2026-05": (0.97088, 8424), "2026-06": (0.96081, 15966),
          "2026-07": (1.00182, 23058)}  # from calibMeta (uniform per month)


def load_tsv(name):
    with open(os.path.join(SNAP, name)) as f:
        header = f.readline().rstrip("\n").split("\t")
        return [{h: (None if v == "\\N" else v) for h, v in
                 zip(header, line.rstrip("\n").split("\t"))} for line in f]


def num(v):
    try:
        return float(v) if v not in (None, "") else None
    except ValueError:
        return None


def get_json(url):
    key = hashlib.sha256(url.encode()).hexdigest()
    path = os.path.join(CACHE, key + ".json")
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    req = urllib.request.Request(url, headers={"User-Agent": "dime-audit-replay/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode())
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f)
    os.replace(tmp, path)
    return data


def boxscore_hr(game_pk):
    data = get_json(f"https://statsapi.mlb.com/api/v1/game/{game_pk}/boxscore")
    out = {}
    for side in ("away", "home"):
        players = (data.get("teams", {}).get(side, {}) or {}).get("players", {}) or {}
        for pk, pdata in players.items():
            batting = ((pdata.get("stats") or {}).get("batting") or {})
            if "homeRuns" in batting:
                try:
                    out[int(str(pk).replace("ID", ""))] = int(batting["homeRuns"])
                except (TypeError, ValueError):
                    pass
    return out


hrprops = [p for p in load_tsv("replay-props-p1.tsv") if p["propType"] == "HR"]
live_hr = load_tsv("live-hrprops.tsv")
linescores = {int(r["gameId"]): r for r in load_tsv("linescores.tsv") if r["gameId"]}

hr_idx = {}
for r in live_hr:
    if r["actualHr"] is None or not r["gameId"]:
        continue
    y = 1 if num(r["actualHr"]) >= 1 else 0
    gid = int(r["gameId"])
    if r["mlbamId"]:
        hr_idx[(gid, int(r["mlbamId"]))] = y
    if r["playerName"]:
        hr_idx[(gid, r["playerName"].strip().lower())] = y

by_month = defaultdict(list)
for p in hrprops:
    by_month[p["gameDate"][:7]].append(p)

box_cache = {}
fetched = 0


def label(p):
    global fetched
    gid = int(p["gameId"])
    mlbam = int(p["mlbamId"]) if p["mlbamId"] else None
    y = hr_idx.get((gid, mlbam)) if mlbam is not None else None
    if y is None and p["playerName"]:
        y = hr_idx.get((gid, p["playerName"].strip().lower()))
    if y is not None:
        return y
    ls = linescores.get(gid)
    if ls is None or ls["gamePk"] is None or mlbam is None:
        return None
    pk = int(ls["gamePk"])
    if pk not in box_cache:
        try:
            box_cache[pk] = boxscore_hr(pk)
            fetched += 1
            if fetched % 100 == 0:
                print(f"[fetch] {fetched} boxscores", file=sys.stderr)
            time.sleep(0.05)
        except Exception as e:  # noqa: BLE001
            print(f"[warn] boxscore {pk}: {e}", file=sys.stderr)
            box_cache[pk] = {}
    hr = box_cache[pk].get(mlbam)
    return None if hr is None else (1 if hr >= 1 else 0)


rows = []
for m in sorted(by_month):
    if m in SEED_MONTHS:
        continue
    train = [p for mm in by_month if mm < m for p in by_month[mm]]
    p_sum = y_sum = 0.0
    n = n_live = n_box = n_miss = 0
    for p in train:
        if num(p["pOver"]) is None:
            continue
        gid = int(p["gameId"])
        mlbam = int(p["mlbamId"]) if p["mlbamId"] else None
        in_live = ((gid, mlbam) in hr_idx or
                   (p["playerName"] and (gid, p["playerName"].strip().lower()) in hr_idx))
        y = label(p)
        if y is None:
            n_miss += 1
            continue
        p_sum += num(p["pOver"])
        y_sum += y
        n += 1
        n_live += 1 if in_live else 0
        n_box += 0 if in_live else 1
    hr_factor = (y_sum / n) / (p_sum / n) if n and p_sum > 0 else 1.0
    st_f, st_n = STORED.get(m, (None, None))
    rows.append({
        "month": m, "refit_hr_factor": f"{hr_factor:.5f}", "stored_hr_factor": st_f,
        "abs_diff": f"{abs(hr_factor - st_f):.5f}" if st_f else "",
        "refit_n": n, "stored_n": st_n, "n_from_live_props": n_live,
        "n_from_boxscore": n_box, "n_unlabelable": n_miss,
    })
    print(json.dumps(rows[-1]))

with open(OUT_CSV, "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
    w.writeheader()
    w.writerows(rows)
print(f"[done] {fetched} boxscores fetched; wrote {OUT_CSV}")
