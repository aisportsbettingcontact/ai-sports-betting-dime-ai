# offline-behavior.md — Task 4 (WS-D) Step 6

Method: `https_proxy=http://127.0.0.1:9 http_proxy=http://127.0.0.1:9 no_proxy=''` in the shell
env before `Rscript --vanilla` (port 9 = discard; nothing listens there, so every connection
attempt fails fast and deterministically rather than timing out slowly against an unreachable real
host). Two scenarios, each the same 6 calls as Steps 4-5:

- **6a — offline + cold** (`$ROOT/tmp/step6_offline_cold.R`, fresh empty
  `$ROOT/tmp/cache_offline_cold`): `$ROOT/tmp/step6/offline_cold_stdout.txt`
- **6b — offline + warm** (`$ROOT/tmp/step6_offline_warm.R`, reusing the good, fully-populated
  `$ROOT/tmp/cache` from Steps 4-5): `$ROOT/tmp/step6/offline_warm_stdout.txt`

## Headline: nflreadr fails *safe* but fails *silent* — no R error ever propagates to the caller

Across all 6 calls in the cold+offline scenario, **not one raised an R-level error/exception**.
Every call in `run_and_report()`'s `tryCatch(..., error = ...)` wrapper took the success branch,
not the error branch — the function always returned a normal R object, just an empty one.

Real captured warning sequence for `load_schedules(2026)` (identical shape for the other 4
default-format loaders):
```
[WARNING] [simpleWarning/warning/condition]
  URL 'https://github.com/nflverse/nfldata/raw/master/data/games.rds': status was 'Couldn't connect to server'
[WARNING] [rlang_warning/warning/condition]
  Failed to readRDS from <https://github.com/nflverse/nfldata/raw/master/data/games.rds>
[WARNING] [rlang_warning/warning/condition]
  Unknown or uninitialised column: `roof`.     (x2)
load_schedules(2026): elapsed=0.039s RETURNED dim=0x1 class=nflverse_data,tbl_df,tbl,data.table,data.frame
```

Reading this against the source explains exactly what happens, layer by layer
(`sources/nflreadr/R/from_url.R:65-78`):
```r
rds_from_url <- function(url) {
  cache_message()
  con <- url(url)                                  # (1) does NOT throw even with a dead proxy
  on.exit(close(con))
  load <- try(readRDS(con), silent = TRUE)          # (2) THIS is where the real failure surfaces
  if (inherits(load, "try-error")) {
    cli::cli_warn("Failed to readRDS from {.url {url}}")   # (3) downgraded to a warning
    return(data.table::data.table())                # (4) ...and swallowed into an empty result
  }
  data.table::setDT(load); load
}
```
1. `con <- url(url)` — constructing the connection object never fails outright, even against a
   black-hole proxy (base R's `url()` is lazy; it doesn't dial out until something actually reads
   from the connection).
2. `readRDS(con)` is where the connection is actually opened and the failure happens. R's own
   internal libcurl connection layer surfaces the low-level failure as a **warning**
   (`status was 'Couldn't connect to server'`), not an error — and the subsequent `readRDS` parse
   failure raises an R error, but it's wrapped in `try(..., silent = TRUE)`.
3. `nflreadr` catches that `try-error` and downgrades it to its own `cli_warn()` — a second,
   friendlier warning, still not an error.
4. It returns `data.table::data.table()` — a completely empty (0-row, 0-column) table — as if that
   were a normal, valid answer.

`load_schedules()`'s own post-processing then makes things subtly worse: its
`out$roof[!out$roof %in% valid_roof_values] <- NA_character_` line runs against the empty table
regardless (`out$roof` on a columnless data.table is `NULL`; `NULL %in% x` is `logical(0)`; `out$roof[logical(0)]
<- NA_character_` **auto-vivifies a zero-row `roof` column** on the data.table). That's why the
final shape is reported as `0x1`, not `0x0` — one phantom column, a small but concrete illustration
of how a silent-failure design can produce increasingly surprising downstream shapes the further
you get from the actual point of failure. `load_teams()` shows the analogous
`Unknown or uninitialised column: 'team_abbr'` warning from its own current-teams filter line.

**Practical consequence**: a caller that does `pbp <- load_pbp(2025)` and immediately proceeds
(the overwhelmingly common usage pattern in every example in the package's own docs) gets **no
exception to catch**. The only observable symptoms are (a) warnings, which are very easy to miss or
suppress (`suppressWarnings()`, `options(warn = -1)`, running inside `knitr`/Shiny/anything that
routes warnings elsewhere), and (b) an empty data frame, which silently breaks everything
downstream (an `nrow() == 0` frame passed into a model, a join, a plot) with no indication *why* it
is empty. This is the single most consequential Step 6 finding: **nflreadr does not fail loudly
when offline; it fails by quietly handing back nothing.**

## Follow-on finding: a failed cold-offline fetch gets cached exactly like a success — and later poisons a real fetch

Because `rds_from_url()`'s failure handling (above) is a normal `return()`, not a thrown/propagated
condition, **`memoise` sees it as a perfectly normal, cacheable return value** — nothing in the
memoisation layer distinguishes "successfully fetched, here is your empty table" from "this
particular fetch legitimately returns 0 rows." The `$ROOT/tmp/cache_offline_cold/nflreadr/`
directory went from **0 files before the 6a run to 5 files after it** — every one of the 5
default-format calls wrote a real, permanent (24h-TTL) cache entry for its *empty* result:
```
cache dir exists before run: TRUE  n_files: 0
...
cache dir after run: exists= TRUE  n_files: 5
```
Confirmed this is a real poisoning risk, not a theoretical one, with a direct three-step
reproduction (`$ROOT/tmp/step6/verify_poisoned_cache.R`): (1) 6a fetches `load_schedules(2026)`
while offline, caching an empty result under `$ROOT/tmp/cache_offline_cold`; (2) network access is
then fully restored (no proxy env at all); (3) **the same cache dir, same URL, called again while
genuinely online**:
```
load_schedules(2026) NOW (back online, same poisoned cache dir): elapsed=0.013s dim=0x1
==> CONFIRMED: stale EMPTY result served from cache; network was NOT retried even though it is reachable again.
```
The cache key is purely `hash(url, ...)` (see `cache-behavior.md`) — it carries no notion of
whether the cached value represents success or failure, so there is no automatic self-healing. The
only recovery path is `nflreadr::clear_cache()` (drops everything) or waiting out the fixed 24h
TTL. In this environment the finding is scoped to `nflreadr.cache="filesystem"` mode specifically
(the default `"memory"` mode has the identical poisoning behavior *within a process*, but a fresh
process — the common case for scripts/cron jobs — naturally clears it; **filesystem mode is the one
place this becomes a genuine multi-hour reliability trap**, and filesystem mode is exactly what a
user reaching for cross-run persistence would deliberately opt into).

## Warm + offline: complete, correct, silent success — the positive counterpart

6b (same 6 calls, offline, but pointed at the good `$ROOT/tmp/cache` populated by Steps 4-5)
produced **zero warnings, zero errors, and full correct data** for every one of the 6 calls:

| Call | dim returned | elapsed | 
|---|---|---|
| `load_schedules(2026)` | 272 x 46 | 0.050s |
| `load_players()` | 25035 x 39 | 0.202s |
| `load_rosters(2025)` | 3137 x 36 | 0.028s |
| `load_pbp(2025)` | 48771 x 372 | 1.812s |
| `load_teams()` | 32 x 16 | 0.002s |
| `fast_scraper_schedules(2026)` | 272 x 46 | 0.069s |

Every row's `status` in `dynamic-fetch-log.csv` is `OK|cache_hit_precheck=TRUE`. This directly
confirms `memoise`'s cache lookup happens **before** the wrapped function (and therefore before any
network call) ever runs — a cache hit means the underlying `url()`/`readRDS()` call is never even
attempted, so there is no dependence on connectivity at all once data is warm. From a pure
data-availability standpoint this is the correct, desirable "fail-safe, stale-cache-fallback"
behavior; the problem is narrowly that the *same* mechanism cannot distinguish a warm cache of
"good data I already have" from a warm cache of "an empty result I got because I was offline
earlier" (see above) — it is one undifferentiated cache, and its silence is symmetric in both the
good and bad cases.

## Answering the brief's exact questions

- **Does it fail safe?** Yes, in the narrow sense that it never crashes/throws and never returns
  corrupt/partial data — it returns a well-typed, empty result.
- **Does it fail *loud*?** No — only R warnings, easily missed/suppressed, no error.
- **Stale-cache fallback?** Yes, and it works well when the staleness is "old but valid data"
  (6b). It works *identically* — which is to say, badly — when the staleness is "a cached failure,"
  silently masking that fresh data is now available (verified reproduction above).

## Evidence note

No retries were needed for Step 6 — every offline call resolved (successfully-empty or
successfully-cached-good) on the first attempt; nothing here required the "retry once, then record
gap" fallback.
