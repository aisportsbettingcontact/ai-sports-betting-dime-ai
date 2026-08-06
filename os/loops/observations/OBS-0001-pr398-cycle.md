# OBS-0001 — the first completed LOOP-001 cycle: PR #398 merged green and was wrong

**Status:** CLOSED · **DRI:** Prez · **Kind:** observation · **Loop:** LOOP-001 · **observe_by:** 2026-08-08
**Cycle:** `merge-536404bdc304` (PR #398) · **Merged:** 2026-08-06T00:03:40Z

> The first cycle of Dime's first designated loop to complete all seven D5 components — action,
> artifact, **observed outcome**, evaluation, and a filed adjustment. Until this artifact existed,
> every cycle in `os-ledger:cycles.jsonl` carried `outcome: null`, which is the honest record of a
> loop that had not yet closed.

---

## Action

PR #398 merged to `main` — the goal-record type (`shared/os/goal.ts`), GR-0001 itself,
`scripts/os/contradiction.mjs`, and 12 tests. Merge commit `536404bdc3041e510a1d72c56f33cafd9561e95e`.

## Artifact

`origin/os-ledger:cycles.jsonl`, line for PR #398: tree SHA, 4 files changed, proof-contract run
`31057867211`, `observe_by: 2026-08-08`.

## Outcome — observed, not assumed

**Every gate passed and the change was defective.**

Green: 11 of 11 check runs on the merge commit, including all three required contexts. Both Railway
services deployed SUCCESS. `/health` 200, `db` circuit CLOSED, `schema: ok`. Smoke 10/10.

Then a 35-agent adversarial audit raised 29 findings, of which **21 survived independent
refutation**. Two could not have been caught by any gate in the repository:

1. **`shared/os/goal.ts` was binary to git.** It shipped with two raw NUL bytes used as a glob
   sentinel. `git diff` reported `Bin 0 -> 4863 bytes`; `--numstat` reported `-` on both sides. No
   reviewer could see a diff of it, `git blame` was useless on it, and the patch-coverage gate saw
   zero changed lines. The NUL rendered as a space, so the obvious "cleanup" would have introduced
   a silent over-matching bug.
2. **The number in GR-0001 came from untested code.** `contradiction.mjs` reimplemented the glob
   matcher inline with a **space** sentinel where the library used **NUL**. The two provably
   disagree — `docs/a b/**` vs `docs/aXXXb/x.md` returns `false` from the library and `true` from
   the script. All 12 passing tests covered the library; the reported figure came from the script.

Also found: the section parser slurped an H3 subsection's prose into the activity-path globs, so
**the act of documenting the first reading changed the reading** — GR-0001 silently declared six
priorities instead of four.

## Evaluation

Against GR-0001's acceptance criteria and D5's standard that an action is not an outcome.

The verdict is about the *instruments*, not just the change. Three ran:

| Instrument | Result | Found |
|---|---|---|
| required checks (Security Audit, TypeScript Check, Vitest) | pass | nothing |
| deploy + live smoke | pass | nothing |
| fresh-context adversarial audit | 21 confirmed | everything |

**The two instruments that run on every merge would have certified #398 as successful.** That is
the finding, and it is the reason this loop is worth its cost: without the third instrument, the
cycle would have closed green and the defects would have compounded into every artifact GR-0001
governs.

## Adjustment

Four corrective merges, each verified after landing:

| PR | Closed |
|---|---|
| #399 | 6 defects — the duplicate matcher, the NUL bytes, the H3 leak, fail-open catches, a stale artifact, an unescaped `?` |
| #400 | 6 more — the clock could not see its own flagship goal; absence of evidence read as evidence of contradiction; only the first goal record was measured |
| #403 | the state line contradicted the UNRESOLVED line printed directly above it |
| #405 | 13 more — evidence-free cycles counted as off-goal; fenced blocks parsed as declarations; the clock fired 7h early; `contradiction.mts` had never been type-checked |

Structural changes that outlive the specific bugs: a source-hygiene gate makes a raw control byte in
`/os/` source fail the build; the runner script imports the tested library and a guard forbids it
building a matcher of its own; and `scripts/os/**` entered the TypeScript program, which it had
never been in.

## Memory

- [[the-script-that-runs-is-not-the-code-thats-tested]]
- [[an-exit-code-cannot-tell-a-diagnosis-from-a-crash]]

## What changes in the next cycle

**A merge is not evaluated by its gates.** Gates are necessary and were never sufficient — all three
required checks passed on a change carrying 21 confirmed defects. The adversarial audit moves from
"a thing that was done once" to the loop's third evaluation instrument, and its absence on a cycle
is a gap in that cycle's evidence, not a clean bill of health.
