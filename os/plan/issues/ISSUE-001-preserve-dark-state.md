# ISSUE-001 — Preserve dark state to archive branches

**Wave:** 0 — Unblock · **Effort:** XS · **Status:** NOT STARTED · **DRI:** Prez
**Ruling dependency:** DR-003 (Phase A)
**Doctrine:** D6 (minimize invisible consequential state) · D12-L2 · D16 criterion 12 (no dark state)

---

## Scope

End the single-disk exposure on finished work that already mutated production. **Preservation is
not adoption** — these branches are a historical record, not truth. Nothing is merged to `main`.

Two pushes:
1. `local/audit-mlb-model-2026` (26 commits ahead of `main`, tip `8190a7d96`, never pushed) →
   `archive/mlb-model-audit-2026`. Contains the forensic audit, backfill tooling, the **provenance
   regime**, and the **publication-gate wiring** — i.e. the fixes for gaps F5 and F3.2.
2. The untracked AI-native tree (`docs/ai-native/` 17 files, `shared/loop/` 4, `server/loop/` 2, plus
   7 `server/*.ts` modules) → `archive/ai-native-program-2026-07-28`, committed **exactly as found**.

## Files

- Push only: `local/audit-mlb-model-2026` → `origin/archive/mlb-model-audit-2026`
- Create: `archive/ai-native-program-2026-07-28` from `origin/main`, adding the untracked tree verbatim
- Modify: nothing on `main`

## Acceptance criteria

Every criterion is checkable. A criterion that cannot be checked is not a criterion.

- [ ] `git branch -r --contains local/audit-mlb-model-2026` is **non-empty** (was empty)
- [ ] `git ls-tree -r archive/ai-native-program-2026-07-28 -- docs/ai-native shared/loop server/loop` returns **23+ files**
- [ ] Neither branch is `main`; `git merge-base --is-ancestor <branch> origin/main` is **false** for both
- [ ] `gitleaks` scan over **all 26 commits** of the audit branch reports **zero findings** — if it does not, do not push, and file an incident
- [ ] The AI-native commit message states plainly that `execution-state.json`'s `IMPLEMENTED_UNVERIFIED` claims were **disproved by the Stage 1 audit**, and that the files are preserved as a historical record, not as current truth
- [ ] A `MANIFEST.md` is committed to `/os/` for the 52 GB of local-only corpora (47 GB MLB feeds, 3.8 GB NFL DB, 1.2 GB audit evidence): identity, size, file count, checksum roll-up, how produced, regeneration command

## Verification

Run these and paste the raw output. Per `OPERATING-RULES.md` Rule 6, a DONE claim without
this evidence is void.

```bash
# 1. Secret-scan the full audit branch BEFORE pushing anything
docker run --rm -v "$PWD:/p" zricethezav/gitleaks:latest detect --source=/p --log-opts="main..local/audit-mlb-model-2026" --no-banner
# (or: gitleaks detect --source=. --log-opts="main..local/audit-mlb-model-2026")

# 2. Confirm the branch is genuinely unpushed
git branch -r --contains local/audit-mlb-model-2026     # expect: empty

# 3. Push (a non-main branch is NOT a deploy — both Railway services pin source.branch=main)
git push origin local/audit-mlb-model-2026:archive/mlb-model-audit-2026

# 4. Verify it landed and is not on main
git branch -r --contains local/audit-mlb-model-2026     # expect: origin/archive/mlb-model-audit-2026
git merge-base --is-ancestor local/audit-mlb-model-2026 origin/main && echo "ON MAIN - WRONG" || echo "not on main - correct" 
```

## Depends on

Nothing. **This is the hard blocker for 9 of the 10 design records.**

## If the ruling differs

If DR-003 is rejected, the mission stalls here: `shared/loop/` cannot enter git, ISSUE-006 collapses
to a from-scratch schema, and 52 GB of evidence plus a production-mutating branch stay on one disk.
Record the rejection as a ruling with its rationale — do not leave it implicit.

## Notes

`git push` of a non-`main` branch is **VERIFIED deploy-inert**: both Railway services report
`source.branch = "main"` (Railway MCP, read-only). This issue therefore carries no production risk
and requires no review to be safe — review gates the *merge*, not the *existence of the record*.
