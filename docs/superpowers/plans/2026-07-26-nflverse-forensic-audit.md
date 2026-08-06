# nflverse Stack Forensic Audit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce an evidence-backed forensic audit report of the locally installed nflverse R
stack (6 target packages, 90-package closure) covering supply-chain integrity, execution surfaces,
network/runtime behavior, licensing, and API/schema inventory.

**Architecture:** Task 0 acquires and stages all shared inputs (manifest, verified tarballs,
extracted sources). Tasks 1–6 are six independent evidence workstreams (WS-A…WS-F) that run as
parallel subagents, each writing to its own evidence directory. Task 7 handles escalations, Task 8
synthesizes the report + appendices from evidence only, Task 9 verifies, Task 10 publishes.

**Tech Stack:** bash/zsh, R 4.6.1 (`Rscript`, `R CMD INSTALL`), curl, shasum/md5, git, grep/perl.
This is an investigation plan — "tests" are acceptance checks on evidence files, not unit tests.

## Global Constraints

- `ROOT=/private/tmp/claude-501/-Users-danielwalker-src-ai-sports-betting-dime-ai/dd3b2b85-766c-4b7b-a98c-d928cffcbac2/scratchpad/nflverse-audit`
- Evidence dirs: `$ROOT/evidence/ws-{a,b,c,d,e,f}`; shared stage: `$ROOT/tarballs`, `$ROOT/sources`, `$ROOT/mirror2`, `$ROOT/tmp`
- Live library under audit: `LIB=/opt/homebrew/lib/R/4.6/site-library` (90 packages). **Read-only** — no task may write into `$LIB`.
- Targets: `nflverse 1.0.3, nflreadr 1.5.1, nflfastR 5.2.0, nflseedR 2.0.2, nfl4th 1.0.7, nflplotR 1.6.0` (upstream repos `github.com/nflverse/<pkg>`).
- Mirrors: primary `https://cloud.r-project.org`; second `https://cran.wu.ac.at` (fallback `https://ftp.osuosl.org/pub/cran`).
- Evidence-first: every claim in the final report must cite a file under `$ROOT/evidence/`. A failed command is retried once, then recorded in the workstream's `notes.md` as an evidence gap — never silently skipped, never fabricated.
- Network access only to: the two CRAN mirrors, `github.com`/`raw.githubusercontent.com`/`api.github.com`/`objects.githubusercontent.com` (+ redirect targets of nflverse release assets), `nflverse.com`/`nflreadr.nflverse.com` docs pages.
- Dynamic R runs use `R --vanilla` / `Rscript --vanilla` with caches pointed into `$ROOT`; never write to `~/Library/Caches` deliberately (observing that a package writes there IS evidence — record it).
- **No git commits, no branch changes, no edits outside `docs/audits/`, `docs/superpowers/`, and `$ROOT`** (spec non-goal; deliberate deviation from the skill's commit-per-task default).
- Report deliverables: `docs/audits/2026-07-26-nflverse-stack-forensic-audit.md` + `docs/audits/appendix/*` (left uncommitted for user review).
- Severity scale: Critical / High / Medium / Low / Info.
- Do not fabricate option names, tag names, or URLs: where a name must be discovered (cache option, git tag format, release URL), the step says how to discover it from the installed package itself.

---

### Task 0: Scaffold + shared acquisition stage

**Files:**
- Create: `$ROOT/evidence/ws-{a..f}/`, `$ROOT/{tarballs,sources,mirror2,tmp}/`
- Create: `$ROOT/evidence/installed-manifest.csv`, `$ROOT/evidence/acquisition-log.csv`, `$ROOT/evidence/task0-notes.md`

**Interfaces:**
- Consumes: the live library at `$LIB`.
- Produces (all later tasks rely on these exact paths):
  - `$ROOT/evidence/installed-manifest.csv` — header `package,version,license,needs_compilation,built_r,install_mtime`, 90 rows.
  - `$ROOT/tarballs/<pkg>_<ver>.tar.gz` — one per installed package, downloaded from primary mirror.
  - `$ROOT/sources/<pkg>/` — extracted source tree per package.
  - `$ROOT/evidence/acquisition-log.csv` — header `package,version,channel,url,sha256,http_status`, `channel ∈ {current,archive}`.

- [ ] **Step 1: Create directory skeleton**

```bash
ROOT=/private/tmp/claude-501/-Users-danielwalker-src-ai-sports-betting-dime-ai/dd3b2b85-766c-4b7b-a98c-d928cffcbac2/scratchpad/nflverse-audit
mkdir -p "$ROOT"/evidence/ws-{a,b,c,d,e,f} "$ROOT"/{tarballs,sources,mirror2,tmp}
```

- [ ] **Step 2: Dump installed manifest**

```bash
Rscript --vanilla -e '
lib <- "/opt/homebrew/lib/R/4.6/site-library"
pkgs <- sort(list.dirs(lib, recursive = FALSE, full.names = FALSE))
rows <- lapply(pkgs, function(p) {
  d <- read.dcf(file.path(lib, p, "DESCRIPTION"))
  g <- function(f) if (f %in% colnames(d)) gsub("[\r\n,]+", " ", d[1, f]) else ""
  data.frame(package = p, version = g("Version"), license = g("License"),
             needs_compilation = g("NeedsCompilation"), built_r = g("Built"),
             install_mtime = format(file.info(file.path(lib, p, "DESCRIPTION"))$mtime, "%Y-%m-%dT%H:%M:%S"))
})
df <- do.call(rbind, rows)
write.csv(df, file.path(Sys.getenv("ROOT"), "evidence", "installed-manifest.csv"), row.names = FALSE)
cat(nrow(df), "packages\n")'
```

Run with `ROOT` exported. Expected: `90 packages`.

- [ ] **Step 3: Download all 90 source tarballs from primary mirror**

For each manifest row, try current then archive channel; log to `acquisition-log.csv`:

```bash
cd "$ROOT/tarballs"
echo "package,version,channel,url,sha256,http_status" > "$ROOT/evidence/acquisition-log.csv"
tail -n +2 "$ROOT/evidence/installed-manifest.csv" | while IFS=, read -r pkg ver _rest; do
  f="${pkg}_${ver}.tar.gz"
  for try in "current https://cloud.r-project.org/src/contrib/$f" \
             "archive https://cloud.r-project.org/src/contrib/Archive/$pkg/$f"; do
    ch=${try%% *}; url=${try#* }
    code=$(curl -sfL -o "$f" -w '%{http_code}' "$url" || echo FAIL)
    if [ "$code" = 200 ]; then
      sha=$(shasum -a 256 "$f" | cut -d' ' -f1)
      echo "$pkg,$ver,$ch,$url,$sha,200" >> "$ROOT/evidence/acquisition-log.csv"; break
    fi
  done
done
ls *.tar.gz | wc -l
```

Expected: `90`. Any package with no 200 row → retry once, then record in `task0-notes.md`.

- [ ] **Step 4: Extract all sources**

```bash
cd "$ROOT/sources"
for t in "$ROOT"/tarballs/*.tar.gz; do tar xzf "$t"; done
ls -d */ | wc -l   # expected: 90
```

- [ ] **Step 5: Acceptance check**

Manifest has 90 data rows; acquisition log has 90 rows with `http_status=200`; `$ROOT/sources/`
has 90 dirs whose `DESCRIPTION` versions match the manifest (spot-check the 6 targets exactly).
Record all counts in `$ROOT/evidence/task0-notes.md`.

---

### Task 1 (WS-A): Inventory & dependency forensics

**Files:**
- Create: `$ROOT/evidence/ws-a/dep-edges.csv`, `reachability.txt`, `currency.csv`, `notes.md`

**Interfaces:**
- Consumes: `installed-manifest.csv`, `$LIB` DESCRIPTIONs, CRAN `available.packages()`, `raw.githubusercontent.com/nflverse/<pkg>/HEAD/DESCRIPTION`.
- Produces: `dep-edges.csv` header `from,to,type` (type ∈ Depends/Imports/LinkingTo/Suggests); `reachability.txt` — packages reachable from the 6 targets via hard deps, plus orphan list; `currency.csv` header `package,installed,cran_current,status` (status ∈ current/outdated/archived-or-missing) covering all 90 + a `github_dev` column for the 6 targets.

- [ ] **Step 1: Build dependency edge list from installed DESCRIPTIONs** (R script over `$LIB`, parse `Depends/Imports/LinkingTo/Suggests` fields with `tools:::.split_dependencies` or regex on `read.dcf`; write `dep-edges.csv`).
- [ ] **Step 2: Compute reachability** from the 6 targets over Depends+Imports+LinkingTo edges (BFS in R); orphans = installed − reachable − base/recommended; write `reachability.txt` with both sets.
- [ ] **Step 3: Currency check** — `available.packages(repos="https://cloud.r-project.org")` in R; join against manifest; for the 6 targets also fetch upstream `DESCRIPTION` from GitHub HEAD via curl and record `Version:`; write `currency.csv`.
- [ ] **Step 4: Acceptance check** — every one of the 90 appears in `currency.csv`; the 6 targets appear in `reachability.txt` roots; note counts + anomalies (orphans, outdated) in `notes.md`.

---

### Task 2 (WS-B): Supply-chain integrity

**Files:**
- Create: `$ROOT/evidence/ws-b/hash-verification.csv`, `mirror-crosscheck.txt`, `reinstall-diff/<pkg>.txt` (×6), `github-diff/<pkg>.txt` (×6), `notes.md`

**Interfaces:**
- Consumes: Task 0 tarballs + acquisition log; `$LIB`; both mirrors; `github.com/nflverse/*`.
- Produces: `hash-verification.csv` header `package,version,channel,md5_actual,md5_index_primary,md5_index_mirror2,sha256_primary,sha256_mirror2,verdict` (verdict ∈ PASS/FAIL/GAP); per-package diff reports.

- [ ] **Step 1: Fetch PACKAGES indices from both mirrors** (`/src/contrib/PACKAGES`), extract `Package/Version/MD5sum` triples; diff the two indices for our 90 packages → `mirror-crosscheck.txt`.
- [ ] **Step 2: Verify current-channel tarballs**: `md5 -q` each Task-0 tarball vs both indices' MD5sum (only rows where installed version == index version). Record in `hash-verification.csv`.
- [ ] **Step 3: Verify archive-channel tarballs**: download the same `Archive/<pkg>/<file>` from mirror 2 into `$ROOT/mirror2/`, compare SHA-256 against the Task-0 copy. Record.
- [ ] **Step 4: Clean reinstall diff (6 targets)**: `mkdir $ROOT/tmp/cleanlib`, then for each target `R_LIBS="$LIB" R CMD INSTALL -l $ROOT/tmp/cleanlib $ROOT/tarballs/<pkg>_<ver>.tar.gz`; compare trees against `$LIB/<pkg>`: file list diff + per-file SHA-256; classify differing files (expected: `DESCRIPTION` Built line, `Meta/package.rds`; anything else — especially `R/<pkg>.rdb` — gets byte-level investigation with `cmp -l | head` and `strings` before classification). One report per package in `reinstall-diff/`.
- [ ] **Step 5: GitHub tag diff (6 targets)**: discover the release tag with `git ls-remote --tags https://github.com/nflverse/<pkg>` (match the CRAN version string; record the tag format found). `git clone --depth 1 --branch <tag>`into `$ROOT/tmp/gh/<pkg>`; `diff -r` against `$ROOT/sources/<pkg>` excluding `.git`; classify every difference: repo-only files (`.github/`, `.Rbuildignore` targets, `data-raw/`, pkgdown), tarball-only build artifacts (`MD5`, `build/`, `inst/doc`), and **content diffs in `R/`, `data/`, `src/`, `NAMESPACE`, `configure` — these are findings**. One report per package in `github-diff/`. If no tag matches the CRAN version, record as a finding-level gap and diff against the closest tag, noting it.
- [ ] **Step 6: Acceptance check** — `hash-verification.csv` covers all 90 with no empty verdicts; 6 reinstall + 6 github reports exist; summary counts in `notes.md`.

---

### Task 3 (WS-C): Execution-surface analysis

**Files:**
- Create: `$ROOT/evidence/ws-c/pattern-hits.csv`, `hooks-inventory.md`, `native-code-inventory.md`, `per-package-review/<pkg>.md` (×6), `escalations.md`, `notes.md`

**Interfaces:**
- Consumes: `$ROOT/sources/` (all 90).
- Produces: `pattern-hits.csv` header `package,file,line,pattern,snippet,classification` (classification ∈ benign/note/finding); `escalations.md` — closure packages whose hits warrant Task-7 deep review, with reasons.

- [ ] **Step 1: Automated pattern scan over all 90 source trees** — grep -RnE for: `\bsystem2?\s*\(`, `\bshell\s*\(`, `\bpipe\s*\(`, `eval\s*\(\s*parse`, `\bsource\s*\(`, `unserialize\s*\(`, `readRDS\s*\(`, `\bload\s*\(`, `download\.file`, `curl_(download|fetch)`, `\burl\s*\(`, `Sys\.setenv`, `\.onLoad|\.onAttach|\.onUnload|\.First\.lib`, `processx|callr` usage, writes via `file\.(create|copy|rename)|writeLines|saveRDS` with non-temp paths. Restrict to `R/`, `src/`, `configure*`, `cleanup*`, `Makevars*`, `inst/` (exclude `man/`, `tests/`, `vignettes/`, `inst/doc`). Emit every hit to `pattern-hits.csv` (classification filled in Step 4).
- [ ] **Step 2: Hooks + install-script inventory** — list every package with `.onLoad/.onAttach` (from scan), every `configure`/`cleanup` script (read each fully — there are few), every `Makevars`; summarize per package in `hooks-inventory.md` with what each hook actually does.
- [ ] **Step 3: Native-code inventory** — packages with `src/` (language, approx LOC, what it implements); note this is attack surface reviewed at pattern level only, per spec.
- [ ] **Step 4: Line-level read of the 6 targets** — read **every file** under `sources/<pkg>/R/` for all six (and their `inst/` scripts, `data/` contents via `Rscript -e 'str(load(...))'` equivalents); write per-package review notes covering: load hooks, every network call site, every filesystem write, every eval/parse or NSE trick, anything unexpected. Classify all six packages' rows in `pattern-hits.csv`.
- [ ] **Step 5: Classify remaining closure hits** — for the 84 non-target packages, classify each hit from context (open the surrounding function when needed); anything not confidently benign goes to `escalations.md`.
- [ ] **Step 6: Acceptance check** — zero rows in `pattern-hits.csv` with empty classification; 6 review files exist and each states "all R/ files read" with a file count matching `ls sources/<pkg>/R | wc -l`.

---

### Task 4 (WS-D): Network endpoints & runtime behavior

**Files:**
- Create: `$ROOT/evidence/ws-d/url-census-targets.txt`, `url-census-closure.txt`, `load-side-effects.md`, `dynamic-fetch-log.csv`, `cache-behavior.md`, `offline-behavior.md`, `serialization-channel.md`, `notes.md`

**Interfaces:**
- Consumes: `$ROOT/sources/`, live library (read-only loads), network.
- Produces: `dynamic-fetch-log.csv` header `call,url,status,bytes,dest_file,seconds` — the actual URLs fetched during exercised loads.

- [ ] **Step 1: Static URL census** — `grep -RohE '(https?|ftp)://[^"'"'"' )>,;]+'` over the 6 targets' sources → dedup with counts → `url-census-targets.txt`; same over all 90 → `url-census-closure.txt` (host-level rollup at top).
- [ ] **Step 2: Discover cache + verbosity controls from the installed package** — `Rscript --vanilla -e 'library(nflreadr); print(nflreadr::nflverse_sitrep())'` and read `?nflreadr` options docs from the installed help (`tools::Rd_db("nflreadr")`); record the real option/env names in `notes.md` before use.
- [ ] **Step 3: Load-time side effects, per target package** — fresh `Rscript --vanilla` per package: snapshot `options()`, env, `search()`, tempdir contents, and `~/Library/Caches` listing before/after `library(<pkg>)`; diff and record in `load-side-effects.md`.
- [ ] **Step 4: Cold-cache dynamic fetches** — with cache dir pointed into `$ROOT/tmp/cache` (using the names discovered in Step 2) and `trace()` wrappers on `curl::curl_fetch_memory`/`curl_fetch_disk`/`curl_download` + `utils::download.file` logging URL→file: run `load_schedules(2026)`, `load_players()`, `load_rosters(2025)`, `load_pbp(2025)`, `load_teams()`, and one nflfastR path (`fast_scraper_schedules` equivalent if exported) — append every fetch to `dynamic-fetch-log.csv`; record row/col counts of returned frames.
- [ ] **Step 5: Warm-cache repeat** — same calls; confirm zero/reduced fetches; document cache location, format, and eviction in `cache-behavior.md`.
- [ ] **Step 6: Offline behavior** — same calls with `https_proxy=http://127.0.0.1:9` in env; record error classes/messages in `offline-behavior.md` (does it fail safe? stale-cache fallback?).
- [ ] **Step 7: Serialization channel memo** — combining WS-C source reading and the fetch log: exactly what formats arrive (`rds`/`qs`/`parquet`/`csv`), from which hosts, whether any checksum/signature is verified before `readRDS`/`qs::qdeserialize`, and what a malicious asset could achieve → `serialization-channel.md`.
- [ ] **Step 8: Acceptance check** — fetch log non-empty with all rows resolving to hosts in the URL census (any novel host is itself a finding); all seven output files exist.

---

### Task 5 (WS-E): Licensing & data provenance

**Files:**
- Create: `$ROOT/evidence/ws-e/license-inventory.csv`, `copyleft-flags.md`, `data-licensing.md`, `commercial-posture.md`, `notes.md`

**Interfaces:**
- Consumes: `installed-manifest.csv`, `$ROOT/sources/*/LICENSE*`, GitHub API (`repos/nflverse/<repo>` license field), nflverse docs pages.
- Produces: `license-inventory.csv` header `package,license_declared,spdx_normalized,copyleft,license_file_present`.

- [ ] **Step 1: Normalize licenses for all 90** from manifest + LICENSE files; flag copyleft (GPL/LGPL/MPL/CeCILL) and unusual grants → `license-inventory.csv`, narrative in `copyleft-flags.md` (state plainly: GPL deps used server-side/internally are not distributed — note the AGPL distinction and whether any AGPL package exists in the closure).
- [ ] **Step 2: Data licensing (distinct from code)** — via `gh api` or curl: license of `nflverse/nflverse-data`, `nflverse/nflverse-pbp` if present; WebFetch the nflreadr/nflverse docs pages that state data terms; quote exact language with URLs and access date → `data-licensing.md`.
- [ ] **Step 3: Provenance chain** — document where the release assets originate (NFL feeds/scrapers per nflverse docs), update cadence, and single-point-of-failure notes (GitHub releases availability) → include in `data-licensing.md`.
- [ ] **Step 4: Commercial posture memo** — for a real-money sports-betting product: attribution obligations, any non-commercial clauses found (quote or state none found), trademark/data-rights caveats (NFL marks), and explicit "for counsel review" flags → `commercial-posture.md`. No legal conclusions.
- [ ] **Step 5: Acceptance check** — 90 rows in inventory; every quoted term in `data-licensing.md` carries a URL + access date.

---

### Task 6 (WS-F): API & schema inventory

**Files:**
- Create: `$ROOT/evidence/ws-f/exports.csv`, `dictionaries/<name>.csv` (all shipped dictionaries), `schema-summary.md`, `dime-mapping.md`, `notes.md`

**Interfaces:**
- Consumes: live library namespaces (read-only), nflreadr data dictionaries, Dime context: `~/.claude/projects/-Users-danielwalker-src-ai-sports-betting-dime-ai/memory/{kickoff-datetime-convention,nfl-2026-dataset,fbs-team-crosswalk}.md`, repo files under `server/` for NFL schema if referenced by those memories.
- Produces: `exports.csv` header `package,symbol,kind,signature,title` covering every export of all 6 targets.

- [ ] **Step 1: Full export inventory** — R script: per target, `getNamespaceExports()`, `formals()` → deparsed signature, `tools::Rd_db(pkg)` → `\title` per alias; write `exports.csv`; count per package recorded in `notes.md`.
- [ ] **Step 2: Dump every nflreadr dictionary** — `data(package="nflreadr")` → all `dictionary_*` datasets; `write.csv` each to `dictionaries/`; row counts (field counts) per dictionary in `notes.md`.
- [ ] **Step 3: Schema summary** — `schema-summary.md`: for the core frames (pbp, schedules, rosters, players, teams, contracts, depth charts, injuries…): loader, field count, key fields, seasons coverage as documented.
- [ ] **Step 4: Dime mapping** — read the three memory files; produce `dime-mapping.md` table: Dime convention (kickoff_date PT-derived, kickoff_time ET, canonical UTC; ESPN ID joins; venue/roster fields) vs nflverse equivalent (`gameday`, `gametime` ET, `game_id` format, `espn` id columns in rosters/players), stating agree/disagree/absent per row, plus "what nflverse adds that Dime lacks".
- [ ] **Step 5: Acceptance check** — `exports.csv` non-empty for all 6 packages; every `dictionary_*` in the package has a CSV; mapping table has no empty cells.

---

### Task 7: Escalation reviews (conditional)

**Files:**
- Create: `$ROOT/evidence/ws-c/escalation-reviews/<pkg>.md` per escalated package.

**Interfaces:**
- Consumes: `ws-c/escalations.md`, `$ROOT/sources/<pkg>/`.
- Produces: per-package deep-review notes in the same format as Task 3 Step 4.

- [ ] **Step 1:** If `escalations.md` is empty → record "no escalations" and skip. Otherwise dispatch one focused review per escalated package (line-level read of the implicated files, classification of every flagged hit, verdict).
- [ ] **Step 2: Acceptance check** — every package named in `escalations.md` has a review file with a verdict.

---

### Task 8: Synthesis — report + appendices

**Files:**
- Create: `docs/audits/2026-07-26-nflverse-stack-forensic-audit.md`
- Create: `docs/audits/appendix/package-manifest.md`, `appendix/findings-register.csv`, `appendix/exports-inventory.md`, `appendix/data-dictionaries.md`, `appendix/evidence-index.md`

**Interfaces:**
- Consumes: everything under `$ROOT/evidence/`.
- Produces: `findings-register.csv` header `id,severity,title,claim,evidence,impact,recommendation` (ids `NFLV-001…`); the main report.

- [ ] **Step 1: Build findings register** from all workstream notes — every finding severity-rated, every row's `evidence` column a real path under `$ROOT/evidence/`.
- [ ] **Step 2: Write main report** with sections: Executive summary + verdict; Scope & methodology (including the lost-original-tarballs limitation and trust model); Inventory; Supply-chain integrity results; Execution-surface results; Network & runtime results (incl. serialization-channel memo); Licensing & data provenance; API/schema + Dime mapping; Dependency risk & currency; Findings register (inline table); Limitations; Recommendations (pinning, caching policy, attribution, vendoring options).
- [ ] **Step 3: Write appendices** (full manifest table, full export inventory, dictionary summaries with field counts + core dictionaries in full, evidence index mapping every report section → evidence files).
- [ ] **Step 4: Acceptance check** — grep the report for every `$ROOT/evidence/` citation and confirm each cited file exists; no section empty; verdict present.

---

### Task 9: Verification pass

**Files:**
- Create: `$ROOT/evidence/verification.md`

**Interfaces:**
- Consumes: report + appendices + evidence tree.
- Produces: verification memo; corrected report if discrepancies found.

- [ ] **Step 1: Claims audit** — for each quantitative claim in the executive summary and findings register (counts, PASS totals, field counts), re-derive the number directly from the evidence CSVs (`wc -l`, `awk` filters) and record claimed vs derived.
- [ ] **Step 2: Coverage audit** — spec §7 success criteria checked one by one (all 6 read fully; all 90 hash-verified or gap-documented; licenses complete; no uncited claims).
- [ ] **Step 3: Fix and re-verify** any discrepancy; verification memo states final PASS.

---

### Task 10: Publish + wrap up

**Files:**
- Create: HTML artifact (from report), memory update `~/.claude/projects/.../memory/` if warranted.

- [ ] **Step 1:** Load `artifact-design` skill; render the report as a navigable HTML artifact (private); favicon 🔬.
- [ ] **Step 2:** Final user-facing summary: verdict, top findings, deliverable paths, explicit note that nothing is committed.

## Self-Review (completed at write time)

- **Spec coverage:** §4 WS-A→Task 1 … WS-F→Task 6, escalation→Task 7, synthesis/verification→Tasks 8–9, deliverable 4 (artifact)→Task 10. Spec §5 deliverable paths match Global Constraints. ✓
- **Placeholders:** none — discovery steps (cache option names, tag formats) are explicit discovery procedures, not TBDs. ✓
- **Interface consistency:** evidence filenames and CSV headers defined once in each producing task and referenced identically by consumers (Task 8 cites by directory). `ROOT`/`LIB` defined in Global Constraints. ✓
