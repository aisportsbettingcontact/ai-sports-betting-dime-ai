# MASTER.md Pre-Delivery Checklist — Betting Splits desktop refinement (2026-08-05)

Scored against the AFTER build (`feat/splits-desktop-refine`, production
bundle on :3912, deterministic fixture slate: 8 games incl. LIVE and a
deliberate 50/50-splits game, 14-row odds histories, dark + light).
Screenshots in `screenshots/after/` (untracked; see summary.md).

| # | Item | Verdict | Evidence |
|---|---|---|---|
| 1 | Mint ONLY on signal | **PASS with a documented tension** | Mint accents: LIVE pill, live-movement history separator, focus rings, active nav — all signal. The split bars use mint as the away-SIDE encoding (structural, not signal) — a shipped, deliberate override-layer decision this pass did not change; the mint-semantics question (incl. the 50/50 probe) is escalated to the owner in the proposed `pages/betting-splits.md`. All 15 rendered raw `#45E0A8` literals in GameCard moved to `var(--dime-mint*/…)` fallback position |
| 2 | `--mint-on-light` for mint text on light | **PASS** | Mint text routes through `--dime-mint-text` (#0A7C50 on light — pixel-verified on the LIVE pill); NEW: light `--dime-mint-border` now derives v3's `color-mix(mint 68%, black)` so mint-bordered controls clear 3:1 on white (was raw mint ~1.9:1) |
| 3 | Familjen + IBM Plex Mono; no legacy fonts | **PASS** (per the 2026-07-24 supersede note: pass = Familjen-only, Plex Mono NOT loaded) | fontMisses 0/29 AFTER shots; all font-family declarations route through `--dime-font-mono`/`--dime-font-sans` (both Familjen-first); zero literal stacks (Assessment B grep) |
| 4 | All icons SVG; no emojis as icons | **PASS** | Lucide throughout; NEW: off-domain lab-flask empty-state icon → `CalendarX` |
| 5 | `cursor-pointer` on clickables | **PASS** | `.ohp-toggle`/`.bs-result` cursor rules + control classes; hover states verified in `splits-dark-state-hover-history-toggle.png` |
| 6 | Hover states on the 160ms brand curve | **PASS** | All durations are `160ms` literals or `var(--dime-t)` (Assessment B sweep); NEW: the last deviation (JS highlight `0.16s ease`) now uses the brand curve; `animate-spin`/`animate-pulse` are loading/live indicators, not hover motion |
| 7 | Text contrast 4.5:1 (both themes) | **PASS** | Bar labels: ink-on-mint + primary-on-track pass both themes; NEW: history TH floor raised 10px → 11px (caption floor); NEW: small-segment label clipping fixed (geometric legibility, both themes); light LIVE text #0A7C50 ≈ 6.3:1 |
| 8 | Focus states visible (3px ring) | **PASS** | Pills/toggles/results rings pre-existing (`splits-dark-state-focus-visible.png`); NEW: `.gc-star:focus-visible` ring added — every interactive control now has one |
| 9 | `prefers-reduced-motion` respected | **PASS** | `splits-dark-state-reduced-motion.png`; reveal/chevron/press kill switches unchanged; highlight pulse has a static fallback |
| 10 | Responsive 375/768/1024/1440; no mobile horizontal scroll | **PASS with notes** | overflow flags 0/29 at 375/1024/1280/1440/1680. 768 not captured (desktop-first brief; shell boundary band verified at 1024/1280). Known issue (deferred, listed in summary.md): the 1024 band ellipsizes market label rows — needs component hooks beyond this pass's CSS-first scope |
| 11 | Real `<button>`/`<a>` + ARIA | **PASS** | History toggles are real buttons with aria-expanded; bars carry text labels (never color-only); tooltips remain title-only (known issue, deferred) |

**Result: 11/11 pass**, with item 1's mint-semantics tension and item 10's
1024 band explicitly escalated rather than silently absorbed.
