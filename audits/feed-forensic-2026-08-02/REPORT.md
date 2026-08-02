# AI Model Projections feed — forensic layout audit (2026-08-02)

Pixel-level audit of the production feed (`/feed/model/mlb-MM-DD-YYYY`), desktop dark +
mobile light + the full viewport matrix, cross-referenced against the documented intent
(`design-system/dime-ai/MASTER.md`, `design-system/dime-ai/pages/ai-model-projections.md`,
`dime-ai/THREE-COLOR-LAW.md`, `dime-ai/DIME-FEED-MIGRATION-DRAFT.md`) and the shipped
code. Companion to `audits/ui-forensic-2026-07-31/` (whole-product); this one goes deeper
on the one surface.

## Method

- **Rig:** Playwright Chromium against **live production** (`aisportsbettingmodels.com`),
  DPR 2. The route is login-gated, so the rig patches only the `appUsers.me` tRPC
  response client-side (same technique as the 2026-07-31 audit) — every game, odds, and
  pitcher fact rendered is real production data; nothing bypasses server-side auth.
- **Matrix:** 1512 / 1440 / 1280 / 1231 / 1229 / 1024 / 900 / 768 / 767 / 390 / 320 CSS px,
  dark + light (`?theme=` override), plus `prefers-reduced-motion`, hover probes, and two
  slates: **2026-08-02** (15 scheduled cards, pregame panels) and **2026-08-01**
  (15 final cards, lifecycle-compact anatomy).
- **Census per config:** bounding-box geometry of every summary row element, computed
  typography/color on every leaf node, per-element horizontal-overflow sweep, mint-color
  census, cards-per-row pattern, sticky-chrome offsets, console + network capture.
  Raw data: `evidence/census.json`, `evidence/probe2.json`, `evidence/discover.json`.
- Implementation map (routes, component tree, CSS locations, tests) built by a parallel
  read-only code sweep; every SEV claim below was re-verified against source before filing.

## Verified compliant (measured, not assumed)

| Law | Measured | Source |
|---|---|---|
| Shell title 5× (96px band, ≤70px, one line, centered) | 96px sticky band; title 70px, 1 line, center delta −3px at 1512 | `DimeModelFeed.tsx:1661-1667` |
| Date-nav rhythm (24px above, 32px+1px divider below) | 24.0px title-band→nav; 33px nav→league header, edge-to-edge | `DimeModelFeed.tsx:1665` |
| Date nav: 28px square buttons, radius 8, label 17px/700 | 28×28, radius 8px, 17px/700, centered | `DimeModelFeed.tsx:1364-1372` |
| League header: centered cluster, 15px/600 caps, 60px MLB mark (desktop 2×) | 60×33.7px logo box, 15px/600, ls 1.2px, cluster centered | `DimeModelFeed.tsx:1379-1406` |
| Grid: 1-up <768 / 2-up 768–1023 / content-aware 3-up (`dmf-league` ≥940px) | 1-up at 320–767, 2-up at 768–1280, 3-up at ≥~1401 (see F6), equal 340px tracks | `DimeModelFeed.tsx:1408,1615-1627` |
| Desktop rows stretch; summary centers; trigger pins to bottom | scheduled rows all exactly 494px; trigger 14px from card bottom on every card | `ProjectionCard.css:840-850` |
| Lifecycle compaction (live/final → compact, 0.72, align-self start) | all 15 finals: `--compact`, opacity 0.72, align-self start, ragged heights 272–334 by design | `ProjectionCard.css:42-57` |
| Unified score row 24px/700 tabular | every final: scores 24px/700 `tabular-nums` | `ProjectionCard.css:88-90` |
| Header shows LIVE/FINAL only; scheduled owns time in matchup block | finals: head "FINAL", no pregame UI, no stale LINEUPS trigger | `ProjectionCard.tsx:89-112` |
| One canonical edge chip (v3 tinted cell) | every chip dark `#0B241B`/`#DFF9EF`, light `#DEF9EF`/`#09251C` — zero variants across 30 cards | `EdgeIndicator.css`, `index.css:274-295` |
| Neutral ROI badge on PASS; no-scorable → unavailable copy | Aug-1 PASS+final card renders no chip (post-settlement no scorable side) — state machine per law | `ProjectionCard.tsx:47-64` |
| Carousel arrow: 44px, mint icon, foreground border, wraps, no dot row | 44×44, border white(dark)/black(light), svg `#45E0A8`, 160ms curve, focus outline | `ProjectionCard.css:577-608` |
| 44px summary alignment lane; values tabular | `.summary__item`/`.summary__signal` min-block-size 44px; `tabular-nums` on values | `ProjectionCard.css:611-613` |
| Summary labels `MODEL EDGE | BOOK | MODEL`; spelled-out picks | "Model edge / Book / Model"; "Orioles ML", "Under 8.5", "Braves -1.5" | `ProjectionSummary.tsx:60-113` |
| Pitcher panel: two equal lanes, centered LINEUPS, pending shape | 3-track grid, CTA centered, "W–L / ERA pending" copy renders without anatomy shift | `ProjectionCard.css:160-171` |
| 44px touch floor on compact LINEUPS | 32px visual + `::before` ±6px = 44px effective (owner directive 2026-07-29) | `ProjectionCard.css:311-337` |
| Mobile floating-nav clearance chain | `--dime-floating-nav-h` 114px live; body pad 114px; feedhead top 106px (−8 gap); scroll pad-bottom 24px; topbar hidden | `dime-mobile.css:719-737`, `index.css:437-456` |
| Motion law: one 160ms `cubic-bezier(0.16,1,0.3,1)` curve; reduced-motion | trigger/arrow/LINEUPS all 160ms brand curve; hover fill `#141414`; reduced-motion → 0s everywhere, scroll-behavior auto | `ProjectionCard.css` throughout |
| No horizontal page scroll 320–1512, both themes | `scrollWidth − clientWidth = 0` at every config; only intended scrollports overflow (carousel track, summary viewport) | — |
| Single typeface | Familjen Grotesk is the only rendered family in every census | `index.css:7-12` |
| Light-theme v2 tokens | card `#F7F7F7`, border `#D9D9D9`, labels `#595959`, values `#000` — all v2 ramp values | THREE-COLOR-LAW v2 |
| Contrast remediations hold | `@`/labels on `--text-secondary` (8.6:1 dark / 7.0:1 light) per CL-05a/b; confirmed-status light uses `#0A7C50` | `ProjectionCard.css:94-97,616,190` |
| Console/network | zero real errors on the feed at all 13 configs (only rig-induced 401s on `analytics.*`/`metrics.*` from the stubbed session) | — |

## Findings (ranked)

### F1 — MAJOR · The summary "single-line group" law and the shipped wrap behavior have forked, and the visible symptom is the ragged edge-chip placement across a row
- **Intent** (`ai-model-projections.md` §2026-07-24): "`MODEL EDGE | BOOK | MODEL | signal`
  travels as one intrinsic-width, centered, **single-line group at every breakpoint**…
  If localized content is physically wider than the card, **overflow is confined to the
  summary viewport**."
- **Implemented:** `.summary__group { flex-wrap: wrap }` — the `FEED-EDGE-ROW-CLIP`
  comment (`ProjectionCard.css:568-575`) deliberately replaced clip-into-scrollport with
  wrap-onto-second-line, and `ProjectionCard.test.ts:923,951` **guard the wrap as a
  regression test**. The law file was never amended (the Round-4 plan explicitly required
  law annotations for amendments).
- **Measured:** at 1512/1440 (3-across, 340px cards) 4–5 of 15 cards wrap the chip+arrow
  onto a second line while row-mates keep one line ("Orioles ML" wraps; "Braves -1.5"
  doesn't). Same at 1024, 768, and all cards at 320. This defeats Round-4 item 5's goal —
  "values align vertically across all cards" — in every mixed row, and is the desktop
  raggedness visible in the owner's screenshot.
- **Fix direction:** decide the law, then make the outcome uniform per row — either a
  deterministic two-row anatomy for all cards at narrow card widths (chip row always
  present), or width-budgeted pick abbreviation, or return to the scrollport with a
  visible affordance. Record the decision in `ai-model-projections.md`.

### F2 — MEDIUM · "View full AI model projections" wraps to two lines on every desktop 3-across card
- **Intent:** "The complete trigger label stays on one line **on mobile and tablet**"
  (law is silent on desktop — written when desktop was 2-across).
- **Measured:** at 340px cards (1512/1440 3-across) the label renders two lines
  (`17.3px` fluid type in a ~308px content box) on **all** cards; at 2-across and mobile
  it is one line. Uniform, but it visibly cheapens the densest view and adds 22px of
  card height the equal-height grid then propagates.
- **Fix direction:** cap `--proj-*` fluid size for the trigger in the 3-across band, or
  extend the one-line law to desktop and size accordingly.

### F3 — MEDIUM · Pitcher names wrap on desktop 3-across cards
- **Intent** (§2026-07-23): "Pitcher names remain complete and **on one line** on mobile
  and tablet; compact cards give the pitchers two equal-width lanes… **rather than
  stealing name width or wrapping/clipping text**."
- **Measured:** mobile/tablet ✔ one line. Desktop 3-across (340px cards): "Zack Wheeler",
  "Martin Perez", "Matthew Liberatore", "Max Scherzer" all render **two lines**
  (`white-space: normal`, no desktop nowrap rule). The mobile one-line machinery
  (`ProjectionCard.css:288-350`) is scoped `max-width:1023.98px` and never engages in
  the desktop 3-across band, the one place cards are narrowest.
- **Fix direction:** extend the compact-name contract to `@container projcard` width
  rather than viewport width.

### F4 — MEDIUM · Raw-mint "Confirmed" labels dilute the mint = signal law on dark
- **Intent** (MASTER): mint is reserved for edge/pick/live/active/focus/coin-dot;
  anti-pattern list: "Mint for decoration — if it isn't signal, it isn't mint." The
  pitcher law specifies "a text label of EXPECTED or CONFIRMED" with no color grant.
- **Implemented:** `.pregame-pitcher__status--confirmed { color: #45e0a8 }`
  (`ProjectionCard.css:189`; light theme correctly swaps to `#0A7C50`, `:190`).
- **Measured:** on a fully-confirmed slate that is up to 30 raw-mint labels vs 15 edge
  chips — the mint census shows status labels outnumbering actual signal. Expected
  labels stay grey (`#595959` light / secondary dark) — the asymmetry proves the intent
  was emphasis, but the law doesn't grant it.
- **Fix direction:** owner call — either amend the law (confirmed-status = signal) or
  move confirmed to `--text-primary`/weight emphasis.

### F5 — MEDIUM · Documented in-shell 3-across threshold is off by ~170px because the sidebar grew
- **Intent** (FEED-CL01a note): "inside the app shell (**sidebar ≈250px**) rows stay
  2-across until **roughly a 1230px window**." MASTER still says "264px fixed sidebar."
- **Measured:** shipped sidebar is **381px** border-box (352px content — the 2026-07-21
  ×1.75 sidebar text directive grew it; MASTER was never updated). League body =
  viewport − 381 − 80, so 3-across engages at **≈1401px**, not ~1230: a 1280×800 or
  1366×768 laptop in the shell never sees 3-across. (940px container-query mechanism
  itself works exactly as designed — verified 2-up at 1280, 3-up at 1440.)
- **Fix direction:** decide whether 1280-class laptops should get 3-across; either way,
  correct FEED-CL01a's numbers and MASTER's sidebar spec.

### F6 — LOW · The "@" separator renders larger than the team names it separates
- **Measured:** scheduled-card names ≈15.9px/700; the "@" inherits `.matchup__line`
  `--proj-team` → **20.5px**/400. CL-05a (`ProjectionCard.css:94-97`) fixed its color
  and concedes 20px/400 in passing, but the 16px/700 matchup law
  (`ai-model-projections.md` Typography) never reconciled the size. Subordination is
  currently carried by color/weight against a size that outranks the names.

### F7 — LOW · League name ellipsizes at 320px
- **Intent:** "the full spelled-out name at 15px (1.25×, clamped on narrow phones)".
- **Measured:** at 320px `.dmf-lgname` (`white-space:nowrap; text-overflow:ellipsis`,
  `DimeModelFeed.tsx:1403`) clips "Major League Baseball (MLB)" (scrollWidth 207 vs
  182). The clamp the law describes is a size clamp; shipped behavior truncates the
  name at the supported floor.

### F8 — LOW (docs) · Three intent conflicts to resolve on paper
1. **PASS/compact opacity vs v2 tone law:** THREE-COLOR-LAW v2 retired "the
   `opacity:0.82` alpha loophole" for de-emphasis; the page law and shipped code use
   opacity 0.82 (PASS, ≥768 only — mobile PASS renders undimmed) and 0.72 (compact).
   Page law overrides MASTER, but v2 claims to supersede — say which wins.
2. **Feed surface is login-gated** (`RequireAuth`, `App.tsx:283-296`; anonymous →
   `/login`) while `DIME-FEED-MIGRATION-DRAFT.md` §4 and the page-law data contract
   still say "Feed data is public." The tRPC reads are public; the surface is not.
   Update the contract text (or note the gating decision) so the next audit doesn't
   re-litigate it.
3. **LINEUPS CTA law text is stale:** law says "the Dime mint CTA: bold black text";
   shipped is `--surface-raised` + foreground in both themes since `423442ee`
   ("mint rationing", from the 2026-07-31 audit remediation). The restyle was
   deliberate; the law sentence was never rewritten.

### F9 — MAINTENANCE · Structural fragility inventory (no visual defect today)
- The **entire feed stylesheet is a JS template string** (`DMF_CSS`,
  `DimeModelFeed.tsx:1309-1677`) injected via `<style>`; tests assert literal substrings.
- **~200 lines of dead CSS + three dead components** (`GameRow`/`MarketCol`/`TeamRow`,
  `.dmf-game` tree, `DimeModelFeed.tsx:179-278,1409-1614`) — zero call sites.
- **Four sticky top offsets** (46/64/96/`--dime-floating-nav-h − 8`) across two files
  must track four header heights; the −8 hard-codes a JS constant.
- Title fit divisor `10.8` (`:1663`) is tuned to the exact string "AI Model Projections".
- `940px` container threshold is derived from `.dmf-scroll` padding; changing either
  silently desyncs (documented in-code, still a coupling).
- Duplicate mobile bottom padding (130px slab `:1362` vs 24px `dime-mobile.css:736`);
  duplicate 112px nav fallback in four files.
- PASS zero-mint enforcement needs a 5-rule `!important` cascade incl. one rule that
  exists to beat an inline style (`ProjectionCard.css:790-826` vs `EdgeIndicator.tsx:64`).
- Two theme systems on one page (`html.dark` for cards, `data-dmf-theme` for chrome);
  raw `#45e0a8` hex in ~8 places; `--mint-on-light` cited in comments but never defined
  as a token (value inlined as `#0a7c50`).

## Evidence

`evidence/` — 13-config screenshot matrix (viewport + full-page), finals-slate captures,
mobile chrome capture, and the raw census JSONs. Notables:
- `d1512-dark.png` — the owner's desktop view reproduced (shell, 70px title, 3-across)
- `finals-1512-dark.png` — Aug-1 lifecycle-compact anatomy
- `m390-light.png` / `m390-light-chrome.png` — the owner's mobile view
- `m320-light-full.png` — floor-width behavior (F1 all-wrap, F7 ellipsis)
- `census.json` / `probe2.json` / `discover.json` — every number cited above

## Verdict

The feed's engineered contracts — grid, rhythm, lifecycle, tokens, motion, clearance,
overflow — measure within law almost everywhere; this surface has clearly been through
disciplined rounds. The layout problem the owner perceives is real and has one dominant
root: **at the narrowest card widths (desktop 3-across band), three different elements
(edge signal, trigger label, pitcher names) independently fall back to wrapping**, so
adjacent equal-height cards render internally different anatomies (F1/F2/F3). The law
that should arbitrate this (single-line summary) was silently amended in code. Fixing
those three at the container-width level — plus the F4 mint dilution — restores the
uniform card grid the design system promises.
