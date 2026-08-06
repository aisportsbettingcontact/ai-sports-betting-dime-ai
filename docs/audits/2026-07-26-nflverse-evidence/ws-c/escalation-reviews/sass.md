# Escalation review — sass 0.4.10

**Escalation:** E13 (network fetches in UI packages — Google Fonts)
**Verdict:** **BENIGN**
**Executes when:** call time, only via `font_google(local = TRUE)` / thematic font resolution
**Ran on this machine:** **NO** — no font cache exists

## Files read

`sources/sass/R/fonts.R:500-540`, `sources/sass/src/libsass/Makefile:285-295`,
`sources/sass/configure`-equivalent build files.

## What executes, when, under whose control

```r
fonts.R:511   if (is_installed("curl")) {
fonts.R:512     if (!curl::has_internet()) { warning("Looks like you don't have internet access, ...") }
fonts.R:521     handle <- curl::handle_setheaders(curl::new_handle(), .list = headers)
fonts.R:522     return(curl::curl_download(url, dest, handle = handle, quiet = quiet, ...))
fonts.R:525   if (capabilities("libcurl")) {
fonts.R:526     return(download.file(url, dest, method = "libcurl", headers = headers, quiet = quiet, ...))
fonts.R:529   stop("Downloading Google Font files requires either the curl package or `capabilities('libcurl')`. ")
```

This is a font downloader for `font_google(..., local = TRUE)`: it fetches woff2/ttf files from
Google's font CDN so they can be embedded locally rather than referenced by URL. The `url` is built
from the font name the caller asked for. The downloaded bytes are font files written to a cache
directory — they are not parsed by R, not deserialised, and not executed; they end up embedded in
generated CSS. Requires an explicit call.

It also fails *loudly and safely*: `fonts.R:512-518` warns rather than hanging when offline, and
`:529` errors if no HTTP transport exists.

**`src/libsass/Makefile:290, 293` — `git clone` of sass-spec.** Re-checked: these are upstream
libsass developer targets (`test`/`test_build` rules for running the spec suite). `R CMD INSTALL`
invokes `src/Makevars`, not this Makefile's test targets. The install log for sass
(`bznitqj7o.output:1490+`) shows only compilation; there is no `git` invocation and no
`configure` network activity. Correctly classified `note`, not finding, by WS-C.

`.onLoad` registers a `knitr::knit_print` method; `.onUnload` is `library.dynam.unload()`
(`hooks-inventory.md`).

## Provenance on this machine

| Check | Result |
|---|---|
| `installed-manifest.csv` | `"sass","0.4.10","MIT + file LICENSE","yes","R 4.6.1; aarch64-apple-darwin25.4.0; …","2026-07-26T21:23:42"` |
| install log `bznitqj7o.output:50, 1490` | `trying URL '.../sass_0.4.10.tar.gz'`; `begin installing package 'sass'` — no network during build |
| Font cache | no sass/bslib font cache directories exist on the host |
| Native code | 2,067 C + 39,629 C++ — **bundled libsass**, unreviewed (see `STRUCTURAL-LIMITATIONS.md` §L1) |
| Why present | `bslib` dependency → `gt` |

## Verdict and rationale

**BENIGN.** The escalated network call is an opt-in font download that writes font files to a cache
for embedding; there is no deserialisation, no execution, and no automatic trigger. The `git clone`
rows are upstream test-harness targets that `R CMD INSTALL` never reaches, confirmed by the install
log. The genuine residual concern for sass is not E13 at all — it is the 42k lines of bundled
libsass in `src/`, which this audit did not read and which parses SCSS input; that is recorded as a
structural limitation rather than a package finding.

## Defender action

1. None for the font path. If a fully offline posture is required, avoid `font_google(local = TRUE)`
   and use `font_face()`/local font files instead.
2. Carry sass's bundled libsass forward in the §L1 native-code limitation, not as a sass-specific
   action.
