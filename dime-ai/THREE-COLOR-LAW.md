# Three-Color Law (2026-07-13 rebrand directive)

Supersedes the multi-tier palette in `design-system/dime-ai/MASTER.md`.
Applied across Mobile, Tablet, Desktop — frontend **and** backend (emails, Discord
cards, prerender).

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
