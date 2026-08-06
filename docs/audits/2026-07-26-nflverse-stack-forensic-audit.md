# nflverse R stack — forensic audit

**Subject:** the nflverse R package family and its full installed dependency closure, evaluated for
adoption by Dime AI (a commercial real-money sports-betting platform).
**Field work:** 2026-07-26 to 2026-07-27 (UTC), macOS/darwin 25.5.0, R 4.6.1, against the live
site-library at `/opt/homebrew/lib/R/4.6/site-library` (read-only throughout; verified unwritten).
**Targets:** nflverse 1.0.3, nflreadr 1.5.1, nflfastR 5.2.0, nflseedR 2.0.2, nfl4th 1.0.7,
nflplotR 1.6.0 — plus all 90 packages in their hard-dependency closure.
**Method:** six parallel workstreams, each independently reviewed and re-derived before acceptance.
Every number below traces to a file under `$ROOT/evidence/`; see Appendix E for the mapping.

```text
$ROOT = /private/tmp/claude-501/-Users-danielwalker-src-ai-sports-betting-dime-ai/\
        dd3b2b85-766c-4b7b-a98c-d928cffcbac2/scratchpad/nflverse-audit
```

**Appendices:** [A — package manifest](appendix/package-manifest.md) ·
[B — findings register (CSV)](appendix/findings-register.csv) ·
[C — exports inventory](appendix/exports-inventory.md) ·
[D — data dictionaries](appendix/data-dictionaries.md) ·
[E — evidence index](appendix/evidence-index.md)

---

## 1. Executive summary and verdict

### 1.1 We found no tampering

Every integrity test this audit ran came back clean, and they were not soft tests.

- All 90 source tarballs match CRAN's published MD5, on three separate fetches, including from
  `ftp.osuosl.org` — a genuine rsync mirror on infrastructure independent of CRAN master.
  90 PASS, 0 FAIL, 0 gaps (`ws-b/hash-verification.csv`).
- Across roughly 24.4 thousand package records in the full CRAN index, the number of packages with
  the same version but a different MD5 between independent sources is **zero**
  (`ws-b/mirror-crosscheck.txt`). That is the signal that would show mirror-level substitution, and
  it is absent.
- All six targets were reinstalled from the verified tarballs into a throwaway library and
  byte-diffed against the live install. Every difference reduces to the install timestamp or the
  install path — including two that took real work to close, the namespace `path` string inside
  each `.rdb` and an integer offset named `first` in `help/paths.rds` that shifts with the length
  of the randomly-named staging directory. 6/6 clean, 0 unexplained deviations
  (`ws-b/reinstall-diff/*.txt`, `ws-b/raw-logs/paths-rds-attributes.txt`).
- All six CRAN tarballs were diffed against their upstream GitHub release tags. 6/6 show **zero
  content divergence**; after CRLF normalisation the only file that differs anywhere is
  `DESCRIPTION`, and every differing field is CRAN's own publish metadata
  (`ws-b/github-diff/*.txt`).

The code on this machine is the code CRAN publishes, and for the six targets it is the code the
nflverse maintainers pushed to GitHub. That removes "tampered in transit or tampered locally" as a
hypothesis. It does not establish that the code is safe — a separate question, answered below.

### 1.2 What we did find

Three things, in descending order of how much they should change your plans.

**One unmitigated supply-chain exposure, and it is not where you would look for it.** Four
packages — `curl`, `fs`, `V8` and `xml2` — each downloaded a shell script from
`https://autobrew.github.io/scripts/<name>` during their `configure` step and dot-sourced it into
the running shell. That script then downloaded a prebuilt static library with no checksum and no
signature, and the linker baked it into the installed shared object. Four shared objects totalling
roughly 49 MB now carry statically linked third-party libraries of unverified provenance, dominated
by a 47,520,328-byte static JavaScript engine inside `V8.so`. The clean 90/90 tarball verification
above **does not cover these binaries** — they were fetched *by* those verified tarballs at install
time, entirely outside CRAN's chain of custody. Each package's `cleanup` script then deleted both
the fetched script and the extracted archive, so what those bundles contained on 2026-07-26 is
unrecoverable. See [NFLV-001](#nflv-001).

Two details worth internalising, because they are how this class of problem hides. First, grepping
your install logs for "autobrew" is a **false negative**: `xml2`'s fetched script contains no `echo`
statements at all and never appears in the logs. Only linker fingerprinting (`otool -L` showing no
corresponding dylib) and `strings` (finding `libcurl/8.14.1`, `14.6.202.26`, `2.14.4` and `libuv`
tokens inside the `.so` files) caught it. Second, `magick` — which is listed in the same escalation —
did **not** fetch: Homebrew was present, so its macOS branch was skipped, and its other branch is
Linux-guarded dead code on this platform. "Built from source" was the wrong question; "which branch
of its configure did this platform take, and what does the resulting binary link against" was the
right one.

**A runtime trust model with no floor beneath TLS.** Nothing in any of the six packages verifies
anything before deserializing it. A grep across all six packages' entire R source for
`checksum|sha256|md5sum|digest::|signature|gpg|verify.*hash|integrity` returns zero matches.
`nflreadr/R/from_url.R:65-78` opens a bare `url()` connection and hands it straight to `readRDS` —
bypassing even the `curl` R package's handle API (though not libcurl itself, which `url()` still
uses internally). The pattern is independently re-implemented three times across the codebase and
none of the three copies added a check the others lack. `nflfastR::add_dakota()` goes further and
uses `load()` on a remote `.Rdata`, injecting named objects directly into a live function frame.
The practical consequence is not exotic: **a payload that decodes to a structurally valid but
factually wrong data frame — spoofed scores, altered lines, tampered win probabilities — is accepted
with no warning and flows straight into whatever consumes it.** That needs no code-execution
vulnerability at all. See [NFLV-002](#nflv-002), [NFLV-006](#nflv-006).

**A failure mode that will bite you in production before any attacker does.** When the network is
unavailable, `nflreadr` does not raise an R error. It emits warnings — three of them for
`load_schedules(2026)` — and returns an empty data frame as though that were a normal answer.
`memoise` then caches that empty result exactly like a
success — and serves it back **after connectivity is restored**, for up to 24 hours, with zero
conditions raised on the poisoned read. This was reproduced end to end, twice, independently
(`ws-d/offline-behavior.md`). A cron job that loses the network for one call silently proceeds on
zero rows and keeps doing so long after the network is healthy. See [NFLV-003](#nflv-003).

Alongside those: one cleartext `http://site.api.espn.com` endpoint feeding a live 4th-down
decision-support computation ([NFLV-004](#nflv-004)); a `V8` JavaScript-to-R escape hatch that is on
by default ([NFLV-005](#nflv-005)); attribution obligations and a rights disclaimer that need
counsel ([NFLV-010](#nflv-010), [NFLV-011](#nflv-011)); two nflverse upstream feeds that have
already died ([NFLV-012](#nflv-012)); and a Dime-side schema gap that is costing you data you
actually want ([NFLV-013](#nflv-013)).

### 1.3 Verdict — adopt the data, not this configuration

**ADOPT** nflverse as a batch data source for Dime, subject to four gating conditions.
**HOLD** on any production path in which R fetches from nflverse inside a request, and on nfl4th's
live ESPN path entirely, until those conditions are met.

The data is worth having. It is genuinely authentic to its source, the six packages ship zero native
code of their own, and `dictionary_schedules` alone carries the historical closing lines and results
that Dime's own schema currently discards. The problem is not the data; it is that the delivery
mechanism has no integrity controls, fails silently, and left unverified binaries in your library.
All four conditions are engineering work you control, not upstream changes you must wait for.

| # | Gate | Closes | Effort |
|---|---|---|---|
| G1 | Rebuild the R library from binaries (Posit Package Manager, `type="binary"`), or from source with `DISABLE_AUTOBREW=1` on an egress-restricted build host. Record `otool -L` output for `curl.so`, `fs.so`, `V8.so`, `xml2.so` as a build-provenance artefact. | NFLV-001 | hours |
| G2 | Mirror every nflverse release asset into Dime-controlled storage, record a SHA-256 at ingest, verify it on every read. nflverse never fetches inside a request path. | NFLV-002, NFLV-003, NFLV-012, NFLV-014 | days |
| G3 | Keep `nfl4th::get_4th_plays()` off every wagering surface until its cleartext ESPN call is proxied over TLS or replaced. | NFLV-004 | hours |
| G4 | Counsel sign-off on the 9-item list in `ws-e/commercial-posture.md` §5 before nflverse-derived data reaches a user-facing surface. | NFLV-010, NFLV-011 | external |

Three schema fixes are not gates but should be done before the first ingestion is written, because
they get materially more expensive afterwards: capture the betting columns
([NFLV-013](#nflv-013)), reconcile the `kickoff_time_et` memory note against the real schema
([NFLV-018](#nflv-018)), and stop joining on team abbreviations ([NFLV-019](#nflv-019)).

**Finding counts:** 25 total — 3 High, 10 Medium, 7 Low, 5 Info. No Critical: a Critical rating in
this audit's scheme would require evidence of actual compromise or exploitation, and none was found.

---

## 2. Scope and methodology

### 2.1 What was examined

| Layer | Contents | Depth of review |
|---|---|---|
| Targets | 6 nflverse packages | Line-level source review, live runtime experiments, GitHub tag diff, clean-reinstall byte diff |
| Closure | All 90 packages in the site-library | Checksum verification, license inventory, dependency graph, currency check, automated dangerous-pattern scan |
| Escalated | 26 closure packages flagged by the scan | Line-level review with file:line citations, install-log and linker provenance |

Out of scope by design: R 4.6.1 itself, Homebrew system libraries beyond noting them as attack
surface, and any legal opinion. Licensing findings describe and flag; they do not conclude.

### 2.2 How the work was structured

Six workstreams ran in parallel — WS-A inventory and dependencies, WS-B supply-chain integrity,
WS-C execution surface, WS-D network and runtime, WS-E licensing and data provenance, WS-F API and
schema — followed by a dedicated escalation deep-review pass over the 26 packages WS-C could not
adjudicate from a snippet. Every workstream's output was independently reviewed before acceptance,
and the review ledger is in `.superpowers/sdd/progress.md`.

The reviews were not rubber stamps and changed the result in several places. WS-B's first draft
claimed `help/paths.rds` attributes were identical when its own raw log recorded otherwise; the
claim was wrong, the underlying conclusion survived, and the corrected explanation (an integer
offset tracking staging-directory name length) is stronger than the original. WS-C's original
escalation asserted that `future`'s `.future.R` startup-script behaviour was reachable from
`library(nflverse)`; that was empirically disproven and narrowed to an explicit `library(future)`
or `library(furrr)` attach. WS-C also over-stated its own scan deviation by roughly six times by
folding in a directory the brief already excluded. WS-F's dictionary field-sum was recomputed from
1,270 to 1,286. In each case the correction is recorded in the evidence rather than quietly applied.

The synthesis pass that produced this report re-derived every count it cites directly from the
evidence CSVs rather than copying figures from workstream prose; the commands are in Appendix E.

### 2.3 Trust model, and what the integrity result actually proves

CRAN over HTTPS and GitHub over HTTPS were used as reference sources. We do not assume either is
compromised — we test for divergence between them.

**The two mirrors named in the audit plan turned out to be one origin.** `cran.wu.ac.at` does not
serve its own copy; it answers with an HTTP 301 to `cran.r-project.org`. And `cloud.r-project.org`
is a CloudFront CDN (`via: ...cloudfront.net`, `x-amz-cf-pop: LAX54-P1`) in front of the same CRAN
master. Their byte-identical indices are therefore not independent corroboration, and were not
reported as such. Real host independence rests entirely on the designated fallback
`ftp.osuosl.org`, a genuine rsync mirror on separate infrastructure, from which all 90 tarballs were
re-downloaded and matched (`ws-b/mirror-crosscheck.txt`). This is [NFLV-025](#nflv-025), and it is a
methodology lesson worth keeping: choose your second source by infrastructure, not by hostname.

Given that, the integrity result means precisely this: **the local tarballs match what CRAN serves
today, corroborated by an independent mirror.** CRAN publishes no signatures for source tarballs, so
there is no cryptographic chain back to the maintainer. GitHub tags are mutable — and, as nflverse
itself demonstrates ([NFLV-016](#nflv-016)), can be misplaced — so the tag diff is corroboration,
not proof of provenance.

### 2.4 The lost original tarballs

**This is the audit's structural limitation and it must not be read past.** The tarballs actually
downloaded during the original install were deleted along with R's temp directory. Verification is
therefore against *present-day* CRAN artifacts, not against the install-time bytes.

The clean reinstall in §4.3 closes most of that gap: it proves the live library is reproducible,
byte for byte, from the freshly verified tarballs. If the install-time bytes had differed from
today's CRAN bytes, that reinstall would have produced files whose differences did not reduce to
timestamp and path — and it did not, for any of the six.

What it does not close is the install-time *network fetches*. Those left no reproducible artefact at
all, because `cleanup` deleted them. That is exactly the gap [NFLV-001](#nflv-001) sits in, and it
is why that finding is a limitation as much as it is a finding.

### 2.5 Where the evidence actually lives

Every `$ROOT/evidence/...` path cited in this report and its appendices is a **session-scratchpad
path**, and a scratchpad is reclaimed. A verbatim copy of the whole tree was therefore preserved
in-repo on **2026-07-27** at
[`docs/audits/2026-07-26-nflverse-evidence/`](2026-07-26-nflverse-evidence/) — **151 files,
2,183,780 bytes**, the same counts Appendix E records for `$ROOT/evidence/`. `diff -rq` between the
two trees is empty, and sha256 spot-checks across all six workstreams match. To re-verify any
citation, substitute `docs/audits/2026-07-26-nflverse-evidence/` for `$ROOT/evidence/`.

A 152nd file, `verification.md`, was added to **both** trees afterwards: the independent
verification pass over this report (claims re-derived, citations resolved, coverage against the
design doc's success criteria, and every correction it applied). It is the record of what was
checked and what was wrong, and it is the right place to start if you want to attack these numbers.

The two `R CMD INSTALL` transcripts that the install-provenance and autobrew findings quote by line
number were not part of the original evidence tree. Because they are not reproducible at all — and
because they are the primary evidence for the highest-severity finding in this report — they were
recovered from the session's task output and preserved into **both** trees after the verification
pass, at `install-transcripts/`:

| Transcript | Lines | SHA-256 (first 16) | Carries |
|---|---:|---|---|
| `bznitqj7o.output` | 3,115 | `f98aea8ada1ffceb` | 87 source-install lines; the three `Using autobrew bundle:` lines at 721 (libuv), 784 (curl), 1258 (v8); the magick configure failure at 3089–3105 |
| `bvdz7ibhe.output` | 97 | `468bd1a063f85e5e` | 4 source-install lines; magick's successful pkg-config build at :12 |

Every line number cited by the autobrew and install-provenance findings can now be checked directly
against these files rather than trusted from the quotations in `ws-c/escalation-reviews/*.md`. Note
that xml2 does **not** appear in either transcript — that absence is itself evidence, and is the
false-negative documented in [NFLV-001](#nflv-001).

The one thing the copy still does not contain is `$ROOT/sources/` (the 90 extracted CRAN tarballs),
which is reproducible from CRAN at any time and whose integrity is established in §4.

---

## 3. Inventory

**90 packages**, all installed into `/opt/homebrew/lib/R/4.6/site-library`, all compiled from source
on this machine (87 `installing *source* package` lines in one install log plus 4 in a second — 91
lines for 90 packages, because `magick` was installed twice after a first failure — and **zero**
binary installs). 39 of 90 declare `NeedsCompilation: yes`; 38 actually ship a `src/` tree (§5.3).
Those 38 all carry `Built: R 4.6.1; aarch64-apple-darwin25.4.0`. The 39th, `tidyselect`, is the
whole of the 39-versus-38 gap: it declares `NeedsCompilation: yes`, ships no `src/`, and its
`Built:` line has an **empty** platform field (`Built: R 4.6.1; ; 2026-07-27 04:23:54 UTC; unix`) —
the tell that nothing was actually compiled for it (`installed-manifest.csv`).
All 90 were acquired from `https://cloud.r-project.org/src/contrib/`, HTTP 200 on the first attempt,
with **0 rows needing the `Archive/` fallback** — every installed version is still current on CRAN.

**Dependency graph: 1,054 edges** — 4 `Depends`, 355 `Imports`, 6 `LinkingTo`, 689 `Suggests`
(`ws-a/dep-edges.csv`). 256 distinct edge targets: 89 of the 90 site-library packages, 18
base/recommended R packages, and 149 external packages — all 149 reachable **only** via `Suggests`,
so every declared hard dependency of every one of the 90 resolves to something actually present.
(The 90th package, `nflverse` itself, never appears as a target: it is the umbrella meta-package and
nothing depends on it.)

**Reachability: 90 of 90, with zero orphans** — a surprising enough result that it was independently
re-derived with a different algorithm before being accepted (`ws-a/reachability.txt`,
`ws-a/notes.md`). The explanation is a single edge: **`nflplotR` hard-`Imports` `gt`**, which
hard-`Imports` 20 further packages including `htmlwidgets`, which hard-`Imports` `knitr` and
`rmarkdown` — not as `Suggests` — and `rmarkdown` hard-`Imports` `tinytex`. So the entire document
rendering toolchain that looks like leftover vignette cruft is in fact a real, transitively required
hard dependency of `nflplotR`. This library was very likely installed with exactly
`install.packages(c("nflverse","nflreadr","nflfastR","nflseedR","nfl4th","nflplotR"))` and nothing
else.

That one edge is load-bearing for several findings. Dropping `nflplotR` would remove `gt`, `V8` and
its 47.5 MB unverified binary, `juicyjuice`, `reactable`, `knitr`, `rmarkdown`, `tinytex` and most
of the GPL exposure in one move. If Dime does not need styled `gt` tables or NFL logo plotting, that
is the single highest-leverage scope reduction available.

Full manifest with versions, licenses, copyleft class, compilation status and hash verdict:
[Appendix A](appendix/package-manifest.md).

---

## 4. Supply-chain integrity

### 4.1 Checksum verification — 90/90 PASS

`md5_actual` (recomputed locally with `tools::md5sum`) equals the MD5 published in CRAN's index on
the primary source **and** on mirror 2: 90/90. Beyond the required minimum, all 90 tarballs were
re-downloaded in full from both secondary sources and hashed — `cran.wu.ac.at` 90/90 HTTP 200 with
sha256 matching primary 90/90, and `ftp.osuosl.org` likewise 90/90. Task 0's own acquisition log
was not trusted: every sha256 in it was independently recomputed and matched, 90/90.

Index-level comparison across the full CRAN catalogue (24,409 mainline records on primary and
mirror 2, 24,408 on osuosl, after dropping 15 legacy records carrying a `Path:` field so a stale
duplicate cannot shadow a current entry): 8 packages differ in version and 1 exists only on primary,
all consistent with ordinary mirror lag — osuosl is behind in every case and never ahead.
**Same-version-but-different-MD5: 0.**

### 4.2 Archive channel — an explicit no-op

No archive-channel verification was performed because there is nothing to verify: all 90 rows in the
acquisition log are `current` channel, 90 URLs under `/src/contrib/`, none under
`/src/contrib/Archive/`. This was proven from the log rather than skipped silently.

### 4.3 Clean reinstall — 6/6 clean

Each target was reinstalled from its verified tarball into a throwaway library. All six exited 0;
all six are `NeedsCompilation: no`, so no toolchain variance is in play. File lists were identical
in both directions — 0 files only-in-live, 0 only-in-rebuilt. Exactly 7 files differ per package,
the same 7 every time, and five of them sat outside the expected-differ set and were therefore
opened and compared semantically rather than waved through:

| File | Resolution |
|---|---|
| `DESCRIPTION` | `Built:` timestamp line only |
| `Meta/package.rds` | `DESCRIPTION$Built` + `Built$Date` only |
| `R/<pkg>.rdb` | Opened with `lazyLoad()`. Object-name sets identical; `deparse(control="all")` identical for **every object in all 6 packages**. The one differing object is `.__NAMESPACE__.`, and within it the one differing key is `path` — a necessary consequence of installing with a different `-l` |
| `R/<pkg>.rdx` | Every code blob has identical compressed length; the reference blob embedding that `path` string grew by exactly the path-length delta, and that same constant is the offset shift applied to every later blob. Causally closed |
| `help/<pkg>.rdb` | All 159 Rd topics across the 6 packages initially compared unequal. Traced to build-time path attributes nested inside `Rd_option` **attribute values** — a first strip pass missed those and left 74 topics apparently differing; the recursion was fixed rather than the residue explained away. After stripping: **0 of 159 topics differ**, corroborated by identical `Rd2txt()` rendering |
| `help/paths.rds` | Character vector of `.Rd` paths inside the ephemeral staging directory; identical once the staging prefix is stripped. Its one attribute, an integer `first` marking where the package-relative path begins, shifts by exactly the staging-directory name-length delta in all 6 cases — and `nflfastR`, the one package whose two staging directory names happened to be the same length, is the one package whose attributes were already identical, which is what the explanation predicts |

**Verdict: 6/6 clean, 0 unexplained deviations.** A marker file confirmed `$LIB` was never written
during any of this (`find $LIB -newer <marker>` returns 0 files).

### 4.4 GitHub tag diff — 6/6 no content divergence, one bookkeeping defect

Tag format was discovered via `git ls-remote --tags` rather than guessed: plain `v<version>`.
Repo-only paths were matched against each repo's **actual** `.Rbuildignore` using R CMD build
semantics, applied to the path and every ancestor directory (because R CMD build prunes whole
directories), and every one is attributed to a specific named rule. Tarball-only paths are only
`MD5`, `build/` and `inst/doc/` — standard build artifacts. After CRLF normalisation the only
differing file in all six packages is `DESCRIPTION`, and **shared fields differing in value: 0, in
all 6 packages**.

The one anomaly is a maintainer bookkeeping defect, not tampering. **nflverse's `v1.0.3` tag points
at commit `b8314c594a93` (2022-10-05), whose DESCRIPTION still declares 1.0.2.** The real release
commit is the next one, `6c4f6ad` — "release v1.0.3 to cran (#19)", 2023-08-14. The tag was created
roughly ten months early and never moved. The comparison was run against both bases and both are
emitted in full. Every file under `R/` and `NAMESPACE` is CRLF-only against *either* base: no R code
changed between the tagged 1.0.2 tree and the 1.0.3 release. Practical consequence: that tag cannot
be used naively as a provenance anchor. See [NFLV-016](#nflv-016).

### 4.5 What this section does not prove

Stated plainly so the strong result is not over-read: agreement with CRAN's published MD5 proves the
tarball matches what CRAN serves *today*, not that CRAN's copy was never tampered with. The osuosl
cross-check narrows that — an attacker would need CRAN master and an independent mirror
simultaneously — but does not close it. The reinstall proves the installed bytes are reproducible
from the audited tarball on *this* machine with *this* R; it says nothing about the 84 non-target
packages, verified at tarball level only. And **nothing in this section evaluates whether the code
is safe** — only whether it is authentic. That is §5 and §6.

Most importantly: **§4's integrity result and §5.1's autobrew exposure are disjoint.** WS-B verified
CRAN source tarballs. The autobrew binaries were fetched *by* those tarballs at install time,
outside CRAN's chain of custody entirely. The audit's strongest result does not touch its most
consequential finding, and blurring the two would be the single easiest way to misread this report.

---

## 5. Execution surface

### 5.1 The central finding — unverified binaries in your library

`curl`, `fs`, `V8` and `xml2` each contain a `configure` fallback branch that fetches
`https://autobrew.github.io/scripts/<name>` and dot-sources it into the running configure shell.
Every one of those branches **fired on this machine**, and the static libraries the fetched scripts
downloaded are linked into the installed shared objects:

| Package | Bundle fetched | Now resident in | Proof |
|---|---|---|---|
| `curl` | `curl-macos-8.14.1-universal.tar.xz` | `curl.so`, 838 KB | Install log line "Using autobrew bundle"; `otool -L` shows **no libcurl dylib at all**; `strings` finds `libcurl/8.14.1` |
| `fs` | `libuv-1.52.0-sonoma-universal.tar.xz` | `fs.so`, 220 KB | Install log; links only libSystem/libR/libc++; `strings` finds libuv tokens |
| `V8` | `v8-14.6.202.26-sonoma-universal.tar.xz` | `V8.so`, **47,520,328 bytes** | Install log; links only libR/libc++/libSystem; `strings` finds `14.6.202.26` |
| `xml2` | `libxml2-2.14.4-universal.tar.xz` | `xml2.so`, 1.07 MB | `.deps` fingerprint in log; no libxml2 dylib; `strings` finds `2.14.4` |

Several details make this worse than a generic "install-time RCE" framing:

- **The selector script is unpinned and unchecksummed**, on a mutable GitHub Pages path, and is
  refetched on every build. The bottle URLs *inside* it are version-labelled, so what it points at
  today is stable — but what the path serves tomorrow is not controlled by anything.
- **`fs` prefers the network over code already on disk.** It ships a vendored static libuv in its
  own tarball and will use it if `USE_BUNDLED_LIBUV` is set — but on macOS the fetch branch is
  reached first. That inversion is what makes it a finding rather than a note.
- **`V8`'s branch is effectively unconditional on macOS arm64**, not a "no Homebrew" fallback.
  Homebrew was installed and detected on this machine, and V8 fetched anyway. The fetched script
  then writes `src/Makevars` itself and calls `exit 0`, terminating `configure` before its own
  feature tests ever run — a remote script decides the entire build.
- **`xml2` discards a working configuration to do it.** macOS ships `xml2-config`, `configure`
  queries it successfully, and the maintainer then explicitly rejects that answer and fetches
  instead.
- **`magick` did not fetch.** Homebrew was detected so its macOS branch was skipped, and its other
  branch is guarded on `uname -sm` being `Linux x86_64` — dead code here. It linked Homebrew
  ImageMagick 7 dynamically, confirmed by `otool -L`.
- **Log-grepping is a false negative.** `xml2`'s script contains zero `echo` statements and never
  appears in the install logs at all. If you audit this class of exposure by grepping build logs for
  "autobrew", you will miss it.
- **The artefacts are gone.** Each `cleanup` deleted the fetched script and the extracted archive
  (`fs` uses `rm -f`, which cannot remove the `.deps` directory, so it leaves that one behind).
  There is nothing left to hash against upstream — not now, not retrospectively.

A JIT-compiling JavaScript engine is the worst single item on that list to accept unverified: it
allocates W^X memory and emits native code by design, so a tampered blob would have an unusually
clean path to persistent native execution. No evidence of tampering was found; the bottle tags are
normal autobrew releases and everything moved over TLS. The severity is driven by blast radius and
the total absence of an integrity control, not by an observed anomaly. Full detail:
`ws-c/escalation-reviews/{curl,fs,V8,xml2,magick}.md` and `STRUCTURAL-LIMITATIONS.md` §L4.

### 5.2 Pattern scan and escalation outcomes

The automated scan produced **3,637 rows** across the 90 packages — 2,993 classified benign, 628
notes, 16 findings (`ws-c/pattern-hits.csv`). An honesty caveat the evidence states itself and this
report repeats: **34 of those rows were hand-adjudicated after reading surrounding code; the other
~3,600 were labelled by regex rules against a one-line snippet, with no per-row context read.** A
benign label on a bulk row is a rule's claim, not a verified fact about that line. The reason strings
are deliberately not written to the CSV so nothing downstream inherits an unverified justification.

Two real findings have **no CSV row at all**, because no pattern in the scan matches them, and both
were found by reading files: `nfl4th`'s cleartext ESPN URL (§6.5) and `nfl4th`'s raw-byte
CRAN-detection string ([NFLV-017](#nflv-017)). Treat "no row" as "no pattern matched", never as
"nothing there".

26 escalated packages were reviewed at line level with file:line citations. Outcomes:

| Verdict | Count | Packages |
|---|---:|---|
| FINDING | 7 | curl (High), fs (High), V8 (High + a second Medium), xml2 (High), future (Medium), knitr (Low), memoise (Low) |
| ACCEPTED-RISK | 8 | magick (Medium, [NFLV-009](#nflv-009)); tinytex, parallelly, Rcpp, xfun, rmarkdown, data.table (Low); litedown (Info) — the latter seven consolidated as [NFLV-020](#nflv-020) |
| BENIGN | 11 | juicyjuice, reactR, reactable, evaluate, stringi, withr, rstudioapi, bslib, sass, gt, fontawesome |

Five escalations were upheld and strengthened, two upheld with a narrowed trigger, and **eight were
downgraded on evidence** — which is worth noting as a signal that the escalation process was
adversarial rather than confirmatory. `stringi`'s ICU download, for instance, was proven not to have
occurred by three independent lines of evidence: it pins a commit SHA, it verifies against an md5sum
shipped inside the tarball, and the data file is present in the tarball so the download
short-circuits entirely. `fontawesome` turned out to have no network call at all — two help-text
strings and a method-registering `.onLoad`.

### 5.3 Native code

**932,557 lines of C/C++ across 2,497 files** in top-level `src/` trees were not read (933,771
counting any path containing `/src/`; the extra 1,214 lines are test fixtures not part of any
installed shared object). 38 of 90 packages ship `src/`, and all 38 declare `useDynLib` — including
`cachem`, which `ws-c/native-code-inventory.md` records as an exception but whose `NAMESPACE:17` is
`useDynLib(cachem, .registration = TRUE)`; it registers via `R_init_cachem` *as well*, not instead.
Four packages are roughly 77% of the mass (715,263 of 932,557 lines): `stringi` 540,791 (bundled
ICU 74), `xgboost` 83,413, `vctrs` 49,363, `sass` 41,696 (bundled libsass).

**All six targets ship zero native code** — verified, not assumed: `find -type d -name src` returns
nothing and `grep -c useDynLib NAMESPACE` is 0 for all six. Every bit of native surface is inherited
from the dependency closure.

A targeted pattern scan of that native layer found remarkably little: 97 hits total — 68 `getenv()`
reading documented config variables, 14 `system()` of which **11 are the words "system (" inside ICU
comments** and 3 are a `git clone` in a libsass developer script, 8 `dlopen()` all in vendored
upstream trees, 6 `setenv()`, 1 `popen()`, and **zero `exec*()` and zero `fork()` anywhere in the
closure**. Nothing looks planted. The genuine risk is volume plus transitive supply chain, and it is
carried forward as [NFLV-022](#nflv-022) and §11.

---

## 6. Network and runtime

### 6.1 Static census

**383 unique URL strings across 68 hosts** in the six targets; **7,659 URL strings across 1,096
hosts** across the full 90-package closure (`ws-d/url-census-targets.txt`,
`ws-d/url-census-closure.txt`).

### 6.2 Load-time side effects

Each package was loaded in a fresh `Rscript --vanilla` process with before/after snapshots of
`options()`, `Sys.getenv()`, `search()`, `tempdir()` and `~/Library/Caches`. Most of what shows up
is dependency noise — `data.table` sets ~19 options at its own `.onLoad`. None of the six packages
set any environment variable on load in this environment, and none wrote a tempdir file.

One package is different. **`nfl4th`'s `.onLoad` calls `curl::nslookup("github.com", error = FALSE)`
unconditionally** — confirmed live by tracing `curl::nslookup` during `library(nfl4th)`, not merely
by reading source. The same hook creates its cache directory if absent and otherwise **deletes its
cached games file** whenever that file exists and `options(nfl4th.keep_games)` is not `TRUE`. There
is no option that skips the lookup itself. So `library(nfl4th)` — including transitively via
`library(nflverse)`, which attaches all five core packages — is a network operation and a potential
filesystem mutation before any function is called. On this host the delete branch was a no-op: the
directory pre-existed the audit (mtime `Jul 26 21:26`) and held no games file, recorded explicitly
so it is not misattributed to this audit. See [NFLV-007](#nflv-007).

A related discoverability problem: the three options that actually govern caching behaviour —
`nflreadr.cache`, `nflreadr.verbose`, `nflreadr.cache_warning` — **appear in no Rd topic of the
installed help**, exist only as internal `getOption()` reads in non-exported functions, and are
never written into the options table at load time. You cannot find them by reading the docs or by
introspecting `options()`; you have to already know the names. And `nflreadr.cache` is read exactly
once at `.onLoad`, so setting it after `library(nflreadr)` has no effect. See
[NFLV-023](#nflv-023).

### 6.3 Cache behaviour

Cold and warm runs were executed in separate processes against a filesystem cache. Cold: 6 calls, 5
genuine misses plus one same-key hit, 11.5s wall, 5 cache files totalling 17,482,382 bytes. Warm:
same 6 calls in a fresh process, **all 6 cache hits** measured directly with `memoise::has_cache()`
before each call rather than inferred from timing, 4.2s wall, and the cache directory's file count
and total byte size **byte-for-byte identical before and after** — direct confirmation of zero
fetches, not merely small ones.

Mechanics that matter for the next section: cache keys are `rlang::hash()` over the function's own
source hash plus the URL — never content, never a server ETag or `Last-Modified`. Eviction is a
fixed 24-hour TTL baked into `nflreadr`'s `.onLoad`; there is no size-based eviction, no LRU, and
**no connectivity-aware or content-aware invalidation at all**. The only escapes are
`nflreadr::clear_cache()` (drops everything) or waiting out the TTL.

The one instructive detail: `cachem` re-serializes the *deserialized R object*, so cache files are
always RDS regardless of the source format, and are not the wire bytes. A 160 MB in-memory
play-by-play frame becomes a 14.4 MB cache file.

### 6.4 Offline behaviour — silent failure and cache poisoning

Run offline against a black-hole proxy, **not one of the six calls raised an R-level error.** Every
one took the success branch of a `tryCatch` and returned a normal object — just an empty one.
`load_schedules(2026)` returned `dim 0x1` after three warnings — the connection failure, `nflreadr`'s
own `cli_warn`, and an `Unknown or uninitialised column: 'roof'` fired twice by its own
post-processing (`ws-d/offline-behavior.md`, captured sequence).

The mechanism, from `nflreadr/R/from_url.R:65-78`: `url()` is lazy and never fails on construction;
`readRDS(con)` is where the failure actually happens, and R's own connection layer surfaces it as a
**warning**; the parse error is wrapped in `try(..., silent = TRUE)`; `nflreadr` catches the
try-error and downgrades it to its own `cli_warn()`; and then it **returns an empty
`data.table()` as though that were a valid answer.** (The `0x1` rather than `0x0` shape is
`load_schedules`'s own post-processing auto-vivifying a phantom `roof` column on the empty
table — a small illustration of how a silent-failure design produces increasingly surprising shapes
the further you get from the point of failure.)

Then it gets cached. Because the failure path is a normal `return()`, `memoise` sees an ordinary
cacheable value; the cache directory went from 0 files to 5. A three-step reproduction confirmed
this is a live risk, not a theoretical one: fetch offline, restore the network fully, call again
against the same cache directory — **`dim 0x1` in 0.013 seconds, network not retried.** Independent
review reproduced it end to end and found it worse than first reported: **zero conditions are raised
on the poisoned re-read.** Not even a warning.

The counterpart is the good case, and it is worth stating for balance: offline with a properly warm
cache produced zero warnings, zero errors and full correct data for all six calls. The problem is
narrowly that one undifferentiated cache cannot tell "old but valid data" from "an empty result I
got because I was offline earlier", and its silence is symmetric across both. See
[NFLV-003](#nflv-003).

### 6.5 The serialization channel

**No asset of any format, from any host, in any of the six target packages, is checksummed or
signature-verified before being handed to its deserializer.** The exhaustive grep for
`checksum|sha256|sha-256|md5sum|digest::|signature|gpg|verify.*hash|hash.*verify|integrity` across
all six packages' entire R source returns zero matches. So does a grep for any TLS override
(`ssl_verifypeer`, `ssl_verifyhost`, `insecure`, `CURLOPT_SSL*`) — the only transport protection is
whatever `curl`'s and base R's `url()`'s *default* certificate verification provides, unmodified.

Formats and paths observed:

| Format | Consumer | Deserializer | Status |
|---|---|---|---|
| rds (default) | `nflreadr::rds_from_url()` — backs `load_schedules`, `load_players`, `load_rosters`, `load_pbp`, `load_teams` | base `readRDS()` via a bare `url()` connection | Live, all 24 fetch-log rows |
| rds (model) | `nfl4th:::raw_rds_from_url()` — an independently duplicated copy of the same pattern | `readRDS()` **then** `xgboost::xgb.load.raw()`, a second C++-side deserializer | Live-verified: fetched a 7,663,086-byte `wp_model.rds` and produced a working booster |
| rds (raw games) | `nflfastR:::load_raw_game()` / `read_raw_rds()` — a **third** independent implementation, via `gzcon(rawConnection(raw))` | `readRDS()` | Source-verified |
| **Rdata** | `nflfastR:::add_dakota()` | **`load()`** — injects named objects into a live function frame | Source-verified; see below |
| csv | `csv_from_url()` → `data.table::fread()` | text parser | Non-default; verified live once |
| parquet | `parquet_from_url()` → `arrow::read_parquet()` | Arrow C++ | Unreachable — `arrow` is not installed; fails loud before any network attempt |
| qs | `qs_from_url()` | — | Dead code: `lifecycle::deprecate_stop()`; the qs package was removed from CRAN 2026-01-17 |

The rds pattern is independently re-implemented **at least three times** across this codebase, and
none of the three copies added a check the others lack. `nflseedR` fetches nothing at all — it is a
pure simulation engine over data the caller already holds.

`add_dakota()` deserves separate mention. It opens a `url()` on a remote `.Rdata` and calls
`load(con)`. `load()` is a strictly larger trust surface than `readRDS()`: rather than returning a
value the caller inspects, it deserializes an entire saved workspace's *named objects* directly into
the calling frame. The code simply trusts that a variable called `dakota_model` will appear —
pre-initialised to `NULL`, so a tampered or missing load degrades silently to "model unavailable" —
and passes it into `mgcv::predict.gam()`. See [NFLV-006](#nflv-006).

The closest thing to a safety mechanism anywhere in the six packages is `nfl4th`'s `is.raw()`
format-sniff on its cached model — and that exists to detect nfl4th's *own past cache-format
changes*, not to validate origin. A malicious raw vector passes it trivially.

**What this means concretely.** The entire trust chain reduces to TLS to the resolved host plus
GitHub's access controls over who can publish a release asset to four nflverse-org repos —
`nflverse-data`, `nfldata`, `nfl4th` and `nflplotR` (`ws-d/serialization-channel.md`). Two further
nflverse-org repos are read over non-release paths: `nflfastR-raw` (raw per-game scrape files) and
`nflfastR-data` (the `add_dakota()` `.Rdata`). Nothing downstream of transport is re-checked. The
most consequential attack does not require a deserialization exploit at
all: **a payload that decodes to a structurally valid but factually wrong data frame is accepted
with no warning** and flows into anything that trusts `load_schedules()`, `load_pbp()` or nfl4th's
win-probability model. For a wagering product, that is the failure mode to design against.

Separately, R's native serialization format is not a passive data format the way JSON is — it can
encode closures, environments and promises, and `readRDS`/`load` of untrusted input is a documented
risk area for R specifically (CVE-2024-27322 being the commonly cited example). This audit did not
construct or test any such payload; it is noted as public context for why this specific ecosystem
warrants the concern, not as a demonstrated exploit.

### 6.6 Hosts actually contacted

The dynamic fetch log records 24 rows, and **exactly one host appears in it: `github.com`**, which is
in-census. But going one layer deeper found something the log structurally cannot see. GitHub
release-asset URLs return HTTP 302 to `https://release-assets.githubusercontent.com/...` (a signed,
time-limited URL), verified both from the shell and from R. **That host appears nowhere in the
90-package static census** — expected, since it is minted per request. It is also not
`objects.githubusercontent.com`, the name the audit plan anticipated. Redirect-following happens
inside libcurl, below any R-level hook, so no source-derived allowlist would ever contain it.
Practical consequence for egress control: see [NFLV-021](#nflv-021).

**One fetched endpoint is cleartext.** `nfl4th::get_4th_plays()` builds a plaintext
`http://site.api.espn.com` URL by `paste0()` and fetches live in-game state from it. It is the only
non-TLS endpoint among all endpoints actually fetched by the six targets. The payload is JSON, so
the R-deserialization risks above do not transfer — but an unencrypted transport for live game data
feeding a real-time decision-support computation is a distinct problem, and for a real-money product
it is the most immediately actionable item in this section. See [NFLV-004](#nflv-004).

---

## 7. Licensing and data provenance

**This section describes and flags. It contains no legal conclusions, and none should be inferred.**
Nine items requiring counsel are listed in `ws-e/commercial-posture.md` §5.

### 7.1 Code licensing

| copyleft class | count |
|---|---:|
| none (permissive) | 72 |
| weak (LGPL / MPL) | 4 |
| strong (GPL family) | 14 |
| **total** | **90** |

**All six targets are `MIT + file LICENSE`** — none of the copyleft exposure originates in
nflverse's own code. Two entries are first-order rather than distant:

- **`data.table` (MPL-2.0) is a direct `Imports` of 5 of the 6 targets** — nfl4th, nflfastR,
  nflplotR, nflreadr, nflseedR — verified edge by edge in `ws-a/dep-edges.csv`. Its LICENSE file was
  read in full (373 lines) and is the unmodified MPL 2.0 text, no dual-license surprise.
- **`gsubfn` (GPL >= 2) is a direct `Imports` of `nflseedR`**, pulling `proto` (GPL-2) with it.

The rest of the GPL exposure is transitive tooling that enters almost entirely through the
`nflplotR → gt` edge from §3: `rmarkdown`, `knitr`, `highr`, `mime`, `base64enc`, `bitops`,
`htmltools`.

**No AGPL exists anywhere in the closure.** This was checked explicitly and the negative
independently re-derived: the two files that match a case-insensitive `AGPL|Affero` grep
(`data.table/LICENSE` and `vctrs/LICENSE.note`) match only inside MPL-2.0's own §1.12 definition of
"Secondary License", not as a grant of any code. CeCILL and EPL: zero hits. The absence matters —
AGPL is the one license in this family whose copyleft trigger is *network use* rather than
distribution, and its absence is what makes a server-side-only reading available to discuss at all.

Two file-level grants hide inside otherwise-permissive packages and were found only by reading
LICENSE files rather than trusting declared fields: `stringi` ships `stri_stats_latex()` under
GPL-2.0-or-later inside an otherwise BSD-3-Clause-style package, and `vctrs` ships
`src/order-*.c|h` under MPL-2.0 inside an otherwise-MIT package. Separately, `highr`, `knitr` and
`mime` declare a bare `License: GPL` with **no version qualifier at all**.

GPL/LGPL/MPL obligations are conventionally understood to attach on distribution rather than private
or internal use. Which scenario describes Dime's actual deployment is an architectural question this
audit did not investigate, and it is counsel item 1. See [NFLV-011](#nflv-011).

### 7.2 Data licensing

`nflverse/nflverse-data` — the repository whose GitHub Releases every one of the six packages
ultimately reads from — is **CC-BY-4.0**, confirmed via the GitHub license API and by reading the
full 18,647-character `LICENSE.md`. GitHub's structured summary lists permissions `commercial-use`,
`modifications`, `distribution`, `private-use`, with conditions `include-copyright` and
`document-changes`.

**A non-commercial clause search returned zero hits everywhere it could be run**: all 90 packages'
DESCRIPTION and LICENSE files, the full CC-BY-4.0 text, nflreadr's Terms of Use and LICENSE pages,
the automation-status article, the FTN charting dictionary page, and the nflverse GitHub org profile.
CC-BY-4.0 is the "BY" variant, not "BY-NC" — the absence is structural, not merely undetected.

Three things qualify that, and all three are quoted verbatim from primary sources in
`ws-e/data-licensing.md`:

1. **Attribution is a condition, not a courtesy.** §3(a) requires creator identification, a
   copyright notice, a notice referring to the license, a warranty disclaimer, a URI to the licensed
   material, and an indication of any modifications — *if You Share the Licensed Material*. §4
   extends the same conditions to sui generis database rights over a substantial portion of the
   contents, which matters because nflverse-data is fundamentally a database.
2. **nflverse explicitly declines to assert that its grant covers the underlying data.** nflreadr's
   own Terms of Use: *"The R code for this package is released as open source under the MIT License.
   NFL data accessed by this package belong to their respective owners, and are governed by their
   terms of use."*
3. **The grant excludes trademark outright.** CC-BY-4.0 §2(b)(2): *"Patent and trademark rights are
   not licensed under this Public License."* So NFL team names, logos and "Next Gen Stats" are
   untouched by it. No affiliation or trademark disclaimer of any kind was found anywhere in
   nflverse's own documentation — worth flagging to counsel precisely because its absence means
   nflverse publishes no position on it.

The upstream provenance chain reads as a community pipeline rather than a licensed commercial data
partnership: nflscrapR lineage, named individual contributors, GitHub Actions automation, and
scraping of NFL.com, Next Gen Stats, Pro Football Reference and FTN Fantasy. **None of those four
upstream parties' own terms of service were reviewed** — they were outside this audit's approved
network scope. See [NFLV-010](#nflv-010).

### 7.3 Feed stability is a product risk, not just a licensing one

nflverse's own automation-status article documents that **two upstream feeds have already died**:

> **Injuries:** "Our data source died after the 2024 season. At the moment, there is no 2025 data
> and there is no ETA yet as to when we will be able to make injury data available again."

> **Participation:** "Participation data prior to 2023 is from NFL NGS. The data source died during
> the 2023 season. Participation data from 2023 onwards is courtesy of FTN and is provided after all
> post-season games are completed. It does not update during the season!"

`dictionary_injuries` documents 16 fields back to 2009 and currently has no data and no replacement
source. This is nflverse's own admission, which makes "an upstream source disappears" demonstrated
history for this pipeline rather than a hypothetical. Distribution is also a single point of failure:
GitHub Releases on one organisation's repos, updated by GitHub Actions. See
[NFLV-012](#nflv-012) — and note that the mirroring in gate G2 hedges this risk as well as the
integrity one.

---

## 8. API, schema and Dime mapping

### 8.1 Surface

**132 exported symbols** across the six targets — nflreadr 54, nflplotR 28, nflfastR 27, nflseedR
12, nfl4th 7, nflverse 4 (116 functions, 11 re-exports, 5 non-function data objects). Full listing
with signatures and titles: [Appendix C](appendix/exports-inventory.md).

**22 shipped data dictionaries totalling 1,286 field rows.** Largest are `dictionary_pbp` at 372
fields and `dictionary_ff_opportunity` at 218. Full field lists: [Appendix D](appendix/data-dictionaries.md).

A caveat before anyone generates an ingestion schema from these: **the dictionaries contradict each
other and themselves on types.** `dictionary_pbp` documents `game_id` as character with the
description "Ten digit identifier for NFL game", but the live format is the underscore-joined
`season_week_away_home` string; `dictionary_schedules` has the correct prose for the same field but
declares it numeric, which cannot be right for a string containing letters and underscores.
`espn_id` is numeric in one dictionary and character in two others. Derive types from a loaded
sample, not from the `type` columns. See [NFLV-024](#nflv-024).

### 8.2 Mapping to Dime's NFL 2026 dataset

Ten concepts were compared against Dime's actual repo artifacts — `drizzle/nfl.schema.ts`,
`drizzle/0118_dark_gateway.sql`, `shared/kickoffDate.ts` and the seed JSONs — counted and
spot-checked directly rather than trusted from prose. Three results matter.

**The betting columns.** `dictionary_schedules` (45 fields) ships `away_score`, `home_score`,
`result`, `total`, `overtime`, `away_moneyline`, `home_moneyline`, `spread_line`,
`away_spread_odds`, `home_spread_odds`, `total_line`, `over_odds`, `under_odds` and `div_game`.
**Dime's `nfl_games` table has none of them** — no scores, no lines, nothing betting-related; it is
purely schedule and metadata. This is the single highest-relevance gap in the whole comparison:
historical closing lines and results are exactly what backtesting and calibration need, they are
already sitting in the frame Dime is closest to ingesting, and backfilling them later is materially
harder than capturing them on first load. See [NFLV-013](#nflv-013).

**A documentation drift on Dime's own side.** The `kickoff-datetime-convention` memory note states
the schema shape is `kickoff_utc`, `kickoff_date`, `kickoff_time_et`. The implemented schema has
**no `kickoff_time_et` column** — only `kickoff_utc`, `kickoff_date` and `time_valid` are persisted,
with ET derived at read time. Worth correcting because nflverse persists exactly what the note says
Dime should: `gametime`, 24-hour, always Eastern regardless of venue. See [NFLV-018](#nflv-018).

**Team abbreviations disagree for 2 of 32.** Dime stores ESPN-sourced `LAR` and `WSH`; nflreadr's
`team_abbr_mapping` canonicalizes to `LA` and `WAS`. Every other team checked agrees. Any join on
abbreviation silently drops or mis-attributes Rams and Commanders rows, silently because both sides
are valid non-null strings. Join on ESPN numeric ids — the project's own CFB crosswalk convention
already mandates exactly this. See [NFLV-019](#nflv-019).

Other structural differences are real but expected: nflverse uses a composite `game_id`
(`{season}_{week}_{away}_{home}`) where Dime uses the raw ESPN `event_id`, though nflverse also
ships an `espn` column that is structurally the same key, so the join is available. nflverse embeds
venue as a bare `stadium_id`/`stadium` pair where Dime normalizes a `nfl_venues` entity with geo and
capacity. nflverse has no TBD or time-validity flag at all — unplayed games are implied by null
scores. nflverse encodes playoff round as a queryable `game_type` enum (`REG`/`WC`/`DIV`/`CON`/`SB`)
where Dime encodes it as a convention over `week` documented only in a source comment.

### 8.3 What nflverse would add

Beyond the betting columns: play-by-play with derived analytics (372 fields, including `epa`, `wp`,
`wpa`, `cpoe`, full situational state at play granularity), injury reports, player contracts, depth
charts, snap counts, FTN manual play-charting, player and team box scores (114 and 102 fields), Next
Gen Stats tracking metrics, PFR advanced stats, ESPN QBR, combine and draft history, trades, and a
cross-platform player-id crosswalk covering roughly 20 platforms. Dime currently has no equivalent
for any of these. `dictionary_players` alone carries 39 identity fields against Dime's 9.

---

## 9. Dependency risk and currency

**All 90 packages are CRAN-current** — 90 current, 0 outdated, 0 archived-or-missing, checked
against a freshly fetched `available.packages()` returning 24,395 packages, and independently
spot-checked against CRAN's raw `PACKAGES` file for six packages. There is no patch backlog to work
through, which is a genuinely good result and rare for a stack this size.

Three of six targets have unreleased dev-branch commits ahead of their CRAN release — `nflfastR`
5.2.0.9012, `nflseedR` 2.0.2.9000, `nflverse` 1.0.3.9001. The other three (`nfl4th`, `nflplotR`,
`nflreadr`) are identical to their GitHub HEAD. This is normal R development convention, not drift,
but it does mean any bug you hit in those three may already be fixed only on a dev branch.

The real dependency risk in this stack is not staleness. It is:

1. **Breadth from one edge.** `nflplotR → gt` alone pulls the whole rendering toolchain into a hard
   dependency closure that would otherwise be roughly half the size, and brings `V8`, most of the
   GPL exposure, and several accepted-risk execution surfaces with it (§3, §5.2, §7.1).
2. **Vendored upstream projects with their own CVE histories.** ICU 74, libsass, cmark-gfm, libyaml,
   yajl, cctz, utf8lite and xgboost's dmlc/rabit are wholesale vendored copies whose supply chains
   are entirely out of this audit's scope (§5.3).
3. **Statically linked libraries that do not receive OS patches.** The four autobrew binaries —
   libcurl 8.14.1, libxml2 2.14.4, libuv 1.52.0, V8 14.6.202.26 — will not be updated by
   `brew upgrade`. Patching them means rebuilding the R package (§5.1).

---

## 10. Findings register

Full claims, evidence paths, impact and recommendations for every row:
[`appendix/findings-register.csv`](appendix/findings-register.csv).

| id | sev | title |
|---|---|---|
| <a id="nflv-001"></a>NFLV-001 | High | Unpinned autobrew fetch left unverified third-party static libraries inside four installed shared objects |
| <a id="nflv-002"></a>NFLV-002 | High | No integrity verification anywhere before deserialization; live network bytes stream straight into `readRDS` |
| <a id="nflv-003"></a>NFLV-003 | High | Offline fetch failure is silent, is cached as a success, and keeps being served after connectivity returns |
| <a id="nflv-004"></a>NFLV-004 | Medium | Live game state for a decision-support computation is fetched over cleartext HTTP |
| <a id="nflv-005"></a>NFLV-005 | Medium | V8 executes bundled JavaScript inside the R process with the JS-to-R escape hatch enabled by default |
| <a id="nflv-006"></a>NFLV-006 | Medium | `nflfastR add_dakota()` `load()`s a remote `.Rdata` into a live function frame |
| <a id="nflv-007"></a>NFLV-007 | Medium | `nfl4th` performs an unconditional DNS lookup and can delete a user cache file on every `library()` call |
| <a id="nflv-008"></a>NFLV-008 | Medium | `future`'s `.onAttach` sources `.future.R` from the current working directory into the global environment |
| <a id="nflv-009"></a>NFLV-009 | Medium | Remote image bytes reach the system ImageMagick parser through nflplotR |
| <a id="nflv-010"></a>NFLV-010 | Medium | CC-BY-4.0 attribution conditions apply and nflverse expressly disclaims that its grant covers the underlying NFL data |
| <a id="nflv-011"></a>NFLV-011 | Medium | 14 GPL-family and 4 weak-copyleft packages sit in the hard-dependency closure, two of them first-order |
| <a id="nflv-012"></a>NFLV-012 | Medium | Two upstream nflverse data feeds have already died |
| <a id="nflv-013"></a>NFLV-013 | Medium | Dime's `nfl_games` schema discards the betting lines and results nflverse already ships |
| <a id="nflv-014"></a>NFLV-014 | Low | `memoise`'s filesystem cache `readRDS` makes the closure's unverified-deserialization trust persistent |
| <a id="nflv-015"></a>NFLV-015 | Low | `knitr`'s `R_KNITR_OPTIONS` is an environment-variable code-injection point |
| <a id="nflv-016"></a>NFLV-016 | Low | The nflverse `v1.0.3` git tag points at a commit whose DESCRIPTION declares 1.0.2 |
| <a id="nflv-017"></a>NFLV-017 | Low | `nfl4th` hides its CRAN-detection string as raw bytes so a source grep will not find it |
| <a id="nflv-018"></a>NFLV-018 | Low | A Dime memory note describes a `kickoff_time_et` column that does not exist in the implemented schema |
| <a id="nflv-019"></a>NFLV-019 | Low | Dime and nflverse disagree on team abbreviations for at least 2 of 32 teams |
| <a id="nflv-020"></a>NFLV-020 | Low | Seven closure packages carry call-time execution surfaces that were accepted rather than closed |
| <a id="nflv-021"></a>NFLV-021 | Info | Release-asset downloads terminate on a host that appears nowhere in the static URL census |
| <a id="nflv-022"></a>NFLV-022 | Info | 932,557 lines of C/C++ and roughly 30 MB of bundled JavaScript were not read |
| <a id="nflv-023"></a>NFLV-023 | Info | nflreadr's three most important behaviour-controlling options are absent from the installed documentation |
| <a id="nflv-024"></a>NFLV-024 | Info | The shipped nflverse dictionaries contradict each other and themselves on field types |
| <a id="nflv-025"></a>NFLV-025 | Info | The two CRAN mirrors named in the audit plan turned out to be a single origin |

---

## 11. Limitations

Everything this audit did **not** establish, stated so no one over-reads what it did.

**L1 — 932,557 lines of C/C++ were not read.** Compiled code was reviewed at pattern level only.
The exposure is volume plus transitive supply chain, not a suspected backdoor. Compensating
evidence is genuine: those bytes are byte-identical to what CRAN publishes across three sources, and
the targeted native scan found zero `exec*()` and zero `fork()` anywhere. Proportionate next steps
and their costs are in `ws-c/escalation-reviews/STRUCTURAL-LIMITATIONS.md` §L1.

**L2 — roughly 30 MB of bundled JavaScript and CSS was not reviewed.** Most of it executes in a
browser, which bounds it. Three bundles do not: `juicyjuice`'s `bundle.js`, `reactR`'s
`babel.min.js` and `reactable`'s `reactable.server.js` are fed to V8 and **execute inside the R
process**, where `console.r.eval()` reaches global scope. None of the three is fetched over the
network — all three `ctx$source()` calls were confirmed to read `system.file()` paths.

**L3 — install provenance: RESOLVED.** This began as a limitation and was closed. All 90 packages
were compiled from source on this host, all from `cloud.r-project.org`, zero binary installs. The
resolution is what turned E1 from "severity unknown" into [NFLV-001](#nflv-001).

**L4 — the 2026-07-26 autobrew bundles are unrecoverable.** `cleanup` destroyed both the fetched
scripts and the extracted archives. There is nothing left to hash against upstream, and there never
will be. The only evidence of what was linked is the `.so` files themselves. Forward remediation is
possible (rebuild with `DISABLE_AUTOBREW=1` and compare; or re-fetch today's bundles and record
their hashes as a forward baseline); retrospective verification is not.

**L5 — the original install-time tarballs are gone.** Verification is against present-day CRAN
artifacts (§2.4). The clean reinstall closes most of this gap; it cannot close all of it.

**L6 — bulk pattern classifications are rule output, not per-row evidence.** 34 of 3,637 rows were
hand-adjudicated. The rest carry a regex rule's label against a one-line snippet.

**L7 — scan coverage is narrower than the brief specified.** Beyond the brief's own `inst/doc`
exclusion, the scanner also skipped `inst/docs`, `inst/html`, `inst/examples` and `inst/NEWS` — 103
files, 40 of them R. Three real hits fall in that gap; all three were located by targeted
verification and added to the CSV by hand, and none changes a conclusion.

**L8 — upstream terms of service were not reviewed.** NFL.com, NFL Next Gen Stats, Pro Football
Reference and FTN Fantasy all appear in the provenance chain. None was in the approved network
scope. No legal conclusion of any kind is offered anywhere in this report.

**L9 — some paths were source-verified but not exercised.** `add_dakota()`'s remote `load()`,
`nflplotR`'s headshot map fetch, and `nflfastR`'s raw-game debug path were read but not run live.
Two runtime paths are unreachable in this environment and were confirmed as such rather than assumed:
parquet (the `arrow` package is not installed; it fails loud before any network attempt) and
`nflverse_download()` (requires `piggyback` and `gh`, neither installed).

**One evidence contradiction, surfaced rather than smoothed.** Two files in the evidence tree give
different figures for the unread native-code volume. `ws-c/escalations.md` §L1 and
`ws-c/escalation-reviews/STRUCTURAL-LIMITATIONS.md` §L1 both say "~892,000 lines".
`ws-c/native-code-inventory.md` says **932,557** and explicitly documents that the earlier ~892,000
figure was derived by summing a per-package table and was simply wrong. This report uses 932,557,
because `native-code-inventory.md` states its counting basis as a reproducible command and the two
other files inherited the superseded number. The discrepancy does not affect any conclusion — both
figures support the same limitation — but the stale figure remains in two evidence files and anyone
citing them should use the corrected one.

---

## 12. Recommendations

Ordered by what they close and when to do them.

### 12.1 Before adopting — the four gates

**G1. Rebuild the R library without the autobrew path.** Closes [NFLV-001](#nflv-001). Effort: hours.

- Preferred: install binaries. `options(repos = c(CRAN = "https://p3m.dev/cran/latest"))` plus
  `install.packages(..., type = "binary")` — `configure` never runs, no install-time network fetch,
  and each artefact is one CRAN-checksummed object. This removes the entire class.
- If source builds are required: set `DISABLE_AUTOBREW=1` (and `USE_BUNDLED_LIBUV=1` for `fs`),
  supply the libraries yourself via `PKG_CONFIG_PATH`, and verify with `otool -L` that each `.so`
  links a real dylib rather than hiding a static copy. A correctly built `V8.so` is small, not 47 MB.
- Either way: build on an egress-restricted host so a source install **fails loudly** instead of
  silently fetching, and record `otool -L` output for `curl.so`, `fs.so`, `V8.so` and `xml2.so` as a
  build-provenance artefact. That output is the only durable evidence of which branch was taken.
- Track CVEs against libcurl 8.14.1, libxml2 2.14.4, libuv 1.52.0 and V8 14.6.202.26 until the
  rebuild lands. Statically linked copies get no OS patching.

**G2. Mirror the data; never fetch nflverse inside a request path.** Closes
[NFLV-002](#nflv-002), [NFLV-003](#nflv-003), [NFLV-014](#nflv-014), and hedges
[NFLV-012](#nflv-012). Effort: days.

- Run a scheduled ingestion job that pulls each nflverse release asset, records a SHA-256 at ingest,
  and writes to Dime-controlled storage. Verify the pinned hash on every read. Treat a hash change
  on a *historical* asset as an event to review before promotion — historical play-by-play should
  not change.
- Assert non-emptiness explicitly at every loader call site (`nrow` above an expected floor) and
  fail hard. The package will not do this for you: it returns an empty frame and a warning.
- Do not rely on `memoise` for correctness. If filesystem cache mode is used anywhere, call
  `nflreadr::clear_cache()` after any run that emitted a fetch warning, and treat the cache
  directory as a trust boundary with restrictive permissions, never shared between users or jobs.
- Set `options(nflreadr.cache = ...)` **before** `library(nflreadr)` — it is read once at load time —
  and record the intended values in Dime's runbook, since they are absent from the package docs.
- Mirroring also removes the single-point-of-failure exposure to GitHub Releases and gives you a
  local copy if another upstream feed dies.

**G3. Keep the cleartext ESPN path off wagering surfaces.** Closes [NFLV-004](#nflv-004). Effort:
hours. Either source live game state from a TLS endpoint Dime controls, or proxy
`get_4th_plays()`'s call through an https gateway and validate the response shape before it reaches
any model. Do not ship it as-is.

**G4. Counsel review before nflverse-derived data reaches users.** Closes [NFLV-010](#nflv-010),
[NFLV-011](#nflv-011). External dependency. Take the 9-item list in `ws-e/commercial-posture.md` §5.
Priority order: (a) whether Dime's use constitutes "Sharing" under CC-BY-4.0 §3(a), which determines
whether attribution is required and in what form; (b) whether nflverse holds the rights it is
licensing, given its own disclaimer; (c) NFL trademark clearance, which the CC-BY grant explicitly
does not cover; (d) which distribution scenario applies for the 18 copyleft packages, with
`data.table` first because it is first-order on 5 of 6 targets; (e) upstream vendor terms,
particularly FTN Fantasy as a named commercial vendor.

### 12.2 Do before writing the first ingestion

- **Capture the betting columns.** Extend `nfl_games`, or add a sibling `nfl_game_lines` table, with
  the score, result, total and line/odds columns from `dictionary_schedules` before ingesting
  schedules. Backfilling closing lines later is materially harder than capturing them at ingest.
  [NFLV-013](#nflv-013)
- **Join on ESPN numeric ids, never on team abbreviations.** Use `nflreadr::team_abbr_mapping` /
  `clean_team_abbrs()` as an explicit canonicalization step wherever an nflverse abbreviation must
  be consumed. [NFLV-019](#nflv-019)
- **Reconcile the `kickoff_time_et` memory note** against the implemented schema — correct the note
  or add the column, deliberately. [NFLV-018](#nflv-018)
- **Derive ingestion types from a loaded sample**, not from the dictionaries' `type` columns.
  [NFLV-024](#nflv-024)
- **Build the egress allowlist from observed traffic**, not from a source grep. It must include
  `release-assets.githubusercontent.com` and `raw.githubusercontent.com` alongside `github.com`, and
  must account for `nfl4th`'s load-time DNS lookup. [NFLV-021](#nflv-021), [NFLV-007](#nflv-007)

### 12.3 Scope reduction worth considering

**Ask whether Dime needs `nflplotR`.** That one package's hard `Imports: gt` is responsible for a
disproportionate share of everything in this report: `V8` and its 47.5 MB unverified binary, the
`juicyjuice`/`reactable` in-process JavaScript, `knitr`/`rmarkdown`/`tinytex`/`markdown`/`litedown`
and their execution surfaces, and most of the GPL exposure. If Dime consumes nflverse data
programmatically and renders its own UI — which is what a React + tRPC platform does — then
`nflplotR` buys plotting Dime will not use, at a substantial cost in attack surface, license
complexity and closure size. Removing it is the highest-leverage single change available after G1.

### 12.4 Hardening if the stack stays as-is

- `options(nfl4th.keep_games = TRUE)` before loading, and redirect all three packages' caches with
  `R_USER_CACHE_DIR`. [NFLV-007](#nflv-007)
- `R_FUTURE_STARTUP_SCRIPT=FALSE` in the environment of any process that attaches `future` or
  `furrr`, and never run one with an untrusted working directory. [NFLV-008](#nflv-008)
- If any Dime code creates a V8 context, use `V8::v8(console = FALSE)` and never pass a URL to
  `ctx$source()`. [NFLV-005](#nflv-005)
- Do not let untrusted input reach the environment of R processes (`R_KNITR_OPTIONS`).
  [NFLV-015](#nflv-015)
- Pin nflverse by commit `6c4f6ad`, not by the `v1.0.3` tag, anywhere a git ref is used.
  [NFLV-016](#nflv-016)
- Keep Homebrew ImageMagick patched, and do not render images from URLs Dime does not control.
  [NFLV-009](#nflv-009)

### 12.5 Highest-value follow-up work not done here

**CVE-map the vendored library versions** — ICU 74, libxml2 2.14.4, libcurl 8.14.1, libuv 1.52.0,
V8 14.6.202.26, libsass, cmark-gfm. Roughly half a day, and it is the highest-value single action
available because it produces an actionable patch list rather than a statement of unknowns.
Version-diffing the vendored copies against their named upstream releases is a further one to two
days and converts roughly 700,000 of the 932,557 unread lines from "unread" to "unmodified relative
to a named release". [NFLV-022](#nflv-022)

---

*Evidence tree: 154 files, 2,840,539 bytes under `$ROOT/evidence/`. `$ROOT` is a session scratchpad;
a verbatim copy was preserved 2026-07-27 at
[`docs/audits/2026-07-26-nflverse-evidence/`](2026-07-26-nflverse-evidence/) — see §2.5.
Section-to-evidence mapping and reproduction commands: [Appendix E](appendix/evidence-index.md).*
