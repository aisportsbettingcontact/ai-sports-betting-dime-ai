# Structural limitations — L1, L2, L3, and a new L4

These are not package findings. They are honest statements of what this audit did **not** establish,
what it would cost to establish, and what compensating evidence exists. Per the task brief, no
attempt was made to read 892k lines of C/C++.

---

## L1 — ~892,000 lines of C/C++ were not read

### What is unreviewed

38 of 90 packages ship a `src/` tree; 37 declare `useDynLib` (`native-code-inventory.md`). Four
packages carry wholesale vendored third-party projects and account for ~84% of the total:

| Package | Lines | What it is |
|---|---:|---|
| stringi | 540,791 | **bundled ICU 74** (common + i18n) |
| xgboost | 83,413 | **bundled xgboost core** + dmlc-core + rabit |
| vctrs | 49,363 | first-party vector type system |
| sass | 41,696 | **bundled libsass** |
| commonmark | 28,768 | **bundled cmark-gfm** |
| utf8 | 31,606 | **bundled utf8lite** |
| data.table | 25,816 | first-party fread/fwrite, grouping, OpenMP primitives |
| cli | 22,235 | terminal handling, progress-bar timer thread |
| rlang | 22,235 | quosures, conditions, the rlang C library |
| yaml | 17,188 | **bundled libyaml** |
| jsonlite | 5,702 | **bundled yajl** |
| timechange | 7,405 | **bundled cctz** |
| curl / xml2 / fs / magick / V8 | — | thin bindings over the libraries discussed in E1 |

### What the risk actually is

Not "a backdoor might be hiding in there". It is **volume plus transitive supply chain**: ICU,
libsass, cmark-gfm, libyaml, yajl, cctz, utf8lite and xgboost's dmlc/rabit are upstream projects
with their own maintainers, release processes and CVE histories, none of which is in this audit's
scope. A vulnerability in any of them is a vulnerability in this R installation.

### Compensating evidence (real, and worth stating)

1. **WS-B integrity verification, 90/90 PASS.** Every tarball's MD5 matches the CRAN index on
   `cloud.r-project.org`, `cran.wu.ac.at` **and** `ftp.osuosl.org` — the last being a genuinely
   independent rsync mirror on separate infrastructure, not a CDN edge of the same origin. Across
   the full 24.4k-package index there were **zero** same-version-different-MD5 discrepancies. So the
   C/C++ on this machine is *the same C/C++ CRAN publishes*, and matches upstream GitHub for the six
   targets (6/6 GitHub diff reports, 0 content divergences). This does not tell us the code is safe;
   it tells us it is **unmodified**, which removes the "tampered in transit / tampered locally"
   hypothesis entirely.
2. **A targeted pattern scan of the native layer found almost nothing.** 97 hits across ~892k lines:
   68 `getenv()` (documented config vars), 14 `system()` — of which **11 are the word "system (" in
   ICU comments** and 3 are `git clone` in a libsass dev script — 8 `dlopen()` (all in vendored
   upstream trees: NCCL stub in a CUDA-only path, libsass plugin loader, ICU/cctz probing `libc.so`),
   6 `setenv()`, 1 `popen()`, and **zero `exec*()` and zero `fork()`** anywhere in the closure.
3. **The six audit targets ship zero native code.** Verified, not assumed: `find -type d -name src`
   returns nothing and `grep -c useDynLib NAMESPACE` is 0 for nflverse, nflreadr, nflfastR,
   nflseedR, nfl4th and nflplotR. All the native surface is inherited from the dependency closure.

### What a targeted review would cost

Reading 892k lines is not the right question — nobody does that. Proportionate options, in
increasing cost:

- **Version-diff the vendored copies against upstream releases** (ICU 74, libsass, cmark-gfm,
  libyaml, yajl, cctz): a mechanical `diff` per package. ~1–2 days, and it converts "unread" into
  "unmodified relative to a named upstream release" for ~700k of the 892k lines.
- **CVE-map the vendored versions** against the NVD (ICU 74, libxml2 2.14.4, libcurl 8.14.1,
  libuv 1.52.0, V8 14.6.202.26, libsass, cmark-gfm). ~half a day, and it is the highest-value single
  action because it produces an actionable patch list.
- **Read the first-party binding layers only** — magick's 4,660 C++ lines, curl's 3,620 C, xml2's
  2,605, fs's 2,506, V8's 934. ~14k lines total, i.e. 1.6% of the mass, and it covers every place
  where R-level data crosses into native code. ~2–3 days for a competent reviewer.
- Full review of the vendored trees: months. Not proportionate, and duplicative of the upstream
  projects' own work.

---

## L2 — ~30 MB of `inst/` web assets were not reviewed

### What is unreviewed and why

WS-C's scan deliberately excluded non-script files under `inst/` (`notes.md`, decision 2): R-language
regexes against CSS/JS produce only noise (`url(...)`, `load(...)`). The excluded assets belong to
**bslib, jquerylib, reactable, reactR, htmlwidgets, fontawesome, gt, rmarkdown and V8**.

### The distinction that matters — and a correction to L2 as written

WS-C's statement that these assets "execute in a browser when a gt table, reactable or R Markdown
document is rendered — not in the R process" is **true for most of them but not all**. Three bundles
are fed to the V8 engine and therefore execute **inside the R process**:

| Asset | Loaded by | Executes in |
|---|---|---|
| `juicyjuice/inst/dist/bundle.js` | `css_inline.R:19-22` | **R process** (V8) |
| `reactR/inst/www/babel/babel.min.js` | `babel.R:20-25` | **R process** (V8) |
| `reactable/inst/htmlwidgets/reactable.server.js` | `reactable.R:850` | **R process** (V8) |
| bslib/jquerylib Bootstrap+jQuery, fontawesome SVG/CSS, gt CSS, htmlwidgets JS, rmarkdown JS | rendered HTML | browser |

The R-process trio matters more, because `V8::v8()` defaults to `console = TRUE`, which exposes
`console.r.eval()` — a route from that JavaScript back into R at global scope (see `V8.md` Part 2).
Their integrity therefore rests on the same CRAN verification as everything else, but their blast
radius is in-process, not sandboxed by a browser.

### Compensating evidence

Same as L1: WS-B verified all 90 tarballs against three sources, so these bundles are byte-identical
to what CRAN publishes. Additionally, none of the three R-process bundles is fetched over the
network — all three `ctx$source()` calls in the closure were confirmed to read `system.file()` paths
(see `juicyjuice.md`, `reactR.md`, `reactable.md`).

### What a targeted review would cost

The browser-side assets are well-known upstream releases (Bootstrap, jQuery, Font Awesome) and are
best handled by version-pinning + CVE monitoring, not reading — a few hours. The three R-process
bundles are minified and would need to be diffed against their upstream published builds (juice,
Babel standalone, reactable's server bundle): ~1 day, and it is the part worth doing, because those
are the ones with a path back into R.

---

## L3 — Install provenance was unresolved (**now RESOLVED**)

WS-C recorded: *"Every Tier-1 severity call depends on it. WS-C worked from staged CRAN source
tarballs, which is the right input for reading code but says nothing about how the installed library
was built."*

**This limitation is closed.** Task 7 resolved it against the two install logs and the installed
artefacts:

- **All 90 packages were compiled from source on this machine** by Homebrew R 4.6.1 — 87
  `installing *source* package` lines in `bznitqj7o.output`, 4 in `bvdz7ibhe.output`, **zero binary
  installs**. Corroborated by `installed-manifest.csv`, where every `needs_compilation="yes"` row
  carries `Built: R 4.6.1; aarch64-apple-darwin25.4.0; …`.
- **All 90 came from `https://cloud.r-project.org/src/contrib/`** — every `trying URL` line in both
  logs points there; no non-CRAN source URL appears.
- **But source-install alone does not settle E1.** Each of the nine install-time network rows is a
  *conditional fallback branch*, so each guard had to be evaluated separately. Per-package results
  are in the individual review files; the summary is: **curl, fs, V8 and xml2 fetched; magick did
  not; four of the nine rows are Linux-only and unreachable on darwin/arm64.**

The lesson worth carrying: "was it built from source?" is the wrong question. The right one is
"which branch of its configure did this platform take, and what does the resulting binary link
against?"

---

## L4 — NEW: unverified third-party binaries are resident in the installed library

This limitation did not exist in WS-C's list because WS-C could not see the install logs. It is the
most consequential thing Task 7 found, and it is a *limitation* as well as a finding: there is
information here that can no longer be recovered.

**What happened.** Four packages' `configure` scripts fetched an unpinned shell script from
`autobrew.github.io`, dot-sourced it, and that script downloaded a prebuilt static library from
`github.com/autobrew/bundler/releases` with **no checksum or signature**. Each was linked into the
package's shared object:

| Package | Bundle fetched | Now resident in | Evidence |
|---|---|---|---|
| curl | `curl-macos-8.14.1-universal.tar.xz` | `curl.so` (838 KB) | log `:784`; `otool -L` shows no libcurl dylib |
| fs | `libuv-1.52.0-sonoma-universal.tar.xz` | `fs.so` (220 KB) | log `:721`; links only libSystem/libR/libc++ |
| V8 | `v8-14.6.202.26-sonoma-universal.tar.xz` | `V8.so` (**47.5 MB**) | log `:1258`; links only libR/libc++/libSystem |
| xml2 | `libxml2-2.14.4-universal.tar.xz` | `xml2.so` (1.07 MB) | log `:1556` `.deps` fingerprint; no libxml2 dylib |

**Why it is a limitation and not only a finding.** Each package's `cleanup` script then ran
`rm -Rf .deps autobrew` (curl `cleanup:3`, V8 `cleanup:2-3`, xml2 `cleanup:2`, magick `cleanup:3`;
fs `cleanup:2` without `-Rf`). **Neither the fetched script nor the downloaded archive survives**, so
there is nothing left to hash against upstream — not now, and not retrospectively. The only evidence
of what was linked is the `.so` files themselves.

**Why WS-B does not cover it.** WS-B's 90/90 PASS verified CRAN **source tarballs**. These binaries
were fetched *by* those tarballs at install time, entirely outside CRAN's chain of custody. The
audit's strongest integrity result and this exposure are disjoint — a point that must not be blurred
in the synthesis.

**What can still be done.** Rebuild with `DISABLE_AUTOBREW=1` (or `USE_BUNDLED_LIBUV=1` for `fs`)
against locally-provided libraries and compare; or re-fetch today's bundles and record their hashes
as a *forward* baseline, accepting that the 2026-07-26 fetch is unrecoverable. Cost: a few hours.
Going forward, install binaries from CRAN/Posit Package Manager and the whole class disappears.
