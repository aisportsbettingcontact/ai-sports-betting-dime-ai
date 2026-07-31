# Dime LLM model-artifact evaluation v1

This package replaces the active provider-comparison framing with a
model-artifact comparison. It does not rewrite or invalidate the historical
`provider-selection-v1` evidence package.

The frozen 81-case suite compares:

1. Candidate A: the pinned base model without Runtime Answer Routing v1;
2. Candidate B: the same base model with Runtime Answer Routing v1; and
3. Candidate C: the Dime QLoRA adapter with Runtime Answer Routing v1.

Candidate A to B isolates runtime-engineering gain. Candidate B to C isolates
training gain. Candidates B and C must use the same base revision, prompt,
retrieval, tools, context construction, routing, decoding, and RunPod
execution controls. Candidate C is not selectable unless it materially beats
Candidate B and clears every zero-tolerance, quality, calibration, latency,
and reliability gate.

Frozen/no-provider remains the deterministic fallback and non-generative
control. It is not a model candidate.

## Current verdict

`REVISE`. No governed training run exists, so a retraining verdict would be
inaccurate. The base-versus-Instruct suitability gate has no selection, the
2,400-record Foundation release is not frozen, and Candidate C does not exist.
No model execution, training, pricing entry, provider activation, Railway
mutation, tracing, shadow traffic, route activation, or Research Alpha change
is authorized.

## Pricing boundary

RunPod cost must be calculated from the actual selected infrastructure. If
utilization is unknown, cost is `cost_unavailable`; it is never zero and is
never substituted with a generic external-API token tariff.
