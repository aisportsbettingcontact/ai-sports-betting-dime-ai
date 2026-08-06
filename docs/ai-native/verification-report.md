# Verification report — AI-native execution program

Date: 2026-07-28 · Baseline: `ff1d72fd` (`feat/mlb-canonical-db`) · Claim labels per OPERATING-RULES.

## Final status

**PARTIAL** (program level) · diagnostic score **78/100**.
The vertical slice itself is **VERIFIED_COMPLETE in fixture scope**; program-level
VERIFIED_COMPLETE is blocked honestly by (a) no production wiring (owner-gated by deploy law),
(b) probabilistic rubric defined but not executed, (c) no elapsed business-outcome window,
(d) two OPEN incidents (41, 42 — both pre-existing local-environment conditions, not
regressions). No blocking-rule violations occurred: no unauthorized external action, no
data-integrity failure, no future-data leakage (leakage attempts were the *test subjects* and
were quarantined/rejected), no secret exposure, no fabricated claim.

## Commands executed and raw results (deterministic gates)

| Command | Result |
|---|---|
| `npx vitest run shared/loop server/loop` | 32/32 pass (first run 469 ms; post-fix re-run 358 ms) |
| `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit` | FAIL (3 defect classes) → fixed → **clean** |
| `npx vitest run client/src/pages/admin/DeviceActivityPanel.test.tsx` (before fix) | "No test files found, exiting with code 1" |
| same (after `client/src/**/*.test.tsx` glob) | 6/6 pass (270 ms) |
| `pnpm run test:gated:local` (run 1, 13:26) | vitest 2,393 pass / 2 env-bound excused; env-gate FAIL → **Incident 41** |
| `pnpm run test:gated:local` (run 2, 13:31, final) | vitest 2,398 pass (+6 reattached −1 race) / 3 fail: 2 env-bound excused + 1 race → **Incident 42**; env-gate FAIL (same stale-entry as 41) |
| `npx vitest run server/appUsers.register.test.ts` (isolation) | 8/8 pass — confirms Incident 42 race diagnosis |

## Adversarial matrix (each is a named executed test)

| Contract case | Test | Result |
|---|---|---|
| Complete valid input | "closes the full loop…" (WIN, CLV>0, lineage to ext roots, approval) | PASS |
| Missing data (identity) | "refuses to canonicalize… without gamePk" | PASS |
| Missing data (result) | "grades a FINAL with missing runs as UNGRADED" | PASS |
| Stale data | "flags stale odds on the display artifact" | PASS |
| Conflicting sources | "blocks grading while two live result observations disagree" | PASS |
| Delayed/corrected results | "regrades through a correction: supersedes…, refuses the stale result" | PASS |
| Rescheduled/cancelled | "voids postponed games" | PASS |
| Push handling | "pushes a whole-number total landing exactly on the line" | PASS |
| Future-data leakage (input side) | "rejects closing odds as a projection input" | PASS |
| Future-data leakage (timing side) | "quarantines post-first-pitch projections and blocks promotion (zero tolerance)" | PASS |
| Unsupported certainty | "rejects probabilities at or beyond certainty" (0, 1, 1.2, NaN) | PASS |
| Injection via retrieved content | "treats instruction-like provider content as inert data" | PASS |
| Certainty language from any origin | "refuses user-facing copy containing certainty language" | PASS |
| Unauthorized action | "rejects approvers without the owner role" + "rejects self-approval" | PASS |
| Duplicate/replayed action | "deduplicates a replayed grading action" | PASS |
| Version mismatch | "evaluating a version with no graded records fails instead of fabricating" | PASS |
| Interrupted run + state recovery | "recovers from an interrupted run via JSONL and finishes the loop" | PASS |
| Tamper/fabrication | ledger tests: HASH_MISMATCH, CONTENT_TAMPERED, CHAIN_MISMATCH, malformed JSONL | PASS |
| Cost budget visibility | economics test: not_measured → ok with usdPerVerifiedOutcome | PASS |
| Honest empty states | not_measured/incomplete/unknown query tests | PASS |
| Retry exhaustion / tool timeout | NOT covered by the fixture slice (no network tools in it); retry policy exercised at program level (WebFetch ×2 then approach change) | N/A — declared |

## What was NOT tested (explicit)

- Production runtime of anything ("code is intent, runtime is truth" — no prod access used).
- The probabilistic display-copy rubric (defined with calibration protocol; never executed).
- Playwright e2e (local-only in this repo; unrelated to the slice).
- DB cleanup completeness after the sanctioned local real-DB suites (Incident 42 disclosure).
- Read-boundary *enforcement* of envelope accessClass at consumer edges (recorded, not enforced).

## Score breakdown (diagnostic, not proof)

| Dimension | Score | Basis |
|---|---|---|
| Foundation | 18/20 | Envelope/ledger/identity/temporal contracts + tamper evidence + state files; −2: accessClass not consumer-enforced, spec timestamps gap only documented |
| Execution | 19/20 | Slice complete end-to-end; bounded retries honored; progress preserved across interruptions; −1: production wiring not started (gated) |
| Quality | 17/20 | 32 new + 6 reattached executed tests, tsc clean, defect taxonomy applied; −3: rubric unexecuted, 2 OPEN incidents |
| Scale | 16/20 | Factory reused (packet 002), queries + metrics dictionary + economics primitive; −4: no rendered dashboard, no production cost emitter, single loop on the spine |
| Results | 8/20 | Verified engineering outcomes only (coverage 0→100% of loop grading records version-attributed/leakage-checked/CLV-carrying in fixture; +38 executed tests; 2 latent defects fixed; 2 latent process defects incident-filed). No customer/business window has elapsed; per contract this caps Results regardless of implementation strength |

## Residual risks

| Risk | Severity | Evidence | Mitigation / next action |
|---|---|---|---|
| Drift recalibrator still self-promotes in production | HIGH | `mlbDriftDetector.ts` patches `MLBAIModel.py`; gap G2 | Migration step 2 (owner-gated) |
| Grading claims unattributable in production until wired | MEDIUM | G1/G3 columns NULL | Migration step 1 + `db-push.yml` |
| Local gate unreliable in credentialed shells | MEDIUM | Incidents 41, 42 | Owner decision on the two candidate fixes |
| AN↔gamePk crosswalk still fuzzy for closing lines | MEDIUM | G5; scoreGrader comment | Spec Phase 3 (`mlb_schedule_history.game_pk`) |
| Fixture-verified ≠ production-verified | STRUCTURAL | this report | Keep the label until prod evidence exists |
