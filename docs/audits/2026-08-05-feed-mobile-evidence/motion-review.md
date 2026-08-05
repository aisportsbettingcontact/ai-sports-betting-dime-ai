# review-animations gate — feed mobile refinement (2026-08-05)

**Gate trigger:** YES — the diff moves the `.projection-card__live-dot`
activation rule (`display: inline-block` + `animation:
projection-card-live-pulse 1.6s cubic-bezier(0.16, 1, 0.3, 1) infinite`)
out of the `@media (min-width: 768px)` block, extending the pulse to
<768px. No new animation, duration, curve, or keyframes are introduced.

**Review (per review-animations SKILL.md + STANDARDS.md, read via Read):**

| Check | Verdict |
| --- | --- |
| Purpose | State indication — LIVE lifecycle marker; the one sanctioned always-running motion on this surface (THREE-COLOR-LAW v3 grant, pages/ai-model-projections.md live-indicator rule) |
| Duration/curve | Unchanged: 1.6s, `cubic-bezier(0.16, 1, 0.3, 1)` — the brand curve; opacity-only keyframes (0.55 ↔ 1), GPU-safe |
| Frequency | Only on LIVE cards; opacity pulse, not layout/paint churn |
| Reduced motion | `@media (prefers-reduced-motion: reduce)` collapses to a static dot (`animation: none` — "Item 4: static dot, no pulse", ProjectionCard.css end-of-file block) — verified present and unconditional |
| Spatial consistency | n/a (in-place opacity) |
| Interruptibility | n/a (ambient indicator, no user-triggered variant) |

**Mobile-specific judgment:** on phones the dot is the only motion in the
scroll field; 0.55–1.0 opacity at 1.6s is below attention-capture threshold
while remaining detectable — consistent with the law's "LIVE is signal"
intent. The dark-theme dot sits directly on black; the light theme keeps its
1px keyline (`html:not(.dark)` box-shadow), unchanged.

## Verdict: **Approve**

The change is a scope extension of an already-approved motion grant with the
reduced-motion fallback intact at every breakpoint. Nothing here conflicts
with MASTER.md's 160ms interaction-motion law (this is the explicitly
exempted live indicator, not an interaction transition).
