# OBS-0002 — declared cron cadence is not the cadence Dime runs at

**Status:** OPEN · **DRI:** Prez · **Kind:** observation · **Loop:** LOOP-002 · **observe_by:** 2026-08-13
**Measured:** 2026-08-05 (UTC), a complete 24-hour window · **Instrument:** `scripts/os/observe-crons.mts`

> The first observation LOOP-002 produced. It is cited by [[DR-016]], which is the decision
> LOOP-001 recorded in response — the cross-link between Dime's two active loops.

---

## What was measured

For every workflow declaring a `schedule:` block, the cron expression's expected runs for that
calendar date against the scheduled runs GitHub actually recorded.

```
     02-codeql.yml                      declared 17 6 * * 1                expected    0  actual    0    —
  !! 12-nightly-verification.yml        declared 23 9 * * *                expected    1  actual    0     0%
  !! cron-bet-grade.yml                 declared */30 * * * * + 15 8 * * * expected   49  actual   11    22%
     cron-mlb-canonical-refresh.yml     declared 0 9 * * *                 expected    1  actual    1   100%
  !! cron-mlb-cycle.yml                 declared */5 * * * *               expected  288  actual   12     4%
  !! cron-scores.yml                    declared */10 * * * *              expected  144  actual   13     9%
     cron-stripe-reconcile.yml          declared 17 9 * * *                expected    1  actual    1   100%
  !! cron-vsin-odds.yml                 declared */15 * * * *              expected   96  actual   13    14%
     perf-harness.yml                   declared 0 12 * * *                expected    1  actual    1   100%
     refresh-cf-cidrs.yml               declared 17 6 1 * *                expected    0  actual    0    —
     security-audit-weekly.yml          declared 0 9 * * 1                 expected    0  actual    0    —
     stripe-e2e.yml                     declared 41 4 * * *                expected    1  actual    1   100%

  5 of 12 schedule(s) NOT honoured on 2026-08-05
```

Gaps between consecutive `cron-mlb-cycle` runs, in minutes, against a declared 5:

```
96, 107, 88, 68, 64, 85, 201, 169, 164, 130, 145, 103, 101, 107, 72, 76, 69, 88, 202
median 101 · max 202
```

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
Dime has shows them green. `12-nightly-verification` did not run at all and is likewise not red
anywhere.

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
- **The in-process schedulers are invisible here.** 48 `setInterval` schedulers run inside the
  Express process and appear in no GitHub run list. See LOOP-002's known limitations.

## Method

```bash
npx tsx scripts/os/observe-crons.mts --dry-run --date 2026-08-05
```

Declared schedules parsed from `.github/workflows/*.yml`; actual runs from
`gh run list --event schedule`; expected counts from `expectedRunsOnDate` in
`shared/os/cadence.ts`, which walks the 1440 minutes of the named date rather than deriving a rate,
so a monthly job is not reported broken on the 30 days it is correctly silent.

Re-runs daily via `.github/workflows/os-observe-crons.yml`, so this is a standing check rather than
a one-time measurement.
