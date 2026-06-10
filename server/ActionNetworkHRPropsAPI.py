"""
ActionNetworkHRPropsAPI.py
==========================
Scrapes MLB HR props from Action Network's Consensus column (book_id=15),
matches each player to their game via event_id, and cross-references against
Rotowire confirmed lineups stored in the mlb_lineups DB table.

OUTPUT CONTRACT (per player record):
  {
    "gameId":          int,          # our DB games.id
    "anEventId":       int,          # Action Network event_id
    "gameDate":        str,          # YYYY-MM-DD
    "awayTeam":        str,          # e.g. "CHC"
    "homeTeam":        str,          # e.g. "CLE"
    "playerName":      str,          # full name from AN
    "playerTeam":      str,          # team abbr from AN
    "position":        str,          # primary position
    "battingOrder":    int | None,   # 1-9 if in confirmed lineup, None otherwise
    "lineupConfirmed": bool,         # True if player is in Rotowire confirmed lineup
    "overLine":        float,        # always 0.5 for HR props
    "overOdds":        int | None,   # American odds (e.g. +395)
    "underOdds":       int | None,   # American odds (e.g. -550)
    "impliedOverProb": float | None, # no-vig implied probability for over
    "anPlayerId":      int,          # Action Network player_id
  }

EXECUTION FLOW:
  1. [INPUT]  Fetch AN API for date → markets + players + games
  2. [STEP]   Build player_id → player info map
  3. [STEP]   Build event_id → game info map (AN event_id → our DB game)
  4. [STEP]   Group consensus HR markets by player_id (over + under)
  5. [STEP]   Load Rotowire lineups from DB for all games on date
  6. [STEP]   Cross-reference each player against confirmed lineup
  7. [OUTPUT] Return structured list of HR prop records
  8. [VERIFY] Log counts: total players, lineup-confirmed, lineup-unconfirmed
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from datetime import datetime

import requests

# ── Logging ───────────────────────────────────────────────────────────────────


def log(msg: str) -> None:
    ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    print(
        f"[ANHRPropsAPI] [{ts}] {msg}", file=sys.stderr, flush=True
    )  # stderr: logs only, stdout reserved for JSON output


def log_err(msg: str) -> None:
    ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    print(f"[ANHRPropsAPI] [ERROR] [{ts}] {msg}", file=sys.stderr, flush=True)


# ── Constants ─────────────────────────────────────────────────────────────────

AN_API_BASE = "https://api.actionnetwork.com/web/v2/scoreboard/mlb/markets"
CONSENSUS_BOOK_ID = "15"
HR_PROP_TYPE = "core_bet_type_33_hr"

HEADERS = {
    "Accept": "application/json",
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0.0.0 Safari/537.36"
    ),
    "Referer": "https://www.actionnetwork.com/mlb/props/home-runs",
    "Origin": "https://www.actionnetwork.com",
}

# Action Network team_id → our abbreviation (all 30 MLB teams)
AN_TEAM_ID_TO_ABBR: dict[int, str] = {
    187: "BAL",
    188: "TOR",
    189: "TB",
    190: "BOS",
    191: "NYY",
    192: "KC",
    193: "CLE",
    194: "CWS",
    195: "DET",
    196: "MIN",
    197: "SEA",
    198: "LAA",
    199: "HOU",
    200: "TEX",
    201: "ATH",
    202: "CIN",
    203: "PIT",
    204: "LAD",
    205: "ARI",
    206: "CHC",
    207: "STL",
    208: "MIL",
    209: "SF",
    210: "COL",
    211: "SD",
    212: "PHI",
    213: "NYM",
    214: "MIA",
    215: "ATL",
    216: "WSH",
}

# ── Probability helpers ───────────────────────────────────────────────────────


def american_to_prob(odds: int) -> float:
    """Convert American odds to implied probability (with vig)."""
    if odds > 0:
        return 100.0 / (odds + 100)
    return abs(odds) / (abs(odds) + 100)


def no_vig_prob(over_odds: int | None, under_odds: int | None) -> float | None:
    """
    Compute no-vig implied probability for the over side.
    Uses the standard two-sided no-vig formula:
      p_over_novig = p_over_raw / (p_over_raw + p_under_raw)
    Returns None if either side is missing.
    """
    if over_odds is None or under_odds is None:
        return None
    p_over = american_to_prob(over_odds)
    p_under = american_to_prob(under_odds)
    total = p_over + p_under
    if total <= 0:
        return None
    return round(p_over / total, 6)


# ── Fetch ─────────────────────────────────────────────────────────────────────


def fetch_hr_props_raw(date_str: str) -> dict:
    """
    Fetch raw AN HR props JSON for a given date.
    Args:
        date_str: YYYYMMDD format (e.g. "20260405")
    Returns:
        Parsed JSON dict with keys: games, markets, players, market_rules
    """
    url = f"{AN_API_BASE}?customPickTypes={HR_PROP_TYPE}&date={date_str}"
    log(f"[INPUT] GET {url}")
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.raise_for_status()
        data = resp.json()
        log(f"[INPUT] HTTP {resp.status_code} — {len(resp.content)} bytes")
        log(
            f"[INPUT] games={len(data.get('games', []))} players={len(data.get('players', []))} markets_books={list(data.get('markets', {}).keys())}"
        )
        return data
    except requests.RequestException as e:
        log_err(f"HTTP error fetching HR props: {e}")
        raise
    except json.JSONDecodeError as e:
        log_err(f"JSON parse error: {e}")
        raise


# ── Core parsing ──────────────────────────────────────────────────────────────


def parse_hr_props(
    raw: dict,
    db_game_map: dict[str, int],  # "AWAY@HOME|YYYY-MM-DD" → db_game_id
    lineup_map: dict[
        int, dict
    ],  # db_game_id → {awayLineup: [...], homeLineup: [...], awayLineupConfirmed, homeLineupConfirmed}
    date_str: str = "",  # YYYYMMDD — used as fallback for UTC date-shifted West Coast games
) -> list[dict]:
    """
    Parse raw AN HR props response into structured records.

    Args:
        raw:          Raw JSON from fetch_hr_props_raw()
        db_game_map:  Maps "AWAY@HOME|YYYY-MM-DD" → our DB games.id
        lineup_map:   Maps db_game_id → Rotowire lineup data

    Returns:
        List of HR prop dicts (see module docstring for schema)
    """
    log("[STEP] Building player lookup map")
    players_raw = raw.get("players", [])
    players: dict[int, dict] = {p["id"]: p for p in players_raw}
    log(f"[STATE] {len(players)} players in AN response")

    log("[STEP] Building game lookup map (AN event_id → matchup)")
    games_raw = raw.get("games", [])
    # an_event_id → {"awayAbbr": str, "homeAbbr": str, "startTime": str}
    an_games: dict[int, dict] = {}
    for g in games_raw:
        event_id = g["id"]
        away_abbr = g.get("away_team", {}).get("abbr", "?")
        home_abbr = g.get("home_team", {}).get("abbr", "?")
        start_time = g.get("start_time", "")
        # Extract date from start_time (ISO format)
        game_date = start_time[:10] if start_time else ""
        an_games[event_id] = {
            "awayAbbr": away_abbr,
            "homeAbbr": home_abbr,
            "gameDate": game_date,
            "startTime": start_time,
        }
    log(f"[STATE] {len(an_games)} AN games mapped")

    log("[STEP] Extracting consensus HR markets (book_id=15)")
    consensus = raw.get("markets", {}).get(CONSENSUS_BOOK_ID, {})
    event_data = consensus.get("event", {})
    hr_list: list[dict] = event_data.get(HR_PROP_TYPE, [])
    log(f"[STATE] {len(hr_list)} consensus HR market entries (over + under combined)")

    log("[STEP] Grouping by player_id → {over, under}")
    # player_props[player_id] = {"over": {...}, "under": {...}}
    player_props: dict[int, dict] = defaultdict(dict)
    for m in hr_list:
        pid = m["player_id"]
        side = m["side"]  # "over" or "under"
        player_props[pid][side] = {
            "odds": m["odds"],
            "value": m["value"],
            "event_id": m["event_id"],
        }
    log(f"[STATE] {len(player_props)} unique players with HR props")

    log("[STEP] Building Rotowire lineup name sets for cross-reference")
    # lineup_name_sets[db_game_id] = {
    #   "away": {normalized_name: batting_order},
    #   "home": {normalized_name: batting_order},
    #   "awayConfirmed": bool,
    #   "homeConfirmed": bool,
    # }
    lineup_name_sets: dict[int, dict] = {}
    for db_game_id, lineup in lineup_map.items():
        away_names: dict[str, int] = {}
        home_names: dict[str, int] = {}
        for player in lineup.get("awayLineup") or []:
            norm = _normalize_name(player.get("name", ""))
            away_names[norm] = player.get("battingOrder", 0)
        for player in lineup.get("homeLineup") or []:
            norm = _normalize_name(player.get("name", ""))
            home_names[norm] = player.get("battingOrder", 0)
        lineup_name_sets[db_game_id] = {
            "away": away_names,
            "home": home_names,
            "awayConfirmed": lineup.get("awayLineupConfirmed", False),
            "homeConfirmed": lineup.get("homeLineupConfirmed", False),
        }

    log("[STEP] Building output records")
    results: list[dict] = []
    skipped_no_game = 0
    skipped_no_player = 0
    lineup_confirmed_count = 0
    lineup_unconfirmed_count = 0

    for pid, sides in player_props.items():
        player_info = players.get(pid)
        if not player_info:
            log_err(f"  [SKIP] player_id={pid} not in players dict")
            skipped_no_player += 1
            continue

        # Determine event_id from whichever side is available
        event_id = (sides.get("over") or sides.get("under", {})).get("event_id")
        if not event_id:
            log_err(
                f"  [SKIP] player_id={pid} ({player_info.get('full_name')}) — no event_id"
            )
            skipped_no_game += 1
            continue

        an_game = an_games.get(event_id)
        if not an_game:
            log_err(f"  [SKIP] event_id={event_id} not in an_games")
            skipped_no_game += 1
            continue

        away_abbr = an_game["awayAbbr"]
        home_abbr = an_game["homeAbbr"]
        game_date = an_game["gameDate"]

        # Look up our DB game_id
        lookup_key = f"{away_abbr}@{home_abbr}|{game_date}"
        db_game_id = db_game_map.get(lookup_key)
        if db_game_id is None and date_str:
            # Fallback: West Coast late games have UTC start_time on next day
            # Try the passed date_str (YYYYMMDD → YYYY-MM-DD)
            fallback_date = f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:8]}"
            fallback_key = f"{away_abbr}@{home_abbr}|{fallback_date}"
            db_game_id = db_game_map.get(fallback_key)
            if db_game_id is not None:
                game_date = fallback_date  # Update game_date for record output
                lookup_key = fallback_key
        if db_game_id is None:
            log_err(f"  [WARN] No DB game found for key={lookup_key}")
            skipped_no_game += 1
            continue

        # Get player team abbreviation
        team_id = player_info.get("team_id")
        player_team = AN_TEAM_ID_TO_ABBR.get(team_id, "?")

        # Determine if player is on away or home side
        is_away = player_team == away_abbr
        is_home = player_team == home_abbr

        # Cross-reference against Rotowire lineup
        lineup_data = lineup_name_sets.get(db_game_id, {})
        player_norm = _normalize_name(player_info.get("full_name", ""))
        batting_order: int | None = None
        lineup_confirmed = False

        if is_away and lineup_data.get("away"):
            batting_order = lineup_data["away"].get(player_norm)
            if batting_order is not None:
                lineup_confirmed = lineup_data.get("awayConfirmed", False)
        elif is_home and lineup_data.get("home"):
            batting_order = lineup_data["home"].get(player_norm)
            if batting_order is not None:
                lineup_confirmed = lineup_data.get("homeConfirmed", False)

        if lineup_confirmed:
            lineup_confirmed_count += 1
        else:
            lineup_unconfirmed_count += 1

        # Extract odds
        over_side = sides.get("over", {})
        under_side = sides.get("under", {})
        over_odds: int | None = over_side.get("odds") if over_side else None
        under_odds: int | None = under_side.get("odds") if under_side else None
        over_line: float = over_side.get("value", 0.5) if over_side else 0.5

        # Compute no-vig implied probability
        implied_prob = no_vig_prob(over_odds, under_odds)

        record = {
            "gameId": db_game_id,
            "anEventId": event_id,
            "gameDate": game_date,
            "awayTeam": away_abbr,
            "homeTeam": home_abbr,
            "playerName": player_info.get("full_name", ""),
            "playerTeam": player_team,
            "position": player_info.get(
                "primary_position", player_info.get("position", "")
            ),
            "battingOrder": batting_order,
            "lineupConfirmed": lineup_confirmed,
            "overLine": over_line,
            "overOdds": over_odds,
            "underOdds": under_odds,
            "impliedOverProb": implied_prob,
            "anPlayerId": pid,
        }
        results.append(record)

    log(f"[OUTPUT] {len(results)} HR prop records built")
    log(
        f"[VERIFY] lineup_confirmed={lineup_confirmed_count} | lineup_unconfirmed={lineup_unconfirmed_count}"
    )
    log(
        f"[VERIFY] skipped_no_game={skipped_no_game} | skipped_no_player={skipped_no_player}"
    )

    # Sort: confirmed lineup players first, then by team, then by batting order
    results.sort(
        key=lambda r: (
            not r["lineupConfirmed"],
            r["awayTeam"],
            r["homeTeam"],
            r["battingOrder"] or 99,
            r["playerName"],
        )
    )

    return results


# ── Name normalization ────────────────────────────────────────────────────────


def _normalize_name(name: str) -> str:
    """
    Normalize a player name for fuzzy matching:
    - Lowercase
    - Remove punctuation (periods, apostrophes, hyphens)
    - Collapse whitespace
    """
    import re

    name = name.lower()
    name = re.sub(r"[.\'\-]", "", name)
    name = re.sub(r"\s+", " ", name).strip()
    return name


# ── Main entry point ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    """
    CLI mode: TypeScript passes input via stdin as JSON:
    {
      "dateStr":    "20260405",
      "dbGameMap":  {"CHC@CLE|2026-04-05": 2250125, ...},
      "lineupMap":  {2250125: {"awayLineup": [...], "homeLineup": [...], ...}, ...}
    }

    Outputs to stdout as JSON array of HR prop records.
    """
    log("=== ActionNetworkHRPropsAPI CLI MODE ===")

    try:
        stdin_data = json.loads(sys.stdin.read())
    except json.JSONDecodeError as e:
        log_err(f"Failed to parse stdin JSON: {e}")
        sys.exit(1)

    date_str: str = stdin_data.get("dateStr", "")
    db_game_map: dict[str, int] = stdin_data.get("dbGameMap", {})
    lineup_map_raw: dict = stdin_data.get("lineupMap", {})

    # Convert string keys back to int keys for lineup_map
    lineup_map: dict[int, dict] = {int(k): v for k, v in lineup_map_raw.items()}

    log(
        f"[INPUT] dateStr={date_str} | dbGameMap entries={len(db_game_map)} | lineupMap entries={len(lineup_map)}"
    )

    if not date_str:
        log_err("dateStr is required")
        sys.exit(1)

    # Fetch raw data
    raw = fetch_hr_props_raw(date_str)

    # Parse with DB context
    results = parse_hr_props(raw, db_game_map, lineup_map, date_str)

    # Output to stdout
    output = json.dumps(results, ensure_ascii=False)
    log(f"[OUTPUT] Writing {len(results)} records to stdout ({len(output)} bytes)")
    print(output, flush=True)

    log("[VERIFY] PASS — HR props pipeline complete")
