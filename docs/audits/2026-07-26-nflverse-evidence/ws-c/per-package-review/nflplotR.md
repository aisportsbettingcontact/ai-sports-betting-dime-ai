# nflplotR 1.6.0 — line-level review

**Files read: 16 of 16.** `ls sources/nflplotR/R | wc -l` = **16** (15 `.R` + `sysdata.rda`).
All 15 R source files read end to end (1,202 code lines after stripping roxygen doc lines; the 21
comment lines matching URL/eval/network tokens were reviewed separately — all are pkgdown/GitHub
documentation links). No `src/`, no `useDynLib`, no `inst/` — verified. `tools/check.env` is a
two-line env file.

## Load hooks

`.onLoad` (`R/zzz.R:2-63`):
- `S7::methods_register()` — registers the S7 `element_grob` methods.
- Reads `getOption("nflplotR.cache", default = "memory")`. With `"filesystem"` it creates
  `R_user_dir("nflplotR","cache")` on disk (`:11-14`) and builds a `cachem::cache_disk`.
- Wraps `reader_function` in `memoise::memoise(..., timeout(86400))` and `assign()`s it into
  `parent.env(environment())` — **namespace mutation at load**, same idiom nflreadr uses.
- `:42-62` If either `_R_CHECK_EXAMPLE_TIMING_CPU_TO_ELAPSED_THRESHOLD_` or
  `_R_CHECK_TEST_TIMING_CPU_TO_ELAPSED_THRESHOLD_` is set, calls
  **`Sys.setenv("OMP_THREAD_LIMIT")` and `Sys.setenv("OMP_NUM_THREADS")`** plus
  `data.table::setDTthreads()`. These are process-wide OpenMP settings that persist for the whole
  session and are inherited by child processes. The guard means it normally only fires under
  `R CMD check`, but the mechanism is env-var-triggered, so anything that sets those variables
  triggers it. **Note.**

`.onAttach` (`R/zzz.R:65-80`): validates the cache option and prints a startup message. Benign.

## Network call sites

Two, both https, both indirect:

1. `load_headshots()` (`R/utils.R:54-57`) →
   `nflreadr::rds_from_url("https://github.com/nflverse/nflplotR/releases/download/nflplotr_infrastructure/headshot_gsis_map.rds")`.
   This inherits nflreadr's remote `readRDS` — see `nflreadr.md`. Called from
   `geom_nfl_headshots` (`R/geom_nfl_headshots.R:135`), `gt_nfl_cols_label`
   (`R/gt_nfl.R:132`), `gt_nfl_headshots` (`R/gt_nfl.R:298`), `headshot_html` (`R/utils.R:28`),
   and the S7 headshot element (`R/theme-elements.R:231`). **Note.**
2. `nfl_team_factor()` (`R/nfl_team_factors.R:69`) → `nflreadr::load_teams()`.

`na_headshot()` (`R/utils.R:59-60`) returns a constant https `static.www.nfl.com` URL.

## The image-parsing surface (worth flagging)

`reader_function()` (`R/build_grobs.R:106-113`) dispatches to `magick::image_read()` or
`magick::image_read_svg()`. Its input is either a raw PNG blob from `sysdata.rda` (safe, bundled)
or, for headshots, **a URL string fetched from a remote RDS** — magick then downloads and parses it.
That routes remote, third-party image bytes into ImageMagick's C++ parsers (and, for SVG, librsvg).
It is the only place in the six targets where untrusted binary content reaches a native parser.
`build_grobs.R:40,44,54,61,65,75,82,86` then pass it through `image_quantize`/`image_colorize`/
`image_fx`. **Note** — not a defect in nflplotR, but real inherited attack surface.

## Filesystem writes

Two, both benign:
- `ggpreview()` (`R/ggpreview.R:53-68`) — `file <- tempfile()`, `ggplot2::ggsave(file, ...)`, then
  `rstudioapi::viewer(file)`. Tempdir only.
- `gt_render_image()` (`R/gt_nfl.R:349-360`) — `tempfile(fileext=".png")`, `gt::gtsave()`,
  `on.exit(unlink(temp_file))`. Tempdir only, cleaned up.

The `.onLoad` cache-dir creation above is the only non-temp path, and only under an opt-in option.

## eval / parse / NSE

No `eval(parse(`, no `source()`, no `readRDS`/`load`/`unserialize` called directly, no `system()`.
`{{ columns }}` embrace-NSE throughout `gt_nfl.R` is rlang tidy-eval on user column names.
`R/theme-elements.R:181-186,206-212,246-251` reassign `class(element) <- c(...)` on S7 objects to
force ggplot2 dispatch — a hack, not a security issue.

## HTML generation

`gt_nfl.R:698-717` (`html_tag`/`span_tag`/`div_tag`/`p_tag`) and `utils.R:20-48`
(`logo_html`/`headshot_html`) build raw HTML with `paste0`/`sprintf` and **no escaping**. Inputs are
team abbreviations validated through `nflreadr::clean_team_abbrs()` and hex colours, plus
`headshot_map$headshot_nfl` URLs that come from the remote RDS. If that RDS were poisoned, a
crafted "URL" would be interpolated unescaped into an `<img src="...">` in a gt table — an HTML
injection into any rendered report. Low severity (requires the upstream RDS to be compromised
first), but it is a missing defence-in-depth layer. `get_image_uri()` (`gt_nfl.R:214-232`)
base64-encodes the *bundled* logos into `data:` URIs and is not affected.

## Data payload — `R/sysdata.rda` (1.87 MB)

Loaded with `Rscript --vanilla`: `logo_list` (39 raw blobs) and `wordmark_list` (32 raw blobs) —
**every blob starts `89 50 4E 47 0D 0A 1A 0A`, i.e. a valid PNG header**; sizes 5 KB–135 KB. Plus
`logo_urls` (39 https `a.espncdn.com`), `wordmark_urls` (36 https `github.com/nflverse`),
`primary_colors`/`secondary_colors` (36 hex each), `color_palettes` (3 palettes). No functions.

## Scan rows

9 hits: 2 `ns_hook` (note), 2 `Sys_setenv` (note, the OMP lines), 5 `Sys_getenv` (benign).

**Verdict: clean, with two notes** — session-wide `Sys.setenv` of OMP variables in `.onLoad`, and
remote images parsed by ImageMagick. No findings.
