# Mobile floating navigation — top pill nav replaces the bottom tab bar

**Date:** 2026-07-18 · **Scope:** mobile (<768px) primary navigation only.

## What changes

The fixed bottom tab bar (`MobileOwnerBottomTabs`, 60px, Feed·Splits·Chat·Props·Profile)
is replaced by a top-floating composition: the Dime wordmark on a small raised chip,
with a fully-rounded pill menu directly below it. Both float over content (fixed,
centered, safe-area aware) and reserve real document space via a measured CSS variable.

## Destination contract (route-preservation map)

| Label       | Destination                                        | Active rule                                     | Guard                            | Entitlement                                     |
| ----------- | -------------------------------------------------- | ----------------------------------------------- | -------------------------------- | ----------------------------------------------- |
| Feed        | `/feed/model/mlb` (canonicalizes to dated URL)     | `pathname.startsWith("/feed/model")`, `/m/feed` | RequireAuth                      | —                                               |
| Tools       | `/betting-splits/MLB` (canonicalizes to dated URL) | `startsWith("/betting-splits")`, `/m/splits`    | RequireAuth                      | —                                               |
| Chat        | `/chat`                                            | `=== "/chat"` (+ nested), `/m/chat`             | RequireAuth (DEV preview exempt) | owner-role gate inside DimeChatPage (unchanged) |
| Bet Tracker | `/bet-tracker`                                     | `=== "/bet-tracker"` (+ nested)                 | RequireAuth                      | —                                               |
| Profile     | `/profile`                                         | `=== "/profile"` (+ nested), `/m/profile`       | RequireAuth                      | —                                               |

Evidence-based mapping notes:

- **Tools → the Betting Splits + Odds History surface.** No `/tools` route exists; the
  splits surface is the product's live betting-tools destination (desktop sidebar label
  "Betting Splits + Odds History"). Mapping Tools anywhere else would orphan a primary
  product surface from mobile nav.
- **Props (`/m/props`) leaves the primary bar** per the mandated five-destination list.
  The route, screen, and access gate are untouched — it stays deep-linkable, and the
  floating nav now renders on `/m/*` so it is never a dead end.
- Chat keeps persistent primary emphasis (exact `#45E0A8` pill, "Chat with [wordmark]",
  accessible name "Chat with Dime AI"); `aria-current="page"` goes only to the actual
  active destination. No default-active fallback (the old bar defaulted to "feed").

## Brand-law adaptations of the pill-menu reference

Per `dime-ai/THREE-COLOR-LAW.md` (supersedes MASTER.md): translucent container +
backdrop blur → **solid raised surface** (`--dime-surface-raised`) + quiet 1px border +
floating-surface shadow (alpha is legal only inside `box-shadow`/mint `color-mix`).
Familjen Grotesk only. Motion: 160ms `var(--dime-ease)`, pressed-state compression
(transform-only), all gated by `prefers-reduced-motion`. Chat pill ink is `#000000`
(achromatic, ~12:1 on mint); the wordmark coin-dot inside the mint pill is **white**
(brand coin-dot rule: white dot on mint).

## Mechanics

- `GlobalMobileNav` keeps its gating (authed, <768px, not `/login`) but now also
  renders on `/m/*`, mounts `MobileFloatingNav`, and toggles body class
  `dime-floating-nav-active` (replaces `mobile-owner-tabs-active`).
- The nav measures its rendered height (ResizeObserver) and publishes
  `--dime-floating-nav-h` on `<html>`; `body.dime-floating-nav-active` gets
  `padding-top: var(--dime-floating-nav-h)` — no fixed-pixel offsets.
- Chat centering is deterministic: `grid-template-columns: 1fr 1fr auto 1fr 1fr` — the
  Chat pill's center is the menu's center regardless of neighbor label widths.
- Sticky page chrome offsets under the body class: generic
  `header.sticky.top-0 { top: var(--dime-floating-nav-h) }` plus scoped rules for
  `.dmf-feedhead`, `.bs-header`, `.bt-page` divs, and the chat fixed-viewport layout
  (`--dc-visual-top`-anchored chrome shifts by the nav height; keyboard handling intact).
- Duplicate brand identity removed while the floating logo is present ("one Dime
  identity per page"): feed topbar (wordmark-only on mobile) hidden; chat bar, splits
  header, and profile hero wordmarks hidden — all via the body class, so signed-out
  users (no nav) keep today's chrome.
- `MobileNavShell` (/m/\*) drops the bottom bar and pads top by the nav variable.
- `MobileOwnerBottomTabs.tsx` is deleted; all bottom-clearance CSS is retired.
