# Packets 003–008 — Next-action-queue execution round (2026-07-28, evening session)

Composite record: six bounded packets executed through the factory in one authorized round
("execute the next action queue"). Each follows the template; deterministic gates listed per
packet; the full-suite regression gate is shared (results in the final verification section).

Context shift discovered at re-baseline: the owner concurrently merged PR #223 (canonical MLB DB:
`drizzle/mlb.schema.ts` 10 tables, `scripts/mlb-etl/`, `mlb_schedule_history.gamePk` crosswalk
merge, production-audited). Queue item Q4's *data* side was therefore already done; its
*consumption* side (grading reads closing lines) remained open and is what packet 005 built.
The owner also has uncommitted client work in flight (BetTracker/Trends/GameCard) — untouched.

## Packet 003 — Incident 41: env-gate `envMode: "any"`

- Evidence: Incident 41 (stale-entry FAIL in any shell with `ANTHROPIC_API_KEY` exported).
- Change: `scripts/check-environment-failures.mjs` gains per-entry `envMode: "all"|"any"`
  semantics applied symmetrically to stale-entry and real-failure checks; AND entries keep exact
  prior behavior. Allowlist: claude.test entry annotated `envMode: "any"` (3-line diff).
- Gates: `scripts/check-environment-failures.test.ts` 15/15 (4 new envMode cases: satisfied-pass
  not stale, all-absent-pass stale, one-present-fail real, all-absent-fail env-bound).
- DRI: builder-operator; the gate is *stricter*, not looser — no OPERATING-RULES §9 conflict
  (this is the candidate fix filed in the incident, now owner-authorized via the queue directive).
- Status: VERIFIED_COMPLETE (final full-suite run must exit 0 — see verification).

## Packet 004 — Incident 42: split-phase gated-local runner

- Evidence: Incident 42 (tokenVersion cross-file race; CI serializes DB suites, local didn't).
- Change: `scripts/run-gated-local.mjs` — no DATABASE_URL → identical single parallel run;
  DATABASE_URL present → phase A (non-DB, parallel) + phase B (DB suites discovered via their
  `SKIP_DB_IN_CI` guard marker, `--no-file-parallelism`, mirroring ci.yml), reports merged for the
  gate. `package.json` `test:gated:local` now calls the runner. Full `[gated-local]` decision logging.
- Gates: `scripts/run-gated-local.test.ts` 5/5 (plan shapes, live guard-marker discovery, report merge).
- Status: VERIFIED_COMPLETE pending the final full-suite run exercising it live.

## Packet 005 — Q1+Q4: model identity + closing-line resolver + grader integrity emission

- Evidence: audit G1/G3/G4/G5 — `mlb_game_backtest.clv/closingOdds/leakageSafe/modelRunAt/
  gameStartUtcMs/auditVersion` permanently NULL; no model versioning anywhere.
- Changes:
  - `server/mlbModelIdentity.ts` — `MLB_MODEL_VERSION` + engine-file sha-256 fingerprint
    (mtime-cached; the drift patcher rewrites the file, so the hash IS the params identity;
    unreadable engine → "unknown", logged once).
  - `server/schemaCapabilities.ts` — INFORMATION_SCHEMA probe, per-process cache, fail-safe
    (probe error → columns treated absent → new-column writes skipped, never ER_BAD_FIELD).
  - `server/mlbClosingLineResolver.ts` — tiered AN↔gamePk resolution (EXACT_GAMEPK 1.0 →
    DATE_TEAMS_UNIQUE 0.95 via the shared/mlbTeams registry → DATE_TEAMS_TIME 0.8 with ±90min
    doubleheader disambiguation; ambiguity/duplicates refuse with a reason, never guess) +
    per-market closing pair extraction with line-match enforcement (a moved RL/total line is a
    different bet → CLV honestly unavailable) + write-through crosswalk heal.
  - `server/mlbBacktestIntegrity.ts` — pure enrichment reusing the audit core (`checkLeakage`,
    `calcCLV`, `calcProfitLoss`): leakage quarantine (settled grades only; NO_ACTION flagged not
    quarantined), CLV, flat-stake P/L, `auditVersion = integrity-v1|<version>|params:<hash>`;
    canonical `mlb_games.game_datetime_utc` beats parsed EST for the start instant; full `events[]`
    reasoning chain logged per row.
  - Wiring: `mlbMultiMarketBacktest` builds a per-game integrity context and writes all integrity
    columns on insert AND update; `mlbModelRunner` stamps `games.modelVersion/modelParamsHash`
    (capability-gated). Schema: version columns + `idx_backtest_model_version` added.
- Deploy gating: all integrity columns written by the grader PRE-EXIST in production — emission
  activates on plain deploy, no migration needed.
- Defects (classified): (1) `MLB_BY_ABBREV` is a Map, not a record — class: code; `.get()` fix;
  24/24 green. (2) **Incident 43** — the planned NEW attribution columns, added schema-first,
  broke all `games` inserts against the live DB (drizzle enumerates every schema column in
  generated INSERTs). Class: schema/deploy-sequencing. Smallest correction: columns reverted;
  attribution rides the existing `auditVersion` column as `integrity-v1|<version>|params:<hash>`;
  regression re-run `mlbDoubleheader.db.test.ts` 9/9 + touched suites 67/67 + full gate PASS.
  Dedicated indexed columns are queued with the mandatory db-push-FIRST ordering.
- Gates: `server/mlbBacktestIntegrity.test.ts` 24/24.
- Status: VERIFIED_COMPLETE (fixture scope + local live-DB suites); first production evidence
  arrives on the next graded slate after deploy.

## Packet 006 — Q2: independent recalibration gate

- Evidence: audit G2 — `triggerRecalibration` patched `MLBAIModel.py` in place, no approval.
- Changes: `server/mlbRecalibrationGate.ts` (mode resolution: default **propose**, legacy
  autopatch only behind `MLB_RECAL_MODE=autopatch` and logged CRITICAL; proposal envelope stored
  in `mlb_model_learning_log.paramChanges` JSON — no schema change, carries the full calibration
  payload so apply needs no 20-min backtest re-run; `validateApproval` enforces PROPOSED-only,
  distinct approver, owner role, mandatory rationale, and zero-tolerance on open leakage
  quarantines in a 30-day window). `mlbDriftDetector.triggerRecalibration` rerouted through the
  gate. New owner tRPC: `mlbSchedule.listRecalibrationProposals` + `mlbSchedule.decideRecalibration`
  (approver identity = authenticated owner; patch applied via the existing
  `migrateCalibrationConstants`, injected to avoid an import cycle).
- Gates: `server/mlbRecalibrationGate.test.ts` 11/11 (self-approval, role, rationale,
  zero-tolerance blocks APPROVED but not REJECTED, no double-apply, legacy rows undecidable,
  autopatch stamped as auditable override).
- Behavior change note (intentional, authorized): from the next deploy, drift/scheduled/manual
  recalibrations WRITE PROPOSALS instead of patching the engine. The owner decides via tRPC.
  Emergency escape hatch documented above.
- Status: VERIFIED_COMPLETE (logic); production behavior change ships with deploy.

## Packet 007 — Q5: AI cost meter + production emitters

- Evidence: audit G7 — zero USD measurement anywhere.
- Changes: `server/_core/aiCostMeter.ts` (versioned price table `prices-2026-07-28` from the
  claude-api reference cache 2026-06-24 — Fable 5 $10/$50, Opus 5 $5/$25, Sonnet 5 $3/$15,
  Haiku 4.5 $1/$5; `AI_PRICE_TABLE_JSON` env override for gateway rates; unknown model → usd null
  + reason, never a guess). Emitters: `dime-chat.route.ts` stream.done and `dime-wc2026.route.ts`
  claude_call_DONE — fire-and-forget, internally fail-soft. Persistence: new `ai_workflow_costs`
  table (dime.schema.ts) with `outcome_ref` for cost-per-verified-outcome; absent table → logged-only.
- Gates: `server/_core/aiCostMeter.test.ts` 8/8.
- Status: VERIFIED_COMPLETE (logic + wiring); live rows require db-push + (for chat) unfreezing.

## Packet 008 — Q6: rubric calibration kit

- Evidence: display-copy rubric defined but not executable (packet 001 residual).
- Changes: `scripts/generate-rubric-samples.mts` — 25 samples through the REAL slice engine
  (10 EDGE / 5 NO_EDGE / 5 STALE / 5 adversarial incl. 2 correct refusals), deterministic
  (byte-identical sha across 3 runs) → `docs/ai-native/factory/calibration/samples.jsonl` +
  ratings template. `scripts/rubric-agreement.mjs` — tie-safe Spearman per dimension + the hard
  rule (grader may never pass a human auto-fail), threshold 0.7, exit-coded for CI.
- Gates: `scripts/rubric-agreement.test.ts` 6/6.
- Status: kit VERIFIED_COMPLETE; the calibration itself remains NOT_RUN — it requires the two
  human raters + one grader run per the protocol (human input, cannot be closed by this session).
