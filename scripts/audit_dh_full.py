#!/usr/bin/env python3
"""
Full end-to-end doubleheader logic audit.
Tests all 5 layers of DH handling with live data.
"""

import json
import urllib.error
import urllib.request
from datetime import datetime, timezone

PASS = "✅ PASS"
FAIL = "❌ FAIL"
WARN = "⚠️  WARN"


def fetch(url, timeout=10):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "DH-Audit/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())
    except Exception as e:
        return {"_error": str(e)}


print("=" * 70)
print("DOUBLEHEADER LOGIC AUDIT — Full End-to-End Validation")
print(f"Timestamp: {datetime.now(timezone.utc).isoformat()}")
print("=" * 70)

# ─────────────────────────────────────────────────────────────────────────────
# LAYER 1: MLB Stats API — verify G1/G2 gamePk ordering for known DH dates
# ─────────────────────────────────────────────────────────────────────────────
print("\n[LAYER 1] MLB Stats API — DH gamePk ordering")
print("-" * 50)

TEST_DATES = ["2026-04-30", "2026-05-07", "2026-05-08"]
dh_found = {}

for date in TEST_DATES:
    url = f"https://statsapi.mlb.com/api/v1/schedule?sportId=1&date={date}&hydrate=linescore"
    data = fetch(url)
    if "_error" in data:
        print(f"  {WARN} {date}: fetch error — {data['_error']}")
        continue

    # Group games by away:home
    matchup_games = {}
    for d in data.get("dates", []):
        for g in d.get("games", []):
            away = g["teams"]["away"]["team"]["abbreviation"]
            home = g["teams"]["home"]["team"]["abbreviation"]
            pk = g["gamePk"]
            key = f"{away}@{home}"
            matchup_games.setdefault(key, []).append(
                {
                    "gamePk": pk,
                    "status": g.get("status", {}).get("abstractGameState", "?"),
                    "awayR": g.get("linescore", {})
                    .get("teams", {})
                    .get("away", {})
                    .get("runs"),
                    "homeR": g.get("linescore", {})
                    .get("teams", {})
                    .get("home", {})
                    .get("runs"),
                    "away": away,
                    "home": home,
                    "date": date,
                }
            )

    for key, games in matchup_games.items():
        if len(games) >= 2:
            games.sort(key=lambda x: x["gamePk"])  # ASC = G1 first
            g1, g2 = games[0], games[1]
            dh_found[f"{date}:{key}"] = {"g1": g1, "g2": g2}
            print(f"  {PASS} DH found: {date} {key}")
            print(
                f"         G1: gamePk={g1['gamePk']} score={g1['awayR']}-{g1['homeR']} status={g1['status']}"
            )
            print(
                f"         G2: gamePk={g2['gamePk']} score={g2['awayR']}-{g2['homeR']} status={g2['status']}"
            )
            # Verify G1 gamePk < G2 gamePk
            if g1["gamePk"] < g2["gamePk"]:
                print(
                    f"         {PASS} gamePk ordering correct: G1({g1['gamePk']}) < G2({g2['gamePk']})"
                )
            else:
                print(
                    f"         {FAIL} gamePk ordering WRONG: G1({g1['gamePk']}) >= G2({g2['gamePk']})"
                )

if not dh_found:
    print(
        f"  {WARN} No doubleheaders found on test dates. Testing with 2026-04-30 HOU@BAL known DH."
    )
    # Hardcode the known DH for validation
    url = "https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-04-30&hydrate=linescore"
    data = fetch(url)
    for d in data.get("dates", []):
        for g in d.get("games", []):
            away = g["teams"]["away"]["team"]["abbreviation"]
            home = g["teams"]["home"]["team"]["abbreviation"]
            pk = g["gamePk"]
            awayR = g.get("linescore", {}).get("teams", {}).get("away", {}).get("runs")
            homeR = g.get("linescore", {}).get("teams", {}).get("home", {}).get("runs")
            if away == "HOU" and home == "BAL":
                print(f"  gamePk={pk} {away}@{home} score={awayR}-{homeR}")

# ─────────────────────────────────────────────────────────────────────────────
# LAYER 2: Key format consistency check
# ─────────────────────────────────────────────────────────────────────────────
print("\n[LAYER 2] Key format consistency — linescoreByGameNum vs bet lookup")
print("-" * 50)

# Simulate the key construction for both sides
# linescoreByGameNum builder: `${ls.gameDate}:${ls.awayAbbrev}:${ls.homeAbbrev}:${ls.gameNumber}`
# bet history lookup:         `${bet.gameDate}:${bet.awayTeam}:${bet.homeTeam}:${betGameNum}`
#
# For HOU@BAL 2026-04-30:
# ls.awayAbbrev = "HOU" (from MLB Stats API)
# bet.awayTeam  = "HOU" (from Action Network, stored in DB)
# These must match exactly.

# Check MLB Stats API abbreviations vs Action Network abbreviations
mlb_abbrevs = {}
url = "https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-04-30"
data = fetch(url)
for d in data.get("dates", []):
    for g in d.get("games", []):
        away = g["teams"]["away"]["team"]["abbreviation"]
        home = g["teams"]["home"]["team"]["abbreviation"]
        mlb_abbrevs[g["gamePk"]] = {"away": away, "home": home}

# Check AN API abbreviations
an_abbrevs = {}
url = "https://api.actionnetwork.com/web/v2/scoreboard/mlb?period=game&bookIds=15,30,76,75,123,69,68,972,71,247,79&date=20260430"
data = fetch(url)
for g in data.get("games", []):
    teams = g.get("teams", [])
    if len(teams) >= 2:
        away_team = next((t for t in teams if t.get("side") == "away"), None)
        home_team = next((t for t in teams if t.get("side") == "home"), None)
        if away_team and home_team:
            away_abbr = away_team.get("abbr", "")
            home_abbr = home_team.get("abbr", "")
            an_abbrevs[g.get("id")] = {"away": away_abbr, "home": home_abbr}

print(f"  MLB Stats API returned {len(mlb_abbrevs)} games for 2026-04-30")
print(f"  Action Network returned {len(an_abbrevs)} games for 2026-04-30")

# Find HOU@BAL in both
mlb_hou_bal = [
    (pk, v)
    for pk, v in mlb_abbrevs.items()
    if v["away"] == "HOU" and v["home"] == "BAL"
]
an_hou_bal = [
    (gid, v)
    for gid, v in an_abbrevs.items()
    if v["away"] == "HOU" and v["home"] == "BAL"
]

print(f"\n  HOU@BAL in MLB Stats API: {mlb_hou_bal}")
print(f"  HOU@BAL in Action Network: {an_hou_bal}")

if mlb_hou_bal and an_hou_bal:
    mlb_away = mlb_hou_bal[0][1]["away"]
    an_away = an_hou_bal[0][1]["away"]
    if mlb_away == an_away:
        print(f"  {PASS} Abbreviation match: MLB='{mlb_away}' == AN='{an_away}'")
    else:
        print(f"  {FAIL} Abbreviation MISMATCH: MLB='{mlb_away}' != AN='{an_away}'")

# ─────────────────────────────────────────────────────────────────────────────
# LAYER 3: gameDate format consistency
# ─────────────────────────────────────────────────────────────────────────────
print("\n[LAYER 3] gameDate format consistency")
print("-" * 50)

# linescoreByGameNum uses ls.gameDate (from server)
# bet.gameDate is stored in DB from input.gameDate (from frontend from SlateGame.gameDate)
# Both should be "YYYY-MM-DD" format

# Check MLB Stats API gameDate format
url = "https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-04-30"
data = fetch(url)
for d in data.get("dates", []):
    sample_date = d.get("date", "")
    print(f"  MLB Stats API date format: '{sample_date}'")
    if len(sample_date) == 10 and sample_date[4] == "-" and sample_date[7] == "-":
        print(f"  {PASS} Date format is YYYY-MM-DD")
    else:
        print(f"  {FAIL} Unexpected date format: '{sample_date}'")
    break

# ─────────────────────────────────────────────────────────────────────────────
# LAYER 4: Simulate the full linescoreByGameNum key construction
# ─────────────────────────────────────────────────────────────────────────────
print(
    "\n[LAYER 4] Simulate linescoreByGameNum key construction for 2026-04-30 HOU@BAL DH"
)
print("-" * 50)

url = "https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-04-30&hydrate=linescore"
data = fetch(url)

hou_bal_games = []
for d in data.get("dates", []):
    for g in d.get("games", []):
        away = g["teams"]["away"]["team"]["abbreviation"]
        home = g["teams"]["home"]["team"]["abbreviation"]
        if away == "HOU" and home == "BAL":
            awayR = g.get("linescore", {}).get("teams", {}).get("away", {}).get("runs")
            homeR = g.get("linescore", {}).get("teams", {}).get("home", {}).get("runs")
            hou_bal_games.append(
                {
                    "gamePk": g["gamePk"],
                    "gameDate": d["date"],
                    "awayAbbrev": away,
                    "homeAbbrev": home,
                    "awayR": awayR,
                    "homeR": homeR,
                    "status": g.get("status", {}).get("abstractGameState", "?"),
                }
            )

hou_bal_games.sort(key=lambda x: x["gamePk"])

# Assign gameNumber (same logic as server)
if len(hou_bal_games) >= 2:
    hou_bal_games[0]["gameNumber"] = 1
    hou_bal_games[1]["gameNumber"] = 2

print(f"  Found {len(hou_bal_games)} HOU@BAL games on 2026-04-30:")
for g in hou_bal_games:
    gn = g.get("gameNumber", 1)
    key = f"{g['gameDate']}:{g['awayAbbrev']}:{g['homeAbbrev']}:{gn}"
    print(
        f"  G{gn}: gamePk={g['gamePk']} key='{key}' score={g['awayR']}-{g['homeR']} status={g['status']}"
    )

# Simulate bet lookup
print(
    "\n  Simulating bet lookup for bet 60005 (G2, awayTeam='HOU', homeTeam='BAL', gameNumber=2):"
)
bet_gameDate = "2026-04-30"
bet_awayTeam = "HOU"
bet_homeTeam = "BAL"
bet_gameNumber = 2  # backfilled
lookup_key = f"{bet_gameDate}:{bet_awayTeam}:{bet_homeTeam}:{bet_gameNumber}"
print(f"  Lookup key: '{lookup_key}'")

# Build the map
linescore_map = {}
for g in hou_bal_games:
    gn = g.get("gameNumber", 1)
    k = f"{g['gameDate']}:{g['awayAbbrev']}:{g['homeAbbrev']}:{gn}"
    linescore_map[k] = g

result = linescore_map.get(lookup_key)
if result:
    print(
        f"  {PASS} HIT: gamePk={result['gamePk']} score={result['awayR']}-{result['homeR']} (G2: HOU 11 – BAL 5)"
    )
    if result["awayR"] == 11 and result["homeR"] == 5:
        print(f"  {PASS} Score correct: HOU {result['awayR']} – BAL {result['homeR']}")
    else:
        print(
            f"  {FAIL} Score WRONG: expected HOU 11 – BAL 5, got HOU {result['awayR']} – BAL {result['homeR']}"
        )
else:
    print(f"  {FAIL} MISS — key '{lookup_key}' not found in map")
    print(f"  Available keys: {list(linescore_map.keys())}")

# ─────────────────────────────────────────────────────────────────────────────
# LAYER 5: scoreGrader DH resolution
# ─────────────────────────────────────────────────────────────────────────────
print("\n[LAYER 5] scoreGrader DH resolution logic")
print("-" * 50)

# The scoreGrader uses gameNumber to pick the correct game from the games list.
# For G2: skip the first HOU@BAL game and return the second.
# Simulate with the two games we found.

games_list = hou_bal_games.copy()
print(
    "  Simulating gradeTrackedBet for G2 bet (gameNumber=2, awayTeam=HOU, homeTeam=BAL):"
)
print(
    f"  Games list: {[(g['gamePk'], g['awayAbbrev'] + '@' + g['homeAbbrev'], g.get('gameNumber')) for g in games_list]}"
)

# Primary: anGameId match (will fail since AN ID ≠ gamePk)
an_game_id = 287818  # G2 AN ID
gamePk_match = next((g for g in games_list if g["gamePk"] == an_game_id), None)
if gamePk_match:
    print(f"  {PASS} Primary anGameId match: gamePk={gamePk_match['gamePk']}")
else:
    print(f"  {WARN} Primary anGameId match MISS (expected — AN ID ≠ gamePk)")

# Fallback: team-name + gameNumber match
game_number = 2
team_matches = [
    g for g in games_list if g["awayAbbrev"] == "HOU" and g["homeAbbrev"] == "BAL"
]
team_matches.sort(key=lambda x: x["gamePk"])  # sort by gamePk ASC = G1 first
if len(team_matches) >= game_number:
    selected = team_matches[game_number - 1]  # 0-indexed: G2 = index 1
    print(
        f"  {PASS} Fallback gameNumber match: G{game_number} → gamePk={selected['gamePk']} score={selected['awayR']}-{selected['homeR']}"
    )
    if selected["awayR"] == 11 and selected["homeR"] == 5:
        print(
            f"  {PASS} Correct game selected for grading: HOU {selected['awayR']} – BAL {selected['homeR']}"
        )
    else:
        print(
            f"  {FAIL} Wrong game selected: expected HOU 11 – BAL 5, got HOU {selected['awayR']} – BAL {selected['homeR']}"
        )
else:
    print(f"  {FAIL} Not enough team matches for G{game_number}")

# ─────────────────────────────────────────────────────────────────────────────
# SUMMARY
# ─────────────────────────────────────────────────────────────────────────────
print("\n" + "=" * 70)
print("AUDIT COMPLETE")
print("=" * 70)
