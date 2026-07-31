# SOL_HANDOFF — remediation queue

Execute in order. Each item: what to change (direction, not code), acceptance criterion, and the exact verification step that proves it fixed. Repro rig for rendered checks: boot `DISABLE_BACKGROUND_JOBS=1 PORT=3910 NODE_ENV=development npx tsx server/_core/index.ts`, then drive with Playwright (repo's own `node_modules/playwright/index.mjs`); `?preview=1` unlocks shell surfaces ≥768px; for sub-768 authed surfaces intercept the `appUsers.me` tRPC item client-side as done in `evidence/` scripts (never bypass server auth). "Census script" = the audit's `census.mjs`/`probes.mjs` pattern; re-running the same evaluate functions is the verification.

## Queue A — SEV-1 (ship blockers)

**A1 · DIME-UI-001 — wordmark contrast on mint CTA** ([FinalCTA.tssx→](../../client/src/pages/dime/landing/components/FinalCTA.tsx#L15), landing CSS `.btn--mint` / `.wordmark`)
Change: on mint fills, render the wordmark in black ink (same treatment as the adjacent "Get access ·" text), per the black-on-mint law.
Accept: computed contrast of every text node inside every `.btn--mint` ≥ 4.5:1 in both themes.
Verify: run the contrast census on `/`; assert `contrastFails` contains no entry with `cls` containing `wordmark` or `btn--mint`; screenshot the final CTA and confirm no white glyphs on mint.

**A2 — removed.** The original DIME-UI-002 ("focus-invisible no-edge arrow") was pulled after a settled re-measurement showed the mint ring present on both variants; its residuals are C16 below.

**A3 · DIME-UI-003 — reduced-motion coverage for overlay animations** ([index.css:303-320](../../client/src/index.css#L303))
Change: extend the reduced-motion kill block to `animate-in`, `animate-out`, `animate-accordion-down/up`, `animate-caret-blink` (tw-animate classes), keeping the existing four.
Accept: with `prefers-reduced-motion: reduce`, opening the LINEUPS dialog, any popover, sheet, or drawer produces no keyframe animation (cross-fade or instant is acceptable per law).
Verify: Playwright context `reducedMotion: 'reduce'` → open LINEUPS dialog on the feed → `document.getAnimations()` returns no entries whose `animationName` matches `/enter|exit|accordion|caret/`.

**A4 · DIME-UI-004 — 390px pregame panel layout** ([ProjectionCard.css:292-333](../../client/src/components/projections/ProjectionCard.css#L292) tier logic; note the audit measured `position: relative` where the tier specifies `absolute`, i.e. the compact tier is not applying in the standalone mobile feed)
Change: make the compact-card tier actually apply below 768 in the standalone feed (diagnose why the container/media condition misses at card width 358px), or design an explicit stacked layout.
Accept: at 390×844 dark, the two `.pregame-pitcher` boxes share the same top y (±4px) OR are deliberately full-width stacked with the chip in flow; no overlap between chip and pitcher text; no empty 100px+ diagonal void.
Verify: re-run the geometry probe (evidence/probes.json → feed-390-geometry): assert `pitchers[0].y === pitchers[1].y` (±4) or both `w ≥ 300`; screenshot-compare against `evidence/feed-390-dark.png` (the failing baseline).

**A5 · DIME-UI-005 — sub-AA muted labels** ([index.css:191](../../client/src/index.css#L191) `--text-muted`, consumers `bt-label`/`bt-faint`/splits/landing captions)
Change: add a small-text muted token ≥4.5:1 on its darkest ground (light theme already ships `#767676`-class values); route all 10–13px labels to it; keep `#6E6E6E` only for ≥24px/decorative.
Accept: contrast census on `/bet-tracker`, `/betting-splits/mlb`, `/` reports zero failures at need=4.5.
Verify: re-run census on those three routes, both themes; `contrastFailTotal === 0` excluding aria-hidden/decorative nodes (DIME-UI-040's `+` markers must be `aria-hidden` to be excluded).

## Queue B — SEV-2 (design-lead blockers)

**B1 · DIME-UI-006 — shared button states** ([ui/button.tsx:7-30](../../client/src/components/ui/button.tsx#L7))
Depends on: none, but do before any surface polish so consumers inherit it.
Change: add `:active` press (scale ~0.97) + hover treatment to all variants; brand duration/curve; remove the two dangling `dark:` fragments (lines 16, 20); introduce touch-min sizes.
Accept: every variant shows press feedback on pointer-down; no bare `transition-all`; `grep -n 'dark:"' ` and `grep -n "dark: "` on the file return nothing malformed; rendered buttons on touch surfaces measure ≥44px.
Verify: unit-grep the file for `active:` (≥1 per variant path), and Playwright `page.mouse.down()` on a feed-adjacent button asserting computed transform ≠ none while pressed.

**B2 · DIME-UI-007 — motion token sweep**
Change: alias Tailwind's default transition duration/curve to the brand values at the theme layer (or lint-ban `transition-all`/bare `transition-colors`), fix the named offenders: sheet `ease-in-out`, sidebar `ease-linear` ×4, BetCalendar/Analytics inline `all 150ms ease`, GameCard `grid-template-columns 200ms ease` ×4, Analytics `width 300ms ease` ×2, JourneyFunnel `320ms ease-out`.
Accept: computed `transition-timing-function` on interactive elements resolves to `cubic-bezier(0.16, 1, 0.3, 1)` and duration ≈160ms (tolerated exceptions: reduced-motion resets, the two pulse indicators).
Verify: census-style evaluate collecting `transitionDuration`/`transitionTimingFunction` over `a,button,[role=button]` on feed/splits/tracker — distinct easing set = 1, distinct duration set ⊆ {0.16s} (+`0s`).

**B3 · DIME-UI-008 — one edge-badge anatomy** ([EdgeIndicator.tsx](../../client/src/components/projections/EdgeIndicator.tsx))
Change: single badge geometry for BET/WATCH/NO_EDGE (same min-height, same slot structure); make BET vs WATCH legible in visible text (the words exist — they're currently aria-only); keep the arrow's presence/absence rule but give it one style.
Accept: across a mixed slate, all badges share height and internal layout; a WATCH badge is distinguishable from BET without decoding a 14px icon.
Verify: card-geometry census — `badge.h` identical across all cards; screenshot of a mixed row (baseline: `evidence/feed-1280-dark.png` showing EDGE+glyph vs ROI-plain).

**B4 · DIME-UI-009 — edge above pitchers on mobile** ([ProjectionCard.css:26-29](../../client/src/components/projections/ProjectionCard.css#L26) grid areas)
Change: below the shell boundary, order scheduled-card areas so summary (edge) precedes pregame; keep DOM order stable for AT if possible (grid-area reorder, documented).
Accept: at 390×844 the first card's edge badge top ≤ 480px (visible with the full matchup header), pitchers below it.
Verify: firstViewportOrder probe — "Model edge" y-coordinate < pitcher-name y-coordinate.

**B5 · DIME-UI-010 — nav current-signal conflict** ([mobileFloatingNav.css:202-216](../../client/src/features/mobileNav/mobileFloatingNav.css#L202), [MobileFloatingNav.tsx:164-176](../../client/src/features/mobileNav/MobileFloatingNav.tsx#L164))
Owner input needed: the chat pill's always-mint treatment and the credits flip are dated directives (2026-07-29) — confirm before changing. If approved: inactive chat pill becomes outline/ghost; mint fill only when chat is current; remove the "3,000 credits" literal until the credits system ships real data.
Accept: exactly one nav element carries mint fill at any time, and it is the current page or the single sanctioned CTA — not both; no hardcoded credit values in the bundle.
Verify: `grep -rn "3,000 credits" client/src` → 0; screenshot at `/feed` and `/chat` at 390px: count mint-filled nav pills = 1.

**B6 · DIME-UI-011 — one type scale**
Change: migrate fixed-px text utilities on the feed/shell to the `--fs-*` tokens; delete per-element clamp() in favor of the token scale (GameCard's 63 triples burn down with DIME-UI-017/018's refactor).
Accept: distinct rendered font sizes on the 1280 feed viewport ≤ 12, with no two sizes within 0.6px of each other.
Verify: typography census — `distinctFontSizes.length ≤ 12`, no near-collision pairs.

**B7 · DIME-UI-012 — tab order** — remove `tabindex` from `summary-carousel__track`/`summary__viewport` (keep one scrollable focusable OR arrow-key the carousel); add a skip-to-content link as first tab stop.
Verify: keyboard walk — first Tab lands on skip link; per-card tab stops ≤ 3 (lineups, arrow-if-present, markets toggle).

**B8 · DIME-UI-013 — name the inputs** — aria-labels/labels for the 4 `bt-input` fields and `dc-composer-input`.
Verify: census `unnamedIconButtons` (which includes unnamed inputs) = 0 on `/bet-tracker` and `/chat`.

**B9 · DIME-UI-014 — mint rationing on the card** — LINEUPS to outline/ghost so the edge badge is the sole mint object.
Verify: mint census on feed 390: `bg` count attributable to per-card fills = 1 per card (the edge badge tint/rail), not 2.

**B10 · DIME-UI-015 — mint-on-light ruling** — owner decides `#0FA36B` vs `#0B8557`; then converge tokens and fix the case-sensitive contradictory guard in [dimeModelFeed.test.ts:180-184](../../client/src/pages/dimeModelFeed.test.ts#L180).
Verify: `grep -rniE "#(0FA36B|0B8557)" client/src` returns only the chosen hex (token definitions + guards agreeing).

**B11 · DIME-UI-016 — hex ratchet burn-down (mechanical first tranche)** — replace the 178 arbitrary-mint utilities (`text-[#45E0A8]` → `text-primary` etc.), ratchet BettingSplits.tsx and TrendsPage.tsx ceilings to 0.
Verify: `npx vitest run client/src/hexLiteralCeiling.test.ts` green with lowered ceilings; `grep -rn "\[#45E0A8\]" client/src --include="*.tsx" | wc -l` → 0.

**B12 · DIME-UI-017/018 — dedupe siblings** — extract shared `fmtOdds`/`toNum`/`TeamLogo`/bar-segment; normalize `100 %`→`100%` and the 4px/9999px radius split.
Verify: `grep -rn '"100 %"\|100 %' client/src --include="*.tsx"` → 0; one exported implementation each for fmtOdds/TeamLogo with all call sites importing it.

**B13 · DIME-UI-019 — skeleton parity** — feed skeleton mirrors the loaded card grid (all three columns) and adopts the app's one pulse treatment.
Verify: screenshot-diff skeleton vs loaded card bounding boxes: column count equal, card height delta < 8px.

**B14 · DIME-UI-020/021 — tracker header + slate source** — fix "OWNI" clipping; unify percent formatting (decide decimals per metric); point Add-Bet's game list at the feed's slate.
Verify: 1280 screenshot shows full "OWNER" label; `WP%` and `ROI%` share format; on a day the feed shows N games, Add-Bet lists N games (compare both surfaces same-day).

**B15 · DIME-UI-022 — de-emoji admin surfaces** — replace the 13 files' emoji glyphs with lucide equivalents; remove mathematical-bold Unicode headers.
Verify: emoji grep over client/src (excluding tests/comments) → 0 rendered emoji in JSX.

**B16 · DIME-UI-023 — interruptible disclosure motion** — overlays/accordions to transitions or `springSettle`; keyframes only for one-shot pulses.
Verify: mid-flight reversal test: open then immediately close the LINEUPS dialog — no restart-from-zero jump (record with `page.video` or getAnimations timing).

**B17 · DIME-UI-024 — hover-only reveals** — add `focus-visible:opacity-100` + touch fallback to ClaudeAssistant copy button and MlbLast5Panel link.
Verify: keyboard-focus each control; computed opacity = 1.

## Queue C — SEV-3/4 (craft debt; batch freely)

- **C1 · -026/-041**: delete dead artifacts — `components/TeamLogo.tsx`, `lib/teamLogoCircle.ts`, `ui/accordion.tsx`, `.feed-tab` CSS block. Verify: grep for each name → only history; bundle builds green.
- **C2 · -027**: guard `prezGamePulse`, `todayPulse`, BetCalendar `pulse` (and namespace it). Verify: reduced-motion context → `document.getAnimations()` empty on BetTracker calendar.
- **C3 · -028**: chat prompt pills derive dates from the slate. Verify: pill text contains today's slate date.
- **C4 · -029**: comment-rot sweep (list in FINDINGS). Verify: `grep -rniE "39FF14|JetBrains|Barlow|gold" client/src --include="*.tsx" --include="*.css"` returns no *doctrinal* comments (loss-red/danger prose OK).
- **C5 · -030**: replace IBM Plex Mono fallbacks in ProjectionCard.css; drop the unused font load in frozen-tokens. Verify: `grep -rn "IBM Plex" client/src` → 0 outside comments; fonts request log shows no Plex download.
- **C6 · -031/-032**: extract GameCard/BetTracker sub-components opportunistically; strip `[VERIFY] … ✓` comments. Verify: `grep -rn "\[VERIFY\]" client/src` → 0.
- **C7 · -033**: one hit-area utility. Verify: both date arrows and compact LINEUPS use the same class/pattern.
- **C8 · -034**: splits pane header names the surface. Verify: screenshot shows one wordmark per viewport.
- **C9 · -035**: radii onto the token scale. Verify: census radii set ⊆ documented scale (+50%).
- **C10 · -036**: strip/gate console logging. Verify: loading `/feed` logs nothing at info level in production build.
- **C11 · -037**: remove WaitlistAdmin inline blur + 16 inert backdrop-blur classes. Verify: `grep -rn "backdrop" client/src --include="*.tsx"` → 0 live.
- **C12 · -038**: replace `Sparkles` in AIChatBox/MobileChat (admin usages optional). Verify: `grep -rn "Sparkles" client/src` → admin-only or 0.
- **C13 · -025**: `‹›▲` → lucide chevrons/triangle; dedupe double-imported lucide concepts. Verify: no bare text-glyph icons in DimeModelFeed/GameCard renders.
- **C14 · -039/-040/-042**: red-only-when-nonzero losses; `aria-hidden` on decorative `+`; refresh the stale kill-list comment count.
- **C16 · -043/-044**: make focus rings appear instantly (exclude box-shadow/outline from the `.summary__next` transition on focus) and delete the dead white-ring override at ProjectionCard.css:591-593. Verify: computed ring present within one frame of keyboard focus; grep shows no `--foreground` focus ring on the no-edge arrow.
- **C15 · H5 residue**: pair the five unguarded `100vh` sites with `100dvh` fallbacks (MlbBacktest:180, WaitlistAdmin:383, ClaudeAssistant:130, CheckoutPage:616, landing-v2.css:44). Verify: grep shows every `100vh` adjacent to a `dvh` line.

## Re-audit gate

After Queue A+B: re-run the four census jobs (feed 1280 dark/light, feed 390 dark, tracker 1280) and the three probes (geometry, keyboard, reduced-motion). Ship gate: zero SEV-1 reproductions, `contrastFailTotal = 0` on product surfaces, one easing/duration pair, per-card tab stops ≤ 3, and the 390px card geometry assertion green.
