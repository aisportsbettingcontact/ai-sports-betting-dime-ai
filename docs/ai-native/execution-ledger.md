# AI-native execution ledger

Chronological record of material observations, decisions, changes, validations, failures. Claim labels per OPERATING-RULES.md: VERIFIED / INFERRED / UNKNOWN.

## 2026-07-28 — Gate 0: source and environment freeze

- VERIFIED: repo HEAD `ff1d72fd` on `feat/mlb-canonical-db`, node v22.22.0 (`git rev-parse HEAD`, `node --version` output logged in session).
- VERIFIED: sole external source fetched. First WebFetch returned only the page title (client-rendered). Retry via `curl` + extraction of the Inertia `data-page` JSON yielded the full article description + episode transcript (Diana Hu, YC Startup School, "The Playbook For Building An AI Native Company"). sha256 of extracted transcript: `78fab51d…591143`. Transcript retained in session scratchpad only — third-party copyrighted content is not committed; the concept register carries short verbatim key phrases.
- VERIFIED: OPERATING-RULES.md read in full — claim-labeling, incident, and verification rules adopted for this program (they outrank this contract).
- VERIFIED: pre-existing untracked work present (`docs/audits/*nfl*`, `scripts/data/nfl-*`, modified `.gitignore`) — preserved untouched.
- DECISION D-001/D-002: state lives in `docs/ai-native/`; OPERATING-RULES claim labels used throughout.
- ACTION: dispatched 3 read-only Explore agents (projections pipeline; canonical data layer + MLB DB spec; AI usage/eval/ops artifacts) for the Gate 1 audit.

## 2026-07-28 — Gate 1: data-layer audit report (Explore agent, verified paths)

- VERIFIED: canonical MLB DB spec at `docs/superpowers/specs/2026-07-27-mlb-canonical-database-design.md` (approved by owner) is **spec-only** — `drizzle/mlb.schema.ts` and `scripts/mlb-etl/` do not exist; grep for `mlb_pitches|mlb_franchises|mlb_people` hits only the spec.
- VERIFIED: corpus drift — spec's CI invariant says 49,403 games; the 21 `verify-report.json` files now sum to **49,414** (2026 refresh landed after the spec). Spec invariant is stale.
- VERIFIED: existing canonical-identity primitives: `server/mlbEventIdentity.ts` (pure, gamePk-first identity contract, doubleheader classification), `shared/mlbTeams.ts` (7-way crosswalk), `games_mlb_gamepk_unique`, and WC2026's `wc2026_provider_match_map` (confidence-scored provider↔canonical mapping as rows) + `wc2026_data_lineage` (provenance as rows) — the repo's most mature provenance precedent, not yet adopted for MLB.
- VERIFIED: documented crosswalk gap — `server/scoreGrader.ts:704-712`: AN game IDs vs MLB gamePk are different number spaces; AN-path MLB bets always miss the id join and fall back to fuzzy team-name matching.
- VERIFIED: spec omits per-row observation/ingestion timestamps on canonical tables (provenance is out-of-band manifests) — a gap vs the loop architecture's temporal requirements.
- VERIFIED: test posture — vitest needs no DATABASE_URL (`server/db.ts` lazy-gates the pool); dominant pattern is pure fixture modules (e.g. `mlbEventIdentity.test.ts`); real-DB suites run in an isolated `db-tests` CI job (local mysql:8, `drizzle-kit push --force`). `shared/**/*.test.ts` is in the vitest include set → new loop primitives under `shared/loop/` will run everywhere.
- VERIFIED: existing learning-loop fragments in schema: `mlb_game_backtest`, `mlb_model_learning_log`, `mlb_drift_state`, `mlb_calibration_constants`, `odds_history.scrapedAt` (observation time), `mlb_schedule_history` closing-line block (`closingLineLockedAt`).

## 2026-07-28 — Gate 1: AI/eval/ops audit report (Explore agent, verified paths)

- VERIFIED: Dime Chat provider hard-frozen (`server/_core/dimeChatModel.ts:44`, `DIME_CHAT_LLM_PROVIDER = "frozen"`); route short-circuits before any Anthropic call; 57/57 Dime governance unit tests pass with zero credentials (agent executed `npx vitest run` on those suites).
- VERIFIED: deterministic evidence layer already exists at answer level — `server/_core/dimeVerdict.ts`: zod verdict schema with `source_ids`, `odds_observed_at`, `projection_observed_at`, `model_version`, `data_quality` (incl. stale/missing/conflict), 15-min odds / 24-h projection freshness gates, deterministic edge recalculation with 0.002 tolerance, whole-answer withholding on validation failure. GAP: `source_ids` are model-asserted, never cross-checked against the injected context rows.
- VERIFIED: honest-metric vocabulary exists — `server/analytics/metricDefinitions.ts`: `MetricState = ok|not_measured|incomplete|stale|unknown`, `{state,value,reason}` points, "never render a fabricated zero" (owner directive 2026-07-23).
- VERIFIED: AI cost measurement absent — no USD computation/persistence anywhere; only `dime_request_audit`/`dime_response_audit` on the WC2026 route persist tokens/credits; chat path logs usage to console only; `references/ai-gateway-setup.md` cited at `dime-chat.route.ts:9` does not exist.
- VERIFIED: independent-promotion governance already codified for the in-house model — `ml/dime-1.0/docs/RELEASE_GATES.md` (zero-tolerance gates incl. 0 future-data violations, promotion sequence with isolated evaluator, publication transaction gate). Never exercised on a real candidate (only 2026-07-25 rehearsal, release_gate_pass=false).
- VERIFIED: operating discipline artifacts — OPERATING-RULES.md claim labels, INCIDENTS.md 40 numbered incidents (none OPEN), docs/remediation claim-ledger precedent, machine-enforced env-failure allowlist (`vitest.environment-failure-allowlist.json` + `scripts/check-environment-failures.mjs`).
- VERIFIED: no Playwright in CI (e2e local-only); `client/src/pages/admin/DeviceActivityPanel.test.tsx` is orphaned from the vitest include globs (never runs).

## 2026-07-28 — Gates 2–5: design, implementation, factory, queryability

- DECISION: active constraint = untrustworthy learning loop (unversioned, self-promoting, no CLV/leakage integrity); vertical slice selected accordingly (current-state-audit.md §3–4).
- ACTION (Gate 2): wrote target-architecture.md (10 deterministic invariants, authority boundaries, 3-step owner-gated migration sequence) + loop-registry.yaml (8 loops with DRI/approval/escalation).
- ACTION (Gate 3): implemented `shared/loop/envelope.ts` (zod envelope, semantic content hash), `shared/loop/ledger.ts` (append-only, tamper-evident chain, JSONL recovery), `shared/loop/queries.ts` (honest-state queries), `server/loop/projectionLoop.ts` (10-stage slice engine reusing `mlbBacktestAuditCore.gradeMarket`/`calcCLV` and the gamePk identity contract).
- VERIFIED (Gate 3): `npx vitest run shared/loop server/loop` → 32/32 pass. `tsc --noEmit` → 3 defects found (literal widening; ES5 Map/Set iteration ×4) → smallest corrections → clean; suites re-run green (raw outputs in session log; summarized in verification-report.md).
- FAILURE + INCIDENT: full `pnpm run test:gated:local` → vitest 2,393 passed / 2 env-bound excused, but env-gate FAIL on stale allowlist entry for `server/claude.test.ts` in a shell with ambient `ANTHROPIC_API_KEY`. Filed **Incident 41** (OPEN); allowlist deliberately not edited (OPERATING-RULES §9).
- ACTION (Gate 4): factory established (`docs/ai-native/factory/`: template, defect taxonomy in packets, display-copy rubric defined-not-executed). Packet 001 = the slice (VERIFIED_COMPLETE, fixture scope). Packet 002 = re-attached orphaned `DeviceActivityPanel.test.tsx` via `client/src/**/*.test.tsx` glob; verified 6/6 pass (was: "No test files found").
- ACTION (Gate 5): metrics-dictionary.md (4 performance layers kept distinct), ai-economics.md (cost primitive + honest UNKNOWNs), operating-brief.md (owner decision queue with citations).

## 2026-07-28 — Gate 6: adversarial validation and close-out

- VERIFIED: adversarial matrix executed inside the 32 tests — leakage (2 forms: closing-odds-as-input rejected at construction; post-first-pitch quarantined + promotion blocked), unsupported certainty (4 values), injection-as-data + certainty-language refusal, conflicting results block grading, correction supersession without double-count, idempotent replay, void/push/ungraded, self-approval + unauthorized approver rejected, entity mismatch, JSONL interrupted-run recovery, hash-chain tamper detection, version-mismatch honest failure.
- ACTION: concept register reconciled — 8 VERIFIED_COMPLETE (3 scope-qualified), 11 PARTIAL, 0 BLOCKED/NOT_STARTED. Source verification: VERIFIED.
- Final full gated suite re-run results recorded in verification-report.md.
- OBSERVATION (13:33): untracked `scripts/mlb-etl/` (transform.py + test_transform.py + executed `__pycache__`) appeared at 13:31–13:33 — created by a concurrent actor, NOT by this program (this session made no writes there; its explorers are read-only). The audit's "canonical-DB spec has zero code" claim was VERIFIED as of ~13:05 and is superseded by this concurrent work. Left untouched.

## 2026-07-28 (evening) — Queue execution round (owner-authorized: "execute the next action queue")

- VERIFIED: re-baseline before building — branch advanced from `ff1d72fd` to `fcb85ddd`; owner merged PR #223 (canonical MLB DB, 10 tables, `scripts/mlb-etl/`, `mlb_schedule_history.gamePk` crosswalk merge, "independent final production audit — 100% VERIFIED"). Q4 data side already done by the owner; grader consumption still open (grep: no clv/leakage in `mlbMultiMarketBacktest`). Owner has live uncommitted client work (BetTracker/Trends/GameCard) — not touched. All docs/ai-native artifacts and Incidents 41/42 survived intact.
- ACTION: executed queue items Q3(41+42), Q1+Q4, Q2, Q5, Q6 as factory packets 003–008 (see `factory/packets/003-queue-execution-round.md` for the full per-packet record: evidence, changes, defects, gates).
- VERIFIED (per-suite): env-gate 15/15 · gated-runner 5/5 · integrity+resolver 24/24 · recal gate 11/11 · cost meter 8/8 · rubric harness 6/6; mid-round `tsc --noEmit` clean; rubric sample set deterministic (identical sha over 3 runs).
- DEFECT (packet 005): `MLB_BY_ABBREV` is a Map — index access returned undefined → 3 test failures → `.get()` fix → 24/24. Class: code.
- DECISION D-005: recalibration gate defaults to propose-mode from next deploy (production behavior change authorized by the queue directive); `MLB_RECAL_MODE=autopatch` retained as a CRITICAL-logged emergency override.
- DECISION D-006: new columns (`games`/`mlb_game_backtest` modelVersion+modelParamsHash, `ai_workflow_costs`) are deploy-gated via `schemaCapabilities` probes — code is safe to deploy before `db-push.yml`, attribution/persistence activate after it.
- FAILURE + DIAGNOSIS + FIX (Incident 43): first full gated run FAILED — 9 `mlbDoubleheader.db.test.ts` inserts errored because the new `games` attribution columns existed in drizzle schema but not the live DB (drizzle emits every schema column name in INSERTs; VERIFIED from the failing query text). Columns reverted same session; attribution moved into `auditVersion` (`integrity-v1|<version>|params:<hash>`). 2 `perf/harness.smoke` failures were 30s browser-launch timeouts under tsc CPU contention — 6/6 in isolation.
- VERIFIED (final): `tsc --noEmit` exit 0 · touched suites 67/67 · `mlbDoubleheader.db.test.ts` 9/9 · **full `pnpm run test:gated:local` → `[env-gate] PASS`, exit 0** (2,497 passed, 2 env-bound excused; split-phase runner live: non-DB parallel 85.4s + DB serialized 71.3s, zero races, zero stale entries in a credentialed shell). First fully green local gate on record; Incidents 41, 42, 43 all RESOLVED with evidence in INCIDENTS.md.
