# WS-C Step 3 — native-code inventory

**Scope caveat, per the audit spec: compiled code is reviewed at pattern level only.** The C/C++
below was not read for logic. It is inventoried so the synthesis can state honestly how much
unreviewed native attack surface the closure carries.

## Headline numbers

- **38 of 90 packages ship a `src/` tree**; 37 declare `useDynLib` in `NAMESPACE` (`cachem` ships
  `src/` without `useDynLib`; it registers via `R_init_`).
- **52 of 90 packages are pure R** — including all six audit targets.
- **932,557 lines of C/C++** across 2,497 files. Counting basis, stated so it is reproducible:
  `find sources/*/src -type f \( -name '*.c' -o -name '*.h' -o -name '*.cpp' -o -name '*.cc' -o
  -name '*.cxx' -o -name '*.hpp' -o -name '*.hxx' \) | xargs wc -l` — i.e. **top-level `src/`
  directories only**. Counting *any* path containing `/src/` gives **933,771**, the extra 1,214
  lines being 28 files in `cli`/`rlang` test fixtures and `Rcpp/inst/tinytest` demo packages, which
  are not part of any installed shared object. An earlier draft of this file said "~892,000"; that
  figure was derived by summing the per-package table below and was simply wrong. Four packages are
  ~82 % of the total: stringi (540 k, bundled ICU 74), xgboost (83 k, bundled dmlc-core + rabit),
  vctrs (49 k), sass (42 k, bundled libsass).
- No Fortran anywhere in the closure.

## The six audit targets ship zero native code

| package | `src/` | `useDynLib` | verdict |
|---|---|---|---|
| nflverse 1.0.3 | absent | no | pure R (8 R files) |
| nflreadr 1.5.1 | absent | no | pure R (36 R files) |
| nflfastR 5.2.0 | absent | no | pure R (32 R files) |
| nflseedR 2.0.2 | absent | no | pure R (27 R files) |
| nfl4th 1.0.7 | absent | no | pure R (11 R files) |
| nflplotR 1.6.0 | absent | no | pure R (16 R files) |

Verified, not assumed: `find sources/<pkg> -type d -name src` returns nothing for all six, and
`grep -c useDynLib <pkg>/NAMESPACE` is 0 for all six. `nflplotR/tools/check.env` and
`nflfastR/tools/check.env` are two-line env files, not build scripts.

## Full `src/` inventory

C/H and CPP columns are line counts (`wc -l`) over the whole `src/` tree.

| package | C/H | C++ | files | what the native code implements |
|---|---:|---:|---:|---|
| stringi | 199,252 | 341,539 | 1,070 | **bundled ICU 74** (common + i18n) plus stringi's own ICU bindings |
| xgboost | 52,344 | 31,069 | 440 | **bundled xgboost core** + dmlc-core + rabit: gradient boosting, tree learners, IO, collective comms |
| vctrs | 49,312 | 51 | 273 | vector type system, size/type coercion, ordering, hashing |
| sass | 2,067 | 39,629 | 229 | **bundled libsass** — SCSS parser/compiler |
| commonmark | 28,768 | 0 | 74 | **bundled cmark-gfm** — Markdown parser |
| utf8 | 31,606 | 0 | 69 | **bundled utf8lite** — Unicode normalisation/width tables |
| data.table | 25,816 | 0 | 60 | fread/fwrite, grouping, sorting, OpenMP-parallel primitives |
| cli | 22,235 | 0 | 38 | ANSI/terminal handling, progress-bar timer thread, glob, hashing |
| rlang | 22,184 | 51 | 145 | quosures, environments, condition system, the rlang C library |
| yaml | 17,188 | 0 | 16 | **bundled libyaml** |
| digest | 15,264 | 808 | 43 | md5/sha1/sha256/xxhash/spookyhash implementations |
| timechange | 2,388 | 5,017 | 30 | **bundled cctz** — timezone arithmetic |
| jsonlite | 5,702 | 0 | 45 | **bundled yajl** — JSON parser |
| magick | 82 | 4,660 | 20 | Magick++ bindings (links against system/autobrew ImageMagick) |
| Rcpp | 151 | 6,027 | 9 | the Rcpp runtime + attribute compiler |
| curl | 3,620 | 0 | 31 | libcurl bindings: handles, multi, forms, SMTP |
| isoband | 123 | 3,318 | 13 | contour/isoband generation |
| farver | 1,197 | 2,738 | 12 | colour-space conversion |
| xml2 | 471 | 2,134 | 15 | libxml2 bindings |
| fs | 904 | 1,602 | 26 | **bundled libuv** filesystem layer |
| dplyr | 265 | 1,754 | 14 | group/slice/filter fast paths |
| purrr | 1,769 | 0 | 18 | map/reduce fast paths |
| lubridate | 1,157 | 0 | 7 | date parsing/updating |
| V8 | 18 | 916 | 7 | **embeds the V8 JavaScript engine** — arbitrary JS execution by design |
| fastmap | 2,920 | 265 | 8 | hash map |
| S7 | 802 | 0 | 4 | class/dispatch primitives |
| base64enc | 447 | 0 | 4 | base64 |
| glue | 372 | 0 | 4 | string interpolation |
| tibble | 383 | 0 | 6 | printing/subsetting helpers |
| tidyr | 0 | 385 | 3 | pivot helpers |
| bitops | 299 | 0 | 4 | bitwise ops |
| magrittr | 660 | 0 | 3 | pipe |
| htmltools | 227 | 0 | 2 | HTML escaping |
| xfun | 281 | 0 | 3 | string/base64 helpers |
| parallelly | 181 | 0 | 6 | pid/socket probes |
| rappdirs | 52 | 0 | 2 | platform config paths |
| mime | 45 | 0 | 2 | MIME type table |
| cachem | 42 | 0 | 2 | cache key helpers |

## Native primitives found by pattern scan

Only 97 hits total across ~892 k lines. All were located and read in context.

| primitive | count | where |
|---|---:|---|
| `getenv()` | 68 | stringi 27 (ICU config), xgboost 20, timechange 5, fs 4, cli 3, vctrs/Rcpp/data.table/curl 2 each, rlang 1 — all reading documented configuration variables |
| `system()` | 14 | 11 are the word "system (" inside ICU/stringi *comments*; 3 are `system("git","clone",...)` in `sass/src/libsass/script/test-leaks.pl`, an upstream dev script |
| `dlopen()` | 8 | `xgboost/src/src/collective/nccl_stub.cc:88` (loads an NCCL `.so` by path — **CUDA-only, not compiled in the CRAN build**); `sass/src/libsass/src/plugins.hpp:22` (libsass plugin loader); `stringi/src/icu74/common/putil.cpp:1082,2382` (ICU probing `libc.so`); `timechange/src/cctz/src/time_zone_lookup.cc:58` (cctz probing `libc.so`) |
| `setenv()`/`putenv()` | 6 | `magick/src/base.cpp:12` sets `KMP_DUPLICATE_LIB_OK=1` at init; `xgboost/src/dmlc-core/include/dmlc/parameter.h:1127`; the rest are cctz *tests* |
| `popen()` | 1 | `xgboost/src/src/common/io.cc:401` — `CmdOutput()`, a `popen`/`pclose` helper used for platform probing |
| `exec*()` / `fork()` | 0 | none |

**Assessment.** Nothing in the native layer looks planted. The process- and library-loading
primitives are all in *vendored upstream* trees (ICU, cctz, libsass, dmlc/xgboost) doing what those
libraries normally do. The genuine risk here is not a backdoor but volume: 932,557 lines of C/C++
that this audit did not read, four packages of which (stringi, xgboost, sass, commonmark) are
wholesale vendored copies of third-party projects whose own supply chains are out of scope.
`V8` deserves separate mention — it exists to execute arbitrary JavaScript, and `juicyjuice` and
`reactR` in this closure feed it JS at runtime (`ctx$source(...)`).
