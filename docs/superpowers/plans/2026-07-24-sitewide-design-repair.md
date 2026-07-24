# Sitewide Design Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the 28 in-session-fixable canonical defects from the 2026-07-24 five-agent sitewide design audit (74 raw findings, reconciled ledger in the session evidence dir), without violating Dime brand law.

**Architecture:** Root-cause fixes ordered foundations → landing → auth surfaces → checkout/docs pages → feed/chat/404 → law-documentation sync. Every change traces to a canonical defect ID (D-*). No new dependencies, no schema, no route changes except deleting dead code.

**Tech Stack:** React 19 + wouter + Tailwind 4 (`@theme` in `client/src/index.css`) + Express dev server. Verification: `tsc --noEmit`, Playwright probes against the dev server (BROWSER_EMULATION, Chromium 1194), targeted width sweeps.

## Global Constraints

- THREE-COLOR-LAW (v2+v3) wins over MASTER.md where they disagree; mint `#45E0A8` is the only accent; negative states are grey, never red (scoped `--loss-red` exception).
- Single-font mandate: Familjen Grotesk only (`index.css:7-12`); never reintroduce IBM Plex Mono / Barlow / Inter.
- One motion curve: `160ms cubic-bezier(0.16,1,0.3,1)`; `prefers-reduced-motion` collapses all animation.
- Micro-label floor: 11px (`index.css` READABILITY MANDATE); touch targets ≥44px; text contrast ≥4.5:1 small / ≥3:1 large.
- Owner directives in `design-system/dime-ai/pages/*.md` are binding (e.g. emoji flags stay per 2026-07-18 directive).
- No `!important`, no new arbitrary hex in components (use tokens), no dead controls, no placeholder copy.

---

### Batch B1: Foundations (index.css, index.html, dead code)

**Files:**
- Modify: `client/src/index.css` (flex utility, reduced-motion guard, focus baseline)
- Modify: `client/index.html` (remove GG Sans block, shell reduced-motion, boot-error state, title)
- Delete (precondition: grep proves zero imports): `client/src/components/AppLoadingShell.tsx`, `client/src/hooks/useViewportScale.ts`, `client/src/pages/ModelProjections.tsx`, `client/src/pages/ModelResults.tsx`, `client/src/pages/F5EdgeLeaderboard.tsx`, `client/src/pages/MobileBetTracker.tsx` (+ any orphaned single-consumer imports of those files)

- [ ] **B1.1 (D-FLEX-MINH):** Replace `.flex { min-width: 0; min-height: 0; }` with `:where(.flex) { min-width: 0; min-height: 0; }` so explicit `min-h-*`/`min-w-*` utilities win (`:where()` has zero specificity). Verify: probe `/nonexistent` 404 at 1440×900 — container height ≥ 900 (was 488).
- [ ] **B1.2 (D-GGSANS):** Delete the four `@font-face` "gg sans" declarations in `client/index.html`. Verify: probe `/` — zero CSP font console errors (was 4).
- [ ] **B1.3 (D-SHELL-MOTION):** Wrap shell keyframe animations in `@media (prefers-reduced-motion: no-preference)`; delete the no-op `shell-logo-pulse` keyframes+usage. Verify: probe `/` with `--reduced-motion` — no animating shell elements.
- [ ] **B1.4 (D-BOOT-ERROR):** In the shell force-dismiss script, instead of removing the shell silently at 8s, swap its content to a visible failure notice (plain text + a real reload `<button>`, brand tokens, no animation) when `#root` is still empty. Verify: block `/src/main.tsx` via Playwright route intercept → error notice appears with working reload button.
- [ ] **B1.5 (D-PULSE-REDUCE):** Add to `index.css`: `@media (prefers-reduced-motion: reduce){ .animate-pulse, .animate-spin, .animate-bounce { animation: none !important; } }` (the one sanctioned `!important`: it must beat utility layers; MASTER.md mandates pulses disabled under reduce). Verify: 404 probe with `--reduced-motion` — no running animations.
- [ ] **B1.6 (D-FOCUS-UNIFY):** Strengthen base focus: replace `outline-ring/50` with a visible `:focus-visible` treatment (2px solid `var(--ring)`, offset 2px) in `@layer base`. Verify: keyboard-walk probe screenshots on `/` and `/login`.
- [ ] **B1.7 (D-DEADCODE):** `grep -rn "ModelProjections\|ModelResults\b\|F5EdgeLeaderboard\|MobileBetTracker\|AppLoadingShell\|useViewportScale" client/src --include=*.tsx --include=*.ts` — delete each file only if its only references are self/dead-peer; also remove any now-unused shared-only-by-them helpers. Verify: `tsc --noEmit` clean.
- [ ] **B1.8:** Commit batch with per-defect trailer list.

### Batch B2: Landing (public conversion surface)

**Files:**
- Modify: `client/src/pages/dime/landing/DimeLandingV2.tsx` (hash scroll, mobile nav)
- Modify: `client/src/pages/dime/landing/landing-v2.css` (floors, slipbar, :active, contrast, dead blur)
- Modify: `client/src/pages/dime/landing/components/MarketSignals.tsx` (header/teaser contrast)
- Modify: `client/src/pages/dime/landing/landing-content.ts` + `server/landingPrerender.ts` (copy, kept in sync)

- [ ] **B2.1 (D-PRICING-HASH):** On mount and on `location` change, if `window.location.hash` matches a section id, `scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'})` after first paint (rAF). Verify: probe `/#pricing` → `scrollY > 4000`; also `/login → Sign up` click path.
- [ ] **B2.2 (D-LANDING-NAV) [NEW_DESIGN_DECISION ND-1]:** ≤820px, replace the hidden section links with a brand-law overflow menu: a real `<button aria-haspopup="menu" aria-expanded>` in the topbar opening a `--surface-raised`/14px-radius/`--shadow-menu` menu of the six section anchors (Escape + outside-click close, focus return). Rationale: MASTER.md menu spec exists; 5800px page needs jump nav (uipro `nav-hierarchy`, `persistent-nav`). Verify: probe 390×844 — menu opens, links navigate, `aria-expanded` toggles.
- [ ] **B2.3 (D-CONTRAST):** MarketSignals headers/teasers: replace `#444444`/`#4a4a4a` with law tier `--text-secondary` (#A6A6A6 dark ≈ 8.6:1). Landing muted mono labels used on interactive chips → `--text-secondary`; purely decorative micro-labels may stay `--text-muted` only where ≥3:1 large-text applies. Verify: computed-style contrast probe ≥4.5:1 on headers/chips.
- [ ] **B2.4 (D-DLV2-FLOOR):** Raise every sub-11px fixed size in `landing-v2.css` to ≥11px; change `.dlv2 { font-size:16px }` to `font-size:1rem` so user text-scale propagates. Verify: probe with 130% root font — landing text scales; no node <11px computed.
- [ ] **B2.5 (D-SLIPBAR):** Slipbar: `bottom: calc(18px + env(safe-area-inset-bottom, 0px))`; dismiss ≥44×44 (padding/hit-area), CTA ≥44px height. Verify: DOM rect probe at 390×844.
- [ ] **B2.6 (D-PRESS-STATE):** Add `:active` press feedback (opacity .85 / `transform: scale(.97)`; 160ms brand curve; guarded by reduced-motion for transform) to `.dlv2` buttons/CTAs and the shared `Button` primitive (`active:` variants). Verify: computed `:active` style probe.
- [ ] **B2.7 (D-MOTION-LAW, landing scope):** Normalize landing transition durations to 160ms brand curve; stop transitioning `width` (use transform/opacity). Verify: grep — no `width .* [0-9]+ms` transitions remain in `landing-v2.css`.
- [ ] **B2.8 (D-DEAD-BLUR):** Remove `backdrop-filter` under opaque backgrounds. Verify: grep zero `backdrop-filter` in `landing-v2.css`.
- [ ] **B2.9 (D-COPY-SLOP):** stop-slop pass on `landing-content.ts`: remove em dashes, "not X, Y" antitheses, negative listings, duplicated pull-quote; keep facts/specifics; mirror the exact same strings into `server/landingPrerender.ts`. Verify: `grep -c "—" landing-content.ts` → 0; prerender/client copy-sync spot-check; stop-slop score ≥40/50.
- [ ] **B2.10:** Commit batch.

### Batch B3: Auth surfaces

**Files:**
- Modify: `client/src/pages/Home.tsx` (labels, placeholder color, targets, tiers, rem headings)
- Modify: `client/src/pages/ResetPassword.tsx` (destination, aria-live, focus)
- Modify: `client/src/components/RequireAuth.tsx` (client-side navigation)

- [ ] **B3.1 (D-LOGIN-A11Y):** Visible or aria labels for every input (forgot-password identifier; chat composer if in scope); placeholder color → `--text-muted` (distinct from value); links/eye-toggle/micro-CTAs ≥44px hit areas; secondary copy → `--text-secondary` tier instead of flat white; h1 sizes → rem-based so text-scale applies. Verify: probe label coverage (every input has accessible name), rect probe ≥44px, computed placeholder color ≠ value color.
- [ ] **B3.2 (D-RESET-PW):** Success path routes to `/login` (the form the copy promises), errors in `role="alert"` container, `aria-invalid` + `aria-describedby` wiring, focus moves to first invalid field on error. Verify: component-level probe of the error branch (submit invalid → focus + announcement attrs present).
- [ ] **B3.3 (D-REQAUTH):** Replace `window.location.href = '/login?...'` with wouter `navigate('/login?returnPath=...', {replace:true})`; render a minimal inline "Redirecting to login…" state instead of the opaque shell. Preserve returnPath semantics exactly. Verify: probe a protected route unauthenticated — single SPA navigation (no full document reload: `performance.navigation` count / no second shell), lands on /login with returnPath.
- [ ] **B3.4:** Commit batch.

### Batch B4: Checkout + document pages

**Files:**
- Modify: `client/src/pages/dime/CheckoutPage.tsx` (fallback plan, h1, title)
- Modify: `client/src/pages/Privacy.tsx`, `client/src/pages/Terms.tsx` (escape nav, `<main>`, titles)

- [ ] **B4.1 (D-CHECKOUT-99):** Bare `/checkout` (no/unknown plan param) must not quote the retired `$99.99` plan: read the fallback at `CheckoutPage.tsx:183`, source the same catalog the landing sells ($99), or redirect bare hits to `/#pricing` if no canonical plan exists. Keep legacy per-day math out. Add `<h1>` to the error branch. Verify: probe `/checkout` — no "99.99" text; h1 present in error branch; `tsc` clean.
- [ ] **B4.2 (D-TITLES):** `document.title` effects: checkout ("Checkout — dıme"), 404 ("Page not found — dıme"), Privacy/Terms already partial — normalize suffix to the current brand (drop "AI Sports Betting Models"). Verify: title probe per route.
- [ ] **B4.3 (D-DOCS-ESCAPE):** Privacy/Terms: add a minimal header (wordmark link → `/`) + `<main>` landmark; open cross-links from checkout in new tab (`target="_blank" rel="noopener"`) so checkout state survives. Verify: probe — landmark exists, header link navigates, checkout link has target.
- [ ] **B4.4:** Commit batch.

### Batch B5: Feed error state, chat CSS, 404

**Files:**
- Modify: `client/src/pages/DimeModelFeed.tsx` (error vs empty)
- Modify: `client/src/pages/dime-chat/conversation.css` (font stack)
- Modify: `client/src/pages/NotFound.tsx` (icon contrast, motion law)

- [ ] **B5.1 (D-FEED-ERROR):** Distinguish query error from empty slate: on error render an error state ("Projections are temporarily unavailable." + retry `<button>` calling the query refetch; grey per law, no red) instead of "No games for this date"; keep the true empty state for successful empty responses. Per `design-system/dime-ai/pages/ai-model-projections.md` error-surface law. Verify: `tsc`; runtime probe limited to unauth redirect (auth-blocked) — code-level assertion via component reading + existing test patterns if present.
- [ ] **B5.2 (D-PLEXMONO):** Replace `'IBM Plex Mono'` stacks in `conversation.css` with `var(--font-sans)` (single-font mandate; keeps caps/tracking treatment). Verify: grep zero "IBM Plex Mono" in client/src.
- [ ] **B5.3 (D-404-POLISH):** 404: icon gets contrast (mint-on-dark disc per token, not white-on-white), pulse guarded by reduced-motion (B1.5 covers class-level), CTA duration → 160ms curve. Verify: probe screenshot + computed styles.
- [ ] **B5.4 (D-BG-SEAM):** Public pages that hardcode `bg-black`/`#000` page canvases (Privacy/Terms/Home/landing shell) → `bg-background` token so System (#121212)/Dark(#000)/Light(#fff) render coherent single-canvas pages. Verify: probe `/privacy` in default mode — body bg == page container bg.
- [ ] **B5.5:** Commit batch.

### Batch B6: Law-documentation sync

**Files:**
- Modify: `design-system/dime-ai/MASTER.md` (stale tokens note, support contract)
- Modify: `design-system/dime-ai/pages/signup.md` (typography drift note)

- [ ] **B6.1 (D-DOC-DRIFT):** Add a dated supersession note to MASTER.md typography (IBM Plex Mono retired by single-font mandate, `client/src/index.css:7-12`) and colors (dark bg is Law v2 `#000000`, not `#0B0B0F`); same note in signup.md where it names Plex Mono. Do not delete history — annotate.
- [ ] **B6.2 (D-SUPPORT-CTR) [NEW_SUPPORT_CONTRACT ND-2]:** Add "Supported viewport contract (NEW 2026-07-24, evidence-derived)" to MASTER.md: widths 320–1920 CSS px (sweep-verified 320–1440; 1441–1920 rule-derived), heights 500–1000+, DPR 1–3, zoom/text-scale 200%/130%, Chromium-class engines verified; WebKit/Firefox unverified. Label as NEW, never as pre-existing.
- [ ] **B6.3:** Commit batch. Update this plan's checkboxes.

### Verification (per batch + final)

- Per batch: `pnpm exec tsc --noEmit` (must stay clean), targeted probes listed above, `git status` reviewed, commit.
- Final (Phase 4, independent verifier context): full-route probe matrix (public routes × {dark,light,system} × {1440×900, 390×844} × reduced-motion), integer width sweep 320–1440 re-run on `/` + 404, console-error census (target: only the environment-proxy reset remains), production build `pnpm build`, gate arithmetic with exact numerators/denominators.

### Out of scope (deferred, documented in ledger)

X-HEX-EPIDEMIC (2,042 hex literals), X-DUAL-SYSTEMS (GameCard vs ProjectionCard consolidation), X-PX-SWEEP (381 arbitrary px), X-PY-CARDGEN (StrikeoutModel legacy card generator — owner call), X-ADMIN-ALPHA (auth-blocked admin scrims), X-IMPORTANT (dime-mobile.css remap layer + .feed-tab tiers), X-PRERENDER-V1 (prerender tonal tiers), X-STAR-ANCHOR, X-ZINDEX, X-LOSSRED-D, X-1023-IDIOM, X-STALE-RESIZE, X-OVERFLOW-X (removal requires full-matrix re-sweep first). Rejected as defects: R-CONNRESET (environment), R-CREST-GOLD (law exception), R-EMOJI-FLAGS (owner directive).

### Risks

- B1.1 `:where()` touches every flexbox — mitigated by full-route probe + width sweep re-run after B1.
- B3.3 RequireAuth is on every protected route — behavior must remain redirect-idempotent; verified with unauth probes of 3 gated routes.
- B2.9 copy must stay mirrored with prerender guard test — run the existing landing prerender test if present.
- Feed (B5.1) renders auth-gated; runtime verification of the healthy-data branch is impossible here (DB) — the error-branch change is code-verified + tsc only. Recorded honestly in gates.
