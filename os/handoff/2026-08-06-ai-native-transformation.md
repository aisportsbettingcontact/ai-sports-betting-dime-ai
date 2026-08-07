# Handoff — AI-Native Transformation, Stages 1–4

**Status:** ACTIVE · **DRI:** Prez · **Kind:** handoff · **observe_by:** 2026-08-20
**Covers:** 2026-08-05 → 2026-08-06 · **Executor:** Claude Opus 5 (1M context), rung 2
**Serves:** [[GR-0001]] · **Loops:** [[LOOP-001]] engineering build, [[LOOP-002]] operations

> Everything done, everything found, everything still open. Written so a fresh context can resume
> without re-deriving any of it. Where a claim here has evidence, the evidence is named; where a
> number is live, the command that produces it is given rather than the number alone.

---

## 1. The mission, in one paragraph

Audit Dime against the twelve-criterion D16 AI-Native scorecard, then close the gap: **AUDIT →
BRAINSTORM → PLAN → EXECUTE → TEST → VALIDATE → PUSH**, fractal at every level. Doctrine lives in
`os/DOCTRINE.md` (D1–D16, the Dime translation of the Y Combinator playbook). The Stage 1 audit
scored the company **Level 2 of 4**: excellent raw materials, and almost no closed loop anywhere
that mattered.

**Hard limits that governed every action** — no force-pushes, no history rewrites, no merges to
`main` or production deploys without Prez's gate, no production data mutation, no destructive
operations, `gitleaks`-clean before every push. Merge to `main` **is** a production deploy under
Dime's deploy law. Every material claim carries **VERIFIED / INFERRED / UNKNOWN**; a DONE claim
without VERIFIED evidence is void.

## 2. How to resume

```bash
git fetch origin main os-ledger
git checkout main && git pull                      # the working tree drifts; see §11
npx vitest run shared/os scripts/os                # expect 244 passing
npx tsx scripts/os/contradiction.mts               # LOOP-001's D13 reading
npx tsx scripts/os/observe-crons.mts --dry-run     # LOOP-002's cadence reading
node scripts/os/clock.mjs                          # what is overdue, and on which branch
```

Read in this order: `os/DOCTRINE.md` → `os/audits/2026-08-ai-native-audit.md` → `os/plan/README.md`
→ `os/goals/GR-0001-ai-native-certification.md` → `os/loops/README.md` → this file.

## 3. Every PR, in order

All merged to `main`, each one deployed to both Railway services, each verified after landing.

| PR | Files | What it did |
|---|---|---|
| **#369** | 14 | Stage 1+2 — the AI-native audit (Level 2 of 4), 110 claims, 96 open loops, first decision records |
| **#375** | 21 | Stage 2 — 14 decision records + **DR-014**, the consolidation ruling that cut the plan to a minimal system |
| **#377** | 3 | Stage 3 — master build plan, plus two fixes verification found |
| **#378** | 20 | Stage 3 — the plan and 17 independently shippable issues |
| **#379** | 8 | **ISSUE-017 — my own RAILPACK finding REFUTED by me.** The Dockerfile is the builder |
| **#380** | 5 | Completed that correction — 8 stale references #379 missed |
| **#385** | 5 | Stage 4 — Wave 0 complete: **DR-015** (Stage 3 plan approved), the corpus manifest, dark-state preserved |
| **#387** | 22 | **ISSUE-006** artifact gate + **ISSUE-007** `observe_by` clock — the checks that catch my own drift |
| **#388** | 8 | **ISSUE-008** token ledger — $6,272.08 spent, 87.7% of the cost saved by caching |
| **#391** | 5 | **ISSUE-009** ledger-append-on-merge — a merge stops being an unobserved event |
| **#393** | 3 | Fix: a cycle's proof-contract reference was always `null` |
| **#395** | 1 | **Incident 62** — the schema gate failed two backend deploys; no entry existed |
| **#396** | 5 | **ISSUE-010** authority ladder — D16 criterion 7 |
| **#398** | 4 | **ISSUE-011** goal record + GR-0001 — D13's contradiction check, made computable |
| **#399** | 8 | Five defects found auditing #398 — **the tested code was not the running code** |
| **#400** | 6 | Six more, including **a false claim I had repeated to Prez** |
| **#403** | 2 | The state line contradicted the UNRESOLVED line printed directly above it |
| **#405** | 8 | 13 findings from the #400 audit — and the guard that caught my own hollow test |
| **#407** | 28 | **ISSUE-013** first loops — and a fenced example was overriding the goal |
| **#411** | 8 | **ISSUE-012** gate the drift detector — and the measurement that inverted it |
| **#412** | 10 | LOOP-002 was reporting green from a shallow clone; its headline gap used the wrong window |
| **#415** | 8 | LOOP-002 saw 1 of 4 declared schedules and invented 2 more — replaced the YAML scan |
| **#417** | 7 | **ISSUE-012** a proposal you can actually decide + the second contradiction |

## 4. What exists now — the artifact system

**83 files under `os/`** — `git ls-files os | wc -l`. The map:

| Path | What it holds |
|---|---|
| `os/DOCTRINE.md` | D1–D16, the certification scorecard, the monthly cadence |
| `os/STATE.md` | the four D4 questions |
| `os/audits/` | the Stage 1 audit, the gap map (96 open loops → 9 families), the builder resolution |
| `os/audits/appendix/` | the full 110-claim ledger + 71 adversarial rechecks — **immutable, exempt from sweeps** |
| `os/decisions/` | **DR-001 … DR-016** + README (declares two kinds: `decision`, `consolidation`) |
| `os/goals/` | **GR-0001** — the mission's own goal record and the worked example of the type |
| `os/loops/` | LOOP-001 … LOOP-008 + README (the D5 nine-question contract) |
| `os/loops/observations/` | **OBS-0001** (the first completed live cycle), **OBS-0002** (cron cadence) |
| `os/memory/lessons/` | 15 lessons, each with *why it mattered* and *how to apply* |
| `os/plan/` | the master plan, WAVE-0-COMPLETE, and **ISSUE-001 … ISSUE-017** |
| `os/ledger/` | token ledger, prices, sessions, human-equivalence |
| `os/agents/` | the authority ladder (canonical `.md`, generated `.json` mirror) |
| `os/corpora/` | 125,223 files / 51.26 GB manifest |

## 5. What exists now — the code

| File | Purpose |
|---|---|
| `shared/os/artifacts.ts` | the artifact envelope + validator; decision-record contract by kind and status |
| `shared/os/authority.ts` | parses the authority ladder; executor must have a rung, DEFERRED needs `blocked_on` |
| `shared/os/cost.ts` | token pricing; `null` for unknown models, never a guess |
| `shared/os/cycle.ts` | the merge cycle artifact; `outcome` born `null`, `assertRevish`, PR-number extraction |
| `shared/os/goal.ts` | the nine L1 fields, activity-path validation, `findPriorityContradiction` |
| `shared/os/loop.ts` | the D5 contract — nine questions, seven components, cross-link resolution |
| `shared/os/cadence.ts` | cron arithmetic, `HONOURED_FLOOR`, complete-day helpers, `runGaps` |
| `shared/os/markdown.ts` | **the one fence-aware reader** — CommonMark fence rules, section location |
| `shared/os/workflowSchedules.ts` | reads `on.schedule` from a workflow, refuses what it cannot parse |
| `scripts/os/clock.mjs` | the per-prompt `observe_by` clock; names a non-`main` ref |
| `scripts/os/contradiction.mts` | LOOP-001's D13 reading |
| `scripts/os/observe-crons.mts` | LOOP-002's cadence observer |
| `scripts/os/ledger-append.mjs` | writes one cycle artifact per merge to the `os-ledger` orphan branch |
| `scripts/os/authority-sync.mjs` | keeps the JSON mirror honest |
| `server/mlbRecalibrationGate.ts` | the recalibration gate — propose-first, session-sourced identity |
| `server/mlbDriftDetector.ts` | `applyOrPropose()` — the patcher is unreachable by default |

**Workflows:** `.github/workflows/os-ledger-append.yml` (on push to main, writes only to the
`os-ledger` orphan branch) and `.github/workflows/os-observe-crons.yml` (daily 10:40 UTC,
`fetch-depth: 0`, read-only).

**Test count on `main`: 231**, across 15 files — 213 in the 14 files under `shared/os` +
`scripts/os` (`npx vitest run shared/os scripts/os`), plus 18 in
`server/mlbRecalibrationGate.test.ts`, which that command does not match. Everything rides the
already-required `Vitest` check — **this mission added no new required status check**,
deliberately, so nothing it built could block an unrelated merge.

Note the repo moved underneath that reasoning: the required set grew from **3 contexts to 9** on
2026-08-05T15:09 PDT, and `Secret Scan (gitleaks)` is now among them. An earlier draft of this
handoff said the repo "has never once promoted one" — that is REFUTED; Prez promoted six.

## 6. Every audit, and what survived

| Target | Agents | Raised | Confirmed | Refuted |
|---|---|---|---|---|
| Stage 1 — the company | 84 | 110 claims | 31 VERIFIED · 39 PARTIAL | 40 REFUTED |
| PR #398 | 35 | 29 | **21** | 8 |
| PR #400 | 38 | 32 | **15** | 17 |
| PRs #403 + #405 | 37 | 31 | **13** | 18 |
| LOOP-002 precision | 47 | 42 | **23** | 19 |

Every finding was **re-derived by hand before being actioned**. Several agent findings did not
reproduce and were rejected — e.g. a claim that `cron-bet-grade` showed 12 (main already said 11;
the agent tested a stale tree), and a claim that a `#` comment inside a fenced block truncated a
section (it does not).

## 7. The findings that mattered most

**The tested code was not the running code (#399).** `contradiction.mjs` reimplemented the glob
matcher with a **space** sentinel where the library used **NUL**. They disagreed —
`docs/a b/**` vs `docs/aXXXb/x.md` returns `false` from the library, `true` from the script — and
the number written into GR-0001 came from the script while all twelve passing tests covered the
library.

**A source file was binary to git (#399).** `shared/os/goal.ts` shipped with two raw NUL bytes.
`git diff` showed `Bin 0 -> 4863 bytes`; no reviewer could see a diff, `blame` was useless, and the
patch-coverage gate saw zero changed lines. The NUL rendered as a space, so the obvious "cleanup"
would have introduced the over-matching bug the script already had.

**Writing down the reading changed the reading (#399).** The section splitter used `/^##\s/`, which
cannot match `### `. The `### First reading` subsection added to *document* the result was parsed as
more activity-path globs, so GR-0001 silently declared six priorities instead of four.

**A fenced example could override the goal (#407).** A ` ```markdown ` block whose first line was
`## Activity paths` **replaced** the real declaration — `declared example/only/**`, `contradiction
YES`, against work that was 100% on-goal. A fence mentioning `## Constraints` also **satisfied that
required field**. Root cause: heading location ran on raw markdown.

**The observer was permanently green (#412).** `actions/checkout` defaults to `fetch-depth: 1`. In a
depth-1 clone `git log --diff-filter=A` reports the one available commit as the add date for every
file, so the workflow-age guard excluded all 13 workflows and printed **`all 0 declared schedules
honoured`**, exit 0, forever. The guard added to prevent false positives created a false negative
that is strictly worse.

**The headline gap was measured over the wrong window (#412).** `median 101 · max 202` was computed
from `gh run list --limit 20` — the last twenty runs *overall*, spanning **35.6 hours across three
days** — and labelled "a complete 24-hour window". The published maximum was a gap that occurred
entirely on the following day. True in-window values: **median 107, max 201**.

**The scanner saw 1 of 4 schedules and invented 2 (#415).** Flow mappings, inline sequences and
flush-indented blocks were silently dropped; a folded scalar captured `">-"` and aborted the run;
`schedule:` inside a `run: |` heredoc and under `env:` were read as real triggers.

**The drift detector had been dead for 89 days (#411).** `migrateCalibrationConstants` requires
**single-quoted** keys; `MLBAIModel.py` has used double quotes since **2026-05-09**, commit
`4c27b4f5f` ("Enterprise modernization", authored by Manus). Measured across all 22 revisions:
matchable in 9 (2026-04-14 → 04-30), unmatchable in every revision since. **Zero adjustments have
ever been applied**, while `mlb_model_learning_log` recorded `accuracyAfter` as though the model had
adopted the new value. **Incident 63.**

**A false claim I repeated to Prez (#400).** GR-0001 said DR-001 was *"overdue on the clock
2026-08-12"* and I said so several times. It was not overdue — that is its `observe_by` **deadline**.
Corrected in place with a dated note rather than silently edited.

## 8. What mutation testing caught in my own work

Every guard in this system was mutation-tested. **Five survived on first attempt and had to be
fixed** — this is the honest record:

1. **An exit-code-only assertion.** Replacing a deliberate `die()` with a silent skip still exited
   non-zero (via a downstream `TypeError`), so the test passed. → assert the **diagnosis**, and the
   absence of a `TypeError`.
2. **A structural "is the word nearby" test.** Replacing the guard with `if (true)` — restoring the
   unconditional patch — left it green. → extracted `applyOrPropose()` with an **injectable
   patcher**, so "the patcher is never called" is testable directly.
3. **The default path was uncovered.** Every test passed an explicit `--date`, so reverting the
   default to *today* stayed green — and the default is the path the daily workflow takes.
4. **A client-supplied identity.** The *type* forbids `decidedBy`, so no test could express the
   attack; adding a runtime fallback stayed green. **TypeScript is not a runtime guard.** → three
   tests now smuggle `decidedBy`, `role` and `approver` into the input.
5. **A feature with no test at all** — the clock's ref-naming.

Two further "survivals" were **my own badly constructed mutations**, not hollow tests: they did not
disable the behaviour they named. Reconstructed properly, both failed correctly. That distinction is
itself worth remembering.

## 9. The lessons (15)

`os/memory/lessons/` — each carries **why it mattered** and **how to apply**:

`owner-gated-is-not-a-terminal-state` · `gates-must-be-required-to-be-gates` ·
`tests-can-report-green-without-asserting` · `numbers-in-narratives-are-usually-generated` ·
`incident-numbers-collide` · `db-push-before-new-columns` · `fixture-verified-is-not-production-verified` ·
`one-branch-one-pr-one-stage` · `config-api-is-not-runtime-truth` ·
`a-gate-in-the-same-command-block-is-not-a-gate` · `the-script-that-runs-is-not-the-code-thats-tested` ·
`an-exit-code-cannot-tell-a-diagnosis-from-a-crash` · `a-green-cron-is-not-a-run` ·
`an-observer-can-manufacture-its-own-findings` · `a-formatter-can-disable-a-control-path`

## 10. The loops

**LOOP-001 — Engineering Build.** ACTIVE. Merge-to-main is the apply step; it fires ~13×/day
without anyone remembering to do it, which is the strongest survival property available. Cycle
artifacts land in `os-ledger:cycles.jsonl`. **OBS-0001** records the first completed live cycle:
PR #398 passed all 11 checks, deployed clean, smoked 10/10 — and the audit then found 21 confirmed
defects. *The two instruments that run on every merge would have certified it.*

**LOOP-002 — Operations.** ACTIVE. A CI-side cadence observer, zero production change. Its first
observation found four production pipelines running at **4%, 9%, 14% and 22%** of declared cadence,
**every recorded run green**. Its written blind spot: it cannot see the ~30 in-process `setInterval`
schedulers, and that is the stated trigger for building the TiDB observation tier.

**LOOP-003 … LOOP-008** are DEFERRED, each with a `blocked_on` reason. Six deferred loops recorded
rather than omitted, so the gap between D7's eight and Dime's two is visible on its face.

**The cross-link is demonstrated, not asserted:** DR-016 is recorded by LOOP-001 and its entire
evidentiary basis is OBS-0002 from LOOP-002; `shared/os/loop.test.ts` resolves the citation and
fails if the artifact is deleted.

## 11. Open, and waiting on Prez

**The D13 contradiction has fired three consecutive times and is worsening.** At the time of writing:

```
cycles        33
on-goal       13 (39%)
contradiction YES — only 13/33 cycles touched the declared priority paths
```

**The globs have not been widened and must not be.** Adjusting a priority definition until the
contradiction clears games the measure D13 exists to provide, and GR-0001 says so in writing. There
are exactly two honest responses, and both are the DRI's:

1. **Security and feed work genuinely IS the priority.** Then GR-0001's declared activity paths are
   out of date and should be amended — deliberately, on the record.
2. **Mission work is being crowded out.** Then the number is doing its job and the allocation is
   what changes.

**Fifteen decision records are AWAITING RULING, fourteen due 2026-08-12, DR-016 due 2026-08-13.**
The clock will report them daily from the day after. The three raised most often in conversation:

- **DR-001** publish posture — gates LOOP-004 and LOOP-008
- **DR-002** pricing reconciliation — gates LOOP-006
- **DR-016** cron cadence truth — the executor recommends option 1 (make the declaration honest)
- plus the `.gitignore` ruling for the 47 GB untracked tree

**A working-tree note.** The clock reports on whatever is checked out. During this engagement it
repeatedly reported ISSUE-012 overdue from a branch 13 commits behind `main`, *after* the fix had
landed. It now names a non-`main` ref (`[OS] [some/feature] …`) so this is visible; a `git pull`
quiets it.

## 12. What is next, in order

1. **ISSUE-012's last criterion** — `modelVersion` + `paramsHash` on every projection, so *"did the
   last recalibration help?"* becomes answerable. 7 of 8 criteria are met; this one spans the whole
   projection path and is genuinely the largest remaining piece of that issue.
2. **ISSUE-014 — the first agent seat.** Unblocked: SEAT-001 was `DEFERRED blocked_on: LOOP-002`,
   and LOOP-002 is live.
3. **Wave 4** — **ISSUE-015** (the D15 diagnostic), **ISSUE-016** (the Level-4 rescore instrument),
   then **Stage 6 certification** against the twelve D16 criteria.

**Known findings raised by audit and deliberately NOT actioned**, so nobody rediscovers them as new:

- `pnpm/action-setup` is pinned to **two different SHAs** across the repo — `0ebf4713…` (5
  workflows) and `b906affc…` (`pi-review.yml`, `feed-responsive-cross-browser.yml`).
- `docs/ai-native/execution-state.json` claims the recalibration gate is *"IMPLEMENTED_UNVERIFIED
  (production) … owner decides via `mlbSchedule.decideRecalibration`"*. That procedure did not exist
  until PR #417; the claim predates this work and overstates what existed when written.
- The `os-ledger` cycle artifacts all carry `outcome: null` except where an observation exists.
  **That is the honest record**, not a bug: an action is not an outcome.
- One merge produces **two** Railway deploys and only the domained service is smoke-tested (gap
  F7.6). This bit on 2026-08-05 as Incident 62.
- ~~`Secret Scan (gitleaks)` is not a required check (gap F6.10)~~ — **gap F6.10 is CLOSED.**
  It is now required and blocks a merge, along with five other contexts promoted the same day.
  `os/agents/AUTHORITY.md` carries the corrected reading.

## 13. Operating rules that governed this work

Kept here because they are the reason the record can be trusted:

- **One branch, one PR, one unit.** Two merge races happened early from reusing branches with open
  PRs; both were my error, both are in the lessons.
- **`gitleaks` runs as its own call, never in the same command block as the push** — a gate in the
  same block gates nothing.
- **Verify ancestry, not the API's word:** `git merge-base --is-ancestor <sha> origin/main`.
- **Mutation-test every guard, in both directions**, and re-check any mutation that survives — it
  may be the mutation that is wrong, not the test.
- **Corrections are dated and recorded, never silently edited.** OBS-0002 carries two.
- **Never widen a measure to clear a finding.**

## 14. Corrections to this record — 2026-08-07

Three defects found by auditing this file against the repository it describes. Recorded here rather
than silently edited, per §13.

**1. §3 omitted #385 — a whole PR of the mission was missing from "every PR, in order."** The table
as merged ran #380 → #387, so a fresh context resuming from this file would not have found DR-015
or `WAVE-0-COMPLETE.md`. The row is restored above. The program's complete set is **24 PRs**: the 22
originally tabled, plus #385, plus #428 (this record). Three independent discriminators return that
same set and are worth keeping as the way to re-derive it —

```bash
# 1. title convention
gh pr list --state all --limit 3000 --json number,title \
  -q '.[] | select(.title|test("^(os\\(|fix\\(os\\)|os:|incident:)")) | .number'
# 2. branch prefix — every mission PR shipped from os/*
gh pr list --state all --limit 3000 --json number,headRefName \
  -q '.[] | select(.headRefName|startswith("os/")) | .number'
# 3. diff paths — finds 23 of 24; #395 touched only INCIDENTS.md, which is why the
#    title and branch discriminators are not redundant with this one
```

**2. §4 said "82 files under `os/`" — it was 83 at this record's own merge commit.** The count was
taken before the file counting itself had landed. `git ls-tree -r --name-only 203c12fdb | grep -c
'^os/'` returns 83. Now stated with the command that reproduces it.

**3. §5 said "244 tests, across 16 files" — REFUTED. The real figures are 231 across 15.** No method
reproduces 244 or 16. The mission's test files have not changed since this record merged
(`git log 203c12fdb..origin/main -- shared/os scripts/os server/mlbRecalibrationGate.test.ts` is
empty); 15 mission test files existed at that merge commit; `server/mlbDriftDetector.test.ts` — the
only candidate 16th file — has never existed on any ref
(`git log --all --diff-filter=A -- server/mlbDriftDetector.test.ts` is empty); and the static
`it(`/`test(` count is 216, also not 244. So the number was already wrong when written, not made
wrong by later drift.

This is `numbers-in-narratives-are-usually-generated`, fired against the record whose §9 lists it.
The lesson holds in the first person: a file that names its own failure modes does not thereby
become exempt from them. The two counts that mattered were both stated without the command that
produces them — which is why both are now stated with it.
