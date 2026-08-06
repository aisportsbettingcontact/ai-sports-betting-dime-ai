# Operating brief — Dime AI, 2026-07-28 (updated after queue round 1, 2026-07-29)

## Queue round 1 — what changed since the morning brief (VERIFIED)
- The local test gate is now trustworthy: `test:gated:local` passes end-to-end in a credentialed
  shell (2,497 tests; Incidents 41/42 RESOLVED — envMode:any semantics + split-phase DB-serialized
  runner). One new incident (43, self-caused schema-first regression) was caught by the gate,
  fixed, and codified the rule: new columns go db-push-FIRST, new tables may be probe-guarded.
- On your next deploy, three production behaviors change: (1) every graded row gets leakage
  verdict + CLV vs DK closing (via the PR #223 gamePk crosswalk) + model attribution in
  `auditVersion`; (2) drift recalibration STOPS self-patching MLBAIModel.py — it writes PROPOSED
  rows you decide via `mlbSchedule.decideRecalibration` (env `MLB_RECAL_MODE=autopatch` is the
  emergency override); (3) wc2026 answers log USD per call (chat too, once unfrozen);
  `ai_workflow_costs` persistence activates after db-push.
- Your decision queue is in `execution-state.json` → `next_action_queue` (db-push+deploy first;
  then the first proposal review; rubric calibration needs 25 ratings from you + one reviewer).

---

# Original brief — 2026-07-28 (morning program)

Audience: owner (founder-led AI execution — this artifact is the recurring decision surface).
Everything below is grounded in canonical artifacts; each claim cites its evidence. Claim
labels per OPERATING-RULES. Regenerable from: current-state-audit.md, loop-registry.yaml,
factory packets, INCIDENTS.md, and the loop ledger test evidence.

## The one compounding objective
Make the model learning loop trustworthy end to end (versioned → leakage-safe → CLV-graded →
independently gated). Everything else — public track record, chat evidence, canonical-DB
grading — compounds on it. (Basis: current-state-audit.md §3, active constraint.)

## What changed this session (VERIFIED)
- Closed-loop slice implemented and exercised on fixtures: `shared/loop/` +
  `server/loop/` — 32/32 tests, repo typecheck clean. It wires the previously dead
  evaluation suite (`mlbBacktestAuditCore`) into an end-to-end path for the first time.
- Factory established and exercised twice (packets 001, 002); packet 002 re-attached 6
  silently-orphaned assertions to CI.
- Queryable surfaces: decision-time view, grading-by-model-version, lineage, pending
  approvals, conflicts, cost-per-verified-outcome — all with honest empty/thin states.

## Decisions waiting on you (pending approvals queue)
1. **Production wiring of the slice** (schema columns `model_version`/`params_hash` on
   `mlb_game_backtest`, grader emits closing odds + CLV + leakage verdict). Needs
   `db-push.yml` before code deploy. Risk: low (additive columns); value: makes every future
   W/L claim attributable. — target-architecture.md migration step 1.
2. **Gate the drift recalibrator.** Today `mlbDriftDetector.ts` patches `MLBAIModel.py` in
   place with no approval (violates the independent-gate principle). Route through
   improvement-proposal → your approval. — migration step 2.
3. **Incident 41** (OPEN): env-gate stale-entry semantics for multi-var requiredEnv entries;
   candidate OR-semantics fix proposed in the incident. Until decided, `test:gated:local`
   fails in any shell with ANTHROPIC_API_KEY exported (CI unaffected).
4. **Canonical MLB DB** (approved spec, zero code): note the spec's Phase-6 invariant is
   already stale (49,403 vs corpus 49,414) — fix the count to be manifest-derived before ETL
   is built. — audit G10.

## Human-routing eliminated (intelligence-layer effect)
- "Did the last recalibration help?" — previously unanswerable (no versioning); now a query
  (`gradingByModelVersion`) once wired. "What did the user see at decision time?" — was a
  manual DB archaeology exercise; now `decisionTimeView` with lineage to provider roots.
- This brief itself replaces a status roll-up: it is derived from ledger/registry artifacts,
  not from anyone's memory.

## Risks (top 3, with severity)
- HIGH: self-promoting recalibration remains live in production until decision 2 ships.
- MEDIUM: model performance claims (accuracy/ROI surfaces at /admin) remain unattributable to
  parameter sets until decision 1 ships.
- MEDIUM: AI spend is unmeasured (ai-economics.md); the loop primitive exists but no
  production emitter does.

## Uncertainty
Fixture-verified ≠ production-verified ("code is intent, runtime is truth"). No business
outcome window has elapsed for any of this session's changes; no customer-facing behavior
changed. All production-impact claims above are therefore projections, labeled as such.
