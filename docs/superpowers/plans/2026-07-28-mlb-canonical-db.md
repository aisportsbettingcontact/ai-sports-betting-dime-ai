# MLB Canonical Database Implementation Plan (Phases 0–3 + verification)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load the verified 2006–2026 feed corpus (49,414 finals as of 2026-07-27) into Railway production MySQL as the canonical MLB database, and merge every valuable identifier/row from the 17 legacy MLB tables with a fully audited, no-loss process.

**Architecture:** Forensic audit gates everything → new `drizzle/mlb.schema.ts` (9 snake_case natural-PK tables, CFB/NFL convention) → local Python transforms (feeds → per-season NDJSON) → TypeScript batch loader (mysql2, upsert, resumable) → crosswalk merge from legacy tables → SQL invariant verification + independent audit.

**Tech Stack:** Python 3 stdlib (transforms), Drizzle + mysql2 via `npx tsx` .mts scripts (schema/loader/verifier — precedent: `scripts/seedCfb2026.mts`), GitHub Actions `db-push.yml` for schema deploy.

**Spec:** `docs/superpowers/specs/2026-07-27-mlb-canonical-database-design.md` (approved).

## Global Constraints

- Corpus is truth; legacy data is never deleted or overwritten — merge adds columns/rows, DEPRECATE = archived to file + noted, never dropped.
- All canonical tables: snake_case, natural PKs, no autoincrement surrogate ids (CFB/NFL convention).
- Loader/verifier read `DATABASE_URL` from env (present in local `.env`); **never print, log, or commit the URL or credentials**.
- Schema reaches production ONLY via the manual `db-push.yml` workflow (repo law), run BEFORE any loader.
- Loader batches ≤ 1,000 rows/INSERT, ≤ 4 concurrent connections, season-by-season, resumable; must not degrade the live 5-minute MLB cycle (pause if `games` writes stall).
- Row invariants at completion: `mlb_games` = finals in `games-*.json` datasets (49,414 as of 2026-07-27 refresh: 49,403 + 11); `mlb_plays` = Σ feed `allPlays`; `mlb_pitches` = Σ pitch events (all playId-keyed); zero orphan FKs.
- No feed JSON, NDJSON output, or audit exports containing bulk data get committed (gitignored dirs).
- TypeScript strict: `npx tsc --noEmit` passes; Python tests via plain-assert files (crawl precedent).

---

### Task 0: Phase 0 forensic audit (operational, read-only, GATING)

No code written. Dispatch an audit supervisor subagent (read-only DB + repo access) to produce two committed documents:

**A. `docs/audits/2026-07-28-mlb-column-disposition.md`** — every column of the 17 legacy MLB tables (`drizzle/schema.ts` lines: games:287 MLB-only cols per `server/routers.ts:94-128`, mlb_teams:893, mlb_players:935, mlb_lineups:1039, odds_history:982, mlb_strikeout_props:1149, mlb_pitcher_stats:1240, mlb_team_batting_splits:1326, mlb_pitcher_rolling5:1398, mlb_park_factors:1464, mlb_bullpen_stats:1511, mlb_umpire_modifiers:1553, mlb_hr_props:1583, mlb_game_backtest:1647, mlb_model_learning_log:1735, mlb_drift_state:1771, mlb_calibration_constants:1809, mlb_schedule_history:1933) dispositioned RETAIN / DERIVE / CROSSWALK / DEPRECATE with one-line rationale each. 100% column coverage is the gate.

**B. `docs/audits/2026-07-28-mlb-reconciliation.md`** — row-level cross-reference (read-only SQL against production via `DATABASE_URL` + local corpus datasets):
- every `games` row `sport='MLB'` joined to dataset by `mlbGamePk` (fallback `gameDate`+teams+`gameNumber`): count matched/unmatched; score/status/DH mismatches listed with gamePks
- every `mlb_schedule_history` row mapped to a gamePk by date+AN-slug-crosswalked teams+gameNumber; unmatched listed
- `mlb_players`: counts with/without `mlbamId`; null-mlbamId rows enumerated
- `mlb_lineups`/`mlb_strikeout_props`/`mlb_hr_props`: distinct `*MlbamId`/`rotowireId`/`anPlayerId` counts available for crosswalk harvest

Adjudication rule for mismatches: corpus wins for DERIVE fields; discrepancies in RETAIN fields are findings for the owner. Merge tasks (5) may not run until both docs are committed.

### Task 1: Canonical schema — `drizzle/mlb.schema.ts`

**Files:** Create `drizzle/mlb.schema.ts`; Modify `drizzle.config.ts:10` (add to schema array); generate migration via `npx drizzle-kit generate` (commit the SQL, CFB precedent 0117).

**Tables (exact columns; types follow CFB/NFL schema idiom — `varchar` lengths shown, `int`/`decimal(6,2)`/`json`/`date`/`datetime`/`boolean`):**

- `mlb_seasons`: `season` int PK; `regular_season_start` date, `regular_season_end` date, `postseason_end` date null, `games_expected` int, `notes` varchar(255) null.
- `mlb_franchises`: `team_id` int PK (statsapi); `name` varchar(120), `abbrev` varchar(8), `league` varchar(4) null, `division` varchar(16) null, `active` boolean, `first_season` int null, `last_season` int null; crosswalks (all null): `vsin_slug` varchar(64), `an_slug` varchar(64), `an_team_id` int, `br_abbrev` varchar(8), `mlb_code` varchar(8), `an_logo_slug` varchar(64), `db_slug` varchar(64).
- `mlb_venues`: `venue_id` int PK; `name` varchar(120), `active` boolean null, `capacity` int null, `turf_type` varchar(32) null, `roof_type` varchar(32) null, `left_line` int null, `left_field` int null, `left_center` int null, `center` int null, `right_center` int null, `right_field` int null, `right_line` int null, `city` varchar(80) null, `state` varchar(40) null, `timezone` varchar(48) null.
- `mlb_people`: `mlbam_id` int PK; `full_name` varchar(120), `first_name` varchar(60) null, `last_name` varchar(60) null, `primary_position` varchar(8) null, `bat_side` char(1) null, `pitch_hand` char(1) null, `birth_date` date null, `mlb_debut` date null, `active` boolean null, `is_umpire` boolean default false; crosswalks (all null): `br_id` varchar(16), `an_player_id` int, `rotowire_id` int, `retrosheet_id` varchar(16).
- `mlb_games`: `game_pk` int PK; `game_guid` varchar(64) null, `season` int, `game_type` char(1), `series_description` varchar(48) null, `official_date` date, `game_datetime_utc` datetime, `day_night` varchar(8) null, `double_header` char(1), `game_number` int, `games_in_series` int null, `series_game_number` int null, `status_code` varchar(4), `detailed_state` varchar(48), `is_tie` boolean default false, `away_team_id` int, `home_team_id` int, `away_score` int, `home_score` int, `away_hits` int null, `home_hits` int null, `away_errors` int null, `home_errors` int null, `innings` int, `scheduled_innings` int null, `venue_id` int null, `attendance` int null, `duration_minutes` int null, `first_pitch_utc` datetime null, `weather_condition` varchar(48) null, `temp_f` int null, `wind` varchar(64) null, `winner_pitcher_id` int null, `loser_pitcher_id` int null, `save_pitcher_id` int null, `gameday_type` char(1) null, `feed_timestamp` varchar(16) (metaData.timeStamp — revision provenance), `loaded_at` datetime. Indexes: `(official_date)`, `(season, game_type)`, `(away_team_id, season)`, `(home_team_id, season)`, `(venue_id)`.
- `mlb_plays`: PK (`game_pk`,`at_bat_index`); `inning` int, `half` varchar(6), `batter_id` int, `pitcher_id` int, `bat_side` char(1) null, `pitch_hand` char(1) null, `event_type` varchar(48), `event` varchar(64) null, `description` text null, `rbi` int, `away_score` int, `home_score` int, `is_scoring_play` boolean, `has_out` boolean null, `outs_end` int null, `balls_end` int null, `strikes_end` int null, `men_on_base_split` varchar(16) null, `start_time_utc` datetime null, `end_time_utc` datetime null, `runners` json null, `pitch_count` int. Indexes: `(batter_id)`, `(pitcher_id)`, `(game_pk)` implicit via PK prefix, `(event_type)`.
- `mlb_pitches`: `play_id` varchar(40) PK; `game_pk` int, `season` int, `at_bat_index` int, `pitch_number` int, `batter_id` int, `pitcher_id` int, `is_pitch` boolean default true, `call_code` varchar(4) null, `call_description` varchar(48) null, `pitch_type_code` varchar(4) null, `pitch_type` varchar(32) null, `type_confidence` decimal(4,2) null, `balls` int null, `strikes` int null, `start_speed` decimal(5,2) null, `end_speed` decimal(5,2) null, `spin_rate` int null, `extension` decimal(5,2) null, `plate_time` decimal(5,3) null, `px` decimal(6,3) null, `pz` decimal(6,3) null, `zone` int null, `sz_top` decimal(5,3) null, `sz_bot` decimal(5,3) null, `break_angle` decimal(6,2) null, `break_length` decimal(6,2) null, `break_vertical` decimal(6,2) null, `break_horizontal` decimal(6,2) null, `is_in_play` boolean null, `launch_speed` decimal(5,2) null, `launch_angle` decimal(5,2) null, `total_distance` int null, `trajectory` varchar(32) null, `hit_coord_x` decimal(7,2) null, `hit_coord_y` decimal(7,2) null. Indexes: `(game_pk)`, `(pitcher_id, season)`, `(batter_id, season)`.
- `mlb_boxscore_batting` / `mlb_boxscore_pitching`: PK (`game_pk`,`mlbam_id`); batting: `team_id` int, `batting_order` int null, `position` varchar(8) null, `ab` int, `r` int, `h` int, `doubles` int, `triples` int, `hr` int, `rbi` int, `bb` int, `so` int, `hbp` int, `sb` int, `cs` int, `lob` int null, `sac_bunts` int, `sac_flies` int; pitching: `team_id` int, `outs_recorded` int, `batters_faced` int, `h` int, `r` int, `er` int, `bb` int, `so` int, `hr` int, `pitches` int null, `strikes` int null, `win` boolean, `loss` boolean, `save` boolean, `hold` boolean null. Index both: `(mlbam_id, game_pk)` covered by PK reorder — add `(mlbam_id)`.
- `mlb_officials`: PK (`game_pk`,`mlbam_id`); `position` varchar(24).

**Steps:** write schema → `npx tsc --noEmit` → `npx drizzle-kit generate` → inspect generated SQL (no drops of existing tables — hard check) → commit schema + migration.

### Task 2: Transform — `scripts/mlb-etl/transform.py` + tests

Feeds → NDJSON per table per season into gitignored `docs/mlb-stats-api/data/etl-out/{season}/{table}.ndjson`.

Core mapping rules (complete, era-aware):
- `mlb_games` row from `gameData` + `liveData.linescore` + `decisions` + dataset row (isTie, seriesDescription come from `games-{season}.json`, joined by gamePk — feeds lack seriesDescription).
- `mlb_plays` from `allPlays`: `pitch_count` = count of playEvents with `isPitch`; `runners` = compact JSON `[{id,start,end,out,rbi,earned}]`; timestamps nullable (pre-2008 gaps).
- `mlb_pitches` from playEvents where `isPitch` true AND `playId` present; `season` denormalized from game; nullable tracking fields — absent keys → NULL, never 0.
- Boxscores from `liveData.boxscore.teams.{away,home}.players[*].stats` (skip players with empty stats blocks); `outs_recorded` from `inningsPitched` string (e.g. "5.2" → 17 outs: `int(ip)*3 + int(frac)`).
- `mlb_officials` from `liveData.boxscore.officials`.
- People/venues/franchises emitted as dedup dictionaries accumulated across seasons (single `dims.ndjson` set at the end): people from `gameData.players` + officials; venues from `gameData.venue`; franchises from `gameData.teams` (id, name, abbrev, league/division when present).
- Emit per-season `manifest.json`: `{games, plays, pitches, batting_rows, pitching_rows, officials}` counts — the loader and verifier reconcile against these.

**Tests (`scripts/mlb-etl/test_transform.py`, plain asserts):** fixture-driven against real feeds on disk: 823433 (modern, ABS-era), 449244 (2016 tie), 381964 (2014 rain-shortened), one 2020 7-inning DH game (find via dataset `scheduledInnings`), one 2006 feed (39939). Assert: play/pitch counts match feed sums; tie game emits `is_tie` true and no winner; shortened game innings correct; 2006 pitches have playIds but NULL tracking fields where absent; IP "5.2" → 17 outs.

### Task 3: Loader — `scripts/mlb-etl/load.mts`

mysql2/promise, reads `DATABASE_URL` from env (never logged). For each season (arg `--season` or `--all` ordered 2006→2026): for each table in dependency order (`mlb_seasons`, `mlb_franchises`, `mlb_venues`, `mlb_people`, `mlb_games`, `mlb_plays`, `mlb_pitches`, `mlb_boxscore_batting`, `mlb_boxscore_pitching`, `mlb_officials`): stream NDJSON, batch 1,000 rows, `INSERT ... ON DUPLICATE KEY UPDATE` (idempotent), per-batch retry ×3 with backoff, progress line every 25k rows, per-season load report appended to `etl-out/load-log.jsonl` (rows read vs upserted per table). Resumable = re-run is safe by upsert semantics; `--table` filter for retries. After each season: sanity `SELECT COUNT(*)` per table `WHERE season=?` (games/pitches) reconciled to the season manifest; abort on mismatch.

### Task 4: Verification suite — `scripts/mlb-etl/verify_db.mts`

Read-only SQL against production; exits non-zero on any failure; writes `etl-out/verify-db-report.json`:
1. `mlb_games` count per season == dataset finals per season (reads `games-{season}.json` locally); grand total == 49,414.
2. `mlb_plays` count per season == manifest plays; `mlb_pitches` == manifest pitches; boxscore/officials same.
3. FK orphans: plays without game, pitches without play (join on game_pk+at_bat_index), boxscore rows without game or person, officials without person — all zero.
4. Score cross-foot: for every season, `SUM(away_score+home_score)` in `mlb_games` == Σ dataset scores; sampled 50 games/season: game score == MAX(play away/home score) from `mlb_plays`.
5. Sampled era checks (seeded, 25/season): pitch playId uniqueness, `season` denorm matches game, no zero-filled tracking values where feed had NULL.
6. Perf smoke: EXPLAIN on the two consumer-shaped queries (team season schedule by date; pitcher season pitches) — must use indexes.

### Task 5: Crosswalk merge — `scripts/mlb-etl/merge_crosswalks.mts` (gated on Task 0 docs)

Idempotent UPDATE-only merge (adds identifiers; never overwrites non-null canonical values):
- legacy `mlb_teams` → `mlb_franchises` crosswalk columns (join `mlbId` == `team_id`); report rows where `mlbId` is null (finding, not silent skip).
- legacy `mlb_players` → `mlb_people.br_id` (join `mlbamId`); null-mlbamId legacy rows exported to `docs/audits/2026-07-28-unmatched-legacy-players.csv` (committed — small).
- `mlb_lineups` pitcher/batter RotoWire+MLBAM pairs and `mlb_hr_props`/`mlb_strikeout_props` (`anPlayerId`,`retrosheetId`) harvested → `mlb_people.rotowire_id`/`an_player_id`/`retrosheet_id` (first-seen wins; conflicts reported).
- `mlb_schedule_history`: add nullable `game_pk` column (schema change rides Task 1 migration — `ALTER` included there), populate by date+slug-crosswalk+gameNumber; unmatched rows listed in reconciliation v2.
- Output: `docs/audits/2026-07-28-mlb-merge-report.md` (counts per crosswalk, conflicts, unmatched) — commit.

### Task 6: Execution runbook (operational)

1. Task 0 audit dispatched (background) — runs parallel to Tasks 1–4 implementation; **gates Task 5 only**.
2. Task 1 schema merged to branch → run `gh workflow run db-push.yml --ref <branch>` → confirm tables exist (information_schema query) before loading.
3. Transform all seasons locally (~30–60 min CPU-bound).
4. Load seasons 2006→2026 sequentially (~2–4 h) with the live-pipeline health check between seasons (`SELECT MAX(lastUpdated) FROM games WHERE sport='MLB'` must stay < 15 min old; else pause).
5. Run Task 4 verifier — must be fully green.
6. Task 5 merge (audit-gated) → reconciliation v2 → commit audit docs.
7. Independent final-audit subagent re-derives invariants from production with no access to implementation notes; report committed.
8. PR; owner merges; memory updated.

## Risks / Unknowns

- Railway MySQL max_allowed_packet / rate limits on 1,000-row batches — loader halves batch size on packet errors.
- `mlb_schedule_history` AN slugs may not map 1:1 to franchises for relocations (A's) — crosswalk table carries `db_slug` from legacy `mlb_teams` to absorb this; unmatched = findings.
- Pre-2008 feeds: some fields absent — transforms treat absence as NULL by construction; tests pin this.
- Load window vs live pipeline: run outside peak game hours if health check trips repeatedly.

## Out of Scope (later plans)

Consumer read migration (Phase 4), nightly freshness cron (Phase 5 — currently manual refresh commands, proven 2026-07-28), legacy table deprecation/archival execution, model retraining on deep history.
