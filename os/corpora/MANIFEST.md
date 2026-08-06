# MANIFEST — local-only data corpora

**Generated:** 2026-08-05 · **ISSUE-001** (Wave 0) · **DRI:** Prez

These corpora are the evidence base under Dime's forensic audits. They are far too large for git
and **should not** be committed. This manifest converts them from *invisible* state into *known,
locatable, regenerable* state — which is what D6 actually requires.

**Backing up the bytes off this disk is a separate operational decision. It is flagged here, not
made here.**

| Corpus | Path | Files | Size | Roll-up digest |
|---|---|---|---|---|
| `mlb-feed-corpus` | `docs/mlb-stats-api/data` | 49,646 | 46.47 GB | `252143f6985be7707ff2d9c4d5abceeb` |
| `nfl-db` | `scripts/data/nfl-db` | 75,304 | 3.62 GB | `0208e0d493ac3c7eb509d2c2c248ab8f` |
| `audit-evidence` | `docs/audits` | 273 | 1.17 GB | `107622796a4c89c13b2f1652d2134168` |
| **total** | | **125,223** | **51.26 GB** | |

The digest is a sha-256 over each file's path and size, walked in sorted order. It detects
addition, removal, rename, and resize — it does **not** detect a content edit that preserves size.
That limit is stated rather than papered over; a full content hash over 52 GB was judged not worth
its cost for a drift check.

## How each was produced

| Corpus | Producer | Regeneration |
|---|---|---|
| `mlb-feed-corpus` | `scripts/mlb-crawl/crawl_feeds.py` (writes to `docs/mlb-stats-api/data`) | Re-run the crawler per season; `verify_feeds.py` validates |
| `nfl-db` | `scripts/data/nfl-db/` pipeline (nflverse + ESPN, multi-pass integrity gates) | Re-run the build; **the pipeline itself is untracked — see the hazard below** |
| `audit-evidence` | Output of the 2026-07 forensic audits | Not regenerable — it is a record of what was observed at a point in time |

## HAZARD found while writing this manifest

**`docs/mlb-stats-api/data` is untracked *and not gitignored*.** 49,646 files, 47 GB, all sitting in
`git status` as untracked. That is why `git ls-files --others --exclude-standard` returns 75,483
entries repo-wide.

A careless `git add -A` at the repo root would attempt to stage 47 GB. The corpus is also only
*partially* tracked — 24 files under that path **are** in git.

It does not reach the production image (`docs` is excluded in `.dockerignore`), so this is a
developer-workflow hazard, not a deploy one. **Recommended: add the data paths to `.gitignore`.**
Not done here, because `.gitignore` is outside Wave 0's authorized scope and changing it could mask
files someone intends to commit. Raised for a ruling.

## Provenance

Counts and sizes measured 2026-08-05 by walking each tree. The Stage 1 audit's "52 GB" figure is
**confirmed accurate** — one of the few inherited numbers in this mission that survived verification
unchanged.
