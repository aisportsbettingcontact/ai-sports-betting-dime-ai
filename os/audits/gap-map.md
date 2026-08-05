# Gap map — Dime AI, 2026-08-05

Companion to `os/audits/2026-08-ai-native-audit.md`. Every gap is an **open loop**: a process where
a required closed-loop component (D5) is missing. 96 open loops were identified across 13 forensic
clusters; they collapse into **9 gap families** plus **3 urgent live findings**.

Each gap names: the missing closed-loop component · the doctrine section violated · the evidence ·
the consequence. Priority is *(customer/company risk × learning value × reuse) ÷ (effort × risk)*.

Legend for the missing component: **G**oal · **C**ontext · **A**ction · **Ar**tifact · **O**utcome ·
**E**valuation · **M**emory (Adjustment + Memory).

---

## U — Urgent live findings (decide before Stage 3)

### U1 — Production holds "do not publish" verdicts it is ignoring
**Missing: A (the decision authorizes nothing) · Violates D5, D8, and the compliance gate in §19**

On 2026-07-25 the forensic audit wrote **9 `publish_*` BACKTEST-ONLY rows** into production
`mlb_calibration_constants` — an evidence-based verdict that no market has demonstrated sellable
edge. **No shipped code reads `publish_*`.** The platform publishes all 9 markets anyway, fail-open.
The audit's own executive verdict: *"Publish graded results and transparent projections; do not sell
edges the data does not yet support."* That instruction is not in force.

Supporting evidence from the same audit: FG ML 55.4% (n=1,528) · FG total bias −0.54 runs · NRFI
51.3% (coin flip) · K props structurally broken (an opponent-adjustment unit bug shrank every
projection to ~72% of the book line) · HR props **negative skill vs base rate**.

*Consequence:* live customer-facing claims contradict Dime's own evidence. This is the one gap that
is a trust and compliance exposure rather than an architecture defect.
*Resolution requires:* a Prez ruling (§Stage 2, DR-001) — not an executor decision.

### U2 — Three contradictory price sets ship simultaneously
**Missing: E (a stated rule with no verification step) · Violates D15 #8**

| Surface | Prices |
|---|---|
| Live checkout (`landing-content.ts:297,312,329`) | Pro **$49.99** · Sharp **$99.99** · Max **$199.99** |
| Objections block, *same page* (`:398`) | "Why **$99** a month… ≈ $3.30 a day", tier **"Operator"** — which no longer exists |
| schema.org JSON-LD served to bots (`landingPrerender.ts:351`) | Pro **$99** · Sharp **$249** · Operator **$499** |

A prospect reading the objections section sees roughly double what they will be charged; Google
indexes a third set entirely. The page's own HONESTY LAW header declares a claim whitelist — **with
no executable check enforcing it**, which is exactly how this shipped.

### U3 — 837 commits and 52 GB of evidence exist only on one laptop
**Missing: Ar + M · Violates D6 (minimize invisible consequential state)**

`local/audit-mlb-model-2026` — the forensic audit, backfill tooling, model fixes, replay engine, and
publication-gate wiring — has **never been pushed**. It executed real, snapshot-backed writes against
production TiDB on 2026-07-25: **13,408 regrades, 8,464 new ledger rows, 7,632 CLV backfills.**

Alongside it: 47 GB MLB feed corpus + 3.8 GB NFL DB + 1.2 GB audit evidence, plus all of
`docs/ai-native/`, `shared/loop/`, `server/loop/`, and 7 `server/*.ts` modules — untracked.

*Consequence:* disk failure destroys the audit **and the only record of what was done to
production**. No one can re-run or verify those mutations.

---

## Gap families

### F1 — Dark state: consequential work that no system can see
**Missing: Ar + M · D6, D15 #3 · Priority: HIGHEST**

| # | Gap | Evidence |
|---|---|---|
| F1.1 | Entire AI-native program untracked | `git ls-files docs/ai-native shared/loop server/loop` → 0; `git log` on those paths → empty |
| F1.2 | 7 `server/*.ts` modules written 2026-07-28, never committed, imported only by their own tests | `aiCostMeter`, `mlbRecalibrationGate`, `mlbClosingLineResolver`, `mlbModelIdentity`, `mlbBacktestIntegrity`, `schemaCapabilities` |
| F1.3 | 5 of 16 `docs/audits/` bundles untracked | `git status --porcelain docs/audits` |
| F1.4 | **Zero GitHub issues, ever** — 366 PRs in 28 days, `has_issues=true`, full label set unused | `gh issue list --state all` → empty |
| F1.5 | 3,136 `console.*` calls → ephemeral Railway stdout, no retention, no query path | Only 6 of ~220 server modules write to `debug_logs`; `dailyPurge.ts` is an explicit no-op since 2026-03-25 |
| F1.6 | Discord alerts are **write-only** — bot has `GatewayIntentBits.Guilds` only, cannot read messages | No code can query what was sent, whether anyone saw it, or what was done |
| F1.7 | `.tmp-*` drivers and `vitest-results.phase-*.json` have no artifact home | Runs they describe are unreproducible |

### F2 — Silence is invisible: no mechanism ages a blocked queue
**Missing: O + M · D5 (open loops fail silently) · Priority: HIGHEST**

The defining gap. `execution-state.json` `next_action_queue` holds **5 owner-gated items, all
blocked on item 1, untouched for 8 days**, while `main` took ~350 commits in other directions.
Nothing reminded, aged, escalated, or even noticed.

| # | Gap | Evidence |
|---|---|---|
| F2.1 | Owner-gated queue with no ageing or escalation | `execution-state.json:26-32` |
| F2.2 | `operating-brief.md` declares itself "the recurring decision surface" and "regenerable" — **no generator exists anywhere** | 72 lines of hand-typed markdown, regenerated exactly once, now 8 days stale with a wrong item 3 |
| F2.3 | `loop-registry.yaml` statuses are a snapshot with no refresh mechanism | `updated: "2026-07-28"`, never re-observed; `execution-ledger.md:37` even miscounts 9 loops as 8 |
| F2.4 | Incident 40 "RESOLVED IN CODE (trust pending post-deploy observation period)" — no artifact records the observation happening | `INCIDENTS.md:1048` |
| F2.5 | `todo.md` — 781 open checkboxes, 4,550 lines, append-accreted since 2026-04-16, unlinked from every context root | Last commit 2026-07-23 |

### F3 — Evaluation computed and discarded
**Missing: E → A · D5, D12-L6, D15 #2 · Priority: HIGH**

| # | Gap | Evidence |
|---|---|---|
| F3.1 | ~2,500 lines of evaluation tooling **dead since 2026-05-23** | `mlbBacktestAuditCore`, `mlbCalibrationAudit`, `mlbWalkForwardValidator`, `mlbSegmentationEngine`, `mlbPublicationGate` — sole importer is `mlbBacktestAudit.test.ts` |
| F3.2 | `mlbPublicationGate` computes SAFE_TO_PUBLISH and **authorizes nothing** — no caller, no side effect but a log line | 3 of its 7 checks read columns production never writes |
| F3.3 | CLV permanently NULL in production; `calcCLV` reachable only from untracked files | `mlb_game_backtest.clv/closingOdds/closingOddsOpposite` |
| F3.4 | Log-loss computed in two modules, **never persisted to any column** | Unlike Brier, which is written to `games` |
| F3.5 | Walk-forward validator's leakage counter keys on `'QUARANTINED'`, a value production never emits → **always reports zero violations** | A vacuously-passing evaluation |
| F3.6 | Brier scores computed nightly, rendered on an owner-only surface, **influence nothing** — the only recalibration trigger is `f5_share`, a property of the run environment, not of model error | 11 of 16 markets get no Brier at all |
| F3.7 | Compliance-gate blocks are logged per-request with **no aggregation surface** — the gate cannot learn from its own firings | |

### F4 — Uncontrolled automation: action without evaluation
**Missing: E before A · D2 pattern, D15 #2 · Priority: HIGH**

| # | Gap | Evidence |
|---|---|---|
| F4.1 | **`mlbDriftDetector` rewrites `MLBAIModel.py` constants in place, automatically, with no proposal, no approval, no version stamp** | Still true 8 days after documentation; `git log` shows no commit touched the trigger path |
| F4.2 | No model versioning anywhere — no `modelVersion` column exists | "Did the last recalibration help?" is structurally unanswerable |
| F4.3 | `mlb_drift_state` is **upserted** on every check — prior state destroyed | `drizzle/schema.ts:2162-2165` |
| F4.4 | The fixture approval gate correctly refuses self-approval — **and approving causes nothing to happen.** No apply/promote step exists | The loop terminates at a decision with no effect |

### F5 — No provenance: replays destroy originals
**Missing: Ar integrity · D5, mission §19 data-provenance law · Priority: HIGH**

| # | Gap | Evidence |
|---|---|---|
| F5.1 | **No live-pregame vs walkforward-replay separation exists** — no column, enum, guard, or discriminator | The mission's own standing rule: *"a loop that blends them fails its evaluation layer by definition"* |
| F5.2 | Unique key `(gameId, market)`; a re-run silently `UPDATE`s the original row — **a replay is indistinguishable from, and destroys, the original** | `drizzle/schema.ts:2114` |
| F5.3 | Duplicate-key UPDATE matches on `(gameId, market, modelSide)` but the index is `(gameId, market)` — if a re-run flips the side, **0 rows update, `written++` still increments, stale row survives, log reports success** | `mlbMultiMarketBacktest.ts:930-936` |
| F5.4 | 5 provenance columns declared and never written → permanently NULL | `modelRunAt`, `gameStartUtcMs`, `leakageSafe`, `quarantineReason`, `auditVersion` |
| F5.5 | **Suspected precision defect:** `modelProb` declared `decimal(5,2)` documented "(0-100)"; writer stores a 0–1 probability. Scale 2 quantizes to 1-pp buckets, corrupting every downstream Brier/log-loss | UNKNOWN pending one production `SELECT`; does not bite today only because consumers are unwired |
| F5.6 | `tracked_bets.result` destructively overwritten on settlement — no settlement-event row | No user-bet history exists |

### F6 — Gates that do not gate
**Missing: E binding · D8 (acceptance criteria), D15 #8 · Priority: HIGH**

| # | Gap | Evidence |
|---|---|---|
| F6.1 | Only **4 required status checks** on `main`. **DB Tests and Build & Preview Gate are advisory** — the bundle-budget gate and the 10 real-DB suites can fail and still merge | Both were the *remediation* for the app-shell blockers |
| F6.2 | 30 of 38 Playwright tests (7 of 8 specs) **run in no workflow at all** | The "live proof" for the shell remediation never executes |
| F6.3 | `kenpomCredentials.test.ts` returns early when env is absent → **reports GREEN with zero assertions on every CI run**, counted among 3,778 passing | Routes around the allowlist by using `return` instead of `it.skip` |
| F6.4 | `DeviceActivityPanel.test.tsx` matches no vitest include glob — **has never executed**. A work packet records this as `VERIFIED_COMPLETE`; the one-line fix is not on `main` and the packet is uncommitted | A closed-loop failure *inside the packet system* |
| F6.5 | The allowlist's stale-entry / not-executed / real-failure detection is gated behind `profile === "local"` — **never runs in CI** | An entry pointing at a deleted test is invisible on every PR |
| F6.6 | Bundle-budget allowance ratcheted **9 times** (5,120 → 11,776 bytes, +130%); each breach resolved by raising the ceiling, recorded in prose inside the config it governs | Emits no artifact |
| F6.7 | Append-only on `INCIDENTS.md` has **zero mechanical enforcement**; Status lines are mutated in place | And no number-allocation mechanism — see F6.8 |
| F6.8 | **Incident-number collision**: two concurrent sessions both took 41–43; the AI-native program's three incidents were never filed and it cited the register as evidence anyway | `grep` for the program's terms across all 61 entries → 0 hits |
| F6.9 | VERIFIED/INFERRED/UNKNOWN taxonomy has **zero enforcement**, and `OPERATING-RULES.md` ("read at every session start, non-negotiable") is **loaded by nothing** — not `CLAUDE.md`, not `AGENTS.md`, no hook, not the per-prompt capsule | Its own last commit is 2026-07-08, the oldest governance artifact |

### F7 — No operational observability
**Missing: O · D12-L3/L6 · Priority: MEDIUM-HIGH**

| # | Gap | Evidence |
|---|---|---|
| F7.1 | **No cron job writes a run record.** No `job_runs` table exists anywhere | The GitHub Actions run proves only that the endpoint accepted the trigger |
| F7.2 | `CronJobRunner.lastResult` is process memory — wiped on every deploy, and the repo redeploys ~13×/day | `/api/cron/status` is structurally useless |
| F7.3 | **Declared cadence is fiction** — `cron-mlb-cycle` claims `*/5` but fires ~8–10×/day with 1–3 h gaps, and **every under-run reports success** | Nothing compares intended to observed cadence |
| F7.4 | Zero error tracking, metrics, tracing, or APM — no sentry/datadog/otel/prom-client/pino/winston | An unhandled exception in any background job produces no queryable signal |
| F7.5 | CI failure evidence expires in 30 days and is gitignored | After a month a red PR leaves no reproducible trace |
| F7.6 | **One merge = two production deploys.** Both Railway services deploy the same repo/branch; the second has no domain, no smoke test, no health check | Observed: commit `31fe9638` deployed to both within the same second |
| F7.7 | `railway.json` declares `DOCKERFILE`; live config for both services reports `RAILPACK` | UNKNOWN which runs. If RAILPACK wins, the Python runners hit the exact ENOENT the Dockerfile exists to prevent |
| F7.8 | Product analytics is **default-disabled with a silent drop path** — no error on misconfiguration | Whether events land is not determinable from the repo |

### F8 — Money path integrity
**Missing: Ar + O · D13 Revenue · Priority: MEDIUM-HIGH**

| # | Gap | Evidence |
|---|---|---|
| F8.1 | **Zero database transactions on the entire Stripe path.** Entitlement grant, `entitlement_events`, `payment_events`, plan-quantity decrement, and Discord role sync are 5 independent un-atomic statements | Every ledger writer swallows its own errors by design — partial fulfillment is silent by construction |
| F8.2 | **Claim-before-process ordering neutralizes the deliberate 5xx-invites-redelivery design** — 6 of 14 event types are acked 200 before processing; a crash loses them permanently | The single highest-value defect in the billing cluster |
| F8.3 | `request_id` uniqueness — the stated double-charge guard — is **declared in Drizzle and explicitly absent in production** | Schema-as-documented and schema-as-deployed disagree on the one constraint preventing double-charging |
| F8.4 | Credit charge happens **after** the answer streams → a lost race or crash yields a free answer | `step.13.credit_RACE_BLOCKED`, `creditsCharged=0` |
| F8.5 | **Nothing ever grants credits.** Every user defaults to a hardcoded 100 and can only spend down; zero connection between Stripe and the credit ledger | |
| F8.6 | `payment_events` / `subscription_events` / `entitlement_events` — three append-only ledgers with **zero readers** | Artifact produced, never observed |
| F8.7 | Revenue never enters the metrics system | No product decision can be conditioned on it |

### F9 — Missing layer primitives
**Missing: various · D12 · Priority: MEDIUM (this is what Stage 4 builds)**

| Primitive | State |
|---|---|
| Goal record | **ABSENT** — prose objectives only, no type, no metric bound to a threshold |
| Agent charter | **ABSENT** — zero occurrences of "charter" repo-wide |
| Authority ladder | **PARTIAL** — 2 hardcoded strings inside a fixture engine; `accessClass` recorded on every artifact and enforced at no consumer |
| Token ledger | **PARTIAL** — complete design, zero rows, no table, a broken import, zero emitters |
| Founder dashboard | **ABSENT** — no page, route, or component; the "regenerable" brief has no generator |
| Loop file | **PRESENT and good** — `loop-registry.yaml`, 9 loops with status/gap/DRI/approver/escalation. Untracked |
| Decision record | **PARTIAL, split in two incompatible forms** — D-001…D-007 prose (D-003/D-004 never stated) + a schema-validated `approval_decision` that exists only in test memory |
| Artifact ledger | **PRESENT and excellent** — append-only, prev-hash chained, tamper-evident, adversarially tested. Untracked, and **never persisted** (the JSONL writer is implemented, tested, and never called) |

---

## Correctness defects found in passing

Not doctrine gaps — ordinary bugs surfaced by the audit, recorded so they are not lost:

1. **`mlbOutcomeIngestor.ts:162`** — `parseFloat(String(modelProbPct)) / 100` applied to NRFI/F5
   probabilities that are stored 0–1 in practice, producing near-meaningless Brier scores. Schema doc
   says "(0-100)"; stored data disagrees. Unchanged since 2026-07-23.
2. **`v27_jul18_engine.mjs:9`** advertises a "500X Monte Carlo backtest"; the file contains **no RNG
   at all**. The repo already guards the chat layer against repeating this — a known, tolerated
   inaccuracy one grep from marketing copy.
3. **`server/mlbFeedbackLoop.test.ts` tests a module that was never written.**
4. **`server/wc2026/betexplorer_scraper.py`** — 3,044 lines, never spawned by anything; a schema
   column claims it as the writer.
5. **`kenpomCredentials.test.ts`** would spawn a deleted script if `KENPOM_*` were ever set in CI.
6. **`v27_jul18_engine.mjs`** is scoped to two WC2026 fixtures already played (2026-07-18/19) and is
   still registered behind a live endpoint.
7. **The market taxonomy is redefined four times at three granularities** (16 keys ×3, 8 display
   groups, 9 audit gate markets), kept in sync by a code comment: *"must match
   mlbMultiMarketBacktest.ts MARKETS"*.
8. **`dime_soak_test_results` and `dime_user_entitlements`** — tables with no writer and no reader.
9. **`.gitignore:90`** ignores Next.js build output this repo will never produce — the residue that
   makes a reader believe Next.js is in the stack.
10. **`platform_contract.json`** still names RunPod as the compute platform and lists `"anthropic"`
    as an **excluded** provider — the exact opposite of the 2026-08-04 owner decision.

---

## Sequencing implication for Stage 3

D14 is explicit: *visibility before autonomy, evaluation before scale.* The families order as:

```
U1–U3 (decide)  →  F1 + F2 (durability + loud silence)  →  F5 + F6 (provenance + binding gates)
                →  F3 + F4 (wire evaluation, gate the self-promoter)  →  F7 + F8  →  F9 (layers)
```

**F1 and F2 must come first.** Every other fix, if built before them, becomes more dark state — which
is precisely what happened on 2026-07-28. The first thing this mission ships must be the thing that
makes shipping observable.
