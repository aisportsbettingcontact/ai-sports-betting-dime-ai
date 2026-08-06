# Escalation review — bslib 0.11.0

**Escalation:** E13 (network fetches in UI packages)
**Verdict:** **BENIGN**
**Executes when:** never, in this closure's usage — the flagged network calls live in example apps
that are not loaded
**Ran on this machine:** **NO**

## Files read

Full non-benign row set from `pattern-hits.csv` for this package (20 rows), each inspected in
context: `sources/bslib/R/onLoad.R:1-13`, `sources/bslib/R/bs-dependencies.R:125-135, 175-185,
270-280`, `sources/bslib/R/staticimports.R:70-76`, `sources/bslib/inst/examples-shiny/**`.

## What executes, when, under whose control

The escalation named bslib collectively with four other "UI packages". Reading its actual rows,
bslib is the thinnest of the five:

| Row | Reality |
|---|---|
| `inst/examples-shiny/brand.yml/app.R:53, 57` `download.file(...)` | **example Shiny app source shipped under `inst/`.** Not loaded by the package, not on any code path; runs only if a user opens and runs the demo. `shiny` is not even installed here. |
| `inst/examples-shiny/*/deploy.R:2` `install.packages(...)` | deployment helper scripts inside the same examples |
| `R/bs-dependencies.R:131, 179, 276` `file.copy(...)` | copies precompiled CSS/JS from the installed package into an output dependency directory — local file copies, no network |
| `R/staticimports.R:73` | a **message string** `"Please upgrade via install.packages('%s')."` — text, not a call |
| `R/onLoad.R:1-13` | creates a `cachem::cache_mem()` and registers `setHook(packageEvent("shiny","onLoad"))`. In-memory cache; the hook is inert because shiny is absent |
| `R/bslib-package.R:16` | an `@importFrom utils ... download.file` roxygen line |
| `R/utils.R:64`, `R/shiny-devmode.R:23`, `R/staticimports.R:40`, `R/bs-theme-preview.R:705` | `Sys.getenv()` reads of `SHINY_SERVER_VERSION` / `TESTTHAT` |

**No network call exists on any loadable bslib code path.** The two `download.file()` hits are in
demo application source under `inst/`, which WS-C's scanner correctly included (it scans `inst/`
scripts) but which never executes as part of the package.

Where bslib *does* reach the network is indirectly, via `sass::font_google()` — reviewed in
`sass.md`, and likewise opt-in.

## Provenance on this machine

| Check | Result |
|---|---|
| `installed-manifest.csv` | `"bslib","0.11.0","MIT + file LICENSE","no","R 4.6.1; ; 2026-07-27 04:24:30 UTC; unix","2026-07-26T21:24:30"` — pure R |
| install log `bznitqj7o.output:8` | `trying URL '.../bslib_0.11.0.tar.gz'`; no `configure` |
| `shiny` installed? | **No** — absent from the 90-package manifest, so the `packageEvent("shiny","onLoad")` hook can never fire |
| Why present | `gt` → `bslib` (theming for HTML tables) |
| `inst/` assets | large bundled Bootstrap CSS/JS — part of limitation §L2 (browser-side, unreviewed) |

## Verdict and rationale

**BENIGN.** Every network-shaped row resolves to example-app source under `inst/`, a roxygen import
line, or a message string. The load hook builds an in-memory cache and registers a hook for a
package that is not installed. bslib's only real contribution to this audit is its share of the
~30 MB of unreviewed bundled web assets (§L2), which execute in a browser rather than in R.

## Defender action

1. None. Do not treat `inst/examples-shiny/**` as live code — it is documentation that happens to be
   executable, and the scanner rows for it are noise.
2. bslib's bundled Bootstrap assets are covered by the §L2 limitation statement.
