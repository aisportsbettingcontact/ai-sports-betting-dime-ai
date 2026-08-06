# Feed — unplayable games: slate tier + mint rationing

**Branch:** `fix/feed-unplayable-slate-rank` · **Date:** 2026-08-06 · **Surface:** `/feed`
**Lead:** `impeccable` v4.0.4 (pin `ae5e951`) · **Brief:** [`brief.yaml`](./brief.yaml)

Closes the two findings the post-deploy audit of PR #409 reported and
deliberately left open, because both were explicit non-goals of that change.
Also corrects a wrong contrast figure that PR published.

## The two defects

1. **Dead games outranked bettable ones.** `slateStatusRank` returned `0` for
   live, `2` for a `timeLabel` starting `"FINAL"`, and `1` for *everything
   else* — so postponed and suspended fell into the **upcoming** tier and sorted
   by their original first pitch. On the audited slate they held DOM positions
   2 and 3 of 5 at every breakpoint, above the only card a user could act on.
2. **A postponed game kept a full mint `EDGE +8.2%` chip.** `isPass` only
   neutralized mint when there were *no* edges, and a postponed game can carry
   real ones. The result: a mint accent — the product's single signal colour —
   sitting 100px under a POSTPONED header, with the strongest visual claim on
   the card arguing against the strongest textual one. MASTER.md is explicit:
   *"if it isn't signal (edge/pick/live/active), it isn't mint."*

## The change

**`unplayable` is a new named state (`postponed | suspended`), deliberately NOT
folded into `isPass`.** They look alike and mean opposite things — PASS is
"nothing worth acting on in a game that WILL be played"; unplayable is "the game
is not available to act on, whatever the model found". Separate modifiers
(`--pass`, `--unplayable`) share one set of neutralizing rules by joining their
selector lists, so there is one treatment and two truthful names.

| | Before | After |
|---|---|---|
| slate tier of postponed/suspended | 1 (upcoming) | 2 (settled) |
| tier derivation | `timeLabel.startsWith("FINAL")` | `Record<GameStatus, number>` |
| mint on an unplayable card with edges | full chip, rail, icon, arrow, market cells | all neutral grey |
| edge content on an unplayable card | shown | **still shown**, unchanged |

`Record<GameStatus, number>` is the substantive part of fix 1: the old string
sniff could only ever recognize the states it was written for, which is exactly
how postponed and suspended defaulted into the wrong tier. A new lifecycle
member now fails the typecheck instead of silently mis-tiering.

The popover takes its own `isUnplayable` prop because it portals to a floating
surface **outside** `.projection-card` — verified in-browser
(`isDescendantOfCard: false`), so no descendant selector could have reached it.

## Scope discipline

The edge **content** stays: readout, pick, percentage, market tables, popover
trigger all still render. Removing the information is a product decision;
removing the accent is brand-law enforcement, and only the second is in scope.
Accessible names are untouched and remain truthful — the card's own name already
opens "…, POSTPONED" (directive 2026-08-05), so the announcement and the visual
still agree.

## Correction to the PR #409 evidence

That bundle recorded light-theme LIVE at **4.62:1** and item 7 as a clean pass.
The real figure is **4.4969:1** — 0.003 *below* the AA floor for normal text.
The error was the compositing model: `opacity: 0.72` composites the card layer
over the **page**, so page white bleeds into the text as well as the background;
the original pass composited the text over the already-dimmed card instead.

Corrected in **four** places, not the two originally identified — the same wrong
number had propagated into the governing law and a CSS comment:

| File | What was wrong |
|---|---|
| `docs/audits/2026-08-05-…/checklist.md` | item 7 marked a clean pass; full derivation + re-measured 10-row table now filed as a dated CORRECTION section |
| `docs/audits/2026-08-05-…/summary.md` | correction banner at the top |
| `design-system/dime-ai/pages/ai-model-projections.md` | the 2026-08-05 directive quoted the wrong ratios |
| `client/src/components/projections/ProjectionCard.css` | two comments, including one that claimed the `color-mix` "clears 4.5:1" — **it does not**, and that comment predates #409 |

**The miss is pre-existing.** The three rules that produce it are byte-identical
before and after #409, which changed no colour and no opacity. A computed remedy
is recorded but **not applied**: deepening the mix from 60% to 50% gives
`rgb(75,116,100)` ≈ **4.96:1**. That is a brand-token change on a governed
surface — owner territory, and outside this PR's scope.

## Gates

| Gate | Result |
|---|---|
| TDD | 9 assertions written **red first**, then green. No test deleted. |
| `npx tsc --noEmit` | clean — [`typecheck-tests.txt`](./typecheck-tests.txt) |
| `npx prettier --check` | clean — same file |
| `npx vitest run client/src` | **791/791**, 55 files — same file |
| `verify` skill: build + boot + smoke | **10/10** — [`smoke.txt`](./smoke.txt) |
| Rendered proof (both themes) | **all checks passed** — [`rendered-proof.txt`](./rendered-proof.txt) |
| impeccable detector | 3 warnings, **0 attributable to this diff** — [`impeccable-detect.json`](./impeccable-detect.json) |
| review-animations motion gate | **did not fire** — [`motion-review.md`](./motion-review.md) |
| MASTER.md Pre-Delivery Checklist | **11/11** — [`checklist.md`](./checklist.md) |

## Rendered proof

Production build, booted locally, driven with Playwright. The fixture gives every
game the same priced markets **on purpose**: without real edges on the postponed
and suspended cards the mint rule would be vacuously satisfied and the test
would prove nothing. Both cards do carry an `Edge +8.2%` chip — asserted
explicitly before the colour is checked.

```
[dark]  DOM order: live → scheduled → postponed → suspended → final
[light] DOM order: live → scheduled → postponed → suspended → final
  PASS  scheduled ranks ABOVE postponed  — scheduled@1 postponed@2
  PASS  scheduled ranks ABOVE suspended  — scheduled@1 suspended@3
  PASS  postponed genuinely has an edge chip  — Edge+8.2%
  PASS  postponed chip color/background/border/icon/arrow are not mint
  PASS  postponed chip has no mint rail shadow  — none
  PASS  postponed does NOT carry --pass (distinct meanings)
  PASS  live card is never unplayable
  PASS  live card KEEPS its mint rail  — rgb(69, 224, 168)
  PASS  popover really does portal outside the card
  PASS  popover signal cell / edge footer are neutral
ALL CHECKS PASSED
```

The live-card control is deliberate: a rule that neutralizes mint must be shown
**not** to over-reach. It doesn't — live keeps `rgb(69,224,168)`.

### A caught false pass, recorded

The first run of the harness reported the live control as FAILING. The product
was correct; the *matcher* was wrong — I had written the mint pattern as
`45, 224, 168`, using the hex digits of `#45E0A8` where the browser reports
decimal `rgb(69, 224, 168)` (`0x45` = 69). Every "is not mint" assertion had
therefore been passing vacuously. The matcher is fixed and now carries a
self-check that throws if it ever stops recognizing the token it exists to
catch. The numbers above are from the corrected run.

## Non-goals, untouched

Card ordering **within** a tier (first pitch ascending, stable sort), PASS
semantics for genuinely no-edge games, the edge content itself, the popover's
pagination, the summary carousel, and the lifecycle-compaction opacity.
