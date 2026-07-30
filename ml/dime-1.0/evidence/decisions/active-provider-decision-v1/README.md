# Active Provider Decision v1

This is the non-authorizing decision record for the production model runtime
that may eventually constitute Dime LLM v1.

No provider is selected. All candidate scores remain null because no
candidate endpoint benchmark was authorized or executed while preparing this
record.

The record compares:

1. the current frozen/no-provider baseline;
2. the dormant RunPod/OpenAI-compatible Dime lane; and
3. the existing Anthropic integration.

A later decision must fill every field in `decisionTuple`, attach measured
results for every comparison dimension, identify the exact immutable model
revision, and receive independent approval. Only then may a separately
reviewed pricing entry be proposed.

This artifact does not authorize endpoint invocation, provider selection,
pricing changes, Railway configuration changes, provider activation, Trace v1,
shadow traffic, route activation, model training, or Research Alpha.
