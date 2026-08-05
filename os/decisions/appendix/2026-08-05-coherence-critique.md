# Appendix — coherence critique (Stage 2)

28-finding conflict register across the ten records drafted blind to each other. Source of DR-014's one-substrate / one-clock / one-gate / one-writer consolidation.

# DR-014 — Coherence ruling on the Stage 2 decision set: one substrate, one clock, one gate, one workflow

**Status:** AWAITING RULING · **DRI:** Prez · **Raised:** 2026-08-05 by the executor (Stage 2, coherence critic)
**Urgency:** BLOCKING — this record must be ruled before DR-004…DR-013 are implemented, or the set builds three artifact stores, three ageing mechanisms, four per-PR artifacts, four issue bots and six workflows for one company with one human.
**Doctrine:** D4 (one reality — specialized agents may divide labor, never maintain incompatible realities) · D14 (visibility before autonomy) · D15 #4 (data collection without meaning) · D12-L2/L3 · §19 deploy law

---

## The question

**Ten decision records were drafted blind to each other. Which of their recommendations cannot both be executed, which build the same thing twice, which depend on something nobody produces, and which violate a hard constraint — and what single consolidation ruling makes the surviving set buildable by one person?**

---

## Pre-work: three facts I resolved read-only, because five DRs rest on them

| # | Fact | Label | Consequence |
|---|---|---|---|
| P1 | **Both Railway services are pinned to `source.branch = "main"`.** `ai-sports-betting-dime-ai` (a46ea921…, custom domains) and `ai-sports-betting-backend` (3528dc9f…, no domain) both report `{"repo":"aisportsbettingcontact/ai-sports-betting-dime-ai","branch":"main","checkSuites":false}` | **VERIFIED** (Railway MCP `get-service-config`, production env 787f3113…, read-only) | The orphan-branch assumption flagged as a BLOCKING unknown by DR-005, DR-011 **and** DR-013 — and relied on by DR-003 Phase A — is **confirmed safe**. A push to `os-ledger` is not a deploy. Delete that unknown from three records. |
| P2 | **Both services build with `RAILPACK`, not the Dockerfile.** `railway.json` declares `DOCKERFILE`; live config for both reports `"builder":"RAILPACK"` | **VERIFIED** (same call) | Resolves audit §8's builder UNKNOWN in the *dangerous* direction. This is DR-004's unknown #5 and it is not neutral: it means Python runner availability at runtime is unproven, which bears on DR-005's F4 note that `mlbDriftDetector`'s self-patch may already be silently failing. **File this as an incident candidate; it is out of scope for this record but it should not stay unowned.** |
| P3 | **`DISABLE_BACKGROUND_JOBS` exists as a variable on `ai-sports-betting-backend` only, not on the domained service.** | **INFERRED** (variable *names* are readable; values are not, and I did not read them) | This is direct evidence the two-writer question (DR-004 unknown #7, DR-006 unknown #4, project memory's "single-writer choice still pending") was already answered by env config. One `list-variables` read settles it. Do not design duplicate-suppression before making that read. |
| P4 | `main-protection` (ruleset 18701573) requires exactly **three** contexts: `Security Audit`, `TypeScript Check`, `Vitest`. Vitest's include globs already cover `shared/**/*.test.ts` and `scripts/**/*.test.ts` | **VERIFIED** (`gh api .../rulesets/18701573`, `vitest.config.ts:27-36`) | DR-006's central mechanism claim is correct, and it generalizes far wider than DR-006 claimed — see C13. |
| P5 | PR #362 ships `WRITE_APPROVALS` in `scripts/check-github-actions-security.mjs:17`, already granting `contents: write` to `auto-merge-dependabot.yml` | **VERIFIED** (`git show ci/verification-framework:scripts/check-github-actions-security.mjs`) | DR-004's stated reason for rejecting a ledger branch — that `contents: write` on a scheduled workflow regresses #362's posture — is answerable by one justified map entry, not by abandoning the mechanism. The framework #362 built exists precisely to make such a grant reviewable. |

---

## The conflict register — 28 findings

Severity: **BLOCKING** (two records cannot both be executed) · **SERIOUS** (duplicate machinery or unowned dependency that will rot) · **TIDY** (naming, sequencing).

### Class A — Direct contradictions

**C1 · BLOCKING · Three incompatible artifact substrates, each claiming to be the one store.**
- DR-006/C: git tier under `/os/` on `main` + a **deferred** TiDB `loop_artifacts`; explicit boundary rule (org kinds → git, runtime kinds → TiDB); **no orphan-branch tier exists in its model.**
- DR-004/A: `loop_artifacts` in TiDB built **now**, as "one durable artifact store," and it explicitly **rejects** the ledger-branch design as its Option B.
- DR-005/A, DR-011/C, DR-012/A, DR-013: an orphan branch — named `os-ledger` by DR-005 and DR-013, `os-state` by DR-011 — plus `os/ledger/sessions/` committed to `main` by DR-012.

Three stores, two names for the same branch, and DR-006's "one envelope prevents a second reality" claim is falsified by the orphan branch it never modelled. This is a D4 violation in the design phase.

**Resolution — a three-tier map, ruled once:**
1. **Hand-authored org artifacts** (decisions, goals, loops, charters, lessons, AUTHORITY.md) → `/os/` on `main`. Reviewed, rare, validated by Vitest. Yes, each is a production deploy under §19; it is a text-only no-op deploy and that is acceptable, but say it out loud.
2. **Machine-generated artifacts** (job_run, brief, index, contradictions, cost records, per-PR factory runs) → **one orphan branch, `os-ledger`** — `os-state` is retired as a name. VERIFIED deploy-inert per P1.
3. **TiDB `loop_artifacts`** → **DEFERRED**, specified by DR-006, not built. Written trigger for building it: *the first artifact kind that must be emitted by the running server and cannot be reconstructed from CI* (per-game projections, per-request compliance blocks). Until that kind exists, the table is YAGNI.

DR-004's store choice is overruled; its other three answers survive intact.

**C2 · BLOCKING · DR-005 and DR-013 recommend opposite loop-activation shapes.**
DR-005: exactly one loop (Engineering Build), everything else recorded `deferred`. DR-013: "no loop ships alone" — four pairs, a ring, eight loops. DR-013 lists DR-005 as a dependency while overriding its central ruling.

**Resolution:** DR-005 wins the *designation*; DR-013 wins the *promotion rule*. LOOP-001 = Engineering Build Loop. DR-013's mechanical cross-link test — a loop may not be declared LIVE until an artifact id it produced resolves inside another loop's recorded decision, enforced by `loop-check` — is adopted **as the LIVE criterion**, not as a schedule. To make that satisfiable, exactly one partner activates with it: **LOOP-002 = Operations (cron cadence observation)**, which is the only pair both records can support without new production authority, and which C3 and C9 independently need. D16 criterion 4 (eight loops interconnected) is then reported **PARTIAL with two live and six deferred-with-reasons** at certification — DR-013's own "honest verdict for loops that cannot reach a live cycle" already licenses this, and faking it is the exact failure the mission exists to correct.

**C3 · BLOCKING · DR-009's three activated seats all serve loops DR-005 defers — so DR-009's own gate would reject them on day one.**
DR-009's rule: `status: ACTIVE` requires a resolvable `os/loops/LOOP-*.md`. SEAT-001 (run-recorder) serves an ops loop DR-005 rejected as Option D. SEAT-002 (calibration-auditor) is bound to the MLB model loop, which DR-005 defers and DR-001 gates. SEAT-003 (voice-compliance-gate) serves no loop at all. DR-009 flags SEAT-002's binding as an unknown but its recommendation text commits to it anyway.

**Resolution:** with C2, SEAT-001 is activatable against LOOP-002. **SEAT-002 → DEFERRED** (`blocked_on: DR-001, DR-005`). **SEAT-003 → DEFERRED** (`blocked_on: NO_LOOP`) — chartering the compliance gate costs almost nothing, and DR-009 is right that it is the best-built thing in the repo, but activating a seat with no loop is the precise inversion DR-009 itself wrote the gate to prevent. It activates the day a customer-facing loop is designated. **One active seat at v1.** That is an honest Level-2→3 step, not a roster.

**C4 · BLOCKING · `os/ledger/` and the six D10 questions have two owners with incompatible sources.**
DR-004: `workflow_cost` artifacts carrying `links.outcomeRef`, rolled into `os/ledger/LEDGER-YYYY-MM.md`, sourced from server-runtime emitters. DR-012: session transcripts → `os/ledger/sessions/` → `os/ledger/LEDGER.md` + `HUMAN-EQUIVALENCE.md`, with named proxies per question. DR-012 additionally identifies a third definition already in the repo (`costPerVerifiedOutcome()` in `shared/loop/queries.ts`, keyed on settled gradings).

DR-012's evidence is decisive and DR-004 did not have it: **$18,274 measurable today from transcripts vs approximately zero through the server runtime**, because `LLM.md`'s subscription-first auth means interactive work is not billed per token and never touches the gateway.

**Resolution:** **DR-012 owns D10 and `os/ledger/` outright.** DR-004 retains what STATE.md §4 actually assigned it — the ruling that **LiteLLM tiering is rejected, not deferred**, on §19-precedence grounds — and drops its ledger rollup entirely. Per DR-012's own unresolved note, the ledger reports **two labelled ratios**: product-code factory (unit = accepted merged PR) and model factory (unit = settled grading). DR-010 must adopt the same two units so acceptance records and cost records share denominators.

**C5 · SERIOUS · DR-011's panel 8 renders the answer DR-012 rejected.**
Panel 8 (AGENT ECONOMICS) reads `not_measured`, reason: *"ai_workflow_costs table absent; db-push.yml not run."* That is DR-012's Option B framing. Under DR-012/A the number exists today.
**Resolution:** panel 8 reads `os/ledger/LEDGER.md`; the `not_measured` reason is deleted; the brief's provenance footer cites the ledger's `PRICES.json` version so a re-priced replay is visible as a version bump, not a silent number change.

**C6 · BLOCKING · `loop_artifacts`: DR-004 builds it, DR-006 explicitly declines to.** Same table name, opposite ruling, in the same Stage-2 batch. Resolved by C1's tier 3 deferral.

### Class B — Double-builds

**C7 · SERIOUS · Ageing and escalation is built three times, four counting the loop checker.**
- DR-008: `observe_by` front-matter + required `OS Clock` check + standing issue OI-0001 + SessionStart capsule + `os/overrides/` valve + 48h heartbeat.
- DR-007: `review_by` + derived `last_touched` + INDEX staleness banner + `os-nightly.yml` issue + a Discord line. (DR-007 itself asks whether this belongs to it. It does not.)
- DR-011: check C4 blocked-queue ageing with `firstSeen` carried in `contradictions.json` + per-contradiction issues + a required `os-brief-fresh` check.
- DR-013: `loop-check.mjs` failing PRs on unobserved loops.

**Resolution:** **DR-008 owns ageing and escalation exclusively.** One clock field (`observe_by`), one required check, one standing issue, one session capsule, one override valve. DR-007 drops `review_by`, the nightly issue and the Discord line, and contributes `last_touched` + the index as *inputs* (which it already offers). **DR-011 drops C4 and drops `os-brief-fresh` as a separate context** — instead `os/BRIEF.md` becomes one clock item with `observe_by: generated + 36h`, so a dead generator turns the *same* check red. DR-013's loop-observation deadline becomes an `observe_by` on the LOOP file. Three required checks collapse to one, and the "brief with no generator" defect (F2.2) is still caught.

**C8 · SERIOUS · Four per-PR JSON artifacts, all CI-written, all keyed by PR number.**
#362's `proof-contract.json`; DR-005's per-PR validated evidence record; DR-010's `os/factory/runs/<pr>.json`; DR-012's per-PR cost attribution.
**Resolution:** one file at DR-010's path, written by one job, assembling #362's proof contract + DR-010's threshold verdicts + DR-005's intent/loop linkage + DR-012's cost block. Stored on `os-ledger` (machine-generated, tier 2). **DR-005 must not mint a parallel evidence record** — consuming #362's contract is strictly better and is the composition DR-005's own dependency note already anticipated.

**C9 · SERIOUS · Cron cadence is observed four times, twice at the cost of a production deploy.**
DR-004 (`job_run` from `server/cronJobRunner.ts`), DR-009 (SEAT-001 touching `server/cronJobRunner.ts` and `server/routes/cron*`), DR-011 (check C3, `.github/workflows/cron-*.yml` schedules vs `gh run list`), DR-013 (ops observer copying run facts before Actions retention expires).
**Resolution:** one observer, **CI-side, zero production change**: `scripts/os/observe-crons.mjs`, run daily, diffing declared schedule expressions against `gh run list`, writing `job_run` artifacts to `os-ledger`. That single script *is* SEAT-001's implementation, *is* DR-011's C3 data source, and *is* DR-013's ops artifact. DR-004's in-process `withRun()` emitter is **deferred**, and its deferral carries the honest limitation: **a CI-side observer cannot see the in-process `setInterval` schedulers, only the Actions-triggered ones.** That named blind spot is the written trigger for building the in-process emitter — and for building tier 3.

**C10 · SERIOUS · Five overlapping front-matter schemas.** DR-006 (envelope + sealed org front-matter), DR-007 (`kind`/`owner`/`status`/`evidence[]`/`supersedes`/`loop`/`review_by`), DR-008 (`observe_by`), DR-009 (six charter fields + `authority_rung`), DR-011 (goal `priority`, paths glob, target metric), DR-013 (LOOP file schema). DR-007 already concedes DR-006 owns the vocabulary; the others do not.
**Resolution:** **DR-006 owns one zod schema** (`shared/os/frontmatter.ts`) with per-kind required-field sets *contributed* by the owning record: `observe_by` from DR-008, charter fields from DR-009, goal fields from DR-011, LOOP fields from DR-005/DR-013. One validator, one test file, inside the already-required Vitest job.

**C11 · SERIOUS · Two new SessionStart hooks proposed; two already exist** (`bootstrap-plugins.sh` @300s, `bootstrap-dime-context.sh` @45s — VERIFIED in `.claude/settings.json`).
**Resolution:** exactly **one** new hook, owned by DR-008, which prints the clock capsule *and* DR-007's index header. Budget ≤2s, reads a cached JSON only (never `git log` per artifact — DR-007's own intended implementation), `exit 0` unconditionally.

**C12 · SERIOUS · Four GitHub-issue writers in a repo with zero issues ever opened.** DR-007's nightly staleness issue, DR-008's standing OI-0001, DR-011's per-contradiction issues, DR-013's tracker-as-substrate.
**Resolution:** one issue-writing module, one label taxonomy (`os:clock`, `os:contradiction`, `os:loop`, `os:intent`), one standing clock issue plus per-contradiction issues capped at N open. DR-013's "the tracker is the largest piece of unused infrastructure we own" is right, and the way to honor it is one disciplined writer, not four bots discovering the tracker simultaneously.

### Class C — Ruleset and workflow contention

**C13 · BLOCKING · The set requests ~8 new required contexts against a ruleset that has 3.**
DR-004 (authority gate + liveness alarm), DR-005 (workflows 13-15, incl. a fail-closed intent gate), DR-007 (`OS Context Index`), DR-008 (`OS Clock`), DR-010 (`check-required-checks` + scenario tier), DR-011 (`os-brief-fresh`), DR-012 (`os-ledger`, required day one), DR-013 (`loop-check`). **Four of them independently write "sequence this against PR #362's Wave 1" while unaware of the other seven.** Each is a separate ruleset edit, and F6.1 documents that a required context is removed by one untraceable API call.

**Resolution — and this is the single largest coherence win available, and it is free:** P4 verifies that `shared/**/*.test.ts` and `scripts/**/*.test.ts` are already inside the include globs of the already-required `Vitest` context. Therefore **DR-006's artifact validation, DR-007's index integrity, DR-009's charter gate, DR-010's threshold checker, and DR-013's `loop-check` all become vitest test files and add ZERO new contexts.** DR-006 discovered this mechanism and under-claimed its reach; it generalizes to five records.

Hard budget: **at most two new required contexts from the entire Stage 2 set.**
1. `OS Clock` (DR-008) — because a clock cannot live inside the checks it polices; it must evaluate the head tree *and* a heartbeat.
2. Reserved for DR-005's intent gate, and only after one week in WARNING mode with a published would-have-blocked count, per DR-005's own stated survival test.

Both graduate only after #362's Wave 1 has been stable for one week, so a red check is never ambiguous about which framework caused it.

**C14 · SERIOUS · Six new workflow files proposed on top of 24 existing + 11 from #362.** DR-005 claims numbers 13-15 (VERIFIED available; #362 uses 01-03, 05-12), DR-007 `os-nightly.yml`, DR-008 `os-clock.yml`, DR-011 `os-brief.yml` + `os-brief-deep.yml`, DR-012 an `os-ledger` job, DR-013 one scheduled workflow.
**Resolution:** **one scheduled workflow, `os-daily.yml`**, with jobs `observe` → `brief` → `ledger` → `clock` → `push` (a single commit to `os-ledger`) → `escalate`. One `contents: write` grant, one heartbeat to verify, one failure surface, one thing that can rot. Add the justified `["os-daily.yml", new Set(["contents", "issues"])]` entry to #362's `WRITE_APPROVALS` map (P5) in the same PR. Plus one PR-time job inside the existing `ci.yml`. **Net new workflow files: 1.**

### Class D — Cycles and orphan dependencies

**C15 · BLOCKING · Nobody produces `os/agents/AUTHORITY.md`, and three records consume it under two different filenames.** DR-004's authority gate reads `authority.json`; DR-005 asserts merge-to-main is rung 3 and forward-declares "DR-00n (AUTHORITY LADDER)"; DR-009 validates `authority_rung` against `os/agents/AUTHORITY.md` and names the ownership gap as its top unknown. Doctrine L5 names that exact path.
**Resolution:** **DR-009 owns `os/agents/AUTHORITY.md`** and ships it in its own implementation with rungs 1/2/3 exactly as doctrine L5 states them. One file, markdown, with a fenced machine-readable rung table parsed by the charter test. `authority.json` is retired as a name. DR-004's gate and DR-005's rung-3 assertion consume it.

**C16 · TIDY · Soft cycle DR-003 ↔ DR-006.** DR-003 says `shared/loop/` should land *before* DR-006 is ruled; DR-006 says it is hard-blocked by DR-003 and collapses to Option D if DR-003 says no.
**Resolution:** state the order explicitly — DR-003 Phase A (archive push, zero-risk, VERIFIED deploy-inert per P1) → typecheck fix → `shared/loop/` PR → DR-006 ruling ratifies or supersedes what landed. No deadlock, but it was unstated in both.

**C17 · TIDY · Cycle DR-004 ↔ DR-005 on substrate vs emitter.** Dissolved by C1 + C9: no engine, orphan branch, first emitter is the CI-side observer.

**C18 · BLOCKING, and the highest-leverage single action in the set · Nine of ten records are hard-blocked on DR-003, and DR-003 is blocked on one line.** The working tree fails `tsc --noEmit` because `server/_core/aiCostMeter.ts:20` imports `aiWorkflowCosts`, absent from `drizzle/dime.schema`. DR-003 leaves the fix open ("remove or stub"). DR-005 leaves it open. DR-004 asks *why the export disappeared* and worries the answer is a policy about adding tables. **DR-012 already answers it decisively:** its recommendation deletes the phantom import because the table would instrument an empty pipe — which is strictly less risk than creating the table `aiCostMeter.ts` hallucinated.
**Resolution:** adopt DR-012's answer. **Delete the import, no schema change, no `db-push.yml` run.** One-line diff unblocks nine records.

### Class E — Hard-constraint violations

**C19 · BLOCKING · DR-004/A requires a TiDB schema change before any loop has closed a cycle.** `loop_artifacts` → `db-push.yml` (owner-gated) → a production deploy, for observability of jobs CI can already observe. DR-006 makes exactly this D14-inversion argument against its own Option B and is right. Resolved by C1/C6.

**C20 · SERIOUS · DR-009's SEAT-001 modifies `server/cronJobRunner.ts` and `server/routes/cron*` — a production deploy whose sole purpose is observability.** Resolved by C9: the seat's v1 implementation is the CI-side observer; the in-process emitter is the seat's *stated future work*, with the blind-spot limitation recorded in the charter (which DR-009's format already requires).

**C21 · SERIOUS · DR-013 pushes to the ledger branch hourly.** Now VERIFIED safe (P1), but 24 generated commits/day, plus DR-012's per-session records and DR-005's per-merge appends, on a branch DR-006 already worries about for file volume. Nothing in the mission needs hourly resolution; every evaluation window in the set is measured in days.
**Resolution:** daily, one run, one commit, inside `os-daily.yml`.

**C22 · SERIOUS · DR-012 commits git records derived from Claude Code session transcripts and never states what is excluded.** Transcripts hold secrets, customer data, and production query output; the emitter is a hook running on a credentialed machine. This is unaddressed in DR-012 and it is the kind of gap that gets found later by a scanner.
**Resolution:** DR-012 must state the record schema as a closed allowlist — `{sessionId, model, four token counters, startedAt, endedAt, branch, sha, isSidechain}` — **no free-text field, no message content, no tool output, no absolute paths outside the repo** — with a vitest assertion that the zod schema is `.strict()` and contains zero string fields other than the enumerated ids. `gitleaks` is already blocking and covers the committed file, but a schema that structurally cannot carry prose is the actual control.

**C23 · SERIOUS · Two records independently want a scheduled workflow holding `DATABASE_URL`.** DR-011's weekly `os-brief-deep`; DR-004's liveness alarm (which flags the `environment: Production` approval-gate unknown). Today that credential's exposure is manual-dispatch-only via `db-query.yml`.
**Resolution:** one scheduled DB reader, fixed query allowlist, modeled on `db-query.yml`, and **not shipped until DR-011's own unknown #2 is resolved** — if TiDB cannot issue a read-only scoped user, panels 6/7 stay `not_measured` with the reason printed. Widening a standing production credential to unlock a dashboard tile is a bad trade in a set that already has enough moving parts.

### Class F — Silent assumptions against another record's ruling

**C24 · SERIOUS · DR-010's graduation enforcer will fire constantly under C13's budget.** `check-required-checks.mjs` fails the nightly when a check named in an ACCEPTANCE file passes its `requiredBy` date without entering the ruleset. If every record sets its own `requiredBy`, the mechanism reports the budget as a permanent breach.
**Resolution:** DR-010's mechanism is good and should own the graduation ledger — for #362's waves and the two budgeted contexts. But its contents are set by **this** ruling, not by each record self-declaring. One list, one owner.

**C25 · SERIOUS · DR-007 commits a generated `os/INDEX.json` to `main` at ~13 merges/day** and flags the conflict frequency as an open question with three candidate mitigations.
**Resolution:** pick the one that is already implied by C1's tier map — the index is generated, therefore tier 2. It is written by `os-daily.yml` onto `os-ledger`; the SessionStart hook reads it from there. Zero merge conflicts, zero commits to `main`, and the `git log`-per-artifact cost moves to CI where DR-007 wanted it anyway.

**C26 · TIDY · The `/os/`-on-main deploy consequence is flagged by DR-006 and by nobody else, though four records write to `/os/`.** State it once in the tier map: hand-authored `/os/` commits are production deploys and that is accepted; generated artifacts never touch `main`.

**C27 · SERIOUS · `INCIDENTS.md` mechanics are touched by three records and owned by none, while #362 already ships an overlapping gate.** DR-006 (header-immutability vitest gate), DR-007 (id derivation, and asks whether it should become the number allocator), DR-008 (ageing via `git log -L` per block). #362's `08-contract-and-data-integrity.yml` already runs an immutable-history diff gate.
**Resolution:** **#362 owns immutability** — DR-006 drops its gate rather than build a second one. **DR-007 owns id derivation and becomes the allocator**, because F6.8 (two sessions both taking 41–43, three incidents never filed) is a live defect and reserving the next free number in `--check` costs one function. **DR-008 owns ageing.**

**C28 · BLOCKING · Three independently-designed blocking mechanisms hit the same merge, and their sum is the manual-effort failure mode the constraints forbid.** DR-005's fail-closed intent gate at 13 PRs/day, DR-008's clock, DR-010's acceptance thresholds. Worst case, a 2am UI-only PR must carry an intent issue, a loop id, an acceptance record, a cost record, an `observe_by` date, a seat trailer and a proof contract. DR-005 names this as its real survival risk; DR-008 names bounded escapes as the reason its gate lives; DR-010 does not model the interaction at all.
**Resolution:** **one PR-time gate script with exactly one fail-closed requirement** — a resolvable `Loop:` reference in the PR body. Everything else is auto-derived from the diff and the run, or reports WARN. DR-008's override valve (24h expiring file, permanent git-visible reason, two-renewal cap) covers **all** PR-time OS gates, not only the clock. And DR-009's `Seat:` path-scope trailer — which DR-009 itself questions as "an opt-in gate that reads like enforcement" — ships **labelled advisory** or not at all.

---

## Options for the coherence ruling itself

### Option A — Consolidation ruling: name one owner per capability, delete the duplicates ✅ RECOMMENDED
Issue this record as a binding amendment over DR-004…DR-013: the tier map (C1), the loop shape (C2/C3), the D10 owner (C4), the six de-duplications (C7-C12), the required-check budget (C13), the single workflow (C14), the AUTHORITY owner (C15), and the four deferrals (tier-3 table, in-process emitter, SEAT-002, SEAT-003). Each record keeps its argument and its evidence; each loses its duplicate machinery and is edited to consume the named owner's output.

- **Pros:** produces one buildable plan · every deleted mechanism is deleted *for a stated reason traceable to another record's evidence*, which is itself a D6 artifact · the Vitest discovery (C13) converts five would-be required checks into zero at no cost · resolves P1/P4/P5 into the records so three BLOCKING unknowns disappear · net new infrastructure across the entire Stage 2 set drops to **1 workflow, 1 required check (a second reserved), 1 hook, 1 orphan branch, 0 schema changes**
- **Cons:** ten records need an editing pass before implementation begins · it overrules two recommendations outright (DR-004's store, DR-013's activation shape) and three partially · a critic ruling on peers is a rung-3 act and needs Prez's signature to be legitimate
- **Effort:** M (one pass over ten records + one consolidated build spec) · **Risk:** low
- **Doctrine:** D4 one-reality — the only option that actually delivers it. D14 — enforces the ordering three records were violating. D12-L2 — one artifact system, not three. §19 YAGNI/one-founder — the only option that reduces total moving parts rather than sequencing them.

### Option B — Sequenced isolation: rule the records in dependency order, let each later one adapt
No consolidation now. Rule DR-003 → DR-006 → DR-008 → DR-005 → the rest, and require each record to be re-drafted against what actually landed.

- **Pros:** genuinely the lowest-ceremony option, and it has a real argument: designs adapt better to a built thing than to a written ruling · no peer record is overruled on paper · preserves each author's judgment about their own domain
- **Cons:** the duplicates are not caught by ordering, they are caught by *seeing each other* — DR-011 will still build its own ageing check because it was written to · the required-check budget is never stated, so contexts accrete one justified edit at a time (exactly how the repo reached "gates that do not gate") · four records will each still write "sequence against #362 Wave 1" · it converts a design problem into a series of merge-time surprises for a one-person team
- **Effort:** XS now, L later · **Risk:** high
- **Doctrine:** fails D4 directly. Fails D14 only indirectly. This is the option that most resembles how 2026-07-28 was run.

### Option C — Budget only: overrule nothing, impose hard resource caps
Leave all ten recommendations standing; impose ≤1 new workflow, ≤2 required contexts, ≤1 hook, ≤1 orphan branch, 0 schema changes, and let the record owners resolve overlaps inside the budget.

- **Pros:** cheapest to issue · the budget is the thing that actually protects the one-founder constraint, and it is enforceable mechanically (a test asserting workflow count and ruleset context count) · respects author autonomy
- **Cons:** a budget adjudicates *quantity*, not *contradiction* — it does nothing about DR-004 and DR-006 ruling opposite ways on one table, or DR-009's seats having no loops, or two owners for D10 · under a cap, the duplicates compete rather than compose, and whoever implements first wins by default, which is decision-by-race
- **Effort:** XS · **Risk:** medium-high
- **Doctrine:** partial D4. Strong on §19 YAGNI. Silent on the substantive contradictions, which are the majority of what is wrong.

### Option D — Dissolve the ten into one Stage-2 build plan
Retire DR-004…DR-013 as inputs; write one `os/plan/STAGE-2.md` with a single coherent design.

- **Pros:** maximum coherence by construction · one document to implement from
- **Cons:** **destroys the preserved reasoning** — D6 is explicit that a decision record carries the evidence, constraints, standard, and ruling so a future cycle can tell whether it still applies, and ten records' worth of adversarial option analysis would be compressed into conclusions · Prez cannot rule on what he cannot see · re-litigating settled questions inside one document is slower than amending ten · and it discards the one thing the drafting process bought: independent arguments that can be cited against each other
- **Effort:** L · **Risk:** medium
- **Doctrine:** violates D6's "preserve reasoning, not only conclusions."

---

## Recommendation

**Option A — the consolidation ruling — with Option C's budget grafted in as its enforcement and Option B's ordering as its schedule.**

Why it beats the runners-up:

**Against B**, the decisive point is that ordering does not cure duplication, because each record was written to build its own mechanism and will do so on its turn. DR-007 will build ageing. DR-011 will build ageing. DR-008 will build ageing. All three are individually well-argued and all three are due to arrive within days of each other. Ordering also leaves the required-check budget unstated, and the audit's own F6.1 documents how this repo arrives at gates that do not gate: one justified edit at a time, each defensible, until nobody can say what binds. The specific harm B permits is the harm the mission was convened to stop.

**Against C**, a budget is necessary and insufficient. It is genuinely the best single sentence in this record and I am grafting it. But it cannot adjudicate DR-004 and DR-006 issuing opposite rulings on `loop_artifacts`, or DR-009's activation gate rejecting DR-009's own activations, or two owners of D10 with incompatible sources. Under a cap alone those resolve by implementation race — decision by whoever types first — which is exactly the "incompatible realities" D4 forbids.

**Against D**, D6 is explicit that reasoning is the durable asset and conclusions are the perishable one. Ten records of adversarial option analysis are the most valuable artifact Stage 2 produced. Amending them is cheaper and more honest than compressing them.

The deciding practical fact is the arithmetic. Implemented as drafted, the ten records add roughly **6 workflows, 8 required contexts, 2 SessionStart hooks, 3 artifact stores, 2 orphan branches, 1 schema change, 5 front-matter schemas, 4 issue bots and ~25 scripts.** Every record argues, correctly, that *it* is minimal. Their sum is a second operating system for the operating system, and it would be maintained by one person who ships thirteen PRs a day. Under this ruling the same set of capabilities lands as **1 new workflow, 1 new required check (a second reserved and earned), 1 hook, 1 orphan branch, 1 zod schema, 1 issue writer, 0 schema changes** — and five of the proposed gates ride inside a required Vitest job that already exists, which nobody would have found without DR-006 noticing the include globs. The consolidation is not a compromise on ambition; it is the same ambition at a fifth of the surface area that can rot.

**Grafted from the runners-up:**
- From **C**: the budget is not advisory. It ships as `scripts/os/budget.test.ts` inside the required Vitest job, asserting the count of `os-*.yml` workflows, the count of `SessionStart` hooks, and the ruleset context list against a committed expected set. Exceeding the budget turns the next merge red, and raising it requires a diff to a file with a comment explaining why — the same discipline F6.6's bundle-budget ratchet failed to have.
- From **B**: the implementation schedule is dependency-ordered — DR-003 Phase A → typecheck one-liner → `shared/loop/` → tier map + `os-daily.yml` (WARN mode) → DR-008 clock → #362 Wave 1 → graduate `OS Clock` → DR-005 intent gate in WARN → measure → graduate or fall back to DR-005's Option D.
- From **D**: one derived `os/plan/STAGE-2.md` is generated *from* the amended records as an index, not as a replacement for them.

---

## What I need from Prez

**Ruling 1 (the one that matters).** *Do you accept this record as a binding amendment over DR-004…DR-013 — specifically: one tier map (git `main` / orphan `os-ledger` / TiDB deferred), one first loop plus one cross-link partner, one owner per capability, and a hard cap of 1 new workflow, 2 required contexts, 1 hook, 1 orphan branch, 0 schema changes for all of Stage 2?*

**A yes commits you to:** DR-004's TiDB store overruled and its ledger rollup transferred to DR-012 (its LiteLLM rejection stands, unchanged); DR-013's eight-loop paired activation demoted from a schedule to a promotion rule, with two loops live and six deferred-with-reasons at certification, and **D16 criterion 4 reported PARTIAL rather than satisfied**; DR-009 activating one seat, not three; DR-007, DR-011 and DR-013 each losing a mechanism they argued for; and a certification scorecard that will read honestly rather than fully.

**Ruling 2.** *Confirm the tie-breaks I made on the two closest calls* — (a) `loop_artifacts` deferred rather than built, trigger = the first artifact kind CI cannot reconstruct; (b) SEAT-003 (voice-compliance-gate) deferred despite being the best-built thing in the repo, because activating a seat with no loop inverts DR-009's own rule. I can defend either reversal; I want them ruled, not assumed.

**Ruling 3, and it needs no meeting.** *Authorize the C18 one-liner now:* delete the `aiWorkflowCosts` import at `server/_core/aiCostMeter.ts:20`. It is one line, it creates no table, it runs no `db-push`, and it is the sole blocker on nine of ten records. **A yes commits you to** the token ledger being sourced from session transcripts (DR-012/A) rather than from a server-runtime table — which is the substance of DR-012's requested ruling anyway.

**One thing I did not decide and will not:** P2 (RAILPACK is the live builder, not the declared Dockerfile) is a production finding surfaced by this record's pre-work. It is out of scope here. It needs an incident number and an owner, and under C27 the allocator does not exist yet, which is a small live demonstration of why F6.8 matters.

---

## Depends on

- **DR-003** — hard blocker for the entire set, and per C18 it is itself blocked on one line. Its Phase A is now VERIFIED zero-deploy (P1) and should not wait on this record.
- **DR-006** — retains ownership of the envelope, the one front-matter schema (C10), and the tier boundary; loses its INCIDENTS gate to #362 (C27) and gains the orphan tier it did not model (C1).
- **DR-008** — becomes the sole owner of ageing, escalation, the session capsule and the override valve (C7, C11, C28), and owns the one budgeted required context (C13).
- **DR-012** — becomes the sole owner of D10 and `os/ledger/` (C4), supplies the C18 answer, and inherits one new obligation (C22, the strict record schema).
- **DR-009** — becomes the owner of `os/agents/AUTHORITY.md` (C15), which three records consume and none produced.
- **DR-005** — keeps LOOP-001; gains LOOP-002 as its mandatory cross-link partner (C2); loses its parallel per-PR evidence record to #362's proof contract (C8); its intent gate holds the reserved second required context and must earn it in WARN mode.
- **DR-010** — owns the graduation ledger, but its contents come from this ruling's budget (C24); adopts DR-012's two labelled acceptance units (C4).
- **DR-004 / DR-007 / DR-011 / DR-013** — each keeps its central argument and loses specific machinery, cited above.
- **DR-001 / DR-002** — unaffected by this record, and per DR-008 they become the first two items on the clock, which is the fastest honest test of whether any of this works.
- **PR #362** — not a DR, but it owns immutability (C27), the proof contract (C8), the `WRITE_APPROVALS` map that must gain one entry (C14/P5), and the Wave-1 precedent that both budgeted contexts queue behind.

---

## Unknowns

- **Whether Prez will accept a PARTIAL on D16 criterion 4.** The honest consequence of C2 is that certification reports two live loops and six deferred, not eight interconnected. If the mission's success condition is a clean twelve-for-twelve scorecard, then DR-013's pairing schedule is the correct plan and C2 should be reversed — but that reversal costs six loops' worth of new authority built before the first one has closed a cycle, which is the D14 inversion. **This is a values question, not an engineering one, and it is the single most consequential thing in this record.** *Resolves via:* Prez stating whether "100% AI-Native" means all twelve criteria VERIFIED at Stage 6, or means the diagnostic runs honestly and names what is not yet true.
- **Whether `DISABLE_BACKGROUND_JOBS` is actually set on the backend service** (P3). I read variable *names* only and deliberately did not read values, per repo law. If background jobs run on both services, the CI-side observer sees one Actions trigger and two executions, and the `job_run` artifact needs a `serviceId`. *Resolves via:* one `list-variables` read on service 3528dc9f.
- **Whether a scheduled workflow can reach the `environment: Production` secret without a manual approval prompt** (DR-004's unknown #1, DR-011's deep-run dependency). Unchanged by this record; still gates C23. *Resolves via:* reading the environment's protection rules, or one throwaway scheduled run.
- **Whether the required-check budget survives its first genuine need for a third context.** The budget is a judgment with no evidence behind it — it is set at two because that is what a one-person team can keep meaningful, not because two is a measured threshold. *Resolves via:* the first PR that argues for a third; if the argument is good, the budget file changes and the reason is in the diff, which is the mechanism working rather than failing.
- **Whether consolidating five gates into the existing Vitest job makes that job slow enough to be resented.** It is currently one of three required contexts and it now inherits artifact validation, index integrity, charter validation, threshold checking, loop-checking and the budget assertion. All are file parses; all should be milliseconds. But "should be" is the honest label. *Resolves via:* timing the job on the first consolidated PR, and splitting to a second context only if it measurably degrades — which would spend the reserved budget slot on plumbing rather than on DR-005's intent gate, and that trade should be ruled deliberately.
- **Whether this record should exist at all as a peer-overruling artifact, or whether Prez should simply rule the ten records in order and let me implement the resolution silently.** Issuing it is the more expensive and more honest path, and it is the one D6 asks for — the reasoning behind a consolidation is exactly the reasoning a future cycle needs to tell whether the consolidation still applies. But it is a rung-3 act by an executor over peer records, and it has no legitimacy until countersigned. *Resolves via:* Ruling 1.