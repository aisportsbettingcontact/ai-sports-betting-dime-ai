# Escalation review — Rcpp 1.1.2

**Escalation:** E5 (compiles and `dyn.load`s C++ at runtime; `load()` of a cache index)
**Verdict:** **ACCEPTED-RISK — Low** (WS-C's specific concern is **downgraded** on evidence)
**Executes when:** call time, on `sourceCpp()` / `cppFunction()` / `compileAttributes()`
**Ran on this machine:** **NO** — no `sourceCpp` cache directory exists; none of the six audit
targets ships or compiles C++

## Files read

`sources/Rcpp/R/Attributes.R:20-60, 150-235, 255-270, 360-380, 1160-1290`,
`sources/Rcpp/R/RcppLdpath.R:85-95`, `sources/Rcpp/NAMESPACE`.

## What executes, when, under whose control

`sourceCpp()`/`cppFunction()` compile and `dyn.load()` arbitrary C++. That is the product; the
`system2(r, ...)` / `system(command, intern = TRUE)` calls at `Attributes.R:156, 587, 606, 1181` are
`R CMD SHLIB` invocations, and `Attributes.R:208, 219` `source(scriptPath, local = env)` sources the
R shim that `compileAttributes()` just generated in the build directory. All of it is downstream of
an explicit user call with user-supplied C++.

**WS-C's sharpest concern was the cache.** It asked Task 7 to "audit the sourceCpp cache directory
location and the `load()` of its index — that is a local deserialisation primitive". Reading it:

```
Attributes.R:1218  .sourceCppDynlibWriteCache <- function(cacheDir, cache) {
Attributes.R:1219      index_file <- file.path(cacheDir, "cache.rds")
Attributes.R:1220      save(cache, file = index_file, compress = FALSE)
Attributes.R:1224  .sourceCppDynlibReadCache <- function(cacheDir) {
Attributes.R:1225      index_file <- file.path(cacheDir, "cache.rds")
Attributes.R:1227      if (file.exists(index_file)) { load(file = index_file); get("cache") }
Attributes.R:1267  .sourceCppDynlibUniqueToken <- function(cacheDir) {
Attributes.R:1268      token_file <- file.path(cacheDir, "token.rds")
Attributes.R:1270      if (file.exists(token_file)) load(file = token_file) else token <- 0
```

`load()` on a file is a deserialisation primitive — but **where** the file lives decides the
severity, and the answer downgrades the concern:

```
Attributes.R:27   cacheDir = getOption("rcpp.cache.dir", tempdir())
Attributes.R:261  cacheDir = getOption("rcpp.cache.dir", tempdir())
Attributes.R:367  cacheDir = getOption("rcpp.cache.dir", tempdir())
Attributes.R:38-40  cacheDir <- path.expand(cacheDir); cacheDir <- .sourceCppPlatformCacheDir(cacheDir); normalizePath(...)
Attributes.R:1253-1263  .sourceCppPlatformCacheDir → file.path(cacheDir, paste("sourceCpp", R.version$platform, packageVersion("Rcpp"), sep="-"))
```

The default is **`tempdir()`** — R's per-process private session directory (created mode 0700,
removed at session exit) — not a persistent user-writable cache. So by default the `load()`ed index
is a file this process wrote, moments earlier, in a directory no other user can reach and that does
not survive the session. It is **not** a persistent poisoning target.

It becomes one only if a user sets `options(rcpp.cache.dir = <persistent shared path>)`. There is no
such option anywhere on this host (no `~/.Rprofile`, no `Rprofile.site` — both confirmed absent),
and nothing in the nflverse closure sets it.

`RcppLdpath.R:92` `capture.output(source(script))` sources `Rcpp`'s own installed script for linker
flags — a `system.file()` path inside the installed package.

`.onLoad` registers a vignette engine and nothing else (`hooks-inventory.md`, "Benign" section).

## Provenance on this machine

| Check | Result |
|---|---|
| `installed-manifest.csv` | `"Rcpp","1.1.2","GPL (>= 2)","yes","R 4.6.1; aarch64-apple-darwin25.4.0; …","2026-07-26T21:23:00"` |
| install log `bznitqj7o.output:52` | `trying URL '.../Rcpp_1.1.2.tar.gz'` — ordinary source install, no `configure` network activity |
| `~/Library/Caches/.../sourceCpp-*` | absent |
| Why it is here | `magick` links against it (`-I'.../Rcpp/include'`, `bvdz7ibhe.output:18`); it is a build-time dependency of magick, not a runtime one for the six targets |
| Six audit targets | zero `src/` trees, zero `useDynLib` (`native-code-inventory.md`) — none of them calls `sourceCpp()` |

## Verdict and rationale

**ACCEPTED-RISK — Low.** Runtime compilation and `dyn.load()` of C++ is Rcpp's reason to exist and
cannot be characterised as a defect; it requires an explicit call carrying explicit C++ source. The
escalated deserialisation concern is genuinely reduced by reading the code: the cache index lives in
the session-private `tempdir()` by default, so the `load()` at `Attributes.R:1227`/`1270` reads a
file the same process just wrote. The residual risk is entirely conditional on a user opting into a
persistent shared `rcpp.cache.dir`, which nothing here does. Nothing in the nflverse data path
reaches any of this code.

## Defender action

1. Do not set `options(rcpp.cache.dir=)` to a shared or world-writable location. If a persistent
   cache is wanted for build-speed reasons, use a per-user path with `0700` permissions —
   `tools::R_user_dir("Rcpp", "cache")` — and never a `/tmp`-style shared directory.
2. Treat `sourceCpp()`/`cppFunction()` on C++ from an untrusted source exactly like running an
   untrusted binary, because that is what it is.
3. No action is required for the nflverse closure itself: all six targets are pure R and never
   invoke the compiler.
