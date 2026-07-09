# CI perf harness

Guards the deployed app's **load time and page weight** with real-browser
measurements + enforced budgets, so a slow deploy can't merge unnoticed.

## What it measures

Headless Chromium (Playwright) loads each route in `perf/harness.ts` and records,
per route (lower is better):

| Metric | Meaning |
|---|---|
| `ttfbMs` | responseStart − requestStart (server + network) |
| `domContentLoaded` | DOMContentLoaded relative to nav start |
| `loadMs` | load event relative to nav start |
| `fcpMs` | first-contentful-paint |
| `lcpMs` | largest-contentful-paint |
| `transferBytes` | Σ transfer size of the navigation + all resources |

`GET /health` is probed for status + latency (informational — not budgeted, so a
DB circuit-breaker flap doesn't fail the perf gate).

## How it gates (`perf/regression.ts`, unit-tested)

Two independent gates per metric:

1. **Hard budget** — `budget[metric]` absolute ceiling in `perf/baseline.json`.
2. **Regression guard** — must not exceed the recorded baseline by more than
   `tolerancePct` (catches gradual creep that stays under budget).

An improvement never fails. A route with no baseline entry (first run of a new
route) is still budget-checked.

## Running it

```bash
PERF_TARGET_URL=https://your-app.up.railway.app npx tsx perf/harness.ts
# reseed the committed baseline from a known-good run:
PERF_TARGET_URL=... npx tsx perf/harness.ts --update-baseline
```

CI: `.github/workflows/perf-harness.yml` (daily + manual). Needs the
`RAILWAY_APP_URL` repo secret. The manual run exposes `update_baseline` to reseed.

## Seeding the baseline (one-time)

`baseline.json` ships with generous budgets and an empty `baseline: {}` (so the
first run only enforces budgets). Once the app is stably deployed, run the
workflow with `update_baseline: true` (or `--update-baseline` locally) and commit
the result to turn on the regression guard.
