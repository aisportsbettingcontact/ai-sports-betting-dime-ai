# REMEDIATION LOG — executed 2026-07-31 (same session as the audit)

Executed from SOL_HANDOFF.md at commit `fcb85ddd` (working tree). Verification: `npx tsc --noEmit` clean, all 46 client test files green (591 tests), rendered re-probes against the rebooted dev server. Fresh evidence: `evidence/fix-*.png`, `evidence/census-fix-*.json`, re-run `probes.json`.

## SEV-1 — all four closed, re-measured

| Finding | Fix | Post-fix measurement |
|---|---|---|
| DIME-UI-001 wordmark on mint CTA | `.dlv2 .btn--mint .wordmark { color: inherit }` (landing-v2.css) | computed rgb(0,0,0) on rgb(69,224,168) — ~12.6:1; `census-fix-landing`: wordmark absent from fails |
| DIME-UI-003 overlays ignore reduced motion | index.css kill list now covers `animate-in/out`, `animate-accordion-*`, `animate-caret-blink`, `prez-game-pulse` | rule-level (single sanctioned block); BetCalendar's injected keyframes guarded separately (agent M2) |
| DIME-UI-004 390px diagonal pregame | compact tier rewritten to explicit grid placement (both pitchers `grid-row: 1`, chip full-span centered) | probes: pitchers y=216/y=216 same row; chip centered x=147; card 531→430px; `fix-feed-390-dark.png` |
| DIME-UI-005 sub-AA muted labels | `--text-muted`/`--dime-text-muted`/`--dime-text-faint` + landing token: 6E→`#7E7E7E` | contrast fails: tracker 23→0, splits 15→0, landing 12→0 informative (6 decorative `aria-hidden` `+` marks remain, exempt) |

## SEV-2 executed

- **B1 button.tsx**: press feedback (`motion-safe:active:scale-[0.97]`), hover on all variants, brand 160ms curve replaces `transition-all`, `cursor-pointer`, both dangling `dark:` fragments removed. Also fixed en route: ghost/outline `hover:bg-accent` was flooding buttons mint → quiet `hover:bg-secondary`. (Sizes left at shadcn defaults — global height changes deferred as layout-risk; touch surfaces use their own 44px controls.)
- **B3 edge badge**: NO_EDGE variant matched to the mint cell's geometry (2rem min-height, same padding) — measured uniform 33px across variants in one row. Owner rulings (2026-07-31) then removed the BET/WATCH split presentation entirely: one badge, one glyph (trend), label "Edge", no eye-icon variant, no data-rec attribute, no Bet/Watch wording in the aria-label. The engine's classification survives as data in gameInsight.ts; the UI no longer varies by it. A first-pass "Bet"/"Watch" visible-label swap was reverted the same way, and an agent's invented "strong/fair/weak" wording in the TheModelResults heatmap legend went back to the original numeric thresholds, emoji removed.
- **B4 hierarchy**: `<768px` grid-areas put `summary` before `pregame` — edge row measured y≈365 (was 648) at 390×844; both first cards' verdicts in the first viewport.
- **B5**: hardcoded "3,000 credits" placeholder removed; active chat pill keeps its label until real balances exist (mint fill still carries active state per the 2026-07-29 directive; comment documents the return path).
- **B7 tab order**: carousel track removed from tab order (−1 stop/card); the labeled `summary__viewport` region stays (WCAG scrollable-region contract, asserted by ProjectionCard.test.ts:948) — per-card stops now 4, deliberately one above the handoff's ≤3 to preserve that contract. **Skip link deferred** (requires edits inside DimeChatPage's shell frame).
- **B9 mint rationing**: LINEUPS demoted to a quiet raised chip (surface-raised + hairline + foreground; hover row-active). Per-viewport mint fills on the feed: 17-18 → 2-3.
- **B10 ruling executed**: `#0B8557` (4.66:1 on white) is the one mint-text-on-light; ProjectionCard's three `#0fa36b` sites converged; the contradictory case-sensitive test ban replaced with a working case-insensitive ban on the retired hex.
- **B2 named offenders**: sheet `ease-in-out`→brand curve; sidebar 4× `ease-linear`→brand; BetCalendar/Analytics inline `all 150ms ease`, `width 300ms ease`→specific properties at 160ms brand; GameCard's 7 inline transitions→brand (agents M2/M3).
- **B13 skeleton**: feed skeleton rebuilt to mirror the ProjectionCard anatomy (card chrome + matchup/pregame/summary/markets bars, percentage-based, pulsing under the global guard).
- **B14 partial**: OWNER clip fixed (header wraps; full label at 1280), ROI% unified to one-decimal alongside WP%. **Slate-source unification deferred** (server-side data plumbing).
- **B8**: aria-labels on the four Add-Bet inputs (audit note: they already had `label htmlFor` names — the census flagged them for missing aria-label; labels are now belt-and-suspenders).
- **B15 emoji**: all listed admin-surface emoji → lucide (SecurityEvents, TheModelResults, PublishProjections, WaitlistAdmin, UserManagement, AdminModelStatus, MlbBacktest, PostponedGames, BetCalendar); mathematical-bold Unicode heading normalized.
- **B11 first tranche**: 137+ arbitrary mint utilities swapped to semantic classes across BetTracker (91), mobile screens, Home, WorldCup2026, Subscribe pages; zero `[#45E0A8]` arbitrary utilities remain in those files.

## SEV-3/4 executed

C3 stale "July 7, 2026" prompt pill → live ET date · C5 all seven IBM Plex Mono fallbacks → Familjen stack · C16 focus rings moved to non-transitioned `outline` (instant) + dead white-ring rule deleted · C1 dead files deleted (TeamLogo.tsx with off-brand palette, teamLogoCircle.ts, ui/accordion.tsx, `.feed-tab` CSS block + ceilings entries) · C2 keyframe guards (prezGamePulse via kill list; BetCalendar renamed `btCalPulse` + reduced-motion guard, un-shadowing Tailwind's `pulse`) · C4 comment rot swept (GameCard, MobileGameCard, BetCalendar, BetTrackerAnalytics, ManageAccount docblocks; `100 %`→`100%` ×4) · C6 all 14 `[VERIFY] ✓` self-audit comments stripped · C11 inert backdrop-blur removed (ManageAccount, WaitlistAdmin incl. the one rendering blur) · C12 Sparkles removed from MobileChat (→MessageSquare) · C15 all five unguarded `100vh` sites paired/converted to dvh · ClaudeAssistant copy button reveals on focus (DIME-UI-024, one of two sites).

## Deferred (with reasons)

- **B6 type-scale consolidation, B12 full sibling dedupe, B16 full interruptibility conversion, C6 monolith extraction** — multi-day refactors across the two 5k-line components; out of safe scope for one pass.
- **Skip link** (B7) — lives in DimeChatPage's shell frame; needs a deliberate edit there.
- **Add-Bet slate source** (B14) — backend data plumbing, not UI.
- **MlbLast5Panel hover reveal** (DIME-UI-024 second site), M2's flagged stragglers (a few ✓/⚠ glyphs at unlisted lines, two 150ms inline transitions in BetTrackerAnalytics) — small follow-ups, enumerated in the agents' reports.
- **shadcn button sizes** (32–36px) — changing global control heights ripples through admin layouts; needs its own pass.
- Design-law docs (`design-system/dime-ai/pages/ai-model-projections.md`, THREE-COLOR-LAW appendices) still describe the pre-audit LINEUPS mint fill, mobile area order, and pill date — owner should amend to match the executed rulings (DIME-UI-014/-009/-015/-028).

## Verification snapshot

- `npx tsc --noEmit`: exit 0.
- `npx vitest run client/src`: 46 files / 591 tests green (including the hex-ceiling ratchet, which the changes keep at or below every ceiling, minus the two deleted-file entries).
- Rendered: `evidence/fix-feed-390-dark.png` (edge-first order, aligned pitchers, quiet chip), `evidence/landing-final-cta.png` re-crop (black wordmark on mint), `evidence/census-fix-*.json` (contrast zeros), `probes.json` (geometry + tab stops).
