# games-YYYY.json fixtures

Single-row extracts (by `gamePk`) of the historical season datasets that were
dropped from git on 2026-08-05 (`docs/mlb-stats-api/data/games-2006..2025.json`):

- `games-2016.json` — gamePk 449244 (tie game, called early)
- `games-2014.json` — gamePk 381964 (rain-shortened, 5 innings)
- `games-2020.json` — gamePk 631470 (first 7-inning doubleheader, game 1)

Rows are byte-for-byte the dataset rows. Regenerate a full season with:
`python3 scripts/mlb-crawl/build_games_dataset.py --start YYYY --end YYYY`
(`games-2026.json` remains tracked — the live canonical-refresh cron's base.)
