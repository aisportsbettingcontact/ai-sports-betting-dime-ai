# Appendix C — Exported API inventory (132 symbols)

Source: `$ROOT/evidence/ws-f/exports.csv` (132 rows, header `package,symbol,kind,signature,title`),
generated from `getNamespaceExports()` against the installed library at
`/opt/homebrew/lib/R/4.6/site-library`. Method and kind-classification rules:
`$ROOT/evidence/ws-f/notes.md`.

`$ROOT` = `/private/tmp/claude-501/-Users-danielwalker-src-ai-sports-betting-dime-ai/dd3b2b85-766c-4b7b-a98c-d928cffcbac2/scratchpad/nflverse-audit`

## Counts

| package | version | exports |
|---|---|---:|
| nflverse | 1.0.3 | 4 |
| nflreadr | 1.5.1 | 54 |
| nflfastR | 5.2.0 | 27 |
| nflseedR | 2.0.2 | 12 |
| nfl4th | 1.0.7 | 7 |
| nflplotR | 1.6.0 | 28 |
| **total** | | **132** |

By kind: data 5, function 116, reexport 11.
`reexport` means the symbol resolves to another package's namespace or is listed in the
package's own `reexports.Rd`; `data` is the catch-all for non-function exports (2 S4 class
representations in nflreadr, 3 ggproto layer objects in nflplotR).

## nflverse 1.0.3 — 4 exports

| symbol | kind | signature | title |
|---|---|---|---|
| `%>%` | reexport | `function (lhs, rhs) NULL` | Pipe operator |
| `nflverse_packages` | function | `function (include_self = FALSE) NULL` | List all packages in the nflverse |
| `nflverse_sitrep` | reexport | `function (pkg = c("nflreadr", "nflfastR", "nflseedR", "nfl4th", "nflplotR", "nflverse"), recursive = TRUE, redact_path = TRUE) NULL` | Get a Situation Report on System, nflverse Package Versions and Dependencies |
| `nflverse_update` | function | `function (recursive = FALSE, repos = getOption("repos"), devel = FALSE) NULL` | Update nflverse Packages |

## nflreadr 1.5.1 — 54 exports

| symbol | kind | signature | title |
|---|---|---|---|
| `.__C__nflverse_data` | data | `` |  |
| `.__C__nflverse_sitrep` | data | `` |  |
| `.clear_cache` | function | `function () NULL` | Clear function cache |
| `.for_cran` | function | `function () NULL` | CRAN setup code |
| `.sitrep` | function | `function (pkg, recursive = TRUE, redact_path = TRUE, dev_repos = c("https://nflverse.r-universe.dev", "https://ffverse.r-universe.dev")) NULL` | Get a Situation Report on System, nflverse/ffverse Package Versions and Dependencies |
| `as.nflverse_data` | function | `function (df, nflverse_type = NULL, ...) NULL` | nflverse data class |
| `clean_homeaway` | function | `function (dataframe, invert = NULL) NULL` | Clean Home/Away in dataframes into Team/Opponent dataframes |
| `clean_player_names` | function | `function (player_name, lowercase = FALSE, convert_lastfirst = TRUE, use_name_database = TRUE, convert_to_ascii = rlang::is_installed("stringi")) NULL` | Create Player Merge Names |
| `clean_team_abbrs` | function | `function (abbr, current_location = TRUE, keep_non_matches = TRUE) NULL` | Standardize NFL Team Abbreviations |
| `clear_cache` | function | `function () NULL` | Clear function cache |
| `csv_from_url` | function | `function (...) NULL` | Load .csv / .csv.gz file from a remote connection |
| `ffverse_sitrep` | function | `function (pkg = c("ffscrapr", "ffsimulator", "ffpros", "ffopportunity"), recursive = TRUE, redact_path = TRUE) NULL` | Get a Situation Report on System, nflverse/ffverse Package Versions and Dependencies |
| `get_current_season` | function | `function (roster = FALSE) NULL` | Get Latest Season |
| `get_current_week` | function | `function (use_date = FALSE, ...) NULL` | Get Current Week |
| `get_latest_season` | function | `function (roster = FALSE) NULL` | Get Latest Season |
| `join_coalesce` | function | `function (x, y, by = NULL, type = c("left", "inner", "full"), ..., by.x = NULL, by.y = NULL, sort = TRUE, incomparables = c(NA, NaN)) NULL` | Coalescing join |
| `load_combine` | function | `function (seasons = TRUE, file_type = getOption("nflreadr.prefer", default = "rds")) NULL` | Load Combine Data from PFR |
| `load_contracts` | function | `function (file_type = getOption("nflreadr.prefer", default = "rds")) NULL` | Load Historical Player Contracts from OverTheCap.com |
| `load_depth_charts` | function | `function (seasons = most_recent_season(roster = TRUE), file_type = getOption("nflreadr.prefer", default = "rds")) NULL` | Load Weekly Depth Charts |
| `load_draft_picks` | function | `function (seasons = TRUE, file_type = getOption("nflreadr.prefer", default = "rds")) NULL` | Load Draft Picks from PFR |
| `load_espn_qbr` | function | `function (seasons = most_recent_season(), summary_type = c("season", "week"), file_type = getOption("nflreadr.prefer", default = "rds")) NULL` | Load ESPN's QBR |
| `load_ff_opportunity` | function | `function (seasons = most_recent_season(), stat_type = c("weekly", "pbp_pass", "pbp_rush"), model_version = c("latest", "v1.0.0")) NULL` | Load Expected Fantasy Points |
| `load_ff_playerids` | function | `function () NULL` | Load Fantasy Player IDs |
| `load_ff_rankings` | function | `function (type = c("draft", "week", "all")) NULL` | Load Latest FantasyPros Rankings |
| `load_from_url` | function | `function (url, ..., seasons = TRUE, nflverse = FALSE) NULL` | Load any rds/csv/csv.gz/parquet file from a remote URL |
| `load_ftn_charting` | function | `function (seasons = most_recent_season(), file_type = getOption("nflreadr.prefer", default = "rds")) NULL` | Load FTN Charting Data |
| `load_injuries` | function | `function (seasons = most_recent_season(), file_type = getOption("nflreadr.prefer", default = "rds")) NULL` | Load Injury Reports |
| `load_nextgen_stats` | function | `function (seasons = TRUE, stat_type = c("passing", "receiving", "rushing"), file_type = getOption("nflreadr.prefer", default = "rds")) NULL` | Load Player Level Weekly NFL Next Gen Stats |
| `load_officials` | function | `function (seasons = TRUE, file_type = getOption("nflreadr.prefer", default = "rds")) NULL` | Load Officials |
| `load_participation` | function | `function (seasons = most_recent_season(), include_pbp = FALSE, file_type = getOption("nflreadr.prefer", default = "rds")) NULL` | Load Participation Data |
| `load_pbp` | function | `function (seasons = most_recent_season(), file_type = getOption("nflreadr.prefer", default = "rds")) NULL` | Load Play By Play |
| `load_pfr_advstats` | function | `function (seasons = most_recent_season(), stat_type = c("pass", "rush", "rec", "def"), summary_level = c("week", "season"), file_type = getOption("...` | Load Advanced Stats from PFR |
| `load_pfr_passing` | function | `function (seasons = TRUE) NULL` | Load Advanced Passing Stats from PFR |
| `load_player_stats` | function | `function (seasons = most_recent_season(), ..., summary_level = c("week", "reg", "post", "reg+post"), file_type = getOption("nflreadr.prefer", defau...` | Load Player Level Stats |
| `load_players` | function | `function (file_type = getOption("nflreadr.prefer", default = "rds")) NULL` | Load Players |
| `load_rosters` | function | `function (seasons = most_recent_season(roster = TRUE), file_type = getOption("nflreadr.prefer", default = "rds")) NULL` | Load Rosters |
| `load_rosters_weekly` | function | `function (seasons = most_recent_season(roster = TRUE), file_type = getOption("nflreadr.prefer", default = "rds")) NULL` | Load Weekly Rosters |
| `load_schedules` | function | `function (seasons = TRUE) NULL` | Load Game/Schedule Data |
| `load_snap_counts` | function | `function (seasons = most_recent_season(), file_type = getOption("nflreadr.prefer", default = "rds")) NULL` | Load Snap Counts from PFR |
| `load_team_stats` | function | `function (seasons = most_recent_season(), ..., summary_level = c("week", "reg", "post", "reg+post"), file_type = getOption("nflreadr.prefer", defau...` | Load Team Level Stats |
| `load_teams` | function | `function (current = TRUE, file_type = getOption("nflreadr.prefer", default = "rds")) NULL` | Load NFL Team Graphics, Colors, and Logos |
| `load_trades` | function | `function (seasons = TRUE) NULL` | Load Trades |
| `most_recent_season` | function | `function (roster = FALSE) NULL` | Get Latest Season |
| `nflverse_download` | function | `function (..., folder_path = getOption("nflreadr.download_path", default = "."), file_type = getOption("nflreadr.prefer", default = "rds"), use_hiv...` | Bulk download utilities via piggyback |
| `nflverse_game_id` | function | `function (season, week, away, home) NULL` | Compute nflverse Game Identifiers |
| `nflverse_releases` | function | `function (.token = "default") NULL` | List all available nflverse releases |
| `nflverse_sitrep` | function | `function (pkg = c("nflreadr", "nflfastR", "nflseedR", "nfl4th", "nflplotR", "nflverse"), recursive = TRUE, redact_path = TRUE) NULL` | Get a Situation Report on System, nflverse/ffverse Package Versions and Dependencies |
| `parquet_from_url` | function | `function (url) NULL` | Load .parquet file from a remote connection |
| `progressively` | function | `function (f, p = NULL) NULL` | Progressively |
| `qs_from_url` | function | `function (url) NULL` | Load .qs file from a remote connection |
| `raw_from_url` | function | `function (url) NULL` | Load raw filedata from a remote connection |
| `rbindlist_with_attrs` | function | `function (dflist) NULL` | rbindlist but maintain attributes of last file |
| `rds_from_url` | function | `function (url) NULL` | Load .rds file from a remote connection |
| `stat_mode` | function | `function (x, ..., na.rm = FALSE) NULL` | Statistical Mode |

## nflfastR 5.2.0 — 27 exports

| symbol | kind | signature | title |
|---|---|---|---|
| `add_qb_epa` | function | `function (pbp, ...) NULL` | Compute QB epa |
| `add_xpass` | function | `function (pbp, ...) NULL` | Add expected pass columns |
| `add_xyac` | function | `function (pbp, ...) NULL` | Add expected yards after completion (xyac) variables |
| `build_nflfastR_pbp` | function | `function (game_ids, dir = getOption("nflfastR.raw_directory", default = NULL), ..., decode = TRUE, rules = TRUE) NULL` | Build a Complete nflfastR Data Set |
| `calculate_expected_points` | function | `function (pbp_data) NULL` | Compute expected points |
| `calculate_player_stats` | function | `function (pbp, weekly = FALSE) NULL` | Get Official Game Stats |
| `calculate_player_stats_def` | function | `function (pbp, weekly = FALSE) NULL` | Get Official Game Stats on Defense |
| `calculate_player_stats_kicking` | function | `function (pbp, weekly = FALSE) NULL` | Summarize Kicking Stats |
| `calculate_series_conversion_rates` | function | `function (pbp, weekly = FALSE) NULL` | Compute Series Conversion Information from Play by Play |
| `calculate_standings` | function | `function (nflverse_object, tiebreaker_depth = 3, playoff_seeds = NULL) NULL` | Compute Division Standings and Conference Seeds from Play by Play |
| `calculate_stats` | function | `function (seasons = nflreadr::most_recent_season(), summary_level = c("season", "week"), stat_type = c("player", "team"), season_type = c("REG", "P...` | Calculate NFL Stats |
| `calculate_win_probability` | function | `function (pbp_data) NULL` | Compute win probability |
| `clean_pbp` | function | `function (pbp, ...) NULL` | Clean Play by Play Data |
| `decode_player_ids` | function | `function (pbp, ..., fast = TRUE) NULL` | Decode the player IDs in nflfastR play-by-play data |
| `fast_scraper` | function | `function (game_ids, dir = getOption("nflfastR.raw_directory", default = NULL), ..., in_builder = FALSE) NULL` | Get NFL Play by Play Data |
| `fast_scraper_roster` | function | `function (...) NULL` | Load Team Rosters for Multiple Seasons |
| `fast_scraper_schedules` | function | `function (...) NULL` | Load NFL Season Schedules |
| `load_pbp` | reexport | `function (seasons = most_recent_season(), file_type = getOption("nflreadr.prefer", default = "rds")) NULL` | Objects exported from other packages |
| `load_player_stats` | reexport | `function (seasons = most_recent_season(), ..., summary_level = c("week", "reg", "post", "reg+post"), file_type = getOption("nflreadr.prefer", defau...` | Objects exported from other packages |
| `load_rosters` | reexport | `function (seasons = most_recent_season(roster = TRUE), file_type = getOption("nflreadr.prefer", default = "rds")) NULL` | Objects exported from other packages |
| `load_schedules` | reexport | `function (seasons = TRUE) NULL` | Objects exported from other packages |
| `load_team_stats` | reexport | `function (seasons = most_recent_season(), ..., summary_level = c("week", "reg", "post", "reg+post"), file_type = getOption("nflreadr.prefer", defau...` | Objects exported from other packages |
| `missing_raw_pbp` | function | `function (dir = getOption("nflfastR.raw_directory", default = NULL), seasons = TRUE, verbose = TRUE) NULL` | Compute Missing Raw PBP Data on Local Filesystem |
| `nflverse_sitrep` | reexport | `function (pkg = c("nflreadr", "nflfastR", "nflseedR", "nfl4th", "nflplotR", "nflverse"), recursive = TRUE, redact_path = TRUE) NULL` | Objects exported from other packages |
| `report` | function | `function (...) NULL` | Get a Situation Report on System, nflverse Package Versions and Dependencies |
| `save_raw_pbp` | function | `function (game_ids, dir = getOption("nflfastR.raw_directory", default = NULL)) NULL` | Download Raw PBP Data to Local Filesystem |
| `update_db` | function | `function (dbdir = getOption("nflfastR.dbdirectory", default = "."), dbname = "pbp_db", tblname = "nflfastR_pbp", force_rebuild = FALSE, db_connecti...` | Update or Create a nflfastR Play-by-Play Database |

## nflseedR 2.0.2 — 12 exports

| symbol | kind | signature | title |
|---|---|---|---|
| `compute_conference_seeds` | function | `function (teams, h2h = NULL, tiebreaker_depth = 3, .debug = FALSE, playoff_seeds = 7) NULL` | Compute NFL Playoff Seedings using Game Results and Divisional Rankings |
| `compute_division_ranks` | function | `function (games, teams = NULL, tiebreaker_depth = 3, .debug = FALSE, h2h = NULL) NULL` | Compute NFL Division Rankings using Game Results |
| `compute_draft_order` | function | `function (teams, games, h2h = NULL, tiebreaker_depth = 3, .debug = FALSE) NULL` | Compute NFL Draft Order using Game Results and Divisional Rankings |
| `fmt_pct_special` | function | `function (x) NULL` | Format Numerical Values to Special Percentage Strings |
| `load_schedules` | reexport | `function (seasons = TRUE) NULL` | Objects exported from other packages |
| `load_sharpe_games` | function | `function (...) NULL` | Load Lee Sharpe's Games File |
| `nfl_simulations` | function | `function (games, compute_results = nflseedR_compute_results, ..., playoff_seeds = 7L, simulations = 10000L, chunks = 8L, byes_per_conf = 1L, tiebre...` | Simulate an NFL Season |
| `nfl_standings` | function | `function (games, ..., ranks = c("CONF", "DIV", "DRAFT", "NONE"), tiebreaker_depth = c("SOS", "PRE-SOV", "POINTS", "RANDOM"), playoff_seeds = NULL, ...` | Compute NFL Standings |
| `nfl_standings_prettify` | function | `function (standings, ..., grp_by = c("div", "conf", "nfl"), order_by = c("div_rank", "conf_rank", "draft_rank"), reverse = FALSE) NULL` | Compute Pretty NFL Standings Table |
| `nflseedR_compute_results` | function | `function (teams, games, week_num, ...) NULL` | Compute NFL Game Results in Season Simulations |
| `simulate_nfl` | function | `function (nfl_season = NULL, process_games = NULL, ..., playoff_seeds = ifelse(nfl_season >= 2020, 7, 6), if_ended_today = FALSE, fresh_season = FA...` | Simulate an NFL Season |
| `simulations_verify_fct` | function | `function (compute_results, ..., games = nflseedR::sims_games_example, teams = nflseedR::sims_teams_example) NULL` | Verify Custom NFL Result Simulation Function |

## nfl4th 1.0.7 — 7 exports

| symbol | kind | signature | title |
|---|---|---|---|
| `add_2pt_probs` | function | `function (df) NULL` | Get 2pt decision probabilities |
| `add_4th_probs` | function | `function (df) NULL` | Get 4th down decision probabilities |
| `get_4th_plays` | function | `function (gid) NULL` | Get 4th down plays from a game |
| `load_4th_pbp` | function | `function (seasons, fast = FALSE) NULL` | Load calculated 4th down probabilities from list("nflfastR") data |
| `make_2pt_table_data` | function | `function (probs) NULL` | Get 2pt decision probabilities |
| `make_table_data` | function | `function (probs) NULL` | Get 4th down decision probabilities |
| `nfl4th_clear_cache` | function | `function (type = c("games", "fd_model", "wp_model", "all")) NULL` | Reset nfl4th Package Cache |

## nflplotR 1.6.0 — 28 exports

| symbol | kind | signature | title |
|---|---|---|---|
| `.nflplotR_clear_cache` | function | `function () NULL` | Clear nflplotR Cache |
| `GeomNFLheads` | data | `` | nflplotR: NFL Logo Plots in 'ggplot2' and 'gt' |
| `GeomNFLlogo` | data | `` | nflplotR: NFL Logo Plots in 'ggplot2' and 'gt' |
| `GeomNFLwordmark` | data | `` | nflplotR: NFL Logo Plots in 'ggplot2' and 'gt' |
| `element_nfl_headshot` | function | `function (alpha = 1L, colour = NA_character_, hjust = 0.5, vjust = 0.5, color = NULL, angle = 0, size = grid::unit(0.5, "cm")) NULL` | Theme Elements for Image Grobs |
| `element_nfl_logo` | function | `function (alpha = 1L, colour = NA_character_, hjust = 0.5, vjust = 0.5, color = NULL, angle = 0, size = grid::unit(0.5, "cm")) NULL` | Theme Elements for Image Grobs |
| `element_nfl_wordmark` | function | `function (alpha = 1L, colour = NA_character_, hjust = 0.5, vjust = 0.5, color = NULL, angle = 0, size = grid::unit(0.5, "cm")) NULL` | Theme Elements for Image Grobs |
| `element_path` | reexport | `function (alpha = 1L, colour = NA_character_, hjust = 0.5, vjust = 0.5, color = NULL, angle = 0, size = grid::unit(0.5, "cm")) NULL` | Objects exported from other packages |
| `geom_from_path` | function | `function (...) NULL` | ggplot2 Layer for Visualizing Images from URLs or Local Paths |
| `geom_mean_lines` | function | `function (...) NULL` | ggplot2 Layer for Horizontal and Vertical Reference Lines |
| `geom_median_lines` | function | `function (...) NULL` | ggplot2 Layer for Horizontal and Vertical Reference Lines |
| `geom_nfl_headshots` | function | `function (mapping = NULL, data = NULL, stat = "identity", position = "identity", ..., na.rm = FALSE, show.legend = FALSE, inherit.aes = TRUE) NULL` | ggplot2 Layer for Visualizing NFL Player Headshots |
| `geom_nfl_logos` | function | `function (mapping = NULL, data = NULL, stat = "identity", position = "identity", ..., na.rm = FALSE, show.legend = FALSE, inherit.aes = TRUE) NULL` | ggplot2 Layer for Visualizing NFL Team Logos |
| `geom_nfl_wordmarks` | function | `function (mapping = NULL, data = NULL, stat = "identity", position = "identity", ..., na.rm = FALSE, show.legend = FALSE, inherit.aes = TRUE) NULL` | ggplot2 Layer for Visualizing NFL Team Wordmarks |
| `ggpreview` | function | `function (plot = ggplot2::last_plot(), width = NA, height = NA, asp = NULL, dpi = 300, device = "png", units = c("in", "cm", "mm", "px"), scale = 1...` | Preview ggplot in Specified Dimensions |
| `gt_nfl_cols_label` | function | `function (gt_object, columns = gt::everything(), ..., height = 30, type = c("logo", "wordmark", "headshot")) NULL` | Render Logos, Wordmarks, and Headshots in 'gt' Table Column Labels |
| `gt_nfl_headshots` | function | `function (gt_object, columns, height = 30, locations = NULL) NULL` | Render Player Headshots in 'gt' Tables |
| `gt_nfl_logos` | function | `function (gt_object, columns, height = 30, locations = NULL) NULL` | Render Logos and Wordmarks in 'gt' Tables |
| `gt_nfl_wordmarks` | function | `function (gt_object, columns, height = 30, locations = NULL) NULL` | Render Logos and Wordmarks in 'gt' Tables |
| `gt_pct_bar` | function | `function (gt_tbl, col_value, col_pct, ..., rows = gt::everything(), hide_col_pct = FALSE, value_position = c("inline", "above"), value_scale = 1L, ...` | Format Columns of 'gt' Tables as Percentage Bars |
| `gt_render_image` | function | `function (gt_tbl, ...) NULL` | Render 'gt' Table to Temporary png File |
| `nfl_team_factor` | function | `function (teams, ...) NULL` | Create Ordered NFL Team Name Factor |
| `nfl_team_tiers` | function | `function (data, title = "NFL Team Tiers, 2021 as of Week 4", subtitle = "created with the #nflplotR Tiermaker", caption = NULL, tier_desc = c(1 = "...` | Create NFL Team Tiers |
| `nflverse_sitrep` | reexport | `function (pkg = c("nflreadr", "nflfastR", "nflseedR", "nfl4th", "nflplotR", "nflverse"), recursive = TRUE, redact_path = TRUE) NULL` | Get a Situation Report on System, nflverse Package Versions and Dependencies |
| `scale_color_nfl` | function | `function (type = c("primary", "secondary"), values = NULL, ..., aesthetics = "colour", breaks = ggplot2::waiver(), na.value = "grey50", guide = NUL...` | Scales for NFL Team Colors |
| `scale_colour_nfl` | function | `function (type = c("primary", "secondary"), values = NULL, ..., aesthetics = "colour", breaks = ggplot2::waiver(), na.value = "grey50", guide = NUL...` | Scales for NFL Team Colors |
| `scale_fill_nfl` | function | `function (type = c("primary", "secondary"), values = NULL, ..., aesthetics = "fill", breaks = ggplot2::waiver(), na.value = "grey50", guide = NULL,...` | Scales for NFL Team Colors |
| `valid_team_names` | function | `function (exclude_duplicates = TRUE) NULL` | Output Valid NFL Team Abbreviations |
