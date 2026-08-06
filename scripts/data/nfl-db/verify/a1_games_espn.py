#!/usr/bin/env python3
"""
A1 — Independent verification of the `game` table against ESPN.

Read-only against nfl.db. Every ESPN response is cached under
scripts/data/nfl-db/cache/a1/ and re-read on subsequent runs; nothing is
re-fetched unless --refresh is passed.

Strategy
--------
ESPN's scoreboard endpoint accepts (season, seasontype, week) and returns a full
slate, so the whole 2010-2026 universe costs ~400 requests instead of 4,648
`summary` calls. Any DB row whose espn_event_id does not appear in that universe
falls back to a single `summary?event=` call, which also reveals preseason leaks
(a preseason event id simply will not be in the REG/POST sweep).

Comparison is per field. Systematic differences (encodings that differ by rule
across the whole population) are detected and reported as one rule each, not as
thousands of rows. Anything left over is itemized.

Exit code
---------
0  every row reconciled (agreement, or covered by a declared systematic rule, or
   listed in the ACCEPTED_EXCEPTIONS ledger below with adjudication)
1  at least one unexplained mismatch

Usage
-----
  python3 scripts/data/nfl-db/verify/a1_games_espn.py
  python3 scripts/data/nfl-db/verify/a1_games_espn.py --no-network   # cache only
  python3 scripts/data/nfl-db/verify/a1_games_espn.py --json out.json
"""

from __future__ import annotations

import argparse
import collections
import datetime as dt
import json
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
NFLDB_DIR = os.path.dirname(HERE)
DB_PATH = os.path.join(NFLDB_DIR, "nfl.db")
CACHE_DIR = os.path.join(NFLDB_DIR, "cache", "a1")
SB_DIR = os.path.join(CACHE_DIR, "scoreboard")
SUM_DIR = os.path.join(CACHE_DIR, "summary")
OUT_DIR = os.path.join(CACHE_DIR, "out")

SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary"
UA = "dime-ai-nfl-db-audit/1.0 (A1 games-vs-espn)"

SEASONS = list(range(2010, 2027))
REG_WEEKS = list(range(1, 19))      # 18 requested for every season; pre-2021 return 17
POST_WEEKS = list(range(1, 6))      # 1=WC 2=DIV 3=CON 4=Pro Bowl 5=SB

# ESPN seasontype 3 week number -> DB playoff_round. Week 4 is the Pro Bowl,
# which is not a real game and is deliberately absent from the DB.
POST_WEEK_TO_ROUND = {1: "WC", 2: "DIV", 3: "CON", 4: None, 5: "SB"}

# Cross-check on ESPN's own note headline, which is the authoritative label.
NOTE_TO_ROUND = [
    ("super bowl", "SB"),
    ("pro bowl", None),
    ("conference championship", "CON"),
    ("divisional", "DIV"),
    ("wild card", "WC"),
]

# ---------------------------------------------------------------------------
# Adjudication ledgers.
#
# ADJUDICATED — differences that are NOT database defects. Either ESPN is the
# wrong one, or both sources are right under different definitions, or the
# difference is structurally not applicable. Each entry names the evidence.
#
# DB_DEFECTS — differences where a third source confirms the DB is wrong. These
# keep the exit code non-zero until the data is fixed; that is the point.
#
# Keys are "<field>|<game_id>". A "*" game_id matches every row for that field
# whose value pair also matches the predicate in `_ledger_reason`.
# ---------------------------------------------------------------------------

# ESPN's competitions[0].neutralSite is false for EVERY neutral-site game before
# the 2014 season, and for every pandemic/disaster relocation in any season. The
# DB is right in all 16 cases; the venue in each is demonstrably not the home
# franchise's stadium. Verified game-by-game in the report.
ESPN_NEUTRAL_FLAG_GAP = {
    "2010_08_DEN_SF", "2010_14_NYG_MIN", "2010_21_PIT_GB", "2011_07_CHI_TB",
    "2011_21_NYG_NE", "2012_08_NE_STL", "2012_21_BAL_SF", "2013_04_PIT_MIN",
    "2013_08_SF_JAX", "2013_13_ATL_BUF", "2013_21_SEA_DEN", "2020_13_BUF_SF",
    "2020_14_WAS_SF", "2020_17_SEA_SF", "2021_01_GB_NO", "2024_19_MIN_LA",
}

# nflverse timestamps the scheduled slot; ESPN timestamps the observed kickoff.
# Where a game was delayed the two differ by the delay. All of these are under
# 90 minutes and none moves the game's date, week, matchup or result.
KICKOFF_SCHEDULED_VS_ACTUAL_MAX_S = 5400

# Confirmed DB errors, each with a third source.
DB_DEFECTS: dict[str, str] = {
    # kickoff_utc is 12 hours late: the 09:30 ET London slate was stored as
    # 21:30 ET. Wikipedia (BST/GMT local times) and ESPN both give 13:30Z.
    "kickoff_utc|2017_03_BAL_JAX": "London 09:30 ET slate stored as 21:30 ET (+12h)",
    "kickoff_utc|2017_04_NO_MIA":  "London 09:30 ET slate stored as 21:30 ET (+12h)",
    "kickoff_utc|2017_08_MIN_CLE": "London 09:30 ET slate stored as 21:30 ET (+12h)",
    "kickoff_utc|2018_07_TEN_LAC": "London 09:30 ET slate stored as 21:30 ET (+12h)",
    "kickoff_utc|2018_08_PHI_JAX": "London 09:30 ET slate stored as 21:30 ET (+12h)",
    # Arizona home games with the wrong kickoff. Wikipedia local time matches
    # ESPN exactly and contradicts the DB in both cases.
    "kickoff_utc|2016_02_TB_ARI":  "13:00 ET stored; actual 16:05 ET (13:05 MST)",
    "kickoff_utc|2014_01_SD_ARI":  "21:20 ET stored; actual 22:20 ET (19:20 MST)",
    # espn_event_id collision: this row carries the SEA@ARI id. Correct: 301114030.
    "home_franchise|2010_10_HOU_JAX": "espn_event_id is 301114022 (SEA@ARI); correct id 301114030",
    "away_franchise|2010_10_HOU_JAX": "espn_event_id is 301114022 (SEA@ARI); correct id 301114030",
    "away_score|2010_10_HOU_JAX":     "espn_event_id is 301114022 (SEA@ARI); correct id 301114030",
    "home_score|2010_10_HOU_JAX":     "espn_event_id is 301114022 (SEA@ARI); correct id 301114030",
    "kickoff_utc|2010_10_HOU_JAX":    "espn_event_id is 301114022 (SEA@ARI); correct id 301114030",
}

# 2026 international games + Super Bowl LXI: ESPN marks them neutral, the DB
# says Home. The DB's own venue_id already points at Melbourne / Rio / London /
# Paris / Madrid / Munich / Mexico City; only `location` was not derived.
DB_MISSING_NEUTRAL_2026 = {
    "2026_01_SF_LAR", "2026_03_BAL_DAL", "2026_04_IND_WSH", "2026_05_PHI_JAX",
    "2026_06_HOU_JAX", "2026_07_PIT_NO", "2026_09_CIN_ATL", "2026_10_NE_DET",
    "2026_11_MIN_SF", "2026_POST_SB_401873270",
}

# ESPN retro-renames venues: historical games carry the venue's CURRENT name.
# The DB keeps the era-correct name, which is the better behaviour. Not a defect.
ESPN_RETRO_RENAME = {
    "2010_15_CHI_MIN",   # TCF Bank Stadium    -> Huntington Bank Stadium
    "2010_21_PIT_GB",    # Cowboys Stadium     -> AT&T Stadium
    "2012_21_BAL_SF",    # Mercedes-Benz Superdome -> Caesars Superdome
    "2014_21_NE_SEA",    # University of Phoenix Stadium -> State Farm Stadium
    "2021_01_GB_NO",     # TIAA Bank Stadium   -> EverBank Stadium
    "2023_09_MIA_KC",    # Deutsche Bank Park  -> "Frankfurt Stadium"
    "2023_10_IND_NE",    # Deutsche Bank Park  -> "Frankfurt Stadium"
    "2024_22_KC_PHI",    # Mercedes-Benz Superdome -> Caesars Superdome
}

# 2025 international games where the DB kept the designated home team's stadium
# instead of the venue the game was actually played at.
DB_STALE_INTL_STADIUM_2025 = {
    "2025_01_KC_LAC",    # SoFi Stadium        -> Corinthians Arena, Sao Paulo
    "2025_04_MIN_PIT",   # Acrisure Stadium    -> Croke Park, Dublin
    "2025_05_MIN_CLE",   # FirstEnergy Stadium -> Tottenham Hotspur Stadium, London
    "2025_06_DEN_NYJ",   # MetLife Stadium     -> Tottenham Hotspur Stadium, London
    "2025_07_LA_JAX",    # TIAA Bank Stadium   -> Wembley Stadium, London
    "2025_10_ATL_IND",   # Lucas Oil Stadium   -> Olympiastadion, Berlin
    "2025_11_WAS_MIA",   # Hard Rock Stadium   -> Santiago Bernabeu, Madrid
}

# ESPN event ids present in ESPN's REG/POST universe that the DB legitimately
# does not carry, with the reason.
ACCEPTED_ESPN_ONLY: dict[str, str] = {
    "400554331": "2014 wk12 NYJ@BUF postponed by the Buffalo snowstorm; ESPN keeps "
                 "the abandoned original AND the played game 400607990, which the DB has",
    "400951581": "2017 wk1 TB@MIA postponed by Hurricane Irma; ESPN keeps the "
                 "abandoned original AND the rescheduled wk11 game 400981391, which the DB has",
    "401437947": "2022 wk17 BUF@CIN abandoned after Damar Hamlin's cardiac arrest and "
                 "never resumed; no result exists, so the DB carries 271 REG rows for 2022",
}
DB_DEFECT_ESPN_ONLY: dict[str, str] = {
    "301114030": "the real HOU@JAX 2010 wk10; the DB row 2010_10_HOU_JAX points at "
                 "301114022 (SEA@ARI) instead",
}


# ---------------------------------------------------------------------------
# fetch / cache
# ---------------------------------------------------------------------------
def _get(url: str, path: str, allow_network: bool, sleep: float) -> dict | None:
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as fh:
                return json.load(fh)
        except (json.JSONDecodeError, OSError):
            os.unlink(path)
    if not allow_network:
        return None
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    last = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=45) as resp:
                body = resp.read().decode("utf-8")
            data = json.loads(body)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            tmp = path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                fh.write(body)
            os.replace(tmp, path)
            time.sleep(sleep)
            return data
        except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError, TimeoutError) as exc:
            last = exc
            if isinstance(exc, urllib.error.HTTPError) and exc.code in (400, 404):
                # Genuine "no such slate" — cache the emptiness so we stop asking.
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with open(path, "w", encoding="utf-8") as fh:
                    json.dump({"events": [], "_a1_http_error": exc.code}, fh)
                time.sleep(sleep)
                return {"events": [], "_a1_http_error": exc.code}
            time.sleep(sleep * (2 ** attempt) + 1.0)
    print(f"  !! give up on {url}: {last}", file=sys.stderr)
    return None


def fetch_universe(allow_network: bool, sleep: float) -> tuple[dict, list[str]]:
    """Sweep every (season, seasontype, week) slate. Returns {event_id: record}."""
    events: dict[str, dict] = {}
    problems: list[str] = []
    jobs = [(s, 2, w) for s in SEASONS for w in REG_WEEKS]
    jobs += [(s, 3, w) for s in SEASONS for w in POST_WEEKS]
    for i, (season, stype, week) in enumerate(jobs, 1):
        path = os.path.join(SB_DIR, f"{season}_{stype}_{week}.json")
        url = f"{SCOREBOARD}?dates={season}&seasontype={stype}&week={week}&limit=100"
        cached = os.path.exists(path)
        data = _get(url, path, allow_network, sleep)
        if data is None:
            problems.append(f"slate {season}/{stype}/{week}: not cached and network unavailable")
            continue
        if not cached and allow_network and i % 25 == 0:
            print(f"  ... {i}/{len(jobs)} slates", file=sys.stderr)
        for ev in data.get("events", []):
            rec = parse_event(ev, requested=(season, stype, week))
            if rec is None:
                continue
            prev = events.get(rec["event_id"])
            if prev is None:
                events[rec["event_id"]] = rec
            elif prev["kickoff_utc"] != rec["kickoff_utc"]:
                problems.append(
                    f"ESPN event {rec['event_id']} returned twice with different dates "
                    f"({prev['kickoff_utc']} vs {rec['kickoff_utc']})"
                )
    return events, problems


def parse_event(ev: dict, requested: tuple[int, int, int] | None = None) -> dict | None:
    comps = ev.get("competitions") or []
    if not comps:
        return None
    c = comps[0]
    home = away = None
    for comp in c.get("competitors", []):
        if comp.get("homeAway") == "home":
            home = comp
        elif comp.get("homeAway") == "away":
            away = comp
    season = ev.get("season") or {}
    week = (ev.get("week") or {}).get("number")
    venue = c.get("venue") or {}
    addr = venue.get("address") or {}
    status = ((c.get("status") or {}).get("type") or {})
    notes = [n.get("headline", "") for n in (c.get("notes") or [])]

    def score(comp):
        if comp is None:
            return None
        s = comp.get("score")
        if s is None or s == "":
            return None
        try:
            return int(s)
        except (TypeError, ValueError):
            return None

    def tid(comp):
        if comp is None:
            return None
        t = comp.get("team") or {}
        v = t.get("id") or comp.get("id")
        try:
            return int(v)
        except (TypeError, ValueError):
            return None

    def abbr(comp):
        if comp is None:
            return None
        return ((comp.get("team") or {}).get("abbreviation"))

    return {
        "event_id": str(ev.get("id")),
        "kickoff_utc": ev.get("date"),
        "season": season.get("year"),
        "season_type": season.get("type"),
        "week": week,
        "name": ev.get("shortName"),
        "notes": notes,
        "neutral": bool(c.get("neutralSite")),
        "time_valid": c.get("timeValid"),
        "status": status.get("name"),
        "completed": bool(status.get("completed")),
        "venue_id": venue.get("id"),
        "venue_name": venue.get("fullName"),
        "venue_city": addr.get("city"),
        "venue_country": addr.get("country") or "USA",
        "home_id": tid(home),
        "away_id": tid(away),
        "home_abbr": abbr(home),
        "away_abbr": abbr(away),
        "home_score": score(home),
        "away_score": score(away),
        "requested": requested,
    }


def parse_summary(data: dict, event_id: str) -> dict | None:
    """`summary` has a different shape; normalise it onto parse_event's schema."""
    hdr = data.get("header") or {}
    comps = hdr.get("competitions") or []
    if not comps:
        return None
    ev = {
        "id": hdr.get("id") or event_id,
        "date": comps[0].get("date"),
        "season": hdr.get("season") or {},
        "week": {"number": hdr.get("week")},
        "shortName": None,
        "competitions": comps,
    }
    rec = parse_event(ev)
    if rec is None:
        return None
    gi = data.get("gameInfo") or {}
    venue = gi.get("venue") or {}
    if venue.get("id"):
        rec["venue_id"] = venue.get("id")
        rec["venue_name"] = venue.get("fullName")
        addr = venue.get("address") or {}
        rec["venue_city"] = addr.get("city")
        rec["venue_country"] = addr.get("country") or "USA"
    rec["_from_summary"] = True
    return rec


# ---------------------------------------------------------------------------
# comparison
# ---------------------------------------------------------------------------
def to_epoch(s: str | None) -> int | None:
    if not s:
        return None
    s = s.strip().replace("Z", "+00:00")
    # ESPN emits 2010-09-10T00:30+00:00 (no seconds); the DB emits seconds.
    try:
        return int(dt.datetime.fromisoformat(s).timestamp())
    except ValueError:
        return None


def round_from_notes(notes: list[str]) -> str | None | bool:
    """Returns 'WC'/'DIV'/'CON'/'SB', None for Pro Bowl, or False if unknown."""
    blob = " ".join(notes).lower()
    for needle, rnd in NOTE_TO_ROUND:
        if needle in blob:
            return rnd
    return False


def load_db(db_path: str) -> list[dict]:
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    cur = con.execute(
        """
        SELECT game_id, espn_event_id, data_source, season, season_type, week,
               playoff_round, kickoff_utc, gameday, gametime_et, time_valid,
               result_status, away_franchise_id, home_franchise_id,
               away_abbr, home_abbr, away_score, home_score, result, total,
               location, stadium_id, stadium, venue_id
        FROM game
        ORDER BY kickoff_utc, game_id
        """
    )
    rows = [dict(r) for r in cur.fetchall()]
    con.close()
    return rows


FIELDS = [
    "espn_id_resolves", "season", "season_type", "week_or_round",
    "home_franchise", "away_franchise", "orientation",
    "kickoff_utc", "away_score", "home_score", "score_presence",
    "neutral_site", "venue", "stadium_text", "time_valid", "gameday_pt",
]


def modal_home_venue(espn: dict) -> dict:
    """(season, home_franchise_id) -> the venue id that franchise used most that
    season, per ESPN. Any ESPN game away from that venue is a relocation or a
    neutral site, which is an independent handle on the `location` column."""
    tally: dict[tuple, collections.Counter] = collections.defaultdict(collections.Counter)
    for rec in espn.values():
        if rec["season_type"] != 2 or rec["home_id"] is None or not rec["venue_id"]:
            continue
        tally[(rec["season"], rec["home_id"])][str(rec["venue_id"])] += 1
    return {k: c.most_common(1)[0][0] for k, c in tally.items()}


def compare(rows: list[dict], espn: dict, allow_network: bool, sleep: float) -> dict:
    agree = collections.Counter()
    checked = collections.Counter()
    mismatches: list[dict] = []
    kickoff_deltas = collections.Counter()
    kickoff_detail: list[dict] = []
    venue_missing = 0
    unresolved: list[dict] = []
    venue_table: list[dict] = []
    modal = modal_home_venue(espn)

    for row in rows:
        eid = str(row["espn_event_id"])
        rec = espn.get(eid)
        origin = "sweep"
        if rec is None:
            path = os.path.join(SUM_DIR, f"{eid}.json")
            data = _get(f"{SUMMARY}?event={eid}", path, allow_network, sleep)
            if data:
                rec = parse_summary(data, eid)
                origin = "summary"

        checked["espn_id_resolves"] += 1
        if rec is None:
            unresolved.append({"game_id": row["game_id"], "espn_event_id": eid})
            mismatches.append({
                "field": "espn_id_resolves", "game_id": row["game_id"], "espn_event_id": eid,
                "db": eid, "espn": "NOT FOUND",
                "detail": "espn_event_id does not resolve to any ESPN event",
            })
            continue
        agree["espn_id_resolves"] += 1

        def note(field, dbv, esv, detail=""):
            checked[field] += 1
            if dbv == esv:
                agree[field] += 1
                return True
            mismatches.append({
                "field": field, "game_id": row["game_id"], "espn_event_id": eid,
                "db": dbv, "espn": esv, "detail": detail, "origin": origin,
            })
            return False

        # --- season -------------------------------------------------------
        note("season", row["season"], rec["season"])

        # --- season type --------------------------------------------------
        espn_type = {2: "REG", 3: "POST", 1: "PRE"}.get(rec["season_type"])
        note("season_type", row["season_type"], espn_type)

        # --- week / playoff round ----------------------------------------
        checked["week_or_round"] += 1
        if row["season_type"] == "REG":
            ok = row["week"] == rec["week"]
            dbv, esv = row["week"], rec["week"]
        else:
            by_note = round_from_notes(rec["notes"])
            by_week = POST_WEEK_TO_ROUND.get(rec["week"], False)
            espn_round = by_note if by_note is not False else by_week
            ok = row["playoff_round"] == espn_round
            dbv, esv = row["playoff_round"], espn_round
        if ok:
            agree["week_or_round"] += 1
        else:
            mismatches.append({
                "field": "week_or_round", "game_id": row["game_id"], "espn_event_id": eid,
                "db": dbv, "espn": esv,
                "detail": f"espn seasontype={rec['season_type']} week={rec['week']} notes={rec['notes']}",
                "origin": origin,
            })

        # --- franchises + orientation ------------------------------------
        db_home, db_away = row["home_franchise_id"], row["away_franchise_id"]
        es_home, es_away = rec["home_id"], rec["away_id"]
        if row["result_status"] == "tbd" and db_home is None and db_away is None:
            # 2026 postseason placeholders: ESPN also carries TBD teams.
            for f in ("home_franchise", "away_franchise", "orientation"):
                checked[f] += 1
                agree[f] += 1
        else:
            note("home_franchise", db_home, es_home)
            note("away_franchise", db_away, es_away)
            checked["orientation"] += 1
            if db_home == es_home and db_away == es_away:
                agree["orientation"] += 1
            elif db_home == es_away and db_away == es_home:
                mismatches.append({
                    "field": "orientation", "game_id": row["game_id"], "espn_event_id": eid,
                    "db": f"home={db_home} away={db_away}", "espn": f"home={es_home} away={es_away}",
                    "detail": "HOME/AWAY FLIPPED relative to ESPN", "origin": origin,
                })
            else:
                # not a flip; the franchise mismatches above already carry it
                agree["orientation"] += 1

        # --- kickoff instant ---------------------------------------------
        checked["kickoff_utc"] += 1
        d_ep, e_ep = to_epoch(row["kickoff_utc"]), to_epoch(rec["kickoff_utc"])
        if d_ep is None or e_ep is None:
            kickoff_deltas["unparseable"] += 1
            mismatches.append({
                "field": "kickoff_utc", "game_id": row["game_id"], "espn_event_id": eid,
                "db": row["kickoff_utc"], "espn": rec["kickoff_utc"],
                "detail": "unparseable timestamp", "origin": origin,
            })
        else:
            delta = e_ep - d_ep
            if delta == 0:
                agree["kickoff_utc"] += 1
                kickoff_deltas["exact"] += 1
            else:
                kickoff_deltas[bucket_delta(delta)] += 1
                kickoff_detail.append({
                    "game_id": row["game_id"], "espn_event_id": eid, "delta_s": delta,
                    "db": row["kickoff_utc"], "espn": rec["kickoff_utc"],
                    "season": row["season"], "season_type": row["season_type"],
                    "time_valid": row["time_valid"], "espn_time_valid": rec["time_valid"],
                    "status": rec["status"],
                })
                mismatches.append({
                    "field": "kickoff_utc", "game_id": row["game_id"], "espn_event_id": eid,
                    "db": row["kickoff_utc"], "espn": rec["kickoff_utc"],
                    "detail": f"delta {delta}s ({bucket_delta(delta)})", "origin": origin,
                })

        # --- scores -------------------------------------------------------
        checked["score_presence"] += 1
        db_played = row["result_status"] == "final"
        espn_played = rec["status"] == "STATUS_FINAL"
        db_has = row["home_score"] is not None and row["away_score"] is not None
        espn_has = rec["home_score"] is not None and rec["away_score"] is not None
        if db_played == espn_played and db_has == db_played:
            agree["score_presence"] += 1
        else:
            mismatches.append({
                "field": "score_presence", "game_id": row["game_id"], "espn_event_id": eid,
                "db": f"status={row['result_status']} scores={row['away_score']}-{row['home_score']}",
                "espn": f"status={rec['status']} scores={rec['away_score']}-{rec['home_score']}",
                "detail": "played/unplayed disagreement or score presence anomaly",
                "origin": origin,
            })
        if db_has and espn_has:
            note("away_score", row["away_score"], rec["away_score"])
            note("home_score", row["home_score"], rec["home_score"])
        elif not db_has and not espn_has:
            for f in ("away_score", "home_score"):
                checked[f] += 1
                agree[f] += 1

        # --- neutral site --------------------------------------------------
        db_neutral = (row["location"] == "Neutral")
        note("neutral_site", db_neutral, rec["neutral"])

        # ESPN's own venue data is a second, independent handle on neutrality:
        # a home game played anywhere but the franchise's modal venue is either
        # a relocation or a neutral site.
        # The modal map is built from regular-season home games, but it is a
        # valid reference for postseason games too — that is how a Super Bowl at
        # a third party's stadium gets caught.
        off_home = False
        if rec["venue_id"] and es_home is not None:
            usual = modal.get((rec["season"], es_home))
            off_home = bool(usual and str(rec["venue_id"]) != usual)
        international = (rec["venue_country"] or "USA") != "USA"
        if db_neutral or rec["neutral"] or off_home or international:
            venue_table.append({
                "game_id": row["game_id"], "espn_event_id": eid,
                "season": row["season"], "season_type": row["season_type"],
                "week": row["week"], "playoff_round": row["playoff_round"],
                "matchup": f"{row['away_abbr']}@{row['home_abbr']}",
                "db_location": row["location"], "db_stadium": row["stadium"],
                "db_stadium_id": row["stadium_id"], "db_venue_id": row["venue_id"],
                "espn_neutral": rec["neutral"], "espn_venue_id": rec["venue_id"],
                "espn_venue": rec["venue_name"], "espn_city": rec["venue_city"],
                "espn_country": rec["venue_country"],
                "espn_off_modal_home_venue": off_home,
            })

        # --- stadium text, but only where it is decidable --------------------
        # ESPN applies a venue's CURRENT name to historical games, so a global
        # name comparison is pure noise. It is decidable exactly when ESPN puts
        # the game somewhere other than the home franchise's usual stadium:
        # then the DB either names that other place or it does not.
        if off_home and row["stadium"]:
            checked["stadium_text"] += 1
            if venue_names_agree(row["stadium"], rec["venue_name"]):
                agree["stadium_text"] += 1
            else:
                mismatches.append({
                    "field": "stadium_text", "game_id": row["game_id"], "espn_event_id": eid,
                    "db": f"{row['stadium']} [{row['stadium_id']}]",
                    "espn": f"{rec['venue_name']} ({rec['venue_city']}, {rec['venue_country']})",
                    "detail": "ESPN places this game away from the home franchise's "
                              "modal venue and the DB names a different stadium",
                    "origin": origin,
                })

        # --- venue ----------------------------------------------------------
        checked["venue"] += 1
        if row["venue_id"] is None:
            venue_missing += 1
            agree["venue"] += 1   # structurally absent, counted separately
        else:
            try:
                same = int(row["venue_id"]) == int(rec["venue_id"])
            except (TypeError, ValueError):
                same = False
            if same:
                agree["venue"] += 1
            else:
                mismatches.append({
                    "field": "venue", "game_id": row["game_id"], "espn_event_id": eid,
                    "db": row["venue_id"], "espn": f"{rec['venue_id']} ({rec['venue_name']})",
                    "detail": "ESPN venue id disagreement", "origin": origin,
                })

        # --- time_valid ------------------------------------------------------
        if rec["time_valid"] is None:
            checked["time_valid"] += 1
            agree["time_valid"] += 1
        else:
            note("time_valid", bool(row["time_valid"]), bool(rec["time_valid"]),
                 "DB time_valid vs ESPN competitions[0].timeValid")

        # --- gameday must be the Pacific calendar date of the kickoff --------
        # (CONTEXT.md: kickoff_utc is canonical, the date column is derived in PT)
        checked["gameday_pt"] += 1
        if not row["gameday"]:
            agree["gameday_pt"] += 1          # absent, not wrong
        else:
            e_ep = to_epoch(rec["kickoff_utc"])
            pt = pacific_date(e_ep) if e_ep is not None else None
            if pt is None or row["gameday"] == pt:
                agree["gameday_pt"] += 1
            else:
                mismatches.append({
                    "field": "gameday_pt", "game_id": row["game_id"], "espn_event_id": eid,
                    "db": row["gameday"], "espn": pt,
                    "detail": f"Pacific date of ESPN kickoff {rec['kickoff_utc']}",
                    "origin": origin,
                })

    return {
        "agree": agree, "checked": checked, "mismatches": mismatches,
        "kickoff_deltas": kickoff_deltas, "kickoff_detail": kickoff_detail,
        "venue_missing": venue_missing, "unresolved": unresolved,
        "venue_table": venue_table,
    }


def venue_names_agree(db_name: str, espn_name: str | None) -> bool:
    def n(s):
        if not s:
            return ""
        s = s.lower()
        for w in ("stadium", "field", "arena", "park", "centre", "center",
                  "dome", "superdome", "coliseum", "the ", "at "):
            s = s.replace(w, " ")
        return "".join(ch for ch in s if ch.isalnum())
    a, b = n(db_name), n(espn_name)
    return bool(a and b and (a == b or a in b or b in a))


def pacific_date(epoch: int) -> str:
    """US Pacific calendar date for a UTC instant. US DST rules since 2007:
    second Sunday in March 02:00 local -> first Sunday in November 02:00 local."""
    u = dt.datetime.fromtimestamp(epoch, dt.timezone.utc)
    y = u.year
    mar = dt.datetime(y, 3, 8, tzinfo=dt.timezone.utc)
    while mar.weekday() != 6:
        mar += dt.timedelta(days=1)
    dst_start = mar + dt.timedelta(hours=10)          # 02:00 PST = 10:00 UTC
    nov = dt.datetime(y, 11, 1, tzinfo=dt.timezone.utc)
    while nov.weekday() != 6:
        nov += dt.timedelta(days=1)
    dst_end = nov + dt.timedelta(hours=9)             # 02:00 PDT = 09:00 UTC
    offset = -7 if dst_start <= u < dst_end else -8
    return (u + dt.timedelta(hours=offset)).date().isoformat()


def bucket_delta(d: int) -> str:
    a = abs(d)
    if a % 3600 == 0:
        return f"exact_{d // 3600:+d}h"
    if a <= 60:
        return "<=60s"
    if a <= 300:
        return "<=5min"
    if a <= 3600:
        return "<=1h_nonround"
    return "other"


def espn_only(espn: dict, rows: list[dict]) -> list[dict]:
    have = {str(r["espn_event_id"]) for r in rows}
    out = []
    for eid, rec in espn.items():
        if eid in have:
            continue
        if rec["season_type"] == 3 and POST_WEEK_TO_ROUND.get(rec["week"]) is None:
            continue  # Pro Bowl — not a real game
        out.append(rec)
    out.sort(key=lambda r: (r["season"] or 0, r["kickoff_utc"] or ""))
    return out


def classify(m: dict) -> str:
    """RULE (systematic, explained), DEFECT (DB is wrong, third-source confirmed),
    or UNEXPLAINED. Sets m['_rule'] to the human-readable reason."""
    f, gid = m["field"], m["game_id"]
    key = f"{f}|{gid}"

    if key in DB_DEFECTS:
        m["_rule"] = DB_DEFECTS[key]
        return "DEFECT"

    if f == "neutral_site":
        if gid in ESPN_NEUTRAL_FLAG_GAP and m["db"] is True and m["espn"] is False:
            m["_rule"] = ("R1 ESPN neutralSite is unpopulated pre-2014 and for "
                          "pandemic/disaster relocations; the DB is correct")
            return "RULE"
        if gid in DB_MISSING_NEUTRAL_2026 and m["db"] is False and m["espn"] is True:
            m["_rule"] = ("D2 2026 international game / Super Bowl left as "
                          "location='Home'; ESPN and the DB's own venue_id say neutral")
            return "DEFECT"

    if f == "gameday_pt" and gid.startswith("2026_"):
        m["_rule"] = ("D3 the 2026 ESPN loader wrote the UTC calendar date into "
                      "`gameday` instead of the Pacific date")
        return "DEFECT"

    if f == "kickoff_utc":
        try:
            delta = abs(to_epoch(m["espn"]) - to_epoch(m["db"]))
        except (TypeError, ValueError):
            delta = None
        if delta is not None and delta <= KICKOFF_SCHEDULED_VS_ACTUAL_MAX_S:
            m["_rule"] = ("R2 nflverse stores the scheduled slot, ESPN the observed "
                          "kickoff; differences are under 90 min and never move the "
                          "game's date, week, matchup or result")
            return "RULE"

    if f == "stadium_text":
        if gid in ESPN_RETRO_RENAME:
            m["_rule"] = ("R3 ESPN applies a venue's current name to historical "
                          "games; the DB keeps the era-correct name")
            return "RULE"
        if gid in DB_STALE_INTL_STADIUM_2025:
            m["_rule"] = ("D4 2025 international game: stadium / stadium_id / roof / "
                          "surface are the designated home team's, not the actual venue")
            return "DEFECT"

    m["_rule"] = "UNEXPLAINED"
    return "UNEXPLAINED"


# ---------------------------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=DB_PATH)
    ap.add_argument("--sleep", type=float, default=1.0)
    ap.add_argument("--no-network", action="store_true")
    ap.add_argument("--json", default=os.path.join(OUT_DIR, "a1_result.json"))
    args = ap.parse_args()

    for d in (SB_DIR, SUM_DIR, OUT_DIR):
        os.makedirs(d, exist_ok=True)

    allow_network = not args.no_network

    print("== sweeping ESPN scoreboard universe (cache-first) ==", file=sys.stderr)
    espn, sweep_problems = fetch_universe(allow_network, args.sleep)
    print(f"   ESPN events indexed: {len(espn)}", file=sys.stderr)

    rows = load_db(args.db)
    print(f"   DB game rows: {len(rows)}", file=sys.stderr)

    res = compare(rows, espn, allow_network, args.sleep)
    extra = espn_only(espn, rows)

    # ---------------- report ----------------
    print()
    print("=" * 78)
    print("A1 — game table vs ESPN")
    print("=" * 78)
    print(f"DB rows: {len(rows)}   ESPN events in REG/POST universe: {len(espn)}")
    print()
    print(f"{'field':<20}{'checked':>9}{'agree':>9}{'mismatch':>10}")
    print("-" * 48)
    for f in FIELDS:
        c, a = res["checked"][f], res["agree"][f]
        print(f"{f:<20}{c:>9}{a:>9}{c - a:>10}")
    print()
    print(f"venue: {res['venue_missing']} rows have venue_id NULL in the DB "
          f"(structurally absent, not a mismatch)")
    print()
    print("kickoff delta buckets (espn - db):")
    for k, v in sorted(res["kickoff_deltas"].items(), key=lambda kv: -kv[1]):
        print(f"   {k:<20}{v:>7}")
    print()

    by_field = collections.Counter(m["field"] for m in res["mismatches"])
    print(f"total mismatch records: {len(res['mismatches'])}")
    for f, n in by_field.most_common():
        print(f"   {f:<20}{n:>7}")
    print()

    adjudicated, defects, unexplained = [], [], []
    for m in res["mismatches"]:
        cls = classify(m)
        (adjudicated if cls == "RULE" else defects if cls == "DEFECT"
         else unexplained).append(m)

    rule_counts = collections.Counter(m["_rule"] for m in adjudicated)
    print("--- systematic differences (rules, not per-row defects) ---")
    for r, n in rule_counts.most_common():
        print(f"  {n:>5}  {r}")
    print()

    print(f"--- confirmed DB defects: {len(defects)} ---")
    for m in sorted(defects, key=lambda x: (x["field"], x["game_id"])):
        print(f"  [{m['field']}] {m['game_id']} espn={m['espn_event_id']}  "
              f"db={m['db']!r} espn={m['espn']!r}  -- {m['_rule']}")
    print()

    if unexplained:
        print(f"--- UNEXPLAINED (not in any rule or ledger): {len(unexplained)} ---")
        for m in unexplained[:200]:
            print(f"  [{m['field']}] {m['game_id']} espn={m['espn_event_id']}  "
                  f"db={m['db']!r} espn={m['espn']!r}  {m.get('detail','')}")
        if len(unexplained) > 200:
            print(f"  ... and {len(unexplained) - 200} more (see --json)")
        print()

    extra_hard = [e for e in extra if e["event_id"] not in ACCEPTED_ESPN_ONLY
                  and e["event_id"] not in DB_DEFECT_ESPN_ONLY]
    print(f"--- ESPN events absent from the DB: {len(extra)} ---")
    for e in extra:
        eid = e["event_id"]
        tag = ("OK " if eid in ACCEPTED_ESPN_ONLY else
               "DEF" if eid in DB_DEFECT_ESPN_ONLY else "!! ")
        why = ACCEPTED_ESPN_ONLY.get(eid) or DB_DEFECT_ESPN_ONLY.get(eid) or "UNEXPLAINED"
        print(f"  {tag} {eid} {e['season']}/t{e['season_type']}/w{e['week']} "
              f"{e['kickoff_utc']} {e['name']} status={e['status']}")
        print(f"       {why}")
    print()

    if sweep_problems:
        print("--- sweep problems ---")
        for p in sweep_problems[:50]:
            print("  " + p)
        print()

    payload = {
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(),
        "db_rows": len(rows),
        "espn_events": len(espn),
        "checked": dict(res["checked"]),
        "agree": dict(res["agree"]),
        "kickoff_deltas": dict(res["kickoff_deltas"]),
        "kickoff_detail": res["kickoff_detail"],
        "venue_id_null_rows": res["venue_missing"],
        "venue_table": res["venue_table"],
        "mismatches": res["mismatches"],
        "adjudicated_rules": dict(rule_counts),
        "db_defects": defects,
        "unexplained": unexplained,
        "espn_only": extra,
        "unresolved": res["unresolved"],
        "sweep_problems": sweep_problems,
    }
    os.makedirs(os.path.dirname(args.json), exist_ok=True)
    with open(args.json, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=1, default=str)
    print(f"json -> {args.json}")

    fail = bool(unexplained) or bool(defects) or bool(extra_hard) or bool(sweep_problems)
    print()
    if unexplained or extra_hard or sweep_problems:
        print("VERDICT: FAIL — unexplained differences remain")
    elif defects:
        print(f"VERDICT: FAIL — {len(defects)} confirmed DB defects, all itemised "
              f"and third-source adjudicated; no unexplained differences")
    else:
        print("VERDICT: PASS")
    return 1 if fail else 0


if __name__ == "__main__":
    sys.exit(main())
