#!/usr/bin/env python3
"""F08 evidence fetcher -- cache-filling half of the F08 forensic audit.

Separated from f08.py so the (slow, network-bound) evidence gathering can run
unattended while the (fast, offline) verification passes are developed. Every
byte it writes lands under scripts/data/nfl-db/cache/f08/ and every f08.py
verdict cites one of those files. Re-running is free: anything already on disk
is never re-fetched, so this doubles as the offline-replay guarantee.

Phases:
  espn   -- summary?event={id} for all 570 games of seasons 2024-2025
  soh    -- SportsOddsHistory season pages (the game_line authority)
  roster -- ESPN team roster by season, 32 teams x 2 seasons
  pfr    -- Pro-Football-Reference box scores (snap counts). Blocks hard; this
            phase is expected to be partial and f08.py reports the split.
"""
from __future__ import annotations

import gzip
import os
import random
import sqlite3
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
NFLDB = os.path.dirname(HERE)
DB = os.path.join(NFLDB, "nfl.db")
CACHE = os.path.join(NFLDB, "cache", "f08")
SEASONS = (2024, 2025)

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")


def _ro():
    return sqlite3.connect("file:%s?mode=ro" % DB, uri=True)


def cache_path(name: str) -> str:
    return os.path.join(CACHE, name)


def cached(name: str) -> bool:
    p = cache_path(name)
    return os.path.exists(p) and os.path.getsize(p) > 0


def read_cache(name: str) -> bytes:
    p = cache_path(name)
    if p.endswith(".gz"):
        with gzip.open(p, "rb") as fh:
            return fh.read()
    with open(p, "rb") as fh:
        return fh.read()


def fetch(url: str, name: str, sleep: float = 1.2, tries: int = 3) -> bool:
    """GET url into cache/f08/<name>. Returns True if the file is on disk after.

    A 4xx is cached too -- the contract wants the 404 kept as evidence for an
    UNRESOLVED verdict, not silently dropped.
    """
    if cached(name):
        return True
    os.makedirs(CACHE, exist_ok=True)
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": UA,
                "Accept": "*/*",
                "Accept-Language": "en-US,en;q=0.9",
            })
            with urllib.request.urlopen(req, timeout=45) as resp:
                body = resp.read()
            p = cache_path(name)
            if name.endswith(".gz"):
                with gzip.open(p, "wb") as fh:
                    fh.write(body)
            else:
                with open(p, "wb") as fh:
                    fh.write(body)
            time.sleep(sleep + random.uniform(0, 0.4))
            return True
        except urllib.error.HTTPError as exc:
            last = exc
            body = b""
            try:
                body = exc.read()
            except Exception:
                pass
            # Cache the error body as evidence; do not retry a hard 4xx.
            if exc.code in (403, 404, 410):
                p = cache_path(name + ".http%d" % exc.code)
                with open(p, "wb") as fh:
                    fh.write(body or str(exc).encode())
                time.sleep(sleep)
                return False
            time.sleep(3.0 * (attempt + 1))
        except Exception as exc:                       # noqa: BLE001
            last = exc
            time.sleep(3.0 * (attempt + 1))
    sys.stderr.write("FAIL %s %s\n" % (name, last))
    return False


# ---------------------------------------------------------------- phases

def phase_espn() -> None:
    conn = _ro()
    rows = conn.execute(
        "SELECT espn_event_id, game_id FROM game WHERE season IN (?,?) "
        "ORDER BY kickoff_utc", SEASONS).fetchall()
    conn.close()
    todo = [r for r in rows if not cached("summary_%s.json.gz" % r[0])]
    sys.stderr.write("espn: %d games, %d to fetch\n" % (len(rows), len(todo)))
    for i, (eid, gid) in enumerate(todo, 1):
        ok = fetch(
            "https://site.api.espn.com/apis/site/v2/sports/football/nfl/"
            "summary?event=%s" % eid,
            "summary_%s.json.gz" % eid)
        if i % 25 == 0 or not ok:
            sys.stderr.write("  espn %d/%d %s %s\n"
                             % (i, len(todo), gid, "ok" if ok else "MISS"))


def phase_soh() -> None:
    for y in SEASONS:
        fetch("https://www.sportsoddshistory.com/nfl-game-season/?y=%d" % y,
              "soh_%d.html.gz" % y, sleep=3.0)
        sys.stderr.write("soh %d %s\n" % (y, cached("soh_%d.html.gz" % y)))


def phase_roster() -> None:
    conn = _ro()
    teams = [r[0] for r in conn.execute(
        "SELECT DISTINCT abbreviation FROM team ORDER BY abbreviation")]
    conn.close()
    for y in SEASONS:
        for t in teams:
            fetch("https://site.api.espn.com/apis/site/v2/sports/football/nfl/"
                  "teams/%s/roster?season=%d" % (t.lower(), y),
                  "roster_%d_%s.json.gz" % (y, t))
        sys.stderr.write("roster %d done\n" % y)


def phase_pfr(limit: int = 0) -> None:
    """PFR box scores. Blocks aggressively -- slow, partial, honest."""
    conn = _ro()
    rows = conn.execute(
        "SELECT DISTINCT s.pfr_game_id FROM snap_count s "
        "WHERE s.season IN (?,?) ORDER BY s.pfr_game_id", SEASONS).fetchall()
    conn.close()
    todo = [r[0] for r in rows
            if not cached("pfr_%s.html.gz" % r[0])
            and not os.path.exists(cache_path("pfr_%s.html.gz.http403" % r[0]))]
    if limit:
        todo = todo[:limit]
    sys.stderr.write("pfr: %d games total, %d to try\n" % (len(rows), len(todo)))
    blocked = 0
    for i, pid in enumerate(todo, 1):
        ok = fetch("https://www.pro-football-reference.com/boxscores/%s.htm" % pid,
                   "pfr_%s.html.gz" % pid, sleep=6.0, tries=1)
        if not ok:
            blocked += 1
            if blocked >= 8 and blocked == i:
                sys.stderr.write("pfr: blocked on first %d attempts, aborting\n" % blocked)
                return
            time.sleep(20.0)
        if i % 10 == 0:
            sys.stderr.write("  pfr %d/%d blocked=%d\n" % (i, len(todo), blocked))


PHASES = {"espn": phase_espn, "soh": phase_soh,
          "roster": phase_roster, "pfr": phase_pfr}

if __name__ == "__main__":
    for name in (sys.argv[1:] or ["espn", "soh", "roster"]):
        sys.stderr.write("=== phase %s ===\n" % name)
        PHASES[name]()
    sys.stderr.write("=== fetch complete ===\n")
