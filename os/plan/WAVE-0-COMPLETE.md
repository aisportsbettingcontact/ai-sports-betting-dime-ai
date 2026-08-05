# Wave 0 — complete

**Closed:** 2026-08-05 · **Authorized by:** DR-015 · **DRI:** Prez · **Executor:** Fable 5

---

## ISSUE-001 — Preserve dark state ✅

| Acceptance criterion | Result |
|---|---|
| `git branch -r --contains local/audit-mlb-model-2026` non-empty | ✅ `origin/archive/mlb-model-audit-2026` |
| AI-native tree preserved | ✅ 37 files on `archive/ai-native-program-2026-07-28` |
| Neither branch is an ancestor of `main` | ✅ both `not on main` — **no deploy triggered** |
| gitleaks clean over all 26 audit commits | ✅ 26 commits, 58.43 MB, **no leaks found**, exit 0 |
| Commit message records the disproved claims | ✅ `IMPLEMENTED_UNVERIFIED` → *written to disk, never integrated*; the false `INCIDENTS.md` citation; the "40 numbered, none OPEN" error; the non-existent brief generator |
| `MANIFEST.md` for the local-only corpora | ✅ `os/corpora/MANIFEST.md` — **125,223 files, 51.26 GB**, roll-up digests |

**Preservation is not adoption.** Both branches are historical records. Nothing is asserted as
current truth and nothing merges to `main`.

## ISSUE-002 — Repair the typecheck break ✅

| Acceptance criterion | Result |
|---|---|
| `tsc --noEmit` exits 0 | ✅ **EXIT=0, 0 errors** (was 1) |
| No `aiWorkflowCosts` references outside comments | ✅ zero |
| No new table in `drizzle/dime.schema.ts` | ✅ zero — deferral is intentional and written down |
| `aiCostMeter.test.ts` passes | ✅ **8/8** |

Fixed by **deletion, not repair**, per DR-012. A written activation trigger for reinstating DB
persistence now lives in the module header. The repair is durable on
`archive/ai-native-program-2026-07-28` (commit 2), so it is not working-tree-only.

---

## Two findings raised, neither actioned (outside Wave 0 scope)

**1. A 47 GB untracked, un-gitignored tree.** `docs/mlb-stats-api/data` — 49,646 files — is
untracked **and not in `.gitignore`**. One `git add -A` at the repo root stages 47 GB. It does not
reach production (`docs` is in `.dockerignore`), so this is a developer-workflow hazard, not a deploy
one. **Awaiting a ruling**; I did not edit `.gitignore` because doing so could mask files someone
intends to commit.

**2. Archive branches bypass CI's secret scan.** `gitleaks.yml` triggers on `pull_request`; a
preservation branch has no PR. For these branches the local scan is the only scan.

## One executor failure, recorded

I ran the gitleaks scan and the `git push` in the **same command block**, so the push was not
conditional on the scan. The outcome was clean, but the gate contributed nothing. Filed as
`os/memory/lessons/a-gate-in-the-same-command-block-is-not-a-gate.md` — the third instance in this
mission of a control that existed, looked right, and was not binding.

---

## Next

Wave 1 (ISSUE-003/004/005) **remains blocked** on DR-001 and DR-002 — both customer-facing, both
Prez's to rule. Wave 2 (ISSUE-006, ISSUE-007) is unblocked by DR-015 and proceeds now.
