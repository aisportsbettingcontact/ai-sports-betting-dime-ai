# AI-Native Audit — Dime AI, 2026-08-05

Stage 1 of the 100% AI-Native mission · DRI: Prez · Auditor of record: Fable 5 (executor)
Baseline: `origin/main` @ `fb1d4024d` · Working tree also inspected at `245424de`
Method: 13 parallel forensic claim-cluster verifiers + 71 adversarial re-checks (84 agents,
6.13M tokens, 2,429 tool calls, 0 errors) + direct file reads by the executor.
Claim labels per `OPERATING-RULES.md` §Claims and doctrine §19.

---

## 0. Executive verdict

**Dime AI scores Level 2 on the D1 four-level scale, with two genuine Level-3 fragments and one
uniquely strong Level-4 asset that has never been committed to git.**

The company has unusually good *raw materials* — a real evaluation math library, a real closing-line
capture scheduler, a real defense-in-depth compliance gate, a real append-only artifact-ledger
design, a real forensic model audit, and a genuinely disciplined evidence culture. What it does not
have is a **closed** loop anywhere that matters. Work is produced at extraordinary volume (366 PRs
in 28 days, ~13/day) and then its outcome is never observed by any system.

The single most important structural finding is not any individual gap. It is this:

> **Dime has already attempted this exact transformation once, produced high-quality work, and the
> work died at the last mile.** On 2026-07-28/29 a prior program built a complete closed-loop slice
> with 32 adversarial tests, an artifact envelope, a tamper-evident ledger, an 11-gap forensic
> audit, a 9-loop registry, and a software factory. Eight days later **not one byte of it is in
> git.** Its next-action queue has five owner-gated items, untouched. Its own incidents were never
> filed. Its state file has no mechanism to notice any of that.
>
> The failure mode was not sloppiness — the labeling discipline was rigorous. The failure mode was
> that "owner-gated" was treated as a terminal state instead of a loop stage, and **eight days of
> silence produced no signal anywhere.** *(D5: an open loop fails silently when inputs shift.)*

That is the failure this mission must design against, and it is why the first structural act of
Stage 4 must be **making artifacts durable and making silence loud** — not building new capability.

### Three findings that need a decision before anything else

| # | Finding | Why it cannot wait |
|---|---|---|
| **U1** | **Production holds "do not publish" verdicts it is ignoring.** The 2026-07-25 forensic audit wrote 9 `publish_*` BACKTEST-ONLY rows into production `mlb_calibration_constants`. The code that reads them was never merged, so the platform publishes all 9 markets anyway, fail-open. The audit's own verdict: "do not sell edges the data does not yet support." | Live customer-facing claims contradict Dime's own evidence. This is a compliance and trust exposure, not an architecture gap. |
| **U2** | **Three contradictory price sets ship on the same page.** Live checkout charges Pro $49.99 / Sharp $99.99 / Max $199.99. The objections block on the same page sells "$99 a month… ≈ $3.30 a day" and names a tier ("Operator") that no longer exists. The bot-facing schema.org JSON-LD tells Google Pro $99 / Sharp $249 / Operator $499. | A prospect reads ~2× the real price; a search engine indexes a third set. Structured data misstating price is exactly what the landing page's own HONESTY LAW exists to prevent. |
| **U3** | **The MLB forensic audit exists only on one laptop.** Branch `local/audit-mlb-model-2026` — **26 commits ahead of `main`, never pushed to any remote** — holds the forensic audit, backfill tooling, model fixes, walk-forward replay, the **provenance regime**, and the publication-gate wiring. It mutated production data on 2026-07-25 (13,408 regrades, 8,464 new ledger rows, 7,632 CLV backfills). Alongside it: 52 GB of evidence corpora, `docs/ai-native/`, and ~78 KB of finished evaluation code, all untracked. | Disk failure destroys the audit *and* the only record of what was done to production. No one else can re-run or verify those mutations. |

> **Correction (executor, VERIFIED 2026-08-05).** An earlier draft of this audit stated "837 commits"
> for this branch. That was wrong — the verifier reported the count in the wrong direction.
> `git rev-list --count local/audit-mlb-model-2026 ^main` → **26**;
> `git rev-list --count main ^local/audit-mlb-model-2026` → **839**. The branch is 26 commits of
> audit work atop an older `main`. Tip: `8190a7d96`, 2026-07-29. `git branch -r --contains` → empty,
> confirming it was never pushed. The dark-state finding stands; only its magnitude was overstated.
> Logged here rather than silently edited, per `OPERATING-RULES.md` and
> `os/memory/lessons/numbers-in-narratives-are-usually-generated.md` — which this audit's own output
> just violated.

---

## 1. D1 — The central test and the four-level score

### The central test

> *Does this merely use AI to accelerate individual tasks, or has it redesigned how information,
> work, evaluation, and responsibility move through the company?*

**Answer: ACCELERATED, not redesigned. [VERIFIED]**

AI acceleration at Dime is extreme and real — 366 PRs in 28 days from one human, a ~200-skill
arsenal, two agent runtimes, 3,778 vitest cases. But the four movements the test names are each
open:

- **Information** does not move. Zero GitHub issues have ever been opened (`gh issue list` → empty,
  28 days, 366 PRs). Every problem statement, decision, and follow-up either lands in a PR body and
  is archived on merge, or in a markdown file no machine reads.
- **Work** produces artifacts inconsistently. Six cron jobs run and **not one writes a run record.**
  `CronJobRunner.lastResult` is process memory, erased on every deploy — and this repo redeploys
  ~13×/day.
- **Evaluation** is computed and discarded. ~2,500 lines of evaluation tooling
  (`mlbBacktestAuditCore`, `mlbCalibrationAudit`, `mlbWalkForwardValidator`, `mlbSegmentationEngine`,
  `mlbPublicationGate`) has been dead since 2026-05-23 — reachable only from a single test file.
- **Responsibility** is uniformly Prez, which is correct for a one-founder company, but it is
  nowhere *recorded* against an outcome outside one untracked YAML file.

### Four-level score

| Level | Definition | Dime | Evidence |
|---|---|---|---|
| 1 | AI as occasional utility | **exceeded** | Agents are structural, not occasional |
| 2 | **AI embedded in workflows still designed around human coordination** | **← CURRENT** | Every gate, queue, and decision routes to Prez with no mechanism to age, remind, or escalate. `execution-state.json` next_action_queue: 5 items, all blocked on item 1, untouched 8 days |
| 3 | AI connecting workflows across functions | **2 fragments only** | (a) Stripe → Discord role sync (billing → access); (b) game FINAL → outcome ingest → Brier → drift → engine patch. Both are single-hop and neither is evaluated |
| 4 | Company organized around the intelligence | **1 asset, uncommitted** | `shared/loop/` + `server/loop/` implements Context/Action/Artifact/Outcome/Evaluation with 32 adversarial tests — and is dead code that has never closed a cycle outside a 293 ms test run |

**Score: Level 2. [VERIFIED]** Not Level 3, because the two cross-function connections do not
evaluate their outcomes; and one of them (drift → self-patch) is precisely the "uncontrolled
automation" D2 warns of.

---

## 2. D2 — The six-element map

| Element | State | Evidence | What is actually missing |
|---|---|---|---|
| **1. Human goals** | ⚠️ PARTIAL | Goals exist as prose: one "compounding objective" + 9 `objective:` strings in `docs/ai-native/loop-registry.yaml` (untracked) | No goal *record type* anywhere. No schema, no id, no owner field, no target metric bound to a threshold, no review date, no status transition. `artifactTypeSchema` has 11 artifact kinds; none is a goal |
| **2. Accessible context** | ❌ WEAK | Real stores exist (TiDB, 59 `mysqlTable` defs, event tables incl. `payment_events`, `odds_history`, `mlb_game_backtest`, `dime_chat_trace_events`) | Retrieval is tool-by-tool, never by goal/owner/outcome. 3,136 `console.*` calls → ephemeral Railway stdout, no retention, no query path. Zero issues. `OPERATING-RULES.md` says "read at every session start" and **no hook, script, or context root loads it** |
| **3. Agents that reason and act** | ⚠️ PARTIAL | Two real runtimes: `server/_core/dimeAgent.ts` (Claude Agent SDK subprocess), `server/_core/piAgent.ts` (in-process, 3-model allowlist enforced by a throw) | Zero charters. Zero occurrences of "charter" in the repo. No agent has declared scope, allowed tools, forbidden actions, or an escalation contract — only a hardcoded `producer` string |
| **4. Artifact-producing workflows** | ❌ WEAK | Strong where it exists: `INCIDENTS.md` (61 numbered), `docs/audits/` (16 bundles), `docs/superpowers/plans/` (29 plans) | **No cron job writes a run record.** Test failures expire in 30 days and are gitignored. `tracked_bets.result` is destructively overwritten — no settlement-event row. Discord alerts are write-only; no code can read them back |
| **5. Evaluation vs goals** | ❌ WEAK | The math is genuinely correct: Brier, log-loss, Wilson CI, no-vig, `calcCLV`, `calcEdge`, `calcEV`, walk-forward folds — all unit-tested | ~2,500 lines dead since 2026-05-23. `mlbPublicationGate` computes SAFE_TO_PUBLISH and **authorizes nothing**. CLV is permanently NULL in production. Log-loss is never persisted. Three of the gate's seven checks read columns production never writes |
| **6. Named human ownership** | ✅ ADEQUATE | Prez is DRI of everything; `ownerProcedure` enforces it in code; the fixture gate correctly refuses self-approval | Recorded only in one untracked YAML. No `AUTHORITY.md`, no rung for agents, no per-action authority table |

### Diagnosis against the D2 element pattern

Three of the six failure patterns are live at Dime right now:

- **Action without evaluation → uncontrolled automation.** `server/mlbDriftDetector.ts` detects
  drift and **rewrites `MLBAIModel.py` constants in place on disk**, automatically, with no proposal
  record, no approval, and no version stamp. A bad recalibration ships itself. *(Still true 8 days
  after it was first documented; `git log` shows no commit has touched the trigger path.)*
- **Evaluation without memory → the same lesson relearned.** `mlb_drift_state` is *upserted* on
  every drift check — prior state destroyed. `mlb_model_learning_log` records before/after accuracy
  with **nothing attributing it to a model version**, so "did the last recalibration help?" is
  structurally unanswerable.
- **Context without action → a searchable archive.** `todo.md` is 4,550 lines / 3,604 checkboxes
  (781 open), append-accreted since 2026-04-16, unlinked from every context root.

---

## 3. Claim ledger — `<dime_current_state>` verified claim by claim

110 claims tested. **31 VERIFIED · 39 PARTIALLY_VERIFIED · 40 REFUTED.** Every REFUTED and
PARTIALLY_VERIFIED verdict was independently re-checked by a second agent instructed to refute it;
71 re-checks produced 8 disagreements, all in the direction of *upgrading* a verdict (the primary
auditors were slightly too harsh in 8 places, never too lenient).

### 3.1 REFUTED — claims with no basis in the repo

| Claim | Reality | Evidence |
|---|---|---|
| **Next.js** in the stack | Absent. No `next` package, no config, no router | The 3 surviving mentions are a stale `.gitignore:90` entry and a migration report recording the decision *not* to use it. Trap: `next-themes` is framework-agnostic |
| **Vercel Pro** infra | Absent in every form. No `vercel.json`, no `.vercel/`, no deploy workflow, no env vars | Railway is the sole host and has been since 2026-07-11; `CLAUDE.md:217`, `AGENTS.md:105`, `references/railway-deploy.md:17` all say so. The claim describes an architecture the repo explicitly retired |
| **Temporal** as durable spine | Absent — and **not even in a Dime design doc** | Zero occurrences of `temporalio` anywhere incl. the lockfile. Every "temporal" hit is ordinary English about point-in-time correctness |
| **Pydantic AI** | Absent | Only base `pydantic==2.13.4`, transitive, in the DORMANT ML lane's lockfile |
| **Mastra** | Absent | Not a dependency, imported nowhere. Trap: thousands of hits are Wikipedia dumps in `scripts/data/nfl-db/cache/` |
| **OPA** for policy | Absent | Zero `.rego` files, no binary, no SDK. Traps eliminated: `opacity` (233 hits), `Oregon` |
| **LiteLLM ~70/25/5 routing** | Absent — **and repo policy is the opposite** | Every surface pins one model (`claude-fable-5`); `piAgent.ts:57` *throws* on off-allowlist models; `LLM.md:15` forbids cheaper-tier routing. Building 70/25/5 means **reversing code-enforced policy**, not adding a router |
| **llm-builder-os** plugin (13-state machine, 17 agents, 32 skills) | Entirely absent — not installed, not vendored, not referenced | The string exists nowhere on this machine outside the mission prompt itself. Not in `.claude/settings.json`, not among 65 installed plugins, not among 9 known marketplaces |
| **32-seat Dime Mint™ team**; The Press / Assay Office / The Reserve | **No design document exists, on any branch, ever.** Zero seats enumerated | `git log --all -S` across 4 terms → empty. "Assay" has **zero** occurrences repo-wide. "Mint" refers only to brand accent `#45E0A8` |
| **NCAAM 82.6% OVER-bias incident** | Does not exist | No `.md` file contains "82.6". `INCIDENTS.md` has 61 entries, none about model bias, none about NCAAM |
| **Bet Grader / CLV Auditor** wedge | **NOT BUILT** | What exists is a manual-entry Bet Tracker that settles to WIN/LOSS and reports ROI. Missing all three wedge requirements: no import path, no CLV on a user's bet, no "audit my last N" surface. `parlayGrader.ts` is parlay-leg settlement |
| **Transparency-first: failures published** | Refuted as a product surface | Every grading view is behind `RequireOwner`. No changelog, no accuracy history, no build-in-public surface. Landing copy sells the grading as "the record" — a record no paying customer can read |
| **Nine subscription states** | No such enum | Three non-overlapping vocabularies: a `varchar(32)` whose comment lists 8 raw Stripe statuses; `PlanStatusState` with 4 members; `SubscriptionKind` with 11 (transitions, not states). Code decides on 5 |
| **Provenance controls separating live-pregame from walkforward-replay rows** | **No mechanism at all** | No column, no enum, no guard, no discriminator. A re-run silently `UPDATE`s the original row in place — a replay is indistinguishable from, and destroys, the original |
| **Public signup does not exist** *(project memory)* | Refuted — a full anonymous pay-first path is shipped | `/checkout` → `publicCreateEmbeddedCheckoutSession` → webhook `createPendingUserFromCheckout` → `completeAccountSetup`. What doesn't exist is a *free* signup |
| **Seven hard gates / banned "AI slop" voice standard** in the Dime 1.0 SFT pipeline | Conflation of two unrelated pipelines | Dime 1.0 has 11 hard failures / 15 machine gates / 6 pass-fail dimensions and **no voice standard**. The "four scored dimensions + banned slop" belong to the *untracked* AI-native display-copy rubric (faithfulness / uncertainty_honesty / actionability / brand_tone; bans "elevate" and "unlock") |
| **Rules 1/2/3** as architectural rulings | Rule 6 is real (`OPERATING-RULES.md:20`). Rules 1/2/3 as described are not | The Apple/logo/no-invention rules live only inside a **verbatim transcript dump of a one-off owner prompt to Codex** (`docs/audits/2026-07-11-dime-shell/…:57-64`). It has 4 rules, no Rule 6, and nothing cites it |
| **91/100 composite, two hard blockers open** | Number unsourced; blockers **CLOSED** | No "91/100" exists in the repo, in PR #70's body, or its comments. Both blockers were remediated 2026-07-12 on `remediation/pr70-hotfix` |
| **"webapp-testing harness"** | Not a Dime artifact | It is an unmodified upstream Anthropic skill in a gitignored pi cache. Dime's real harness is TypeScript Playwright: 2 configs, 8 specs, 38 tests |
| **NBA / NCAAM / NFL have model code** | None of the three | NBA: ingestion only. NCAAM: **model was deleted** (commits `e0139d4c2`, `14efcf865`), leaving 2 orphan tests. NFL: dataset build only, zero projection code |

### 3.2 Materially corrected — true but not in the stated form

- **"Python ML engine."** There is **no machine learning anywhere in the sports pipeline.**
  `requirements.txt` is numpy, scipy, pandas, requests — nothing else. The engines are Monte Carlo
  over analytically-specified distributions with constants **fitted offline and pasted into source**
  (`StrikeoutModel.py:12` `NegBin Dispersion (r = 22.20)`; `:22` `kProj_cal = 1.0305 * kProj_raw +
  0.3314`). The only ML libraries in the repo belong to the DORMANT LLM lane. Accurate name:
  *Python simulation engine*. **[VERIFIED]**
- **400K Monte Carlo iterations.** Exactly 400,000, `server/MLBAIModel.py:68`, real RNG sampling.
  **[VERIFIED]** — one of the few numeric claims that survived.
- **Dixon-Coles for soccer.** The math is genuine and shipped, but it is **JavaScript**
  (`server/wc2026/v27_jul18_engine.mjs`), not Python, and hardcoded to two 2026 World Cup fixtures
  **already played**. Its own header advertises a "500X Monte Carlo backtest" and the file contains
  **no RNG at all** — the repo already guards the chat layer against repeating that claim.
- **"TypeScript monorepo."** TypeScript yes, strictly (one `tsconfig`, 685 files, `tsc --noEmit`
  gated). **Monorepo no** — one `package.json`, no workspaces, no turbo/nx/lerna. Also 131 tracked
  Python files.
- **"Six sports."** Real models: MLB and NHL. Soccer is a fixture-specific WC2026 engine. **Off by
  three.**
- **TiDB Cloud.** Correct and *more* specific than `CLAUDE.md`/`AGENTS.md`, which say only
  "Drizzle/MySQL". That vagueness is now dangerous: a **separate Railway `mysql:9.4` service literally
  named "MySQL: Dime AI"** exists in the same project, and two authored specs give opposite answers
  about which database is canonical for the largest planned dataset.
- **"28 landing assertions."** Real assertions exist and are CI-gated, but the count is 14 cases /
  38 `expect()`s across two suites.
- **Atomic credit reservation/settlement.** There is no reservation/settlement *pair* — a single-phase
  post-hoc deduction. The deduction itself **is** properly atomic (`db.transaction` + `SELECT … FOR
  UPDATE` + integer-only append). But the charge happens *after* the answer streams, so a lost race
  or crash yields a free answer; and the `request_id` uniqueness that prevents double-charging **is
  declared in Drizzle and explicitly absent in production**.
- **"Full webhook lifecycle."** 14 event types handled — broad, not full. Materially: only 8
  access-changing types get await-then-5xx; the other 6 are acked 200 *before* processing, so a crash
  loses the event permanently. **The claim-before-process ordering neutralizes the deliberate
  5xx-invites-redelivery design.**

### 3.3 VERIFIED — real strengths to build on

These survived adversarial re-check and are the mission's genuine assets:

1. **The Dime Chat compliance gate is excellent engineering, not disclaimer theater.** Four layers:
   prompt rules → pre-generation distress screen → **post-generation certainty screen on the model's
   own output that withholds the whole answer** → zod verdict validator with freshness and
   provenance requirements. Applied redundantly across all three answer paths, with fallback
   ordering that makes a certainty violation always hard-block. This is the best-built thing in the
   repo.
2. **Anti-tout positioning is verified across all four customer-facing layers** and is used as the
   product's core argument, not a disclaimer. Governed by a documented HONESTY LAW with a claim
   whitelist. One live proof of discipline: `CREDITS_NOTE` is set `show: false` with the comment
   *"Advertising a monthly allowance the code never provisions is a claim we cannot honour at
   checkout."*
3. **Responsible-gaming posture** present and consistent on every marketing surface, and extends
   into runtime via jurisdiction-aware distress resources.
4. **The evaluation math is correct and unit-tested** — Brier, log-loss, Wilson CI, no-vig, CLV,
   edge, EV, walk-forward fold geometry. Choosing the model loop as first loop means **wiring
   existing correct code, not writing new math.**
5. **Closing-line capture is genuinely shipped** — a 5-minute scheduler locks DK closing odds at
   first pitch, once per game, idempotently. That is the expensive half of a CLV system.
6. **`shared/loop/envelope.ts` + `ledger.ts` is the best artifact primitive in the repo** — 11 typed
   artifact kinds, four distinct timestamps, resolvable source refs, sha-256 content hash over a
   canonical view that excludes processing time so replays dedupe, append-only prev-hash chain,
   refusal of fabricated hashes and unresolved citations. Adversarially tested. **Untracked.**
7. ~~**`gitleaks` is genuinely blocking** — one of exactly 4 required status checks on `main`.~~
   **CORRECTED 2026-08-05 — this was wrong, and the correction is a finding.** `main-protection`
   (ruleset `18701573`) requires exactly **three** contexts: `Security Audit`, `TypeScript Check`,
   `Vitest`. The gitleaks workflow declares job name `Secret Scan (gitleaks)` and is **not among
   them**. `Security Audit` is a job in `ci.yml` that runs the GitHub-Actions security contract and
   `osv-scanner` — **it performs no secret scanning at all.**
   Net: **gitleaks runs on every PR and fails its own workflow, but does not block a merge.** The
   remediation for SEC-006 ("Production credentials committed to git history", 23 credentials) is
   advisory. The workflow itself is well-built — no failure suppression, fingerprint-scoped ignores
   that cannot mask future findings — it simply is not wired to the gate. Filed as **F6.10**.
8. **The test harness is better than typical** — `check-environment-failures.mjs` is a real
   executable gate, `dbSuiteRegistration.test.ts` exists specifically to break when a DB suite is
   half-wired, the bundle-budget script carries a documented negative control.
9. **A real admin dashboard exists** (14 destinations, product-analytics suite, versioned metric
   definitions with an anti-fabricated-zero contract). It covers product/user; it does **not** cover
   cron health, deploy health, AI cost, or model attribution.
10. **PR #362** (`ci/verification-framework`, open) installs a ten-layer fail-closed verification
    framework — proof contract, CodeQL, semgrep, zizmor, patch coverage, PR-time docker build +
    trivy + SBOM + smoke, property tests. This is most of a software-factory acceptance layer,
    already built, awaiting merge.

---

## 4. Asset inventory mapped to the eight layers (D12)

| Layer | Exists today | Grade | Critical missing piece |
|---|---|---|---|
| **L1 Goals + ownership** | 9 prose `objective:` strings; `ownerProcedure` in code | ⚠️ | No goal record type. No metric bound to a threshold. No status transition |
| **L2 Artifact system** | `INCIDENTS.md` (61), `docs/audits/` (16), `docs/superpowers/plans/` (29), event tables | ⚠️ | Append-only is **convention with zero enforcement**; Status lines are mutated in place. No cron writes a run record. 5 audit bundles untracked |
| **L3 Queryable context** | TiDB, `debug_logs`, `analytics_events`, admin panels | ❌ | Retrieval is tool-by-tool. Zero GitHub issues. `OPERATING-RULES.md` loaded by nothing. 3,136 console lines to ephemeral stdout |
| **L4 Specialized agents** | 2 runtimes, ~200 skills, 61 plugins | ❌ | **Zero charters.** Zero occurrences of "charter". No scope/tools/escalation for any agent |
| **L5 Execution tools** | 3-model allowlist enforced by throw; `ownerProcedure`; 12 Railway MCP mutations hard-denied | ⚠️ | No `AUTHORITY.md`. The only graduated ladder is 2 hardcoded strings inside a fixture engine |
| **L6 Evaluation** | Correct math, 3,778 vitest cases, required gitleaks | ❌ | ~2,500 lines dead since 2026-05-23. Publication gate authorizes nothing. **DB Tests and Build & Preview Gate are advisory, not required** |
| **L7 Memory + improvement** | `INCIDENTS.md`, `docs/remediation/` | ❌ | Lessons attach to nothing. `mlb_drift_state` upserted (prior state destroyed). CI evidence expires in 30 days |
| **L8 Human governance** | Prez owns everything; `RequireOwner`; deny-lists | ⚠️ | Governance exists as prose in files no machine reads. No policy enforcement surface |

**Layer score: 0 implemented · 4 partial · 4 weak.**

---

## 5. Prior art — what the mission builds on, and what it must not repeat

`docs/ai-native/` (17 files) + `shared/loop/` + `server/loop/` (3,351 lines total, 22 files).
**All untracked. `git log` on those paths is empty. Unchanged since 2026-07-29 00:02.**

**Build on** *(highest-value reusable assets)*:
- `shared/loop/envelope.ts` + `ledger.ts` — the artifact + append-only-ledger contract
- `loop-registry.yaml` — 9 loops with status / gap / DRI / approver / escalation, already good shape
- The factory work-packet template + its 13-class defect taxonomy
- The honest `{state, value, reason}` query vocabulary (`not_measured` / `incomplete` / `stale`)
- `current-state-audit.md`'s G1–G11 gap list — **spot-verified today, still accurate 8 days later**

**Must rebuild**: persistence of any kind (nothing survives a process exit — the JSONL writer is
implemented, tested, and never called); the apply/promote step after approval (**approving a
proposal currently causes nothing to happen**); a goal record type; agent charters; a token ledger
with emitters; a founder dashboard.

**Must fix before salvage**: the working tree **does not typecheck** —
`server/_core/aiCostMeter.ts:20` imports `aiWorkflowCosts` from `drizzle/dime.schema`, which has no
such export (collateral damage from the Incident-43 column revert). Any attempt to commit as-is
fails CI. **[VERIFIED — reproduced: `tsc --noEmit` → EXIT=1]**

### Corrections to the prior program's own claims

The prior program **oversold its evening "queue execution round."** `execution-state.json:6` and
packet 003 claim the grader emits CLV/leakage/attribution, the recalibrator is propose-gated, and
cost emitters are wired. **All false.** The six modules exist and cross-import each other, but every
integration point is absent: no import of them in `mlbMultiMarketBacktest.ts`, `mlbDriftDetector.ts`,
or `mlbModelRunner.ts`; the claimed tRPC procedures were never written; `package.json` still runs the
old test command. **Only packet 002's one-line vitest glob change landed** — and even that is not on
`main`. Treat every `IMPLEMENTED_UNVERIFIED` in that file as **"written to disk, never integrated."**

Two further self-inconsistencies, both instances of the failure mode the program existed to find:
- `current-state-audit.md:54` and `execution-ledger.md:31` assert *"INCIDENTS.md (40 numbered, none
  OPEN)"* — wrong on both counts even at their own date; Incidents 21 and 39 were already OPEN.
- `execution-ledger.md:60` asserts *"Incidents 41, 42, 43 all RESOLVED with evidence in
  INCIDENTS.md."* **That citation is false.** See §6.

---

## 6. The incident-number collision *(newly discovered, and structurally important)*

Two concurrent sessions on 2026-07-28 both allocated incident numbers 41–43.

- `INCIDENTS.md` 41/42/43 belong to the **Trace v1** workstream (sandboxed git fetch, zsh unmatched
  quote, zsh nomatch glob) — all RESOLVED.
- The AI-native program's own 41/42/43 (env-gate stale allowlist entry, gated-runner race,
  schema-first `games` column regression) **were never filed.** `grep -ni
  'ai-native|shared/loop|projectionLoop|recalibration gate|cost meter' INCIDENTS.md` → **zero hits
  across all 61 entries.** They survive only in untracked prose.

**Why it matters beyond bookkeeping:** `loop-registry.yaml` declares `escalation: INCIDENTS.md entry`
for all nine loops. The program's own escalation path was never exercised, and it cited the register
as evidence anyway. `INCIDENTS.md` has **no number-allocation mechanism and no enforced append-only
check**, so concurrent writers silently overwrite each other's numbering. Project memory recorded
"Incidents 41/42 OPEN" — that memory has now been corrected.

---

## 7. Conflicts between the mission brief and repo reality

Per `<source_boundary>`, flagged rather than silently resolved:

| Conflict | Resolution proposed |
|---|---|
| Brief: "Railway Pro + Vercel Pro". Repo: Railway-only since 2026-07-11, stated in three places | **Adopt the repo.** Amend the brief. Vercel does not exist here |
| Brief: build on Temporal / Pydantic AI / Mastra / OPA / LiteLLM. Repo: none present, none planned in any doc, **and LiteLLM tiering contradicts code-enforced model policy** | **Do not adopt the named stack as given.** D12-L5/L8 require *graduated authority* and *a policy enforcement surface* — not specifically OPA. D10 requires *spend justified per accepted outcome* — not specifically LiteLLM. Stage 2 will put the real choice to Prez as a decision record |
| Brief: 32 Mint seats designed. Repo: no design exists | **Build the roster from the loop registry.** Doctrine L4 is explicit that seats without a loop to serve are deferred. Designing 32 seats before there are 32 loops would invert the doctrine |
| Brief: Bet Grader is the GTM wedge. Repo: not built; closing-line data is MLB-only and joined to the model path, not to `tracked_bets` | **Keep it as the wedge, treat it as unbuilt.** Honest build estimate: bet ingest path + **bettor-side** CLV formula (price-obtained vs closing — the existing `calcCLV` computes model-vs-close, a different quantity) + a `tracked_bet`→closing-line join + non-MLB closing-line coverage |
| `<thesis>` block arrived as an unfilled placeholder | **Proceed on D1–D16**, which is complete and self-describes as the operative law. Primary source independently identified (Diana Hu, YC) and already registered by the prior program |
| `CLAUDE.md:208` says `DIME_CHAT_LLM_PROVIDER` "must stay frozen"; `:210` says it is "anthropic"; code says `"anthropic"` | **Code wins.** `CLAUDE.md:208`, `docs/ai-native/execution-ledger.md:26`, `docs/runbooks/2026-07-29-…:46`, and `references/pi-harness.md:108` are all stale and should be corrected |

---

## 8. What this audit could not determine — UNKNOWN

Stated plainly per doctrine §19, with what would resolve each:

- **Whether production is currently serving projections for the 9 BACKTEST-ONLY markets.** Code
  analysis proves nothing reads `publish_*`; confirming customer impact needs a production read.
  *Resolves via:* a read-only query against `mlb_calibration_constants` + one live page check.
- ~~**Which Railway builder actually runs.**~~ **RESOLVED 2026-08-05 — the Dockerfile.** One
  build-log read settled it, exactly as this entry predicted it would. The live deployment shows
  named Docker stages, a real `apt-get install python3 python3-numpy python3-pandas python3-scipy`,
  and an OCI image digest, with **zero occurrences of `railpack`/`nixpacks`**. The `RAILPACK` value
  in the service config is stale persisted dashboard state that `railway.json` overrides at deploy
  time. **There is no ENOENT risk; the Python runners work.** The "~74 s deploy is suspiciously
  fast" reasoning in the original entry was also wrong — the apt layer is Docker-layer-cached.
  Full finding: `os/audits/2026-08-05-builder-resolution.md`. *Original text:* `railway.json`
  declares `DOCKERFILE`; live service config for both services reports `RAILPACK`. If RAILPACK wins,
  the Python runners hit the exact `spawn /usr/bin/python3 ENOENT` the Dockerfile exists to prevent.
  *Resolves via:* one build-log read.
- **Whether product analytics events are landing.** The pipeline is fully built and
  **default-disabled with a silent drop path**. *Resolves via:* reading env on the two Railway
  services (forbidden to this executor by repo law).
- **Whether the RunPod endpoint is truly decommissioned.** Asserted in two places; the control plane
  401s on the available credential. Materially, `ml/dime-1.0/configs/platform_contract.json` still
  names RunPod as the compute platform and lists `"anthropic"` as an **excluded** provider — the
  exact opposite of the 2026-08-04 owner decision.
- **The `modelProb` precision defect.** `drizzle/schema.ts:2051` declares `decimal(5,2)` documented
  "(0-100)"; `mlbMultiMarketBacktest.ts:889` writes a 0–1 probability. Scale 2 would quantize every
  probability to 1-percentage-point buckets, corrupting every downstream Brier and log-loss. Does not
  bite today only because those consumers are unwired — **it would bite the moment a release loop is
  built on that table.** *Resolves via:* one production `SELECT DISTINCT modelProb`.
- **Dime's actual AI spend.** No USD is measured anywhere. The prior program could not price its own
  ~400 K-token run and recorded it as UNKNOWN rather than estimating. This audit's own cost is
  measured: **6,134,033 subagent tokens across 84 agents** — the first Dime AI-native artifact to
  carry a real token count.

---

## 9. Stage 1 conclusion → Stage 2 entry

Dime is **Level 2**, with Level-4-quality components sitting uncommitted on one laptop. The binding
constraint is not capability and not model quality — it is that **nothing observes whether anything
worked**, and the one program that tried to fix that died silently because nothing observed *it*
either.

Stage 2 therefore opens with a decision space concentrated on three questions, in this order:

1. **Durability first** — how does work stop being dark state? (git, allocation, enforcement)
2. **Silence must be loud** — what mechanism ages an owner-gated queue and escalates it?
3. **Which loop closes first** — and does it close *end to end*, including the apply step that the
   prior slice never had?

Ordering rationale is D14: *visibility before autonomy, evaluation before scale.* Building agent
seats, a policy engine, or tiered routing before the artifact layer is durable would repeat 2026-07-28
at larger scale.

---

*Every claim in this audit carries a citation traceable to a tool result or a file. The full 110-claim
ledger with `file:line` evidence and all 71 adversarial re-checks is preserved at
`os/audits/appendix/2026-08-05-claim-ledger.md`. Gap inventory: `os/audits/gap-map.md`.*
