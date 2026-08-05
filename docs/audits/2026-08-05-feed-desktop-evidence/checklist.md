# MASTER.md Pre-Delivery Checklist — feed desktop refinement (2026-08-05)

Scored against the AFTER build (`feat/feed-desktop-refine`, production bundle
on :3911, fixture slate with LIVE / PASS / FINAL / carousel / CONFIRMED
states, dark + light). Screenshot references are in
`screenshots/after/` (untracked; see summary.md).

| # | Item | Verdict | Evidence |
|---|---|---|---|
| 1 | Mint appears ONLY on signal (edges, picks, live, active nav, focus, coin-dot) | **PASS** | Edge cells + LIVE label + active nav + focus rings only; PASS card zero-mint at 0.82 (`feed-dark-1440x900-scroll2.png` Angels card, ROI badge grey); CONFIRMED pitcher labels ink-not-mint (`feed-dark-1440x900-viewport.png`); the two raw `#45e0a8` literals moved into `var(--brand-mint, …)` fallback position (ProjectionCard.css pagination active border + table signal stripe) |
| 2 | `--mint-on-light` used for all mint text on light surfaces | **PASS** | Mint text flows through `--mint-ink` (raw mint dark / `#0A7C50` light); NEW: dimmed compact live cards darken the same hue via `color-mix` so the 0.72-composited LIVE label clears 4.5:1 on white (computed 4.8:1; was ~3.1:1) — `feed-light-1440x900-viewport.png` |
| 3 | Familjen Grotesk + IBM Plex Mono loaded; no legacy fonts | **PASS** (per the 2026-07-24 supersede note: pass = Familjen-only, Plex Mono NOT loaded) | `document.fonts.check("16px Familjen Grotesk")` true in all 30 AFTER shots (run-report fontMisses: 0); no mono face loaded; `--dmf-mono`/`--dmf-sans` both resolve Familjen-first. Emoji font stacks on `.market-table__flag`/CountryFlag are country-flag glyph content, not typography |
| 4 | All icons SVG (brand kit or Lucide); no emojis as icons | **PASS** | Lucide throughout (ChevronDown/Up, ArrowRight, TrendingUp, PanelsTopLeft); country flags are content glyphs, not icons |
| 5 | `cursor-pointer` on all clickable elements | **PASS** | `.dmf-root :where(button)` cursor rule + explicit `cursor: pointer` on markets toggle, LINEUPS chip, next arrow, date-nav squares |
| 6 | Hover states use the 160ms brand curve | **PASS** | Assessment B duration sweep: every transition literal is `160ms` or `var(--dmf-t)`=160ms; only other duration is the sanctioned 1.6s live pulse. Hover states unchanged by this diff (`feed-dark-state-hover-*.png`) |
| 7 | Text contrast 4.5:1 minimum (both themes) | **PASS** | Compact-card label/value tokens remap to foreground under the 0.72/0.82 dims (~10:1 dark / ~9:1 light per FEED-CONTRAST notes); NEW compact-live label fix (item 2); all compact type ≥ the 10px floor (pick raised 10.7px → 13.9px) |
| 8 | Focus states visible (3px `--ring`) | **PASS** | `feed-dark-state-focus-visible.png` — 3px mint ring + fill on markets toggle; `.dmf-root` focus-visible box-shadow rule intact |
| 9 | `prefers-reduced-motion` respected | **PASS** | `feed-dark-state-reduced-motion.png` (static live dot, no transitions); reduced-motion blocks unchanged |
| 10 | Responsive: 375px, 768px, 1024px, 1440px; no horizontal scroll on mobile | **PASS** (with note) | run-report: `horizontalOverflow: false` in 30/30 AFTER shots at 375/1024/1280/1440/1680. 768 was not in this pass's viewport set (brief: desktop-first 1280/1440/1680 + regression 1024/375; tablet layouts out of scope). Card anatomy is card-width-keyed (container queries), and the 2-up band that 768-adjacent widths produce was verified at 1280 |
| 11 | Real `<button>`/`<a>` elements with ARIA roles for menus/tabs | **PASS** | Radix popover/dialog semantics unchanged; league headers native details/summary; NEW: per-card summary regions now carry distinguishable labels ("Model projection summary: Blue Jays at Astros") |

**Result: 11/11 pass** (item 3 scored per the 2026-07-24 supersede note; item 10
carries the 768-not-captured note above).
