# WS-C notes — method, scope decisions, limits

Scanner: `$ROOT/tmp/scan.py`. Classifier: `$ROOT/tmp/classify.py`. Both are re-runnable and
deterministic; `sources/` was never written to. No network was used at any point (all six audit
targets and all 84 closure packages were read from the Task-0 staged CRAN trees). No upstream
GitHub lookups were needed.

## Pattern set

All 15 patterns from the brief, plus the four the task required (`Sys.getenv`, `library.dynam`,
`.Call/.C/.External/.Fortran`, `httr::`/`curl::` + POST-shaped calls), plus `pkg_install`
(`install.packages`/`remotes::install`/`devtools::install`/`pak::`) which is a real runtime
execution surface the brief did not list.

For compiled and build files a second set was added, because the R-language patterns say nothing
useful about C: `c_system`, `c_popen`/`pclose`, `c_exec*`, `c_fork`, `c_dlopen`, `c_getenv`,
`c_setenv`/`putenv`, and `build_net` (`curl`/`wget`/`git clone`/`https?://`).

## Scope decisions (deviations worth knowing)

1. **`build_net` is applied to build scripts only, not to `.c/.h/.cpp`.** Applied to vendored C
   sources it produced 2,505 hits, essentially all licence headers and RFC references in ICU,
   libsass and xgboost. Restricting it to `configure*`, `cleanup*`, `Makevars*`, `Makefile*`,
   `.sh/.py/.pl/.ac/.am/.in` left 80 hits — and those 80 are exactly the signal wanted: which
   packages reach the network *during installation*. This is the single most valuable result of
   the scan.
2. **Actual `inst/` exclusions are wider than the brief's.** The brief excludes `inst/doc`.
   `scan.py` also skips `inst/docs`, `inst/html`, `inst/examples` and `inst/NEWS`
   (`SKIP_INST_SUB`), and skips extension-less `inst/` files that have no shebang. The scanner also
   never applies the R-language patterns to `.c`/`.cpp`. This narrowing was not disclosed in the
   first version of this file; it is disclosed now.

   **The undisclosed deviation is the four *additional* directories: 103 files, 40 of them
   `.R`/`.r`.**

   ```sh
   # the deviation - four dirs beyond the brief's own exclusion: 103 files, 40 R
   find sources -type f \( -path '*/inst/docs/*' -o -path '*/inst/html/*' \
        -o -path '*/inst/examples/*' -o -path '*/inst/NEWS/*' \) | wc -l          # 103
   find sources -type f \( -path '*/inst/docs/*' -o -path '*/inst/html/*' \
        -o -path '*/inst/examples/*' -o -path '*/inst/NEWS/*' \) \
        \( -name '*.R' -o -name '*.r' \) | wc -l                                  #  40

   # inst/doc alone, which the brief already excludes: 540 files, 144 R
   find sources -type f -path '*/inst/doc/*' | wc -l                            # 540
   find sources -type f -path '*/inst/doc/*' \( -name '*.R' -o -name '*.r' \) | wc -l   # 144
   ```

   All five directories together are 643 files / 184 R (540+103 = 643; 144+40 = 184), but quoting
   643/184 as "the deviation" overstates it ~6x by folding in `inst/doc`, which the brief excludes
   anyway. An earlier version of this file did exactly that, and published a `-type d` command that
   returns **55** (a directory count) rather than any of these file counts. Both are corrected here.

   Three real hits are dropped by it. All three were located by targeted verification and **added
   to `pattern-hits.csv` by hand** (`SUPPLEMENT` in `classify.py`) so the CSV remains a complete
   record. None changes any conclusion — all three are non-runtime:

   | hit | classification |
   |---|---|
   | `reactable/inst/examples/app/app.R:386` `eval(parse(text = code()))` | benign — Shiny demo app; the evaluated text is the demo user's own editor input |
   | `Rcpp/src/attributes.cpp:2816` `eval(parse(_["text"] = args))` | note — C++ calling back into R parse/eval in the Rcpp attributes compiler; part of the `sourceCpp` surface already escalated as E5 |
   | `digest/inst/CITATION:4` `eval(parse(text = meta$\`Authors@R\`))` | benign — standard R CITATION idiom over the package's own DESCRIPTION |

3. **`inst/` is scanned for scripts only** — `.R/.r/.q/.s`, `.sh/.bash/.py/.pl/.rb`, and
   extension-less files with a shebang. Web assets under `inst/` (bslib, jquerylib, reactable,
   reactR, htmlwidgets, fontawesome, gt, rmarkdown ship ~30 MB of JS/CSS/HTML) are not R code and
   would have swamped the CSV with CSS `url(...)` and JS `load(...)` matches. Those assets execute
   in a *browser*, not in R, and are out of the execution-surface scope defined for this task.
   They remain unreviewed and are recorded as a limitation in `escalations.md`.
4. **`inst/doc/` excluded** per the brief; `man/`, `tests/`, `vignettes/` excluded per the brief.
   A package's own `inst/testme`, `inst/tinytest`, `inst/unitTests` harnesses are scanned and
   present in the CSV but classified benign — they are not loaded at runtime.
5. **`.onLoad` bodies were extracted by brace-matching** (`$ROOT/tmp/hook-bodies.txt`, 1,651
   lines) and every one was read. Two hooks exceed the 200-line extraction window (vctrs, future);
   both were read directly from source instead.
6. Files larger than 4 MB and files with NUL bytes in the first 8 KB are skipped as binary. Nothing
   in scope hit that limit except data blobs.

## What the CSV does *not* capture

The regex set is deliberately narrow, so two real findings do **not** appear as CSV rows and are
recorded only in the review files and the report:

- `nfl4th/R/get_game_data.R:41-42` builds a **plaintext `http://site.api.espn.com`** URL by
  `paste0()`. No pattern in the brief matches a bare URL literal in an R file, and `build_net` is
  build-scripts-only (decision 1). Found by reading the file.
- `nfl4th/R/cache.R:127` calls `grepl(rawToChar(no_cache), ...)` where `no_cache` is a raw vector
  in `sysdata.rda`. Decoded with `Rscript --vanilla`: it is the string **`"ripley"`**. The package
  detects it is running on a CRAN check machine by grepping the cache path, and stores the needle
  as raw bytes so CRAN's own source grep will not find it. Benign in effect, deliberate evasion of
  a policy inspection in form.

Anyone re-running this scan should treat "no CSV row" as "no *pattern* matched", not "nothing there".

## Binary payloads loaded and inspected (Rscript --vanilla, R 4.6.1)

| payload | contents |
|---|---|
| `nfl4th/R/sysdata.rda` (186 KB) | `two_pt_model` raw 25,347 B (xgboost UBJ, starts `{"learner"`), `fg_model` a `bam` GAM object, `punt_df` 5,483x4 tibble, `no_cache` raw[6] = `"ripley"` |
| `nflplotR/R/sysdata.rda` (1.87 MB) | `logo_list` 39 raw blobs, `wordmark_list` 32 raw blobs — every one begins `89 50 4E 47 0D 0A 1A 0A` (valid PNG), 5 KB–135 KB; plus `logo_urls`/`wordmark_urls` (https, a.espncdn.com + github.com), `primary_colors`/`secondary_colors`, `color_palettes` |
| `nflseedR/R/sysdata.rda` (439 B) | three integer constants, `div_vec`, `conf_vec` — 36-element named character vectors |
| `nflfastR/R/sysdata.rda` (29 KB) | `tidy_play_stats_row` (1x190), `default_play` (1x372), `scramble_fix` (5,830 game-play ids) |

No function objects, no closures carrying environments, and no executable content were found in any
`sysdata.rda`. `nflseedR/data/*.rda` and `nflreadr/data/*.rda` are documented data dictionaries and
example frames.

## Bulk labels are rule output, not per-row evidence (IMPORTANT)

Of the 3,637 rows, **34 were hand-adjudicated** (15 findings, 19 notes, plus 2 hand-set benign
supplements) after reading the surrounding code. **The other ~3,600 were labelled by regex rules in
`classify.py` against the one-line snippet, with no per-row context read.** Any statement of the
form "row X is benign because Y" for a bulk-labelled row is a *rule's* claim, not a verified fact
about that line. The reason strings are computed but **never written to the CSV**, so the evidence
file carries only the label; nothing downstream inherits an unverified justification.

An external review found three rule reason-strings asserting facts the rule never checked. All
three have been rewritten in `classify.py`; the *labels* were correct in every case:

- `build_net -> benign` claimed "URL appears only in a comment" — but `is_comment` has already
  returned by that point, so **32 of the 68 benign `build_net` rows are non-comment lines**
  (`curl/cleanup:2` an `rm -f` of a filename, `magick/configure:94` a `sed 's/curl/utils/g'`,
  `sass/.../test-leaks.pl:30-31` variable assignments). Reason now describes what these actually
  are; every line that genuinely fetches is hand-adjudicated.
- `processx_callr -> benign` claimed "option name or comment; neither is in this closure". The
  second half is true and load-bearing; the first half is false — `cli/R/progress-server.R:231`
  (`processx::process$new(...)`) and `cli/R/tty.R:253` (`callr::r_process_options(...)`) are live
  calls. They are unreachable **because processx and callr are cli `Suggests:` and absent from all
  90 staged packages** (verified: neither appears in `sources/`, and no DESCRIPTION declares them).
  Reason now says that.
- `Sys_getenv -> benign` claimed "not used to build a command or path" and
  `native_entry -> benign` claimed the target was "the package's own registered native routines".
  Neither was checked. Both reasons now state the limit of what was inspected.

## Honesty note on classification

`readRDS`/`load`/`unserialize` on downloaded bytes is classified **note** at minimum in every
package including the six trusted targets, per the audit's own rule. The one exception is
`nflfastR add_dakota()`, promoted to **finding** because it is `load()` (not `readRDS()`) and the
target environment is a live function frame, not a variable. The decision about whether the
nflverse GitHub org is trusted enough to deserialise from belongs to the synthesis, not here.
