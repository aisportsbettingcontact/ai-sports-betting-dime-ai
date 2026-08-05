# DR-015 — Stage 3 plan approved

**Status:** RULED · **Ruled:** 2026-08-05 by Prez · **DRI:** Prez
**Kind:** consolidation
**Governs:** `os/plan/README.md` and `os/plan/issues/ISSUE-001` … `ISSUE-017`
**Doctrine:** D14 (the fifteen-stage sequence) · D16 §17 · mission Stage 3 gate

> Per the mission, **approval of the Stage 3 plan is itself a decision-record artifact.** This is
> that artifact. It records what was approved, what was cut, what the approval does **not** cover,
> and the contingencies that remain live.

---

## The ruling

**Prez approved the Stage 3 master build plan on 2026-08-05.**

Verbatim instruction: *"approve stage 3 plan"*.

## Ruling 1 — What the approval covers

1. **The wave sequencing** under D14 — Unblock → Customer truth → Visibility → Ownership →
   Certification. Visibility before autonomy; evaluation before scale.
2. **The 17-issue scope** in `os/plan/issues/`, each with its acceptance criteria and verification
   commands.
3. **DR-014's consolidation rulings**, which the plan is built on:
   - **Ruling 1** — cut DR-010 (factory thresholds), DR-011 (founder dashboard), DR-013 (eight-loop
     rollout); DR-007 absorbed into DR-006.
   - **Ruling 2** — one substrate map (git `/os/` · orphan `os-ledger` · TiDB deferred), one clock,
     one per-PR artifact, one issue-writer, one frontmatter schema, one new SessionStart hook.
   - **Ruling 3** — `.claude/scripts/prompt-capsule.sh` is the escalation channel, **not** GitHub
     issues and **not** new required status checks.
   - **Ruling 4** — the four holes assigned: goal record (ISSUE-011), the live self-patching drift
     detector (ISSUE-012), the authority ladder (ISSUE-010), the D15 diagnostic (ISSUE-015).
4. **The five-item minimal system** as Stage 4's core scope.
5. **The honest certification verdict**: D16 **criterion 4 scores PARTIAL** (two loops live, six
   deferred with reasons) and **criterion 6 scores PARTIAL** (the model factory cannot produce a real
   acceptance number until the suspected `modelProb decimal(5,2)` defect is resolved and CLV columns
   stop being NULL). **Faking either is the failure this mission exists to correct.**
6. **The plan's explicit argument that Wave 0 executes before individual rulings** — because pushing
   a non-`main` branch is VERIFIED deploy-inert, and repairing the `aiCostMeter` phantom import is a
   single deleted line that currently blocks every commit in the tree.
7. **What the plan does not schedule**: D14 stages 13 (redesign roles) and 14 (shift capital) —
   Dime has one human, and DR-012 measures spend without redesigning it. Recorded, not skipped.

## Ruling 2 — What the approval does NOT cover

Stated explicitly so the boundary is not assumed away:

| Not covered | Why it still needs a ruling |
|---|---|
| **DR-001** — publish posture on the 9 BACKTEST-ONLY markets | Customer-facing claim plus a revenue tradeoff. ISSUE-004 and ISSUE-005 stay blocked |
| **DR-002** — pricing reconciliation | Pricing is a founder decision. ISSUE-003 stays blocked |
| **DR-003** — the dark-state rescue, beyond Wave 0's Phase A | Phase B's five reviewed PRs touch model behaviour and need their own review |
| Any merge to `main` or production deploy | Unchanged: **merge to `main` IS a production deploy**, and that gate stays with Prez until `os/agents/AUTHORITY.md` says otherwise |

**Wave 1 does not begin until DR-001 and DR-002 are ruled.**

## Ruling 3 — Live contingencies

The plan is written against **recommendations**, not rulings. These remain true:

- If **DR-003** is rejected, 9 of 10 records become unbuildable and the mission stalls at Wave 0.
- If **DR-005** is rejected in favour of the model release loop, no live cycle completes inside this
  mission — its apply step must be built before it can be gated.
- If **DR-006** is rejected in favour of a fresh schema, the 32 adversarial tests inherited from
  `shared/loop/` are lost — the largest single quality regression available in this plan.

## What this authorizes now

**Wave 0 only:**

- **ISSUE-001** — preserve the dark state to `archive/*` branches, gated on a clean `gitleaks` scan
  over all 26 commits. Nothing merges to `main`.
- **ISSUE-002** — repair the `aiCostMeter` phantom import so the tree typechecks.

## Evidence

| Artifact | State at approval |
|---|---|
| `os/plan/README.md` | on `main` @ `f32ee7712`, byte-verified |
| `os/plan/issues/` | 17 issues, 0 incomplete |
| `os/decisions/` | 14 records, format contract 0 failures |
| Whole `/os/` tree | 53 files, tree hash `14405a6cb3b6…`, byte-identical to source |

## Adjustment recorded

Five of the six PRs preceding this approval were **verification-and-correction loops on the
mission's own output** — two merge races and a half-finished correction, each invisible to the push,
to the green PR, and to CI, and each caught only by an after-the-fact audit.

That is the empirical case for **ISSUE-006** (a structural validator on the already-required
`Vitest` job) and **ISSUE-007** (the `observe_by` clock on the per-prompt hook) being Wave 2's first
two items. Both are in the approved plan. Until they ship, the executor is performing by hand, every
turn, exactly what they exist to automate.
