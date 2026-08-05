# Lessons

One lesson per file. One-line summary as the H1. Corrections and confirmed approaches alike, each
with **why it mattered** and **how to apply**. Update rather than duplicate; delete what is proven
wrong. Never store what the repo or artifact system already records.

Lessons attach to the **process**, so that when the same work begins again the relevant lesson is
retrieved automatically rather than buried in a postmortem *(doctrine §8, L7)*.

## Seeded 2026-08-05 from the Stage 1 audit

| Lesson | Origin |
|---|---|
| [Owner-gated is not a terminal state](owner-gated-is-not-a-terminal-state.md) | The 2026-07-28 program's death by silence |
| [db-push before new columns](db-push-before-new-columns.md) | Incident 43 (never filed — see below) |
| [Incident numbers collide](incident-numbers-collide.md) | Concurrent allocation, 3 entries lost |
| [Fixture-verified is not production-verified](fixture-verified-is-not-production-verified.md) | `OPERATING-RULES.md` §7, repeatedly confirmed |
| [Numbers in narratives are usually generated](numbers-in-narratives-are-usually-generated.md) | 110-claim verification pattern |
| [Tests can report green without asserting](tests-can-report-green-without-asserting.md) | Orphan glob + vacuous pass |
| [Gates must be required to be gates](gates-must-be-required-to-be-gates.md) | 2 advisory gates, 9 ceiling raises |
| [One branch, one PR, one stage](one-branch-one-pr-one-stage.md) | Two stages missed their merge window by 15 min and 1 min |
| [A config API is not runtime truth](config-api-is-not-runtime-truth.md) | I refuted my own RAILPACK finding with one build-log read |
| [A gate in the same command block is not a gate](a-gate-in-the-same-command-block-is-not-a-gate.md) | I scanned and pushed in one block; the scan gated nothing |
