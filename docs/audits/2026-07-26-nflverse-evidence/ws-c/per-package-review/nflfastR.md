# nflfastR 5.2.0 — line-level review

**Files read: 32 of 32.** `ls sources/nflfastR/R | wc -l` = **32** (31 `.R` + `sysdata.rda`).
All 31 R source files read end to end (7,454 code lines after stripping roxygen doc lines; the 40
comment lines matching URL/eval/network/IO tokens were extracted and reviewed separately — all are
documentation links or algorithm attributions). No `src/`, no `useDynLib` — verified.
`tools/check.env` is a two-line env file.

## Load hooks

**None.** nflfastR defines no `.onLoad`, `.onAttach`, `.onUnload` or `.onDetach`. Nothing runs at
`library(nflfastR)`.

## FINDING — `load()` of a remote `.Rdata` into a live function frame (`R/aggregate_game_stats.R:687-691`)

```r
add_dakota <- function(add_to_this, pbp, weekly) {
  dakota_model <- NULL
  con <- url("https://github.com/nflverse/nflfastR-data/blob/master/models/dakota_model.Rdata?raw=true")
  try(load(con), silent = TRUE)
  close(con)
  if (is.null(dakota_model)) { ... }
```
`load()` — not `readRDS()` — is called with no `envir=`, so it defaults to `parent.frame()`, i.e.
**the executing `add_dakota()` frame**. An `.Rdata` file names its own objects, so the remote file
controls which local bindings get created or overwritten: `dakota_model`, but equally `pbp`,
`weekly`, `add_to_this`, or `con`. The `try(..., silent = TRUE)` swallows any error, and the only
subsequent check is `is.null(dakota_model)`.

This is materially worse than the `readRDS()` pattern used everywhere else in the nflverse, which
returns a value the caller must bind deliberately. It is also the only `load()` of remote content in
the six targets. Additionally the URL points at `master` on a data repo — **unpinned**, so the
artefact can change under the package at any time. **Finding.**

## Network call sites

All others are https and read-only:

| function | file:line | mechanism |
|---|---|---|
| `fetch_raw()` | `R/utils.R:175-217` | `curl::curl_fetch_memory("https://raw.githubusercontent.com/nflverse/nflfastR-raw/master/raw/<season>/<id>.rds")`, status-code checked (404/500 handled), then `read_raw_rds()` |
| `read_raw_rds()` | `R/utils.R:54-59` | `readRDS(gzcon(rawConnection(raw)))` — **remote deserialisation** of the bytes above. Note. |
| `load_raw_game()` | `R/utils.R:94-123` | local `readRDS()` if `options(nflfastR.raw_directory)` is set and the file exists, else `nflreadr::rds_from_url()` from the same raw repo |
| `save_raw_pbp()` | `R/save_raw_pbp.R:46-70` | `curl::multi_download(to_load, save_to)` — bulk download to a user-specified directory |
| `load_playstats()` | `R/calculate_stats.R:497-500` | `nflreadr::load_from_url(".../nflverse-pbp/releases/download/playstats/play_stats_<season>.rds")` |
| `R/top-level_scraper.R:122` | | `nflreadr::rds_from_url(".../nflverse-data/releases/download/misc/multiple_lateral_yards.rds")` |
| `update_db()`, `build_db()`, `missing_raw_pbp()`, `build_playstats()`, `get_scheds_and_rosters()`, `decode_player_ids()` | various | delegate to `nflreadr::load_schedules/load_pbp/load_rosters/load_players` |

Every remote path terminates in `readRDS` of nflverse-controlled bytes. Consistent with nflreadr;
same trust question. **Notes.**

## Filesystem writes

- **`update_db()` (`R/helper_database_functions.R:47-129`).** `dbdir` defaults to
  `getOption("nflfastR.dbdirectory", default = ".")` — **the current working directory**. Line 70
  `dir.create(dbdir)` if missing; line 74 `DBI::dbConnect(RSQLite::SQLite(), file.path(dbdir,
  dbname))` creates `./pbp_db`. Writes via `DBI::dbWriteTable` (`:111` and `R/utils.R:142`), and
  `DBI::dbRemoveTable`/`dbExecute` can **drop or delete rows from a user table** on
  `force_rebuild = TRUE`. Documented and user-invoked, but a default of `"."` means an unwary call
  drops a multi-GB database into whatever directory the user happens to be in. **Note.**
- **`save_raw_pbp()` (`R/save_raw_pbp.R:46-70`).** Requires `options(nflfastR.raw_directory)` to be
  set and the directory to already exist (`:49-55` abort otherwise — good), then `dir.create()`s
  per-season subfolders (`:59`) and writes `<game_id>.rds` files. Input `game_ids` are validated by
  `verify_game_ids()` (`:133-156`: season range, week 1-22, team abbreviations against
  `teams_colors_logos$team_abbr`) **before** they are interpolated into paths — that check is what
  prevents path traversal via a crafted game id. Correct. **Note.**
- Nothing writes to a temp-only path; there are no `writeLines`/`saveRDS` calls at all.

## SQL construction

`R/helper_database_functions.R:116-123` and `:154`:
```r
DBI::dbExecute(connection, glue::glue_sql(
  "DELETE FROM {`tblname`} WHERE game_id IN ({vals*})", vals = "9999_99_DEF_TYP", .con = connection))
```
`glue_sql` with backtick-braces for the identifier and `{vals*}` for the value list — **properly
parameterised and identifier-quoted against the live connection**. No string concatenation into
SQL anywhere. Correct.

## eval / parse / NSE

No `eval(parse(`, no `parse(text=)`, no `source()`, no `system()`/`shell()`, no `install.packages()`
executed (`R/build_nflfastR_pbp.R:67` only *messages* the user to install `gsisdecoder`).

`R/helper_decode_player_ids.R:98-113` decodes GSIS ids by hex-to-raw conversion
(`rawToChar(as.raw(strtoi(hex_raw, 16L)))`) on a 36-character id whose shape is checked first
(`:103`). It is string decoding, not deserialisation. `furrr::future_map_chr` at `:99` and
`build_playstats.R:19` spawn `future` workers.

Extensive dplyr/tidyeval NSE across `helper_add_ep_wp.R` (1,452 lines), `helper_add_nflscrapr_
mutations.R` (722), `helper_tidy_play_stats.R` (1,313), `aggregate_game_stats*.R` (1,610) and
`calculate_stats.R` (557) — all read; all are column arithmetic and regex parsing of play
descriptions. `R/helper_variable_selector.R` is a column-name whitelist.

Models come from the **`fastrmodels` package**, not the network: `load_model()` (`R/utils.R:229-248`)
switches over `fastrmodels::{ep,cp,wp,wp_spread,fg,xpass,xyac}_model` and calls
`xgboost::xgb.load.raw()` if the object is raw. `fastrmodels` is in the audited closure — a real
improvement over nfl4th's download-at-runtime approach.

## Data payloads

`R/sysdata.rda` (29 KB): `tidy_play_stats_row` (1x190 tibble), `default_play` (1x372 tibble),
`scramble_fix` (5,830 `"<game>_<play>"` id strings). `data/` holds `field_descriptions.rda`,
`nfl_stats_variables.rda`, `stat_ids.rda`, `teams_colors_logos.rda` — documented lookup tables
(`R/data_documentation.R`). No functions, no closures.

## Anything surprising

`R/report.R:33-40` is a `lifecycle::deprecate_warn` shim onto `nflreadr::nflverse_sitrep()`.
`please_work()` (`R/utils.R:161-171`) is a `tryCatch` decorator that swallows errors and returns an
empty data frame — it makes failures silent, which is a robustness/observability concern rather
than a security one.

## Scan rows

10 hits: **2 findings** (`R/aggregate_game_stats.R:689` `url_conn`, `:690` `load_call`), 6 notes
(3 `readRDS`, 2 `http_client`, 1 `curl_download`), 2 benign.

**Verdict: one finding** — remote `load()` from an unpinned `master` URL directly into an executing
frame — plus the usual remote-`readRDS` notes and two default-path filesystem concerns. Otherwise
well constructed: parameterised SQL, validated game ids before path interpolation, models shipped
in a package rather than downloaded.
