# CI perf harness

Guards the deployed app's **load time and page weight** with real-browser
measurements + enforced budgets, so a slow deploy is caught.

## Trust status (2026-07-25)

Every retained scheduled run from 2026-07-10 to 2026-07-25 crashed before
collecting any metric (`ReferenceError: __name is not defined` — the tsx/esbuild
`keepNames` helper leaking into the Playwright-serialized `page.evaluate`
callback; INCIDENTS.md #40). That history is **invalid as performance
evidence**: it demonstrates no application regression, and budgets + the
regression baseline have never actually gated a deploy.

The fixed harness must complete an observation period of **3–5 successful,
comparable scheduled runs** (same runner class, same routes, same config)
before its budgets/regression guard are treated as a trusted deployment
control, and before a candidate baseline is generated from a known-good run.
The observation count remains zero until the buffered-LCP and browser-CI
follow-up is deployed. Budget values were not changed by either fix.

Code that runs inside the page lives in `perf/browserMetrics.ts` and must stay
standalone browser-safe JS (no name-inferred inner function expressions, no
module-scope references) — `perf/harness.smoke.test.ts` enforces this through
the same tsx transform CI uses. LCP is collected with a buffered
`PerformanceObserver`; an unsupported observer or missing LCP candidate is a
harness failure, never a valid `lcpMs: 0`. The required Vitest job installs
Chromium, so its real-browser smoke and failure-path tests cannot be skipped in
CI.

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
# generate a reviewable candidate without changing the committed baseline:
PERF_TARGET_URL=... npx tsx perf/harness.ts --update-baseline
```

CI: `.github/workflows/perf-harness.yml` (daily + manual). Needs the
`RAILWAY_APP_URL` repo secret. The manual run exposes `update_baseline` to
generate an artifact containing `perf-baseline-candidate.json` and the matching
raw `perf-results.json`.

## Seeding the baseline (one-time)

`baseline.json` ships with generous budgets and an empty `baseline: {}` (so the
first run only enforces budgets). After 3–5 valid observation runs:

1. Manually run the workflow with `update_baseline: true`.
2. Download the uniquely named baseline-candidate artifact.
3. Compare `perf-baseline-candidate.json` with its bundled raw results.
4. Promote the reviewed candidate by replacing `perf/baseline.json` in a normal
   pull request.

The workflow retains `contents: read`; it never commits directly to `main`.
