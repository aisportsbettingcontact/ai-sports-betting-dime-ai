# Escalation review — future 1.75.0

**Escalation:** E2 (`.onAttach` sources `./.future.R` from the working directory)
**Verdict:** **FINDING — Medium**
**Executes when:** `library(future)` / `require(future)` — **attach**, not load
**Ran on this machine:** **NO** — no `.future.R` exists anywhere it would be found, and no
override is configured

## Files read

`sources/future/R/zzz.R:85-171` in full (WS-C flagged this hook as exceeding its 200-line
brace-match window, so it was read directly, as WS-C also did).

## What executes, when, under whose control

```
zzz.R:97    .onAttach <- function(libname, pkgname) {
zzz.R:99      sourceFutureStartupScript()
zzz.R:105   sourceFutureStartupScript <- function(default = c(".future.R", "~/.future.R"), ...)
zzz.R:107     pathnames <- Sys.getenv("R_FUTURE_STARTUP_SCRIPT")
zzz.R:108-109   if (nchar(pathnames) == 0L) pathnames <- TRUE
zzz.R:124     pathnames <- getOption("future.startup.script", pathnames)
zzz.R:135     pathnames <- default            # TRUE resolves back to c(".future.R", "~/.future.R")
zzz.R:147     pathnames <- pathnames[file_test("-f", pathnames)]
zzz.R:155     pathname <- pathnames[1]
zzz.R:162     source(pathname, chdir = FALSE, echo = FALSE, local = FALSE)
zzz.R:163-167 }, error = function(ex) { ... warning(msg) })
```

Reading the whole function confirms the escalation and adds three details:

1. **Opt-out, not opt-in.** With `R_FUTURE_STARTUP_SCRIPT` unset and no
   `options(future.startup.script)`, `pathnames` becomes `TRUE` (`:109`) → `default` (`:135`).
   Disabling requires explicitly setting the env var or option to `FALSE` (`:118`, `:131-133`).
2. **`local = FALSE`** (`:162`) — the script is sourced into the **global environment**, so it can
   define or overwrite anything the user's session will later use.
3. **Failure is silent-ish.** `tryCatch` downgrades any error to a `warning()` (`:163-167`), so a
   script that errors *after* doing something interesting produces only a warning at attach time.

Ordering matters: `.future.R` in the **current working directory** is checked first (`:105`
default order, `:155` takes `pathnames[1]`). Any directory a user `setwd()`s into — a cloned
repository, an unpacked data bundle, a downloaded dataset — can plant it.

## Reachability — WS-C's claim corrected

WS-C wrote that this is "reachable from an ordinary nflverse session via `furrr`". **That
overstates it, and the correction is evidence-backed:**

- `sources/furrr/DESCRIPTION` — `Depends: future (>= 1.70.0), R (>= 4.1.0)`
- `sources/nflfastR/DESCRIPTION` — `Imports: ... furrr, future, ...`
- `sources/nflseedR/DESCRIPTION` — `Imports: ... furrr, future, ...`
- `sources/nfl4th/DESCRIPTION` — `Suggests: future, ...`

`Imports` causes `loadNamespace()`, which runs `.onLoad` but **not** `.onAttach`. So
`library(nflfastR)` does *not* source `.future.R`. The hook fires only when `future` is attached —
`library(future)`, `require(future)`, or attaching `furrr` (whose `Depends` pulls `future` onto the
search path).

That is not a dismissal: `library(future); plan(multisession)` is the standard, documented way to
turn on nflfastR/nflseedR parallelism, so a working analyst hits the attach path routinely. The
correction changes it from "every session" to "every parallel session".

This static reading was corroborated empirically by the audit coordinator with a marker-file test:
`library(nflfastR)` → marker **not** written; `library(furrr)` and `library(future)` → marker
**written**. Two independent methods, same answer.

## Provenance on this machine

| Check | Result |
|---|---|
| `~/.future.R` | absent |
| `/Users/danielwalker/src/ai-sports-betting-dime-ai/.future.R` | absent |
| `find /Users/danielwalker/src -maxdepth 2 -name '.future.R'` | no results |
| `env \| grep -i future` | empty — `R_FUTURE_STARTUP_SCRIPT` unset |
| `~/.Rprofile`, `~/.Renviron` | do not exist |
| `/opt/homebrew/lib/R/etc/Rprofile.site`, `Renviron.site` | do not exist |
| `installed-manifest.csv` | `"future","1.75.0",...,"no","R 4.6.1; ; 2026-07-27 04:23:26 UTC; unix"` — pure R, no compiled component |

So `options(future.startup.script)` cannot be pre-set either (there is no profile to set it in).
**Nothing has been sourced on this host, and there is currently nothing to source.**

## Verdict and rationale

**FINDING — Medium.** This is a genuine local code-execution primitive that a user cannot infer
from the act of calling `library()`: a file dropped into a directory by any means — `git clone`,
`unzip`, a downloaded dataset, a shared network drive — becomes R code that runs in the global
environment the next time the user attaches `future` from that directory. It is upstream-documented
behaviour, not a defect, and the blast radius on this host is currently zero. It is a finding rather
than accepted risk because the default is opt-**out**, the target is the global environment, and
errors are demoted to warnings — three choices that each remove a chance for the user to notice. It
is Medium rather than High because it requires an attacker to already be able to write a file into
a directory the user will `setwd()` to, and because the `Imports`-vs-`Depends` analysis above shows
it does not fire on a plain `library(nflfastR)`.

## Defender action

1. Set `R_FUTURE_STARTUP_SCRIPT=FALSE` in `~/.Renviron` (handled at `zzz.R:118`), or
   `options(future.startup.script = FALSE)` in `~/.Rprofile` (`zzz.R:124`, `:131-133`). Either kills
   the path outright and costs nothing — no nflverse workflow uses `.future.R`.
2. Add `.future.R` to repository-hygiene scanning: flag it in any cloned repo or unpacked archive,
   the same way a `.Rprofile` or `.envrc` would be flagged.
3. If the option is ever deliberately enabled, prefer an absolute path
   (`R_FUTURE_STARTUP_SCRIPT=~/.future.R`) so the working-directory variant can never win at
   `zzz.R:155`.
4. Note for incident response: a `.future.R` that fails leaves only a `warning()`, so grep session
   logs for `"Failed to source"` (`zzz.R:164`) rather than expecting an error.
