# Escalation review — data.table 1.18.4

**Escalation:** E9 (runtime package installation and base-namespace patching)
**Verdict:** **ACCEPTED-RISK — Low** (both escalated concerns resolve favourably)
**Executes when:** `update_dev_pkg()` at explicit call time; the base-patching branch at load time
**on R < 4.0.0 only**
**Ran on this machine:** **NO** for both — R is 4.6.1, and `update_dev_pkg()` has not been called

## Files read

`sources/data.table/R/devel.R:1-50`, `sources/data.table/R/onLoad.R:10-70`,
`sources/data.table/R/fread.R:85-100, 210-220`, `sources/data.table/R/utils.R:210-225`,
`sources/data.table/NAMESPACE`, `sources/data.table/configure`.

## What executes, when, under whose control

WS-C posed two specific questions. Both have clean answers.

### Q1 — "confirm the default `repo` for `update_dev_pkg()`"

```r
devel.R:20  update_dev_pkg = function(pkg="data.table", repo="https://Rdatatable.gitlab.io/data.table",
devel.R:20+                           field="Revision", type=getOption("pkgType"), lib=NULL, ...)
devel.R:13    idx = file(file.path(contrib.url(repo, type=type),"PACKAGES"))
devel.R:38    utils::install.packages(pkg, repos=repo, type=type, lib=lib, ...)
```

The default is **`https://Rdatatable.gitlab.io/data.table`** — HTTPS, and the project's own GitLab
Pages site, i.e. the same maintainers who publish the CRAN package. It is exported
(`NAMESPACE:147 export(update_dev_pkg)`), so a user can call it, but it does nothing unless called:
`devel.R:29-30` compares the remote `Revision` field against the installed one and only installs on
a difference. The `repo` argument is caller-overridable, which is the actual risk — a user who
passes an attacker-supplied repo gets `install.packages()` from it — but that is true of
`install.packages()` generally.

Two mild aggravators worth naming: the install happens inside `on.exit({...})` (`devel.R:34-45`),
so it runs even if the function body errors; and `devel.R:37` `unloadNamespace(pkg)` unloads the
package first. Neither changes the trust model.

### Q2 — "confirm the base-patching branch is genuinely unreachable on R 4.6"

```r
onLoad.R:35   if (session_r_version < "4.0.0") {
onLoad.R:37     tt = base::cbind.data.frame
onLoad.R:38     ss = body(tt)
              # ... unlockBinding("cbind.data.frame", baseenv()); assign into asNamespace("base"); re-lock
```

**Confirmed unreachable.** The guard is a literal version comparison at `onLoad.R:35`, and this host
runs R 4.6.1 (`installed-manifest.csv` `built_r` = `R 4.6.1`, install log throughout). The comment
at `onLoad.R:30-34` explains the history: R gained proper `c`/`rbind` S3 dispatch in R-devel around
Sep 2019 (#3948), and the workaround is retained only for pre-4.0 users. The code is dead on any
supported R.

### Remaining rows

- `utils.R:217` `system(cmd, intern=TRUE)` — CPU-count detection; constant command.
- `fread.R:93` `download.file(file, tmpFile, ...)` — fires when `fread()` is given a URL. That is
  the documented API (`fread("https://...")`); the bytes are then parsed by data.table's own C
  reader (25,816 lines, unreviewed — see `STRUCTURAL-LIMITATIONS.md` §L1). Reachable from nflverse
  code paths that `fread()` a remote CSV.
- `fread.R:215` `yaml::yaml.load(yaml_string)` — parses a YAML header block from a data file when
  `yaml=TRUE`. `yaml.load` is a data parser, not `yaml.load_file` with R evaluation; no code
  execution.
- `.onLoad` also does `readRDS(system.file("Meta","package.rds"))` (its own install metadata) and
  `.Call(CinitLastUpdated)`, and sets 18 `datatable.*` options.
- `configure` is a pkg-config + OpenMP feature probe that writes `src/Makevars` — **no network**
  (`hooks-inventory.md`; confirmed by re-reading).

## Provenance on this machine

| Check | Result |
|---|---|
| `installed-manifest.csv` | `"data.table","1.18.4","MPL-2.0 \| file LICENSE","yes","R 4.6.1; aarch64-apple-darwin25.4.0; …","2026-07-26T21:23:09"` |
| install log `bznitqj7o.output:59` | `trying URL '.../data.table_1.18.4.tar.gz'` |
| Install-time network | none — no `autobrew`/`.deps` strings in data.table's install section |
| R version | 4.6.1 → `onLoad.R:35` branch not taken |
| `update_dev_pkg()` | no evidence of use; the installed `DESCRIPTION` has no `Revision` field, which is what `dcf.lib()` (`devel.R:3-8`) would read |

## Verdict and rationale

**ACCEPTED-RISK — Low.** Both escalated items resolve in the package's favour on evidence: the
runtime-installation function defaults to the project's own HTTPS repository and requires an
explicit call, and the base-namespace patching is behind a hard `R < 4.0.0` guard that cannot be
satisfied here. What remains is ordinary: `fread()` will fetch a URL you give it, and its C parser
is part of the unreviewed native mass. Rating it Low rather than Info reflects that
`update_dev_pkg()` is exported, takes a caller-supplied `repo`, and installs from inside `on.exit`
— a combination that would be unpleasant if a user were ever talked into calling it with a hostile
repository.

## Defender action

1. Never call `update_dev_pkg()` with a non-default `repo`; there is no reason to, and it is a
   direct `install.packages()` from wherever you point it (`devel.R:38`).
2. Keep the released CRAN build. The dev-repo mechanism exists for contributors, not users.
3. Treat `fread(<url>)` as feeding remote bytes to an unreviewed C parser — the same posture
   recommended for `magick` (see `magick.md`) and covered by §L1.
