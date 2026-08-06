# Probabilistic rubric — user-facing projection copy

Scope: the one judgment dimension in the slice that deterministic checks cannot fully capture —
whether display-artifact copy is clear, honest, and on-brand. Deterministic gates always run
first and can never be overridden by this rubric: prohibited-certainty regex, probability
bounds, evidence resolution, responsible-gaming line (all enforced in
`server/loop/projectionLoop.ts` and tested).

Status: DEFINED, NOT EXECUTED (no grader was run this session; recorded honestly per
OPERATING-RULES — this rubric is not evidence of copy quality until calibrated).

## Behavior evaluated
One display artifact's `payload.copy` string, given its projection payload.

## Rubric (score each 1–5; anchors are observable)
1. **Faithfulness** — every number in the copy appears in the projection/odds payload.
   5: all numbers traceable · 3: rounding drift only · 1: any invented number (auto-fail → deterministic gate).
2. **Uncertainty honesty** — probability framed as probability.
   5: explicit "probability, not a promise" framing · 3: neutral · 1: certainty implication (auto-fail → regex gate).
3. **Actionability** — a reader knows the market, side, and price context in one read.
4. **Brand tone** — plain, unhyped; no slop phrases ("elevate", "unlock"), per Dime brand law.

## Calibration protocol (before first production use)
- Sample: 20 generated copies (10 EDGE, 5 NO_EDGE, 5 stale) + 5 adversarial (hostile team
  names, extreme probs).
- Two human ratings per sample (owner + one reviewer); grader (an LLM judge) runs the same set.
- Acceptance: grader-human Spearman ≥ 0.7 and no grader pass on a human auto-fail.
  Disagreements logged per-case; threshold: mean ≥ 4.0 to ship copy changes.
- Escalation: any auto-fail dimension → block + INCIDENTS.md entry; grader may never
  override a failed deterministic gate (invariant, tested in the slice).
- Version this file on any anchor change; evaluations cite the file's git blob hash.
