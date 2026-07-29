# Runtime Answer Routing v1 benchmark

## Purpose

This benchmark freezes a small, public-safe contract suite for Runtime Answer
Routing v1. It answers one narrow question:

> Given a synthetic prompt, a fixed clock, and a bounded set of synthetic
> events, does the runtime choose the expected answer mode, date, event
> resolution, retrieval boundary, and completeness-guard outcome?

It is a regression benchmark for deterministic runtime behavior. It is not a
training dataset, a model-quality score, a production traffic replay, or
authorization to promote a release.

## Files and ownership

| File                                                                | Purpose                                                                         |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `data/eval/runtime_answer_routing_v1.benchmark.json`                | Frozen synthetic prompts, events, expected routes, and contract-probe responses |
| `schemas/runtime_answer_routing_benchmark.schema.json`              | Strict public fixture schema                                                    |
| `scripts/audit-dime-answer-routing-v1.ts`                           | Deterministic generator that exercises the pure runtime APIs                    |
| `evidence/benchmarks/runtime-answer-routing-v1/local-baseline.json` | Checked-in local result with source hashes                                      |
| `evidence/benchmarks/runtime-answer-routing-v1/README.md`           | Evidence boundary and interpretation                                            |
| `tests/test_runtime_answer_routing_benchmark.py`                    | Fixture and evidence integrity tests                                            |
| `scripts/audit-dime-answer-routing-v1.test.ts`                      | Runtime-to-evidence reproduction test                                           |

The generator calls only these stable pure APIs:

- `planDimeAnswerRoute`;
- `resolveDimeEvent`; and
- `validateDimeResponseCompleteness`.

It does not connect to Railway, RunPod, Hugging Face, a provider endpoint, or
any production database.

## Frozen coverage

The 14 synthetic cases cover:

- broad and feature-specific platform questions;
- direct betting education;
- team-alias word boundaries;
- ISO, numeric, and relative dates using a frozen
  `America/New_York` clock;
- exact matchup resolution;
- adjacent-date disclosure;
- missing-event refusal;
- doubleheader ambiguity;
- ambiguous and invalid dates;
- the 12-row slate cap; and
- the runtime kill switch.

All events and response probes are synthetic. No account ID, thread ID, user
message, provider payload, production event, private prompt, or locked
evaluation appears in the fixture.

## Local metric definitions

The deterministic local report uses exact-match counts. A rate is
`passing checks / applicable frozen cases`.

| Metric                               | Definition                                                                                                                   |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Route exact match                    | Mode, platform scope, league, requested date, date source, retrieval cap, and bypass state all equal the frozen expectation  |
| Grounding-resolution exact match     | Resolution kind and selected synthetic event IDs equal the frozen expectation                                                |
| Completeness-guard expectation match | The guard returns the expected `passed`, `failed`, `not_applicable`, or `disabled` state for the synthetic contract response |
| Retrieval-cap compliance             | Selected rows never exceed the route cap                                                                                     |
| Retrieval-bypass compliance          | A bypassed route selects zero event rows                                                                                     |
| Full case contract accuracy          | Every preceding check passes for the case                                                                                    |

`grounding_resolution_exact_match` proves only that the correct synthetic
event identity was selected or rejected. It does not prove that a generated
answer's factual claims are supported.

## Post-deploy measurements

Live metrics are deliberately separate and `pending` in the local evidence.
They must be calculated from sanitized production traces only after the
measurement plan and thresholds are approved.

### Answer grounding

For each sampled response:

1. extract verifiable factual claims;
2. map each claim to the server-supplied evidence span or catalog fact;
3. mark a claim supported, contradicted, or unsupported; and
4. calculate `supported claims / all verifiable claims`.

Responses with no verifiable claims are reported separately and do not inflate
the rate. No raw user text or retrieved payload is committed to GitHub.

### Answer completeness

For each route, use its applicable rubric:

- platform capabilities: all required sections, features, and access
  boundaries;
- exact matchup: both teams, requested date when present, and freshness
  disclosure when data is delayed;
- nearby: requested and candidate dates plus confirmation request;
- ambiguous: ambiguity notice and candidate choice request;
- missing: no-data notice without substituted evidence;
- slate: at least one supplied event and no event outside the supplied set;
- educational: a direct explanation with hypothetical labeling when
  applicable.

The rate is `responses satisfying every applicable rubric item / applicable
responses`.

### Retrieval volume

Capture the number of candidate rows and selected rows for every request.
Report p50, p95, maximum, bypass violations, and cap violations by mode. A
platform or educational request selecting any event row is an immediate
failure.

### Latency

Capture monotonic durations for:

- routing;
- retrieval;
- provider generation; and
- total server processing.

Report p50 and p95 in milliseconds for each stage. Define the sample window,
deployment revision, endpoint revision, warm/cold state, and inclusion rules
beside the result. The deterministic local generator does not report latency
because filesystem, compilation, and workstation timing would not represent
the deployed service.

### Tokens and cost

Capture provider-reported prompt and completion tokens per successful request.
Report totals and per-request p50/p95. Dollar cost may be derived only when the
evidence includes a verified provider, model, price source, currency, and
price-effective timestamp for the same measurement window:

`prompt tokens × prompt unit price + completion tokens × completion unit price`

Without that price snapshot, token counts remain valid and monetary cost stays
`null`. The benchmark must never estimate or invent a price, saving, or gain.

### Failures

Report provider failure rate as:

`provider requests ending in timeout, transport error, invalid response, or
provider 5xx / all provider requests attempted`

Policy blocks, user cancellations, and intentional fail-closed routing
outcomes are separate counters; they are not provider failures.

## Rollback and promotion

Rollback is immediate and does not require a database change: set
`DIME_ANSWER_ROUTING_V1_ENABLED=false` on the serving application and redeploy.
That restores the existing bounded legacy retrieval path.

Immediately disable Runtime Answer Routing v1 with its kill switch if any of
these conditions occurs:

- platform or educational routing retrieves event rows;
- a nearby event is presented as exact;
- an ambiguous event is selected without confirmation;
- a missing event is replaced with another event;
- a retrieval cap is exceeded;
- the kill switch fails to restore the bounded legacy path; or
- private or production data appears in the benchmark or published evidence.

Do not promote beyond a controlled rollout when:

- any frozen case fails;
- required live metrics are missing;
- the owner-approved live thresholds are not recorded; or
- dollar cost is reported without a verified price snapshot.

This package intentionally does not invent numeric live thresholds. Those
thresholds must be approved against an observed serving baseline and recorded
before promotion.

## Reproduction

From the repository root:

```bash
pnpm exec tsx scripts/audit-dime-answer-routing-v1.ts --check
pnpm exec vitest run scripts/audit-dime-answer-routing-v1.test.ts
```

From `ml/dime-1.0`:

```bash
uv run pytest -q tests/test_runtime_answer_routing_benchmark.py
```

To intentionally regenerate the tracked result after an approved fixture or
runtime change, omit `--check`, review the diff, and update `SHA256SUMS`.
