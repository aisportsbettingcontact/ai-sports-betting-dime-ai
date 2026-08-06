#!/usr/bin/env python3
"""F05 network phase - fills cache/f05/ for the 2018+2019 partition.

Separated from f05.py so the audit itself is provably offline-replayable.
Every response is written to disk exactly as received (gzip for JSON).
Re-runnable: anything already cached is skipped.
"""
from __future__ import annotations

import concurrent.futures
import gzip
import json
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                       # scripts/data/nfl-db
DB = os.path.join(ROOT, "nfl.db")
CACHE = os.path.join(ROOT, "cache", "f05")
SEASONS = (2018, 2019)

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
SLEEP = 1.1          # ESPN: ~1 req/s, shared with ten other agents
PFR_SLEEP = 8.0      # Pro-Football-Reference: deliberately glacial


def get(url: str, timeout: int = 45, headers: dict | None = None) -> tuple[int, bytes]:
    req = urllib.request.Request(url, headers={"User-Agent": UA,
                                               "Accept": "*/*", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except Exception as e:                                   # noqa: BLE001
        return 0, str(e).encode()


def write_gz(path: str, blob: bytes) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with gzip.open(path, "wb") as fh:
        fh.write(blob)


def espn_summaries(conn) -> None:
    """One summary?event= per game. Serves `game` and `player_game_stats`."""
    rows = conn.execute(
        "SELECT game_id, espn_event_id FROM game WHERE season IN (?,?) ORDER BY kickoff_utc",
        SEASONS).fetchall()
    todo = []
    for gid, ev in rows:
        if find_summary(ev) is None:
            todo.append((gid, ev))
    print(f"[summary] {len(rows)} games, {len(rows)-len(todo)} already cached, "
          f"{len(todo)} to fetch", flush=True)
    done = [0]

    def one(item):
        gid, ev = item
        url = ("https://site.api.espn.com/apis/site/v2/sports/football/nfl/"
               f"summary?event={ev}")
        code, blob = get(url)
        out = os.path.join(CACHE, f"summary_{ev}.json.gz")
        if code == 200:
            write_gz(out, blob)
        else:
            write_gz(os.path.join(CACHE, f"summary_{ev}.ERR{code}.gz"), blob)
            print(f"  !! {gid} event={ev} HTTP {code}", flush=True)
        done[0] += 1
        if done[0] % 25 == 0:
            print(f"  [summary] {done[0]}/{len(todo)}", flush=True)
        time.sleep(SLEEP)

    # 2 in flight maximum, per the contract's rate-limit rule.
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
        list(ex.map(one, todo))


def find_summary(event_id: str) -> str | None:
    """Locate a cached ESPN summary for this event across every agent's cache."""
    cands = [
        os.path.join(CACHE, f"summary_{event_id}.json.gz"),
        os.path.join(ROOT, "cache", "a5", f"summary_{event_id}.json.gz"),
        os.path.join(ROOT, "cache", "a1", "summary", f"{event_id}.json"),
        os.path.join(ROOT, "cache", "s2", f"summary_{event_id}.json"),
        os.path.join(ROOT, "cache", "a2", f"espn_summary_{event_id}.json"),
    ]
    for c in cands:
        if os.path.exists(c):
            return c
    return None


def espn_rosters(conn) -> None:
    """Seasonal team roster (core API). Authority for roster_season membership."""
    fids = [r[0] for r in conn.execute("SELECT franchise_id FROM team ORDER BY franchise_id")]
    for season in SEASONS:
        for fid in fids:
            out = os.path.join(CACHE, f"roster_{season}_{fid}.json.gz")
            if os.path.exists(out):
                continue
            url = ("https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/"
                   f"seasons/{season}/teams/{fid}/athletes?limit=400")
            code, blob = get(url)
            write_gz(out if code == 200
                     else os.path.join(CACHE, f"roster_{season}_{fid}.ERR{code}.gz"), blob)
            if code != 200:
                print(f"  !! roster {season}/{fid} HTTP {code}", flush=True)
            time.sleep(SLEEP)
    print("[roster] done", flush=True)


def espn_athletes(conn) -> None:
    """Resolve ESPN athlete ids seen in seasonal rosters that we cannot map locally.

    Only fetched for ids absent from player.espn_id, so the roster comparison can
    distinguish 'ESPN has a player we lack' from 'we simply cannot join the id'.
    """
    have = {r[0] for r in conn.execute(
        "SELECT espn_id FROM player WHERE espn_id IS NOT NULL")}
    need: set[str] = set()
    for season in SEASONS:
        for fid in [r[0] for r in conn.execute("SELECT franchise_id FROM team")]:
            p = os.path.join(CACHE, f"roster_{season}_{fid}.json.gz")
            if not os.path.exists(p):
                continue
            d = json.load(gzip.open(p, "rt"))
            for it in d.get("items", []):
                aid = it["$ref"].rsplit("/", 1)[-1].split("?")[0]
                if aid not in have:
                    need.add(aid)
    need = sorted(need - {a.split("_")[1].split(".")[0]
                          for a in os.listdir(CACHE) if a.startswith("athlete_")})
    print(f"[athlete] {len(need)} unmapped ESPN ids to resolve", flush=True)
    for i, aid in enumerate(need, 1):
        out = os.path.join(CACHE, f"athlete_{aid}.json.gz")
        if os.path.exists(out):
            continue
        url = ("https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/"
               f"athletes/{aid}")
        code, blob = get(url)
        write_gz(out if code == 200
                 else os.path.join(CACHE, f"athlete_{aid}.ERR{code}.gz"), blob)
        if i % 50 == 0:
            print(f"  [athlete] {i}/{len(need)}", flush=True)
        time.sleep(SLEEP)


def pfr_probe(conn) -> None:
    """Attempt Pro-Football-Reference, the contract's snap_count authority.

    Whatever comes back - including a Cloudflare interstitial - is cached, because
    the block itself is the evidence for the NOT_COMPARABLE verdicts it forces.
    """
    targets = [r[0] for r in conn.execute(
        "SELECT DISTINCT pfr_game_id FROM game WHERE season IN (?,?) "
        "AND season_type='POST' ORDER BY pfr_game_id", SEASONS).fetchall()]
    targets = targets[:6] + ["__root__"]
    for t in targets:
        out = os.path.join(CACHE, f"pfr_{t}.html.gz")
        if os.path.exists(out) or os.path.exists(out.replace(".html.gz", ".BLOCKED.html.gz")):
            continue
        url = ("https://www.pro-football-reference.com/" if t == "__root__"
               else f"https://www.pro-football-reference.com/boxscores/{t}.htm")
        code, blob = get(url, headers={
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": "https://www.pro-football-reference.com/years/2018/",
            "Upgrade-Insecure-Requests": "1",
        })
        name = out if code == 200 else out.replace(".html.gz", f".BLOCKED{code}.html.gz")
        write_gz(name, blob)
        print(f"  [pfr] {t} -> HTTP {code} ({len(blob)}B) {os.path.basename(name)}",
              flush=True)
        time.sleep(PFR_SLEEP)


def main() -> int:
    os.makedirs(CACHE, exist_ok=True)
    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    what = sys.argv[1:] or ["summary", "roster", "athlete", "pfr"]
    if "summary" in what:
        espn_summaries(conn)
    if "roster" in what:
        espn_rosters(conn)
    if "athlete" in what:
        espn_athletes(conn)
    if "pfr" in what:
        pfr_probe(conn)
    return 0


if __name__ == "__main__":
    sys.exit(main())
