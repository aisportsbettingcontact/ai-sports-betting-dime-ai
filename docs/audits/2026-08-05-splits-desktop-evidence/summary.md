# Betting Splits desktop refinement — evidence bundle (2026-08-05)

**Surface:** Betting Splits + Odds History (`/betting-splits/:sport`, canonical
via `bettingSplitsPath`) — `client/src/pages/BettingSplits.tsx`,
`client/src/components/GameCard.tsx` (mode="splits"), `BettingSplitsPanel.tsx`,
`OddsHistoryPanel.tsx`, `client/src/styles/splits-interactions.css`.
**Change class:** refine (desktop-first; CSS-first with three surgical
component touches). **Branch:** `feat/splits-desktop-refine` off `main`
(6b4a5c3). **Brief:** `brief.yaml`.
**Law:** MASTER.md + THREE-COLOR-LAW (no pages/ override exists — this PR
*proposes* one: `design-system/dime-ai/pages/betting-splits.md`, owner
territory, dated decision note inside).
**Lead:** impeccable. **Advisors (read-only):** ui-ux-pro-max (terminal-only),
emil-design-eng (hover/press restraint — no motion added),
frontend-design (distinctiveness bar), review-animations (gate RAN —
**Approve**, see motion-review.md). Critique ran as two isolated sub-agents
(design review; detector + mechanical greps), synthesized with in-browser DOM
measurement in both themes.

## What changed (one batched fix round; no confirm round needed)

| # | Fix | Where |
|---|---|---|
| 1 | **Small-segment label clipping** (P0): the shipped 46/54px segment minimums went stale once the vw-scaled label font hit its 17px cap (≥1417px viewports) — small percentages clipped their leading digit against the segment's own `overflow:hidden` ("13%" could scan as "3%"). `min-width: max-content` + a 15px label ceiling; the printed number stays the truth, the bar stays indicative | splits-interactions.css |
| 2 | **Light theme erased team identity** (P1): the dark-tuned crest recipe (`mix-blend-mode: screen` + brightness lift) resolves to white-on-white — crests and search badges vanished on light. Neutralized on light via the layer's existing attribute-selector pattern (licensed-logo exception: art renders as-authored) | splits-interactions.css |
| 3 | **Light mint borders dissolved**: raw mint on white ≈ 1.9:1; the light `--dime-mint-border` now derives THREE-COLOR-LAW v3's `color-mix(mint 68%, black)` (≈#2F9872, ≥3:1) — LIVE pill, live-movement separators, edge-cell borders regain their shape. Expressed via color-mix from the token (X-HEX ratchet: zero new raw hex) | dime-mobile.css |
| 4 | **Token law**: all 15 rendered raw `#45E0A8` literals in GameCard's splits path wrapped in `var(--dime-mint*/…, #45E0A8)` (text → `--dime-mint-text`, borders → `--dime-mint-border`, fills → `--dime-mint`) — identical on dark, theme-correct on light | GameCard.tsx |
| 5 | **Freshness stamp**: `splitsAgoLabel` was computed but never rendered — "SPLITS SYNCED N MIN AGO" mono micro-label now sits in the date header (desktop), the sibling projections law's "SYNCED" analog | BettingSplits.tsx |
| 6 | **History scan hierarchy**: TH floor 10px → 11px (caption floor); SPREAD/TOTAL/MONEYLINE section labels 11px/500 secondary → 12px/600 body ink (the page's largest structural boundaries were its quietest text) | OddsHistoryPanel.tsx |
| 7 | **Duplicate wordmark**: the standalone pane wordmark now hides at every shell viewport (≥768px), not just 768–1023 — one brand mark per screen | dime-mobile.css |
| 8 | **A11y**: `.gc-star` favorite gains the standard 3px mint focus ring (was the one control without one) | splits-interactions.css |
| 9 | **Motion law**: the search-jump highlight's `0.16s ease` JS transition → `160ms cubic-bezier(0.16,1,0.3,1)` (the one brand curve) — gate verdict **Approve** | BettingSplits.tsx |
| 10 | Empty-state icon: off-domain lab flask → `CalendarX` | BettingSplits.tsx |

Preserved untouched: tRPC wiring, route canonicalization (`bettingSplitsPath` —
no hand-emitted slugs; `feedRoutes`/`routePattern` tests green), analytics,
AgeModal + auth gating, favorites behavior, sonner, mobile nav config, mobile
layouts (bar-label fixes benefit phones but no mobile-specific changes), the
bars' away=mint side-encoding (owner decision — see the proposal), team logo
art (licensed exemption).

## The three risks the brief named — findings

1. **GameCard vocabulary drift** (legacy inline styles, hard #FFF ink,
   text strokes, vw type vs the projections card's token language): real, but
   the sanctioned override layer already neutralizes it on the rendered
   surface; the residue (token-law literals) is fixed here (#4). Full
   migration is redesign-scale — codified as known debt in the proposed page
   law.
2. **Mint on every bar row**: mint is side-encoding here, not signal — a
   deliberate shipped structure, but a genuine tension with MASTER's
   rationing discipline, sharpest on the deliberate 50/50 fixture (half-mint
   bars that look like half-signals). Nothing destructive changed; the two
   compliant resolutions (mint-fills-majority vs away-legend) are laid out as
   **OPEN DECISION 1** in the proposed `pages/betting-splits.md`. The acute
   harm in this family — label clipping at small segments — is fixed (#1).
3. **History-table hierarchy vs TYPOGRAPHY.md**: fundamentally sound
   (tabular-nums, body-sm values, mono time column, zebra+hairline rhythm);
   deviations fixed (#6). Day-boundary and change-highlight enhancements are
   OPEN DECISION 2 in the proposal.

## Gates

| Gate | Result | File |
|---|---|---|
| `npx tsc --noEmit` | exit 0 | typecheck-tests.txt |
| Vitest full client suite | 55 files, **767/767 pass** (incl. the X-HEX ratchet, feedRoutes/routePattern route law, fontColorLaw) | typecheck-tests.txt |
| Production build + boot + smoke (`:3912`) | 8/8 | smoke.txt |
| impeccable detector (5 target files) | 2 findings, both pre-existing `side-tab` hits on the `data-edge-tier` model-edge stripe (state-encoding, not decoration — FP for this surface); **0 introduced** | impeccable-detect.json |
| review-animations | **Approve** (1 line strengthened toward the brand curve; pre-existing non-GPU pulse noted as known issue) | motion-review.md |
| MASTER Pre-Delivery Checklist | 11/11 (item 1 tension + item 10 band escalated explicitly) | checklist.md |
| Rendered proof | 30 BEFORE + 29 AFTER shots (5 widths × dark/light, expanded histories, hover/press/focus-visible/reduced-motion/empty/loading); overflow 0; app console errors 0; webfont 29/29 | screenshots/ |

## Known issues / deferred (listed, not polished open-endedly)

1. **1024–1279 band** ellipsizes market label rows (lines/odds lost) — needs
   component hooks + band CSS; OPEN DECISION 3 in the proposal.
2. Mint side-encoding semantics — OPEN DECISION 1 (owner).
3. History day-boundary + change-highlighting — OPEN DECISION 2 (owner).
4. TICKETS/HANDLE tooltips are title-only (keyboard/touch-invisible); the
   tickets-vs-handle insight is unexplained in-surface.
5. GameCard vw-clamp/inline-style migration (would retire much of the
   override layer's 43 `!important`s) — redesign-scale, known debt.
6. The highlight pulse animates box-shadow/outline (non-GPU) — rare one-shot,
   noted in motion-review.md.
7. "TOP 6" clock copy; zebra reuses `--dime-row-hover` as static fill.

**Screenshot policy:** untracked per the PNG law; key pairs embedded in the PR
evidence page and delivered in-session. Environment note: crest CDN blocked in
the capture container — crest slots exercise the fallback path in both phases
(which is precisely how the light-theme blend bug was caught).

**Merge gate:** owner visual sign-off; the `pages/betting-splits.md` proposal
additionally needs an explicit owner decision before it becomes law. Merge to
`main` IS a production deploy.
