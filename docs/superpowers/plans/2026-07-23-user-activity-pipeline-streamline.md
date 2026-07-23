# Plan — streamline the User Activity analytics pipeline (bulletproof end-state)

**Date:** 2026-07-23 · **Branch:** `claude/repo-skills-setup-plzlq1`
**Goal:** one verified, authoritative User Activity pipeline —
`browser → web same-origin proxy → ai-sports-betting-backend → USER_ACTIVITY_DATABASE_URL → MySQL: Dime AI → admin read → UA tab` —
with value-bearing activity, honest data-states, near-real-time freshness, and no
secrets/private-hosts leaking. No second/parallel analytics system at any point.

## Bulletproof invariants (every phase must preserve)
1. **One authoritative store.** UA data lives ONLY in the dedicated `MySQL: Dime AI`;
   never written to TiDB; no silent fallback; no two writers.
2. **Backend owns the DB.** Only `ai-sports-betting-backend` connects to it (via
   `USER_ACTIVITY_DATABASE_URL`). The web service is proxy-only; the browser never
   touches `.railway.internal` or a DB.
3. **No leakage.** No private hostname / connection string / secret in browser code,
   `VITE_*`, API responses, logs, commits, screenshots, or bundles.
4. **Server-authoritative identity.** `source_user_id`, `is_test`, staff/entitlement
   derived server-side; client identity claims rejected. No cross-DB foreign keys.
5. **Value, not noise.** "Active" = a released, versioned, value-bearing foreground
   event — never login/heartbeat/page-load/staff/test/bot.
6. **Honest states.** Missing instrumentation ⇒ `not_measured`, never `0`/`00:00:00`;
   `DAU ≤ WAU ≤ MAU`; membership reconciled; freshness shown; `Live` only when the
   freshness target is observed.
7. **Idempotent + durable.** `event_id` dedupe; ACK only after durable commit;
   analytics failure never breaks the product.

## Critical-path bottleneck = ACCESS (Phase 0 gates everything)
The design is done; the build cannot start or be verified without:
- **Backend repo** `ai-sports-betting-backend` added to the working session (currently
  `list_repos` returns only this repo).
- **Railway read access** (CLI/token or a granted connector) for project
  `8dd7341d-…`, env `787f3113-…`.
- Confirmation (or access to confirm) that a `USER_ACTIVITY_DATABASE_URL` service-ref
  can be created on the backend → `MySQL: Dime AI`.

---

## Phase 0 — Unblock (OWNER action; ~minutes)
**Tasks:** add `ai-sports-betting-backend` to the session; grant Railway read access (or
provide the redacted facts: which service is `3528dc9f`, the backend's `$PORT`/start
command, and whether `USER_ACTIVITY_DATABASE_URL` exists/resolves to MySQL: Dime AI).
**Files:** none (infra/permissions).
**Verification:** I can `list_repos`/clone the backend and run read-only Railway/DB
diagnostics. **Gate:** do not proceed to Phase 2+ until the backend repo + DB target are
verified (hard-stop §18).

## Phase 1 — Verify topology (read-only; my action once unblocked)
**Tasks:** resolve service-ID `3528dc9f` → web vs backend; record project/env/service IDs
+ deployed SHAs; confirm `USER_ACTIVITY_DATABASE_URL` is a service-ref to MySQL: Dime AI
(metadata only, no secret print); confirm backend binds `$PORT`; `SELECT 1` + engine/
version from the backend; confirm it is NOT TiDB/SQLite/another env.
**Files:** `analytics-backend/README.md` (fill the verified topology + SHAs).
**Verification:** a written VERIFIED topology ledger; `SELECT 1` succeeds against the
dedicated MySQL. **Gate:** DB target VERIFIED before any migration.

## Phase 2 — Backend pipeline (in `ai-sports-betting-backend`)
**Tasks:** apply `analytics-backend/migrations/0001_*.sql` via the backend's migration
framework (adapt dialect/tooling); implement idempotent ingestion
(`POST /internal/analytics/events`, server-derived identity, allowlist, dedupe,
quarantine, ACK-after-commit); sessionization (foreground/idle/union/close/abandon);
smallest-correct aggregation (query-time first); admin read endpoints; the
`analytics_user_map` idempotent sync (minimal fields, no PII).
**Files:** backend repo (paths unknown until cloned) + `analytics-backend/*` as the spec.
**Verification:** migration applies + re-run no-op; unit/integration tests for ingestion,
dedupe, exclusions, boundaries, sessionization; `SELECT` shows exactly-once storage.
**Gate:** ingestion durably stores in the dedicated MySQL, verified by readback.

## Phase 3 — Web-service proxy + emitters (THIS repo)
**Tasks:** same-origin `/api/analytics/*` proxy → `USER_ACTIVITY_BACKEND_URL` (server-only;
auth/origin/CSRF/rate-limit; strips client identity; forwards derived `source_user_id`);
feature-flag OFF until configured (returns `not_measured`). Wire the §CONTRACT value-event
emitters on their released surfaces (fire-and-forget, bounded retry, non-blocking).
**Files (this repo):** `server/routers/analyticsProxy.ts` (new) + `server/routers.ts`
(register); `server/_core/env.ts` (add `USER_ACTIVITY_BACKEND_URL` name); client emitters
in the released surfaces (e.g. `client/src/pages/DimeModelFeed.tsx`,
`client/src/pages/dime-chat/DimeChatPage.tsx`, `client/src/pages/BetTracker.tsx`) via a
small `client/src/lib/analytics.ts` helper; `analytics-backend/CONTRACT.md` (finalize).
**Verification:** `tsc`; proxy unit tests (auth, origin, rate-limit, flag-off 503,
identity-strip); **bundle scan** shows no `.railway.internal`/secret; emitter tests.
**Gate:** browser calls only same-origin; no private host in the built bundle.

## Phase 4 — UA UI cutover to the dedicated store
**Tasks:** point the UA tab reads at the proxy→backend metric contract
(`{value,state,reason,as_of,freshness_seconds,definition_version,sample_size,…}`); render
all data-states; add freshness/`Last updated`/`Data through`/lag + `Live` gating; polling
pauses when hidden, refresh on return, backoff+jitter. Keep membership + Discord cross-cut.
**Files (this repo):** `client/src/pages/admin/MetricsPanel.tsx`,
`client/src/pages/UserActivity.tsx`, `server/routers/metrics.ts` (route UA reads via the
proxy, not TiDB), `server/db.ts` (retire the interim TiDB UA reads only at cutover).
**Verification:** UI state tests (loading/measured/true-zero/not-measured/partial/stale/
conflicting/error); freshness observed ≤ target; `DAU ≤ WAU ≤ MAU`.
**Gate:** UA tab reads ONLY from the dedicated MySQL (via backend).

## Phase 5 — Bulletproofing (verification matrix + canary + observability)
**Tasks:** the §16 automated matrix (ingestion/dedupe/forgery/exclusions/boundaries/
sessions/overlap/open-exclusion/`not_measured`→measured/monotonicity/rebuild/failure-
isolation/authz/UI-states/bundle-scan/log-redaction/fresh+populated migrate/rerun-no-op);
structured redacted logs + data-quality checks (§15); **excluded synthetic canary** (§17)
— one `is_test=true` event through the real public path → exactly one durable row →
readback < 60s → excluded from all real metrics.
**Files (this repo):** `server/analytics/*.test.ts`, `e2e/user-activity.spec.ts`;
(backend) its own tests. `analytics-backend/README.md` runbook results.
**Verification:** full matrix green; canary trace + exclusion proof recorded.
**Gate:** definition-of-done (§19) checklist all satisfied with direct evidence.

## Phase 6 — Cutover + decommission interim
**Tasks:** flip UA fully to the dedicated store; remove the interim TiDB session-metric
reads; confirm the live page reads only dedicated MySQL; observe a stabilization window.
**Files (this repo):** remove interim UA reads from `server/db.ts`/`server/routers/metrics.ts`.
**Verification:** live page green from the dedicated store; no TiDB UA reads remain;
rollback SHA recorded. **Gate:** one authoritative path, verified in production.

---

## Prep I can do NOW (no access needed; some already done)
- ✅ Neutralized the TiDB-bound seam; ✅ authored `analytics-backend/` schema + contract +
  runbook. **Next safe prep (only if you want it before Phase 0):** scaffold the
  flag-OFF web proxy + `client/src/lib/analytics.ts` emitter helper (dormant, returns
  `not_measured` until configured) + their tests, and the UI state-handling for the
  metric contract — so Phases 3–4 are drop-in once the backend is verified.

## Risks / unknowns
- **Backend stack unknown** (language/ORM/migration tool/auth) until the repo is added —
  `0001_*.sql` may need dialect/tooling adaptation.
- **`$PORT`/protocol** must come from verified Railway config (never hardcoded/guessed).
- **`DATABASE_URL` = TiDB assumption** is owner-stated; confirm at Phase 1 before trusting.
- **Legacy `user_sessions`** in TiDB (source of MAU 19) — decide: migrate/backfill (only
  if deterministic + marked) or expose coverage-from-instrumentation-start. Default: no
  fabricated history.
- **web↔backend auth** over private DNS — shared-secret/signed header must be verified.
- **Freshness target** feasibility at scale — start query-time; materialize only on
  measured need.

## Out of scope (explicitly)
- Building/deploying inside `ai-sports-betting-backend` **without** the repo in scope.
- Any Railway variable change, production migration, deploy, restart, canary, rollback, or
  data mutation **without** explicit authorization + verified target.
- Migrating the product account system off TiDB (separate, unrequested effort).
- Auto-contacting anyone; populating Research/Founder queues with fabricated candidates.
- Printing/committing secrets or private connection strings.

## On `/sp-worktree`
Isolation is **not** the current bottleneck (access is), and git cannot check the mandated
branch into a second worktree. When we execute the THIS-repo phases (3–4), a worktree adds
little over the clean branch; the backend phases happen in the backend repo/worktree once
it's added. Recommend: skip a worktree for now; revisit at Phase 2/3 if parallel repos
warrant it.
