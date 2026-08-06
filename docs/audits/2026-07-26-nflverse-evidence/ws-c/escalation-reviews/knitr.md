# Escalation review — knitr 1.51

**Escalation:** E8 (document rendering executes code — 54 note rows)
**Verdict:** **ACCEPTED-RISK — Info**, with one **Low finding**: `R_KNITR_OPTIONS` is an
environment-variable code-injection point
**Executes when:** call time, on `knit()` / `render()` — i.e. only when a document is rendered
**Ran on this machine:** **NO** — no rendering has occurred

## Files read

`sources/knitr/R/engine.R:145-160, 210-270, 375-390, 715-740, 790-800`,
`sources/knitr/R/block.R:610-650`, `sources/knitr/R/defaults.R:218-235`,
`sources/knitr/R/themes.R:95-115`, `sources/knitr/R/hooks.R:10-20`,
`sources/knitr/R/output.R:140-155`.

## What executes, when, under whose control

**The headline is not a vulnerability, it is the product.** knitr's job is to execute the code in a
document. WS-C's instruction was to *bound* the exposure, and the bound is clean: every flagged site
sits downstream of an explicit `knit()`/`render()` call on a specific file. Nothing fires at load
(`.onLoad` does package-local initialisation only, `hooks-inventory.md` "Benign").

**Foreign-language engines** (`engine.R:150, 218, 259, 382, 720, 731, 798`) — `system2(cmd, ...)`
where `cmd` comes from `get_engine_path(options$engine.path, engine)` (`engine.R:146`) and the
argument is the chunk's own code:

```r
engine.R:146   cmd = get_engine_path(options$engine.path, engine)
engine.R:148   if (options$message) message('running: ', cmd, ' ', code)
engine.R:150   system2(cmd, code, stdout = TRUE, stderr = TRUE, env = options$engine.env)
```

Two useful properties: execution is gated on `options$eval` (`engine.R:147`), and `:148` **echoes
the command** when `message = TRUE`. `engine.R:259` `system('R CMD SHLIB')` + `dyn.load()` is the C
engine — compiling and loading a chunk's C code, again only when `eval` is true.

**`eval(parse_only(...))` sites** — `block.R:619` extracts and evaluates `read_chunk(...)` calls
found in a chunk; `block.R:646` evaluates `knit_child(...)` calls. Both operate on **text from the
document being knitted**, which is already executable content by definition. `hooks.R:14` and
`themes.R:106` (`eval(parse(text = y))`) parse a theme file's own settings after heavy sanitisation
(`themes.R:100-103` strips `;`, rewrites `true`→`TRUE`) into a fresh `new.env()`.

**The one item that is not "documents execute code":**

```r
defaults.R:219  adjust_opts_knit = function() {
defaults.R:222    if (nzchar(opts <- Sys.getenv('R_KNITR_OPTIONS')))
defaults.R:223      eval(parse_only(sprintf('base::options(%s)', opts)), envir = globalenv())
```

Called from `output.R:148`, i.e. on every `knit()`. The env-var content is interpolated into a
string and parsed, so it is **not** confined to being options: a value like
`a=1); system("id"); base::options(b=2` closes the call and injects statements, evaluated in
`globalenv()`. The comment at `defaults.R:220-221` labels it `begin_hack` — the author knows it is
one. This is a genuine finding rather than an accepted capability, but the severity is Low because
an attacker who can set your environment variables can already run code more directly.

## Provenance on this machine

| Check | Result |
|---|---|
| `installed-manifest.csv` | `"knitr","1.51","GPL","no","R 4.6.1; ; 2026-07-27 04:23:31 UTC; unix","2026-07-26T21:23:31"` — pure R |
| install log `bznitqj7o.output:14, 1288-1298` | `trying URL '.../knitr_1.51.tar.gz'`; `* installing *source* package 'knitr'` → `* DONE (knitr)`; no `configure` |
| `env \| grep R_KNITR_OPTIONS` | unset |
| `~/.Renviron`, `Renviron.site` | do not exist — nothing can pre-set it |
| Rendering evidence | no `.Rmd` output artefacts, no knitr cache dirs on the host |
| Why present | `Suggests` of nflseedR/nfl4th, dependency of `rmarkdown`/`gt` |

## Verdict and rationale

**ACCEPTED-RISK — Info** for the rendering surface: knitr executes the code in a document because
that is what it is for, execution is gated on `eval`, commands are echoed under `message = TRUE`,
and nothing runs at load time. The correct defensive framing is the one WS-C reached — **any `.Rmd`
in a repository is executable content, and should be treated exactly like a script, not like a
document.** Separately, **`R_KNITR_OPTIONS` (defaults.R:222-223) is a Low finding**: it is an
environment variable whose contents are string-interpolated into `parse()` and evaluated in the
global environment on every knit, which is a different and unnecessary class of risk from "the
document's own chunks run".

## Defender action

1. Treat `.Rmd`/`.qmd`/`.Rnw` files from untrusted sources as untrusted executables. Read chunks
   before rendering; render unknown documents in a container or throwaway user account.
2. Do not set `R_KNITR_OPTIONS`, and audit CI images for it — it is a code-injection vector, not an
   options string (`defaults.R:223`).
3. Use `opts_chunk$set(eval = FALSE)` when rendering a document purely to inspect its prose.
4. Keep `message = TRUE` for foreign-language engine chunks so `engine.R:148` logs the command that
   is about to run.
