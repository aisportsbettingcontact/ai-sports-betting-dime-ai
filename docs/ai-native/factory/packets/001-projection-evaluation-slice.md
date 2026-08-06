# Packet 001 — Projection-evaluation vertical slice

## Evidence (why this, now)
- `docs/ai-native/current-state-audit.md` gaps G1–G6: unversioned self-promoting model loop,
  CLV/leakage/publication tooling unwired (`server/mlbBacktestAuditCore.ts` et al. test-only).
- `mlb_game_backtest.clv/closingOdds/leakageSafe/auditVersion` permanently NULL in production
  (grep of `server/mlbMultiMarketBacktest.ts` insert, 18 columns).

## Specification (narrow, with exclusions)
- In scope: pure-module closed loop (envelope, ledger, queries, slice engine) exercised on
  synthetic fixtures; reuse of `gradeMarket`/`calcCLV`/leakage preflight; independent approval gate;
  cost attribution primitive.
- Explicitly out of scope: drizzle schema changes, scheduler/route wiring, production data,
  `MLBAIModel.py` changes, UI. (Queued as owner-gated migration steps in target-architecture.md.)

## Executable acceptance criteria
- [x] `npx vitest run shared/loop server/loop` — 32/32 green (2 files)
- [x] `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit` — clean
- [x] Adversarial matrix covered: leakage ×2, certainty, injection, conflict, correction,
      replay, void/push/ungraded, self-approval, unauthorized approver, entity mismatch,
      JSONL recovery, tamper evidence (named tests in `server/loop/projectionLoop.test.ts`,
      `shared/loop/ledger.test.ts`)

## DRI and boundaries
- DRI: builder-operator (this session). Approver for any production wiring: owner.
- Implementation authority: new files under `shared/loop/`, `server/loop/`, `docs/ai-native/`.

## Deterministic gates — results
1. Loop suites: PASS (32/32, first run 469 ms; re-run after fixes 358 ms).
2. Typecheck: FAIL → 3 defects → PASS after smallest corrections (see below).
3. Full gated suite: vitest 2,393 passed / 2 env-bound excused; env-gate FAIL on a
   pre-existing environmental stale-entry condition — Incident 41 (OPEN, not a regression).

## Probabilistic rubric
- N/A for the slice invariants (all deterministic). Display-copy tone/quality is the one
  judgment dimension — rubric defined in `docs/ai-native/factory/display-copy-rubric.md`,
  NOT executed this session (no grader run; deterministic certainty/RG checks cover the
  blocking requirements).

## Defects found (classify each)
| # | Symptom | Class | Smallest correction | Regression rerun |
|---|---|---|---|---|
| 1 | `tsc`: literal `schemaVersion` widened to `string` in `makeArtifact` | code | annotate `base: Omit<LoopArtifact,"contentHash">` | tsc + 32/32 green |
| 2 | `tsc` TS2802: Map/Set iteration under ES5 default target (ledger, queries ×3) | code | index loop / `Array.from(...entries())` | tsc + 32/32 green |
| 3 | env-gate stale-entry FAIL in credentialed shell | runtime/environment | none applied — allowlist not edited to sidestep a gate; Incident 41 filed with candidate OR-semantics fix | n/a (OPEN) |

## Outcome
- Result metric: grading-integrity coverage for the fixture loop — 100% of graded records carry
  modelVersion+paramsHash, leakage verdict, and CLV-or-reason (was: 0% of these fields populated
  anywhere in production). Verified by executed tests, not code presence.
- Status: VERIFIED_COMPLETE (fixture scope); production wiring NOT_STARTED (owner-gated).
