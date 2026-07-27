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
