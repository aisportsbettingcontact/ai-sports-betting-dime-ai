#!/usr/bin/env python3
"""
Diagnostic: Inspect Action Network API response for doubleheader fields.
Checks today's MLB slate for any game-level fields that indicate doubleheader G1/G2.
"""

import json
import urllib.request
from datetime import datetime, timedelta, timezone

# EST = UTC-5 (no DST adjustment needed for this diagnostic)
est = timezone(timedelta(hours=-4))  # EDT currently
today = datetime.now(est).strftime("%Y%m%d")

url = f"https://api.actionnetwork.com/web/v2/scoreboard/mlb?bookIds=15,30,76,75,123&date={today}&periods=event"
print(f"[INPUT] Fetching: {url}")

req = urllib.request.Request(
    url,
    headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "application/json",
    },
)
with urllib.request.urlopen(req, timeout=15) as resp:
    data = json.loads(resp.read())

games = data.get("games", [])
print(f"[STATE] Total games: {len(games)}")

# Collect ALL top-level keys across all games
all_keys = set()
for g in games:
    all_keys.update(g.keys())
print(f"[STATE] All game-level keys: {sorted(all_keys)}")

print("\n[OUTPUT] Per-game details:")
for g in games:
    teams = {t["id"]: t for t in g.get("teams", [])}
    away = teams.get(g.get("away_team_id", 0), {})
    home = teams.get(g.get("home_team_id", 0), {})
    away_abbr = away.get("abbr", "?")
    home_abbr = home.get("abbr", "?")
    start = g.get("start_time", "")[:19]
    status = g.get("status", "?")

    # Check for any DH-related fields
    dh_fields = {}
    for k in [
        "double_header",
        "game_number",
        "series_game_number",
        "game_type",
        "description",
        "title",
        "neutral_site",
        "series_summary",
        "broadcast",
        "boxscore",
        "score",
    ]:
        if k in g:
            dh_fields[k] = g[k]

    print(f"  id={g['id']} {away_abbr}@{home_abbr} start={start} status={status}")
    for k, v in dh_fields.items():
        if isinstance(v, dict):
            print(f"    {k}: {json.dumps(v)[:120]}")
        else:
            print(f"    {k}: {v}")

# Also check if there are any games with the same away+home teams (potential DH)
from collections import defaultdict

matchup_count = defaultdict(list)
for g in games:
    teams = {t["id"]: t for t in g.get("teams", [])}
    away = teams.get(g.get("away_team_id", 0), {}).get("abbr", "?")
    home = teams.get(g.get("home_team_id", 0), {}).get("abbr", "?")
    matchup_count[f"{away}@{home}"].append(g["id"])

print("\n[VERIFY] Duplicate matchups (potential doubleheaders):")
for matchup, ids in matchup_count.items():
    if len(ids) > 1:
        print(f"  DOUBLEHEADER DETECTED: {matchup} → game ids: {ids}")
    else:
        print(f"  Single game: {matchup} → id={ids[0]}")
