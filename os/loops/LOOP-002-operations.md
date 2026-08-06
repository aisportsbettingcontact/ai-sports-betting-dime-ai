# LOOP-002 — Operations (cron cadence observation)

**Status:** ACTIVE · **DRI:** Prez · **Kind:** loop · **Goal:** GR-0001 · **observe_by:** 2026-08-20
**Doctrine:** D5 · D7 (function loops) · D16 criteria 3 and 4

> Activated alongside LOOP-001 because **a cross-link between loops cannot be demonstrated with one
> loop.** Scoped deliberately small: one CI-side observer, **zero production change**. It reads what
> GitHub already records and compares it to what the repository already declares.

---

## 1. What objective controls this process?

**GR-0001**, narrowed to one question this loop can actually answer: *do Dime's scheduled processes
run at the cadence they declare?*

The limit matters as much as the objective. This loop is **observe-only**. It does not retry a
missed run, change a schedule, or touch a production system — because the first thing it found is
that the declared cadences are unachievable, and a loop that "fixed" that by firing more jobs would
be optimizing the number rather than the truth.

## 2. Who owns the result?

**Prez.** Whether a 5-minute pipeline is allowed to run hourly is a product decision about data
freshness, not an engineering preference. The loop reports; the DRI decides.

## 3. What evidence informed the most recent action?

The measurement in [[OBS-0002]], taken 2026-08-06 over a 24-hour window using `gh run list`:
every high-frequency cron is throttled to **~12–13 runs/day** regardless of what it declares.

| Workflow | Declared | Expected/24h | Actual/24h | Ratio |
|---|---|---|---|---|
| `cron-mlb-cycle` | `*/5` | 288 | 12 | **0.04×** |
| `cron-scores` | `*/10` | 144 | 13 | **0.09×** |
| `cron-vsin-odds` | `*/15` | 96 | 13 | **0.14×** |
| `cron-bet-grade` | `*/30` | 49 | 12 | **0.24×** |
| `12-nightly-verification` | `23 9` | 1 | **0** | **0.00×** |

Median gap between consecutive `cron-mlb-cycle` runs: **101 minutes** against a declared 5.
Longest observed gap: **202 minutes**.

## 4. What did the system do?

Nothing to production. `scripts/os/observe-crons.mjs` read the `schedule:` blocks declared in
`.github/workflows/*.yml`, read the completed scheduled runs GitHub records for each, and computed
the ratio of actual to declared.

## 5. What artifact records it?

[[OBS-0002]] — the cadence observation, with the raw numbers above and the method used to get them.
The observer re-runs daily via `.github/workflows/os-observe-crons.yml` and fails when a workflow
falls below its declared floor, so the finding is a standing check rather than a one-time
measurement.

## 6. What happened afterward?

**Every one of those under-running workflows reported `success`.** In the 24-hour window,
`cron-mlb-cycle` recorded 12 successes and 0 failures; `cron-scores` 13/0; `cron-vsin-odds` 13/0;
`cron-bet-grade` 12/0.

That is the finding, and it is worse than the drift itself. A pipeline declared to refresh every
five minutes, running every 101 minutes, is **green on every dashboard Dime has**. The gap between
declared and actual cadence was invisible to CI, to alerting, and to the operator — for as long as
these workflows have existed.

`12-nightly-verification` did not run at all in the window and is likewise not red anywhere.

## 7. How was the result evaluated?

Against the declared schedule, which is the only written standard that exists for these jobs. The
comparison is deliberately mechanical — declared expression → expected runs per day → observed runs
per day — because the alternative is judgement about what cadence "feels" acceptable, and that
judgement is the DRI's, not the observer's.

Evaluated a second way, against D5's own test: *success is never assumed because planned activity
occurred.* Twelve green runs looked like twelve successes. They were twelve runs out of 288.

## 8. What changed because of the evaluation?

[[DR-016]] was raised — the decision about which cadences Dime actually needs, given that the
declared ones are not achievable on GitHub-hosted schedules. It is Prez's ruling, not the executor's:
the options (accept hourly, move the hot paths to the in-process scheduler, or pay for a runner that
honours the cadence) trade cost against data freshness.

Nothing was silently "fixed". Raising the frequency to compensate would have made the number look
better and changed nothing real.

## 9. What knowledge will influence the next cycle?

- [[a-green-cron-is-not-a-run]] — a scheduled job's conclusion describes the runs that happened, and
  says nothing about the ones that did not. Absence has no conclusion, so it has no colour on a
  dashboard.
- The observer's own blind spot, below, is the written trigger for the TiDB observation tier.

## Components

| Component | This loop |
|---|---|
| Goal | GR-0001, narrowed to declared-vs-actual cadence |
| Context | `.github/workflows/*.yml` `schedule:` blocks; GitHub's own run history |
| Action | `scripts/os/observe-crons.mjs`, daily, read-only |
| Artifact | `os/loops/observations/OBS-*.md` plus the workflow run itself |
| Outcome | which schedules are honoured, which are not, and by how much |
| Evaluation | actual runs/24h against the declared expression's expected count |
| Adjustment + Memory | a decision record for the DRI, and a filed lesson |

## Known limitations — stated, not discovered later

**A CI-side observer cannot see the in-process schedulers.** It reads GitHub Actions runs, and the
server also runs **48 `setInterval` schedulers** inside the Express process — the DB keep-alive, the
checkout reconciler, and the three bet-auto-grade pollers among them. None of those appear in
`gh run list`. If one dies, this loop stays green.

That blind spot is the **written trigger for building the TiDB observation tier**: the moment an
in-process scheduler's health becomes load-bearing, a CI-side observer is the wrong instrument and
this loop must be re-scoped rather than trusted.

Two smaller limits, recorded so nobody rediscovers them:

- GitHub retains run history for a bounded window, so the observer measures a rolling 24 hours and
  cannot answer "was this ever honoured?".
- A workflow disabled in the UI reports zero runs and looks identical to one being throttled. The
  observer reports the count; it does not diagnose the cause.
