# DR-014 — Consolidation ruling: cut the set to what survives, and fill four holes

**Status:** AWAITING RULING · **DRI:** Prez · **Raised:** 2026-08-05 (Stage 2, three adversarial critics)
**Kind:** consolidation
**Governs:** DR-004 … DR-013
**Urgency:** BLOCKING — must be ruled before DR-004…DR-013 are implemented
**Doctrine:** D4 (one reality) · D14 (visibility before autonomy) · D15 #4, #15, #16 · D16 §17

> **This record governs.** DR-004 through DR-013 were drafted blind to each other. Three critics —
> coherence, doctrine, and survival — reviewed the set together. Where this record and any other
> Stage 2 record disagree, **this one wins.**

---

## The finding that reframes everything

**Seven of the ten records terminate in "…and then this becomes a required status check."**

That action has never been performed at this company. All five `main-protection` ruleset revisions
since 2026-07-08 carry the identical three contexts — `Security Audit`, `TypeScript Check`,
`Vitest`. Never expanded, never contracted. [VERIFIED]

```
45447573  2026-08-05  ['Security Audit','TypeScript Check','Vitest']
45447216  2026-08-05  ['Security Audit','TypeScript Check','Vitest']
42747020  2026-07-10  ['Security Audit','TypeScript Check','Vitest']
42746653  2026-07-10  ['Security Audit','TypeScript Check','Vitest']
42517018  2026-07-08  ['Security Audit','TypeScript Check','Vitest']
```

This also **corrects the Stage 1 audit**: `DB Tests` and `Build & Preview Gate` were never
*demoted* to advisory. They were **never promoted** — which is worse, because it means the promotion
step itself is the thing that does not happen.

### The survival law at Dime, measured

| Tier | Definition | Evidence |
|---|---|---|
| **1 — survives** | Blocks the merge | 3 required contexts, `bypass_actors: []`, strict policy. Fixed in minutes because 13 PRs/day cannot flow past them |
| **2 — survives** | Auto-loads into every session or prompt | `CLAUDE.md` 31 commits/30 days. Versus `OPERATING-RULES.md` — declares itself *"non-negotiable, read at every session start"*, loaded by no hook, **dead 28 days.** The delta is entirely whether a hook loads it |
| **3 — dies** | Everything else | **Measured response rate: zero** |

Tier 3, measured today:

| Mechanism | Observed | Response |
|---|---|---|
| `security-audit-weekly.yml` | 4 scheduled runs, **4 failures**, 2026-07-13 → 08-03 | none, 3 weeks |
| `perf-harness.yml` | **11 of last 12 push runs failed**, all 2026-08-05 | ~30 PRs merged straight through them, same day |
| GitHub Issues | **0 opened in 366 PRs** | channel never once used |
| `todo.md` | 781 open checkboxes | last commit 2026-07-23 |
| `INCIDENTS.md` | 61 entries | last touched 2026-07-29 |
| `docs/ai-native/` | complete closed-loop slice | 8 days, then silence |

**A red non-required workflow at Dime produces zero action. That is not inferred — it is happening
right now, on two workflows simultaneously.**

**Consequence:** only **two** designs in the whole set route enforcement through an already-required
job — DR-006 (rides `Vitest`; `shared/**/*.test.ts` and `scripts/**/*.test.ts` are already in the
include globs) and DR-009 (rides `TypeScript Check`). Every survivor must be re-homed onto those two
jobs, or onto the per-prompt hook.

---

## Four facts resolved read-only during review

| # | Fact | Consequence |
|---|---|---|
| **P1** | **Both Railway services are pinned to `source.branch = "main"`** [VERIFIED, Railway MCP read-only] | Orphan-branch pushes are **deploy-inert**. This was flagged BLOCKING-unknown by DR-005, DR-011 and DR-013 and relied on by DR-003 Phase A. **Confirmed safe.** Delete the unknown from four records |
| **P2** | **Both services build with `RAILPACK`, not the Dockerfile** — `railway.json` declares `DOCKERFILE`, live config says otherwise [VERIFIED] | Resolves audit §8's builder UNKNOWN **in the dangerous direction.** Python-runner availability at runtime is unproven. See HOLE B — the drift detector's self-patch may already be silently failing |
| **P3** | **`required_approving_review_count: 0`, `bypass_actors: []`** [VERIFIED] | **DR-008's stated safety premise is false.** It assumed a second account approves every merge; no review is required at all. Every override it contemplates is genuinely unilateral with no co-signer |
| **P4** | Production env holds `ANTHROPIC_API_KEY` and **no** `ANTHROPIC_BASE_URL`/`AUTH_TOKEN` | Confirms DR-012's rejection of the gateway-meter option |

---

## Ruling 1 — Cut three records entirely

Not deferred. **Cut**, with their one durable idea each absorbed.

### CUT DR-013 (eight-loop paired activation)
A one-founder company that just watched a **one**-loop program die in 8 days is being handed an
**eight**-loop program with a wave plan, five hard dependencies, and an observer on the
`security-audit-weekly` channel (0/4 response). It is the failure mode this mission exists to break,
scaled by eight.

**Absorb:** its cross-link test — *a loop may not be declared LIVE until an artifact id it produced
resolves inside another loop's recorded decision.* That is a five-line assertion; it moves into
DR-006's test file. Loop ordering becomes one `status: deferred` line per loop file.

### CUT DR-011 (founder dashboard)
Nine panels, three rendering `not_measured` on day one, six checks, ~9 scripts, escalating through a
tracker with **zero uses in company history** — and it proposes to instrument whether that channel
works by writing the instrumentation into the artifact the channel delivers. Circular.

**Absorb:** replaced entirely by three lines in `.claude/scripts/prompt-capsule.sh` (Ruling 3).

### CUT DR-010 (two factories + ACCEPTANCE files)
The product-code half is ~90% **PR #362, which is already built and open** — merging #362 is
strictly cheaper and strictly dominant. The model half cannot produce a real number until the
`modelProb decimal(5,2)` defect is resolved and CLV columns stop being NULL, so its headline output
on day one is `not_measured`: a schema-correct system with no rows that *looks* answered.

**Absorb:** one sentence — acceptance thresholds live in a versioned file under `/os/`, shape-checked
by the Vitest job, numbers not enforced until they can be computed.

**Optional fourth cut: DR-007 (OS Index),** absorbed into DR-006. A generated JSON index committed on
every one of 13 daily merges is constant conflict resolution by hand, and its frontmatter contract,
query surface, and staleness logic each duplicate a sibling. Its load-bearing contribution — the
frontmatter contract — is already DR-006's.

---

## Ruling 2 — One substrate, one clock, one gate, one writer

The set as drafted builds **three artifact stores, three ageing mechanisms, four per-PR JSON
artifacts, four GitHub-issue bots, and five frontmatter schemas** — for one company with one human.
That is a D4 violation ("agents may divide labor, never maintain incompatible realities") committed
by the program written to enforce D4.

| Collision | Ruling |
|---|---|
| **Three artifact substrates** (DR-006 `/os/` on main · DR-004 TiDB `loop_artifacts` · DR-005/011/012/013 orphan branch, under two different names) | **Three tiers, ruled once.** (1) Hand-authored org artifacts → `/os/` on `main`. (2) Machine-generated artifacts → **one** orphan branch `os-ledger` (`os-state` retired). (3) TiDB `loop_artifacts` → **DEFERRED**, specified not built; written trigger = the first artifact kind that must be emitted by the running server and cannot be reconstructed from CI |
| **Ageing built 3–4 times** (DR-008 · DR-007 · DR-011 · DR-013) | **DR-008 owns ageing exclusively.** One clock field `observe_by`, one enforcement path, one standing record, one session capsule, one override valve |
| **Four per-PR JSON artifacts** (#362's `proof-contract.json` · DR-005 · DR-010 · DR-012) | **One file, one job**, assembling #362's proof contract + threshold verdicts + intent/loop linkage + cost block. DR-005 must **not** mint a parallel evidence record |
| **Cron cadence observed 4×, twice via production deploy** | **One CI-side observer**, zero production change: `scripts/os/observe-crons.mjs`, daily, diffing declared schedules against `gh run list`. Honest named blind spot: *it cannot see the in-process `setInterval` schedulers*, only Actions-triggered ones. That blind spot is the written trigger for tier 3 |
| **Five frontmatter schemas** | **DR-006 owns one zod schema**; other records *contribute* per-kind required fields |
| **Two new SessionStart hooks, two already exist** (300 s + 45 s) | **Exactly one** new hook, owned by DR-008, ≤2 s, reads a cached JSON, `exit 0` unconditionally |
| **Four GitHub-issue writers, zero issues ever opened** | **One writer, one label taxonomy** — and per Ruling 3, issues are the *evidence* channel, never the *enforcement* channel |

**Loop designation:** DR-005 wins the designation (**LOOP-001 = Engineering Build Loop**); DR-013
wins the promotion *rule* (mechanical cross-link test as the LIVE criterion). Exactly one partner
activates with it — **LOOP-002 = Operations (cron cadence observation)** — because a cross-link test
needs two loops to be satisfiable at all.

**Seats:** DR-009's three proposed seats all serve loops DR-005 defers, so **DR-009's own gate would
reject them on day one.** Ruling: **one active seat at v1** (SEAT-001 run-recorder, bound to
LOOP-002). SEAT-002 and SEAT-003 → DEFERRED with reasons. That is an honest Level-2→3 step, not a
roster.

---

## Ruling 3 — The channel the whole set missed

`.claude/scripts/prompt-capsule.sh` is a `UserPromptSubmit` hook that injects text into **every
prompt**. It is already wired, already trusted, `exit 0` always — and today it is a static heredoc.
**No decision record touched it.** DR-008 proposed `SessionStart`, which fires once per session.
This fires once per *prompt*.

Make the last line dynamic:

```
[OS] 3 items overdue — DR-001 ruling (12d), LOOP-001 outcome unobserved (4d), INC-21 (11d).
```

The state file it reads is generated by DR-006's already-required test run — so **if the generator
breaks, `Vitest` goes red on the next merge, within the hour, at 13 merges/day.** No new workflow. No
new required check. No GitHub issue. No orphan branch. No service.

The empirical case is already settled in this repo: `CLAUDE.md` is loaded by the harness and has 31
commits in 30 days; `OPERATING-RULES.md` declares itself mandatory, is loaded by nothing, and has
been dead for 28 days. **That is the whole survival question, and Dime already ran the experiment.**

---

## Ruling 4 — Four holes nobody owns

The doctrine critic scored the set against all twelve D16 §17 criteria. Four have **no owner at
all** — these are holes in the design space, not weaknesses in a record.

### HOLE A — the goal record (L1) is referenced by three records and designed by none
Doctrine L1 specifies `os/goals/GR-####-*.md` with **nine fields**. No record designs it. The
envelope's 11 artifact kinds include no goal.
**Consequence:** D13's founder-loop flagship requirement — *"surfaces contradictions: a claimed
priority that engineering activity ignores"* — is **not computable anywhere in the set**. Neither is
D5's "goal, specific enough to evaluate, **with limits**." **Criteria 2, 5 and 9 all fail on this one
missing type.**
**Ruling:** the goal record is added to DR-006's schema as a first-class kind, and this mission
writes **GR-0001** for its own outcome as the worked example.

### HOLE B — the one live open-loop automation survives the mission unowned
`server/mlbDriftDetector.ts:814` still executes `fs.writeFileSync(MODEL_PY, src)` on `main` **today**
[VERIFIED this session]. It is the audit's named D15 #2 exemplar (F4.1, HIGH).
Across ten records: DR-009 *forbids a new seat* from doing it; DR-005 and DR-013 defer the model
loop; nobody else touches it. **Forbidding a new seat from doing what shipped code already does is
not a control. Criterion 3 cannot pass while it stands.**
Aggravated by **P2**: under RAILPACK the write may silently no-op or write to a filesystem wiped
every deploy. **An automation whose effect status is unknown is worse than one known to fire.**
**Ruling:** this is a standalone work item in Stage 3, owned, with two steps — (1) determine whether
it currently fires at all, (2) route it through propose→decide→apply using the already-written
`mlbRecalibrationGate.ts`. It does not wait for the model loop.

### HOLE C — the authority ladder has two claimants, two formats, and no owner
Criterion 7 is *"authority ladder enforced."* **No `AUTHORITY.md` exists anywhere in the repo**
[VERIFIED]. DR-009 validates charters against it and explicitly declines to own it; DR-004 proposes a
different format (`authority.json`); DR-005 asserts a rung for merge-to-main. So the set has an
enforcement gate, two consumers, two file formats — **and no ladder.**
**Ruling:** `os/agents/AUTHORITY.md` (human) + one machine mirror is a **named Stage 3 deliverable
with its own issue**, written *before* DR-009's charter gate. It must include a rung for **the
executor of this mission** — doctrine L5 requires that explicitly, and it is the rung under which
everything else in Stage 4 is performed.

### HOLE D — the D15 diagnostic (criterion 11) has no owner
Nothing in the set runs the 17-failure-mode protocol or schedules its recurrence, and D16 requires it
to run clean end to end.
**Ruling:** the diagnostic is a Stage 6 deliverable with a written monthly cadence in `DOCTRINE.md`
§17 (already stated) and a named artifact under `os/audits/`.

**Also unowned:** criterion 1 (the Level-4 rescore) — the Level-2 score came from an 84-agent,
6.13M-token one-off, and nothing makes it repeatable or names who signs it. **Ruling:** the rescore
instrument is a Stage 6 deliverable; the fresh-context verifier signs it, Prez countersigns.

---

## The smallest system that actually closes a loop

Everything above reduces to five things. Nothing else in the ten records is load-bearing at 30 days.

| # | Thing | Why it survives |
|---|---|---|
| 1 | **DR-003's commit** | Hard blocker on 9 of 10 records; also fixes `aiCostMeter.ts:20`, without which **nothing merges at all** |
| 2 | **DR-006's git tier + envelope**, validated by `scripts/os-artifacts.test.ts` inside the already-required `Vitest` check — **structural validation only, no time assertions** | Live on day one with no ruleset change. *(Time assertions get skipped, because they turn Vitest red on unrelated PRs at 13 merges/day — `kenpomCredentials.test.ts` is the precedent)* |
| 3 | **DR-012's session-cost hook**, plus one line setting `cleanupPeriodDays` | Automatic; the emitter **already ran and produced real numbers** |
| 4 | **DR-005's ledger-append-on-merge** | Rides merge-to-main — the one event that fires ~13×/day without anyone remembering |
| 5 | **DR-008's `observe_by` field**, surfaced through `prompt-capsule.sh` on every prompt | Makes it structurally impossible to write "blocked on owner" without writing the date at which that silence becomes a defect. **The smallest correct fix for F2 in the entire set** |

Four files, one hook edit, one test file, one settings line. Every mechanism is either automatic or
already required. **Nothing in it needs Prez to remember, read, promote, or regenerate anything.**

Everything cut is 2026-07-28 with better handwriting.

---

## Requested ruling

> **Prez: approve DR-014's four rulings — (1) cut DR-010, DR-011, DR-013 (and optionally DR-007);
> (2) the one-substrate / one-clock / one-gate / one-writer consolidation; (3) `prompt-capsule.sh`
> as the primary escalation channel instead of GitHub issues and new required checks; (4) the four
> holes assigned as named Stage 3 deliverables — and confirm the five-item minimal system as Stage
> 4's scope.**

**A yes commits you to:**
- A deliberately smaller operating system than the mission brief implies — **two live loops, one
  active agent seat, and a PARTIAL on D16 criterion 4 at first certification, on the record.**
  Faking that criterion is the exact failure the mission exists to correct.
- Enforcement riding `Vitest` and `TypeScript Check` rather than new required checks — meaning **no
  ruleset change is needed for the core system to bind.**
- A dynamic line in your per-prompt capsule that will tell you what is overdue, every prompt.

**One thing I need regardless of this ruling:** **P2 (RAILPACK vs Dockerfile) should be filed as an
incident now.** It is a live production-correctness question — the Python model runners hardcode
`/usr/bin/python3`, which is the exact failure the Dockerfile exists to prevent — and it is currently
unowned by every record including this one. One build-log read resolves it.

## Depends on

**DR-003** is the hard blocker for 9 of the 10 records. Nothing in Stage 4 is buildable until the
`/os/` tree and `shared/loop/` are in git and the working tree typechecks.

## Open unknowns

- Whether `Security Audit` (a required context) is the gitleaks job under another name, or a separate
  job — the Stage 1 audit reported gitleaks as one of four required checks; this review found three
  contexts and no `Secret Scan`. One `gh api` read reconciles it, and it matters because gitleaks
  being non-required would be a material regression of SEC-006.
- Whether `DISABLE_BACKGROUND_JOBS` is actually set on the backend service — variable *names* are
  readable, values are not, and this settles the long-pending single-writer question. One
  `list-variables` read.
- The real cost of the RAILPACK finding: whether MLB model runs are succeeding in production at all.
