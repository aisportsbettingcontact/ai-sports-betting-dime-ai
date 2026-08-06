# Motion gate — NOT FIRED (determination + evidence)

**Verdict: the `review-animations` gate does not apply to this diff.** Recorded
here rather than omitted, because an absent file in this bundle reads as "not
run" (evidence-bundle.md, Rules).

## The conditional

design-federation SKILL.md: *"If the diff touches `transition`, `animation`,
`transform`, keyframes, or motion tokens → run the `review-animations` gate."*

## Test

```
$ git diff -U0 -- client/ \
  | grep -nE "^[+-].*(transition|animation|transform|@keyframes|cubic-bezier|will-change|scroll-behavior)"
```

Three matches, all on the same line pair, and all the substring `transform`
inside **`text-transform: uppercase`** — a typography property, not motion:

| line | change |
|---|---|
| `-` | `.projection-card__status { … text-transform: uppercase; color: … }` |
| `+` | `.projection-card__status { … text-transform: uppercase; color: … font-variant-numeric: tabular-nums; }` |
| `-` | `.matchup__time { … text-transform: uppercase; … }` (rule deleted) |

No `transition`, no `animation`, no `@keyframes`, no `cubic-bezier`, no
`transform`, no motion token is added, removed, or modified. The single property
this diff adds to that rule is `font-variant-numeric`.

## What the diff does around existing motion, and why it is untouched

The pulsing mint live dot moved **with** its status span from the card's
top-right to the card's center. Its own rules are byte-identical to `origin/main`:

- `.projection-card__live-dot` base + `animation: projection-card-live-pulse 1.6s cubic-bezier(0.16,1,0.3,1) infinite`
  (`client/src/components/projections/ProjectionCard.css:748-757`)
- `@keyframes projection-card-live-pulse` (`:93`)
- `@media (prefers-reduced-motion: reduce) { .projection-card__live-dot { animation: none; opacity: 1; } }`
  (`:1152`)

THREE-COLOR-LAW v3's owner-approved lift/spring allowance for interactive
projections cards is not exercised and not withdrawn by this change.

## Rendered confirmation anyway

Even though the gate did not fire, the reduced-motion pass was captured and
measured, because MASTER.md's Pre-Delivery Checklist requires it independently:

```
$ node scratchpad/shots.mjs …      # Playwright context: reducedMotion: "reduce"
  saved reduced-motion-dark-1440x900.png
  reduced-motion live-dot animation-name: none
```

`getComputedStyle(.projection-card__live-dot).animationName === "none"` under
`prefers-reduced-motion: reduce`. Assessment B independently diffed
`reduced-motion-dark-1440x900.png` against its animated twin: exactly 45 pixels
differ — the dot and nothing else.

**No Block/Approve verdict is issued, because there is nothing in scope for the
gate to rule on.**
