# nflseedR 2.0.2 — line-level review

**Files read: 27 of 27.** `ls sources/nflseedR/R | wc -l` = **27** (26 `.R` + `sysdata.rda`).
All 26 R source files read end to end (4,301 code lines after stripping roxygen comment lines;
every comment line matching a URL/eval/network/IO token was separately extracted and reviewed —
28 such lines, all documentation links to nflseedr.com / nfl.com / futureverse). No `src/`, no
`useDynLib` — verified.

## Load hooks

**None.** nflseedR defines no `.onLoad`, `.onAttach`, `.onUnload` or `.onDetach`. Nothing happens
at `library(nflseedR)` beyond namespace loading.

## Network call sites

Two, both read-only and both https:

1. `R/simulate_nfl.R:266` and `R/nflseedR-package.R:29` — `nflreadr::load_schedules()`, i.e. the
   schedule fetch is delegated entirely to nflreadr. `R/load_sharpe_games.R:101-104` is a
   deprecation shim onto the same call.
2. `R/simulate_nfl.R:282-292` — a fallback when a season has no real schedule:
   `data.table::fread("https://github.com/nflverse/nfldata/blob/master/fake_schedule_<season>.csv?raw=true")`,
   wrapped in `tryCatch`. `fread()` on a URL parses CSV; it does not deserialise R objects.

## Filesystem writes

**None.** No `saveRDS`, `writeLines`, `file.create/copy/rename`, `dir.create`, `unlink`, or DBI
write anywhere in the package.

## eval / parse / NSE

One `eval()`: `R/simulate_nfl.R:349-370` builds `run <- quote({ furrr::future_map(...) })` and then
`if (isTRUE(.debug)) eval(run) else suppressMessages(eval(run))`. The quoted expression is a
compile-time literal in the source; nothing user-supplied enters it. This is a `suppressMessages`
workaround, not dynamic code construction. No `parse(text=)` anywhere in the package.

The `list[u, tied] <- ...` destructuring used throughout the tiebreakers
(`conference_tiebreaker.R:28`, `division_tiebreaker.R:27`, `draft_tiebreaker.R:24`, …) is the
`gsubfn` `list[]` assignment idiom — that is why `gsubfn` is in the dependency closure. It is NSE,
but it is `gsubfn`'s NSE operating on local values, not on strings.

Heavy `data.table` NSE (`:=`, `.SD`, `on=`, `keyby=`) throughout `standings_*.R` and
`simulations_*.R`. `R/silence_tidy_eval_notes.R` is 124 lines of `utils::globalVariables()` to
quiet R CMD check — inert.

## Parallelism

`R/simulate_nfl.R:350` and `R/simulations.R:281` use `furrr::future_map(..., .options =
furrr_options(seed = TRUE))`. Under a non-sequential `future::plan()` this spawns worker R
processes via `parallelly`. Two consequences worth recording: (a) `future`'s `.onAttach`
`.future.R` sourcing (see `hooks-inventory.md`) applies in the parent session, and (b) the
user-supplied `process_games` / `compute_results` **closure is serialised and shipped to workers** —
by design, since the whole point is a user-defined simulation function.

`R/simulations_verify_fct.R` (`simulations_verify_fct()`) exists specifically to let users validate
their own function before it runs 10,000 times. It calls the user's function; it does not eval
strings.

## Data payloads

`R/sysdata.rda` (439 bytes) — loaded with `Rscript --vanilla`: `TIEBREAKERS_NONE`,
`TIEBREAKERS_NO_COMMON`, `TIEBREAKERS_THROUGH_SOS` (numeric constants) and `div_vec` / `conf_vec`
(36-element named character vectors). Nothing else.

`data/` holds 8 `.rda` files — `divisions`, `sims_games_example`, `sims_teams_example`, and five
`dictionary_*` data frames. All documented in `R/data_doc.R`; all plain data frames.

## Anything surprising

Nothing. `R/utils.R:36-41` `strip_nflverse_attributes()` deletes `nflverse*` and
`.internal.selfref` attributes before joins — a correctness fix. `R/summary_nflseedR.R` and
`R/standings_prettify.R` emit `gt` HTML tables; `gt::opt_css()` at `standings_prettify.R:141-155`
injects a constant CSS string.

## Scan rows

1 hit: `R/utils.R` `Sys_getenv` — actually `R/simulations_verify_fct.R:216`
`Sys.getenv("IN_PKGDOWN")`, benign.

**Verdict: the cleanest of the six.** No hooks, no writes, no deserialisation, no dynamic
evaluation of external content. Its only external dependency for data is nflreadr.
