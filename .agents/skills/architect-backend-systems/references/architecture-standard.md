# Backend Architecture Standard

Use this reference to derive decisions from requirements and evidence. It is a decision framework, not a mandate to use every technology or produce every artifact.

## Contents

1. Requirement model
2. Domain and topology
3. Contracts and clients
4. Data architecture
5. Security and privacy
6. Reliability and distributed behavior
7. Performance, capacity, and cost
8. Observability and operations
9. Delivery and evolution
10. External systems and organizational fit
11. Adversarial review

## 1. Requirement model

Define before designing:

- Actors, trust levels, critical journeys, business invariants, lifecycle transitions, and failure consequences.
- Request rate, concurrency, payload size, read-to-write mix, fan-out, burst shape, background volume, data growth, and geographic distribution.
- Consistency, durability, freshness, ordering, isolation, retention, deletion, residency, export, and audit requirements.
- p50, p95, and p99 latency targets; availability SLOs; throughput; RTO; RPO; and acceptable degraded behavior.
- Web, iOS, Android, cross-platform, internal, partner, device, and machine clients; supported versions; offline behavior; and release constraints.
- Data classification, threat actors, abuse cases, compliance duties, budget, staffing, ownership, and recovery capacity.

When values are unknown, expose the missing decision. Use explicit planning ranges only when they allow a reversible choice.

## 2. Domain and topology

Model business behavior before infrastructure:

- State invariants and legal transitions.
- Bounded contexts and dependency direction.
- Commands, queries, durable facts, projections, and derived state.
- Transaction boundaries and authorization boundaries.
- Canonical owner for each entity and mutation.

Choose topology from evidence:

| Need | Prefer | Require evidence before |
| --- | --- | --- |
| Early product or one owning team | Modular monolith with strict module boundaries | Splitting deployable services |
| Independent scaling or failure isolation | Extracted service around one bounded capability | Shared mutable databases |
| Long-running recoverable process | Durable workflow or explicit state machine | Ad hoc chains of jobs |
| Burst absorption or decoupling | Bounded queue with backpressure | Unbounded asynchronous fan-out |
| Independent read shapes | Projections or read models | Duplicating canonical writes |
| Global low-latency reads | Regional replicas, edge cache, or materialization | Multi-writer global state |

Distribution adds network failure, partial deployment, observability, data consistency, security, and ownership costs. Accept those costs only when they solve measured constraints.

## 3. Contracts and clients

For each API, message, event, webhook, or job, specify:

- Producer, consumer, purpose, authentication, authorization, and data classification.
- Typed request and response schema, validation, status or error taxonomy, and correlation identifiers.
- Idempotency scope and lifetime, timeout, retry eligibility, retry cap, backoff, and dead-letter or reconciliation path.
- Delivery semantics, ordering scope, deduplication, replay behavior, and compatibility guarantees.
- Pagination stability, filtering, sorting, rate limits, quotas, payload limits, and cache semantics.
- Versioning, additive-change rules, deprecation notice, minimum client version, and removal criteria.

Use REST for resource-oriented public contracts, GraphQL for controlled client-driven composition, gRPC for strongly typed internal calls, WebSocket or streaming for live updates, and asynchronous messages for temporal decoupling only when each choice matches the interaction and failure model.

For mobile clients, include intermittent connectivity, duplicated requests, stale binaries, restricted background work, resumable transfer, push delivery, device registration, attestation, secure token storage, remote configuration, feature rollout, kill switches, and conflict resolution. The server owns authorization and integrity even when the client validates locally.

## 4. Data architecture

Choose stores by access pattern and required guarantee:

- Relational databases for transactions, constraints, joins, and canonical business state.
- Document or key-value stores for access-pattern-aligned aggregates or extreme key-based scale, not to avoid modeling.
- Object storage for immutable or large blobs with metadata, integrity, lifecycle, and access controls.
- Search indexes, analytical warehouses, caches, and projections as rebuildable derived state unless explicitly made canonical.
- Queues and streams for bounded delivery or event history with named ownership and retention.

For each durable entity, define schema, constraints, keys, indexes, query patterns, owner, classification, encryption, retention, erasure, backup, restoration, and migration behavior. Verify indexes with representative queries and execution plans where possible.

Select correctness mechanisms deliberately:

- Transactions for invariants within one transactional boundary.
- Optimistic concurrency or compare-and-swap for conflicting writes.
- Unique constraints and idempotency records for retry-safe commands.
- Transactional outbox for atomic state and event publication.
- Saga or compensating action only when one transaction cannot span required owners.
- Deterministic reconciliation when providers, devices, or regions can disagree.

Define cache ownership, key structure, source of truth, TTL or invalidation, freshness guarantee, negative caching, stampede protection, memory bound, failure mode, and bypass path. Never let an unavailable cache corrupt canonical state.

Use expand-contract migrations: add compatible structures, backfill with measurement, dual-read or dual-write only with reconciliation, switch traffic behind a gate, verify, then remove old structures after the compatibility window. Define rollback or roll-forward behavior before mutation.

## 5. Security and privacy

Build a threat model from assets, actors, entry points, trust boundaries, abuse cases, and impact. Apply controls at every protected resource boundary.

Define:

- Standards-based authentication, short-lived credentials, refresh rotation, session revocation, service identities, and device trust where needed.
- Role-based, attribute-based, relationship-based, or scoped authorization based on resource semantics. Default deny and prevent cross-tenant access.
- Input validation, output encoding, parameterized data access, file isolation, request forgery defenses, replay resistance, and webhook signature verification.
- Rate limits, quotas, bot and abuse controls, resource caps, dependency integrity, secret isolation, key rotation, and tamper-evident audit records.
- Encryption in transit and at rest, key ownership, data minimization, privacy-preserving logs, consent, access, correction, export, erasure, residency, retention, and legal hold.

Do not record secrets, session tokens, raw payment data, unnecessary personal data, or unbounded payloads in logs. Treat client checks, gateway checks, and hidden routes as insufficient authorization.

## 6. Reliability and distributed behavior

Assume networks partition, dependencies slow, processes restart, clocks drift, messages duplicate or reorder, caches stale, deployments partially complete, and operators make mistakes.

For each dependency and critical path, define:

- Deadline and timeout hierarchy.
- Retry eligibility, budget, jitter, cap, and amplification risk.
- Circuit breaking, concurrency limit, queue bound, backpressure, load shedding, and graceful degradation.
- Idempotency and deduplication scope.
- Partial-failure behavior, compensation, reconciliation, and user-visible result.
- Regional containment, failover authority, data-loss bound, restore path, and recovery validation.

Retry only transient, safe, and budgeted operations. Ensure upstream deadlines exceed downstream work without allowing orphaned processing. Bound every queue, cache, connection pool, worker group, batch, upload, and fan-out.

Derive SLOs from critical journeys. Allocate error and latency budgets across dependencies. Separate infrastructure availability from successful user completion.

## 7. Performance, capacity, and cost

Build a workload model from measurable dimensions. Calculate peak and sustained requests, concurrent work, database connections, queue arrival and service rates, storage growth, egress, provider calls, and hot-key or tenant concentration.

Profile before optimizing. Inspect latency distributions, query plans, lock contention, cache hit quality, serialization, payload size, connection reuse, memory, queue delay, cold starts, round trips, throughput, and algorithmic complexity.

Use batching, compression, precomputation, materialized views, replicas, edge delivery, regional routing, streaming, or asynchronous work only when they improve a defined outcome. Include cost per request, tenant, job, stored unit, and growth scenario when cost influences the design.

Reject claims such as “supports millions of users” without traffic shape, data volume, topology, bottleneck assumptions, and measured or calculated evidence.

## 8. Observability and operations

For every critical journey, define:

- Structured logs, metrics, traces, audit records, correlation identifiers, and business outcome signals.
- Service-level indicators and objective, alert threshold, owner, severity, diagnostic context, and response path.
- Capacity, saturation, queue age, dependency, data quality, security anomaly, client-version, sync-conflict, and cost signals.
- Dashboard purpose, audience, decision supported, and retention.

Redact sensitive fields and control telemetry cardinality. Use synthetic checks for externally observable journeys. Alerts must be actionable, deduplicated, and connected to an owner or runbook.

## 9. Delivery and evolution

Require reproducible builds, immutable artifacts, configuration validation, least-privilege deployment identities, dependency verification, secret scanning, and infrastructure as code where infrastructure changes matter.

Choose tests from risks:

- Unit tests for domain behavior and invariants.
- Property-based tests for broad state or input spaces.
- Contract tests for independently deployed producers and consumers.
- Integration tests for real persistence and provider adapters.
- Migration tests for old and new schema or data states.
- Load tests for capacity hypotheses and overload behavior.
- Fault tests for dependency, network, process, and regional failure.
- Recovery tests for backup restore and environment reconstruction.
- Security tests for authorization boundaries and abuse cases.

Sequence deployments so database, API, event, worker, and client versions coexist safely. Use feature flags, canaries, progressive delivery, shadow traffic, or blue-green releases only with owners, observability, expiry, and rollback or roll-forward criteria.

## 10. External systems and organizational fit

Evaluate build versus buy using security, correctness, availability, data ownership, privacy, operational burden, pricing behavior, switching cost, concentration risk, integration complexity, and exit strategy.

Wrap providers behind verified adapters. Persist canonical request and result state when reconciliation matters. Validate signatures, deduplicate callbacks, bound timeouts and retries, record provider identifiers, and provide replay or manual recovery paths.

Match architecture to team boundaries, deployment ownership, on-call capacity, review responsibility, and cognitive load. Standardize authentication, authorization, validation, errors, telemetry, configuration, persistence, messaging, testing, and delivery where standardization reduces failure without erasing domain boundaries.

## 11. Adversarial review

Before accepting a design, challenge it with:

- Concurrent updates, replay, duplicates, out-of-order messages, delayed events, stale reads, and clock skew.
- Database, cache, queue, identity provider, payment provider, object store, DNS, region, and control-plane outage.
- Hot key, noisy tenant, traffic spike, retry storm, poison message, oversized payload, slow consumer, and exhausted connection pool.
- Partial deployment, incompatible schema, rollback after migration, stale mobile release, failed backfill, and corrupted derived state.
- Cross-tenant access, credential theft, privilege escalation, malicious files, injection, request forgery, webhook spoofing, insider misuse, dependency compromise, and denial of service.
- Backup loss, restore failure, deleted data, regional evacuation, key rotation, provider exit, and complete environment reconstruction.

For each material case, define prevention, detection, containment, recovery, user-visible behavior, owner, and proof or planned validation.
