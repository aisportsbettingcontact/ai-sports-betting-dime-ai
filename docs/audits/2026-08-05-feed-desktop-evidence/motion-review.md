# Motion review — feed desktop refinement (2026-08-05)

## Gate determination

The review-animations gate is **required whenever the diff touches `transition`,
`animation`, `transform`, keyframes, or motion tokens** (design-federation
conditional). This diff was checked line-by-line against that trigger:

- `git diff` on `feat/feed-desktop-refine` touches ProjectionCard.css,
  ProjectionSummary.tsx, DimeModelFeed.tsx, ProjectionCard.test.ts.
- **No `transition`, `animation`, `transform`, keyframe, or motion-token line
  is added, removed, or modified.** The changes are container-query
  thresholds, grid tracks/gaps, font sizes, `min-inline-size`,
  `align-items`, `justify-self`, one static `color`, two static
  color-token substitutions, an aria-label, and a skeleton wrapper element.

**Verdict: gate not triggered — no Block/Approve run required.** Recorded here
(instead of omitting the file) so the absence of a verdict is documented, not
silent.

## Hover/press craft decision (emil-design-eng advisor, read-only)

The brief named hover/press craft in scope, so the question "should the
carousel next-arrow and LINEUPS chip hovers gain the THREE-COLOR-LAW v3
granted 1–2px lift?" was put to the emil-design-eng advisor framework:

- Frequency table: hover effects on controls seen tens of times per day →
  *remove or drastically reduce*, never add.
- The next-arrow hover already carries three concurrent signals (row-hover
  fill + shadow expansion + 2px icon nudge) at the brand 160ms curve; adding
  a lift would be additive decoration on a high-frequency control.
- Press states already meet the bar: `scale(0.98)` at 160ms
  (within the 100–160ms press budget), reduced-motion collapses all.

**Decision: restraint — zero motion diff.** The v3 grant is permissive, not
mandatory; the existing hover/press vocabulary already satisfies the law and
the craft bar. The gate must not be given behavior to Block, and none was
introduced.
