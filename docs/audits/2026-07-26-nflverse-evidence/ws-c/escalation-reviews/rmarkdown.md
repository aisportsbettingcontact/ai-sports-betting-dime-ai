# Escalation review — rmarkdown 2.31

**Escalation:** E8 (document rendering executes code — 38 note rows)
**Verdict:** **ACCEPTED-RISK — Low**
**Executes when:** call time, on `render()` / `run()` — and, for the sharpest paths, only for
**Shiny** documents
**Ran on this machine:** **NO** — no rendering has occurred

## Files read

`sources/rmarkdown/R/render.R:450-470`, `sources/rmarkdown/R/shiny.R:160-175`,
`sources/rmarkdown/R/shiny_prerendered.R:60-90, 740-755`,
`sources/rmarkdown/R/pandoc.R:95-115, 150-165, 680-700, 760-775`,
`sources/rmarkdown/R/util.R:300-315, 490-500`.

## What executes, when, under whose control

**Implicit `source()` of files adjacent to the document** — the item worth flagging, because it is
the one a user would not predict:

```r
render.R:458    global_r <- file.path.ci(".", "global.R")
render.R:459-460  if (file.exists(global_r)) { source(global_r, local = envir) }
```
and in the prerendered-Shiny path:
```r
shiny_prerendered.R:68   global_r <- file.path.ci(dirname(input_rmd), "global.R")
shiny_prerendered.R:69-70  if (file.exists(global_r)) { source(global_r, local = FALSE) }
shiny_prerendered.R:78     server <- source(server_r, local = server_r_env)$value
shiny_prerendered.R:749    load(rdata_file, envir = server_envir)
```

Three things follow. First, `render.R:458` resolves `global.R` against the **current working
directory** (`"."`), not the document's directory — so rendering a Shiny document while `setwd()`'d
into a directory containing a `global.R` sources that file. Second, `shiny_prerendered.R:70` uses
`local = FALSE`, i.e. the global environment. Third, `shiny_prerendered.R:749` `load()`s `.RData`
chunk-cache files into the server environment — deserialisation of on-disk state.

All three are gated on the document being a **Shiny** document (`render.R:454` requires the shiny
package; `shiny_prerendered.R` runs only for `runtime: shiny_prerendered`). A plain
`render("report.Rmd")` does not reach them. That gate is what keeps this at Low.

`shiny_prerendered.R:73-77` `eval(xfun::parse_only(server_extras), envir = server_r_env)` evaluates
server extras extracted from the document itself — the document is already executable content.

**Pandoc invocation** (`pandoc.R:104, 156, 690, 766`; `util.R:307, 495, 497`) — `system()`/`shell()`
calls to run the `pandoc` binary and query its version. Arguments are assembled from the document's
YAML and rmarkdown's own format definitions. This is ordinary external-tool invocation, and pandoc
must run for the package to do anything.

Nothing fires at load: `.onLoad` registers `knitr::knit_print` methods only (`hooks-inventory.md`).

## Provenance on this machine

| Check | Result |
|---|---|
| `installed-manifest.csv` | `"rmarkdown","2.31","GPL-3","no","R 4.6.1; ; 2026-07-27 04:24:33 UTC; unix","2026-07-26T21:24:33"` — pure R |
| install log `bznitqj7o.output:15` | `trying URL '.../rmarkdown_2.31.tar.gz'`; no `configure` |
| Shiny | **not installed** — `shiny` is absent from the 90-package manifest, so `render.R:454`'s `stop("The shiny package is required for shiny documents")` fires before any of the Shiny paths can be reached |
| Rendering evidence | no rendered output, no `*_files/` directories, no prerendered `.RData` caches |
| Why present | `Suggests` of nflseedR/nfl4th; dependency of `gt` |

The absence of `shiny` from this installation is a meaningful, checkable control: the three
`source()`/`load()` paths above are **unreachable on this host as configured**.

## Verdict and rationale

**ACCEPTED-RISK — Low.** Rendering a document executes its code; that is the contract. What the
line-level read adds is that rmarkdown's most surprising behaviours — implicitly sourcing
`./global.R`, sourcing `server.R` into a global-parented environment, and `load()`ing cached
`.RData` — are confined to the Shiny runtimes, and `shiny` is not installed here. The
working-directory resolution at `render.R:458` is the detail a defender should carry forward: it
means "render this document" can execute a file the document does not reference and the user did not
name. Not a defect to report upstream (it is documented Shiny-app behaviour), but it belongs in the
same mental category as `future`'s `.future.R` (E2) — *a file dropped in a directory becomes code*.

## Defender action

1. Treat `.Rmd` files as executables (see `knitr.md`). Additionally, before rendering an unfamiliar
   document, check its directory **and your working directory** for `global.R`, `server.R`, and
   `.RData` chunk caches.
2. Prefer `rmarkdown::render(input, knit_root_dir = <explicit path>)` so the `"."` in
   `render.R:458` is not wherever the session happens to be.
3. Do not install `shiny` unless it is needed — its absence currently makes the sharpest paths
   unreachable, and that is worth preserving as a deliberate control.
4. Render untrusted documents in a container or throwaway account.
