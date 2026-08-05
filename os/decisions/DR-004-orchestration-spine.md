# DR-004 — The orchestration spine substitution — durable execution, agent runtime, policy enforcement, and model-spend governance without Temporal/Pydantic AI/Mastra/OPA/LiteLLM

**Status:** AWAITING RULING · **DRI:** Prez · **Raised:** 2026-08-05 (Stage 2)
**Doctrine:** §5 D5 — the closed loop: Action/Artifact/Outcome, and "an open loop fails silently when inputs shift" (the run-record and liveness-alarm rationale) · §6 D6 — artifact law: the seven required properties, semantic connections, minimize invisible consequential state · §8 D12-L2 — artifact system (one store, append-only, linked) · §8 D12-L3 — queryable context: retrieval by goal/owner/outcome, currency beats completeness · §8 D12-L4 — specialized agents: charters with six fields; seats without a loop are deferred, not activated · §8 D12-L5 — execution tools: graduated authority codified in `os/agents/AUTHORITY.md` · §8 D12-L6 — evaluation: acceptance criteria that bind · §8 D12-L8 — human governance: "policy is the enforcement surface" · §11 D10 — token-maxing economics: the six ledger questions, the capital-allocation rule, and the tiered-routing sentence this DR contests · §14 D14 — the fifteen-stage sequence: visibility before autonomy, evaluation before scale (stages 4, 5, 9, 10, 14) · §15 D15 — failure modes #2 (open-loop automation), #3 (unqueryable work), #4 (data collection without meaning), #9 (generated output mistaken for completion), #14 (token waste mistaken for token-maxing) · §19 — standing Dime rules: data provenance (live-pregame vs walkforward-replay), deploy law (merge to main IS a production deploy; schema changes go through db-push.yml first), and the precedence clause that lets `LLM.md` bind tighter than doctrine

> **Read `DR-014` first.** The coherence, doctrine, and survival critics reviewed all ten
> Stage 2 records together and issued consolidation rulings that override parts of this one.
> Where DR-014 and this record disagree, DR-014 governs.

---

## The question

For each of the four capabilities the mission brief assigned to a named product (Temporal → durable execution, Pydantic AI/Mastra → agent runtime, OPA → policy enforcement, LiteLLM → tiered model-spend governance), do we adopt the product, substitute a mechanism native to this stack, or defer with a stated trigger?

## Why this is contested

Doctrine demands the four *capabilities* (D5 replay/idempotency and stability; D12-L4 chartered agents; D12-L5/L8 graduated authority and a policy enforcement surface; D10 spend justified per accepted outcome) and the brief names four *products* that deliver them elsewhere. Choosing products is not obviously wrong — Temporal's timer-and-timeout semantics are precisely the mechanism Dime lacks, and its absence is what killed the 2026-07-28 program (owner-gated queue, 5 items, 8 days, zero signal). But every named product is a new deployed component or vendor for a one-founder company on a single Railway process, and one of them (LiteLLM tiering) reverses a rule enforced by a `throw` at server/_core/piAgent.ts:57 and stated at LLM.md:15. Doctrine itself is split: D10 calls tiered routing "the mechanical expression" of the capital-allocation rule, while §19 says Dime's own standing rules bind where they bind tighter, and D14 forbids optimizing before measuring. The genuine judgment call is how much orchestration machinery a company with zero measured AI spend, zero job-run records, and zero committed artifacts is entitled to buy before it can observe any of it failing.

## Options

### A — Native four-way substitution: one durable artifact store in TiDB, CI as the policy surface, existing runtimes under charters, spend measured not routed ✅ **RECOMMENDED**

**Effort:** L · **Risk:** medium

Substitute all four. (1) DURABLE EXECUTION: commit `shared/loop/envelope.ts` + `ledger.ts` (blocked on DR-003), then add `server/loop/artifactStore.ts` persisting the ledger to a new TiDB table `loop_artifacts` (artifactId PK, artifactType, contentHash, seq, prevChainHash, chainHash, createdAtMs/eventTimeMs, accessClass, gamePk/market/modelVersion, runMode, payload/sources/links JSON) via `db-push.yml` BEFORE any code deploy, guarded by the existing `server/schemaCapabilities.ts` `tableColumns()` probe so an absent table degrades to logs and never throws in a serving path. Two additive envelope changes, safe because zero artifacts are persisted today: add `"job_run"` to `artifactTypeSchema`, add `runMode: "live" | "replay"` to `versionsSchema` — which makes a replay hash differently and therefore append as a distinct artifact instead of overwriting the original (F5.1/F5.2 at the artifact layer). Replay/idempotency come from what `ledger.ts` already does: dedupe on (artifactId, contentHash), ID_CONFLICT rejection, unresolved-source rejection, hash-chain tamper evidence, JSONL recovery. (2) First and only emitter: ~20 lines in `server/cron/cronRunner.ts` writing a `job_run` artifact per run (name, startedAt, elapsedMs, ok, error) — closes F7.1/F7.2 and proves the store on the cheapest, highest-frequency case. (3) POLICY: `os/agents/AUTHORITY.md` (human) + `os/agents/authority.json` (machine, single source) + `scripts/check-authority.mjs` + `.github/workflows/13-authority-gate.yml` that fails when a PR's changed paths fall outside the acting seat's `allowedPaths`, modelled exactly on the existing fail-closed `scripts/check-github-actions-security.mjs` WRITE_APPROVALS map and workflow `08-contract-and-data-integrity`'s manifest re-verify; plus the runtime half, `shared/authority.ts::assertAction(seat, action)` called from piAgent tool wrappers and `server/cron/cronAuth.ts`. Required-check status rides PR #362's ROLLOUT Wave 1, not a separate ruleset change. (4) AGENT RUNTIME: keep `server/_core/dimeAgent.ts` + `server/_core/piAgent.ts`; add `os/agents/charters/*.md` with L4's six fields and bind `createPiAgent({tools})` to a charter so an off-charter tool throws like an off-allowlist model already does. (5) SPEND: reject LiteLLM tiering; delete the orphan `ai_workflow_costs` design instead of repairing it — `server/_core/aiCostMeter.ts:20`'s broken import of `aiWorkflowCosts` disappears when cost becomes a `workflow_cost` artifact in `loop_artifacts` with `links.outcomeRef` pointing at the outcome it bought. `os/ledger/LEDGER-YYYY-MM.md` is generated from those artifacts and answers D10's six questions. (6) NEGLECT ALARM: `.github/workflows/14-loop-liveness.yml` on a schedule, read-only, on the proven `db-query.yml` pattern (fixed queries, no free-text SQL) — red when any registered job's newest `job_run` is older than its declared max interval, when any pending owner-gated artifact is past its deadline, or when `verifyIntegrity()` fails. A red scheduled workflow emails Prez with zero human effort.

**Pros**

- Every capability lands on infrastructure that already exists and already deploys: TiDB, GitHub Actions, two agent runtimes, CI. Zero new services, zero new vendors, zero new daemons.
- Reuses the single best asset in the repo (`shared/loop/`, 32 adversarial tests) instead of letting it die a second time — and gives it the persistence it was designed for but never got (the JSONL writer is implemented, tested, and never called).
- `runMode` on the content hash is a one-field fix for the provenance law in doctrine §19 that F5 says has no mechanism at all — replays stop destroying originals for free.
- The neglect alarm is a scheduled CI job: its own failure is the notification. Nothing depends on Prez remembering to look.
- Cost becomes an artifact linked to the outcome it produced, which is literally D10's six ledger questions rather than a proxy for them.
- Policy is enforced at the boundary that actually matters here — merge to main IS a production deploy — and at runtime, using two patterns this repo has already shipped and tested.

**Cons**

- Requires an owner-gated `db-push.yml` run before any code deploy, and the migration is only reversible by another migration.
- Touches `server/cron/cronRunner.ts`, which every production data-freshness job runs through — a bug there is a live-data outage, not a CI failure.
- Hard-blocked on DR-003: none of it is buildable until `shared/loop/` is in git and the working tree typechecks again (`server/_core/aiCostMeter.ts:20` currently breaks `tsc --noEmit`).
- CI-as-policy is bypassable by an admin merge, and Prez is the admin. It raises the cost of a violation; it cannot make one impossible.
- ~1.7k `job_run` rows/day at current cadence needs a stated retention/rollup policy or the table becomes the next unobserved thing.
- No timeout/timer primitive — deadline escalation is a `WHERE` clause in a scheduled query, which is weaker than a real durable timer and depends on the alarm workflow itself staying green.

**Doctrine fit:** D5 (replay + idempotency by content hash; stability because an open loop now emits a record whose absence is detectable) · D6 (one artifact store, semantic `links`, seven artifact properties already in the envelope) · D12-L2/L3/L5/L6/L8 (artifact system, queryable context, graduated authority as a machine-readable file with two enforcement points, evaluation binding, policy as the enforcement surface) · D10 (measure before optimize; the six ledger questions answered from artifacts) · D14 (the first emitter is pure visibility — it grants no new autonomy at all) · D15 #2/#3/#9.

### B — Minimum spine: a deploy-inert ledger branch plus a cadence alarm; defer the other three with triggers

**Effort:** S · **Risk:** low

Change no schema and no production code. Durable execution is deferred to its cheapest honest form: a dedicated workflow appends JSONL run records to an orphan branch `ops/ledger`, which Railway never deploys because it only watches `main`. The six `cron-*.yml` workflows already receive the run-lock state in the endpoint response (`server/cron/cronRoutes.ts` returns `lastRunAt`/`lastResult` from `CronJobRunner`), so the trigger job captures the *previous* run's outcome and hands it to the ledger workflow. Add `.github/workflows/14-cadence-alarm.yml` (scheduled) that reads the branch and fails when a job's declared cron cadence and its observed run history disagree — directly answering F7.3, where `cron-mlb-cycle` claims `*/5` and fires 8–10×/day with every under-run reporting success. Policy enforcement = CODEOWNERS plus PR #362's existing ten layers, nothing new. Agent runtime = unchanged, charters deferred with the trigger "first activated seat." Spend = deferred entirely with the trigger "first month where a single workload exceeds a Prez-set USD threshold." `shared/loop/` gets committed (DR-003) but stays unwired.

**Pros**

- Smallest possible surface: no migration, no production code path touched, no new table, nothing that can break a serving request.
- Attacks the exact failure that killed the last program — eight days of silence producing no signal — and nothing else.
- The cadence comparison is the one observability fact no other option gives cheaply: intended schedule vs observed reality, which today is fiction.
- A git branch is durable, free, diffable, `gh`-queryable, and survives Railway redeploys and process restarts by construction.
- Fastest path to a first green artifact; buys real information before committing to a store shape.

**Cons**

- Needs `contents: write` on a workflow that a scheduled trigger can reach — a direct regression against the eight template-injection vectors PR #362 just closed, and against zizmor's posture. Mitigable with a single narrow-scope workflow, not eliminable.
- Records only what GitHub Actions can see: that a trigger was accepted and what the *previous* run reported. Nothing inside the app — no projections, no gradings, no costs, no provenance — ever becomes an artifact.
- Leaves `shared/loop/` committed but still importable by nothing, which is precisely the shape of the 2026-07-28 death; "committed" is not "alive."
- Concurrent pushes from six schedules need rebase-retry logic — small, but it is bespoke machinery whose own failure mode is silence.
- Defers three of the four capabilities the decision was convened to settle, so DR-004 has to be reopened.

**Doctrine fit:** D14 satisfied maximally (visibility, and nothing else, before anything). D5 partially — outcomes are recorded but only at job granularity, and there is no idempotency or replay semantics at all. D6 weak: artifacts exist but form no semantic links to goals or outcomes. D12-L5/L8 unaddressed (no authority ladder, which is a named L5 requirement). D10 unaddressed by design, with a stated trigger — defensible under D14 but not compliant.

### C — Adopt Temporal Cloud for durable execution; substitute the other three natively

**Effort:** XL · **Risk:** high

Take the brief's strongest product at face value. A Temporal Cloud namespace plus `server/temporal/worker.ts` running as a second Railway service (or a second process in the existing container) replaces the six `cron-*.yml` timer workflows and the surviving `setInterval` schedulers in `server/vsinAutoRefresh.ts`. `runMlbCycleOnce`, `runBetGradeCycle`, `refreshAllScoresNow`, and `reconcileStripeSubscriptions` become activities behind workflows with workflow-id-based idempotency, automatic retry policies, and — the real prize — durable timers. The owner-gated queue becomes a workflow awaiting a signal with a timeout that escalates on expiry, which is a first-class mechanism rather than a hand-built alarm. Temporal's Web UI supplies run history and replay. Policy, agent runtime, and spend are substituted exactly as in Option A (authority.json + CI gate, charters on the two existing runtimes, cost artifacts, LiteLLM rejected).

**Pros**

- Durable timers and timeout-triggered escalation are the one capability every native option has to reinvent, and reinventing them is how the last attempt failed.
- Replay and idempotency are properties of the platform rather than of a discipline someone has to maintain.
- Retry, backoff, and failure surfacing come free for jobs that today swallow errors into ephemeral Railway stdout (3,136 `console.*` calls, no retention).
- Managed Temporal Cloud means no cluster to operate — the operational ask is a worker process, not a distributed system.
- Genuinely raises the ceiling if Dime ever runs more than a handful of jobs.

**Cons**

- A new vendor, a new deployed component, and a second deploy target for a one-founder company whose sole host is Railway and whose entire app is one esbuild bundle at `dist/index.js`.
- Temporal TS workflows are deterministic-sandboxed; the existing work functions are deeply coupled to Express, Drizzle, and `spawn(python3)`, so this is a restructuring of the production data path, not an addition beside it.
- It is the largest possible violation of D14 in this decision space: a big new machine introduced *before* a single job-run record exists to show whether the current jobs even work.
- Solves durable execution and contributes nothing to the artifact, provenance, policy, or spend gaps that dominate the gap map.
- Adds a runtime whose own neglect is silent — an unstaffed Temporal namespace looks healthy right up until it does not.
- Cost, and an operational surface Prez did not ask for and must now own forever.

**Doctrine fit:** Strong on D5 stability and replay — the strongest of any option. Directly contrary to D14 ("visibility before autonomy") and to the YAGNI constraint: it adds a service, a daemon, and a vendor in one move. D15 #1 ("AI tools without organizational redesign") applies by analogy — buying orchestration is not the same as closing a loop, and none of Dime's nine registered loops is currently blocked on the absence of durable timers.

### D — One `job_runs` table and a `withRun()` wrapper; reject the envelope as over-engineering

**Effort:** M · **Risk:** low

The boring engineering answer. Add a single TiDB table `job_runs` (id, jobName, startedAt, finishedAt, ok, errorText, triggeredBy, elapsedMs) via `db-push.yml`, plus a `withRun(name, fn)` wrapper in `server/cron/cronRunner.ts` and a scheduled read-only staleness check on the `db-query.yml` pattern. Do not resurrect `shared/loop/` — leave the envelope and ledger where they are, or archive them under `docs/`. Policy: `os/agents/AUTHORITY.md` as prose plus CODEOWNERS. Agent runtime: unchanged. Spend: fix the `aiCostMeter` import by adding an `ai_workflow_costs` table to `drizzle/dime.schema.ts` in the same migration, and log USD per call with no linkage to outcomes. LiteLLM rejected.

**Pros**

- Smallest DB footprint that still closes F7.1/F7.2 and gives the staleness alarm somewhere real to read from.
- Roughly 200 lines, one migration, no dependency on DR-003 or on any prior program's design surviving review.
- A plain relational table is trivially queryable by `db-query.yml`, by any admin surface, and by Prez with a mysql client — no hash chain to explain.
- Repairs the `tsc` break by the most direct route.
- Zero conceptual overhead: any engineer picking this up in six months understands it in a minute.

**Cons**

- Discards the only Level-4-quality asset the audit found, guaranteeing it stays dark state and dies exactly as the 2026-07-28 program did — the failure this mission exists to prevent.
- No content hash means no idempotency and no replay semantics, so F5 (a replay silently UPDATEs and destroys the original) stays open and needs a second, separate mechanism later.
- Two stores from day one (`job_runs` + `ai_workflow_costs`), and neither can hold a projection, grading, evaluation, proposal, or approval — so the model loop needs a third.
- Cost logged without `links.outcomeRef` cannot answer any of D10's six ledger questions; it produces a number, not a justification.
- Prose-only AUTHORITY.md repeats F6.9 verbatim: `OPERATING-RULES.md` declares itself non-negotiable and is loaded by nothing.

**Doctrine fit:** D12-L2 partially (one artifact kind, no links). D5 weak — outcomes recorded, idempotency and replay absent. D6 fails the semantic-connection requirement outright: run rows link to no goal and no outcome. D10 non-compliant (a bill, not a justification). D15 #4 applies directly — "data collection without meaning: build semantic relationships, not a larger archive."

## Recommendation

**A — Native four-way substitution**

A is the only option that answers all four capabilities without adding a service, a daemon, or a vendor, and it does so by making the repo's best existing asset load-bearing rather than by building beside it. The decisive comparisons: against C, none of Dime's nine registered loops is blocked on durable timers — they are blocked on nothing observing them at all, and buying Temporal before a single `job_run` row exists is the most expensive possible way to violate D14 while leaving the artifact, provenance, policy, and spend gaps untouched; C's real prize (timeout escalation) reduces here to a WHERE clause in a scheduled read-only query, which is 95% of the value for 2% of the operational surface. Against D, the `job_runs` table is cheaper by a week and worse forever: it cannot hold a projection, a grading, a cost, or an approval, so it guarantees three stores instead of one, it leaves F5's destructive-replay defect completely open, and it condemns `shared/loop/` — 32 adversarial tests, tamper-evident chain, the one Level-4 artifact the audit found — to a second death by non-adoption, which is precisely the failure mode this mission was convened to break. Against B, the ledger branch records only what GitHub Actions can see from outside the process and needs `contents: write` on a scheduled workflow, regressing the exact template-injection posture PR #362 just hardened. On the fourth capability the answer is not close: LiteLLM tiering should be rejected outright, not deferred politely. It reverses a rule enforced by a `throw` at `server/_core/piAgent.ts:57` and stated at `LLM.md:15`; doctrine §19 gives Dime's tighter standing rule precedence; D14 forbids optimizing a quantity that is currently measured nowhere (no code path persists a single USD figure); and structurally a token router could not govern Dime's dominant AI consumption anyway, because `LLM.md`'s auth model is subscription-first — interactive Claude Code work is not billed per token and not routable. D10 compliance is therefore measurement and attribution — `workflow_cost` artifacts carrying `links.outcomeRef`, rolled into `os/ledger/LEDGER-YYYY-MM.md` against the six ledger questions — with tiering revisited only on a written trigger.

**Grafted from the runners-up**

- From B: the declared-vs-observed cadence comparison, which is the single highest-value observability fact available and is not implied by run records alone. `14-loop-liveness.yml` should assert each job's registered max interval against its newest `job_run`, so `cron-mlb-cycle` claiming `*/5` while firing 8–10×/day turns a green check red (F7.3).
- From B: the principle that the alarm must be a *scheduled CI job whose own failure is the notification*, so neglect is loud with zero sustained human effort — no dashboard anyone has to open.
- From C: durable-timer escalation semantics, reduced to a `deadline` field on owner-gated artifacts (`improvement_proposal`, `approval_decision`) and a staleness clause in the same liveness query. This is the direct fix for F2, the gap that killed the 2026-07-28 program.
- From D: sequencing discipline — ship `job_run` as the store's first and *only* emitter, on the cheapest and highest-frequency path, and require a green liveness alarm for one full week before any second artifact kind is wired. Prove the store before trusting it.
- From D: its honesty about legibility — `os/agents/AUTHORITY.md` must stay a readable prose file for Prez even though `os/agents/authority.json` is the machine source, with a CI check asserting the two agree.

## Requested ruling

Ruling requested: Do we substitute all four named products with native mechanisms — (1) durable execution = the committed `shared/loop/` ledger persisted to a new TiDB `loop_artifacts` table, with `runMode` making replays non-destructive; (2) agent runtime = the existing `dimeAgent` + `piAgent`, bound to charters in `os/agents/charters/`; (3) policy enforcement = `os/agents/authority.json` enforced by a fail-closed CI gate at the PR boundary plus `assertAction()` at runtime, riding PR #362's Wave-1 ruleset rollout; (4) model-spend governance = REJECT LiteLLM tiering outright, keep the 3-model allowlist and `LLM.md:15` as standing law, and satisfy D10 with `workflow_cost` artifacts linked to the outcomes they bought? A YES commits Prez to: (a) authorizing one owner-gated `db-push.yml` run for `loop_artifacts` BEFORE the corresponding code deploy, and accepting that the migration is reversible only by another migration; (b) accepting a change to `server/cron/cronRunner.ts`, which sits on every production data-freshness job, mitigated by the `schemaCapabilities` fail-safe (absent table → log only, never throw) and by shipping `job_run` as the sole emitter first; (c) DR-003 landing first — none of this is buildable until `shared/loop/` is in git and `tsc --noEmit` is green again; (d) adding the authority gate and the liveness alarm to the required-check set after PR #362's ROLLOUT Wave 1, not at merge; (e) an amendment to `LLM.md` recording that D10 compliance at Dime is cost-per-accepted-outcome measurement rather than tiered routing, with the revisit trigger written down — proposed trigger: reopen tiering only when `os/ledger/` shows a single non-interactive workload exceeding a Prez-set monthly USD threshold AND a scored evaluation demonstrates no quality delta on that specific workload; (f) deleting the orphan `ai_workflow_costs` design rather than repairing it, which is what removes the broken import at `server/_core/aiCostMeter.ts:20`. A NO on part (4) alone — i.e. Prez wants tiering anyway — is survivable but must be recorded as a deliberate reversal of a code-enforced rule, requiring edits to `LLM.md`, `piAgent.ts:57`, and `.pi/settings.json` in one PR so the reversal is legible in a single diff.

## Depends on

- DR-003 — hard blocker. `shared/loop/envelope.ts` and `ledger.ts` are untracked; nothing in Option A is buildable until they are committed and the working tree typechecks. If DR-003 rules against committing the prior program, Option A collapses to Option D.
- DR-005 — first-loop selection determines the store's SECOND emitter (after `job_run`). If the model-evaluation loop wins, `server/loop/projectionLoop.ts` already emits eight of the eleven artifact kinds and the wiring is short; if a different loop wins, the second emitter must be designed.
- DR-001 — the publication-gate ruling needs somewhere to record its verdict. `mlbPublicationGate`'s SAFE_TO_PUBLISH becomes an `evaluation_report` artifact with an `approval_decision` linked by `links.decides`; this DR supplies that store.
- Not a DR, but a scheduling dependency: PR #362 (`ci/verification-framework`) must merge before the authority gate and liveness alarm can be added to the required-check set, because its RULESETS.md and ROLLOUT.md own that surface.

## Open unknowns

- Whether a *scheduled* GitHub Actions workflow can use the `environment: Production` gate that `db-query.yml` relies on for the `DATABASE_URL` secret without a manual approval prompt. If Production requires reviewers, the liveness alarm cannot self-fire and needs its own environment or a read-only secret. Resolves via: one test run of a scheduled workflow against that environment, or reading the environment's protection rules.
- Why `aiWorkflowCosts` disappeared from `drizzle/dime.schema.ts`. The audit attributes it to the AI-native program's unfiled "Incident 43" (schema-first `games` column regression), which was never written to `INCIDENTS.md` — the numbers 41–43 there belong to the Trace v1 workstream. If the revert was deliberate policy about adding tables, the same policy governs `loop_artifacts`. Resolves via: a Prez recollection or `git log -S aiWorkflowCosts -- drizzle/`.
- TiDB storage and cost at ledger volume. Six jobs at current cadence produce roughly 1.7k `job_run` rows/day (~620k/year) before any second emitter. No retention or rollup policy is proposed here. Resolves via: a stated retention rule from Prez (proposed default: `job_run` artifacts summarized to daily rows after 90 days, all other kinds retained indefinitely).
- Whether `loop_artifacts` should be `accessClass: "internal"` or `"owner"` at rest. The envelope carries the field but the audit found `accessClass` is "recorded on every artifact and enforced at no consumer." This matters the moment a public model track record is built on the same store. Resolves via: a Prez ruling, ideally folded into DR-001.
- Which Railway builder actually runs (`railway.json` declares DOCKERFILE, live service config for both services reports RAILPACK). Does not block this design, but it determines whether the post-merge deploy verification for the cronRunner change is trustworthy. Resolves via: one build-log read.
- How the authority gate identifies the acting seat for a PR. Proposed: a `Seat:` trailer in the PR body validated against `authority.json`, defaulting fail-closed to the narrowest seat when absent. Not yet tested against this repo's PR template or against `auto-merge-dependabot.yml`, which opens PRs with no human author. Resolves via: a dry-run of `scripts/check-authority.mjs` over the last 50 merged PRs.
- Whether F7.6 (one merge deploys to BOTH Railway services, the second having no domain and no smoke test) means two processes would emit duplicate `job_run` artifacts. Content-hash dedupe does not save this — two processes produce different `startedAt` values and therefore different hashes. May need a `serviceId` in `producer` plus a single-writer rule. Resolves via: confirming whether the second service actually boots the cron routes, which ties to the unresolved single-writer question in project memory.

