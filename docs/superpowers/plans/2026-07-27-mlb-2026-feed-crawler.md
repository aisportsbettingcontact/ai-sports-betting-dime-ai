# MLB 2026 Feed Crawler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Download the full v1.1 live feed for every completed 2026 MLB game (1,586 finals) with rate limiting, retries, atomic writes, and resume support, executed as 5 parallel season shards plus a verification supervisor proving 100% coverage and cross-source accuracy.

**Architecture:** Three small Python scripts under `scripts/mlb-crawl/`: a shard generator that partitions the finals list from the existing game-level dataset, a resumable crawler run once per shard (5 parallel subagents), and a verifier that checks every downloaded feed against `games-2026.json` (gamePk echo, Final status, exact score match, play/inning sanity). Feeds land in a gitignored data directory inside the repo.

**Tech Stack:** Python 3 stdlib only (`urllib`, `json`, `argparse`, `time`, `os`) — no pip installs. Source dataset: `docs/mlb-stats-api/data/games-2026.json` (2,431 games, built 2026-07-27).

## Global Constraints

- Read-only GETs against `https://statsapi.mlb.com/api/v1.1/game/{gamePk}/feed/live` only; no POSTs, no auth.
- Per-shard request delay ≥ 1.0 s (aggregate ≈ 5 req/s across 5 shards); 3 retry attempts with exponential backoff (2 s, 4 s, 8 s) on 5xx/timeouts; 4xx recorded as permanent failure, never retried.
- Data directory `docs/mlb-stats-api/data/feeds-2026/` must be gitignored (a `.gitignore` containing `*` inside it); **feed data is never committed** (MLB copyright: bulk/commercial use restricted — this is a one-time research artifact).
- Atomic writes: download to `<pk>.json.tmp`, validate JSON + gamePk echo, then `os.replace` to `<pk>.json`.
- Resume: a game is skipped iff `<pk>.json` exists AND parses as JSON AND `gamePk` matches.
- Completed games = `codedState` in `{F, O}` from `games-2026.json` → exactly **1,586** games; verification must account for all 1,586.

---

### Task 1: Shard generator + data directory

**Files:**
- Create: `scripts/mlb-crawl/make_shards.py`
- Create: `scripts/mlb-crawl/test_crawl.py` (shared test file, plain asserts)
- Create: `docs/mlb-stats-api/data/feeds-2026/.gitignore`

**Interfaces:**
- Consumes: `docs/mlb-stats-api/data/games-2026.json` (list of dicts with `gamePk:int`, `codedState:str`, `officialDate:str`, `awayScore`, `homeScore`).
- Produces: `scripts/mlb-crawl/shards/shard-{1..5}.json` — each a JSON list of `{"gamePk": int, "officialDate": str, "awayScore": int, "homeScore": int}`; function `split_shards(games: list, n: int) -> list[list[dict]]` (balanced contiguous date-sorted chunks, sizes differ by ≤ 1).

- [ ] **Step 1: Write the failing test**

```python
# scripts/mlb-crawl/test_crawl.py
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

def test_split_shards():
    from make_shards import split_shards
    games = [{"gamePk": i, "officialDate": f"2026-04-{i:02d}"} for i in range(1, 12)]  # 11 games
    shards = split_shards(games, 5)
    assert len(shards) == 5
    sizes = [len(s) for s in shards]
    assert sum(sizes) == 11
    assert max(sizes) - min(sizes) <= 1
    flat = [g["gamePk"] for s in shards for g in s]
    assert flat == sorted(flat), "shards must stay date-ordered"

if __name__ == "__main__":
    for name, fn in sorted({k: v for k, v in globals().items() if k.startswith("test_")}.items()):
        fn(); print(f"PASS {name}")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 scripts/mlb-crawl/test_crawl.py`
Expected: FAIL with `ModuleNotFoundError: No module named 'make_shards'`

- [ ] **Step 3: Write the implementation**

```python
# scripts/mlb-crawl/make_shards.py
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 scripts/mlb-crawl/test_crawl.py`
Expected: `PASS test_split_shards`

- [ ] **Step 5: Create the gitignored data dir and generate shards**

```bash
mkdir -p docs/mlb-stats-api/data/feeds-2026
printf '*\n!.gitignore\n' > docs/mlb-stats-api/data/feeds-2026/.gitignore
python3 scripts/mlb-crawl/make_shards.py
```

Expected: 5 lines `shard-N: 317|318 games ...` and `total finals: 1586`. Confirm `git status` shows no `feeds-2026` contents beyond nothing (dir ignored except its .gitignore).

- [ ] **Step 6: Commit**

```bash
git add scripts/mlb-crawl/make_shards.py scripts/mlb-crawl/test_crawl.py docs/mlb-stats-api/data/feeds-2026/.gitignore
git commit -m "feat(mlb-crawl): shard generator for 2026 feed crawl"
```

(`scripts/mlb-crawl/shards/` output stays uncommitted; it is derived.)

---

### Task 2: Resumable rate-limited crawler

**Files:**
- Create: `scripts/mlb-crawl/crawl_feeds.py`
- Modify: `scripts/mlb-crawl/test_crawl.py` (append tests)

**Interfaces:**
- Consumes: shard files from Task 1 (`[{"gamePk":..., "officialDate":..., "awayScore":..., "homeScore":...}]`).
- Produces: `docs/mlb-stats-api/data/feeds-2026/<gamePk>.json` per game; append-only manifest `docs/mlb-stats-api/data/feeds-2026/manifest-<shardname>.jsonl` with rows `{"gamePk","status":"ok"|"skipped"|"failed","bytes","ms","attempts","error"}`; functions `is_valid_feed_file(path, gamePk) -> bool` and `fetch_feed(gamePk, timeout=30) -> bytes` (raises on failure).

- [ ] **Step 1: Write the failing tests**

Append to `scripts/mlb-crawl/test_crawl.py` (before the `__main__` block):

```python
def test_is_valid_feed_file(tmpdir="/tmp/mlb_crawl_test"):
    import json, os
    from crawl_feeds import is_valid_feed_file
    os.makedirs(tmpdir, exist_ok=True)
    good = os.path.join(tmpdir, "823433.json")
    json.dump({"gamePk": 823433, "liveData": {}}, open(good, "w"))
    bad_json = os.path.join(tmpdir, "111.json")
    open(bad_json, "w").write("{truncated")
    wrong_pk = os.path.join(tmpdir, "222.json")
    json.dump({"gamePk": 999}, open(wrong_pk, "w"))
    assert is_valid_feed_file(good, 823433) is True
    assert is_valid_feed_file(bad_json, 111) is False
    assert is_valid_feed_file(wrong_pk, 222) is False
    assert is_valid_feed_file(os.path.join(tmpdir, "missing.json"), 3) is False
```

- [ ] **Step 2: Run tests to verify the new one fails**

Run: `python3 scripts/mlb-crawl/test_crawl.py`
Expected: `PASS test_split_shards` then FAIL with `ModuleNotFoundError: No module named 'crawl_feeds'`

- [ ] **Step 3: Write the implementation**

```python
# scripts/mlb-crawl/crawl_feeds.py
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 scripts/mlb-crawl/test_crawl.py`
Expected: `PASS test_is_valid_feed_file`, `PASS test_split_shards`

- [ ] **Step 5: Live smoke test (2 games) + resume proof**

```bash
python3 scripts/mlb-crawl/crawl_feeds.py --shard scripts/mlb-crawl/shards/shard-1.json --limit 2
python3 scripts/mlb-crawl/crawl_feeds.py --shard scripts/mlb-crawl/shards/shard-1.json --limit 2
```

Expected: first run `ok=2 skipped=0`; second run `ok=0 skipped=2` (resume works). Two `<pk>.json` files ~600-900 KB each in `feeds-2026/`.

- [ ] **Step 6: Commit**

```bash
git add scripts/mlb-crawl/crawl_feeds.py scripts/mlb-crawl/test_crawl.py
git commit -m "feat(mlb-crawl): resumable rate-limited feed crawler"
```

---

### Task 3: Verification supervisor script

**Files:**
- Create: `scripts/mlb-crawl/verify_feeds.py`
- Modify: `scripts/mlb-crawl/test_crawl.py` (append test)

**Interfaces:**
- Consumes: `games-2026.json` (source of truth for the 1,586 finals and their scores), downloaded `feeds-2026/<pk>.json` files.
- Produces: `docs/mlb-stats-api/data/feeds-2026/verify-report.json` `{"expected":1586,"present":N,"valid":N,"failures":[{"gamePk","checks":[...]}...]}`; function `verify_feed(feed: dict, expected: dict) -> list[str]` returning empty list when all checks pass. Exit code 0 iff 100% present and valid.

**Checks per game (all must hold):**
1. file exists and parses;
2. `gamePk` echo matches;
3. `gameData.status.codedGameState` in `{F, O}`;
4. feed linescore totals equal dataset `awayScore`/`homeScore` exactly;
5. `liveData.plays.allPlays` length ≥ 40;
6. linescore innings ≥ 5 (lenient floor, covers Completed Early); the strict ≥ 9 rule applies only when `codedGameState == "F"` and `scheduledInnings == 9`.

- [ ] **Step 1: Write the failing test**

Append to `scripts/mlb-crawl/test_crawl.py`:

```python
def test_verify_feed():
    from verify_feeds import verify_feed
    expected = {"gamePk": 823433, "awayScore": 4, "homeScore": 11}
    feed = {
        "gamePk": 823433,
        "gameData": {"status": {"codedGameState": "F"}},
        "liveData": {
            "plays": {"allPlays": [{}] * 81},
            "linescore": {"scheduledInnings": 9,
                          "innings": [{}] * 9,
                          "teams": {"away": {"runs": 4}, "home": {"runs": 11}}},
        },
    }
    assert verify_feed(feed, expected) == []
    feed["liveData"]["linescore"]["teams"]["home"]["runs"] = 10
    assert any("score" in c for c in verify_feed(feed, expected))
```

- [ ] **Step 2: Run tests to verify the new one fails**

Run: `python3 scripts/mlb-crawl/test_crawl.py`
Expected: FAIL with `ModuleNotFoundError: No module named 'verify_feeds'`

- [ ] **Step 3: Write the implementation**

```python
# scripts/mlb-crawl/verify_feeds.py
"""Verify 100% coverage + accuracy of crawled 2026 feeds against games-2026.json."""
import json, os, sys

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DATASET = os.path.join(REPO, "docs", "mlb-stats-api", "data", "games-2026.json")
FEED_DIR = os.path.join(REPO, "docs", "mlb-stats-api", "data", "feeds-2026")
FINAL_STATES = {"F", "O"}

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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 scripts/mlb-crawl/test_crawl.py`
Expected: 3 PASS lines.

- [ ] **Step 5: Commit**

```bash
git add scripts/mlb-crawl/verify_feeds.py scripts/mlb-crawl/test_crawl.py
git commit -m "feat(mlb-crawl): coverage + accuracy verifier"
```

---

### Task 4: Parallel crawl execution (5 shard subagents)

**Files:** none created (operational task). Each of 5 subagents runs exactly:

```bash
cd /Users/danielwalker/src/ai-sports-betting-dime-ai && python3 scripts/mlb-crawl/crawl_feeds.py --shard scripts/mlb-crawl/shards/shard-<N>.json --delay 1.0
```

- [ ] Dispatch 5 subagents (shard-1 … shard-5) concurrently; each reports back `ok/skipped/failed` counts and the tail of its manifest.
- [ ] Expected duration ≈ 317 games × (1.0 s delay + ~0.5 s fetch) ≈ 8–10 min per shard, running in parallel.
- [ ] On any shard reporting `failed > 0`: re-run that shard once (resume skips completed games, retries only failures). Persistent failures escalate to the supervisor with manifest rows.

### Task 5: Verification supervision + report

- [ ] Run `python3 scripts/mlb-crawl/verify_feeds.py`. Expected: `expected=1586 present=1586 valid=1586 failures=0`, exit 0.
- [ ] If failures: re-crawl the failed gamePks (delete their files, re-run owning shard with resume), then re-verify. Repeat until 0 or a game is proven structurally exceptional (document it in the report).
- [ ] Sanity aggregates from the corpus (spot-check vs known values): total plays > 120,000; every feed's `gameData.game.season == "2026"`; disk usage ≈ 1.0–1.3 GB (`du -sh`).
- [ ] Record final `verify-report.json` summary in the session summary (data dir stays uncommitted).

### Task 6: Finish

- [ ] `python3 scripts/mlb-crawl/test_crawl.py` — all PASS.
- [ ] `git status` — only `scripts/mlb-crawl/*` and the plan file staged/committed; no data files.
- [ ] Use superpowers:finishing-a-development-branch for merge/PR decision.

## Risks / Unknowns

- **Legal:** bulk download of 1,586 feeds is the "non-bulk" boundary in MLB's copyright notice; user explicitly opted in for a local, uncommitted research artifact. Data must never be committed or redistributed.
- **Feed availability:** all 1,586 targets were `Final` in the dataset built this morning; post-final scorer corrections may change linescore vs the dataset snapshot (score mismatches at verify time are then *findings*, not crawler bugs — re-pull `games-2026.json` scores before declaring failure).
- **Rate limiting:** no published quota; 5 req/s aggregate with backoff is polite but unverified against MLB's tolerance — any observed 429/403 pauses the run (backoff handles transient; persistent → stop and reassess).
- **Suspended/resumed games:** a handful of feeds may have unusual inning counts; check #6 is deliberately lenient (≥5 innings) with the strict ≥9 rule scoped to full 9-inning finals.

## Out of Scope

- Postseason 2026 (not yet populated), Spring Training, non-MLB sportIds.
- winProbability/content/boxscore sibling endpoints (the feed embeds boxscore + plays).
- Any database loading, Tier-B (Okta) endpoints, production scheduling/cron, and committing any downloaded data.
