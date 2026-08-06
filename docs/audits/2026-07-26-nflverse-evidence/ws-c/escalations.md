# WS-C escalations — closure packages needing a Task-7 deep review

Escalating is the correct outcome where a pattern hit is a *real, reachable* execution surface that
a one-line snippet plus surrounding context cannot adjudicate. Everything below was classified
`note` or `finding` in `pattern-hits.csv` and is left deliberately un-cleared.

Nothing here is an accusation. These are the places where "I read enough to classify it benign"
would have been a lie.

> ## ⚠ AMENDMENT NOTICE — read before citing this file
>
> **This file is the WS-C escalation baseline: what WS-C escalated, and why, from source code
> alone.** It was **amended on 2026-07-26, after WS-C's independent review**, to incorporate
> install-provenance evidence that WS-C did not have and could not have had when it escalated.
>
> Three entries — **E1, E2 and L3** — are marked **`[AMENDED 2026-07-26]`**. Each of those now
> carries two clearly separated blocks:
>
> - **"As originally escalated"** — the verbatim original text. This is the WS-C baseline. It is
>   what a reader should cite when asking *what WS-C found*.
> - **"Post-review determination"** — conclusions reached **after** the original escalation, using
>   evidence identified below. This is what a reader should cite when asking *what turned out to
>   be true*. It is not WS-C baseline work.
>
> Everything not marked `[AMENDED]` is original, unmodified WS-C output.
>
> **Attribution of post-review evidence.** The install-provenance logs
> (`$TASKS/bznitqj7o.output`, `$TASKS/bvdz7ibhe.output`) and the initial per-branch reading of them
> were **supplied by the coordinator** following independent review; WS-C then re-derived every
> figure and every branch outcome from those logs itself before writing the determinations below.
> The `.future.R` marker test in E2 was designed and run by WS-C. Task 7's own review files under
> `escalation-reviews/` reach these resolutions independently and were not consulted or modified.

---

## Tier 1 — install-time remote code execution (adjudicate first)

### E1. `[AMENDED 2026-07-26]` `curl`, `fs`, `V8`, `xml2` fetched and executed remote scripts here; `magick` did not

<details open>
<summary><b>As originally escalated (WS-C baseline, before install-provenance evidence)</b></summary>

> ### E1. `curl`, `fs`, `magick`, `V8`, `xml2` — configure fetches and dot-sources a remote script
>
> Nine `finding` rows. Each `configure` downloads a shell script over the network and `. `-sources it
> during `R CMD INSTALL` (`hooks-inventory.md` has the full table). No hash pinning; the fetched
> script is deleted by `cleanup` afterwards, so it cannot be inspected post-hoc.
>
> **Why escalated, not closed:** severity depends entirely on a fact WS-C cannot establish — whether
> these five were installed *from source* on this machine or as prebuilt binaries. This is a
> darwin/arm64 host; if the user installs from CRAN or Posit Package Manager the binary path is
> normal and `configure` never runs. **Task 7 must reconcile against WS-A/WS-B install provenance
> (`evidence/acquisition-log.csv`, the installed `DESCRIPTION` `Built:` fields, and whether
> `Packaged`/`Built` show a binary build).** If any of the five were built from source here, this is
> the audit's top finding; if all five are binaries, it drops to a supply-chain risk statement about
> the reinstall path.

*Baseline errors, for the record: the original text said "each `configure` downloads" without
qualifying that every one is a conditional fallback; it listed `magick` among the fetchers, which
the logs disprove; and it hedged severity on source-vs-binary, an axis now closed.*

</details>

#### Post-review determination (2026-07-26, after install-provenance evidence)

Nine `finding` rows across five packages. Each `configure` has a **conditional fallback** branch
that downloads a shell script over the network and `. `-sources it during `R CMD INSTALL`.

**Install provenance is settled, and it is the bad case: all 90 packages were compiled from
source on this host** — 87 `installing *source* package` lines in
`$TASKS/bznitqj7o.output` plus 4 in `$TASKS/bvdz7ibhe.output` = 91 source installs (90 packages,
`magick` twice), and **zero** `installing *binary* package` lines in either log. The first version
of this entry hedged severity on source-vs-binary. That axis is now closed; the correct axis is
which *branch* each conditional took. Verified per package from the install logs:

| package | rows | branch taken here | evidence |
|---|---|---|---|
| `fs` | `configure:26` | **FIRED** | `bznitqj7o:721` `Using autobrew bundle: libuv-1.52.0-sonoma-universal.tar.xz`, inside the fs block that opens at `:717` |
| `curl` | `configure:50` | **FIRED** | `bznitqj7o:784` `Using autobrew bundle: curl-macos-8.14.1-universal.tar.xz`, block opens `:780` |
| `V8` | `configure:91` | **FIRED** | `bznitqj7o:1258` `Using autobrew bundle: v8-14.6.202.26-sonoma-universal.tar.xz`, block opens `:1253` |
| `xml2` | `configure:33` | **FIRED** (by elimination) | `bznitqj7o:1556` `PKG_CFLAGS=-I…/xml2/.deps/include/libxml2`. `.deps` appears nowhere in xml2's own `configure` or `Makevars.in` — only in `cleanup`, which deletes it — so only the autobrew script can have created it. There is **no `Found pkg-config` line anywhere in the run-1 log**. Block opens `:1552` |
| `magick` | `configure:51` | **did NOT fire, twice** | Run 1 took the Homebrew branch (`bznitqj7o:3090-3091` `-I/opt/homebrew/opt/imagemagick@6/…`) and then `:3107 ERROR: configuration failed`. Run 2 succeeded via pkg-config (`bvdz7ibhe:12` `Found pkg-config cflags and libs!`). Block opens `:3085` |

**Four of the nine rows are Linux-only and unreachable on darwin/arm64**: `curl:91`
(`uname = Linux` guard), `magick:31` (`uname -sm = "Linux x86_64"` guard), and `V8:95`/`V8:96`
(the `elif [ "$DOWNLOAD_STATIC_LIBV8" ]` arm, unreachable because the Darwin `elif` above it
already matched).

**`V8`'s fetch is unconditional on this platform, not a "no Homebrew" fallback.** `configure:29-30`
sets `HAVE_STATIC=1` because `uname` is Darwin; `:44-48` then set `DOWNLOAD_STATIC_LIBV8=1` because
`uname -m` is arm64. The guard at `:85` is `[ \`command -v brew\` ] && [ -z "$DOWNLOAD_STATIC_LIBV8" ]`
— the second test is false, so the `else` (autobrew) runs **even though this host has Homebrew at
`/opt/homebrew`**. The log confirms it: V8 autobrewed on a machine with brew installed.

**The shape of the finding is worse than "a script ran".** The sourced scripts did not merely
execute — each pulled a prebuilt static binary bottle from `autobrew.github.io`
(`libuv-1.52.0-sonoma-universal.tar.xz`, `curl-macos-8.14.1-universal.tar.xz`,
`v8-14.6.202.26-sonoma-universal.tar.xz`, plus xml2's libxml2 bundle) and **linked it into
`fs.so`, `curl.so`, `V8.so` and `xml2.so`** — objects that `dyn.load` into every R session that
touches these packages, today.

**Precisely what is and is not pinned.** The bottle *filenames* are version-labelled
(`libuv-1.52.0`, `curl-macos-8.14.1`, `v8-14.6.202.26`), so it is loose to call the tarball itself
"unpinned". **What is unpinned is the `autobrew` script that selects it** — `configure` fetches
that script fresh from `autobrew.github.io` on every build with no hash, no signature and no
version constraint, and the script alone decides which bottle URL to retrieve. A changed script can
therefore point at a different artefact without anything in the R package changing. No integrity
check is applied at either step: not to the script, not to the bottle.

**Cleanup is not uniform, and `fs` is the exception.** `curl/cleanup` and `V8/cleanup` and
`magick/cleanup` remove `.deps` with `rm -Rf`; `xml2/cleanup` uses a single `rm -Rf` for
everything. **`fs/cleanup` is `rm -f src/Makevars configure.log autobrew .deps` — `rm -f` cannot
remove a directory**, so fs's `.deps` tree is not deleted by its own cleanup (it disappears only
because R CMD INSTALL discards the whole staging directory). Either way the practical outcome for
this audit is the same: **neither the autobrew script nor the bottle it fetched survives anywhere
inspectable**, so their contents cannot be verified after the fact.

**This is a gap in the audit's coverage, not just a risk statement: WS-B verified the integrity of
the R *source* tarballs against CRAN. It does not cover these binaries.** Nothing in this audit has
checked what is actually inside the four autobrew bundles that are now linked into the installed
library. Task 7 should say so explicitly, and decide whether a rebuild with
`USE_BUNDLED_LIBUV=1` / system pkg-config / `V8_PKG_LIBS` set — which avoids every autobrew branch —
is warranted.

### E2. `[AMENDED 2026-07-26]` `future` — `.onAttach` sources `./.future.R` from the working directory

<details open>
<summary><b>As originally escalated (WS-C baseline, before the marker test)</b></summary>

> ### E2. `future` — `.onAttach` sources `./.future.R` from the working directory
>
> `R/zzz.R:97` → `R/zzz.R:105-169`, `source()` at line 162. Default paths `c(".future.R",
> "~/.future.R")`, no opt-in, errors downgraded to a warning. Reachable from an ordinary nflverse
> session via `furrr` (nflseedR, nflfastR, nfl4th). **Task 7 should determine whether any `.future.R`
> exists on this host (`~`, and the repo working directories the user actually runs R in) and confirm
> whether `R_FUTURE_STARTUP_SCRIPT` / `options(future.startup.script)` is set anywhere.**

*Baseline error, for the record: "Reachable from an ordinary nflverse session via `furrr`" was
wrong — it conflated namespace load with attach. The finding itself was correct.*

</details>

#### Post-review determination (2026-07-26, after the marker test)

`R/zzz.R:97` → `R/zzz.R:105-169`, `source()` at line 162. Default paths `c(".future.R",
"~/.future.R")`, no opt-in, errors downgraded to a warning.

**Trigger corrected.** An earlier version of this entry claimed the hook was reachable from an
ordinary nflverse session via `furrr`. **That is wrong and was empirically disproven.** `.onAttach`
fires on *attach*, not on namespace load. `future` is in `Imports:` of nflseedR and nflfastR
(namespace load → `.onLoad` only) and in `Suggests:` of nfl4th; `nflverse/R/zzz.R:1-16` attaches
five packages that all declare `Depends: R` only. Marker test with a `.future.R` in the working
directory, R 4.6.1:

```
library(nflverse)  -> marker: FALSE      library(furrr)   -> marker: TRUE
library(nflfastR)  -> marker: FALSE      library(future)  -> marker: TRUE
library(nflseedR)  -> marker: FALSE      loadNamespace(future) -> marker: FALSE
library(nfl4th)    -> marker: FALSE
```

The finding stands and the classification is unchanged — the trigger is **an explicit
`library(future)` or `library(furrr)`, which nflverse parallel workflows do commonly use** (both
nflseedR and nflfastR document `future::plan()` as the way to parallelise). It is never
`library(nflverse)`.

**Task 7 should determine whether any `.future.R` exists on this host (`~`, and the repo working
directories the user actually runs R in) and confirm whether `R_FUTURE_STARTUP_SCRIPT` /
`options(future.startup.script)` is set anywhere.**

### E3. `tinytex` — downloads and executes a TeX Live installer; shells out to a package manager

`R/install.R:303` `system(sprintf(...))`, `:349` `system2('sh', c(...))` on a downloaded installer,
`:568` `system2(pkg, args = c('-y', paste0('-o', path.expand(target))))`, `:188`
`system2('ldd', ...)`; `R/tlmgr.R:52` `system2('tlmgr', args, ...)` and `R/tlmgr.R:128`
**`system('brew install ghostscript')`**. `tinytex::install_tinytex()` is by design "download an
installer from the internet and run it".

**Why escalated:** functionally identical to E1 but at *runtime* and user-triggered. It is in the
closure via rmarkdown. Task 7 should confirm the download URLs and integrity checks in
`R/install.R` and whether tinytex is ever invoked non-interactively in this environment.

---

## Tier 2 — packages that execute arbitrary code by design

These are not defects; they are capabilities. They need a deep review because "benign" is the wrong
word for a package whose job is to run code, and because each one widens the blast radius of any
compromise elsewhere in the closure.

### E4. `parallelly` — launches processes, including over SSH

`R/launchNodePSOCK.R:61` `system(local_cmd, wait = FALSE, input = input)`;
`R/makeClusterPSOCK.R:352,357` `system(cmd, wait = FALSE)`; `R/utils,cluster.R:351`
`system(test_cmd, intern = TRUE, input = input)`; plus `system2("ps"/"tasklist"/"id")` probes and
`shell("ver")`. `makeClusterPSOCK(rshcmd = ...)` composes and executes remote shell commands.
47 note rows. **Task 7: review how `rshcmd`/`rscript` arguments are quoted and whether any code path
lets a data value reach the command string.**

### E5. `Rcpp` — compiles and `dyn.load`s C++ at runtime

`R/Attributes.R:156,587,606,1181` `system2(r, ...)` / `system(command, intern = TRUE)` invoking
`R CMD SHLIB`; `R/Attributes.R:208,219` `source(scriptPath, local = env)`;
`R/Attributes.R:1227,1271` `load(file = index_file)` / `load(file = token_file)` on a **cache index
in a user-writable directory**; `R/RcppLdpath.R:92` `capture.output(source(script))`. 78 note rows.
`sourceCpp()`/`cppFunction()` compile and load arbitrary C++. **Task 7: audit the sourceCpp cache
directory location and the `load()` of its index — that is a local deserialisation primitive.**

### E6. `xfun` — shells out extensively and uploads files over the network

`R/command.R:307` `system2('curl', shQuote(c('-T', file, server)))` and `:348` a second
`system2('curl', ...)`; `R/cran.R:142-155` `curl::handle_setform(...)` + `curl_fetch_memory(server,
h)` — **HTTP POST/upload paths**; `R/command.R:172` `system2('powershell', c('-Command',
shQuote(command)))`; `:277` `system2('sh', c('-c', shQuote(code)))` — **executes an arbitrary shell
string**; `:318` `system2('git', 'pull')`; `R/cache.R:226,234,477-483` `unserialize(read_bin(...))`,
`readRDS(...)`, and `eval(parse2(...))`; `R/base64.R:119` `readRDS(p)` of a cache db;
`R/cache.R:564,601` `readRDS(f)` keyed on a URL. 112 note rows — **the largest single concentration
in the closure.** `xfun` is pulled in by knitr, rmarkdown, litedown and tinytex.
**Task 7: this is the highest-value deep review target after E1. Determine which of these paths are
reachable without an explicit user call.**

### E7. `V8` (+ its consumers `juicyjuice`, `reactR`, `reactable`) — embeds a JavaScript engine

`R/callback.R:6,18` `eval(parse(text = strfun))` / `eval(parse(text = str))` — **JS callbacks are
turned back into R code and evaluated**. `ctx$source()` accepts a URL (documented at
`R/V8.R:108,122` with `cdnjs.cloudflare.com` and `coffeescript.org` examples).
`juicyjuice/R/css_inline.R:22` and `reactable/R/reactable.R:850` and `reactR/R/babel.R:20` all call
`ctx$source(...)`. **Task 7: `V8/R/callback.R` is the sharpest item — confirm exactly what can
reach `eval(parse(text=))` from JS, and confirm every `ctx$source()` in the closure reads a bundled
`system.file()` path rather than a URL.**

### E8. `knitr`, `rmarkdown`, `litedown`, `evaluate` — document rendering executes code

`knitr/R/engine.R:150,218,259,382,720,731,798` `system2(cmd, ...)` for foreign-language engines
(and `:259` `system('R CMD SHLIB')`); `knitr/R/block.R:619,646`, `R/hooks.R:14`, `R/defaults.R:223`
(`eval(parse_only(...), envir = globalenv())`), `R/themes.R:106` `eval(parse(text = y))`;
`rmarkdown/R/render.R:460`, `R/shiny.R:166`, `R/shiny_prerendered.R:70,79` **`source(global_r)`**;
`R/shiny_prerendered.R:749` `load(rdata_file, envir = server_envir)`; `rmarkdown/R/pandoc.R:104,156,
690,766` and `R/util.R:307,495,497` `system()`/`shell()`; `litedown/R/fuse.R:1290` an explicit
`exec` engine that runs arbitrary commands, `R/fuse.R:679` / `R/site.R:250` / `R/utils.R:1163,1181`
`readRDS()` of cache files. 54 + 38 + 12 note rows.
**Task 7: bound the exposure — these only fire when the user renders a document, but they mean any
`.Rmd` in a repo is executable content.**

### E9. `data.table` — runtime package installation and base-namespace patching

`R/devel.R:38` **`utils::install.packages(pkg, repos = repo, type = type, lib = lib, ...)`** —
`update_dev_pkg()` installs a package from a **configurable repo** at runtime; `R/devel.R:13`
`file(file.path(contrib.url(repo, ...), "PACKAGES"))`. `R/onLoad.R:35-60` unlocks and rewrites
`base::cbind.data.frame`/`rbind.data.frame` on R < 4.0.0. `R/utils.R:217` `system(cmd, intern=TRUE)`
for CPU detection; `R/fread.R:93` `download.file(file, tmpFile, ...)` when `fread()` is given a URL,
`:215` `yaml::yaml.load(yaml_string)` on a file header.
**Task 7: confirm the default `repo` for `update_dev_pkg()` and that the base-patching branch is
genuinely unreachable on R 4.6.**

---

## Tier 3 — narrower items, still not cleared

### E10. `magick` — remote image bytes into ImageMagick, plus env mutation
`R/utils.R:35,46` `curl::curl_download(url, tmp, handle = h)` / `utils::download.file(url, tmp)`;
`.onLoad` sets `MAGICK_TMPDIR` and `FONTCONFIG_PATH`; `src/base.cpp:12`
`setenv("KMP_DUPLICATE_LIB_OK","1",1)`. **Reachable from nflplotR** (`reader_function()` →
`magick::image_read(<remote URL>)`). 4,660 lines of unreviewed C++ bindings over a system
ImageMagick. Task 7 should decide whether headshot rendering should be considered an untrusted
parser path.

### E11. `stringi` — icudt download during install
Mitigated (pinned commit SHA, md5 verified against a shipped `.md5sum`, `.xz` already in the tarball
for little-endian so no fetch normally occurs), but the code path exists and includes an `http://`
fallback mirror. Left as `note`. Task 7 need only confirm the shipped `icudt74l.dat.xz` was in fact
used.

### E12. `withr` — monkey-patches `rlang`'s namespace at load
`R/with.R:63-78` `unlockBinding("defer", asNamespace("rlang"))`; `ns$defer <- defer`. Cross-package
namespace mutation in a load hook. Almost certainly the documented `defer()` interop, but a
deep review should confirm nothing else is injected.

### E13. `rstudioapi`, `bslib`, `sass`, `gt`, `fontawesome` — network fetches in UI packages
`rstudioapi/R/themes.R:68` `utils::download.file(themePath, path)` and `R/auth.R:676`
`curl::curl_fetch_memory`; `rstudioapi/R/remote.R:93` `readRDS(responseFile)` — **deserialises a
response file**; `sass/R/fonts.R:522,526` `curl::curl_download` / `download.file` for Google Fonts;
`gt/R/format_data.R:8699` and `R/utils_render_xml.R:3293` `utils::download.file`;
`gt/R/info_tables.R:1548` `readRDS(system_file(...))` (bundled, fine);
`gt/R/helpers.R:3382` injects `@import url('https://fonts.googleapis.com/...')` into generated CSS.
All are reachable from nflplotR's `gt_*` helpers. Individually small; collectively they mean
rendering a table can talk to Google and RStudio infrastructure.

### E14. `memoise` cache backends
`R/cache_filesystem.R:48` `readRDS(file.path(path, key))`, `R/cache_s3.R:52` and
`R/cache_gcs.R:55` `readRDS(temp_file)`. **nflreadr, nflplotR and ggpath all use memoise in
`filesystem` mode when the user opts in** — which means a poisoned or tampered cache file on disk
is deserialised without validation. This is the mechanism that makes the remote-`readRDS` notes in
the targets *persistent* rather than per-session.

---

## Structural limitations (not package-specific, but must appear in the synthesis)

### L1. ~892,000 lines of C/C++ were not read
Pattern-level review only, per the audit spec. Four packages carry wholesale vendored third-party
projects: stringi (ICU 74, 540 k lines), xgboost (83 k), sass (libsass, 42 k), commonmark
(cmark-gfm, 29 k), plus utf8 (utf8lite), yaml (libyaml), jsonlite (yajl), timechange (cctz), fs
(libuv). Their upstream supply chains are entirely out of this audit's scope. See
`native-code-inventory.md`.

### L2. ~30 MB of `inst/` web assets were not reviewed
bslib, jquerylib, reactable, reactR, htmlwidgets, fontawesome, gt, rmarkdown and V8 ship large
bundled JS/CSS. These were excluded from the scan by design (`notes.md`, decision 2) because
R-language patterns produce only noise against them. They execute in a browser when a gt table,
reactable or R Markdown document is rendered — not in the R process — but they are unaudited
third-party code shipping inside these tarballs.

### L3. `[AMENDED 2026-07-26]` Install provenance — RESOLVED, and the autobrew binaries are unverified

<details open>
<summary><b>As originally escalated (WS-C baseline)</b></summary>

> ### L3. Install provenance is unresolved
> Every Tier-1 severity call depends on it. WS-C worked from staged CRAN *source* tarballs, which is
> the right input for reading code but says nothing about how the *installed* library was built.

*This was correct as written. It was a genuine limitation of WS-C's inputs, and it is the thing the
coordinator's log evidence subsequently closed.*

</details>

#### Post-review determination (2026-07-26, after install-provenance evidence)

Provenance is settled: **91 source installs, 0 binary** across both install logs (see E1). What
remains unresolved is narrower and sharper — the four prebuilt binary bottles, chosen by an
unpinned selector script, that autobrew fetched and linked into `fs.so`, `curl.so`, `V8.so` and `xml2.so` have **not been verified by any
work package**. WS-B covers R source tarballs against CRAN; it does not cover these.
