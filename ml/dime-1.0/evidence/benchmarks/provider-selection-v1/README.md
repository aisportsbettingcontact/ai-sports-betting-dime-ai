# Dime LLM provider-selection evaluation v1

This package freezes the dataset identity, execution controls, measurements,
and promotion thresholds for comparing the existing Anthropic integration
with the dormant RunPod lane. The frozen/no-provider production state remains
the deterministic control and emergency rollback target.

## Locked evaluation

The composite suite contains 81 cases:

- 65 existing checksum-pinned route, grounding, development, and safety cases;
- 16 reviewed synthetic supplemental cases covering the remaining provider
  decision risks; and
- no production prompt, response, game row, or user identifier.

Both candidates must receive identical prompt, knowledge, routing, retrieval,
tool fixtures, context, temperature, output limit, timeout, retry policy, and
concurrency. Candidate labels remain blinded through scoring.

## Current verdict

`REVISE`. This artifact does not authorize a benchmark or provider call.

Before execution, an independent authority must authorize the isolated run and
both candidates must have immutable model identities. Before selection, exact
official pricing, an owner-approved latency SLO and cost budget, a complete
production tuple, a verified rollback target, and independent approval are
required.

The hard quality gates include zero critical fabricated dynamic facts, zero
cross-user failures, zero mandatory tool or schema violations, and no critical
route regression. Unknown pricing is `cost_unavailable`, never zero.
