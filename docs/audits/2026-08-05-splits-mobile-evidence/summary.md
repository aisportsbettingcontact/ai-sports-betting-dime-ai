# Splits mobile refinement — evidence bundle (2026-08-05)

**Surface:** Betting Splits + Odds History, MOBILE presentation (<768px) —
`BettingSplits.tsx`, `GameCard.tsx` (mode="splits" mobile path),
`BettingSplitsPanel.tsx`, `OddsHistoryPanel.tsx`,
`splits-interactions.css`, `dime-mobile.css`.
**Change class:** refine (thumb-first pass; not a redesign).
**Branch:** `feat/splits-mobile-refine`. Authored stacked on
`feat/splits-desktop-refine` (PR #367); the owner merged #367 to `main`
mid-pass (2026-08-05 13:15Z), so this branch was rebased onto `main` and
targets it directly. The desktop fixes (bar-label integrity, light-theme
repairs, token wraps, freshness stamp) are inherited from `main`.
**Brief:** `brief.yaml`. **Lead:** impeccable. **Advisors (read-only):**
ui-ux-pro-max (terminal-only), emil-design-eng (touch press craft),
frontend-design, review-animations (gate NOT triggered — motion-review.md).

Captured under TRUE mobile emulation (iPhone UA + touch + DPR2). Critique
ran as two isolated sub-agents (Assessment A design review over the before
set; Assessment B detector + mechanical greps), synthesized with DOM probes.

## What changed (one batched fix round + one confirm fix)

| # | Fix | Where |
|---|---|---|
| 1 | **P0 — the home half of every bar was amputated.** The frozen matchup column floored at 148px and the splits scroll pane carried a fixed 220px (CSS) / 260px (inline) inner minimum — on a 320–390px card the pane silently overflowed behind an unindicated `overflow-x:auto`, pushing every HOME percentage off-screen. Frozen column now floors at 118px; the pane sheds its fixed minimums (`min-width: 0 !important` beats the inline 260) — both bar halves fit the real pane width at 320–430, with the bars' own `max-content` label guarantee intact | `dime-mobile.css` phone block |
| 2 | **Keyboard-unreachable panes.** The splits scroll container and the history-table scroll pane were plain divs — their off-screen content was untabbable. Both are now focusable named groups (`tabIndex=0`, `role="group"`, aria-labels) with `scrollbar-width: thin` as the affordance (gradient fades are banned) | `GameCard.tsx`, `OddsHistoryPanel.tsx`, `splits-interactions.css` |
| 3 | **Vocabulary drift on phones:** mobile bars said MONEY where desktop + history say HANDLE; the third market chip clipped to "MONEYLIN" at 375–390. Bars now say HANDLE; the mobile chip label is ML; phone chip tracking trimmed to 0.03em; bar headers carry team abbreviations (`awayAbbr`/`homeAbbr` passed to the panel), matching the history tables | `BettingSplitsPanel.tsx`, `GameCard.tsx`, `splits-interactions.css` |
| 4 | **History table density:** desktop clamp padding → 4px cells on phones; the TIME column may wrap to two lines (`white-space: normal`, ~3.6rem max) instead of forcing the table wider | `splits-interactions.css` phone tier |
| 5 | **Card grouping:** a game's history card tucks flush under its game card (−6px overlap, squared inner corners via `:has()` + adjacent-sibling rules); distinct games keep the full floating-card rhythm | `dime-mobile.css` phone block |
| 6 | **Sticky-chrome seam:** the transparent 8px breathing gap between the floating nav and the pinned filter header let scrolled card fragments glint through — covered with page ground (`.bs-header::before`) | `dime-mobile.css` phone block |
| 7 | **Touch floors:** history disclosure row `min-height: 44px`; favorite star gains an invisible −6px hit extension (visual size unchanged) | `splits-interactions.css` |
| 8 | **LIVE dot 7px** (was 5px on the pill variant and 4px `w-1` on the mobile header variant — both now 7px; the confirm-round probe caught the second instance) | `GameCard.tsx` |
| 9 | Orphaned "·" separator no longer strands on its own line when the date header wraps (hidden <768; the gap separates the labels) | `splits-interactions.css` |
| 10 | `pages/betting-splits.md` proposal (owner territory, PROPOSED status) gains a dated **Mobile addendum** + OPEN DECISION 4 (mobile freshness-stamp home) | `design-system/dime-ai/pages/betting-splits.md` |

## Rendered proof (AFTER — `run-report.json` in the shots archive)

- 22 shots: dark 320/375/390/430 + light 375/390, states (history open ×2,
  hover, press, focus-visible, star hover, empty, loading, reduced-motion).
  **Zero horizontal overflow in all 22.**
- DOM probes (`measure-mobile.mjs`) at 320/375/390: splits panes
  `scrollWidth == clientWidth` (amputation gone) with `tabindex=0`; grid
  first column 128/150/156px; chips SPREAD/TOTAL/ML all unclipped; HANDLE
  present, no bare MONEY; abbr headers ("NYY (+1.5) … BOS (-1.5)"); star
  `position:relative` + `::after inset:-6px`; orphan dot `display:none`;
  seam strip present (8px, nav active); `.ohp-toggle` min-height 44px;
  history th padding 4px, TIME `white-space:normal`, pane `tabindex=0`,
  `scrollbar-width: thin`; card pair `-6px`/0-radius both sides.
- Console: only the capture environment's blocked-CDN noise; no app errors.
- Smoke: `smoke.txt` — 8/8 against the production boot on :3912.
- Detector: `impeccable-detect.json` — 3 findings, all the known `side-tab`
  warning (the mint signal stripe; same disposition as the desktop bundle).
- Motion gate: `motion-review.md` — **not triggered** (zero motion-keyword
  lines in the diff); the desktop Approve stands.

## Screenshots

PNGs are not committed (repo law). Before/after pairs are embedded on the
PR's artifact page; raw sets in the session capture archive
(`evidence/splitsm/{before,after}`).

## Deferred (documented, intentionally not done)

- Mint side-encoding semantics — OPEN DECISION 1 (owner call, unchanged).
- History change-marking / day boundaries — OPEN DECISION 2.
- Mobile freshness-stamp home — OPEN DECISION 4 (new, this pass).
- GameCard vw/inline-style token migration (known debt in the proposal).
- Tickets-vs-handle explainer for touch (title-tooltips are dead on touch —
  recorded in the proposal's known debt).
