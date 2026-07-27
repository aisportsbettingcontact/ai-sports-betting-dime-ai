"""Build per-season game-level MLB datasets from the StatsAPI schedule endpoint.

One JSON + CSV pair per season in docs/mlb-stats-api/data/ (games-YYYY.json/.csv).
Covers Regular Season, all postseason rounds, and the All-Star Game; excludes
Spring Training/Exhibition/Intrasquad. Rescheduled duplicates are deduped by
gamePk, keeping the most-final schedule entry.

Usage: python3 build_games_dataset.py --start 2006 --end 2026 [--delay 0.5]
"""
import argparse, csv, json, os, time, urllib.parse, urllib.request

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT_DIR = os.path.join(REPO, "docs", "mlb-stats-api", "data")
GAME_TYPES = "R,F,D,L,W,A"          # regular, WC, DS, LCS, WS, All-Star
MONTHS = [(3, 31), (4, 30), (5, 31), (6, 30), (7, 31), (8, 31), (9, 30), (10, 31), (11, 30)]
STATE_RANK = {"F": 3, "O": 3, "I": 2, "S": 1}   # keep the most-final entry per gamePk

COLS = ["gamePk", "season", "officialDate", "gameDate", "gameType", "seriesDescription",
        "doubleHeader", "gameNumber", "status", "codedState", "away", "awayId", "awayScore",
        "home", "homeId", "homeScore", "winner", "loser", "save", "innings", "venue",
        "dayNight", "seriesGameNumber", "gamesInSeries", "isTie", "resumeDate", "rescheduleDate"]


def rank(coded_state):
    return STATE_RANK.get(coded_state, 2)


def game_row(g, season):
    dec = g.get("decisions", {})
    return {
        "gamePk": g["gamePk"], "season": season,
        "officialDate": g["officialDate"], "gameDate": g["gameDate"],
        "gameType": g["gameType"], "seriesDescription": g.get("seriesDescription"),
        "doubleHeader": g["doubleHeader"], "gameNumber": g["gameNumber"],
        "status": g["status"]["detailedState"], "codedState": g["status"]["codedGameState"],
        "away": g["teams"]["away"]["team"]["name"], "awayId": g["teams"]["away"]["team"]["id"],
        "awayScore": g["teams"]["away"].get("score"),
        "home": g["teams"]["home"]["team"]["name"], "homeId": g["teams"]["home"]["team"]["id"],
        "homeScore": g["teams"]["home"].get("score"),
        "winner": (dec.get("winner") or {}).get("fullName"),
        "loser": (dec.get("loser") or {}).get("fullName"),
        "save": (dec.get("save") or {}).get("fullName"),
        "innings": len(g.get("linescore", {}).get("innings", [])) or None,
        "venue": g.get("venue", {}).get("name"), "dayNight": g.get("dayNight"),
        "seriesGameNumber": g.get("seriesGameNumber"), "gamesInSeries": g.get("gamesInSeries"),
        "isTie": g.get("isTie"), "resumeDate": g.get("resumeDate"),
        "rescheduleDate": g.get("rescheduleDate"),
    }


def fetch_month(season, month, last_day, timeout=30):
    q = urllib.parse.urlencode({
        "sportId": 1, "gameTypes": GAME_TYPES,
        "startDate": f"{season}-{month:02d}-01", "endDate": f"{season}-{month:02d}-{last_day}",
        "hydrate": "decisions,linescore",
    })
    url = f"https://statsapi.mlb.com/api/v1/schedule?{q}"
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def build_season(season, delay):
    games = {}
    for month, last_day in MONTHS:
        d = fetch_month(season, month, last_day)
        for dt in d.get("dates", []):
            for g in dt["games"]:
                row = game_row(g, season)
                pk = row["gamePk"]
                if pk not in games or rank(row["codedState"]) >= rank(games[pk]["codedState"]):
                    games[pk] = row
        time.sleep(delay)
    rows = sorted(games.values(), key=lambda r: (r["gameDate"], r["gamePk"]))
    json.dump(rows, open(os.path.join(OUT_DIR, f"games-{season}.json"), "w"), indent=0)
    with open(os.path.join(OUT_DIR, f"games-{season}.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLS)
        w.writeheader()
        w.writerows(rows)
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", type=int, required=True)
    ap.add_argument("--end", type=int, required=True)
    ap.add_argument("--delay", type=float, default=0.5)
    a = ap.parse_args()
    for season in range(a.start, a.end + 1):
        rows = build_season(season, a.delay)
        by_type = {}
        for r in rows:
            by_type[r["gameType"]] = by_type.get(r["gameType"], 0) + 1
        print(f"{season}: {len(rows)} games  {by_type}", flush=True)


if __name__ == "__main__":
    main()
