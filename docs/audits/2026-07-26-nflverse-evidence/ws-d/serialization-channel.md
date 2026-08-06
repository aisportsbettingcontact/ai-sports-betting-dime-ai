# serialization-channel.md — Task 4 (WS-D) Step 7

Combines the fetch log (`dynamic-fetch-log.csv`, Steps 4-6) with source reading across all 6
target packages. This step's own instruction ("grep sources/nflreadr/R for readRDS/qs::/arrow::")
was extended to all 6 targets, done directly against `$ROOT/sources/<pkg>/R/*.R`, since three of
them — not just nflreadr — turned out to have their own independent fetch/deserialize code paths
(nfl4th, nflfastR, nflplotR; see section 1 table). `$ROOT/evidence/ws-c/pattern-hits.csv` (WS-C's
own pattern scan, which finished mid-way through this task and was cross-checked once available)
corroborates every nflreadr/nfl4th call site found independently here, and additionally surfaced
one this task's own manual read had not reached: `nflfastR/R/utils.R` has its own `readRDS`
call sites (lines 56, 110, 213) — folded into section 1 below. All file:line cites are against
`$ROOT/sources/<pkg>/...`.

## 1. Formats observed, by host

| Format | Consumer function(s) | Host(s) observed | Deserializer | Evidence |
|---|---|---|---|---|
| **rds** (default, `nflreadr.prefer="rds"`) | `nflreadr::rds_from_url()` — used by `load_schedules`, `load_players`, `load_rosters`, `load_pbp`, `load_teams`, and (transitively) `nflfastR::fast_scraper_schedules` | `github.com` (both `.../raw/master/...` and `.../releases/download/...` paths) | base R `readRDS()` | All 24 rows of `dynamic-fetch-log.csv`; `sources/nflreadr/R/from_url.R:65-78` |
| **rds** (raw-vector-wrapped XGBoost model) | `nfl4th:::raw_rds_from_url()` (nfl4th's own, independently duplicated copy of the same pattern) | `github.com/nflverse/nfl4th/releases/download/model_archive/{wp,fd}_model.rds` | base R `readRDS()`, **then** `xgboost::xgb.load.raw()` (a second, C++-side deserializer) | Live-verified: `$ROOT/tmp/step7_nfl4th_model_check.R` fetched `wp_model.rds` (7,663,086 raw bytes) and successfully produced a live `xgb.Booster`; source: `sources/nfl4th/R/helpers.R:284-307`, `sources/nfl4th/R/cache.R:31-83` |
| **csv** (only if `nflreadr.prefer="csv"` or `file_type="csv"` explicitly passed — not the default, not used by the required Step 4-6 battery) | `nflreadr::csv_from_url()` -> `data.table::fread()` -> internally `utils::download.file()` | `github.com/nflverse/nflverse-data/releases/download/...` | `data.table::fread()` (text parser) | Supplementary check (kept out of the official log, see `notes.md`): `load_teams(file_type="csv")` produced one real `utils::download.file` row (status=0, 18,919 bytes) + one `nflreadr:::loader[csv]` row for the same fetch |
| **parquet** (only if explicitly requested) | `nflreadr::parquet_from_url()` -> `curl::curl_fetch_memory()` -> `arrow::read_parquet()` | would be `github.com/nflverse/.../releases/download/.../*.parquet` | `arrow::read_parquet()` (Arrow C++ library) | **Unreachable in this environment**: `arrow` is not among the 90 installed packages. Live-verified fail-fast: `load_teams(file_type="parquet")` throws `rlib_error_package_not_found: The package "arrow" is required.` *before* any network attempt — the one format path that fails loud instead of silent (contrast with `offline-behavior.md`'s network-failure case). Source: `sources/nflreadr/R/from_url.R:162-183`. |
| **qs** | `nflreadr::qs_from_url()` | n/a | n/a | **Dead code**: `sources/nflreadr/R/from_url.R:208-213` — the function body is `lifecycle::deprecate_stop("1.6.0", "qs_from_url()", ...)`; it unconditionally errors before doing anything, because (per its own roxygen comment) "the underlying package qs has been removed from CRAN on 2026-01-17." No live qs traffic is possible through nflreadr at the installed version (1.5.1) regardless of any option. |
| **rds** (small mapping file, not the image itself) | `nflplotR:::load_headshots()` -> reuses `nflreadr::rds_from_url()` | `github.com/nflverse/nflplotR/releases/download/nflplotr_infrastructure/headshot_gsis_map.rds` | base R `readRDS()` (same call as the primary path — not a separate implementation) | Source only: `sources/nflplotR/R/utils.R:54-57`; not exercised live (not part of the required loader list; the map's *values* are image URLs on `static.www.nfl.com`, fetched later, out of scope for this package's own code — presumably by a browser/graphics device rendering an `<img>` tag, not by nflplotR itself) |
| **rds** (per-game raw scrape files, debug/build path — not `load_pbp`'s normal season-level path) | `nflfastR:::load_raw_game()` -> `nflreadr::rds_from_url()` (same shared function) *or*, when bytes are already in hand, `nflfastR:::read_raw_rds(raw)` -> `gzcon(rawConnection(raw))` -> `readRDS()` | `raw.githubusercontent.com/nflverse/nflfastR-raw/master/raw/<season>/<game_id>.rds` (a 3rd nflverse-org repo, `nflfastR-raw`, confirmed present in `url-census-closure.txt`, 3 occurrences) — falls back to a **local file** under `getOption("nflfastR.raw_directory")` first if one exists, no remote call at all in that case | base R `readRDS()`, via a *third* independent code path (own `gzcon`/`rawConnection` wrapper, not reusing `rds_from_url`) | Source only, corroborated by WS-C's independent pattern scan (`evidence/ws-c/pattern-hits.csv`: `nflfastR,R/utils.R,56/110/213,readRDS,...`); `sources/nflfastR/R/utils.R:53-58,93-118,195-214`, `sources/nflfastR/R/save_raw_pbp.R:61`. Own roxygen comment calls this path "esp. for debugging" — not exercised live here since it isn't one of the 5 required loaders and it delegates to the already-analyzed `rds_from_url` in the network case. `nflfastR.raw_directory` is a distinct, undocumented-in-Rd option in the same family as `nflreadr.download_path`; unlike `nflreadr`'s cache dir, no env-var override was found for it. |

`nflseedR` does no fetching of its own at all (confirmed: zero hits for
`curl::|curl_fetch|curl_download|download\.file|readRDS|url\(` across its entire `R/` directory) —
it is a pure simulation engine operating on data the caller already has in memory.

**Tally across all 6 targets: every single deserialization call site found — by this task's own
read and independently corroborated by WS-C's pattern scan — is a bare `readRDS()` (occasionally
via `gzcon(rawConnection(raw))` instead of a `url()` connection, mechanically equivalent) or, once,
`arrow::read_parquet()`/`data.table::fread()`. Zero call sites, in zero packages, are preceded by
any check of the bytes' origin or integrity.** The pattern (`con <- url(url); try(readRDS(con))`)
is independently re-implemented at least three times across this codebase (`nflreadr::rds_from_url`,
`nfl4th:::raw_rds_from_url`, and the network branch of `nflfastR:::load_raw_game`/`read_raw_rds`) —
none of the three re-implementations added an integrity check the others lack.

**One step further, found via WS-C's `escalations.md` and independently confirmed against source
here** (not part of the required Step 4-6 loader battery — `calculate_player_stats(weekly=TRUE)`
was not one of the 5+1 exercised loaders, so this was not live-tested in this task, only source
-verified): `nflfastR:::add_dakota()` (`sources/nflfastR/R/aggregate_game_stats.R:687-691`) uses
`load()` instead of `readRDS()`:
```r
con <- url("https://github.com/nflverse/nflfastR-data/blob/master/models/dakota_model.Rdata?raw=true")
try(load(con), silent = TRUE)
close(con)
```
(URL confirmed present in `url-census-closure.txt`, 1 occurrence — a **4th** distinct nflverse-org
data repo beyond `nflverse-data`, `nfldata`, and `nflfastR-raw`: `nflfastR-data`.) `load()` is a
strictly larger trust surface than `readRDS()`: rather than returning a value the caller inspects,
it deserializes and injects an entire saved-workspace's worth of *named objects* directly into the
calling frame — here the code simply trusts that a variable named `dakota_model` will appear
(pre-initialized to `NULL` so a failed/tampered load degrades to "model unavailable" rather than a
crash — the same silent-friendly-failure design already documented in `offline-behavior.md`, now
confirmed as a repeated pattern, not a one-off) and passes it straight into `mgcv::predict.gam()`.

**Also cross-referenced from WS-C, network-endpoint-relevant rather than serialization-relevant,
noted here since it bears directly on "exactly which hosts are contacted" and was not live-tested
in this task (no current/live game to query against on this run date):** `nfl4th::get_4th_plays()`
(`sources/nfl4th/R/get_game_data.R:42`) fetches live in-game state from
**`http://site.api.espn.com/...`** — plain HTTP, no TLS at all, the only cleartext endpoint this
audit found actually being fetched, across all 6 targets (the static census separately contains
other incidental `http://` strings that are never fetched by any package's own code — e.g.
`nflfastR`'s doc-only `\url{}` citation of `www.nflgsis.com`,
`sources/nflfastR/R/data_documentation.R:59` — so every *fetched* endpoint in this audit besides
this one is `https://`). The payload there is JSON (`jsonlite::fromJSON()`), not R-native serialization, so the
specific deserialization risks discussed above don't transfer directly — but an unencrypted
transport for live game data feeding directly into a real-time decision-support computation is a
distinct, concrete finding in its own right, and the most actionable one in this file for a sports
betting product to be aware of.

## 2. Is ANY checksum or signature verified before deserialization? No — anywhere, for any format, in any of the 6 target packages.

Exhaustive check, not just for nflreadr:
```
grep -RniE "checksum|sha256|sha-256|md5sum|digest::|signature|gpg|verify.*hash|hash.*verify|integrity" \
  sources/{nflverse,nflreadr,nflfastR,nflseedR,nfl4th,nflplotR}/R/
```
returns **zero matches** across all six packages' entire R source. Also zero matches for any
explicit TLS-hardening or TLS-weakening override (`ssl_verifypeer`, `ssl_verifyhost`, `insecure`,
`CURLOPT_SSL*`) — meaning the only transport protection present is whatever `curl`'s (and base R's
`url()`'s) *default* peer/host certificate verification provides, unmodified by any of these
packages. No package fetches or checks a `.sha256`/`.sig`/`SHASUMS`-style manifest alongside any
data or model asset. No package pins an expected content hash for any URL. The entire trust chain,
for every format, reduces to: **HTTPS transport security to the resolved host, plus GitHub's own
access controls over who can publish a release asset to `nflverse/nflverse-data`,
`nflverse/nfldata`, `nflverse/nfl4th`, or `nflverse/nflplotR`.** Nothing downstream of that
transport layer is re-checked before the bytes are handed to a deserializer.

The closest thing to a safety mechanism found anywhere is nfl4th's `cached_model()` format-sniff at
`sources/nfl4th/R/cache.R:66-81` (`if (is.raw(model)) {...} else { file.remove(model_path); ... }`)
— but this exists purely to detect nfl4th's **own past cache-format changes** (v1.0.5's model
format was incompatible with earlier versions, per the source comment), not to validate that the
bytes came from a legitimate/untampered source. A malicious raw vector would pass this check
trivially (`is.raw()` is true for any raw vector, tampered or not).

## 3. Byte-level confirmation (`file`, hexdump) — plain gzip, no wrapper, no header integrity field

```
$ file $ROOT/tmp/cache/nflreadr/*.rds
...f12201e5....rds: gzip compressed data, from Unix, original size modulo 2^32 23940
...c15b1360....rds: gzip compressed data, from Unix, original size modulo 2^32 171085721
```
Every cached artifact — across all 5 successful cold-run fetches — is plain gzip
(`file` reports "gzip compressed data" uniformly; hex dump confirms the standard `1f 8b 08 00`
gzip magic/flags header, nothing custom). This is R's default `saveRDS(..., compress = "gzip")`
format: a bare gzip stream wrapping R's native serialization format, with no length-prefixed
integrity field, no embedded hash, nothing beyond gzip's own (weak, non-cryptographic) CRC32
trailer, which exists purely for corruption detection, not authenticity.

A direct independent-fetch comparison was done for one asset (`teams_colors_logos.rds`, fetched a
second time with plain `curl`, bypassing R and nflreadr entirely — `$ROOT/tmp/step7_raw_teams.rds`)
against the cachem-cached copy of the same logical data. Both are valid gzip streams with matching
gzip headers, but they are **not byte-identical** to each other — expected and correctly explained
by the pipeline, not a bug: the cachem cache file is `cachem`'s own re-serialization (via a fresh
`saveRDS()` call) of the **already-deserialized R object** that `memoise` is caching, not a stored
copy of the original wire bytes. This is the precise mechanical reason `dynamic-fetch-log.csv`'s
`bytes` column for `nflreadr:::loader[...]` rows is documented as an in-memory `object.size()`
proxy rather than a wire-byte count (see `notes.md`, `cache-behavior.md`): there are, in a very
literal sense, at least two different gzip streams involved for any cached fetch — the one that
crossed the wire, and the one `cachem` wrote to represent the cached value — and this audit's
fetch log intentionally documents which one each row's number reflects.

Also confirmed empirically: cachem's write path is content-blind to *validity*, not just to
*origin* — the Step 6a "poisoned cache" files (`$ROOT/tmp/cache_offline_cold/nflreadr/*.rds`) are
themselves perfectly well-formed gzip streams too (`file` reports the same "gzip compressed data",
just a much smaller "original size... 287" — the serialized form of an empty `data.table()`). There
is no structural way to tell a legitimately-empty cached result apart from a well-formed cache file
at all — you have to `readRDS()` it and look at its shape, exactly as `offline-behavior.md`
describes happening (invisibly) to real callers.

## 4. What a malicious or corrupted asset could achieve

Ordered from certain/mundane to serious/conditional, all against the *default* rds path (the one
every required loader in this audit actually used):

1. **Silent data corruption of exactly the kind this repo's own product would consume.** Since
   nothing checks that the bytes are what nflverse intended to publish, a payload that decodes to
   a *structurally valid but factually wrong* R `data.frame` (spoofed scores, altered player IDs,
   fabricated injury/roster status, tampered win-probability numbers) would be accepted with **no
   warning at all** — this class of attack doesn't even need a deserialization exploit, it only
   needs to produce a well-formed RDS payload, and it would flow straight into anything downstream
   that trusts `load_schedules()`/`load_pbp()`/`load_rosters()`/nfl4th's win-probability model.
   Given this repository's own stated purpose (an AI sports-betting platform, per this repo's
   `CLAUDE.md`), this is the most directly consequential failure mode to flag, independent of any
   exotic RCE consideration below — it requires no code-execution vulnerability whatsoever, only a
   successful position on the wire or at the source repo.
2. **Denial of service.** A truncated/malformed gzip stream or a crafted RDS structure that causes
   `readRDS()` to hang, allocate excessively, or crash the R process is straightforward to produce
   and completely plausible given zero pre-validation; `rds_from_url()`'s `try()` only catches
   *R-level* errors from a completed `readRDS()` call, not e.g. a pathological allocation.
3. **Code execution via R's own deserializer.** R's native serialization format is not merely a
   passive data format the way JSON or plain CSV are — it can encode arbitrary R language objects,
   including closures, environments, and *promises* (R's lazy-evaluation objects, which carry an
   unevaluated expression plus an environment to evaluate it in). This is a real, publicly
   documented class of risk for R specifically (not a hypothetical raised for this audit): R's
   `unserialize()`/`readRDS()`/`load()` deserialization of untrusted input has had disclosed
   security advisories in this exact area (e.g. the 2024 R Core / HiddenLayer-reported issue
   affecting promise evaluation during deserialization, commonly referenced as CVE-2024-27322).
   This audit did **not** attempt to construct or test any such payload — doing so would mean
   actually attacking `github.com`/`nflverse`'s real infrastructure or crafting a working exploit,
   both well outside this task's read-only, evidence-gathering scope, and inappropriate regardless
   of scope. It is cited here only as publicly known context for *why* "readRDS() called directly
   on a live, unauthenticated network stream, with no integrity check and no sandboxing" is a
   meaningful risk category for this specific ecosystem, not just a generic "unvalidated input"
   observation that would apply equally to any file format.
4. **A second, independent attack surface for the nfl4th model path specifically**: even setting
   R's own deserializer aside, `xgboost::xgb.load.raw()` is a *second*, C++-side binary
   deserializer invoked immediately after the first (see section 1 table) — a tampered
   `wp_model.rds`/`fd_model.rds` gets two independent chances to be mishandled, by two different
   parsers in two different languages, before it starts influencing real 4th-down/win-probability
   output. This audit did not attempt to assess XGBoost's own model-deserialization hardening; it
   is flagged purely as an additional, distinct surface that the "single readRDS call" framing
   understates for nfl4th specifically.

None of the above requires defeating TLS — the finding is that **there is no second line of
defense if TLS, the registrar, or the GitHub account/workflow that publishes these releases is ever
compromised**, not that TLS itself is broken. This audit found no evidence TLS is misconfigured or
bypassed anywhere in these six packages (see section 2).

## 5. Direct answer to Step 7's question

**No asset of any format (rds, csv, parquet, or the dead `qs` path), from any host, in any of the 6
target packages, is checksummed or signature-verified before being handed to its deserializer.**
The rds path (nflreadr's default, and the only path the required Step 4-6 loader battery actually
exercises) goes further than "unverified" — it streams live network bytes directly into
`readRDS()` via a bare `url()` connection, architecturally bypassing even the `curl` package's own
handle-based API (see `notes.md`), so there is no intermediate buffer at which a check could easily
be inserted without changing the package's own code. The practical security boundary for every one
of these packages is entirely "trust GitHub's release-asset hosting and TLS," with no
application-layer integrity check anywhere behind it.
