# DR-010 — The two factories and their acceptance thresholds — where the bar lives, what the numbers are, and what makes them bind

**Status:** RULED — cut upheld 2026-08-07 · **DRI:** Prez · **Raised:** 2026-08-05 (Stage 2)
**observe_by:** 2026-08-12
**Doctrine:** §9 D8 — the software factory (all ten parts; part 7 the probabilistic satisfaction threshold; the two-factory table; the factory is itself queryable) · §8 D12-L6 — evaluation at the outcome level; code against specs/tests/scenarios/thresholds · §8 D12-L2 — artifact system; append-only enforcement · §6 D6 — artifact law: seven required properties, semantic connections, traceability intention→result, preserve reasoning not only conclusions · §5 D5 — the closed loop; an action is not an outcome; generation is the beginning of execution · §14 D14 — visibility before autonomy, evaluation before scale (stages 9, 11, 15) · §15 D15 #8 weak tests, #9 generated output mistaken for completion, #2 open-loop automation, #15 prototype theater · §17 — certification criterion 6 (both factories certified) and criterion 10 (queryability proven) · §19 — evidence taxonomy (VERIFIED/INFERRED/UNKNOWN), compliance gate, data provenance (live-pregame vs walkforward-replay), deploy law (merge to main is a production deploy) · §10 D9 — value visible as what you build and how you govern the intelligent system · §18 — the Dime Cycle: Test and Validate are the observed outcome and its evaluation; nothing pushes below the bar

> **Read `DR-014` first.** The coherence, doctrine, and survival critics reviewed all ten
> Stage 2 records together and issued consolidation rulings that override parts of this one.
> Where DR-014 and this record disagree, DR-014 governs.

---

## The question

Dime must satisfy D8 part 7 — a stated probabilistic satisfaction threshold — for both the product-code factory and the model factory. Where does that threshold live (GitHub ruleset only / a versioned threshold file checked by CI / an append-only artifact ledger), which existing gates become REQUIRED, and what are the actual numbers?

## Why this is contested

Three things make this a real judgment call rather than an obvious default.

(1) **Most of the product-code acceptance layer already exists and is unmerged.** PR #362 (`ci/verification-framework`) ships 11 workflows, a `proof-contract.json` evidence artifact, property tests, and a Dockerfile/Trivy/smoke gate. Building a second acceptance layer beside it is duplication; building nothing leaves D8 part 7 unsatisfied, because every gate in #362 is boolean and its own `docs/verification/ROLLOUT.md` says nothing is required until Prez hand-edits the ruleset after "one clean week". That is manual, undated, unowned work — the precise shape of the 2026-07-28 death.

(2) **The numbers that exist are wrong, not merely unwired.** `server/mlbPublicationGate.ts:108-116` sets `ACCURACY_HARD_FLOOR: 0.70` and `ROI_FLOOR: 0.0` as CRITICAL blockers at `MIN_SAMPLE: 30`. For -110 two-way markets a 70% accuracy floor is unreachable forever (the audit's own FG ML measurement is 55.4% at n=1,528), so the gate can only ever say BLOCKED; and `ROI > 0` at n=30 certifies pure variance. Wiring this gate as-is would replace "no gate" with "a gate that is simultaneously unpassable and untrustworthy". Choosing the numbers is a founder-level call because they set what Dime may claim to a paying customer.

(3) **Every enforcement locus has a real cost here.** Ruleset-only is free but produces no trace and no probabilistic bar. A threshold file plus a checker adds two files and one CI job. A ledger-backed factory is the strongest doctrine fit (D6 §6, D8 parts 9-10) and rescues the repo's best asset (`shared/loop/envelope.ts` + `ledger.ts`, adversarially tested, imported by nothing) — but it needs a schema change, which is owner-gated and db-push-first, and its emitter-wiring step is exactly where the prior program died. Meanwhile merge to main IS a production deploy, so any design where CI writes trace rows to `main` turns bookkeeping into deploys. There is no free locus.

## Options

### A — Bind what exists (ruleset + test hygiene only)

**Effort:** S · **Risk:** low

No new files, no new concepts. Do four things.

(1) **Ruleset**: promote `DB Tests` and `Build & Preview Gate` from advisory to REQUIRED on `main-protection` (ruleset id 18701573) and the classic-protection mirror. Verified today the required set is exactly `Security Audit`, `TypeScript Check`, `Vitest`, `Secret Scan (gitleaks)` — the 10 real-DB suites and the bundle budget can fail and still merge. Then merge PR #362 and follow its `docs/verification/ROLLOUT.md` waves by hand.

(2) **Fix the four hygiene defects that make green meaningless**: add `client/src/**/*.test.tsx` to `vitest.config.ts:include` (today's globs are `.test.ts` only, so `client/src/pages/admin/DeviceActivityPanel.test.tsx` has never executed); convert `kenpomCredentials.test.ts`'s early `return` to `it.skip` (it reports GREEN with zero assertions on every CI run); move `scripts/check-environment-failures.mjs:137`'s stale-entry / not-executed / real-failure-despite-env detection out from under `effectiveProfile === "local"` so it runs in CI; add a `pnpm exec playwright test` job covering the 7 specs in `e2e/` that run in no workflow (only `feed-responsive.spec.ts` runs, in the path-scoped push-only `feed-responsive-cross-browser.yml`).

(3) **Bundle budget**: keep `bundle-budget.json` as-is but add a check that fails when `allowanceBytes` increases without a new `recalibrationN` block — a paper-thin version of the ratchet rule.

(4) **Model factory**: nothing. `mlbPublicationGate.ts` stays dead and the 9 production `publish_*` BACKTEST-ONLY rows stay unread.

**Pros**

- Smallest possible surface. Zero new moving parts, so zero new things that can rot unobserved — the strongest YAGNI answer available.
- Every item is a defect fix with an already-verified failure, not speculative infrastructure.
- Closes most of F6 (gates that do not gate) in a single afternoon.
- Requires no schema change, no owner-gated DB work, no dependency on the unpushed `local/audit-mlb-model-2026` branch.

**Cons**

- **Does not satisfy D8 part 7 at all.** Every gate remains boolean pass/fail. There is no probabilistic satisfaction threshold, no scenario layer, and no stated bar — the factory still does not formally exist under doctrine, so §17 certification criterion 6 ("both factories certified") fails.
- No iteration trace. "Which spec controlled this implementation, which tests failed, what revisions occurred, what evidence supported acceptance" stays unanswerable (D8's queryability clause).
- Leaves the model factory entirely absent, which is where the live customer exposure is (U1: 9 markets publishing against Dime's own do-not-publish verdict).
- Graduation of PR #362's checks stays a manual ruleset edit with no deadline and no owner-visible signal. On this repo's own evidence that work will not happen.
- The bundle-budget fix codifies the pathology instead of correcting it: adding a `recalibrationN` block is exactly what happened all 9 times (5,120 → 11,776 bytes, +130%).

**Doctrine fit:** D15 #8 (weak tests) partially corrected; D12-L6 improved from ❌ to ⚠️. **Fails D8 outright** — parts 3 (realistic scenarios), 7 (probabilistic threshold), 9 (durable artifacts per iteration) and 10 (reusable memory) remain absent. Fails §17 criterion 6.

### B — Two ACCEPTANCE files, one checker, a scenario tier, and an in-PR iteration trace ✅ **RECOMMENDED**

**Effort:** M · **Risk:** medium

Contains all of A, plus the three things A is missing, built as file formats and CI jobs — no service, no daemon, no vendor.

**Path tiers.** `os/factory/CRITICAL-PATHS.json` maps globs to four tiers: **M** money/access (`server/stripe/**`, `server/parlay*`, `server/betTracker*`, `shared/parlayPricing.ts`, `shared/inviteCode.ts`, auth/session files); **E** evidence/model (`server/mlb*Backtest*`, `mlbPublicationGate.ts`, `mlbDriftDetector.ts`, `mlbCalibrationAudit.ts`, `mlbWalkForwardValidator.ts`, `server/loop/**`, `shared/loop/**`); **C** customer claims (`client/src/**/landing-content.ts`, `server/landingPrerender.ts`, `server/_core/dimeVerdict.ts`, compliance gate); **S** standard.

**Product-code threshold** — `os/factory/ACCEPTANCE.product.json`, enforced by `scripts/check-acceptance.mjs` (new required check `factory-acceptance`), reading PR #362's `proof-contract.json`, `vitest-results.json`, the stryker report and the scenario report:

| bar | M | E | C | S |
|---|---|---|---|---|
| patch coverage on changed lines | 90% | 85% | 80% | advisory 70% |
| stryker mutation score on changed modules | 75 | 60 | — | — |
| **scenario reliability (the probabilistic bar)** | ≥0.95 @95% conf | ≥0.90 | ≥0.80 | — |
| ⇒ consecutive clean randomized-seed scenario runs (Clopper-Pearson: n ≥ ln0.05/ln p₀) | **60/60** | **30/30** | **15/15** | — |
| property tests per changed pure function | ≥1 @ ≥1000 cases | ≥1 | — | — |

**Scenarios** live in `scenarios/SC-*.scenario.ts` with a frozen corpus in `scenarios/fixtures/` and their own vitest project. Three to start: `SC-01 money-lifecycle` (Stripe fixtures incl. duplicate + out-of-order delivery against the MySQL service the `DB Tests` job already provisions — asserts entitlement state, one `entitlement_events` row per transition, no double grant); `SC-02 projection-replay` (a frozen MLB day → ingest → project → grade → publication gate → display artifact; asserts a re-run yields an identical `computeContentHash` and does **not** UPDATE the live-pregame row); `SC-03 shell-and-claims` (the 8 `e2e/` specs + landing claim whitelist + the schema.org/checkout/objections price triple, run against the PR-time image workflow 09 already builds).

**Model threshold** — `os/factory/ACCEPTANCE.model.json`, enforced by a rewritten `server/mlbPublicationGate.ts`, computed per market family over rows with `leakageSafe=1` and `modelRunAt < gameStartUtcMs`: (1) n ≥ 300 sides / 500 props; (2) **Brier Skill Score vs the book no-vig probability, 95% bootstrap lower bound > 0** — the primary probabilistic bar; (3) ECE < 0.05 and |bias| < 0.03 (keep `mlbCalibrationAudit.ts:92-93`, they are sound); (4) mean CLV 95% bootstrap lower bound > 0 over ≥200 rows with closing odds; (5) ≥70% of walk-forward folds pass 2–4 and no fold with BSS < −0.02; (6) hard provenance: leakage = 0, quarantine < 5%, `auditVersion` non-null on 100%. **ROI is reported, never a gate.** Status maps to `PUBLISH` / `INSUFFICIENT_DATA` / `BACKTEST_ONLY` / `QUARANTINED`, written to the `publish_*` rows the feed reads.

**Change rule** (both files): a number may be RAISED in any PR. LOWERING requires a PR touching only the acceptance file, carrying `dr: "DR-0NN"`, an `INCIDENTS.md` entry, and `expiresAt` ≤ 30 days — after which `check-acceptance.mjs` **fails until the number returns or the DR is renewed**. Three lowerings of one metric in 90 days hard-fails and forces a redesign of the metric. `bundle-budget.json`'s `allowanceBytes` migrates into this file and inherits the rule. Model thresholds additionally freeze for a market once it publishes.

**Iteration trace**: `os/factory/runs/<pr>.json` written by the agent opening the PR (schema: spec path + blob sha, tier, gates with value/threshold, scenario seeds and pass counts, mutation score, defects classified by the existing 13-class taxonomy in `docs/ai-native/factory/work-packet-template.md`, revisions with shas and why, acceptance evidence, token cost). `check-acceptance.mjs` **verifies the trace against `proof-contract.json`** — a fabricated number fails the build. Required only for tier M/E/C diffs. Model runs emit `os/factory/model-runs/<family>-<date>.json`.

**Anti-rot**: `scripts/check-required-checks.mjs` in the nightly workflow reads the live ruleset via `gh api`, diffs it against `os/factory/REQUIRED-CHECKS.json` (each check carrying a `requiredBy` date), and fails the nightly + alerts Discord when a check is past its date and still not required.

**Pros**

- **Satisfies D8 part 7 with an actual stated bar and named math** — Clopper-Pearson on scenario reliability, bootstrap lower bounds on BSS and CLV. Not "looks plausible", and not a point estimate dressed as certainty.
- Every mechanism makes its own neglect loud: the `expiresAt` clock self-breaks a lowered threshold, the ratchet counter turns the third lowering into a breach, and `check-required-checks.mjs` converts ROLLOUT.md's undated waves into a dated, self-announcing deadline. No item depends on Prez remembering.
- Adds no service, no daemon, no vendor, no schema change — two JSON files, one checker, one scenario project, one nightly script. Reuses PR #362's `proof-contract.json` as the evidence source rather than duplicating it.
- Directly fixes the metric pathology it inherits: the bundle budget stops being a ceiling that gets raised (9 times, +130%) and becomes a breach with an expiry.
- Model numbers are defensible for betting markets specifically. Replacing `accuracy ≥ 70%` and `ROI > 0` with skill-vs-market and CLV means the gate can actually pass when the model is genuinely good and cannot pass on variance — and it gives DR-001 a principled basis for the 9 markets rather than a vibe.
- The trace is verified against machine evidence, so §19's VERIFIED/INFERRED/UNKNOWN taxonomy gains its first mechanical enforcement (F6.9).
- Scenarios are defined so they catch the defect classes unit tests structurally cannot: SC-01 targets ordering across un-atomic statements (F8.1/F8.2), SC-02 targets replay-destroys-original (F5.2/F5.3).

**Cons**

- Real cost: roughly 1,200–1,600 lines across the checker, scenario harness, fixture corpus, and the rewritten publication gate. It is the largest of the three CI-scoped options.
- The scenario reliability counts are only cheap if scenarios stay fast. 60 randomized-seed repetitions of SC-01 against a MySQL service is plausibly 4–8 CI minutes; if the corpus grows carelessly this becomes the slowest gate in the repo and gets routed around — the exact failure ROLLOUT.md's own calibration note warns about.
- The in-PR trace is written by the agent, so it depends on the PR-opening agent following a convention. The checker catches fabricated numbers but cannot catch a thin, low-effort trace.
- The model half is blocked on evidence Dime does not have yet: CLV is permanently NULL in production, and the provenance discriminator does not exist in any shipped column (F5.1, F5.4). Gates 4 and 6 cannot compute until DR-003 lands the provenance regime from `local/audit-mlb-model-2026`.
- Three named thresholds (mutation 75/60, coverage 90/85/80) are guesses until a first measurement — stryker has never had a clean baseline run on tiers M/E.
- Two threshold files plus a path-tier file is three places a reader must hold in mind. Worth it, but it is genuine added surface.

**Doctrine fit:** Satisfies **D8 parts 1–3, 5–7, 9–10** (spec, executable tests, realistic scenarios, repeated evaluation, failure-driven revision via the classified-defect block, stated probabilistic threshold, durable per-iteration artifacts, reusable memory). Part 8 (human ownership) is the requested ruling itself. Serves **D12-L6** (evaluation at the outcome level), **D6** (traceability intention→result; the trace links spec blob → gates → defects → acceptance), **D14** (visibility before autonomy: nothing here grants an agent new authority), **D15 #8 and #9**. Honors §19 deploy law (no CI writes to `main`), data-provenance law (gate 6 is a hard, non-statistical check), and compliance gate (SC-03 covers the claim whitelist and U2's price triple).

### C — Ledger-backed unified factory (rescue `shared/loop`, persist both factories' runs as chained artifacts)

**Effort:** L · **Risk:** high

Same thresholds and scenarios as B, but the iteration trace is not a JSON file convention — it is a first-class artifact stream.

Commit `shared/loop/envelope.ts` + `ledger.ts` + `queries.ts` (untracked today, 32/32 adversarially tested, imported by nothing shipped). Add a `loop_artifacts` table via the manual `db-push.yml` workflow — columns mirroring `loopArtifactSchema` (artifactId, artifactType, contentHash, prevHash, producer, sources, entityRefs, versions, accessClass, freshness, links, cost, payload). Every product-code factory run emits an `evaluation_report` artifact through `makeArtifact()`; every model factory run emits `evaluation_report` + `improvement_proposal`; the publication decision emits `approval_decision` with `links.decides` pointing at the proposal. CI runs push their artifact JSONL to a non-deploying orphan ref (`refs/heads/os-trace`) so no trace append becomes a Railway deploy; the server-side emitters write to TiDB. Both factories, and eventually every loop, share one query vocabulary through `shared/loop/queries.ts` and its honest `{state, value, reason}` shape with `not_measured` / `incomplete` / `stale`.

**Pros**

- **Strongest doctrine fit available.** D6 §6's seven artifact properties and semantic-connection requirement are satisfied by construction, not by convention. D8 parts 9 and 10 are structural rather than aspirational.
- Rescues the single best asset in the repo and gives it a first real consumer — the audit calls `envelope.ts` + `ledger.ts` "the best artifact primitive in the repo" and it has never closed a cycle outside a 293ms test run.
- One vocabulary for both factories and for every future loop, so the factory trace and the model trace are joinable without a translation layer. The `links.supersedes` / `correctionOf` / `decides` fields already model regrades, corrections and approvals.
- Tamper-evidence is real: prev-hash chaining plus refusal of fabricated hashes and unresolved citations means a falsified acceptance record is mechanically detectable, not just implausible.
- `contentHash` excludes processing time, so a replay of the same fact deduplicates — which is precisely the primitive SC-02 needs to prove a replay did not destroy an original.

**Cons**

- **Requires a schema change**, which is owner-gated and must run `db-push.yml` before any code deploy. That is a hard serialization point in front of the whole design.
- The prior program died at exactly this step. `docs/ai-native/` records the JSONL writer as "implemented, tested, and never called" and the audit found every claimed integration point absent. Choosing C means betting that the emitter-wiring step succeeds this time, with no evidence that the failure mode has changed.
- Meaningfully more moving parts for a one-founder company: a table, emitters at ≥4 call sites, an orphan-ref push in CI (a `contents: write` token on a workflow, an attack surface PR #362 just spent effort reducing), and a query layer.
- D14 sequencing argues against it right now: this is infrastructure for queryability, and the mission's own audit says F1 (durability) and F2 (loud silence) ship before anything else. C is the second thing to build, not the first.
- The value over B is real but deferred — B's per-PR JSON files are already `jq`-queryable and can be migrated into the ledger later without rewriting the thresholds.

**Doctrine fit:** Best possible fit on **D6** and **D8 parts 9-10**, and the only option that gives §17 criterion 10 (queryability proven) a mechanical basis. But it inverts **D14** ("visibility before autonomy, evaluation before scale" — this scales the artifact system before the acceptance bar has ever bound once) and carries the D15 #15 risk (prototype theater) that the audit says already materialized on this exact code.

### D — Model factory only; let PR #362 be the product-code factory

**Effort:** M · **Risk:** medium

Argue that the product-code factory is already being built and should not be duplicated: merge PR #362, execute its ROLLOUT waves, promote `DB Tests` and `Build & Preview Gate`, and declare the product-code factory's acceptance threshold to be exactly "every required check green" — accepting that it is deterministic-only.

Spend all remaining effort on the model factory, which has nothing. Rewrite `server/mlbPublicationGate.ts` with the B-option numbers (sample floors 300/500, BSS bootstrap lower bound > 0 vs the book no-vig baseline, ECE < 0.05, |bias| < 0.03, CLV lower bound > 0, ≥70% fold pass rate, hard provenance checks, ROI reported not gated), give it `os/factory/ACCEPTANCE.model.json` with the same raise-freely / lower-only-with-DR-and-30-day-expiry rule, wire it as a caller of the existing `mlbCalibrationAudit` + `mlbWalkForwardValidator` code (~2,500 lines dead since 2026-05-23), have it write `publish_*` verdicts that the projections feed actually reads, and emit `os/factory/model-runs/<family>-<date>.json` as the model iteration trace. Add exactly one scenario, `SC-02 projection-replay`, because provenance cannot be proven any other way.

**Pros**

- Targets the only live customer-facing exposure. U1 — production holding 9 do-not-publish verdicts that no code reads, while all 9 markets publish anyway — is a trust and compliance problem, not an architecture problem, and this option is the shortest path to ending it.
- Wakes ~2,500 lines of already-correct, already-unit-tested evaluation math instead of writing new code. The audit is explicit that choosing the model loop means "wiring existing correct code, not writing new math".
- Avoids duplicating PR #362. One acceptance layer for product code, owned by a document that already exists (`docs/verification/RULESETS.md`, `ROLLOUT.md`).
- Smaller CI-minute footprint than B: no 60-repetition scenario matrix on the product-code side.
- Gives DR-001 what it actually needs to be ruled on — a defensible per-market verdict computed by a gate whose numbers are appropriate to betting markets.

**Cons**

- **Leaves the product-code factory failing D8 part 7 by construction.** "Every required check green" is a deterministic conjunction; there is no probabilistic satisfaction threshold, no reliability estimate, and no scenario tier beyond SC-02. §17 criterion 6 stays half-failed.
- Inherits ROLLOUT.md's manual, undated graduation with no anti-rot mechanism. On the evidence of this repo, the ruleset edits do not happen.
- Blocked harder than B on DR-003: without the provenance regime and CLV backfill from `local/audit-mlb-model-2026`, gates 4 and 6 cannot compute at all, so the model factory would ship with two of six gates permanently `not_measured`.
- The `modelProb decimal(5,2)` precision defect bites here immediately and only here — 1-percentage-point quantization corrupts every Brier and therefore every BSS. This option makes an unresolved UNKNOWN load-bearing on day one.
- No product-code iteration trace, so "which spec controlled this implementation" stays unanswerable for the 366-PR/28-day side of the company — which is where most of the work actually is.

**Doctrine fit:** Strong on **§19 compliance gate and data-provenance law** and on **D12-L6** for the model side. Strong on **D13 Product** ("verify the original problem was solved"). But only half-satisfies **D8**, which requires *both* factories to have all ten parts, and leaves **§17 criterion 6** failing. Good **D14** sequencing on the model side, none on the product side.

## Recommendation

**B — Two ACCEPTANCE files, one checker, a scenario tier, and an in-PR iteration trace**

B is the only option that satisfies D8 part 7 for both factories while adding a file format and a CI job instead of a service, a table, or a vendor — which is the cost ordering this repo's constraints demand.

Against **A**: A is the honest YAGNI answer and I would take it if the question were "how do we stop shipping broken things". But the question is whether a factory exists, and D8 is a ten-part conjunction. A leaves parts 3, 7, 9 and 10 absent, so §17 criterion 6 fails and the mission cannot certify. A's every item is inside B anyway, so choosing B costs nothing that A would have saved.

Against **C**: C is where this should end up, and I believe that. It loses today on D14 sequencing and on evidence. D14 is law — visibility before autonomy, evaluation before scale — and C scales the artifact system before a single acceptance bar has ever bound a merge. More decisively, C's critical step (wire the emitters) is the exact step that killed the 2026-07-28 program, and nothing about the failure mode has changed yet. B's per-PR `os/factory/runs/<pr>.json` is already jq-queryable and its fields are deliberately a subset of `loopArtifactSchema`, so migrating into the ledger later is a mechanical lift, not a rewrite. Build the bar first, prove it binds, then give it a ledger.

Against **D**: D's argument — don't duplicate PR #362, spend effort where nothing exists — is the strongest counter-case, and B adopts its entire model-factory design verbatim. Where D fails is that it accepts "every required check green" as a probabilistic threshold when it is a deterministic conjunction, and it inherits ROLLOUT.md's manual graduation with no mechanism. B's `check-required-checks.mjs` is ~80 lines and is the difference between a rollout plan and a rollout. D also makes the unresolved `modelProb decimal(5,2)` defect load-bearing on day one with no product-code work to hide behind; B has the same exposure but sequences the model half behind DR-003 explicitly.

The deciding property is that every mechanism in B is loud when neglected. A lowered threshold self-breaks at `expiresAt`. A third lowering in 90 days is a breach, not a ceiling raise. A check that passes its `requiredBy` date without entering the ruleset fails the nightly and hits Discord. For a one-founder company, that is worth more than any amount of correctness that depends on Prez remembering.

**Grafted from the runners-up**

- From D — the entire model-factory threshold set is D's design, adopted unchanged: sample floors 300 sides / 500 props, BSS-vs-book-no-vig with a 95% bootstrap lower bound above zero as the primary bar, ECE < 0.05 and |bias| < 0.03 kept from mlbCalibrationAudit.ts:92-93, CLV lower bound above zero over ≥200 rows, ≥70% walk-forward fold pass rate kept from the existing validator, hard provenance checks, and ROI reported but never gated.
- From D — sequence the model half behind DR-003 rather than shipping it with two of six gates permanently not_measured. The product-code half of B ships first and independently.
- From C — use `computeContentHash` from `shared/loop/envelope.ts` as the identity of each trace row, and keep every field of `os/factory/runs/<pr>.json` a strict subset of `loopArtifactSchema`, so the later migration to a ledger is a load, not a rewrite. This also commits the file (F1.1) without needing the table yet.
- From C — the orphan-ref idea (`refs/heads/os-trace`) is held in reserve as the answer if the in-PR trace convention proves too weak; it is the one durable, non-deploying write path CI has.
- From A — take A's four hygiene fixes exactly as written and land them FIRST, in their own PR, before any threshold file exists. A bar computed over a suite where one file has never run, one test asserts nothing, and the allowlist's own defect detection is disabled in CI is a bar over a fiction.

## Requested ruling

**Ruling requested from Prez, in three parts. A yes to all three is one decision.**

**1. Locus.** Adopt Option B: the acceptance thresholds for both factories live in two versioned files — `os/factory/ACCEPTANCE.product.json` and `os/factory/ACCEPTANCE.model.json` — enforced by one new required check, `factory-acceptance` (`scripts/check-acceptance.mjs`), reading PR #362's `proof-contract.json` as its evidence source. Not the GitHub ruleset alone (A), not a ledger-backed artifact stream yet (C).

**2. The numbers.** Ratify these as the stated bars, on the understanding that all six model numbers and the two mutation numbers are provisional until first measurement and may be RAISED freely afterward:
- *Product-code, probabilistic bar*: scenario reliability ≥0.95 (tier M) / ≥0.90 (E) / ≥0.80 (C) at 95% confidence, realized as 60 / 30 / 15 consecutive clean randomized-seed scenario runs.
- *Product-code, supporting bars*: patch coverage 90/85/80% on changed lines; stryker mutation score 75 (M) / 60 (E) on changed modules.
- *Model*: n ≥ 300 sides and 500 props; Brier Skill Score vs the book no-vig probability with a 95% bootstrap lower bound > 0; ECE < 0.05; |bias| < 0.03; mean CLV 95% bootstrap lower bound > 0 over ≥200 rows; ≥70% of walk-forward folds passing; leakage = 0, quarantine < 5%, `auditVersion` 100% non-null. **ROI is reported and never gates.** The current `ACCURACY_HARD_FLOOR: 0.70` and `ROI_FLOOR: 0.0` in `server/mlbPublicationGate.ts:110-112` are retired as unfit for -110 markets.

**3. The change rule.** Any number may be raised in any PR. Lowering requires a PR that touches only the acceptance file and carries a `dr` reference, an `INCIDENTS.md` entry, and an `expiresAt` ≤ 30 days, after which the checker fails until the number returns or the DR is renewed. Three lowerings of one metric inside 90 days hard-fails and forces the metric to be redesigned. `bundle-budget.json`'s `allowanceBytes` (raised 9 times, 5,120 → 11,776) migrates into this regime. Model thresholds freeze for a market family once that family publishes.

**What a yes commits Prez to:**
- Executing two ruleset edits himself (the checker cannot): promote `DB Tests` and `Build & Preview Gate` to required now, and add `factory-acceptance` + `scenarios` when they first go green. Agent sessions cannot edit branch protection.
- Accepting that a lowered threshold expiring will break CI on a day he did not plan for — that is the mechanism, not a bug.
- Accepting that some markets will read `INSUFFICIENT_DATA` or `BACKTEST_ONLY` for months, and that DR-001's posture must be honest about that rather than publishing anyway.
- Accepting ~4–8 additional CI minutes per tier-M PR for the scenario repetition matrix.
- Accepting that PR #362 merges first and that its ROLLOUT waves become dated obligations in `os/factory/REQUIRED-CHECKS.json` rather than open-ended intentions.

**What a yes does NOT authorize:** no merge to `main` (merge is a production deploy and stays his action), no schema change, no production data mutation, no change to the 3-model allowlist, and no agent authority increase of any kind.

## Depends on

- DR-001
- DR-002
- DR-003
- DR-004
- DR-005

## Open unknowns

- **The `modelProb` precision defect is load-bearing on the model factory and unresolved.** `drizzle/schema.ts` declares `modelProb decimal(5,2)` documented "(0-100)" while `mlbMultiMarketBacktest.ts:889` writes a 0–1 probability; scale 2 quantizes every probability to 1-percentage-point buckets, which would corrupt every Brier and therefore every BSS the model gate computes. *Resolves via:* one read-only production `SELECT DISTINCT modelProb FROM mlb_game_backtest LIMIT 50`. If confirmed, gate 2 cannot be trusted until the column is widened (a schema change, db-push-first) and the affected rows are recomputed.
- **Whether CLV coverage supports the n ≥ 200 floor per market family.** `mlb_game_backtest.clv` / `closingOdds` / `closingOddsOpposite` are permanently NULL in production; the 7,632 CLV backfills live only on the unpushed `local/audit-mlb-model-2026`. *Resolves via:* a read-only `SELECT market, COUNT(clv) FROM mlb_game_backtest GROUP BY market` after DR-003 lands. Until then gate 4 must report `not_measured`, not pass.
- **Whether the provenance discriminator arrives from DR-003 or must be added here.** Gate 6 and scenario SC-02 both require distinguishing live-pregame from walkforward-replay rows; no column, enum, guard or discriminator exists in shipped code (F5.1), and the unique key `(gameId, market)` means a re-run silently UPDATEs the original (F5.2). If DR-003's branch carries the regime, this DR consumes it; if not, this DR needs an owner-gated schema change and its model half slips.
- **No mutation-score baseline has ever been measured on tiers M or E.** `stryker.conf.json` (PR #362) mutates 5 modules with `break: 60` and runs advisory-only in the nightly workflow; the ROLLOUT plan requires 2 clean nightlies before it even becomes an advisory PR job. The proposed 75 (M) / 60 (E) numbers are therefore estimates. *Resolves via:* two nightly runs post-merge of #362; ratify or adjust in the first threshold-raise PR.
- **CI-minute cost of the scenario repetition matrix is unmeasured.** 60 randomized-seed repetitions of SC-01 against the MySQL service container could plausibly run 4–8 minutes or 20; if it lands at the high end the reliability count must drop (with the confidence claim dropping honestly alongside it) or the scenario corpus must shrink. *Resolves via:* one timing run on a draft PR.
- **Whether the owner's CI model-spend pause permits any LLM-judge rubric.** The untracked display-copy rubric (`docs/ai-native/factory/display-copy-rubric.md`) and its scorer (`scripts/rubric-agreement.mjs`, Spearman ≥ 0.7, zero grader-passes-human-auto-fail) are the only probabilistic *judgment* machinery in the repo — and they need both model calls and **two human raters per sample**, which a one-founder company cannot supply. This DR therefore keeps the probabilistic bar entirely deterministic-computable (scenario reliability, mutation, bootstrap intervals). If Prez lifts the pause, the rubric becomes an additional tier-C bar; it is not one now.
- **The working tree does not typecheck.** `server/_core/aiCostMeter.ts:20` imports `aiWorkflowCosts` from `drizzle/dime.schema`, which has no such export. Nothing in this DR can land until that is fixed (DR-003 scope). *Resolves via:* removing the import or restoring the export in the dark-state rescue PR.
- **Whether `docs/verification/RULESETS.md`'s end-state list is complete.** Its required-check target omits `DB Tests` and `Build & Preview Gate` entirely — the two checks the audit identifies as the highest-value advisory-to-required promotions (F6.1). Unclear whether this is a deliberate judgment (01-pr-proof-contract subsumes the build + bundle budget; DB suites stay in ci.yml) or an oversight. *Resolves via:* one question to the PR #362 author, or by reading `docs/verification/AUDIT.md` §division-of-labor in full.

---

## Ruling — 2026-08-07

**RULED: cut upheld.** the two ACCEPTANCE files and the `factory-acceptance` check is not built and will not be built under this record.

DR-014 Ruling 1 cut this as ~90% duplicative of PR #362. Verified 2026-08-07 and the basis is now STRONGER than when written: #362 is CLOSED and shipped as **#371, merged 2026-08-05T14:22:58Z**. The duplication DR-014 cited is no longer an open PR competing for the same ground — it is merged, running code.

**Recorded by:** the executor, on Prez's 2026-08-07 instruction to proceed with the four cuts
(DR-007, DR-010, DR-011, DR-013). The decision is Prez's; the rationale above was drafted by the
executor from DR-014 Ruling 1 and the 2026-08-07 freshness audit, and is recorded here rather than
left implicit so a future cycle can tell whether the reasoning still applies. **Amend this paragraph
before merge if it does not match your reasoning** — per `os/decisions/README.md`, a ruling is the
durable answer to *"why is it like this?"*, and it should be in your words where they differ from
mine.

This ruling does not reverse anything, so nothing is superseded. Reopening requires a new record
citing what changed.
