# LOOP-001 — Engineering Build Loop

**Status:** ACTIVE · **DRI:** Prez · **Kind:** loop · **Goal:** GR-0001 · **observe_by:** 2026-08-20
**Doctrine:** D5 (seven components, nine questions) · D7 · D13 · D16 criteria 3 and 4

> Dime's first designated closed loop. It was chosen over every alternative for one reason:
> **its apply step already exists and already works.** Merge-to-main fires ~13×/day without anyone
> remembering to do it, which is the strongest survival property available (§ survival law). Every
> other candidate loop needs its apply step *built* before a cycle could complete at all.

---

## 1. What objective controls this process?

**GR-0001** — Dime operates as a closed, queryable, self-improving system — bounded by the limits
that record declares. The engineering loop inherits every one of them, and two bind hardest here:
**merge to `main` IS a production deploy**, and **no schema change ships ahead of `db-push.yml`**.

The objective is explicitly *not* throughput. D5 warns that a loop told only to increase output
produces unnecessary code, and this loop is the one most able to do that: it can merge 13 times a
day and change nothing that matters. Its limit is therefore **every merge must have an observable
outcome**, not "more merges".

## 2. Who owns the result?

**Prez.** Rung 3 on the authority ladder, and the only actor holding it. The executor operates at
rung 2 — it may open PRs and push branches; it may not merge, deploy, or touch production data. The
apply step of this loop is, by construction, the point where a human decides.

## 3. What evidence informed the most recent action?

The adversarial audit of PR #398: **32 findings raised, 15 confirmed after independent refutation**,
across six dimensions. Two mattered beyond the artifact system — a governance number produced by
untested code, and a source file that was binary to git and therefore outside review entirely.

Earlier in the same chain: the audit of #398 itself (29 raised, 21 confirmed) and of #400
(32 raised, 15 confirmed). The evidence is recorded in the PR bodies of #399, #400, #403 and #405.

## 4. What did the system do?

Merged five PRs to `main` in sequence — #398, #399, #400, #403, #405 — each one an apply step
gated by Prez, each triggering a production deploy of both Railway services.

## 5. What artifact records it?

`origin/os-ledger:cycles.jsonl`, one line per merge, written by
`.github/workflows/os-ledger-append.yml`. Each carries the merge SHA, tree SHA, PR number, merge
instant, file count, the run id of `01-pr-proof-contract`, an `observe_by` date, and
`outcome: null` until observed.

The cycle for this evaluation is **`merge-536404bdc304`** (PR #398). Machine-written and
append-only; the observation of its outcome is a separate artifact, [[OBS-0001]], for the reason
`os/loops/README.md` gives — a machine record must not be editable to match a story.

## 6. What happened afterward?

**PR #398 merged clean and was wrong anyway.** All 11 checks passed, both services deployed
SUCCESS, the live site stayed healthy, and 10/10 smoke checks passed. Then the post-merge audit
found 21 confirmed defects in it, including two that no gate in the repo could have caught:

- `shared/os/goal.ts` shipped with two raw NUL bytes, which made it **binary to git** — no diff, no
  blame, no review, and invisible to the patch-coverage gate;
- the number written into GR-0001 was produced by `contradiction.mjs`, which **reimplemented the
  matcher** with a different sentinel than the tested library and gave different answers.

The deploy verdict was green. The outcome was not. That gap is the whole reason this loop exists.

## 7. How was the result evaluated?

Against GR-0001's acceptance criteria and the D5 standard that **an action is not an outcome**.
Three instruments, in increasing severity:

1. the required checks (`Security Audit`, `TypeScript Check`, `Vitest`) — passed;
2. deployment and live verification (`scripts/smoke-deploy.mjs`, `/health`) — passed;
3. a fresh-context adversarial audit that tries to **refute** each finding before it counts.

Only the third one found anything. Recorded honestly: **the two gates that pass on every merge
would have certified #398 as successful.**

## 8. What changed because of the evaluation?

Four corrective merges — #399 (6 defects), #400 (6 more), #403 (1), #405 (13) — carrying the
substantive adjustments: the runner script now imports the tested library instead of duplicating it;
a source-hygiene gate makes a control byte in `/os/` source fail the build; the clock can finally
see `ACTIVE` artifacts; evidence-free cycles no longer count against the goal; and
`scripts/os/contradiction.mts` entered the type-check program, which it had never been in.

The full evaluation and its adjustments are recorded in [[OBS-0001]].

## 9. What knowledge will influence the next cycle?

Two lessons, both filed and retrievable:

- [[the-script-that-runs-is-not-the-code-thats-tested]] — green tests beside a claim are not
  evidence *for* that claim unless they cover the code that produced it.
- [[an-exit-code-cannot-tell-a-diagnosis-from-a-crash]] — asserting on an exit code tests almost
  nothing about intent, and a fail-path test that has not been mutation-tested is not evidence.

The operative change to the next cycle: **a merge is not evaluated by its gates.** Gates are
necessary and were never sufficient — all three required checks passed on a PR carrying 21 defects.

## Components

| Component | This loop |
|---|---|
| Goal | GR-0001, with its declared limits |
| Context | the repository, `CLAUDE.md`, `/os/`, the open PR and its diff |
| Action | open a PR → binding gates → **Prez merges** (rung 3) → Railway deploys both services |
| Artifact | `os-ledger:cycles.jsonl`, one line per merge, plus the PR body and proof contract |
| Outcome | deploy verdict + live smoke + what the change actually did downstream |
| Evaluation | required checks, then `smoke-deploy.mjs`, then a fresh-context adversarial audit |
| Adjustment + Memory | a corrective PR and a filed lesson under `os/memory/lessons/` |

## Cadence and cycle time

Elapsed cycle time is roughly **48 hours** — the `observe_by` window on each cycle artifact — with
dozens of cycles running concurrently. Merge-to-deploy is ~50 seconds per service.

## Known limitations

- **One merge produces two deploys** (gap F7.6) and only the domained service is smoke-tested. This
  bit on 2026-08-05: Incident 62, two FAILED backend deploys with no customer impact and no CI
  signal.
- `Secret Scan (gitleaks)` is **not** a required check (gap F6.10). It runs and reports; it does not
  block.
- `required_approving_review_count: 0`. Nothing forces a second pair of eyes.
