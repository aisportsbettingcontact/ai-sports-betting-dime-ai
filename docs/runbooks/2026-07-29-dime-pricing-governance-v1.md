# Dime pricing governance and runtime attestation v1

## Purpose

This control closes the cost-accounting precondition for observational Dime
Chat traces. It does not activate tracing, a provider, a route, Research Alpha,
training, or deployment.

Pricing resolution is exact and fail-closed. A priced result requires:

- registry status `approved`;
- entry review status `approved`;
- exact provider, model, and model-revision equality;
- an effective interval containing the request time;
- a valid entry checksum; and
- an explicit cached-input rate whenever cached tokens are present.

Every other state returns `cost_unavailable` with null dollar values. The
frozen provider and deterministic server runtime use the separately identified
`zero_cost_runtime` contract; they are not unknown provider pricing and do not
justify a provider entry.

## Review state machine

```text
review_required
→ independently_reviewed
→ approved
```

The author of an entry cannot be its only independent reviewer. Do not use
wildcard providers or models, provider-wide fallbacks, unversioned prices,
inferred cache discounts, or the closest available model.

## Configuration

The packaged registry is:

```text
/app/ml/dime-1.0/configs/dime_observability_pricing_v1.json
```

Runtime variables:

```text
DIME_PRICING_REGISTRY_PATH
DIME_PRICING_REGISTRY_SHA256
```

The checksum variable is optional during local review and required by the
production-change request. A configured mismatch fails closed.

Do not configure either production variable until the registry PR is
independently approved and merged under separate deployment authority.

## Runtime attestation

The application emits one bounded startup line beginning with:

```text
[DIME_PRICING] version=dime-pricing-attestation-v1
```

The owner-only `dimeRuntime.observability` procedure returns the same
attestation as structured data. It contains only:

- whether a path and expected checksum are configured;
- registry revision, observed checksum, and review status;
- approved entry count;
- active provider, model, model revision, and deployment tier;
- currency and explicit zero-cost-runtime state; and
- whether one exact approved entry matches the active runtime tuple.

It never returns the configured filesystem path, endpoints, credentials, API
keys, complete environment contents, prompts, responses, or trace records.

Startup logs establish deployment-start state. The owner-only procedure is the
authoritative current-process check.

## Verification

From the repository root:

```bash
pnpm exec vitest run \
  server/_core/dimePricingGovernance.test.ts \
  server/_core/dimePricingAttestation.test.ts \
  server/_core/dimeTraceObservability.test.ts
pnpm run check
pnpm run build
```

Before a separately authorized production rollout, require:

```text
path_configured=true
registry_status=approved
approved_entries=1
registry_checksum=<independently reviewed SHA-256>
exact_match=true
```

Keep the following state throughout the pricing-only rollout:

```text
trace_enabled=false
shadow_enabled=false
route_activation=false
research_alpha_enabled=false
research_alpha_kill_switch=true
```

Abort or roll back if the startup and owner attestations disagree, the checksum
does not match, the runtime tuple has no exact entry, health or feed parity
regresses, or any restricted value is exposed.
