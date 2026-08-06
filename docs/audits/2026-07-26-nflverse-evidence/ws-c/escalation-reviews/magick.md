# Escalation review — magick 2.9.1

**Escalations:** E1 (install-time RCE — **not exercised**) and E10 (remote image bytes into
ImageMagick; env mutation)
**Verdict:** **BENIGN** for E1 (the autobrew branch demonstrably did not run here)
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;**ACCEPTED-RISK — Medium** for E10 (untrusted-parser exposure via nflplotR headshots)
**Executes when:** E1 at install; E10 at call time (`image_read(<url>)`)
**Ran on this machine:** E1 **NO** — pkg-config found Homebrew ImageMagick 7 on the successful run

## Files read

`sources/magick/configure`, `sources/magick/cleanup`, `sources/magick/R/utils.R:29-49`,
`sources/magick/R/init.R:17-50` (via `hooks-inventory.md`, re-verified), `sources/magick/src/base.cpp:12`.

## Part 1 — E1: the autobrew branch did not fire

`configure:31` (→ `get-im-linux.sh`) and `configure:51-52` (macOS without Homebrew → autobrew) are
the two network branches. **Neither ran, and one of them is unreachable on this platform at all:**
`configure:31` is guarded on `uname -sm` being `Linux x86_64`, so on darwin/arm64 it is dead code,
not a live row. Only `configure:51-52` was ever a candidate here, and it was not taken.

This is the correction that matters for reading WS-C's E1: the escalation lists five packages
unconditionally, but each row is a *conditional fallback*, and "the package was built from source"
does not imply "the fetch fired". Every branch guard has to be evaluated against this platform and
this host's actual state. For magick the answer is no, twice over.

**magick was installed twice, and both attempts are in the logs.**

*Run 1 — FAILED* (`bznitqj7o.output:3085-3110`):
```
3085  * installing *source* package 'magick' ...
3089  Homebrew 6.0.12
3090  Using PKG_CFLAGS=-I/opt/homebrew/opt/imagemagick@6/include/ImageMagick-6 ...
3092  --------------------------- [ANTICONF] ---------------------------
3096  <stdin>:1:10: fatal error: 'Magick++.h' file not found
3109  ERROR: configuration failed for package 'magick'
3112  installation of 4 packages failed: 'magick', 'ggpath', 'nflplotR', 'nflverse'
```
Homebrew **was** detected (`Homebrew 6.0.12`), so `configure:51-52` was skipped; configure took the
`brew --prefix`/`imagemagick@6` branch, whose headers were absent, and aborted. No network fetch.

*Run 2 — SUCCEEDED* (`bvdz7ibhe.output:7-48`):
```
 8  * installing *source* package 'magick' ...
12  Found pkg-config cflags and libs!
13  Using PKG_CFLAGS=-I/opt/homebrew/Cellar/imagemagick/7.1.2-27/include/ImageMagick-7 ...
14  Using PKG_LIBS=-L/opt/homebrew/Cellar/imagemagick/7.1.2-27/lib -lMagick++-7.Q16HDRI ...
48  * DONE (magick)
```
Between the runs, ImageMagick 7.1.2-27 was installed via Homebrew; pkg-config then answered and
the install completed with **no download**.

Confirmed in the binary — `otool -L .../site-library/magick/libs/magick.so`:
```
/opt/homebrew/opt/imagemagick/lib/libMagick++-7.Q16HDRI.5.dylib
/opt/homebrew/opt/imagemagick/lib/libMagickWand-7.Q16HDRI.10.dylib
/opt/homebrew/opt/imagemagick/lib/libMagickCore-7.Q16HDRI.10.dylib
```
Dynamic links to Homebrew, not a static `.deps` archive. `install_mtime` `2026-07-26T21:28:04`
matches run 2, not run 1.

**E1 verdict for magick: BENIGN — not exercised.** The code path exists and would fire on a macOS
host without Homebrew; that residual risk is identical to curl/fs/V8/xml2 and is covered by the
same defender actions.

## Part 2 — E10: remote bytes into ImageMagick, plus environment mutation

**Network → parser.** `R/utils.R:31-48` `download_url(url)`:
- `:34-35` `curl::new_handle()` / `curl::curl_download(url, tmp, handle = h)`
- `:36-42` sniffs `content-type` and renames the temp file so ImageMagick guesses the format
- `:45` `utils::download.file(url, tmp, quiet = TRUE)` fallback

The bytes then go into Magick++ — 4,660 lines of C++ bindings (`native-code-inventory.md`) over a
system ImageMagick, which this audit did not read and which has a long CVE history in its decoders.

**Reachability is real, not theoretical.** `nflplotR`'s `reader_function()` is memoised at load
(`zzz.R:2-63`) and calls `magick::image_read()` on remote URLs; `nflplotR/R/sysdata.rda` carries
`logo_urls`/`wordmark_urls` pointing at `a.espncdn.com` and `github.com` (WS-C `notes.md`, binary
payload table). Rendering a plot with team logos or player headshots therefore feeds
third-party-hosted image bytes to a C++ image parser in-process.

**Environment mutation** (all confirmed, all session-persistent):
- `R/init.R` `.onLoad` — `Sys.setenv(MAGICK_TMPDIR = tempdir())` and `set_magick_tempdir(tempdir())`
- `.onLoad` — `Sys.setenv(FONTCONFIG_PATH = ...)` when the build was autobrewed (not the case here)
- `.onLoad` builds the default viewer with `body(fun) <- parse(text = 'magick:::image_preview(x)')`
  — a **constant string**, no user input reaches `parse()`; benign
- `src/base.cpp:12` — `setenv("KMP_DUPLICATE_LIB_OK","1",1)` at init: suppresses the OpenMP
  duplicate-runtime abort process-wide. A stability workaround, but it silences a real
  memory-corruption warning for the whole R process, not just magick.

## Verdict and rationale

**ACCEPTED-RISK — Medium.** Headshot/logo rendering *should* be treated as an untrusted parser
path: remote bytes, chosen by remote metadata, into unreviewed C++ over a historically
vulnerability-prone native library. It is accepted rather than a finding because it is the
package's entire purpose, the transport is HTTPS to reputable hosts, and — unlike the E1 group —
this build links **dynamically**, so `brew upgrade imagemagick` patches the parser without
rebuilding any R package. That single property is the strongest mitigation available anywhere in
this audit, and it is a direct consequence of run 2 taking the pkg-config path.

## Defender action

1. Keep `brew upgrade imagemagick` current — it patches `magick` transitively. Confirm with
   `otool -L magick.so` that the dynamic-link property still holds after any reinstall.
2. Prefer the logos already bundled in `nflplotR/R/sysdata.rda` (39 logo + 32 wordmark PNG blobs,
   all verified to start with the PNG magic bytes) over network fetches; reserve remote
   `image_read()` for headshots that genuinely are not bundled.
3. If untrusted or user-supplied image URLs are ever rendered, do it in a separate short-lived
   process, not in the analysis session.
4. Do not rely on `MAGICK_TMPDIR`/`FONTCONFIG_PATH` being unset by anything else in the session —
   `magick` claims them at load.
5. Treat `KMP_DUPLICATE_LIB_OK=1` as a known, accepted deviation and note it in any OpenMP-related
   incident triage.
