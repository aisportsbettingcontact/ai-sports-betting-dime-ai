# ISSUE-012 — Prove whether the self-patcher fires, then gate it

**Wave:** 3 — Ownership · **Effort:** M · **Status:** IN PROGRESS · **DRI:** Prez
**Ruling dependency:** DR-014 Ruling 4 (HOLE B)
**Doctrine:** D5 (agent authority matches demonstrated reliability) · D15 #2 (open-loop automation) · D16 criterion 3

---

## Scope

`server/mlbDriftDetector.ts:814` executes `fs.writeFileSync(MODEL_PY, src)` on `main` **today** —
it rewrites `MLBAIModel.py` model constants in place, automatically, with **no proposal record, no
approval, and no version stamp.** It is the audit's named D15 #2 exemplar (gap F4.1, HIGH).

Across all ten decision records, DR-009 *forbids a new seat* from doing this and everyone else defers
the model loop. **Forbidding a new seat from doing what shipped code already does is not a control.
Criterion 3 cannot pass while it stands.**

Aggravated by P2 [**THIS PARAGRAPH IS SUPERSEDED — see "RE-SCOPED" below**]: both Railway services
were believed to build with **RAILPACK**, not the Dockerfile. Under Railpack
the write may silently no-op or write to a filesystem wiped every deploy. **An automation whose
effect status is unknown is worse than one known to fire.**

**Step 1 is therefore not a fix — it is a measurement.**

### RE-SCOPED 2026-08-05 — the effect status is now known, and it is a third case

The RAILPACK premise above is **REFUTED** (`os/audits/2026-08-05-builder-resolution.md`). The
Dockerfile is the builder, `/app/dist/MLBAIModel.py` **is** in the image, and the Dockerfile
declares **no `USER`** — so the process runs as root and that path **is writable**.

**So the self-patch fires, succeeds, and takes effect live and ungated.** But the container
filesystem is ephemeral and this repo deploys ~13×/day, so **every recalibration is silently
discarded at the next deploy**, reverting to the git-baked constants.

That is sharper than either "it works" or "it's broken":
1. The ungated self-promotion risk is **real** — a bad recalibration serves customers until the
   next merge.
2. Every adjustment is **erased within hours**, so the model oscillates on a cadence set by
   unrelated merges.
3. `mlb_model_learning_log` records that the recalibration **happened**. The artifact says the
   model learned; the runtime reverted. **Record and reality disagree, and nothing reconciles
   them** — D15 #9 inside the loop D16 criterion 3 depends on.

**Phase 1 is no longer "does it fire".** It is: *how many adjustments have been silently discarded,
and does `mlb_model_learning_log` overstate what actually persisted?*

## Files

- Investigate: `server/mlbDriftDetector.ts` (the `migrateCalibrationConstants()` path, `:814`)
- Adopt: `server/mlbRecalibrationGate.ts` + its 11 tests (from ISSUE-001's archive branch)
- Create: the `mlbSchedule.listRecalibrationProposals` / `decideRecalibration` tRPC procedures — **these were claimed as implemented and were never written**
- Create: `server/driftDetectorGate.test.ts`

## Acceptance criteria

Every criterion is checkable. A criterion that cannot be checked is not a criterion.

**Phase 1 — measurement (no code change):**
- [x] ~~Determine whether `MLBAIModel.py` is writable at runtime~~ **ANSWERED 2026-08-05: yes.** It is in the image (`Dockerfile:130` copies `dist/`), the Dockerfile declares no `USER`, so the process runs as root and `/app/dist` is writable. **The self-patch fires and succeeds.**
- [x] Determine **how many** adjustments have been silently discarded — **ANSWERED 2026-08-06: zero were ever applied.** The patcher's regex needs single-quoted keys; the model file has been double-quoted since 2026-05-09 (commit `4c27b4f5f`), so it has matched **0 of 9 constants for 89 days**. The premise that it "fires, succeeds, and takes effect" is REFUTED. `mlb_model_learning_log` records `constantsPatched: 0` honestly, but its `accuracyAfter` reads as though the model adopted the new value — it did not. See Incident 63.
- [x] File the finding as a numbered `INCIDENTS.md` entry — **Incident 63**, number verified against the file tail immediately before writing — re-reading the tail of the file immediately before writing, to avoid the number collision documented in `os/memory/lessons/incident-numbers-collide.md`

**Phase 2 — gate (only after Phase 1):**
- [x] Drift detection writes a **PROPOSED** record; it never patches the engine directly
- [x] Promotion requires an approval artifact from a **distinct** approver; self-approval throws (test-covered) — `validateApproval`, 11 tests. **Not yet reachable: the tRPC procedures are still unwritten, so no one can act on a proposal.**
- [x] `MLB_RECAL_MODE=autopatch` remains as a CRITICAL-logged emergency override
- [ ] **STILL OPEN** — Every projection carries `modelVersion` + `paramsHash`, so *"did the last recalibration help?"* becomes answerable
- [x] The gate is covered by a test that fails if the propose-first default is removed — behavioural, with an injectable patcher; 4 mutations verified to fail

## Verification

Run these and paste the raw output. Per `OPERATING-RULES.md` Rule 6, a DONE claim without
this evidence is void.

```bash
# Phase 1 — measure first. Does the write actually happen?
# Railway build log for the current deployment (read-only)
# then:
git log -1 --format=%H -- server/mlbDriftDetector.ts   # unchanged since 2026-07-23?
git grep -n "writeFileSync" server/mlbDriftDetector.ts

# Phase 2
npx vitest run server/mlbRecalibrationGate.test.ts server/driftDetectorGate.test.ts 2>&1 | tail -10
NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit; echo "EXIT=$?" 
```

## Depends on

ISSUE-001 (the gate module is untracked). ~~ISSUE-017~~ — **closed 2026-08-05**; the builder question is resolved and no longer blocks this issue.

## If the ruling differs

No record owned this, so there is no competing recommendation. If Prez rules the self-patcher may
continue ungated, **D16 criterion 3 cannot pass** and the certification must say so.

## Notes

This issue is why criterion 3 is currently unpassable. It does **not** wait for the model loop — the
automation is live now.
