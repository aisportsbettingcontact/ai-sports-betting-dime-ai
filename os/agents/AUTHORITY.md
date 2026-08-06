# AUTHORITY — the graduated authority ladder

**Status:** ACTIVE · **DRI:** Prez · **Kind:** governance · **observe_by:** 2026-09-05
**Doctrine:** D12-L5 (execution tools, graduated authority) · D12-L8 (human governance) · D16 §17 criterion 7

> **This file is canonical.** `os/agents/authority.json` is generated from it by
> `scripts/os/authority-sync.mjs`. Never hand-edit the JSON — drift between the two fails the
> required `Vitest` check. One source, never two.

---

## The principle

Agents act, not only generate — but authority is **graduated**, and it is earned:

> Read-only analysis and recommendation first. Reversible, low-risk actions after evaluation shows
> reliability. High-impact or hard-to-reverse actions stay human-gated. *(D12-L5)*

An actor moves up a rung only when its loop has produced evidence of reliability — not when it seems
trustworthy, and not because a task would be faster with more authority.

## Rungs

| Rung | Name | May do | Gate |
|---|---|---|---|
| 1 | read-only | Read any repo state, analyse, recommend, report. Produce artifacts under `/os/`. No mutation of anything outside `/os/`. | none |
| 2 | reversible | Everything in rung 1, plus reversible low-risk action: push non-`main` branches, open PRs, append to `os-ledger`, write CI checks, run read-only queries. | evaluation shows reliability for that action class |
| 3 | irreversible | Merge to `main`, production deploy, schema change, production data mutation, secret access, history rewrite, force-push. | **Prez, per action** |

**Rung 3 is not a rung any agent holds.** It is the boundary at which a human decides. Merge to
`main` **is** a production deploy under Dime's deploy law, which is why it sits here and not in
rung 2.

## Actors

| Actor | Rung | Status | Notes |
|---|---|---|---|
| `Prez` | 3 | ACTIVE | Founder and DRI of every outcome. The only actor at rung 3. |
| `executor` | 2 | ACTIVE | The AI-native mission executor (Fable 5). Full write across the monorepo and `/os/**` on mission branches; may push branches and open PRs. **May not** merge to `main`, deploy, touch production data, rewrite history, or force-push. |
| `os-ledger-append` | 2 | ACTIVE | CI workflow. Appends one cycle artifact per merge to the `os-ledger` orphan branch. `contents: write` scoped to that branch only; justified in `WRITE_APPROVALS`. |
| `SEAT-001` | 2 | DEFERRED | blocked_on: LOOP-002 — run-recorder activates with the Operations loop (ISSUE-013). |
| `SEAT-002` | 1 | DEFERRED | blocked_on: DR-001 and DR-005 — calibration-auditor serves the model loop, which is deferred and gated. |
| `SEAT-003` | 3 | DEFERRED | blocked_on: NO_LOOP — the voice/compliance gate serves no designated loop yet. L4 forbids activating a seat without one. |

**One active agent seat at v1 is the honest number.** DR-009 proposed three; DR-014 cut it to one
because the other two serve loops that are deferred, and DR-009's own gate would have rejected them.

## What this ladder cannot enforce, stated plainly

A governance file that overstates its power is worse than none. Verified 2026-08-05:

- **`required_approving_review_count: 0`** and **`bypass_actors: []`** on `main-protection`. No review
  is required on any merge.
- **Prez is the repository admin.** Any gate here can be bypassed by the person it nominally binds.
- Only **three** contexts are required on `main`: `Security Audit`, `TypeScript Check`, `Vitest`.
  Notably **`Secret Scan (gitleaks)` is NOT among them** (gap F6.10) — it runs and reports, but it
  does not block a merge.

So this ladder **raises the cost of a violation and makes one visible. It cannot make one
impossible.** That is the accurate claim, and it is the one this file makes.

## How an actor moves up

1. The actor operates at its current rung and produces artifacts.
2. Its loop's evaluation shows reliability *for the specific action class* being requested.
3. Prez rules on the promotion, recorded as a decision record in `os/decisions/`.
4. This file is edited; the JSON mirror regenerates; the change lands through a PR.

**No actor promotes itself.** That is the same independent-gate principle that
`server/mlbRecalibrationGate.ts` enforces for model changes, applied to authority.

## Enforcement

- `scripts/os/authority-sync.mjs --check` fails when the JSON mirror drifts from this file.
- `shared/os/authority.test.ts` fails when: the executor has no rung; an actor claims an undefined
  rung; or a `DEFERRED` actor states no `blocked_on:` reason.
- Both ride the already-required `Vitest` check — **no new required status check**, because in five
  ruleset revisions this repo has never once promoted one.
