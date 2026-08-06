# load-side-effects.md — Task 4 (WS-D) Step 3

Method: one fresh `Rscript --vanilla` process per target package (script:
`$ROOT/tmp/step3_load_side_effects.R <pkg>`, raw output: `$ROOT/tmp/step3/<pkg>.out.txt`).
Each process snapshots `options()` names, `Sys.getenv()`, `search()`, `tempdir()` contents, and
`~/Library/Caches` top-level listing **before** and **after** `library(<pkg>)`, then prints only
the diff. No cache-directory env overrides were set for this step deliberately — Step 3 exists to
observe each package's *true default* footprint (Steps 4-6 later deliberately redirect caches away
from `~/Library/Caches`, per the brief). `~/Library/Caches` was not otherwise touched by this audit
before these runs; it is a real, long-lived directory on the host with hundreds of unrelated
pre-existing entries from normal machine use, so only the *diff* is meaningful, not the raw
listing.

## Summary table

| Package | `library()` wall time | New `options()` names | Env vars changed | New `search()` entries | New tempdir files | New `~/Library/Caches` top-level entries |
|---|---|---|---|---|---|---|
| nflreadr | 0.222s | 19 (all `data.table`/`callr` — dependency noise, none nflreadr-specific) | none | `package:nflreadr` | none | none |
| nflfastR | 0.780s | 20 (as above + `ambiguousMethodSelection`) | none | `package:nflfastR` | none | none |
| nflseedR | 0.402s | 32 (as above + `future.*`/`globals.*`/`progressr.*`) | none | `package:nflseedR` | none | none |
| nfl4th | 0.636s | 20 (as above + `ambiguousMethodSelection`) | none | `package:nfl4th` | none | none (see DNS/cache finding below) |
| nflplotR | 0.411s | 19 (as above) | none | `package:nflplotR` | none | none |
| nflverse | 0.900s | 33 (union of all of the above; attaches all 5 as "core") | none | `package:nflplotR`, `package:nflreadr`, `package:nfl4th`, `package:nflseedR`, `package:nflfastR`, `package:nflverse` (6 — nflverse is a meta-package, `.onAttach` walks a `core <- c("nflfastR","nflseedR","nfl4th","nflreadr","nflplotR")` vector, `sources/nflverse/R/core.R`) | none | none |

None of the six packages set any environment variables on load in this environment (the
`Sys.setenv("OMP_THREAD_LIMIT"=...)`/`Sys.setenv("OMP_NUM_THREADS"=...)` branch in nflplotR's
`.onLoad`, `sources/nflplotR/R/zzz.R`, only fires when CRAN's own
`_R_CHECK_(EXAMPLE|TEST)_TIMING_CPU_TO_ELAPSED_THRESHOLD_` env vars are set to a nonzero value —
not the case in an ordinary interactive/CI environment like this one). No tempdir files were added
by any of the six `library()` calls alone (before any data is actually loaded).

All 90-package-closure "added options" are dependency noise from shared transitive deps
(`data.table` sets ~19 `datatable.*` options at its own `.onLoad`; `callr` sets one；`future` /
`globals` / `progressr` add ~13 more when `nflseedR` or `nfl4th`/`nflverse` pull them in for
parallel-processing support; `ambiguousMethodSelection` comes from the S4/S7 method-dispatch setup
triggered transitively by `ggplot2`'s S7 usage when `nflfastR`/`nfl4th`/`nflverse` load it). None of
nflreadr's, nflplotR's, or nfl4th's **own** behavior-controlling options
(`nflreadr.cache`/`nflreadr.verbose`/`nflreadr.cache_warning`/`nflreadr.prefer`/`nflplotR.cache`/
`nfl4th.keep_games`) are ever added to `options()` by merely loading the package — confirmed
directly: `getOption()` for every one of them still returns `NULL` after `library(<pkg>)` in every
run (see the "selected option values AFTER load" section of each `$ROOT/tmp/step3/<pkg>.out.txt`).
Every one of these packages reads its options with a `default=` fallback at *call* time rather than
writing a default into the global options table at *load* time — so `options()` introspection alone
(e.g. what a monitoring tool might snapshot) will never reveal that these packages have
cache/verbosity knobs at all; you have to already know the names (see `notes.md` Step 2).

## Headline finding: `nfl4th` performs an unconditional live DNS lookup, and can conditionally delete a user cache file, on every `library(nfl4th)`

Source: `sources/nfl4th/R/zzz.R` `.onLoad`:
```r
.onLoad <- function(libname, pkgname) {
  is_online <- !is.null(curl::nslookup("github.com", error = FALSE))
  keep_games <- isTRUE(getOption("nfl4th.keep_games", FALSE))
  if (!is_online && !keep_games && !probably_cran()) { ... }
  if (!is_online && keep_games && !probably_cran()) { ... }
  if (!dir.exists(R_user_dir("nfl4th", "cache"))) {
    dir.create(R_user_dir("nfl4th", "cache"), recursive = TRUE, showWarnings = FALSE)
  } else if (file.exists(nfl4th_games_path()) && !keep_games) {
    file.remove(nfl4th_games_path())   # <-- runs on EVERY load unless nfl4th.keep_games=TRUE
  }
}
```
This is not conditional on calling any nfl4th function — it happens purely from `library(nfl4th)`
(or loading it transitively via `library(nflverse)`).

- **DNS lookup, confirmed live via `trace()`** (not just source-reading): a targeted reproducer
  (`$ROOT/tmp/step3/nfl4th_nslookup_trace.R`) traced `curl::nslookup` in the `curl` namespace, then
  ran `library(nfl4th)` in a fresh `--vanilla` process:
  ```
  Tracing function "nslookup" in package "namespace:curl"
  [TRACE] curl::nslookup() invoked with host= github.com
  library(nfl4th) elapsed s: 0.589
  curl::nslookup was called during library(nfl4th)? TRUE
  ```
  This is a genuine network operation (DNS resolution against whatever resolver the host is
  configured with) triggered purely by loading the package, with no way to opt out (there is no
  option to skip the lookup itself — only `nfl4th.keep_games` changes what happens *after* it,
  and only when the lookup fails). It is intentionally **not** added as a `dynamic-fetch-log.csv`
  row: that log's contract (`call,url,status,bytes,dest_file,seconds`) is HTTP-fetch-shaped and the
  brief's 4 named hooks are HTTP functions; a bare hostname resolution has no meaningful `bytes` or
  `dest_file`. Recorded here and in `notes.md` instead, per "any host outside the static census is
  itself a finding" — `github.com` is in-census, so the *host* isn't novel, but the *lookup itself
  happening unconditionally at load time* is a runtime-behavior finding in its own right.

- **Cache directory / file deletion, verified against real on-disk state, not assumed:** before any
  command in this task ran, `~/Library/Caches/org.R-project.R/R/nfl4th` already existed on this
  host (`stat` shows mtime `Jul 26 21:26`, pre-dating every `$ROOT` artifact from this task, i.e.
  **not created by this audit** — recorded explicitly so it isn't misattributed) and was empty (no
  `games.rds`-equivalent file inside). Re-checked immediately after the Step 3 `nfl4th` run: same
  mtime, still empty — in this environment the delete-branch was a no-op because there was nothing
  to delete, and the dir-create branch was a no-op because the directory already existed. Had a
  games cache file been present, `.onLoad` would have silently deleted it (no prompt, no log
  message on that path). This exact directory is why the task's "never deliberately write
  `~/Library/Caches`" constraint matters in practice: `nfl4th` writes/deletes there **by default**,
  with no override besides `options(nfl4th.keep_games = TRUE)` (which only suppresses the delete,
  not the dir-create) or redirecting via `R_USER_CACHE_DIR` (see `notes.md` Step 2 — the same env
  var also governs nfl4th's cache dir, since it uses `tools::R_user_dir()`, which checks
  `R_USER_CACHE_DIR` first).

## nflplotR: parallel cache design, but memory-only by default (no disk footprint observed)

`sources/nflplotR/R/zzz.R` `.onLoad` mirrors nflreadr's pattern almost exactly: an independent
`nflplotR.cache` option (`"memory"` default / `"filesystem"` / `"off"`), memoising an internal
`reader_function` (used when nflplotR reads e.g. team logo images for plotting) via
`cachem::cache_mem()` by default. Since the default is `"memory"`, and Step 3 never calls any
nflplotR function beyond `library()` itself, no `cache_dir` branch executes and no disk write was
expected or observed — confirmed (`~/Library/Caches` diff: none).

## nflverse, nflfastR, nflseedR: no notable network/cache side effects at load time

- `nflverse`'s `.onAttach` (`sources/nflverse/R/zzz.R`) only does `crayon`/`cli` console setup and
  attaches the 5 "core" packages (each of which then runs its own `.onLoad`/`.onAttach`, already
  covered above/below) — no network calls, no cache writes of its own.
- `nflfastR` and `nflseedR` have **no** `.onLoad`/`.onAttach`/`.onUnload` hooks at all (confirmed:
  `grep -RIl '\.onLoad\|\.onAttach\|\.onUnload'` over each package's `R/` directory returns no
  files for either). Their only load-time footprint is the ordinary R package/namespace machinery
  and their dependencies' own hooks (data.table, future/progressr for nflseedR, S7/ggplot2 for
  nflfastR via `fastrmodels`).

## Cross-reference

See `notes.md` Step 3 section for the script list and the exact commands run. The DNS-lookup and
cache-delete behavior of `nfl4th` is the most consequential finding of this step for the rest of
WS-D's "network endpoints & runtime behavior" scope, since it means **`library(nfl4th)` alone
(before calling a single nfl4th function) is a network operation**, independent of anything the
Step 4-6 loader battery exercises.
