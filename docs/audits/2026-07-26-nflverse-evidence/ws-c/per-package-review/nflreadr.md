# nflreadr 1.5.1 — line-level review

**Files read: 36 of 36.** `ls sources/nflreadr/R | wc -l` = **36** — all 36 are `.R` files, all read
end to end (3,306 lines). No `src/`, no `useDynLib` — verified. `inst/` contains only `inst/doc/`
(vignette artefacts), which is out of scope per the brief.

nflreadr is the data-access layer for the whole nflverse: every other target's network I/O either
goes through it or copies its idioms. It is therefore the single most important file to get right.

## Load hooks

`.onLoad` (`R/zzz.R:2-82`):
- Reads `getOption("nflreadr.cache", default = "memory")`. With `"filesystem"` (`:9-13`) it creates
  `rappdirs::user_cache_dir(appname = "nflreadr")` and builds a `cachem::cache_disk`.
- `:19-56` **rebinds four exported functions inside its own namespace**:
  `assign("rds_from_url", memoise::memoise(rds_from_url, ~timeout(86400), cache = cache),
  envir = rlang::ns_env("nflreadr"))`, and the same for `csv_from_url`, `raw_from_url`,
  `parquet_from_url`. Namespace mutation at load. It is a legitimate memoisation pattern, but it
  means the function a caller sees is not the function in the source, and in filesystem mode the
  **deserialised remote object is written to disk and reused for 24 hours**.
- `:58-63` may set `options(nflreadr.verbose = TRUE)`.
- `:65-81` if `options(nflreadr.prefer) == "parquet"`, calls
  `rlang::check_installed("arrow (>= 6.0.0)")` — in an interactive session this *prompts to install
  a package* from within a load hook. Not an unattended install, but worth noting.

`.onAttach` (`R/zzz.R:84-118`): validates `nflreadr.prefer` and `nflreadr.cache` and prints
messages. Benign.

## Network call sites — all of them

Every one is **https**; there is no `http://` anywhere in the package. The URL is always built from
a hard-coded host prefix plus validated arguments (`rlang::arg_match0(file_type, c("rds","csv",
"parquet"))`, numeric season range `stopifnot()`s), so there is no user-controlled host.

| function | file:line | mechanism |
|---|---|---|
| `rds_from_url()` | `R/from_url.R:65-78` | `con <- url(url)`; `readRDS(con)` — **remote deserialisation** |
| `csv_from_url()` | `R/from_url.R:98-101` | `data.table::fread(...)` — CSV parse, no object reconstruction |
| `raw_from_url()` | `R/from_url.R:124-141` | `curl::curl_fetch_memory(url)`; returns bytes; checks `status_code != 200` |
| `parquet_from_url()` | `R/from_url.R:162-183` | `curl_fetch_memory` then `arrow::read_parquet()` |
| `qs_from_url()` | `R/from_url.R:208-213` | hard-deprecated, `lifecycle::deprecate_stop()` — dead |
| `nflverse_download()` | `R/utils_download_nflverse.R:29-145` | `piggyback::pb_releases/pb_list/pb_download` against `nflverse/nflverse-data` |
| `nflverse_releases()` | `R/utils_download_nflverse.R:176-215` | `piggyback::pb_releases` / `pb_list` |
| `.sitrep_pkg_status()` | `R/utils_sitrep.R:131,142,151-156` | `curl::has_internet()`, then `utils::available.packages()` against packagemanager.posit.co, cloud.r-project.org, cran.rstudio.com, and the r-universe dev repos |

The 22 `load_*()` functions (`load_pbp`, `load_schedules`, `load_rosters`, `load_players`,
`load_stats`, `load_ftn_charting`, …) are thin wrappers that build a URL and call
`load_from_url()` → `loader()` → one of the four above, selected by file extension
(`detect_filetype()`, `R/from_url.R:242-244`). Hosts seen: `github.com/nflverse/*`,
`github.com/dynastyprocess/data`, `github.com/ffverse/ffopportunity`.

**The `readRDS` path is the one that matters** (`R/from_url.R:69`). `.rds` is the default
`file_type` for every loader, so the default behaviour of essentially every nflreadr call is to
deserialise an R object fetched over the network. `readRDS` reconstructs arbitrary R objects; a
compromised release asset (or a TLS-terminating proxy with a trusted CA) yields object injection
into the caller. Classified **note** per the audit rule; the trust decision is the synthesis's.

## Credential handling

`nflverse_download()` and `nflverse_releases()` default `.token = "default"` and then call
**`gh::gh_token()`** (`R/utils_download_nflverse.R:39,181`), which reads `GITHUB_PAT`/`GITHUB_TOKEN`
or gitcreds. The token is passed to `piggyback::pb_*`, which sends it to `api.github.com`. Scoped
and conventional, but it is the only place in the six targets that touches a credential. **Note.**

`.sitrep_pkg_opts()` (`R/utils_sitrep.R:209-220`) redacts options whose names match
`"path|token|auth|directory"` **by default** (`redact_path = TRUE`) — good hygiene, since sitrep
output is meant to be pasted into public issues. A user passing `redact_path = FALSE` defeats it.

## Filesystem writes

- `nflverse_download()`: `fs::dir_create(file.path(folder_path, releases))` (`:74`) and
  `:111`, then `piggyback::pb_download(dest = ...)`. **`folder_path` defaults to
  `getOption("nflreadr.download_path", default = ".")` — the current working directory.** Explicit,
  user-invoked, documented. **Note**, not a finding.
- `.onLoad` filesystem cache dir, above.
- Nothing else. No `saveRDS`, `writeLines`, `file.create/copy/rename` anywhere.

## eval / parse / NSE

No `eval(parse(`, no `parse(text=)`, no `source()`, no `system()`/`shell()`, no
`install.packages()` executed. `R/utils_join_coalesce.R` and the `data.table` `:=`/`.SD` usage are
ordinary NSE. `rlang::ensyms(...)` at `utils_download_nflverse.R:42` converts unquoted release names
to strings via `as.character()` — symbol capture, not evaluation.

`R/utils_nflverse_data_class.R` defines the `nflverse_data` S3 class and a `print` method;
`as.nflverse_data()` (`:39-69`) uses `data.table::setattr` to attach `nflverse_type` and
`nflverse_timestamp`.

## Data payloads

`data/` holds 26 `.rda` files: 22 `dictionary_*` data frames, `player_name_mapping`,
`team_abbr_mapping`, `team_abbr_mapping_norelocate`, `nflverse_data_timezone`. All documented in
`R/data.R` and used as lookup tables (`R/utils_name_cleaning.R:38-43,127`). All plain data.
No `sysdata.rda`.

## Anything surprising

Nothing adverse. `most_recent_season()` (`R/utils_date.R:20-39`) and `compute_labor_day()`
(`:131-139`) are date heuristics. `progressively()` (`R/utils_progressively.R:34-45`) is a function
decorator. `.for_cran()` (`R/utils_cran.R:8-21`) caps `data.table` threads for CRAN — reads
`OMP_THREAD_LIMIT` and `_R_CHECK_*` but, unlike nflplotR, **does not `Sys.setenv`**.

## Scan rows

15 hits: 12 notes (`url_conn`, `readRDS`, 3x`curl_download`, 5x`http_client`, 2x`ns_hook`),
3 benign. No findings.

**Verdict: clean and disciplined — all-https, validated arguments, redaction by default — with one
structural note that dominates the whole audit: the default data path is `readRDS()` over the
network, optionally cached to disk.**
