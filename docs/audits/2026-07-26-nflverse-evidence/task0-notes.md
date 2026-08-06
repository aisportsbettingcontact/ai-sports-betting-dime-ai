# Task 0 — Scaffold + shared acquisition stage — evidence notes

Run date: 2026-07-27T05:2x UTC (macOS/darwin, R 4.6.1, curl via /usr/bin/curl)
LIB under audit: /opt/homebrew/lib/R/4.6/site-library (READ-ONLY; not written to — verified below)
ROOT: /private/tmp/claude-501/-Users-danielwalker-src-ai-sports-betting-dime-ai/dd3b2b85-766c-4b7b-a98c-d928cffcbac2/scratchpad/nflverse-audit

## Step 1 — Directory skeleton

Created: `$ROOT/evidence/ws-{a,b,c,d,e,f}/`, `$ROOT/{tarballs,sources,mirror2,tmp}/`. All present.
(Note: `$ROOT/sdd/` also pre-existed from an earlier, unrelated scaffold step outside this task's
brief — left untouched, does not conflict with any path this task produces or consumes.)

## Step 2 — Installed manifest

Command: `Rscript --vanilla -e '...'` exactly as given in the brief, `ROOT` exported.
Output: `90 packages`.

- `$ROOT/evidence/installed-manifest.csv` row count (excluding header): **90** — matches expected.
- Header (as written by R's `write.csv`, quoted): `"package","version","license","needs_compilation","built_r","install_mtime"`
  — same six fields/order as the required header `package,version,license,needs_compilation,built_r,install_mtime`.

## Step 3 — Download 90 source tarballs (primary mirror only)

Adaptation (mechanical, recorded per instructions): R's `write.csv()` quotes all string fields by
default, so `installed-manifest.csv` rows look like `"base64enc","0.1-6",...` rather than bare
`base64enc,0.1-6,...`. The brief's loop (`IFS=, read -r pkg ver _rest`) as given would read
`pkg='"base64enc"'` and `ver='"0.1-6"'` **including the literal quote characters**, corrupting the
constructed filename/URL (verified this failure mode empirically before running the real loop —
see task transcript). Fix applied: immediately after the `read`, strip embedded `"` characters via
`pkg=${pkg//\"/}` and `ver=${ver//\"/}`. No other logic in the brief's script was changed — same
two channels tried in the same order (current, then archive), same log columns, same break-on-200
behavior, primary mirror only (`cloud.r-project.org`), as required for Task 0.

Result of the single loop pass (no per-package retries were needed — see below):

- Tarballs downloaded: **90** (`ls *.tar.gz | wc -l` → 90)
- `acquisition-log.csv` data rows: **90**, all with `http_status=200`
- Channel breakdown: **90 current / 0 archive** — every installed version was still present in
  the current CRAN `src/contrib/` tree, so no package needed the `Archive/` fallback.
- Every row's `http_status` is exactly `200`; zero non-200 rows; zero `FAIL` rows.
- Zero-byte / stray-file check on `$ROOT/tarballs/`: none found — 90 files, all named
  `*.tar.gz`, all non-zero size.
- Identity cross-check: `(package,version)` pairs in `installed-manifest.csv` are byte-identical
  (as a sorted set) to those in `acquisition-log.csv`; no duplicates in either; every
  `acquisition-log.csv` row's `<package>_<version>.tar.gz` has a matching file in `$ROOT/tarballs/`
  and vice versa (`diff` on sorted filename lists → identical, no output).

**No evidence gaps to record for Step 3** — all 90 packages resolved with `http_status=200` on the
first attempt via the `current` channel; the retry-once contingency in the task instructions was
not invoked because there were no failures.

## Step 4 — Extraction

`for t in "$ROOT"/tarballs/*.tar.gz; do tar xzf "$t"; done`, run from `$ROOT/sources`.

- Extracted directories: **90** (`ls -d */ | wc -l` → 90)
- Directory-name identity cross-check: the set of dirnames under `$ROOT/sources/` is
  byte-identical (sorted) to the set of package names in `installed-manifest.csv` — `diff` shows
  no differences.

## Step 5 — Acceptance check

| Check | Expected | Observed | Result |
|---|---|---|---|
| `installed-manifest.csv` data rows | 90 | 90 | PASS |
| `acquisition-log.csv` rows with `http_status=200` | 90 | 90 | PASS |
| `$ROOT/sources/` extracted dirs | 90 | 90 | PASS |
| Six-target version spot-check | all match | all match | PASS |
| (extra) all 90 extracted `DESCRIPTION` versions vs. manifest | 0 mismatches | 0 mismatches | PASS |
| `$LIB` untouched (nothing newer than task start) | no writes | none found | PASS |

Six-target spot-check detail (manifest version vs. `DESCRIPTION` `Version:` in the extracted
source tree):

| package | manifest version | extracted DESCRIPTION version | match |
|---|---|---|---|
| nflverse | 1.0.3 | 1.0.3 | MATCH |
| nflreadr | 1.5.1 | 1.5.1 | MATCH |
| nflfastR | 5.2.0 | 5.2.0 | MATCH |
| nflseedR | 2.0.2 | 2.0.2 | MATCH |
| nfl4th | 1.0.7 | 1.0.7 | MATCH |
| nflplotR | 1.6.0 | 1.6.0 | MATCH |

As an extra diligence pass beyond the required spot-check, all 90 packages' `DESCRIPTION`
`Version:` fields in `$ROOT/sources/<pkg>/` were diffed against `installed-manifest.csv` versions:
**0 mismatches across all 90**.

## Evidence gaps

None. All acceptance criteria met on the first pass; no retries were required; no fabricated or
skipped data.

## Read-only guarantee on $LIB

Verified via `find $LIB -newer <script-start-marker>` returning no results — no file under
`/opt/homebrew/lib/R/4.6/site-library` has an mtime newer than the start of this task's write
activity, confirming $LIB was never written to.
