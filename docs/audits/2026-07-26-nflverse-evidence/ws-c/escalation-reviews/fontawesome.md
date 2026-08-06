# Escalation review — fontawesome 0.5.3

**Escalation:** E13 (network fetches in UI packages)
**Verdict:** **BENIGN**
**Executes when:** n/a — no network call exists in this package
**Ran on this machine:** **NO**

## Files read

The complete non-benign row set from `pattern-hits.csv` for this package — **three rows**, all
inspected in context: `sources/fontawesome/R/fa_png.R:60-66`,
`sources/fontawesome/R/knit_print.R:43-49`, `sources/fontawesome/R/zzz.R`.

## What executes, when, under whose control

| Row | Classification in CSV | Reality |
|---|---|---|
| `R/fa_png.R:63` | `pkg_install` / benign | the **message string** `" * It can be installed with \`install.packages(\"rsvg\")\`."` — advice text printed when the optional `rsvg` package is missing. Not a call. |
| `R/knit_print.R:46` | `pkg_install` / benign | the same message string, in the knit-print path |
| `R/zzz.R:3` | `ns_hook` / note | `.onLoad <- function(...)`; `hooks-inventory.md` places it in the "Benign — one line each" group: it registers S3 methods only |

That is the entire escalated surface. fontawesome ships SVG/webfont assets and renders icon markup;
it makes **no `download.file()`, no `curl::` call, no `system()` call, and no deserialisation** on
any code path. Its inclusion in E13 was as a member of a named group ("rstudioapi, bslib, sass, gt,
fontawesome — network fetches in UI packages"), and for this member the group label does not hold.

The package's icons are served from files inside `inst/` — a browser loading generated HTML reads
them from the rendered document's dependency directory, not from a CDN.

## Provenance on this machine

| Check | Result |
|---|---|
| `installed-manifest.csv` | `"fontawesome","0.5.3","MIT + file LICENSE","no","R 4.6.1; ; 2026-07-27 04:23:37 UTC; unix","2026-07-26T21:23:37"` — pure R |
| install log `bznitqj7o.output:9` | `trying URL '.../fontawesome_0.5.3.tar.gz'`; source install, no `configure` |
| Native code | none |
| Why present | `gt` dependency (icon rendering in tables) |
| `inst/` assets | bundled Font Awesome SVG/CSS — part of limitation §L2 |

## Verdict and rationale

**BENIGN — and the escalation is not sustained for this package.** Its three flagged rows are two
identical help-text strings and a method-registering `.onLoad`. There is no network access, no
execution surface, and nothing to accept as a risk. Recording this explicitly matters for the
audit's honesty: E13 grouped five packages under one heading, and reading them individually shows
the group is not homogeneous — `rstudioapi` and `sass` have real (if gated) network paths, `gt` has
author-initiated asset fetches, `bslib` has none outside example apps, and `fontawesome` has none at
all.

## Defender action

None. fontawesome's bundled icon assets are covered by the §L2 limitation statement; nothing else
applies.
