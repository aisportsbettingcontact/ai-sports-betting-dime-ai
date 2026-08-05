# ISSUE-013 — Bring up LOOP-001 (Engineering) and LOOP-002 (Operations)

**Wave:** 3 — Ownership · **Effort:** L · **Status:** NOT STARTED · **DRI:** Prez
**Ruling dependency:** DR-005 + DR-014 Ruling 2
**Doctrine:** D5 (the seven components + nine questions) · D7 · D13 · D14 stages 3-12 · D16 criteria 3, 4

---

## Scope

Designate Dime's first closed loops.

**LOOP-001 — Engineering Build Loop.** Change intent → PR → binding gates → **merge-to-main as the
owner-gated apply step** → Railway deploy → `deploy-smoke` verdict → evaluation → filed adjustment.
Its decisive advantage: **its apply step already exists and already works**, ~13×/day. Elapsed cycle
time ≈ 48 hours, with dozens running concurrently.

**LOOP-002 — Operations (cron cadence observation).** Activated with it because a cross-link test
needs two loops to be satisfiable at all. One CI-side observer, **zero production change**:
`scripts/os/observe-crons.mjs` diffs declared schedule expressions against `gh run list`.

**Named blind spot, written down:** a CI-side observer **cannot see the in-process `setInterval`
schedulers**, only Actions-triggered ones. That blind spot is the written trigger for building the
TiDB tier.

## Files

- Create: `os/loops/LOOP-001-engineering-build.md`, `os/loops/LOOP-002-operations.md`
- Create: `os/loops/README.md` (the nine-question contract)
- Create: `scripts/os/observe-crons.mjs`
- Create: `.github/workflows/os-observe-crons.yml` (daily)
- Create: six `os/loops/LOOP-*.md` stubs with `status: deferred` and a reason each

## Acceptance criteria

Every criterion is checkable. A criterion that cannot be checked is not a criterion.

- [ ] Both loop files answer **all nine** D5 interrogation questions; a loop that cannot **fails `Vitest`**
- [ ] Each names its DRI, its goal record (ISSUE-011), and its evaluation method
- [ ] **At least one completed live cycle** on LOOP-001, with an observed outcome and a filed adjustment — this is a D16 criterion and it is the point of the whole issue
- [ ] The cross-link is **demonstrated, not asserted**: an artifact id produced by LOOP-002 resolves inside a decision recorded by LOOP-001, and the validator fails if it does not
- [ ] Cron cadence drift is detected — the observer must catch that `cron-mlb-cycle` claims `*/5` but fires ~8-10×/day, and that **every under-run currently reports success**
- [ ] Six remaining function loops recorded `deferred` **with reasons** — not omitted
- [ ] The in-process-scheduler blind spot is written into `LOOP-002` as a known limitation

## Verification

Run these and paste the raw output. Per `OPERATING-RULES.md` Rule 6, a DONE claim without
this evidence is void.

```bash
npx vitest run scripts/os/artifacts.test.ts 2>&1 | tail -10

# The cron observer must find the real drift
node scripts/os/observe-crons.mjs --dry-run | tail -30
# expect: cron-mlb-cycle declared */5, observed ~8-10 runs/day

# Cross-link resolution
node scripts/os/loop-check.mjs --require-crosslink LOOP-001 LOOP-002; echo "EXIT=$?" 
```

## Depends on

ISSUE-006, ISSUE-007, ISSUE-009, ISSUE-010, ISSUE-011.

## If the ruling differs

If DR-005 is rejected for the **model release loop**: its apply step must be *built* before it can be
gated (ISSUE-012), CLV is NULL, no model versioning exists, and no provenance separation exists —
**no live cycle would complete inside this mission.** If rejected for the **Bet Grader wedge**: it is
not built at all (no ingest path, no bettor-side CLV formula, no `tracked_bet`→closing-line join, and
closing-line coverage is MLB-only).
