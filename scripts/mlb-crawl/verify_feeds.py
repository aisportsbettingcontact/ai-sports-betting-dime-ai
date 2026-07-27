"""Verify 100% coverage + accuracy of crawled feeds against a season's games-YYYY.json.

Usage: python3 verify_feeds.py [--season 2026]
"""
import argparse, json, os, sys

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
FINAL_STATES = {"F", "O"}

def data_paths(season):
    data = os.path.join(REPO, "docs", "mlb-stats-api", "data")
    return (os.path.join(data, f"games-{season}.json"),
            os.path.join(data, f"feeds-{season}"))

def verify_feed(feed, expected):
    fails = []
    if feed.get("gamePk") != expected["gamePk"]:
        fails.append(f"gamePk echo {feed.get('gamePk')} != {expected['gamePk']}")
        return fails
    state = feed.get("gameData", {}).get("status", {}).get("codedGameState")
    if state not in FINAL_STATES:
        fails.append(f"status not final: {state}")
    ls = feed.get("liveData", {}).get("linescore", {})
    away = ls.get("teams", {}).get("away", {}).get("runs")
    home = ls.get("teams", {}).get("home", {}).get("runs")
    if away != expected["awayScore"] or home != expected["homeScore"]:
        fails.append(f"score mismatch feed {away}-{home} vs dataset {expected['awayScore']}-{expected['homeScore']}")
    plays = feed.get("liveData", {}).get("plays", {}).get("allPlays", [])
    if len(plays) < 40:
        fails.append(f"allPlays too small: {len(plays)}")
    innings = ls.get("innings", [])
    if len(innings) < 5:
        fails.append(f"innings too small: {len(innings)}")
    if state == "F" and ls.get("scheduledInnings", 9) == 9 and len(innings) < 9:
        fails.append(f"innings {len(innings)} < 9 for full final")
    return fails

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=2026)
    a = ap.parse_args()
    DATASET, FEED_DIR = data_paths(a.season)
    games = json.load(open(DATASET))
    finals = {g["gamePk"]: g for g in games if g["codedState"] in FINAL_STATES}
    failures, present, valid = [], 0, 0
    for pk, g in sorted(finals.items()):
        path = os.path.join(FEED_DIR, f"{pk}.json")
        if not os.path.exists(path):
            failures.append({"gamePk": pk, "checks": ["missing file"]}); continue
        present += 1
        try:
            feed = json.load(open(path))
        except ValueError as e:
            failures.append({"gamePk": pk, "checks": [f"unparseable: {e}"]}); continue
        fails = verify_feed(feed, g)
        if fails:
            failures.append({"gamePk": pk, "checks": fails})
        else:
            valid += 1
    report = {"expected": len(finals), "present": present, "valid": valid, "failures": failures}
    json.dump(report, open(os.path.join(FEED_DIR, "verify-report.json"), "w"), indent=1)
    print(f"expected={len(finals)} present={present} valid={valid} failures={len(failures)}")
    for f in failures[:20]:
        print(" ", f)
    return 0 if valid == len(finals) else 1

if __name__ == "__main__":
    sys.exit(main())
