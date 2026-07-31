# Dime AI — UI Forensic Audit

**Date** 2026-07-31 · **Repo** `aisportsbettingcontact/ai-sports-betting-dime-ai` · **Branch** `fix/mlb-verify-dynamic-total` · **Commit** `fcb85dddf25b5730ab9539bcc68c6e9a608a85f0`

**Skills loaded:** apple-design, emil-design-eng, ui-ux-pro-max (v2.11.0 plugin), ui-ux-pro-max:design-system, ui-styling, design. **Absent from arsenal** (noted, not blocking): `dime-brand-system`, `dime-ai-quality`, `web-design-guidelines`, `webapp-testing`, `design-taste-frontend-v1`. Brand law was read directly from source: `design-system/dime-ai/MASTER.md` + its superseding amendments in `client/src/index.css` / `dime-ai/THREE-COLOR-LAW.md`.

**Law note (read first).** The audit brief's design law is one generation behind the repo. The single-font mandate (index.css:7-12, owner-approved 2026-07-24) retires IBM Plex Mono — Familjen Grotesk is the only face — and THREE-COLOR-LAW v2/v3 replaces MASTER.md's `#0B0B0F` surfaces with pure `#000000` + tonal tiers + scoped elevation. Execution was judged against the repo's current law; brief-vs-repo divergences are tagged in the ledger.

---

## Verdicts

| Question | Verdict |
|---|---|
| **Ship** | **NO-SHIP** — 4 open SEV-1s force it regardless of composite |
| **Apple bar** | **FAIL** — contrast failure on the landing page's final conversion CTA, overlay motion that ignores `prefers-reduced-motion`, a visibly broken card layout at 390px, sub-AA muted labels on primary content, and a shared button component with no designed press state |
| **Provenance test** | **FAIL — but split verdict.** The *rendered* product would pass a cold look from most senior designers: mint is rationed, the light theme is genuinely designed, cards align to the pixel at 1280, digits are tabular, focus rings are systemic. The *codebase* fails in minutes: `// [VERIFY] … ✓` self-audit comments, a hex-ceiling ratchet file, six parallel TeamLogo implementations, renamed-but-byte-identical helpers, three styling paradigms across sibling cards, and two 5,000-line components. Any designer who opens the repo — or hits the 390px diagonal — identifies machine authorship |
| **Composite (mean of 9 lenses)** | **60 / 100** — an unfinished system with strong pockets |
| **Slop Index** | **34 / 100** — surface craft is real; the slop lives in the code layer (counted tells below) |

**SEV counts:** SEV-1 × 4 · SEV-2 × 19 · SEV-3 × 14 · SEV-4 × 6 — 43 findings, all VERIFIED, 4 candidate findings pulled when evidence failed to resolve (listed at the end of FINDINGS.md; one — the "focus-invisible arrow" — was pulled during the final pointer re-resolution when a settled measurement showed the ring present, and was replaced by two SEV-4 residuals).

### Top five findings

1. **DIME-UI-001 — The final "Get access · dıme" CTA fails contrast on its own wordmark.** White `dıme` on the mint fill measures 1.68:1 (needs 4.5). The last thing a prospect sees before checkout is the brand breaking its own black-ink-on-mint rule. `evidence/landing-final-cta.png`.
2. **DIME-UI-004 — The projections card is visibly broken at 390px,** the most common phone width: the two pitchers land diagonally in a 2×2 grid with dead space and the LINEUPS chip pinned to the card edge, while 767px renders the intended side-by-side layout. Measured DOM boxes in `evidence/probes.json`; compare `evidence/feed-390-dark.png` vs `feed-767-dark.png`.
3. **DIME-UI-003 — Every Radix overlay (including the feed's LINEUPS dialog) animates under `prefers-reduced-motion`.** The tw-animate keyframes sit outside index.css's kill list, so the app's own "Always respect reduced motion" law is violated on its primary surface.
4. **DIME-UI-005 — Muted labels ship below AA on primary content.** `--text-muted #6E6E6E` — self-documented in index.css as 4.1:1 — is applied to 10–11px labels across the tracker, splits, and landing captions, measuring 3.6–4.1:1 where 4.5:1 is required.
5. **DIME-UI-008 + 014 — The edge badge is three systems, and mint salience is inverted.** BET vs WATCH differ only by a 14px icon swap (the visible label says "Edge" for both); NO_EDGE is a differently-shaped "ROI" badge; the trailing arrow appears only on multi-edge cards. Meanwhile the only solid-mint fill on a scheduled card is the LINEUPS reference button — the brand's loudest token is spent on a secondary action while the model's verdict gets a tint.

---

## Method

Dev server booted web-only (`DISABLE_BACKGROUND_JOBS=1`, real DB reads, no writers). Rendered evidence: 30+ Playwright captures across 320/390/640/767/768/1280/1600 px, dark+light, loaded/loading/empty/error states, plus DOM-computed censuses (typography tuples, radii, shadows, mint counts, contrast ratios, touch targets, tab order, layout-shift, digit-width probes) stored as `evidence/census-*.json` and `evidence/probes.json`. Sub-768 authed surfaces were rendered by patching only the `appUsers.me` response client-side; all data is real. Code sweeps: four parallel read-only agents (provenance, color/banned patterns, motion/states, card anatomy) whose SEV-1/2 claims were re-verified against source before filing. An earlier attempt to mint a real session cookie was blocked by the environment's permission layer and abandoned; nothing in this audit bypasses server-side auth.

**Rig artifacts to ignore:** 403s on `analytics.track` and "Request origin not permitted" console errors are products of the stubbed-auth capture rig, not app defects. `/trends` data requires real server auth, so its populated state is UNKNOWN in the coverage matrix.

---

## Per-lens scores

### Lens 1 — Typography · **72**
One family everywhere (census: Familjen Grotesk is the only rendered face — the single-font mandate is genuinely enforced). Digits are natively uniform-width and the feed adds `tabular-nums`; the odds columns do not jitter (probe: 111 vs 999 identical width). Tracking is size-specific in the right direction (−0.05em at 64px wordmark, −0.01em at card titles, +0.08em at micro-labels). The debt: **18 distinct font sizes on one 1280 viewport** because two sizing systems coexist — fluid `--fs-*`/`--scale` clamp math and fixed-px utilities — producing near-collisions (12.48/12.898/13/13.5168px); 63 hand-tuned `clamp()` triples in GameCard alone; 10.4px micro-text is pervasive (readable, but at the floor). (DIME-UI-011, -030)

### Lens 2 — Spatial system · **64**
At 1280 the feed grid is *rigorously* aligned — across all six visible cards the edge badge row sits at exactly top=290, the CTA row at 355, pregame at 120, cards at 415px equal height (measured boxes). That is designed, not accidental. Against it: the 390px pregame collapse (SEV-1), ≥19 distinct corner radii app-wide vs a 6-value scale, 853 arbitrary Tailwind values, two different pseudo-element hit-target hacks for the same problem, and a tracker header that clips its own "OWNER" toggle to "OWNI" at 1280. (DIME-UI-004, -020, -033, -035)

### Lens 3 — Color & elevation · **58**
The law is real and mostly obeyed where it counts: zero live `#39FF14`, zero purple/gold/gradient/glass on rendered product surfaces, a light theme that is a designed system (own border/shadow/elevation tokens; the light feed measures **zero** contrast failures), an elevation model of 3 solid tiers + scoped v3 shadows. The failures: the SEV-1 wordmark-on-mint CTA; `--text-muted #6E6E6E` knowingly shipped at 4.1:1 and applied to 10–11px labels (3.6–4.1:1 measured on tracker/splits/landing); mint saturation — 89 mint elements per feed viewport with the only solid fill on a secondary button; two competing "sanctioned" mint-on-light hexes plus a test that bans one of them; and 1,557 raw hex literals (463 × `#45E0A8`) that the repo itself labels X-HEX-EPIDEMIC. (DIME-UI-001, -005, -014, -015, -016)

### Lens 4 — Component anatomy & states · **55**
The projections card is the high-water mark: 44×44 targets throughout (some via documented hit-area extensions), `focus-visible` rings, hover gated behind `(hover:hover)`, designed empty ("No games for this date · Try the date arrows above"), error, and live states. Below it: the shared `ui/button.tsx` has **no press state on any variant, no hover on three of six, off-brand default motion, two malformed dangling `dark:` prefixes, and 32–36px sizes**; the edge badge is three anatomies; the LINEUPS button has no disabled/empty state (tap → "Batting order not posted yet"); four tracker inputs and the chat composer lack accessible names; icon language is four systems (77 lucide + 46 inline SVG + text glyphs + admin emoji). (DIME-UI-006, -008, -013, -022, -025)

### Lens 5 — Motion · **58**
The brand curve (160ms `cubic-bezier(0.16,1,0.3,1)`) covers 85/107 CSS literals, the chat drawer runs on a critically-damped, retargetable spring (`lib/springSettle.ts` — genuinely Apple-grade), theme switching is a guarded View-Transition crossfade, and measured CLS ≈ 0.0002. But: ~197 interactive declarations ride Tailwind's default 150ms curve (`transition-all` ×86, bare `transition-colors` ×114), every Radix overlay animates via non-interruptible keyframes that also **ignore reduced motion** (SEV-1), the sheet uses banned `ease-in-out`, the sidebar `ease-linear`, four keyframes are unguarded, and the feed skeleton is a static single-column ghost of a three-column card. (DIME-UI-003, -007, -019, -023, -027)

### Lens 6 — Hierarchy & ergonomics · **62**
Wayfinding is solid in the shell (active rail + inverse pill + labeled sidebar; the feed answers where-am-I instantly). The failures are priority inversions: on mobile the model's verdict — the product — renders at y≈648 of an 844px viewport, below two pitcher headshots and their W–L lines (uniform across widths, so structural); the always-mint "Chat with dime" pill outshouts the actual current-page indicator and swaps to a hardcoded "3,000 credits" placeholder when active; all five primary destinations live in the top 112px of the phone screen (a deliberate top-nav choice, but every nav action costs a hand reposition); the card itself navigates nowhere (popover-only depth); the splits pane renders the wordmark twice. H2's "three affordances, one destination" was refuted — the real issue is the opposite. (DIME-UI-009, -010, -034)

### Lens 7 — Accessibility · **68**
Systemic strengths: a zero-specificity global 2px mint `focus-visible` ring, correct `aria-current` on nav, aria-labels on the icon buttons that matter, reflow clean at 320/640 with no horizontal scroll, `overscroll-behavior` and safe-areas handled, reduced-motion handled at three layers (CSS kill-list, JS gates, per-component). The holes: overlays outside the reduced-motion net; a focus ring that fades in over 160ms instead of appearing instantly (DIME-UI-043); two scroll containers in the tab order of *every* card (28 tabs ≈ 6 cards) and no skip link; sub-AA muted labels; unnamed form inputs; 40 `outline-none` sites without a same-line replacement (most covered by the global ring, several genuinely bare — BettingSplits search, PublishProjections inline cell, TabsContent). Screen-reader semantics of "-103" odds strings were not exercised — UNKNOWN. (DIME-UI-002, -005, -012, -013, -024)

### Lens 8 — Copy & numeric formatting · **60**
The projections system is disciplined: real minus (U+2212) via `formatEdge`, one-decimal edges, "Model estimates, not guarantees. 21+ · 1-800-GAMBLER" on every surface (responsible-gaming law respected). Drift lives at the seams between the two card generations and surfaces: `+x.x%` vs `x.xx% ROI` vs `EDGE: x PTS` formats; `100 %` vs `100%`; `WP% 0.0%` beside `ROI% 0%`; Model edge / MODEL EDGE / Edge casing variance; a stale hardcoded "July 7, 2026" prompt pill on `/chat`; and the tracker telling users "No MLB games on 07/31/2026" while the feed lists fifteen. (DIME-UI-008, -020, -021, -028)

### Lens 9 — Code-level provenance · **40**
The groomed-surface / generated-bones split is stark. Clean: 3 TODOs, zero commented-out code, 1 contradictory utility stack in 3,482 class strings. Damning: two ~5,100-line components; three styling paradigms across sibling cards (170 inline styles vs BEM CSS vs Tailwind); six independent `TeamLogo`s, six `fmtOdds`, renamed-but-identical helpers; 71 cross-file duplicated 6-line blocks; `// [VERIFY] … ✓` self-audit comments; a `hexLiteralCeilings.json` ratchet that admits ~1,760 frozen literals; dead components still carrying the retired purple/gold palette; 189 console.logs narrating auth state; comments still teaching JetBrains Mono/Barlow/gold as if current. (DIME-UI-016–018, -026, -029, -031, -032, -036)

---

## Slop Index — 34/100, justified by counts

Present (weighted in): unmodified-shadcn button/overlay behavior under the skin (0 press states, tw-animate defaults); default-easing on ~197 interactive elements; 853 arbitrary values / 1,557 raw hex; emoji-as-UI on 13 files (admin-scoped); four icon systems; copy-paste sibling drift incl. `100 %`; monoliths and duplicate helpers; self-verify comments; dead code (4 orphaned styled artifacts); skeleton that doesn't match content; identical card padding regardless of density is **absent** (density is designed); stale placeholder data ("3,000 credits", July 7 pill).

Absent (weighted out): purple/indigo washes, gradients, glass, mesh/aurora, neon, gold, sparkle/AI badging on primary surfaces, centered-everything, one-shadow-everywhere (4 deliberate shadows on feed), default Tailwind grays (12 hits, all *defensive* overrides), undesigned light theme, missing loading/empty/error states on the primary surface, hover-dependent primary affordances.

## Coverage, evidence, and limits

`COVERAGE.md` holds the full route × breakpoint × theme × state matrix with explicit UNKNOWNs (admin/* and owner-gated data surfaces chief among them; WebKit/Firefox unverified; true browser-zoom 200% approximated by 640px viewport reflow per the repo's own precedent). Every SEV-1/2 evidence pointer was re-resolved against source or captured pixels before filing; three findings were pulled when their pointers failed (see FINDINGS.md tail). Remediation order and acceptance criteria: `SOL_HANDOFF.md`.
