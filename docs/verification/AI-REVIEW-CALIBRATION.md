# AI reviewer calibration log

Primary reviewer: **CodeRabbit** (config: `.coderabbit.yaml`, CODEOWNERS-
protected). Second opinion: Copilot code review, manually invoked only.
Human code-owner approval is required regardless — an LLM review is never the
sole approval authority.

**Enablement preconditions (owner):**
1. Install the CodeRabbit GitHub App (marketplace) — not yet installed.
2. Reconcile with the API-credit law (LLM.md): CodeRabbit bills its own LLM
   usage; confirm that's acceptable or route through an approved plan.

## Calibration protocol (30–50 PRs, advisory)

Log every substantive finding here, one row per finding:

| Date | PR | Finding (short) | True/False positive | Would a human have caught it? | Bad blocking rec? |
|---|---|---|---|---|---|
| — | — | — | — | — | — |

Weekly during calibration, compute: TP rate, FP rate, unique-catch count
(findings no human/gate caught), noise complaints. Graduation gate: FP rate
< 20% on the candidate check class over ≥ 20 observations.

## Graduation candidates (narrow, deterministic — the only things that may
become required)

- "migration file changed without a migration test / plan file" (overlaps
  check 08 — graduate only if CodeRabbit catches cases 08 misses)
- "new tRPC procedure lacks owner/protected wrapper in a sensitive router"
- "prompt file changed without matching prompt-content test change"

General-quality commentary stays advisory forever.
