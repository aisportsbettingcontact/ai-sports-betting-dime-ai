# Dime-mapping — nflverse conventions vs Dime AI's NFL 2026 dataset

Task 6 (WS-F), Step 4. Dime-side evidence: the three memory files (paths below), cross-checked
against the actual repo artifacts they describe — `drizzle/nfl.schema.ts`,
`drizzle/0118_dark_gateway.sql`, `shared/kickoffDate.ts`, `scripts/seedNfl2026.mts`, and the seed
JSONs in `scripts/data/nfl-2026/` (`teams.json`, `games.json`, `players.json`, `venues.json`),
counted and spot-checked directly rather than trusted from memory prose alone. nflverse-side
evidence: the `dictionary_*` CSVs dumped in Step 2 (`dictionaries/`) and loader `.Rd` text.

Memory files read:
- `~/.claude/projects/-Users-danielwalker-src-ai-sports-betting-dime-ai/memory/kickoff-datetime-convention.md`
- `~/.claude/projects/-Users-danielwalker-src-ai-sports-betting-dime-ai/memory/nfl-2026-dataset.md`
- `~/.claude/projects/-Users-danielwalker-src-ai-sports-betting-dime-ai/memory/fbs-team-crosswalk.md`

**Pre-flight finding (memory vs. repo mismatch, reported before the table because it affects two
rows below):** `kickoff-datetime-convention.md` states *"Schema shape: `kickoff_utc` (instant),
`kickoff_date` (DATE), `kickoff_time_et` (display)"*. The actual schema
(`drizzle/nfl.schema.ts` `nflGames`, confirmed byte-for-byte in `drizzle/0118_dark_gateway.sql`)
has no `kickoff_time_et` column — only `kickoff_utc` (timestamp), `kickoff_date` (date),
`time_valid` (boolean) are persisted. ET display time is derived at read time from `kickoff_utc`,
not materialized. Rows 1–2 below reflect the **implemented** schema, not the memory's stated
aspiration.

## Comparison table

| # | Concept | Dime convention (evidence) | nflverse equivalent (dictionary evidence) | Verdict | Evidence field(s) |
|---|---|---|---|---|---|
| 1 | Kickoff **date** derivation | `kickoff_date` stored, derived from the `kickoff_utc` instant in **America/Los_Angeles** for real kickoffs, or **America/New_York** for TBD sentinels (`shared/kickoffDate.ts::deriveKickoffDate`) — an explicit, timezone-safe, DST-aware rule with a documented TBD special case | `gameday`: *"The date on which the game occurred"* (character) — no timezone-derivation rule of any kind documented; no TBD-safety carve-out | **Disagree** | `dictionaries/dictionary_schedules.csv` row `gameday` |
| 2 | Kickoff **time** display | Per memory: `kickoff_time_et` should be stored (ET). Per actual schema: **not stored at all** — only derivable at read time from `kickoff_utc`. No dedicated ET-string column exists in `nfl_games` | `gametime`: stored directly, *"represented in 24-hour time and the Eastern time zone, regardless of what time zone the game was being played in"* | **Disagree** (nflverse persists what Dime's own memory says it should, but Dime's implementation doesn't) | `dictionaries/dictionary_schedules.csv` row `gametime`; `drizzle/nfl.schema.ts` (no matching column) |
| 3 | Canonical **UTC instant** | `kickoff_utc` TIMESTAMP, stored directly, NOT NULL on every row incl. TBD sentinels (confirmed in `drizzle/0118_dark_gateway.sql`) | **Absent.** Full 45-field scan of `dictionary_schedules` has no combined date+time UTC instant column — only the separate local-date (`gameday`) + always-ET-time (`gametime`) strings, which would need manual combination/localization to reconstruct one instant | **Absent** in nflverse | Full column list, `dictionaries/dictionary_schedules.csv` |
| 4 | Game **identifier** format | `event_id`: raw ESPN numeric event id, used directly as primary key (e.g. `401872656` for the 2026 wk1 NE@SEA game, confirmed in `scripts/data/nfl-2026/games.json`) | Primary key is `game_id`: composite string `{season}_{2-digit week}_{away}_{home}` (e.g. `2026_01_NE_SEA`), per `dictionary_schedules` + `nflreadr::nflverse_game_id(season, week, away, home)`. nflverse *also* ships a separate `espn` column (numeric) alongside `game_id` in the same schedules row — that column is structurally the same kind of key as Dime's `event_id` | **Disagree** on the primary key shape; **Agree** that both sides also carry a raw-ESPN-numeric game id (nflverse's secondary `espn` column ≈ Dime's primary `event_id`) | `dictionaries/dictionary_schedules.csv` rows `game_id`, `espn`; `nflverse_game_id.Rd` |
| 5 | **ESPN id joins** | Explicit project convention (`fbs-team-crosswalk.md`): *"Join on ESPN numeric team IDs, never on names."* Carried into the NFL schema: `nfl_teams.espn_id` (PK), `nfl_games.away_espn_id`/`home_espn_id`, `nfl_players.athleteId` (= ESPN athlete id) + `teamEspnId` | ESPN id columns are pervasive but package-inconsistent in **declared type**: `dictionary_rosters.espn_id` = numeric; `dictionary_players.espn_id` = character; `dictionary_depth_charts.espn_id` = character (*"ESPN Player ID"*); `dictionary_espn_qbr.player_id` = numeric (*"ESPN Player ID"*); `dictionary_ff_playerids.espn_id` = character, *"usual format is an integer with ~5 digits"* | **Agree** on ESPN-id-as-join-key as a shared principle; note the cross-dictionary type inconsistency (numeric vs character for the same concept) is an nflverse-side wrinkle, not a Dime one | `dictionary_rosters.csv`, `dictionary_players.csv`, `dictionary_depth_charts.csv`, `dictionary_espn_qbr.csv`, `dictionary_ff_playerids.csv`, all `espn_id`/`player_id` rows |
| 6 | Time-validity / **TBD** flag | `time_valid` (boolean, NOT NULL) + `is_tbd` (boolean, default false) stored per game; `is_tbd` games have null team FKs and a `note` (confirmed: 13 TBD playoff-slot rows in `scripts/data/nfl-2026/games.json`, e.g. `eventId 401872910`, `kickoffUtc "2027-01-16T05:00:00Z"` = midnight ET encoded as 05:00Z, matching the memory's TBD-sentinel rule exactly) | **Absent.** No field in `dictionary_schedules`' 45 rows named anything like `tbd`, `time_valid`, or `postponed`. Unplayed/future games are only implied by `away_score`/`home_score` being `NA` (*"Is NA for games which haven't yet been played"*) | **Absent** in nflverse | Full column list, `dictionaries/dictionary_schedules.csv` |
| 7 | **Venue** fields | Normalized `nfl_venues` table: `venue_id` (ESPN-sourced), `name`, `city`, `state`, `country` (non-null only for the 8 international venues), `capacity` (null across the entire source, per memory + schema comment), `indoor`. Joined via `nfl_games.venue_id` / `nfl_teams.venue_id` | Embedded directly in the schedule row, not normalized: `stadium_id` (character) + `stadium` (name) only. No `city`/`state`/`country`/`capacity`/`indoor` venue columns anywhere in `dictionary_schedules`; `roof`/`surface`/`temp`/`wind` are separate **game-level** weather/condition fields, not venue attributes. No `dictionary_venues`/`dictionary_stadiums` exists among the 22 shipped dictionaries | **Disagree** — Dime normalizes venue as its own entity with geo/capacity/indoor attributes; nflverse embeds only an id+name pair per game, no geo/capacity data at all | `dictionaries/dictionary_schedules.csv` rows `stadium_id`, `stadium`, `roof`, `surface`; absence confirmed against full `dictionary_*` listing in `notes.md` |
| 8 | **Roster** size / model | Flat **current-snapshot** table: 2,929 players total (confirmed by counting `scripts/data/nfl-2026/players.json`), one row per player, 9 fields (`athleteId`, `teamEspnId`, `fullName`, `jersey`, `position`, `heightIn`, `weightLb`, `experience`, `hometown`) | `dictionary_rosters` (37 fields) is **season-indexed** — one row per player *per season* (data back to 1920 per `load_rosters.Rd`), not a single current snapshot; `dictionary_players` (39 fields) is the closer one-row-per-player analog but carries far more identity data (`birth_date`, `college_name`, draft info, 9 cross-platform ids) that Dime's `nfl_players` doesn't store at all | **Disagree** — different cardinality model (Dime: current flat snapshot; nflverse: historical season-indexed + separate identity table), and nflverse's identity table is far richer per player | `dictionary_rosters.csv` (season field), `dictionary_players.csv` (full 39-field list); `scripts/data/nfl-2026/players.json` (count=2929, 9 keys) |
| 9 | **Team abbreviation** convention | ESPN-sourced abbreviations stored directly in `nfl_teams.abbreviation`, e.g. (confirmed in `scripts/data/nfl-2026/teams.json`): Rams = `"LAR"`, Commanders = `"WSH"`, Raiders = `"LV"`, Patriots = `"NE"` | `team_abbr_mapping` (143-entry alias→canonical table, package data) canonicalizes historical/alternate names to: Rams = `"LA"`, Commanders = `"WAS"`, Raiders = `"LV"`, Patriots = `"NE"` | **Disagree** for at least 2 of 32 teams (Rams `LAR` vs `LA`; Commanders `WSH` vs `WAS`); **Agree** on the other teams checked (Raiders, Patriots, Packers `GB`, Saints `NO`, Bucs `TB`, 49ers `SF`, Chargers `LAC`) | `nflreadr::team_abbr_mapping` (package data, not a `dictionary_*` CSV — accessed directly since it's the documented canonicalization table); `scripts/data/nfl-2026/teams.json` |
| 10 | Season-phase encoding | `season_type` raw ESPN numeric code (`2`=regular, `3`=postseason) + `week` int, with postseason round (WC/Div/Conf/SB) encoded only in a **code comment**, not a queryable column (`drizzle/nfl.schema.ts`: *"3 = postseason (1 WC, 2 Div, 3 Conf, 5 SB)"*) | `game_type`: character enum column, directly queryable — `REG`, `WC`, `DIV`, `CON`, `SB`. Dictionary explicitly warns: *"`game_type` will differ for weeks >= 18 because of the season expansion in 2021. Please use `game_type` to filter for regular season or postseason"* | **Disagree** — nflverse stores playoff-round as data; Dime stores it as an undocumented-in-schema convention layered onto `week`, only visible in a source comment | `dictionaries/dictionary_schedules.csv` rows `game_type`, `week` |

## What nflverse adds that Dime lacks

Sourced from the field lists actually dumped in Step 2 (`dictionaries/*.csv`), not from memory or
outside knowledge:

- **Betting lines and results, on the schedules frame itself** — the single highest-relevance gap
  for a sports-betting product. `dictionary_schedules` (45 fields) ships `away_score`/`home_score`,
  `result` (home − away), `total` (combined score), `overtime`, `away_moneyline`/`home_moneyline`,
  `spread_line`, `away_spread_odds`/`home_spread_odds`, `total_line`, `over_odds`/`under_odds`, and
  `div_game`. Dime's `nfl_games` table (`drizzle/nfl.schema.ts`) has **none** of these — no score
  columns, no line columns, nothing betting-related at all; it is purely a schedule/metadata table.
- **Play-by-play with derived analytics** (`dictionary_pbp`, 372 fields) — `epa`, `wp`/`wpa`,
  `cpoe`, `success`, `qb_epa`, `air_yards`, `yards_after_catch`, full situational state
  (`down`/`ydstogo`/`yardline_100`/`score_differential`) at play granularity. Dime has no
  play-level data at all.
- **Injury reports** (`dictionary_injuries`, 16 fields, since 2009) — official + practice
  injury/participation status per player per week. No equivalent in Dime's schema.
- **Player contracts** (`dictionary_contracts`, 15 fields, OverTheCap.com) — `value`, `apy`,
  `guaranteed`, `is_active`. No equivalent in Dime.
- **Depth charts** (`dictionary_depth_charts`, 12 fields, weekly since 2001) — `pos_slot`/
  `pos_rank` ordering within position group. No equivalent in Dime (Dime's `nfl_players` has no
  depth-chart-position field).
- **Snap counts** (`dictionary_snap_counts`, 16 fields, since 2012) — offense/defense/special-teams
  snap percentages per player per game. No equivalent in Dime.
- **FTN manual play-charting** (`dictionary_ftn_charting`, 28 fields, since 2022) — pressure,
  motion, play-action, RPO, coverage-shell booleans. No equivalent in Dime.
- **Player/team box-score stats** (`dictionary_player_stats` 114 fields / `dictionary_team_stats`
  102 fields) — full official-box-score-matching stat lines. No equivalent in Dime.
- **NFL Next Gen Stats** (`dictionary_nextgen_stats`, 51 fields, since 2016) — tracking-derived
  metrics (time to throw, air-yards differential, etc). No equivalent in Dime.
- **PFR advanced stats** (`dictionary_pfr_passing`, 28 fields, since 2018/2019) — batted balls,
  bad-throw%, on-target% for passers. No equivalent in Dime.
- **ESPN QBR** (`dictionary_espn_qbr`, 23 fields, since 2006). No equivalent in Dime.
- **Combine** (`dictionary_combine`, 18 fields, since 2000) and **draft picks**
  (`dictionary_draft_picks`, 36 fields, since 1980, including career approximate-value stats). No
  equivalent in Dime (Dime's `nfl_players` carries no draft or combine data whatsoever).
- **Trades** (`dictionary_trades`, 11 fields). No equivalent in Dime.
- **Fantasy layer** — cross-platform player-id crosswalk (`dictionary_ff_playerids`, 35 fields,
  ~20 platforms incl. `sportradar_id`/`yahoo_id`/`sleeper_id`), expert consensus rankings
  (`dictionary_ff_rankings`, 25 fields), and precomputed expected fantasy points
  (`dictionary_ff_opportunity`, 218 fields). No equivalent in Dime.
- **Player identity depth** — `dictionary_players` (39 fields) carries `birth_date`, `college_name`,
  `college_conference`, `high_school`, draft provenance, and 9 distinct cross-platform ids
  (`gsis_id`, `pfr_id`, `pff_id`, `otc_id`, `sportradar_id` via the ff crosswalk, etc). Dime's
  `nfl_players` (9 fields total) has none of these — only `hometown` overlaps in spirit.
