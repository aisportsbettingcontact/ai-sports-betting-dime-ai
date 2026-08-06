# MASTER.md Pre-Delivery Checklist — item by item

Source: `design-system/dime-ai/MASTER.md` §"Pre-Delivery Checklist". Scope is the
diff on `feat/feed-card-status-header` (the feed gamecard header + the
pregame-only venue/time gate), not a re-audit of the whole surface.

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | Mint appears ONLY on signal (edges, picks, live, active nav, focus, coin-dot) | **PASS** | The diff adds no mint. The only mint in the header slot is the pre-existing live state: `--mint-ink` text + the `--brand-mint` dot, both on `--live` only. scheduled/final/postponed/suspended headers carry no mint (`ProjectionCard.css:67,84-86`; `geometry.json` shows `hasLiveDot: true` on live only). |
| 2 | `--mint-on-light` used for all mint text on light surfaces | **PASS** | Mint text resolves through `--mint-ink` (`#0a7c50` on light — the token that superseded `--mint-on-light` per THREE-COLOR-LAW §2026-08-02), further darkened under compaction by `color-mix(… 60%, #000)`. The correct token is in use; its composited ratio is item 7. Raw `#45E0A8` as text on the light card would be 1.57:1 and is not used. |
| 3 | Familjen Grotesk + IBM Plex Mono loaded; no legacy fonts | **PASS** (per the routing.md scoring rule) | Correct state is Familjen-only with mono-STYLE treatment and Plex Mono NOT loaded (2026-07-24 supersede note). The header uses the mono-style register — caps, `0.06em` tracking, `tabular-nums` — in Familjen Grotesk. No `font-family` is added by this diff. |
| 4 | All icons SVG (brand kit or Lucide); no emojis as icons | **PASS** | The diff adds no icon. The live dot is a styled `<span>`, unchanged. |
| 5 | `cursor-pointer` on all clickable elements | **PASS (n/a to the diff)** | The status line is not interactive and correctly is not focusable (`tabIndex -1`, Assessment B). No interactive element is added or removed. |
| 6 | Hover states use the 160ms brand curve | **PASS (n/a to the diff)** | No hover state added; no transition property touched — see `motion-review.md`. |
| 7 | Text contrast 4.5:1 minimum (both themes) | **9 of 10 PASS — see correction below** | Composited (not raw) contrast against the card ground, accounting for `--compact`'s `opacity: 0.72`. Status text is 12.00px @375 / 14.05px @1440 → **normal text**, so 4.5:1 is the floor: scheduled **8.13** dark / **6.54** light · live **6.25** / **4.4969** · final, postponed, suspended **10.10** / **8.79**. Light-theme live is **0.003 below** the floor. |
| 8 | Focus states visible (3px `--ring`) | **PASS (n/a to the diff)** | No focusable element added. An 18-Tab sweep never lands in `.projection-card__head`, which is correct for non-interactive text; existing focusable controls (summary viewport, next-edge arrow, markets toggle, LINEUPS) are unchanged. |
| 9 | `prefers-reduced-motion` respected | **PASS** | `getComputedStyle(.projection-card__live-dot).animationName === "none"` under `reducedMotion: "reduce"`; screenshot `reduced-motion-dark-1440x900.png`. Assessment B: exactly 45 pixels differ vs the animated frame — the dot and nothing else. |
| 10 | Responsive: 375px, 768px, 1024px, 1440px; no horizontal scroll on mobile | **PASS** | Screenshots at all four widths × dark and light. `documentElement.scrollWidth > clientWidth` is **false** at 320 / 375 / 768 / 1024 / 1440 (Assessment B). The status line never truncates: `scrollWidth === clientWidth` for all five states at all five widths. At 200% zoom (720×450 @ DSF 2) the grid reflows 3-up → 2-up with no clipping ancestor over the status box. |
| 11 | Real `<button>`/`<a>` elements with ARIA roles for menus/tabs | **PASS** | No menu or tab added. The header is a `<header>` → `role=sectionheader`; the status is a plain `<span>` carrying `StaticText`, which is correct for non-interactive state text. Improved during the repair round: the card's accessible name now carries the state — `aria-label="Giants at Rangers, LIVE · BOT 8TH"` (verified in-browser for all five states). |

**Checklist: 10/11 pass, 1 partial** (4 of the passes vacuous, because the diff
adds no interactive element, icon, hover, or font).

## CORRECTION — 2026-08-06 (post-deploy audit)

**This file originally recorded item 7 as a clean 11/11 pass with light-theme
live at 4.62:1. That number was wrong and the item is a partial.** The
correction is filed here rather than silently overwritten, because the original
figure was quoted into the PR body, the page law, and a CSS comment.

The error was in the compositing model, not the measurement. When
`.projection-card--compact` sets `opacity: 0.72`, the browser renders the card
and its text into one layer and composites that whole layer over the **page**.
So the page ground bleeds into the text and the card background alike:

```
effective text = 0.72 × color   + 0.28 × pageBackground
effective bg   = 0.72 × cardBg  + 0.28 × pageBackground
```

The original pass composited the text over the already-dimmed card background
(`#f9f9f9`) instead of over the page white, which under-lightened the text and
overstated the ratio. Re-measured in a real browser against the deployed
production build, reading `getComputedStyle` and flattening with the formula
above:

| theme | state | effective text | effective bg | ratio | AA 4.5 |
|---|---|---|---|---|---|
| dark | live | `rgb(50,161,121)` | `rgb(7,7,7)` | 6.2500 | pass |
| dark | scheduled | `rgb(166,166,166)` | `rgb(10,10,10)` | 8.1300 | pass |
| dark | final / postponed / suspended | `rgb(184,184,184)` | `rgb(7,7,7)` | 10.0986 | pass |
| light | **live** | `rgb(76,125,106)` | `rgb(249,249,249)` | **4.4969** | **fail by 0.003** |
| light | scheduled | `rgb(89,89,89)` | `rgb(247,247,247)` | 6.5385 | pass |
| light | final / postponed / suspended | `rgb(71,71,71)` | `rgb(249,249,249)` | 8.7878 | pass |

At 14.05px / weight 600 this is **normal** text under WCAG (large text needs
24px, or 18.66px bold), so 4.5:1 is the applicable floor and light-theme live
misses it.

**Not caused by PR #409.** The three rules that determine this value —
`.projection-card__status--live { color: var(--mint-ink) }`, the
`html:not(.dark) .projection-card--compact` `color-mix(… 60%, #000000)`
correction, and `.projection-card--compact { opacity: 0.72 }` — are
byte-identical before and after that PR. #409 moved the element and added
`font-variant-numeric`; it changed no colour and no opacity.

**Computed remedy, for the owner.** The existing correction mixes the light
mint ink 60% with black. Deepening it to **50%** yields effective text
`rgb(75,116,100)` and a ratio of **≈4.96:1** — clear of the floor with real
margin, still the same single mint hue. That is a brand-token change on a
governed surface, so it is proposed here, not applied.

## Known issues carried forward, not fixed here

1. **Salience is inverted against decision value.** `.projection-card--compact`
   remaps `--text-secondary → --foreground` to hold AA through its `0.72` dim,
   which makes the four *non-actionable* states the brightest text in the slot
   (10.10:1 measured, corrected above) and the bettable scheduled card the
   dimmest of the greys (8.13:1). Reverting the
   remap for the status alone would drop light-theme settled text to ~3.4:1 —
   below AA — so the fix is not a CSS exemption; it means revisiting the
   lifecycle-compaction dim itself, which is owner territory. Logged in the page
   law under the 2026-08-05 directive.
2. ~~**Postponed and suspended cards still rank above scheduled and still render
   a mint edge chip.**~~ **CLOSED 2026-08-06** by PR
   `fix/feed-unplayable-slate-rank` (owner directive "unplayable games: slate
   tier + mint rationing", evidence bundle
   `docs/audits/2026-08-06-feed-unplayable-evidence/`). Both were explicit
   non-goals of #409 and were reported rather than applied at the time.
3. **The live label sits ~5.5px right of the card centerline** because the 7px
   dot + 6px margin live inside the centered span. The span's optical mass is
   centered; the words are not. Every other state is centered to 0.0px.
