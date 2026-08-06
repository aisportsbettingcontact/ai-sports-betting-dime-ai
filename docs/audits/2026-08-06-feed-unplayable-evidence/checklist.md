# MASTER.md Pre-Delivery Checklist — item by item

Scope: the diff on `fix/feed-unplayable-slate-rank` (slate tier + zero mint on
unplayable cards + the PR #409 evidence correction). Not a re-audit of the
surface.

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | Mint appears ONLY on signal (edges, picks, live, active nav, focus, coin-dot) | **PASS — and this is the item the diff exists to fix** | A postponed/suspended card with real edges previously rendered a full mint chip, rail, icon, arrow, and market cells. Measured in-browser after the change, both themes: chip colour, background, border, icon and arrow all non-mint; `box-shadow: none` (rail gone); popover signal cell and edge footer neutral. Control: the LIVE card still measures `rgb(69,224,168)` on its rail, so the rule does not over-reach. |
| 2 | `--mint-on-light` used for all mint text on light surfaces | **PASS (unchanged)** | The diff removes mint; it introduces none. Light-theme neutral values measured `rgb(0,0,0)` text on `rgba(0,0,0,0)` over the card. |
| 3 | Familjen Grotesk + IBM Plex Mono loaded; no legacy fonts | **PASS (n/a to the diff)** | No `font-family` touched. |
| 4 | All icons SVG (brand kit or Lucide); no emojis as icons | **PASS (n/a)** | No icon added; the existing Lucide `TrendingUp` only changes colour. |
| 5 | `cursor-pointer` on all clickable elements | **PASS (n/a)** | No interactive element added or removed. `.summary__next` keeps `cursor: pointer`. |
| 6 | Hover states use the 160ms brand curve | **PASS (unchanged)** | The `.summary__next` transition declaration is untouched — see `motion-review.md`. Only the resting colour differs on an unplayable card. |
| 7 | Text contrast 4.5:1 minimum (both themes) | **PASS for the diff** | The neutralized values are the tokens PASS cards already use: `--text-secondary` remapped to `--foreground` under `--compact`, measured `rgb(255,255,255)` dark / `rgb(0,0,0)` light on the card ground — higher contrast than the mint they replace. Separately, this PR **corrects** the wrong light-theme LIVE figure published by #409 (4.62 → 4.4969, a pre-existing 0.003 AA miss); see `summary.md`. |
| 8 | Focus states visible (3px `--ring`) | **PASS (unchanged)** | `.projection-card .summary__next:focus-visible` outline is untouched; the new rule sets `color` and `box-shadow` only, and focus rides `outline`. |
| 9 | `prefers-reduced-motion` respected | **PASS (unchanged)** | Reduced-motion block untouched; no motion added. |
| 10 | Responsive: 375/768/1024/1440; no horizontal scroll | **PASS** | No layout property changed — the diff alters colour and DOM order only. Card geometry is identical; the 1440 render shows no overflow. |
| 11 | Real `<button>`/`<a>` with ARIA roles | **PASS (unchanged)** | No role or accessible name changed. The card name still opens with the lifecycle state, so the visual (grey) and the announcement (POSTPONED, then the edge) continue to agree. |

**Checklist: 11/11 pass.**

## Delivery gate

`references/evidence-bundle.md`: *"owner visual sign-off remains the merge gate
for brand-surface changes (merge to main IS a production deploy)."*

**Satisfied for the brand-law amendment.** The owner approved and authorized the
2026-08-06 directive on 2026-08-06. Recorded in three places so it cannot be
lost: the directive heading (`— owner-approved`) and its blockquote in
`design-system/dime-ai/pages/ai-model-projections.md`, the banner in
[`summary.md`](./summary.md), and PR #413. A regression test pins the
authorization text and its scope fence
(`ProjectionCard.test.ts` → "records the directive in the page law"), so
deleting the approval or quietly widening it fails the suite.

Scope: the directive's four bullets only. The two items in "Known issues NOT
addressed here" below are explicitly outside it.

## Detector

3 warnings, all `side-tab`, all pre-existing: `EdgeIndicator.css:18`,
`ProjectionCard.css:977`, `ProjectionCard.css:1198`. The two ProjectionCard line
numbers shifted only because this diff adds comment lines above them; the rule
bodies are untouched, and the diff introduces no `border-inline-start` or inset
stripe of its own.

## Known issues NOT addressed here

1. **Light-theme LIVE status at 4.4969:1** — pre-existing, documented and
   quantified by this PR with a computed remedy (`color-mix` 60% → 50% gives
   ≈4.96:1). Not applied: brand-token change on a governed surface is owner
   territory.
2. **Salience inversion** — `--compact`'s `--text-secondary → --foreground`
   remap still makes settled states the brightest text in the status slot.
   Resolving it means revisiting the lifecycle-compaction dim, also owner
   territory. Logged in the page law under the 2026-08-05 directive.
3. **`mlbScoreRefresh.ts:103`** still comments that postponed/suspended are
   "hidden from feed". `games.list` applies no such filter — the comment is
   stale. Left alone: not raised in this PR's scope.
