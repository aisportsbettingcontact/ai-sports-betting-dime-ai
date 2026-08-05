# DR-013 — The eight-function-loop rollout order and cross-links

**Status:** AWAITING RULING · **DRI:** Prez · **Raised:** 2026-08-05 (Stage 2)
**observe_by:** 2026-08-12
**Doctrine:** §13 Function loops (D13) — all eight, connected not isolated · §16 Peak state (D16) — criterion 4: all eight loops operating and interconnected · §17 Certification and cadence — PARTIAL and MISSING are failing grades that route back · §14 The fifteen-stage sequence (D14) — visibility before autonomy, stage 12 'connect the function to other functions' · §5 The closed loop (D5) — the seven components, goals with limits, the nine-question interrogation · §6 The queryable company (D6) — artifact law, semantic connections, traceability intention-to-result · §8 L1 Goals + ownership — the nine-field goal record · §8 L2 Artifact system — durable, linked, append-only · §8 L6 Evaluation — outcome-level judgment, activity is not progress · §8 L8 Human governance — named humans on every important outcome · §11 Token-maxing economics (D10) — the capital-allocation hire-test · §15 Failure modes (D15) — #2 open-loop automation, #3 unqueryable work, #9 generated output mistaken for completion, #15 prototype theater, #16 isolated agent departments · §19 Standing Dime rules — compliance gate, evidence taxonomy, deploy law

> **Read `DR-014` first.** The coherence, doctrine, and survival critics reviewed all ten
> Stage 2 records together and issued consolidation rulings that override parts of this one.
> Where DR-014 and this record disagree, DR-014 governs.

---

## The question

In what order do Dime's eight function loops come alive, what is each loop's outcome / DRI / first artifact / evaluation / proving cross-link, and what is the honest certification verdict for the loops that cannot reach a completed live cycle inside this mission?

## Why this is contested

Three real tensions, none with an obvious default.

(1) D14 says visibility before autonomy, which argues for machinery-first (operations, engineering). D16's hardest criterion is that all eight loops are interconnected with cross-links DEMONSTRATED, and cross-links built last are the ones that end up asserted — which is exactly the 2026-07-28 failure mode. Sequential-by-function and paired-by-cross-link give genuinely different answers.

(2) Four of the eight loops depend on events Dime does not control. Support has no readable inbound channel at all: server/discord/bot.ts:172 constructs the client with GatewayIntentBits.Guilds only and registers no commands, so it is structurally write-only. Sales has no prospect before payment (no free tier, VERIFIED), so there is no pipeline to instrument — only checkout_sessions rows. Revenue needs a real Stripe event to land in-window. Hiring has zero instances by design and one human. Any order that puts these early stalls; any order that puts them last certifies them unexercised.

(3) The honest-certification question is itself contested. The tempting move is to redefine "live cycle" until all eight pass, or to manufacture traffic (Prez files his own support ticket, buys his own subscription). Both are the vacuous-pass pattern the audit already found twice — F3.5's leakage counter keyed on a value production never emits, and F6.3's test that reports green with zero assertions. Choosing to accept a PARTIAL on a D16 criterion is a real cost and a real founder decision.

## Options

### Sequential by function, strict D14 order

**Effort:** L · **Risk:** medium

Activate one loop at a time in the textbook D14 order — Operations → Engineering → Founder → Revenue → Product → Support → Sales/GTM → Hiring — driving each through D14 stages 1–12 (including its cross-links) before the next begins.

Concretely: one `os/loops/LOOP-<NAME>.md` per loop carrying the nine D5 interrogation answers plus `cadence`, `dri`, `crosslink_out`, `crosslink_in`, `last_artifact`; a `scripts/os/loop-check.mjs` CI job that fails a PR when any LOOP file is missing a required field or declares `status: live` with no artifact reference; a scheduled `.github/workflows/os-observer.yml` that appends run facts to an orphan `os-ledger` branch and opens a `loop:<name>` issue when a live loop's last artifact is older than its declared cadence. Loops 5–8 begin only after loops 1–4 are certified.

**Pros**

- Literal D14 compliance — the sequence doctrine names is the sequence executed, easiest to defend at certification
- Smallest concurrent surface for one human: exactly one loop in flight, so nothing half-built is forgotten
- Each loop gets a full Stage 5→11 treatment (artifacts → context → analysis → recommendation → evaluation → controlled action) instead of being rushed to 'connected'
- Failure is contained — a stuck loop stops the line loudly instead of leaving four half-loops

**Cons**

- Cross-links land last, per loop and across the program — precisely when calendar runs out. D16's criterion 4 is the one most likely to be asserted rather than demonstrated
- Support and Sales sit at positions 6 and 7, and they have the slowest triggers (a real customer contact, a real conversion). They get the least calendar time and need the most
- Serializes work that has no dependency: the revenue reader over payment_events and the ops cadence check share nothing and could run concurrently
- A loop 'finished' before its partner exists has no one to hand evidence to, so its cross-link is written speculatively against a target that does not yet exist

**Doctrine fit:** Strong on D14 (§14 order is law) and D5 per-loop completeness. Weak on D16 criterion 4 and D13's 'connected, not isolated' — deferring every cross-link to each loop's final stage is structurally the pattern D15 #16 (isolated agent departments) warns about, arriving one loop at a time.

### Paired activation — no loop ships alone (four pairs, a ring, and a gate) ✅ **RECOMMENDED**

**Effort:** L · **Risk:** medium

Loops activate in linked pairs. The cross-link is not a later stage; it is the pair's acceptance test. Pair order still obeys D14 — the visibility pair goes first.

WAVE 0 (substrate, not a loop). `os/loops/LOOP-<NAME>.md` × 8 with the nine D5 answers + `cadence`/`dri`/`crosslink_out`/`crosslink_in`/`last_artifact`. `scripts/os/loop-check.mjs` as a REQUIRED PR check: fails when a LOOP file misses a field, when a declared cross-link names a loop that does not exist, or when `status: live` carries no artifact reference. `.github/workflows/os-observer.yml`, hourly, single writer, appends to orphan branch `os-ledger` (`runs/YYYY-MM.jsonl`) and opens/updates one issue per stale loop labeled `loop:<name>` + `os-silence`. `gh label create loop:ops loop:eng loop:product loop:support loop:revenue loop:gtm loop:hiring loop:founder os-silence` — the label set is currently the untouched GitHub default and zero issues have ever been opened, so the issue tracker is free capacity, not new infrastructure. Pushes to `os-ledger` are durable and do not deploy (Railway watches `main`).

W1 OPERATIONS ⇄ ENGINEERING (visibility pair).
• OPS outcome: every scheduled job's observed cadence and terminal result are recorded within one interval, and any job missing ≥2 consecutive intervals becomes a GitHub issue within 60 minutes. LIMIT: misses are never reduced by relaxing declared cadence — a cadence change must edit the LOOP file in the same PR. DRI Prez. First artifact: `os-ledger:runs/YYYY-MM.jsonl` built by the observer from `gh run list --workflow cron-*.yml --json databaseId,conclusion,createdAt` — zero edits to the six existing `cron-*.yml`, zero schema change, zero deploy. Evaluation: `scripts/os/cadence-check.mjs` compares each workflow's declared cron expression to observed p50/p95 inter-arrival. Its guaranteed first finding is F7.3 — `cron-mlb-cycle.yml` declares `*/5` and fires 8–10×/day — so cycle one is real on day one. GRADUATION (owner-gated, db-push-first): a `job_runs` table, because `gh run list` proves the endpoint accepted the trigger, not that `runMlbCycleOnce()` succeeded (F7.1).
• ENG outcome: every issue opened by another loop reaches a filed adjustment — merged PR, or wontfix with VERIFIED evidence — and the originating check is observed GREEN afterward. LIMIT: throughput is not the measure; an adjustment that closes an issue without changing observed behavior is a failure. DRI Prez. First artifact: the PR closing the first ops issue, plus PR #362's `proof-contract.json` reused as the per-PR evidence artifact — built, not to be rebuilt. Evaluation: `loop:*` issue age p50/p95, reopen rate, and post-fix observer verdict.
• CROSS-LINK DEMONSTRATED: `gh issue list --label loop:ops --state closed` shows ≥1 issue opened by the observer and closed by a merged PR, with the triggering run-record artifact id in the issue body. Not assertable — the artifact ids either resolve or they do not.

W2 REVENUE ⇄ PRODUCT (money-explains-itself pair).
• REVENUE outcome: every change in active entitlements and MRR is attributed to a named customer, event, and product surface; unexplained deltas = 0. LIMIT: never publish a number without its explanation (D13 Revenue). First artifact: `os/ledger/revenue/YYYY-MM.md` from a read-only owner query joining `payment_events` + `subscription_events` + `entitlement_events` + `checkout_sessions` — the FIRST readers those three ledgers have ever had (F8.6, three append-only ledgers, zero readers). Evaluation: unexplained-delta count must be 0; ANTI-VACUITY GUARD — a period containing zero Stripe events must report `state: not_exercised`, never PASS (the F3.5 lesson, encoded).
• PRODUCT outcome: every shipped surface change names the customer-evidence artifact that justified it, and post-release the original problem is verified solved or the change reverts. First artifact: `os/goals/GR-0001-*.md` — the goal record type that does not exist anywhere today (F9) — instantiated for one real problem drawn from the revenue or support ledger.
• CROSS-LINK: each churn/expiry record carries the last product surface the account touched (`analytics_events`); the product goal record cites that revenue artifact id, and `loop-check.mjs` fails if it cites an id the ledger cannot resolve.

W3 SUPPORT ⇄ ENGINEERING (failure-flows-back pair). The Discord blocker and its cheap fix: do NOT request the privileged MessageContent intent — it needs Discord-portal approval, opens a permanent read scope over customer conversation, and creates a PII surface for a one-person company. Instead register ONE guild slash command `/dime-issue <description>` through the application-commands API; interaction payloads deliver the customer's text with no privileged intent, scoped to exactly what they chose to submit. ~60 lines in `server/discord/bot.ts` plus an interactions route. SECOND INPUT, ZERO DISCORD WORK: the compliance gate's withheld answers. The post-generation certainty screen withholds the entire answer, and those blocks are logged per-request with no aggregation surface (F3.7). Every withheld answer is a paying customer who asked and got nothing — the purest support-failure signal Dime already generates. Outcome: every observed customer failure is resolved WITH THE RESOLUTION OBSERVED, never administratively closed. First artifact: `os/ledger/support/YYYY-MM.jsonl`, one record per failure with `source: discord_command | withheld_answer | client_error`. Evaluation: recurrence rate by class, time-to-observed-resolution, and % closed without observation which must be 0. CROSS-LINK: a class reaching 3 occurrences auto-opens a `loop:eng` issue carrying the aggregate.

W4 SALES/GTM ⇄ PRODUCT + MODEL (the claim gate — this is the D16 'model outcomes into GTM proof' link made executable). Shaped by reality: no free tier and no prospect before payment, so there is no pipeline; the only pre-payment artifacts are `checkout_sessions` rows. Outcome has two halves — (a) CLAIM INTEGRITY: no marketing surface states a price or a model claim that live Stripe prices and Dime's own evidence do not support; (b) DEMAND: every checkout that does not complete produces a recorded reason class. First artifact: `scripts/os/check-claim-parity.mjs` as a REQUIRED status check (F6.1's lesson: an advisory gate is not a gate), reading `os/ledger/gtm/publish-verdicts.json` snapshotted by the observer so CI never needs production DB access. It fails on the four contradictions that ship today: `landing-content.ts:297` charges $49.99 while `:398` sells '≈ $3.30 a day' (= $99) and `:13`/`:237` still name an 'Operator' tier that no longer exists, while `landingPrerender.ts:350` serves Google offers of $99/$249/$499 and `:351`'s FAQ repeats them — and, the model half, `landing-content.ts:422` advertises HR props as live when the forensic audit found HR props at NEGATIVE skill vs base rate, and `landingPrerender.ts:351` tells Google 'Outputs are Brier-scored against closing prices' when CLV is permanently NULL and 11 of 16 markets get no Brier at all. Rule enforced: a market may not be named in marketing copy while its `publish_*` verdict is BACKTEST-ONLY, and a model-capability claim requires a resolvable live evaluation artifact. CROSS-LINK: model evaluation → GTM copy, enforced in CI, plus loss-reason classes → product.

W5 FOUNDER (the ring). Outcome: Prez answers the four D4 questions from GENERATED state, and each cycle the brief names ≥1 contradiction or explains why there is none. LIMIT: no summaries-of-summaries — every line cites an artifact id or says `not_measured`. First artifact: `os/BRIEF.md` from `scripts/os/brief.mjs`, eight sections, each `{state, value, reason}`, reusing the honest `not_measured`/`incomplete`/`stale` vocabulary the prior program already designed. Three concrete contradiction detectors: (1) declared priority in `os/goals/GR-*.md` vs. the `loop:*` label distribution of merged PRs in the period; (2) any LOOP file saying `status: live` whose last artifact predates its declared cadence; (3) any `os/decisions/DR-*.md` in AWAITING RULING past its decide-by date — the direct mechanical fix for the failure that killed 2026-07-28, where owner-gated was treated as a terminal state and eight days of silence produced no signal. Evaluation: CI regenerates the brief and byte-compares it to the committed copy — a hand-edited brief fails the build, which is what stops it decaying into `operating-brief.md` (F2.2: declares itself 'regenerable', no generator exists).

W6 HIRING (armed gate, one real exercise). `os/loops/LOOP-HIRING.md` with `status: armed`, `instances: 0`, and a trigger contract: its only legal input is a `capability-gap` record emitted when the ops loop sees the same manual step in ≥3 cycles. Then exercise it once for real against a gap that exists today — who owns model-calibration acceptance, currently nobody, since `mlbPublicationGate` computes SAFE_TO_PUBLISH and authorizes nothing (F3.2). Produces `os/hiring/HT-0001-model-calibration-owner.md` with the six §11 hire-test fields and its ruling (expected NO-HIRE, absorbed by a chartered calibration-auditor seat plus making the publication gate binding), plus a DATED prediction that becomes the observable outcome.

ANTI-FRAUD RULE, binding on all eight: owner-generated traffic is labeled `synthetic` in the ledger and is excluded from certification. Prez may not file his own `/dime-issue` or buy his own subscription to 'exercise' a loop.

**Pros**

- The cross-link is the acceptance test, so D16 criterion 4 is demonstrated by construction and cannot be quietly downgraded to an assertion
- Every pair's first cycle is guaranteed real, not manufactured: W1 has a known live cadence defect (F7.3), W2 has three ledgers with zero readers, W4 has four contradicting price surfaces plus two false model claims shipping right now
- Adds no service, no daemon, no vendor. The moving parts are markdown files, three node scripts, one scheduled workflow, an orphan git branch, and GitHub Issues — a tracker that already exists and has never been used once
- Neglect is loud by construction and self-referential: the observer opens issues about stale loops, and the founder brief flags stale DRs, so the specific failure that killed the 2026-07-28 program has a mechanism aimed at it
- Reuses the best existing assets instead of rebuilding: shared/loop/envelope.ts + ledger.ts as the artifact contract, PR #362's proof-contract.json as engineering's per-PR evidence, checkoutReconcile's existing sweep as the sales signal
- Retires U1's marketing half and all of U2 as a side effect of the W4 cross-link, in CI, without touching production data

**Cons**

- Two loops in flight per wave for one human; a stuck partner blocks its pair, and W3's Discord half can stall on a Discord-portal or OAuth-scope issue outside Prez's control
- W0's substrate must land before any loop, and it is the least visibly valuable work in the program — the exact shape of thing that gets skipped under time pressure
- Requires editing .github/ and adding a required status check, which means merging to main, which under deploy law IS a production deploy (of byte-identical application code, but a deploy nonetheless)
- Depends on the orphan-branch assumption: if Railway's deploy trigger is not branch-scoped to main, every ledger push deploys production. Must be verified read-only before W0 ships
- Still leaves Support, Sales-demand, Revenue-exercise and Hiring-outcome dependent on external events, so it does not by itself make criterion 4 pass

**Doctrine fit:** Best available fit. D14 preserved — the visibility pair is first and no autonomy is proposed anywhere (every loop's action is 'open an issue' or 'fail a check'). D16 criterion 4 addressed head-on. D13's 'connected, not isolated' is the acceptance criterion rather than a closing remark. D5 satisfied per loop including the LIMIT clause each goal carries. D6 satisfied — every loop's first artifact is durable and linkable. D15 #2, #3, #9 and #15 each get a named mechanism. Its one honest doctrinal debt is that it will still report PARTIAL on criterion 4 at first certification.

### Customer-truth first — money and claims before machinery

**Effort:** M · **Risk:** high

Order by live customer exposure rather than by observability: Revenue → Sales/GTM → Product → Support → Engineering → Operations → Founder → Hiring.

Rationale is STATE §1's binding constraint — Dime cannot honestly sell decision quality it cannot demonstrate — plus U1 and U2 being live trust exposures rather than architecture defects. Week one ships the revenue reader over payment_events/subscription_events/entitlement_events and `scripts/os/check-claim-parity.mjs`, retiring U2 and U1's marketing half immediately. Operations and the observer come sixth, after the customer-facing surfaces are honest.

**Pros**

- Fastest reduction of the only two findings that are trust and compliance exposures rather than internal defects
- Revenue is genuinely the cheapest closed loop in the company — three fully-written append-only ledgers with zero readers; the work is a query, not a system
- Puts the founder in direct contact with customer reality early, which is D11's conviction requirement operating rather than described
- The claim-parity check is a pure CI artifact with no production dependency, so it can ship before any substrate exists

**Cons**

- Inverts D14 explicitly. It builds evaluation surfaces on top of a substrate that still cannot observe whether anything ran — every revenue and claim artifact produced before the observer exists is a candidate for becoming more dark state, which is exactly how 2026-07-28 died
- Both lead loops depend on events Dime does not control. If no Stripe event lands in week one, the program opens with an unexercised loop and no visibility machinery to notice
- Leaves cron cadence fiction (F7.3) and the absent job-run record (F7.1) running underneath every other loop for six waves
- Support at position four still has no readable channel, so the Discord fix gets scheduled before the engineering loop that would route its findings

**Doctrine fit:** Good on D13 Revenue and on §19's compliance gate — it fixes customer-facing dishonesty first. Directly contradicts D14 ('visibility before autonomy, evaluation before scale') and the gap map's explicit sequencing implication that F1+F2 must precede everything. Repeats D15 #3 by generating consequential artifacts before anything can query them.

### Founder-brief-first — one generator, eight sections, order emerges

**Effort:** M · **Risk:** medium

Build only `scripts/os/brief.mjs` → `os/BRIEF.md` first. Eight sections, one per function loop, each printing `{state, value, reason}` and defaulting to `not_measured` with the specific reason it is not measured. A loop is 'activated' by whatever work makes its section stop saying `not_measured`; the rollout order emerges from which section is cheapest to turn on, and the brief itself is the certification scorecard's data source. CI regenerates and byte-compares so it can never be hand-edited.

**Pros**

- One moving part for a one-founder company — the smallest possible surface that can rot
- Neglect is loud from day one across all eight functions simultaneously, before any loop exists, because every unwired section says not_measured out loud
- Makes the certification verdict self-computing rather than argued, which removes the temptation to redefine 'live cycle' at scoring time
- Reuses the prior program's honest {state, value, reason} vocabulary, which is already designed and was one of the audit's named reusable assets
- Cheapest possible answer to D16's 'organizational state stays current because it updates continuously' and to STATE.md's own v1 honesty note

**Cons**

- A brief is a VIEW, not a loop. It has no Action and no Adjustment component, so shipped alone it instantiates D2's 'context without action → a searchable archive' — the exact pattern that made todo.md 4,550 lines long
- Ordering by cheapest-to-wire is not ordering by D14. It would likely activate product-usage analytics (already closed) before operations (the thing that makes everything else observable), because the former is a one-line query
- High risk of the brief becoming the deliverable: a beautiful generated dashboard over eight sections that all still say not_measured is a Level-2 artifact wearing Level-4 clothes
- Cross-links are invisible in a sectioned brief — it shows eight columns of state, which is precisely the isolated presentation D16 criterion 4 rejects

**Doctrine fit:** Excellent on D4 (the four questions answered from derived state), D6 (queryable), and D13 Founder ('derived from underlying artifacts, never summaries-of-summaries'). Fails D5 as a standalone — it produces no Action, Outcome, or Adjustment. Fails D16 criterion 4 outright by presenting loops as independent sections. Its true role is as a component of another option, not as the rollout strategy.

## Recommendation

**Paired activation — no loop ships alone (four pairs, a ring, and a gate)**

It is the only option whose structure makes D16's hardest criterion falsifiable. Criterion 4 is not 'eight loops exist', it is 'eight loops operating and INTERCONNECTED, with cross-links DEMONSTRATED, NOT ASSERTED'. Under paired activation a pair cannot be declared live until an artifact id produced by loop A resolves inside a decision made by loop B, and `scripts/os/loop-check.mjs` fails the PR when it does not. That is a mechanical proof, not a narrative one.

It beats Sequential-by-function because sequential defers every cross-link to each loop's final stage and the whole program's cross-links to its final weeks. The audit's central finding is that Dime produces excellent work and never observes its outcome; a plan that schedules the observing last reproduces that shape at program scale. Sequential also puts Support and Sales — the two loops with the slowest external triggers — at positions six and seven, guaranteeing they are unexercised at certification for a reason that is scheduling, not reality.

It beats Customer-truth-first on D14, which is law and is the specific law the 2026-07-28 program broke. Customer-truth-first is genuinely tempting because U1 and U2 are live exposures and the revenue reader is a day of work. Paired activation captures most of that value anyway — the graft below pulls the claim-parity check forward — while still shipping the observer first, so nothing built afterward can go dark unnoticed.

It beats Founder-brief-first because a brief has no Action and no Adjustment. Shipped alone it is D2's 'context without action'. Its real value is as the founder loop's artifact and as the program's honesty instrument, which is exactly how the recommendation absorbs it.

The deciding practical fact: paired activation adds no service, no daemon, and no vendor. Its entire substrate is eight markdown files, three node scripts, one scheduled workflow, an orphan git branch, and a GitHub issue tracker that has existed for the whole life of the company and has never had a single issue opened in it. Against 366 PRs in 28 days, that tracker is the largest piece of unused, zero-maintenance, already-paid-for infrastructure Dime owns, and it is natively queryable by every agent in the harness via `gh`.

**Grafted from the runners-up**

- From Founder-brief-first: adopt `scripts/os/brief.mjs` → `os/BRIEF.md` with the eight-section `{state, value, reason}` / `not_measured` vocabulary WHOLESALE as the founder loop's artifact — and additionally publish it at Wave 0, before any loop is live, so all eight sections read `not_measured` from day one. That gives paired activation the day-one loudness that was Founder-brief-first's real advantage, without letting a view masquerade as a loop. Keep its CI byte-compare rule: a hand-edited brief fails the build.
- From Founder-brief-first: make the brief the certification scorecard's data source, so the D16 verdict is computed from resolvable artifact ids rather than argued in prose at scoring time.
- From Customer-truth-first: pull `scripts/os/check-claim-parity.mjs` forward from W4 into W1, running alongside the ops/eng pair. Justification for the exception to strict pairing — it is a pure CI check with no production dependency and no external trigger, it retires all of U2 and U1's marketing half, and its model-claim half (HR props advertised live at `landing-content.ts:422` despite negative skill vs base rate; 'Brier-scored against closing prices' served to Google at `landingPrerender.ts:351` while CLV is NULL) is the single most valuable cross-link in the whole program. It becomes GTM's first artifact early and GTM's loop formally opens at W4 as planned.
- From Sequential-by-function: keep its discipline that a pair is not declared live until BOTH members have passed loop-check, so paired activation does not degrade into four half-loops in flight at once.

## Requested ruling

RULING REQUESTED — one question:

**Do you approve the paired rollout order (W0 substrate → W1 Operations⇄Engineering + the claim-parity check → W2 Revenue⇄Product → W3 Support⇄Engineering → W4 Sales/GTM⇄Product+Model → W5 Founder → W6 Hiring), including the honest certification verdict that D16 criterion 4 will score PARTIAL at first certification?**

A YES commits you to six things:

1. **A PARTIAL on a certification criterion, on the record.** At first certification, five loops or loop-halves will have a completed live cycle with an observed outcome and a filed adjustment — Operations, Engineering, Founder, Sales/GTM (claim-integrity half), and Support (withheld-answer half). Four will be below that: Revenue LIVE-BUT-CONDITIONALLY-EXERCISED (needs ≥1 real Stripe event in-window), Product ONE-CYCLE-IN-FLIGHT (needs a release plus an observation window that may not close), Support-Discord and Sales-demand ARMED-ZERO-INSTANCES, Hiring ONE-EXERCISE-OUTCOME-WINDOW-OPEN. Under DOCTRINE §17 that is a failing grade on criterion 4 and it routes back through the cycle. You are approving that we say so rather than redefine the bar.

2. **The anti-fraud rule, which costs you the easy fix.** No loop is certified on synthetic traffic. You may not file your own `/dime-issue`, and you may not purchase your own subscription, to exercise Support or Revenue. Owner-generated events are labeled `synthetic` in the ledger and excluded. This is the rule that makes the PARTIAL unavoidable, and it is the point of the rule.

3. **A scheduled route-back, mechanically raised.** A second certification pass fires on the first of: the product observation window closing, the first real Stripe event after the revenue reader ships, or the first real `/dime-issue` submission. The founder brief's stale-loop detector raises it. You are committing to not needing to remember it.

4. **One Discord change and its scope.** Registering a single guild slash command `/dime-issue` — and explicitly NOT requesting the MessageContent privileged intent. Support reads only what a customer deliberately submits through that command. If you want the broader read scope instead, say so now; it changes the PII posture and needs Discord-portal approval.

5. **One required status check and one production deploy of unchanged code.** `check-claim-parity` becomes REQUIRED on `main` (advisory gates are not gates — F6.1). Landing it means merging to `main`, which under deploy law is a production deploy, of byte-identical application code plus workflow/config files. It will initially fail red against the four price contradictions and the two false model claims currently shipping, and stays red until DR-001 and DR-002 are ruled and the copy is corrected.

6. **Prez as DRI of record for all eight loops**, per DOCTRINE §10, until the hiring loop justifies otherwise — including LOOP-HIRING's one real exercise on the model-calibration-ownership gap, whose expected ruling is NO-HIRE.

If you would rather trade honesty for a cleaner scorecard, the fastest alternative is Sequential-by-function with a redefined 'live cycle' — say so explicitly and I will record the redefinition as an amendment to DOCTRINE §17 rather than apply it silently.

## Depends on

- DR-001
- DR-002
- DR-003
- DR-004
- DR-005

## Open unknowns

- Whether Railway's deploy trigger is branch-scoped to `main` only. The entire W0 substrate rests on the orphan `os-ledger` branch being writable without deploying. CLAUDE.md and references/railway-deploy.md both state Railway auto-deploys on push to main, but neither is the service configuration. If either service has no branch filter, every hourly ledger push becomes a production deploy — a severe hazard. RESOLVES VIA: one read-only `get-service-config` on both Railway services (dime-ai and the second, domainless service), checking the deploy trigger branch. Must be done BEFORE W0 ships, not after.
- Whether ≥1 real Stripe event will land inside the certification window. This decides whether Revenue reports a completed live cycle or `state: not_exercised`. Project memory records ~90 Stripe-linked users, so renewals are likely, but likely is not verified. RESOLVES VIA: one read-only count of `payment_events` and `subscription_events` rows in the trailing 30 days.
- Whether the Discord application can register a guild slash command with the token and OAuth grant currently in use. `applications.commands` must have been in the scope set when the bot was invited; if it was invited with `bot` alone, a re-invite is required and W3's Discord half slips. RESOLVES VIA: one read-only `GET /applications/{app_id}/guilds/{guild_id}/commands` — a 403 means re-invite.
- Whether `checkout.session.expired` is now subscribed on the live Stripe endpoint. `server/stripe/checkoutReconcile.test.ts:6` states it is NOT subscribed and that the sweep exists to cover exactly that, while `server/stripeWebhook.ts:641` handles the event. This determines whether the sales-demand half has a push signal or only the periodic sweep, which changes its latency and its evaluation window. RESOLVES VIA: one read-only Stripe `webhook_endpoints` retrieve on the live account.
- Whether GitHub Actions run retention on this repo is the default 90 days. The ops loop's observation source is `gh run list`, and the observer must copy run facts into the ledger branch before they expire. A shorter retention setting silently truncates the cadence baseline. RESOLVES VIA: reading the repo's Actions retention setting; mitigation either way is that the observer copies rather than queries at read time.
- DR ids 006–012 are assumed to cover the artifact-substrate, silence/ageing, authority-ladder, goal-record, and agent-charter decisions; only DR-001, DR-002 and DR-003 are confirmed to exist on disk. If the substrate decision selects a different artifact store than the orphan `os-ledger` branch — for example a `job_runs` table or the `shared/loop/ledger.ts` JSONL writer persisted server-side — then W0 here yields to it and the LOOP-file schema retargets. The loop order and cross-link topology in this record survive that substitution unchanged; only the storage does not.
- Whether PR #362 merges before W1. The engineering loop's per-PR evidence artifact is #362's `proof-contract.json`. If #362 stays open, engineering's first artifact falls back to the PR body plus the existing `ci.yml` result set, which is weaker but sufficient. This is a degradation, not a blocker.
- Whether the working-tree typecheck failure is fixed first. `server/_core/aiCostMeter.ts:20` imports `aiWorkflowCosts` from `drizzle/dime.schema`, which has no such export, so `tsc --noEmit` exits 1. Nothing in this rollout can be committed until that is resolved — it is DR-003's blocker and it gates W0 absolutely.

