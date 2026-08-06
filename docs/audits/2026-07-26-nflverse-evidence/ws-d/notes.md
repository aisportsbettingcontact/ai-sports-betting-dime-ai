# Task 4 (WS-D) — Network endpoints & runtime behavior — notes.md

Run date: 2026-07-27 (UTC timestamps as shown per command). macOS/darwin, R 4.6.1.
ROOT=/private/tmp/claude-501/-Users-danielwalker-src-ai-sports-betting-dime-ai/dd3b2b85-766c-4b7b-a98c-d928cffcbac2/scratchpad/nflverse-audit
LIB=/opt/homebrew/lib/R/4.6/site-library (read-only throughout; every experiment ran `Rscript
--vanilla`, loading packages from LIB, never installing/modifying anything in it).

All experiment/helper scripts referenced below live under `$ROOT/tmp/` (or `$ROOT/tmp/step*/`
subfolders); this file is the index the brief asks for.

## Step 1 — static URL census

- `$ROOT/tmp/all90_dirs.txt` — the 90 extracted source directory names used as grep arguments
  (cross-checked against Task 0's `installed-manifest.csv`; identical set).
- Exact command run (zsh, this shell does **not** word-split unquoted `$VAR`, unlike bash — the
  6/90 target directory names were passed as literal, explicit arguments, not an unquoted
  variable, to avoid a real failure mode hit during this task: an unquoted `$TARGETS` collapsed
  to a single glued argument under zsh and produced 0 matches + a "No such file or directory"
  warning on the first attempt):
  ```
  grep -RohE '(https?|ftp)://[^"'"'"' )>,;]+' nflverse nflreadr nflfastR nflseedR nfl4th nflplotR | sort | uniq -c | sort -rn   # targets
  grep -RohE '(https?|ftp)://[^"'"'"' )>,;]+' <all 90 dirs, from all90_dirs.txt>              | sort | uniq -c | sort -rn   # closure
  ```
  Decoded, the pattern is `(https?|ftp)://[^"' )>,;]+` (excludes: double-quote, single-quote,
  space, `)`, `>`, `,`, `;`). It does **not** exclude `{`/`}`, so a handful of Rd `\url{...}`
  macro matches keep a trailing `}` (e.g. `nflseedr.com}`) — this is extraction noise from the
  literal, unmodified brief regex, not a distinct host; the clean form is always separately
  present too. Documented at the top of both output files.
- Results: **383** unique URL strings / **68** unique case-insensitive hosts across the 6 targets;
  **7659** unique URL strings / **1096** unique case-insensitive hosts across the full 90-package
  closure. Host-level rollup included at the top of `url-census-closure.txt` per the brief.
- `objects.githubusercontent.com` does **not** appear anywhere in the static census (verified: 0
  hits, case-insensitive, across all 90 packages' source text). This is expected, not a gap: it is
  the redirect *destination* GitHub Releases issues at fetch time for a signed, time-limited asset
  URL — it is never written as a literal string in any package's source, docs, or tests. The task's
  own Global Constraints pre-authorize it ("Network expected to: ... github.com/
  objects.githubusercontent.com/release assets"), so it is treated as an expected host, not a
  novel-host finding, if/when observed in the dynamic fetch log. See `serialization-channel.md`.

## Step 2 — discovered cache + verbosity control names

Ran exactly as specified: `Rscript --vanilla -e 'library(nflreadr); print(nflreadr::nflverse_sitrep())'`
(output: `$ROOT/tmp/step2/sitrep_stdout.txt`) plus `tools::Rd_db("nflreadr")` read via two small
scripts (`$ROOT/tmp/step2/rd_db_inspect.R`, `$ROOT/tmp/step2/rd_db_grep.R`, `$ROOT/tmp/step2/rd_dump.R`).
`nflverse_sitrep()` itself turned out to be a real network call (see below) — its output showed a
"dev" column implying a live version comparison, run *before* any tracing was installed, so it is
reported here qualitatively, not as `dynamic-fetch-log.csv` rows (it is not one of the Step 4 named
loaders; adding differently-sourced rows to that CSV would have muddied the "actual URLs fetched
during exercised loads" contract). `.sitrep()`'s documented default `dev_repos` argument is
`c("https://nflverse.r-universe.dev", "https://ffverse.r-universe.dev")` (from `sitrep.Rd`) —
consistent with those two hosts appearing in the static census.

**The installed exported help (`tools::Rd_db`) does not document the three most important
behavior-controlling options at all.** `nflreadr.cache`, `nflreadr.verbose`, and
`nflreadr.cache_warning` never appear in any Rd topic's usage/argument section — only
`nflreadr.prefer` and `nflreadr.download_path` do (both appear as `getOption(...)` default
arguments in every `load_*.Rd`/`nflverse_download.Rd`). The three undocumented options only exist
as internal `getOption()` reads inside non-exported functions (`R/zzz.R` `.onLoad`/`.onAttach`,
`R/from_url.R` `cache_message()`). Discovered by grepping `$ROOT/sources/nflreadr/R/*.R` for
`getOption(`/`Sys.getenv(` (all hits, deduplicated):
```
getOption("Ncpus", default = 2L)
getOption("nflreadr.cache_warning", default = interactive())
getOption("nflreadr.cache_warning")
getOption("nflreadr.cache", default = "memory")
getOption("nflreadr.download_path", default = ".")
getOption("nflreadr.prefer", default = "rds")
getOption("nflreadr.prefer")
getOption("nflreadr.verbose", default = interactive())
getOption("nflreadr.verbose")
Sys.getenv("OMP_THREAD_LIMIT", unset = "2")
```
Cross-checked against the **installed** (not just source-tarball) binary namespace — confirmed
byte-identical: `body(nflreadr:::cache_message)` and `body(nflreadr:::loader)` printed from the
loaded package match the source tarball exactly (`$ROOT/tmp/step2/verify_installed_options.R` /
`verify_installed_options_out.txt`). No drift between what Task 0 staged and what `$LIB` actually
loads.

**Discovered names actually used for Steps 4-6 (real names, not guessed):**

| Name | Kind | Default | Effect |
|---|---|---|---|
| `nflreadr.cache` | R option | `"memory"` | `"memory"` \| `"filesystem"` \| `"off"`. Selects the `cachem` backend (`cache_mem()` vs `cache_disk()`) that `memoise::memoise()` wraps around `rds_from_url`/`csv_from_url`/`raw_from_url`/`parquet_from_url` **at `.onLoad` time** (`R/zzz.R`). Must be set *before* `library(nflreadr)` — it is read exactly once at load time; setting it after loading has no effect on the already-memoised functions. |
| `nflreadr.verbose` | R option | `interactive()` | Gates a couple of `cli`/`rlang::inform()` messages (e.g. `cache_message()`). Not a per-fetch URL log. |
| `nflreadr.cache_warning` | R option | `interactive()` | Gates the same `cache_message()` note specifically. |
| `nflreadr.prefer` | R option | `"rds"` | `"rds"` \| `"csv"` \| `"parquet"` — selects `file_type` default for every `load_*()` function. |
| `R_USER_CACHE_DIR` | env var | unset | **Not an nflreadr-specific name** — it's `rappdirs`' (a dependency) override env var, read by `rappdirs::user_cache_dir()`'s `base_path()` helper (`sources/rappdirs/R/utils.R:31-40`, doc'd in `cache.R`). When `nflreadr.cache="filesystem"`, nflreadr computes its disk-cache directory via `rappdirs::user_cache_dir(appname="nflreadr")`, so this env var is how you redirect it. Verified empirically: unset → `~/Library/Caches/nflreadr`; set to `X` → `X/nflreadr`. **The same env var also happens to control `nfl4th`'s and `nflplotR`'s cache dirs** (they use base R's `tools::R_user_dir(pkg, "cache")`, whose `cache=` branch checks `R_USER_CACHE_DIR` first, then `XDG_CACHE_HOME`, then falls back to `~/Library/Caches/org.R-project.R/R/<pkg>` on macOS — confirmed by printing `tools::R_user_dir`'s body). One env var redirects all three packages' filesystem caches away from the real `~/Library/Caches` for Steps 4-6. |
| `nflplotR.cache` | R option | `"memory"` | Same memory/filesystem/off pattern, independent option, own package (`R/zzz.R` in nflplotR). Not exercised (nflplotR isn't in the Step 4 loader list; noted for completeness from Step 3). |
| `nfl4th.keep_games` | R option | `FALSE` | Not cache-format-related — controls whether nfl4th's `.onLoad` deletes its own games cache file on every load (see Step 3 finding below). |

`nflreadr.download_path` exists and is documented, but its only consumer, `nflverse_download()`
(and `nflverse_releases()`), requires the `piggyback` and `gh` packages — **neither is in the
installed 90-package closure** (confirmed against `installed-manifest.csv` / `$ROOT/sources/`
directory listing). `rlang::check_installed()` would prompt/fail before any network code in that
function runs. This makes `nflverse_download()` unreachable/untestable under this audit's
constraints (installing suggested packages is out of scope) — noted, not exercised.

## Step 3 — load-side-effects script

Script: `$ROOT/tmp/step3_load_side_effects.R` (one fresh `Rscript --vanilla` per package, no cache
env overrides — Step 3's purpose is the *true default* footprint). Driver commands and raw output:
`$ROOT/tmp/step3/{pkg}.out.txt` for pkg in nflreadr, nflfastR, nflseedR, nfl4th, nflplotR, nflverse.
Findings written up in `load-side-effects.md`.

Headline finding surfaced here because it directly affects the rest of WS-D: **`nfl4th`'s
`.onLoad` unconditionally calls `curl::nslookup("github.com", error = FALSE)`** — a live DNS
lookup on every `library(nfl4th)`, regardless of any option. Verified two ways: (1) source read
(`sources/nfl4th/R/zzz.R`), (2) a live `trace()` on `curl::nslookup` that fired during
`library(nfl4th)` (`$ROOT/tmp/step2/rd_db_grep.R` sibling script `$ROOT/tmp/step2/...` — see
`$ROOT/tmp/step3/nfl4th_nslookup_trace.R` for the exact reproducer, host confirmed
`"github.com"`). This is a DNS lookup, not an HTTP fetch, so it is intentionally **not** added as a
`dynamic-fetch-log.csv` row (the log's `url` column and the brief's 4 named hook functions are
HTTP-fetch-shaped; a bare hostname resolution doesn't fit that contract) — it is documented here
and in `load-side-effects.md` instead. nfl4th also unconditionally maintains a cache directory
(`tools::R_user_dir("nfl4th","cache")`, default `~/Library/Caches/org.R-project.R/R/nfl4th`) and
**deletes its cached games file on load** unless `options(nfl4th.keep_games)=TRUE` — on this
machine that directory already existed (pre-dated this audit, empty, mtime unrelated to any
command run here) and contained no games file, so the delete branch was a no-op; recorded precisely
in `load-side-effects.md` including the pre-existing-state caveat so it isn't misattributed as
something this audit created.

## Step 4-6 — dynamic fetch tracing: mechanism, and why it isn't a plain trace() job

Shared helper sourced by every Step 4/5/6 experiment script: **`$ROOT/tmp/harness.R`**. Installs
`trace()` wrappers on the four brief-mandated functions (`curl::curl_fetch_memory`,
`curl::curl_fetch_disk`, `curl::curl_download`, `utils::download.file`) exactly as specified, all
of which log to `$ROOT/evidence/ws-d/dynamic-fetch-log.csv`.

**`trace()` proved unreliable exactly as the brief's contingency anticipated — for two independent
reasons, both verified empirically before the real runs (reproducers kept in `$ROOT/tmp/step2/`):**

1. **Architectural**: nflreadr's *default* format is `rds` (`getOption("nflreadr.prefer", default =
   "rds")`), and `rds_from_url()` fetches via plain base R — `con <- url(url); readRDS(con)`
   (`sources/nflreadr/R/from_url.R:65-78`) — which never calls into the `curl` R package at all
   (R's own `url()` connection has its own internal libcurl binding, separate from the `curl`
   package's R-level API). None of the 4 brief-mandated hooks can ever fire for this path. This
   matters a great deal: **all 5 required loaders use this exact default path**, so without a
   supplementary hook, `dynamic-fetch-log.csv` would come back essentially empty for the required
   experiments — failing Step 8's "fetch log non-empty" acceptance bar for reasons that have
   nothing to do with whether fetches actually happened.
2. **Mechanical**: `rds_from_url`, `csv_from_url`, `raw_from_url`, and `parquet_from_url` are all
   individually wrapped in `memoise::memoise()` at `.onLoad` time (`R/zzz.R`), which stamps
   `class(fn) <- c("memoised","function")`. Calling `trace()` directly on any of the four throws,
   reproduced verbatim:
   ```
   Error in .classEnv(className) :
     unable to find an environment containing class "memoised"
   ```
   (`$ROOT/tmp/step2/rds_trace_realtest.R` / captured stderr). `trace()` cannot target these
   functions at all under `--vanilla`, independent of the architectural issue above.

**Fallback adopted** (per the brief's own permitted contingency — "an acceptable fallback is
`options(nflreadr.verbose=TRUE)`-style output plus cache-dir file listings ... document which
mechanism produced each row"): trace the **non-memoised internal dispatcher**
`nflreadr:::loader(url)` instead. It is a plain function (not memoised) sitting one call-frame
above all three memoised leaf functions (`switch(detect_filetype(url), rds=, parquet=, csv=)`),
so it traces cleanly, and its frame directly exposes `url` plus, via `returnValue()`, the exact
data frame that was fetched — giving row/col counts and an in-memory `object.size()` for free.
Verified end-to-end against nflreadr's own tiny test fixture
(`https://.../releases/download/test/combines.rds`) before use, both for a cold call
(`precache_hit_precheck=FALSE`, ~0.8-1.1s) and a same-process warm call
(`precache_hit_precheck=TRUE`, ~0.008-0.03s) — see `$ROOT/tmp/step2/harness_verify2.R` and its
captured output. `harness.R`'s loader-hook entry tracer also calls `memoise::has_cache(<leaf
fn>)(url)` **before** invoking the real call, giving a direct boolean cache-hit measurement (not
just an elapsed-time inference) that is folded into the CSV's `status` column as
`cache_hit_precheck=TRUE|FALSE|NA`.

**Every `dynamic-fetch-log.csv` row's `call` column says exactly which of the 5 installed hooks
produced it** (`curl::curl_fetch_memory`, `curl::curl_fetch_disk`, `curl::curl_download`,
`utils::download.file`, or `nflreadr:::loader[rds|csv|parquet]`) — this is the "document which
mechanism produced each row" requirement, satisfied per-row rather than only in prose. For the 5
required rds-format loaders, only `nflreadr:::loader[rds]` rows are expected/possible. A single
supplementary, clearly-labeled bonus check (`load_teams(file_type="csv")`) was run purely to prove
the 4 brief-mandated hooks *do* fire correctly when the code path actually reaches them — see
`$ROOT/tmp/step2/harness_verify.R` / output: it produced exactly one paired
`utils::download.file` (real HTTP-level, status=0, wire bytes=18919 from `file.size()` on the
downloaded temp file) + one `nflreadr:::loader[csv]` (status=OK, bytes=43128 = in-memory
`object.size()` of the parsed data.table) row for the same logical fetch — the two byte figures
differ because they measure different things (compressed-on-wire vs deserialized-in-memory), not
because of a bug; documented in `serialization-channel.md`.

**`bytes` column semantics differ by row type, stated explicitly rather than left implicit:**
- `curl::curl_fetch_memory` / `curl::curl_fetch_disk`: exact wire byte count of the HTTP response
  body (`length(content)` / `file.size(path)`).
- `utils::download.file`: `file.size()` of the file actually written to disk — real wire bytes
  (post any transparent decompression the transfer method itself performs; none observed here).
- `nflreadr:::loader[...]`: `object.size()` of the **deserialized, in-memory R object** — this is
  a proxy for payload size, not a wire measurement, and is typically *larger* than the wire bytes
  (R vectors carry type/alignment overhead an RDS/gzip stream doesn't). This is the only number
  available for the rds path since no lower hook exists to observe wire bytes directly; a
  clearly-labeled, non-fetch, metadata-only diagnostic (`curl_fetch_memory` with
  `nobody=TRUE`/HEAD-equivalent, run and reported separately, never mixed into the CSV as a fake
  "fetch" row) was used where a true wire-byte figure mattered for the narrative — see
  `serialization-channel.md`.

## Scripts index (all under `$ROOT/tmp/`, per the brief's requirement to list them here)

| Script | Purpose |
|---|---|
| `harness.R` | Shared fetch-tracing helper, sourced by every Step 4-6 experiment script. |
| `step3_load_side_effects.R` | Step 3 driver, parameterized by package name. |
| `step4_cold.R` | Step 4: cold-cache dynamic fetch battery (filesystem cache mode, fresh dir). |
| `step5_warm.R` | Step 5: warm-cache repeat, identical calls, same cache dir. |
| `step6_offline_cold.R` | Step 6a: offline env, fresh/empty cache dir. |
| `step6_offline_warm.R` | Step 6b: offline env, pre-warmed cache dir from Step 4/5. |
| `step2/*.R` | Step 2 exploration + mechanism-validation reproducers (sitrep, Rd_db reads, the `trace()`-on-memoised-function crash repro, the harness dry-runs). Kept for evidentiary traceability of claims made above; not part of the required Step 4-6 battery itself. |

## Step 8 — acceptance check

**All 7 output files + this file exist and are non-empty** (`evidence/ws-d/`:
`url-census-targets.txt` 28,106 bytes; `url-census-closure.txt` 486,487 bytes;
`load-side-effects.md` 9,352 bytes; `dynamic-fetch-log.csv` 3,483 bytes / 24 data rows;
`cache-behavior.md` 9,246 bytes; `offline-behavior.md` 9,053 bytes;
`serialization-channel.md` 18,542 bytes; `notes.md`, this file).

**Fetch log hosts ⊆ census, checked mechanically**: extracted the unique lowercased host from
every `dynamic-fetch-log.csv` row's `url` column and checked each against the case-insensitive,
brace-stripped host set derived from `url-census-closure.txt` (`$ROOT/tmp/closure_hosts_clean.txt`,
1050 entries after stripping Rd-macro brace noise from the 1096 raw case-insensitive rollup
entries). Result: **exactly one unique host appears anywhere in the 24-row fetch log —
`github.com` — and it is in-census** (unsurprising: `github.com` is the single most common host in
both the 6-target and 90-package static census). No row-level surprises.

**However — a real "novel host" finding, found by going one layer deeper than the CSV can see.**
`dynamic-fetch-log.csv` records the URL the R code *asks for*, because that's what the
`nflreadr:::loader()` hook (and, per its docstring, the brief's 4 curl/download.file hooks) can
observe — none of these hooks expose the post-redirect destination, since redirect-following
happens inside libcurl, transparently, below any R-level hook available here. `github.com`'s
`releases/download/...` URLs are all HTTP 302 redirects. Checked directly, two ways —
`curl -sD - -L` from the shell, and `curl::curl_fetch_memory()` called directly from R
(`$ROOT/tmp/step8_redirect_check.R`), both against a real required-loader URL
(`.../releases/download/players/players.rds`):
```
HTTP/2 302
location: https://release-assets.githubusercontent.com/github-production-release-asset/...(signed, time-limited query string)...
HTTP/2 200
```
Final host: **`release-assets.githubusercontent.com`**. This host string appears **nowhere** in the
90-package static census (checked: zero hits, case-insensitive) — expected, since it's a
dynamically-generated signed URL GitHub mints per-request, never written as a literal string
anywhere in any package's source. It is also, notably, **not quite** the hostname this task's own
Global Constraints text names as expected ("github.com/objects.githubusercontent.com/release
assets") — the constraint anticipated `objects.githubusercontent.com`; what this environment's
GitHub actually redirects release assets to, right now, is `release-assets.githubusercontent.com`.
Both names describe the same underlying thing (GitHub's signed blob-storage CDN for release
assets), and the difference most likely reflects GitHub having renamed/split this endpoint since
the constraint text was written, not a suspicious redirect — but per this task's own instruction
("any host outside the static census is itself a finding"), it is flagged explicitly rather than
silently absorbed into "close enough to what was expected." **Not fabricated as a
`dynamic-fetch-log.csv` row**: it was never actually observed being contacted by one of the
installed trace hooks during the required loader battery (R's `url()`-based rds path hides
redirects from R-level code entirely — that architectural fact is exactly why the CSV's own `call`
column distinguishes the mechanism that produced each row, see Steps 4-6 section above); it is
corroborated separately, here and via the standalone diagnostic script, rather than blended into
the fetch log's own accounting. The `raw/master/...` URL path (used by `load_schedules`) redirects
differently — to `raw.githubusercontent.com` — which **is** already present in the static census
(404 occurrences in the 90-package closure), so only the `releases/download/...` asset path
produces a genuinely novel host.

**Self-review, per the task's own instructions:**
- *Does every fetch-log row have all 6 columns?* Yes — verified mechanically
  (`awk -F',' '{print NF}' dynamic-fetch-log.csv | sort | uniq -c` → all 25 lines, header included,
  report exactly 6 fields). `dest_file` is legitimately empty (not missing) on every row: the
  `nflreadr:::loader[...]` hook operates one layer above where any disk path would be known (see
  "bytes column semantics" above) — an empty field is the documented, correct value there, not an
  omission.
- *Are cold vs warm fetch counts consistent with the cache-behavior story?* Yes, and this needed
  active documentation, not just a glance: row **counts** are identical cold vs warm (6 and 6 in
  each of Steps 4/5, and again in each of Steps 6a/6b) because `loader()` itself always executes
  regardless of cache status (only its three memoised callees short-circuit) — so presence/count of
  rows was never going to be the cold/warm signal. The actual signal —
  `cache_hit_precheck=TRUE|FALSE`, measured directly via `memoise::has_cache()` *before* each call,
  corroborated by `seconds` — is present on every single row and tells a fully consistent story
  end to end: 5 of 6 Step 4 rows `FALSE` (genuine cold) with the 6th (`fast_scraper_schedules`)
  `TRUE` — it shares `load_schedules`'s cache key for the same URL, which that same run's 1st call
  had just populated; all 6 Step 5 rows `TRUE` (genuine warm, 0 new cache files written); 5 of 6 Step
  6a rows `FALSE` (genuine cold, offline, real network-failure warnings captured) with the 6th
  (`fast_scraper_schedules`) again `TRUE` for the same shared-cache-key reason (against the empty,
  poisoned entry that run's 1st call had just written); 5 of 6 Step 6b rows `TRUE` with the 6th
  (`fast_scraper_schedules`) also `TRUE` because it shares `load_schedules`'s cache key. Full
  accounting in `cache-behavior.md` / `offline-behavior.md`.

## Evidence gaps

None that required invoking the "retry once, then record gap" fallback — every experiment in
Steps 3-7 produced a usable result on the first attempt, including the two scripts that were
*designed* to fail (Step 6a/6b offline runs; the parquet-format and qs-format reachability checks).
Two things worth recording here precisely as **scoping boundaries actively chosen**, not gaps in
execution:

1. **`nflverse_sitrep()`'s own network calls (Step 2) are not represented as
   `dynamic-fetch-log.csv` rows.** It ran once, before any tracing was installed (Step 2 is
   discovery, not instrumented experimentation), and it isn't one of the Step 4-6 named loaders.
   Its `dev_repos` behavior is documented qualitatively in the Step 2 section above from its own
   Rd docs, not from a captured trace.
2. **`nfl4th`'s load-time `curl::nslookup("github.com")` (Step 3) is not a `dynamic-fetch-log.csv`
   row**, and neither is the model-fetching supplementary check
   (`$ROOT/tmp/step7_nfl4th_model_check.R`) or the csv-format/parquet-format/redirect-target
   supplementary checks (`$ROOT/tmp/step2/harness_verify.R`, `$ROOT/tmp/step7_parquet_unreachable_check.R`,
   `$ROOT/tmp/step8_redirect_check.R`) — all deliberately kept out of the official CSV (several
   using `WSD_LOG_OVERRIDE` to physically write elsewhere) because none of them are one of the
   brief's required Step 4-6 loader calls, and blending mechanism-validation/exploratory evidence
   into the "actual URLs fetched during exercised loads" contract would have made that file harder
   to trust, not easier. Every one of these checks is fully described, with real captured output,
   in the relevant `.md` file (`load-side-effects.md`, `serialization-channel.md`, this file) —
   nothing was observed and then discarded.
