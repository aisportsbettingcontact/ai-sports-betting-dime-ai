# Feed card refinements — 2026-07-18

Owner requests from the mobile feed screenshot (post-PR #142 deploy), six changes on the
projections card plus the World Cup Final label. Branch: `claude/dime-feed-layout-updates-elwv8j`
(restarted from merged main at `d8c3e9a`). Execute with `/sp-execute`, verify with `/sp-verify`,
ship with `/sp-finish`.

Requests:
1. Remove the "WORLD CUP" corner label on the card. The selected sport chip already says it.
2. Make the flags 2.5x bigger.
3. Venue format "City, ST": "Hard Rock Stadium · Miami, FL" (England vs France),
   "MetLife Stadium · East Rutherford, NJ" (Spain vs Argentina).
4. "World Cup Final", not "Final", for the Jul 19 card.
5. Reduce the white space in the "VIEW FULL AI MODEL PROJECTIONS" collapsible element.

Brand law (`design-system/dime-ai/MASTER.md`) governs all styling: mint `#45E0A8` signal-only,
160ms motion, no gradients. `apple-design` informs the tap-target tradeoff in Phase 4.

## Verified facts (read during planning)

- `ProjectionCard` has exactly one consumer: `DimeModelFeed.tsx:496`. Header edits touch no
  other surface.
- `CountryFlag` has exactly one consumer: `TeamLogoMark` (matchup panel). Scaling its CSS
  cannot leak into market tables. MLB logos use a different path (`.team-logo-box`).
- Flag today: box `clamp(2rem, 1.8rem + 0.5vw, 2.25rem)`, glyph `clamp(1.5rem, 1.35rem + 0.4vw, 1.9rem)`
  in `CountryFlag.css`.
- Venue city comes from tRPC `wc2026.matchesByDate` → `m.venue.city` ("Miami Gardens",
  "East Rutherford"). The card join is `[stadium, city].join(" · ")` in `wcMatchToCard`.
- Round label: `wcRoundLabel` in `DimeModelFeed.tsx` (`>= 2026-07-19` branch returns "Final").
- Collapsible spacing: toggle `min-block-size: 2.75rem`, card grid `gap: var(--space-md)`,
  card `padding: var(--space-lg)` (`ProjectionCard.css`).
- `dimeModelFeed.test.ts` serializes the page JSX between anchors
  `'  return (\n    <div className="dmf-root"'` and `'\n}\n\n// ─── Data adapters'`.
  Phase 1 edits sit below the template; anchors stay untouched.

## Phase 1 — Copy: round label + venue display (`client/src/pages/DimeModelFeed.tsx`)

**Task 1.1** In `wcRoundLabel`, change the `>= "2026-07-19"` branch from `"Final"` to
`"World Cup Final"`. Leave every other branch alone (the test pins the Quarterfinal line).

**Task 1.2** In `wcMatchToCard`, map the DB city to the owner display string before the join:

```ts
const WC_VENUE_CITY_DISPLAY: Record<string, string> = {
  "Hard Rock Stadium": "Miami, FL",
  "MetLife Stadium": "East Rutherford, NJ",
};
```

Key on the stadium name (trimmed, case-insensitive compare), value replaces the city
entirely ("Miami Gardens" → "Miami, FL"). Unknown stadiums fall back to the raw DB city, so
past dates keep rendering. Join stays `" · "`.

**Verification**
- `pnpm check` exits 0.
- `pnpm vitest run client/src/pages/dimeModelFeed.test.ts client/src/pages/DimeModelFeed.doubleheader.test.ts client/src/lib/sport` all pass (24 + 4 + 24 today).
- Grep the file: `"World Cup Final"` present, no remaining bare `? "Final"` in the ternary.

## Phase 2 — Remove the card corner label (`ProjectionCard.tsx`, `ProjectionCard.css`)

**Task 2.1** Delete the `projection-card__league` span. Render the `<header>` only when
`game.status !== "scheduled"` (it then carries LIVE/FINAL alone). Note: MLB cards lose their
"MLB" corner label too, same rationale, the chip already says it.

**Task 2.2** Kill the phantom gap: with the head row empty, `grid-template-areas` plus the
card gap leaves a blank first row. Add a modifier (`projection-card--scheduled`) that drops
`"head"` from the template areas, or move the card to a flex column. With the league span gone,
set the lone status chip `justify-content: flex-end` so it does not sit in the dead corner.

**Verification**
- `pnpm vitest run client/src/components/projections` passes; `ProjectionCard.test.ts`
  still proves FINAL renders exactly once and scheduled cards carry no duplicate time.
- Add one assertion: rendered HTML of a scheduled card does not contain
  `projection-card__league`.

## Phase 3 — Flags 2.5x (`CountryFlag.css`)

**Task 3.1** Scale glyph and box 2.5x: glyph `clamp(3.75rem, 3.4rem + 1vw, 4.75rem)`, box
`clamp(5rem, 4.5rem + 1.25vw, 5.625rem)`. Keep the drop-shadow and tilt as is.

**Task 3.2** Guard narrow cards: two 80px flags leave roughly 190px for "England @ France"
on a 360px viewport. `matchup__line` wraps (`text-wrap: balance`), so the expected worst case
is a two-line matchup, not clipping. If the render check shows crowding below 380px card
width, add a `@container projcard` cap (about 4rem) for that range.

**Verification**
- `pnpm vitest run client/src/components/projections` passes (flag aria labels unchanged).
- Static render of the WC fixture at 360px and 393px widths, confirm no horizontal overflow
  (livelab if a DB-backed dev server is available, otherwise a standalone HTML harness of the
  built card CSS).

## Phase 4 — Collapsible white space (`ProjectionCard.css`)

**Task 4.1** Tighten the disclosure row: `min-block-size` 2.75rem → 2.25rem, pull the markets
block toward the summary with `margin-block-start: calc(-1 * var(--space-xs))` on
`.projection-card__markets`, and cut the card's bottom padding to `var(--space-sm)` via
`padding-block-end` so the closed card ends near the toggle.

**Task 4.2** Keep the affordance honest: full-row width preserves a large tap area, the focus
ring and hover surface must still fit, and the `[open]` state keeps `margin-top: var(--space-sm)`
on the grid so expanded tables do not collide.

**Verification**
- Closed-card render: measure the toggle block's rendered box (36px) and confirm the border
  and focus ring are not clipped.
- Open/close both states in the render check, tables intact.

## Phase 5 — /sp-verify + /sp-finish

- `pnpm check`, `pnpm vitest run client/src` DB-free suites, `pnpm build`.
- Bundle marker greps on `dist/public/assets`: `"World Cup Final"`, `"Miami, FL"`,
  `"East Rutherford, NJ"`, the new flag clamp present; `projection-card__league` absent.
- Push to `claude/dime-feed-layout-updates-elwv8j`, PR, owner merges, Railway auto-deploys.
- Production runtime check stays manual (this environment's egress policy 403s the domain):
  hard-refresh the feed, confirm the six changes on the England vs France and the Final cards.

## Risks and unknowns

- **Venue map keys on exact stadium strings.** If tRPC sends a variant ("Hard Rock Stadium,
  Miami"), the map misses and the raw city renders. Mitigation: case-insensitive substring
  match on "hard rock" / "metlife"; confirm against live data during execution.
- **2.5x flags on 320px devices** may force the matchup line to two cramped lines. Mitigation
  in Task 3.2; needs eyes on a real render, not just tests.
- **Toggle tap height drops to 36px.** Below Apple's 44pt guideline; the full-width row
  compensates. Flag to the owner if it feels tight on device.
- **Spain vs Argentina card is tomorrow's slate.** The Final's venue and label render only on
  the Jul 19 card; verification uses the date arrows to reach it.
- **Emoji flag rendering varies by platform.** 2.5x magnifies Windows' monochrome fallback;
  the site's audience is mobile Safari/Chrome where color emoji are safe.

## Out of scope

- `WorldCup2026.tsx` stale "Knockout Stage · Round of 32" banner (pre-existing, separate page).
- `WcFeedInline.tsx` (tree-shaken; parent page unrouted). No edits.
- MLB team logo sizing (request covers flags only).
- Desktop (≥768px) layout, top bar, and shell chrome.
- Server or DB venue data changes; this is display mapping only.
- Dead `GameRow` markup inside `DimeModelFeed.tsx`.
