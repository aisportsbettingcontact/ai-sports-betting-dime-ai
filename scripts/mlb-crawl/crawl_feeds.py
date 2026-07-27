"""Resumable, rate-limited crawler for MLB v1.1 live feeds. One process per shard.

Usage: python3 crawl_feeds.py --shard shards/shard-1.json [--delay 1.0] [--limit N]
"""
import argparse, json, os, sys, time, urllib.request, urllib.error

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT_DIR = os.path.join(REPO, "docs", "mlb-stats-api", "data", "feeds-2026")
URL = "https://statsapi.mlb.com/api/v1.1/game/{pk}/feed/live"
RETRIES = 3
BACKOFF = [2, 4, 8]

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

def crawl(shard_path, delay, limit=None):
    shard_name = os.path.splitext(os.path.basename(shard_path))[0]
    games = json.load(open(shard_path))
    if limit:
        games = games[:limit]
    os.makedirs(OUT_DIR, exist_ok=True)
    manifest = open(os.path.join(OUT_DIR, f"manifest-{shard_name}.jsonl"), "a")
    ok = skipped = failed = 0
    for i, g in enumerate(games):
        pk = g["gamePk"]
        final_path = os.path.join(OUT_DIR, f"{pk}.json")
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
            print(f"[{shard_name}] {i+1}/{len(games)} ok={ok} skipped={skipped} failed={failed}", flush=True)
        time.sleep(delay)
    manifest.close()
    print(f"[{shard_name}] DONE ok={ok} skipped={skipped} failed={failed}")
    return failed

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--shard", required=True)
    ap.add_argument("--delay", type=float, default=1.0)
    ap.add_argument("--limit", type=int, default=None)
    a = ap.parse_args()
    sys.exit(1 if crawl(a.shard, a.delay, a.limit) else 0)
