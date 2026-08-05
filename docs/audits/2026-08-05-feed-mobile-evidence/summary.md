# Feed mobile refinement — evidence bundle (2026-08-05)

**Surface:** AI Model Projections feed, MOBILE presentation (<768px) —
`client/src/pages/DimeModelFeed.tsx` + `dimeModelFeed.css` +
`client/src/components/projections/*`.
**Change class:** refine (thumb-first pass; not a redesign).
**Branch:** `feat/feed-mobile-refine`. Authored stacked on
`feat/feed-desktop-refine` (PR #365); the owner merged #365 to `main`
mid-pass (2026-08-05 12:02Z), so this branch was rebased onto `main` and
targets it directly. The desktop fixes (content-box tier correction, readout
lanes, pick size, message clip, region labels, skeleton grid) are inherited
from `main`, not re-implemented.
**Brief:** `brief.yaml` (this directory). **Lead:** impeccable.
**Advisors (read-only):** ui-ux-pro-max (terminal-only), emil-design-eng
(touch press craft), frontend-design (distinctiveness bar),
review-animations (gate TRIGGERED — Approve, see motion-review.md).

Captured under TRUE mobile emulation — iPhone UA + touch + DPR2, which
activates the app's `--vp` viewport-scaling engine — unlike prior
narrowed-desktop-window checks. Critique ran as two isolated sub-agents
(Assessment A design review over the 22-shot before set; Assessment B
detector + mechanical greps), synthesized with DOM probes.

## What changed (one batched fix round; one confirm probe, no fixes needed)

| # | Fix | Where |
|---|---|---|
| 1 | League header (the surface's namesake row) rendered truncated at 3 of 4 captured widths. Three phone reduction tiers (<480, <360, <330: gap/padding/type/tracking/logo scale down together) — "MAJOR LEAGUE BASEBALL (MLB)" now renders complete at 320/375/390/430 | `dimeModelFeed.css` |
| 2 | PASS-card law and the LIVE indicator applied only ≥768px — a phone PASS card kept full opacity + mint, and LIVE cards had no dot. The PASS dim (0.82, zero-mint), mint token remap, live-dot activation, and LIVE tracking are now unconditional (2026-08-05 supersession of the Round-4 item-8 scoping; the 24px live-score rule keeps its ≥768 gate) | `ProjectionCard.css` |
| 3 | Summary readout label/value baselines staggered per column (the A-review's "one unfinished seam" — the facts block read as auto-layout output). Compact readout items now share a two-row **subgrid** (`@supports` guarded): every MODEL EDGE / BOOK / MODEL label sits on one baseline, values on another | `ProjectionCard.css` ≤472 tier |
| 4 | Contract pins: the "scoped inside the same ≥768px block" test replaced with an every-breakpoint assertion for items 3–4 (dated rationale comments) | `ProjectionCard.test.ts` |

## Rendered proof (AFTER — `run-report.json` in the shots archive)

- 22 shots: dark 320/375/390/430 + light 375/390 (viewport + full/pane-scroll),
  states (hover, press, focus-visible, popover, lineups dialog, empty,
  loading, reduced-motion). **Zero horizontal overflow in all 22.**
- DOM probes (`measure-mobile.mjs`): league header unclipped at all 4 widths;
  PASS card computed opacity **0.82**; live dot `inline-block`, 7px,
  `projection-card-live-pulse` running at every mobile width; readout
  `summary__item` rows resolve to **subgrid** with dt baselines equal to the
  pixel at 320/375/390/430.
- **Desktop non-regression** probed at 1440: first row 3-up, PASS 0.82,
  live dot + pulse intact, no overflow.
- Console: only the capture environment's blocked-CDN noise (Google Fonts
  `ERR_CONNECTION_RESET`, aborted external media `ERR_FAILED`) — same set as
  the BEFORE run; no app errors.
- Smoke: `smoke.txt` — 8/8 against the production boot on :3911.
- Detector: `impeccable-detect.json` — 3 findings, all the known `side-tab`
  warning on the mint signal stripe, which pages/ai-model-projections.md
  legislates (same disposition as the desktop bundle). No new findings.
- Motion gate: `motion-review.md` — **Approve** (live-pulse scope extension;
  reduced-motion collapse verified at every breakpoint).

## Screenshots

PNG evidence is not committed (repo law: `docs/audits/*-evidence/screenshots/`
is gitignored). Before/after pairs are embedded on the PR's artifact page;
raw sets live in the session capture archive (`evidence/feedm/{before,after}`).

## Deferred (documented, intentionally not done in this pass)

- Popover max-width at 320 (usable; slightly tight) — needs a component hook.
- The `--vp` engine's 0.81 clamp floor leaves 320 slightly denser than the
  law's ideal reading size; changing the engine is out of scope.
- Light-theme league-bar logo treatment variance (licensed-asset exemption).
