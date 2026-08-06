# Loops

The closed loop is **the smallest complete unit of Dime** *(D5)*. Every important process is
captured as one here.

```
Goal → Context → Action → Artifact → Outcome → Evaluation → Adjustment + Memory → Updated Context
                                                                      ↑                        │
                                                                      └────────────────────────┘
```

## The contract

Every `LOOP-*.md` with `Status: ACTIVE` must, **at any time**:

1. answer all **nine** D5 interrogation questions, each with a non-empty body;
2. name all **seven** components in its Components table;
3. name the **goal record** it serves, its **DRI**, and its **evaluation method**.

`shared/os/loop.ts` enforces this and `shared/os/loop.test.ts` fails the required `Vitest` check
when a record cannot comply. **A loop that cannot answer the nine questions is not a loop — it is a
description of one**, and the difference is exactly what the Stage 1 audit found missing when it
scored Dime Level 2 of 4.

A `DEFERRED` loop is held to a different, smaller standard: it must state `blocked_on:` and nothing
more. Demanding nine answers from an undesignated loop would force fabricated ones, which is worse
than an honest gap. Deferral must be a **decision with a reason**, never a quiet omission — the same
principle the authority ladder applies to seats.

## Roster

| Loop | Status | Serves | Note |
|---|---|---|---|
| [LOOP-001 Engineering Build](LOOP-001-engineering-build.md) | ACTIVE | GR-0001 | merge-to-main is the apply step; ~13 cycles/day |
| [LOOP-002 Operations](LOOP-002-operations.md) | ACTIVE | GR-0001 | cron cadence observation; CI-side, zero production change |
| [LOOP-003 Model Release](LOOP-003-model-release.md) | DEFERRED | — | blocked_on: DR-005 |
| [LOOP-004 Customer Evidence](LOOP-004-customer-evidence.md) | DEFERRED | — | blocked_on: DR-001 |
| [LOOP-005 Support](LOOP-005-support.md) | DEFERRED | — | blocked_on: NO_VOLUME |
| [LOOP-006 Revenue](LOOP-006-revenue.md) | DEFERRED | — | blocked_on: DR-002 |
| [LOOP-007 Hiring](LOOP-007-hiring.md) | DEFERRED | — | blocked_on: NO_DEMAND |
| [LOOP-008 Content and Voice](LOOP-008-content-voice.md) | DEFERRED | — | blocked_on: DR-001 |

**Two active loops at v1 is the honest number**, and two is also the minimum: a cross-link between
loops cannot be *demonstrated* with one. Six deferred loops are recorded rather than omitted so that
the gap between what Dime runs and what D7 describes is visible on its face.

## Observations

`observations/` holds what a loop learned. The engineering loop's cycle *artifacts* are written by CI
to the `os-ledger` orphan branch and are append-only and machine-authored; an **observation** is the
human- or executor-authored record of an outcome, its evaluation, and the adjustment that followed.
Keeping them apart is deliberate: it stops a machine record from being edited to match a story.

An observation must cite the cycle or run it observed. `shared/os/loop.ts` resolves those citations,
so a link to something that does not exist fails the gate rather than reading as evidence.
