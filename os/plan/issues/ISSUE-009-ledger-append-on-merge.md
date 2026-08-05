# ISSUE-009 — Append a loop artifact on every merge to main

**Wave:** 2 — Visibility · **Effort:** S · **Status:** NOT STARTED · **DRI:** Prez
**Ruling dependency:** DR-005
**Doctrine:** D5 (every action leaves an artifact) · D7 (five-level chain) · D16 criterion 3

---

## Scope

The single strongest survival property available in this plan: **merge-to-main fires ~13×/day
without anyone remembering to do it.** A mechanism that rides that event cannot be forgotten.

On every merge to `main`, append one artifact to the `os-ledger` orphan branch recording the change:
PR number, intent linkage, the gates that passed, the deploy that resulted, and a slot for the
outcome to be observed later.

**Do not mint a parallel evidence record.** The now-merged verification framework already writes
`proof-contract.json` per PR. One file, one job, assembling that contract + the loop linkage + the
cost block from ISSUE-008.

## Files

- Create: `.github/workflows/os-ledger-append.yml` (on push to `main`)
- Create: `scripts/os/ledger-append.mjs`
- Consumes: `proof-contract.json` from workflow `01-pr-proof-contract`
- Target: orphan branch `os-ledger` (VERIFIED deploy-inert)

## Acceptance criteria

Every criterion is checkable. A criterion that cannot be checked is not a criterion.

- [ ] Every merge to `main` appends exactly **one** artifact to `os-ledger`
- [ ] The artifact consumes the existing `proof-contract.json` rather than duplicating it
- [ ] The append is **idempotent** — replaying the same merge produces no second record (dedupe on content hash)
- [ ] The workflow needs `contents: write` scoped to `os-ledger` only, added to the `WRITE_APPROVALS` map in `scripts/check-github-actions-security.mjs` with a written justification — the framework exists to make such a grant reviewable
- [ ] `os-ledger` is confirmed deploy-inert **before** the first push
- [ ] The artifact carries an empty `outcome` slot with an `observe_by` (ISSUE-007), so an unobserved merge becomes overdue

## Verification

Run these and paste the raw output. Per `OPERATING-RULES.md` Rule 6, a DONE claim without
this evidence is void.

```bash
# Confirm the orphan branch cannot deploy
# (both Railway services must report source.branch = "main")

# Dry-run the appender against a real merge commit
node scripts/os/ledger-append.mjs --sha ff3108704 --dry-run | tail -20

# Idempotency: run twice, expect one record
node scripts/os/ledger-append.mjs --sha ff3108704 --dry-run | sha256sum
node scripts/os/ledger-append.mjs --sha ff3108704 --dry-run | sha256sum   # identical

# The actions-security gate must still pass with the new write grant
node scripts/check-github-actions-security.mjs; echo "EXIT=$?" 
```

## Depends on

ISSUE-006 (envelope), ISSUE-007 (`observe_by`), ISSUE-008 (cost block).

## If the ruling differs

DR-005's own design proposes a fail-closed `13-loop-intent` gate requiring an intent issue on every
substantive PR. **DR-014 does not adopt that** — at 13 PRs/day it either never becomes required
(advisory ⇒ dead) or becomes required and gets routed around via an exemption label. If Prez wants
the gate, it needs a ruling of its own and an honest read of that risk.
