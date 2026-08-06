# Schema summary — nflverse core data frames

Task 6 (WS-F), Step 3. Source: `nflreadr` 1.5.1 `dictionary_*` datasets dumped verbatim to
`dictionaries/*.csv` (Step 2), plus loader `.Rd` files rendered via `tools::Rd2txt()` for
"documented seasons coverage" claims. Every field name and coverage claim below is sourced from
one of those two evidence types — none is inferred or remembered from outside knowledge. Field
counts are `nrow()` of the shipped dictionary (== the CSV row count in `dictionaries/`).

All 22 `dictionary_*` datasets shipped by nflreadr 1.5.1 are covered (not just the brief's named
minimum), plus two frames that have loaders but **no** shipped dictionary (`teams`,
`rosters_weekly`) and one lookup table that isn't a field dictionary at all (`roster_status`).

---

## 1. Play-by-play — `dictionary_pbp`

- **Loader:** `nflreadr::load_pbp()` (also re-exported as `nflfastR::load_pbp`)
- **Field count:** 372 (largest dictionary in the package)
- **Documented seasons coverage:** load_pbp.Rd, `seasons` arg — *"defaults to latest season. If
  set to `TRUE`, returns all available data since 1999."*
- **Key fields:**
  | field | meaning |
  |---|---|
  | `play_id` | Numeric play id; with `game_id`+`drive` forms the unique play key |
  | `game_id` | Game identifier (see game-id note below) |
  | `posteam` / `defteam` | Team abbreviation with possession / on defense |
  | `down` / `ydstogo` / `yardline_100` | Down-and-distance state |
  | `epa` | Expected points added by the posteam on the play |
  | `wp` / `wpa` | Win probability for posteam at play start / added by the play |
  | `cpoe` | Completion % over expected (pass plays) |
  | `desc` | Human-readable play description |
- **Note (data-quality observation, not a Dime-mapping item):** `dictionary_pbp` documents
  `game_id` as `type=character`, description *"Ten digit identifier for NFL game."* — but the
  live format (confirmed via `nflreadr::nflverse_game_id(season, week, away, home)`, Rd example
  `nflverse_game_id(2022, 2, "LAC", "KC")`) is the underscore-joined human-readable string, not a
  10-digit number. `dictionary_schedules`' own `game_id` row has the *correct* prose description
  (season_week_away_home) but declares `type=numeric`, which is also wrong for a string with
  letters and underscores. The two shipped dictionaries disagree with each other and each is
  internally inconsistent (description vs. declared type) for the same field name. Filed as a
  gap/observation in `notes.md`, not asserted as fact beyond what's shown.

## 2. Schedules/games — `dictionary_schedules`

- **Loader:** `nflreadr::load_schedules()` (also re-exported as `nflfastR::load_schedules`,
  `nflseedR::load_schedules`)
- **Field count:** 45
- **Documented seasons coverage:** load_schedules.Rd, `seasons` arg — *"default `TRUE` returns
  all available data"* (no explicit start year stated in this Rd). Corroborating evidence:
  `nflverse_game_id.Rd` documents its `season` argument as *"4 digit season between 1999 and the
  output of `most_recent_season()`"* — the general nflverse game-id convention is anchored at
  1999, consistent with `load_pbp()`'s explicit 1999 floor, but this is not stated verbatim in
  `load_schedules.Rd` itself, so it is cited separately rather than conflated.
- **Key fields:**
  | field | meaning |
  |---|---|
  | `game_id` | Primary game key: `{season}_{2-digit week}_{away}_{home}` |
  | `gameday` | Calendar date the game occurred (character) |
  | `gametime` | Kickoff time, 24-hour clock, **always Eastern time regardless of game's actual venue timezone** |
  | `away_team` / `home_team` | Team abbreviations |
  | `espn` | ESPN's numeric id for the game |
  | `stadium_id` / `stadium` | Venue identifier / name |
  | `roof` / `surface` | Stadium roof status, playing surface |
  | `old_game_id`, `gsis`, `nfl_detail_id`, `pfr`, `pff` | Cross-source game id columns (also present, not in the 5-8 above) |

## 3. Teams — no shipped dictionary (documentation gap)

- **Loader:** `nflreadr::load_teams(current = TRUE)` — fetches team graphics/colors/logos.
  **Not called** (network loader; out of scope per run constraints).
- **Field count:** unknown from offline evidence. `load_teams.Rd` `\value` section is qualitative
  only: *"A tibble of team-level image URLs and hex color codes."* No `dictionary_teams` dataset
  exists among the 22 (confirmed by full listing in `notes.md`), so nflreadr itself does not
  field-document this frame anywhere offline.
- **Substitute evidence found:** `nflfastR` ships a *static*, non-exported, Rd-documented dataset
  `teams_colors_logos` (confirmed present via `tools::Rd_db("nflfastR")`, not part of
  `getNamespaceExports` so correctly absent from `exports.csv`). Its `\format` block lists 15
  named fields: `team_abbr`, `team_name`, `team_id`, `team_nick`, `team_conf`, `team_division`,
  `team_color`, `team_color2`, `team_color3`, `team_color4`, `team_logo_wikipedia`,
  `team_logo_espn`, `team_wordmark`, `team_conference_logo`, `team_league_logo` — while its own
  prose header claims *"A data frame with 36 rows and 10 variables"* (15 are actually listed; a
  documentation inconsistency in the upstream Rd itself, reported as observed).
- **Seasons coverage:** not applicable — current-snapshot reference table, not season-indexed.

## 4. Rosters (season-level) — `dictionary_rosters`

- **Loader:** `nflreadr::load_rosters()` (also re-exported as `nflfastR::load_rosters`)
- **Field count:** 37
- **Documented seasons coverage:** load_rosters.Rd, `seasons` arg — *"defaults to returning this
  year's data if it is March or later... If set to `TRUE`, will return all available data. Data
  available back to 1920."*
- **Key fields:**
  | field | meaning |
  |---|---|
  | `season` / `team` / `position` | Season-team-position key columns |
  | `full_name` | Player full name |
  | `gsis_id` | NFL GSIS id — primary play-by-play join key |
  | `espn_id` | Player id for ESPN API (type declared **numeric** here) |
  | `status` | Roster status (Active/Inactive/IR/Practice Squad/...; see `dictionary_roster_status` below) |
  | `jersey_number` | Numeric jersey number |
  | `height` / `weight` | Declared **character** type (not numeric) in this dictionary |

## 5. Rosters (weekly) — loader exists, no dictionary reference documented

- **Loader:** `nflreadr::load_rosters_weekly()`
- **Field count:** none shipped; `load_rosters_weekly.Rd` has no "See Also" pointer to any
  `dictionary_*` (unlike `load_rosters()`, which explicitly cross-references
  `dictionary_rosters`). Treated as a documentation gap — column overlap with
  `dictionary_rosters` is plausible but **not asserted** since it isn't documented.
- **Documented seasons coverage:** *"defaults to returning this year's data if it is March or
  later. If set to `TRUE`, will return all available data. Data available back to 2002."*

## 6. Players (immutable identity) — `dictionary_players`

- **Loader:** `nflreadr::load_players()`
- **Field count:** 39
- **Documented seasons coverage:** not season-indexed — one row per player, per `\value`
  (*"A tibble with one row per player"*). `\details` frames it as the nflverse-wide player-id
  crosswalk.
- **Key fields:**
  | field | meaning |
  |---|---|
  | `gsis_id` | *"Primary key for all data"* (explicit in dictionary) |
  | `display_name` | Full player name |
  | `espn_id` | ESPN id for player (declared **character** type here, vs. numeric in `dictionary_rosters` — see notes.md) |
  | `birth_date` | Player birth date |
  | `position` / `position_group` | NFL-listed position |
  | `height` / `weight` | Declared **numeric** here (inches / lbs) — differs from `dictionary_rosters`' character declaration for the same concept |
  | `draft_year` / `draft_round` / `draft_pick` | Draft provenance |
  | (also carries `pfr_id`, `pff_id`, `otc_id`, `smart_id`, `esb_id`, `nfl_id` — full ID crosswalk) |

## 7. Depth charts — `dictionary_depth_charts`

- **Loader:** `nflreadr::load_depth_charts()`
- **Field count:** 12
- **Documented seasons coverage:** *"Loads depth charts for each NFL team for each week back to
  2001... Defaults to latest season with available rosters."*
- **Key fields:**
  | field | meaning |
  |---|---|
  | `dt` | ISO8601 timestamp the record was loaded (point-in-time snapshot) |
  | `team` | Team the chart belongs to |
  | `player_name` | Full player name |
  | `espn_id` | ESPN player id (character) |
  | `gsis_id` | GSIS player id |
  | `pos_grp` / `pos_slot` / `pos_rank` | Position group, formation slot number, depth rank within slot |

## 8. Injuries — `dictionary_injuries`

- **Loader:** `nflreadr::load_injuries()`
- **Field count:** 16
- **Documented seasons coverage:** *"Data collected from an API for weekly injury report
  data"*; `seasons` arg — *"data available since 2009. Defaults to latest season available."*
- **Key fields:**
  | field | meaning |
  |---|---|
  | `season` / `week` / `team` | Season-week-team key |
  | `gsis_id` / `full_name` | Player identity |
  | `report_primary_injury` / `report_status` | Official injury report body part / game status |
  | `practice_status` | Practice participation level |
  | `date_modified` | Timestamp of last update |

## 9. Participation — `dictionary_participation`

- **Loader:** `nflreadr::load_participation(seasons, include_pbp = FALSE)`
- **Field count:** 26
- **Documented seasons coverage:** *"If set to `TRUE`, returns all available data since 2016."*
  Provenance detail (from `\description`): pre-2023 seasons sourced from NFL NextGen Stats,
  2023-onwards from FTN Data, released under CC-BY-SA 4.0.
- **Key fields:**
  | field | meaning |
  |---|---|
  | `nflverse_game_id` | Game key, `season_week_away_home` format |
  | `possession_team` | Team with the ball |
  | `offense_formation` / `defense_personnel` | Personnel/formation on the play |
  | `defenders_in_box` | Count of defenders in the box at snap |
  | `was_pressure` | Boolean: QB pressured |
  | `route` | Primary receiver's route (enumerated string set) |
  | `defense_coverage_type` | Coverage shell (COVER_0..COVER_9, etc.) |

## 10. Snap counts — `dictionary_snap_counts`

- **Loader:** `nflreadr::load_snap_counts()`
- **Field count:** 16
- **Documented seasons coverage:** *"Loads game level snap counts stats provided by Pro Football
  Reference starting with the 2012 season."*
- **Key fields:** `game_id` / `pfr_game_id`, `player` / `pfr_player_id`, `team` / `opponent`,
  `offense_pct` / `defense_pct` / `st_pct` (percent of team's snaps played, by unit).

## 11. FTN charting — `dictionary_ftn_charting`

- **Loader:** `nflreadr::load_ftn_charting()`
- **Field count:** 28 (unusual 5-column dictionary shape: `field_name`, `field_type`,
  `ftn_field_name` (FTN's own short code), `order`, `description`)
- **Documented seasons coverage:** *"Data is available from the 2022 season onwards and is
  charted within 48 hours following each game."* CC-BY-SA 4.0, attribution "FTN Data via
  nflverse".
- **Key fields:** `nflverse_game_id`, `is_no_huddle` / `is_motion` / `is_play_action` /
  `is_screen_pass` / `is_rpo` / `is_trick_play` (manually charted play-design booleans),
  `n_offense_backfield`, `is_qb_out_of_pocket`.

## 12. Player-level stats — `dictionary_player_stats`

- **Loader:** `nflreadr::load_player_stats(seasons, summary_level = c("week","reg","post","reg+post"))`
- **Field count:** 114
- **Documented seasons coverage:** `seasons` arg — *"defaults to most recent season. If set to
  `TRUE`, returns all available data."* No explicit start year stated in this Rd (unlike
  `load_pbp`).
- **Key fields:** `player_id` (gsis_id, join key back to `load_players()`), `season` / `week` /
  `season_type`, `team` / `opponent_team`, `completions`/`attempts`/`passing_yards`/`passing_tds`,
  `passing_epa` (explicitly documented as using `qb_epa`), `passing_cpoe`.

## 13. Team-level stats — `dictionary_team_stats`

- **Loader:** `nflreadr::load_team_stats(seasons, summary_level = c("week","reg","post","reg+post"))`
- **Field count:** 102
- **Documented seasons coverage:** same pattern as `load_player_stats` — *"defaults to most
  recent season... `TRUE` returns all available data"*, no explicit start year in this Rd.
- **Key fields:** `season` / `week` / `team` / `season_type` / `opponent_team`, `completions` /
  `attempts` / `passing_yards` / `passing_tds`, `passing_epa`, `passing_cpoe` (team-aggregated
  mirror of `dictionary_player_stats`).

## 14. Next Gen Stats — `dictionary_nextgen_stats`

- **Loader:** `nflreadr::load_nextgen_stats(seasons, stat_type = c("passing","receiving","rushing"))`
- **Field count:** 51
- **Documented seasons coverage:** *"starting with the 2016 season... NGS will only provide data
  for players above a minimum number of pass/rush/rec attempts."*
- **Key fields:** `season_type`, `player_gsis_id`, `team_abbr`, `avg_time_to_throw`,
  `avg_completed_air_yards`, `avg_intended_air_yards`, `avg_air_yards_differential` (passing
  `stat_type`; receiving/rushing add their own NGS-specific metrics not enumerated here).

## 15. PFR advanced stats — `dictionary_pfr_passing`

- **Loaders:** TWO distinct exported functions share this one dictionary (both "See Also"
  cross-reference `dictionary_pfr_passing.html` — no separate `dictionary_pfr_advstats` exists):
  - `nflreadr::load_pfr_advstats(seasons, stat_type = c("pass","rush","rec","def"), summary_level = c("week","season"))` —
    *"starting with the 2018 season"*
  - `nflreadr::load_pfr_passing(seasons)` — *"starting with the 2019 season"*
- **Field count:** 28
- **Key fields:** `player` / `pfr_id` / `team` / `season`, `pass_attempts`, `batted_balls`,
  `throwaways`, `drop_pct`, `bad_throw_pct`, `on_tgt_pct`.

## 16. ESPN QBR — `dictionary_espn_qbr`

- **Loader:** `nflreadr::load_espn_qbr(seasons, summary_type = c("season","week"))`
- **Field count:** 23
- **Documented seasons coverage:** *"data available since 2006. Defaults to latest season
  available. TRUE will select all seasons."*
- **Key fields:** `player_id` (**"ESPN Player ID"**, numeric — explicit ESPN join column),
  `team_abb`, `qbr_total`, `pts_added`, `qb_plays`, `epa_total`, `qualified`.

## 17. Combine — `dictionary_combine`

- **Loader:** `nflreadr::load_combine(seasons = TRUE)`
- **Field count:** 18
- **Documented seasons coverage:** *"Loads combine data since 2000 courtesy of PFR."*
- **Key fields:** `season`, `pfr_id` / `cfb_id`, `player_name`, `pos`, `ht` / `wt`, `forty`
  (40-yard dash), `vertical`, `bench`.

## 18. Draft picks — `dictionary_draft_picks`

- **Loader:** `nflreadr::load_draft_picks(seasons = TRUE)`
- **Field count:** 36 (largest of the "reference" tables outside stats/pbp)
- **Documented seasons coverage:** *"Loads every draft pick since 1980 courtesy of PFR."*
- **Key fields:** `season` / `round` / `pick`, `team`, `gsis_id` (*"ID for joining with nflverse
  data"*), `pfr_player_id`, `position` / `category` / `side`, `car_av` (career approximate
  value), `w_av` (weighted approximate value).

## 19. Trades — `dictionary_trades`

- **Loader:** `nflreadr::load_trades(seasons = TRUE)`
- **Field count:** 11 (smallest dictionary in the package)
- **Documented seasons coverage:** *"a table of historical trades... default `TRUE` returns all
  available data"* (no explicit start year stated).
- **Key fields:** `trade_id`, `season` / `trade_date`, `gave` / `received` (team abbreviations),
  `pick_season` / `pick_round` / `pick_number`, `pfr_id` (traded player, if a player was involved).

## 20. Contracts — `dictionary_contracts`

- **Loader:** `nflreadr::load_contracts()`
- **Field count:** 15
- **Documented seasons coverage:** not season-parameterized (no `seasons` arg at all) — loads the
  full OverTheCap.com contract history in one call.
- **Key fields:** `player` / `position` / `team`, `is_active`, `year_signed` / `years`, `value` /
  `apy` (average per year) / `guaranteed`, `otc_id` (OverTheCap player id).

## 21. Fantasy player IDs — `dictionary_ff_playerids`

- **Loader:** `nflreadr::load_ff_playerids()` (explicitly named in the brief)
- **Field count:** 35
- **Documented seasons coverage:** not applicable — static cross-platform id crosswalk from
  DynastyProcess.com, no `seasons` argument.
- **Key fields:** `mfl_id` (*"primary key for this table"*), `gsis_id`, `sportradar_id`,
  `espn_id` (*"usual format is an integer with ~5 digits"*), `pff_id`, `yahoo_id`, `pfr_id`,
  `merge_name` (normalized name for fuzzy joins).

## 22. Fantasy rankings — `dictionary_ff_rankings`

- **Loader:** `nflreadr::load_ff_rankings(type = c("draft","week","all"))`
- **Field count:** 25
- **Documented seasons coverage:** not season-indexed — *"updated on a weekly basis"* snapshot of
  current expert consensus rankings, no historical `seasons` argument.
- **Key fields:** `player` / `pos` / `team`, `id` (FantasyPros id), `ecr` (avg expert rank),
  `player_owned_espn` / `player_owned_yahoo`, `bye` (bye week).

## 23. Fantasy expected points (ffopportunity) — `dictionary_ff_opportunity`

- **Loader:** `nflreadr::load_ff_opportunity(seasons, stat_type = c("weekly","pbp_pass","pbp_rush"), model_version = c("latest","v1.0.0"))`
- **Field count:** 218 (2nd-largest dictionary) — unusual 4-column shape (`Field`, `Type`,
  `Dataframe`, `Description`): the `Dataframe` column tags which of the 3 `stat_type` sub-frames
  (`weekly` / `pbp_pass` / `pbp_rush`) each field belongs to, since one dictionary documents three
  distinct frame shapes. Breakdown observed: `weekly`-only = 146, `pbp_rush`-only = 10,
  `pbp_pass`-only = 21, fields shared across 2+ sub-frames = 41.
- **Documented seasons coverage:** *"defaults to most recent season. If set to `TRUE`, returns all
  available data."* No explicit start year in this Rd.
- **Key fields:** `game_id`, `posteam`, `rusher_player_id` (pbp_rush only), `full_name`, `era`
  (*"pre2018 (2006-2017) or post2018 (2018+)"* — an explicit historical-coverage clue even though
  the loader's own Rd doesn't state a start year), `rush_touchdown`.

## 24. Roster status codes — `dictionary_roster_status` (not a field dictionary)

- **Not tied to a single loader** — documents the *values* found in the `status` /
  `status_description_abbr` columns of `dictionary_rosters` / `dictionary_players`, not a data
  frame's fields. Shape is `status, description` (2 columns), 19 rows — one row per status code
  (`ACT`, `EXE`, `DEV`, `CUT`, `E14`, `INA`, `NWT`, `PUP`, `RES`, `RET`, `RFA`, `RSN`, `RSR`,
  `SUS`, `TRC`, `TRD`, `TRL`, `TRT`, `UFA`). Included here for completeness per the "whatever
  dictionaries exist" instruction, flagged as structurally different from the other 21.

---

## Field-count roll-up (all 22 shipped `dictionary_*`, sorted descending)

| dictionary | fields |
|---|---|
| dictionary_pbp | 372 |
| dictionary_ff_opportunity | 218 |
| dictionary_player_stats | 114 |
| dictionary_team_stats | 102 |
| dictionary_nextgen_stats | 51 |
| dictionary_schedules | 45 |
| dictionary_players | 39 |
| dictionary_draft_picks | 36 |
| dictionary_ff_playerids | 35 |
| dictionary_rosters | 37 |
| dictionary_ftn_charting | 28 |
| dictionary_pfr_passing | 28 |
| dictionary_participation | 26 |
| dictionary_ff_rankings | 25 |
| dictionary_espn_qbr | 23 |
| dictionary_combine | 18 |
| dictionary_roster_status | 19 (status-code lookup, not fields) |
| dictionary_snap_counts | 16 |
| dictionary_injuries | 16 |
| dictionary_contracts | 15 |
| dictionary_depth_charts | 12 |
| dictionary_trades | 11 |

(Raw counts also recorded in `notes.md`, generated programmatically from the same
`data(package="nflreadr")` pass that produced the CSVs — not retyped by hand.)
