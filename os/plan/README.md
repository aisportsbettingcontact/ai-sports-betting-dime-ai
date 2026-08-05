# Master build plan — Dime AI operating system

**Stage 3 of the 100% AI-Native mission** · **Status:** AWAITING APPROVAL · **DRI:** Prez
**Raised:** 2026-08-05 · **Doctrine:** D14 (the fifteen-stage sequence) · D12 (eight layers) · D16 §17

> **For agentic workers:** each issue in `issues/` is independently shippable and carries its own
> acceptance criteria and verification commands. Use `superpowers:subagent-driven-development` or
> `superpowers:executing-plans` to work them task-by-task.

---

## ⚠️ This plan is contingent

The mission's Stage 3 says *"convert rulings into the master build plan."* **No rulings have been
issued.** This plan is therefore written against the **recommendations** in `os/decisions/`, and
every issue names the decision record it depends on plus what changes if that ruling differs.

**Nothing in Wave 1 or later is executed until the relevant record is ruled.** Wave 0 is the
exception and is argued below.

| If Prez rules… | Then… |
|---|---|
| DR-014's cuts **rejected** (keep DR-010/011/013) | +3 waves, ~9 more issues, and D16 criterion 4 is attempted rather than honestly scored PARTIAL |
| DR-005 **rejected** (model loop instead of engineering loop) | ISSUE-013 is rewritten; its apply step must be built before it can be gated, and no live cycle completes inside this mission |
| DR-006 **rejected** (fresh schema instead of the envelope) | ISSUE-006 rewrites rather than adopts; loses 32 adversarial tests |
| DR-003 **rejected** (do not commit the prior program) | **9 of 10 records become unbuildable.** The mission stalls at Wave 0 |
| DR-001 **rejected** (keep publishing gated markets) | ISSUE-004/005 are cut; recorded as a ruling with its rationale, not silently dropped |

---

## Goal

Take Dime from **D1 Level 2 → Level 4** by making work durable, its neglect loud, and its outcomes
observed — then close two real loops end to end and score the D16 scorecard honestly.

**Explicit limits** *(D5: a goal without limits is unevaluable)*: no merge to `main` or production
deploy without a Prez gate; no production data mutation; no loop ships that blends live-pregame and
walkforward-replay provenance; no customer-facing output bypasses the voice/compliance gate;
gitleaks-clean before every push.

## Architecture

Three substrates, ruled once in `DR-014` Ruling 2, and **no fourth**:

1. **Hand-authored org artifacts** → `/os/` on `main`. Reviewed, rare, validated by the
   already-required `Vitest` check.
2. **Machine-generated artifacts** → one orphan branch, **`os-ledger`**. VERIFIED deploy-inert
   (both Railway services pin `source.branch = "main"`).
3. **TiDB `loop_artifacts`** → **DEFERRED**, specified not built. Written trigger: *the first
   artifact kind that must be emitted by the running server and cannot be reconstructed from CI.*

**Enforcement rides jobs that are already required** — `Vitest` and `TypeScript Check` — plus
`.claude/scripts/prompt-capsule.sh`, which fires on every prompt. **No new required status check is
introduced**, because promoting a check is an action this repo has never performed in five ruleset
revisions.

## Tech stack

TypeScript (strict, one `tsconfig`), Vitest, GitHub Actions, git/GitHub as the artifact store,
Claude Code hooks. No new service, no new vendor, no new daemon, no schema change in Waves 0–3.

## Global constraints

- **Merge to `main` IS a production deploy.** Railway auto-deploys `main`.
- **New columns on existing tables require `db-push.yml` FIRST** — Drizzle names every schema column
  in INSERTs. New tables may land ahead if writers probe via `server/schemaCapabilities.ts`.
- Required contexts on `main` are exactly `Security Audit`, `TypeScript Check`, `Vitest`.
  **`Secret Scan (gitleaks)` is NOT required** (gap F6.10) — do not assume it gates.
- Any UI inherits `design-system/dime-ai/MASTER.md`.
- Every claim in every artifact carries VERIFIED / INFERRED / UNKNOWN.
- Both Railway services build with **RAILPACK**, not the Dockerfile (P2) — do not assume Dockerfile
  semantics apply.

---

## Sequencing under D14

**Visibility before autonomy. Evaluation before scale.** The fifteen stages map onto four waves:

| Wave | D14 stages | What it does | Gate |
|---|---|---|---|
| **0 — Unblock** | 5 (create artifacts until the process is legible) | Stop the dark-state bleeding; repair the typecheck break | DR-003 |
| **1 — Customer truth** | 9 (define evaluation before declaring success) | Fix what is currently wrong in front of customers | DR-001, DR-002 |
| **2 — Visibility** | 4, 5, 6, 7 (map the open loop, artifacts, context, analysis) | The five-item minimal system: durable artifacts, loud silence, measured spend | DR-006, DR-008, DR-012, DR-005 |
| **3 — Ownership + first loops** | 3, 8, 9, 10, 11, 12 (outcome + DRI, recommendations, evaluation, reversible action, factory, connect) | Authority ladder, goal records, gate the self-promoter, two live loops, one seat | DR-014 Ruling 4, DR-005, DR-009 |
| **4 — Certification** | 15 (expand only after the loop learns) | Diagnostic + rescore instrument | — |

**Stages 13 and 14** (redesign roles, shift capital) are **not scheduled**: Dime has one human, and
DR-012 measures spend without redesigning it. Recorded here rather than silently skipped.

---

## Issues

`issues/` holds 17 independently shippable issues. Each carries scope, exact files, acceptance
criteria, verification commands, the doctrine section it satisfies, and its ruling dependency.

### Wave 0 — Unblock (no other wave can start)

| # | Issue | Effort | Ruling |
|---|---|---|---|
| [001](issues/ISSUE-001-preserve-dark-state.md) | Push the audit branch + AI-native tree to archive branches | XS | DR-003 |
| [002](issues/ISSUE-002-repair-typecheck-break.md) | Repair the `aiCostMeter` phantom import | XS | DR-003 |

> **Wave 0 is argued for immediate execution even before rulings.** ISSUE-001 pushes non-`main`
> branches, which is VERIFIED deploy-inert; it changes nothing and ends a single-disk exposure on
> work that already mutated production. ISSUE-002 deletes one broken import line. Both are
> reversible and neither commits Prez to any design.

### Wave 1 — Customer truth

| # | Issue | Effort | Ruling |
|---|---|---|---|
| [003](issues/ISSUE-003-pricing-reconciliation.md) | Reconcile three price sets; generate prerender pricing from `TIERS` | S | DR-002 |
| [004](issues/ISSUE-004-publication-gate-wiring.md) | Wire `publish_*` into the read path; suppress Edge Detected on gated markets | M | DR-001 |
| [005](issues/ISSUE-005-suppress-broken-prop-markets.md) | Suppress HR + K props outright until the units fix ships | S | DR-001 |

### Wave 2 — Visibility (the five-item minimal system)

| # | Issue | Effort | Ruling |
|---|---|---|---|
| [006](issues/ISSUE-006-artifact-envelope-and-validator.md) | Adopt the envelope; `/os/` git tier; structural validator on required `Vitest` | M | DR-006 |
| [007](issues/ISSUE-007-observe-by-clock.md) | `observe_by` clock + per-prompt escalation via `prompt-capsule.sh` | M | DR-008 |
| [008](issues/ISSUE-008-token-ledger.md) | Session-cost hook + transcript retention + first real spend numbers | M | DR-012 |
| [009](issues/ISSUE-009-ledger-append-on-merge.md) | Append a loop artifact on every merge to `main` | S | DR-005 |

### Wave 3 — Ownership and the first loops

| # | Issue | Effort | Ruling |
|---|---|---|---|
| [010](issues/ISSUE-010-authority-ladder.md) | `AUTHORITY.md` + rungs, including the mission executor's | S | HOLE C |
| [011](issues/ISSUE-011-goal-record.md) | Goal record type + `GR-0001` for the mission itself | S | HOLE A |
| [012](issues/ISSUE-012-gate-the-drift-detector.md) | Prove whether the self-patcher fires; then gate it propose→decide→apply | M | HOLE B |
| [013](issues/ISSUE-013-first-loops.md) | `LOOP-001` Engineering + `LOOP-002` Operations + mechanical cross-link check | L | DR-005 |
| [014](issues/ISSUE-014-first-agent-seat.md) | `SEAT-001` charter + charter gate on `TypeScript Check` | M | DR-009 |

### Wave 4 — Certification prerequisites

| # | Issue | Effort | Ruling |
|---|---|---|---|
| [015](issues/ISSUE-015-d15-diagnostic.md) | Run the 17-failure-mode diagnostic; schedule its recurrence | M | HOLE D |
| [016](issues/ISSUE-016-level4-rescore-instrument.md) | Make the D1 rescore repeatable and signable | M | criterion 1 |
| [017](issues/ISSUE-017-railpack-builder-incident.md) | Resolve RAILPACK-vs-Dockerfile; file the incident | S | P2 |

---

## Records with no issue, and why

Four decision records produce **no build work**. Recorded here so they are not silently lost —
a record that vanishes from the plan is exactly the drift this mission exists to stop.

| Record | Disposition | Why |
|---|---|---|
| **DR-004** — orchestration spine | **Ruling only, no issue** | Its store choice is overruled by DR-014 Ruling 2, and its agent-runtime answer is the status quo (`dimeAgent` + `piAgent` stay). What survives is a **standing rejection**: *LiteLLM tiered routing is rejected, not deferred* — adopting it would reverse a rule enforced by a `throw` at `server/_core/piAgent.ts:57` and stated at `LLM.md:15`. **Rulings do not rot; mechanisms do.** This one needs recording, not building. |
| **DR-007** — OS Index | **Absorbed into ISSUE-006** | Its load-bearing contribution is the frontmatter contract, which DR-006 already owns. A generated `INDEX.json` committed on every one of ~13 daily merges is constant manual conflict resolution, and a third `SessionStart` hook competes with the two that already exist. |
| **DR-010** — factory thresholds | **CUT** (DR-014 Ruling 1) | ~90% duplicates the now-merged verification framework. Its one surviving sentence — *acceptance thresholds live in a versioned file, shape-checked, numbers not enforced until computable* — folds into ISSUE-006. |
| **DR-011** — founder dashboard | **CUT** (DR-014 Ruling 1) | Escalates through a channel with **zero uses in company history**. Replaced by three lines in `prompt-capsule.sh` (ISSUE-007), which reaches Prez dozens of times a day instead of once. |
| **DR-013** — eight-loop rollout | **CUT** (DR-014 Ruling 1) | An eight-loop program handed to a company that just watched a one-loop program die in 8 days. Its durable idea — the mechanical cross-link test — is absorbed into ISSUE-006 and exercised by ISSUE-013. |

---

## What this plan does NOT do, stated plainly

D16 requires all twelve criteria VERIFIED. This plan **cannot** deliver two of them inside the
mission, and says so rather than faking them:

- **Criterion 4 — eight function loops interconnected.** This plan activates **two** (Engineering,
  Operations). Six are recorded `deferred` with reasons. **Criterion 4 scores PARTIAL**, which is a
  failing grade that routes back through the cycle. Faking it is precisely the failure the mission
  exists to correct. *(DR-014 Ruling 1; DR-013's own honest-verdict clause licenses this.)*
- **Criterion 6 — both factories certified.** The product-code factory is largely satisfied by the
  now-merged verification framework. The **model factory cannot produce a real acceptance number**
  until the suspected `modelProb decimal(5,2)` defect is resolved and CLV columns stop being NULL.
  It scores PARTIAL until then.

Two further honest limits:

- The **CI-side cron observer cannot see the in-process `setInterval` schedulers**, only
  Actions-triggered ones. That named blind spot is the written trigger for building the TiDB tier.
- **Enforcement is bypassable.** `required_approving_review_count: 0`, `bypass_actors: []`, and Prez
  is the admin. These gates raise the cost of a violation; they cannot make one impossible.

## Approval

Per the mission, **approval of this plan is itself a decision-record artifact.** On approval a
`DR-015 — Stage 3 plan approved` is written recording what was approved, what was cut, and the
contingencies above.
