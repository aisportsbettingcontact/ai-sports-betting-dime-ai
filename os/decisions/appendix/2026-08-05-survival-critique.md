# Appendix — survival critique (Stage 2)

Deliberately pessimistic review: which of the ten recommendations will be dead or rotted 30 days after shipping, and why. Source of DR-014's survival-tier law and its three cuts.

## SURVIVAL CRITIQUE — which of the ten will be dead in 30 days

I measured the repo's actual response to every mechanism class these ten DRs propose. The results are worse than any of the drafts assume.

---

## 0. The survival law at Dime, measured today

Three tiers. Nothing else exists.

**Tier 1 — blocks the merge → survives.** `main-protection` ruleset 18701573: required contexts `Security Audit`, `TypeScript Check`, `Vitest`. `bypass_actors: []`. `strict_required_status_checks_policy: true`. These get fixed in minutes because 13 PRs/day cannot flow past them. [VERIFIED]

**Tier 2 — auto-loads into every session/prompt → survives.** `CLAUDE.md`: 31 commits in 30 days, touched today. `AGENTS.md`/`SKILLS.md`: 6 each, touched today. Contrast `OPERATING-RULES.md`, which declares itself *"read at every session start, non-negotiable"* and is loaded by no hook: **last commit 2026-07-08, dead 28 days.** The delta between those files is entirely whether a hook loads them. [VERIFIED]

**Tier 3 — everything else. Measured response rate: zero.**

| Mechanism | Observed | Response |
|---|---|---|
| `security-audit-weekly.yml` | **4 scheduled runs, 4 failures**, 2026-07-13 → 2026-08-03 | none, 3 weeks |
| `perf-harness.yml` | **11 of last 12 push runs FAILED, all on 2026-08-05** | founder merged ~30 PRs straight through them, same day |
| GitHub Issues | 0 opened in 366 PRs / 28 days | channel never once used |
| `todo.md` | 781 open checkboxes | last commit 2026-07-23 |
| `INCIDENTS.md` ("single source of truth") | 61 entries | last touched 2026-07-29 |
| `docs/ai-native/` | complete closed-loop slice | 8 days, then silence |

A red non-required workflow at Dime produces **zero** action. That is not inferred; it is happening right now, today, on two workflows simultaneously.

---

## 1. The set-wide defect nobody modeled

**Seven of ten DRs terminate in "…and then this becomes a required status check." That action has never been performed at this company.**

Ruleset history, all five revisions since 2026-07-08:

```
45447573  2026-08-05  ['Security Audit','TypeScript Check','Vitest']  reviews:0
45447216  2026-08-05  ['Security Audit','TypeScript Check','Vitest']  reviews:0
42747020  2026-07-10  ['Security Audit','TypeScript Check','Vitest']  reviews:0
42746653  2026-07-10  ['Security Audit','TypeScript Check','Vitest']  reviews:0
42517018  2026-07-08  ['Security Audit','TypeScript Check','Vitest']  reviews:0
```

Never expanded. Never contracted. And the two checks that were explicitly *supposed* to be promoted — `DB Tests`, `Build & Preview Gate`, the remediation for the app-shell blockers (F6.1) — are still advisory a month later. Note this also corrects the audit: those gates were never *demoted*; they were **never promoted**, which is worse, because it means the promotion step itself is the thing that doesn't happen.

Consequence: DR-005, DR-007, DR-008, DR-010, DR-011, DR-013 (and DR-004's authority gate) all share one unexercised activation step. If Prez doesn't perform it — and he hasn't, once, in 366 PRs — every one of them degrades to advisory, and advisory is measurably Tier 3.

**Only two designs route enforcement through an already-required job: DR-006 (`shared/**/*.test.ts` and `scripts/**/*.test.ts` are already in `vitest.config.ts:27-37`, and `Vitest` is already required) and DR-009 (rides `TypeScript Check`).** That is not a design detail. It is the difference between live-on-merge and waiting on a behavior with zero precedent. Every survivor should be re-homed onto those two jobs.

**Second set-wide defect: four incompatible artifact substrates.** DR-005 proposes orphan branch `os-ledger`; DR-011 proposes orphan branch `os-state`; DR-013 proposes orphan branch `os-ledger` again; DR-006 proposes `/os/` on `main`; DR-004 proposes a TiDB `loop_artifacts` table. Ship them all and Dime holds four realities — a direct D4 violation ("they may never maintain incompatible realities") committed by the program written to enforce D4.

**Third: DR-008's safety argument rests on a false premise.** It states `required_approving_review_count: 1` and "a second account already approves every merge — so an override is never truly unilateral." **VERIFIED FALSE:** `required_approving_review_count: 0`, `bypass_actors: []`. Merges come from two accounts (`aisportsbettingcontact` 27, `prez-ai-sports-betting` 3 of last 30) but **no review is required at all**. Every `os/overrides/` file DR-008 contemplates is genuinely unilateral, with no co-signer. The design isn't wrong; its stated escape-hatch safety is fiction.

**Two unknowns resolved in passing (read-only Railway config, service `a46ea921`):** `source.branch: "main"` — deploy trigger IS branch-scoped, so orphan-branch substrates are deploy-safe. And `builder: "RAILPACK"` — RAILPACK wins over `railway.json`'s DOCKERFILE declaration, which resolves audit §8's builder UNKNOWN in the dangerous direction. Also: production env holds `ANTHROPIC_API_KEY` and **no** `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`, confirming DR-012's rejection of the gateway-meter option.

---

## 2. Per-DR decay mechanism

**DR-013 — eight-loop paired activation. DEAD, highest confidence.**
Decay: *scope with no owner + escalation on a dead channel.* Eight loops, four waves, an orphan ledger branch, three scripts, a scheduled observer, a Discord slash command needing an OAuth re-invite it flags as unknown, and a Stripe-event dependency it cannot confirm will fire. Five hard DR dependencies plus PR #362. A one-founder company that just watched a **one**-loop program die in 8 days is being handed an **eight**-loop program with a wave plan. Its observer is a scheduled workflow — the `security-audit-weekly` channel, 0/4. Estimated life: W0 ships, W1 partially ships, nothing observes W2.

**DR-011 — founder dashboard. DEAD. Textbook "demos well, never used again."**
Decay: *depends on a human reading something, through a channel with zero uses in company history.* Escalation is a GitHub issue — 0 issues in 366 PRs. The DR proposes to *instrument* whether that channel works by writing the instrumentation into the artifact the channel delivers; that is circular. Freshness gate is a fifth required check, explicitly sequenced behind PR #362's unmerged Wave 1. Panels 6, 7, 8 render `not_measured` on day one. Nine panels, six checks, ~9 scripts, three blocked on other DRs. It will generate beautifully for ~10 days, the orphan branch will stop moving, and nothing will go red because the freshness check was never promoted.

**DR-010 — two factories + ACCEPTANCE files. DEAD, mostly by duplication.**
Decay: *duplicates something easier + measures a quantity that is `not_measured` from birth.* The product-code half is ~90% PR #362, which is **already built and open**. Merging #362 is strictly cheaper than writing DR-010's product half. The model half is blocked on the suspected `modelProb decimal(5,2)` defect and on `mlb_game_backtest.clv/closingOdds` being permanently NULL — so gate 4 reports `not_measured` on day one, which is the exact F9 trap (a schema-correct system with no rows that *looks* answered). The 60-repetition scenario matrix has unmeasured CI cost and is the first thing cut when it adds minutes to a 13-PR/day flow. Mutation testing is already advisory-nightly in #362 — Tier 3. Five hard dependencies, the widest in the set.

**DR-007 — OS Index. DEAD.**
Decay: *needs manual upkeep + duplicates three siblings.* `os/INDEX.json` is a generated file committed at ~13 merges/day; conflicts are constant and resolution is manual regeneration — the DR defers choosing a mitigation. New required check (unexercised action). Third `SessionStart` hook on a path already carrying a 300s and a 45s hook, and hooks fail open by law, so its death is silent by construction. Its frontmatter contract duplicates DR-006, its query surface duplicates DR-011, its staleness duplicates DR-008.

**DR-004 — native four-way spine. MOSTLY DEAD; one part permanent.**
Decay: *four programs in one trenchcoat, gated on an owner-only migration.* Needs a db-push, a production deploy, a new required authority gate, and a scheduled liveness alarm (0%-response channel). `loop_artifacts` at ~1.7k rows/day with **no retention policy and no reader** recreates F8.6 verbatim — three append-only ledgers with zero readers — this time with the mission's name on it. The monthly `os/ledger/LEDGER-YYYY-MM.md` rollup is hand-authored prose: that is `operating-brief.md`, which declared itself "regenerable," had no generator, and was 8 days stale with a wrong item when the audit found it. **The one part that survives forever is free: rejecting LiteLLM tiering.** That is a ruling, not a mechanism, and rulings don't rot.

**DR-009 — agent charters. HALF-DEAD, and the dead half is the point.**
Survives: it rides the already-required `TypeScript Check` job. Good instinct, correctly identified.
Decay: *the gate checks shape, not truth.* `check-charters.mjs` validates that a charter has six well-formed fields and a resolvable `LOOP-*.md`. It cannot check whether SEAT-001 ever emitted an artifact or SEAT-003 ever produced its obliged daily aggregate. A charter whose `evaluation:` field promises a daily artifact, with nothing verifying the artifact arrives, is `operating-brief.md` in YAML. Also: **SEAT-002 is chartered against the MLB projection-evaluation loop, which DR-005 explicitly did not select** — a live contradiction across the set. Prediction: three charter files persist, the gate is green forever, zero seats produce anything after week 2.

**DR-008 — clock ladder. THREE OF FOUR RUNGS DEAD; the diagnosis is the best in the set.**
Rung "standing GitHub issue": 0 issues ever → dead. Rung "required OS Clock check": unexercised promotion → advisory → `perf-harness` → dead. Rung "48h heartbeat via `gh run list`": technically viable (daily crons DO fire reliably here — `cron-stripe-reconcile` 5/5 over 5 days) but proves only that the job *ran*; `security-audit-weekly` ran on schedule and failed 4/4 and nothing happened, so a heartbeat that a workflow executed is not evidence anyone acted. Rung "SessionStart capsule": survives, and is Tier 2 — but it is the *weaker* Tier-2 channel (see the graft below).
**What survives and is worth everything: the mandatory `observe_by` front-matter field.** It makes it structurally impossible to write "blocked on owner" without writing the date at which that silence becomes a defect. That is the smallest correct fix for F2 in the entire set.

**DR-005 — Engineering Build Loop. PARTIAL SURVIVAL, and the surviving part is the right one.**
Survives: *the apply step is merge-to-main, which happens ~13×/day without anyone remembering.* Ledger-append-on-merge rides an event that cannot be forgotten. That is the single strongest survival property in the set.
Dies: `13-loop-intent` fail-closed gate at 13 PRs/day — either it never becomes required (advisory → dead) or it becomes required and gets routed around via `loop-exempt`; the DR names this risk honestly and it is real. And `scripts/loop-outcome-sweep.mjs` as a daily red workflow is `perf-harness` with a different name. Prediction: the append survives, the gate and the sweep do not, and the loop degrades to "PRs have a paragraph in them."

**DR-012 — token ledger from transcripts. HIGHEST-SURVIVAL EMITTER; rollup dies.**
Survives: it is the only DR whose core emitter **has already run and produced defensible company numbers** ($18,274 cache-aware, 66.3% PR-attributable, $36.69/accepted unit, 2.3% waste, 31.5% dark). It rides a hook (automatic), derives from files already on disk (no new store), and fixes a typecheck break by *deleting* a phantom import rather than creating a table.
Decay risks, both real: (a) **transcript retention is destroying the substrate now** — `cleanupPeriodDays` is unset (30-day default) and the oldest transcript in this project's directory is **2026-07-25**, 11 days of history in a 403 MB / 27-session corpus; (b) `HUMAN-EQUIVALENCE.md` needs Prez to state a plan fee and ratify assumption ranges — a manual input that, unstated, leaves `amortizedUsd: null` forever; (c) the monthly `LEDGER.md` prose rollup is `operating-brief.md` again.

**DR-006 — two tiers, one envelope. HIGHEST SURVIVAL, for the one correct reason.**
Survives: **it needs no ruleset change.** `shared/**/*.test.ts` and `scripts/**/*.test.ts` are already in `vitest.config.ts` include globs and `Vitest` is already one of the three required contexts. Enforcement is live the moment the file merges, bypassing the single action Prez has never taken. It also defers the expensive half (the TiDB table) correctly instead of leading with a db-push.
The one decay mechanism, and it is serious: **a gate hidden inside a test file is one `it.skip` away from death, with no audit trail** — cheaper to disable than a ruleset edit, and this repo has a documented instance of exactly that pattern (`kenpomCredentials.test.ts`, F6.3: returns early, reports GREEN with zero assertions, counted among 3,778 passing). The *time-based* staleness assertion is what will get skipped, because it turns `Vitest` red on unrelated PRs at 13 merges/day. **Cut the staleness assertion from the vitest file; keep the structural validation, which never fires spuriously.** Put staleness on the per-prompt capsule instead.

---

## 3. Ranking by survival probability at 30 days

Survival = the mechanism is still automatically producing a correct, current artifact **and** at least one instance of its enforcement has actually bound something.

| # | DR | P(alive) | Why it lives / dies |
|---|---|---|---|
| 1 | **DR-006** artifact schema + envelope | **~65%** | Only design whose gate is live on day one with no ruleset change |
| 2 | **DR-012** token ledger | **~55%** | Emitter already ran; hook-driven; no new store; substrate decaying |
| 3 | **DR-005** engineering build loop | **~45%** | Append rides merge-to-main; gate and sweep die |
| 4 | **DR-008** clock ladder | **~35%** | Best diagnosis; 3 of 4 channels dead; safety premise false |
| 5 | **DR-009** agent charters | **~30%** | Rides required job; gate checks shape not truth |
| 6 | **DR-004** native four-way spine | **~25%** | LiteLLM rejection permanent; rest needs db-push + deploy + new gate + prose rollup |
| 7 | **DR-007** OS Index | **~20%** | Generated file at 13 merges/day + new required check + duplicates 3 siblings |
| 8 | **DR-010** two factories | **~18%** | 90% duplicate of #362; model half `not_measured` from birth |
| 9 | **DR-011** founder dashboard | **~12%** | Escalates through a channel with zero uses in company history |
| 10 | **DR-013** eight-loop activation | **~7%** | 2026-07-28 at 8× scale, observer on the 0%-response channel |

---

## 4. Cut these three, entirely

### CUT DR-013 (eight-loop paired activation)
It is the failure mode the mission was convened to break, scaled by eight, with five hard dependencies and an observer on a channel measured at 0/4. Its one durable idea — *a cross-link must resolve mechanically or the check fails* — is a five-line assertion. **Move that assertion into DR-006's `scripts/os-artifacts.test.ts` and delete the rest.** Loop ordering becomes a one-line `status: deferred` per loop file, which costs nothing and rots harmlessly.

### CUT DR-011 (founder dashboard)
This is the artifact a one-founder company builds in order to *feel* observed. Nine panels, three of them `not_measured` at launch, escalating through a tracker that has never been used. **Replaced entirely by three lines in `.claude/scripts/prompt-capsule.sh`** (see graft below), which reaches Prez dozens of times per day instead of once, and requires no branch, no workflow, no required check, and no scripts.

### CUT DR-010 (two factories + ACCEPTANCE files)
For product code it duplicates PR #362, which is already built and awaiting merge — **merging #362 is the cheaper, strictly-dominant action**. For the model factory it cannot produce a real number until `modelProb decimal(5,2)` is resolved and CLV columns stop being NULL, so its headline output on day one is `not_measured` with a threshold file nobody is blocked by. Keep exactly one sentence of it: the acceptance thresholds live in a versioned file. Put that file in `/os/` under DR-006 and check its *shape*, not its numbers.

**Fourth cut if Prez will take one:** DR-007, absorbed into DR-006. Its only load-bearing contribution is the frontmatter contract, which DR-006 already defines. A generated JSON index committed on every one of 13 daily merges is pure manual upkeep, and a third SessionStart hook competes with the two that already exist.

---

## 5. The graft the entire set is missing

**`.claude/scripts/prompt-capsule.sh` is a `UserPromptSubmit` hook that injects text into EVERY prompt. It is 9 lines, already wired, already trusted, `exit 0` always, and today it is a static heredoc.** No DR touches it. DR-008 uses `SessionStart` — once per session. This is once per *prompt*.

Make the last line dynamic:

```
[OS] 3 items overdue — DR-001 ruling (12d), LOOP-001 outcome unobserved (4d), INC-21 (11d).
```

The state file it reads is generated by DR-006's already-required test run, so if the generator breaks, `Vitest` goes red on the next merge — inside the hour, at 13 merges/day. No new workflow. No new required check. No GitHub issue. No orphan branch. No service.

The empirical case for this channel over every other in the set: `CLAUDE.md` is loaded by the harness and has 31 commits in 30 days. `OPERATING-RULES.md` declares itself mandatory and is loaded by nothing and has been dead for 28 days. **That is the whole survival question, and it has already been answered in this repo.**

---

## 6. The smallest system that actually closes a loop

Everything above reduces to five things. Nothing else in the ten DRs is load-bearing at 30 days.

1. **DR-003's commit** (hard blocker on 9 of 10; also fixes `server/_core/aiCostMeter.ts:20`, without which nothing merges at all).
2. **DR-006's git tier + envelope**, validated by `scripts/os-artifacts.test.ts` inside the already-required `Vitest` check — **structural validation only, no time assertions**.
3. **DR-012's session-cost hook** — automatic, already proven to run, plus one line setting `cleanupPeriodDays` before more history evaporates.
4. **DR-005's ledger-append-on-merge** — rides the one event that fires 13×/day without anyone remembering.
5. **DR-008's `observe_by` field**, surfaced through `prompt-capsule.sh` on every prompt — *not* through a GitHub issue, *not* through a new required check.

Four files, one hook edit, one test file, one settings line. Every mechanism in it is either automatic or already required. Nothing in it needs Prez to remember, read, promote, or regenerate anything.

Everything cut is the 2026-07-28 program with better handwriting.