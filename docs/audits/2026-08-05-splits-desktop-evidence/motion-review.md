# Motion review — Betting Splits desktop refinement (2026-08-05)

## Gate determination

The diff touches one motion line, so the review-animations gate ran (via Read
of `.claude/skills/review-animations/SKILL.md` + `STANDARDS.md`, applied to
the diff).

**Motion lines in the diff:**
- `client/src/pages/BettingSplits.tsx` (`scrollToGame` highlight pulse):
  `el.style.transition = "box-shadow 0.16s ease, outline 0.16s ease"` →
  `"box-shadow 160ms cubic-bezier(0.16, 1, 0.3, 1), outline 160ms cubic-bezier(0.16, 1, 0.3, 1)"`.
- No other transition/animation/transform/keyframe lines are added, removed,
  or modified (the `.bsp-seg` min-width and label-size rules are static
  layout; the pre-existing Tailwind `transition-all duration-[160ms]` classes
  on segments are untouched).

## Findings table

| Before | After | Why |
| --- | --- | --- |
| `0.16s ease` on the search-jump highlight | `160ms cubic-bezier(0.16, 1, 0.3, 1)` | Built-in `ease` is too weak; the brand's single strong ease-out curve is the law and *feels* faster at the same duration |
| (pre-existing, unchanged) `box-shadow`/`outline` transitions in the pulse | — noted, not changed — | Non-GPU properties (standard 7). Tolerated: the pulse is a **rare, one-shot** event (search → jump), runs ~2s total on one element, cleans up after itself, and has a static reduced-motion fallback. Remedial hierarchy would reach it only after the fixes this pass ships; converting it to transform/opacity would change its visual identity (an outline beacon), which is beyond refinement scope. Listed as a known issue. |

## Verdict

No feel-breaking regressions; no motion on keyboard/high-frequency actions
(the pulse is search-initiated and rare per the frequency table); durations
within bounds (160ms steps, ~2s total one-shot); interruptible enough for its
one-shot role; `prefers-reduced-motion` fully honored (static highlight, no
pulse). The one changed line strictly strengthens easing toward the brand
curve.

**Approve.**

## Hover/press advisor note (emil-design-eng, read-only)

The surface's hover/press vocabulary predates this pass and is already law-
aligned: `--dime-t`/`--dime-ease` everywhere, 0.97 press settle on every
tappable control, chevron rotating in place, reduced-motion kill switches
(`splits-interactions.css`). Per the frequency table (hover on tens-of-times-
daily controls → reduce, never add), no motion was added. The one a11y gap —
the favorite star lacking a focus ring — was fixed statically (no motion).
