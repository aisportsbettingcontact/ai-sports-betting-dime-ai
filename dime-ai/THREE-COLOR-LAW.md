# Three-Color Law (2026-07-13 rebrand directive)

Supersedes the multi-tier palette in `design-system/dime-ai/MASTER.md`.
Applied across Mobile, Tablet, Desktop — frontend **and** backend (emails, Discord
cards, prerender).

---

## Law v2 — Tonal Amendment (2026-07-13, owner-approved)

The strict-3 mapping (below) proved too literal for a dense data product: it
collapsed four text tiers to one, deleted hover feedback, flattened every
surface, and left ~12 elements rendering invisibly (audit:
`docs/audits/2026-07-13-design-audit-and-redesign-plan.md`). v2 keeps the
**spirit** (mint is the only *hue*) and amends the **letter**:

> **Mint `#45E0A8` is the only chroma. Black and white may render as achromatic
> TONES — pure greys with zero hue.** Still banned: purple, gold, neon `#39FF14`,
> any *chromatic* second accent, and gradients.

**"Achromatic" is mechanical:** every non-mint value must satisfy `R == G == B`.
A grey with a blue/warm bias is a hue and is banned. The allowed chromatic
values remain exactly three: `#45E0A8` (mint), `#0B8557` (mint-as-text on light,
4.66:1), `#FF3B3B` (`--loss-red`, scoped to Bet Tracker/calendar).

### v2 tonal ramp (verified contrast) — the tokens that render

| Token | Dark | Light |
|---|---|---|
| Page background | `#000000` | `#FFFFFF` |
| Surface card (tier 1) | `#0A0A0A` | `#F7F7F7` |
| Surface raised (menus, active) | `#141414` | `#EFEFEF` |
| Text primary | `#FFFFFF` (21:1) | `#000000` (21:1) |
| Text secondary | `#A6A6A6` (8.6:1) | `#595959` (7.0:1) |
| Text muted | `#6E6E6E` (4.1:1) | `#767676` (4.5:1) |
| Border (quiet default) | `#262626` | `#D9D9D9` |
| Border strong (rationed keyline) | `#FFFFFF` | `#000000` |
| Row hover | `#141414` | `#EFEFEF` |
| Row active | `#1F1F1F` | `#E4E4E4` |
| Focus ring | `#45E0A8` | `#45E0A8` |
| Menu shadow (floating surfaces only) | `0 12px 32px rgba(0,0,0,0.55)` | `0 12px 32px rgba(11,11,15,0.18)` |

**White keylines are now a rationed signature, not the default.** Full-white
`--border-strong` is reserved for signature moments (verdict strip, composer,
section frames); everything else uses the quiet `#262626`/`#D9D9D9` hairline.

**De-emphasis uses real tone, not opacity.** PASS/disabled/secondary states drop
to a grey tier — the `opacity: 0.82` alpha loophole the strict law leaned on is
retired.

Token layers carrying v2: `client/src/index.css`, `client/src/styles/dime-mobile.css`,
`client/src/pages/dime-chat/frozen-tokens.css`, `client/src/pages/dime/landing/landing-v2.css`.

*Everything below is the original strict-3 directive, kept for provenance. Where
it conflicts with v2, v2 wins.*

---

## Fonts
- **Familjen Grotesk is the only typeface.** IBM Plex Mono and JetBrains Mono are
  fully retired; every `--*-mono` token and Tailwind `font-mono`/`font-sans`
  resolves to Familjen Grotesk.

## Colors — the only values allowed to render
| Value | Role |
|---|---|
| `#45E0A8` mint | the one accent / signal / active / positive edge |
| `#FFFFFF` white | dark-theme text & borders · light-theme background |
| `#000000` black | light-theme text & borders · dark-theme background |

### Mechanical mapping (strict solid 3, no alpha, no greys) — both themes
- **Backgrounds** (page + every surface tier): dark `#000000` · light `#FFFFFF`
- **Text** (every tier): dark `#FFFFFF` · light `#000000`
- **Borders / dividers / keylines**: dark `#FFFFFF` · light `#000000`
- **Mint as fill / dot / rail / active**: `#45E0A8` (both themes)
- **Mint as text**: dark `#45E0A8` (passes on black); light `#000000` (mint text
  fails contrast on white — signal shown via mint fills, not text)
- **Focus ring**: solid `#45E0A8` (replaces all rgba rings)
- **Hover**: no background change (no alpha available) — affordance via cursor +
  active state; **Active** = mint
- **Shadows**: removed — surfaces separate by 1px solid border only
- **"Dim mint" tiles** (rgba mint backgrounds): transparent, with mint text/border
- **Negative / error / no-edge / PASS / destructive**: plain text color
  (white on dark, black on light) — differentiated by label/weight/icon, never color

### Allowed exceptions (may render other colors)
1. **Dime brand logo assets** (wordmark SVGs, coin-dot).
2. **Team logos, country flags, league marks** — and the team-primary-color
   monogram-disc fallback used when a logo image is unavailable.
3. **Bet-loss indicators** may use **red** (single `--loss-red` token) in the Bet
   Tracker / calendar win-loss records. Bet **wins** = mint. Everything else on
   those surfaces stays within the 3.

### Retired for good
`#39FF14` neon · all `oklch()` purple/green/red · Tailwind default
zinc/emerald/amber/blue/red families (remapped) · `#0FA36B` `#2FB584` `#7DEBC4`
mint variants · every grey tier · every rgba alpha (except where a documented
exception keeps a color).

---

## Verification (final)

- **Fonts:** 0 non-Familjen `font-family` in `client/src` + `server` (audit-clean). Familjen
  Grotesk is the only typeface everywhere (IBM Plex Mono / JetBrains Mono / Barlow retired).
- **Colors:** `tsc --noEmit` passes. Rendered UI resolves to `#45E0A8` / `#FFFFFF` / `#000000`
  across all breakpoints & both themes, on the token-driven surfaces and every swept page/component.
- **Residual audit flags (~89) are all documented exceptions**, not violations:
  1. **Team/league/country color constants** — crest/monogram/flag/logo fallbacks:
     `#1a4a8a`,`#c84b0c` (GameCard/BettingSplitsPanel), `#4A90D9`,`#1A3A5C`,`#003087`,`#E8A838`
     (MLB props/cheatsheet), `#666`/`#888`/`#444`/`#222` (team primary/dark fallbacks),
     `#1a1a2e` (logo-disc contrast), `actionNetwork`/`teamRegistry`/`splits_card` team tokens.
  2. **Tailwind remap selectors** in `dime-mobile.css` (`[class*="text-emerald-"]` etc.) — the
     mechanism that forces stray Tailwind color classes onto the 3-color tokens; not rendered color.
  3. **Chart alpha math** in `BetTrackerAnalytics` — `withAlpha()`/`color-mix()` compute translucent
     tints **from the mint/white/black palette** for data-viz legibility (only the 3 hues involved).
  4. **Doc-comments** referencing retired values (`#39FF14`, old hex) and **HTML entities**
     (`&#305;` dotless-i, "React Error #310") — non-rendering text.
  5. **Bet-loss red** `#FF3B3B` — the explicitly-approved scoped exception (Bet Tracker/calendar only).
- **Known strict-3 contrast artifacts** (consequences of the literal mapping, flagged for an optional
  polish pass): mint-on-mint "hit target" badge (MlbBacktest); white-on-white comparative bar
  (SituationalResultsPanel); white text on some mint CTA fills; light-mode mint text at low contrast.

---

## Follow-up audit (smoke + 12-subagent fan-out) — remediation

Deployed smoke: `scripts/smoke-deploy.mjs` 8/8 on the live origin; served HTML renders only the 3 colors. A 12-subagent file-by-file re-audit (pages/components/features/css/lib/server/config) surfaced a residual class the first sweep under-handled — now fixed:
- **Alpha modifiers → solid** (149 across 42 files): `bg-black/50` scrims, `bg-background/95` sticky headers, `bg-card/60`, `bg-muted/50`, `text-white/90`, `border-white/10`, `ring-destructive/40`, and `hover:/focus:/active:bg-*/NN` (removed) — alpha renders translucent (off-palette); law is solid-3.
- **Gradients → solid** (9): MobileProfile mint→white discs/tiles → solid mint; the 4 MLB-card + WC team-color top-*rails* → solid mint (matching MlbCheatSheetCard); ModelProjections fade-scrim → transparent. Team-color **radial crest/monogram discs** (WcFeedInline, teamLogoCircle) kept — logo exception.
- **client/index.html** loading shell + SEO block → 3-color (was outside the first audit's scope); unused **Inter** `<link>` removed.
- Stray `#444` (TheModelResults retry border) → white; white-alpha drop-shadow (BetTracker MLB logo) removed; `UIUX_SYSTEM_PROMPT` "neon" → "mint".

Runtime computed-style pass (headless Chromium on the live site) was blocked by the environment proxy (ERR_CONNECTION_RESET for browser automation); verification rests on the static fan-out + curl smoke + served-HTML check. Residual audit flags remain only the documented exceptions (team colors, remap selectors, chart mint-alpha, comments, bet-loss red, Discord surfaces).
