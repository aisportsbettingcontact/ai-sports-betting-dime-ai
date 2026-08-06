#!/usr/bin/env python3
"""F02 PFR fetcher — Pro-Football-Reference boxscores via the Wayback Machine.

PFR itself sits behind a Cloudflare managed challenge (HTTP 403 to curl and to
headless Chromium alike; verified in cache/f02/probe/). The Wayback Machine
serves byte-identical archived copies of the same PFR pages with no challenge,
so every snap-count comparison in this audit is against real PFR HTML — just
fetched through archive.org rather than from pro-football-reference.com.

Snapshots are pinned by timestamp in cache/f02/pfr/index_{season}.json, so a
replay months from now fetches the exact same bytes.

Fetches BOTH 2013 (to validate our 23,799 rows) and 2012 (to quantify the
missing-season gap). Read-only w.r.t. the database.
"""
from __future__ import annotations

import gzip
import json
import os
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(ROOT, "nfl.db")
OUT = os.path.join(ROOT, "cache", "f02", "pfr")
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
CDX = "http://web.archive.org/cdx/search/cdx"


def get(url: str, tries: int = 4, timeout: int = 90) -> bytes:
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA,
                                                       "Accept-Encoding": "gzip"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                data = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    data = gzip.decompress(data)
                return data
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(4 * (i + 1))
    raise RuntimeError(f"{url}: {last}")


def build_index(season: int, want: set[str]) -> dict:
    """Newest >=20KB archived snapshot per PFR game id, for the calendar years
    an NFL season spans."""
    path = os.path.join(OUT, f"index_{season}.json")
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    best: dict[str, list] = {}
    for year in (season, season + 1):
        q = urllib.parse.urlencode({
            "url": f"pro-football-reference.com/boxscores/{year}*",
            "output": "json", "filter": "statuscode:200",
            "fl": "original,timestamp,length", "limit": "60000"})
        raw = get(f"{CDX}?{q}", timeout=300)
        rows = json.loads(raw)
        if rows and rows[0][0] == "original":
            rows = rows[1:]
        for orig, ts, length in rows:
            m = re.search(r"boxscores/(20\d{7}[a-z]{3})\.htm", orig)
            if not m:
                continue
            gid = m.group(1)
            if gid not in want or int(length) < 20000:
                continue
            if gid not in best or ts > best[gid][0]:
                best[gid] = [ts, orig, int(length)]
        time.sleep(3)
    with open(path, "w") as f:
        json.dump(best, f, indent=0, sort_keys=True)
    return best


def fetch_season(season: int, gids: list[str]) -> None:
    idx = build_index(season, set(gids))
    print(f"[pfr {season}] {len(gids)} games, {len(idx)} archived", flush=True)
    miss = [g for g in gids if g not in idx]
    if miss:
        print(f"[pfr {season}] no snapshot for {len(miss)}: {miss[:8]}", flush=True)
    todo = [g for g in gids if g in idx
            and not os.path.exists(os.path.join(OUT, f"{g}.html.gz"))]
    print(f"[pfr {season}] fetching {todo and len(todo) or 0}", flush=True)
    for n, gid in enumerate(todo, 1):
        ts = idx[gid][0]
        url = (f"https://web.archive.org/web/{ts}id_/"
               f"https://www.pro-football-reference.com/boxscores/{gid}.htm")
        try:
            data = get(url)
        except Exception as e:  # noqa: BLE001
            print(f"  !! {gid}: {e}", flush=True)
            continue
        if len(data) < 15000:
            print(f"  !! {gid}: short body {len(data)}", flush=True)
        tmp = os.path.join(OUT, f"{gid}.html.gz.tmp")
        with gzip.open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, os.path.join(OUT, f"{gid}.html.gz"))
        if n % 20 == 0:
            print(f"  ..{n}/{len(todo)}", flush=True)
        time.sleep(1.6)


def main() -> int:
    os.makedirs(OUT, exist_ok=True)
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    for season in (2013, 2012):
        gids = [r[0] for r in con.execute(
            "SELECT pfr_game_id FROM game WHERE season=? AND pfr_game_id IS NOT NULL "
            "ORDER BY kickoff_utc", (season,))]
        fetch_season(season, gids)
    con.close()
    print("[pfr done]", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
