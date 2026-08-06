# Task 1 (WS-A) — Inventory & dependency forensics — evidence notes

Run date: 2026-07-27 (~05:2x-05:4x UTC), macOS/darwin, R 4.6.1 (`Rscript --vanilla` only, per
constraints), curl via `/usr/bin/curl` (shelled out from R with `system2()`, matching the brief's
"via curl" wording for Step 3).

LIB under audit: `/opt/homebrew/lib/R/4.6/site-library` (READ-ONLY; 90 package dirs, matches
`installed-manifest.csv` from Task 0 exactly — `setequal()` check passes).
Base/recommended R library (for classifying non-site-library edge targets, not one of the two
network hosts, purely a local `dir()` listing): `/opt/homebrew/lib/R/library` (30 packages; the
brief's stated path `/opt/homebrew/lib/R/4.6/library` does not exist on this host — `.libPaths()`
resolves the real base-library path to `/opt/homebrew/Cellar/r/4.6.1/lib/R/library`, which
`/opt/homebrew/lib/R/library` symlinks to. Used only as read-only classification context, never
written to, never counted as part of the 90 under audit.)

Scripts (evidence, kept under `$ROOT/evidence/ws-a/scripts/`, the only place written to besides
this notes.md/the 3 CSV/txt deliverables and the final report file):
`01-build-edges.R`, `02-reachability.R`, `03-currency.R`, `04-acceptance.R`, plus a `.log` per
script capturing stdout at run time.

## Step 1 — dep-edges.csv

Command: `Rscript --vanilla 01-build-edges.R`, iterating all 90 `$LIB/<pkg>/DESCRIPTION` files,
parsing `Depends/Imports/LinkingTo/Suggests` via `tools:::.split_dependencies` (the manual-regex
fallback path was never invoked — `.split_dependencies` succeeded on every field), stripping
version qualifiers (handled by `.split_dependencies` itself, which returns bare `name`/`op`/
`version` components), excluding `"R"` as a dependency target, and writing `from,to,type` (one row
per edge, unquoted CSV — package/version/type tokens never contain commas so `quote=FALSE` is safe
and matches the header contract literally).

**Counts:**
- Total edges: **1054**
- By type: Depends **4**, Imports **355**, LinkingTo **6**, Suggests **689**
- Distinct `from` packages: **87** of 90 (see anomaly below)
- Distinct `to` targets: **256**
  - of which **89** are one of the 90 site-library packages
  - of which **18** are base/recommended R packages (`boot, codetools, graphics, grDevices, grid,
    lattice, MASS, Matrix, methods, mgcv, nlme, parallel, rpart, stats, survival, tcltk, tools,
    utils`) — kept as edge targets per instructions, not part of the 90
  - remaining **149** are external (not installed anywhere on this system, neither site-library nor
    base/recommended) — **all 149 are reached only via `Suggests` edges (0 via a hard edge)**,
    confirmed by filtering `dep-edges.csv` for `type != Suggests` and checking target membership.
    This means every declared **hard** dependency (Depends/Imports/LinkingTo) of every one of the
    90 packages resolves to something actually present on the system (one of the 90, or a
    base/recommended package) — the site-library has no missing hard deps. The 149 externals are
    ordinary CRAN test/vignette/optional tooling (`testthat, covr, arrow, DT, gh, piggyback,
    RSQLite, DBI, gsisdecoder, rsvg, vdiffr, webshot2, tictoc, colorspace, bench, blob, brio, ...`)
    that this site-library was never meant to carry at runtime.
- Data-quality checks (all pass): no duplicate `(from,to,type)` triples; no self-loops
  (`from==to`); no row with `to=="R"`; no malformed rows (field count != 3 anywhere); every `from`
  value is one of the 90 (no phantom sources).

**Anomaly — 3 of 90 packages contribute zero outgoing edges:** `base64enc`, `bitops`,
`RColorBrewer`. Investigated by reading their DESCRIPTIONs directly (not guessed): all three
declare **no** `Imports`/`LinkingTo`/`Suggests` field at all, and their only `Depends` is `R (>=
x.y.z)`, which is excluded per the brief. `base64enc` additionally declares `Enhances: png`, a
5th DESCRIPTION dependency field the brief does not ask WS-A to track (only
Depends/Imports/LinkingTo/Suggests), so it correctly produces zero rows. This is genuine —
these are minimal, dependency-free CRAN leaf packages — not a parser bug. (Cross-check: the
89-vs-90 asymmetry on the *incoming*-edge side, below, is a separate and unrelated fact about
`nflverse`.)

**Anomaly — only 89 of 90 ever appear as a `to` target (any type):** the missing one is
`nflverse` itself. Expected: `nflverse` is the top-level umbrella/meta-package (it Imports the
other 5 targets to provide "install/load everything in one step"); nothing in this 90-package
closure depends *on* it. Confirmed via `comm` against the full sorted `to` column.

**Plausibility (self-review):** 1054 edges across 90 DESCRIPTIONs is "hundreds, not tens" as
required — mean of ~11.7 declared-dependency rows per package (Depends+Imports+LinkingTo+Suggests
combined), consistent with a real-world CRAN package graph rooted at a data/analysis stack
(tidyverse-adjacent + nflverse + gt/plotting + build tooling).

## Step 2 — reachability.txt

Command: `Rscript --vanilla 02-reachability.R`. BFS from the 6 targets
(`nflverse, nflreadr, nflfastR, nflseedR, nfl4th, nflplotR`) over **hard edges only**
(`type %in% c("Depends","Imports","LinkingTo")`; Suggests excluded per brief). Orphans =
installed (90) − reachable-within-90.

**Counts:**
- Roots: **6** (all present, verified in `reachability.txt`'s `ROOTS` block)
- Reachable within site-library: **90 of 90**
- Orphans: **0**
- Reachable outside site-library (base/recommended, pulled in as real hard-dep targets): **11**
  (`codetools, graphics, grDevices, grid, Matrix, methods, mgcv, parallel, stats, tools, utils`)
- Reachable-but-unresolved (hard-dep target neither in site-library nor base/recommended): **0**
  — i.e. zero "dangling" hard dependencies anywhere in the reachable closure.

**Anomaly / key finding — 0 orphans.** This was surprising enough on first run to warrant
independent verification before accepting it (see Self-review below) — a 90-package install
with *zero* Suggests-only or leftover-tooling packages is not the typical outcome of
`install.packages()` dependency resolution. Investigated via the edge list rather than assumed:

- Every one of the 90 (except `nflverse`, the root umbrella package — see Step 1) has at least
  one incoming **hard** edge from some other package in the 90.
- The single largest contributor to the closure's breadth is **`nflplotR`'s hard `Imports: gt`**
  (confirmed: `nflplotR,gt,Imports` in dep-edges.csv). `gt` itself hard-`Imports` a further 19
  packages including `htmlwidgets` and `reactable`. `htmlwidgets` hard-`Imports` **`knitr` and
  `rmarkdown`** (not Suggests!); `rmarkdown` hard-`Imports` `tinytex`; `gt` also hard-`Imports`
  `markdown`, which hard-`Imports` `litedown`. So the entire "document-rendering toolchain"
  (`knitr, rmarkdown, tinytex, markdown, litedown`) that would normally look like orphaned
  vignette-building cruft is in fact a **real, transitively-required hard dependency** of
  `nflplotR` (used for styled `gt` tables of NFL stats), not Suggests-driven bloat. Evidence
  chain: `nflplotR --Imports--> gt --Imports--> {htmlwidgets, reactable, markdown, ...}`,
  `htmlwidgets --Imports--> {knitr, rmarkdown}`, `rmarkdown --Imports--> tinytex`,
  `markdown --Imports--> litedown`.
- Conclusion: this particular site-library was very likely installed with exactly
  `install.packages(c("nflverse","nflreadr","nflfastR","nflseedR","nfl4th","nflplotR"))` (default
  `dependencies=NA`, i.e. hard deps only) and that alone happens to pull all 90 — there is no
  separate Suggests-closure or manually-added tooling layer to explain.

**Self-review — independent cross-validation of the BFS:** re-ran reachability with a *different*
algorithm (repeated fixed-point set-union over the same hard-edge table, rather than a queue-based
BFS) directly at the R console — same result: 90/90 reachable, 0 orphans, 101 total reachable
nodes counting the 11 base/recommended targets. Also confirmed structurally that every non-root
package has ≥1 hard incoming edge from *somewhere* in the 90 (necessary-but-not-sufficient check,
consistent with full reachability in an acyclic package-dependency graph). Treated as verified,
not a bug.

## Step 3 — currency.csv

Command: `Rscript --vanilla 03-currency.R`. `available.packages(repos="https://cloud.r-project.org",
type="source")` fetched fresh at run time (**not** assumed from Task 0): returned **24,395** CRAN
packages. Joined against `installed-manifest.csv` (90 rows) by package name. For the 6 targets,
fetched `https://raw.githubusercontent.com/nflverse/<pkg>/HEAD/DESCRIPTION` via `curl` (through
`system2()`), with the brief's fallback sequence (`HEAD` → `main` → `master`) implemented and
ready, plus a full-sequence retry-once on total failure (evidence-first constraint).

**Counts:**
- Rows written: **90** (all of the 90, header `package,installed,cran_current,status,github_dev`)
- Status breakdown: **current 90, outdated 0, archived-or-missing 0**
- `github_dev`: non-empty for exactly the 6 targets, empty string for the other 84 — verified
  programmatically (`stopifnot` in the script, plus independent re-check in
  `04-acceptance.R`)
- All 6 targets resolved on **`HEAD`, first attempt, http 200** — the `main`/`master` fallback and
  the retry-once path were never exercised (recorded, not fabricated: see gaps below)

**github_dev vs CRAN for the 6 targets:**

| package | installed | cran_current | github_dev | dev ahead of CRAN? |
|---|---|---|---|---|
| nfl4th | 1.0.7 | 1.0.7 | 1.0.7 | no (identical) |
| nflfastR | 5.2.0 | 5.2.0 | 5.2.0.9012 | **yes** |
| nflplotR | 1.6.0 | 1.6.0 | 1.6.0 | no (identical) |
| nflreadr | 1.5.1 | 1.5.1 | 1.5.1 | no (identical) |
| nflseedR | 2.0.2 | 2.0.2 | 2.0.2.9000 | **yes** |
| nflverse | 1.0.3 | 1.0.3 | 1.0.3.9001 | **yes** |

3 of 6 targets (`nflfastR`, `nflseedR`, `nflverse`) have unreleased dev-branch commits ahead of
their CRAN release (`.90xx` version suffix, standard R devel-version convention); the other 3 are
identical to CRAN HEAD-for-HEAD. All 6 installed versions match CRAN exactly (all "current").

**Anomaly:** none in the status column — every one of the 90 is CRAN-current as of this run,
consistent with (but independently re-derived from, not assumed from) Task 0's same observation
made earlier the same day.

**Self-review — independent cross-validation of `available.packages()`:** re-fetched CRAN's raw
`src/contrib/PACKAGES` file directly with `curl` and grepped `Version:` for 6 spot-check packages
(`xgboost, ggplot2, dplyr, data.table, knitr, Rcpp`) — every value matched `currency.csv` exactly
(e.g. `xgboost 3.2.1.1`, `ggplot2 4.0.3`, `Rcpp 1.1.2`). Confirms `available.packages()` was not
serving a stale/cached result.

**Evidence gaps:** none. 0 entries in `03-currency-gaps.txt` (the script deletes that file if
empty rather than leaving a stale one); `available.packages()` succeeded on the first attempt for
all 90; all 6 GitHub fetches succeeded on `HEAD` on the first attempt.

## Step 4 — Acceptance check

Command: `Rscript --vanilla 04-acceptance.R` (independent of the three build scripts — re-reads
all three output files plus the manifest and re-derives every check from scratch).

| Check | Result |
|---|---|
| `installed-manifest.csv` / `$LIB` package sets identical (90) | PASS |
| `currency.csv` covers all 90, no duplicates | PASS |
| `currency.csv` header = `package,installed,cran_current,status,github_dev` | PASS |
| `currency.csv` status values ⊆ {current,outdated,archived-or-missing} | PASS |
| `currency.csv` `github_dev` non-empty only for the 6 targets | PASS |
| `dep-edges.csv` header = `from,to,type` | PASS |
| `dep-edges.csv` type values ⊆ {Depends,Imports,LinkingTo,Suggests} | PASS |
| `dep-edges.csv` never emits `to=="R"` | PASS |
| `dep-edges.csv` `from` set ⊆ the 90 (no phantom sources) | PASS |
| `dep-edges.csv` edge count plausible (200–5000) | PASS (1054) |
| `reachability.txt` has one `ROOTS` block containing all 6 targets | PASS |
| Every one of the 90 appears in `currency.csv` | PASS |
| The 6 targets appear in `reachability.txt` roots | PASS |

**Overall: ALL PASS.**

### Self-review note on the acceptance script itself

The first run of `04-acceptance.R` reported 2 failures. Both were investigated and found to be
**bugs in the check script, not in the deliverables**, before this report was written:

1. A check asserting "`dep-edges.csv` `from` set == all 90" failed because 3 packages
   (`base64enc`, `bitops`, `RColorBrewer`) legitimately have zero outgoing edges (see Step 1
   anomaly above, confirmed by reading their DESCRIPTIONs). The brief never requires every
   package to have outgoing edges — only that edges come from installed DESCRIPTIONs — so the
   check was over-strict. Fixed to assert subset-of instead, with the 3-package fact surfaced as
   an explicit info line rather than hidden.
2. A check for "all 6 targets appear in the first 10 lines of `reachability.txt`" failed on a
   hardcoded line-range slice (`reach_txt[1:10]`) that didn't reach `nfl4th`/`nflplotR`, which
   fall on lines 11–12 given the file's header-comment length. Fixed to locate the `ROOTS` block
   dynamically (from the `ROOTS` line to the next blank line) instead of assuming a fixed offset.

Re-ran after both fixes: all checks pass (see table above). Flagging this here per the
evidence-first / no-fabrication constraint — the deliverables themselves were correct throughout;
only the independent verifier needed correcting, and that correction is shown rather than silently
applied.

## Overall evidence gaps

**None.** No command failed and needed a retry; no data was fabricated or assumed. The one
path-discrepancy noted (base/recommended library not at the brief's literal
`/opt/homebrew/lib/R/4.6/library` path) was resolved by querying `.libPaths()` directly rather than
guessing, and only affects informational classification of edge targets outside the 90 — it does
not change any of the three required deliverables' required contents or contracts.
