# User Activity — Root-Cause Trace (2026-07-23)

**Surface:** `/admin/activity` → `UserActivity.tsx` → `MetricsPanel.tsx` (owner-gated).
**Symptom:** DAU/WAU/MAU = 0, avg session 00:00:00, 0 sessions; but 77 paying /
76 lifetime / 1 non-paying / 77 discord.
**Commit:** `e61e140953a167fedc91e08075606241e9ece540`

## The one defect behind every zero session value

`metrics.openSession` → `createUserSession` (`server/db.ts:2620`) inserts the ONLY
`user_sessions` rows. It has **zero callers anywhere**. Grep for `openSession`
across `client/src` + `server` returns only its definition (`server/routers/metrics.ts:61`);
no client mutation ever invokes `trpc.metrics.openSession`. The live shell
`client/src/pages/dime-shell/DimeAppShell.tsx` (renders chat + feed/splits/trends/tracker
panes) makes **no** metrics calls. Only two legacy pages touch session RPCs, and
neither opens a session:

- `client/src/pages/ModelProjections.tsx:534-535,551,556` — calls `closeSession` +
  `sessionHeartbeat`, but **ModelProjections is not imported/routed in `client/src/App.tsx`**
  (the routed feed is `DimeModelFeed`). Dead code; its calls never fire in prod.
- `client/src/pages/BettingSplits.tsx:420,435` — calls `closeSession` on logout only.
  No `openSession`, no heartbeat.

Because no row is ever inserted, `heartbeatUserSession` (`db.ts:2648`, updates only
`endedAt IS NULL` rows) and `closeUserSessions` (`db.ts:2671`, closes only open rows)
are permanent no-ops. `user_sessions` stays empty → every session-derived value is 0.

## Per-value classification

### Row 1 — Session KPIs (all from `getSessionMetrics`, `db.ts:2745`)

| Value | Component | Query | Root cause | Class |
|---|---|---|---|---|
| DAU = 0 | `MetricsPanel.tsx:48` `sessionData.dau` | `COUNT(DISTINCT userId)` WHERE `startedAt ≥ now-24h` (`db.ts:2759`) | Table empty — no `openSession` caller | **Missing-instrumentation** |
| WAU = 0 | `MetricsPanel.tsx:55` | same, `startedAt ≥ now-7d` (`db.ts:2764`) | same | **Missing-instrumentation** |
| MAU = 0 | `MetricsPanel.tsx:62` | same, `startedAt ≥ now-30d` (`db.ts:2769`) | same | **Missing-instrumentation** |
| Avg session 00:00:00 | `MetricsPanel.tsx:69` `fmtDuration(avgSessionDurationMs)` | `AVG(durationMs)` WHERE `durationMs` in (0, 4h], `startedAt ≥ now-30d` (`db.ts:2778`) | No rows → `AVG` = NULL → coalesced to 0 (`db.ts:2791`); `fmtDuration(0)` → `"00:00:00"` (`MetricsPanel.tsx:23`) | **Missing-instrumentation** |

The queries, time windows (`Date.now()` ms vs `startedAt` bigint ms — no TZ math),
and calc are all **correct**. There is no query/eligibility/timezone defect on Row 1;
the zeros are purely the absent-writer problem.

### Row 3 — Duration histogram (from `getDurationHistogram`, `db.ts:2867`)

| Value | Root cause | Class |
|---|---|---|
| 0 sessions / all buckets 0 | `MetricsPanel.tsx:143,165,192` read `histData.total/under5m/…`; query counts closed rows (`durationMs>0`, ≤4h, last 30d) — table empty | **Missing-instrumentation** |

Same single cause. Query logic correct.

### Row 2 — Member KPIs (from `getMemberMetrics`, `db.ts:2811`) — these are VALID

These read `app_users`, not `user_sessions`, so they populate correctly. The observed
numbers are **valid non-zeros / valid-zero**, not defects:

| Value | Query (`db.ts`) | Observed | Class |
|---|---|---|---|
| Total paying = 77 | `hasAccess=true AND (expiryDate IS NULL OR expiryDate > now)` (`:2824`) | 77 | **Valid** |
| Lifetime = 76 | `hasAccess=true AND expiryDate IS NULL` (`:2831`) | 76 | **Valid** |
| Non-paying = 1 | `totalUsers − totalPaying` (`:2843`) | 1 → totalUsers = 78 | **Valid-zero-ish** |
| Discord = 77 | `discordId IS NOT NULL` (`:2835`) | 77 | **Valid** |

## Membership overlap (as-built, not a bug — flag for interpretation)

- **paying ⊇ lifetime.** Lifetime (76) is the `expiryDate IS NULL` subset of paying (77);
  the 1 remaining paying member has a future `expiryDate` (time-boxed paid access).
- **non-paying is a residual, not a category.** `nonPaying = totalUsers − totalPaying`
  (`db.ts:2843`), so it silently absorbs owner/admin/handicapper/test accounts with
  `hasAccess=false` OR an expired `expiryDate`. Here totalUsers = 78, paying = 77 → 1.
- **discord cross-cuts.** `discordConnected` (77) counts any linked account regardless
  of access tier; it overlaps paying/non-paying and is not additive with them.
- **KPIs are not mutually exclusive** — do not sum Row 2 to a headcount.

## Staff inclusion (as-built)

Neither session nor member queries exclude staff. `getSessionMetrics` counts every
`userId` in `user_sessions` (`db.ts:2760`) and `getMemberMetrics` counts every
`app_users` row (`db.ts:2821-2838`) with **no `role NOT IN ('owner','admin')` filter**.
So once sessions are instrumented, owner/admin logins will inflate DAU/WAU/MAU, and
staff already count toward member totals today. `app_users.role` enum
(`drizzle/schema.ts:50`: owner|admin|handicapper|user) is available for exclusion but unused.

## Summary of root cause per value

- **DAU/WAU/MAU = 0** → missing-instrumentation: `createUserSession` has zero callers; `user_sessions` never receives a row.
- **Avg session 00:00:00** → same empty table → `AVG` NULL → 0 → formatted 00:00:00.
- **0 sessions (histogram)** → same empty table.
- **77 paying / 76 lifetime / 1 non-paying / 77 discord** → VALID (sourced from `app_users`, not sessions); non-paying is a residual and discord cross-cuts; staff not excluded.
