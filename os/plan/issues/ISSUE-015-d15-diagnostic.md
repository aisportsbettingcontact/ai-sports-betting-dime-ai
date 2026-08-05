# ISSUE-015 — Run the D15 diagnostic end to end and schedule its recurrence

**Wave:** 4 — Certification · **Effort:** M · **Status:** NOT STARTED · **DRI:** Prez
**Ruling dependency:** DR-014 Ruling 4 (HOLE D)
**Doctrine:** D15 (all 17 failure modes) · D16 criterion 11

---

## Scope

D16 criterion 11 requires the D15 diagnostic protocol to have **run once end to end with zero
unresolved critical findings**, and its recurrence scheduled. **Nothing in the decision set owns
this.**

Run all seventeen failure modes against the built system, not against intentions. Every finding
carries evidence and either a resolution or an explicit acceptance with a reason.

## Files

- Create: `os/audits/2026-XX-d15-diagnostic.md`
- Modify: `os/DOCTRINE.md` §17 — confirm the monthly cadence and its triggers are accurate

## Acceptance criteria

Every criterion is checkable. A criterion that cannot be checked is not a criterion.

- [ ] All **17** failure modes assessed with evidence — not 16, and none marked N/A without a reason
- [ ] Every finding is resolved, or accepted with a written rationale and an `observe_by`
- [ ] **Zero unresolved critical findings**, or criterion 11 fails and says so
- [ ] The diagnostic reduces each finding to the doctrine question: *which part of the closed, queryable, human-owned system is missing?*
- [ ] Recurrence is scheduled monthly plus the four stated triggers, and the schedule is in a place that will actually fire
- [ ] The diagnostic is applied to **this mission's own output** — the audit already reproduced two of its own failure modes (a wrong commit count; a format contract with no verification step)

## Verification

Run these and paste the raw output. Per `OPERATING-RULES.md` Rule 6, a DONE claim without
this evidence is void.

```bash
# The diagnostic is a written audit, verified by its evidence citations resolving
node scripts/os/query.mjs --kind audit --latest d15 | tail -30
npx vitest run scripts/os/artifacts.test.ts 2>&1 | tail -5
```

## Depends on

Waves 0-3 (the diagnostic assesses what was built).

## If the ruling differs

No record claimed this.
