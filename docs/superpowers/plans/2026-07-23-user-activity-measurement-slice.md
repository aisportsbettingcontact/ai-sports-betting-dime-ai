# Plan — User Activity measurement slice (verified monolith)

**Date:** 2026-07-23 · **Branch:** `claude/repo-skills-setup-plzlq1`
**Scope decision (owner):** focused, production-grade vertical slice against the *verified monolith*;
≤4 bounded agents; token-lean; NO Railway/live-MySQL/deploy claims.

## Verified topology (repo evidence)
Monolith: `Dockerfile` + `railway.json`, Express serves API + built Vite client, MySQL via Drizzle
(`server/db.ts`). This repo's server **already is** the analytics writer. The spec's separate
`ai-sports-betting-backend` service is NOT in this repo → building a parallel writer here is
rejected (one authoritative path). Railway/live-DB unverifiable this session (no CLI, no creds).

## Exact root cause of the zero-activity state
`getSessionMetrics` (server/db.ts:2745) counts distinct `user_sessions.userId` by `startedAt`
window. Sessions are created only via `metrics.openSession` → `createUserSession`, and
**`openSession` has zero call sites** (grep: client + server). Legacy pages (ModelProjections,
BettingSplits) call heartbeat/close but never open; the current Dime shell (`DimeAppShell`) makes
**no metrics calls at all**. ⇒ `user_sessions` gets ~no rows ⇒ DAU/WAU/MAU=0, avg=`00:00:00`.
This is **missing instrumentation → `Not measured`**, not a measured zero.
Membership: paying(77) ⊇ lifetime(76); discord(77) cross-cuts — overlapping populations shown as
separate totals.

## Deliverables (one PR)
1. **Fix instrumentation** — `useSessionTracking` hook wired into `DimeAppShell` (authenticated,
   non-staff): open on mount, heartbeat on a foreground interval (paused on `document.hidden`/idle),
   close on logout + `pagehide`, single-primary-tab guard (no multi-tab duration inflation).
2. **Honest data-states** — extract pure helpers in `server/analytics/metricDefinitions.ts`
   (versioned defs, `MetricState`, derivation). `getSessionMetrics`/`getDurationHistogram` return
   `{state,value,reason}` per metric; `not_measured` when no engaged sessions exist, never
   `00:00:00`/false `0`. Exclude staff (role owner/admin) from active-user counts. Active user v1 =
   distinct eligible user with a heartbeat-bearing (foreground) session in window — engagement, not
   login alone.
3. **Membership reconciliation** — `getMemberMetrics` → single total + non-overlapping buckets
   (lifetime / recurring-paid / no-access) + cross-cutting discord; UI shows a breakdown, not
   separate totals.
4. **Event-ingestion seam (foundation/extension point)** — additive `analytics_events` table
   (Drizzle, drizzle-kit generate), idempotent `analytics.track` ingestion (server-verified
   identity, event allowlist, `schema_version`, `event_id` dedupe), event dictionary. Emitters =
   next phase. Migration reviewed/generated; NOT applied to any live/disposable DB (flagged).
5. **Docs** — root-cause trace, product-truth freeze, event dictionary + metric definitions,
   evidence-contract TYPES for future Research/Founder queues (NO candidates, no intent inference).
6. **Tests** — pure helpers (data-state, membership math, bucketing), ingestion validation +
   idempotency, session-hook logic, UI render-states. `tsc` clean.

## Agent division (≤4)
- **R (read-only):** root-cause trace + product-truth freeze docs.
- **E:** event-ingestion seam — owns `drizzle/schema.ts`, migration, `server/routers/analytics.ts`,
  `server/analytics/eventStore.ts`, dictionary, ingestion tests, routers.ts registration. Must NOT
  touch db.ts / metrics.ts / UI / hook.
- **Me (inline):** the coupled core (hook + shell + db metric functions + metricDefinitions +
  metrics router contract + UI + tests).
- **V (verify supervisor):** tsc + targeted vitest + adversarial review vs constraints
  (honest states, no overlapping totals, no fabricated queue candidates, no overclaiming,
  additive-only, no live-DB/deploy claims).

## Non-goals (named next phase)
Qualifying-activity DAU off `analytics_events` (needs event volume); Research/Founder queue
population; full 9-section dashboard; Railway migration + deploy + live readback (access-blocked).
