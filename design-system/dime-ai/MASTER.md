# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/dime-ai/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.
>
> **SUPERSEDED (2026-07-13):** the color + surface rules here are superseded by
> `dime-ai/THREE-COLOR-LAW.md` — v1 (strict 3-color), v2 (tonal greys, hover,
> depth-by-border), and v3 (dimensional: elevation shadows + an accessible mint
> accent surface, scoped to the projections product). Where this file and the
> Law disagree, the Law wins.

---

**Project:** Dime AI (AI Sports Betting)
**Generated:** 2026-07-08 (authored from the pixel-verified brand kit in `dime-ai/` — NOT from generic search output)
**Category:** AI analytics / sports betting product
**Design Dials:** Density 8/10 (Dense / Dashboard) | Motion 2/10 (Subtle)
**Source of truth:** `dime-ai/README.md`, `dime-ai/reference-pages/*.html`, `dime-ai/design-bundle/`

---

## Global Rules

### Color Palette — STRICT ONE-ACCENT MINT DISCIPLINE

Mint is the ONLY accent. It is reserved for: model edges/picks, live indicators, active-nav
rail, focus rings, and the brand coin-dot. Everything without signal stays in the grey text
tiers. **No gold, no red, no neon green (`#39FF14` is the LEGACY accent being replaced), no
purple, no gradients.**

| Role | Dark | Light | CSS Variable |
|------|------|-------|--------------|
| Accent (mint) | `#45E0A8` | `#45E0A8` (fills) | `--mint` |
| Accent text on light surfaces | — | `#0FA36B` | `--mint-on-light` |
| Page background | `#0B0B0F` | `#FFFFFF` | `--color-background` |
| Sidebar surface | `#101016` | `#F4F4F6` | `--surface-sidebar` |
| Card / input surface | `#16161C` | `#F7F7F9` | `--surface-card` |
| Raised surface (menu, active pill) | `#1A1A22` | `#E8E8EC` | `--surface-raised` |
| User bubble | `#1E1E26` | `#F0F0F3` | `--surface-bubble` |
| Border | `#24242E` (also `#1E1E26`, `#2E2E38`) | `#E4E4E9`, `#D5D5DC` | `--color-border` |
| Text primary | `#EDEDF2` | `#0B0B0F` | `--text-primary` |
| Text body | `#C9C9D4` | `#2A2A32` | `--text-body` |
| Text secondary | `#9A9AA8` | `#55555E` | `--text-secondary` |
| Text muted | `#6A6A78` | `#9A9AA8` | `--text-muted` |
| Text faint | `#55555E` | — | `--text-faint` |
| Focus ring | `rgba(69,224,168,0.36)` | `rgba(69,224,168,0.28)` | `--ring` |
| Row hover | `rgba(255,255,255,0.065)` | `rgba(15,23,42,0.055)` | `--row-hover` |
| Row active | `rgba(255,255,255,0.095)` | `rgba(69,224,168,0.13)` | `--row-active` |
| Mint keyline (mint plates only) | `#2FB584` | `#2FB584` | `--mint-keyline` |

**Color Notes:**
- Mint TEXT on light surfaces must use `--mint-on-light: #0FA36B` (raw mint on white is ~1.9:1 — fails contrast). Mint FILLS (dots, rails, pills) may stay `#45E0A8` on light, with a `#0B0B0F` hairline keyline where edge definition is needed (brand dot rule).
- Negative / no-edge / PASS states are GREY (`--text-secondary`), never red. De-emphasize whole PASS rows to ~82% opacity.
- Coin-dot logic (brand): mint dot on black · mint dot + black hairline on white · white dot on mint.

**Destructive-action exception:** `--dime-danger: #E5484D` (owner directive 2026-07-22,
account-settings cancel flow) — destructive-action CONFIRMS only, e.g. the "Cancel plan"
button in a cancel-confirm dialog. Never for emphasis, badges, or general error text —
those stay grey per the negative-state rule above. Mint remains the sole accent; this is a
single, scoped carve-out, not a second accent color.

### Typography

> **SUPERSEDED (2026-07-24 audit note):** the single-font mandate in
> `client/src/index.css:7-12` retires IBM Plex Mono — `--font-sans` AND
> `--font-mono` both resolve to Familjen Grotesk, and no mono face is loaded
> anywhere. Micro-labels keep the treatment below (10–11px caps, 0.08em
> tracking) rendered in Familjen Grotesk. Do not reintroduce Plex Mono from
> this file. The dark page background is likewise Law v2 `#000000`
> (`client/src/index.css:126`), not the `#0B0B0F` in the table above.

- **Heading & Body Font:** Familjen Grotesk (400, 500, 600, 700)
- **Data labels / micro-labels:** IBM Plex Mono (400, 500) — 10–11px, UPPERCASE, letter-spacing `0.08em`, `--text-muted`
- **Numeric data values:** Familjen Grotesk 700 at 15–20px (mono is for labels, not values)
- **Wordmark:** lowercase "dıme" — dotless ı (U+0131) + mint coin-dot (0.20em, `left: calc(50% + 0.03em); top: 0.05em`), weight 700, tracking −0.05em
- **Google Fonts:** [Familjen Grotesk + IBM Plex Mono](https://fonts.googleapis.com/css2?family=Familjen+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap)

**CSS Import:**
```css
@import url('https://fonts.googleapis.com/css2?family=Familjen+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');
```

### Spacing Variables

*Density: 8/10 — Dense / Dashboard (data-heavy feed surfaces). Chat/home surfaces may relax to the standard tier.*

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | `2px` / `0.125rem` | Tight gaps (sidebar row gap) |
| `--space-sm` | `4px` / `0.25rem` | Icon gaps, inline spacing |
| `--space-md` | `8px` / `0.5rem` | Standard padding |
| `--space-lg` | `12px` / `0.75rem` | Card gaps |
| `--space-xl` | `16px` / `1rem` | Card padding |
| `--space-2xl` | `24px` / `1.5rem` | Section padding |
| `--space-3xl` | `32px` / `2rem` | Page gutters (desktop: 40px feed / 140px chat) |

### Radius Scale

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-row` | `8px` | Sidebar rows, small controls |
| `--radius-card` | `12px`–`16px` | Stat cards (12), game cards & bubbles (16) |
| `--radius-menu` | `14px` | Popup menus |
| `--radius-pill` | `16px`–`20px` | Tab pills (16), prompt pills (20) |
| `--radius-composer` | `26px` | Composer |
| `--radius-full` | `50%` | Buttons, avatars, dots |

Chat bubble corner rule: user `16/16/4/16`, assistant `4/16/16/16` (tail toward speaker).

### Motion

*Motion: 2/10 — Subtle. One curve everywhere.*

- **Transition:** `160ms cubic-bezier(0.16, 1, 0.3, 1)` for background, color, transform, box-shadow
- **Hover states:** `opacity: 0.85` (pills/mint buttons), `opacity: 0.7` (submit button), `--row-hover` (rows/menu items)
- **Live indicator:** 1.6s opacity pulse on a 7px mint dot
- **Typing indicator:** 3 dots, 1s cycle, 0.2s stagger
- **Always** respect `prefers-reduced-motion: reduce` (disable transitions and pulses)
- **No** GSAP/scroll/parallax effects — this is a data product, not a marketing page

### Shadow Depths

Shadows are minimal — surfaces separate by background tier + 1px borders, not elevation.

| Level | Value | Usage |
|-------|-------|-------|
| `--shadow-menu` | `0 12px 32px rgba(0,0,0,0.55)` dark / `0 12px 32px rgba(11,11,15,0.18)` light | Popup menus only |
| `--shadow-input` | `0 1px 3px rgba(11,11,15,0.06)` | Light-mode composer only |

---

## Component Specs

### Sidebar row (nav + recent chats)

```css
.sidebar-row {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 10px; border-radius: 8px; font-size: 13px;
  color: var(--text-secondary); cursor: pointer;
  transition: background 160ms cubic-bezier(0.16,1,0.3,1), color 160ms cubic-bezier(0.16,1,0.3,1);
}
.sidebar-row:hover { background: var(--row-hover); color: var(--text-primary); }
.sidebar-row.is-active { background: var(--row-active); color: var(--text-primary); font-weight: 600; }
/* Active rail: 3px × 18px mint rounded bar at left: -6px, vertically centered */
.sidebar-row:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--ring); }
```

### Composer

```css
.composer {
  display: flex; align-items: center; gap: 10px;
  background: var(--surface-card); border: 1px solid var(--color-border);
  border-radius: 26px; padding: 9px 9px 9px 20px;  /* light mode: + --shadow-input */
}
/* Submit: 36px circle. Dark UI: white btn / black caret / mint plus.
   Light UI: black btn / mint caret / white plus.
   Glyph = brand caret+plus SVG (dime-ai/design-bundle/dime-brand-svgs/4b). */
```

### Cards (game cards, stat cards, reply bubbles)

```css
.card {
  background: var(--surface-card);
  border: 1px solid var(--color-border);
  border-radius: 16px;              /* 12px for compact stat cards */
  padding: 16px;                    /* 14px 20px for stat strips */
}
/* No hover-lift on data cards. Cards are informational, not clickable-affordance. */
```

### Stat block (the signature data pattern)

```html
<!-- IBM Plex Mono micro-label over a bold value. Mint ONLY when the value is signal. -->
<div>
  <div class="mono-label">EDGE</div>            <!-- 10px, 0.08em, uppercase, --text-muted -->
  <div class="stat-value is-signal">+5.5%</div>  <!-- 17-20px, 700; mint if signal, --text-primary otherwise -->
</div>
```

### Buttons / pills

```css
.pill {
  height: 36px; padding: 0 16px; border-radius: 20px;
  font-size: 13px; font-weight: 600; cursor: pointer;
  transition: opacity 160ms cubic-bezier(0.16,1,0.3,1);
}
.pill:hover { opacity: 0.85; }
/* Tab pill (active): background var(--surface-raised); inactive: --text-muted, no bg */
```

### Inputs

```css
.input { background: transparent; border: none; outline: none; font: inherit; font-size: 14px; color: var(--text-primary); }
.input::placeholder { color: var(--text-muted); }
/* Focus lives on the composer container: box-shadow 0 0 0 3px var(--ring) */
```

### Menus

```css
.menu {
  background: var(--surface-raised); border: 1px solid #2E2E38;
  border-radius: 14px; padding: 10px; box-shadow: var(--shadow-menu);
}
.menu-item { padding: 9px 10px; border-radius: 8px; font-size: 13px; }
/* Menu items must be real <button> elements; Escape + outside-click close; aria-haspopup/menu roles */
```

---

## Style Guidelines

**Style:** Dark-first data product. Quiet surfaces, one signal color, mono micro-labels,
tight numeric hierarchy. Light mode is a token swap, never a redesign.

**Page shell:** 264px fixed sidebar (`--surface-sidebar`, 1px right border) + main pane.
Top bar: pill tabs (Chat / Slate / Bet Tracker) + context info right-aligned.
Sidebar order: brand header → nav rows → Recent Chats (scroll) → profile row (top border).

**Key Effects:** mint active-rail on nav rows; pulsing mint live-dot; edge values pop
because everything else is grey — protect that contrast by rationing mint.

---

## Anti-Patterns (Do NOT Use)

- ❌ **Neon green `#39FF14`** — legacy accent, replaced by mint everywhere
- ❌ **Gold `#FFD700` favorites** — use neutral outline star, mint fill when active
- ❌ **Red for negative edge** — no-signal/negative = grey tiers + reduced opacity
- ❌ **Purple/pink "AI" palettes and gradients** — off-brand
- ❌ **Raw mint `#45E0A8` as TEXT on light surfaces** — use `#0FA36B`
- ❌ **Mint for decoration** — if it isn't signal (edge/pick/live/active), it isn't mint
- ❌ **Barlow Condensed / Inter / JetBrains Mono** — legacy fonts; Familjen Grotesk + IBM Plex Mono only
- ❌ **Hover-only affordances** — row actions need `:focus-within` + touch fallback
- ❌ **Emojis as icons** — use the brand SVG kit (`dime-ai/design-bundle/dime-brand-svgs/`) or Lucide
- ❌ **Missing cursor:pointer**, **layout-shifting hovers**, **instant state changes**, **invisible focus states**
- ❌ **Canvas-frame chrome** — the 1600×900 border in reference pages is not product UI

---

## Pre-Delivery Checklist

Before delivering any UI code, verify:

- [ ] Mint appears ONLY on signal (edges, picks, live, active nav, focus, coin-dot)
- [ ] `--mint-on-light` used for all mint text on light surfaces
- [ ] Familjen Grotesk + IBM Plex Mono loaded; no legacy fonts
- [ ] All icons SVG (brand kit or Lucide); no emojis as icons
- [ ] `cursor-pointer` on all clickable elements
- [ ] Hover states use the 160ms brand curve
- [ ] Text contrast 4.5:1 minimum (both themes)
- [ ] Focus states visible (3px `--ring`)
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive: 375px, 768px, 1024px, 1440px; no horizontal scroll on mobile
- [ ] Real `<button>`/`<a>` elements with ARIA roles for menus/tabs

---

## Supported viewport contract (NEW 2026-07-24, evidence-derived)

No support contract existed before this date (audit S5-001,
`SUPPORT_CONTRACT_MISSING`). The bounds below are **new**, derived from
repository evidence — breakpoints in `client/src/index.css` (375/640/768/
1024/1280/1600), the viewport-scaling engine (`--vp-base: 393`, clamp floor
0.81 ≈ 320px), the device database comment in the same file (320–3840), and
Chromium-emulation sweeps run 2026-07-24 (integer widths 320–1440 on `/` and
the 404 route, heights 500–1000). They are a floor to verify against, not a
ceiling on what may work.

| Axis | Supported | Verification status |
|---|---|---|
| Viewport width | 320–1920 CSS px | 320–1440 sweep-verified (Chromium emulation); 1441–1920 rule-derived, spot-checked |
| Viewport height | 500–1000+ CSS px | 500–1000 sweep-verified at 390/1440 wide |
| Device pixel ratio | 1–3 | probe-verified (calculated backing pixels) |
| Zoom / text scale | 200% / 130% | spot-verified on `/`, `/feed` shell |
| Engines | Chromium-class verified | WebKit/Firefox **unverified** — no runtime available in the audit environment |
| Reduced motion | full support required | verified (shell, utilities, landing) |
