# GitHub Actions cron endpoints (off the legacy platform — data freshness)

Replaces the always-on in-process `setInterval` schedulers (which burn Railway
credits 24/7) with GitHub-Actions-driven, on-demand runs.

## How it works

```
GitHub Actions (timer)  ──POST + Authorization: Bearer $CRON_SECRET──▶  Railway app
  .github/workflows/cron-*.yml                                          /api/cron/*
```

Each endpoint: shared-secret authed → responds `200` immediately → runs the work
in the background under a single-flight run-lock (no overlapping runs).

| Endpoint                             | Work                                                              | Workflow             | Cadence           |
| ------------------------------------ | ----------------------------------------------------------------- | -------------------- | ----------------- |
| `POST /api/cron/vsin-odds`           | `runVsinRefresh()` — NBA/NHL/MLB VSiN + AN odds                   | `cron-vsin-odds.yml` | every 15 min      |
| `POST /api/cron/scores`              | `refreshAllScoresNow()` — live scores                             | `cron-scores.yml`    | every 10 min      |
| `POST /api/cron/bet-grade`           | `runBetGradeCycle()` — settle PENDING bets, today + yesterday     | `cron-bet-grade.yml` | every 10 min      |
| `POST /api/cron/bet-grade-sweep`     | `gradeAllPendingAllDates()` — settle every PENDING bet, all dates | `cron-bet-grade.yml` | nightly 08:15 UTC |
| `POST /api/cron/mlb-cycle`           | `runMlbCycleOnce()` — lineups, K-props, backtest writes           | `cron-mlb-cycle.yml` | every 10 min      |
| `POST /api/cron/mlb-outcomes`        | `ingestMlbOutcomes()` — actual scores + Brier columns; `?date=`   | none yet             | —                 |
| `POST /api/cron/mlb-closing-capture` | `captureClosingLines()` — lock today's closing odds snapshot      | none yet             | —                 |
| `POST /api/cron/mlb-backtest`        | backtest SELF-HEAL for unenrolled FINAL games; `?date=`           | none yet             | —                 |
| `POST /api/cron/mlb-asg`             | All-Star Game seed/refresh (synchronous, returns audit)           | `mlb-asg.yml`        | —                 |
| `POST /api/cron/stripe-reconcile`    | Stripe↔DB reconciliation                                          | —                    | —                 |
| `GET  /api/cron/status`              | run-lock state for all jobs (observability)                       | —                    | —                 |

The table above was corrected 2026-08-07: it previously listed 5 of the 8 mounted
endpoints, omitting `mlb-cycle`, `mlb-asg` and `stripe-reconcile`.

**No workflow file exists yet for the three MLB learning-loop endpoints.** They are
mounted and callable, but nothing calls them on a schedule — wiring the cadence is a
separate change. Two operational constraints when you do:

- `mlb-backtest` runs `runKProps=false` and `onlyUnenrolled=true` by design. Hold any
  `?date=` BULK BACKFILL until after the K walk-forward re-fit —
  `K_CALIBRATION_FACTOR_OVER/UNDER` are still the pre-M-204 literals, and enrolling
  against constants that are about to change pollutes the evaluation set the re-fit
  is judged on. The rolling default window is safe: it only fills genuine gaps.
- `mlb-outcomes` defaults to the last **2 PT** dates and `mlb-backtest` to the last
  **3 ET** dates. Those zones are not interchangeable — `games.gameDate` is a PT
  calendar date, so a late West Coast final belongs to the PT day even after UTC
  has rolled over.

Bet grading is the one job whose absence is silent: with no cron path, setting
`DISABLE_BACKGROUND_JOBS=1` would stop settlement without an error — bets just
never leave `PENDING`. Both grading endpoints share the single-flight run-lock
with the in-process scheduler's mutex being independent, so running both is
safe: whichever reaches a bet first settles it, and the other finds an empty
`PENDING` set.

## Why not reuse the legacy `/api/scheduled/*` auth

Those endpoints authenticated against the **retired platform's OAuth server**,
accepting only a session whose `openId` was prefixed `cron_` (issued exclusively
by the legacy heartbeat platform, now removed). A GitHub
Actions runner has no such cookie, so it can never pass that guard. These
endpoints therefore use a host-independent shared secret instead — see
`cronAuth.ts`.

## Setup (one-time)

1. **Railway → Variables:** set `CRON_SECRET` to a long random string. Keeping
   `DISABLE_BACKGROUND_JOBS=1` is what makes this migration save credits.
2. **GitHub → repo Settings → Secrets and variables → Actions:**
   - `RAILWAY_APP_URL` — the app's public URL, no trailing slash
     (e.g. `https://your-app.up.railway.app`)
   - `CRON_SECRET` — the **same** value as in Railway
3. Rotating the secret = update both places.

Fail-closed: if `CRON_SECRET` is unset on the server, every cron request is
rejected `503` — the endpoints are never implicitly open.

## Not included here — MLB model sync

`runMlbModelForDate()` spawns `/usr/bin/python3` (400k Monte-Carlo sims), which
fails on Railway with `spawn /usr/bin/python3 ENOENT`. Curling a Railway endpoint
for it would just error. It needs **Python-in-the-runner** (run the model inside a
GitHub Actions job with DB write-back) — a separate follow-up, not an HTTP curl.
