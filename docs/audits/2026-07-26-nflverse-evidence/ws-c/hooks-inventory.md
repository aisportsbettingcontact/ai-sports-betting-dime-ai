# WS-C Step 2 — hooks and install-script inventory

Source of truth: `$ROOT/tmp/hook-bodies.txt` (every hook body, brace-matched and read).
69 hook definitions across 47 of the 90 packages. 43 packages define no hook at all.

## Part 1 — install scripts

### `configure` / `configure.win` / `cleanup` (13 packages, all read end to end)

Five packages contain code that **fetches and executes a shell script from the network during
`R CMD INSTALL`**. This is the highest-severity execution surface in the closure.

**Every one of these is a conditional fallback, not an unconditional fetch**, and on this host
(darwin/arm64) four of the nine rows are in Linux-only branches and cannot fire at all. Install
provenance is settled — all 90 packages were compiled from source here — and the per-branch
outcome is verified from the install logs in `escalations.md` E1: **curl, fs, V8 and xml2 fired;
magick did not.** The generic "only fires on a source build" caveat that appeared in the first
version of this file was correct but useless: it did fire.

| package | line | what it does |
|---|---|---|
| `curl` | `configure:50-51` | macOS, no pkg-config: `curl -sfL https://autobrew.github.io/scripts/libcurl-macos > autobrew` then `. ./autobrew` |
| `curl` | `configure:91` | Linux w/ libcurl < 7.73: `curl -sOL https://github.com/jeroen/curl/releases/download/libcurl-8.14.1/get-curl-linux.sh && . ./get-curl-linux.sh` |
| `fs` | `configure:26-27` | macOS, no libuv: fetches `autobrew` and dot-sources it |
| `magick` | `configure:31` | Linux x86_64 + clang: `curl -sOL .../get-im-linux.sh && . ./get-im-linux.sh` |
| `magick` | `configure:51-52` | macOS without Homebrew: fetches `autobrew` and dot-sources it |
| `V8` | `configure:91-92` | macOS: fetches `autobrew` and dot-sources it. **Unconditional on macOS, not "without Homebrew"** — `configure:29-30` sets `HAVE_STATIC=1` on Darwin, `:44-48` then set `DOWNLOAD_STATIC_LIBV8=1` for arm64/x86_64, so the `[ -z "$DOWNLOAD_STATIC_LIBV8" ]` guard at `:85` is false and the Homebrew branch is skipped even when brew is present |
| `V8` | `configure:95-96` | Linux/static: `R -e "curl::curl_download('$SCRIPTURL','get-v8-linux.sh')" && . ./get-v8-linux.sh` |
| `xml2` | `configure:33-34` | macOS with system libxml2: fetches `autobrew` and dot-sources it |

None pins a hash. Trust rests entirely on TLS and on `autobrew.github.io` / the `jeroen` and
`ropensci` GitHub release assets not being compromised. All five are Jeroen Ooms "Anticonf"
scripts — the pattern is long-standing and well known upstream, which is context for severity, not
a mitigation.

`stringi` is a near miss and a good contrast: `configure:4044-4056` shells out to R to run
`stri_download_icudt()` from `R/install.R`, which does `download.file()` from
`raw.githubusercontent.com/gagolews/stringi/<pinned commit>/src/icu74/data/`. Unlike the five
above it (a) pins a commit SHA, (b) verifies the download against a `.md5sum` shipped *inside the
tarball*, and (c) short-circuits entirely if the file already exists — and `icudt74l.dat.xz` **is**
shipped in the tarball, so on any little-endian platform (all of x86-64/arm64) no download happens.
The `http://` fallback mirror at `R/install.R:92-93` is only reachable after https fails, and the
result is still md5-checked. Classified **note**.

The remaining configure scripts are inert: `data.table/configure` (pkg-config + OpenMP feature
probes, writes `src/Makevars`), `xgboost/configure(.ac|.win)` (autoconf feature tests),
`stringi/configure.win` (Rscript template substitution). All `cleanup` scripts are `rm -f` of build
artefacts; the only notable detail is that `curl`, `fs`, `magick`, `V8` and `xml2` all delete the
downloaded `autobrew` / `get-*.sh` afterwards, so **the fetched script is not retained on disk for
later inspection**.

`lubridate/inst/cctz.sh:7` (`git clone https://github.com/google/cctz.git`) and
`sass/src/libsass/Makefile:290,293` (`git clone` of sass-spec) are maintainer/dev targets never
invoked by `R CMD INSTALL` — **note**, not finding.

### `Makevars*` (40 files, 24 packages)

All are ordinary compiler/linker flag declarations plus `$(SHLIB_OPENMP_*FLAGS)` and
`PKG_CPPFLAGS`. Several are `.in` templates filled in by `configure`. No `Makevars` contains a
recipe that downloads, executes, or writes outside the build directory. `stringi/src/install.libs.R`
(generated from `.in`) copies the shared object, optionally installs icudt, and generates
`include/stringi.cpp` — filesystem writes are confined to `R_PACKAGE_DIR`.

## Part 2 — `.onLoad` / `.onAttach` / `.onUnload` / `.onDetach`

### Findings

**`future` — `.onAttach` (R/zzz.R:97) → `sourceFutureStartupScript()` (R/zzz.R:105-169).**
The default `pathnames` argument is `c(".future.R", "~/.future.R")`, and `R_FUTURE_STARTUP_SCRIPT`
being unset sets `pathnames <- TRUE`, which resolves back to that default. The function keeps
whichever paths exist (`file_test("-f", ...)`), takes the first, and calls
`source(pathname, chdir = FALSE, echo = FALSE, local = FALSE)` at line 162 — i.e. into the global
environment. **`library(future)` executes `./.future.R` from the current working directory if one
exists, with no opt-in.** Errors are caught and downgraded to a warning, so it fails quietly. This
is documented upstream behaviour, but it is a genuine local code-execution path: any repository,
dataset bundle, or extracted archive that a user `setwd()`s into can plant a `.future.R`. `future`
is pulled in transitively by `nflfastR`, `nflseedR` and `nfl4th` (via `furrr`), so it is reachable
from an ordinary nflverse session.

**`nfl4th` — `.onLoad` (R/zzz.R:1-30).** Two behaviours, both at load time, before the user calls
anything: (a) line 2 `curl::nslookup("github.com", error = FALSE)` — an **outbound DNS query on
every `library(nfl4th)`**; (b) lines 24-29, unless `options(nfl4th.keep_games = TRUE)` is set, it
**deletes** `R_user_dir("nfl4th","cache")/games_nfl4th.rds`. It also `dir.create()`s that cache
directory unconditionally. Network activity and destructive filesystem action in a load hook are
both things a user cannot reasonably anticipate from `library()`.

### Notes — hooks that touch environment, filesystem, options or native state

| package | hook | what it actually does |
|---|---|---|
| `magick` | `.onLoad` (init.R:17-50) | `set_magick_tempdir(tempdir())`; `Sys.setenv(MAGICK_TMPDIR = tempdir())`; builds the default viewer with `body(fun) <- parse(text = 'magick:::image_preview(x)')` (a constant string, not user input); if the build was autobrewed, sets `Sys.setenv(FONTCONFIG_PATH = ...)` pointing at XQuartz or the package's own `etc/fontconfig`. Three env mutations that persist for the whole session. |
| `data.table` | `.onLoad` (onLoad.R:10-131) | On **R < 4.0.0 only**: `unlockBinding("cbind.data.frame", baseenv())`, rewrites the function body with `parse(text = ...)`, `assign()`s it back into `asNamespace("base")`, re-locks — same for `rbind.data.frame`. Patching base R in a load hook. Irrelevant on R 4.6, but the code is present. Also `readRDS(system.file("Meta","package.rds"))` (its own install metadata) and `.Call(CinitLastUpdated)`. Sets 18 `datatable.*` options. |
| `withr` | `.onLoad` (with.R:63-78) | `unlockBinding("defer", asNamespace("rlang"))` and `ns$defer <- defer` — **monkey-patches another package's namespace** on load, guarded by `getOption("withr:::inject_defer_override")`. |
| `parallelly` | `.onLoad` (zzz.R:4-73) | Under `R CMD check`/vignette build only, sets six `R_PARALLELLY_*` env vars plus `_R_CHECK_LIMIT_CORES_` "so they are passed down to child processes". Otherwise reads options and registers cluster types. |
| `nflplotR` | `.onLoad` (zzz.R:2-63) | `S7::methods_register()`; wraps `reader_function` in `memoise::memoise` and `assign()`s it into the namespace parent env; with `options(nflplotR.cache="filesystem")` creates `R_user_dir("nflplotR","cache")` on disk. If `_R_CHECK_*_TIMING_*` env vars are present, sets `Sys.setenv(OMP_THREAD_LIMIT)` and `Sys.setenv(OMP_NUM_THREADS)` — process-wide OpenMP limits. |
| `nflreadr` | `.onLoad` (zzz.R:2-82) | Rebinds four exported functions (`rds_from_url`, `csv_from_url`, `raw_from_url`, `parquet_from_url`) to memoised versions via `assign(..., envir = rlang::ns_env("nflreadr"))` — **namespace mutation of its own package at load**. With `options(nflreadr.cache="filesystem")` creates `rappdirs::user_cache_dir("nflreadr")` and caches *deserialised remote objects* to disk for 24 h. Sets `options(nflreadr.verbose)`. |
| `ggpath` | `.onLoad` (zzz.R:2-23) | Same memoise/cache-dir pattern as nflplotR. |
| `cli` | `.onLoad` (onload.R:29-139) | `.Call(clic_start_thread, ...)` — **starts a background OS thread** for the progress-bar timer; registers a task callback and finalizers; installs 24 `makeActiveBinding()`s in the package env; may set `options(callr.condition_handler_cli_message)`. |
| `timechange` | `.onLoad` (package.R:15-38) | Sets `Sys.setenv(TZDIR = ...)` if unset, after probing six well-known zoneinfo paths. |
| `pillar` | `.onLoad` (zzz.R:40-64) | If `Sys.getenv("DEBUGME") != ""` and debugme is installed, calls `debugme::debugme()` — activates third-party instrumentation based on an env var. |
| `curl` | `.onAttach` (onload.R:1-18) | Reads `Sys.getenv("ALL_PROXY")`, parses it, and **prints the proxy host and port** as a startup message. Harmless unless credentials are embedded in `ALL_PROXY`, in which case the userinfo is not printed (only scheme/host/port). `.onLoad` only acts under Emscripten. |
| `progressr`, `globals`, `listenv`, `future` (`.onLoad`) | | read `R_<PKG>_*` env vars into package options; `future` additionally calls `Sys.unsetenv("R_FUTURE_PLAN")` under `R CMD check`, initialises a session UUID (which writes `.GlobalEnv$.Random.seed`), and calls `plan("default", .init = FALSE)`. |
| `bslib` | `.onLoad` (onLoad.R:1-13) | Creates a `cachem::cache_mem`; registers a `setHook(packageEvent("shiny","onLoad"))`. |
| `xfun` | `.onLoad`/`.onUnload` (zzz.R:24-33) | Registers a finalizer that kills a background proxy app on session exit. |

### Benign — one line each

`Rcpp` registers a vignette engine. `S7` `.onAttach` sets `.conflicts.OK` on R < 4.3; `.onLoad`
defines its generics. `V8` `.onAttach` prints the linked engine version. `cpp11`, `fontawesome`,
`glue`, `htmlwidgets`, `hms`, `fs`, `lubridate`, `vctrs`, `gt` register S3 methods / knitr engines
only. `htmltools`, `reactable`, `sass`, `rmarkdown` register `knitr::knit_print` methods.
`dplyr` `.onLoad` calls `.Call(dplyr_init_library)` and `run_on_load()`; `.onAttach`/`.onDetach`
only add and remove a plyr-conflict warning hook. `evaluate`, `farver`, `ggplot2` (`.onLoad`),
`lifecycle`, `scales`, `tidyr`, `litedown`, `knitr`, `tibble` do package-local initialisation.
`ggplot2` `.onAttach` prints a random tip 10 % of the time in interactive sessions.
`gsubfn` `.onAttach` probes tcltk capability. `magrittr` and `rlang` `.onLoad` are `.Call` inits.
`nflverse` `.onAttach` attaches the five core packages via `do.call("library", ...)` and prints a
banner. `nflreadr`/`nflplotR`/`ggpath` `.onAttach` only validate an option and print a message.
`digest` `.onLoad` caches option values. All `.onUnload` hooks (`cli`, `data.table`, `digest`, `fs`,
`parallelly`, `rlang`, `sass`, `yaml`, `xfun`) are `library.dynam.unload()` of the package's own DLL
plus, in cli's and fs's case, a `.Call` cleanup.
