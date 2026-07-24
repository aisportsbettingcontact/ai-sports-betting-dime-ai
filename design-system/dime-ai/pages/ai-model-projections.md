# AI Model Projections (Dime Feed) — Page Overrides

> **PROJECT:** Dime AI
> **Generated:** 2026-07-08 (authored from `dime-ai/reference-pages/dime-feed-*.html` and `dime-ai/DIME-FEED-MIGRATION-DRAFT.md`)
> **Page Type:** Dashboard / Data View

> ⚠️ **IMPORTANT:** Rules in this file **override** the Master file (`design-system/dime-ai/MASTER.md`).
> Only deviations from the Master are documented here. For all other rules, refer to the Master.

---

## Page-Specific Rules

### Layout Overrides

- **Shell:** Dime sidebar with "AI Model Projections" as `is-active`; top bar shows Slate as the active pill tab
- **Main pane gutters:** 40px (not the chat pane's 140px)
- **Card grid:** `grid-template-columns: 340px 1fr 1fr 1fr 300px` — Matchup | Run Line | Total | Moneyline | Model Verdict
- **Column headers:** IBM Plex Mono micro-labels above the card list ("MATCHUP", "RUN LINE · BOOK / MODEL", …)
- **Sub-tabs:** Projections · Splits · Lineups · K Props · Cheat Sheets · HR Props — 13px/600, active = `--text-primary` + 2px mint underline, inactive = `--text-muted`
- **Date nav:** ‹ › square buttons (28px, radius 8, 1px border) around "Weekday, Month D" (15px/700) + mono "MLB · N GAMES"
  — owner directive 2026-07-23: desktop date nav centers under the title band at 17px; 24/32px rhythm to the league header (32px of space; the pre-existing 1px divider border adds up to 33px edge-to-edge)
- **Sync status:** top-bar right — mono micro-label "SYNCED N MIN AGO" with 6px mint dot
- **Bottom composer:** "Ask dime about tonight's slate…" — ties the feed back to chat

### Spacing Overrides

- Card list gap: `12px`; card padding: `16px` (Master dense tier applies)

### Typography Overrides

- Matchup line: 16px/700 `--text-primary`; "@" separator in `--text-muted` at 400
- Book values: 15px `--text-body`, juice in parens `--text-muted`
- Model values: 15px/700 — mint ONLY if the model disagrees with the book enough to be signal
- Verdict strip values: 17px/700 over 10px mono labels (PICK / EDGE / GRADE)

### Color Overrides

- **Live state:** pulsing 7px mint dot + mono "LIVE · TOP 6" in mint (`--mint-on-light` on light theme, with keyline on the dot)
- **PASS games:** verdict values in `--text-secondary`, grade "—" *(2026-07-23: the verdict-strip/grade concept is superseded — no letter-grade field exists in the current ProjectionCard architecture; PASS state is enforced via `.projection-card--pass` at `opacity: 0.82` + an ROI-only neutral badge + a defensive zero-mint backstop, per Round 4 items 3 and 8 in `docs/superpowers/plans/2026-07-23-feed-desktop-polish.md`)*, whole card at `opacity: 0.82`, zero mint anywhere in the card. When prices are scorable, the summary still presents one best canonical no-vig ROI side per market (`calculateRoi`), ordered highest → lowest (zero/negative values included). Each slide shows only `ROI ±x.x%` in compact grey styling; its accessible name still announces that the projection is not actionable. The unavailable-data sentence is reserved for games with no scorable side.
  — a LIVE card never takes the PASS treatment, even when a mid-game model
  invalidation removes every edge. The newer compact-state rule below still
  reduces the whole live/final card to `opacity: 0.72`; that is lifecycle
  hierarchy, not a PASS/no-edge signal.
- **Win% annotation** next to model ML: 12px `--text-secondary`

### Component Overrides

- Verdict strip is separated from market columns by a 1px left border (`--color-border`), right-aligned
- No favorites gold: star = neutral outline, mint fill only when active (pending final call)

### Owner Directives — 2026-07-17 (mobile-first; all breakpoints)

- **No theme toggle in the feed header.** The Profile tab's Appearance setting
  (System / Light / Dark) is the single theme control. `?theme=` embeds stay honored.
  System owns the fixed neutral-grey, dark-contrast ground (`#121212` page /
  `#181818` card), Dark owns the pure-black ground, and Light owns the white
  ground.
- **Gamecard matchup block** (team names only; each fact once):
  ```
  {AWAY TEAM NAME} @ {HOME TEAM NAME}   ← "Giants @ Mariners" (names only, no abbrs)
  {BALLPARK}                            ← "T-Mobile Park" (never duplicated)
  {TIME OF FIRST PITCH ET}              ← "10:10 PM ET"
  ```
  Countries render names only (no FIFA codes); WC context line stays "Round · Venue".
  Scheduled games own the time in this block; the card header shows LIVE/FINAL only.
  Scheduled MLB probable pitchers render in their dedicated middle panel below
  this matchup block, never inside the matchup line itself.
- **Markets popover** *(amended 2026-07-23)*: closed by default; the card-level
  trigger reads "VIEW FULL AI MODEL PROJECTIONS" and opens the paginated
  floating panel defined below. Per-game market details are not a native
  `details` disclosure.
- **Market column labels:** `SIDE | BOOK | MODEL` — never "SPORTSBOOK PRICE" /
  "MODEL FAIR PRICE". Applies to every feed surface: mobile, tablet, desktop.
- **Summary readout labels:** `MODEL EDGE | BOOK | MODEL` — never "BEST PRICE".
- **Summary row grouping (2026-07-24):** `MODEL EDGE | BOOK | MODEL | signal`
  travels as one intrinsic-width, centered, single-line group at every
  breakpoint. Values never wrap, clamp, truncate, or overlap. If localized
  content is physically wider than the card, overflow is confined to the
  summary viewport so the complete row remains reachable without widening the
  card or page.
- **MODEL EDGE values are spelled out:** `U 7` → "UNDER 7", `O 8.5` → "OVER 8.5",
  a leading team abbr → the team name (`ATH ML` → "ATHLETICS ML").
  *(2026-07-18: the "tables keep compact form" clause is superseded — see below.)*
- **Mobile chrome centering (<768px):** dime wordmark centered in the topbar;
  date nav (‹ date › + slate count) stacks centered *(sport chips removed
  2026-07-18 — see combined slate below)*; the summary block centers above
  the markets popover trigger on mobile-width cards.
- **Slate order:** MLB games list earliest → latest first pitch, top to bottom
  (`timeToMinutes`; TBD start times sink to the bottom).

### Owner Directives — 2026-07-18 (WC winner-scope markets)

- **The two remaining WC matches replace MONEYLINE with a match-WINNER
  market** — graded on whoever wins the match when it settles, regardless of
  90'+injury time, extra time, or penalties:
  - `wc26-3rd-103` (FRA home vs ENG away): **"World Cup 3rd Place"** — book
    France **-215** / England **+170** (owner-provided 2026-07-18).
  - `wc26-final-104` (ESP home vs ARG away): **"To Win the World Cup"** —
    book Spain **-150** / Argentina **+130** (owner-provided 2026-07-18).
- **Model odds for this scope = `model_*_to_advance`** from the v27 engine
  (`server/wc2026/v27_jul18_engine.mjs` `deriveAllMarkets`): P(win 90') +
  P(draw) × [ET sub-sim at λ/3 + pens 50.5/49.5 home/away] — for these two
  matches that is literally "wins the match outright" (engine header). They
  flow `wc2026_model_projections.to_advance_*_odds` → router
  `modelOdds.toAdvance*` → the winner column. Edge = 2-way
  `calculateEdge(book, model)` (model side is fair: pAdvH+pAdvA=1); the mint
  edge cell, footers, and carousel populate through the standard pipeline.
- The client map (`WC_WINNER_MARKETS`, DimeModelFeed.tsx) pins the
  v27-verified orientation; a live-row disagreement falls back to plain ML
  rather than misassigning the owner book prices.
- **Scope clarity:** on these two cards the headers of DRAW, SPREAD,
  DOUBLE CHANCE, and BOTH TEAMS TO SCORE append **"(90 Min)"** (display-only
  tag; market shapes/labels resolve from the base title). Total keeps its
  plain header. Picks read "France 3rd Place" / "Spain to Win WC" so the
  summary readout and carousel always name the market.

### Owner Directives — 2026-07-18 (combined slate)

- **One collective feed — no sport toggle.** The MLB / World Cup chips are
  removed; both leagues load for the selected date and render in ONE list,
  grouped by league: **World Cup on top, MLB beneath** (CBS-scores-style
  league grouping — ONLY the grouping/order is mirrored, no other CBS
  element). Rationale: two WC matches remain, then MLB carries the feed
  until NCAAF/NFL return.
- League sections are **collapsible containers** (native details/summary,
  open by default; chevron affordance; 44px header row; mobile-first):
  official league logo in a fixed 30px box + the full spelled-out name at
  15px (1.25x, clamped on narrow phones), **centered as a cluster within
  the page** with the chevron pinned to the right edge — "2026 FIFA WORLD
  CUP" and "MAJOR LEAGUE BASEBALL (MLB)".
  **No game counts** in headers, and the feedhead slate count is removed
  (its divider stays — the feedhead bottom border). The WC emblem is
  theme-keyed: `/brand/wc26-emblem-on-light.png` (black FIFA wordmark) on
  light, `/brand/wc26-emblem-on-dark.png` (white wordmark) on dark, both
  rendered the same size; MLB uses the actual current mark (2026-07-21):
  the official `https://www.mlbstatic.com/team-logos/league-on-dark/1.svg`
  with the bundled recolored `/brand/mlb-logo.png` as offline fallback. A
  missing logo file hides itself (clean text-only header). A league with no games that date renders no
  section. Within a section the existing slate order holds (first pitch
  asc; LIVE > upcoming > FINAL tiers).
- **WC venue line drops trailing stadium parentheticals** —
  "MetLife Stadium (NY/NJ)" reads "MetLife Stadium · East Rutherford, NJ"
  (`wcDisplayStadium`; city matching still uses the raw stadium string).
- Date nav canonicalizes on the `mlb-` slug (one URL per date); legacy
  `wc-` deep links still parse and render the same combined slate.

### Owner Directives — 2026-07-21 (desktop emphasis pass)

Desktop (>=1024px) only — tablet/mobile keep their shipped layouts:

- **Shell page title at 5x, centered.** Embedded in the app shell, the
  topbar's "AI Model Projections" centers and scales 14px -> 70px (cqi-shaved
  only where the pane is too narrow for one line; never wraps). The topbar
  grows to a fixed 96px and the sticky feedhead offset tracks it. Standalone
  /feed keeps its compact wordmark + nav row.
- **Sidebar dime wordmark at 2.5x** (20px -> 50px) where the sidebar is
  persistent; the <1024px drawer keeps the frozen 20px.
- **MLB league logo is the actual current mark at 2x**: official navy/red
  mlbstatic league SVG in a 60px box (WC emblem keeps 30px); bundled
  recolored `/brand/mlb-logo.png` (navy `#041E42` / red `#BF0D3E`) as
  offline fallback.

### Owner Directives — 2026-07-23 (responsive feed density)

- **Games per row:** mobile (<768px) renders 1, tablet (768–1023px) renders
  2, and desktop (>=1024px) renders 3 inside each league section. Cards keep
  their container-driven internal reflow.
- Tablet rows stay start-aligned so each card keeps its natural height.
  Desktop rows stretch for scheduled cards; each summary centers within surplus height and
  the "VIEW FULL AI MODEL PROJECTIONS" popover trigger stays pinned to the bottom.
  Live/final/postponed cards opt out with `align-self: start`, keeping their
  intentionally compact natural height beside richer upcoming cards.

### Owner Directives — 2026-07-23 (Rotowire probable pitchers + lineups)

- **Upcoming MLB only.** Between the matchup and projection summary, render two
  equal probable-pitcher columns with a centered `LINEUPS` button. Each pitcher
  shows a headshot, `First Last`, the Rotowire W–L/ERA display line, and a
  text label of `EXPECTED` or `CONFIRMED`. If Rotowire has not posted the game,
  preserve the panel shape with `Pitcher TBD` and pending copy.
- Headshots are bottom-centered and inset inside their circular frames so the
  full portrait remains visible. `LINEUPS` is the Dime mint CTA: bold black
  text, 12px radius, inset highlight, hover elevation, and active scale.
- Matchup side tracks balance around the centered matchup copy; scheduled team
  logos sit directly beside their corresponding team names instead of at the
  card edges.
- Data stays on the existing public `games.mlbLineups({ gameIds })` read path.
  Batch numeric `games.id` values for `gameStatus === "upcoming"` only and poll
  every 60 seconds. Prefer the enriched lineup row; `games.list` starter names
  are the no-photo/no-stats fallback. Malformed lineup JSON is ignored at the
  client boundary, batting order is sorted 1–9, and no more than nine hitters
  render per team.
- `LINEUPS` opens a modal dialog, not another small popover: both teams, starter
  status, starter season line, lineup status, and batting orders render in two
  columns at tablet/desktop widths and one scrollable stack on mobile. The
  trigger and close control are at least 44px; Escape/outside click close the
  dialog and Radix restores focus to the trigger.
- **Lifecycle compaction.** As soon as a game becomes live, final, postponed, or
  suspended, remove all pregame pitcher/lineup UI, apply the compact card
  anatomy, set `align-self: start`, and diminish the card to `opacity: 0.72`.
  Never keep a stale lineup dialog trigger on a non-scheduled card.

### Owner Directives — 2026-07-23 (paginated market popover)

- **Replace the per-game collapsible market panel with an anchored popover.**
  Opening projections must never resize the card, stretch a row-mate, or move
  the feed grid. League sections remain their existing native collapsibles.
- The popover renders **one market table per page in source order**. MLB pages
  are Run Line (1), Total (2), and Moneyline (3). Other leagues keep their
  complete dynamic market count; the pagination window uses ellipses rather
  than hiding additional markets.
- Controls include Previous, numbered pages, and Next. The active page carries
  `aria-current`; boundary controls carry `aria-disabled` and leave the tab
  order. Every interactive pagination target is at least 44px.
- The floating surface is collision-aware, viewport-constrained, scrollable
  when vertical space is limited, and keeps one readable table on mobile. It
  consumes the global popover surface/foreground tokens in both themes; mint
  text uses the contrast-safe light-theme value.
- Escape and outside click close the popover and return focus to its trigger.
  Reduced motion removes the opening animation.

### Owner Directives — 2026-07-18 (edge labeling + multi-edge carousel)

- **The MODEL EDGE pick always names its market.** A moneyline edge reads
  "YANKEES ML" — never a bare "YANKEES". Run line edges carry their line
  ("YANKEES +1.5"), totals their number ("UNDER 9"). Implemented in the
  team-sport presentation adapter (`client/src/lib/sport/presentation.ts`
  `teamSideLabel`), mirroring the soccer adapter's "<Country> ML" rule.
- **Market-table side labels are spelled out** (supersedes the 2026-07-17
  compact-form clause): run line rows read "Dodgers -1.5" / "Yankees +1.5",
  total rows read "Over 9" / "Under 9", moneyline rows read "<Team> ML".
  Edge footers re-anchor on the spelled-out side ("Yankees +1.5 · +4.8%").
- **Ranked projection carousel:** a game with 2+ real edges cycles them in a
  swipeable scroll-snap strip (`SummaryCarousel`), one uniform summary
  readout per slide, ranked largest → smallest edge %, at most one side per
  market. If the whole game has no actionable edge, the same strip instead
  carries the highest canonical no-vig ROI side from each scorable market,
  ordered best → worst even when every ROI is negative; every neutral slide
  renders only a compact grey `ROI ±x.x%` badge while the accessible name
  retains the non-actionable status; its arrow remains neutral. The visible count/dot row
  is removed: a 44px `ArrowRight` control
  sits immediately after the edge pill, advances to the next edge, and wraps
  to the strongest after the last. Its icon is mint and its border consumes
  the theme foreground token (white on dark/system, black on light).
  `prefers-reduced-motion` collapses smooth scrolling. A game with one edge
  or one scorable no-edge candidate keeps the plain single summary with no
  arrow; a game with no scorable candidate shows the unavailable-data copy.

---

## Data Contract (do not violate — see `dime-ai/DIME-FEED-MIGRATION-DRAFT.md` §4)

- `games.list` requires exact `{ sport, gameDate }`; sync date to `games.getCurrentDate` (11:00 UTC cutoff)
- Honor ETag/304 (empty 304 body ≠ "no games"); keep 0-games auto-retry ×3 + auto-advance-to-first-available-date
- F5/NRFI/team-HR ride on the `games.list` row; K props / HR props / lineups are separate batched queries
- Keep 60s polling with `placeholderData: prev`
- Feed data is public; only `favorites.*` and Last-5 need the app session

---

## Recommendations

- Stream Dime chat answers about the slate token-by-token (existing SSE core)
- Mobile (<768px): sidebar becomes drawer; reuse frozen-panel MobileGameCard pattern inside the Dime skin
- Empty state: keep it quiet — mono label + date-advance hint, no illustration
