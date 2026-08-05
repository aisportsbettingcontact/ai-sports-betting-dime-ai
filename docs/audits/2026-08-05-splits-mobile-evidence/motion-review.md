# review-animations gate — splits mobile refinement (2026-08-05)

**Gate trigger:** NO — audited the full diff
(`git diff feat/splits-desktop-refine` across GameCard.tsx,
BettingSplitsPanel.tsx, OddsHistoryPanel.tsx, splits-interactions.css,
dime-mobile.css): zero added/removed/edited lines containing `transition`,
`animation`, `transform`, `@keyframes`, or motion tokens
(`--dime-t` / `--dime-ease`).

The changes are vocabulary (HANDLE / ML), layout floors
(frozen-column clamp, scroll-pane minimums, cell padding), a11y
(focusable named scroll panes, 44px hit floors), static chrome
(seam cover, card-pair radii), and a 5px→7px LIVE-dot size — none of which
alters any animation or transition the desktop pass already gated.

The desktop-pass verdict for this surface's motion layer
(`docs/audits/2026-08-05-splits-desktop-evidence/motion-review.md`:
**Approve** — 160ms brand curve on box-shadow/outline, press settle,
reduced-motion kills) carries over unchanged.

## Verdict: **Not triggered** (desktop Approve stands)
