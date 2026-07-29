# Dime Phase 1 Disabled-State Deployment Parity

## Status and authority

This is the exact parity procedure for the first Phase 1 production rollout.
It is locally prepared but not executed. It does not authorize a Railway
deployment, database mutation, variable change, trace capture, Research Alpha
change, shadow execution, route activation, or model change.

The goal is code, schema, configuration, and artifact parity while preserving:

```yaml
trace_flag: disabled
route_activation: false
shadow_authorized: false
user_behavior_changed: false
```

## Required separation

Use distinct reviewed operations in this order:

1. review and freeze the application commit;
2. apply and verify migration 0122 while the old application serves;
3. deploy the frozen application commit with tracing disabled;
4. verify parity and behavior;
5. separately review the Research Alpha kill-switch hardening proposal; and
6. only later submit a separate observational trace-activation proposal.

Do not combine database migration, application deployment, trace activation,
Research Alpha configuration, route activation, or shadow execution.

## Frozen deployment inputs

Record before any production action:

- full 40-character source commit;
- package/application version;
- `dime-composite-engineering-control-v1`;
- `trace-v1-phase1-2026-07-29`;
- migration `0122_dime_evidence_lifecycle_v1`;
- pricing registry revision and SHA-256;
- Docker image digest; and
- rollback application commit and image digest.

The bounded pricing registry must exist in the image at:

```text
/app/ml/dime-1.0/configs/dime_observability_pricing_v1.json
```

Its initial `review_required` state is valid for disabled-state parity but does
not satisfy the later pricing-approval gate and must resolve costs as
unavailable.

## Required environment state

The first deployment must retain:

```text
DIME_CHAT_TRACE_V1_ENABLED=false
```

Configure these non-secret identities to the frozen artifacts:

```text
DIME_APPLICATION_VERSION=<immutable release label>
DIME_PRICING_REGISTRY_PATH=/app/ml/dime-1.0/configs/dime_observability_pricing_v1.json
```

Do not change `DIME_ANSWER_ROUTING_V1_ENABLED`, the model provider, model
endpoint, model revision, Research Alpha variables, traffic percentages, or
retention settings in this deployment.

## Pre-deployment verification

From the reviewed source:

```bash
corepack pnpm run check
corepack pnpm exec vitest run \
  server/_core/dimeEvidenceLifecycleMigration.test.ts \
  server/_core/dimeEvidenceProvenance.test.ts \
  server/_core/dimePricingGovernance.test.ts \
  server/_core/dimeTrafficEvidence.test.ts \
  server/_core/dimeTraceObservability.test.ts \
  server/_core/dimeChatContext.test.ts \
  server/_core/dime1AnswerRouting.integration.test.ts \
  server/dimeChatTrace.test.ts \
  scripts/audit-dime-product-routes-v1.test.ts
corepack pnpm run build
corepack pnpm run check:bundle
```

Build the production Docker image and verify the pricing artifact inside it.
Record its SHA-256 and compare it with the reviewed source artifact. Do not
print registry entries or environment values into logs.

Complete migration 0122 using the dedicated migration runbook before the
application deployment.

## Deployment

Deploy only the frozen application image. Keep the existing one-replica
topology and region. Do not enable tracing during or after the rollout.

If the health check fails, the application cannot read the migrated schema, or
the deployed image identity differs from the frozen input, roll back the
application immediately. Do not repair parity by enabling a flag or changing a
route.

## Post-deployment parity

Capture sanitized evidence for:

1. Railway directly reports the exact 40-character deployed commit.
2. The owner-only `dimeRuntime.engineeringControl` revision matches.
3. The owner-only `dimeRuntime.observability` trace-schema revision and
   application version match.
4. `dimeRuntime.observability` reports the pricing registry configured and
   loaded; reviewed remains false until a separate pricing review.
5. Migration 0122 and all seven exact column definitions are present.
6. `DIME_CHAT_TRACE_V1_ENABLED=false` is directly verified.
7. Runtime Answer Routing and provider/model configuration are unchanged.

Run the public smoke suite against both the Railway origin and the custom
domain:

```bash
node scripts/smoke-deploy.mjs <railway-origin>
node scripts/smoke-deploy.mjs https://aisportsbettingmodels.com
```

With one authorized test account, compare the same frozen-provider Dime Chat
request before and after deployment. Verify:

- the same SSE frame ordering and terminal event;
- the same hardcoded/frozen response text;
- no alternative answer or model call;
- no route-policy change;
- no raw prompt or response in new trace metadata; and
- no client error or reconnect regression.

Record counts for `dime_chat_sessions`, `dime_chat_turns`,
`dime_chat_generations`, and `dime_chat_trace_events` immediately before and
after that request. With tracing disabled, each delta must be zero. Do not
infer this from the flag alone.

## Parity verdict

The evidence artifact must contain exactly:

```yaml
deployment_parity:
  application_commit: verified
  control_plane_revision: matched
  schema_revision: matched
  pricing_registry_revision: matched
  trace_flag: disabled
  route_activation: false
  shadow_authorized: false
  user_behavior_changed: false
```

Any unknown, inferred, mismatched, or unmeasured value fails parity. A parity
pass does not authorize trace activation.

## Rollback

Rollback triggers include:

- health or SSE failure;
- commit, application, control, schema, or pricing mismatch;
- a new trace-table write;
- raw-content retention;
- answer, route, provider, or model behavior change; or
- migration incompatibility.

Restore the prior application image first and retain tracing disabled. The
additive columns normally remain. Use the manual migration rollback only under
its separate destructive approval and preconditions.
