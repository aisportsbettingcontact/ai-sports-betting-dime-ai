# cache-behavior.md — Task 4 (WS-D) Steps 4-5

## Two different caches, and why the brief's cold-vs-warm test requires the non-default one

`nflreadr` has an in-process **memory** cache by default (`options(nflreadr.cache)` default is
`"memory"`, wired up via `memoise::memoise(fn, cache = cachem::cache_mem())` at `.onLoad`, see
`notes.md` Step 2). This cache **cannot, by construction, ever persist across a fresh `Rscript
--vanilla` process** — every new process starts with an empty in-memory cache. We confirmed this
is real and fast *within* one process during Step 2 mechanism validation
(`$ROOT/tmp/step2/harness_verify2.R`): first call to a tiny test fixture, 0.8276s
(`cache_hit_precheck=FALSE`); second call, same process, same URL, 0.0082s
(`cache_hit_precheck=TRUE`) — but that speedup evaporates the instant a new process starts.

Since the brief's Step 4/5 design (cold in one process, warm in a *separate* process) is only
meaningful against a cache that can survive a process boundary, Steps 4-5 deliberately set the
**non-default** filesystem-cache mode, using the two names discovered in Step 2:
```r
options(nflreadr.cache = "filesystem")   # must be set BEFORE library(nflreadr) -- .onLoad reads it once
Sys.setenv(R_USER_CACHE_DIR = "$ROOT/tmp/cache")  # (set in the shell env before Rscript starts)
```
This is exactly the "using the names discovered in Step 2" instruction, and doubles as the
mechanism that keeps the cache **out of `~/Library/Caches`**, per the global constraint — verified
after every run in this step that `~/Library/Caches/nflreadr` was never created.

## Cache format and location

- **Location**: `rappdirs::user_cache_dir(appname = "nflreadr")` resolves to
  `$R_USER_CACHE_DIR/nflreadr` when `R_USER_CACHE_DIR` is set (confirmed: resolved to
  `$ROOT/tmp/cache/nflreadr` for every Step 4-6 run). Backing implementation: `cachem::cache_disk(dir
  = cache_dir)`, one process-independent directory shared by all four memoised fetch functions
  (`rds_from_url`, `csv_from_url`, `raw_from_url`, `parquet_from_url`).
- **Format**: one flat file per unique cache key, named `<32-hex-char-hash>.rds` — i.e. `cachem`
  itself always serializes cache entries as R-native RDS, **regardless of the `nflreadr.prefer`
  file format the original data came from**. A `parquet`-sourced or `csv`-sourced fetch result is
  still stored on disk as an `.rds` (confirmed via `file`, see `serialization-channel.md`). The
  hash key is derived from `rlang::hash()` over the function's own source hash plus the call's
  evaluated arguments (`memoise::memoise()`'s `key <- encl$`_hash`(c(encl$`_f_hash`, args, ...))`,
  `sources/memoise/R/memoise.R:158-164`) — i.e. keyed by URL (the only argument), not by content,
  not by any server-provided ETag/Last-Modified.
- **Eviction**: `memoise::timeout(86400)` — a fixed 24-hour TTL baked into nflreadr's own
  `.onLoad` (`~ memoise::timeout(86400)` passed to every one of the four `memoise()` calls,
  `sources/nflreadr/R/zzz.R:24/33/42/51`). There is no size-based eviction, no LRU, and — this
  matters, see below — **no connectivity-aware or content-based invalidation at all**. The only way
  to force a refresh before 24h is `nflreadr::clear_cache()` (drops the whole cache) or changing the
  call's arguments (different URL/season -> different key). Confirmed no user-facing option exists
  to change the 24h figure short of monkey-patching the package.

## Cold run (Step 4): `$ROOT/tmp/step4_cold.R`, fresh empty `$ROOT/tmp/cache`

All 6 calls were genuine cache misses (`cache_hit_precheck=FALSE` on every row) and produced real
network fetches with real data. Full run: **11.5s wall** (`time` around the whole process).

| Call | URL | elapsed (loader-level) | rows x cols (raw fetch) | in-memory bytes |
|---|---|---|---|---|
| `load_schedules(2026)` | `.../nfldata/raw/master/data/games.rds` | 1.223s | 7548 x 46 | 4,321,880 |
| `load_players()` | `.../releases/download/players/players.rds` | 1.679s | 25035 x 39 | 25,718,352 |
| `load_rosters(2025)` | `.../releases/download/rosters/roster_2025.rds` | 0.867s | 3137 x 36 | 3,812,800 |
| `load_pbp(2025)` | `.../releases/download/pbp/play_by_play_2025.rds` | 4.851s | 48771 x 372 | 160,060,384 |
| `load_teams()` | `.../releases/download/teams/teams_colors_logos.rds` | 0.710s | 36 x 16 | 45,432 |
| `nflfastR::fast_scraper_schedules(2026)` | same URL as `load_schedules` | 0.052s | 7548 x 46 | 4,321,880 |

Note the last row: `fast_scraper_schedules(2026)`, called **after** `load_schedules(2026)` in the
same script, was already `cache_hit_precheck=TRUE` — direct runtime proof (not just source-reading)
that it shares the exact same cache key as `nflreadr::load_schedules()`, because it *is*
`nflreadr::load_schedules()` under a deprecated name (`sources/nflfastR/R/top-level_scraper.R:520-527`:
`fast_scraper_schedules <- function(...) { lifecycle::deprecate_warn(...); nflreadr::load_schedules(...) }`).
The deprecation warning fired exactly as the source implies:
`` `fast_scraper_schedules()` was deprecated in nflfastR 5.2.0. ℹ Please use `nflreadr::load_schedules()` instead. ``

After the cold run, `$ROOT/tmp/cache/nflreadr/` contained exactly **5** files (one per unique URL —
the 6th call was a cache hit, so no 6th file), totaling 17,482,382 bytes on disk:
```
43c5dcf62a76b1c6666ded503ff6c23e.rds    376,722 bytes
4880e3310c86c796fe055d095b288d64.rds    425,651 bytes
c15b1360d36cdf64f079f406174d855d.rds 14,362,113 bytes   <- the pbp fetch (see note below)
cbab9483a5e05c631f3ac8b04dd0c63b.rds  2,314,756 bytes
f12201e5e7458116c82836a5e2fdf116.rds      3,140 bytes
```
The play-by-play entry is instructive: the in-memory `object.size()` for that fetch was
160,060,384 bytes, but its on-disk RDS cache file is only 14,362,113 bytes (~11x smaller) — RDS's
default gzip compression on a wide (372-column), fairly repetitive play-by-play frame. This is why
`dynamic-fetch-log.csv`'s `bytes` column for `nflreadr:::loader[...]` rows is documented as an
in-memory proxy, never a wire/disk-size figure (see `notes.md`, `serialization-channel.md`).

## Warm run (Step 5): `$ROOT/tmp/step5_warm.R`, fresh process, **same** `$ROOT/tmp/cache`

All 6 calls were cache hits (`cache_hit_precheck=TRUE` on every row, confirmed via
`memoise::has_cache()` checked *before* each call, not inferred from timing alone). Full run:
**4.2s wall**, down from 11.5s cold (a ~2.7x whole-process speedup; the gap is smaller than the
per-call numbers below suggest because R startup + package loading — not fetching — dominates a
run this short).

| Call | cold elapsed | warm elapsed | speedup |
|---|---|---|---|
| `load_schedules(2026)` | 1.223s | 0.039s | 31x |
| `load_players()` | 1.679s | 0.213s | 8x |
| `load_rosters(2025)` | 0.867s | 0.025s | 34x |
| `load_pbp(2025)` | 4.851s | 1.191s | 4x |
| `load_teams()` | 0.710s | 0.003s | 237x |
| `fast_scraper_schedules(2026)` | 0.052s (already warm within cold run) | 0.032s | n/a |

`load_pbp`'s warm speedup (4x) is the smallest because, even on a cache hit, `cachem::cache_disk`
still has to read a 14.4MB compressed file off disk and `readRDS`-deserialize it into a 372-column,
48771-row frame — real work, just none of it is network I/O. The cache directory's file **count
and total byte size were byte-for-byte identical before and after** the warm run
(`n_files=5, total_bytes=17482382` both before and after; `setdiff(after_files, before_files)` was
empty) — direct confirmation of zero new writes, i.e. genuinely zero fetches, not just
small/negligible ones.

**Cross-check**: `$ROOT/tmp/cache/R/nfl4th` and `$ROOT/tmp/cache/R/nflplotR` do not exist after
either run — expected, since Steps 4-5 never load those two packages (only `nflreadr`/`nflfastR`),
so `R_USER_CACHE_DIR`'s redirection of their caches was never exercised here (it *was* exercised
qualitatively for `nfl4th` in Step 3's default-footprint run — see `load-side-effects.md` — with
the caveat that Step 3 deliberately did **not** set `R_USER_CACHE_DIR`, to observe nfl4th's true
default location).

## Self-review: are cold vs warm fetch *counts* consistent with this story?

Row **counts** at the `nflreadr:::loader[...]` layer are identical cold vs warm (6 and 6) — by
design, `loader()` itself is not memoised, only its three leaf functions are, so `loader()` always
executes and always produces a trace row regardless of cache status. The signal that distinguishes
cold from warm is never row-presence, it is (a) the `cache_hit_precheck=TRUE/FALSE` tag baked into
every row's `status` field, directly measured via `memoise::has_cache()` before the call, and (b)
`seconds`, which corroborates it (every `TRUE` row is dramatically faster than its `FALSE`
counterpart for the same URL — see table above). Documented in `notes.md` up front, specifically so
this wouldn't read as a contradiction on review.

See `offline-behavior.md` for what happens when cold/warm are combined with no network at all —
including a significant follow-on finding (a cache entry created from a *failed* cold-offline fetch
is indistinguishable, from the cache's perspective, from a successful one, and gets served back on
later calls even after connectivity returns).
