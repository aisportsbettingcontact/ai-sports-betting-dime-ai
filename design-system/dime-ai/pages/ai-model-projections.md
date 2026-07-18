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
- **PASS games:** verdict values in `--text-secondary`, grade "—", whole card at `opacity: 0.82`, zero mint anywhere in the card
- **Win% annotation** next to model ML: 12px `--text-secondary`

### Component Overrides

- Verdict strip is separated from market columns by a 1px left border (`--color-border`), right-aligned
- No favorites gold: star = neutral outline, mint fill only when active (pending final call)

### Owner Directives — 2026-07-17 (mobile-first; all breakpoints)

- **No theme toggle in the feed header.** The Profile tab's Appearance setting
  (System / Light / Dark) is the single theme control. `?theme=` embeds stay honored.
- **Gamecard matchup block** (pitcher names are BANNED from gamecards; each fact once):
  ```
  {AWAY TEAM NAME} @ {HOME TEAM NAME}   ← "Giants @ Mariners" (names only, no abbrs)
  {BALLPARK}                            ← "T-Mobile Park" (never duplicated)
  {TIME OF FIRST PITCH ET}              ← "10:10 PM ET"
  ```
  Countries render names only (no FIFA codes); WC context line stays "Round · Venue".
  Scheduled games own the time in this block; the card header shows LIVE/FINAL only.
- **Markets disclosure:** collapsed by default; toggle reads
  "VIEW FULL AI MODEL PROJECTIONS" with a Lucide `ChevronDown` to expand and
  `ChevronUp` (shown via `details[open]`) to collapse.
- **Market column labels:** `SIDE | BOOK | MODEL` — never "SPORTSBOOK PRICE" /
  "MODEL FAIR PRICE". Applies to every feed surface: mobile, tablet, desktop.
- **Summary readout labels:** `MODEL EDGE | BOOK | MODEL` — never "BEST PRICE".
- **MODEL EDGE values are spelled out:** `U 7` → "UNDER 7", `O 8.5` → "OVER 8.5",
  a leading team abbr → the team name (`ATH ML` → "ATHLETICS ML").
  *(2026-07-18: the "tables keep compact form" clause is superseded — see below.)*
- **Mobile chrome centering (<768px):** dime wordmark centered in the topbar;
  date nav (‹ date › + slate count) stacks centered *(sport chips removed
  2026-07-18 — see combined slate below)*; the summary block centers above
  the markets disclosure on mobile-width cards.
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
- League section header = mono micro-label with count ("WORLD CUP · 2
  MATCHES", "MLB · 14 GAMES"); a league with no games that date renders no
  section (no empty WC header after the final). The feedhead slate count
  sums every league. Within a section the existing slate order holds
  (first pitch asc; LIVE > upcoming > FINAL tiers).
- Date nav canonicalizes on the `mlb-` slug (one URL per date); legacy
  `wc-` deep links still parse and render the same combined slate.

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
- **Multi-edge carousel:** a game with 2+ real edges cycles them in a
  swipeable scroll-snap strip (`SummaryCarousel`), one uniform summary
  readout per slide, ranked largest → smallest edge %. ONLY real edges
  populate slides — NO_EDGE markets never appear; at most one side per
  market. Dot + count nav; mint marks the active dot only; 160ms brand
  curve; `prefers-reduced-motion` collapses smooth scrolling. A game with
  one edge (or none) keeps the plain single summary.

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
