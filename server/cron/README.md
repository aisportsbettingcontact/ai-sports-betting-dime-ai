# GitHub Actions cron endpoints (off-Manus data freshness)

Replaces the always-on in-process `setInterval` schedulers (which burn Railway
credits 24/7) with GitHub-Actions-driven, on-demand runs.

## How it works

```
GitHub Actions (timer)  ──POST + Authorization: Bearer $CRON_SECRET──▶  Railway app
  .github/workflows/cron-*.yml                                          /api/cron/*
```

Each endpoint: shared-secret authed → responds `200` immediately → runs the work
in the background under a single-flight run-lock (no overlapping runs).

| Endpoint | Work | Workflow | Cadence |
|---|---|---|---|
| `POST /api/cron/vsin-odds` | `runVsinRefresh()` — NBA/NHL/MLB VSiN + AN odds | `cron-vsin-odds.yml` | every 15 min |
| `POST /api/cron/scores` | `refreshAllScoresNow()` — live scores | `cron-scores.yml` | every 10 min |
| `POST /api/cron/mlb-cycle` | `runMlbCycleOnce()` — MLB lineups / K-props / backtest | `cron-mlb-cycle.yml` | every 5 min |
| `POST /api/cron/mlb-daily-seeds` | `seedPitcherStats()` + `seedBullpenStats()` + `seedPitcherRolling5()` + `seedTeamBattingSplits()` — sequential, per-seeder try/catch; job reports failure if any seeder failed | `cron-mlb-daily-seeds.yml` | daily 10:00 UTC |
| `POST /api/cron/mlb-weekly-seeds` | `seedParkFactors()` + `seedUmpireModifiers()` — same batch semantics | `cron-mlb-weekly-seeds.yml` | Mondays 09:00 UTC |
| `GET  /api/cron/status` | run-lock state for all jobs (observability) | — | — |

The two `mlb-*-seeds` workflows ship **inert**: their trigger step is gated on the
repo **variable** `MLB_SEEDS_CRON_ENABLED == '1'` (Settings → Secrets and variables
→ Actions → Variables), so enabling them at Manus cutover is a variable flip — no
workflow-file edit or manual UI disable/enable dance. `workflow_dispatch` runs
bypass the gate for manual/dry-run triggering.

## Why not reuse the Manus `/api/scheduled/*` auth

Those endpoints authenticate via `sdk.authenticateRequest()` → `verifySession()`
against the **Manus OAuth server**, accepting only a session whose `openId` is
prefixed `cron_` (issued exclusively by the Manus Heartbeat platform). A GitHub
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
