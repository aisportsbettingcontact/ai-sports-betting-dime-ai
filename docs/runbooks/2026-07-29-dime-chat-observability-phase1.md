# Dime Chat Observability Phase 1 Runbook

## Status

Local implementation only. This runbook does not authorize deployment, route
activation, shadow traffic, provider activation, model training, or release.

## Scope

Phase 1 observability is additive to Conversation Trace v1:

- complete request/application/model/prompt/route/control identity;
- explicit tool states for no-tool, selected, success, empty, failure, timeout,
  stale, malformed, and rejected outcomes;
- distinct event, provider, source, ingestion, retrieval, and response times;
- classification, resolution, retrieval, tool, context, model, validation, and
  end-to-end latency;
- context volume and quality fields;
- reviewed-registry price-based cost estimates; and
- privacy-safe route-level distribution helpers plus a frozen nine-route
  benchmark.

Sanitized Phase 1 structures use the existing append-only Trace v1 event
metadata. Migration `0122_dime_evidence_lifecycle_v1.sql` adds nullable,
no-default lifecycle fields to `games`; it does not backfill, enable tracing,
or write trace rows. Apply it before deploying the Phase 1 read path, using the
dedicated migration and disabled-state parity runbooks.

## Required deployment identity

Trace-enabled deployments fail before inference when either source commit or
environment identity is missing. Railway normally supplies:

```text
RAILWAY_GIT_COMMIT_SHA
RAILWAY_ENVIRONMENT_NAME
```

Non-Railway environments must provide:

```text
GIT_COMMIT_SHA
NODE_ENV
```

`DIME_APPLICATION_VERSION` is optional and defaults to the package version.
Never use `unknown`, a branch name, or a mutable tag as the Git commit.

## Governed pricing configuration

Dollar cost is emitted only when this setting points to a reviewed,
checksum-valid registry:

```text
DIME_PRICING_REGISTRY_PATH
```

The selected entry must exactly match provider, model, and model revision; be
effective at request time; retain its historical effective interval; and
include token, request, and tool rates in USD plus source, reviewer, review
time, and checksums. Unknown, ambiguous, expired, unreviewed, or modified
entries record `cost_unavailable`. There is no fallback.

## Verification

```bash
corepack pnpm run check
corepack pnpm exec vitest run \
  server/_core/dimeTraceObservability.test.ts \
  server/_core/dimeEvidenceProvenance.test.ts \
  server/_core/dimePricingGovernance.test.ts \
  server/_core/dimeTrafficEvidence.test.ts \
  server/_core/dimeChatContext.test.ts \
  server/_core/dime1AnswerRouting.integration.test.ts \
  server/dimeChatTrace.test.ts \
  scripts/audit-dime-product-routes-v1.test.ts
corepack pnpm exec tsx scripts/audit-dime-product-routes-v1.ts --check
cd ml/dime-1.0
./.venv/bin/python -m pytest \
  tests/test_product_route_observability_benchmark.py
```

The owner-only `dimeRuntime.observability` procedure accepts no input and
returns configuration-presence booleans and measurement status only. It must
never expose raw traces, trace identifiers, prompts, responses, account data,
endpoint values, credentials, or environment values.

## Known incomplete evidence

The local schema can persist authoritative market-observation and ingestion
lifecycle times, pipeline revision, and run identity. Historical values remain
null, production migration 0122 is not yet applied, and current producers do
not yet establish complete authoritative lifecycle evidence. Provider identity
and provider revision are also not persisted. Dynamic game context therefore
remains `delayed`, its tool outcome remains `stale`, missing provider evidence
is explicitly `unavailable`, and the Phase 1 completeness assessment remains
failed until production-derived evidence proves otherwise.

Representative sanitized observational traffic is also required before
publishing route-level latency, context, failure, and cost distributions. Raw
prompt or response text is rejected by the aggregation contract. The local
synthetic benchmark does not substitute for production-derived measurements.

## Rollback

Restore the pre-Phase 1 application first while tracing remains disabled.
Migration 0122 is additive, so its nullable columns normally remain through the
compatibility window. Physical removal requires the separate, manual guarded
rollback and explicit data-disposition approval. Existing Trace v1 rows and
pre-Phase 1 event metadata remain readable. Do not delete trace records as part
of rollback; existing retention policy remains authoritative.
