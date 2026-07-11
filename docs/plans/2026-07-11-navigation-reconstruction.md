# Navigation Reconstruction — Canonical Feed & Splits Routes

**Date:** 2026-07-11 · **Branch:** `claude/ai-projections-routing-fix-cqq7zm`

## Goal

Make these the only navigation targets for their surfaces, site-wide:

| Surface | Canonical URL |
|---|---|
| AI Model Projections (MLB) | `/feed/model/mlb-MM-DD-YYYY` (e.g. `/feed/model/MLB-07-11-2026`, case-insensitive) |
| AI Model Projections (World Cup) | `/feed/model/wc-MM-DD-YYYY` |
| Betting Splits | `/betting-splits/MLB` (also `/NHL`, `/NBA`) |

Eradicate every `/feed?tab=…` query hook and every `/splits` hook. Legacy slugs
(`/feed`, `/feed?tab=…`, `/splits`, `/projections`, `/dashboard`) permanently route
(HTTP 308 at the server + client-side redirect for SPA navigations) to the canonical
URLs and can never populate from any link, tab, or post-login redirect.

## Current state (verified in code)

- `client/src/App.tsx:104` — RootRoute sends authenticated users to `/splits`.
- `client/src/App.tsx:137-138` — `/dashboard`, `/projections` → `/feed`.
- `client/src/App.tsx:140` — `/splits` renders public `SplitsLive`.
- `client/src/App.tsx:165` — `/feed` renders legacy `ModelProjections` whose state
  lives in query params (`useUrlState` — this is the hook that populates `?tab=…`).
- `client/src/App.tsx:169-170` — canonical `DimeModelFeed` routes exist (PR #67), but
  the sport-only form (`/feed/model/mlb`) renders "Invalid feed URL" — no
  default-to-today.
- `client/src/App.tsx:172` — `/betting-splits` has no `:sport` param.
- `client/src/features/mobileOwnerTabs/config.ts:27-30` — Feed/Splits/Props tabs point
  at `/feed?tab=dual|splits|lineups`.
- `client/src/features/mobileOwnerTabs/MobileOwnerBottomTabs.tsx:282-321` —
  `getActiveTab` parses query strings to resolve the active tab.
- `client/src/pages/Home.tsx:105,117` — login `returnPath` defaults to `/splits`.
- `client/src/pages/BettingSplits.tsx:532,541` — tab bar links `/projections` and a
  `/splits` self-link (known bug: the active tab navigates away to the public page).
- Feed links elsewhere: `DimeChatPage.tsx:47,48,487`, `MlbTeamSchedule.tsx:569`,
  `ModelResults.tsx:444`, `ManageAccount.tsx:157`, `SubscribeSuccess.tsx:237`,
  `TheModelResults.tsx:1012`, `ClaudeAssistant.tsx:99,161-162`.
- `server/mobileOwnerTabs.test.ts:33-42,314-316,362-391` — tests pin `/feed?tab=` paths.
- `server/_core/index.ts` — no server-level redirects for these slugs (only
  www→canonical 308 at :362-374, which is the precedent to follow).
- `drizzle/schema.ts:2267-2271` — doc comment cites `/splits` as the returnPath example.

## Phase 1 — Canonical route helpers + date defaulting

- **1.1** New `client/src/lib/feedRoutes.ts`: `toFeedSlugDate(iso)` (YYYY-MM-DD →
  MM-DD-YYYY), `feedModelPath(sport?: "MLB"|"WC", iso?: string)` (date defaults to
  `todayUTC()` from `CalendarPicker`), `bettingSplitsPath(sport?: "MLB"|"NHL"|"NBA")`,
  `legacyFeedRedirectTarget(search: string)` (pure: `?tab=splits` → splits path,
  `?sport=WC` → WC feed, else MLB feed). Unit tests in `client/src/lib/feedRoutes.test.ts`.
- **1.2** `client/src/pages/DimeModelFeed.tsx`: bare-sport URLs (`/feed/model/mlb`)
  canonicalize — `parseFeedModelPath` accepts a bare `mlb|wc` segment and the page
  `navigate(feedModelPath(sport), { replace: true })` to the dated URL instead of
  rendering "Invalid feed URL". Extend `client/src/pages/dimeModelFeed.test.ts`
  (bare sport, uppercase `MLB-07-11-2026`, invalids).

## Phase 2 — Router reconstruction (`client/src/App.tsx`)

- RootRoute authenticated redirect → `feedModelPath("MLB")` (was `/splits`).
- `/dashboard`, `/projections` → `<Redirect to={feedModelPath("MLB")} />`.
- `/feed` → redirect via `legacyFeedRedirectTarget(window.location.search)` (replace,
  so back-button never re-lands on the legacy slug).
- `/splits` → `<Redirect to={bettingSplitsPath("MLB")} />`; remove the `SplitsLive`
  route + import and delete `client/src/pages/SplitsLive.tsx`.
- `/betting-splits/:sport` → `BettingSplits` with validated `initialSport`;
  `/betting-splits` → `<Redirect to="/betting-splits/MLB" />`.
- Remove the `ModelProjections` route + import (file stays; see out-of-scope).

## Phase 3 — Navigation hooks (every link source)

- `config.ts` tabs: Feed → `/feed/model/mlb`, Splits → `/betting-splits/MLB`,
  Props → `/m/props` (existing query-free route, `MobileOwnerLayout.tsx:25`).
- `MobileOwnerBottomTabs.tsx` `getActiveTab`: drop all query-string matching; prefix
  rules — `/feed/model` → feed, `/betting-splits` → splits, `/m/props` → props.
- `Home.tsx`: both `returnPath` defaults → `/feed/model/mlb`.
- `BettingSplits.tsx`: accept `initialSport`; sport-pill changes sync the URL
  (`navigate(bettingSplitsPath(sport), { replace: true })`); tab bar left link →
  `feedModelPath()`, right self-link → current splits path (fixes the :541 bug).
- Update remaining `/feed` + `/betting-splits` call sites (DimeChatPage,
  ClaudeAssistant, MlbTeamSchedule, ModelResults, ManageAccount, SubscribeSuccess,
  TheModelResults) to the helpers.
- `drizzle/schema.ts` returnPath doc comment → `/betting-splits/MLB`.

## Phase 4 — Server-side permanent redirects (`server/_core/index.ts`)

GET-only middleware registered before the SPA fallback, mirroring the www→canonical
308 style: `/splits` → `/betting-splits/MLB`; `/feed` (exact pathname), `/projections`,
`/dashboard` → canonical feed URL computed from the server's effective date
(same cutoff logic as `games.getCurrentDate`), honoring `?tab=splits` → splits.
`/feed/model/*` passes through untouched.

## Phase 5 — Verification (/sp-verify)

- `npx tsc --noEmit` with `NODE_OPTIONS=--max-old-space-size=6144`.
- Targeted vitest: `server/mobileOwnerTabs.test.ts` (expectations updated to new
  paths), `client/src/pages/dimeModelFeed.test.ts`, new `feedRoutes.test.ts` —
  none require `DATABASE_URL`.
- Grep sweep: zero `/feed?` and zero `/splits` link/redirect references left in
  `client/src` + `server` source (docs/logs excluded).
- Subagent fan-out: independent verifiers re-trace each route family (feed, splits,
  legacy redirects, mobile tabs, login returnPath) from route definition → every
  link source → active-tab logic → tests, and confirm nothing can emit a legacy URL.

## Phase 6 — 5-subagent UI/UX audit (apple-design + ui-ux-pro-max)

Production-grade audit across MOBILE / TABLET / DESKTOP of the surfaces this
reconstruction touches (DimeModelFeed, BettingSplits, mobile owner tabs, login/root
redirect flow):

1. **Mobile (≤430px)** — bottom tabs, safe-area insets, ≥44px touch targets, feed
   card layout, horizontal overflow.
2. **Tablet (768–1024px)** — breakpoint behavior, grid/table reflow, orientation.
3. **Desktop (≥1280px)** — page composition, header/nav, max-width discipline,
   hover states.
4. **Motion & interaction (apple-design)** — 160ms brand motion law, easing,
   `prefers-reduced-motion`, interruptibility, touch feedback.
5. **Brand law + accessibility (MASTER.md + ui-ux-pro-max)** — single mint accent
   `#45E0A8` (`#0FA36B` on light), Familjen Grotesk / IBM Plex Mono, no
   gradients/neon `#39FF14`/purple/gold, WCAG contrast, aria labels, focus states.

Findings are severity-ranked; P0/P1 issues on touched nav surfaces get fixed in this
branch, the rest are reported.

## Phase 7 — Ship

Commit with a descriptive message and push to
`claude/ai-projections-routing-fix-cqq7zm` (`git push -u origin …`).

## Risks / unknowns

- **`/splits` was public (no auth).** `/betting-splits/MLB` sits behind `RequireAuth`,
  so the public splits view now requires login. Explicitly requested ("/splits …
  eradicated"), but it is a visible behavior change.
- **Legacy `ModelProjections` sub-tabs** (LINEUPS / K PROPS / CHEAT SHEETS / HR PROPS)
  lose their `/feed?tab=lineups` entry point; the Props tab now opens `/m/props`.
  A path-based props surface is a follow-up, out of scope here.
- **WC "today"** buckets on PT kickoff-day server-side while `todayUTC()` uses the
  11:00 UTC cutoff — around midnight the default date can differ by a day; the feed's
  prev/next date arrows make this recoverable.
- **External deep links** (Discord posts, bookmarks) to `/feed?…`/`/splits` are covered
  by the server 308s.

## Out of scope

- Deleting `client/src/pages/ModelProjections.tsx` / `useUrlState` (kept unrouted;
  dead-code removal is a follow-up).
- Rebuilding a props/lineups surface at a path-based route.
- `/m/*` owner screens redesign; `MobileOwnerBottomTabs` hardcoded `#39FF14` (owner
  marked "PERMANENT" — audit flags it, does not change it).
- Sitemap/SEO work; Discord bot `/splits` slash command (different namespace, stays).
