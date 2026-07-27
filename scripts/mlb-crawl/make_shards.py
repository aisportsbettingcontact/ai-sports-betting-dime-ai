"""Partition completed 2026 games into N balanced, date-ordered crawl shards."""
import json, os, sys

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DATASET = os.path.join(REPO, "docs", "mlb-stats-api", "data", "games-2026.json")
SHARD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shards")
FINAL_STATES = {"F", "O"}

def split_shards(games, n):
    games = sorted(games, key=lambda g: (g["officialDate"], g["gamePk"]))
    base, extra = divmod(len(games), n)
    shards, i = [], 0
    for k in range(n):
        size = base + (1 if k < extra else 0)
        shards.append(games[i:i + size]); i += size
    return shards

def main():
    games = json.load(open(DATASET))
    finals = [{"gamePk": g["gamePk"], "officialDate": g["officialDate"],
               "awayScore": g["awayScore"], "homeScore": g["homeScore"]}
              for g in games if g["codedState"] in FINAL_STATES]
    os.makedirs(SHARD_DIR, exist_ok=True)
    shards = split_shards(finals, 5)
    for i, shard in enumerate(shards, 1):
        path = os.path.join(SHARD_DIR, f"shard-{i}.json")
        json.dump(shard, open(path, "w"))
        print(f"shard-{i}: {len(shard)} games  {shard[0]['officialDate']} -> {shard[-1]['officialDate']}")
    print(f"total finals: {len(finals)}")
    if len(finals) != 1586:
        print(f"WARNING: expected 1586 finals, got {len(finals)}", file=sys.stderr)

if __name__ == "__main__":
    main()
