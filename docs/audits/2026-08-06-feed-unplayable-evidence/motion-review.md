# Motion gate — NOT FIRED

Recorded rather than omitted: an absent file in this bundle reads as "not run"
(evidence-bundle.md, Rules).

## Conditional

design-federation SKILL.md: *"If the diff touches `transition`, `animation`,
`transform`, keyframes, or motion tokens → run the `review-animations` gate."*

## Test

```
$ git diff -U0 -- client/ \
  | grep -nE "^[+-].*(transition|animation|@keyframes|cubic-bezier|will-change|scroll-behavior|transform:)"
  → no matches
```

Zero motion properties added, removed, or modified. The CSS side of this diff is
one selector-list extension and one colour override:

- joined `--unplayable` into the existing PASS neutralization group
  (`color`, `background`, `border-color`, `box-shadow: none`)
- added `.projection-card.projection-card--unplayable .summary__next`
  (`color`, `box-shadow: none`)

`box-shadow: none` here is a paint value, not a transition. The
`.projection-card .summary__next` rule it overrides does declare a
`transition` on `background`/`box-shadow`/`transform` — that declaration is
untouched and still applies, so the arrow's hover and press behaviour is
unchanged; only its resting colour differs on an unplayable card.

## Adjacent motion, verified unaffected

- `@keyframes projection-card-live-pulse` and the live-dot animation: untouched.
  A live card is never unplayable, so the new rules cannot reach the dot.
- `@media (prefers-reduced-motion: reduce)` block: untouched.
- THREE-COLOR-LAW v3's owner-approved lift/spring allowance for interactive
  projections cards is neither exercised nor withdrawn.

**No Block/Approve verdict is issued — there is nothing in scope for the gate to
rule on.**
