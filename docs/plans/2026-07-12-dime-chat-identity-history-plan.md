# Dime Chat: Real Identity, Non-Owner Gate, Persistent Chat History — Implementation Plan

**Date:** 2026-07-12 · **Status:** PROPOSED (no implementation yet) · **Base:** `main@2e6bbbf`

## What was reported, and what investigation found

| # | Report | Investigated root cause / state |
|---|---|---|
| 1 | Logged in as a non-owner user, sidebar shows "PREZ BETS" | **Confirmed bug.** `client/src/pages/dime-chat/DimeChatPage.tsx:311-380` renders a hardcoded "FROZEN SAMPLE IDENTITY": name `PREZ BETS`, handle `@prez`, tier `Pro`, expiry `August 8, 2026`, `Discord Connected: @prez`, and the prez photo — for **every** user, on every viewport. It was left as design-frozen sample content ("product-wiring decision pending"). |
| 2 | "Login button isn't working" | **Partially confirmed, needs a debug pass.** The `/login` form wiring is intact (`trpc.appUsers.login` → redirect). But the chat sidebar's settings menu buttons — **Log Out, Edit Profile, Upgrade, Cancel** — have **no click handlers at all** (dead buttons). Leading hypothesis: the browser still held the prez `app_session` cookie (90-day persistent login); with Log Out dead there was no way to switch accounts, and with #1 the sidebar would show PREZ BETS even after a successful login as someone else. Phase 0 reproduces and pins this down before any fix. |
| 3 | Non-owners should see **no** composer/pills — just the Dime logo + "AI MODEL CHAT COMING SOON" | **Not currently implemented.** PR #76 (your revert) removed the earlier notice-based gate; current `main` shows the full chat UI to every authenticated user. The Anthropic provider freeze (PR #79) is live, so no one gets model responses — but non-owners still see a working-looking composer. |
| 4 | Are chat histories saved? | **No.** Nothing in `drizzle/schema.ts` stores chats. `recentChats.ts` is explicitly session-only, in-memory. Refreshing the page loses everything. |
| 5 | Settings "⋯" with Star / Archive / Delete per chat | Does not exist; depends on #4. |

**Assumptions baked into this plan** (called out so they can be vetoed):
- **A1 — server gate returns.** "Non-owners shouldn't even see the prompt UI" is taken to reaffirm the original "the LLM never responds to non-owners" rule, so the server-side owner-only entitlement on `POST /api/dime/chat` comes back alongside the UI gate (it was removed by revert #76). The provider freeze makes this moot today, but it must hold when the model is unfrozen.
- **A2 — initials avatar.** There is no avatar-upload system. Non-prez users get an initials avatar (brand-styled); the prez photo remains only for the prez account.
- **A3 — frozen-notice turns are stored.** While the provider is frozen, a user's "hi" + the offline notice still form a real conversation and get persisted like any other.
- **A4 — Delete is a hard delete.** When a user deletes a chat, the thread and its messages are removed from the database, not flagged.

---

## Phase 0 — Branch reset + login-button debug (`/sp-debug`)

| Task | Files | Notes |
|---|---|---|
| 0.1 Restart work branch from merged `main` | — | `claude/dime-chat-owner-only-access-ywnfr3` reset to `origin/main` (done — prior PR #79 merged). |
| 0.2 Reproduce the login failure | `client/src/pages/Home.tsx`, `client/src/App.tsx` (RootRoute), `client/src/pages/dime-shell/breakpoints.ts` (`resolvePostLoginPath`), `server/routers/appUsers.ts` (`login`) | Run dev server; walk all three entry points (landing nav → `/login`, direct `/login` form, Discord button) logged-out **and** while already holding a valid session. Enumerate: stale-cookie UX, redirect race after `onSuccess`, `returnPath` resolution, mutation error swallowed. |
| 0.3 Write the findings before fixing | this plan (append) | The fix lands in Phase 1 if it is the dead Log Out / stale session; otherwise a targeted fix task is added here with its own tests. |

**Phase verification:** documented reproduction (or documented non-reproduction with evidence), console traces for the full login → identity → logout cycle for one owner and one non-owner account.

## Phase 1 — Real identity, everywhere (`/sp-verify`)

| Task | Files | Notes |
|---|---|---|
| 1.1 Wire the chat sidebar profile row + menu to the real session | `client/src/pages/dime-chat/DimeChatPage.tsx` (DimeSidebar), `client/src/_core/hooks/useAppAuth.ts` (read-only) | Name = `username` (display-cased), handle = `@username`, tier from `role`/`stripePlanId`, expiry from `expiryDate` (hidden when absent, e.g. owners), Discord row from `discordUsername` (hidden when not connected). No hardcoded strings remain. |
| 1.2 Initials avatar fallback | `client/src/pages/dime-chat/DimeChatPage.tsx` + small avatar component, `frozen-tokens.css`/`conversation.css` | Prez photo only for prez; everyone else gets brand-styled initials (mint on dark surface per `design-system/dime-ai/MASTER.md`). |
| 1.3 Make the menu buttons real | same file | Log Out → `trpc.appUsers.logout` (exists at `server/routers/appUsers.ts:485`) then hard redirect to `/`; Edit Profile → `/profile`; Upgrade → `/checkout`; Cancel → `/account`. Hide Upgrade/Cancel for owners. |
| 1.4 Platform-wide identity audit | grep sweep over `client/src` | Verify Profile, ManageAccount, mobile `MobileProfile`, feed headers all render the session user (they appear to); fix any other hardcoded identity (e.g. `ClaudeAssistant`'s "PB" bubble — owner-only, cosmetic). |

**Phase verification:** contract test asserting no `PREZ BETS` / `@prez` literals render from `DimeChatPage.tsx` and that the profile row reads `useAppAuth`; manual check as owner + non-owner on mobile/tablet/desktop, dark + light; logout → login-as-other-user cycle shows the right identity each time.

## Phase 2 — Non-owner chat gate: logo + "AI MODEL CHAT COMING SOON"

| Task | Files | Notes |
|---|---|---|
| 2.1 Coming-soon state for non-owners | `client/src/pages/dime-chat/DimeChatPage.tsx`, `conversation.css` | When auth resolves non-owner: render Dime wordmark (`/brand/dime-wordmark-on-{dark,light}.svg`, theme-aware) with **AI MODEL CHAT COMING SOON** beneath it. **No composer, no send pill, no prompt pills, no hero.** Sidebar/nav stays usable. Single component covers mobile/tablet/desktop. While auth is resolving: neutral blank/skeleton (fail closed — never flash the composer). |
| 2.2 Re-instate server owner-only entitlement (A1) | `server/dime-chat.route.ts`, restore `server/dimeModelAccess.ts` + tests | Non-owner `POST /api/dime/chat` → 403 before the freeze branch. Keeps the provider freeze intact and untouched. |
| 2.3 Copy pass | — | Exact copy `AI MODEL CHAT COMING SOON` (per request); `/stop-slop` applied to any supporting copy. |

**Phase verification:** contract tests (gate before render of composer; copy; server 403 ordering); manual non-owner pass on all three viewports; owner unaffected.

## Phase 3 — Chat history persistence (backend first)

| Task | Files | Notes |
|---|---|---|
| 3.1 Schema: `dime_chat_threads` + `dime_chat_messages` | `drizzle/schema.ts` | Threads: `id, userId, title, starred, archived, createdAt, updatedAt`. Messages: `id, threadId, seq, role(user/assistant), content, createdAt`. Indexes on `(userId, updatedAt)` and `(threadId, seq)`. |
| 3.2 ⚠ Deploy law | `.github/workflows/db-push.yml` | **Manual `db-push` workflow must run before any code deploy that reads these tables** (CLAUDE.md deploy law). This sequencing is a hard gate in Phase 5. |
| 3.3 `dimeChats` tRPC router | `server/routers/dimeChats.ts` (new), `server/routers.ts` | `appUserProcedure`-based, every query/mutation ownership-checked (`thread.userId === ctx.appUser.id`): `list` (own threads, starred first, archived filterable), `get` (with messages), `create`, `appendTurn` (user + assistant text after a completed stream), `setStarred`, `setArchived`, `delete` (hard, thread + messages). Title via existing `deriveChatTitle`; content capped at `DIME_CHAT_MAX_MESSAGE_CHARS`. |
| 3.4 Tests | `server/dimeChats.test.ts` (new) | Pure-logic tests + source-contract tests for ownership checks on every procedure (repo pattern); DB-dependent tests follow the existing CI-secrets convention. |

**Phase verification:** vitest green; contract test proves no procedure lacks an ownership check; `tsc --noEmit`.

## Phase 4 — Client: persistent Recent Chats, resume, and the "⋯" menu

| Task | Files | Notes |
|---|---|---|
| 4.1 Persist conversations from the chat page | `DimeChatPage.tsx`, `chatReducer.ts` | First send creates a thread (id held in state); every completed turn appends via `appendTurn`. Failure to persist never blocks the visible chat (fire-and-forget with retry-once). |
| 4.2 Recent Chats = stored threads | `DimeChatPage.tsx` (DimeSidebar), retire `recentChats.ts` session store | Sidebar lists `dimeChats.list` (starred first); clicking a chat hydrates the conversation (new `hydrate` reducer action) and continues it; active thread highlighted; works in the mobile drawer and desktop sidebar. |
| 4.3 Settings "⋯" top-right of an open chat | `DimeChatPage.tsx`, `conversation.css` | Visible only in conversation state, all breakpoints (desktop: top-right of the thread pane; mobile: right side of the top bar). Menu: **Star/Unstar**, **Archive/Unarchive**, **Delete** (with confirm). Delete/Archive returns to home state and refreshes the list. Brand law: mint accent, Familjen Grotesk, 160ms motion, no gradients (`MASTER.md` beats any generated style). |
| 4.4 Reducer tests + contract tests | `chatReducer.test.ts`, new contract test file | `hydrate` action unit-tested; contract tests pin menu actions → mutations and the delete-confirm flow. |

**Phase verification:** vitest green; manual matrix — create chat → refresh → chat persists → reopen → continue → star (reorders) → archive (leaves list) → delete (confirm, gone) — on mobile (~390px), tablet (~768px), desktop (≥1024px), dark + light; Playwright (bundled Chromium) smoke script if time allows.

## Phase 5 — Platform-wide verification, release notes, finish (`/sp-verify`, `/release-notes`, `/sp-finish`)

1. Full `vitest` run (failures must match the documented env/DB-secret baseline exactly), `tsc --noEmit`, full production build.
2. **Ordering gate:** run the manual `db-push.yml` workflow (schema) **before** merging/deploying the code that uses the new tables.
3. Cross-viewport, cross-theme, cross-role manual pass of every touched surface.
4. Release notes (user-facing, slop-free): identity fix, login/logout fix, non-owner coming-soon chat, persistent chat history with star/archive/delete.
5. PR → CI green → merge on your approval → Railway auto-deploy → smoke checks.

## Risks & unknowns

- **Login-button root cause is unconfirmed** until Phase 0 reproduces it. If it is not the stale-session/dead-logout combination, scope may grow (e.g., redirect race in `RootRoute`).
- **Schema deploy ordering**: deploying code before `db-push` runs would 500 the new endpoints in production. Phase 5 gates on it.
- **Stored chats are user data**: retention/PII surface grows; delete is hard-delete (A4); responsible-gambling distress interventions are also conversations — flagging that they will be stored unless excluded (decision welcome).
- **Design-law deviation**: the "⋯" header affordance isn't in the frozen design HTML; it's added as an explicit product requirement and documented as a deviation.
- **A1 partially restores reverted #72** (server chat gate only — Bet Tracker and WC2026 stay reverted). Veto A1 if the revert was meant to keep subscribers' API access.

## Explicitly out of scope

- Un-freezing the Anthropic provider (`DIME_CHAT_LLM_PROVIDER` stays `"frozen"`).
- Bet Tracker lockdown, Props/Bet Tracker tab, WC2026 gating (all reverted by #76; none re-added).
- Avatar uploads, chat sharing/export, chat search, real-time multi-device sync, message editing, pagination beyond a simple recent-N list.
- Discord OAuth flow changes (beyond what Phase 0 debugging may prove necessary).
- Any change to the Claude wiring or model configuration.
