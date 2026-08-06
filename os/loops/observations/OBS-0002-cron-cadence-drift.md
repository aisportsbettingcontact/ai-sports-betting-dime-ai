# OBS-0002 — declared cron cadence is not the cadence Dime runs at

**Status:** OPEN · **Corrected:** 2026-08-06 · **DRI:** Prez · **Kind:** observation · **Loop:** LOOP-002 · **observe_by:** 2026-08-13
**Measured:** 2026-08-05 (UTC), a complete 24-hour window · **Instrument:** `scripts/os/observe-crons.mts`

> The first observation LOOP-002 produced. It is cited by [[DR-016]], which is the decision
> LOOP-001 recorded in response — the cross-link between Dime's two active loops.

---

## What was measured

For every workflow declaring a `schedule:` block, the cron expression's expected runs for that
calendar date against the scheduled runs GitHub actually recorded.

```
  !! cron-bet-grade.yml                 declared */30 * * * * + 15 8 * * * expected   49  actual   11    22%
  !! cron-mlb-cycle.yml                 declared */5 * * * *               expected  288  actual   12     4%
  !! cron-scores.yml                    declared */10 * * * *              expected  144  actual   13     9%
  !! cron-vsin-odds.yml                 declared */15 * * * *              expected   96  actual   13    14%
     cron-mlb-canonical-refresh.yml     declared 0 9 * * *                 expected    1  actual    1   100%
     cron-stripe-reconcile.yml          declared 17 9 * * *                expected    1  actual    1   100%
     perf-harness.yml                   declared 0 12 * * *                expected    1  actual    1   100%
     stripe-e2e.yml                     declared 41 4 * * *                expected    1  actual    1   100%
     security-audit-weekly.yml          declared 0 9 * * 1                 expected    0  actual    0    —
     (4 workflows excluded: first added 2026-08-05, so they did not exist for the whole day)

  4 of 9 schedule(s) NOT honoured on 2026-08-05
```

Gaps between consecutive `cron-mlb-cycle` runs, in minutes, against a declared 5:

```
96, 107, 88, 68, 64, 85, 201, 169, 164, 130, 145, 103, 101, 107, 72, 76, 69, 88, 202
median 101 · max 202
```

### Correction, 2026-08-06 — this observation shipped with a false positive

The first version of this record reported **5 of 12** unhonoured and listed
`12-nightly-verification` at **0 of 1 (0%)**. That figure was wrong, and it was the most alarming
line in the table.

`12-nightly-verification.yml` was first added to the repository on 2026-08-05 and reached `main` at
**2026-08-06T04:38Z** — after the entire measured UTC day. It could not have run at its 09:23 UTC
schedule because it did not exist on the default branch at that time. Two other workflows
(`02-codeql.yml`, `refresh-cf-cidrs.yml`) were in the same position; both were expected to run zero
times that day anyway, so excluding them changes no verdict.

The instrument had no guard for "did this workflow exist for the whole window?" It has one now, and
it answers from git rather than from the API. The corrected figure is **4 of 9**.

The four real findings below are unchanged, and were re-verified independently: those workflows were
added 2026-07-09, 2026-07-10 and 2026-08-01, all before the measured day; the `gh` result window
reaches back to 2026-07-15, so it fully covers 2026-08-05; and every run on the date is `completed`
with conclusion `success` — no `skipped` or `cancelled` runs were filtered out.

## The finding that outranks the drift

**Every under-running workflow reports `success`.** Over the window:

| Workflow | runs | success | failure |
|---|---|---|---|
| `cron-mlb-cycle` | 12 of 288 | 12 | 0 |
| `cron-scores` | 13 of 144 | 13 | 0 |
| `cron-vsin-odds` | 13 of 96 | 13 | 0 |
| `cron-bet-grade` | 11 of 49 | 11 | 0 |

A run that never happened has no conclusion, so it has no colour. Four production data pipelines
have been running at roughly **1/10th to 1/25th of their declared frequency**, and every dashboard
Dime has shows them green.

This is D5's warning made concrete: *success is never assumed because planned activity occurred.*
Twelve green runs looked like twelve successes. They were twelve runs out of two hundred
eighty-eight.

## What is NOT claimed

- **No cause is diagnosed.** The pattern is consistent with GitHub's documented throttling of
  scheduled workflows on busy repositories, but this observation measures runs, not reasons. A
  workflow disabled in the UI would look identical.
- **No data-freshness impact is asserted.** Whether MLB projections refreshed every 101 minutes
  instead of every 5 actually harmed anything depends on the product, and that is [[DR-016]]'s
  question, not this artifact's.
- **The in-process schedulers are invisible here.** 30 `setInterval` call sites across 16 server
  files run inside the Express process and appear in no GitHub run list. See LOOP-002's known
  limitations.

## Method

```bash
npx tsx scripts/os/observe-crons.mts --dry-run --date 2026-08-05
```

The measured day defaults to the most recent COMPLETE UTC day, never today. Scoring a partial day
against a full day's expectation would have reported every high-frequency workflow as unhonoured
every single day regardless of reality — at the observer's 10:40 UTC run time, a perfectly honoured
five-minute job can only have produced 129 of 288 runs, which is 45% and below the floor.

Declared schedules parsed from `.github/workflows/*.yml`; actual runs from
`gh run list --event schedule`; expected counts from `expectedRunsOnDate` in
`shared/os/cadence.ts`, which walks the 1440 minutes of the named date rather than deriving a rate,
so a monthly job is not reported broken on the 30 days it is correctly silent.

Re-runs daily via `.github/workflows/os-observe-crons.yml`, so this is a standing check rather than
a one-time measurement.
