# Dime base-model suitability evaluation v1

This package freezes the pre-training decision between:

- `meta-llama/Llama-3.1-8B` at
  `d04e592bb4f6aa9cfee91e2e20afa771667e1d4b`; and
- `meta-llama/Llama-3.1-8B-Instruct` at
  `0e9e39f249a16976918f6564b8830bc894c89659`.

Both candidates must run against the same 81 cases, canonical Dime prompt and
chat template, Runtime Answer Routing v1, retrieval, tools, context,
deterministic decoding, and RunPod execution controls.

The current non-Instruct training-code binding is not a model-selection
decision. Dataset approval and training authorization remain blocked until an
independent verdict selects one immutable candidate.

If both candidates pass and are statistically tied, the contract prefers the
Instruct model because Dime Chat is a user-facing conversational product and
the planned 2,400-record SFT corpus is too small to treat instruction-following
behavior as an unmeasured assumption. Selecting the base model requires a
material factual-correctness advantage without instruction-adherence or
calibration regression.

This package authorizes no RunPod invocation, evaluation execution, dataset
approval, training, provider activation, or Railway mutation.
