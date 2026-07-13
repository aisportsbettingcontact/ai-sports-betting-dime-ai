# Typography + spacing system (2026-07-13)

The centralized fluid type/spacing layer for the Dime AI client. Lives in
`client/src/styles/type-system.css`, imported once in `main.tsx`. This layer owns
**size, rhythm, measure, and wrap**; the Three-Color Law v2 (`index.css`) owns
**color**. They are orthogonal — never encode color here, never encode size there.

## Why

The strict-3 rebrand left type as scattered `px` sizes, a viewport `--scale`
engine, and one-off Tailwind utilities. This layer replaces that with a small set
of semantic, fluid tokens so the product reads as one system and migration is
mechanical rather than page-by-page patching.

## The scale (validated at 320 / 375 / 768 / 1024 / 1440 / 1920)

`clamp(min, A·rem + B·vw, max)`, rem-based so it honors browser zoom and the
user's default font size. Every token is monotonic and bounded (no clip, no
overflow); verified by the clamp-math check in the redesign notes.

| Token | min→max px | Role |
|---|---|---|
| `--fs-caption` | 11 → 12 | metadata, footnotes |
| `--fs-label` | 12 → 13 | uppercase micro-labels |
| `--fs-body-sm` | 13 → 14 | dense body, table cells |
| `--fs-body` | 14 → 16 | default body |
| `--fs-body-lg` | 16 → 18 | lede, intro copy |
| `--fs-h4` | 17 → 20 | card titles |
| `--fs-h3` | 20 → 24 | sub-section headings |
| `--fs-h2` | 24 → 36 | section headings |
| `--fs-h1` | 30 → 48 | page headings |
| `--fs-display` | 40 → 76 | hero — **capped at 76px, no oversized hero** |

Paired tokens: line-heights (`--lh-display` 1.02 … `--lh-relaxed` 1.65),
tracking (`--tracking-display` −0.035em … `--tracking-label` 0.08em), weights
(`--weight-regular` 400 … `--weight-bold` 700). Familjen Grotesk exposes a `wght`
axis only (no `opsz`), so `font-optical-sizing: auto` is a correct no-op here.

## Measures & spacing

- `--measure-prose` 68ch, `--measure-narrow` 46ch, `--measure-wide` 82ch — cap
  long-form line length; data surfaces intentionally stay full-width.
- Spacing is a 4pt base (`--space-3xs`…`--space-xl`) with fluid rungs
  (`--space-2xl`, `--space-3xl`, `--space-section`) for width-scaled rhythm.
- `--target-min` 2.75rem (44px) — minimum interactive target (WCAG 2.2 §2.5.8).

## How to consume

**Prefer the semantic classes** (they bundle size + leading + tracking + weight):
`.ds-display .ds-h1 .ds-h2 .ds-h3 .ds-h4 .ds-body-lg .ds-body .ds-body-sm
.ds-label .ds-caption .ds-data`. Helpers: `.ds-measure[-narrow|-wide]`,
`.ds-truncate`, `.ds-clamp-2/3`, `.ds-break`.

Or use the raw `var(--fs-*)` / `var(--space-*)` tokens in component CSS (as the
landing hero and chat scroller now do).

**Container queries** — when a component must read the same in a narrow shell
pane and the wide feed, mark its wrapper `.ds-cq` and use `.ds-cq-value` /
`.ds-cq-label` (cqi-based, with an `@supports` fallback to the viewport tokens).
This is content-driven scaling, not device breakpoints.

## Migration path (mechanical, incremental)

Adopted so far: the chat conversation scroller (fluid gutters + bottom-anchored
thread) and the landing hero (display tied to `--fs-display`, lede on a `ch`
measure). Everything else still uses its existing sizes and keeps working —
nothing here overrides existing tokens. To migrate a surface: replace ad-hoc
`text-[Npx]` / `font-size: Npx` with the nearest `.ds-*` class or `--fs-*` token,
and swap arbitrary paddings for the `--space-*` rungs. No visual regression as
long as you map to the nearest rung.

## Not yet done (needs a browser, not available in the authoring env)

Rendered validation at the six widths, 200% zoom reflow, and axe/Lighthouse
passes require a real browser (blocked here). The scale is proven by math; a
LiveLab/Playwright pass should confirm pixels before the full migration lands.
