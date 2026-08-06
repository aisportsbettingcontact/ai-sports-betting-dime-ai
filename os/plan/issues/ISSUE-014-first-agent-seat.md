# ISSUE-014 — Charter SEAT-001 and gate charters on TypeScript Check

**Wave:** 3 — Ownership · **Effort:** M · **Status:** NOT STARTED · **DRI:** Prez
**Ruling dependency:** DR-009 + DR-014 Ruling 2
**Doctrine:** D12-L4 (specialized agents) · D15 #16 · D16 criterion 7

---

## Scope

**Zero charters exist** — "charter" has zero occurrences repo-wide. The brief's 32-seat "Dime Mint"
roster has **no design document on any branch, ever**.

Doctrine L4 is explicit: **seats without a loop to serve are deferred, not activated.** DR-009's own
gate would have rejected all three of its proposed seats on day one, because each serves a loop
DR-005 defers.

So: **one active seat.** `SEAT-001` (run-recorder) bound to `LOOP-002`. That is an honest Level-2→3
step, not a roster.

DR-009's correct ruling stands and should be recorded prominently: **the ~200 vendored skills and 61
plugins are tools, never seats.** That kills the 32-seat fiction structurally rather than
rhetorically.

## Files

- Create: `os/agents/charters/SEAT-001-run-recorder.md`
- Create: `os/agents/charters/README.md` (the six-field contract + the tools-are-not-seats ruling)
- Create: `os/agents/charters/DEFERRED.md` (every deferred seat with its blocking reason)
- Create: `scripts/os/check-charters.mjs` + `scripts/os/check-charters.test.ts`
- Modify: `.github/workflows/ci.yml` — add the checker as a step **inside the already-required `TypeScript Check` job**

## Acceptance criteria

Every criterion is checkable. A criterion that cannot be checked is not a criterion.

- [ ] `SEAT-001` carries all **six** L4 fields: scope · permitted actions · required inputs · expected outputs · evaluation method · escalation path
- [ ] `status: ACTIVE` requires a **resolvable** `os/loops/LOOP-*.md`; the gate rejects an active seat with no loop
- [ ] Every deferred seat is recorded with a machine-readable `blocked_on`
- [ ] The charter's `authority_rung` validates against `os/agents/AUTHORITY.md` (ISSUE-010)
- [ ] The checker runs **inside `TypeScript Check`** — no new required status check
- [ ] The gate **fails** when a charter loses a required field — red-green verified
- [ ] `README.md` records: vendored skills and plugins are tools, not seats
- [ ] **Stated honestly:** this gate checks charter *shape*, not whether the seat ever produced its obliged artifact. Closing that is a follow-up, and pretending otherwise would be the `operating-brief.md` failure in YAML

## Verification

Run these and paste the raw output. Per `OPERATING-RULES.md` Rule 6, a DONE claim without
this evidence is void.

```bash
node scripts/os/check-charters.mjs; echo "EXIT=$?"
npx vitest run scripts/os/check-charters.test.ts 2>&1 | tail -10

# Red: mark a seat ACTIVE with no loop; the gate must reject it
# Confirm it rides the already-required job
grep -n "check-charters" .github/workflows/ci.yml
```

## Depends on

ISSUE-010 (**blocks absolutely** — the ladder must exist first), ISSUE-013 (SEAT-001 needs LOOP-002).

## If the ruling differs

DR-009 proposes **three** active seats. DR-014 cuts to one because the other two serve deferred loops
and its own gate would reject them. If Prez wants all three, LOOP-002 must expand or the gate must be
weakened — and weakening it reintroduces exactly the inversion DR-009 wrote the gate to prevent.
