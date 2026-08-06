# Escalation review — gt 1.3.0

**Escalation:** E13 (network fetches in UI packages)
**Verdict:** **BENIGN**
**Executes when:** call time, when a table references a remote image or a Google font
**Ran on this machine:** **NO** — no table has been rendered

## Files read

`sources/gt/R/format_data.R:8693-8703`, `sources/gt/R/utils_render_xml.R:3286-3300`,
`sources/gt/R/helpers.R:3375-3395`, `sources/gt/R/info_tables.R:1540-1555`.

## What executes, when, under whose control

**`format_data.R:8697-8701` — `download_file()`:**
```r
download_file <- function(uri) {
  filename <- tempfile(fileext = paste0("_", basename(uri)))
  utils::download.file(uri, destfile = filename, quiet = TRUE)
  filename
}
```
A helper for `fmt_image()`/`fmt_url()`-style formatting when a table cell references a remote image.
The `uri` comes from the table's own data or the author's format call. The bytes are written to
`tempfile()` and subsequently base64-embedded — not deserialised, not executed. Note `quiet = TRUE`:
the fetch is silent.

**`utils_render_xml.R:3290-3297` — `copy_to_media()`:**
```r
if (grepl("https?://", path)) {
  utils::download.file(url = path, destfile = file.path(media_dir, basename_clean(path)))
```
The Word/`.docx` output path, copying referenced images into the document's media directory. Same
shape: author-supplied path, file copy, no parsing in R.

**`helpers.R:3378-3386` — `google_font()`:** builds a CSS string
`@import url('https://fonts.googleapis.com/css2?family=<name>...')` and injects it into the
generated stylesheet. **This makes no request from R.** The fetch, if any, happens in the *browser*
that later renders the HTML. It is a privacy/telemetry consideration (viewers' browsers contact
Google), not an R-process execution surface.

**`info_tables.R:1548` — `readRDS(system_file(...))`:** reads gt's own bundled reference data from
the installed package directory. WS-C already noted this as "bundled, fine"; confirmed.

`.onLoad` registers S3/knitr methods only (`hooks-inventory.md`, "Benign").

## Provenance on this machine

| Check | Result |
|---|---|
| `installed-manifest.csv` | `"gt","1.3.0","MIT + file LICENSE","no","R 4.6.1; ; 2026-07-27 04:24:38 UTC; unix","2026-07-26T21:24:38"` — pure R |
| install log | ordinary CRAN source install, no `configure` |
| Rendering evidence | none — no gt output artefacts on the host |
| Why present | reachable from nflplotR's `gt_*` helpers; it is the reason `V8`, `juicyjuice`, `reactable`, `reactR`, `bslib` and `sass` are all in this closure |

## Verdict and rationale

**BENIGN.** All three network sites are author-initiated asset fetches that write files to disk for
embedding; none deserialises, parses in R, or executes. `google_font()` does not even make a
request from R — it emits CSS. The `readRDS` is of a bundled file. gt's real significance in this
audit is not its own behaviour but its **dependency pull**: it is the single edge that brings the
V8 JavaScript engine, three JS-bundle packages, and libsass into the closure. That belongs in the
synthesis as a scope-reduction observation, not as a gt finding.

## Defender action

1. None for gt itself.
2. Privacy note: tables built with `google_font()` cause every *viewer's* browser to contact
   `fonts.googleapis.com` (`helpers.R:3382`). If the output is distributed, prefer
   `sass::font_google(local = TRUE)`-style local embedding or a self-hosted font.
3. Scope reduction worth considering: if `gt` tables are not needed, dropping it removes V8,
   juicyjuice, reactable, reactR, bslib and sass from the installed set — which would eliminate one
   of the four E1 High findings (`V8`) outright.
