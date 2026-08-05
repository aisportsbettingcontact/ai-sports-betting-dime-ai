# Parlay Leg Cells + Live/Pregame Separation — Design

Owner directive (2026-08-04): legs must be easily viewable, editable, and deletable
in the parlay interface; the two caption lines under Ticket odds and Risk are slop
and go; live odds and lines stay separated from pregame odds and lines,
bulletproof, for straights and parlays; cells maximally displayed (size,
viewability, structure, formatting, alignment, order, font color and size); team
logos; one cell per leg; a clear final step for submitting; "straight" is the
term, not "single".

## Current state (audited)

- `ParlayBuilder.tsx` renders legs as thin 13px rows: index, label, matchup,
  odds, an X. No logos, no edit, 11px metadata, `py-2` cells.
- The two caption lines live at ParlayBuilder.tsx:198-204 and :224-226.
- The add-bet form (BetTracker.tsx) autofills odds/lines from
  `formGame.odds` (Action Network slate) regardless of the PRE-GAME/LIVE
  toggle and regardless of game status. AN status vocabulary:
  `scheduled | in_progress | complete`; during `in_progress` the slate's odds
  are the book's CURRENT (live) lines. A user recording a pregame wager on an
  in-progress game silently gets live lines autofilled. This is the mixing
  hole on both the straight path and the leg path (they share the form).
- `DraftLeg` has no logos, no status, no wagerType. The ticket-level
  `wagerType` submitted is whatever the toggle happens to be at submit time —
  legs added before a toggle flip are mislabeled.
- Entry-mode toggle reads SINGLE / PARLAY (`entryMode`, BetTracker.tsx:2442).
- Slate games already carry `awayLogo` / `homeLogo` / `status`; the tracker
  renders logos elsewhere (game picker, BetCard), so assets exist.

## Design

### 1. Leg cells (ParlayBuilder)

One cell per leg, sized for reading and touch:

- Grid per cell: `[index] [logos] [pick + matchup] [PRE/LIVE chip] [odds] [edit] [delete]`.
- Index: mint, 11px bold (unchanged role).
- Logos: away and home, 20px, overlapping pair, hidden for TOTAL/NRFI/YRFI
  legs where a side is not a team claim (matches the BetCard rule).
- Pick label: 15px / 600 / `--text-primary`. Matchup + date beneath:
  12px `--text-secondary`, `AWAY @ HOME · M/D/Y` via the shared `fmtDate`.
- Odds: 16px / 700, numeric alignment class `bt-num`, right-aligned.
- Chip: PRE or LIVE, micro-label treatment (10px caps, 0.08em tracking).
  LIVE chip mint (it is a live indicator — an allowed mint role); PRE grey.
- Edit: pencil button. Tapping loads the leg back into the add-bet form
  (game, market, side, timeframe, line, odds, custom line) and removes it
  from the draft list; re-adding returns it. One editing surface — the form
  the user already knows — instead of a second inline editor.
- Delete: X button, hit target ≥ 32px, `aria-label` kept.
- Cell padding `py-3`, radius 10px, tokens only. No gradients, 160ms motion.

### 2. Copy (stop-slop applied)

- Remove the caption under Ticket odds (both variants) and the caption under
  Risk. No replacement prose. The "use calculated +X" button already carries
  the manual-price affordance; placeholder text carries the rest.
- The `<2 legs` state keeps exactly one indicator: the input placeholder
  ("add two legs"). The duplicate caption goes.
- Validation errors stay: they fire on action, not as standing prose.

### 3. Live/pregame separation (bulletproof, straights and parlays)

The same rules govern the straight form and the leg form (shared code path):

| Game status | PRE-GAME selected | LIVE selected |
|---|---|---|
| `scheduled` | autofill from slate (these are pregame lines) | toggle disabled — a live wager cannot exist before first pitch |
| `in_progress` | NO autofill; odds/line cleared for manual entry | autofill from slate (these are the live lines), odds field carries a LIVE chip |
| `complete` | autofill (closing lines, legitimate for backfill) | manual entry only |

- Selecting a game auto-sets the toggle from its status (`in_progress` →
  LIVE, otherwise PREGAME). The user can override where the matrix allows.
- `DraftLeg` gains `wagerType`, stamped at add time from the toggle. A ticket
  cannot mix: adding a leg whose wagerType differs from the legs already on
  the ticket is rejected with a one-line error. The submitted ticket's
  `wagerType` derives from the legs' common value, not from whatever the
  toggle reads at submit time. No schema change: legs do not persist
  wagerType; the coherence rule makes the ticket-level value truthful.
- Switching the toggle re-runs the autofill rules for the selected game
  (fill, or clear to manual).

### 4. Final step (submit)

A bounded review block above the button replaces the lone payout row:

- Card: `N legs · <PRE|LIVE>` on the left; `+odds` center-right;
  `Risking X.XXu to win Y.YYu` as the primary line, 15px, to-win in mint.
- The button keeps `TRACK N-LEG PARLAY`, full-width, mint fill, black text.
- Nothing new to click — the review block is information, the button is the
  one action. (A wizard/step flow was considered and rejected: density 8/10
  surface, power users log tickets fast; a modal review adds a click and no
  safety.)

### 5. Terminology

`entryMode` values and the visible toggle become STRAIGHT / PARLAY. The word
"single" leaves user-facing copy and local identifiers it names.

## Out of scope

- Persisting per-leg wagerType (schema change; the coherence rule makes it
  unnecessary for truthful tickets).
- Reworking the straight-bet card list or BetCard.
- Odds-history or closing-line capture.

## Verification

- Unit: autofill matrix (6 cells) as a pure decision function with tests;
  leg-coherence rule tests; ticket wagerType derivation test.
- Scans: captions absent from ParlayBuilder; SINGLE absent from the toggle.
- tsc, full non-DB vitest, production build.
- Playwright screenshots of the builder at 1440×900 and 390×844, dark and
  light, committed to the PR description for review.
