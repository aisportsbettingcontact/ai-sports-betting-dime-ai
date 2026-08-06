# nflverse 1.0.3 — line-level review

**Files read: 8 of 8.** `ls sources/nflverse/R | wc -l` = **8**. All R/ files read end to end
(359 lines total). No `src/`, no `useDynLib`, no `data/`, no `inst/`, no `tools/` — verified, not
assumed. It is a metapackage.

Files: `attach.R`, `conflicts.R`, `core.R`, `nflverse-package.R`, `pipe.R`,
`updates_and_reports.R`, `utils.R`, `zzz.R`.

## Load hooks

`.onAttach` (`R/zzz.R:1-16`) is the only hook. It computes which of the five core packages
(`core.R:1-7`: nflfastR, nflseedR, nfl4th, nflreadr, nflplotR) are not yet attached, calls
`crayon::num_colors(TRUE)`, then `nflverse_attach()`.

`nflverse_attach()` (`attach.R:16-52`) builds a banner and calls `same_library()` on each package.
`same_library()` (`attach.R:8-14`) resolves the already-loaded namespace's library path with
`getNamespaceInfo(pkg, "path")` and calls `do.call("library", list(pkg, lib.loc = loc, ...))`.
This is a dynamic call, but the function name is the constant `"library"` and `pkg` comes from the
hard-coded `core` vector — no injection surface. The `lib.loc` pinning is a deliberate correctness
fix (tidyverse#171), and it is a mild *positive* for supply-chain hygiene: it prevents attaching a
same-named package from a different library path than the one already loaded.

**Attaching nflverse transitively runs the `.onLoad`/`.onAttach` of all five core packages**,
including `nfl4th`'s network-touching hook. See `nfl4th.md`.

## Network call sites

One, indirect: `nflverse_update()` (`updates_and_reports.R:55-123`) calls
`utils::available.packages(repos = repos)`, which contacts whatever is in `getOption("repos")`.
With `devel = TRUE` it prepends `https://nflverse.r-universe.dev/` (line 60). User-invoked, https,
and it is a metadata read only.

## Filesystem writes

None. Zero calls to `writeLines`, `saveRDS`, `file.create/copy/rename`, `dir.create`, `unlink`.

## eval / parse / NSE

None. No `eval(parse(`, no `source()`, no `readRDS`/`load`/`unserialize`. The only dynamic
construct is the `do.call("library", ...)` above.

## `install.packages`

`updates_and_reports.R:116` builds the string `"install.packages(c(...))"` and
`cli::cli_code()`s it for the user to copy-paste (`:118-120`). **It does not execute it.** This is
the correct, conservative design and worth crediting explicitly — a package that auto-installed its
own updates would be a finding. Classified benign in `pattern-hits.csv`.

## Anything surprising

`conflicts.R` is 83 lines and **entirely commented out** — the whole `nflverse_conflicts()` /
`nflverse_conflict_message()` machinery is dead code, and the call sites in `zzz.R:9-12` are
commented out to match. Untidy, not a security issue.

## Scan rows

2 hits, both accounted for: `R/zzz.R:1` `ns_hook` (note), `R/updates_and_reports.R:116`
`pkg_install` (benign, string only).

**Verdict: clean.** No network at load, no filesystem writes, no deserialisation, no dynamic
evaluation. nflverse's entire risk is inherited from the five packages it attaches.
