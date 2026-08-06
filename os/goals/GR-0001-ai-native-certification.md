# GR-0001 — Dime AI operates as a closed, queryable, self-improving system

**Status:** ACTIVE · **DRI:** Prez · **Kind:** goal · **observe_by:** 2026-09-05
**Doctrine:** D12-L1 (goals + ownership, nine fields) · D5 (a goal with limits) · D16 §17

> The mission's own goal record, and the worked example of the type. Written because the Stage 1
> audit found **no goal record type existed anywhere** — and D16 criteria 2, 5 and 9 all fail on
> that one missing type.

---

## Desired outcome

Dime AI is **certified 100% AI-Native** against the twelve-criterion scorecard in `os/DOCTRINE.md`
§17 — every criterion VERIFIED with a linked artifact or tool result, signed by a fresh-context
verifier and countersigned by Prez.

Stated as what must become true, not what activity should occur: **every important process at Dime
is a closed loop whose outcome is observed, whose evaluation is recorded, and whose lesson is
retrievable — and no consequential state exists only in someone's session memory.**

## The need behind it

Dime is one human plus agents, shipping ~13 PRs/day. At that rate the binding constraint is not
capability — it is that **nothing observes whether the work worked**. The Stage 1 audit scored the
company **Level 2 of 4**: excellent raw materials, and almost no closed loop anywhere that matters.

The commercial need is sharper than the doctrinal one. Dime sells analytical software on a
transparency-first promise. It cannot honestly sell decision quality it cannot demonstrate — and
today it demonstrates nothing to customers: every grading surface is owner-only, CLV is NULL, and
production holds its own "do not publish" verdicts that no code reads.

## Evidence that justified pursuing it

- `os/audits/2026-08-ai-native-audit.md` — 110 claims verified (84 agents, 6,134,033 tokens):
  **31 VERIFIED · 39 PARTIAL · 40 REFUTED**. D1 level: **2 of 4**.
- `os/audits/gap-map.md` — **96 open loops** → 9 gap families + 3 urgent live findings.
- The decisive precedent: a prior AI-native program (2026-07-28) produced high-quality work and
  **died in 8 days because nothing noticed it had stopped.** Its 5-item owner queue sat untouched
  while `main` took ~350 commits elsewhere.
- **Incident 62 (2026-08-05)** — gap F7.6, filed that morning, caused two failed production
  deployments that same evening and was invisible to CI. The diagnosis was ahead of the machinery.

## Acceptance criteria

- [ ] All twelve D16 §17 criteria scored, each **VERIFIED** with a linked artifact or tool result
- [ ] `os/certification/` published, signed by a fresh-context verifier, countersigned by Prez
- [ ] At least one function loop has completed a **live** cycle with an observed outcome and a filed
      adjustment — not a fixture cycle
- [ ] The D15 diagnostic has run end to end with **zero unresolved critical findings**
- [ ] A spot audit finds **no consequential decision, ruling, or lesson existing only in session
      memory**

**PARTIAL and MISSING are failing grades.** Criteria 4 and 6 are expected to score PARTIAL at first
certification (see Constraints); that is recorded in advance so the result cannot be rationalised
afterwards.

## Constraints

Absolute, and they bind regardless of schedule pressure:

- **No merge to `main` or production deploy without a Prez gate** — merge to `main` IS a production
  deploy. The executor holds rung 2 (`os/agents/AUTHORITY.md`); rung 3 is human-gated.
- **No production data mutation.** No history rewrite. No force-push.
- **No loop ships that blends live-pregame and walkforward-replay provenance** — a loop that blends
  them fails its evaluation layer by definition.
- **No customer-facing output bypasses the voice/compliance gate.**
- **`gitleaks`-clean before every push** — SEC-006 never happens again.
- **Honest PARTIALs over faked VERIFIEDs.** Criterion 4 (eight loops interconnected) and criterion 6
  (both factories) are expected to score PARTIAL. Faking either is the exact failure this goal
  exists to correct.

## Time horizon

First certification attempt: **2026-08-31**. Recertification monthly thereafter, first Monday, per
`os/DOCTRINE.md` §17.

## Responsible individual

**Prez.** DRI of record for this goal and for every loop until the hiring loop justifies otherwise.
The executor (Fable 5) builds and reports; it does not own the outcome.

## Current status

**Wave 3 of 4.** Waves 0 and 2 are complete and live on `main`: dark state preserved, artifact gate
binding on the required `Vitest` check, `observe_by` clock on the per-prompt hook, token ledger
measuring **$6,272.08**, engineering loop recording every merge, and the authority ladder enforcing.

Blocked on three Prez rulings: **DR-001** (publish posture — overdue on the clock 2026-08-12),
**DR-002** (pricing), and the `.gitignore` ruling for the 47 GB untracked tree.

## Evaluation measures

| Measure | Threshold | Current | Source |
|---|---|---|---|
| D16 criteria VERIFIED | **12 of 12** | 0 scored | `os/certification/` (not yet written) |
| D1 level | **4 of 4** | **2** | `os/audits/2026-08-ai-native-audit.md` |
| Function loops with a completed live cycle | **≥ 1** | 0 | `os-ledger` cycle artifacts (8 recorded, all `outcome: null`) |
| Open `/os/` items past `observe_by` | **0** | see clock | `scripts/os/clock.mjs` |
| D15 diagnostic unresolved criticals | **0** | not yet run | ISSUE-015 |
| Consequential state existing only in session memory | **0** | 0 known | spot audit |

The third row is the honest one: **eight merges are recorded and not one outcome has been observed
yet.** That is the gap between an action and an outcome, measured rather than asserted.

## Activity paths

Where work on this goal is expected to land. Divergence is computed by
`findPriorityContradiction` and surfaced by the founder loop.

- `os/**`
- `shared/os/**`
- `scripts/os/**`
- `.github/workflows/os-*.yml`

## Readings

Point-in-time results of `scripts/os/contradiction.mts`. Kept as an append-only series: a
reading is evidence of what was true on a date, never a standing claim.

> **Structural note.** These readings deliberately live in their own `##` section rather than
> as a subsection of **Activity paths**. The PR #398 audit found that an `###` subsection under
> that heading was being parsed as additional activity-path globs — GR-0001 silently declared
> six priorities instead of four. `parseGoal` now terminates a section at any heading level and
> rejects a non-path-shaped entry, but the layout no longer depends on that being right.

### 2026-08-05 — CONTRADICTION FLAGGED (3 of 7, 43%)

| | PR | |
|---|---|---|
| ON | #391 | ledger-append-on-merge |
| OFF | #392 | schema/code-agreement health gate |
| ON | #393 | proof-contract link fix |
| OFF | #394 | schema-gate zombie fix |
| OFF | #395 | Incident 62 |
| ON | #396 | authority ladder |
| OFF | #397 | analytics-store startup skip |

**The globs were deliberately NOT widened to clear this.** Widening a priority definition until
the contradiction disappears games the measure D13 exists to provide, and it is the D15 #14
failure in miniature.

Interpretation, for the DRI to accept or reject — the mechanism reports, it does not judge:

- **#392, #394, #397 are genuine parallel work**, not mission work. Security hardening and an
  analytics fix ran alongside this goal. That is a real allocation fact and it is what the check
  is built to surface.
- **#395 is a known calibration limit.** Filing Incident 62 *was* mission work, but it landed in
  `INCIDENTS.md`, which is not a declared path — and `INCIDENTS.md` is deliberately excluded
  because doctrine L2 says link to it, never move or rewrite it. The check therefore under-counts
  incident-filing as on-goal. Stated rather than patched.

### 2026-08-06 — CLEARED (4 of 8, 50%)

Recomputed after PR #398 merged. **The contradiction no longer fires**, and the reason is worth
stating plainly rather than presenting as progress: **#398 was itself the eighth cycle, and it is
on-goal.** The act of recording the first reading is what moved the number past its own threshold.

Two properties this exposes, both left in place rather than tuned away:

- **A reading can be invalidated by the merge that publishes it.** The 2026-08-05 entry above was
  already stale when it landed. That is why readings are dated and appended, never edited in place.
- **50% sits exactly on the knife edge.** The rule is `share < 0.5`, so an even split reports *no*
  contradiction. The threshold is NOT being adjusted in response to a specific result — moving a
  line because of where a point fell is the same failure as widening the globs.

Also corrected in this pass: the first reading was computed by a script that reimplemented the
glob matcher with a different sentinel than the tested library, so **the number came from code no
test covered**. `scripts/os/contradiction.mts` now imports `shared/os/goal.ts` and owns no matching
logic. The 43% and 50% figures were both re-derived under the single implementation.

