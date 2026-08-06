# MASTER.md Pre-Delivery Checklist — item by item

Source: `design-system/dime-ai/MASTER.md` §"Pre-Delivery Checklist". Scope is the
diff on `feat/feed-card-status-header` (the feed gamecard header + the
pregame-only venue/time gate), not a re-audit of the whole surface.

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | Mint appears ONLY on signal (edges, picks, live, active nav, focus, coin-dot) | **PASS** | The diff adds no mint. The only mint in the header slot is the pre-existing live state: `--mint-ink` text + the `--brand-mint` dot, both on `--live` only. scheduled/final/postponed/suspended headers carry no mint (`ProjectionCard.css:67,84-86`; `geometry.json` shows `hasLiveDot: true` on live only). |
| 2 | `--mint-on-light` used for all mint text on light surfaces | **PASS** | Mint text resolves through `--mint-ink` (`#0a7c50` on light — the token that superseded `--mint-on-light` per THREE-COLOR-LAW §2026-08-02), further darkened under compaction by `color-mix(… 60%, #000)`. Measured light-theme composited contrast **4.62:1** (Assessment B); raw `#45E0A8` as text on the light card would be 1.57:1 and is not used. |
| 3 | Familjen Grotesk + IBM Plex Mono loaded; no legacy fonts | **PASS** (per the routing.md scoring rule) | Correct state is Familjen-only with mono-STYLE treatment and Plex Mono NOT loaded (2026-07-24 supersede note). The header uses the mono-style register — caps, `0.06em` tracking, `tabular-nums` — in Familjen Grotesk. No `font-family` is added by this diff. |
| 4 | All icons SVG (brand kit or Lucide); no emojis as icons | **PASS** | The diff adds no icon. The live dot is a styled `<span>`, unchanged. |
| 5 | `cursor-pointer` on all clickable elements | **PASS (n/a to the diff)** | The status line is not interactive and correctly is not focusable (`tabIndex -1`, Assessment B). No interactive element is added or removed. |
| 6 | Hover states use the 160ms brand curve | **PASS (n/a to the diff)** | No hover state added; no transition property touched — see `motion-review.md`. |
| 7 | Text contrast 4.5:1 minimum (both themes) | **PASS** | Composited (not raw) contrast against the card ground, accounting for `--compact`'s `opacity: 0.72`, measured in-browser by Assessment B. Status text is 12.00px @375 / 14.05px @1440 → **normal text**, so 4.5:1 is the floor: scheduled **8.13** dark / **6.54** light · live **6.41** / **4.62** · final, postponed, suspended **10.32** / **9.01**. All pass; the live-on-light margin is thin (+0.12) and depends on the `color-mix` correction at `ProjectionCard.css:84-86`. |
| 8 | Focus states visible (3px `--ring`) | **PASS (n/a to the diff)** | No focusable element added. An 18-Tab sweep never lands in `.projection-card__head`, which is correct for non-interactive text; existing focusable controls (summary viewport, next-edge arrow, markets toggle, LINEUPS) are unchanged. |
| 9 | `prefers-reduced-motion` respected | **PASS** | `getComputedStyle(.projection-card__live-dot).animationName === "none"` under `reducedMotion: "reduce"`; screenshot `reduced-motion-dark-1440x900.png`. Assessment B: exactly 45 pixels differ vs the animated frame — the dot and nothing else. |
| 10 | Responsive: 375px, 768px, 1024px, 1440px; no horizontal scroll on mobile | **PASS** | Screenshots at all four widths × dark and light. `documentElement.scrollWidth > clientWidth` is **false** at 320 / 375 / 768 / 1024 / 1440 (Assessment B). The status line never truncates: `scrollWidth === clientWidth` for all five states at all five widths. At 200% zoom (720×450 @ DSF 2) the grid reflows 3-up → 2-up with no clipping ancestor over the status box. |
| 11 | Real `<button>`/`<a>` elements with ARIA roles for menus/tabs | **PASS** | No menu or tab added. The header is a `<header>` → `role=sectionheader`; the status is a plain `<span>` carrying `StaticText`, which is correct for non-interactive state text. Improved during the repair round: the card's accessible name now carries the state — `aria-label="Giants at Rangers, LIVE · BOT 8TH"` (verified in-browser for all five states). |

**Checklist: 11/11 pass** (4 of them vacuously, because the diff adds no
interactive element, icon, hover, or font).

## Known issues carried forward, not fixed here

1. **Salience is inverted against decision value.** `.projection-card--compact`
   remaps `--text-secondary → --foreground` to hold AA through its `0.72` dim,
   which makes the four *non-actionable* states the brightest text in the slot
   (10.32:1) and the bettable scheduled card the dimmest (8.13:1). Reverting the
   remap for the status alone would drop light-theme settled text to ~3.4:1 —
   below AA — so the fix is not a CSS exemption; it means revisiting the
   lifecycle-compaction dim itself, which is owner territory. Logged in the page
   law under the 2026-08-05 directive.
2. **Postponed and suspended cards still rank above scheduled and still render a
   mint edge chip.** `slateStatusRank` (`DimeModelFeed.tsx`) puts them in the
   upcoming tier, and `isPass` only neutralizes mint when there are no edges.
   Both fixes are one line each and both are **explicit non-goals** of this
   change (card ordering; PASS dimming semantics), so they are reported, not
   applied.
3. **The live label sits ~5.5px right of the card centerline** because the 7px
   dot + 6px margin live inside the centered span. The span's optical mass is
   centered; the words are not. Every other state is centered to 0.0px.
