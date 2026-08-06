#!/usr/bin/env python3
"""Team-abbreviation -> ESPN franchise id resolution for the NFL database.

Franchises are keyed by ESPN franchise id because that id is relocation-stable.
Every other feed identifies teams by abbreviation, and the feeds disagree with
each other, with themselves across eras, and with ESPN.

Everything in this module was derived by census + empirical resolution over the
six sources, not from memory. See
`docs/audits/2026-07-27-nfl-db-completion/reports/B2-team-aliases.md` for the
per-value evidence and the commands that regenerate it.

Two abbreviations are genuinely era-split *in the data we hold* -- `HOU` and
`BAL` -- and a third, `STL`, is era-split in ESPN's own vocabulary. They live in
SEASON_DEPENDENT and cannot be resolved without a season. `resolve()` raises
rather than guessing; a silent default is how the previous build produced orphan
rows.

The module has no import-time side effects. The self-check under __main__ does
all file I/O.
"""

from __future__ import annotations

import os

__all__ = ["ALIASES", "SEASON_DEPENDENT", "ESPN_ABBR", "resolve", "UnknownTeamAbbr"]


class UnknownTeamAbbr(KeyError):
    """Raised when an abbreviation (or abbreviation+season) cannot be resolved."""


# ---------------------------------------------------------------------------
# ESPN's own canonical abbreviation per franchise, read from
# https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2026/teams/{id}
# Cached at scripts/data/nfl-db/cache/b2/teams/2026-{id}.json.
# This is the authority the schema is keyed on. Note that ESPN uses LAR, WSH and
# ARI -- it never emits the nflverse spellings LA, WAS or AZ.
# ---------------------------------------------------------------------------
ESPN_ABBR: dict[int, str] = {
    1: "ATL",   # Atlanta Falcons
    2: "BUF",   # Buffalo Bills
    3: "CHI",   # Chicago Bears
    4: "CIN",   # Cincinnati Bengals
    5: "CLE",   # Cleveland Browns
    6: "DAL",   # Dallas Cowboys
    7: "DEN",   # Denver Broncos
    8: "DET",   # Detroit Lions
    9: "GB",    # Green Bay Packers
    10: "TEN",  # Tennessee Titans (Houston Oilers <=1996, Tennessee Oilers 1997-98)
    11: "IND",  # Indianapolis Colts (Baltimore Colts <=1983; ESPN still abbreviates those IND)
    12: "KC",   # Kansas City Chiefs
    13: "LV",   # Las Vegas Raiders (Oakland <=2019)
    14: "LAR",  # Los Angeles Rams (St. Louis 1995-2015; ESPN used LOS <=1994)
    15: "MIA",  # Miami Dolphins
    16: "MIN",  # Minnesota Vikings
    17: "NE",   # New England Patriots
    18: "NO",   # New Orleans Saints
    19: "NYG",  # New York Giants
    20: "NYJ",  # New York Jets
    21: "PHI",  # Philadelphia Eagles
    22: "ARI",  # Arizona Cardinals (St. Louis <=1987 as STL, Phoenix 1988-93 as PHO)
    23: "PIT",  # Pittsburgh Steelers
    24: "LAC",  # Los Angeles Chargers (San Diego <=2016)
    25: "SF",   # San Francisco 49ers
    26: "SEA",  # Seattle Seahawks
    27: "TB",   # Tampa Bay Buccaneers
    28: "WSH",  # Washington Commanders (Redskins <=2019, Washington 2020-21)
    29: "CAR",  # Carolina Panthers
    30: "JAX",  # Jacksonville Jaguars
    33: "BAL",  # Baltimore Ravens (est. 1996)
    34: "HOU",  # Houston Texans (est. 2002)
}


# ---------------------------------------------------------------------------
# Season-independent abbreviations.
#
# Every entry below was observed in at least one of the six sources and resolves
# to exactly one franchise in every season it appears. "Observed in" lists the
# file::column sites; seasons are the range over which the value occurs.
#
# `HOU`, `BAL` and `STL` are deliberately ABSENT from this table -- see
# SEASON_DEPENDENT.
# ---------------------------------------------------------------------------
ALIASES: dict[str, int] = {
    # -- the 30 unambiguous current ESPN abbreviations ----------------------
    "ATL": 1,   # Atlanta Falcons        -- all six sources
    "BUF": 2,   # Buffalo Bills          -- all six sources
    "CHI": 3,   # Chicago Bears          -- all six sources
    "CIN": 4,   # Cincinnati Bengals     -- all six sources
    "CLE": 5,   # Cleveland Browns       -- all six sources. NOT era-split: the
                #   franchise was dormant 1996-98 (players.csv last_season shows
                #   the gap 1996-1998) but both sides are the same franchise 5.
    "DAL": 6,   # Dallas Cowboys         -- all six sources
    "DEN": 7,   # Denver Broncos         -- all six sources
    "DET": 8,   # Detroit Lions          -- all six sources
    "GB": 9,    # Green Bay Packers      -- all six sources
    "TEN": 10,  # Tennessee Titans/Oilers -- all six sources; players.csv
                #   last_season 1997-2026 only, never earlier
    "IND": 11,  # Indianapolis Colts     -- all six sources; players.csv
                #   last_season 1984-2026 only (relocated from Baltimore in 1984)
    "KC": 12,   # Kansas City Chiefs     -- all six sources
    "LV": 13,   # Las Vegas Raiders      -- games.json 2020-26, snap_counts
                #   2020-25, rosters 2020-25, depth_charts 2020-24; ALSO
                #   player_stats 2010-2025 and players.csv 1974-2026, where
                #   nflverse back-applies the current label to the Oakland era
    "LAR": 14,  # Los Angeles Rams       -- games.json 2026 (17 rows),
                #   rosters.csv draft_club 2025 (61 rows). ESPN's own spelling.
    "MIA": 15,  # Miami Dolphins         -- all six sources
    "MIN": 16,  # Minnesota Vikings      -- all six sources
    "NE": 17,   # New England Patriots   -- all six sources
    "NO": 18,   # New Orleans Saints     -- all six sources
    "NYG": 19,  # New York Giants        -- all six sources
    "NYJ": 20,  # New York Jets          -- all six sources
    "PHI": 21,  # Philadelphia Eagles    -- all six sources
    "ARI": 22,  # Arizona Cardinals      -- all six sources; players.csv
                #   last_season 1988-2025 only (Phoenix from 1988)
    "PIT": 23,  # Pittsburgh Steelers    -- all six sources
    "LAC": 24,  # Los Angeles Chargers   -- games.json 2017-26, snap_counts
                #   2017-25, rosters 2017-25, depth_charts 2017-24; ALSO
                #   player_stats 2010-2025 and players.csv 1974-2026, where
                #   nflverse back-applies the current label to the San Diego era
    "SF": 25,   # San Francisco 49ers    -- all six sources
    "SEA": 26,  # Seattle Seahawks       -- all six sources
    "TB": 27,   # Tampa Bay Buccaneers   -- all six sources
    "WSH": 28,  # Washington Commanders  -- games.json 2026 (17 rows). ESPN's
                #   own spelling; no other source emits it.
    "CAR": 29,  # Carolina Panthers      -- all six sources
    "JAX": 30,  # Jacksonville Jaguars   -- all six sources

    # -- relocation aliases: same franchise, earlier city --------------------
    "OAK": 13,  # Oakland Raiders        -- games.json 2010-2019, snap_counts
                #   2013-2019, rosters.team 2010-2019, rosters.draft_club
                #   2010-2025, depth_charts.club_code 2010-2019
    "SD": 24,   # San Diego Chargers     -- games.json 2010-2016, snap_counts
                #   2013-2016, rosters.team 2010-2016, rosters.draft_club
                #   2010-2025, depth_charts.club_code 2010-2016
    "LA": 14,   # Los Angeles Rams       -- games.json 2016-2025, snap_counts
                #   2016-2025, rosters.team 2016-2025, rosters.draft_club
                #   2016-2024, depth_charts 2016-2024, player_stats 2010-2025
                #   (back-applied), players.csv 1974-2026.
                #   VERIFIED NOT THE CHARGERS: LAC occurs disjointly in every
                #   one of those sites, and 46,000+ game-anchored rows resolve
                #   LA to franchise 14 with zero rows resolving to 24.

    # -- nflverse / PFR spellings that no ESPN feed emits --------------------
    "WAS": 28,  # Washington             -- games.json 2010-2025, snap_counts
                #   2013-2025, rosters 2010-2025, player_stats 2010-2025,
                #   depth_charts 2010-2025, players.csv 1974-2026
    "SL": 14,   # St. Louis Rams         -- rosters.csv team 2010-2015 (393
                #   rows) and draft_club 2010-2015 (265 rows) only. NOT the
                #   St. Louis Cardinals: the Cardinals were in Arizona for all
                #   of 2010-2015 (ARZ appears in the same files, same seasons),
                #   234 week-exact roster rows resolve to franchise 14, and no
                #   SL draft_club row has a draft_year before 2000.
    "ARZ": 22,  # Arizona Cardinals      -- rosters.csv team + draft_club,
                #   2010-2015 only (PFR spelling)
    "BLT": 33,  # Baltimore Ravens       -- rosters.csv team + draft_club,
                #   2010-2015 only (PFR spelling). Unambiguous: this spelling
                #   postdates the Baltimore Colts by decades.
    "CLV": 5,   # Cleveland Browns       -- rosters.csv team + draft_club,
                #   2010-2015 only (PFR spelling)
    "HST": 34,  # Houston Texans         -- rosters.csv team + draft_club,
                #   2010-2015 only (PFR spelling). Unambiguous: this spelling
                #   never denoted the Houston Oilers.
    "JAC": 30,  # Jacksonville Jaguars   -- rosters.csv draft_club, 2016 only
                #   (3 rows)
    "AZ": 22,   # Arizona Cardinals      -- players.csv latest_team, 2026 only
                #   (92 rows). Previously unmapped. 59 of the 92 players' most
                #   recent rosters.csv team is ARI and 29 were drafted by ARI;
                #   no ARI row carries last_season 2026, so the 2026 players
                #   release simply relabelled ARI -> AZ.
}


# ---------------------------------------------------------------------------
# Season-dependent abbreviations.
#
# These CANNOT be a flat str -> int map. Each span below is closed on both ends
# and is materialised into SEASON_DEPENDENT as explicit (abbr, season) keys.
# Seasons outside every span for a given abbreviation are absent on purpose:
# no NFL team used that abbreviation then, so resolve() raises.
#
# `_SPAN_MIN`/`_SPAN_MAX` bound the enumeration; 1960 is the AFL/modern-era
# start and 2035 is headroom.
# ---------------------------------------------------------------------------
_SPAN_MIN, _SPAN_MAX = 1960, 2035

_ERA_SPANS: list[tuple[str, int, int, int, str]] = [
    # (abbr, first_season, last_season, franchise_id, evidence)
    ("HOU", _SPAN_MIN, 1996, 10,
     "Houston Oilers. ESPN seasons/1995/teams/10 and /1996/teams/10 both return "
     "abbreviation HOU, displayName 'Houston Oilers'. OBSERVED: players.csv "
     "latest_team 1974-1996 (248 rows) and draft_team 1974-1996. A flat "
     "HOU -> 34 would assign these to the Texans, who did not exist."),
    ("HOU", 2002, _SPAN_MAX, 34,
     "Houston Texans. ESPN seasons/2002/teams/34 returns HOU 'Houston Texans'. "
     "OBSERVED: every 2010-2026 source, plus players.csv latest_team 2002-2026. "
     "The gap 1997-2001 is real -- Houston had no NFL team, and players.csv "
     "latest_team has no HOU row in those five years."),

    ("BAL", _SPAN_MIN, 1983, 11,
     "Baltimore Colts, now the Indianapolis Colts. OBSERVED: players.csv "
     "latest_team 1974-1983 (108 rows) and draft_team 1974-1983. A flat "
     "BAL -> 33 would assign these to the Ravens, founded 1996. ESPN itself "
     "abbreviates the 1983 Baltimore Colts as IND (seasons/1983/teams/11, "
     "displayName 'Baltimore Colts'), so ESPN never emits this spelling -- "
     "it is an nflverse-only usage."),
    ("BAL", 1996, _SPAN_MAX, 33,
     "Baltimore Ravens. ESPN seasons/1996/teams/33 returns BAL 'Baltimore "
     "Ravens'. OBSERVED: every 2010-2026 source, plus players.csv latest_team "
     "1996-2026. The gap 1984-1995 is real -- Baltimore had no NFL team, and "
     "players.csv latest_team has no BAL row in those twelve years."),

    ("STL", _SPAN_MIN, 1987, 22,
     "St. Louis Cardinals. ESPN seasons/1987/teams/22 returns abbreviation STL, "
     "displayName 'St. Louis Cardinals'. NOT OBSERVED in any of the six "
     "sources -- the earliest Rams-labelled draft_club row has draft_year 2000 "
     "-- but the ambiguity is real in ESPN's own vocabulary and resolving STL "
     "without a season would be a guess."),
    ("STL", 1995, _SPAN_MAX, 14,
     "St. Louis Rams. ESPN seasons/1995/teams/14 returns STL 'St. Louis Rams'. "
     "OBSERVED: games.json 2010-2015, snap_counts 2013-2015, "
     "depth_charts.club_code 2010-2015, rosters.draft_club 2016-2025 (the "
     "season on a draft_club row is the ROSTER season, not the draft year, "
     "which is why this span must extend past 2015)."),

    # ESPN-attested historical spellings. Not present in any of the six sources
    # today; included so a future ESPN-sourced feed cannot silently fail.
    ("LOS", _SPAN_MIN, 1994, 14,
     "Los Angeles Rams pre-St. Louis. ESPN seasons/1994/teams/14 returns "
     "abbreviation LOS, displayName 'Los Angeles Rams'. NOT OBSERVED in any "
     "of the six sources."),
    ("PHO", 1988, 1993, 22,
     "Phoenix Cardinals. ESPN seasons/1988/teams/22 returns abbreviation PHO, "
     "displayName 'Phoenix Cardinals'. NOT OBSERVED in any of the six sources."),
]

SEASON_DEPENDENT: dict[tuple[str, int], int] = {
    (abbr, season): fid
    for abbr, first, last, fid, _evidence in _ERA_SPANS
    for season in range(first, last + 1)
}

#: Abbreviations that require a season. Resolving one of these without a season
#: is an error, not a lookup miss.
_ERA_SPLIT_ABBRS: frozenset[str] = frozenset(a for a, *_ in _ERA_SPANS)

#: Human-readable evidence per era-split abbreviation, for error messages.
_ERA_NOTES: dict[str, list[tuple[int, int, int, str]]] = {}
for _span in _ERA_SPANS:
    _ERA_NOTES.setdefault(_span[0], []).append(_span[1:])
del _span


def resolve(abbr: str | None, season: int | None = None) -> int:
    """Return the ESPN franchise id for `abbr`.

    `season` is required for era-split abbreviations (HOU, BAL, STL, LOS, PHO)
    and is used in preference to the flat table for any abbreviation that has
    an entry for that season.

    Raises UnknownTeamAbbr for anything unmapped -- including None, the empty
    string and whitespace. There is deliberately no default: a silent fallback
    is what produced the orphan rows this module exists to prevent.
    """
    if abbr is None:
        raise UnknownTeamAbbr("team abbreviation is None (caller must handle "
                              "structurally-absent values explicitly)")
    key = abbr.strip()
    if not key:
        raise UnknownTeamAbbr(f"team abbreviation is blank: {abbr!r}")

    if season is not None:
        season = int(season)
        hit = SEASON_DEPENDENT.get((key, season))
        if hit is not None:
            return hit

    if key in _ERA_SPLIT_ABBRS:
        spans = ", ".join(f"{f}-{l} -> {fid}" for f, l, fid, _ in _ERA_NOTES[key])
        if season is None:
            raise UnknownTeamAbbr(
                f"{key!r} is era-split and cannot be resolved without a season "
                f"({spans})")
        raise UnknownTeamAbbr(
            f"{key!r} in season {season} matches no era span ({spans}); no NFL "
            f"team used this abbreviation that season")

    hit = ALIASES.get(key)
    if hit is None:
        raise UnknownTeamAbbr(
            f"unknown team abbreviation {key!r}"
            + (f" (season {season})" if season is not None else ""))
    return hit


# ===========================================================================
# Self-check: scan all six sources, resolve every team-like value, exit
# non-zero if anything is unmapped.  python3 scripts/data/nfl-db/lib/team_aliases.py
# ===========================================================================

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.abspath(os.path.join(_HERE, "..", "..", "..", ".."))
_RAW = os.path.join(_ROOT, "scripts", "data", "nfl-db", "raw")
_UNIFIED = os.path.join(_ROOT, "scripts", "data", "nfl-unified-2010-2026", "games.json")

#: (file, team column, season column, why a blank value is legitimate).
#: A blank reason of None means blanks are NOT expected and will fail the check.
_SOURCES: list[tuple[str, str, str, str | None]] = [
    ("players.csv", "latest_team", "last_season", None),
    ("players.csv", "draft_team", "draft_year",
     "player went undrafted -- structurally not applicable"),
    ("rosters.csv", "team", "season", None),
    ("rosters.csv", "draft_club", "season",
     "player went undrafted -- structurally not applicable"),
    ("snap_counts.csv", "team", "season", None),
    ("snap_counts.csv", "opponent", "season", None),
    ("player_stats.csv", "team", "season",
     "wholly blank row (player_id also blank)"),
    ("player_stats.csv", "opponent_team", "season",
     "wholly blank row (player_id also blank)"),
    ("depth_charts.csv", "club_code", "season",
     "schema-B snapshot row -- carries `team` and `dt` instead"),
    ("depth_charts.csv", "team", None,
     "schema-A row -- carries `club_code` and `season` instead"),
]


def _selfcheck() -> int:
    import csv
    import json
    from collections import Counter, defaultdict

    csv.field_size_limit(10 ** 9)
    ok = Counter()
    blank = Counter()
    fail: dict[tuple, dict] = defaultdict(lambda: {"rows": 0, "seasons": set(), "err": ""})

    def check(site: str, value, season, blank_reason):
        if value is None or not str(value).strip():
            blank[(site, blank_reason or "UNEXPECTED BLANK")] += 1
            return
        try:
            resolve(value, season)
            ok[site] += 1
        except UnknownTeamAbbr as e:
            rec = fail[(site, str(value))]
            rec["rows"] += 1
            rec["seasons"].add(season)
            rec["err"] = str(e)

    by_file: dict[str, list] = defaultdict(list)
    for f, col, scol, reason in _SOURCES:
        by_file[f].append((col, scol, reason))

    for fname, cols in by_file.items():
        path = os.path.join(_RAW, fname)
        with open(path, newline="", encoding="utf-8", errors="replace") as fh:
            rd = csv.DictReader(fh)
            for col, _s, _r in cols:
                if col not in (rd.fieldnames or []):
                    print(f"  FAIL {fname}: expected column {col!r} is missing")
                    return 1
            for row in rd:
                for col, scol, reason in cols:
                    v = row.get(col)
                    if scol:
                        s = row.get(scol)
                        s = int(s) if s and str(s).strip() else None
                    elif fname == "depth_charts.csv" and row.get("dt"):
                        # schema-B rows carry no season; the NFL league year
                        # starts in March, so derive it from the snapshot date.
                        y, m = int(row["dt"][:4]), int(row["dt"][5:7])
                        s = y if m >= 3 else y - 1
                    else:
                        s = None
                    check(f"{fname}::{col}", v, s, reason)
        print(f"  scanned {fname}")

    for g in json.load(open(_UNIFIED)):
        for col, fid_col in (("awayAbbr", "awayFranchiseId"), ("homeAbbr", "homeFranchiseId")):
            check(f"games.json::{col}", g.get(col), g.get("season"),
                  "unscheduled postseason placeholder -- matchup not yet determined")
            # cross-check: where the feed already carries a franchise id, the
            # alias table must agree with it.
            if g.get(col) and g.get(fid_col) is not None:
                if resolve(g[col], g["season"]) != g[fid_col]:
                    fail[(f"games.json::{col}", g[col])]["rows"] += 1
                    fail[(f"games.json::{col}", g[col])]["seasons"].add(g["season"])
                    fail[(f"games.json::{col}", g[col])]["err"] = (
                        f"alias resolves to {resolve(g[col], g['season'])} but the "
                        f"feed says {g[fid_col]}")
    print("  scanned games.json")

    print("\n  resolved values per site:")
    for site in sorted(ok):
        print(f"    {site:<34} {ok[site]:>8}")
    print(f"    {'TOTAL RESOLVED':<34} {sum(ok.values()):>8}")

    print("\n  blank / structurally-absent values (not failures):")
    if not blank:
        print("    none")
    for (site, reason), n in sorted(blank.items()):
        flag = "  <-- UNEXPECTED" if reason == "UNEXPECTED BLANK" else ""
        print(f"    {site:<34} {n:>8}  {reason}{flag}")

    # guard against a silent-fallback regression creeping back in
    for bad in (None, "", "   ", "ZZZ", "HOU", ("STL", 1990), ("BAL", 1990)):
        args = bad if isinstance(bad, tuple) else (bad,)
        try:
            resolve(*args)
        except UnknownTeamAbbr:
            pass
        else:
            print(f"\n  FAIL resolve{args!r} returned a value; it must raise")
            return 1
    print("\n  no-silent-fallback guard: PASS")

    unexpected_blank = sum(n for (s, r), n in blank.items() if r == "UNEXPECTED BLANK")
    if fail or unexpected_blank:
        print("\n  UNMAPPED VALUES:")
        for (site, val), rec in sorted(fail.items()):
            ss = sorted(x for x in rec["seasons"] if x is not None)
            rng = f"{ss[0]}-{ss[-1]}" if ss else "no season"
            print(f"    {site:<34} {val!r:<8} rows={rec['rows']:<7} seasons={rng}")
            print(f"      {rec['err']}")
        if unexpected_blank:
            print(f"    {unexpected_blank} blank values in columns where blanks are not expected")
        return 1

    print("\n  SELF-CHECK PASS: every team-like value in all six sources resolves.")
    return 0


if __name__ == "__main__":
    import sys

    print("team_aliases self-check")
    print(f"  root: {_ROOT}")
    sys.exit(_selfcheck())
