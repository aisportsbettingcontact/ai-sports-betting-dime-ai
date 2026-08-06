#!/usr/bin/env python3
"""Download the five nflverse extracts that build_db.py needs.

`scripts/data/nfl-db/raw/` is gitignored -- it is 316 MB of regenerable CSV --
so a fresh clone has no data and `build_db.py` cannot run. This script closes
that gap without requiring R or nflreadr: it pulls the same per-season release
assets nflreadr itself reads, using only the standard library.

    python3 scripts/data/nfl-db/fetch_raw.py            # fetch what is missing
    python3 scripts/data/nfl-db/fetch_raw.py --force    # re-fetch everything
    python3 scripts/data/nfl-db/fetch_raw.py --check    # verify, download nothing

WHY THE ROW FLOORS MATTER. nflverse serves an empty-but-well-formed file when a
season has no data, and the original R loader treats that as success -- an empty
frame with a warning, cached by memoise as a real result. That is not
hypothetical here: nflverse ships a 154-byte header-only `snap_counts_2012.csv`
while its own scrape manifest claims 266 games for that season, and our database
silently carried zero 2012 snap rows as a result. Every dataset below therefore
asserts a minimum row count, and a file that parses cleanly but is short is a
hard failure, not a warning.

Counts are pinned to the 2026-07-27 extract recorded in EXTRACT-NOTES.md.
Upstream revises history, so small positive drift is expected and allowed; a
shortfall is not.
"""
from __future__ import annotations

import argparse
import csv
import io
import os
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")
BASE = "https://github.com/nflverse/nflverse-data/releases/download"

#: Season window the database covers. 2010 is the floor set by the betting-line
#: audit (moneylines are not fully populated before it); 2026 is the scheduled
#: season, which has rosters and depth charts but no played-game data yet.
SEASON_MIN, SEASON_MAX = 2010, 2026

#: (output file, release tag, per-season asset template or None, min rows)
#: `None` template means one whole-history asset rather than one file per season.
DATASETS = [
    ("players.csv",      "players",      None,                    25_000),
    ("rosters.csv",      "rosters",      "roster_{year}.csv",      43_000),
    ("snap_counts.csv",  "snap_counts",  "snap_counts_{year}.csv", 324_000),
    # `stats_player`, NOT the older `player_stats` release. nflverse repurposed
    # the old name: player_stats_2023.csv now serves SEASON AGGREGATES (5,653
    # rows) while this table needs WEEKLY lines (18,643 for the same season).
    # Fetching the wrong one fills player_game_stats with season totals -- right
    # table, plausible row shape, wrong granularity, and nothing downstream would
    # notice. The old release also stops at 2024; 2025 only exists here.
    ("player_stats.csv", "stats_player", "stats_player_week_{year}.csv", 287_000),
    ("depth_charts.csv", "depth_charts", "depth_charts_{year}.csv", 1_100_000),
]

#: Seasons nflverse genuinely has no data for. Anything else missing is an error.
#: snap counts begin in 2013 upstream -- except 2012, where the asset exists but
#: is header-only. That is an upstream defect, recorded in the forensic audit,
#: not a season to skip silently: it is reported and left for a human.
KNOWN_EMPTY = {
    ("snap_counts", 2010), ("snap_counts", 2011),
    # 2026 is scheduled but unplayed: it has rosters and depth charts, but no
    # snaps or box scores until games are actually played.
    ("snap_counts", 2026), ("stats_player", 2026),
}
KNOWN_UPSTREAM_DEFECT = {
    ("snap_counts", 2012): "asset is header-only upstream while nflverse's own "
                           "scrape manifest lists 266 games; recoverable from PFR",
}


def _get(url: str) -> bytes | None:
    """Fetch a URL. Returns None on 404, raises on anything else."""
    req = urllib.request.Request(url, headers={"User-Agent": "dime-nfl-db/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return resp.read()
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return None
        raise


def _rows(blob: bytes) -> list[list[str]]:
    """Parse CSV properly -- depth_charts contains embedded newlines, so a line
    count is not a row count. The original extract notes flag this exact trap."""
    return list(csv.reader(io.StringIO(blob.decode("utf-8", "replace"))))


def fetch_dataset(out_name, tag, template, min_rows, force=False):
    dest = os.path.join(RAW, out_name)
    if os.path.exists(dest) and not force:
        with open(dest, newline="", encoding="utf-8", errors="replace") as fh:
            have = sum(1 for _ in csv.reader(fh)) - 1
        print(f"  {out_name:20} present, {have:>9,} rows (use --force to refetch)")
        return have, []

    notes: list[str] = []
    header: list[str] | None = None
    body: list[list[str]] = []

    if template is None:
        blob = _get(f"{BASE}/{tag}/{out_name}")
        if blob is None:
            raise SystemExit(f"FATAL: {tag} asset missing upstream (404)")
        rows = _rows(blob)
        header, body = rows[0], rows[1:]
    else:
        for year in range(SEASON_MIN, SEASON_MAX + 1):
            blob = _get(f"{BASE}/{tag}/{template.format(year=year)}")
            if blob is None:
                if (tag, year) not in KNOWN_EMPTY:
                    notes.append(f"{year}: no asset upstream (404)")
                continue
            rows = _rows(blob)
            if len(rows) <= 1:
                defect = KNOWN_UPSTREAM_DEFECT.get((tag, year))
                notes.append(f"{year}: header-only upstream"
                             + (f" -- {defect}" if defect else ""))
                continue
            if header is None:
                header = rows[0]
            elif rows[0] != header:
                # Column sets genuinely differ across eras (depth_charts ships two
                # schemas). Union them rather than dropping the odd one out.
                for col in rows[0]:
                    if col not in header:
                        header.append(col)
            idx = {c: i for i, c in enumerate(rows[0])}
            for r in rows[1:]:
                body.append([r[idx[c]] if c in idx and idx[c] < len(r) else "" for c in header])

    if header is None:
        raise SystemExit(f"FATAL: {out_name} produced no data at all")

    os.makedirs(RAW, exist_ok=True)
    tmp = dest + ".partial"
    with open(tmp, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(header)
        w.writerows(body)
    os.replace(tmp, dest)

    print(f"  {out_name:20} {len(body):>9,} rows written")
    for n in notes:
        print(f"      note: {n}")
    return len(body), notes


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--force", action="store_true", help="re-download files already present")
    ap.add_argument("--check", action="store_true", help="verify local files only, fetch nothing")
    args = ap.parse_args()

    if args.check:
        bad = 0
        for out_name, _tag, _tpl, min_rows in DATASETS:
            p = os.path.join(RAW, out_name)
            if not os.path.exists(p):
                print(f"  MISSING  {out_name}")
                bad += 1
                continue
            with open(p, newline="", encoding="utf-8", errors="replace") as fh:
                n = sum(1 for _ in csv.reader(fh)) - 1
            ok = n >= min_rows
            print(f"  {'OK      ' if ok else 'SHORT   '} {out_name:20} {n:>9,} rows "
                  f"(floor {min_rows:,})")
            bad += not ok
        if bad:
            print(f"\n{bad} dataset(s) missing or short. Run without --check to fetch.")
        return 1 if bad else 0

    print(f"Fetching nflverse extracts for {SEASON_MIN}-{SEASON_MAX} into {RAW}\n")
    failures = []
    for out_name, tag, template, min_rows in DATASETS:
        n, _notes = fetch_dataset(out_name, tag, template, min_rows, force=args.force)
        if n < min_rows:
            failures.append(f"{out_name}: {n:,} rows, below the {min_rows:,} floor")

    if failures:
        print("\nFAILED -- a short file is a silent-corruption risk, not a warning:")
        for f in failures:
            print(f"  {f}")
        print("\nRe-run, and if it persists the upstream release has changed shape. "
              "Do NOT build on a short extract.")
        return 1

    print("\nAll five extracts present and above their row floors. "
          "Now run: python3 scripts/data/nfl-db/build_db.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
