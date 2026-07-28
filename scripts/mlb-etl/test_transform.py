import sys, os, json
sys.path.insert(0, os.path.dirname(__file__))

DATA_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..",
                                         "docs", "mlb-stats-api", "data"))


def load_feed(season, pk):
    return json.load(open(os.path.join(DATA_DIR, f"feeds-{season}", f"{pk}.json")))


# Fixtures per the task brief:
#   823433  2026  modern / ABS-era, 9 innings, complete tracking data
#   449244  2016  tie game, called early, no winner/loser decision
#   381964  2014  rain-shortened (5 innings)
#   39939   2006  early era, sparse tracking (no start/end times, minimal pitchData)
#   631470  2020  first 7-inning doubleheader game (game 1) found via games-2020.json


def test_innings_pitched_to_outs():
    from transform import innings_pitched_to_outs
    assert innings_pitched_to_outs("5.2") == 17
    assert innings_pitched_to_outs("0.0") == 0
    assert innings_pitched_to_outs("3.1") == 10
    assert innings_pitched_to_outs(None) is None
    assert innings_pitched_to_outs("") is None


def test_iso_to_sql_utc():
    from transform import iso_to_sql_utc
    assert iso_to_sql_utc("2026-07-26T23:20:00Z") == "2026-07-26 23:20:00"
    assert iso_to_sql_utc(None) is None
    assert iso_to_sql_utc("") is None


def test_ensure_out_dir_gitignore():
    import shutil
    from transform import ensure_out_dir
    tmpdir = "/tmp/mlb_etl_test_dir"
    shutil.rmtree(tmpdir, ignore_errors=True)
    ensure_out_dir(tmpdir)
    gi = os.path.join(tmpdir, ".gitignore")
    assert open(gi).read() == "*\n!.gitignore\n"
    ensure_out_dir(tmpdir)  # idempotent


def test_2026_play_and_pitch_counts_match_feed_sums():
    from transform import extract_plays, extract_pitches
    feed = load_feed("2026", 823433)
    all_plays = feed["liveData"]["plays"]["allPlays"]
    plays = extract_plays(feed, 2026)
    pitches = extract_pitches(feed, 2026)

    assert len(plays) == len(all_plays)

    feed_pitch_event_count = sum(
        1 for p in all_plays for e in p["playEvents"] if e.get("isPitch") and e.get("playId")
    )
    assert len(pitches) == feed_pitch_event_count

    # pitch_count per play == count of isPitch playEvents (playId or not)
    total_pitch_count_field = sum(p["pitch_count"] for p in plays)
    feed_is_pitch_count = sum(
        1 for p in all_plays for e in p["playEvents"] if e.get("isPitch")
    )
    assert total_pitch_count_field == feed_is_pitch_count

    # every extracted pitch has a season and gamePk denormalized
    for pitch in pitches:
        assert pitch["season"] == 2026
        assert pitch["game_pk"] == 823433
        assert pitch["play_id"]


def test_2026_pitch_has_full_tracking():
    from transform import extract_pitches
    feed = load_feed("2026", 823433)
    pitches = extract_pitches(feed, 2026)
    in_play = [p for p in pitches if p["is_in_play"]]
    assert in_play, "expected at least one ball in play"
    hit = in_play[0]
    assert hit["launch_speed"] is not None
    assert hit["total_distance"] is not None
    assert hit["trajectory"] is not None
    tracked = [p for p in pitches if p["start_speed"] is not None]
    assert tracked, "expected pitch-tracking speed data in the modern feed"
    sample = tracked[0]
    assert sample["spin_rate"] is not None
    assert sample["zone"] is not None


def test_2016_tie_game_is_tie_and_no_winner():
    from transform import extract_game
    feed = load_feed("2016", 449244)
    dataset = json.load(open(os.path.join(DATA_DIR, "games-2016.json")))
    row = {r["gamePk"]: r for r in dataset}[449244]
    assert row["isTie"] is True

    game = extract_game(feed, row, "2026-07-28 00:00:00")
    assert game["is_tie"] is True
    assert game["winner_pitcher_id"] is None
    assert game["loser_pitcher_id"] is None
    assert game["away_score"] == game["home_score"] == 1


def test_2016_pitching_fractional_ip():
    from transform import extract_boxscores
    feed = load_feed("2016", 449244)
    batting, pitching = extract_boxscores(feed)
    by_id = {row["mlbam_id"]: row for row in pitching}
    assert by_id[642239]["outs_recorded"] == 11  # "3.2" IP -> 3*3+2


def test_2014_rain_shortened_innings():
    from transform import extract_game
    feed = load_feed("2014", 381964)
    dataset = json.load(open(os.path.join(DATA_DIR, "games-2014.json")))
    row = {r["gamePk"]: r for r in dataset}[381964]
    assert row["innings"] == 5

    game = extract_game(feed, row, "2026-07-28 00:00:00")
    assert game["innings"] == 5
    assert game["detailed_state"] == "Completed Early: Rain"


def test_2006_pitches_have_playid_but_null_tracking():
    from transform import extract_pitches
    feed = load_feed("2006", 39939)
    pitches = extract_pitches(feed, 2006)
    assert len(pitches) > 0
    for pitch in pitches:
        assert pitch["play_id"]
        assert pitch["call_code"] is not None  # ball/strike call is always present
        # 2006 feeds have no pitch-type classification or tracking data
        assert pitch["pitch_type_code"] is None
        assert pitch["start_speed"] is None
        assert pitch["spin_rate"] is None
        assert pitch["zone"] is None
        assert pitch["launch_speed"] is None


def test_2006_plays_have_null_timestamps():
    from transform import extract_plays
    feed = load_feed("2006", 39939)
    plays = extract_plays(feed, 2006)
    assert len(plays) == len(feed["liveData"]["plays"]["allPlays"])
    assert all(p["start_time_utc"] is None and p["end_time_utc"] is None for p in plays)


def test_2020_seven_inning_doubleheader():
    from transform import extract_game
    feed = load_feed("2020", 631470)
    dataset = json.load(open(os.path.join(DATA_DIR, "games-2020.json")))
    row = {r["gamePk"]: r for r in dataset}[631470]
    assert row["doubleHeader"] == "Y"
    assert feed["liveData"]["linescore"]["scheduledInnings"] == 7

    game = extract_game(feed, row, "2026-07-28 00:00:00")
    assert game["innings"] == 7
    assert game["scheduled_innings"] == 7
    assert game["double_header"] == "Y"
    assert game["game_number"] == 1


def test_boxscore_row_counts_match_nonempty_stats():
    from transform import extract_boxscores
    for season, pk in [("2026", 823433), ("2016", 449244), ("2014", 381964), ("2006", 39939)]:
        feed = load_feed(season, pk)
        batting, pitching = extract_boxscores(feed)
        teams = feed["liveData"]["boxscore"]["teams"]
        expected_batting = 0
        expected_pitching = 0
        for side in ("away", "home"):
            for _, p in teams[side]["players"].items():
                stats = p.get("stats", {})
                if stats.get("batting"):
                    expected_batting += 1
                if stats.get("pitching"):
                    expected_pitching += 1
        assert len(batting) == expected_batting, f"{season}/{pk} batting row mismatch"
        assert len(pitching) == expected_pitching, f"{season}/{pk} pitching row mismatch"


def test_extract_officials():
    from transform import extract_officials
    feed = load_feed("2026", 823433)
    officials = extract_officials(feed)
    assert len(officials) == 4
    positions = {o["position"] for o in officials}
    assert "Home Plate" in positions
    for o in officials:
        assert o["game_pk"] == 823433
        assert isinstance(o["mlbam_id"], int)


def test_dims_merge_non_null():
    from transform import merge_non_null
    existing = {"a": 1, "b": None, "c": "keep"}
    new = {"a": 999, "b": 2, "c": "overwritten?"}
    merged = merge_non_null(existing, new)
    assert merged["a"] == 1        # existing non-null wins
    assert merged["b"] == 2        # fills in the missing field
    assert merged["c"] == "keep"   # existing non-null wins


def test_interrupted_at_bat_missing_event_type():
    # gamePk 40465 (2006) has a rain-interrupted at-bat whose `result` carries no
    # eventType/event at all (about.isComplete == False). eventType is NOT NULL in the
    # schema, so the extractor must fall back rather than KeyError or emit None.
    from transform import extract_plays
    feed = load_feed("2006", 40465)
    plays = extract_plays(feed, 2006)
    assert len(plays) == len(feed["liveData"]["plays"]["allPlays"])
    incomplete = [p for p in plays if p["at_bat_index"] == 52]
    assert len(incomplete) == 1
    assert incomplete[0]["event_type"] == "unknown"
    assert incomplete[0]["event"] is None


def test_runners_json_shape():
    from transform import extract_plays
    feed = load_feed("2026", 823433)
    plays = extract_plays(feed, 2026)
    with_runners = [p for p in plays if p["runners"]]
    assert with_runners
    r = with_runners[0]["runners"][0]
    assert set(r.keys()) == {"id", "start", "end", "out", "rbi", "earned"}


if __name__ == "__main__":
    for name, fn in sorted({k: v for k, v in globals().items() if k.startswith("test_")}.items()):
        fn(); print(f"PASS {name}")
