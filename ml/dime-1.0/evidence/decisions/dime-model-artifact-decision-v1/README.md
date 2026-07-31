# Dime LLM model-artifact decision v1

This is the active, non-authorizing Dime LLM architecture decision.

Codex with 5.6 Sol owns engineering and training control. RunPod owns model
training and inference compute. Dime LLM is the resulting trained capability;
Dime Chat is its user-facing interface. Frozen/no-provider remains the
deterministic fallback and non-generative control.

The production target is a RunPod-served Dime model artifact, but no starting
model or adapter has been selected. The current non-Instruct training-code
binding is provisional, not a selection. A frozen, non-authorizing suitability
gate compares exact immutable Base and Instruct revisions before dataset
approval. After that decision, the active model-artifact comparison is
Candidate A (selected starting model), Candidate B (the same model plus Runtime
Answer Routing v1), and Candidate C (Dime QLoRA adapter plus the same routing).

The prior provider-decision and provider-selection packages remain unchanged
as checksum-pinned historical evidence. They are no longer active decision
authority.

## Current verdict

`REVISE`. No governed run exists to retrain. The base-versus-Instruct gate has
no selection, the approved 2,400-record Foundation release does not exist, the
training contract is incomplete, and Candidate C has not been trained.

This record authorizes no external-provider call, RunPod invocation, training,
benchmark execution, model selection, pricing entry, Railway mutation,
provider activation, tracing, shadow traffic, route activation, or Research
Alpha change.
