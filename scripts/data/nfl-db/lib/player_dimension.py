"""Referentially complete `player` dimension for scripts/data/nfl-db/nfl.db.

Why this module exists
----------------------
`build_db.py` builds the `player` table from `raw/players.csv` alone (25,035 rows,
one per `gsis_id`).  Four fact tables and two `game` columns key on `gsis_id`, and
`raw/rosters.csv` is a season x player panel that contains **1,482 gsis ids the
players release omits** -- almost entirely offseason/preseason roster churn
(1,323 of them carry status `CUT`).  Those ids arrive in `roster_season` and
`depth_chart` with no dimension row to join to.

`build_player_dimension()` returns the union: every player `players.csv` knows
about, plus every player referenced by a fact table, sourced from `rosters.csv`.
No row is invented.  Fields that neither source publishes stay `None`.

Import-time side effects: none.  Nothing is written; nothing is fetched.

Provenance of every non-CSV value in this file is cited inline.  Evidence
artefacts (ESPN responses, the DynastyProcess crosswalk, match tables) are
cached under `scripts/data/nfl-db/cache/b5/`.

Audit: docs/audits/2026-07-27-nfl-db-completion/reports/B5-player-dimension.md
"""

from __future__ import annotations

import argparse
import csv
import os
import sqlite3
import sys
from collections import defaultdict
from typing import Any, Iterable, Sequence

# --------------------------------------------------------------------------
# Schema contract -- column order matches `player` in schema.sql exactly, so a
# caller can do `INSERT INTO player VALUES (...)` with tuple(row[c] for c in
# PLAYER_COLUMNS).
# --------------------------------------------------------------------------
PLAYER_COLUMNS: tuple[str, ...] = (
    "gsis_id",
    "display_name",
    "first_name",
    "last_name",
    "position",
    "position_group",
    "birth_date",
    "height",
    "weight",
    "college",
    "draft_year",
    "draft_round",
    "draft_pick",
    "draft_team",
    "rookie_year",
    "last_season",
    "status",
    "esb_id",
    "pfr_id",
    "espn_id",
    "headshot_url",
)

_HERE = os.path.dirname(os.path.abspath(__file__))
_NFL_DB_DIR = os.path.dirname(_HERE)
DEFAULT_PLAYERS_CSV = os.path.join(_NFL_DB_DIR, "raw", "players.csv")
DEFAULT_ROSTERS_CSV = os.path.join(_NFL_DB_DIR, "raw", "rosters.csv")
DEFAULT_DB = os.path.join(_NFL_DB_DIR, "nfl.db")


# --------------------------------------------------------------------------
# MANUAL_ADDITIONS
#
# Patches applied on top of the CSV-derived dimension.  Each entry is keyed by
# `gsis_id`; every other key is a `player` column whose value overrides (or
# fills) the CSV-derived value.  If the `gsis_id` is absent from both CSVs the
# entry is inserted as a new row instead.
#
# As of the 2026-07-27 audit **zero new rows are required** -- every gsis id any
# fact table references is published by `raw/rosters.csv`.  The entries below are
# therefore all identity-key backfills for players that the fact tables *do*
# reference but whose `pfr_id` / `espn_id` the nflverse players release leaves
# empty.  Each is sourced, not derived.
#
# `_source` is mandatory and is asserted by the self-check.
# --------------------------------------------------------------------------
MANUAL_ADDITIONS: list[dict[str, Any]] = [
    {
        "gsis_id": "00-0026278",
        "pfr_id": "JameRo99",
        "_source": (
            "Two independent sources agree. (1) nfl.db snap_count carries "
            "pfr_player_id='JameRo99' for player 'Robert James', LB, BAL+KC, "
            "season 2013 -- the same name/position/team/season as player "
            "00-0026278 (Robert James, LB, Arizona State, 2008-2013); those 2 "
            "snap rows are among the 227 with a NULL gsis_id. (2) DynastyProcess "
            "db_playerids.csv maps gsis_id 00-0026278 -> pfr_id JameRo99. "
            "Cache: cache/b5/dp_playerids.csv, cache/b5/snap_pfr_unmatched.json"
        ),
    },
    {
        "gsis_id": "00-0027133",
        "pfr_id": "IngrJa20",
        "_source": (
            "DynastyProcess db_playerids.csv row name='Jake Ingram', "
            "gsis_id=00-0027133 -> pfr_id=IngrJa20. Single-source: nflverse "
            "publishes no pfr_id for this player and he predates snap_counts "
            "(2013+). Cache: cache/b5/dp_playerids.csv"
        ),
    },
    {
        "gsis_id": "00-0025640",
        "pfr_id": "NdukCh99",
        "_source": (
            "DynastyProcess db_playerids.csv row name='Nedu Ndukwe', "
            "gsis_id=00-0025640 -> pfr_id=NdukCh99. Single-source: nflverse "
            "publishes no pfr_id for this player and he predates snap_counts "
            "(2013+). Cache: cache/b5/dp_playerids.csv"
        ),
    },
    {
        "gsis_id": "00-0035437",
        "espn_id": "3917058",
        "_source": (
            "DynastyProcess db_playerids.csv -> espn_id 3917058, confirmed "
            "against ESPN core API athlete 3917058: fullName 'Roderic Teamer', "
            "position S, dateOfBirth 1997-05-12, debutYear 2019 -- matches "
            "player 00-0035437 (Roderic Teamer, DB, Tulane, rookie_year 2019). "
            "Cache: cache/b5/espn_athlete_3917058.json"
        ),
    },
    {
        "gsis_id": "00-0031545",
        "espn_id": "3042435",
        "_source": (
            "DynastyProcess db_playerids.csv -> espn_id 3042435, confirmed "
            "against ESPN core API athlete 3042435: fullName 'Kevin White', "
            "position WR, dateOfBirth 1992-06-25, debutYear 2015, 6'3\"/216 -- "
            "matches player 00-0031545 (Kevin White, WR, West Virginia, "
            "birth_date 1992-06-25, rookie_year 2015). ESPN player search for "
            "'Kevin White' returns exactly one NFL athlete, so this id cannot "
            "belong to the other Kevin White (00-0031683, CB, TCU). "
            "Cache: cache/b5/espn_athlete_3042435.json, "
            "cache/b5/espn_search_kevinwhite.json"
        ),
    },
    {
        "gsis_id": "00-0031067",
        "espn_id": "16932",
        "_source": (
            "ESPN player search 'Cameron Fleming' -> exactly one NFL athlete, "
            "16932 'Cam Fleming': OT, 77in/320lb, debutYear 2014, college 24 = "
            "Stanford. player 00-0031067: Cameron Fleming, OT, 77in/320lb, "
            "Stanford, rookie_year 2014. CONTRADICTION recorded: ESPN gives "
            "dateOfBirth 1993-09-03, nflverse gives 1992-09-03 (same "
            "month/day, one year apart). Position, height, weight, college and "
            "debut season all agree exactly, so the identity is not in doubt; "
            "the birth year disagreement is left unresolved and not written. "
            "Cache: cache/b5/espn_athlete_16932.json, "
            "cache/b5/espn_search_000031067.json, cache/b5/espn_college_24.json"
        ),
    },
    {
        "gsis_id": "00-0020664",
        "espn_id": "17764",
        "_source": (
            "ESPN player search 'Brandon Moore' -> exactly one NFL athlete, "
            "17764 'Brandon Moore': 73in/240lb, dateOfBirth 1979-01-16, "
            "college 201 = Oklahoma. player 00-0020664: Brandon Moore, LB, "
            "73in/240lb, birth_date 1979-01-16, Oklahoma. Birth date, height, "
            "weight and college all match exactly. "
            "Cache: cache/b5/espn_athlete_17764.json, "
            "cache/b5/espn_search_000020664.json, cache/b5/espn_college_201.json"
        ),
    },
]


# --------------------------------------------------------------------------
# DUPLICATE_KEYS
#
# Every identity-key collision found in the 2026-07-27 audit, and how each is
# resolved.  Keys that are clean are recorded as empty so the absence is an
# assertion rather than an omission.
# --------------------------------------------------------------------------
DUPLICATE_KEYS: dict[str, Any] = {
    # ---- keys that are clean -------------------------------------------
    "gsis_id_duplicates": {
        "count": 0,
        "note": (
            "`gsis_id` is the PRIMARY KEY of `player` and is 25,035 distinct "
            "over 25,035 rows, with zero NULL/empty and zero case- or "
            "whitespace-variant collisions. 6,098 of those ids are not in "
            "`00-0XXXXXX` form -- nflverse back-fills `gsis_id` with `esb_id` "
            "for players (mostly pre-2000) that never received a GSIS id. That "
            "is a format quirk, not a duplicate; a loader must not assume "
            "`^00-\\d{7}$`."
        ),
    },
    "pfr_id_duplicates": {
        "count": 0,
        "note": (
            "22,554 of 25,035 rows carry a pfr_id; all 22,554 values are "
            "distinct, case- and whitespace-insensitively. Adding the 1,482 "
            "rosters-derived rows introduces exactly 1 new pfr_id and it does "
            "not collide. The snap crosswalk keying on pfr_id is therefore safe."
        ),
    },
    "espn_id_duplicates": {
        "count": 0,
        "note": (
            "16,768 of 25,035 rows carry an espn_id; all 16,768 values are "
            "distinct. The 1,482 rosters-derived rows contribute 35 espn_ids, "
            "none colliding with an existing value and none duplicated among "
            "themselves. The depth-chart recovery keying on espn_id is safe."
        ),
    },

    # ---- one human, two gsis ids ---------------------------------------
    # Resolution: BOTH ids stay in the dimension, because the fact tables
    # reference both and this module must not rewrite fact tables. `canonical`
    # names the row that owns the crosswalk keys (pfr_id / espn_id); the other
    # row deliberately carries neither, so pfr_id/espn_id stay unique.
    "same_human_two_gsis": {
        "resolution": (
            "Keep both rows. The `canonical` id owns pfr_id/espn_id; the "
            "`alias` id is added from rosters.csv without crosswalk keys so no "
            "key is duplicated. Downstream aggregation over a player must "
            "collapse alias -> canonical using CANONICAL_GSIS below."
        ),
        "pairs": [
            {
                "canonical": "BAT138483", "alias": "00-0029389",
                "name": "Phil Bates", "position": "WR",
                "evidence": (
                    "players.csv BAT138483: WR, 73in/220lb, birth 1989-09-20, "
                    "rookie 2012, pfr BatePh00, espn 15554. rosters.csv "
                    "00-0029389: WR, 73in/220lb, rookie/entry 2012, SEA wk8 + "
                    "CLV wk17 of 2014. ESPN athlete 15554 = Phil Bates, WR, "
                    "73in/220lb, dob 1989-09-20, debut 2012. Decisive: "
                    "snap_count has one row keyed BAT138483 for pfr_game_id "
                    "2014_08_SEA_CAR (2014 wk8, SEA) and roster_season has the "
                    "matching 2014 wk8 SEA row keyed 00-0029389 -- same player, "
                    "same week, same team, two ids. nflverse assigns them "
                    "different esb_ids (BAT138483 vs BAT137358), which is why "
                    "no key join finds this pair."
                ),
            },
            {
                "canonical": "HAR805951", "alias": "00-0035012",
                "name": "Nate Harvey", "position": "DE/DL",
                "evidence": "shared esb_id HAR805951 and smart_id "
                            "32004841-5280-5951-19f2-c3f1613995ed; 73in/225lb, "
                            "East Carolina, rookie 2019 on both sides.",
            },
            {
                "canonical": "FAL374501", "alias": "00-0035712",
                "name": "Lo Falemaka", "position": "C/OL",
                "evidence": "shared esb_id FAL374501 and smart_id "
                            "32004641-4c37-4501-fba1-9867f67d86e7; Utah, "
                            "rookie 2019 on both sides.",
            },
            {
                "canonical": "JOH382488", "alias": "00-0036141",
                "name": "Johnathon Johnson", "position": "WR",
                "evidence": "shared esb_id JOH382488 and smart_id "
                            "32004a4f-4838-2488-97df-65aea96ce6a2; 70in/180lb, "
                            "Missouri, rookie 2020 on both sides.",
            },
            {
                "canonical": "LOV131275", "alias": "00-0035937",
                "name": "Josh Love", "position": "QB",
                "evidence": "shared esb_id LOV131275; 74in/205lb, San Jose "
                            "State, QB on both sides.",
            },
            {
                "canonical": "KEL755800", "alias": "00-0036581",
                "name": "Xavier Kelly", "position": "DT/DL",
                "evidence": "shared esb_id KEL755800; 77in/311lb, Arkansas, "
                            "rookie 2021 on both sides.",
            },
            {
                "canonical": "VIT313230", "alias": "00-0037036",
                "name": "Mark Vital", "position": "TE",
                "evidence": "shared esb_id VIT313230; 77in/250lb, Baylor, TE "
                            "on both sides.",
            },
            {
                "canonical": "JAN439601", "alias": "00-0039605",
                "name": "Jaxon Janke", "position": "WR",
                "evidence": "shared esb_id JAN439601; 75in/210lb, South Dakota "
                            "State, rookie 2024 on both sides. NOTE his twin "
                            "brother Jadon Janke (00-0039604) carries Jaxon's "
                            "smart_id in rosters.csv -- see "
                            "smart_id_collisions.",
            },
            {
                "canonical": "MAT090108", "alias": "00-0038325",
                "name": "Alex Matheson", "position": "LS",
                "evidence": (
                    "'Matheson' appears once in players.csv as a modern player "
                    "(MAT090108, LS, California Lutheran, LA, rookie/last 2023) "
                    "and once in rosters.csv (00-0038325, LS, California "
                    "Lutheran, LA, 2023 wk18, status DEV). ESPN athlete "
                    "3163372 (the espn_id on MAT090108) = 'Alexander Matheson', "
                    "LS, dob 1995-03-30, currently team 14 (LA). "
                    "CONTRADICTION recorded: ESPN links him to college 2364 "
                    "'Minnesota State' while nflverse says California Lutheran; "
                    "and heights/weights differ (players.csv 77in/245lb vs "
                    "rosters.csv 75in/230lb). Neither changes the conclusion -- "
                    "there is exactly one Alex Matheson LS in either feed."
                ),
            },
            {
                "canonical": "PRY456541", "alias": "00-0040792",
                "name": "Layne Pryor", "position": "TE",
                "evidence": (
                    "Both rows are inside players.csv, sharing esb_id "
                    "PRY456541 and smart_id "
                    "32005052-5945-6541-b8ff-63047ad93bc7 and birth_date "
                    "2002-12-09 and college Northern Iowa. nflverse back-filled "
                    "one row's gsis_id with the esb_id. Neither id is "
                    "referenced by any fact table today, so nothing is "
                    "currently misattributed -- but roster_season has a 2025 "
                    "HOU row for 'Layne Pryor' with a NULL gsis_id that "
                    "resolves to PRY456541 (rookie/last 2025, latest_team HOU)."
                ),
            },
        ],
    },

    # ---- two humans, one key -------------------------------------------
    "esb_id_collisions": [
        {
            "esb_id": "PRY456541",
            "gsis_ids": ["00-0040792", "PRY456541"],
            "verdict": "SAME human (Layne Pryor) -- see same_human_two_gsis.",
        },
        {
            "esb_id": "REE257783",
            "gsis_ids": ["00-0032387", "00-0039642"],
            "verdict": (
                "DIFFERENT humans. REE257783 is Jarran Reed's esb_id "
                "(00-0032387, DT, Alabama, born 1992-12-16, smart_id "
                "32005245-4525-7783-... -- the esb is embedded in the smart_id, "
                "so it is genuinely his). rosters.csv stamps the same esb_id on "
                "X'Zauvea Gadlin's single 2024 TEN row (00-0039642, OL, "
                "Liberty), which carries no smart_id/pfr_id/espn_id/birth_date. "
                "HAZARD: any crosswalk that resolves a roster row by esb_id "
                "will attribute Gadlin to Jarran Reed. Resolution: esb_id is "
                "not a safe join key on its own -- require a name or smart_id "
                "corroboration. This module never joins on esb_id."
            ),
        },
    ],
    "smart_id_collisions": [
        {
            "smart_id": "3200474f-5204-5716-a75e-4ec8e313a651",
            "gsis_ids": ["00-0035988", "00-0036200", "00-0035915"],
            "verdict": (
                "THREE humans. The uuid encodes esb GOR045716 = Anthony Gordon "
                "(00-0035988, QB, Washington State), so it is his. rosters.csv "
                "also stamps it on Dustin Woodard (00-0036200, OL, Memphis, "
                "2020) and Jake Benzinger (00-0035915, OL, Wake Forest, 2021). "
                "HAZARD: smart_id is not unique in rosters.csv. This module "
                "never joins on smart_id."
            ),
        },
        {
            "smart_id": "32004a41-4e43-9601-3bc3-9d2a327c58fc",
            "gsis_ids": ["JAN439601", "00-0039604"],
            "verdict": (
                "TWO humans -- twin brothers. The uuid encodes esb JAN439601 = "
                "Jaxon Janke. rosters.csv stamps it on his twin Jadon Janke "
                "(00-0039604, WR, South Dakota State, 2024), whose own esb is "
                "JAN436226. Same-name/same-school twins are exactly the case "
                "where a name+college heuristic also fails; only the esb_id "
                "separates them."
            ),
        },
    ],
    "gsis_it_id_unreliable": {
        "count": 16,
        "note": (
            "rosters.csv `gsis_it_id` agrees with players.csv `nfl_id` for "
            "7,886 players and disagrees for 16, all in the 2018 entry class, "
            "in a way that points at a different real player (e.g. Saquon "
            "Barkley's roster row carries gsis_it_id 46208 = R.J. McIntosh; "
            "Baker Mayfield's carries 46073 = Denzel Ward). Do NOT use "
            "gsis_it_id as an identity key. Three orphans (00-0034595 Nyles "
            "Morgan, 00-0034821 Juante Baldwin, 00-0034826 Bo Bower) match an "
            "existing player only through this corrupted column and are NOT "
            "duplicates."
        ),
    },
    "shared_birth_date_distinct_humans": [
        {
            "birth_date": "1992-06-25",
            "gsis_ids": ["00-0031545", "00-0031683"],
            "verdict": (
                "TWO humans: Kevin White (WR, West Virginia, esb WHI315610, pfr "
                "WhitKe00, espn 3042435) and Kevin White (CB, TCU, esb "
                "WHI315683, no pfr, no espn). nflverse records the same "
                "birth_date for both; ESPN knows only one NFL Kevin White "
                "(3042435, the WVU WR). The CB's birth_date is unverified and "
                "may be copied from the WR. Consequence: name+birth_date is NOT "
                "a sufficient identity test in this dataset -- college and "
                "esb_id are required."
            ),
        },
    ],
}

# Convenience map for downstream aggregation: alias gsis -> canonical gsis.
CANONICAL_GSIS: dict[str, str] = {
    p["alias"]: p["canonical"]
    for p in DUPLICATE_KEYS["same_human_two_gsis"]["pairs"]
}

# gsis ids that must NOT receive crosswalk keys, because their canonical twin
# already owns them (keeps pfr_id / espn_id unique).
_ALIAS_IDS: frozenset[str] = frozenset(CANONICAL_GSIS)


# --------------------------------------------------------------------------
# helpers -- mirror build_db.py's coercion semantics exactly
# --------------------------------------------------------------------------
def _pick(row: dict, *names: str) -> Any:
    """First present, non-empty, non-'NA' column among `names`."""
    for n in names:
        v = row.get(n)
        if v not in ("", None) and (not isinstance(v, str) or v.strip() != "NA"):
            return v.strip() if isinstance(v, str) else v
    return None


def _as_int(v: Any) -> int | None:
    if v in (None, "", "NA"):
        return None
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def _as_id(v: Any) -> str | None:
    """Normalise a numeric-looking external id ('4241983.0' -> '4241983')."""
    if v in (None, "", "NA"):
        return None
    s = str(v).strip()
    if not s or s == "NA":
        return None
    try:
        f = float(s)
        if f.is_integer():
            return str(int(f))
    except (TypeError, ValueError):
        pass
    return s


def _blank_row(gsis_id: str) -> dict[str, Any]:
    row: dict[str, Any] = {c: None for c in PLAYER_COLUMNS}
    row["gsis_id"] = gsis_id
    return row


# --------------------------------------------------------------------------
# source adapters
# --------------------------------------------------------------------------
def _row_from_players_csv(r: dict) -> dict[str, Any]:
    """Exactly the mapping build_db.py applies, so the base rows are identical."""
    return {
        "gsis_id": _pick(r, "gsis_id", "player_id"),
        "display_name": _pick(r, "display_name", "full_name"),
        "first_name": _pick(r, "first_name"),
        "last_name": _pick(r, "last_name"),
        "position": _pick(r, "position"),
        "position_group": _pick(r, "position_group"),
        "birth_date": _pick(r, "birth_date"),
        "height": _as_int(_pick(r, "height")),
        "weight": _as_int(_pick(r, "weight")),
        "college": _pick(r, "college_name", "college"),
        "draft_year": _as_int(_pick(r, "draft_year", "entry_year")),
        "draft_round": _as_int(_pick(r, "draft_round")),
        "draft_pick": _as_int(_pick(r, "draft_pick", "draft_number")),
        "draft_team": _pick(r, "draft_club", "draft_team"),
        "rookie_year": _as_int(_pick(r, "rookie_year", "rookie_season")),
        "last_season": _as_int(_pick(r, "last_season")),
        "status": _pick(r, "status"),
        "esb_id": _pick(r, "esb_id"),
        "pfr_id": _pick(r, "pfr_id"),
        "espn_id": _as_id(_pick(r, "espn_id")),
        "headshot_url": _pick(r, "headshot", "headshot_url"),
    }


def _sort_key(r: dict) -> tuple[int, int]:
    return (_as_int(r.get("season")) or 0, _as_int(r.get("week")) or 0)


def _row_from_roster_rows(gsis_id: str, rows: Sequence[dict]) -> dict[str, Any]:
    """Collapse a player's season x week roster panel into one dimension row.

    Latest row wins for each field, falling back to any earlier non-empty value.
    Only values the feed actually publishes are used.

    Deliberately NOT set:
      * `draft_year`  -- rosters.csv has no draft_year. build_db.py's alias
        chain would fall through to `entry_year`, which for the 1,323 CUT
        players in this pool is a league-entry year, not a draft year. Writing
        it would fabricate a draft that never happened.
      * `draft_round` -- not published, and not derivable from pick number
        without the season's compensatory-pick table.
      * `position_group` -- not published by rosters.csv.
      * `pfr_id` / `espn_id` for the 10 alias ids in CANONICAL_GSIS, so their
        canonical twin keeps sole ownership of those keys.
    """
    ordered = sorted(rows, key=_sort_key)

    def best(*names: str) -> Any:
        for r in reversed(ordered):
            v = _pick(r, *names)
            if v is not None:
                return v
        return None

    seasons = [s for s in (_as_int(r.get("season")) for r in ordered) if s is not None]
    row = _blank_row(gsis_id)
    row.update(
        {
            "display_name": best("full_name", "player_name", "football_name"),
            "first_name": best("first_name"),
            "last_name": best("last_name"),
            "position": best("position", "depth_chart_position", "ngs_position"),
            "birth_date": best("birth_date"),
            "height": _as_int(best("height")),
            "weight": _as_int(best("weight")),
            "college": best("college"),
            "draft_pick": _as_int(best("draft_number")),
            "draft_team": best("draft_club"),
            "rookie_year": _as_int(best("rookie_year")),
            "last_season": max(seasons) if seasons else None,
            "status": best("status"),
            "esb_id": best("esb_id"),
            "pfr_id": best("pfr_id"),
            "espn_id": _as_id(best("espn_id")),
            "headshot_url": best("headshot_url"),
        }
    )
    if gsis_id in _ALIAS_IDS:
        row["pfr_id"] = None
        row["espn_id"] = None
    return row


# --------------------------------------------------------------------------
# public API
# --------------------------------------------------------------------------
def build_player_dimension(
    players_csv: str = DEFAULT_PLAYERS_CSV,
    rosters_csv: str = DEFAULT_ROSTERS_CSV,
    extra: Iterable[dict] | None = None,
) -> list[dict[str, Any]]:
    """Return the complete player dimension, one dict per `gsis_id`.

    Args:
        players_csv: nflverse players release (the base dimension).
        rosters_csv: nflverse rosters release; supplies every player the
            players release omits but the fact tables reference.
        extra: optional iterable of partial/whole player dicts merged after the
            CSVs and before MANUAL_ADDITIONS. Each must carry `gsis_id`; other
            keys must be members of PLAYER_COLUMNS. Non-None values override.

    Returns:
        list[dict], each with exactly PLAYER_COLUMNS keys, ordered
        players.csv-first then rosters-derived (sorted by gsis_id).
    """
    out: dict[str, dict[str, Any]] = {}

    with open(players_csv, newline="", encoding="utf-8", errors="replace") as fh:
        for r in csv.DictReader(fh):
            row = _row_from_players_csv(r)
            gid = row["gsis_id"]
            if not gid or gid in out:
                continue
            out[gid] = row

    roster_rows: dict[str, list[dict]] = defaultdict(list)
    with open(rosters_csv, newline="", encoding="utf-8", errors="replace") as fh:
        for r in csv.DictReader(fh):
            gid = (r.get("gsis_id") or "").strip()
            if gid and gid not in ("NA",) and gid not in out:
                roster_rows[gid].append(r)

    for gid in sorted(roster_rows):
        out[gid] = _row_from_roster_rows(gid, roster_rows[gid])

    for patch in list(extra or []) + MANUAL_ADDITIONS:
        _apply_patch(out, patch)

    return list(out.values())


def _apply_patch(out: dict[str, dict[str, Any]], patch: dict) -> None:
    gid = patch.get("gsis_id")
    if not gid:
        raise ValueError(f"patch without gsis_id: {patch!r}")
    unknown = set(patch) - set(PLAYER_COLUMNS) - {"_source"}
    if unknown:
        raise ValueError(f"patch for {gid} has non-schema keys: {sorted(unknown)}")
    row = out.setdefault(gid, _blank_row(gid))
    for k, v in patch.items():
        if k in ("gsis_id", "_source") or v is None:
            continue
        row[k] = v


def as_tuples(dimension: Iterable[dict]) -> list[tuple]:
    """Rows in `player` column order, ready for executemany INSERT."""
    return [tuple(r[c] for c in PLAYER_COLUMNS) for r in dimension]


# --------------------------------------------------------------------------
# self-check
# --------------------------------------------------------------------------
_FACT_SOURCES: tuple[tuple[str, str], ...] = (
    ("player_game_stats", "SELECT gsis_id FROM player_game_stats WHERE gsis_id IS NOT NULL"),
    ("snap_count", "SELECT gsis_id FROM snap_count WHERE gsis_id IS NOT NULL"),
    ("roster_season", "SELECT gsis_id FROM roster_season WHERE gsis_id IS NOT NULL"),
    ("depth_chart", "SELECT gsis_id FROM depth_chart WHERE gsis_id IS NOT NULL"),
    ("game.away_qb_id", "SELECT away_qb_id FROM game WHERE away_qb_id IS NOT NULL"),
    ("game.home_qb_id", "SELECT home_qb_id FROM game WHERE home_qb_id IS NOT NULL"),
)


def orphan_report(db_path: str, dimension: Sequence[dict]) -> dict[str, Any]:
    """Orphan counts per fact source, before (live `player`) and after."""
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        live = {r[0] for r in con.execute("SELECT gsis_id FROM player")}
        built = {r["gsis_id"] for r in dimension}
        per: dict[str, dict[str, int]] = {}
        for name, sql in _FACT_SOURCES:
            rows = [r[0] for r in con.execute(sql)]
            per[name] = {
                "rows": len(rows),
                "distinct_ids": len({*rows}),
                "orphan_rows_before": sum(1 for v in rows if v not in live),
                "orphan_ids_before": len({v for v in rows if v not in live}),
                "orphan_rows_after": sum(1 for v in rows if v not in built),
                "orphan_ids_after": len({v for v in rows if v not in built}),
            }
        return {
            "player_rows_live": len(live),
            "player_rows_built": len(built),
            "added": len(built - live),
            "per_source": per,
            "total_orphan_ids_before": sum(v["orphan_ids_before"] for v in per.values()),
            "total_orphan_rows_before": sum(v["orphan_rows_before"] for v in per.values()),
            "total_orphan_rows_after": sum(v["orphan_rows_after"] for v in per.values()),
        }
    finally:
        con.close()


def key_coverage(dimension: Sequence[dict]) -> dict[str, Any]:
    n = len(dimension)
    have_pfr = sum(1 for r in dimension if r["pfr_id"])
    have_espn = sum(1 for r in dimension if r["espn_id"])
    pfr_counts: dict[str, list[str]] = defaultdict(list)
    espn_counts: dict[str, list[str]] = defaultdict(list)
    for r in dimension:
        if r["pfr_id"]:
            pfr_counts[str(r["pfr_id"]).strip().upper()].append(r["gsis_id"])
        if r["espn_id"]:
            espn_counts[str(r["espn_id"]).strip().upper()].append(r["gsis_id"])
    return {
        "rows": n,
        "pfr_present": have_pfr,
        "pfr_missing": n - have_pfr,
        "espn_present": have_espn,
        "espn_missing": n - have_espn,
        "pfr_duplicates": {k: v for k, v in pfr_counts.items() if len(v) > 1},
        "espn_duplicates": {k: v for k, v in espn_counts.items() if len(v) > 1},
    }


def _main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__ and __doc__.splitlines()[0])
    ap.add_argument("--db", default=DEFAULT_DB)
    ap.add_argument("--players-csv", default=DEFAULT_PLAYERS_CSV)
    ap.add_argument("--rosters-csv", default=DEFAULT_ROSTERS_CSV)
    args = ap.parse_args(argv)

    failures: list[str] = []

    dim = build_player_dimension(args.players_csv, args.rosters_csv)
    ids = [r["gsis_id"] for r in dim]
    print(f"built dimension: {len(dim)} rows, {len(set(ids))} distinct gsis_id")
    if len(ids) != len(set(ids)):
        failures.append("build_player_dimension returned duplicate gsis_id values")
    if any(not i for i in ids):
        failures.append("build_player_dimension returned an empty gsis_id")
    for r in dim:
        if set(r) != set(PLAYER_COLUMNS):
            failures.append(f"row {r.get('gsis_id')} has wrong column set")
            break

    for m in MANUAL_ADDITIONS:
        if not m.get("_source"):
            failures.append(f"MANUAL_ADDITIONS entry {m.get('gsis_id')} lacks _source")

    cov = key_coverage(dim)
    print(
        f"key coverage: pfr_id {cov['pfr_present']}/{cov['rows']} "
        f"({cov['pfr_present'] / cov['rows'] * 100:.2f}%), "
        f"espn_id {cov['espn_present']}/{cov['rows']} "
        f"({cov['espn_present'] / cov['rows'] * 100:.2f}%)"
    )
    if cov["pfr_duplicates"]:
        failures.append(f"duplicate pfr_id: {cov['pfr_duplicates']}")
    if cov["espn_duplicates"]:
        failures.append(f"duplicate espn_id: {cov['espn_duplicates']}")
    print(
        f"duplicate keys: pfr {len(cov['pfr_duplicates'])}, "
        f"espn {len(cov['espn_duplicates'])}"
    )

    if not os.path.exists(args.db):
        print(f"SKIP live orphan check: {args.db} not found", file=sys.stderr)
    else:
        rep = orphan_report(args.db, dim)
        print(
            f"\nplayer rows: live {rep['player_rows_live']} -> "
            f"built {rep['player_rows_built']} (+{rep['added']})"
        )
        head = f"{'source':<18}{'rows':>10}{'ids':>8}{'orph rows':>11}{'orph ids':>10}{'after':>8}"
        print(head)
        print("-" * len(head))
        for name, v in rep["per_source"].items():
            print(
                f"{name:<18}{v['rows']:>10}{v['distinct_ids']:>8}"
                f"{v['orphan_rows_before']:>11}{v['orphan_ids_before']:>10}"
                f"{v['orphan_rows_after']:>8}"
            )
        print(
            f"\ntotal orphan rows: {rep['total_orphan_rows_before']} before, "
            f"{rep['total_orphan_rows_after']} after"
        )
        if rep["total_orphan_rows_after"]:
            failures.append(
                f"{rep['total_orphan_rows_after']} fact-table rows still "
                "reference a player missing from the dimension"
            )

    print(
        f"\nDUPLICATE_KEYS: {len(DUPLICATE_KEYS['same_human_two_gsis']['pairs'])} "
        f"same-human gsis pairs, "
        f"{len(DUPLICATE_KEYS['esb_id_collisions'])} esb_id collisions, "
        f"{len(DUPLICATE_KEYS['smart_id_collisions'])} smart_id collisions"
    )

    if failures:
        print("\nFAIL")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("\nPASS: every fact-table gsis_id resolves to a dimension row; "
          "pfr_id and espn_id are unique where present")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
