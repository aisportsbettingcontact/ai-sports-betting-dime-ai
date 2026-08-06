# Current-state audit — Dime AI as an operating system

Date: 2026-07-28 · Baseline: `ff1d72fd` on `feat/mlb-canonical-db` · Method: 3 read-only exploration
agents (projections pipeline; canonical data layer; AI usage/eval/ops) + direct file reads.
Claim labels per OPERATING-RULES.md. Every claim below carries a path; UNKNOWN is stated where
evidence is absent. Full agent evidence is condensed here; line refs verified by the explorers.

## 1. What exists (VERIFIED)

### Product surfaces
- Canonical user surface: `/feed/model/:sport/:date` → `client/src/pages/DimeModelFeed.tsx` over
  public tRPC `games.list` (`server/routers.ts:199`, ETag + 30s cache). Live data contract:
  `design-system/dime-ai/pages/ai-model-projections.md` (supersedes the stale
  `dime-ai/DIME-FEED-MIGRATION-DRAFT.md` §1.1 file table).
- Model freshness gate on display: `DimeModelFeed.tsx:733-735` — null `modelRunAt` blanks every
  model value. Client decision engine: `client/src/lib/gameInsight.ts` (BET/WATCH/NO_EDGE,
  thresholds 2.5/1.5 pp), `client/src/lib/edgeUtils.ts` (no-vig, ROI).
- Dime Chat (`/chat`): provider hard-frozen (`server/_core/dimeChatModel.ts:44`); deterministic
  verdict validator `server/_core/dimeVerdict.ts` (source_ids, observed-at freshness gates 15min/24h,
  deterministic edge recalculation tol 0.002, whole-answer withholding). Owner-only entitlement.

### Model pipeline (MLB, the production loop)
- Engine: `server/MLBAIModel.py` (3,019 lines, 400k Monte Carlo sims) spawned by
  `server/mlbModelRunner.ts` (`runMlbModelForDate`), orchestrated 24/7 by
  `server/vsinAutoRefresh.ts` `runMlbCycleOnce` (odds → splits → lineups → model → props → backtest).
- Storage: projections denormalized as ~175 columns on `games` (`drizzle/schema.ts:287-786`);
  props in `mlb_strikeout_props` / `mlb_hr_props`; grading log `mlb_game_backtest`
  (unique per game×market); learning artifacts `mlb_model_learning_log`, `mlb_drift_state`,
  `mlb_calibration_constants`.
- Settlement: `server/mlbOutcomeIngestor.ts` (actuals + 5 Brier columns, idempotent by
  `outcomeIngestedAt`) → `server/mlbMultiMarketBacktest.ts` (9 markets, WIN/LOSS/PUSH grading,
  auto-triggered on FINAL) → `server/mlbFullBacktestEngine.ts` (owner-only reports, ROI at
  flat-stake −110) → `server/mlbDriftDetector.ts` (rolling drift → spawns
  `server/scripts/runMlbBacktest2.py` → **patches `MLBAIModel.py` constants in place** →
  `mlb_model_learning_log`).
- Odds provenance: `odds_history` (append-only, `scrapedAt` epoch-ms; no retention job, no
  `(gameId, scrapedAt)` index); `mlb_schedule_history` captures DK **closing** lines at first-pitch
  (`closingLineLockedAt`), AN-keyed.

### Canonical data + identity
- Approved spec (owner, 2026-07-27): `docs/superpowers/specs/2026-07-27-mlb-canonical-database-design.md`
  — promote the 49,414-game verified feed corpus (local-only, gitignored) into canonical
  `mlb_games/plays/pitches/...` tables. **Spec-only: zero code exists** (`drizzle/mlb.schema.ts`,
  `scripts/mlb-etl/` absent). Spec's Phase-6 invariant "49,403 games" is stale vs the corpus (49,414).
- Identity primitives: `server/mlbEventIdentity.ts` (pure gamePk-first identity contract,
  doubleheader classification, no-event-dropped guarantee), `shared/mlbTeams.ts` 7-way crosswalk,
  `games_mlb_gamepk_unique`.
- Best provenance precedent in repo (WC2026, partially unwired): `wc2026_provider_match_map`
  (confidence-scored provider↔canonical mapping as rows), `wc2026_data_lineage`,
  `wc2026_model_runs`/`model_projections.modelVersion`/`model_grades`/`recommendations` —
  the last four are **schema-only, zero references in server/ or scripts/**.

### Governance & measurement
- `OPERATING-RULES.md` (claim labels, incident protocol), `INCIDENTS.md` (40 numbered, none OPEN),
  machine-enforced env-failure allowlist (`scripts/check-environment-failures.mjs`).
- Honest-metric vocabulary: `server/analytics/metricDefinitions.ts` `{state,value,reason}`,
  "never render a fabricated zero" (owner directive 2026-07-23).
- `ml/dime-1.0/` release governance (RELEASE_GATES.md: zero-tolerance incl. 0 future-data
  violations; isolated-evaluator promotion sequence) — codified, never exercised on a real candidate.
- CI: typecheck + gated vitest (no secrets needed; 163 test files) + isolated-MySQL db-tests job;
  `shared/**/*.test.ts` and `server/**/*.test.ts` run everywhere without DATABASE_URL
  (`server/db.ts:161` lazy pool).

## 2. Broken or missing loops (VERIFIED gaps)

| # | Gap | Evidence | Consequence |
|---|---|---|---|
| G1 | **No MLB model versioning.** No `modelVersion` column/constant; `mlb_game_backtest.auditVersion` never written; drift detector rewrites `MLBAIModel.py` constants in place. | Explorer grep; `mlbDriftDetector.ts` `migrateCalibrationConstants()` | No projection is attributable to a parameter set; "did the recalibration help?" is unanswerable — the learning loop cannot be evaluated. |
| G2 | **Self-promoting improvement, no independent gate.** Drift → recalibration → in-place engine patch is fully automatic; `mlbPublicationGate.ts` (SAFE_TO_PUBLISH criteria) exists but is test-only. | `mlbDriftDetector.ts:99-130`; grep: no production import of `mlbPublicationGate` | Violates "agents may not silently promote their own changes"; a bad recalibration ships itself. |
| G3 | **CLV never computed in production.** Closing lines captured; `calcCLV` exists (`mlbBacktestAuditCore.ts:332`); production grader writes none of `clv/closingOdds/profitLoss/leakageSafe/modelRunAt/gameStartUtcMs/auditVersion` — permanently NULL. | grep of `mlbMultiMarketBacktest.ts` insert (18 columns) | Model quality judged on W/L only; no closing-line benchmark, the core skill signal for a betting model. |
| G4 | **No leakage guard in production.** `modelRunAt < gameStartUtcMs` quarantine lives only in test-only `mlbBacktestAuditCore.ts`. | §4.5 of pipeline report | Post-start projections can silently count as wins. |
| G5 | **AN↔gamePk crosswalk gap.** `games` has no `anGameId`; `mlb_schedule_history` has no `mlbGamePk`; `scoreGrader.ts:704-712` documents the id-spaces never align → fuzzy name matching. | file comments | Closing lines (AN-keyed) cannot be joined to graded projections (gamePk-keyed) deterministically. |
| G6 | **~2,500 lines of evaluation tooling unwired**: `mlbBacktestAuditCore`, `mlbCalibrationAudit`, `mlbWalkForwardValidator`, `mlbSegmentationEngine`, `mlbPublicationGate`; `mlbFeedbackLoop.ts` referenced by a test but does not exist. | grep: only `mlbBacktestAudit.test.ts` imports them | Calibration/ECE/walk-forward verdicts computed nowhere. |
| G7 | **AI cost economics absent.** Only USD field (`dimeAgent.ts:92`) never persisted; chat usage logged to console only; no price table, budget, or cost-per-outcome anywhere. | AI-usage report §5 | Token-maxing cannot be evaluated; spend is controlled (rate limits) but not measured. |
| G8 | **No user-facing model track record.** Grading surfaces are owner-only; the publication gate that would authorize public display is unwired (see G2/G6). | routers.ts:1301-1440 all ownerProcedure | Customer-facing trust loop absent. |
| G9 | Computed-but-undisplayed projections (F5, NRFI, innings, team HR, `mlb_hr_props`) have no rendering component in the shipped feed. | pipeline report §3.4 | Paid-for compute produces no customer value. |
| G10 | Spec/corpus drift: canonical-DB spec invariant 49,403 vs corpus 49,414; `make_shards.py` hardcodes 1,586 vs 1,597. | verify-reports sum | First factory-style spec already stale before implementation. |
| G11 | Misc verified defects: `client/src/pages/admin/DeviceActivityPanel.test.tsx` orphaned from vitest globs (never runs); `references/ai-gateway-setup.md` cited at `dime-chat.route.ts:9` doesn't exist; `checkJuly1Fixtures.mjs:21` references undeclared field. | AI-usage + pipeline reports | Silent test rot; broken doc pointers. |

UNKNOWN: production runtime behavior of any of the above (no prod access this session; "code is
intent, runtime is truth"); whether the external AI gateway dashboard covers chat spend; Python
`test_crawl.py` CI wiring; `odds_history` growth in prod.

## 3. Active constraint (decision)

**The company's learning loop is open where it matters most: model changes are unversioned,
self-promoted, and evaluated without closing-line or leakage integrity.** Everything downstream —
trustworthy user-facing track record (G8), Dime Chat evidence claims, canonical-DB grading (spec
Phase 6), token-maxing economics — depends on a projection-evaluation loop whose records are
version-attributed, leakage-safe, CLV-benchmarked, and whose improvements pass an independent gate.

Priority scoring (customer value × learning value × reuse × risk reduction / effort+risk):

1. **Evaluation-integrity vertical slice (G1–G6) — SELECTED.** Highest learning value; reuses the
   existing unwired audit suite (low effort); pure-module implementation carries no production risk;
   compounds into canonical-DB Phase 6, the public track record, and chat evidence.
2. Canonical MLB DB build-out (approved spec) — high value, but 10–15 GB ETL + manual `db-push.yml`
   + prod writes are owner-gated; not safely completable this session. The slice is designed to be
   its Phase-6 grading substrate.
3. AI cost instrumentation (G7) — folded into the slice's artifact envelope (cost fields) rather
   than a separate system.
4. Feed rendering of computed markets (G9) — UI work, gated on brand law; deferred.

## 4. Vertical slice selected (maps to contract's priority slice)

provider observation → canonical event (gamePk identity) → validated immutable odds/input snapshot
→ **versioned** projection artifact → user-facing display artifact (decision-time evidence) →
authoritative result (with corrections/void/push/reschedule) → grading + Brier + calibration +
**CLV vs closing snapshot** with leakage quarantine → guarded improvement proposal →
**independent approval state** → next-cycle verification.

Implementation boundary (safe): pure TypeScript modules `shared/loop/` (envelope, ledger, queries)
+ `server/loop/` (slice engine reusing `server/mlbBacktestAuditCore.ts` math and
`server/mlbEventIdentity.ts` identity), exercised end-to-end on synthetic fixtures (repo convention:
synthetic gamePks, per `server/mlbDoubleheaderFixtures.ts` honesty note) under vitest with zero
credentials. No scheduler, route, schema, or production-path mutation in this slice. Wiring the
engine into `mlbMultiMarketBacktest` and the drizzle schema is the queued next action, gated on
owner review + `db-push.yml`.
