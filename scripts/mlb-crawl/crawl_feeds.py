"""Resumable, rate-limited crawler for MLB v1.1 live feeds.

Two modes:
  --shard shards/shard-1.json     crawl an explicit game list into feeds-2026/
  --season 2014                   crawl all finals from games-2014.json into feeds-2014/
                                  (historical games-YYYY.json were dropped from git 2026-08-05;
                                   regenerate first: build_games_dataset.py --start YYYY --end YYYY)

Usage: python3 crawl_feeds.py (--shard FILE | --season YYYY) [--delay 1.0] [--limit N]
"""
import argparse, json, os, sys, time, urllib.request, urllib.error

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DATA_DIR = os.path.join(REPO, "docs", "mlb-stats-api", "data")
URL = "https://statsapi.mlb.com/api/v1.1/game/{pk}/feed/live"
RETRIES = 3
BACKOFF = [2, 4, 8]
FINAL_STATES = {"F", "O"}

def ensure_out_dir(path):
    """Create the feed dir with a self-gitignore so data can never be committed."""
    os.makedirs(path, exist_ok=True)
    gi = os.path.join(path, ".gitignore")
    if not os.path.exists(gi):
        with open(gi, "w") as f:
            f.write("*\n!.gitignore\n")
    return path

def is_valid_feed_file(path, gamePk):
    try:
        with open(path) as f:
            return json.load(f).get("gamePk") == gamePk
    except (OSError, ValueError):
        return False

def fetch_feed(gamePk, timeout=30):
    req = urllib.request.Request(URL.format(pk=gamePk),
                                 headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()

def crawl(games, out_dir, manifest_name, delay, limit=None, label="crawl"):
    if limit:
        games = games[:limit]
    ensure_out_dir(out_dir)
    manifest = open(os.path.join(out_dir, manifest_name), "a")
    ok = skipped = failed = 0
    for i, g in enumerate(games):
        pk = g["gamePk"]
        final_path = os.path.join(out_dir, f"{pk}.json")
        if is_valid_feed_file(final_path, pk):
            skipped += 1
            manifest.write(json.dumps({"gamePk": pk, "status": "skipped"}) + "\n")
            continue
        row = {"gamePk": pk, "status": "failed", "attempts": 0, "error": None}
        t0 = time.time()
        for attempt in range(1, RETRIES + 1):
            row["attempts"] = attempt
            try:
                body = fetch_feed(pk)
                data = json.loads(body)          # validate before write
                if data.get("gamePk") != pk:
                    raise ValueError(f"gamePk echo mismatch: {data.get('gamePk')}")
                tmp = final_path + ".tmp"
                with open(tmp, "wb") as f:
                    f.write(body)
                os.replace(tmp, final_path)      # atomic
                row.update(status="ok", bytes=len(body), error=None)
                ok += 1
                break
            except urllib.error.HTTPError as e:
                row["error"] = f"HTTP {e.code}"
                if 400 <= e.code < 500:
                    break                        # permanent — do not retry
                if attempt < RETRIES:
                    time.sleep(BACKOFF[attempt - 1])
            except (urllib.error.URLError, TimeoutError, ValueError, OSError) as e:
                row["error"] = f"{type(e).__name__}: {e}"
                if attempt < RETRIES:
                    time.sleep(BACKOFF[attempt - 1])
        if row["status"] == "failed":
            failed += 1
        row["ms"] = int((time.time() - t0) * 1000)
        manifest.write(json.dumps(row) + "\n")
        manifest.flush()
        if (i + 1) % 25 == 0 or i + 1 == len(games):
            print(f"[{label}] {i+1}/{len(games)} ok={ok} skipped={skipped} failed={failed}", flush=True)
        time.sleep(delay)
    manifest.close()
    print(f"[{label}] DONE ok={ok} skipped={skipped} failed={failed}")
    return failed

def season_finals(season):
    games = json.load(open(os.path.join(DATA_DIR, f"games-{season}.json")))
    return [g for g in games if g["codedState"] in FINAL_STATES]

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--shard")
    mode.add_argument("--season", type=int)
    ap.add_argument("--delay", type=float, default=1.0)
    ap.add_argument("--limit", type=int, default=None)
    a = ap.parse_args()
    if a.shard:
        name = os.path.splitext(os.path.basename(a.shard))[0]
        failed = crawl(json.load(open(a.shard)), os.path.join(DATA_DIR, "feeds-2026"),
                       f"manifest-{name}.jsonl", a.delay, a.limit, label=name)
    else:
        failed = crawl(season_finals(a.season), os.path.join(DATA_DIR, f"feeds-{a.season}"),
                       f"manifest-season-{a.season}.jsonl", a.delay, a.limit,
                       label=f"season-{a.season}")
    sys.exit(1 if failed else 0)
