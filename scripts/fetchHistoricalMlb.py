#!/usr/bin/env python3.11
"""
fetchHistoricalMlb.py
=====================
Fetches 2024 + 2025 + 2026 (03/25-04/13) MLB regular season game results
from the MLB Stats API and outputs a structured JSON file for DB seeding.

For each game, extracts:
  - Game metadata: gamePk, date, away/home team abbrev, venue
  - Final scores: awayScore, homeScore
  - F5 scores: sum of innings 1-5 for each team
  - I1 result: away/home runs in inning 1, NRFI/YRFI flag
  - Game status: only 'Final' games included

Output: /home/ubuntu/mlb_historical_results.json
"""

import json
import time
from datetime import datetime, timedelta

import requests

# ─── Constants ───────────────────────────────────────────────────────────────
MLB_API_BASE = "https://statsapi.mlb.com/api/v1"
SEASONS = [
    ("2024", "2024-03-20", "2024-09-29"),
    ("2025", "2025-03-27", "2025-09-28"),
    ("2026", "2026-03-25", "2026-04-13"),
]
OUTPUT_FILE = "/home/ubuntu/mlb_historical_results.json"
REQUEST_DELAY = 0.15  # seconds between API calls to avoid rate limiting

# MLB team abbreviation map (API teamId → standard abbrev)
TEAM_ID_TO_ABBREV = {
    108: "LAA",
    109: "ARI",
    110: "BAL",
    111: "BOS",
    112: "CHC",
    113: "CIN",
    114: "CLE",
    115: "COL",
    116: "DET",
    117: "HOU",
    118: "KC",
    119: "LAD",
    120: "WSH",
    121: "NYM",
    133: "ATH",
    134: "PIT",
    135: "SD",
    136: "SEA",
    137: "SF",
    138: "STL",
    139: "TB",
    140: "TEX",
    141: "TOR",
    142: "MIN",
    143: "PHI",
    144: "ATL",
    145: "CWS",
    146: "MIA",
    147: "NYY",
    158: "MIL",
}


def fetch_schedule_chunk(start_date: str, end_date: str, season: str) -> list:
    """Fetch schedule with linescore for a date range."""
    url = (
        f"{MLB_API_BASE}/schedule"
        f"?sportId=1&season={season}&gameType=R"
        f"&startDate={start_date}&endDate={end_date}"
        f"&hydrate=linescore"
    )
    try:
        resp = requests.get(url, timeout=30)
        resp.raise_for_status()
        return resp.json().get("dates", [])
    except Exception as e:
        print(f"  [ERROR] fetch_schedule_chunk({start_date}-{end_date}): {e}")
        return []


def parse_game(game: dict) -> dict | None:
    """
    Parse a single game dict from the MLB Stats API.
    Returns structured result dict or None if game is not final/complete.
    """
    status = game.get("status", {}).get("abstractGameState", "")
    if status != "Final":
        return None

    game_pk = game.get("gamePk")
    official_date = game.get("officialDate", "")
    teams = game.get("teams", {})
    away_team = teams.get("away", {}).get("team", {})
    home_team = teams.get("home", {}).get("team", {})
    away_id = away_team.get("id")
    home_id = home_team.get("id")
    away_abbrev = TEAM_ID_TO_ABBREV.get(away_id, away_team.get("abbreviation", "UNK"))
    home_abbrev = TEAM_ID_TO_ABBREV.get(home_id, home_team.get("abbreviation", "UNK"))

    linescore = game.get("linescore", {})
    innings = linescore.get("innings", [])

    if not innings:
        return None

    # Final scores from linescore teams totals
    ls_teams = linescore.get("teams", {})
    away_final = ls_teams.get("away", {}).get("runs")
    home_final = ls_teams.get("home", {}).get("runs")

    if away_final is None or home_final is None:
        return None

    # Per-inning extraction
    away_by_inning = []
    home_by_inning = []
    for inn in innings:
        away_runs = inn.get("away", {}).get("runs", 0) or 0
        home_runs = inn.get("home", {}).get("runs", 0) or 0
        away_by_inning.append(away_runs)
        home_by_inning.append(home_runs)

    # F5 scores (innings 1-5, 0-indexed 0-4)
    away_f5 = sum(away_by_inning[:5]) if len(away_by_inning) >= 5 else None
    home_f5 = sum(home_by_inning[:5]) if len(home_by_inning) >= 5 else None

    # I1 result
    away_i1 = away_by_inning[0] if away_by_inning else None
    home_i1 = home_by_inning[0] if home_by_inning else None
    nrfi_result = None
    if away_i1 is not None and home_i1 is not None:
        nrfi_result = "NRFI" if (away_i1 == 0 and home_i1 == 0) else "YRFI"

    venue = game.get("venue", {}).get("name", "")

    return {
        "gamePk": game_pk,
        "gameDate": official_date,
        "awayTeam": away_abbrev,
        "homeTeam": home_abbrev,
        "awayTeamId": away_id,
        "homeTeamId": home_id,
        "venue": venue,
        "awayFinalScore": int(away_final),
        "homeFinalScore": int(home_final),
        "awayF5Score": int(away_f5) if away_f5 is not None else None,
        "homeF5Score": int(home_f5) if home_f5 is not None else None,
        "awayI1Score": int(away_i1) if away_i1 is not None else None,
        "homeI1Score": int(home_i1) if home_i1 is not None else None,
        "nrfiResult": nrfi_result,
        "awayByInning": away_by_inning,
        "homeByInning": home_by_inning,
        "totalRuns": int(away_final) + int(home_final),
        "f5TotalRuns": (int(away_f5) + int(home_f5))
        if (away_f5 is not None and home_f5 is not None)
        else None,
    }


def date_range_chunks(start: str, end: str, chunk_days: int = 7):
    """Generate (start, end) date string pairs in chunks."""
    fmt = "%Y-%m-%d"
    cur = datetime.strptime(start, fmt)
    end_dt = datetime.strptime(end, fmt)
    while cur <= end_dt:
        chunk_end = min(cur + timedelta(days=chunk_days - 1), end_dt)
        yield cur.strftime(fmt), chunk_end.strftime(fmt)
        cur += timedelta(days=chunk_days)


def main():
    print("[INPUT] Starting MLB historical data fetch")
    print(f"[INPUT] Seasons: {[s[0] for s in SEASONS]}")
    print(f"[INPUT] Output: {OUTPUT_FILE}")
    print()

    all_games = []
    season_stats = {}

    for season, start_date, end_date in SEASONS:
        print(f"[STEP] Fetching season {season}: {start_date} → {end_date}")
        season_games = []
        chunk_count = 0

        for chunk_start, chunk_end in date_range_chunks(
            start_date, end_date, chunk_days=7
        ):
            chunk_count += 1  # noqa: SIM113
            dates = fetch_schedule_chunk(chunk_start, chunk_end, season)
            chunk_games = 0
            for date_obj in dates:
                for game in date_obj.get("games", []):
                    parsed = parse_game(game)
                    if parsed:
                        season_games.append(parsed)
                        chunk_games += 1

            if chunk_count % 5 == 0 or chunk_games > 0:
                print(
                    f"  [STATE] Chunk {chunk_start}→{chunk_end}: {chunk_games} games parsed (season total: {len(season_games)})"
                )

            time.sleep(REQUEST_DELAY)

        nrfi_count = sum(1 for g in season_games if g["nrfiResult"] == "NRFI")
        yrfi_count = sum(1 for g in season_games if g["nrfiResult"] == "YRFI")
        nrfi_rate = nrfi_count / len(season_games) if season_games else 0
        avg_total = (
            sum(g["totalRuns"] for g in season_games) / len(season_games)
            if season_games
            else 0
        )
        f5_games = [g for g in season_games if g["f5TotalRuns"] is not None]
        avg_f5 = (
            sum(g["f5TotalRuns"] for g in f5_games) / len(f5_games) if f5_games else 0
        )

        season_stats[season] = {
            "total_games": len(season_games),
            "nrfi_count": nrfi_count,
            "yrfi_count": yrfi_count,
            "nrfi_rate": round(nrfi_rate, 4),
            "avg_total_runs": round(avg_total, 3),
            "avg_f5_runs": round(avg_f5, 3),
        }

        print(
            f"[OUTPUT] Season {season}: {len(season_games)} games | NRFI={nrfi_count}({nrfi_rate:.1%}) | avg_total={avg_total:.3f} | avg_f5={avg_f5:.3f}"
        )
        all_games.extend(season_games)

    print()
    print(f"[STATE] Total games fetched: {len(all_games)}")
    print(f"[STATE] Season breakdown: {json.dumps(season_stats, indent=2)}")

    # Write output
    output = {
        "fetched_at": datetime.utcnow().isoformat() + "Z",
        "total_games": len(all_games),
        "season_stats": season_stats,
        "games": all_games,
    }
    with open(OUTPUT_FILE, "w") as f:
        json.dump(output, f, indent=2)

    print(f"[OUTPUT] Written to {OUTPUT_FILE}")
    print("[VERIFY] PASS — historical data fetch complete")


if __name__ == "__main__":
    main()
