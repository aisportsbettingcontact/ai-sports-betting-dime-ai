# ISSUE-011 — Create the goal record type and GR-0001

**Wave:** 3 — Ownership · **Effort:** S · **Status:** NOT STARTED · **DRI:** Prez
**Ruling dependency:** DR-014 Ruling 4 (HOLE A)
**Doctrine:** D12-L1 (goals + ownership, nine fields) · D5 (a goal with limits) · D16 criteria 2, 5, 9

---

## Scope

Doctrine L1 specifies `os/goals/GR-####-*.md` with **nine fields**. No record designed it; the
envelope's artifact kinds include no goal.

**Consequence:** D13's founder-loop flagship requirement — *"surfaces contradictions: a claimed
priority that engineering activity ignores"* — is **not computable anywhere in the design**. Neither
is D5's "goal, specific enough to evaluate, **with limits**," the component doctrine warns about most
explicitly. **Criteria 2, 5 and 9 all fail on this one missing type.**

Write the type, then write `GR-0001` for this mission's own outcome as the worked example.

## Files

- Create: `os/goals/GR-0001-ai-native-certification.md`
- Create: `os/goals/README.md` (the nine-field contract)
- Modify: `shared/os/frontmatter.ts` — add the `goal` kind
- Modify: `scripts/os/artifacts.test.ts` — enforce all nine fields

## Acceptance criteria

Every criterion is checkable. A criterion that cannot be checked is not a criterion.

- [ ] All nine L1 fields required and enforced: desired outcome · the customer or company need behind it · the evidence that justified pursuing it · acceptance criteria · constraints · time horizon · responsible individual · current status · evaluation measures
- [ ] A goal record missing any field **fails `Vitest`**
- [ ] `GR-0001` states the mission outcome **with its limits** — a goal without limits is unevaluable (D5)
- [ ] `GR-0001` carries a target metric bound to a threshold, not a prose aspiration
- [ ] Loop files and issues can reference a goal id, and the reference **resolves** (validator-checked)
- [ ] The contradiction check becomes computable: goal priority vs. where engineering activity actually went, derived from ISSUE-009's merge artifacts

## Verification

Run these and paste the raw output. Per `OPERATING-RULES.md` Rule 6, a DONE claim without
this evidence is void.

```bash
npx vitest run scripts/os/artifacts.test.ts 2>&1 | tail -10

# Remove a field on purpose — the gate must fail
# then restore and confirm green

# The contradiction query must return something real, not not_measured
node scripts/os/query.mjs --goal GR-0001 --show activity | tail -20
```

## Depends on

ISSUE-006, ISSUE-009 (activity data for the contradiction check).

## If the ruling differs

No record claimed this. If Prez wants goals to live in GitHub Issues instead, note that **zero
issues have ever been opened in 366 PRs** — that channel has no precedent at this company.
