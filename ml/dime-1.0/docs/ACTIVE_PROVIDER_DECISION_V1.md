# Dime LLM Active Provider Decision v1

## Current outcome

The decision remains `REVISE`: no active provider has been selected.

Production is correctly frozen at:

```yaml
provider: frozen
model: no-provider
model_revision: no-provider
deployment_tier: disabled
trace_enabled: false
generative_route_activation: false
```

Both dormant implementation lanes are configuration-ready at a coarse level:
the RunPod/OpenAI-compatible lane has an endpoint and credential, and the
Anthropic lane has a credential. That is not proof of endpoint health, model
identity, quality, privacy, price, or fitness for production.

## Required decision tuple

The independent decision authority must approve one exact tuple:

```yaml
provider:
endpoint:
base_model:
model_revision:
adapter_revision:
deployment_tier:
context_limit:
maximum_output_tokens:
timeout_ms:
retry_policy:
concurrency_limit:
fallback_behavior:
pricing_source:
effective_pricing_date:
rollback_target:
```

No field may be inferred from a dormant environment variable or a code default.
The endpoint and model revision must be observed and pinned without recording a
credential.

## Candidate comparison

| Candidate | Current evidence | Missing proof |
| --- | --- | --- |
| Frozen/no-provider | Active baseline; no external calls; deterministic responses available | Generative capability is intentionally absent |
| Dormant RunPod Dime lane | OpenAI-compatible code path, endpoint present, credential present, configured model label present | Immutable served revision, adapter identity, endpoint validation, quality, latency, reliability, privacy, and price |
| Existing Anthropic integration | Preserved SDK path and credential present | Approved endpoint/model revision, quality, latency, reliability, retention/privacy disposition, and price |

Each candidate must be scored from measured evidence on sports reasoning,
instruction adherence, tool-use reliability, latency, context handling, output
stability, cost, operational reliability, data privacy, and rollback speed.
Unmeasured dimensions remain null.

## Benchmark gate

After separate authorization, run the selected candidate only in a
nonproduction or isolated production-equivalent environment. Compare it with
the frozen baseline using the locked Dime evaluation suite plus platform,
account, educational, matchup, tool-use, and missing-data cases.

Record:

- correctness, groundedness, calibration, and unsupported assertions;
- instruction, tool-selection, tool-execution, and schema compliance;
- time to first token, end-to-end latency, timeout rate, and error rate;
- context and output token counts;
- exact estimated cost from official pricing evidence; and
- rollback behavior.

The benchmark must not activate production traffic or write a pricing entry.

## Promotion boundary

The order is:

```text
post-merge independent review
→ isolated benchmark authorization
→ exact provider and revision decision
→ official pricing evidence
→ independently reviewed pricing entry
→ checksum verification
→ provider deployment with tracing disabled
→ controlled internal validation
→ separate SHADOW verdict
```

The canonical machine-readable record is
`ml/dime-1.0/evidence/decisions/active-provider-decision-v1/decision.json`.
