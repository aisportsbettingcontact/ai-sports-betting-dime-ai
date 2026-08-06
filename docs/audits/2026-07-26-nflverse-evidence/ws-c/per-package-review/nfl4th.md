# nfl4th 1.0.7 — line-level review

**Files read: 11 of 11.** `ls sources/nfl4th/R | wc -l` = **11** (10 `.R` + `sysdata.rda`).
All 10 R source files read end to end (2,038 lines). No `src/`, no `useDynLib`, no `inst/`,
no `data/` — verified.

Files: `apply_win_prob.R`, `cache.R`, `decision_functions.R`, `get_game_data.R`, `helpers.R`,
`nfl4th-package.R`, `silence_tidy_eval_notes.R`, `table_functions.R`, `wrapper.R`, `zzz.R`,
`sysdata.rda`.

**This is the highest-risk of the six targets.** Four items below, two of them findings.

## FINDING 1 — `.onLoad` makes a network call and deletes a user file (`R/zzz.R:1-30`)

```r
.onLoad <- function(libname, pkgname) {
  is_online <- !is.null(curl::nslookup("github.com", error = FALSE))
```
Line 2 issues an **outbound DNS query to github.com on every `library(nfl4th)`** — and therefore on
every `library(nflverse)`, since nflverse attaches nfl4th. There is no option to suppress it; the
`nfl4th.keep_games` option only changes the messaging.

Lines 17-29: it `dir.create()`s `R_user_dir("nfl4th","cache")`, and if that directory already
exists and `getOption("nfl4th.keep_games")` is not `TRUE`, it **`file.remove(nfl4th_games_path())`**
— deleting the cached games file. The stated reason (`# remove games from package cache on load so
it updates`) is a cache-freshness decision, but a load hook that performs a destructive filesystem
operation by default is not behaviour a user can predict from `library()`.

## FINDING 2 — cleartext HTTP to ESPN (`R/get_game_data.R:41-46`)

```r
game_url <- paste0(
  "http://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=",
  df$espn)
pbp <- game_url |> jsonlite::fromJSON(flatten = TRUE)
```
`get_4th_plays()` fetches live play-by-play over **plain `http://`**, no TLS. The parsed JSON drives
`add_4th_probs()`, whose output is a betting/coaching recommendation. On a hostile network this is
tamperable end to end: an attacker who can see the traffic can rewrite down, distance, score
differential and clock and thereby control the recommendation. There is no integrity check. This is
the only cleartext transport in any of the six targets; every other URL in the package is https.
(Note: this line matches none of the brief's regexes — it was found by reading the file. See
`notes.md`.)

## NOTE — remote `readRDS` of executable model artefacts

`raw_rds_from_url()` (`R/helpers.R:284-293`) is `con <- url(url); readRDS(con)`. Its two callers
fetch xgboost models from GitHub release assets:

- `load_fd_model()` `R/helpers.R:295-300` → `.../nfl4th/releases/download/model_archive/fd_model.rds`
- `load_wp_model()` `R/helpers.R:302-307` → `.../model_archive/wp_model.rds`

and `R/wrapper.R:139-145` does `readRDS(url(".../nfl4th_infrastructure/pre_computed_go_boost.rds"))`
inline. The RDS payloads are raw vectors handed to `xgboost::xgb.load.raw()`
(`R/cache.R:43,61,71,76`). Two layers of trust: `readRDS` will reconstruct whatever R object the
server sends, and `xgb.load.raw` then parses attacker-influenceable bytes in xgboost's C++ model
parser. Per the audit's rule this is at minimum a **note** even though the origin is the nflverse
org; the trust decision belongs to the synthesis.

The fetched models are then **cached to disk**: `R/cache.R:59` `saveRDS(model, model_path)` and
`R/cache.R:18` `saveRDS(get_games_file(), nfl4th_games_path())`, both under
`R_user_dir("nfl4th","cache")`. `R/cache.R:65` reads them back with `readRDS()`. Once poisoned, the
cache persists across sessions for the models (only the *games* file is auto-deleted on load).

## NOTE — obfuscated CRAN-detection string (`R/cache.R:115-128`)

```r
any(!is.na(envvars), grepl(rawToChar(no_cache), x = cache_path))
```
`no_cache` is a 6-byte raw vector in `sysdata.rda`. Decoded: **`"ripley"`**. The package detects
Brian Ripley's CRAN check machine by grepping the cache path, and stores the needle as raw bytes so
that CRAN's own source-level grep will not match it. Functionally harmless — it only disables
caching — but it is deliberate obfuscation to evade a policy inspection, and it is exactly the shape
a real payload would take. Worth stating plainly in the report.

## Other network / filesystem

- `R/helpers.R:39-40` `get_games_file()` → `nflreadr::load_schedules()` (https, delegated).
- `R/wrapper.R:153` → `nflreadr::load_pbp()`; `R/wrapper.R:139` → `nflfastR::load_pbp()`.
- `nfl4th_clear_cache()` `R/cache.R:100-113` — user-invoked `file.remove()` of the three cache
  files. Correct and scoped.
- No `system()`, no `shell()`, no `source()`, no `install.packages()`.

## eval / parse / NSE

No `eval(parse(`, no `parse(text=)`. Heavy dplyr/tidyeval NSE throughout `decision_functions.R`
(punt/FG/2-pt/go-for-it win-probability math, 463 lines, read in full — it is pure arithmetic on
data frames). `R/silence_tidy_eval_notes.R` is 141 lines of `utils::globalVariables()`.
`R/apply_win_prob.R` and `R/table_functions.R` are model-input assembly and table formatting.

## Data payload — `R/sysdata.rda` (186 KB)

Loaded with `Rscript --vanilla`: `two_pt_model` (raw[25347], an xgboost UBJ blob beginning
`{"learner"`), `fg_model` (a `bam`/`gam` object), `punt_df` (5,483x4 tibble), `no_cache`
(raw[6] = `"ripley"`). No functions, no closures.

## Scan rows

16 hits: 1 finding (`R/zzz.R:1`), 10 notes (2 `fs_write` saveRDS to the user cache dir, 4 `readRDS`,
2 `url_conn`, 1 `http_client` nslookup, 1 `Sys_getenv` with a computed name at `cache.R:122`),
5 benign. The http:// ESPN URL is not among them (no pattern matches it).

**Verdict: two findings and two notes.** The package is not malicious, but it has the loosest
security posture of the six: network at load time, cleartext transport for live data that drives a
recommendation, remote deserialisation into a persistent on-disk cache, and a deliberately
obfuscated string.
