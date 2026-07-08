# Dime AI — Design Assets & Implementation References

Everything related to the **Dime** brand and the **Dime Chat** page redesign, collected from the
Claude Design handoff (July 2026). Full read-only audit completed 2026-07-08 — all files below were
inspected line-by-line / pixel-sampled before being committed.

## Folder layout

```
dime-ai/
├── design-bundle/        Claude Design handoff bundle (extracted from DIMEAIDESIGN.zip)
│   ├── README.md         The handoff's own instructions
│   └── project/
│       ├── Dime Chat.dc.html            ★ PRIMARY design — the page to implement
│       ├── Dime Logo Directions*.html   Brand-identity design docs (turns 1, 4, 5)
│       ├── dime-logos/                  Shipped wordmark SVGs (outlined paths, production)
│       ├── dime-brand-svgs/             4a–4f asset kit (prompt glyph, submit button,
│       │                                wordmark, app icon, lockup, chat avatar)
│       ├── ai-sports-betting-lockups/   Parent-brand wordmark studies (variant 02 = final)
│       ├── uploads/ · screenshots/      Design references (contains personal reference
│       │                                screenshots — do not redistribute)
│       └── support.js                   Claude Design prototype runtime (NOT production code)
├── reference-pages/      Static, script-free exports of the four final frames
│   ├── dime-home-dark.html   (5a)   dime-home-light.html  (5b)
│   └── dime-chat-dark.html   (5c)   dime-chat-light.html  (5d)
└── logo-pngs/            Raster wordmarks, 1720×368 RGBA (= 430×92 SVG @4×), pixel-verified
```

## Brand tokens (verified consistent across all assets)

| Token | Value |
|---|---|
| Signal mint (accent) | `#45E0A8` |
| Mint for text on light surfaces | `#0FA36B` (`--mint-on-light`) |
| Near-black (ink / dark ground) | `#0B0B0F` |
| Off-white (light ground / light ink) | `#EDEDF2` |
| Dark surfaces | `#101016` · `#16161C` · `#1A1A22` · `#1E1E26` |
| Dark borders | `#24242E` · `#2E2E38` |
| Light surfaces | `#F4F4F6` · `#F7F7F9` · `#F0F0F3` · `#E8E8EC` |
| Light borders | `#E4E4E9` · `#D5D5DC` |
| Fonts | Familjen Grotesk (400–700) · IBM Plex Mono (400–500, stat labels only) |
| Motion | 160ms `cubic-bezier(0.16, 1, 0.3, 1)` |

Wordmark: lowercase "dıme" (dotless ı, U+0131) with a separate mint coin-dot
(0.20em, `left: calc(50% + 0.03em); top: 0.05em`). Dot rules: mint on black · mint + black
keyline on white · white on mint.

## Key implementation notes (from the audit)

- `reference-pages/` are the cleanest implementation references — static HTML, zero JS,
  content-verified identical to frames 5a–5d of `Dime Chat.dc.html`.
- The embedded script in `Dime Chat.dc.html` is a prototype test harness — it documents intended
  behavior (single-active sidebar row, star/delete chat rows, chat-row creation on first prompt)
  but must not be copied into production.
- `support.js` is the Claude Design preview runtime; never ship it.
- Transparent logo variants are ground-specific: the color in the filename is the intended
  **background** (e.g. `dime-mint-transparent.png` has a white dot — invisible on white).
- Design is desktop-only (fixed 1600×900 frames); mobile behavior is unspecified and must be
  designed at implementation time.
- Target page in this repo: `client/src/pages/DimeChat.tsx` (`/chat` route) — keep its SSE
  streaming core, replace the shell/visuals.
