# Escalation review — evaluate 1.0.5

**Escalation:** E8 (document rendering executes code)
**Verdict:** **BENIGN**
**Executes when:** call time, whenever knitr evaluates a chunk
**Ran on this machine:** **NO** — no rendering has occurred

## Files read

Full non-benign row set from `pattern-hits.csv` (9 rows for this package, all inspected in context):
`sources/evaluate/R/evaluation.R:55-70`, `sources/evaluate/R/inject-funs.R:1-30`,
`sources/evaluate/R/reproducible-output.R:100-115`, `sources/evaluate/R/utils.R:15-25`,
`sources/evaluate/R/zzz.R`.

## What executes, when, under whose control

`evaluate` is the engine knitr calls to run a chunk and capture its output. E8 named it alongside
knitr/rmarkdown/litedown, but its own pattern rows are thin — and every one resolves to something
inert:

| Row | Reality |
|---|---|
| `evaluation.R:61` `} else if (is.source(x)) {` | a class predicate; the token `source` matched the scanner's `source_call` regex. Not a call. |
| `inject-funs.R:15, 17, 19, 22` `system(...)` | **roxygen comment lines** (`#'`) documenting the `inject_funs()` example, which demonstrates *replacing* `system()` with a safer stub. Documentation, not code — and the example's intent is defensive. |
| `reproducible-output.R:105` `Sys.getenv(names(envs), names = TRUE, unset = NA)` | saves current env vars so they can be restored |
| `reproducible-output.R:109` `do.call("Sys.setenv", as.list(envs[set]))` | sets a **fixed** set of reproducibility variables and restores them afterwards |
| `utils.R:20` `isTRUE(as.logical(Sys.getenv(x, "false")))` | a boolean env-var helper |
| `zzz.R:6` `.onLoad <- function(...)` | package-local initialisation only (`hooks-inventory.md`, "Benign") |

There is no `system()` call, no `eval(parse(text=))` on external input, no network access and no
deserialisation in this package. The arbitrary-code execution attributed to E8 lives in
`knitr`/`rmarkdown`/`litedown`, which *call* evaluate with code they have already extracted from a
document. evaluate's own contribution is to run a supplied expression and capture the output —
which is its entire, single-purpose API.

## Provenance on this machine

| Check | Result |
|---|---|
| `installed-manifest.csv` | `"evaluate","1.0.5","MIT + file LICENSE","no","R 4.6.1; ; 2026-07-27 04:22:49 UTC; unix","2026-07-26T21:22:49"` — pure R |
| install log `bznitqj7o.output:6` | `trying URL '.../evaluate_1.0.5.tar.gz'`; source install, no `configure` |
| Native code | none (not in the 38-package `src/` inventory) |
| Rendering evidence | none on the host |

## Verdict and rationale

**BENIGN.** Read line by line, evaluate's escalated rows are four roxygen comments, a class
predicate, two env-var helpers and a benign `.onLoad`. It contributes no execution surface of its
own beyond "evaluate the expression you were handed", and it is the *callee* in E8, not the
originator. This is the one member of the E8 group that can be closed outright rather than accepted
as a risk. Worth noting that `inject-funs.R`'s documented example is a *mitigation* pattern —
substituting a constrained `system()` into the evaluation environment.

## Defender action

None. Controls for the E8 group belong at the knitr/rmarkdown/litedown layer (do not render
untrusted documents); nothing is gained by acting on evaluate.
