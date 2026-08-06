# Forensic audit of the installed nflverse R stack — design

**Date:** 2026-07-26
**Status:** Approved via autonomous pipeline (`/sp-brainstorm /sp-plan /sp-subagents` invoked in one
message — treated as pre-approval of the full chain; every scope decision below is a documented
assumption the user can override after the fact).
**Requested by:** user — "full scope, forensic audit, and inspection … maximum depth and granularity."

## 1. Purpose and framing

Pre-adoption due diligence, not incident response. The Dime AI platform (commercial sports-betting
product) just installed the nflverse stack on the primary dev Mac, adjacent to the NFL 2026 dataset
work (PR #202). Before this stack feeds anything, we establish:

1. **Integrity** — is what is installed exactly what CRAN and the upstream nflverse GitHub repos
   publish? (No tampering between source, mirror, and disk.)
2. **Safety** — what code executes at install, load, and use time; what can execute code
   (deserialization, shell-outs, eval); what network endpoints are contacted.
3. **Legality** — code licenses across the whole closure, data licenses of the nflverse-data
   releases, attribution obligations, commercial-use posture for a betting product. Inventory and
   flags only; not legal advice.
4. **Capability** — the full API surface and data schemas, mapped against Dime's own NFL 2026
   dataset conventions.

## 2. Audit targets

| Tier | Scope | Depth |
| --- | --- | --- |
| Primary | nflverse 1.0.3, nflreadr 1.5.1, nflfastR 5.2.0, nflseedR 2.0.2, nfl4th 1.0.7, nflplotR 1.6.0 | Line-level source review, three-way supply-chain reconciliation, dynamic analysis, full API/schema inventory |
| Closure | All 90 packages in `/opt/homebrew/lib/R/4.6/site-library` | Checksum verification, license inventory, automated dangerous-pattern scan, dependency graph, version currency |
| Escalation | Any closure package flagged by the scan | Promoted to line-level review |

Out of scope: R 4.6.1 itself, Homebrew system libraries (ImageMagick etc.) beyond noting them as
attack surface, and any legal opinion.

## 3. Trust model and known limitations

- CRAN (`cloud.r-project.org`) and GitHub over HTTPS serve as reference sources. We do not assume
  either is compromised; we *test* for divergence: installed tree ↔ CRAN tarball ↔ GitHub release
  tag, and CRAN mirror ↔ independent second mirror.
- **Limitation (must appear in the report):** the tarballs actually downloaded during install were
  deleted with R's temp dir. Verification is therefore against *present-day* CRAN artifacts, not
  the install-time bytes. A clean reinstall from freshly verified tarballs, byte-diffed against the
  live library, closes most of that gap.
- Installed packages carry compiled lazy-load databases (`.rdb`), not plain `R/` source — all
  source-level review happens on extracted CRAN tarballs, and the reinstall-diff proves the live
  library corresponds to that source.

## 4. Method — six workstreams + synthesis

Forensic discipline binding all workstreams: every workstream writes raw command output and
structured results (JSON/CSV/MD) to an evidence directory
(`<scratchpad>/nflverse-audit/evidence/ws-{a..f}/`). The final report may only assert what an
evidence file shows, cited by path. Missing evidence is reported as a gap, never papered over.
Failures (network, tooling) are retried once, then recorded as evidence gaps.

### WS-A — Inventory & dependency forensics

Manifest of all 90 installed packages: name, version, license (DESCRIPTION), NeedsCompilation,
system requirements, Built field, install mtime. Recursive dependency graph rooted at the six
targets (who pulled in what; orphans flagged). Version currency: installed vs. CRAN-current as of
2026-07-26, plus upstream nflverse dev versions.

### WS-B — Supply-chain integrity

1. Download all 90 source tarballs at installed versions from `cloud.r-project.org` (current
   versions from `/src/contrib`, superseded ones from `/src/contrib/Archive`).
2. Verify tarballs of *current* versions against the MD5s in the mirror's `PACKAGES` index, with
   the index itself cross-checked against a second independent mirror (chosen at execution from
   `cran.wu.ac.at`, `ftp.osuosl.org`, `cran.ms.unimelb.edu.au`). Versions that have been
   *superseded* since install have no `PACKAGES` entry — for those, verification is SHA-256
   byte-identity of the Archive tarball across the two mirrors.
3. Clean-install the six targets from the verified tarballs into a throwaway library; byte-diff
   against the live library, allowlisting only known-nondeterministic artifacts (timestamps, paths
   embedded in `.rdb`/`.rdx`, `Built:` lines). Any non-allowlisted diff is a finding.
4. For the six targets: diff CRAN tarball contents against the corresponding GitHub release tag of
   the upstream repo (`nflverse/<pkg>`), classifying differences into expected build artifacts
   (`build/`, vignettes, `MD5`) vs. unexpected code divergence in `R/`, `src/`, `configure`,
   `data/`.

### WS-C — Execution-surface analysis

1. Automated scan over all 90 extracted source trees for: `system`/`system2`/`shell`/`pipe`,
   `eval(parse`, `source(`, `unserialize`/`readRDS` on remote input, `download.file`/`curl`/`url(`,
   `.onLoad`/`.onAttach`/`.onUnload` hooks, `configure`/`cleanup`/`Makevars` scripts, compiled
   `src/` presence, `Sys.setenv`, file writes outside tempdir/cache.
2. Line-level read of **every** `R/` file in the six targets (pure-R packages; tractable), plus
   their load hooks and any `data/` payloads.
3. Every hit classified: benign-by-context / needs-note / finding, with file:line evidence.

### WS-D — Network endpoints & runtime behavior

Static: catalog every URL/host in the six targets' sources + closure-wide host census.
Dynamic, in fresh `R --vanilla` sessions with `NFLREADR_CACHE`/cache options pointed at the
scratchpad: load each target package and snapshot side effects (options set, env vars read,
connections opened, files created); exercise representative loaders cold
(`load_schedules(2026)`, `load_rosters`, `load_pbp` sample, `load_players`); record actual hosts
contacted (curl verbose / DNS observation) and bytes/files written; repeat warm to characterize
cache behavior; offline run to characterize failure mode. Characterize precisely the
unsigned-serialized-data channel (`.rds`/`.qs` from GitHub releases) and what protects it
(HTTPS only? checksums? nothing?).

### WS-E — Licensing & data provenance

SPDX-normalized license per closure package from DESCRIPTION (flag copyleft/unusual; expected mix
MIT/GPL-2/GPL-3/Apache — GPL runtime linkage is normal for internal R use but must be stated).
Data licensing distinct from code: nflverse-data / nflverse.com terms for the release assets the
loaders fetch, attribution obligations (CC-BY-style), provenance chain of the data itself (NFL
feeds → nflverse scrapers → GitHub releases). Commercial-use posture notes for a betting product,
flagged for counsel review.

### WS-F — API & schema inventory

Every export of the six targets (name, signature, one-line purpose) from live namespaces —
maximum granularity means the full list, not highlights. Full field-level data dictionaries
shipped in nflreadr (`dictionary_pbp` ~370+ cols, schedules, rosters, players, contracts, etc.),
dumped to CSV evidence and summarized. Explicit mapping table against Dime's NFL 2026 dataset
conventions: kickoff datetime rules (PT-derived date, ET stored time, UTC canonical), ESPN ID
crosswalk joins, venue/roster fields — where nflverse agrees, disagrees, or adds columns.

### Synthesis & verification

Findings register: ID, severity (Critical/High/Medium/Low/Info), claim, evidence path(s), impact
for Dime, recommendation. Executive summary with overall adopt/hold verdict. Verification pass
before completion: every report claim resolves to an evidence file; headline integrity numbers
(checksum pass counts, diff results) re-derived independently from the evidence; internal
consistency check across sections.

## 5. Deliverables

1. **Evidence bundle** — `<scratchpad>/nflverse-audit/evidence/` (raw outputs, manifests, diffs,
   dictionaries). Ephemeral but referenced by path from the report.
2. **Main report** — `docs/audits/2026-07-26-nflverse-stack-forensic-audit.md` (committed nowhere
   by default; left as working-tree files for user review on the current branch).
3. **Appendices** — `docs/audits/appendix/` (full package manifest, full export inventory, full
   data dictionaries, findings register CSV) so the main report stays readable.
4. **HTML artifact** — a rendered, navigable version of the report published as a private
   Claude artifact.

## 6. Execution architecture

`superpowers:subagent-driven-development`, adapted for an investigation: WS-A…WS-F run as six
parallel subagents (each self-contained: its own evidence dir, its own tools, structured output
contract back to the orchestrator). Synthesis runs in the main session after all six report.
Escalations (WS-C flags on a closure package) fan out as additional targeted subagents before
synthesis. Verification is a distinct final pass in the main session.

## 7. Success criteria

- Every one of the six targets: source fully read, integrity three-way-reconciled, exports and
  schemas fully inventoried.
- All 90 closure packages: checksum-verified, license-inventoried, pattern-scanned.
- Zero report claims without evidence citations; limitations section present and honest.
- The user can act on the report: a clear verdict, ranked findings, and concrete recommendations
  (e.g. pin versions, vendor data, cache policy, license attributions to ship).

## 8. Non-goals

No repo commits or branch changes; no changes to the app; no legal conclusions; no performance
benchmarking; no Windows/Linux portability audit; no audit of R itself or Homebrew libraries
beyond their appearance in the attack-surface narrative.
