# Product-Truth Freeze — Dime AI User Activity (2026-07-23)

Versioned snapshot from **repo facts only**. No live-DB or Railway claims.

- **Commit (git rev-parse HEAD):** `e61e140953a167fedc91e08075606241e9ece540`
- **Branch:** `claude/repo-skills-setup-plzlq1`
- **Working tree:** clean except untracked `docs/superpowers/plans/2026-07-23-user-activity-measurement-slice.md`

Status legend: **Released** = wired & routed in this commit · **Degraded** =
released but not producing correct data · **Planned** = defined/scaffolded, not wired ·
**Unknown** = not verifiable from repo this session.

## Released routes & panes

Admin routes (`client/src/App.tsx`), all `RequireAuth`; owner pages add `RequireOwner`:

| Route | Component | Guard | Status |
|---|---|---|---|
| `/admin/activity` (`App.tsx:349`) | `UserActivity` → `MetricsPanel` | RequireAuth+RequireOwner | **Released** (UI); **Degraded** (session data) |
| `/admin/users` (`:331`) | `UserManagement` | RequireAuth+RequireOwner | **Released** |
| `/admin/publish` (`:340`) | `PublishProjections` | RequireAuth+RequireOwner | **Released** |
| `/admin/ingest-an`, `/admin/model-results`, `/admin/security`, `/admin/model-status`, `/admin/postponed-games`, `/admin/backtest`, `/admin/waitlist`, `/admin/claude` (`:358-462`) | various | RequireAuth (owner enforced server-side / in-page) | **Released** |

Product panes owned by the shell (`client/src/pages/dime-shell/productRoute.ts:1-8`),
rendered by `DimeAppShell.tsx`: `chat`, `feed`, `splits`, `trends`, `tracker`.
Canonical product routes: `/chat`, `/feed/model/:sport(/:date)`,
`/betting-splits/:sport(/:date)`, `/trends`, `/bet-tracker`
(`App.tsx:279-440`, `productRoute.ts:28-49`). Chat owns a stable mount at every
viewport; other panes are shell-owned ≥768px (`App.tsx:202-223`). — **Released**

## Entitlement / access model (as-built)

`app_users` (`drizzle/schema.ts:45-138`):
- `role` enum owner|admin|handicapper|user, default user (`:50`) — **Released**
- `hasAccess` bool default true (`:51`); `expiryDate` bigint ms, **NULL = lifetime** (`:52-53`) — **Released**
- Discord link: `discordId` + `discordUsername/Avatar/ConnectedAt`, `manualDiscordId` (`:67-75`) — **Released**
- Stripe: `stripeCustomerId/SubscriptionId/PlanId`, `cancelAtPeriodEnd`, `pendingSetup/pendingEmail` (`:89-127`) — **Released**

Entitlement definitions (`server/db.ts:2802-2851`, comment `:2804-2807`):
- TOTAL_PAYING = `hasAccess AND (expiryDate IS NULL OR expiryDate > now)`
- LIFETIME = `hasAccess AND expiryDate IS NULL` (⊆ paying)
- NON_PAYING = `totalUsers − paying` (residual; absorbs staff/expired)
- DISCORD_CONNECTED = `discordId IS NOT NULL` (cross-cuts tiers)

Owner-only enforcement: metrics procedures use `ownerProcedure`
(`server/routers/metrics.ts:24,33,42`); route-level `RequireOwner` is cosmetic
(`UserActivity.tsx:8-17`). — **Released**

## Metrics / session model (as-built)

Schema `user_sessions` (`drizzle/schema.ts:1797-1814`): `userId, startedAt,
endedAt, durationMs, lastHeartbeat`; indexes on userId/startedAt/endedAt. — **Released** (table)

RPCs (`server/routers/metrics.ts`):
- `getSessionMetrics` / `getMemberMetrics` / `getDurationHistogram` — owner queries (`:24-48`) — **Released** (read path correct)
- `openSession`→`createUserSession` (`:61`, `db.ts:2620`) — **Planned** (defined, ZERO callers)
- `sessionHeartbeat`→`heartbeatUserSession` (`:51`, `db.ts:2648`) — **Degraded** (only legacy/unrouted `ModelProjections.tsx:556`; no-op without open rows)
- `closeSession`→`closeUserSessions` (`:71`, `db.ts:2671`) — **Degraded** (called in `BettingSplits.tsx:435` + unrouted `ModelProjections.tsx`; no-op without open rows)
- `closeIdleSessions` (`db.ts:2709`) — **Planned** (comment says "scheduled job every 30 min"; no scheduler wiring found this session)

Duration integrity guards that ARE built (apply once data exists): `durationMs`
computed from `lastHeartbeat` not wall-clock (`db.ts:2687-2688`); avg + histogram
cap outliers at 4h and require `durationMs>0` (`db.ts:2777-2786`, `2883-2900`).

## Known limitations

- **Current product surfaces are uninstrumented.** The live shell
  `DimeAppShell.tsx` (chat/feed/splits/trends/tracker) issues no `openSession`/
  heartbeat/close calls. Session KPIs are **Degraded**: structurally 0 until a
  writer is wired. (See root-cause doc, same date.)
- **No qualifying-activity event exists yet.** "Active user" = a `user_sessions`
  row, and nothing creates one on the shell. There is no page-view / feature-use
  event stream; DAU semantics ("unique logins") are aspirational
  (`MetricsPanel.tsx:47`). — **Planned**
- **Staff not excluded.** No `role`-based filter in session or member queries
  (`db.ts:2760,2821-2838`); owner/admin will count as active users once
  instrumented, and already count in member totals. — **Released (as-is), flagged**
- **Non-paying is a residual**, not an explicit segment; conflates staff/test/
  expired accounts (`db.ts:2843`). Member KPIs are non-exclusive; do not sum.
- **`ModelProjections.tsx` is dead code** — not imported/routed in `App.tsx`;
  its heartbeat/close wiring is inert. — **Degraded/dead**
- **Idle-session cleanup has no scheduler** wired in-repo this session. — **Unknown/Planned**
- **Railway / live production DB unverifiable this session** — actual row counts,
  deployed commit, and job schedules cannot be confirmed from the repo. — **Unknown**

## Do-not-overclaim boundary

Released today: the admin UI, owner gating, member/entitlement counts (from
`app_users`), and the session **read** path + schema. NOT released: any real
DAU/WAU/MAU/session-duration signal — that requires an `openSession` writer on a
live surface, which does not exist at this commit.
