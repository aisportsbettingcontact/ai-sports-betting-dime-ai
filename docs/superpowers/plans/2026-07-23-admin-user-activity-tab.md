# Plan — Admin "User Activity" tab (move Platform Metrics off User Management)

**Date:** 2026-07-23
**Branch:** `claude/repo-skills-setup-plzlq1`
**Owner directive:** Create a "User Activity" tab in the Admin Dashboard, route it to
`/admin/activity`, and move the "Platform Metrics" block off the User Management
(`/admin/users`) page into that new tab. Design to Dime brand law + world-class Apple
design, consistent with the existing admin surfaces.

## Current state (verified)

- **`client/src/pages/admin/AdminShell.tsx`** — shared admin chrome. `AdminTab = "users" | "publish"`.
  A `TABS` array renders a 2-tab nav (User Management → `/admin/users`, Publish Projections →
  `/admin/publish`). Mobile short-label is a hardcoded ternary: `tab.key === "users" ? "Users" : "Publish"`.
- **`client/src/pages/UserManagement.tsx`** (1621 lines) — hosts `MetricsPanel()` (lines ~285–470)
  and the `fmtDuration()` helper (~287). `MetricsPanel` renders the "Platform Metrics" block:
  Row 1 session KPIs (DAU/WAU/MAU/avg duration), Row 2 member KPIs (paying/lifetime/non-paying/
  discord), Row 3 session-duration histogram. It is rendered once at line ~913, between the
  5 account stat-cards and the search bar. Data via `trpc.metrics.getSessionMetrics /
  getMemberMetrics / getDurationHistogram` (all `refetchInterval: 60_000`).
- **`server/routers/metrics.ts`** — all three read procedures are `ownerProcedure` (owner-only).
- **`client/src/App.tsx`** — `/admin/users` and `/admin/publish` are each wrapped
  `RequireAuth > RequireOwner > <Page/>`.
- **Import usage in UserManagement:** `BarChart2` (role icon, line 65) and `RefreshCw`
  (12 uses) are used OUTSIDE MetricsPanel → keep both imports. `fmtDuration` is used ONLY by
  MetricsPanel → moves with it.
- **Pinned tests that will break / need updating:**
  - `AdminShell.test.ts` — asserts an EXACT 2-entry `TABS` array via regex; asserts mobile
    short-labels indirectly; also asserts UserManagement/PublishProjections wrap in AdminShell.
  - `App.adminRoutes.test.ts` — pins `/admin/users` + `/admin/publish` composition; asserts
    no OTHER listed `/admin/*` route uses RequireOwner (activity is NOT in that list, so it
    won't false-fail, but we add a positive assertion for `/admin/activity`).

## Target state

Three-tab admin nav: **User Management | User Activity | Publish Projections**.
New owner-only route `/admin/activity` renders a `UserActivity` page inside `<AdminShell
active="activity">`, containing the moved Platform Metrics block. User Management no longer
renders metrics.

## Changes (TDD: update pinned tests → implement → verify)

1. **`AdminShell.tsx`**
   - `AdminTab = "users" | "activity" | "publish"`.
   - Add `short` field to the `TABS` element type; entries:
     - `{ key: "users", label: "User Management", short: "Users", path: "/admin/users" }`
     - `{ key: "activity", label: "User Activity", short: "Activity", path: "/admin/activity" }`
     - `{ key: "publish", label: "Publish Projections", short: "Publish", path: "/admin/publish" }`
   - Replace the mobile ternary with `{tab.short}`.
2. **`client/src/pages/admin/MetricsPanel.tsx`** (NEW) — extract `MetricsPanel` + `fmtDuration`
   verbatim (functional parity; brand-token classes unchanged). Export `MetricsPanel`.
3. **`client/src/pages/UserActivity.tsx`** (NEW) — owner-gated page mirroring UserManagement's
   guard pattern (`useAppAuth`; loading/redirect guard BEFORE the shell so no chrome flash
   pre-auth; internal owner guard → `navigate("/feed/model/mlb")`). Renders `<AdminShell
   active="activity">` with a page header ("User Activity" + subtitle) and `<MetricsPanel />`.
4. **`UserManagement.tsx`** — delete `MetricsPanel` + `fmtDuration`, delete the `<MetricsPanel />`
   render site (line ~913), keep `BarChart2`/`RefreshCw` imports.
5. **`App.tsx`** — import `UserActivity`; add `/admin/activity` route wrapped
   `RequireAuth > RequireOwner > <UserActivity/>`.
6. **Tests** — update `AdminShell.test.ts` (3-tab array + short field + new UserActivity wrap
   assertion), add `/admin/activity` composition test to `App.adminRoutes.test.ts`, and add a
   test that UserManagement no longer contains the Platform Metrics markup (moved, not copied).

## Brand / design guardrails (non-negotiable)

- Semantic tokens only (`bg-background`, `text-foreground`, `bg-card`, `border-border`,
  `text-primary` mint) — NO hardcoded hex in AdminShell/new page (AdminShell.test pins this).
- Motion: the 160ms `cubic-bezier(0.16,1,0.3,1)` curve via AdminShell.css, never Tailwind
  `transition-colors`. `prefers-reduced-motion` collapse preserved.
- Familjen Grotesk / IBM Plex Mono via existing `--font-*` tokens. No gradients/purple/neon-green/gold.
- Page container/spacing matches sibling admin pages (`px-3 sm:px-5 lg:px-8 py-4`, header
  `text-2xl sm:text-3xl font-bold tracking-tight`).

## Verification gate

`npx tsc --noEmit` clean; `vitest run` for AdminShell.test, App.adminRoutes.test, and any
metrics/UserManagement source tests green; grep-confirm metrics markup absent from
UserManagement and present in the new page; supervisor review vs. original directive + brand law.
