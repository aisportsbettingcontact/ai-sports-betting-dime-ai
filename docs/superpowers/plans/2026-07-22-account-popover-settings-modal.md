# Account Popover v2 + Settings Modal + Owner Admin Implementation Plan (6 steps)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (per-task implementer + reviewer + controller verification). Branch `claude/load-skills-repo-urklt7` from `origin/main` @ 68371cf. UI steps MUST read `.claude/skills/apple-design/SKILL.md` and `design-system/dime-ai/MASTER.md` before writing markup — Apple-grade interaction/motion/typography discipline, **skinned strictly by Dime brand law (brand law wins every conflict)**. Copy passes stop-slop (plain, no filler).

**Goal:** Rebuild the sidebar account popover (@user header · Theme with a left-to-right slide-out System|Light|Dark selector · Settings · Admin Dashboard (@prez only) · Log Out); give Settings a centered modal (Username · Connected Discord · Reset Password · full Billing · Log Out); lock **User Management** and **Publish Projections** to the owner at BOTH route and server level; and bring all these surfaces to world-class Apple-design quality within the Dime brand kit.

**Owner spec (verbatim):**
- Popover rows: `@user`, `Theme` ("slides a new left to right row of a dropdown of System Light Dark"), `Settings`, `Admin Dashboard (@prez only)`, `Log Out`.
- Settings modal: Username · Connected Discord · Reset Password · Billing (Current or Expired Plan + date · Billing History · Billing Information · Payment Methods · Cancel/Upgrade/Renew Plan) · Log Out.
- Cancel confirm copy, verbatim: **"If you cancel, you'll keep full access to your plan features until the end of your billing period."** with a **red** cancel button.
- Admin Dashboard is for @prez only: **User Management** + **Publish Projections**. "No other users or site members should be able to view these pages."
- "Design all of these pages with world class apple design UI within the Dime AI Brand kit."

## Global Constraints

- Dime brand law skins everything: mint `#45E0A8` sole accent, Familjen Grotesk + IBM Plex Mono, **160ms `cubic-bezier(0.16,1,0.3,1)`** motion (Theme slide + modal enter use exactly this; `prefers-reduced-motion` collapses all of it), no gradients. Red danger token for the cancel confirm is an owner-directed destructive-only exception, documented in MASTER.md.
- Apple-design skill governs *how it feels* (interruptible motion, spatial consistency, restraint, optical typography); brand law governs *what it looks like*. Precedence per CLAUDE.md rule 1.
- The existing account menu is frozen design law (D/L:80 region) — owner-directed amendment; keep D/L comments, annotate `— owner directive 2026-07-22: account popover v2`.
- **Admin lockdown is server-verified, not cosmetic:** route-level owner guard (redirect non-owners away before render) AND every admin tRPC procedure rejects non-owner callers. Hiding the popover row is NOT the security boundary.
- Live Stripe data only — no fabricated billing values; graceful empty states. No schema changes (`db-push.yml` not needed).
- Surfaces: wherever today's account menu opens (persistent sidebar, rail, drawer); Settings modal is app-centered. Mobile `<768` Profile screen untouched.
- TS strict; existing suites stay green; frozen assertions updated with intent preserved, never deleted.

## Defaults taken

1. Profile row/gear click → popover; Settings row → modal. 2. Admin Dashboard row → `/admin/users`; both admin pages share a two-tab header (**User Management | Publish Projections**) — that shared shell IS the dashboard. 3. Theme System = `prefers-color-scheme`, persisted `localStorage['dime-theme']`, default `system`. 4. Billing sublists render natively (read-only tRPC); Stripe portal stays as escape hatch; Upgrade → existing checkout. 5. Reset Password links the existing `/reset-password` flow. 6. "Edit Profile" leaves the popover (spec omits it); its content lives in Settings → Account. 7. "@prez only" = the server-verified `owner` role exactly (not `admin`/`handicapper`).

---

## Step 1 — Popover v2 + Theme mode

**Files:** `client/src/pages/dime-chat/DimeChatPage.tsx` (dc-menu region ~570-690), `client/src/contexts/ThemeContext.tsx` (add `"system"`, persistence, `matchMedia` listener), `conversation.css`/`frozen-tokens.css` (rows + slide, D/L annotations).

Rows: `@{username}` header (avatar, tier badge, expiry line kept) · Theme → 160ms left-to-right slide-in segmented `System | Light | Dark` (selection applies instantly, persists; back affordance; reduced-motion = instant) · Settings (opens Step 2 modal, closes popover) · Admin Dashboard (rendered only when server-verified owner; → `/admin/users`) · Log Out (existing flow). Apple polish: interruptible slide, no layout jump, focus preserved.

**Verify:** tsc; source-contract test (5 rows owner / 4 non-owner, Edit Profile absent); theme persistence unit test on the context.

## Step 2 — Settings modal shell

**Files:** new `client/src/pages/dime-chat/SettingsModal.tsx` + styles; `DimeChatPage.tsx` mount.

Centered dialog: scrim click + Esc close, focus trap, return focus to profile row, `role="dialog" aria-modal`, scroll lock, 160ms scale/fade. Left nav: **Account** (Username = relocated edit-profile logic; Connected Discord = existing status/connect; Reset Password → existing flow), **Billing** (Step 4), bottom **Log Out**. Single-column stack at narrow widths.

**Verify:** tsc; source-contract test (dialog semantics, section list); manual focus/Esc/scrim pass.

## Step 3 — Billing data layer (server)

**Files:** `server/routers/stripe.ts` (+shared types).

New read-only authed procedures (own-data only): `getPlanStatus` (Current/Expired + governing date from plan/expiry/cancelAtPeriodEnd), `getInvoices` (date, amount, status, hosted URL), `getPaymentMethods` (brand, last4, exp), `getBillingInfo` (name, email, address). Reuse existing portal-session (~:544), cancel (~:751), renew (~:767-802), checkout. Graceful no-customer empty states.

**Verify:** tsc; vitest matrix for plan-status derivation (active / cancel-scheduled / expired / no-sub).

## Step 4 — Billing UI in the modal

**Files:** `SettingsModal.tsx` billing components.

Plan card ("Current Plan — {tier} · Renews {date}" / "Access until {date}" / "Expired {date}") · history table with receipt links · payment-method cards · billing info · Upgrade / Renew / **Cancel** → inline confirm with the verbatim copy and the red confirm + neutral "Keep plan"; success invalidates and re-derives. Loading/error/empty states throughout.

**Verify:** tsc; source-contract test pinning the cancel copy verbatim + red token; stubbed-state manual pass.

## Step 5 — Owner admin lockdown + Apple-grade redesign

**Files:** `client/src/App.tsx` (admin routes), new `client/src/components/RequireOwner.tsx` (or equivalent guard), new shared `client/src/pages/admin/AdminShell.tsx` (two-tab header), `client/src/pages/UserManagement.tsx` + `client/src/pages/PublishProjections.tsx` (reskin within the shell; keep ALL existing functionality/procedures), `server/routers/*` (audit + harden every procedure these pages call to owner-only).

- Route guard: `/admin/users` + `/admin/publish` wrapped in RequireOwner (loading-safe: no flash of admin content; non-owner → redirect `/chat`). PublishProjections' internal guard stays as defense-in-depth; add the same to UserManagement if missing.
- **Server audit:** enumerate every tRPC procedure invoked by both pages; each must reject non-owner (owner-procedure middleware). Any gap is a Critical fix in this step. "No other users or site members should be able to view these pages" = data endpoints too.
- Redesign: shared AdminShell (Dime wordmark context, two-tab nav, back-to-app), both pages restyled to brand law + Apple discipline (typographic hierarchy, spacing rhythm, restrained motion) **without changing behavior** — functional parity is a review gate.

**Verify:** tsc; source-contract tests (guard wiring, both pages inside shell); server tests where cheap (owner-procedure rejection); functional parity checklist in review.

## Step 6 — Harness, gates, finish

**Files:** new `e2e/account-settings.spec.ts`; evidence `docs/evidence/2026-07-22-account-settings/`.

Stubbed-tRPC e2e at 1024/1440: popover row set (owner 5 / non-owner 4); Theme slide + selecting Light flips `theme-light` and persists across reload; Settings modal dialog semantics; billing fixtures render; cancel confirm shows verbatim copy + red button; **admin lockdown: non-owner fixture navigating to `/admin/users` and `/admin/publish` never renders admin content (redirect asserted); owner fixture sees both tabs**. Then full gates (tsc, gated vitest, full Playwright, bundle, brand visual pass with evidence) and superpowers:finishing-a-development-branch (PR; merge = owner's deploy decision).

## Risks / Unknowns

1. Server-side gating gaps found by the Step 5 audit could be larger than expected (e.g. user-list or publish procedures callable by any authed user today) — treat every gap as Critical, fix in-step.
2. Light theme coverage: System/Light modes expose surfaces only fully specified for frozen reference pages — visual pass required; unstyled panes get reported, not silently patched.
3. Stripe list procedures depend on the account's API version/data; e2e uses stubs, dev shows honest empty states.
4. PublishProjections is a 2,400+ line page — reskin without behavior change is the riskiest diff; functional-parity review gate + owner smoke after deploy.
5. Frozen-menu test assertions pinning "Edit Profile"/"Discord Connected" rows will need intent-preserving updates.

## Out of Scope

Mobile `<768` Profile screen; Prop Projections row; new admin features beyond the two existing pages; password-change reimplementation; Stripe product changes; schema changes; other `/admin/*` routes (ingest-an, model-results, f5-edge keep current behavior — flagged for a future round).
