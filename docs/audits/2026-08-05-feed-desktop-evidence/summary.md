# Feed desktop refinement — evidence bundle (2026-08-05)

**Surface:** AI Model Projections feed (`/feed/model/mlb-MM-DD-YYYY`) —
`client/src/pages/DimeModelFeed.tsx` + `client/src/components/projections/*`.
**Change class:** refine (desktop-first product-UI pass; not a redesign).
**Branch:** `feat/feed-desktop-refine` off `main` (6b4a5c3).
**Brief:** `brief.yaml` (this directory).
**Lead:** impeccable. **Advisors (read-only):** ui-ux-pro-max (terminal-only
research — generic output, law retained), emil-design-eng (hover/press
decision, see motion-review.md), frontend-design (distinctiveness bar),
review-animations (gate not triggered — motion-review.md).
Critique ran as two isolated sub-agents per the impeccable critique
invariants (Assessment A design review; Assessment B deterministic detector +
mechanical greps), synthesized with in-browser DOM measurements.

## Root cause of the visible defects

**Size container queries resolve against the container's CONTENT box; the
compact-tier queries were authored in border-box card widths.** The card's own
chrome (2 × clamp(14–24px) padding + 2 × 1px border ≈ −50px on desktop) meant
every tier fired on cards ~50px wider than its stated intent — so the
"defensive, not a live band" ≤280px tier was live on every standard 3-up
desktop card (318px border-box ≈ 268px content). Its 3-track pregame template
collided with the ≤520 tier's 2-column placements: the home pitcher rendered
inside the 48px center track.

## What changed (one batched fix round; no confirm round needed)

| # | Fix | Where |
|---|---|---|
| 1 | Tier queries re-derived to content-box: 520→472, 310→270, 280→246 (semantics unchanged — the law's card-width bands now actually correspond) | ProjectionCard.css (all `@container projcard` tiers) |
| 2 | Compact readout: BOOK/MODEL lanes `2.125rem` fixed → `minmax(2.75rem, max-content)`; column-gap 4px → 8px. Kills the "+118+102" price fusion (highest-stakes defect: misread prices on a betting surface) | ProjectionCard.css ≤472 tiers |
| 3 | Hierarchy: compact pick ("ASTROS -1.5") raised 0.625rem → 0.8125rem — the model's claim no longer renders smaller than its supporting odds | ProjectionCard.css ≤472 tier |
| 4 | FINAL/PASS no-action sentence unclipped: `.summary__item--message` opts out of the `max-content` floor (`min-inline-size: 0`, `safe center`, centered wrap) — was clipped mid-word at both ends | ProjectionCard.css |
| 5 | Pregame panel top-aligned (`align-items: start`) so EXPECTED/CONFIRMED share a baseline when column heights differ | ProjectionCard.css ≤472 tier |
| 6 | Dimmed compact LIVE label on light: same-hue `color-mix` darkening clears AA (3.1:1 → ~4.8:1 composited at 0.72 over white) | ProjectionCard.css |
| 7 | Token law: the two remaining raw `#45e0a8` literals moved to `var(--brand-mint, #45e0a8)` (pagination active border, table signal stripe) | ProjectionCard.css |
| 8 | A11y: per-card summary regions labeled with the matchup ("Model projection summary: Blue Jays at Astros") — a full slate no longer lists N identical rotor entries | ProjectionSummary.tsx |
| 9 | Loading parity (DIME-UI-019 completion): skeletons render inside the same `.dmf-league`/`.dmf-leaguebody` containers as the loaded slate — loading no longer reflows 1-col → 3-up on resolve | DimeModelFeed.tsx |
| 10 | Contract pins in ProjectionCard.test.ts updated to the new tier values / tracks / labels (each with a dated rationale comment) | ProjectionCard.test.ts |

Preserved untouched: tRPC wiring + data contract (games.list exact input,
ETag/304, 60s poll, placeholderData), analytics emits, favorites, AgeModal/auth
gating, sonner, mobile nav config, all motion (zero transition/animation/
transform lines changed), mint rationing, PASS 0.82 / lifecycle 0.72 semantics,
container-driven league columns (no viewport media query added).

## Gates

| Gate | Result | File |
|---|---|---|
| `npx tsc --noEmit` | exit 0 | typecheck-tests.txt |
| Vitest (projections + dimeModelFeed + doubleheader + feedRoutes) | 7 files, 144 tests, all pass | typecheck-tests.txt |
| Production build + boot + smoke (`:3911`) | 8/8 checks pass | smoke.txt |
| impeccable detector (projections dir + page tsx + page css) | 3 findings, all pre-existing and dispositioned below; **0 introduced** | impeccable-detect.json |
| review-animations | **not triggered** (no motion lines in diff) — determination + advisor decision recorded | motion-review.md |
| MASTER.md Pre-Delivery Checklist | 11/11 pass (Plex Mono item per the 2026-07-24 supersede note) | checklist.md |
| Rendered proof | 30 BEFORE + 30 AFTER shots: 5 widths × dark/light, hover/press/focus-visible/popover/lineups-dialog/reduced-motion/empty/loading; overflow flags 0/30; app console errors 0; webfont loaded 30/30 | screenshots/ |

### Detector findings disposition (all 3 pre-existing, unchanged by this diff)

`side-tab` on EdgeIndicator.css:18, ProjectionCard.css (compact rail width,
table signal stripe): these are the owner-endorsed **mint rail** — the Law v3
accessible mint-cell signature ("the one mint rail") and its compact/table
variants, not a generic card side-tab. Accepted by design; not modified.

## Screenshot evidence

`screenshots/before/` (main @ 6b4a5c3) and `screenshots/after/` (this branch),
same deterministic fixture slate, same harness — pixel-comparable pairs.
**Untracked** per the PNG law (`docs/audits/*-evidence/screenshots/` is
gitignored); key pairs are embedded in the PR body via the published evidence
page and delivered to the owner in-session. Environment note: the container
blocks the logo/headshot CDNs, so team crests render as deterministic
monogram-disc stand-ins (team colors — the logo exception) and pitcher photos
as the shipped initials fallback, identically in both phases; Familjen
Grotesk loads for real in every shot.

## Known issues / deferred (listed, not polished open-endedly)

1. Compact tiers hard-code rem sizes; TYPOGRAPHY.md prefers tokens — propose
   `--proj-compact-label`/`--proj-compact-value` in type-system.css as a
   follow-up (global stylesheet; out of this pass's blast radius).
2. `summary__viewport` is tabbable on every card; a follow-up could set
   `tabIndex=0` only when the viewport actually overflows (needs a resize
   observer; deferred to keep the diff CSS-first).
3. Popover pagination is numeric ("1 2 3"); the active market name lives in
   the table caption, so recognition survives — a labeled counter is a
   possible future copy change (owner call).
4. "SYNCED N MIN AGO" is hidden in the desktop shell by the 2026-07-21
   desktop-emphasis directive — flagged by the design review, deliberately
   not touched (owner territory).
5. 375px note: the ≤310-intent tier no longer fires at 375 (it fired there
   only via the same content-box drift), so the LINEUPS chip returns to the
   documented overlay position on phones — this *restores* the written law
   ("the ≤310px-card tier…"); 375 before/after pairs included for the owner
   to confirm no regression is perceived.

**Merge gate:** owner visual sign-off. Do not merge without it — merge to
`main` is a production deploy.
