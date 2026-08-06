# DR-005 — First-loop selection: which process becomes Dime's first closed loop

**Status:** AWAITING RULING · **DRI:** Prez · **Raised:** 2026-08-05 (Stage 2)
**observe_by:** 2026-08-12
**Doctrine:** §0 The operating sentence (D16) — LOOP-001 is the first process that satisfies every clause: retrieve context, act through a defined role, produce a durable artifact, observe the real result, evaluate against intent, preserve the lesson, keep a named human responsible. · §1 The central test (D1) — moves engineering from Level 2 (AI embedded in workflows still designed around human coordination) toward Level 3 by making information move without Prez routing it. · §5 The closed loop (D5) — the mandatory seven-component schema and the nine-question interrogation are the acceptance criteria for `os/loops/LOOP-001-engineering-build.md`. Also the source of the sharpest objection to Option D: 'an action is not an outcome.' · §6 The queryable company (D6) — the seven required artifact properties and the semantic-connection law (a code change links to its spec and tests; a release links to the work; post-release feedback links back). `envelope.ts`'s `sources` + `links` fields implement this literally. · §7 The five-level chain (D7) — the honest limit of Option A: it covers planned activity → actual result well, and strategic intention → customer evidence thinly until LOOP-002/003 connect. · §8 The eight layers (D12) — L1 (goal record type = the issue template's nine fields), L2 (artifact system = the ledger), L5 (authority ladder = merge is rung 3), L6 (evaluation = binding gates, not advisory), L7 (memory = `os/memory/lessons/` keyed by artifactId). · §9 The software factory (D8) — the ten required parts, and the two-factory table. LOOP-001 certifies the product-code factory; LOOP-002 would certify the model factory. Also the law that 'each project must improve the factory.' · §13 Function loops (D13) — the Engineering paragraph verbatim: prior sprint outcomes as shared context, plan-versus-actual comparison, 'measure shipped-the-right-work, not shipped-work.' Also Sales/GTM, which is where the Bet Grader wedge belongs. · §14 The fifteen-stage sequence (D14) — stage 2 is this record. Stage 4 (map the open loop), stage 5 (artifacts until legible), stage 9 (define evaluation before declaring success, at approval time), stage 10 (controlled reversible action, high-impact stays human-gated), stage 11 (build the factory), stage 12 (connect functions). The ordering law 'visibility before autonomy, evaluation before scale' is the single strongest argument against Option B. · §15 Failure modes (D15) — #2 open-loop automation, #3 unqueryable work, #9 generated output mistaken for completion, #15 prototype theater. Each option was scored against all four. · §16 Peak state (D16) — 'the company learns from each cycle and makes the learning available to the next,' and the requirement of at least one completed live cycle with an observed outcome and a filed adjustment. This is the criterion that decides the record. · §19 Standing Dime rules — the evidence taxonomy (VERIFIED / INFERRED / UNKNOWN), the data-provenance law ('a loop that blends live-pregame and walkforward-replay fails its evaluation layer by definition' — the reason Option B needs schema work first), the compliance gate (binding on Option C's surface), and the deploy law ('merge to main IS a production deploy' — the reason the ledger goes on an orphan branch).

> **Read `DR-014` first.** The coherence, doctrine, and survival critics reviewed all ten
> Stage 2 records together and issued consolidation rulings that override parts of this one.
> Where DR-014 and this record disagree, DR-014 governs.

---

## The question

Which single process does Dime close first as LOOP-001 — the Model Release Loop, the Engineering Build Loop, the Bet Grader Wedge Loop, or a narrow Release-Health Loop — given that D16 requires at least one COMPLETED LIVE cycle with an observed outcome and a filed adjustment inside this mission?

## Why this is contested

Three of the four candidates win on a different axis, and no axis dominates on its own.

The Model Release Loop wins on **doctrine density**: it is the only candidate that touches D8's second factory, the §19 provenance law, and U1's live trust exposure simultaneously, and its evaluation math (Brier, log-loss, Wilson CI, no-vig, walk-forward folds) is already written and unit-tested. The Bet Grader wins on **business weight**: STATE §1 names the binding constraint as "Dime cannot honestly sell decision quality it cannot demonstrate," and the wedge is the only candidate that produces a customer-observable outcome. The Engineering Build Loop wins on **evidence density and cycle time**: 366 PRs in 28 days, a cycle that completes in hours, and an apply/promote step that already exists and is already owner-gated.

The tension is that D14 stage 2 asks for a process that is *important, bounded, AND evidence-rich* — and the two most important candidates are the two least evidence-rich. The Bet Grader has zero evidence because it does not exist; you cannot map an open loop (stage 4) or "create artifacts until the process is legible" (stage 5) for a process that never runs. The Model Release Loop has abundant *data* but its evidence is structurally corrupt: CLV is permanently NULL, no `modelVersion` column exists anywhere, `mlb_drift_state` is upserted so prior state is destroyed, the walk-forward leakage counter keys on `'QUARANTINED'` (a value production never emits) so it always reports zero, and `mlbPublicationGate` computes SAFE_TO_PUBLISH and authorizes nothing. Its "richness" is 2,500 lines of correct math attached to columns nobody writes.

The decisive and under-appreciated axis is **whether the loop's outcome is observable on a timescale shorter than the mission**. A recalibration's real outcome is a change in calibration error, and that needs weeks of games to separate from noise — the publication gate's own floor is n≥30 graded rows per market and the audit's own working sample was n=1,528. Closing the model loop "procedurally" in three days would produce exactly the vacuously-passing evaluation (F3.5) the audit condemns. The engineering loop's outcome — did the merged change do what its intent record claimed, and did production stay healthy — is observable in 24 hours, ~13 times a day.

There is also a reflexive argument that cuts both ways and is the real judgment call: the Engineering Build Loop is the loop that *builds the other loops*. Choosing it is either the highest-leverage move available (every subsequent loop gets constructed inside an observed process, which is precisely the 2026-07-28 failure fixed at its root) or it is meta-work that certifies a factory while the customer-facing gaps stay open for another month. Reasonable people land on opposite sides of that.

## Options

### A — Engineering Build Loop (LOOP-001): intent → PR → binding gates → merge/deploy → observed outcome → filed adjustment ✅ **RECOMMENDED**

**Effort:** M · **Risk:** low

Close the loop the executor itself operates, using substrates that already exist. Concretely:

**Intent artifact = GitHub Issues** (zero have ever been opened; `has_issues=true`, full label set unused). New `.github/ISSUE_TEMPLATE/change-intent.yml` carrying the nine D12-L1 goal fields: desired outcome · need behind it · evidence · acceptance criteria · constraints · horizon · DRI · status · evaluation measure. Labels `loop:eng`, `loop-exempt`.

**Linkage gate**: `scripts/check-loop-intent.mjs` (+ co-located `.test.ts`, matching the repo's `scripts/check-*.mjs` convention) in a new `.github/workflows/13-loop-intent.yml`. Fails when a PR touching `server/**`, `client/**`, `shared/**`, or `drizzle/**` has no resolvable `Closes #N` / `Loop-Intent: #N` and no `loop-exempt` label. Auto-exempts dependabot and prettier-fixpoint-only diffs (reuse PR #362's `07-coverage-patch` format-neutrality proof).

**Evidence artifact**: the §21.3 YAML block already hand-written in PR bodies (PR #362 has one) becomes machine-validated — `shared/loop/evidenceRecord.ts` (zod) + `scripts/check-evidence-record.mjs`, requiring a terminal `outcome` from the fixed enum. Turns an existing convention into a binding gate; adds no new format.

**Durable artifact store**: first real use of `shared/loop/envelope.ts` + `ledger.ts`. `.github/workflows/14-loop-ledger-append.yml` (on push to main) runs `scripts/loop-ledger-append.mjs`, builds `LoopArtifact`s via `makeArtifact()`, and appends to `eng-loop.jsonl` on a dedicated **orphan branch `os-ledger`** — never on `main`, because a bot commit to main is a production deploy. Artifact kinds map onto the existing 11-member enum with **zero schema change**: intent issue → `improvement_proposal`; merge → `approval_decision` (with `links.decides`); deploy+smoke → `result_observation`; 24h evaluation → `evaluation_report`; token spend → `workflow_cost` (`links.outcomeRef`).

**Outcome sensor**: `deploy-smoke.yml` already runs on `push: [main]` and asserts five checks against the live origin. Add a step that appends its verdict as the `result_observation`. No new workflow, no new service.

**Loud silence (F2)**: `.github/workflows/15-loop-outcome-sweep.yml` daily, running `scripts/loop-outcome-sweep.mjs` — reads the ledger for `approval_decision` artifacts with no matching `evaluation_report`, maintains ONE issue "Loop outcome queue — unevaluated merges" with per-item age, and **exits non-zero when any item exceeds 72h**. A red daily workflow + GitHub's own notification is the escalation channel; no daemon, no vendor, no Discord (which is write-only, F1.6).

**Loop file**: `os/loops/LOOP-001-engineering-build.md` answering all nine D5 questions, DRI Prez.

**Apply/promote step**: merge to main. It already exists, already deploys, and is already owner-gated — this is the step the 2026-07-28 slice never had.

**Pros**

- Only candidate whose full cycle — intent → merge → deploy → observed outcome → filed adjustment — completes in ~48h. D16's completed-live-cycle criterion is near-certain, not hoped for. And at ~13 merges/day the loop gets dozens of live cycles inside the mission, not one.
- The apply/promote step exists, works, is exercised daily, and is already human-gated. Options B and C must build theirs.
- Executor is the operator: the loop is dogfooded by the mission's own work, so its neglect is felt immediately rather than discovered in an audit 8 days later.
- Zero new infrastructure. No service, no daemon, no vendor, no schema change, no `drizzle/` touch, no production behavior change. Five scripts, three workflows, one issue template, one orphan branch.
- First real use of the best primitive in the repo (`shared/loop/envelope.ts` + `ledger.ts`, 32 adversarial tests, imported by nothing shipped) — converting the audit's #1 salvage asset into load-bearing code, which is also the cheapest possible test of DR-003.
- Directly closes F1.4 (zero issues ever), F1.1 (dark state), F2.1/F2.2 (no ageing on a blocked queue), F6.9 (unenforced evidence taxonomy), and F7.6 (deploys with no recorded observation).
- It is the loop that builds every other loop. Closing it first means LOOP-002 (model) and LOOP-003 (wedge) get constructed inside an observed process — structurally preventing a second 2026-07-28.
- Composes with PR #362 rather than competing: #362 supplies the acceptance layer (D8 parts 2/5/7), this supplies the intent, artifact, outcome, and memory parts (D8 parts 1/9/10).

**Cons**

- Meta-work. It produces no customer-visible improvement, and U1 (nine BACKTEST-ONLY markets publishing anyway) stays live while it is built — unless the graft below is taken.
- Adds real friction to a 13-PR/day cadence. A fail-closed intent gate is a tax Prez pays personally on every change, and if it is felt as bureaucracy he will label-exempt around it and the loop dies the same quiet death as its predecessor.
- The 'outcome' for a UI-only PR is hard to automate and may degrade to self-attestation — which weakens D5's rule that an action is not an outcome. Some cycles will close on a weaker signal than the doctrine wants.
- Cannot ship without DR-003 (committing `shared/loop/`) and without fixing the working-tree typecheck break at `server/_core/aiCostMeter.ts:20` (imports `aiWorkflowCosts`, which `drizzle/dime.schema` does not export; `tsc --noEmit` exits 1).
- The orphan-branch ledger is a slightly unusual store; it is invisible in normal repo browsing and a reader could reasonably not know it exists.

**Doctrine fit:** Strongest overall fit for D14 stage 2 read literally — important, bounded, and by a wide margin the most evidence-rich process Dime runs. Satisfies D14's ordering law (visibility before autonomy) because it adds observation without adding any authority. Delivers D5 completely (all seven components, all nine interrogation questions answerable from the ledger). Delivers D6 by making the issue→PR→artifact→deploy→evaluation chain semantically linked and traceable intention-to-result. Delivers D12-L1 (goal record type via the issue template), L2 (durable artifacts), L6 (binding evaluation), L7 (lessons attached to the process). Directly implements D13-Engineering's 'measure shipped-the-right-work, not shipped-work.' Corrects D15 #2, #3, #9, and #15. Weakest on D7: it covers planned activity → actual result well, but the strategic-intention and customer-evidence rungs of the five-level chain stay thin until LOOP-002/003 connect (D14 stage 12).

### B — Model Release Loop (LOOP-002): recalibration → publication gate → CLV/Brier outcome → next calibration

**Effort:** L · **Risk:** high

Close the model factory. Concretely:

**Provenance + identity (schema, db-push-first, owner-gated)**: add `modelVersion` and a `provenance` enum (`live_pregame` | `walkforward_replay`) to `mlb_game_backtest`; fix the unique key so a replay cannot silently `UPDATE` the live row (`drizzle/schema.ts:2114`, plus the `(gameId, market, modelSide)` vs `(gameId, market)` mismatch at `mlbMultiMarketBacktest.ts:930-936` where 0 rows update and `written++` still increments); resolve the `modelProb decimal(5,2)` precision question (`drizzle/schema.ts:2051` documents 0-100, the writer stores 0-1 — a scale-2 column quantizes every probability to 1-pp buckets and corrupts every downstream Brier).

**Gate the self-promoter (F4)**: commit and wire `server/mlbRecalibrationGate.ts` (259 lines, written 2026-07-28, untracked, imported only by its own test). It already encodes the right shape — drift → backtest → `PROPOSED` row in `mlb_model_learning_log.paramChanges` → owner decision → `APPLIED`/`REJECTED`, with zero-tolerance on quarantined rows and an audited `MLB_RECAL_MODE=autopatch` escape hatch. Then write the `decideRecalibration` tRPC procedure the prior program claimed and never wrote, and replace the current path in `server/mlbDriftDetector.ts:623-815`, which `fs.writeFileSync`s `MLBAIModel.py` in place with a `.bak`, no proposal, no approval, no version stamp.

**Make the gate authorize something (U1/F3.2)**: wire `server/mlbPublicationGate.ts` (422 lines, dead since 2026-05-23) into the projections read path so the nine `publish_*` BACKTEST-ONLY verdicts sitting in production actually suppress or relabel. Three of its seven checks read columns production never writes — those must be backfilled or the checks relaxed with a recorded rationale.

**Outcome capture**: wire `server/mlbClosingLineResolver.ts` so CLV stops being permanently NULL; persist log-loss (computed in two modules, written to no column).

**Pros**

- Highest doctrine density: D8's model factory, the §19 data-provenance law, D12-L5/L6, and U1's live trust exposure all move at once.
- The evaluation math already exists and is correct and unit-tested — Brier, log-loss, Wilson CI, no-vig, calcCLV, calcEdge, calcEV, walk-forward fold geometry. This is wiring, not writing.
- Closing-line capture is genuinely shipped (5-minute scheduler, locks DK closing odds at first pitch, once per game, idempotent) — the expensive half of a CLV system is already paid for.
- It is the only option that resolves U1 as a side effect rather than leaving a known trust exposure live.
- It stops the single most dangerous behavior in the repo: an automated model self-patch with no proposal, approval, or version.

**Cons**

- It cannot complete a CREDIBLE live cycle inside this mission. A recalibration's real outcome is a shift in calibration error, and the gate's own floor is n≥30 graded rows per market (the audit's working sample was n=1,528). A three-day procedural cycle would produce exactly the vacuously-passing evaluation the audit condemns at F3.5.
- Requires at least two production schema changes plus a possible column-type change on a populated table — each db-push-first, each owner-gated, each a hard stop under the mission's own constraints.
- Requires production behavior changes on the customer-facing projections path, so it is downstream of DR-001 and of the voice/compliance gate. High probability of sitting blocked on Prez — the exact F2 failure mode this mission exists to kill.
- The current apply step is worse than the audit records. `mlbDriftDetector` resolves `MLBAIModel.py` from `__dirname` while the app is an esbuild bundle at `dist/index.js` and the Dockerfile copies sources to `/app/server/` — so the patch likely fails to find the file, and even if it lands it writes to a container filesystem wiped on every deploy (~13×/day). [INFERRED from `mlbDriftDetector.ts:130`, `Dockerfile:83`, deploy cadence] The apply step must therefore be rebuilt, not just gated.
- The executor does not operate this loop — the app does. No dogfooding pressure, so neglect is silent, which is precisely how the prior slice died.
- No model versioning exists anywhere, so 'did the last recalibration help?' is not merely unanswered but structurally unanswerable until the schema moves.

**Doctrine fit:** Best fit on D8 (second factory), §19 provenance law, and D2's 'action without evaluation' pattern. But it FAILS the D14 stage-2 test on the dimension that matters here: 'evidence-rich' means the evidence must be trustworthy, and this loop's evidence is structurally corrupt (NULL CLV, upserted drift state, a leakage counter that keys on a value production never emits, a suspected precision defect that would corrupt every Brier the moment consumers are wired). It also collides with D14's ordering law: wiring the publication gate and the recalibration apply step is adding AUTHORITY before the observation layer exists to catch it failing. Under D16 it is the option most likely to end the mission with an incomplete cycle.

### C — Bet Grader Wedge Loop (LOOP-003): user grades bets → bettor-side CLV → activation/retention → product iteration

**Effort:** XL · **Risk:** high

Build the stated GTM wedge and close the loop around it. Concretely: an ingest path (CSV/screenshot/manual) into `tracked_bets`; a NEW `server/betClvResolver.ts` implementing bettor-side CLV — price obtained vs closing price, which is a different quantity from the existing `calcCLV` (model-vs-close) and cannot reuse it; `closingOdds` + `clv` columns on `tracked_bets` (schema change, db-push-first); a `tracked_bets` → closing-line join, which today does not exist because closing-line capture is joined to the model path and is MLB-only; a settlement-event row to stop `tracked_bets.result` being destructively overwritten (F5.6, which is why no user-bet history exists); a customer-facing audit surface under `design-system/dime-ai/MASTER.md`; and a compliance-gate review of every string on it.

**Pros**

- Heaviest business weight by far. It attacks the binding constraint STATE §1 names directly: Dime cannot honestly sell decision quality it cannot demonstrate.
- The only candidate whose outcome is a customer outcome (activation, retention) rather than an internal one — the top rung of D7's five-level chain.
- Would create the public track record that today does not exist (every grading surface is behind `RequireOwner`), which is the product's own stated differentiator.
- Its evaluation is genuinely outcome-level and hard to fake — a bettor either beat the close or did not.

**Cons**

- It is a product build, not a loop closure. D14 stage 2 selects a process that RUNS; stages 4-7 (map the open loop, create artifacts until legible, begin with analysis, compare to the DRI's understanding) have literally nothing to observe here.
- Not built, in all three of its defining requirements: no ingest path, no bettor-side CLV, no audit surface. Effort is XL and dominated by product work, not loop work.
- Closing-line coverage is MLB-only, so the wedge would ship materially incomplete or wait on multi-sport capture.
- Its outcome metric needs weeks of paying-user behavior. Zero chance of a completed live cycle with an observed outcome inside this mission.
- Compounds U1 rather than resolving it: shipping a public CLV audit while the platform ignores its own nine BACKTEST-ONLY verdicts increases the trust exposure. It is downstream of DR-001 too.
- Requires schema changes and a new customer-facing UI — the two most gated categories of change in the mission's constraints, simultaneously.

**Doctrine fit:** Best fit on D7 (it is the only option reaching the business/customer-outcome rung) and on D13-Sales/GTM. But it fails D14 stage 2 outright on 'evidence-rich' and 'bounded,' and it inverts D14's whole sequence by starting at stage 11 (build the factory output) before stages 4-10 exist. It is also the strongest candidate for D15 #15, prototype theater: a customer-facing surface shipped before any loop is observing whether it works. Correct as LOOP-003; wrong as LOOP-001.

### D — Release-Health Loop (narrow slice of A): merge → deploy → smoke → recorded production observation → adjustment

**Effort:** S · **Risk:** low

Close only the release segment. `os/loops/LOOP-001-release.md`; extend the existing `deploy-smoke.yml` (already `on: push: [main]`, already waits 240s and runs `scripts/smoke-deploy.mjs` with 3 retries) to append a `result_observation` artifact per deploy to an orphan `os-ledger` branch via `shared/loop/envelope.ts`; add `scripts/deploy-observe.mjs` and a daily sweep that goes red when a merge to main has no recorded smoke verdict. No issue template, no intent gate, no evidence-record validation.

**Pros**

- Smallest possible thing that genuinely closes. Effort S, first live cycle in hours, and dozens of cycles per day for free.
- Zero dependence on any other ruling except DR-003. No schema change, no production code change, no friction on the PR flow at all.
- Closes F7.1 (no cron/deploy job ever writes a run record), F7.2 (`CronJobRunner.lastResult` is process memory wiped ~13×/day), and F7.6 (one merge = two Railway deploys, the second with no domain, no smoke test, no health check).
- Also proves the ledger primitive in production with the least ceremony — a clean, cheap test of DR-003's salvage thesis.

**Cons**

- It observes deploy HEALTH, not whether the work was RIGHT. It covers exactly one rung of D7's five-level chain and skips strategic intention, customer evidence, and business outcome entirely.
- It closes no factory. D14 stage 11 still has nothing to build on, so the mission's next step is unchanged and this becomes a detour rather than a foundation.
- Highest risk of being the loop that closes and teaches nothing — D15 #15, and D5's own warning that generation is the beginning of execution, never proof of success.
- Leaves F1.4 (zero issues, ever) and F2 (nothing ages a blocked queue) completely untouched, and those are the audit's two HIGHEST-priority families.
- A green smoke test is a weak outcome signal: `scripts/smoke-deploy.mjs` asserts five checks against the live origin, none of which would notice a wrong-but-serving change.

**Doctrine fit:** Satisfies D5 mechanically — all seven components present, cycle demonstrably closes. But it is the thinnest possible satisfaction: the Outcome it observes is barely downstream of the Action, which is close to D5's own prohibition ('an action is not an outcome; shipping is an action, adoption is an outcome'). Good on D12-L2 and L6, absent on L1 and L7. It is the correct fallback if Option A's intent gate is judged too much friction, and it is strictly a subset of A — which is why it is better taken as a component than as the answer.

## Recommendation

**A — Engineering Build Loop (LOOP-001)**

It is the only candidate that can complete a real, credible, live cycle inside this mission, and it is the only one whose apply/promote step already exists and already works.

On the decisive test the prompt names — can this loop close end to end, live, including the apply step the prior slice never had — the comparison is not close. A's cycle is intent issue → PR → gates → merge (the apply step, already owner-gated, exercised ~13×/day) → Railway deploy → `deploy-smoke.yml` verdict → 24h evaluation → filed adjustment. Elapsed: about 48 hours, with dozens of concurrent cycles. B's apply step must be rebuilt before it can be gated (the current one writes `MLBAIModel.py` on an ephemeral container filesystem from a path that likely does not resolve under the esbuild bundle), and its outcome needs weeks of graded games to rise above noise — closing it faster would manufacture exactly the vacuously-passing evaluation the audit condemns at F3.5. C has no apply step, no ingest path, no bettor-side CLV formula, and no process to observe; selecting it would mean stages 4 through 7 of D14 operate on a process that does not run. D closes, but observes only that the server came up.

On D14's ordering law — visibility before autonomy, evaluation before scale — A is the only option that adds observation while adding zero authority. B adds authority (wiring the publication gate to suppress markets, wiring an apply step for model constants) to a system that currently has no way to catch it failing. That is the inversion doctrine explicitly forbids, and it is a 2026-07-28 repeat at higher stakes.

On cost of failure, A is the cheapest wrong answer available. Five `.mjs` scripts, three workflows, one issue template, one orphan branch. No schema change, no production behavior change, no new service, no vendor, no `drizzle/` touch. If it turns out wrong it is deleted in an afternoon. B costs two owner-gated schema migrations and a customer-facing behavior change before anyone learns whether the loop shape was right.

On the reflexive argument, A is the loop that produces the other loops. The mission's own binding failure is not that Dime lacks a model loop or a wedge — it is that Dime built a complete closed-loop slice, with 32 adversarial tests and a tamper-evident ledger, and eight days of silence produced no signal anywhere. LOOP-002 and LOOP-003 built before LOOP-001 become more dark state. Built inside LOOP-001 they cannot: their intent is an issue, their construction is a PR carrying a validated evidence record, their merge is an `approval_decision` artifact, and their unevaluated outcome turns a daily workflow red until someone answers for it.

The honest cost is that A produces nothing a customer can see, and U1 stays live while it is built. That is why the first graft below is not optional — it is the condition under which A is the right answer.

**Grafted from the runners-up**

- **From B, and mandatory:** the first intent issue driven through LOOP-001 is the U1 publication-gate decision (DR-001), not a meta-task. The loop's proving run then produces real customer-facing value, U1 gets resolved *inside* an observed process rather than beside one, and A stops being pure meta-work. This also de-risks B: LOOP-002 gets constructed under observation instead of becoming the next untracked program.
- **From B:** adopt `server/mlbRecalibrationGate.ts`'s propose→decide→apply shape as the canonical template for LOOP-001's authority rung. It already encodes the right law — an agent may propose changes to its own model but never silently promote them — with a distinct proposer identity (`RECAL_PROPOSER = 'drift-detector-agent'`) that a human approver cannot collide with, and an audited emergency override. That is the rung-2/rung-3 boundary written in TypeScript; reuse the pattern rather than inventing one in `os/agents/AUTHORITY.md`.
- **From D, fully absorbed:** the per-deploy `result_observation` written from the existing `deploy-smoke.yml` becomes A's outcome sensor. It is the cheapest signal available, it requires no new workflow, and it closes F7.1/F7.2/F7.6 as a side effect. D is not a rival option so much as A's outcome half; take it whole.
- **From D:** the daily red-workflow escalation pattern (a scheduled job that exits non-zero when something is stale) is the mechanism for F2 generally. Reuse it verbatim for the owner-gated queue, not just for unevaluated merges — one script, `scripts/loop-outcome-sweep.mjs`, with a second staleness class.
- **From PR #362's ROLLOUT doc:** run `13-loop-intent` in WARNING mode for one week with published per-day counts before flipping it fail-closed. #362 already established this wave pattern and already used it to graduate `format-check` from advisory to green; reuse the pattern rather than inventing a rollout.
- **From C, deferred not discarded:** record the Bet Grader as LOOP-003 in `os/loops/`, explicitly `deferred` with its reason (D12-L4: a seat or loop without a process to serve is deferred, and the deferral is recorded). Its first intent issue is written now and left open, so the wedge stops being an unwritten intention.

## Requested ruling

**The question:** Do you designate the **Engineering Build Loop** as Dime's first closed loop (LOOP-001) — change intent (GitHub issue) → PR → binding gates → merge-to-main as the owner-gated apply step → Railway deploy + smoke as the observed outcome → filed evaluation and adjustment — with the U1 publication-gate decision as its first live cycle?

**A yes commits you to six things:**

1. **GitHub Issues become mandatory for substantive code PRs.** `13-loop-intent` blocks any PR touching `server/**`, `client/**`, `shared/**`, or `drizzle/**` without a linked intent issue or an explicit `loop-exempt` label. At ~13 PRs/day this is friction you personally pay on every change. It runs WARNING-only for one week first, then goes fail-closed — and the point of the gate is that you do not label-exempt around it.

2. **The §21.3 evidence record becomes machine-validated and required**, not conventional. A PR body with a malformed or missing YAML block, or a non-terminal `outcome`, fails CI.

3. **`shared/loop/` and `server/loop/` get committed to git** (this is DR-003's scope — LOOP-001 cannot ship without it), and the working-tree typecheck break at `server/_core/aiCostMeter.ts:20` gets fixed in that same commit.

4. **An orphan branch `os-ledger` is created** as the durable artifact store, written by a bot on merge and on deploy. Never `main` — a bot commit to `main` is a production deploy.

5. **A daily outcome-sweep workflow goes RED and notifies you** whenever a merged change sits unevaluated for more than 72 hours. It is deliberately noisy. Disabling it is the single action that kills this loop, and it is the exact action that killed the 2026-07-28 program.

6. **You are DRI of LOOP-001** and personally answer its nine-question D5 interrogation at first recertification.

**A yes explicitly does NOT commit you to:** any schema change · any production behavior change · merging PR #362 or changing the ruleset's three required checks (`Security Audit`, `TypeScript Check`, `Vitest`) · any model, publication, or pricing decision · building the Bet Grader.

**If you rule no on the intent gate specifically but yes on the loop**, say so — the fallback is Option D (release-health only, effort S, zero PR friction), and I will re-scope rather than ship a gate you will route around.

## Depends on

- DR-003 — HARD BLOCKER. LOOP-001 is built on `shared/loop/envelope.ts` + `ledger.ts`, which are untracked. Nothing in this record can ship until pushing `local/audit-mlb-model-2026` and committing the AI-native program is authorized. The commit must also fix `server/_core/aiCostMeter.ts:20` (imports `aiWorkflowCosts`, absent from `drizzle/dime.schema`; `tsc --noEmit` exits 1), or CI rejects it.
- DR-001 — SOFT DEPENDENCY on the recommended first cycle, not on the loop itself. LOOP-001 can be built and proven on any intent issue; the graft that makes it non-meta requires the U1 posture ruling (suppress / relabel / publish-with-record) to be the thing it carries.
- DR-004 — CONTRADICTS-AND-ANSWERS. LOOP-001 deliberately substitutes GitHub Actions + JSONL files + an orphan branch for the named orchestration spine (Temporal / Pydantic AI / Mastra / OPA / LiteLLM), none of which exist in this repo. If DR-004 rules to adopt a durable-execution engine, `scripts/loop-ledger-append.mjs` and `scripts/loop-outcome-sweep.mjs` are re-hosted onto it; the artifact contract itself is engine-independent and survives either ruling.
- DR-00n (AUTHORITY LADDER) — FORWARD DEPENDENCY. LOOP-001 asserts that merge-to-main is a rung-3 action (high-impact, hard-to-reverse, human-gated) and that the loop's automation sits at rung 1-2 (read, record, escalate — never merge). `os/agents/AUTHORITY.md` must codify that, and should reuse `mlbRecalibrationGate.ts`'s propose/decide/apply shape.
- DR-00n (PR #362 DISPOSITION) — SEQUENCING. #362 owns workflow numbers 01-12; LOOP-001 claims 13-15. #362 supplies D8 parts 2/5/7 (executable tests, repeated evaluation, acceptance criteria) and LOOP-001 supplies parts 1/9/10 (specification, durable artifacts, reusable memory). They compose, but the merge order and the ruleset-graduation waves need one ruling.
- LOOP-002 (Model Release) and LOOP-003 (Bet Grader) are DOWNSTREAM of this record, not alternatives to it. Both get recorded in `os/loops/` as `deferred` with reasons at the time LOOP-001 is designated.

## Open unknowns

- Whether Prez will actually tolerate a fail-closed intent gate at ~13 PRs/day, or will route around it with `loop-exempt`. This is the loop's real survival risk and it is behavioral, not technical. RESOLVED BY: one week of `13-loop-intent` in WARNING mode publishing a daily count of would-have-blocked PRs; if the exempt rate exceeds ~20%, the gate is wrong and Option D is the correct fallback.
- Whether `GITHUB_TOKEN` can push to an orphan `os-ledger` branch under the current protection. The `main-protection` ruleset reads as targeting `main` only, with required checks `Security Audit` / `TypeScript Check` / `Vitest` — so an orphan branch should be unprotected. RESOLVED BY: one dry-run push to a throwaway branch before building on the assumption. [INFERRED from `gh api .../rulesets/18701573`]
- How `server/_core/aiCostMeter.ts:20` should be fixed — add `aiWorkflowCosts` to `drizzle/dime.schema` (a schema addition, db-push-first, owner-gated) or delete the import and stub the meter. The audit records this as collateral damage from the Incident-43 column revert. RESOLVED BY: reading the Incident-43 revert diff and deciding inside DR-003's commit. This blocks every path in this record.
- Whether a meaningful post-deploy outcome can be automated for UI-only and refactor PRs, or whether those cycles degrade to self-attested evaluation. If most cycles self-attest, the loop satisfies D5 only formally. RESOLVED BY: classifying the last 50 merged PRs by whether their stated acceptance criteria are machine-checkable, before writing `scripts/loop-outcome-sweep.mjs`.
- Whether the `modelProb decimal(5,2)` defect is real in production (`drizzle/schema.ts:2051` documents 0-100; `mlbMultiMarketBacktest.ts:889` writes 0-1). It does not bite today only because consumers are unwired — but it bites the instant LOOP-002 is built on that table. RESOLVED BY: one read-only production `SELECT DISTINCT modelProb FROM mlb_game_backtest LIMIT 50`. Carry this into DR for LOOP-002; it is a precondition, not a detail.
- Whether `mlbDriftDetector`'s self-patch currently succeeds at all. `MODEL_PY = path.resolve(__dirname, 'MLBAIModel.py')` while the app runs as an esbuild bundle at `dist/index.js` and the Dockerfile does `COPY . .` (sources land at `/app/server/`). Either it silently fails to find the file, or it writes to a container filesystem wiped on every deploy. Both are worse than the audit records, and both change how urgent F4 is. RESOLVED BY: one Railway log read for the `[Drift]` `Cannot read MLBAIModel.py` line, or one `docker run` against the built image. [INFERRED — not confirmed]
- GitHub Actions minutes consumed by the daily sweep plus the per-merge ledger append, against the current cost posture. Almost certainly trivial, but Dime measures no AI or CI spend anywhere, so 'almost certainly' is the honest label. RESOLVED BY: reading the Actions billing page after one week.
- Whether PR #362's ruleset graduation (adding checks 01-12 to required) should precede or follow LOOP-001. If #362's checks become required first, LOOP-001's `13-15` inherit a well-tested rollout path; if LOOP-001 goes first, it proves the loop on today's three required checks. Not blocking, but the sequence should be ruled once rather than drifted into.

