# Escalation review — memoise 2.0.1

**Escalation:** E14 (cache backends deserialise without validation)
**Verdict:** **FINDING — Low**
**Executes when:** call time, on any memoised-function cache hit, when a non-memory backend is
selected
**Ran on this machine:** **NO** — no filesystem cache directory exists

## Files read

`sources/memoise/R/cache_filesystem.R:30-62` in full, `sources/memoise/R/cache_s3.R:45-60`,
`sources/memoise/R/cache_gcs.R:48-62`, plus the consumer wiring in `nflreadr/R/zzz.R`,
`nflplotR/R/zzz.R` and `ggpath/R/zzz.R` (via `hooks-inventory.md`).

## What executes, when, under whose control

```r
cache_filesystem.R:36   path <- normalizePath(path)
cache_filesystem.R:43   cache_set <- function(key, value) saveRDS(value, file = file.path(path, key), compress = compress)
cache_filesystem.R:47   cache_get <- function(key) readRDS(file = file.path(path, key))
cache_filesystem.R:51   cache_has_key <- function(key) file.exists(file.path(path, key))
```

The whole mechanism is four lines. `cache_has_key()` tests for a file; if it exists, `cache_get()`
`readRDS()`s it and the result is returned **as the function's value, with no validation of any
kind** — no type check, no structure check, no provenance check. `cache_s3.R:52` and
`cache_gcs.R:55` are the same shape against a downloaded temp file.

`readRDS()` on an attacker-controlled file is a real primitive. It does not directly `eval()`, but
deserialising R objects reconstructs closures with their environments, promises, and S4/R5 objects
with `initialize` methods — and the deserialised value is then *used* by the caller as if it were
the function's legitimate return value.

**Why WS-C escalated it, and why that framing is right.** Its note reads: "this is the mechanism
that makes the remote-`readRDS` notes in the targets *persistent* rather than per-session." That is
the key insight. Across the closure there are many `readRDS()`-of-remote-bytes rows classified
`note`; individually each is a one-shot, in-memory event. memoise in `filesystem` mode **writes
those deserialised objects to disk and reads them back on every subsequent session** — converting a
transient trust decision into durable on-disk state that is re-deserialised indefinitely.

**Consumers in this closure** (all opt-in, all confirmed in their load hooks):
- `nflreadr/R/zzz.R:2-82` — rebinds `rds_from_url`, `csv_from_url`, `raw_from_url`,
  `parquet_from_url` to memoised versions; with `options(nflreadr.cache = "filesystem")` creates
  `rappdirs::user_cache_dir("nflreadr")` and caches **deserialised remote objects** for 24 h
- `nflplotR/R/zzz.R:2-63` — memoises `reader_function`; `options(nflplotR.cache = "filesystem")`
  creates `R_user_dir("nflplotR","cache")`
- `ggpath/R/zzz.R:2-23` — same pattern

The default for all three is in-memory, not filesystem. Filesystem mode is a deliberate user choice.

## Provenance on this machine

| Check | Result |
|---|---|
| `installed-manifest.csv` | `"memoise","2.0.1","MIT + file LICENSE","no","R 4.6.1; ; 2026-07-27 04:23:42 UTC; unix","2026-07-26T21:23:42"` — pure R |
| install log `bznitqj7o.output` | ordinary CRAN source install, no `configure` |
| `~/Library/Caches/org.R-project.R/R/nflreadr` | **absent** |
| `~/Library/Application Support/org.R-project.R/R/nflplotR` | **absent** |
| `~/Library/Application Support/org.R-project.R/R/nfl4th` | **absent** |
| Conclusion | filesystem caching has never been enabled; no cache file has ever been written or read |

## Verdict and rationale

**FINDING — Low.** The code is unremarkable — a four-line `saveRDS`/`readRDS` pair — but it is the
component that turns per-session trust in remote data into persistent, silently re-deserialised
on-disk state. A tampered or replaced cache file is loaded with no validation and returned as
though it were fresh data (`cache_filesystem.R:47`). It is Low rather than higher because it is
strictly opt-in, unexercised on this host, and requires an attacker who can already write to the
user's cache directory — at which point they have other options. It is a *finding* rather than
accepted risk because a cache is not something users think of as a trust boundary, and because the
same `readRDS`-of-remote-bytes pattern appears throughout the closure with memoise as its
persistence layer.

## Defender action

1. Prefer the **default in-memory** cache. Do not set `options(nflreadr.cache = "filesystem")`,
   `nflplotR.cache` or `ggpath.cache` to `"filesystem"` unless the performance gain is genuinely
   needed.
2. If filesystem caching is enabled, treat the cache directories as security-relevant state:
   restrictive permissions (`0700`), never on a shared or synced volume, and purge them
   (`memoise::forget()`, or delete the directory) after any suspected compromise or when switching
   data sources.
3. Note the 24 h TTL in `nflreadr`: a poisoned entry persists for a day, not a session.
4. Treat this together with `xfun`'s persistent `R_user_dir` cache (`xfun.md`) — same class, same
   control.
