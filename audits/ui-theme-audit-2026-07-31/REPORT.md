# Dime AI — Dark/Light Theme Rendering Audit

**Date** 2026-07-31 · **Base** `main @ 4183a7a2` (post PR #261) · **Work branch** `ui/two-mode-theme` (worktree; the user's local tree untouched)

**Scope (owner directive):** retire the System theme (two modes only, Dark and Light), then audit rendering, coloring, display, readability, and visibility of both modes across all pages, screen sizes, viewports, and device classes. Testing-only mandate: no new elements or features — every change is a token value, a token consumer, or the removal of the retired mode.

---

## Part 1 — System mode retired

Two modes remain: **Dark** and **Light**. The "system" mode (2026-07-22 account-popover round) had been a visual alias of Dark since the D-BG-SEAM amendment; it is now removed end to end:

| Surface | Change |
|---|---|
| [ThemeContext.tsx](../../client/src/contexts/ThemeContext.tsx) | `ThemeMode = "light" \| "dark"`; `resolveTheme` = identity; stored `"system"` **migrates to `"dark"`** (the exact appearance it resolved to) and the persisted key is rewritten on first load; nothing-stored default = dark (matches App.tsx) |
| [ThemeSetting.tsx](../../client/src/components/ThemeSetting.tsx) + CSS | Two-segment Light \| Dark control (Monitor icon gone; grid 3→2) |
| Chat account popover ([DimeChatPage.tsx](../../client/src/pages/dime-chat/DimeChatPage.tsx)) | Same two-segment reduction |
| [ProjectionCard.css](../../client/src/components/projections/ProjectionCard.css) | Retired `data-theme-mode="system"` / `data-dmf-mode="system"` logo-keyline selectors |
| Tests | ThemeContext.test.ts rewritten for two-mode + migration semantics; ProjectionCard.test.ts and comingSoonGate.test.ts assertions updated; the two e2e System tests replaced with one stored-"system"→Dark migration test asserting ink, surfaces, and the rewritten localStorage value |

## Part 2 — Rendering matrix

**Method.** Dev server booted from the work branch (web-only, real data; sub-768 authed surfaces via client-side `appUsers.me` patching). Each cell loads the route in a fresh context with the theme pre-seeded and measures: WCAG contrast of every informative text node (4.5:1 small / 3:1 large; `aria-hidden` decoration excluded), invisible-text detection (< 1.35:1), horizontal overflow, raw-mint-text-on-light violations, theme application (html class + body background), broken images, blank-page detection, and page errors.

**Matrix.** 158 cells:
- **Routes (14):** landing `/`, feed `/feed/model/mlb`, splits `/betting-splits/mlb`, tracker `/bet-tracker`, chat `/chat`, login, privacy, terms, 404, checkout, profile, account, wc2026, admin
- **Widths:** core surfaces (landing/feed/splits/tracker/chat) at **320 / 375 / 390 / 430 / 768 / 834 / 1024 / 1280 / 1440 / 1920 px**; secondary routes at 390 / 768 / 1440
- **Themes:** dark and light, every cell (`localStorage["dime-theme"]` + matching `prefers-color-scheme`)
- **Device classes:** phone/tablet widths run with touch enabled; DPR 2 baseline plus DPR 3 (phone) and DPR 1 (desktop) spot cells
- Evidence: `evidence/matrix-results.json` (pre-fix), `evidence-fix/` (fix iterations), `evidence-final/matrix-results.json` (confirmation run) + screenshots

## Findings — 3 defect classes (16 flagged cells), all light-mode, all fixed

**All 142 dark-mode and remaining light-mode cells passed on the first run** — theme application correct in every cell, zero overflow at every width 320–1920, zero blank pages, zero broken images, zero page errors, and identical results at DPR 1/2/3.

### THEME-1 · Bet Tracker light mode (10/10 widths) — raw mint text + sub-AA labels + red
- `text-primary` resolves to raw `#45E0A8` in both themes (correct for fills); as tracker TEXT on light it measured **1.68:1** (sport tabs, period pill, stat values). Fix: scoped light-mode override maps tracker mint text onto the sanctioned mint-text tone ([dime-mobile.css](../../client/src/styles/dime-mobile.css) `.bt-page .text-primary`, same defensive pattern the file already uses).
- Light muted labels (`--dime-text-muted: #767676`) measured **4.24:1 on F7-tier cards** → darkened one step to `#6e6e6e` (4.8:1 on cards, 5.1:1 on white).
- Bet-loss red `#FF3B3B` measured **3.3:1 on light** → light `--loss-red` is now `#D92D2D` (4.8:1); dark keeps `#FF3B3B` (5.9:1). Root cause was dual token ownership with opposite theme conventions (index.css dark-default vs dime-mobile light-default) — both scopes now declare both themes explicitly, load-order-proof. The theme-blind `text-[#FF3B3B]`-style literals in BetTracker moved to `var(--bt-red)`-driven utilities (hex count reduced).
- Canonical mint-text-on-light stepped `#0B8557` → **`#0A7C50`** everywhere (4 sites + tests): the previous value passed on pure white (4.66:1) but measured **4.35:1 on the F7-tier cards** it actually sits on. One value, passes on every light surface (5.2:1 white / 4.9:1 cards).

### THEME-2 · Login light mode (3/3 widths) — half-themed dark page
The login page is dark-fixed by explicit design (inline `background: "#000000"` on its root), but its secondary text rode the flipping `--text-secondary` token → dark grey on black, **3.0:1**, at all widths. Fix: the dark-fixed page pins `--text-secondary`/`--text-muted` to their dark values on its root — same doctrine as the dark-fixed landing. Renders identically in dark; light-mode visitors now get the same legible dark page.

### THEME-3 · Manage Account light mode (3/3 widths) — invisible text (white on white)
Brand line, "Manage account" heading, and the username rendered `text-white` on themed surfaces → **1.07:1 (invisible)** in light. Fix: six hardcoded `text-white`/`border-white` instances on themed surfaces moved to `text-foreground`/`border-border-strong`. Dark rendering unchanged (foreground = white there).

## Verification

- **Confirmation matrix:** full 158-cell re-run against the fixed build — **158/158 cells, zero flags** (79 dark + 79 light; `evidence-final/matrix-results.json`).
- **Contrast:** zero informative-text failures in either theme at any audited width; zero invisible-text; zero raw-mint-text-on-light.
- **Rendering:** theme applied correctly in all cells (html class, data-theme-mode, body background); no horizontal overflow 320–1920; no blank pages; no broken images; DPR 1/2/3 identical.
- **Static:** `tsc --noEmit` clean; 600/600 client tests including the rewritten theme suites and the hex-ceiling ratchet.
- Visual review: fixed tracker (390 light), account (1440 light), login (1440 light) screenshots in `evidence-fix/`; light feed/splits/chat and dark cells from the matrix screenshots in `evidence/`.

## Notes and limits

- **Dark-fixed-by-design surfaces:** the landing page and login page own a fixed black canvas in both modes (marketing/auth surfaces, matching the brand's dark-first identity). They are measured in both themes and pass in both; they do not re-skin white.
- **Legal pages (`/privacy`, `/terms`):** direct page loads are served by the server as static dark documents for every user agent (white on black, ~21:1 — readable regardless of mode; the six "theme mismatch" cells in the raw matrix data are this, not a defect). The in-app React versions render through the theme (token classes `bg-background text-foreground`, [Privacy.tsx:15](../../client/src/pages/Privacy.tsx#L15)) and are compliant by construction.
- Engines: Chromium-class only (matches the repo's supported-viewport contract; WebKit/Firefox remain unverified there too).
- Admin (`/admin`), wc2026, profile, account render with an owner-role client stub; data panels behind server-verified owner procedures show their unauthenticated states — chrome, theme, and text measured; populated admin data panels not exercised.
- The `sonner` toast wrapper reads `next-themes` (a vestigial import, always falling back to "system"→its own default); toasts are library-styled and were not part of the flagged set. Left untouched under the no-invention mandate; noted for a future cleanup.

---

## Addendum — owner escalation (2026-07-31, round 2)

The owner's review of the shipped audit surfaced two gaps and one new law; all executed on `ui/light-mint-ink`:

1. **New law: on light surfaces, mint exists ONLY as a fill with black ink.** Enforced systemically: a `--mint-ink` token (dark = raw mint via `var(--primary)`, light = the 0A7C50 tone) plus a global `html:not(.dark) .text-primary { color: var(--mint-ink) }` remap — raw mint text can no longer render on light anywhere, current or future. Black-fixed containers keep raw mint ink via `html:not(.dark) .bg-black { --mint-ink: var(--primary) }` (Subscribe result pages converted from inline black styles to `bg-black`); the dark-fixed Login and the black-card WC2026 pin the var at their roots.
2. **Coverage gap closed: all 13 admin routes** (the first matrix rendered only `/admin`). Publish Projections exposed a mixed-mode seam — themed white chrome over a hardcoded-dark body. The admin area is now **dark-fixed via AdminShell** (pins `<html>` dark while mounted, restores the user's theme on exit), which also resolves Subscription Plans' raw-mint-on-white ("10 spots left"). Verified: 26 admin cells + 44 core cells re-run — admin uniformly dark in both themes, zero mint-on-light, zero contrast fails (`evidence-mint/`). Two rig artifacts noted: the NBA CDN league logo refuses headless browsers (200 in real browsers) and a 3px admin-users overflow that does not reproduce on settled measurement.
3. **Mobile chat keyboard choreography** (owner directive): while the OS keyboard is up on phones, the history toggle holds the high top-left corner, the kebab the high top-right, the theme-correct wordmark fades in centered, and the thread tracks the keyboard 1:1 — pinned threads re-pin to the newest bubble the same frame, released threads shift by exactly the inset delta. The bar morph rides `--dc-kb-progress`, a critically-damped `springSettle` retargeted mid-flight (a dismiss during the open settle reverses in real time; reduced-motion snaps the state). Verified end-to-end by driving the real `visualViewport` event path: inset 320px published, progress settles at 1, bar 56→48px at y=0, toggle at (12,1), wordmark centered at cx=195/390, mid-flight reversal sampled at 0.264 before settling to 0 (`evidence-mint/kb-open-390-*.png`).
