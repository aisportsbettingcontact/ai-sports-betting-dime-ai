# ISSUE-002 — Repair the aiCostMeter phantom import

**Wave:** 0 — Unblock · **Effort:** XS · **Status:** NOT STARTED · **DRI:** Prez
**Ruling dependency:** DR-003
**Doctrine:** D15 #8 (weak tests) · blocks every subsequent issue

---

## Scope

`server/_core/aiCostMeter.ts:20` imports `aiWorkflowCosts` from `drizzle/dime.schema`, which has no
such export. This is collateral damage from the Incident-43 column revert: the schema addition was
reverted, the import was not.

**Consequence: `tsc --noEmit` exits 1, so the working tree cannot be committed at all.** Every other
issue is blocked behind this one line.

Per DR-012 the fix is **deletion, not repair** — cost becomes a git-native artifact, so the DB table
the import reaches for is formally deferred behind a written activation trigger.

## Files

- Modify: `server/_core/aiCostMeter.ts` (remove the phantom import and the code path that needs it)

## Acceptance criteria

Every criterion is checkable. A criterion that cannot be checked is not a criterion.

- [ ] `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit` exits **0**
- [ ] `git grep -n aiWorkflowCosts -- server/ drizzle/ shared/` returns **zero** hits outside comments
- [ ] No new table is added to `drizzle/dime.schema.ts` — the deferral is intentional and written down
- [ ] `npx vitest run server/_core` passes

## Verification

Run these and paste the raw output. Per `OPERATING-RULES.md` Rule 6, a DONE claim without
this evidence is void.

```bash
NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit; echo "EXIT=$?"   # expect EXIT=0
git grep -n aiWorkflowCosts -- server/ drizzle/ shared/                    # expect: no code hits
npx vitest run server/_core 2>&1 | tail -5
```

## Depends on

ISSUE-001 (the file is untracked until the AI-native tree is preserved).

## If the ruling differs

If DR-012 is rejected in favour of the DB table, this becomes *repair* instead of *deletion*: add
`ai_workflow_costs` to the schema and run `db-push.yml` **before** any code deploy (new table, so a
probe-guarded writer is also acceptable).
