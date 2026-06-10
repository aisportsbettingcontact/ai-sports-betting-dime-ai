#!/usr/bin/env python3.11
"""
probeAnApiHistorical.py
=======================
Deep-dive probe of the Action Network API for historical dates.
Tests multiple endpoints, parameters, and book IDs to find F5 ML odds
for the 9 missing games (2026-03-31: 8 games, 2026-04-03: 1 game).

Strategy:
1. Test the standard scoreboard endpoint with the target date
2. Inspect the full response structure — what's in markets vs. not
3. Try alternate book IDs (FD NJ=69, DK=15, BetMGM=30, Caesars=68)
4. Try the v1 scoreboard endpoint
5. Try the game-level odds endpoint with specific event IDs
6. Try the consensus endpoint
7. Inspect the 'opener' / 'open' odds fields

Usage:
  python3.11 scripts/probeAnApiHistorical.py
"""

import json
import logging
import sys

import requests

logging.basicConfig(level=logging.INFO, format="%(message)s", stream=sys.stderr)
log = logging.getLogger("AN_PROBE")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://www.actionnetwork.com/mlb/odds",
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "Origin": "https://www.actionnetwork.com",
}

TARGET_DATES = ["20260331", "20260403"]
BOOK_IDS_TO_TEST = [
    "69",
    "15",
    "30",
    "68",
    "2787",
    "356",
    "357",
    "1863",
    "2161",
    "79",
    "2988",
    "358",
]
BOOK_NAMES = {
    "69": "FanDuel NJ",
    "15": "DraftKings",
    "30": "BetMGM",
    "68": "Caesars",
    "2787": "BetRivers",
    "356": "PointsBet",
    "357": "Unibet",
    "1863": "WynnBET",
    "2161": "Barstool",
    "79": "Pinnacle",
    "2988": "ESPN BET",
    "358": "FanDuel",
}

# Target games we need F5 ML for
TARGET_GAMES = {
    "20260331": [
        ("LAA", "CHC"),
        ("TB", "MIL"),
        ("NYM", "STL"),
        ("BOS", "HOU"),
        ("SF", "SD"),
        ("NYY", "SEA"),
        ("CLE", "LAD"),
        ("DET", "ARI"),
    ],
    "20260403": [
        ("MIL", "KC"),
    ],
}


def probe_scoreboard_v2(date_str: str, periods: str, book_ids: str) -> dict:
    """Test the v2 scoreboard endpoint."""
    url = "https://api.actionnetwork.com/web/v2/scoreboard/mlb"
    params = {"bookIds": book_ids, "date": date_str, "periods": periods}
    log.info(
        f"[PROBE] GET {url}?date={date_str}&periods={periods}&bookIds={book_ids[:30]}..."
    )
    try:
        resp = requests.get(url, headers=HEADERS, params=params, timeout=20)
        log.info(f"[PROBE] HTTP {resp.status_code} | {len(resp.content)} bytes")
        if resp.status_code == 200:
            return resp.json()
        log.warning(f"[PROBE] Non-200: {resp.text[:200]}")
        return {}
    except Exception as e:
        log.error(f"[PROBE] Exception: {e}")
        return {}


def probe_scoreboard_v1(date_str: str) -> dict:
    """Test the v1 scoreboard endpoint."""
    url = "https://api.actionnetwork.com/web/v1/scoreboard/mlb"
    params = {"date": date_str}
    log.info(f"[PROBE] GET {url}?date={date_str}")
    try:
        resp = requests.get(url, headers=HEADERS, params=params, timeout=20)
        log.info(f"[PROBE] HTTP {resp.status_code} | {len(resp.content)} bytes")
        if resp.status_code == 200:
            return resp.json()
        return {}
    except Exception as e:
        log.error(f"[PROBE] Exception: {e}")
        return {}


def probe_game_odds(event_id: int) -> dict:
    """Test the per-game odds endpoint."""
    url = f"https://api.actionnetwork.com/web/v2/game/{event_id}/odds"
    log.info(f"[PROBE] GET {url}")
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        log.info(f"[PROBE] HTTP {resp.status_code} | {len(resp.content)} bytes")
        if resp.status_code == 200:
            return resp.json()
        return {}
    except Exception as e:
        log.error(f"[PROBE] Exception: {e}")
        return {}


def analyze_game_markets(game: dict, target_games: list[tuple[str, str]]) -> None:
    """Deep-analyze the markets structure of a game response."""
    away_id = game.get("away_team_id")
    home_id = game.get("home_team_id")
    teams_list = game.get("teams", [])
    team_map = {t["id"]: t.get("abbr", "?") for t in teams_list if "id" in t}
    away = team_map.get(away_id, "?")
    home = team_map.get(home_id, "?")
    event_id = game.get("id")
    start_time = game.get("start_time", "")

    # Check if this is one of our target games
    is_target = (
        (away, home) in target_games
        or any(a in away and h in home for a, h in target_games)
        or any(away in a and home in h for a, h in target_games)
    )

    markets = game.get("markets", {})
    log.info(
        f"\n  [GAME] {away}@{home} | id={event_id} | start={start_time[:16]} | {'*** TARGET ***' if is_target else ''}"
    )
    log.info(f"  [GAME] markets keys: {list(markets.keys()) if markets else 'EMPTY'}")

    if not markets:
        log.warning("  [GAME] ⚠️  NO MARKETS — game has no odds data")
        return

    # Check each book
    for book_id, book_name in BOOK_NAMES.items():
        book_data = markets.get(book_id, {})
        if not book_data:
            continue
        periods_in_book = list(book_data.keys())
        has_f5 = "firstfiveinnings" in book_data
        f5_data = book_data.get("firstfiveinnings", {})
        f5_ml = f5_data.get("moneyline", [])
        f5_ml_odds = [
            (m.get("side"), m.get("odds"), m.get("open"), m.get("type")) for m in f5_ml
        ]
        log.info(
            f"  [BOOK] {book_name} (id={book_id}): periods={periods_in_book} | F5={has_f5} | F5_ML={f5_ml_odds}"
        )

    # Also check opener/open fields at game level
    opener = game.get("opener", {})
    if opener:
        log.info(f"  [GAME] opener: {json.dumps(opener)[:200]}")

    # Check for historical/settled odds in 'lines' field
    lines = game.get("lines", {})
    if lines:
        log.info(f"  [GAME] lines keys: {list(lines.keys())}")

    # Check status
    status = game.get("status", "")
    log.info(f"  [GAME] status={status}")


def main():
    log.info("=" * 70)
    log.info("[INPUT] AN API Historical Deep-Dive Probe")
    log.info("[INPUT] Target dates: 2026-03-31, 2026-04-03")
    log.info("[INPUT] Target games: 9 missing F5 ML odds")
    log.info("=" * 70)

    all_event_ids = {}  # date → list of event IDs for target games

    # ─── Phase 1: Standard v2 scoreboard with all periods ────────────────────
    for date_str in TARGET_DATES:
        log.info(f"\n{'─' * 60}")
        log.info(f"[PHASE 1] Standard v2 scoreboard | date={date_str}")
        log.info(f"{'─' * 60}")

        data = probe_scoreboard_v2(
            date_str,
            periods="event,firstfiveinnings,firstinning",
            book_ids="15,30,358,69,68,2787,356,357,1863,2161,79,2988",
        )
        games_raw = data.get("games", [])
        log.info(f"[STATE] {len(games_raw)} games returned for {date_str}")

        target_games_for_date = TARGET_GAMES.get(date_str, [])
        event_ids_for_date = []

        for g in games_raw:
            analyze_game_markets(g, target_games_for_date)
            away_id = g.get("away_team_id")
            home_id = g.get("home_team_id")
            teams_list = g.get("teams", [])
            team_map = {t["id"]: t.get("abbr", "?") for t in teams_list if "id" in t}
            away = team_map.get(away_id, "?")
            home = team_map.get(home_id, "?")
            if (away, home) in target_games_for_date:
                event_ids_for_date.append((away, home, g.get("id")))

        all_event_ids[date_str] = event_ids_for_date
        log.info(
            f"\n[STATE] Target game event IDs for {date_str}: {event_ids_for_date}"
        )

    # ─── Phase 2: Try different period combinations ───────────────────────────
    log.info(f"\n{'─' * 60}")
    log.info("[PHASE 2] Testing alternate period parameters")
    log.info(f"{'─' * 60}")

    period_variants = [
        "event,firstfiveinnings",
        "firstfiveinnings",
        "event,firstfiveinnings,firstinning,full",
        "event",
    ]

    for date_str in TARGET_DATES:
        for periods in period_variants:
            data = probe_scoreboard_v2(
                date_str, periods, "15,30,358,69,68,2787,356,357,1863,2161,79,2988"
            )
            games_raw = data.get("games", [])
            target_games_for_date = TARGET_GAMES.get(date_str, [])
            f5_found = 0
            for g in games_raw:
                markets = g.get("markets", {})
                for book_id in BOOK_NAMES:
                    book_data = markets.get(book_id, {})
                    if "firstfiveinnings" in book_data:
                        f5_data = book_data.get("firstfiveinnings", {})
                        ml = f5_data.get("moneyline", [])
                        if ml:
                            f5_found += 1
                            break
            log.info(
                f"[PHASE 2] date={date_str} periods={periods!r}: {len(games_raw)} games, {f5_found} with F5 ML odds"
            )

    # ─── Phase 3: Per-game odds endpoint for target event IDs ────────────────
    log.info(f"\n{'─' * 60}")
    log.info("[PHASE 3] Per-game odds endpoint for target event IDs")
    log.info(f"{'─' * 60}")

    for date_str, event_id_list in all_event_ids.items():
        if not event_id_list:
            log.warning(
                f"[PHASE 3] No event IDs found for {date_str} — skipping per-game probe"
            )
            continue
        for away, home, event_id in event_id_list:
            if not event_id:
                continue
            log.info(f"\n[PHASE 3] Probing {away}@{home} event_id={event_id}")
            game_odds = probe_game_odds(event_id)
            if game_odds:
                log.info(f"[PHASE 3] game odds keys: {list(game_odds.keys())}")
                # Look for F5 ML in the response
                odds_data = game_odds.get("odds", [])
                f5_ml_found = [
                    o
                    for o in odds_data
                    if o.get("period", "") in ("firstfiveinnings", "1h", "f5")
                    and o.get("type", "") in ("moneyline", "ml")
                ]
                log.info(f"[PHASE 3] F5 ML entries: {f5_ml_found}")
            else:
                log.warning(f"[PHASE 3] No data returned for event_id={event_id}")

    # ─── Phase 4: Try v1 endpoint ─────────────────────────────────────────────
    log.info(f"\n{'─' * 60}")
    log.info("[PHASE 4] v1 scoreboard endpoint")
    log.info(f"{'─' * 60}")

    for date_str in TARGET_DATES:
        data = probe_scoreboard_v1(date_str)
        games_raw = data.get("games", [])
        log.info(f"[PHASE 4] date={date_str}: {len(games_raw)} games from v1")
        for g in games_raw[:3]:  # Sample first 3
            markets = g.get("markets", {})
            log.info(
                f"[PHASE 4] game id={g.get('id')} markets_keys={list(markets.keys())[:5]}"
            )

    # ─── Phase 5: Check if 'open' odds are stored differently ────────────────
    log.info(f"\n{'─' * 60}")
    log.info("[PHASE 5] Checking for 'open' / 'opener' / 'history' odds fields")
    log.info(f"{'─' * 60}")

    for date_str in TARGET_DATES:
        data = probe_scoreboard_v2(
            date_str,
            periods="event,firstfiveinnings,firstinning",
            book_ids="15,30,358,69,68,2787,356,357,1863,2161,79,2988",
        )
        games_raw = data.get("games", [])
        for g in games_raw:
            away_id = g.get("away_team_id")
            home_id = g.get("home_team_id")
            teams_list = g.get("teams", [])
            team_map = {t["id"]: t.get("abbr", "?") for t in teams_list if "id" in t}
            away = team_map.get(away_id, "?")
            home = team_map.get(home_id, "?")
            target_games_for_date = TARGET_GAMES.get(date_str, [])
            if (away, home) not in target_games_for_date:
                continue
            # Dump the full game structure for target games
            log.info(f"\n[PHASE 5] FULL STRUCTURE for {away}@{home} ({date_str}):")
            top_keys = list(g.keys())
            log.info(f"[PHASE 5] Top-level keys: {top_keys}")
            for key in top_keys:
                if key not in ("markets", "teams"):
                    val = g.get(key)
                    if val is not None:
                        log.info(f"[PHASE 5]   {key}: {str(val)[:100]}")
            # Full markets dump
            markets = g.get("markets", {})
            log.info(f"[PHASE 5] markets (full): {json.dumps(markets)[:500]}")

    log.info(f"\n{'=' * 70}")
    log.info("[SUMMARY] AN API Historical Deep-Dive Complete")
    log.info("=" * 70)


if __name__ == "__main__":
    main()
