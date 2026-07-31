# Dime AI Composite LLM Engineering Control

## Decision

The Dime AI engineering framework is a fail-closed control plane around Dime
Chat and Dime LLM. It does not create a second serving stack. Railway remains
the product runtime and trace owner, `ml/dime-1.0/` remains the governed model
development owner, GitHub remains the reviewed source owner, Hugging Face
remains the immutable dataset/model registry, and RunPod remains replaceable
compute.

This first implementation is **proposed and non-authorizing**. It adds:

- a complete failure-layer taxonomy;
- a nine-route product taxonomy with explicit lifecycle state;
- the Dime Intelligence Efficiency objective;
- deterministic training-necessity and candidate-promotion gates;
- a production-trace completeness score;
- structured agent-handoff artifacts; and
- an owner-only inspection endpoint at
  `dimeRuntime.engineeringControl`.

It does not authorize training, locked evaluation, release, serving, provider
activation, infrastructure deployment, or production schema changes.

## System boundaries

```text
Dime Chat (Railway)
  ├── Runtime Answer Routing v1
  ├── exact/nearby/ambiguous/missing event resolution
  ├── bounded retrieval and deterministic math
  ├── completeness, factual, and responsible-gaming gates
  └── Conversation Trace v1
          │ verified failure evidence only
          ▼
AI Engineering Control (GitHub + governed artifacts)
  ├── failure diagnosis
  ├── intervention selection
  ├── architecture and scaling experiments
  ├── data/post-training plans
  └── independent evaluation decision
          │ separately authorized immutable inputs only
          ▼
Dime LLM development (ml/dime-1.0)
  ├── approved Foundation dataset
  ├── pinned base model and QLoRA training
  ├── development evaluation
  ├── one-way locked evaluation handoff
  └── release attestation
```

Trace data is not a training dataset. A verified failure may nominate a
candidate example, but the existing consent, deidentification, rights,
partition, independent-review, immutable-revision, and authorization gates
still apply.

## Objective

All metrics must be measured over the same candidate/control exposure and
normalized before comparison:

```text
correctness × usefulness × groundedness × calibration × reliability
──────────────────────────────────────────────────────────────────
latency × cost × complexity × regression risk
```

The runtime implementation is
`server/_core/dimeEngineeringControl.ts`. It rejects non-finite quality
metrics, quality values outside `[0, 1]`, and non-positive burden metrics.

A candidate cannot advance to shadow unless:

1. the target capability improves;
2. Dime Intelligence Efficiency exceeds the baseline by the approved minimum;
3. zero-tolerance failures remain zero;
4. regression limits pass;
5. evaluation is independent;
6. locked evaluation passes; and
7. rollback is ready.

Passing this deterministic gate yields only `SHADOW`. It cannot directly
produce `CANARY` or `RELEASE`; those remain later release-controller actions
under the existing release contracts.

## Failure diagnosis and training judgment

Every failure is classified into exactly one primary layer:

1. `product_logic`
2. `routing`
3. `retrieval`
4. `tool_use`
5. `context_construction`
6. `data_quality`
7. `reasoning`
8. `knowledge`
9. `instruction_following`
10. `calibration_uncertainty`
11. `model_capacity`

Training-required decisions fail closed for product logic, routing, retrieval,
context construction, or data-quality failures. Tool-use failures may become
training candidates only after tool availability, authorization, parameter
construction, response validation, and runtime execution have been verified.

Every required-training proposal must include a measurable hypothesis,
evidence, root cause, rejected smaller interventions, capability target,
method, curriculum, data requirements, expected gain, regression risks, stop
conditions, and acceptance thresholds. “Make the model smarter” and equivalent
objectives fail validation.

## Product routes

`Runtime Answer Routing v1` continues to control current response behavior.
The additive product taxonomy refines traces and evaluation:

| Route             | Current state | Retrieval authority                      |
| ----------------- | ------------- | ---------------------------------------- |
| `platform`        | active        | pinned platform catalog                  |
| `matchup`         | active        | exact resolved event only                |
| `full_slate`      | active        | bounded resolved slate                   |
| `educational`     | active        | deterministic math; no dynamic facts     |
| `bet_explanation` | partial       | no dynamic facts                         |
| `historical`      | planned       | timestamped historical records           |
| `account`         | planned       | authenticated user-owned account records |
| `live_data`       | planned       | authoritative current providers          |
| `general_sports`  | planned       | unassigned                               |

No token or latency target is fabricated. Each route policy explicitly records
`requires_benchmark` until representative measurements approve a target.
Planned routes do not activate their listed tools.

## Structured agent artifacts

Agents exchange JSON that validates against:

```text
schemas/engineering_control_artifact.schema.json
```

Supported artifact types:

- `failure_diagnosis`
- `training_strategy`
- `architecture_experiment`
- `scaling_forecast`
- `evaluation_decision`

Every artifact binds a producer agent, opaque principal identity, full source
commit, timestamped hashed evidence, and a non-authorizing effect. An artifact
cannot grant training, locked-evaluation, release, serving, or provider
authority to itself.

The agent and workflow registry is:

```text
configs/composite_engineering_control_v1.yaml
```

The existing reviewer registry, signed decision receipts, one-way locked
evaluation handoff, and platform contract remain the higher authority for real
approvals.

## Trace quality

The trace-quality scorer measures field coverage, not answer correctness. A
complete production-learning trace requires:

- request ID;
- application version;
- model version;
- prompt version;
- product route;
- retrieved record identities;
- data timestamps;
- tool calls;
- validator results;
- latency;
- token usage; and
- estimated cost.

Conversation Trace v1 now records a strict Phase 1 identity, explicit
tool-state classification, separate evidence timestamps, stage latency,
context metrics, token usage, and versioned cost status inside its existing
event-metadata channel. This is additive and requires no schema migration.
Trace identity fails closed when the Git commit or environment is absent.
Monetary cost remains `cost_unavailable` unless a reviewed, checksum-valid
pricing registry provides one exact provider/model/model-revision entry that
is effective at request time. Ad hoc environment rates and model fallbacks
are rejected.

The owner-only `dimeRuntime.observability` endpoint reports configuration and
measurement readiness without accepting trace identifiers or returning raw
traces, prompts, responses, account data, endpoints, credentials, or
environment values. It always reports the independent gate as not issued in
this observational implementation.

Current delayed game context still lacks authoritative market-observation and
database-ingestion timestamps. The trace therefore labels the tool result
`stale` and the completeness assessment fails for dynamic evidence instead of
presenting retrieval time as source freshness. This is measured debt, not a
claim that Phase 1 timestamp closure is complete.

The frozen nine-route synthetic benchmark and deterministic confusion matrix
live at:

```text
data/eval/product_route_observability_v1.benchmark.json
evidence/benchmarks/product-route-observability-v1/local-baseline.json
```

They measure observational product-route classification and required-tool
policy compatibility. Entity resolution, actual tool selection, context
relevance, live latency, and cost distributions remain explicitly unmeasured
until representative sanitized traces exist.

## Improvement state machine

```text
observed
→ reproduced
→ diagnosed
→ baselined
→ intervention_selected
→ implemented
→ independently_evaluated
→ shadow
→ canary
→ released
→ monitored
```

At any stage, a failed zero-tolerance gate, contamination finding, unauthorized
transition, efficiency regression, or rollback trigger moves the candidate to
`REJECT`, `REVISE`, or `ROLLBACK`.

## Immediate implementation sequence

### Phase 1 — runtime intelligence

Completed or present:

- deterministic four-mode runtime routing;
- sport, league, team, and date parsing;
- exact, nearby, ambiguous, missing, and not-applicable event states;
- route-bounded retrieval;
- deterministic market math;
- response-completeness checks;
- server-authoritative Trace v1 contracts;
- nine-route product taxonomy; and
- trace-quality field scoring.

Open:

- activate and benchmark route-specific policies for historical, account,
  live-data, general-sports, and bet-explanation routes;
- add authoritative provider-observation records and the complete ingestion
  lifecycle to every dynamic evidence row;
- approve an effective entry in the governed provider-pricing registry before
  reporting dollar cost;
- approve route-specific p50/p95/p99 and context-token budgets; and
- independently calculate route, entity, actual tool-selection, context,
  latency, and cost distributions from representative observational traces;
- deploy Trace v1 only through its existing migration runbook.

### Phase 2 — 2,400-record Foundation dataset

Use the existing Foundation v1 candidate, review, audit, and freeze workflow.
Add coverage quotas for the nine product routes, eleven failure layers,
curriculum progression, temporal ambiguity, conflict, abstention, correction,
and production-realistic multi-turn conversations. Do not relax the current
provenance or separation-of-duties gates.

### Phase 3 — first adapter

Keep the provider frozen. Freeze one immutable dataset revision, measure the
pinned base, train the smallest approved QLoRA experiment, run category
ablations, and compare base, runtime-only, adapter-only, and combined variants.
Reject the adapter when runtime changes explain the gain or the system-level
objective does not improve.

### Phase 4 — independent promotion

Use development, restricted, locked, and shadow evaluation in order. Advance
to canary only with an independent decision, approved operational thresholds,
and tested rollback. The builder cannot approve the candidate.

## Verification

From the repository root:

```bash
corepack pnpm exec vitest run server/_core/dimeTraceObservability.test.ts \
  scripts/audit-dime-product-routes-v1.test.ts
corepack pnpm exec tsx scripts/audit-dime-product-routes-v1.ts --check
cd ml/dime-1.0
python -m pytest tests/test_product_route_observability_benchmark.py
```

```bash
pnpm exec vitest run \
  server/_core/dimeEngineeringControl.test.ts \
  server/_core/dimeAnswerRouting.test.ts \
  server/dimeChatTrace.test.ts

ml/dime-1.0/.venv/bin/python -m pytest -q \
  ml/dime-1.0/tests/test_engineering_control_contract.py

pnpm run check
```

The full JavaScript and Python suites remain the final repository gates.
