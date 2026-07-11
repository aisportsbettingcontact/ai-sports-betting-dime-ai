# P0 — Railway Feed Recovery — Execution Ledger

**Branch:** `p0/railway-feed-recovery` · **Base:** `origin/main` @ `9a41fa1`
**Archived prior run:** `archive/incomplete-p0-railway-run-20260711T064711Z` (+ `claude/dime-ai-full-audit-pewmxt`) — reference only, conclusions treated as unverified hypotheses.

## Exclusive P0 outcomes
1. Live **MLB Model Projections** on the Dime AI feed.
2. Live **World Cup Model Projections** on the Dime AI feed.
3. Live **MLB Betting Splits** on the Dime AI Betting Splits page.

Definition of done: real Railway-backed data visible through the deployed frontend **and** two independently-verified Railway update cycles.

## Access model
- `RAILWAY_API_TOKEN` is a GitHub Actions repository secret — available only inside a workflow run, never in the dev container. It is used exclusively by `.github/workflows/railway-p0-control.yml`.
- Values (token, Railway variable values) are never printed. Inspection returns names/scope/presence only.
- Read-only is the default operation. `run-job` / `deploy-service` are mutating and require explicit operation + service inputs; the owner authorizes each production mutation.

## Priority order (P0.1 → P0.9)
1. Railway access & topology (gate — nothing outranks it)
2. Source acquisition (MLB odds, WC odds, MLB splits)
3. Event/market/side identity & normalization
4. Model execution (MLB 400k sims, WC distribution, persistence)
5. Edge production (implied vs fair, best-book, correct side)
6. Production APIs (MLB projections, WC projections, MLB splits)
7. Frontend integration (real data + loading/empty/error/partial/stale)
8. Scheduling & reliability (cadence, retries, overlap prevention, last-success)
9. Railway deployment + two-cycle end-to-end verification

## Verified production facts (evidence-backed, this run)
- **Live app UP**: `deploy-smoke` run 29143628836 @ 2026-07-11T06:55Z → SUCCESS (all 5 checks: `/health` 200, HTML shell, cached assets, `/api/trpc` mounted, `/api/dime/chat` 401 gate). Origin: `https://ai-sports-betting-dime-ai-production.up.railway.app`.
- **Pipeline architecture**: GitHub Actions cron workflows POST to Railway `/api/cron/*` (CRON_SECRET) and `/api/scheduled/wc2026-*`. Endpoints run under single-flight run-locks (`server/cron/cronRunner.ts`).
  - `/api/cron/vsin-odds` → `runVsinRefresh()` — NBA/NHL/MLB VSiN + AN odds **and splits**.
  - `/api/cron/mlb-cycle` → `runMlbCycleOnce()` — lineups/K-props/backtest **+ MLB projection model** (`runMlbModelForDate(today)` → MLBAIModel.py, idempotent+validated; vsinAutoRefresh.ts:1862).
  - `/api/cron/scores` → `refreshAllScoresNow()`.
- **Crons firing GREEN**: cron-mlb-cycle (9 runs, latest 06:04Z success), cron-vsin-odds (16 runs, latest 06:25Z success). Both only began ~2026-07-10 (fresh Manus→Railway cutover).
- **CADENCE DEFECT**: GitHub throttles the `*/5` schedule to ~1–3h gaps (mlb-cycle: 06:04, 03:47, 00:14 …). Feed refreshes far slower than the intended 5 min. Reliability risk for freshness.
- **STALE SECRET**: `db-query.yml` (read-only DB counts) FAILS — `TARGET_DATABASE_URL` → `ERROR 1045 Access denied` (worked Jul 9; migration-target creds now dead). Live prod DB secret is `DATABASE_URL` (used by db-push.yml).
- **GATE (proven)**: new `workflow_dispatch` workflows must be on `main` — dispatch on `p0/railway-feed-recovery` returned 404. So `p0-feed-verify.yml` + `railway-p0-control.yml` must be merged to `main` to run.

## Gate status
- [~] P0.1 Railway access — app verified UP; Railway *topology/variables* need `railway-p0-control.yml` on main (RAILWAY_API_TOKEN). DB-count needs `DATABASE_URL` (TARGET creds stale).
- [~] P0.2 Sources — vsin-odds + mlb-cycle crons GREEN at trigger level; data-landing unverified (needs feed-verify on main).
- [ ] P0.3 Identity — code-mapped; live unverified
- [~] P0.4 Models — MLB model wired into mlb-cycle (GREEN trigger); output-in-DB unverified
- [ ] P0.5 Edges — code-mapped; live unverified
- [~] P0.6 APIs — `/api/trpc` mounted (smoke GREEN); data content unverified
- [~] P0.7 Frontend — app serves HTML shell (smoke GREEN); real-data render unverified
- [!] P0.8 Scheduling — crons fire but GitHub throttles */5 to hours; freshness at risk
- [ ] P0.9 Deploy + 2-cycle verify — pending feed-verify on main

## Immediate unblock (owner action required)
1. Merge read-only `p0-feed-verify.yml` (+ optionally `railway-p0-control.yml`) to `main` so live feed-data + Railway topology can be verified. Both are read-only / secret-safe.
2. Refresh `TARGET_DATABASE_URL` (or repoint db-query at `DATABASE_URL`) for DB-count checks.
3. Decide fix for cron cadence (GitHub throttles */5): e.g. Railway-native cron, or an external scheduler hitting `/api/cron/*`.
