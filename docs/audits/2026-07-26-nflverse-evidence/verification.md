# Verification pass — nflverse forensic audit (plan Task 9)

**Date:** 2026-07-27 (UTC). **Subject:** `docs/audits/2026-07-26-nflverse-stack-forensic-audit.md`
and `docs/audits/appendix/{package-manifest.md, findings-register.csv, exports-inventory.md,
data-dictionaries.md, evidence-index.md}`.

**Method:** adversarial. Every quantitative claim was re-derived from the underlying evidence file
(`wc`, `awk`, `find`, Python `csv`) rather than accepted from a workstream report. Where a
workstream report and the primary artefact disagreed, the primary artefact was treated as the
authority — this is how three of the six defects below were found.

**Verdict: PASS with 6 corrections applied.** 126 quantitative claims re-derived, 6 mismatches, 6
fixes applied and re-verified. 74 distinct evidence citations checked, 0 dead. Design-doc §7's four
success criteria, decomposed into 9 checkable sub-criteria, all PASS. No finding, severity or
verdict was changed.

```text
$ROOT = /private/tmp/claude-501/-Users-danielwalker-src-ai-sports-betting-dime-ai/\
        dd3b2b85-766c-4b7b-a98c-d928cffcbac2/scratchpad/nflverse-audit
E     = $ROOT/evidence          (durable copy: docs/audits/2026-07-26-nflverse-evidence/)
S     = $ROOT/sources           (90 extracted CRAN tarballs — not copied, reproducible from CRAN)
```

---

## 1. Summary of defects found

| # | Where | Claimed | Derived | Root cause | Status |
|---|---|---|---|---|---|
| D1 | report §3 | `gt` hard-`Imports` **19** further packages | **20** | inherited verbatim from `ws-a/notes.md:97`; `gt/DESCRIPTION` `Imports:` lists 20 | FIXED |
| D2 | report §5.3, register NFLV-022 | 38 ship `src/`, **37** declare `useDynLib` | **38** declare it | `ws-c/native-code-inventory.md` claims `cachem` is the exception; `cachem/NAMESPACE:17` is `useDynLib(cachem, .registration = TRUE)` — it *also* registers via `R_init_cachem` | FIXED |
| D3 | report §5.3, register NFLV-022 | four packages ≈ **82%** of native mass | **76.70%** (715,263 / 932,557) | percentage never recomputed after the total was corrected from ~892 k to 932,557; evidence files give two different wrong values (82% and 84%) | FIXED |
| D4 | report §3 | **Every** `NeedsCompilation: yes` row carries `Built: R 4.6.1; aarch64-apple-darwin25.4.0` | **38 of 39** | `tidyselect` declares yes, ships no `src/`, and its `Built:` platform field is empty — it is the entire 39-vs-38 gap | FIXED |
| D5 | report §6.5 | release assets publishable to four repos: `nflverse-data`, `nfldata`, **`nflfastR-data`**, "plus per-package release repos" | `nflverse-data`, `nfldata`, `nfl4th`, `nflplotR` | contradicted `ws-d/serialization-channel.md:87-88` **and** the report's own register (NFLV-002); `nflfastR-data` is a `blob/master` path, not a release-asset repo | FIXED |
| D6 | report §1.2 + §6.4, register NFLV-003 | offline `load_schedules(2026)` returned after **two** warnings | **three** distinct warnings (third fired twice → 4 emissions) | `ws-d/offline-behavior.md:22-27` captured sequence | FIXED |

Nothing found affected a finding, a severity, a gate, or the verdict. D2/D3 are the only two that
touch a finding's *body text* (NFLV-022, Info) and neither changes its substance.

---

## 2. Claims audit — claimed vs derived

Every row was derived by running the stated command against the stated evidence file. `=` means
claimed and derived agree exactly.

### 2.1 Executive summary (§1)

| Claim | Claimed | Derived | Source |
|---|---|---|---|
| Targets | 6 | 6 | `E/ws-a/reachability.txt` ROOTS block |
| Closure size | 90 | 90 | `E/installed-manifest.csv` = 90 rows |
| Tarball hash verdicts | 90 PASS, 0 FAIL, 0 gaps | 90 PASS (sole value of `verdict`) | `E/ws-b/hash-verification.csv` |
| CRAN index records | "roughly 24.4 thousand" | 24,409 / 24,409 / 24,408 | `E/ws-b/mirror-crosscheck.txt` |
| Same-version-different-MD5 | 0 | 0 | same |
| Reinstall | 6/6 clean, 0 unexplained | 6 files, each `differing : 7`, `only in live/rebuilt : 0` | `E/ws-b/reinstall-diff/*.txt` |
| GitHub tag diff | 6/6 zero content divergence | 6 × `NO CONTENT DIVERGENCE`, 6 × shared-field diff = 0 | `E/ws-b/github-diff/*.txt` |
| Autobrew packages | 4 (`curl`,`fs`,`V8`,`xml2`) | 4 FIRED, `magick` NOT | `E/ws-c/escalation-reviews/*.md` |
| Autobrew `.so` total | "roughly 49 MB" | 49,646,336 bytes = 49.65 MB | `stat` on the four installed `.so` |
| `V8.so` | 47,520,328 bytes | 47,520,328 | `stat` + `E/ws-c/escalation-reviews/V8.md:56` |
| Integrity-keyword grep | zero matches | 0 | `grep -rniE 'checksum\|sha256\|…' S/{6 targets}/R/` |
| TLS-override grep | zero matches | 0 | same method |
| `from_url.R:65-78` | rds path | line 65 = `rds_from_url <- function(url) {`, 78 = `}` | `S/nflreadr/R/from_url.R` |
| rds pattern re-implemented | 3× | 3 (`rds_from_url`, `raw_rds_from_url`, `read_raw_rds`) | `E/ws-d/serialization-channel.md` |
| Offline warnings | two | **three** | **D6 — FIXED** |
| Poisoned re-read | `dim 0x1` in 0.013 s, cache 0→5 files | 0.013 s, 0→5 | `E/ws-d/offline-behavior.md:82,95` |
| Finding counts | 25 total; 3 High, 10 Medium, 7 Low, 5 Info | 25 rows; High 3 / Medium 10 / Low 7 / Info 5 | `appendix/findings-register.csv` (Python `csv`) |

### 2.2 Scope and methodology (§2)

| Claim | Claimed | Derived | Source |
|---|---|---|---|
| Escalated packages | 26 | 26 package files (28 files − INDEX − STRUCTURAL-LIMITATIONS) | `E/ws-c/escalation-reviews/` |
| WS-C scan over-statement | "roughly six times" | 643 / 103 = 6.24× | `E/ws-c/notes.md:49` |
| WS-F field-sum correction | 1,270 → 1,286 | 1,286 (CSV-aware sum of 22 files) | `E/ws-f/notes.md:271`, `E/ws-f/dictionaries/*.csv` |
| Mirror 2 is a redirect | `cran.wu.ac.at` → 301 | HTTP 301 → `cran.r-project.org`, byte-identical sha256 | `E/ws-b/mirror-crosscheck.txt` |
| Review ledger exists | `.superpowers/sdd/progress.md` | file exists | repo |

### 2.3 Inventory (§3)

| Claim | Claimed | Derived | Source |
|---|---|---|---|
| Install-log source lines | 87 + 4 = 91 for 90 packages (`magick` twice) | 87 + 4 = 91 as recorded; `magick` twice confirmed | `E/ws-c/escalation-reviews/STRUCTURAL-LIMITATIONS.md:129-130`, `magick.md:27-48` |
| `NeedsCompilation: yes` | 39 | 39 | `E/installed-manifest.csv` |
| Packages shipping `src/` | 38 | 38 | `ls -d S/*/src` |
| `Built:` platform string | **every** yes-row | **38 of 39** (`tidyselect` empty) | **D4 — FIXED** |
| Acquisition channel | 90 current, 0 `Archive/` | 90 `current`, 90 URLs under `/src/contrib/`, 0 under `Archive/` | `E/acquisition-log.csv` |
| HTTP status | 200 on first attempt | 90 × `200` | same |
| Dependency edges | 1,054 = 4 + 355 + 6 + 689 | 1,054 = 4 Depends + 355 Imports + 6 LinkingTo + 689 Suggests | `E/ws-a/dep-edges.csv` |
| Distinct edge targets | 256 = 89 + 18 + 149 | 256; 89 site-lib, 18 base/recommended, 149 external | set arithmetic on `dep-edges.csv` vs `installed-manifest.csv` |
| 149 externals hard-reachable | 0 | 0 external appears as a non-`Suggests` target | same |
| `nflverse` never a target | true | `nflverse` is the one site-lib package absent from `to` | same |
| Reachability | 90/90, 0 orphans | `REACHABLE_IN_SITE_LIBRARY (90 of 90)` | `E/ws-a/reachability.txt` |
| `nflplotR` → `gt` | hard `Imports` | `nflplotR,gt,Imports` | `dep-edges.csv` |
| `gt` further hard imports | **19** | **20** | **D1 — FIXED** |
| `htmlwidgets` → knitr/rmarkdown | `Imports`, not `Suggests` | both `Imports` | `dep-edges.csv` |
| `rmarkdown` → `tinytex` | `Imports` | `rmarkdown,tinytex,Imports` | same |

### 2.4 Supply-chain integrity (§4)

| Claim | Claimed | Derived | Source |
|---|---|---|---|
| Index records | 24,409 / 24,409 / 24,408 | = | `E/ws-b/mirror-crosscheck.txt` |
| Legacy `Path:` records dropped | 15 | 15 | `E/ws-b/notes.md:38-39` |
| Version-differing packages | 8, plus 1 only-on-primary | 8 listed by name; `only-in-primary: jamba` | `mirror-crosscheck.txt` |
| osuosl never ahead | true | all 8 rows show osuosl behind | same |
| Archive channel | explicit no-op, 90/90 current | 0 `Archive/` URLs | `E/acquisition-log.csv` |
| Files differing per package | exactly 7, same 7 | 7 in all 6 | `E/ws-b/reinstall-diff/*.txt` |
| Rd topics | 159 total | 5+77+27+22+8+20 = 159 | `E/ws-b/raw-logs/forensic_rd_fullstrip.txt` |
| Topics differing after first strip | 74 | 2+28+22+6+0+16 = 74 | `E/ws-b/raw-logs/forensic_rd_deepstrip.txt` |
| Topics differing after full strip | 0 of 159 | 0 | `forensic_rd_fullstrip.txt` |
| `paths.rds` `first` delta | tracks staging-dir name length; `nflfastR` the exception | 5 packages delta 1, `nflfastR` delta 0 | `reinstall-diff/*.txt` `[5]` blocks |
| `v1.0.3` tag commit | `b8314c594a93`, 2022-10-05, DESCRIPTION 1.0.2 | exact match | `E/ws-b/raw-logs/github-tag-resolution.txt` |
| Real release commit | `6c4f6ad`, 2023-08-14 | exact match | `E/ws-b/github-diff/nflverse.txt:13-19` |
| Tag created ~10 months early | 2022-10-05 → 2023-08-14 | 10.3 months | arithmetic |
| Shared DESCRIPTION fields differing | 0, all 6 | 0 in all 6 | `github-diff/*.txt` |

### 2.5 Execution surface (§5)

| Claim | Claimed | Derived | Source |
|---|---|---|---|
| `curl.so` | 838 KB | 838,248 B | `stat` |
| `fs.so` | 220 KB | 219,896 B | `stat` |
| `V8.so` | 47,520,328 B | 47,520,328 B | `stat` |
| `xml2.so` | 1.07 MB | 1,067,864 B | `stat` |
| Bundle names/versions | libcurl 8.14.1, libuv 1.52.0, v8 14.6.202.26, libxml2 2.14.4 | all four confirmed | `E/ws-c/escalation-reviews/{curl,fs,V8,xml2}.md` |
| Pattern-scan rows | 3,637 | 3,637 | `E/ws-c/pattern-hits.csv` |
| Classification split | 2,993 benign / 628 note / 16 finding | = | same |
| Hand-adjudicated rows | 34 | 34 | `E/ws-c/notes.md:110` |
| Two findings with no CSV row | ESPN cleartext, nfl4th raw-byte string | 0 rows matching `site.api.espn` | `grep` on `pattern-hits.csv` |
| Escalation verdicts | FINDING 7 / ACCEPTED-RISK 8 / BENIGN 11 = 26 | = | `E/ws-c/escalation-reviews/INDEX.md` |
| Upheld / narrowed / downgraded | 5 / 2 / 8 | = | same |
| Native lines, top-level `src/` | 932,557 across 2,497 files | 932,557 / 2,497 | `find S/*/src … \| xargs wc -l` (the file's own documented command) |
| Native lines, any `/src/` | 933,771; extra 1,214 | 933,771; delta 1,214 over 28 extra files | same command without the top-level restriction |
| Packages shipping `src/` | 38 | 38 | `ls -d S/*/src` |
| Packages declaring `useDynLib` | **37** | **38** | **D2 — FIXED** |
| Top-4 share of mass | **≈82%** | **76.70%** | **D3 — FIXED** |
| `stringi` / `xgboost` / `vctrs` / `sass` | 540,791 / 83,413 / 49,363 / 41,696 | all four exact | per-package `wc -l` |
| Six targets ship zero native code | 0 `src/`, 0 `useDynLib` | 0 and 0 for all six | `find`/`grep -c` on `S/` |
| Native primitive hits | 97 = 68+14+8+6+1; 0 `exec*`, 0 `fork` | 68+14+8+6+1 = 97 | `E/ws-c/native-code-inventory.md` |

### 2.6 Network and runtime (§6)

| Claim | Claimed | Derived | Source |
|---|---|---|---|
| Target URL strings / hosts | 383 / 68 | 383 counted lines; 68 distinct hosts | `E/ws-d/url-census-targets.txt` |
| Closure URL strings / hosts | 7,659 / 1,096 | 7,659; 1,096 rollup rows | `E/ws-d/url-census-closure.txt` |
| `data.table` load options | ~19 | "~19" as recorded | `E/ws-d/load-side-effects.md:33` |
| `nfl4th` `.onLoad` DNS lookup | unconditional | `curl::nslookup("github.com", …)` is line 2, ungated | `S/nfl4th/R/zzz.R` |
| Games-file delete branch | fires when file exists and `keep_games` not TRUE | matches source exactly | same |
| Three cache options undocumented | absent from installed help | 0 files in `S/nflreadr/man/` mention `nflreadr.cache` | `grep -rl` |
| Cold run | 6 calls, 5 misses + 1 same-key hit, 11.5 s, 5 files, 17,482,382 B | = (evidence's own summary line says "all 6 misses"; its detail table and file list resolve to 5 + 1 — the report is the more accurate of the two) | `E/ws-d/cache-behavior.md:50-71` |
| Warm run | 6 hits, 4.2 s, byte-identical before/after | `n_files=5, total_bytes=17482382` both sides | `cache-behavior.md:87-106` |
| TTL | fixed 24 h, no LRU, no content invalidation | `memoise::timeout(86400)` in `zzz.R:24/33/42/51` | `cache-behavior.md:40` |
| pbp cache compression | 160 MB → 14.4 MB | 160,060,384 → 14,362,113 | `cache-behavior.md:71` |
| Offline warnings | **two** | **three** | **D6 — FIXED** |
| Fetch-log rows / hosts | 24 rows, exactly 1 host | 24 rows, all `github.com` | `E/ws-d/dynamic-fetch-log.csv` |
| `EMPTY` rows | 6 | 6 | same |
| `wp_model.rds` | 7,663,086 B | = | `E/ws-d/serialization-channel.md:19` |
| `qs` removed from CRAN | 2026-01-17 | = | `serialization-channel.md:22` |
| `parquet` unreachable | `arrow` not installed | `arrow` absent from the 90 | `installed-manifest.csv` |
| Release-asset redirect host | absent from static census | 0 occurrences of `release-assets.githubusercontent.com` | `url-census-closure.txt` |
| Release-asset repos | **3 named + open category** | **4: `nflverse-data`, `nfldata`, `nfl4th`, `nflplotR`** | **D5 — FIXED** |
| Cleartext endpoint | 1, `http://site.api.espn.com` | 1 `http://site.api.espn.com/...` line in the target census | `url-census-targets.txt` |

### 2.7 Licensing (§7)

| Claim | Claimed | Derived | Source |
|---|---|---|---|
| Copyleft classes | 72 none / 4 weak / 14 strong = 90 | 72 / 4 / 14 | `E/ws-e/license-inventory.csv` |
| All six targets MIT | yes | all six `copyleft=no`, `MIT + file LICENSE` | same |
| `data.table` direct `Imports` of 5 of 6 | 5 | 5 (`nfl4th`,`nflfastR`,`nflplotR`,`nflreadr`,`nflseedR`) | `E/ws-a/dep-edges.csv` |
| `data.table` LICENSE | 373 lines, unmodified MPL-2.0 | 373 | `wc -l S/data.table/LICENSE` |
| `gsubfn` → `nflseedR`, pulls `proto` | direct `Imports`; `proto` via `Depends` | `nflseedR,gsubfn,Imports`; `gsubfn,proto,Depends` | `dep-edges.csv` |
| AGPL anywhere | none; 2 files match the grep | exactly `data.table/LICENSE`, `vctrs/LICENSE.note` | `grep -rliE 'AGPL\|Affero' S/*/LICENSE* S/*/DESCRIPTION` |
| CeCILL / EPL | 0 hits | 0 | same method |
| Bare `License: GPL` | `highr`, `knitr`, `mime` | all three are exactly `License: GPL` | `S/*/DESCRIPTION` |
| `vctrs` `src/order-*` under MPL-2.0 | yes | stated verbatim in `LICENSE.note:3-5` | `S/vctrs/LICENSE.note` |
| `stringi` `stri_stats_latex()` GPL | yes | `LICENSE:41` | `S/stringi/LICENSE` |
| `nflverse-data` LICENSE.md | 18,647 characters | 18,647 UTF-8 chars (18,651 bytes) | `E/ws-e/raw/nflverse-data-LICENSE.md` |
| Counsel list | 9 items | 9 numbered items in §5 | `E/ws-e/commercial-posture.md` |
| `dictionary_injuries` | 16 fields | 16 | `E/ws-f/dictionaries/dictionary_injuries.csv` |

### 2.8 API, schema, Dime mapping (§8) and currency (§9)

| Claim | Claimed | Derived | Source |
|---|---|---|---|
| Exported symbols | 132 | 132 | `E/ws-f/exports.csv` |
| Per package | 54/28/27/12/7/4 | nflreadr 54, nflplotR 28, nflfastR 27, nflseedR 12, nfl4th 7, nflverse 4 | same |
| By kind | 116 function / 11 reexport / 5 data | = | same |
| Dictionaries | 22 files, 1,286 field rows | 22, 1,286 (CSV-aware **and** naive count agree) | `E/ws-f/dictionaries/*.csv` |
| `dictionary_pbp` | 372 | 372 | same |
| `dictionary_ff_opportunity` | 218 | 218 | same |
| `dictionary_schedules` | 45 | 45 | same |
| `dictionary_players` | 39 | 39 | same |
| box scores | 114 and 102 | `player_stats` 114, `team_stats` 102 | same |
| player-id crosswalk | "roughly 20 platforms" | exactly 20 `*_id` columns in `dictionary_ff_playerids` | same |
| Dime `nfl_games` has no betting columns | none | 0 grep hits for moneyline/spread/total_line/odds/score/result | `drizzle/nfl.schema.ts` |
| No `kickoff_time_et` column | absent | only `kickoff_utc`, `kickoff_date`, `time_valid` | same |
| Dime abbrevs `LAR`/`WSH` | yes | both present | `scripts/data/nfl-2026/teams.json` |
| Dime `nfl_players` fields | 9 | 9 keys, 2,929 players | `scripts/data/nfl-2026/players.json` |
| Currency | 90 current, 0 outdated, 0 archived | 90 × `current` | `E/ws-a/currency.csv` |
| `available.packages()` | 24,395 | 24,395 | `E/ws-a/scripts/03-currency.log:2` |
| Dev-ahead targets | 3 (`nflfastR` 5.2.0.9012, `nflseedR` 2.0.2.9000, `nflverse` 1.0.3.9001) | exactly those 3; the other 3 equal CRAN | `currency.csv` |

### 2.9 Limitations (§11) and evidence index (Appendix E)

| Claim | Claimed | Derived | Source |
|---|---|---|---|
| L1 unread native lines | 932,557 | 932,557 | as §2.5 |
| L2 bundled JS/CSS | ~30 MB, 3 bundles run in-process | `## L2 — ~30 MB` | `E/ws-c/escalation-reviews/STRUCTURAL-LIMITATIONS.md:77` |
| L6 hand-adjudicated | 34 of 3,637 | 34 / 3,637 | `E/ws-c/notes.md:110` |
| L7 scan gap | 103 files, 40 R, 3 real hits | 103 / 40 / 3 | `E/ws-c/notes.md:33-56` |
| Stale-figure locations | `escalations.md` §L1 and `STRUCTURAL-LIMITATIONS.md` §L1 | both confirmed (`escalations.md:300`, `STRUCTURAL-LIMITATIONS.md:9`) | grep |
| Evidence tree | 151 files, 2,183,780 B | 151 / 2,183,780 | `find`/`stat` |
| ws-a … ws-f file+byte table | 11/68,413 · 44/220,294 · 39/588,323 · 8/588,987 · 18/475,437 · 28/212,557 · root 3/29,769 | **all seven rows exact** | `find`/`stat` per directory |

---

## 3. Citation audit

| Check | Result |
|---|---|
| Distinct `ws-*` / root evidence paths cited across report + 5 appendices | **74** |
| Resolving to a real file (exact or via glob/brace expansion) | **74** |
| Dead | **0** |
| `evidence` column of `findings-register.csv` — individual `$ROOT/evidence/...` tokens | **76**, 0 missing |
| Repo-relative paths (`docs/…`, `drizzle/…`, `shared/…`, `scripts/…`, `.superpowers/…`) | 17 distinct, 0 missing |
| Appendix links from the report (`](appendix/…)`) | 10, 0 broken |
| Source-file citations (`<pkg>/R/<file>.R:lines`) resolvable under `$ROOT/sources/` | 7 distinct, 0 missing |
| Internal anchors | 25 defined, 25 linked, 0 dangling, 0 unused |

Line-level citations were spot-checked rather than exhaustively opened. Two were opened and
confirmed exactly: `nflreadr/R/from_url.R:65-78` (line 65 is the function head, 78 the closing
brace) and `cachem/NAMESPACE:17` (which is how D2 was found).

**One structural gap, recorded not fixed.** The install-log provenance for §3 and NFLV-001 cites
`bznitqj7o.output` and `bvdz7ibhe.output` by line number. Those are agent task transcripts and were
never part of the evidence tree, so they are not in the durable copy and cannot be re-opened. The
line-numbered quotations inside `ws-c/escalation-reviews/*.md` are the only surviving record. This
is now stated in report §2.5.

---

## 4. Coverage audit — design doc §7 success criteria

| # | Criterion | Verdict | Evidence checked |
|---|---|---|---|
| C1 | Every one of the six targets: **source fully read** | **PASS** | `E/ws-c/per-package-review/*.md` claim 11/32/16/36/27/8 files for nfl4th/nflfastR/nflplotR/nflreadr/nflseedR/nflverse. Independently re-derived `ls S/<pkg>/R \| wc -l` → **11/32/16/36/27/8, exact match on all six**; `.R` file counts 10/31/15/36/26/8 also match, the non-`.R` entry being `sysdata.rda` in five of them. Raw line counts match for nflreadr (3,306) and nflverse (359); the other four are quoted as post-roxygen-strip counts, consistent with their raw totals. One nit: nfl4th's review says 2,038 lines, derived 2,017 (see §6). |
| C2 | Every one of the six targets: **integrity three-way-reconciled** | **PASS** | Three independent axes all present and all clean: CRAN MD5 + two secondary sources (`hash-verification.csv`, 90/90 PASS), clean-reinstall byte diff (`reinstall-diff/*.txt`, 6/6, 7 files each, every one explained), GitHub tag diff (`github-diff/*.txt`, 6/6 `NO CONTENT DIVERGENCE`, shared-field diffs 0). |
| C3 | Every one of the six targets: **exports and schemas fully inventoried** | **PASS** | `exports.csv` 132 rows; Appendix C reproduces all 132 with per-package sections whose row counts (4/54/27/12/7/28) and **symbol sets** match the CSV exactly — verified set-equal, not just count-equal. 22 dictionaries / 1,286 rows; Appendix D's summary table, its 22 per-dictionary section headers, and the CSV row counts agree on every one of the 22. |
| C4 | All 90 closure packages: **checksum-verified** | **PASS** | `hash-verification.csv` = 90 rows, sole verdict `PASS`; `md5_actual == md5_index_primary == md5_index_mirror2` for all 90; sha256 re-download from both secondaries 90/90 (`mirror-crosscheck.txt`). |
| C5 | All 90 closure packages: **license-inventoried** | **PASS** | `license-inventory.csv` = 90 rows, every one classified `no`/`weak`/`yes` (72/4/14). 71 have a LICENSE file read; 19 are declared-field-only, which is disclosed. Appendix A's 90-row table was re-joined against all five source CSVs field by field: **0 discrepancies in 90 rows × 8 compared columns**. |
| C6 | All 90 closure packages: **pattern-scanned** | **PASS, with a nuance** | `ws-c/notes.md` states all 90 trees were scanned; 3,637 rows span **76** distinct packages, so 14 produced zero hits (R6, RColorBrewer, bigD, fastrmodels, generics, gtable, jquerylib, labeling, pkgconfig, proto, snakecase, stringr, tidyselect, viridisLite — all small pure-R packages). Zero hits is a valid scan outcome, not a coverage hole; the report's phrasing ("3,637 rows across the 90 packages") is accurate and does not claim all 90 have rows. Scanner scope narrowing is disclosed in L7. |
| C7 | **Zero report claims without evidence citations** | **PASS** | Every numeric claim traced in §2 above resolved to a named evidence file; 74/74 cited paths exist; §10's 25 rows each carry an `evidence` column with 76 resolvable paths. The two findings that have no pattern-scan row are explicitly labelled as such in §5.2 rather than left implicit. |
| C8 | **Limitations section present and honest** | **PASS** | §11 carries L1–L9 plus an explicit evidence-contradiction subsection. It is honest in the strong sense: it names a limitation that was *closed* (L3) rather than quietly dropping it, states that bulk pattern labels are rule output not evidence (L6), discloses a scan-scope deviation the brief did not authorise (L7), and surfaces the ~892,000-vs-932,557 contradiction against its own evidence files rather than smoothing it. §4.5 and §2.4 add "what this does not prove" statements exactly where the results are strongest. |
| C9 | **The user can act on the report** (design §7 bullet 4) | **PASS** | A single unambiguous verdict (ADOPT the data / HOLD the configuration), four numbered gates each naming what it closes and an effort estimate, 25 severity-ranked findings each with a `recommendation` column, and §12's ordered actions — including the concrete items §7 asks for by name: pin (`6c4f6ad`, not the `v1.0.3` tag), vendor the data (G2), cache policy (`clear_cache()` after any fetch warning; set `nflreadr.cache` before `library()`), and the licence-attribution question routed to counsel as a 9-item list. |

---

## 5. Internal consistency

| Check | Result |
|---|---|
| Executive-summary severity counts vs `findings-register.csv` | **MATCH** — 3/10/7/5, total 25, both sides |
| Report §10 table vs register: id, severity, title, all 25 rows | **MATCH** — 0 differences after normalising backticks |
| Register id sequence | `NFLV-001` … `NFLV-025`, **no gaps, no duplicates** |
| Anchors `<a id="nflv-NNN">` vs `](#nflv-NNN)` links | 25 / 25, none dangling, none unused |
| Appendix A roll-up (90 / PASS 90 / current 90 / yes 39 no 51 / 72-4-14) vs evidence | **MATCH** on all six |
| Appendix A 90-row table vs the five source CSVs | **0 discrepancies**, 90 rows × 8 columns, numbering contiguous 1–90 |
| Appendix A copyleft detail lists (14 strong, 4 weak) vs `license-inventory.csv` | **set-equal** |
| Appendix C section counts + symbol sets vs `exports.csv` | **set-equal** for all six packages |
| Appendix D summary table, section headers, and evidence row counts | **agree on all 22** |
| Appendix E per-workstream file/byte table vs `find`/`stat` | **all 7 rows exact** |
| Appendix E "Reproducing the numbers" commands | all 8 re-run; every one returns its stated result |
| 932,557 used consistently (§5.3, §10, §11 L1, §12.5, NFLV-022) | **consistent**, 5 sites |
| 90 / 6 / 26 / 132 / 1,286 repeated across sections | **consistent** everywhere |
| Release-asset repo list, report §6.5 vs register NFLV-002 vs evidence | **was inconsistent (D5)** — now consistent |
| `useDynLib` count, report §5.3 vs register NFLV-022 | **was 37 in both (D2)** — now 38 in both |
| Top-4 native share, report §5.3 vs register NFLV-022 | **was 82% in both (D3)** — now 77% in both |
| Warning count, report §1.2/§6.4 vs register NFLV-003 | **was "two" in all three (D6)** — now "three" in all three |

---

## 6. Known contradictions — honesty check

**(a) Unread native-code volume: ~892,000 vs 932,557.**
Represented honestly. The report uses **932,557** at all five sites where the figure appears, and
§11 devotes a labelled paragraph to the discrepancy: it names both evidence files that still carry
the stale figure (`ws-c/escalations.md` §L1, `ws-c/escalation-reviews/STRUCTURAL-LIMITATIONS.md`
§L1 — both confirmed by grep), states why 932,557 wins (`native-code-inventory.md` gives a
reproducible counting command; the other two inherited a superseded number), and says plainly that
the discrepancy changes no conclusion. Not smoothed, not overstated. **PASS.**

I independently re-ran the documented command: 932,557 lines / 2,497 files, and the per-package
table in `native-code-inventory.md` now sums to exactly 932,557 — so the corrected figure is
internally self-consistent too. Register NFLV-022's phrasing was tightened from "an earlier draft …
quoted ~892,000" to name the two files that still carry it, matching §11.

One genuine consequence of the stale figure survived into the report and is now fixed: the "82% of
the mass" derived percentage was never recomputed against the corrected denominator (**D3**). The
evidence files disagree with each other here too — `native-code-inventory.md` says ~82%,
`STRUCTURAL-LIMITATIONS.md` says ~84% — and the true value against 932,557 is 76.70%.

**(b) `NeedsCompilation: yes` = 39 vs 38 shipping `src/`.**
Represented honestly — §3 stated both numbers side by side and cross-referenced §5.3 rather than
reconciling them silently. Neither the report nor any evidence file explained the gap, so I
resolved it: **`tidyselect`** declares `NeedsCompilation: yes`, ships no `src/` tree, and its
installed `Built:` line is `R 4.6.1; ; 2026-07-27 04:23:54 UTC; unix` — an **empty** platform field,
which is the artefact of a package that was not in fact compiled. The report now names it. This
resolution also falsified an adjacent claim (**D4**: "*Every* `NeedsCompilation: yes` row carries
`Built: R 4.6.1; aarch64-apple-darwin25.4.0`" — 38 of 39 do). **PASS**, and now explained.

---

## 7. Durable-evidence provenance

| Check | Result |
|---|---|
| File count, `$ROOT/evidence/` | 151 |
| File count, `docs/audits/2026-07-26-nflverse-evidence/` | 151 |
| Total bytes, both trees | 2,183,780 |
| `diff -rq` between the trees | **empty — byte-identical, exit 0** |
| Directory structure | identical (`ws-a` … `ws-f` + 3 root files) |
| Copy timestamp | 2026-07-27 00:14 local |
| After this memo was written | both trees 152 files, still `diff -rq` empty, `verification.md` sha256 identical on both sides |

sha256 spot-checks, one per workstream plus the root:

| File | sha256 (first 16) | Verdict |
|---|---|---|
| `ws-a/dep-edges.csv` | `b7d8a30f518ea7f4…` | MATCH |
| `ws-b/hash-verification.csv` | `712133c386ad5e80…` | MATCH |
| `ws-c/pattern-hits.csv` | `b3f94c9fe8f83433…` | MATCH |
| `ws-d/offline-behavior.md` | `116f7ac120d7e6eb…` | MATCH |
| `ws-e/license-inventory.csv` | `219d05e69607d097…` | MATCH |
| `ws-f/exports.csv` | `65ac2092994984fe…` | MATCH |
| `acquisition-log.csv` | `3ae13b4e6ac87959…` | MATCH |

7 of 7 match (the brief asked for 5). **Durable copy verified.**

The provenance note was added to the report as **§2.5 "Where the evidence actually lives"**, stating
that all cited `$ROOT/...` paths are session-scratchpad paths, that a verbatim copy was preserved
2026-07-27 at `docs/audits/2026-07-26-nflverse-evidence/` with 151 files / 2,183,780 bytes, how to
substitute the path, and — for honesty — the two things the copy does *not* contain (`$ROOT/sources/`
and the two install transcripts). The report footer and Appendix E's non-durable warning were
updated to match.

---

## 8. Fixes applied

All edits were confined to the report, the appendices, and this memo. No finding, severity, gate or
verdict was altered. `$ROOT/evidence/` and `$ROOT/sources/` were read-only except for this file.

| # | File | Change | Re-verified by |
|---|---|---|---|
| F1 | report §3 | `gt` hard-`Imports` 19 → **20** further packages | `awk` on `dep-edges.csv` = 20; `gt/DESCRIPTION` `Imports:` = 20 names |
| F2 | report §3 | Replaced the blanket `Built:` claim with "those 38 all carry … the 39th, `tidyselect`, …", naming it as the whole 39-vs-38 gap and quoting its empty-platform `Built:` line | `installed-manifest.csv`: 38 of 39 carry the platform string, `tidyselect` the sole exception; `ls -d S/tidyselect/src` empty |
| F3 | report §5.3 | 37 → **all 38** declare `useDynLib`, with the `cachem` counter-evidence cited inline | 38 of 38 `src/`-shipping packages contain `useDynLib` in `NAMESPACE`; `cachem/NAMESPACE:17` quoted |
| F4 | report §5.3 | ≈82% → **≈77%**, with the raw ratio (715,263 of 932,557) shown | recomputed from per-package `wc -l`: 715,263 / 932,557 = 76.70% |
| F5 | report §6.5 | Corrected the four release-asset repos to `nflverse-data`, `nfldata`, `nfl4th`, `nflplotR`; moved `nflfastR-raw`/`nflfastR-data` into a separate non-release-path sentence | matches `ws-d/serialization-channel.md:87-88` and register NFLV-002 |
| F6 | report §1.2, §6.4 | "two warnings" → **three**, with the captured sequence named in §6.4 | `ws-d/offline-behavior.md:22-27` |
| F7 | `findings-register.csv` NFLV-022 | 37 → all 38 `useDynLib`; 82% → 77% with the ratio; ~892,000 provenance sentence tightened to name the two files that still carry it | CSV re-parsed: 25 rows, 3/10/7/5, ids `NFLV-001`–`NFLV-025` unchanged |
| F8 | `findings-register.csv` NFLV-003 | "two warnings" → "three warnings" with the breakdown | same re-parse |
| F9 | report §2.5 (new), footer | Provenance note — the one content addition (Step 6) | paths resolve; 151 / 2,183,780 confirmed |
| F10 | `appendix/evidence-index.md` | "Scratchpad tree — not durable" block rewritten to point at the durable copy and record what was not copied | file counts unchanged and still exact |

Post-fix re-runs, all green: report §10 table vs register **0 problems**; evidence citations
**74/74 resolve**; anchors **25/25, 0 dangling**; register **25 rows, 3 High / 10 Medium / 7 Low /
5 Info**; `diff -rq` between evidence trees **still empty**; no residual occurrence of `19 further`,
`37 declare`, `roughly 82%`, or `two warnings` in either the report or the appendices.

---

## 9. Things noted but deliberately not edited

None of these is a defect in the report; they are recorded so a later reader does not re-discover
them as surprises.

1. **`ws-c/native-code-inventory.md` is wrong about `cachem`.** It states `cachem` ships `src/`
   without `useDynLib`; `cachem/NAMESPACE:17` is `useDynLib(cachem, .registration = TRUE)` and
   `src/init.c:15` also defines `R_init_cachem`. Both mechanisms are present. The evidence tree is
   read-only to this pass, so the correction lives in the report and in this memo.
2. **The same file's per-package `files` column sums to 2,757, not 2,497.** Not a contradiction:
   2,497 counts only C/H/C++ extensions (the headline basis), 2,757 counts every file under
   `src/`. The report cites 2,497 and is correct; the evidence table just uses a wider basis for
   that one column without saying so.
3. **`ws-c/native-code-inventory.md:85` still says "97 hits total across ~892 k lines"** — the same
   stale denominator, inside the very file that corrects it. Report §11 already tells readers to
   prefer 932,557.
4. **`ws-c/escalation-reviews/STRUCTURAL-LIMITATIONS.md` says the top four are "~84% of the total"**
   where `native-code-inventory.md` says "~82 %". Both are wrong against 932,557; the report now
   carries the derived 77%.
5. **`ws-d/cache-behavior.md`'s cold-run summary line says all 6 calls were misses**, while its own
   detail table and 5-file listing show the 6th was a same-key hit. The report's "5 genuine misses
   plus one same-key hit" is the accurate reading; no change needed.
6. **`ws-c/per-package-review/nfl4th.md` says 2,038 lines read; derived 2,017** (`cat S/nfl4th/R/*.R
   | wc -l`). A 21-line discrepancy in a coverage figure the report does not cite. File coverage
   itself is exact (10 of 10 `.R` files).
7. **14 of the 90 packages produce no `pattern-hits.csv` row.** Expected for small pure-R packages
   and not a coverage gap, but a reader who assumes "90 packages scanned" implies "90 packages
   present in the CSV" would be wrong.
8. **Install transcripts are unrecoverable.** `bznitqj7o.output` / `bvdz7ibhe.output` back the
   install-provenance and autobrew line citations and are not in the evidence tree. Now disclosed in
   report §2.5.

**No severity and no verdict is disputed.** The ADOPT-with-four-gates verdict, the three High
findings, and the 3/10/7/5 severity spread are all supported by evidence I re-derived. Nothing in
this pass moved a finding up or down.

---

## 10. Final verdict

**PASS.**

- **126** quantitative claims re-derived from primary evidence; **6** mismatches; **6** fixed and
  re-verified; **0** unresolved.
- **74** distinct evidence citations checked, plus 76 register-column paths, 17 repo paths, 10
  appendix links and 25 anchors. **0 dead.**
- **9 of 9** decomposed design-doc §7 sub-criteria **PASS** (C6 with a disclosed nuance).
- Durable copy **verified byte-identical**: 151 files, 2,183,780 bytes, `diff -rq` empty, 7/7 sha256
  spot-checks match; 152 files once this memo was written to both trees, still `diff -rq` empty.
  (No byte total is quoted for the 152-file state: it would include this file and change whenever
  this file changes.)
- Both known contradictions are represented honestly; contradiction (b) is now additionally
  *explained* (`tidyselect`).
- No claim in this memo is asserted without a command that produced it. Where a check could not be
  run — the two install transcripts — it is recorded as a gap in §3 and §9, not glossed.

*Verification performed 2026-07-27. This file exists at `$ROOT/evidence/verification.md` and at
`docs/audits/2026-07-26-nflverse-evidence/verification.md`.*
