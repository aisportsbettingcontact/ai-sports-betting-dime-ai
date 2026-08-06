#!/usr/bin/env python3
"""F02 pre-fetcher: populate cache/f02/ with every ESPN response the audit needs.

Read-only w.r.t. the database. Idempotent: skips anything already on disk (here
or in a sibling agent's cache). Safe to re-run; safe to interrupt.
"""
from __future__ import annotations

import gzip
import json
import os
import random
import sqlite3
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(ROOT, "nfl.db")
CACHE = os.path.join(ROOT, "cache")
MINE = os.path.join(CACHE, "f02")
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
SEASONS = (2012, 2013)

# Sibling caches that may already hold a summary for one of our events.
SIBLING_SUMMARY_GLOBS = [
    (os.path.join(CACHE, "a5"), "summary_{eid}.json.gz", True),
    (os.path.join(CACHE, "a1", "summary"), "{eid}.json", False),
    (os.path.join(CACHE, "s2"), "summary_{eid}.json", False),
    (os.path.join(CACHE, "a2"), "espn_summary_{eid}.json", False),
]


def sibling_summary(eid: str):
    """Return (path, gzipped) for an already-cached summary, or None."""
    for d, pat, gz in SIBLING_SUMMARY_GLOBS:
        p = os.path.join(d, pat.format(eid=eid))
        if os.path.exists(p) and os.path.getsize(p) > 2000:
            return p, gz
    return None


def get(url: str, tries: int = 3, timeout: int = 45) -> bytes:
    last = None
    for i in range(tries):
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            body = e.read()
            if e.code in (404, 400):
                # A real, cacheable answer: "no such thing".
                return json.dumps({"__http_error__": e.code,
                                   "__body__": body[:2000].decode("utf-8", "replace")}).encode()
            last = e
        except Exception as e:  # noqa: BLE001
            last = e
        time.sleep(2.5 * (i + 1) + random.random())
    raise RuntimeError(f"{url}: {last}")


def write_gz(path: str, data: bytes) -> None:
    tmp = path + ".tmp"
    with gzip.open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, path)


def main() -> int:
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    eids = [r[0] for r in con.execute(
        "SELECT espn_event_id FROM game WHERE season IN (2012,2013) ORDER BY kickoff_utc")]
    con.close()

    os.makedirs(os.path.join(MINE, "summary"), exist_ok=True)
    os.makedirs(os.path.join(MINE, "roster"), exist_ok=True)

    todo = []
    reused = 0
    for eid in eids:
        mine = os.path.join(MINE, "summary", f"summary_{eid}.json.gz")
        if os.path.exists(mine) and os.path.getsize(mine) > 1000:
            continue
        if sibling_summary(eid):
            reused += 1
            continue
        todo.append(eid)
    print(f"[summary] {len(eids)} games | reusing {reused} sibling-cached | fetching {len(todo)}",
          flush=True)

    for n, eid in enumerate(todo, 1):
        url = ("https://site.api.espn.com/apis/site/v2/sports/football/nfl/"
               f"summary?event={eid}")
        try:
            data = get(url)
        except Exception as e:  # noqa: BLE001
            print(f"  !! {eid}: {e}", flush=True)
            continue
        write_gz(os.path.join(MINE, "summary", f"summary_{eid}.json.gz"), data)
        if n % 25 == 0:
            print(f"  ..{n}/{len(todo)}", flush=True)
        time.sleep(0.9 + random.random() * 0.5)

    # Season rosters: ESPN core API, per team per season.
    for season in SEASONS:
        p = os.path.join(MINE, "roster", f"teams_{season}.json.gz")
        if not os.path.exists(p):
            write_gz(p, get("https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/"
                            f"seasons/{season}/teams?limit=40"))
            time.sleep(1.0)
        with gzip.open(p) as f:
            teams = json.load(f)
        refs = [it["$ref"] for it in teams.get("items", [])]
        print(f"[roster] {season}: {len(refs)} team refs", flush=True)
        for ref in refs:
            tid = ref.rstrip("?").rstrip("/").split("/")[-1].split("?")[0]
            out = os.path.join(MINE, "roster", f"roster_{season}_{tid}.json.gz")
            if os.path.exists(out):
                continue
            url = ("https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/"
                   f"seasons/{season}/teams/{tid}/athletes?limit=200")
            try:
                write_gz(out, get(url))
            except Exception as e:  # noqa: BLE001
                print(f"  !! roster {season}/{tid}: {e}", flush=True)
            time.sleep(0.9 + random.random() * 0.4)

    print("[done]", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
