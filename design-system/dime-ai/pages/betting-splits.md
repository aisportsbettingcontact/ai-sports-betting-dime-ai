# Betting Splits + Odds History — Page Overrides (PROPOSED)

> **PROJECT:** Dime AI
> **Status:** ⚠️ **PROPOSAL — not yet owner law.** Drafted 2026-08-05 during the
> desktop refinement pass (PR: `feat/splits-desktop-refine`), per the
> federation rule that surface contracts land as PR proposals with a dated
> decision note, never as build side effects. Until the owner approves (or
> amends) this file, `MASTER.md` + `dime-ai/THREE-COLOR-LAW.md` remain the
> only law for this surface.
> **Decision note (2026-08-05):** authored from the shipped surface
> (`BettingSplits.tsx`, `GameCard.tsx` mode="splits", `BettingSplitsPanel.tsx`,
> `OddsHistoryPanel.tsx`, `splits-interactions.css`) plus the dual-assessment
> critique in `docs/audits/2026-08-05-splits-desktop-evidence/`. Sections
> marked **OPEN DECISION** need an owner call; everything else codifies what
> already ships.

---

## Shipped rules this file codifies (no change proposed)

### Split-bar anatomy (the page's signature instrument)
- One pill bar per TICKETS row and per HANDLE row, per market column.
- Track: transparent (theme ground shows through); away segment: solid
  `--dime-mint`; 1.5px `--dime-border-strong` outer border + segment divider.
- Labels ALWAYS render inside their segment: away label `--dime-ink-on-mint`,
  home label `--dime-text-primary`; weight 700; no text strokes/shadows
  (`splits-interactions.css` strips the legacy strokes).
- **Small-segment rule (2026-08-05):** segments never render narrower than
  their own label (`min-width: max-content`) — the printed number is the
  truth; the bar is indicative. Label ceiling 15px
  (`clamp(12px, 1.05vw, 15px)`) so bar labels never out-shout the 14px
  history-table data.
- Percent semantics: away/over on the left, home/under on the right;
  home = 100 − away. 0/0 rows read "—" ("market not yet open").

### Odds & Splits History
- Auth-gated (`oddsHistory.listForGame` is premium content); desktop stacks
  all three markets (SPREAD → TOTAL → MONEYLINE) with per-market dedup.
- Table type: values `--fs-body-sm`-tier sans 600–700 with `tabular-nums`;
  headers mono-style UPPERCASE at ≥11px (caption floor); TIME (EST) column
  mono-style, secondary ink, left-aligned; zebra + hairline row rhythm.
- Section labels: mono-style 12px/600 `--dime-text-body` (structural tier —
  must stay scannable mid-scroll).
- Mint in history = the live-movement separator only (live = signal).

### Chrome
- One brand mark per screen: the standalone `.bs-brand-row` wordmark renders
  only <768px (the shell owns the mark at every shell viewport).
- Freshness stamp: "SPLITS SYNCED N MIN AGO" mono micro-label in the date
  header (desktop) — the sibling projections law's "SYNCED" analog.
- LIVE pill: `--dime-mint-dim` fill, `--dime-mint-border` border,
  `--dime-mint-text` text — all theme-correct tokens; light-theme border
  derives v3's `color-mix(mint 68%, black)`.
- Team logos/crest art are licensed assets: colors exempt from the palette
  law; light theme must never blend/filter them into invisibility.

---

## OPEN DECISION 1 — mint as side-encoding vs mint as signal

Today mint fills the AWAY side of every bar (side-encoding; ~48 mint
segments per viewport). MASTER's discipline is "mint = signal"; a dead-even
50/50 game renders six half-mint bars that look like six half-signals, and
mint riding the away side implies a lean that may not exist.

Options (both one-accent compliant):
- **(a) Mint fills the majority side** — mint becomes "where the public
  leans"; an exact 50/50 renders all-grey (truthfully: no signal). Cost:
  mint alternates sides between TICKETS and HANDLE rows of one market.
- **(b) Keep away=mint** (spatial stability) and add a one-time
  AWAY ▪ / HOME ▫ legend chip in each card's header band.

*The 2026-08-05 pass changed nothing here — awaiting the owner's call.*

## OPEN DECISION 2 — history-table enhancements
- Day-boundary rule: a quiet keyline where the date changes mid-table
  (currently zebra + hairlines double-encode row separation while the one
  meaningful boundary gets nothing).
- Change-highlighting: mark which cell(s) changed vs the previous snapshot
  (weight or `--dime-mint-dim` tint) so dedup rows stop requiring manual
  diffing.

## OPEN DECISION 3 — 1024 band label treatment
1024–1279px ellipsizes the market label rows ("NYY …", "O… 8.5 UN…") —
the lines/odds vanish. Fix needs component hooks (band-scoped padding/type
reductions + a narrower score rail), beyond the 2026-08-05 CSS-first pass.

## Mobile addendum (2026-08-05, `feat/splits-mobile-refine`)

Measured under true mobile emulation (iPhone UA + touch + DPR2, 320–430px).
Codifies what the mobile pass ships; OPEN DECISION items stay open.

### Shipped mobile rules
- **Nothing scrolls off unannounced.** Any pane that overflows sideways on
  phones (splits scroll pane, history tables) is keyboard-focusable
  (`tabIndex=0`, named `role="group"`) and shows a thin scrollbar — never a
  gradient fade (gradients are banned). The frozen matchup column floors at
  118px and the scroll pane carries no fixed inner minimum, so both halves
  of every bar fit the real pane width at 320–430; bar labels keep their own
  `max-content` guarantee.
- **One word per concept at every width:** mobile bars say HANDLE (never
  MONEY) and the mobile market chip says ML (never a clipped "MONEYLIN");
  bar headers use team abbreviations, matching the history tables.
- **Card grouping:** a game's history card tucks flush under its game card
  (squared inner corners, −6px overlap); distinct games keep the full
  floating-card rhythm.
- **Touch floors:** 44px minimum hit area on the history disclosure row and
  the favorite star (invisible hit extension — visual size unchanged).
- **Sticky chrome:** the 8px breathing gap between the floating nav and the
  pinned filter header is covered with page ground so scrolled fragments
  never glint through.
- LIVE dot 7px on phones (5px vanishes at arm's length under DPR2).

### OPEN DECISION 4 — mobile freshness-stamp home
The desktop date header renders "SPLITS SYNCED N MIN AGO"; on phones the
stamp is hidden (`hidden md:flex`) because the date row is already at
capacity at 320–390. The mobile surface therefore has **no freshness
signal**. Candidate homes: (a) a mono micro-label row under the date
header; (b) inside the sport picker sheet; (c) accept desktop-only.
*The 2026-08-05 mobile pass changed nothing here — awaiting the owner's
call.*

## Known debt (codify or migrate later)
- `GameCard.tsx` splits path carries ~34 vw-based font clamps and legacy
  inline styles that the override layer corrects; a token migration would
  retire `splits-interactions.css`'s `!important` layer (43 uses).
- TICKETS/HANDLE column tooltips are `title`-only (invisible to keyboard/
  touch); the tickets-vs-handle divergence — the page's core insight — is
  never explained in-surface.
- "TOP 6" (inning clock) reads as a ranking label; consider "TOP 6TH".
