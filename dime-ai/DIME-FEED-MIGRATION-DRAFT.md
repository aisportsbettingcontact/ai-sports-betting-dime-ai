# DRAFT — Migrating the MLB Projections Feed into the Dime AI Design

> Status: **DRAFT / analysis only — no implementation yet.**
> Goal: rebrand the current `/feed` MLB Projections experience into a "Dime AI Feed" that lives
> behind the **AI Model Projections** sidebar tab of the new Dime chat shell
> (see `reference-pages/` and `design-bundle/project/Dime Chat.dc.html`).

---

## 1. What the current MLB Projections feed is built from

### 1.1 Frontend surface (route `/feed`)

| Layer | File | Size / role |
|---|---|---|
| Page | `client/src/pages/ModelProjections.tsx` | 1,796 lines — header/nav, sport pills (MLB / WC), CalendarPicker, sub-tab bar, URL-backed state (`useUrlState`), query orchestration |
| Core card | `client/src/components/GameCard.tsx` | 3,576 lines — BOOK vs MODEL odds (RL / Total / ML), edge verdicts + ROI%, 3-tier responsive, hosts sub-panels |
| Cheat sheets | `client/src/components/MlbCheatSheetCard.tsx` | 2,028 lines — F5 / NRFI / per-inning grid, client-side Edge·EV math |
| Lineups | `client/src/components/MlbLineupCard.tsx` | batting orders, pitchers, weather, env signals strip |
| K props | `client/src/components/MlbPropsCard.tsx` | strikeout prop projections |
| HR props | `client/src/components/MlbHrPropsCard.tsx` | home-run prop rows |
| Splits | `client/src/components/BettingSplitsPanel.tsx` | tickets/handle bars (inside GameCard) |
| Support | `CalendarPicker.tsx`, `GameCardSkeleton.tsx`, `MobileGameCard.tsx`, `WcFeedInline.tsx` | date picker, skeletons, mobile layout, World Cup inline feed |

Feed sub-tabs today: **PROJECTIONS · SPLITS · LINEUPS · K PROPS · CHEAT SHEETS (F5/NRFI) · HR PROPS**.

### 1.2 Data the page pulls (tRPC procedures → tables)

| Procedure | Backing table(s) | Notes |
|---|---|---|
| `games.list` | `games` (~175 cols) | THE payload — book odds, model projections, edges, F5, NRFI, team-HR, inning arrays all ride on this one row. 60s client refetch, 60s server cache, ETag/304. |
| `games.getCurrentDate` / `getAvailableDates` / `activeSports` / `lastRefresh` | `games` + date math | 11:00 UTC cutoff is server-authoritative |
| `games.mlbLineups` | `mlb_lineups` | batched by gameIds |
| `games.mlbEnvSignals` | `mlb_park_factors`, `mlb_bullpen_stats`, `mlb_umpire_modifiers` | env strip |
| `strikeoutProps.getByGames` | `mlb_strikeout_props` | K props tab |
| `hrProps.getByGames` | `mlb_hr_props` | HR props tab |
| `favorites.*` | `user_favorite_games` | only login-gated surface besides Last-5 |
| `mlbSchedule.getLast5ForMatchup` | `mlb_schedule_history` | login-gated panel |

**Everything is public (`publicProcedure`) and pre-computed** — no model runs or scrapes happen at
request time. There is no pagination; one day = one payload.

### 1.3 Pipeline that populates those tables (out-of-band, in-process)

```
MLB Stats API ─ mlbScoreRefresh.ts ────────► games (scores/status/clock)
             └ mlbOutcomeIngestor.ts ──────► games (actuals, Brier)      [nightly]
VSiN ───────── vsinBettingSplitsScraper.ts ► games (bet%/money%)
Action Network actionNetworkScraper.ts ────► games (book RL/Total/ML) + odds_history
             ├ ActionNetworkF5NrfiAPI.py ──► games (f5*, nrfi*)
             ├ anKPropsService ────────────► mlb_strikeout_props (book lines)
             └ mlbHrPropsScraper.ts ───────► mlb_hr_props (book lines)
RotoWire ───── rotowireLineupScraper.ts ───► mlb_lineups
FanGraphs ──── heartbeat /api/scheduled/fg-lineups ► lineup cache
                     ▼ (model inputs)
mlbModelRunner.ts ─► MLBAIModel.py (Monte Carlo) ─► games (model*, edges, F5, NRFI, HR)
mlbKPropsModelService.ts ──────────────────────────► mlb_strikeout_props (kProj, verdicts)
mlbHrPropsModelService.ts ─────────────────────────► mlb_hr_props (modelPHr, verdicts)
        (all orchestrated 24/7 by runMlbCycle() in server/vsinAutoRefresh.ts)
```

### 1.4 Current visual identity (what the rebrand replaces)

- Neon green **`#39FF14`** hardcoded (not tokenized) across: active tab underline, model-edge
  values, cheat-sheet edges, lineup dots, calendar today/dots, mobile tab active icon.
- oklch tokens in `client/src/index.css`: near-black `--background`, purple `--primary`,
  `--edge-green` / `--edge-red`.
- Fonts: Inter (body) + JetBrains Mono; **`Barlow Condensed` is referenced by every MLB card but
  never loaded** (silent fallback — pre-existing bug, moot after rebrand).
- Gold `#FFD700` favorites; `#D3D3D3` book values; per-card inline hex palettes.

---

## 2. Key architectural insight

**The backend needs zero changes.** The feed is a pure read-layer over pre-computed public tRPC
procedures. The Dime AI Feed is therefore a *new frontend surface over the same data contracts* —
low-risk, fully parallel to the production `/feed`, and shippable behind a test route.

Second insight: **the Dime chat sidebar decomposes today's mega-page almost 1:1.** The design's
sidebar rows map directly onto existing feed sub-tabs and routes:

| Dime sidebar row (design) | Existing source | Data already available via |
|---|---|---|
| New Chat / Chat | `/chat` (DimeChat SSE) | `POST /api/dime/chat` |
| **AI Model Projections** | `/feed` PROJECTIONS + CHEAT SHEETS tabs | `games.list` |
| Betting Splits + Odds History | SPLITS tab + `BettingSplitsPanel`/`OddsHistoryPanel` | `games.list` + odds history queries |
| Trends | (future — `startMlbNightlyTrendsScheduler` already computes trend data) | needs a read procedure |
| Prop Projections | K PROPS + HR PROPS tabs | `strikeoutProps.getByGames`, `hrProps.getByGames` |
| Bet Tracker | `/bet-tracker` | `betTracker.listWithStats` |
| Top-bar "Slate" tab (design) | the projections feed itself | `games.list` |

---

## 3. Proposed migration plan (test design, production untouched)

### Phase A — Dime shell + feed pane (structure)
1. Build `DimeShell` layout from `reference-pages/` spec: 264px sidebar (nav rows, Recent Chats,
   profile row + settings menu), top tab bar (Chat / Slate / Bet Tracker), theme-variable driven
   (`.theme-dark` default, `.theme-light` ready).
2. New test route (e.g. `/dime`) rendering DimeShell; panes: **Chat** (existing `DimeChat`
   transport core restyled) and **AI Model Projections** (the feed pane).
3. Feed pane v0: extract the page's data orchestration into a shared hook
   (`useMlbFeedData`: games.list + dates + lineups + props queries, with the retry/304/cutoff
   semantics preserved) and render the **existing** cards unchanged inside the shell.
   Ugly but functional on day one; `/feed` remains production.

### Phase B — token bridge (color/typography swap)
Introduce Dime tokens (verified values from `design-bundle`, see `dime-ai/README.md`) as CSS
variables scoped to the Dime shell, then convert the cards' hardcoded hexes to variables:

| Current | Dime replacement |
|---|---|
| `#39FF14` neon green (edges, active, live) | `#45E0A8` mint (`--mint`), `#0FA36B` on light surfaces |
| `#000` / `#0f0f0f` / `#090E14` card bgs | `#0B0B0F` page · `#101016` sidebar · `#16161C` cards |
| `#232327` / `#182433` borders | `#1E1E26` / `#24242E` |
| `#D3D3D3` book values, `#8a8a92` muted | `#EDEDF2` / `#C9C9D4` / `#9A9AA8` / `#6A6A78` text tiers |
| `#FF4444` negative edge | keep red, tune to design's dark ramp |
| Inter / (unloaded) Barlow Condensed | **Familjen Grotesk** (400–700) |
| JetBrains Mono labels | **IBM Plex Mono** (10px uppercase +0.08em micro-labels) |
| radius mix | 8 / 12 / 16 / 26 scale, 160ms cubic-bezier(0.16,1,0.3,1) motion |

Converting inline hexes → `var(--dime-*)` in the shared cards also future-proofs the legacy feed
(one-line token swap later).

### Phase C — card redesign to the Dime aesthetic
Re-skin the cards using the design language proven in the chat mockups (5c/5d): surfaces
`#16161C` + border `#24242E`, radius 12–16, IBM Plex Mono micro-labels over 20px/700 values —
the **stat-card pattern** (`Model prob · Best price · Edge · Grade`) generalizes perfectly to
GameCard's edge verdicts, F5/NRFI blocks, and prop rows. Priority order:
1. `GameCardSkeleton`, `MlbPropsCard`, `MlbHrPropsCard`, `MlbLineupCard` (pure presentation — easy)
2. `BettingSplitsPanel`, `CalendarPicker` (moderate)
3. `GameCard`, `MlbCheatSheetCard` (logic-heavy — restyle visuals only, do not touch edge math)

### Phase D — wire the rest of the shell
Sidebar rows → panes/routes (`Betting Splits`, `Prop Projections`, `Bet Tracker`), Recent Chats
persistence for Dime chat (localStorage first, `dime_conversations` table later), "Trends" as a
future pane over the nightly-trends data.

---

## 4. Contracts that MUST be preserved (from the pipeline audit)

1. Always pass exact `{ sport, gameDate }` to `games.list`; sync to `games.getCurrentDate`
   (11:00 UTC cutoff) — never compute "today" client-side alone.
2. Honor ETag/304 (an empty 304 body is *not* "no games") and keep the 0-games auto-retry ×3 +
   auto-advance-to-first-available-date semantics.
3. F5/NRFI/team-HR data comes on the `games.list` row — no separate endpoint; K props / HR props /
   lineups are separate batched-by-gameIds queries.
4. Responses are per-sport null-stripped (`stripSportNullFields`) — don't assume all schema columns.
5. Feed data is public; only `favorites.*` and `mlbSchedule.getLast5ForMatchup` need the
   `app_session` cookie.
6. 60s polling on `games.list` is the live-update mechanism — keep `placeholderData: prev`.

## 5. Risks / open questions (for review before implementation)

- **Mobile:** the Dime design is desktop-only (1600×900). Proposal: sidebar → drawer <1024px,
  and reuse the existing frozen-panel `MobileGameCard` inside the Dime skin. The
  `GlobalMobileOwnerTabs` bottom nav overlaps the shell's sidebar role on mobile — decide which
  wins in the test design.
- **GameCard (3.5k lines) and MlbCheatSheetCard (2k lines)** interleave visuals with edge math —
  Phase C for these two is the bulk of the effort; everything else is fast.
- **Favorites gold `#FFD700`:** keep as-is, or restrain to mint + star glyph per Dime's
  one-accent discipline? (Design kit has no gold.)
- **Light mode:** the shell ships theme-ready, but app-wide `ThemeProvider` is dark-locked —
  fine for the test design.
- WC2026 pill: carry into the Dime feed pane later via `wc2026.matchesByDate` (separate pipeline,
  out of scope for v1).
