# Backend Deliverable Contracts

Select the smallest set of artifacts that makes the requested decision or implementation executable. Do not produce an artifact when it has no consumer or acceptance role.

## Contents

1. Architecture brief
2. Architecture decision record
3. Context and component model
4. Domain and data model
5. API and event contract
6. Threat model
7. Reliability and capacity plan
8. Failure matrix
9. Migration and delivery plan
10. Implementation handoff
11. Audit report

## 1. Architecture brief

Include:

- Problem, objective, users, non-goals, and decision status.
- Current constraints and directly observed evidence.
- Workload, integrity, security, compatibility, availability, recovery, cost, and ownership requirements.
- Proposed boundaries, data flows, stores, contracts, dependencies, and deployment topology.
- Principal decisions, alternatives, tradeoffs, assumptions, risks, and unresolved questions.
- Implementation stages, validation gates, and stopping condition.

## 2. Architecture decision record

Record one material decision per ADR:

- Title and status.
- Context and decision drivers.
- Options considered with evidence-based tradeoffs.
- Decision and rationale.
- Positive and negative consequences.
- Reversibility, migration path, validation evidence, owner, and revisit triggers.

Do not use an ADR to conceal an unresolved decision. Mark it proposed when approval or evidence is missing.

## 3. Context and component model

Show only elements needed to understand boundaries and responsibility:

- Actors and external systems.
- Trust boundaries and data classifications.
- Deployable units or modules and their owners.
- Synchronous calls, asynchronous flows, canonical data ownership, and derived stores.
- Protocols and relevant security or failure semantics.

Accompany diagrams with a short legend and the decisions they support. Keep diagrams consistent with written contracts and repository reality.

## 4. Domain and data model

Define:

- Entities, value objects, identifiers, relationships, and bounded contexts.
- Invariants, state machine, legal transitions, commands, and authorization rules.
- Canonical owner, transaction boundary, consistency model, and concurrency control.
- Schema fields, types, nullability, constraints, indexes, retention, deletion, encryption, and audit behavior.
- Query and mutation patterns, estimated cardinality and growth, backup, restore, and migration behavior.

Use database-specific DDL only after confirming the target engine and version. Separate canonical state from caches, indexes, projections, and analytics.

## 5. API and event contract

For an API, include:

- Operation, method or procedure, path or name, purpose, caller, and owner.
- Authentication and resource-level authorization.
- Request, response, validation, errors, pagination, filtering, sorting, and limits.
- Idempotency, concurrency, timeout, retry, rate limit, caching, and observability.
- Versioning, compatibility, deprecation, and representative examples.

For an event or message, include:

- Event name and semantic meaning as a durable fact or command.
- Producer, consumers, schema, key, partitioning, and data classification.
- Delivery, ordering, deduplication, replay, retention, retry, poison-message, and dead-letter behavior.
- Schema evolution, ownership, tracing, reconciliation, and acceptance tests.

For a webhook, add signature verification, replay window, source allow-list policy if justified, callback idempotency, provider identifiers, and reconciliation after missed delivery.

## 6. Threat model

Include:

- Protected assets, sensitive operations, actors, trust boundaries, and entry points.
- Abuse cases and threats ranked by plausible impact and exposure.
- Existing controls supported by evidence.
- Required preventive, detective, containment, and recovery controls.
- Residual risk, owner, validation method, and unresolved security decisions.

Never call a system secure because a framework, gateway, private network, or cloud provider is present. Verify the relevant configuration and resource boundary.

## 7. Reliability and capacity plan

Include:

- Critical journeys, SLI definitions, SLOs, error budgets, and owners.
- Peak and sustained workload inputs with formulas, ranges, and sensitivity cases.
- Bottleneck model for application work, database, connections, queues, storage, networks, providers, and regional limits.
- Timeouts, retries, concurrency limits, rate limits, backpressure, load shedding, and degraded modes.
- RTO, RPO, backup, restore, failover, regional containment, and recovery tests.
- Cost model and thresholds that trigger scaling or redesign.

Label unmeasured values and state what benchmark, load test, or telemetry would validate them.

## 8. Failure matrix

Use one row per material failure:

| Failure | User impact | Prevention | Detection | Containment | Recovery | Owner | Validation |
| --- | --- | --- | --- | --- | --- | --- | --- |

Cover dependency timeout, retry amplification, database contention or outage, cache failure, queue backlog, duplicate or poison messages, partial deployment, incompatible schema, provider outage, regional failure, credential compromise, and restore failure when relevant.

## 9. Migration and delivery plan

For each stage, define:

- Preconditions, change scope, owner, dependency, compatibility window, and approval.
- Data migration or backfill algorithm, checkpointing, throttling, reconciliation, and measurement.
- Deployment order across schemas, services, workers, events, and clients.
- Feature gate, traffic exposure, observability, acceptance threshold, and cost guardrail.
- Rollback or roll-forward action and the point after which rollback becomes unsafe.
- Completion evidence and removal criteria for old paths, flags, columns, topics, or services.

Prefer small independently verifiable slices. Do not use dual writes without a named reconciliation mechanism and exit condition.

## 10. Implementation handoff

Provide:

- Ordered work packages with purpose, boundaries, dependencies, and acceptance criteria.
- Exact modules, contracts, schemas, configuration, tests, dashboards, alerts, and runbooks to add or change.
- Security and data-integrity invariants that reviewers must verify.
- Validation commands or environments, rollout gates, ownership, and unresolved decisions.
- Definition of done that includes compatibility, telemetry, recovery, and removal of temporary mechanisms.

Do not create false precision by naming files or services that were not inspected. Use clearly labeled proposed paths when the repository is unavailable.

## 11. Audit report

Lead with the decision-relevant conclusion. For each finding, include:

- Severity based on impact, likelihood, exposure, and recoverability.
- Direct evidence with file, configuration, command, telemetry, or reproducible behavior.
- Violated invariant or requirement.
- User, data, security, reliability, cost, or operational consequence.
- Root cause or explicitly labeled hypothesis.
- Smallest safe remediation, alternatives, migration risk, and verification method.

Separate confirmed findings from missing evidence and improvement opportunities. Do not convert absence of evidence into proof of a defect, and do not claim remediation success until the changed state is tested.
