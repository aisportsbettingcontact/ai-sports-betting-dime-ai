# WS-B — Supply-chain integrity: evidence notes

Run date: 2026-07-27 (UTC), macOS/darwin 25.5.0, R 4.6.1 "Happy Hop", git 2.55.0
LIB under audit: `/opt/homebrew/lib/R/4.6/site-library` (READ-ONLY — verified untouched, below)
ROOT: `/private/tmp/claude-501/-Users-danielwalker-src-ai-sports-betting-dime-ai/dd3b2b85-766c-4b7b-a98c-d928cffcbac2/scratchpad/nflverse-audit`

## Summary counts

Raw logs backing every claim below are in `raw-logs/` (with the scripts that
produced them in `raw-logs/scripts/`), so this evidence tree stands alone.

| Check | Result |
|---|---|
| `hash-verification.csv` rows | 90 (0 empty verdicts) |
| Verdicts | **PASS 90 / FAIL 0 / GAP 0** |
| Reinstall diff reports | 6/6 written, **0 unexplained deviations** |
| GitHub diff reports | 6/6 written, **0 content divergences** |
| Repo-only paths unexplained by a real rule | 0 (across all 6) |
| Tarball-only paths that are not build artifacts | 0 (across all 6) |
| Evidence gaps | 0 (see "Evidence gaps" below) |

## Step 1 — PACKAGES indices from both mirrors

Full detail in `mirror-crosscheck.txt`. Headline results:

- primary `cloud.r-project.org` and mirror-2 `cran.wu.ac.at` returned **byte-identical**
  indices (sha256 `182704d9…`, 7,015,149 bytes).
- **Caveat that materially limits what this proves:** `cran.wu.ac.at` answers with
  `HTTP/2 301 → https://cran.r-project.org/src/contrib/PACKAGES`, and
  `cloud.r-project.org` is a CloudFront CDN (`via: …cloudfront.net`,
  `x-amz-cf-pop: LAX54-P1`) in front of the same CRAN master. The two "mirrors"
  named in the constraints are therefore **the same origin**. Their agreement is
  *not* independent corroboration and is not reported as such.
- To get real host independence the designated fallback
  `ftp.osuosl.org/pub/cran` (→ `ftp2.osuosl.org`) was also fetched. It is a genuine
  rsync mirror on separate infrastructure.
- Parsing used `read.dcf` (R's own DCF parser), not grep, so wrapped fields cannot
  corrupt the triples. Records carrying a `Path:` field (15 legacy entries for older
  R versions) were dropped so a legacy duplicate cannot shadow a current entry;
  24,409 mainline records remain on primary/mirror2, 24,408 on osuosl.
- Full-index primary vs osuosl: 8 packages differ in version and 1 (`jamba`) exists
  only on primary — all consistent with ordinary mirror lag (osuosl is behind in
  every case, never ahead). **Same-version-but-different-MD5 across the whole
  24.4k-package index: 0.** That is the meaningful integrity signal.
- For our 90: version agreement 90/90 on all three sources; MD5 agreement 90/90 on
  all three sources.

## Step 2 — Current-channel tarball verification

- `md5_actual` (via `tools::md5sum`) == `md5_index_primary` == `md5_index_mirror2`: **90/90**.
- Re-computed sha256 of every Task-0 tarball == the sha256 recorded in
  `acquisition-log.csv`: **90/90** (Task 0's log independently re-verified, not trusted).
- Only rows where installed version == index version were compared; that condition
  held for all 90, so no row was skipped.

Beyond the brief's minimum, all 90 tarballs were **re-downloaded in full** from both
secondary sources and hashed:
- `cran.wu.ac.at` → 90/90 HTTP 200, sha256 matches primary 90/90 (populates `sha256_mirror2`)
- `ftp.osuosl.org` → 90/90 HTTP 200, sha256 matches primary 90/90 (independent host)

The osuosl agreement is the only cross-check here that is not circular, and it is clean.

## Step 3 — Archive-channel tarballs: NO-OP (explicitly)

**This step performed no downloads because there are no archive-channel rows to verify.**
Evidence, from `evidence/acquisition-log.csv`:

- `awk -F, 'NR>1 && $3!="current"' | wc -l` → **0 non-current rows**
- channel tally → `90 current`
- every row's URL host/path → `90 × cloud.r-project.org /src` (i.e. `/src/contrib/…`,
  never `/src/contrib/Archive/…`)
- every row's `http_status` → 200

Task 0's notes state the same: all 90 installed versions were still present in the
current CRAN `src/contrib/` tree, so the `Archive/` fallback was never taken. There
is consequently no `Archive/<pkg>/<file>` to fetch from mirror 2, and
`$ROOT/mirror2/` holds only the full-tarball cross-check downloads described above.

Per the controller's resolution, `sha256_mirror2` was permitted to be `NA` for
current-channel rows. It is instead **populated for all 90** from a real mirror-2
download, which is strictly more evidence than required. `md5_index_primary` and
`md5_index_mirror2` are populated for all 90 as required.

## Step 4 — Clean reinstall diff (6 targets)

Command per package (deps resolved from the live library, writes confined to cleanlib):

```
R_LIBS="$LIB" R CMD INSTALL -l $ROOT/tmp/cleanlib $ROOT/tarballs/<pkg>_<ver>.tar.gz
```

All 6 exited 0. All 6 are `NeedsCompilation: no`, so no toolchain variance is in play.

**File lists identical in both directions for all 6** — 0 files only-in-live,
0 files only-in-rebuilt. Per-file SHA-256 over the whole tree: **7 files differ in
each package**, the same 7 every time:

| File | Classification |
|---|---|
| `DESCRIPTION` | expected — `Built:` timestamp line only |
| `Meta/package.rds` | expected — `DESCRIPTION$Built` + `Built$Date` only |
| `R/<pkg>.rdb`, `R/<pkg>.rdx` | investigated → install-path only |
| `help/<pkg>.rdb`, `help/<pkg>.rdx` | investigated → build-path only |
| `help/paths.rds` | investigated → build-path only |

The last five are outside the controller's expected-differ set, so each was opened
and compared semantically rather than assumed benign. Raw `cmp -l` was uninformative
(these are zlib streams; ~99% of bytes differ after the first divergence), so:

- **`R/<pkg>.rdb`** — opened with `lazyLoad()`. Object-name sets identical;
  `deparse(control="all")` identical for **every object in all 6 packages**. The one
  differing object is `.__NAMESPACE__.`, and inside it the one differing key is
  `path` (`…/site-library/<pkg>` vs `…/cleanlib/<pkg>`) — a necessary consequence of
  installing with a different `-l`. `exports`, `imports`, `S3methods`, `spec`,
  `dynlibs`, `lazydata` are all identical.
- **`R/<pkg>.rdx`** — every code blob has an identical compressed length. The
  reference blob `env::1` (which embeds that `path` string) grew by exactly the
  path-length delta (e.g. nflverse 426→504 = +78; nfl4th 2198→2279 = +81), and that
  same constant is the offset shift applied to every later blob. Causally closed:
  one changed string fully accounts for the whole index difference.
- **`help/<pkg>.rdb`** — all 159 Rd topics across the 6 packages initially compared
  unequal. Cause traced to build-time path attributes (`Rdfile`, `srcref`→`srcfile`),
  including instances nested inside `Rd_option` **attribute values** (a first strip
  pass that only recursed through list elements missed those and left 74 topics
  apparently differing — the recursion was fixed rather than the residue waved off).
  After recursively stripping `srcref`/`srcfile`/`Rdfile`/`wholeSrcref`:
  **0 of 159 topics differ**. Independent corroboration: `tools::Rd2txt()` rendering
  is identical for all 159.
- **`help/paths.rds`** — character vector of `.Rd` paths inside the ephemeral
  `…/T/RtmpXXXX/R.INSTALLxxxxx/<pkg>/man` staging dir. Basenames identical; the path
  values are identical once the staging prefix is stripped (verified for all 6).
  **Corrected post-review:** an earlier revision of this file claimed the *attributes*
  were identical too. They are not — that claim contradicted this workstream's own raw
  log (`raw-logs/forensic_rdb.txt` records `attributes identical: FALSE` for 5 of 6).
  The vector carries exactly one attribute, `first`, an integer offset marking where
  the package-relative portion of the path begins. It shifts by exactly the length
  delta of the randomly-named `R.INSTALL` staging directory:

  | package | `first` live → new | Δ | staging-dir name Δ |
  |---|---|---|---|
  | nflverse | 103 → 104 | +1 | +1 |
  | nflreadr | 104 → 105 | +1 | +1 |
  | nflfastR | 104 → 104 | 0 | 0 (names happened to be equal length) |
  | nflseedR | 104 → 105 | +1 | +1 |
  | nfl4th | 102 → 103 | +1 | +1 |
  | nflplotR | 104 → 105 | +1 | +1 |

  `first`'s delta equals the staging-dir name delta in all 6 cases, and nflfastR — the
  one package whose two staging dirs were the same length — is also the one package
  whose attributes *were* identical, which is exactly what the explanation predicts.
  After normalising `first`, attribute sets are identical for all 6. The
  "build-path only" conclusion is unchanged (`first` is itself a build-path artefact);
  only the wording was wrong. Figures: `raw-logs/paths-rds-attributes.txt`.

**Verdict: 6/6 clean, 0 unexplained deviations.** Every difference reduces to the
install timestamp or the install path — both of which must differ between the live
install and a rebuild into another library.

### $LIB read-only guarantee

A marker file was created before the first `R CMD INSTALL`.
`find $LIB -newer <marker>` → **0 files**. Newest mtime anywhere under `$LIB` is
2026-07-26 21:28:29, well before the marker at 2026-07-26 22:39:24. `$LIB` was
never written.

## Step 5 — GitHub tag diff (6 targets)

**Tag format discovered** (via `git ls-remote --tags`, not guessed): `v<version>` —
e.g. `v1.0.3`, `v5.2.0`. No package-name prefix, no `release/` namespace.

| package | tag | commit | repo DESCRIPTION | CRAN | match |
|---|---|---|---|---|---|
| nflverse | v1.0.3 | b8314c594a93 | **1.0.2** | 1.0.3 | **NO** |
| nflreadr | v1.5.1 | fdeaba0b37ab | 1.5.1 | 1.5.1 | yes |
| nflfastR | v5.2.0 | 675a817a1563 | 5.2.0 | 5.2.0 | yes |
| nflseedR | v2.0.2 | e45ab26a0237 | 2.0.2 | 2.0.2 | yes |
| nfl4th | v1.0.7 | 886c61a329be | 1.0.7 | 1.0.7 | yes |
| nflplotR | v1.6.0 | bf02fecf6caf | 1.6.0 | 1.6.0 | yes |

### FINDING (tag hygiene, not content) — nflverse v1.0.3

The `v1.0.3` tag points at a 2022-10-05 commit whose DESCRIPTION still declares
**1.0.2**. The bump to 1.0.3 is the very next commit, `6c4f6ad` *"release v1.0.3 to
cran (#19)"* (2023-08-14) — the tag was created ~10 months before the release and
never moved. Recorded as the brief's finding-level gap; the comparison was run
against `6c4f6ad` (closest correct basis) **and** against the literal tag:

- vs `6c4f6ad`: 19 differing files — 18 CRLF-only, 1 DESCRIPTION (CRAN metadata).
- vs literal `v1.0.3` tag: 20 differing files — 17 CRLF-only, plus DESCRIPTION,
  `NEWS.md` (4 lines: the 1.0.3 changelog entry) and `README.md` (40 lines).
  **Every file under `R/` and `NAMESPACE` is CRLF-only even against the literal tag**,
  i.e. no R code changed between the tagged 1.0.2 tree and the 1.0.3 release.

Both comparisons are emitted in full — differing-file table, CRLF classification, and
the three real diffs shown rather than asserted — in `github-diff/nflverse.txt`
section **C2** (added post-review; the literal-tag numbers previously appeared only as
prose here, with no diff shown and the clone at `tmp/gh/nflverse` left unused).

This is a maintainer bookkeeping defect. It has no effect on the shipped code, but it
does mean the tag cannot be used naively as a provenance anchor for nflverse 1.0.3.

### Classification results (all 6)

| package | repo-only unexplained | tarball-only non-artifact | content divergences |
|---|---|---|---|
| nflverse | 0 | 0 | 0 (18 CRLF-only + DESCRIPTION) |
| nflreadr | 0 | 0 | 0 (DESCRIPTION only) |
| nflfastR | 0 | 0 | 0 (DESCRIPTION only) |
| nflseedR | 0 | 0 | 0 (DESCRIPTION only) |
| nfl4th | 0 | 0 | 0 (DESCRIPTION only) |
| nflplotR | 0 | 0 | 0 (DESCRIPTION only) |

- **repo-only** paths were matched against the **actual `.Rbuildignore` in each repo**
  using R CMD build semantics (`perl=TRUE, ignore.case=TRUE`), applied to the path
  *and every ancestor directory* because R CMD build prunes whole directories — a
  rule like `^\.github$` removes `.github/workflows/x.yaml`. Every repo-only path is
  attributed to a specific named rule, printed alongside it in each report
  (`.github/`, `data-raw/`, `pkgdown/`, `cran-comments.md`, `CRAN-SUBMISSION`,
  `*.Rproj`, `README.Rmd`, `vignettes/articles/`, `LICENSE.md`, …), or to R's
  built-in hidden-file exclusions (`.Rbuildignore`, `.gitignore` at any depth).
- **tarball-only** paths are only `MD5`, `build/`, and `inst/doc/` (e.g. nflreadr:
  69 × `inst/`, 1 × `build/`, 1 × `MD5`) — all standard `R CMD build` artifacts.
- **content differences**: after CRLF normalisation the only differing file in every
  one of the 6 packages is `DESCRIPTION`. Compared field-by-field with `read.dcf`
  and whitespace-normalised values so CRAN's 80-column re-wrapping of
  `Imports`/`Suggests`/`URL` is not miscounted as a change:
  **shared fields differing in value: 0, in all 6 packages.** Tarball-only fields are
  exactly CRAN's publish metadata (`Packaged`, `Date/Publication`, `Repository`,
  `NeedsCompilation`, `Author`, `Maintainer`); repo-only fields are dev-only
  (`Roxygen`, and `LazyData` for nfl4th).
- **`LazyData` (nfl4th)** — declared in the repo, absent from the tarball. nfl4th
  ships no `data/` directory (verified absent in both trees) and R CMD build drops
  `LazyData` in that case. Verified against a control group rather than assumed:
  nflseedR and nflfastR *do* ship `data/` and *do* retain `LazyData` in their CRAN
  tarballs.
- **CRLF (nflverse)** — byte-trivial, and stated as such, but real: nflverse 1.0.3
  was packaged on a CRLF platform (`Packaged: 2023-08-14 07:59:13 UTC; carl`) while
  its 5 siblings were not. 18 files (`R/*.R`, `NAMESPACE`, `man/*.Rd`, `tests/*`,
  `LICENSE`, `README.md`) are byte-identical after `tr -d '\r'` — verified per file,
  not sampled. No effect on R semantics.

Incidental observation (not a finding): every tarball's `Packaged:` timestamp is
close to, but not identical with, its tag commit date — nflverse packaged 5.5 h
*before* commit `6c4f6ad`, nfl4th 2 days *after* its tag. Normal maintainer workflow
(build/submit and push are separate acts); noted only so the timestamps are not
mistaken for evidence later.

## Step 6 — Acceptance check

| Criterion | Required | Observed | Result |
|---|---|---|---|
| `hash-verification.csv` covers all 90 | 90 rows | 90 | PASS |
| No empty verdicts | 0 | 0 | PASS |
| Header matches the contract | exact | `package,version,channel,md5_actual,md5_index_primary,md5_index_mirror2,sha256_primary,sha256_mirror2,verdict` | PASS |
| `md5_index_primary` / `md5_index_mirror2` filled for every row | 90/90 | 90/90 | PASS |
| Reinstall diff reports | 6 | 6 | PASS |
| GitHub diff reports | 6 | 6 | PASS |
| Summary counts in `notes.md` | present | this file | PASS |
| `$LIB` unwritten | no writes | 0 files newer than marker | PASS |

## Evidence gaps

**None.** Every planned check produced evidence; no retry was exhausted without a
result; nothing is asserted that was not actually compared. The two items that
*could* have become gaps were both resolved with evidence rather than assumption:

1. Archive-channel verification (Step 3) — a genuine no-op, proven from the
   acquisition log rather than skipped silently.
2. nflverse's tag/version mismatch — resolved by locating the real release commit,
   and reported as a finding rather than papered over.

## Scope limits — what this workstream does NOT prove

Stated so later synthesis does not over-read these results:

- Agreement with CRAN's published MD5 proves the local tarball matches **what CRAN
  serves today**. It does not prove CRAN's copy was never tampered with, and CRAN
  publishes no signatures for source tarballs, so there is no cryptographic chain to
  the maintainer. The osuosl cross-check narrows this (an attacker would need both
  CRAN master and an independent mirror) but does not close it.
- The GitHub diff shows tarball content matches the tagged repo content. Tags are
  mutable and, as nflverse demonstrates, can be misplaced; this is corroboration, not
  proof of provenance.
- Step 4 proves the installed bytes are reproducible from the audited tarball on
  *this* machine with *this* R. It says nothing about the 84 non-target packages,
  which were verified at tarball level (Steps 1–3) but not reinstalled.
- Nothing here evaluates whether the code is *safe* — only whether it is *authentic*
  to its stated source. Behavioural review belongs to other workstreams.
