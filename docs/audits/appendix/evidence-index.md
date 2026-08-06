# Appendix E — Evidence index

Maps every section of `docs/audits/2026-07-26-nflverse-stack-forensic-audit.md` to the evidence
files that back it. The evidence tree is the authority, and where the report and an evidence file
disagree the evidence file normally wins — but not blindly: the verification pass re-derived each
figure from the underlying artefact (the CSV, the `NAMESPACE`, the `DESCRIPTION`), and in four
places the artefact contradicted the evidence file's own prose. Those are called out inline in the
report and enumerated in `verification.md` §9. The rule is that the *primary artefact* wins.

```text
$ROOT = /private/tmp/claude-501/-Users-danielwalker-src-ai-sports-betting-dime-ai/\
        dd3b2b85-766c-4b7b-a98c-d928cffcbac2/scratchpad/nflverse-audit
```

**Scratchpad tree — copy preserved in-repo.** `$ROOT` is a session scratchpad. It holds 151 files
totalling 2,183,780 bytes across `evidence/ws-a` … `evidence/ws-f`, plus `$ROOT/sources/` (90
extracted CRAN tarballs), `$ROOT/tarballs/` (90 tarballs), `$ROOT/mirror2/` and `$ROOT/tmp/`.
Because the scratchpad is reclaimed, a **verbatim copy of `$ROOT/evidence/` was made 2026-07-27 at
`docs/audits/2026-07-26-nflverse-evidence/`** — same 151 files, same 2,183,780 bytes, `diff -rq`
empty, sha256 spot-checks matching across all six workstreams. Substitute that path for
`$ROOT/evidence/` in any citation below to re-verify it. Only `$ROOT/evidence/` was copied;
`$ROOT/sources/` and the two `R CMD INSTALL` transcripts were not (see report §2.5).

Both trees then gained a 152nd file, `verification.md` — the independent verification pass over the
report and these appendices. The per-workstream table below counts the 151 original evidence files
only; no byte total is quoted for the 152-file state, since it would include a file that changes
whenever the verification memo does. Nothing else under `$ROOT` was modified by the synthesis or
verification passes: `$ROOT/evidence/` and `$ROOT/sources/` were read-only to both,
`verification.md` excepted.

## Report section → evidence

| Report section | Primary evidence | Supporting |
|---|---|---|
| §1 Executive summary and verdict | all of the below | `docs/audits/appendix/findings-register.csv` |
| §2 Scope and methodology | `$ROOT/evidence/task0-notes.md`, `$ROOT/evidence/acquisition-log.csv` | `docs/superpowers/specs/2026-07-26-nflverse-forensic-audit-design.md`, `docs/superpowers/plans/2026-07-26-nflverse-forensic-audit.md` |
| §2.3 Trust model / mirror independence | `$ROOT/evidence/ws-b/mirror-crosscheck.txt` | `$ROOT/evidence/ws-b/raw-logs/mirror-index-crosscheck.out`, `$ROOT/evidence/ws-b/notes.md` |
| §3 Inventory | `$ROOT/evidence/installed-manifest.csv`, `$ROOT/evidence/ws-a/currency.csv`, `$ROOT/evidence/ws-a/dep-edges.csv`, `$ROOT/evidence/ws-a/reachability.txt` | `$ROOT/evidence/ws-a/notes.md`, `$ROOT/evidence/ws-a/scripts/*` |
| §4 Supply-chain integrity | `$ROOT/evidence/ws-b/hash-verification.csv`, `$ROOT/evidence/ws-b/notes.md` | `$ROOT/evidence/ws-b/reinstall-diff/*.txt`, `$ROOT/evidence/ws-b/github-diff/*.txt`, `$ROOT/evidence/ws-b/raw-logs/**` |
| §4.4 nflverse tag defect (NFLV-016) | `$ROOT/evidence/ws-b/github-diff/nflverse.txt` | `$ROOT/evidence/ws-b/raw-logs/github-tag-resolution.txt`, `$ROOT/evidence/ws-b/raw-logs/crlf-classification-nflverse.txt` |
| §5 Execution surface | `$ROOT/evidence/ws-c/pattern-hits.csv`, `$ROOT/evidence/ws-c/hooks-inventory.md`, `$ROOT/evidence/ws-c/escalations.md` | `$ROOT/evidence/ws-c/notes.md`, `$ROOT/evidence/ws-c/per-package-review/*.md` |
| §5.1 The autobrew finding (NFLV-001) | `$ROOT/evidence/ws-c/escalation-reviews/{curl,fs,V8,xml2,magick}.md` | `$ROOT/evidence/ws-c/escalation-reviews/STRUCTURAL-LIMITATIONS.md` §L4, `$ROOT/evidence/ws-c/escalation-reviews/INDEX.md` |
| §5.2 Escalation outcomes | `$ROOT/evidence/ws-c/escalation-reviews/INDEX.md` | all 26 files in `$ROOT/evidence/ws-c/escalation-reviews/` |
| §5.3 Native code | `$ROOT/evidence/ws-c/native-code-inventory.md` | `$ROOT/evidence/ws-c/escalation-reviews/STRUCTURAL-LIMITATIONS.md` §L1 |
| §6 Network and runtime | `$ROOT/evidence/ws-d/url-census-targets.txt`, `$ROOT/evidence/ws-d/url-census-closure.txt`, `$ROOT/evidence/ws-d/dynamic-fetch-log.csv` | `$ROOT/evidence/ws-d/notes.md` |
| §6.1 Load-time side effects | `$ROOT/evidence/ws-d/load-side-effects.md` | `$ROOT/evidence/ws-d/notes.md` Step 3 |
| §6.2 Cache behaviour | `$ROOT/evidence/ws-d/cache-behavior.md` | `$ROOT/evidence/ws-c/escalation-reviews/memoise.md` |
| §6.3 Offline behaviour and cache poisoning | `$ROOT/evidence/ws-d/offline-behavior.md` | `$ROOT/evidence/ws-d/dynamic-fetch-log.csv` (the 6 `EMPTY\|` rows) |
| §6.4 Serialization channel | `$ROOT/evidence/ws-d/serialization-channel.md` | `$ROOT/evidence/ws-c/pattern-hits.csv` |
| §7 Licensing and data provenance | `$ROOT/evidence/ws-e/license-inventory.csv`, `$ROOT/evidence/ws-e/copyleft-flags.md`, `$ROOT/evidence/ws-e/data-licensing.md`, `$ROOT/evidence/ws-e/commercial-posture.md` | `$ROOT/evidence/ws-e/notes.md`, `$ROOT/evidence/ws-e/raw/**` (13 archived source documents) |
| §8 API, schema and Dime mapping | `$ROOT/evidence/ws-f/exports.csv`, `$ROOT/evidence/ws-f/schema-summary.md`, `$ROOT/evidence/ws-f/dime-mapping.md` | `$ROOT/evidence/ws-f/dictionaries/*.csv` (22 files), `$ROOT/evidence/ws-f/notes.md` |
| §9 Dependency risk and currency | `$ROOT/evidence/ws-a/currency.csv` | `$ROOT/evidence/ws-a/notes.md` Step 3, `$ROOT/evidence/ws-a/scripts/03-currency.R` |
| §10 Findings register | `docs/audits/appendix/findings-register.csv` | every path in that file's `evidence` column |
| §11 Limitations | `$ROOT/evidence/ws-c/escalation-reviews/STRUCTURAL-LIMITATIONS.md` | `$ROOT/evidence/ws-b/notes.md` "Scope limits", `$ROOT/evidence/ws-c/notes.md` "What the CSV does not capture", `$ROOT/evidence/ws-d/notes.md` "Evidence gaps" |
| §12 Recommendations | derived from §§4–9 | per-finding `recommendation` column in the register |

## Evidence tree by workstream

| Path | Files | Bytes | Contents |
|---|---:|---:|---|
| `$ROOT/evidence/` (root) | 3 | 29,769 | `installed-manifest.csv` (90 rows), `acquisition-log.csv` (90 rows, all HTTP 200), `task0-notes.md` |
| `$ROOT/evidence/ws-a/` | 11 | 68,413 | Inventory and dependency forensics: `dep-edges.csv` (1,054 rows), `reachability.txt`, `currency.csv` (90 rows), notes, 4 R scripts + 3 logs |
| `$ROOT/evidence/ws-b/` | 44 | 220,294 | Supply-chain integrity: `hash-verification.csv` (90 rows), `mirror-crosscheck.txt`, notes, 6 `reinstall-diff/`, 6 `github-diff/`, 15 `raw-logs/` + 14 scripts |
| `$ROOT/evidence/ws-c/` | 39 | 588,323 | Execution surface: `pattern-hits.csv` (3,637 rows), `hooks-inventory.md`, `native-code-inventory.md`, `escalations.md`, notes, 6 `per-package-review/`, 26 `escalation-reviews/` + `INDEX.md` + `STRUCTURAL-LIMITATIONS.md` |
| `$ROOT/evidence/ws-d/` | 8 | 588,987 | Network and runtime: 2 URL censuses, `dynamic-fetch-log.csv` (24 rows), `load-side-effects.md`, `cache-behavior.md`, `offline-behavior.md`, `serialization-channel.md`, notes |
| `$ROOT/evidence/ws-e/` | 18 | 475,437 | Licensing: `license-inventory.csv` (90 rows), `copyleft-flags.md`, `data-licensing.md`, `commercial-posture.md`, notes, 13 archived raw source documents |
| `$ROOT/evidence/ws-f/` | 28 | 212,557 | API and schema: `exports.csv` (132 rows), `schema-summary.md`, `dime-mapping.md`, notes, 22 dictionary CSVs (1,286 field rows), 2 R scripts |
| **total** | **151** | **2,183,780** | |

## Workstream reports (context, superseded by the evidence tree)

Written by the workstream agents, each independently reviewed. They carry method narrative the
evidence files compress out. Where they disagree with an evidence file, the evidence file wins —
one such disagreement is recorded in §11 of the main report.

| File | Workstream |
|---|---|
| `.superpowers/sdd/task-0-report.md` | Scaffold and shared acquisition |
| `.superpowers/sdd/task-1-report.md` | WS-A — inventory and dependency forensics |
| `.superpowers/sdd/task-2-report.md` | WS-B — supply-chain integrity |
| `.superpowers/sdd/task-3-report.md` | WS-C — execution surface |
| `.superpowers/sdd/task-4-report.md` | WS-D — network endpoints and runtime behaviour |
| `.superpowers/sdd/task-5-report.md` | WS-E — licensing and data provenance |
| `.superpowers/sdd/task-6-report.md` | WS-F — API and schema inventory |
| `.superpowers/sdd/task-7-report.md` | Escalation deep review (26 packages) |
| `.superpowers/sdd/progress.md` | Review ledger — every workstream's review verdict and corrections |

## Reproducing the numbers

Every count in the main report was re-derived from the CSVs during synthesis rather than copied
from a workstream report. The commands:

```sh
E=$ROOT/evidence
awk -F, 'NR>1{print $NF}' $E/ws-b/hash-verification.csv | sort | uniq -c        # 90 PASS
awk -F'","' 'NR>1{print $4}' $E/ws-e/license-inventory.csv | sort | uniq -c     # 72 no, 4 weak, 14 yes
awk -F, 'NR>1{print $3}' $E/ws-a/dep-edges.csv | sort | uniq -c                 # 4/355/6/689 = 1054
awk -F, 'NR>1{print $4}' $E/ws-a/currency.csv | sort | uniq -c                  # 90 current
awk -F'","' 'NR>1{gsub(/"/,"",$1);print $1}' $E/ws-f/exports.csv | sort | uniq -c  # 132 across 6
awk -F, '{print $NF}' $E/ws-c/pattern-hits.csv | sort | uniq -c                 # 2993/628/16 (+hdr)
awk -F'","' 'NR>1{print $4}' $E/installed-manifest.csv | sort | uniq -c         # 39 yes, 51 no
for f in $E/ws-f/dictionaries/*.csv; do echo $(( $(wc -l < $f) - 1 )); done |
  paste -sd+ - | bc                                                             # 1286
```
