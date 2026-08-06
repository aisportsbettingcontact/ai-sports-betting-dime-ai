# Dime LLM training architecture v1

## Active boundary

```text
Codex with 5.6 Sol
  → engineering, training control, testing, evaluation, and improvement

RunPod
  → training and inference compute

Dime LLM
  → trained model capability

Dime Chat
  → user-facing interface powered by Dime LLM

Frozen / no-provider
  → deterministic fallback and non-generative control
```

Anthropic is excluded from the active Dime LLM architecture. It is not a
candidate, pricing subject, fallback target, or invocation lane. Historical
checksum-pinned evidence that previously considered it is preserved only as a
record of the earlier decision framing.

The machine-readable authority is
`configs/platform_contract.json.dime_llm_architecture` and the active decision
record at
`evidence/decisions/dime-model-artifact-decision-v1/decision.json`.

## Candidate evaluation

Before these candidates are executable, the starting model must pass the
checksum-pinned
[`base-model-suitability-v1`](../evidence/benchmarks/base-model-suitability-v1/)
gate. It compares exact Base and Instruct revisions under identical 81-case
controls. The current Base binding in the training code is provisional and is
not a model-selection decision. Dataset approval and training authorization
remain blocked until an independent verdict selects one candidate. A
statistical tie prefers Instruct because Dime Chat is conversational and the
planned SFT corpus is small; selecting Base requires a material correctness
advantage without instruction-adherence or calibration regression.

The 81-case comparison isolates two sources of gain:

| Candidate | Model artifact | Runtime Answer Routing v1 | Question |
| --- | --- | --- | --- |
| A | Pinned base model | No | What can the base model do alone? |
| B | Same pinned base model | Yes | What does runtime engineering add? |
| C | Dime QLoRA adapter on the same base | Yes | What does Dime training add over B? |

Candidate B and Candidate C must share the exact base and tokenizer revisions,
prompt, retrieval, tools, context construction, routing, decoding, model
compute, and evaluation cases. The adapter is their only allowed difference.
Candidate C is not promotable when Candidate B performs as well.

The frozen contract, thresholds, data identities, and execution blockers are
in
`evidence/benchmarks/model-artifact-evaluation-v1/contract.json`.

## Training contract

`configs/dime_training_contract_v1.json` pins the facts that already exist:

- base and tokenizer repository plus immutable revision;
- source commit and exact training-code/config/lock hashes;
- prompt, chat template, tool catalog, and routing hashes;
- deterministic seeds;
- RunPod container and hardware profile; and
- the model-artifact evaluation revision.

The contract deliberately remains `INCOMPLETE_NOT_AUTHORIZED`. The starting
model is not selected; the approved 2,400-record Foundation revision and
checksums plus development and locked evaluation identities are incomplete.
Early stopping and fail-closed checkpoint-resume verification are implemented,
but neither has passed an authorized RunPod smoke run.

No `latest`, `main`, mutable tag, model alias, or inferred revision can fill an
identity field.

## Foundation validation gate

The 2,400-record release must contain exactly 2,160 training and 240 validation
records and must pass:

- record-level provenance and rights;
- exact split separation from development, model-artifact, and locked
  evaluation data;
- exact and near-duplicate detection;
- temporal-leakage and locked-evaluation exclusion checks;
- label consistency;
- route balance;
- tool-use coverage;
- missing-data and abstention coverage; and
- sports, platform, market, and statistical-reasoning coverage.

The 12 public sample records in this repository are contract fixtures, not the
approved Foundation release.

## First adapter boundary

The first candidate is a controlled rank-16 QLoRA adapter, not a
foundation-model pretraining run. The governed run must provide checkpoint
intervals, loss and gradient monitoring, validation during training, early
stopping, authorized resume verification, artifact hashes, exact hardware and
library capture, adapter-size constraints, and general-capability regression
tests.

Training is blocked until every required control is implemented, the resume
path passes the bounded smoke test, and the platform contract separately
authorizes the exact training tuple.

## Promotion and serving

Candidate C must clear every hard gate, including zero fabricated dynamic
facts, event-identity errors, doubleheader confusion, mandatory-tool failures,
stale-current claims, missing-evidence-as-no-edge claims, critical schema
failures, and cross-user failures. It must not regress protected platform or
account behavior or calibration, and it must remain inside the frozen latency
and reliability bounds.

A passing result may receive only
`SELECT_FOR_CONTROLLED_VALIDATION`. Selection does not activate RunPod,
Railway, Dime Chat routes, tracing, shadow traffic, or serving.

Only after selection may a separate record freeze:

```yaml
provider: runpod
base_model:
base_revision:
adapter_revision:
endpoint_revision:
container_digest:
context_limit:
maximum_output_tokens:
timeout_ms:
concurrency_limit:
rollback_model:
```

RunPod pricing must then be derived from actual GPU, idle, request, token,
generation-time, utilization, cold-start, storage, and network measurements.
Unknown utilization means `cost_unavailable`, never zero.

## Current next step

The next permissible work is to complete and independently review the
Foundation dataset evidence and the missing training controls. This document
does not authorize dataset approval, RunPod execution, training, evaluation,
pricing, deployment, or production activation.
