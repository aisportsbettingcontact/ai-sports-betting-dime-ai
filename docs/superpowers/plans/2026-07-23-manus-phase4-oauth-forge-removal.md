# Manus Removal — Phase 4: OAuth + Forge chain

> REQUIRED SUB-SKILL: executing-plans / subagent-driven-development. TDD where tests exist; verify login at every step.

**Goal:** Remove the last Manus-platform footprint — the legacy OAuth session chain and the Forge (`BUILT_IN_FORGE_*`) integration — WITHOUT breaking the live `app_session` (appUser) auth or login.

**Architecture / key facts (verified):**
- The **live** auth is `appUserProcedure`/`ownerProcedure` (`app_session` cookie, `ctx.appUser`). Untouched by this phase.
- **Manus OAuth** (`ctx.user` via `sdk.authenticateRequest`, `protectedProcedure`, `adminProcedure`, `/api/oauth`, `auth.me`, `COOKIE_NAME`) is **dead on Railway** — no Manus cookie ⇒ `ctx.user` always `null` ⇒ every `protectedProcedure`/`adminProcedure` procedure already rejects in production.
- **Forge** (`ENV.forgeApiUrl/forgeApiKey`) is dead on Railway (unconfigured). Remaining consumers: `notification.ts`, `voiceTranscription.ts`, `storage.ts`.

**Dispositions (verified by callers + route gating):**
| Surface | Disposition | Why |
|---|---|---|
| `mlbBacktest.*` (7 procs: getRollingAccuracy, getDriftLog, getFullReport, getDailyTimeSeries, getEdgeBuckets, getKPropsReport, getHrPropsReport) | **Migrate `protectedProcedure` → `ownerProcedure`** | Called by `MlbBacktest` + `TheModelResults`, both `RequireOwner` pages. Owner-only is correct; **restores** them (currently broken by dead OAuth). No `ctx.user` usage. |
| `files.upload/list/delete` + `server/storage.ts` | **Delete** | Zero client callers; backed by Forge storage (dead). |
| `voiceTranscription.ts` + its procedure | **Delete** | Zero client callers; Forge-backed (dead). |
| `system.notifyOwner` (adminProcedure) + `notification.ts` (Forge) | **Delete procedure; gut `notifyOwner()` → logged no-op** | No client caller; throws on Railway. Keep the exported `notifyOwner` as a no-op so the ~7 server callers (schedulers) keep compiling without behavior change (they already got a throw). |
| Manus OAuth chain: `sdk.ts`, `oauth.ts`, `/api/oauth` route + authLimiter, `context.ts` `ctx.user`, `requireUser`, `protectedProcedure`, `adminProcedure`, `auth.me`, `auth.logout`, `COOKIE_NAME` | **Delete** | Dead legacy auth. |
| Client `useAuth.ts`, `const.ts` `getLoginUrl`/VITE_OAUTH vars; 6 components' `useAuth()` usage; `DashboardLayout` chain if unused | **Delete/migrate to `useAppAuth`** | `useAuth` reads the dead Manus session; the real hook is `useAppAuth`. |
| env: `forgeApiUrl/forgeApiKey`, `appId`, `oAuthServerUrl`, `ownerOpenId`; `.env.example`/`ci.yml`/`SECRETS_SETUP` `VITE_APP_ID`/`OAUTH_SERVER_URL`/`OWNER_OPEN_ID`/`BUILT_IN_FORGE_*` | **Delete** | No remaining consumers after the above. |

## Global constraints
- **`tsc --noEmit` clean + build green after every stage.** `app_session` login path (`appUsers.login`, `appUserProcedure`, `ownerProcedure`, `getSessionCookieOptions`, `APP_USER_COOKIE`) must not be touched.
- Run the auth test suites (`server/appUsers.login.test.ts`, `server/adminProcedureLockdown.test.ts`, `server/auth.logout.test.ts`) after server changes.
- Bundle budget after client changes.
- No secrets in the diff.

## Stages (each ends with tsc + build; commit per stage)

### Stage 1 — Migrate `mlbBacktest.*` to ownerProcedure (restore owner tools)
- `server/routers.ts`: change the 7 `mlbBacktest.*` procedures from `protectedProcedure` → `ownerProcedure` (import `ownerProcedure` from `./routers/appUsers` or wherever it's exported). Verify none read `ctx.user` (confirmed none do).
- Verify: `tsc`; the pages' queries now resolve for an owner.

### Stage 2 — Delete dead Forge/OAuth-gated features
- Delete `files` router (upload/list/delete) from `server/routers.ts` + `server/storage.ts` + `listModelFiles`/`deleteModelFile`/`getModelFileById`/`storagePut` if now unused.
- Delete `server/_core/voiceTranscription.ts` + any `transcribe` procedure registration.
- Delete `system.notifyOwner` procedure (`server/_core/systemRouter.ts`); gut `server/_core/notification.ts` `notifyOwner()` to a logged no-op returning `false` (remove Forge fetch); keep the export so callers compile.
- Verify: `tsc`.

### Stage 3 — Remove the Manus OAuth server chain
- `server/_core/context.ts`: drop `sdk.authenticateRequest` + `user` from `TrpcContext` (or set `user: null` and then remove all readers — prefer full removal).
- `server/_core/trpc.ts`: delete `requireUser`, `protectedProcedure`, `adminProcedure` (and any now-unused imports).
- `server/routers.ts`: delete `auth.me` + `auth.logout` (or the whole `auth` router if empty), remove `COOKIE_NAME` import + `clearCookie(COOKIE_NAME)`.
- `server/_core/index.ts`: remove `registerOAuthRoutes(app)` + the `/api/oauth` authLimiter line + import.
- Delete `server/_core/oauth.ts`, `server/_core/sdk.ts`, `server/_core/types/manusTypes.ts` (+ `oauthTypes.ts` if Manus-only), `@shared/const` `COOKIE_NAME`/`ONE_YEAR_MS` if now unused.
- Verify: `tsc`; run the auth test suites.

### Stage 4 — Client: remove legacy useAuth
- Migrate `DashboardLayout.tsx` (+ `DashboardLayoutSkeleton.tsx`): if the Dashboard chain is unused, delete it; else replace `useAuth()` with `useAppAuth()` (map `user`/`loading`/`logout`).
- `GameCard.tsx`, `BettingSplits.tsx`, `ModelProjections.tsx`: replace `useAuth()` reads (`user`, `isAuthenticated`) with `useAppAuth()` equivalents (`appUser`, `!!appUser`). These already treat Manus `user` as always-null, so behavior is preserved/clarified.
- `MobileNavAuthGate.tsx`: drop the stale `useAuth` comment.
- Delete `client/src/_core/hooks/useAuth.ts`, `client/src/const.ts` `getLoginUrl` (+ VITE_OAUTH_PORTAL_URL/VITE_APP_ID reads). Anything importing `getLoginUrl` for a redirect → use `/login`.
- Verify: `tsc`; `check:bundle`.

### Stage 5 — Env + docs cleanup
- `server/_core/env.ts`: remove `forgeApiUrl`, `forgeApiKey`, `appId`, `oAuthServerUrl`, `ownerOpenId`.
- `.env.example`, `.github/SECRETS_SETUP.md`, `.github/add-secrets.sh`, `.github/workflows/ci.yml`: remove `VITE_APP_ID`, `OAUTH_SERVER_URL`, `OWNER_OPEN_ID`, `BUILT_IN_FORGE_API_URL/KEY`, `VITE_FRONTEND_FORGE_*`.
- Verify: `tsc`; build; full de-Manus grep (`git grep -in "forge\|oauth_server\|manus"` → only legit hits like `manuscript`, Discord OAuth, Stripe).

## Verification (final)
- `tsc --noEmit` clean; `npm run build:client` green; `check:bundle` under budget.
- Auth suites green (login/lockout/logout).
- `git grep -in "forge"` (excluding "fire-and-forget") and `git grep -in "sdk.authenticateRequest\|protectedProcedure\|adminProcedure\|ctx.user"` → **zero** matches.
- Manual reasoning: `app_session` login untouched; owner pages' `mlbBacktest.*` now resolve via `ownerProcedure`.

## Out of scope
- Discord auth/login (Discord OAuth is the real social login — keep). Stripe. The `app_session`/appUser auth.
