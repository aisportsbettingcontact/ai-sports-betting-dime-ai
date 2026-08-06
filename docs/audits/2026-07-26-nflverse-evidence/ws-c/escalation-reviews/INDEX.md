# Task 7 — escalation review index

Line-level deep review of every package escalated by WS-C (`evidence/ws-c/escalations.md`:
14 escalations E1–E14 + 3 structural limitations L1–L3). **26 package review files + 1 structural
file. Every escalation is covered; every verdict cites file:line or log:line.**

## Verdict table

| Package | Escalation | Theme | Executes when | Ran here? | Verdict | Severity |
|---|---|---|---|---|---|---|
| [curl](curl.md) | E1 | `configure` fetches + dot-sources remote script; static libcurl linked in | install | **YES** | FINDING | **High** |
| [fs](fs.md) | E1 | same; static libuv linked in (vendored copy declined in favour of network) | install | **YES** | FINDING | **High** |
| [V8](V8.md) | E1, E7 | same (unconditional on darwin/arm64); 47.5 MB static JS engine linked in **+** `console.r` JS→R escape on by default | install / call | **YES** (E1) | FINDING | **High** (E1), Medium (E7) |
| [xml2](xml2.md) | E1 | same, **silently** — the fetched script prints nothing; static libxml2 linked in | install | **YES** | FINDING | **High** |
| [magick](magick.md) | E1, E10 | E1 branch **not taken** (Homebrew ImageMagick 7 via pkg-config); remote image bytes → system ImageMagick | install / call | **NO** (E1) | BENIGN (E1) / ACCEPTED-RISK (E10) | Medium |
| [future](future.md) | E2 | `.onAttach` sources `./.future.R` from the working directory into `globalenv()` | attach | **NO** | FINDING | Medium |
| [tinytex](tinytex.md) | E3 | downloads + runs a TeX Live installer; `osascript` sudo; auto `brew install ghostscript` | call | **NO** | ACCEPTED-RISK | Low |
| [parallelly](parallelly.md) | E4 | launches processes incl. over SSH | call | **NO** | ACCEPTED-RISK | Low |
| [Rcpp](Rcpp.md) | E5 | compiles + `dyn.load`s C++; `load()` of a cache index — **cache defaults to `tempdir()`** | call | **NO** | ACCEPTED-RISK | Low |
| [xfun](xfun.md) | E6 | shell-outs + uploads (all explicit dev functions); **persistent `R_user_dir` cache `readRDS`** | call | **NO** | ACCEPTED-RISK | Low |
| [juicyjuice](juicyjuice.md) | E7 | `ctx$source()` — confirmed bundled `system.file()` path, not a URL | call | **NO** | BENIGN | — |
| [reactR](reactR.md) | E7 | `ctx$source()` — confirmed bundled path | call | **NO** | BENIGN | — |
| [reactable](reactable.md) | E7 | `ctx$source()` — confirmed bundled path (`mustWork=TRUE`) | call | **NO** | BENIGN | — |
| [knitr](knitr.md) | E8 | rendering executes document code **+ `R_KNITR_OPTIONS` env→`eval` injection** | call | **NO** | ACCEPTED-RISK (Info) **+ FINDING** | Low |
| [rmarkdown](rmarkdown.md) | E8 | implicit `source("./global.R")`, `source(server.R)`, `load(.RData)` — **Shiny-only, shiny not installed** | call | **NO** | ACCEPTED-RISK | Low |
| [litedown](litedown.md) | E8 | `exec` engine runs chunk-named commands; cache `readRDS` | call | **NO** | ACCEPTED-RISK | Info |
| [evaluate](evaluate.md) | E8 | flagged rows are 4 roxygen comments, a class predicate, 2 env helpers | call | **NO** | BENIGN | — |
| [data.table](data.table.md) | E9 | `update_dev_pkg()` → HTTPS project repo, explicit call; base patching gated `R < 4.0.0` | call / load | **NO** | ACCEPTED-RISK | Low |
| [stringi](stringi.md) | E11 | icudt download — **proven not to have occurred**; shipped file, md5 verified | install | **NO** | BENIGN | — |
| [withr](withr.md) | E12 | patches `rlang::defer` at load — **exactly one binding, re-locked, option-guarded** | load | (hook is inert here) | BENIGN | — |
| [rstudioapi](rstudioapi.md) | E13 | theme `download.file`; `readRDS` of IPC response — **all require RStudio, not installed** | call | **NO** | BENIGN | — |
| [bslib](bslib.md) | E13 | network rows are all in `inst/examples-shiny/**` demo apps, never loaded | — | **NO** | BENIGN | — |
| [sass](sass.md) | E13 | Google Fonts download via opt-in `font_google(local=TRUE)`; `git clone` rows are upstream dev targets | call | **NO** | BENIGN | — |
| [gt](gt.md) | E13 | author-initiated image fetches; `google_font()` emits CSS, makes **no R request** | call | **NO** | BENIGN | — |
| [fontawesome](fontawesome.md) | E13 | **no network call exists** — 2 help-text strings + a method-registering `.onLoad` | — | **NO** | BENIGN | — |
| [memoise](memoise.md) | E14 | filesystem cache `readRDS` with no validation — makes remote-`readRDS` trust **persistent** | call | **NO** | FINDING | Low |
| [L1–L4](STRUCTURAL-LIMITATIONS.md) | L1 | ~892k lines C/C++ unread | — | — | LIMITATION | — |
| [L1–L4](STRUCTURAL-LIMITATIONS.md) | L2 | ~30 MB bundled JS/CSS unreviewed (3 bundles run **in the R process** via V8) | — | — | LIMITATION | — |
| [L1–L4](STRUCTURAL-LIMITATIONS.md) | L3 | install provenance — **RESOLVED by Task 7** | — | — | CLOSED | — |
| [L1–L4](STRUCTURAL-LIMITATIONS.md) | **L4 (new)** | unverified third-party binaries resident in `curl.so`/`fs.so`/`V8.so`/`xml2.so`; artefacts destroyed by `cleanup` | install | **YES** | LIMITATION + FINDING | High |

## Counts

- **26 packages reviewed**, covering all 14 escalations; 4 structural limitations documented
  (3 from WS-C + 1 new).
- **FINDING: 7** — curl (High), fs (High), V8 (High), xml2 (High), future (Medium), knitr (Low),
  memoise (Low). V8 carries a second Medium finding (E7) alongside its High.
- **ACCEPTED-RISK: 8** — magick (Medium), tinytex, parallelly, Rcpp, xfun, rmarkdown,
  data.table (all Low), litedown (Info).
- **BENIGN: 11** — juicyjuice, reactR, reactable, evaluate, stringi, withr, rstudioapi, bslib,
  sass, gt, fontawesome.
- Severity spread of findings: **High 4, Medium 2, Low 2** (V8 appears in both High and Medium).

## Escalations upheld vs downgraded

**Upheld and strengthened (5).** E1 for curl/fs/V8/xml2 — WS-C could not tell whether these fired;
they did, and the consequence is worse than "install-time RCE": unverified binaries are resident in
the installed library (§L4). E14 (memoise) upheld as the persistence layer for the closure's
remote-`readRDS` trust.

**Upheld with a narrowed trigger (2).** E2 (future) — real, but fires on `library(future)`/
`library(furrr)`, **not** on `library(nflverse)`; WS-C's reachability claim was too broad, corrected
by `Imports`-vs-`Depends` analysis and confirmed empirically. E8 (knitr) — the rendering surface is
the product, but `R_KNITR_OPTIONS` is a separate, genuine Low finding WS-C did not isolate.

**Downgraded on evidence (8).** E1 for **magick** (branch not taken, twice — and one of its two
network branches is Linux-only dead code here). E5 (Rcpp) — the escalated `load()` target defaults
to session-private `tempdir()`, not a persistent user directory. E6 (xfun) — the 112 rows are a
developer toolkit unreachable from rendering; only the persistent cache survives review. E9
(data.table) — HTTPS project repo, explicit call, base patching hard-gated on `R < 4.0.0`. E11
(stringi) — proven benign by three independent lines of evidence. E12 (withr) — one binding,
re-locked. E13 — the five-package group is not homogeneous: rstudioapi is unreachable without
RStudio, bslib's rows are demo apps, fontawesome has no network call at all.

## Method notes

- Every implicated file was read at the cited lines with surrounding context; no verdict rests on a
  grep snippet.
- Provenance was established from the two install logs
  (`tasks/bznitqj7o.output`, `tasks/bvdz7ibhe.output`), `evidence/installed-manifest.csv`, and
  `otool -L` / `md5` against the **installed** artefacts in
  `/opt/homebrew/lib/R/4.6/site-library` — never assumed from "built from source".
- Four autobrew scripts were fetched over the network **for reading only** and never executed;
  URLs, sha256 hashes and the local read-only copies are recorded in `curl.md`, `fs.md`, `V8.md`
  and `xml2.md`.
- `$ROOT/sources/` was not written to.
