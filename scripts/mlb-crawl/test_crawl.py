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



def test_build_dataset_dedup_rank():
    from build_games_dataset import rank, game_row, COLS
    assert rank("F") == rank("O") == 3 and rank("S") == 1 and rank("X") == 2
    g = {"gamePk": 1, "officialDate": "2026-04-01", "gameDate": "2026-04-01T17:00:00Z",
         "gameType": "D", "seriesDescription": "Division Series", "doubleHeader": "N",
         "gameNumber": 1, "status": {"detailedState": "Final", "codedGameState": "F"},
         "teams": {"away": {"team": {"name": "A", "id": 1}, "score": 2},
                    "home": {"team": {"name": "B", "id": 2}, "score": 3}},
         "venue": {"name": "V"}, "decisions": {"winner": {"fullName": "W"}},
         "linescore": {"innings": [{}] * 9}}
    row = game_row(g, 2026)
    assert set(row) == set(COLS)
    assert row["seriesDescription"] == "Division Series" and row["innings"] == 9



def test_ensure_out_dir_gitignore(tmpdir="/tmp/mlb_crawl_test_dir"):
    import os, shutil
    from crawl_feeds import ensure_out_dir
    shutil.rmtree(tmpdir, ignore_errors=True)
    ensure_out_dir(tmpdir)
    gi = os.path.join(tmpdir, ".gitignore")
    assert open(gi).read() == "*\n!.gitignore\n"
    ensure_out_dir(tmpdir)  # idempotent

def test_verify_data_paths():
    from verify_feeds import data_paths
    ds, fd = data_paths(2014)
    assert ds.endswith("data/games-2014.json") and fd.endswith("data/feeds-2014")


if __name__ == "__main__":
    for name, fn in sorted({k: v for k, v in globals().items() if k.startswith("test_")}.items()):
        fn(); print(f"PASS {name}")
