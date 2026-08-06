# Runtime Answer Routing v1 local evidence

This directory records the deterministic local baseline for
`runtime-answer-routing-v1.1.0`.

## Result

- 19 of 19 frozen synthetic cases passed.
- Route, event-resolution, completeness-guard, retrieval-cap, bypass, and
  full-case contract rates were 1.0.
- Production promotion remains unauthorized.
- Post-deploy answer quality, retrieval volume, latency, token use, provider
  failures, and monetary cost remain pending.

The generator executed the pure runtime routing, resolution, deterministic
betting-math, and completeness APIs against a frozen clock and synthetic
events. The report records SHA-256 identities for the fixture, runtime routing
module, and deterministic educational-math module.

## What this proves

At the recorded source identities, the frozen cases reproduced their expected:

- answer modes and date interpretation;
- exact, nearby, ambiguous, missing, and bypass resolutions;
- event selection and retrieval caps;
- canonical American-odds implied-probability and expected-value enforcement;
- required completeness-guard states; and
- kill-switch behavior.

## What this does not prove

This evidence does not prove:

- model-generated answer quality or factual claim support;
- live database correctness or production retrieval safety;
- deployed p50 or p95 latency;
- prompt, completion, or total token use;
- provider reliability;
- monetary cost or savings;
- release readiness; or
- serving authorization.

Synthetic response text is used only to probe deterministic completeness
guards. It is not presented as model output.

## Files

- `local-baseline.json` is the deterministic machine-readable result.
- `SHA256SUMS` covers the local result. The result records the frozen
  benchmark fixture's SHA-256 identity.

The measurement definitions and rollback policy are in
`docs/RUNTIME_ANSWER_ROUTING_V1_BENCHMARK.md`.
