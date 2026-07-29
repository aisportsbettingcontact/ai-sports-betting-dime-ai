# MLB Warehouse 2026 — Provenance & Ingestion Report

**Group:** provenance & ingestion
**Audit time:** 2026-07-29 ~08:40 UTC (01:40 PDT)
**Method:** every claim below comes from an executed aggregate over the full population via
`docs/audits/mlb-model-audit-2026/tools/db-query.mjs` (read-only), plus read-only `git show`
inspection of `origin/main` / `origin/feat/mlb-games-2006-2025`, `gh` (authenticated) for
workflow-run history, and two StatsAPI schedule fetches for ground truth. Zero writes issued.

Companion CSVs (this directory):
- `provenance-loaded-at-batches.csv` — the 3 distinct load batches
- `provenance-loaded-at-by-season.csv` — per-season load stamp + feed_timestamp era split
- `provenance-indexes.csv` — full index inventory (information_schema.statistics)
- `provenance-storage.csv` — exact counts + TiDB storage stats

---

## 1. Verdict summary

The warehouse is a **one-shot batch backfill (2006-2025) + manually bootstrapped 2026 season,
built 2026-07-27 → 2026-07-29 from MLB StatsAPI live feeds**, with a **nightly delta-refresh
GitHub Actions cron (09:00 UTC) that has not yet fired once** as of audit time. The pipeline is
well-engineered (idempotent upserts, manifest-anchored sanity gates, a 6-group production
verifier, committed audit reports), with **one high-severity provenance defect**: the crosswalk
enrichment (br_id / an_player_id / rotowire_id / retrosheet_id on `mlb_people`; all slug/ID
columns on `mlb_franchises`) was applied on 2026-07-29 00:25 UTC and then **silently wiped back
to NULL** by the 01:59 UTC dims re-upsert — and the nightly cron will keep re-wiping any repair.

## 2. loaded_at forensics (mlb_games, full population)

`loaded_at` values are stamped by `scripts/mlb-etl/transform.py` (`datetime.now(timezone.utc)`,
one value per transform invocation) — so they are **UTC "transformed_at" stamps carried through
the NDJSON into the DB**, not DB-write times. Caution: the mysql2-based query tool renders these
naive DATETIMEs with a spurious local-TZ shift; all values below are raw stored values
(`CAST(... AS CHAR)`), which are UTC.

Exactly **3 distinct values** exist across all 49,419 rows — not phased, not incremental:

| loaded_at (UTC) | games | seasons | interpretation |
|---|---:|---|---|
| 2026-07-28 20:43:49 | 45,350 | 2006-2020, 2022-2025 | bulk backfill (single transform of the whole 20-season corpus; DB load followed, run from the feature branch against prod ~21 min after the 20:22 UTC db-push DDL) |
| 2026-07-28 22:40:21 | 2,467 | 2021 | 2021 re-transform + re-upsert immediately preceding commit `1c455b9f` "NULL physically-impossible tracking values (2 known, break_length 2021)" (22:41 UTC). 2021 was in the bulk load too; the upsert's `loaded_at=VALUES(loaded_at)` overwrote its stamp |
| 2026-07-29 01:59:20 | 1,602 | 2026 | initial 2026 season load, right after the 2026 delta crawl finished (max feed stamp 01:31 UTC) and 13 min before commit `fcb85ddd` "refresh 2026 dataset to 1,602 finals" (02:12 UTC) |

Load order within the bulk crawl is recoverable from `feed_timestamp` (below): seasons were
crawled sequentially ascending (2006 → 2009 at 08:45→14:15 UTC on 2026-07-27, ~75-90 min per
~2,460-game season ≈ the crawler's 1 req/s default with ~1s delay + transfer time).

### feed_timestamp semantics

`feed_timestamp` = the live feed's `metaData.timeStamp` (format `YYYYMMDD_HHMMSS`), copied
verbatim by `transform.py` (line 207: `meta.get("timeStamp")`). It is the **Gameday feed version
stamp**. Aggregate era split over all 49,419 rows (zero NULLs):

- **2006-2009 (9,842 games): 100% carry crawl-time stamps** (all in the 2026-07-27
  08:45-14:15 UTC crawl window; 0 in their own season year). StatsAPI serves reconstructed feeds
  for this era with no original stamp — the timeStamp echoes serve time. **Era artifact, not an
  ingestion defect** — but do NOT use feed_timestamp as a game-time proxy pre-2010.
- **2010-2025 (37,975 games): 100% carry genuine in-season stamps** (feed year == season for
  every single row), i.e. the feed's last real-time update, typically minutes after the final out
  (e.g. game 263816, official_date 2010-04-04, feed `20100405_035624`).
- **2026 (1,602): 100% in-season**; recently finished games are stamped near game end (e.g. game
  824489, 2026-07-28, feed `20260729_013126` = 01:31 UTC, the delta-crawl moment).

## 3. Ingestion code (branch `feat/mlb-games-2006-2025`, fully merged into `main`)

The branch is **fully contained in `origin/main`** (its tip `1a965139` is an ancestor;
`git log main..branch` is empty). Two delivery PRs for crawling + two for DB:
**#207** `feat/mlb-2026-feed-crawler` (merged 2026-07-27 08:06 UTC), **#223**
`feat/mlb-canonical-db` (merged 2026-07-29 01:56 UTC), **#224** `fix/mlb-verify-dynamic-total`
(merged 2026-07-29 06:55 UTC). Build followed a subagent-driven task-brief process
(`.superpowers/sdd/task-*-brief.md` referenced as ground truth by the committed audit docs).

### Pipeline stages (all paths on origin/main)

| Stage | Script | Key mechanics |
|---|---|---|
| Season dataset | `scripts/mlb-crawl/build_games_dataset.py` | `GET https://statsapi.mlb.com/api/v1/schedule?...` per season → committed `docs/mlb-stats-api/data/games-YYYY.{json,csv}` (2006-2026; postseason round labels) |
| Feed crawl | `scripts/mlb-crawl/crawl_feeds.py` | `GET https://statsapi.mlb.com/api/v1.1/game/{pk}/feed/live`; **rate limit: default 1.0 s delay/request**; 3 retries w/ 2/4/8 s backoff; 4xx = permanent, no retry; JSON-validated atomic writes (`.tmp` + rename); **resumable** (skips files that already validate against their gamePk); append-only JSONL manifest per run; feed dirs self-gitignored (never committed) |
| Feed verify | `scripts/mlb-crawl/verify_feeds.py` | 100% coverage vs dataset finals (codedState F/O); gamePk echo; final status; linescore score equality vs schedule dataset; allPlays floor (≥40 full game, ≥25 shortened/Completed Early/tie — the two "verifier" fix commits `d99f5bde`, `1a965139` relaxed exactly these); innings ≥5; 9 innings required for full 9-inning finals; exit nonzero on any failure |
| Transform | `scripts/mlb-etl/transform.py` | feeds → NDJSON (`etl-out/{season}/*.ndjson` + `manifest.json`); era-aware tests; builds dim dictionaries (`people/venues/franchises/seasons`) **from the feeds themselves**, merged/deduped across runs; stamps `loaded_at` (UTC) once per invocation |
| Load | `scripts/mlb-etl/load.mts` | raw mysql2 pool (4 conns, compression); **idempotent `INSERT ... ON DUPLICATE KEY UPDATE` on natural PKs** (every table); 1,000-row batches, halved on `ER_NET_PACKET_TOO_LARGE` (floor 50); 3 retries 2/4/8 s; `load-log.jsonl`; **per-season sanity gate**: DB counts must equal `manifest.json` for all 6 season tables or the process aborts nonzero; `--delta` mode swaps to `>=` on `mlb_games` + exact counts scoped to `game_pk IN (this run's pks)` |
| Crosswalk merge | `scripts/mlb-etl/merge_crosswalks.mts` | UPDATE-only, never overwrites non-null, from 17 legacy tables (`mlb_teams`, `mlb_players`, `mlb_lineups`, `mlb_hr_props`, `mlb_strikeout_props`, ...); also populates `mlb_schedule_history.gamePk`; report committed at `docs/audits/2026-07-28-mlb-merge-report.md` |
| DB verify | `scripts/mlb-etl/verify_db.mts` | 6 read-only groups: (1) per-season games == dataset finals, grand total == dataset (floor 49,414 — made dynamic by `fcb85ddd` because "DB grows nightly"); (2) manifest vs DB counts for plays/pitches/boxscores/officials; (3) FK orphan checks, all must be zero; (4) score cross-foot vs dataset; (5) seeded (mulberry32) era sample 25/season incl. zero-fill guard ("NULL is fine, 0 is not"); (6) EXPLAIN index-usage smoke. Writes `verify-db-report.json`, nonzero exit on failure |
| Nightly refresh | `scripts/mlb-etl/refresh_canonical.mts` | rebuild games-2026.json from StatsAPI → diff finals (F/O) against `SELECT game_pk FROM mlb_games WHERE season=2026` → crawl only missing pks (temp shard) → transform → `load.mts --season 2026 --delta` → inline scoped FK-orphan + score cross-foot verification. Core diff (`computeMissingGames`) is unit-tested |

An independent, read-only final audit of the initial load is committed at
`docs/audits/2026-07-28-mlb-final-audit.md` (all 21 seasons matched dataset finals exactly;
grand total 49,414 at that time; now 49,419 after the +5-final 2026 refresh — consistent).

## 4. Freshness & forward maintenance

- **Finals-only warehouse by design**: crawler/refresh ingest only codedState F/O. Status
  distribution over all 49,419 rows: `F` 49,291; `FR` 121; `FO` 2; `O` 2; `FW`/`FT`/`FG` 1 each.
  **No scheduled / in-progress / future games exist** (StatsAPI lists 16 games scheduled for
  2026-07-29; warehouse correctly has zero).
- **MAX(official_date) = 2026-07-28** (status F and O); 2026 holds 1,599 F + 1 FR + 2 O = 1,602.
- **Currency at audit time**: 2026-07-27 is complete (11/11 StatsAPI finals present; the 12th
  scheduled game was postponed, codedState D, correctly excluded). 2026-07-28 has **5 of 15
  StatsAPI finals** — the last load ran at 01:59 UTC (= 6:59 PM PT on 7-28), before the evening
  games finished. Expected lag ≤ 1 nightly cycle.
- **Maintainer**: `.github/workflows/cron-mlb-canonical-refresh.yml` — schedule `0 9 * * *`
  (09:00 UTC nightly) + `workflow_dispatch`, concurrency-guarded, runs
  `refresh_canonical.mts` end-to-end with repo secret `DATABASE_URL`. The runner always starts
  with empty gitignored feed dirs, so it only crawls the delta. The committed
  `games-2026.json` intentionally goes stale ("the production database, not the committed
  dataset file, is the thing this workflow keeps fresh").
- **The cron has NEVER run**: `gh run list --workflow=cron-mlb-canonical-refresh.yml` returns
  zero runs (authenticated). It landed on main 2026-07-29 06:55 UTC; its first scheduled fire is
  09:00 UTC today — ~20 min after this audit. All 2026 rows so far came from manual invocations.
  **Watch the first run.**
- **No app-runtime writer**: `git grep` over `origin/main` finds no `server/` code referencing
  the warehouse tables (only `drizzle/mlb.schema.ts`, migration snapshots, and one audit
  script). The legacy `cron-mlb-cycle.yml` / `runMlbCycleOnce()` path writes only the model
  tables (`mlb_lineups`, `mlb_strikeout_props`, `mlb_game_backtest`), not the warehouse.

## 5. Consistency with pre-existing app tables (read-only)

| Check | Expected | Observed | Verdict |
|---|---|---|---|
| `mlb_schedule_history` rows | ~10,501 | **10,501** | intact |
| `mlb_schedule_history` dkClosing rows | ~940 | **940** (any dkClosing* non-null) | intact |
| `mlb_schedule_history.gamePk` | new column | present; **8,936/10,501 populated** by crosswalk merge (1,565 unmatched, per merge report) | intended addition (migration 0119, commit `2764a8cf`); DDL at 2026-07-28 20:22:07 UTC |
| `mlb_strikeout_props` | ≥2,883 | **2,992** | present, grown (actively maintained) |
| `mlb_hr_props` | ≥17,505 | **18,415** (exact count; info_schema estimate 18,408) | present, grown |
| `mlb_game_backtest` | ≥21,212 | **21,302** | present, grown |
| `mlb_replay_*` | present | `mlb_replay_grades` 142,048; `mlb_replay_prop_projections` 92,972; `mlb_replay_projections` 4,919; `mlb_replay_linescores` 1,555 (all CREATE_TIME 2026-07-25, predating warehouse work) | present |

TiDB does not populate `information_schema.UPDATE_TIME` (NULL for every table), so "not
altered" cannot be proven from that column; evidence is row counts meeting/exceeding floors,
intact dkClosing data, and CREATE_TIMEs. The only structural change to a legacy table is the
intended `mlb_schedule_history.gamePk` addition (its CREATE_TIME 2026-07-28 20:22:07 reflects
that ALTER in the same db-push as the warehouse tables). The merge report also documents a
known pre-existing legacy defect it deliberately did NOT touch (away/home team-identity
reversal, ~3,642 schedule_history rows, 2023-2025).

## 6. Storage mechanics (TiDB)

All 10 tables report engine InnoDB / row_format Compact (TiDB compatibility shim), collation
`utf8mb4_bin`, and **TIDB_PK_TYPE = CLUSTERED** on natural keys — no surrogate/auto-increment
keys anywhere. Exact `COUNT(*)` vs stats estimate, and sizes:

| table | exact rows | data | index | notes |
|---|---:|---:|---:|---|
| mlb_pitches | 14,495,317 | 2.78 GB | 1.07 GB | PK play_id (varchar); idx game_pk; idx (pitcher_id, season); idx (batter_id, season) |
| mlb_plays | 3,767,228 | 511 MB | 150 MB | PK (game_pk, at_bat_index); idx batter_id; idx pitcher_id; idx event_type |
| mlb_boxscore_batting | 1,186,159 | 180 MB | 38 MB | PK (game_pk, mlbam_id, **team_id**); idx mlbam_id |
| mlb_boxscore_pitching | **408,375** | 69 MB | 16 MB | PK (game_pk, mlbam_id, **team_id**); idx mlbam_id. Stats estimate 505,588 is stale (+24%) |
| mlb_officials | 199,165 | 3.2 MB | 3.2 MB | PK (game_pk, mlbam_id) — **no `position` in PK** (brief said otherwise) |
| mlb_games | 49,419 | 10.8 MB | 2.9 MB | PK game_pk; idx official_date; (season, game_type); (away_team_id, season); (home_team_id, season); venue_id |
| mlb_people | 6,425 | 0.4 MB | 0 | PK mlbam_id |
| mlb_venues | 55 | — | 0 | PK venue_id |
| mlb_franchises | 32 | — | 0 | PK team_id |
| mlb_seasons | 21 | — | 0 | PK season; games_expected populated all 21 seasons (2,430/2,431-ish; 2020=900); postseason_end NULL only for 2026 (in progress) |

Total ≈ 3.55 GB data + 1.28 GB index. DDL timeline: 8 tables created 2026-07-28 20:22:01-07 UTC
(db-push of migration `0119_superb_the_call.sql`); both boxscore tables **recreated 23:09 UTC**
by the PK rebuild (`601c1490` — team_id added to PK after player-on-both-teams game 746942) and
reloaded. Full index inventory: `provenance-indexes.csv`.

## 7. Defects & caveats (ranked)

1. **HIGH — crosswalks wiped by dims re-upsert; nightly cron will keep wiping them.**
   Full-population aggregates: `mlb_people` br_id / an_player_id / rotowire_id / retrosheet_id
   non-null counts = **0 / 0 / 0 / 0** (of 6,425); `mlb_franchises` vsin_slug / an_slug /
   an_team_id / br_abbrev / mlb_code / db_slug non-null = **all 0** (of 32). Yet the committed
   merge report (`docs/audits/2026-07-28-mlb-merge-report.md`, generated 2026-07-29T00:25Z,
   post-merge verification) proves 30 franchise rows (180 cells), 1,400 br_id, 862 rotowire_id,
   812 an_player_id, 35 retrosheet_id landed. Mechanism: `load.mts` dim specs include the
   crosswalk columns; transform's feed-derived dims NDJSON has them absent → `toRow()` nulls →
   `ON DUPLICATE KEY UPDATE col=VALUES(col)` overwrites non-null with NULL. The 01:59 UTC 2026
   load (dims loaded first, every invocation) wiped them; every nightly `--delta` run re-loads
   dims from that night's feeds and will re-wipe any restored subset. `mlb_schedule_history.gamePk`
   (8,936) survived only because the loader never touches that table. Fix: re-run
   `merge_crosswalks.mts` (it is exactly re-runnable) AND make the dim upsert
   crosswalk-preserving (e.g. `col=COALESCE(VALUES(col), col)` or drop crosswalk columns from
   the update clause).
2. **MEDIUM — `O`-status rows are never revisited.** `refresh_canonical.mts` diffs on
   `game_pk` existence only; a game ingested while `codedGameState='O'` (Game Over, pre-final
   certification) already exists, so it is never re-crawled: status stays `O` and late-final
   fields (decisions, attendance, corrections) freeze at crawl-time. Current exposure: 2 rows
   (games 823838, 824243, official_date 2026-07-28, crawled 01:03-01:07 UTC). Self-limiting in
   count but permanent per row.
3. **LOW — `loaded_at` is transform time, not DB-write time.** Stamped once per `transform.py`
   run; actual insert time (and the 23:09 UTC boxscore reload) is invisible in-row. Treat as
   batch/lineage ID, not a write clock. Also beware naive-DATETIME TZ shifting in mysql2 clients.
4. **LOW — stale TiDB stats on `mlb_boxscore_pitching`**: estimate 505,588 vs exact 408,375
   (the "506K" figure circulating in briefs is the stale estimate). `mlb_pitches` estimate off
   by 2,127. An `ANALYZE TABLE` (by an authorized operator — not this audit) would fix.
5. **INFO — era caveat**: `feed_timestamp` for 2006-2009 is crawl-time (see §2) — era-absent
   original stamps, not an ingestion defect.
6. **INFO — cron unproven**: zero runs of `cron-mlb-canonical-refresh.yml` as of 08:40 UTC;
   first scheduled fire 09:00 UTC 2026-07-29. Until it passes once, 2026 currency depends on
   manual runs.
7. **INFO — keying drift vs brief**: `mlb_officials` PK is (game_pk, mlbam_id), not
   (game_pk, mlbam_id, position); `load.mts` boxscore TableSpec `pk` arrays omit team_id
   (harmless for upsert correctness — team_id=VALUES(team_id) is a no-op — but drifts from the
   deployed 3-column PK).
