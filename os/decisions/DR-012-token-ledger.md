# DR-012 — Token ledger mechanics — where the cost record lives, what it contains, and how the six D10 questions get answered

**Status:** AWAITING RULING · **DRI:** Prez · **Raised:** 2026-08-05 (Stage 2)
**Doctrine:** §11 Token-maxing economics (D10) — the six ledger questions, the maximum-useful-outcome-per-combined-cost objective, the capital-allocation hire-test, and the explicit instruction that the comparison is against the human organization otherwise required rather than against zero · §14 The fifteen-stage sequence (D14) — stage 14 ('shift capital from headcount to tokens; track spend against accepted outcomes; let the bill rise when productive capacity rises more') and the standing law 'visibility before autonomy, evaluation before scale' · §6 The queryable company (D6) — artifact law, the seven required artifact properties, semantic connections linking spend to the work it purchased, and 'minimize invisible consequential state' · §5 The closed loop (D5) — the ledger is itself a loop with Goal/Context/Action/Artifact/Outcome/Evaluation/Adjustment; 'an action is not an outcome' is what forces the merged-PR join instead of a raw token count · §8 L6 Evaluation (D12) — 'a generated artifact is not success; a completed action is not a reached objective' — the reason cost-per-accepted-unit exists rather than cost-per-session · §15 Failure mode #14 (D15) — 'token waste mistaken for token-maxing → compare cost to accepted work, human time removed, complexity avoided': this DR is the direct mechanism for that correction · §15 Failure mode #2 and #9 (D15) — open-loop automation and generated output mistaken for completion; both are why the ledger must terminate in an evaluated ratio, not a persisted number · §16 Peak state (D16) — 'model expenditure grows when it produces more value than headcount would' is a certification criterion that is currently unscoreable because no USD is measured anywhere · §19 Standing Dime rules — evidence taxonomy (VERIFIED/INFERRED/UNKNOWN) applied per-field: `listUsd` VERIFIED-from-transcript, Q6 INFERRED-from-versioned-basis, coverage gaps UNKNOWN-with-stated-resolution; and deploy law, which is why avoiding `db-push.yml` is a first-class advantage · §10 Archetypes and the flat company (D9) — questions 3 and 5 (coordination eliminated, product surface one person can direct) are the ledger's link to the never-build-the-middleware mandate

> **Read `DR-014` first.** The coherence, doctrine, and survival critics reviewed all ten
> Stage 2 records together and issued consolidation rulings that override parts of this one.
> Where DR-014 and this record disagree, DR-014 governs.

---

## The question

Where does Dime's token ledger live and what emits it: a git-native, hook-driven ledger derived from Claude Code session transcripts (no schema change), the owner-gated `ai_workflow_costs` DB table the untracked `aiCostMeter.ts` was written against, a one-shot report script, or a gateway-side meter?

## Why this is contested

Three facts pull in opposite directions and none of them is obvious until you look.

(1) **The money is not where the code is.** Every cost emitter written so far (`server/_core/aiCostMeter.ts`, `dimeAgent.totalCostUsd`, the WC2026 token audit rows) instruments *server runtime* AI calls. Server runtime AI spend at Dime is approximately zero — Dime Chat is owner-gated at 30 req/min. Meanwhile [VERIFIED, this session] Claude Code session transcripts under `~/.claude/projects/` record **79,909 assistant messages / 40 sessions / 2026-04-13 → 2026-08-05** carrying 61.3M output, 453M cache-creation and **16.33B cache-read tokens** — priced at first-party list with per-model rates and cache multipliers, **$18,274**. Building the DB table first would be instrumenting the empty pipe.

(2) **Subscription auth means the bill is not the cost.** `ANTHROPIC_BASE_URL` is unset in this interactive session [VERIFIED] and LLM.md's auth law forbids API for interactive work, so the marginal bill for that $18,274 of consumption is a flat plan fee. D10 explicitly says the comparison is *against the human organization otherwise required, not against zero* — so a ledger that records the true bill records ~$0 and answers none of the six questions. A ledger that records list price records a number Dime never paid. Both are defensible; only one is useful, and picking is a judgment call.

(3) **The naive price table is wrong by 8x.** `aiCostMeter.ts` `DEFAULT_PRICES` has only `inputUsdPerMTok`/`outputUsdPerMTok`. Priced that way the same corpus reads **$3,099**. Cache-aware it reads **$18,274**. 89% of the real cost is in cache reads that the existing meter cannot see. Whichever store wins, the price model is the load-bearing decision, and it is currently silently wrong in the only code that exists.

Layered on top: the file that was supposed to do this (`aiCostMeter.ts`) is untracked *and* breaks typecheck — it imports `aiWorkflowCosts` from `drizzle/dime.schema`, a table that exists in no schema file [VERIFIED: `grep -rn aiWorkflowCosts drizzle/` → 0 hits]. So "just finish what's started" is not a free option; it costs a db-push, an owner gate, and a production deploy under deploy law.

## Options

### A — Git-native session ledger in os/ledger/, emitted by a Claude Code hook, joined to merged PRs ✅ **RECOMMENDED**

**Effort:** M · **Risk:** low

**Store.** `os/ledger/sessions/YYYY-MM.jsonl` — `LedgerRecord` lines written through the existing `shared/loop/ledger.ts` (append-only, prev-hash chained, `fromJSONL()` re-verifies the chain and fails loudly on mutation; 32/32 adversarial tests already green). One `workflow_cost` artifact per **(sessionId, gitBranch)** pair — **145 records for the entire company history to date** [VERIFIED], so the file stays human-readable. Companions: `os/ledger/PRICES.json` (versioned, cache-aware), `os/ledger/HUMAN-EQUIVALENCE.md` (the Q6 conversion basis), `os/ledger/LEDGER.md` (generated rollup), `os/ledger/HIRE-TEST.md` (template).

**Record contents.** Reuses `shared/loop/envelope.ts` `workflow_cost`, with an additive extension to `costBlockSchema` (a file imported by nothing shipped, so the edit is free): `cacheCreationTokens`, `cacheReadTokens`, `billingMode: "subscription"|"api"|"gateway"`, and **three USD fields** — `billedUsd` (marginal cash; 0.00 for subscription), `listUsd` (cache-aware first-party price for the identical tokens = replacement cost, the D10 numerator), `amortizedUsd` (plan fee × this session's share of the month's tokens; sums to the real bill). `links.outcomeRef` carries the acceptance join. `sources` cites the transcript path + its sha-256. `payload` carries per-model breakdown, attendance (`mainMsgs` / `sidechainMsgs` / `subagentCount` / wall-clock), production counts (Write/Edit/Bash calls), the acceptance classification, `priceTable` id, and an explicit `coverage` block.

**Three v1 emitters, ordered by share of real spend.** E1 `scripts/os/cost-ledger.mjs --catchup`: walks `~/.claude/projects/**/*.jsonl` (including `subagents/` sidechains), prices per-model with per-bucket cache multipliers, appends. Zero new instrumentation — it reads files that already exist. E2 the PR joiner: `gh pr list --state all --json number,headRefName,mergedAt` → acceptance class. E3 `recordCostEvent()` in `server/_core/aiCostMeter.ts`, with the phantom `aiWorkflowCosts` import **deleted** (fixes the typecheck break with no db-push) and the DB insert replaced by a JSONL append — covers Dime Chat / `dimeAgent` / `piAgent`, ~$0 today, non-zero the day Dime Chat gets traffic.

**Automation, and loud neglect.** `SessionStart` hook (`matcher: startup|resume|clear`) runs `--catchup`, which scans every transcript newer than the ledger's last `observedAtMs` — **catch-up semantics, so a missed run self-heals at the next session start.** This piggybacks the exact pattern already proven to fire daily (`bootstrap-plugins.sh`). `SessionEnd` adds a best-effort immediate flush. `.github/workflows/os-ledger.yml` runs `scripts/os/check-ledger.mjs` on every PR as a **required** check: chain verifies, the PR's head branch has ≥1 cost record or a `Cost-Exempt: <reason>` trailer, and the newest record is < 7 days old. A broken hook goes red on the next PR instead of rotting for 8 days. Monthly `--rollup` regenerates `LEDGER.md` and posts it as a GitHub issue labeled `os/ledger` — the first issues this repo will ever have.

**Pros**

- Covers ~100% of the spend that actually exists. E1 alone already produced the company's real numbers in one pass: **$18,274 total · 66.3% ($12,109) attributable to merged PRs · $36.69 per accepted unit over 330 merged PRs · 2.3% ($416) on branches that never merged · 31.5% ($5,750) unattributable to any PR** [all VERIFIED this session].
- Zero schema change, zero db-push, zero owner-gated deploy, zero new service, zero vendor. It is a file format plus a script plus a hook plus a CI job — the cheapest possible shape under the stated YAGNI rule.
- Reuses the best primitives in the repo instead of adding infrastructure: `envelope.ts` + `ledger.ts` go from *imported by nothing shipped* to load-bearing, and their adversarial test suite starts protecting something real.
- Fixes the typecheck break by **deletion** — removing the import of a table that never existed is strictly less risk than creating the table.
- The 31.5%-unattributable figure is F1 dark state priced in dollars for the first time: `main`, detached `HEAD` worktrees, and `local/audit-mlb-model-2026` (the U3 branch) are exactly the buckets, and they show up as a number that grows if the dark state grows.
- Catch-up + required-CI-check is the direct structural answer to how the 2026-07-28 program died: neglect produces a red check, not silence.
- Survives the founder being the only human — nothing here requires him to type anything on a cadence.

**Cons**

- **Transcript retention is the single point of failure.** `cleanupPeriodDays` is unset (default 30) and today's corpus covers only 22 distinct days back to 2026-04-13 — history before the first catch-up run is permanently partial. Mitigated going forward (records are committed to git before cleanup) but the historical window must be labelled `coverage.transcriptComplete: false`, never smoothed over.
- Blind to anything not run as Claude Code on this machine: cloud sessions, pi, Codex, and any future harness. Each record carries `harness`, so the gap is *declared* rather than silent — but it is still a gap.
- `listUsd` is a modelled price for a relationship that is not list-priced. The cache multipliers (1.25x 5m write, 2x 1h write, 0.1x read) are assumptions. They are versioned in `PRICES.json` and labelled INFERRED, and the transcripts do break out `ephemeral_5m` vs `ephemeral_1h` so the multiplier is applied per-bucket — but it remains an estimate stated as a number.
- Hook writes dirty the working tree mid-session. Contained to `os/ledger/sessions/*.jsonl`, a path no test or build reads, and the hook never commits — but it will occasionally surprise someone running `git status`.
- Branch→PR is a lossy join: 58 of 67 branches matched, 70.5% token-weighted [VERIFIED]. Squash-merges, renamed branches, and multi-PR branches all degrade it. The unmatched residue is reported as its own class, not silently dropped.
- A required CI check on a ledger is a new way for main to be blocked by something that is not the product.

**Doctrine fit:** D10 §11 directly: it is the first mechanism at Dime that produces a spend number at all, and it produces the *right* one (replacement cost, not bill). D14 stage 14 ("shift capital from headcount to tokens; track spend against accepted outcomes") becomes executable rather than aspirational. D6 artifact law: each record satisfies all seven required properties and links spend→PR→outcome, so traceability from intention to result holds. D5: the ledger is itself a closed loop with an Outcome (accepted work) and an Evaluation (cost per accepted unit) rather than a metric that terminates in a log line. D15 #14 ("token waste mistaken for token-maxing") is answered with a computed waste ratio, not a claim. §19 evidence taxonomy is enforced by construction — `listUsd` VERIFIED-from-transcript, Q6 INFERRED-from-versioned-basis, coverage gaps UNKNOWN-with-reason.

### B — Finish the original design: ship the ai_workflow_costs table via db-push and wire the runtime emitters

**Effort:** M · **Risk:** medium

Add an `aiWorkflowCosts` table to `drizzle/dime.schema.ts` matching the shape `aiCostMeter.ts:156` already inserts (workflow, model, requestId, inputTokens, outputTokens, usd, usdReason, latencyMs, retries, outcomeRef, priceTableVersion), extend `DEFAULT_PRICES` with cache rates, run the manual `db-push.yml` workflow, then merge — which under deploy law is a production deploy. Wire `recordCostEvent()` at four call sites: the `/api/dime/chat` `stream.done` handler, `runDimeAgent()` (which already computes `totalCostUsd` and discards it), `runPiAgent()`, and the Python model-runner spawn wrapper. Query it from a founder-dashboard tRPC procedure joining `ai_workflow_costs.outcomeRef` to `mlb_game_backtest` and `games`.

**Pros**

- It is the only design that lets AI cost join *product* data in SQL — cost per projection run, cost per graded market, cost per paying user of Dime Chat. Nothing git-native can do that join.
- It is the right and eventually necessary home for per-user, per-request serving cost, which is a billing input the moment Dime Chat is sold rather than owner-gated.
- The emitter code, the honesty contract (`usd null` with a stated reason, never a guessed price), the `schemaCapabilities` deploy-gate probe, and the tests are already written — this is the shortest path from what exists to what runs.
- Feeds the founder dashboard from the same store as every other company metric, avoiding a second query language for one metric family.

**Cons**

- **It measures approximately none of the money.** Server-runtime AI spend today is ~$0; the $18,274 lives entirely in Claude Code sessions this table cannot see. It would ship, be correct, and report near-zero — reproducing precisely the F9 pattern it is meant to escape ("Token ledger — PARTIAL: complete design, zero rows, no table, a broken import, zero emitters") with one row of the four problems fixed.
- Requires an owner-gated `db-push.yml` run *and* a production deploy before a single number exists. Highest ceremony of any option, for the least measurement.
- A table with a plausible schema and no meaningful rows is worse than no table: it makes the six questions look answered.
- Does not fix the subscription problem at all. `usd` would record marginal API cost, which for the work that matters is zero — the exact failure D10 names.
- Adds a permanent production write on serving paths (fail-soft, but still) for data with no current consumer.

**Doctrine fit:** Satisfies D6's store-of-record instinct but fails D10 on its own terms: a ledger that answers "how much did this cost?" with a number near zero cannot answer any of the six questions, and cannot run the hire-test. Actively risks D15 #4 ("data collection without meaning") and D15 #9 (generated output mistaken for completion) — the table would be an artifact whose existence is mistaken for measurement. Also collides with the mission's own limit that no production deploy happens without a Prez gate, buying a gate for the weakest return.

### C — Report-only shadow bill: one script, no store, no CI

**Effort:** XS · **Risk:** medium

`scripts/os/shadow-bill.mjs` — the same scanner and pricer as Option A's E1 plus the PR join, but it prints a report to stdout and writes nothing durable. Run on demand, or pasted into an audit when a number is needed. Delete `aiCostMeter.ts` outright (removing the typecheck break) and record the ledger as deferred.

**Pros**

- Genuinely the cheapest thing that produces the true numbers — this session proved it takes minutes and no infrastructure.
- Adds no moving part that can rot: no hook, no CI job, no file format, no schema. Under a ruthless YAGNI reading this is the correct answer.
- Zero risk to main, to CI, and to the working tree.
- Makes the immediate D10 argument available today: $18,274 of list-price consumption over ~16 weeks against a flat subscription is a decisive fact whether or not it is ever stored.

**Cons**

- It is the 2026-07-28 failure mode with a different filename. `operating-brief.md` declared itself "the recurring decision surface" and "regenerable", had no generator, and was 8 days stale with a wrong item 3 when the audit found it. A report nobody is obliged to run is a report nobody runs.
- No artifact means no `outcomeRef` accumulation, so cost-per-accepted-unit can never be tracked *over time* — only recomputed, and only for whatever transcript window survived cleanup at the moment someone remembered.
- Transcript cleanup silently deletes the raw material. Without durable records the historical series is destroyed on a 30-day rolling basis and the loss is invisible.
- Fails D5 outright: an evaluation with no artifact and no ageing is an open loop by definition.
- No neglect signal of any kind.

**Doctrine fit:** Fails D6 (no durable artifact, no semantic link to the work it priced), fails D5 (no Outcome, no Adjustment, no Memory), and fails D15 #3 (unqueryable work). It does satisfy D10's *analytical* content — the six questions can be answered once — but D10 says the questions are "applied to every significant spend" and "answered in `os/ledger/`", which presumes accumulation. Its one real doctrinal virtue is D3/YAGNI discipline: it adds nothing that can rot unobserved, and that argument deserves to be heard rather than dismissed.

### D — Meter at the Anthropic-compatible gateway

**Effort:** S · **Risk:** high

Instrument or import usage from the gateway that `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` point at — the single choke point `server/_core/anthropicClient.ts`, `dimeAgent.ts`, `piAgent.ts`, and (per `CLAUDE.md`) the Claude Code CLI are all documented to route through. A periodic importer pulls the gateway's usage export into `os/ledger/` or the DB, with no per-emitter wiring anywhere in the codebase.

**Pros**

- One integration point covers every server surface forever — no emitter drifts out of date, no new code path is ever silently unmetered.
- Gateway numbers are *actual billed amounts*, not modelled list prices, so `billedUsd` needs no cache-multiplier assumptions at all.
- Naturally harness-agnostic: anything that speaks the Anthropic API through that base URL is captured, including harnesses that do not exist yet.
- Cheapest ongoing maintenance of any option if the gateway already exports usage.

**Cons**

- **It would miss ~100% of the money.** `ANTHROPIC_BASE_URL` is unset in this interactive session [VERIFIED], and LLM.md's auth law is explicit that interactive work is subscription-first and never the API. The $18,274 does not pass through the gateway.
- The gateway's coverage is not established: the audit records that `references/ai-gateway-setup.md`, cited from code, does not exist, and that it is UNKNOWN whether the gateway dashboard covers Dime's spend at all.
- Puts the company's measurement path behind an external vendor — the most expensive shape of new dependency under the stated constraints, and the one thing the ledger must never lose access to.
- Gateway invoices are billed-cost only, so it structurally cannot produce the replacement-cost number D10 requires. It answers "what did we pay?", which for a subscription company is the less interesting half.

**Doctrine fit:** Would satisfy D6's artifact-completeness ideal if the traffic actually flowed through it, but as configured it measures the wrong population and would report a confidently precise near-zero. Directly violates D14's visibility-first ordering by installing a meter whose blind spot is the entire subject. Its `billedUsd` reconciliation value is real and worth keeping — as a graft onto the winner, not as the ledger itself.

## Recommendation

**A — Git-native session ledger in os/ledger/, emitted by a Claude Code hook, joined to merged PRs**

It is the only option that measures the money that exists, and it is simultaneously the option that adds the least. That combination is rare enough to settle the decision.

Against **B**: B instruments the empty pipe. It costs an owner-gated `db-push.yml` run plus a production deploy under deploy law, and at the end of that ceremony it reports a number near zero, because server-runtime AI spend at Dime is near zero while $18,274 sits in Claude Code transcripts B cannot see. Worse, a schema-correct table with no meaningful rows makes the six questions *look* answered — the exact F9 trap the token ledger is already caught in. A also fixes the `aiCostMeter.ts` typecheck break by deleting a phantom import, which is strictly less risk than creating the table it hallucinated.

Against **C**: C's YAGNI argument is the strongest case against A and I take it seriously — A does add a hook, a CI job, and a file format, and every one of those can rot. But C is structurally identical to `operating-brief.md`, which declared itself "the recurring decision surface" and "regenerable", had no generator, and was eight days stale with a wrong item when the audit found it. The difference between A and C is exactly one property: whether neglect is loud. A's catch-up-on-SessionStart plus required PR check means a broken meter turns a check red; C means nothing happens and nobody learns. For a one-founder company that is not a nice-to-have, it is the only thing that distinguishes a mechanism from a memo.

Against **D**: D is elegant and measures the wrong population. `ANTHROPIC_BASE_URL` is unset in interactive sessions and the auth law keeps it that way, so the gateway sees approximately none of the spend. Its `billedUsd` reconciliation value is real, which is why it survives as a graft.

The decisive evidence is that A's core emitter is not a proposal — it ran during the drafting of this record and produced defensible company numbers from files already on disk, in minutes: **$18,274 list-price cache-aware spend, 66.3% attributable to merged PRs, $36.69 per accepted unit across 330 merged PRs, 2.3% waste on never-merged branches, 31.5% unattributable to any PR.** That last figure is F1 dark state priced in dollars for the first time. A is mostly the work of making that repeatable, durable, and loud when it stops.

**Grafted from the runners-up**

- **From B — keep the runtime emitter, drop the table.** `recordCostEvent()` stays in `server/_core/aiCostMeter.ts` as emitter E3, but the `aiWorkflowCosts` import and the `db.insert()` are deleted and replaced with a JSONL append. The `schemaCapabilities` probe, the honesty contract (`usd null` with a stated reason, never a guessed price), and the existing tests all survive.
- **From B — defer the table with a written activation trigger, not an abandonment.** `os/ledger/DEFERRED-db-table.md` records the decision and the exact condition that reopens it: E3's monthly `billedUsd` exceeds $50, **or** Dime Chat ships to non-owner users and per-user cost becomes a billing input. Doctrine D12-L4 requires deferrals to be recorded with their reason; this is that record.
- **From C — the one-shot report is a flag, not a second tool.** `scripts/os/cost-ledger.mjs --report` prints the shadow bill without writing, so the cheap path C wanted costs zero extra surface area.
- **From D — `billingMode` on every record, and a reconciliation mode.** Because each record carries `billingMode` and separates `billedUsd` / `listUsd` / `amortizedUsd`, a future gateway invoice reconciles *against* the ledger (`--reconcile <invoice.csv>`) instead of replacing it, and any traffic that does move to the gateway is priced from the invoice rather than modelled.
- **From D — treat price modelling as fallible.** `PRICES.json` is versioned and every record stamps the version it was priced with, so a corrected cache multiplier or a discovered long-context premium tier re-prices history by replay rather than by editing records in place (which `ledger.ts` would reject as `CONTENT_TAMPERED` anyway).

## Requested ruling

**The question for Prez, in one sentence:** Do you approve building the token ledger as a git-native, hash-chained JSONL under `os/ledger/`, fed automatically by a Claude Code SessionStart catch-up hook and joined to merged PRs — with `listUsd` (cache-aware first-party replacement cost) adopted as the official D10 numerator instead of the actual cash bill, and with the `ai_workflow_costs` DB table formally deferred behind a written activation trigger?

**A yes commits you to five things:**

1. **A metric definition you will be quoted on.** Dime's official AI cost number becomes *modelled replacement cost*, not cash paid. The company's headline economics line becomes something like "$18,274 of list-price model consumption over 16 weeks against a flat subscription fee" — a true and defensible statement that is nonetheless **not** what left your bank account. Every surface that shows it must say so. If you want the cash number to be canonical instead, say so now; the mechanics are identical but the answer to all six questions changes, and the D10 argument gets much weaker.

2. **Ratifying a staffing-equivalence basis for question 6.** Q6 ("what human organization would the same result have required?") cannot be measured — only declared. `os/ledger/HUMAN-EQUIVALENCE.md` will ship with a versioned default (fully-loaded cost per engineer, and merged-PRs-per-engineer-per-week) that converts $36.69/accepted-unit into a headcount-equivalent range. **You own those constants.** They will be labelled INFERRED and reported as a range with the assumption id attached, never as a bare number — but your ratification is what makes the answer legitimate rather than invented.

3. **A new required status check on `main`.** `os-ledger` joins the required set: chain verifies, the PR's head branch has a cost record or an explicit `Cost-Exempt:` trailer, newest record < 7 days old. This *will* occasionally block a PR for a reason unrelated to the product. That is the intended cost of making neglect loud — and given that the audit found DB Tests and Build & Preview Gate sitting advisory, an advisory version of this check is not worth building.

4. **A hook that writes into your working tree on every session start.** Contained to `os/ledger/sessions/*.jsonl`, never auto-committing, but it will show up in `git status`.

5. **The hire-test becoming procedural.** Before any role opens, `os/ledger/HIRE-TEST.md` requires the current cost-per-accepted-unit, the four absorb-first questions (better context / better agents / stronger evaluations / redesigned loop), and a record of which was attempted. This is D10's capital-allocation rule made into a gate on your own decision.

**Two things a yes does NOT commit you to:** no schema change, no `db-push.yml` run, no production deploy — Option A touches only `os/`, `scripts/os/`, `.claude/settings.json`, `.github/workflows/`, `shared/loop/envelope.ts` (additive, imported by nothing shipped), and `server/_core/aiCostMeter.ts` (deletion of a broken import).

**A separate, smaller ruling you can give independently and cheaply:** approve raising `cleanupPeriodDays` in `~/.claude/settings.json` to preserve session transcripts. Today it is unset (default 30) and the corpus already spans only 22 distinct days. Every day this waits, ledger history is being deleted that cannot be reconstructed. This is a one-line local setting change, reversible, and worth doing even if you rule against everything else here.

## Depends on

- DR-003 — authorize pushing `local/audit-mlb-model-2026` and committing the AI-native program. **Hard dependency.** Option A reuses `shared/loop/envelope.ts`, `ledger.ts`, and `queries.ts`, which are untracked working-tree-only files. If DR-003 rules against committing them, Option A must vendor its own copies and loses the 32/32 adversarial test coverage that makes the chained ledger trustworthy — which would materially weaken the recommendation.
- DR-005 — first-loop selection. `links.outcomeRef` on every cost record must point at the accepted-outcome artifact of whichever loop goes live first. Until DR-005 rules, `outcomeRef` resolves only to merged PRs (`acc:pr/<n>`), which is sufficient for v1 but is a narrower definition of 'accepted work' than the doctrine intends.
- DR-001 — posture on the 9 BACKTEST-ONLY markets. Not a build dependency, but it determines whether model-runner compute counts as spend against *accepted* work or against work the company has ruled unsellable. Cost-per-accepted-unit changes meaning depending on the ruling.
- The artifact-spine decision record (id not yet assigned) — whichever DR rules on where `/os/` artifacts live in the repo and whether `shared/loop/ledger.ts` becomes the universal artifact store. If that DR picks a different artifact home, `os/ledger/sessions/` must move with it; this DR should not be the one that sets the repo-wide convention.
- The CI-gate-posture decision record (id not yet assigned) — F6.1 shows two remediation gates sitting advisory on `main`. Whatever rule that DR establishes for advisory-vs-required governs whether `os-ledger` may be required on day one or must graduate.
- The founder-dashboard decision record (id not yet assigned) — `os/ledger/LEDGER.md` is the ledger's own rollup surface; if a dashboard DR builds a UI, it renders these records and inherits `design-system/dime-ai/MASTER.md`.

## Open unknowns

- **Which of the six questions are honestly measurable, and the named proxy for each — the core deliverable of this DR.** (1) *Accepted work*: **MEASURABLE.** Merged-PR join; $36.69/accepted unit today. (2) *Human time removed*: **PROXY — `unattended_production_hours`**, the wall-clock span of `isSidechain: true` messages, i.e. time the company was producing while no human was reading. 50,363 of 79,909 assistant messages (63%) are sidechain [VERIFIED]. Honest limit: it measures *agent* working time; the conversion to human-hours is a declared constant in `HUMAN-EQUIVALENCE.md`, not a measurement. (3) *Coordination eliminated*: **PROXY — `handoff_equivalents_avoided`**, the count of subagent invocations plus concurrent branch-weeks, on the argument that each subagent boundary would be a ticket + assignment + review + status update in a human org. Honest limit: it counts boundaries, not meetings, and Dime has no human-org baseline to subtract from — it has never had one. (4) *Learning speed*: **PARTIAL — `pr_lead_time` as a proxy for learning latency.** Measurable now (median 0.1h, p90 1.9h, createdAt→mergedAt over 330 merged PRs [VERIFIED]), but it measures *shipping* speed. The true D10 answer requires evaluation-to-adjustment latency, which does not exist until F3 is wired; the ledger must print the substitution explicitly. (5) *Product surface one person can direct*: **PROXY — `concurrent_accepted_workstreams`**, distinct branches with a merged PR in a rolling 7-day window, plus distinct top-level directories touched per merged PR. Measurable now. (6) *Human organization otherwise required*: **NOT MEASURABLE — declared basis only.** `os/ledger/HUMAN-EQUIVALENCE.md`, versioned, ratified by Prez, reported as a range with the assumption id attached and labelled INFERRED. Never a bare number.
- **Definition of 'accepted work', proposed for ratification.** A1 accepted-and-survived: merged PR still on `main` 14 days later with no revert commit naming it (primary unit). A2 accepted: merged PR, 14-day window not yet elapsed. A3 owner-accepted artifact: a decision record or audit carrying a recorded Prez ruling — this is how non-code work like the Stage 1 audit earns a denominator. R1 rejected: closed-unmerged PR, or a merged PR later reverted. U unattributed: branch with no PR. Ratio = `listUsd(A1+A2+A3) / count(A1+A2+A3)`; waste ratio = `listUsd(R1)/listUsd(all)` = **2.3% today**; dark ratio = `listUsd(U)/listUsd(all)` = **31.5% today**. Open: whether A1's window is 14 days, and whether 'survived' should also require the PR's required checks to have been green (the audit found gates that do not gate, so 'merged' is a weaker signal here than it looks).
- **The subscription plan fee is not known to this record.** `amortizedUsd` and the subscription-leverage multiple (`listUsd ÷ plan fee`) cannot be computed until Prez states the monthly figure and which months it covers. Resolved by one line in `HUMAN-EQUIVALENCE.md`. Until then the ledger reports `amortizedUsd: null` with reason `PLAN_FEE_UNDECLARED` — the same honesty contract `queries.ts` already uses.
- **Cache-multiplier and long-context pricing are modelled, not confirmed.** Applied: 1.25x for `ephemeral_5m` writes, 2.0x for `ephemeral_1h` writes, 0.1x for reads. The transcripts do break out the two ephemeral buckets so the multiplier is applied per-bucket rather than blended — but the multipliers themselves are cached knowledge, and long-context premium tiers (relevant: the primary model here is `claude-opus-5[1m]`) are not modelled at all. Resolved by checking current published rates and stamping `PRICES.json` v2; historical records re-price by replay, never by mutation. Note the magnitude: cache-blind pricing gives **$3,099** for the same corpus versus **$18,274** cache-aware — an 8x error, and exactly the error `aiCostMeter.ts` `DEFAULT_PRICES` makes today.
- **Transcript retention is actively destroying ledger history.** `cleanupPeriodDays` is unset in `~/.claude/settings.json` (default 30); the current corpus spans 2026-04-13 → 2026-08-05 but only **22 distinct days** of assistant activity, so coverage is already holed. Resolved by setting `cleanupPeriodDays` high (one-line, reversible, worth doing regardless of the main ruling) and by the first `--catchup` run committing everything currently on disk before it ages out.
- **Branch→PR join loses 29.5% by token weight.** 58 of 67 branches matched a PR head [VERIFIED]. The residue is dominated by detached `HEAD` (worktrees, $356M token-equivalents), `local/audit-mlb-model-2026` (the U3 dark-state branch), and direct-on-`main` work. Resolved by (a) recording commit SHAs alongside the branch so detached HEAD can be resolved to a PR after the fact, and (b) treating `local/*` spend as its own reported class — it is F1 exposure, and pricing it is more useful than attributing it.
- **Whether `os-ledger` may be a required check on day one.** D14 argues visibility first and graduation second; the audit argues the opposite, since advisory gates at this repo demonstrably do not bind (F6.1). Recommendation is required-from-day-one because the check is trivially satisfiable and its failure mode is informative, but this is genuinely arguable and depends on the CI-gate-posture DR.
- **Whether `costPerVerifiedOutcome()` in `shared/loop/queries.ts` should be extended or superseded.** It defines a verified outcome as a settled grading record (WIN/LOSS/PUSH) — the *model* factory's unit. This DR's accepted-work unit is the merged PR — the *product-code* factory's unit. Doctrine §9 says Dime runs two factories, so both are correct for their own factory and the ledger should report **two ratios, clearly labelled**, rather than reconciling them into one. Not yet designed; flagged so the two are not silently merged.
- **The 6,134,033-token / 84-agent figure for the Stage 1 audit cited in the mission brief could not be reproduced exactly from the transcripts in this session's scan** — subagent transcripts live under `<session>/subagents/` and `<session>/subagents/workflows/`, and the totals depend on which nesting levels and which counter (output-only vs all four buckets) were summed. Not a contradiction, but the ledger must fix one counting convention and state it, or two honest runs will report different numbers for the same work.

