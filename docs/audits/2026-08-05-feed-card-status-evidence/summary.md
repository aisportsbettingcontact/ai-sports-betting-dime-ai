# Feed gamecard — centered lifecycle status + pregame-only venue/time

**Branch:** `feat/feed-card-status-header` · **Date:** 2026-08-05 · **Surface:** `/feed` (AI Model Projections)
**Lead:** `impeccable` v4.0.4 (vendored, pin `ae5e951`) · **Advisors:** `ui-ux-pro-max` (research, terminal-only), impeccable critique Assessments A + B (isolated sub-agents)
**Brief:** [`brief.yaml`](./brief.yaml)

## What changed

1. **One status slot, centered, every state.** Every gamecard renders exactly one
   status line in the card header, horizontally centered, directly above the
   away/home matchup row: scheduled `9:40 PM ET` · live `LIVE · BOT 8TH` + the
   pulsing mint dot · final `FINAL` · postponed `POSTPONED` · suspended
   `SUSPENDED`. Previously the header existed only for live/final and was pinned
   top-right (`justify-content: flex-end`), where it read as an annotation on the
   HOME team; scheduled cards rendered no status element at all.
2. **Ballpark and first pitch are pregame-only.** Live, final, postponed and
   suspended cards render neither, anywhere. The shipped bug this closes: a card
   in the bottom of the 8th printed `Chase Field / 9:40 PM ET` — a first-pitch
   time three hours stale, directly under a live score. Scheduled cards keep the
   ballpark; their time now lives in the header and is not printed twice.
3. **`suspended` is a first-class lifecycle state**, no longer folded into
   postponed's label (see Decision point).

## Owner amendment (required deliverable)

This contradicted a dated owner directive, so it was amended by PR with a
decision note rather than as a build side effect. Changes to
`design-system/dime-ai/pages/ai-model-projections.md` only:

- New dated section **"Owner Directives — 2026-08-05 (card status header +
  pregame-only venue/time)"**, which quotes and retires the 2026-07-17 clause
  *"Scheduled games own the time in this block; the card header shows LIVE/FINAL
  only."*
- The 2026-07-17 **"Gamecard matchup block"** ASCII anatomy updated: `{STATUS}`
  added as the centered header line, `{BALLPARK}` marked SCHEDULED ONLY, and
  `{TIME OF FIRST PITCH ET}` retired from the block entirely.
- Folded into the existing **"Lifecycle compaction"** directive (same file):
  removing the ballpark and first pitch is the same rule extended, not a
  competing one, so it sits beside "remove all pregame pitcher/lineup UI",
  `align-self: start`, and `opacity: 0.72`.

`MASTER.md`, `THREE-COLOR-LAW.md`, and `TYPOGRAPHY.md` were **not touched**.

## Decision point — suspended (surfaced, answered by the owner)

`DimeModelFeed.tsx` mapped `gameStatus: "suspended"` to the literal label
`"POSTPONED"`, and `presentation.ts`'s `EventStatus` had no `suspended` member,
so a suspended game read as postponed. **Owner answer (2026-08-05): thread a real
`SUSPENDED` state.** Implemented end to end — `EventStatus`, `GameStatus`, the
status derivation, the label map, and a `--suspended` CSS modifier. It takes the
same compact anatomy, `align-self: start`, and `opacity: 0.72` as postponed.

The impeccable critique then found that the new state carried no information the
old one lacked: `mlbRowToCard` gated scores on `isLive || isFinal`, so a
suspended card showed no score and was visually identical to POSTPONED (82px vs
83px of the same grey). Fixed in the repair round — **a suspended game was halted
mid-play and keeps its score; postponed was never played and stays score-less.**
Verified in-browser: suspended renders `2 – 2`, postponed renders none.

## Second decision — soccer

Owner answer: *"the world cup is over. focus on mlb."* On MLB rows the ballpark
arrives as the **context line** (`meta = g.venue`), so the team-sport adapter
gates that line on scheduled. Soccer's context line is the **round** ("World Cup
Final") with the stadium on a separate line, so soccer keeps its round at every
state and loses only stadium + kickoff. Stage identity is not a ballpark, and a
settled soccer card would otherwise lose the only thing naming the match.

## Files

| File | Change |
|---|---|
| `client/src/lib/sport/presentation.ts` | `EventStatus += "suspended"`; `venueOf`/`startTimeOf` gated to `scheduled`; team-sport `contextLine` gated (it *is* the ballpark); soccer `contextLine` deliberately not gated |
| `client/src/components/projections/types.ts` | `GameStatus += "suspended"`; field docs updated |
| `client/src/components/projections/fromFeedSpec.ts` | Same pregame-only contract; accepts an explicit `status` so postponed/suspended can't fall through score inference |
| `client/src/components/projections/MatchupPanel.tsx` | Time line removed; venue backstopped to pregame; doc comment rewritten (it encoded the old rule) |
| `client/src/components/projections/ProjectionCard.tsx` | Header renders unconditionally; status in the accessible name |
| `client/src/components/projections/ProjectionCard.css` | `.projection-card__head` centered; `tabular-nums` on the status; `.matchup__time` deleted; the `--scheduled` grid overrides deleted (the base now governs every state) |
| `client/src/pages/DimeModelFeed.tsx` | `suspended` derivation + `"SUSPENDED"` label + score gate |
| `design-system/dime-ai/pages/ai-model-projections.md` | The owner amendment above |
| 5 test files | New assertions written red first; see below |

`fromFeedSpec.ts` was fixed rather than skipped, but note for reviewers: the feed
renders through `presentationToProjectionGame`, so `feedSpecToProjectionGame` is
**exercised only by tests today**. It is a parallel adapter kept in contract, not
a live backstop.

## Gates

| Gate | Result |
|---|---|
| `/sp-tdd` | 15 assertions written red first across the 5 named test files, then made green. No test deleted. |
| `npx tsc --noEmit` | **clean** — [`typecheck-tests.txt`](./typecheck-tests.txt) |
| `npx vitest run client/src` | **781/781 pass, 55 files** — same file |
| `verify` skill: build + boot + `smoke-deploy.mjs` | **10/10 checks passed** — [`smoke.txt`](./smoke.txt) |
| impeccable detector | 3 warnings, **0 attributable to this diff** — [`impeccable-detect.json`](./impeccable-detect.json) |
| `/impeccable critique` | dual-agent (A: design review, B: detector + browser), not degraded. Findings triaged below. |
| review-animations motion gate | **did not fire** — the diff touches no motion property. Determination + grep evidence + reduced-motion verification in [`motion-review.md`](./motion-review.md) |
| MASTER.md Pre-Delivery Checklist | **11/11** — [`checklist.md`](./checklist.md) |

### Detector attribution

All three findings are `warning`/`side-tab` and all three predate the branch:
`EdgeIndicator.css:18` (file byte-identical to `origin/main`), `ProjectionCard.css:930`
(same text at `origin/main:917`), `ProjectionCard.css:1151` (same at `origin/main:1138`).
Both shifted only because comment blocks were added above them. Every
`ProjectionCard.css` hunk in the diff lands in lines 31–46, 67–76, 132–135, and
885–889 — none of which contain a finding.

## Rendered proof

Production build, booted locally, driven with Playwright at
`/feed/model/mlb-08-05-2026`. Screenshots are gitignored per the bundle's PNG
law; they are attached to the PR.

**Harness disclosure, so the frames are read correctly.** `/feed` is behind
`RequireAuth` and the local DB is dead, so the harness intercepts the tRPC batch
to stand in a session (`appUsers.me`) and inject a five-state MLB slate
(`games.list`). Nothing about the page, shell, league grid, stylesheet, or
`ProjectionCard` is mocked — only the data the dead DB cannot serve. The sidebar
therefore reads `RENDERPROOF`, and the console shows 72–76 `401 Not
authenticated` errors, all from analytics **mutations** that the stand-in session
cannot satisfy. No rendering error occurs.

| Artifact | What it shows |
|---|---|
| `screenshots/{dark,light}-{375x812,768x1024,1024x768,1440x900}.png` | All five states in one frame at each checklist width, both themes |
| `screenshots/reduced-motion-dark-1440x900.png` | `prefers-reduced-motion: reduce`; live-dot `animationName === "none"` |
| `screenshots/pair-a-pregame.png` / `pair-b-live.png` | The pregame → live pair, pitcher panel suppressed so the header is the only variable |
| `screenshots/geometry.json` | Per-state measurements |
| `screenshots/pregame-live-pair.json` | The no-jump measurement |

### Measured, all five states (1440×900, dark)

| state | status text | `justify-content` | center skew | matchup top offset | head height | venue line | time line |
|---|---|---|---|---|---|---|---|
| scheduled | `9:40 PM ET` | center | **0.0px** | 61px | 17px | none (`Chase Field` is the context line) | none |
| live | `LIVE · BOT 8TH` | center | **0.0px** | 57px | 17px | none | none |
| final | `FINAL` | center | **0.0px** | 57px | 17px | none | none |
| postponed | `POSTPONED` | center | **0.0px** | 57px | 17px | none | none |
| suspended | `SUSPENDED` | center | **0.0px** | 57px | 17px | none | none |

Centering is exact (`(status.left − card.left) − (card.right − status.right) = 0.0`)
for all five states, in both themes, at 375 and 1440.

**No-jump proof.** The head row is present and identically sized (17px) in every
state, so `matchupTopOffset` is constant at 57px across live/final/postponed/
suspended. The scheduled card's 61px is a **4px** delta that is exactly the
lifecycle gap token (`--space-md` 16 vs `--compact`'s `--space-sm` 12) — the
pre-existing compaction rhythm, not the header appearing or disappearing. Before
this change the scheduled card had no head row at all, so that offset moved by
the full header height on every transition.

**No horizontal overflow** at 320 / 375 / 768 / 1024 / 1440. The status never
truncates (`scrollWidth === clientWidth` for all five states at all five widths).

## Repair round (bounded: one batched round + one confirm round, then stop)

Applied:

1. **[P0] Light-theme screenshots were dark-theme duplicates.** Assessment B
   found that the app reads `localStorage['dime-theme']` and never consults
   `prefers-color-scheme`, so Playwright's `colorScheme: "light"` did nothing —
   all eight "light" PNGs were pixel-identical to their dark twins. That mattered
   because the one theme-specific rule in this area (`ProjectionCard.css:84-86`,
   the `color-mix` that lifts the live label to 4.62:1 on white) had **zero**
   rendered verification. Harness now seeds the real control and asserts
   `documentElement.classList.contains("dark")` matches the requested theme
   before capturing; the PNGs now differ.
2. **[P1] Suspended carried no score** — fixed (above).
3. **[P1/a11y] The lifecycle state was absent from the card's accessible name.**
   Now `aria-label="Giants at Rangers, LIVE · BOT 8TH"`, verified in-browser for
   all five states. Deliberately **no `aria-live`**: a 15-game slate polling every
   60s would interrupt a screen-reader user continuously; the status is first in
   the card's reading order instead.
4. **Two now-redundant CSS rules deleted** (`--scheduled` grid-areas and
   grid-rows became byte-identical to the base once the head row went
   unconditional). Tests updated to assert their *absence*, which is a stronger
   claim than the previous copy.
5. **A wrong comment corrected** — the register comment claimed "10-11px caps";
   `--proj-meta` measures 12.00px @375 and 14.05px @1440. Real measurements now
   in the comment, and the AA classification (normal text, not large) with it.
6. **Page-law wording sharpened.** The first draft said "Type treatment is
   unchanged and shared", which over-claimed: ink is *not* shared across states.
   Now states precisely what is shared (slot, alignment, register) and what is
   not, with the measured contrast per state.

Not applied — **explicit non-goals of this change**, reported instead of touched:

- `slateStatusRank` puts postponed/suspended in the *upcoming* tier, so dead
  games sort above the only bettable card. Fixing it is card ordering (non-goal).
- `isPass` only neutralizes mint when there are no edges, so a postponed game
  keeps a mint `EDGE +8.2%` chip on a game nobody can bet. Fixing it is PASS
  dimming semantics (non-goal). MASTER.md:251 argues it should be fixed; it needs
  its own change.

Both are one-line fixes and are written up in `checklist.md` for the owner.

## Skipped / degraded steps, named

- **`/impeccable shape` was not run as a separate step.** `context.mjs` reported
  `NO_PRODUCT_MD` / `PRODUCT_INIT_REQUIRED` and directs scoped fixes to existing
  code to proceed on the incumbent implementation without the new-surface flow.
  Running `init` would have written a `PRODUCT.md` as a side effect of a
  refinement, which the skill forbids. The header-slot geometry decision was made
  against the page law and confirmed by `critique`.
- **uipro returned nothing surface-specific.** Both searches
  (`"scoreboard card game status lifecycle states" --domain product` and
  `"status badge live final state indicator" --domain ux`) returned generic rows
  — card/board games, loading spinners, nav active states. Recorded as advisor
  evidence with no authority, per the routing rule. Nothing persisted (`/feed` is
  a governed surface).
- **Full-slate `-full.png` frames were dropped.** The app shell scrolls an inner
  container, so neither `fullPage: true` nor an element crop captured the slate
  un-clipped at desktop widths. The per-viewport 1440×900 frame already shows all
  five states at once, so shipping a clipped frame would have been worse than
  shipping none.
- **True Chrome page zoom** is not settable from Playwright; the 200% check used
  a 720×450 viewport at `deviceScaleFactor: 2`, which reproduces the layout
  consequences but not Chrome's font-boosting heuristics.
