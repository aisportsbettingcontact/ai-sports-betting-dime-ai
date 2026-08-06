# Dime AI v1 System Architecture

## Decision

Build Dime AI v1 as a **modular monolith with an isolated GPU inference
process**. Do not begin with microservices, an autonomous agent, or a model that
has direct access to databases or provider APIs.

This design is proposed and executable, but it is not approved for production
exposure. Provider rights, policy rules, retention, workload, SLO, recovery,
client, and operational-ownership decisions remain open.

## Objective and non-goals

Dime AI should let an authenticated user:

- analyze games, matchups, trends, projections, lines, prices, and market
  splits;
- receive evidence-grounded explanations of live and historical market data;
- receive constructive coaching based on authorized Bet Tracker aggregates;
- request versioned simulations and receive conditional interpretations.

The v1 model is not:

- a sportsbook or bet-execution service;
- an authority for identity, eligibility, consent, jurisdiction, self-exclusion,
  or private-data access;
- a source of live facts, deterministic calculations, or simulation results;
- permitted to move funds, place wagers, modify accounts, or write canonical
  user state;
- a substitute for verified responsible-gaming or crisis resources.

## Observed evidence

- The exact Base checkpoint and revision load in 4-bit on the approved RTX 4090
  runtime.
- The three-case Base control called no tools and passed no deterministic case.
- The three-step QLoRA rehearsal proves training, save, fingerprint, reload, and
  adapter-effect mechanics only.
- The starter defines seven read-only tool intentions and deterministic market
  math, but it does not contain a production gateway, provider ingestion,
  retrieval, simulation engine, policy service, or inference server.
- The current generic tool-response `data` object is a development envelope,
  not a production response contract.

The Base or rehearsal adapter must not be connected to users.

## Context

```text
Dime client
    |
    v
Authenticated AI API
    |
    +--> policy and entitlement gate
    |
    +--> conversation orchestrator
            |
            +--> complete-mediation tool broker
            |       +--> normalized market/game data
            |       +--> deterministic market math
            |       +--> versioned simulation
            |       +--> user-bound Bet Tracker aggregates
            |
            +--> isolated Llama inference process
            |
            +--> evidence and output verifier
    |
    v
verified answer or deterministic abstention
```

The first implementation should remain one codebase with strict modules and
three processes:

1. **AI API/orchestrator** — authentication, turn state, policy enforcement,
   context assembly, tool brokerage, and answer verification.
2. **Background worker** — provider ingestion, bounded simulation jobs,
   conversation summaries, export, and deletion workflows.
3. **GPU inference process** — one immutable, approved Base+adapter release
   with no database, provider, user-token, or arbitrary-network credentials.

Use the existing relational database if it satisfies the required constraints.
Use object storage only for licensed immutable provider snapshots or large
simulation artifacts when required. Do not add a vector database, stream
platform, or independently deployed service without measured need.

## Canonical ownership

| State or capability | Canonical owner | Model visibility |
|---|---|---|
| User, tenant, session | Existing identity/account domain | No token or canonical identifier |
| Age, jurisdiction, consent, self-exclusion, risk state | Policy domain | Only permitted capability or deterministic block |
| Events, schedules, injuries, results | Normalized sports-data domain | Typed, timestamped read result |
| Odds, history, and splits | Provider-scoped market snapshot domain | Entitlement-filtered typed result |
| Bets and settlements | Bet Tracker domain | Minimum-necessary aggregate for the authenticated subject |
| Conversation messages | AI conversation domain | Bounded recent context and versioned summary |
| Market calculations | Deterministic math module | Versioned result |
| Simulation runs | Simulation registry/run store | Versioned distribution summary |
| Model/prompt/template/tools | Dime release registry | Loaded immutable release |
| Policy and tool-access audit | Append-only audit owner | No access |
| Caches, summaries, indexes | Rebuildable derived state | Never authoritative |

Provider payloads, retrieved text, user messages, Bet Tracker notes, and model
output are untrusted input. Training and production are separate trust zones;
training jobs receive no production database credentials or provider secrets.

## Turn state machine

```text
accepted
  -> policy_checked
  -> context_built
  -> tooling
  -> generated
  -> verified
  -> completed

terminal:
blocked_by_policy | answer_unavailable | failed | cancelled
```

Persist each transition with an opaque correlation ID. A final answer is
visible only after verification. Status events may stream, but unverified model
tokens must not.

Provisional safety ceilings, to be measured before approval:

- two model/tool rounds;
- six tool calls per turn;
- two concurrent expensive calls;
- one bounded repair generation;
- fixed prompt, output, payload, and simulation budgets.

These are abuse and cost bounds, not demonstrated capacity limits.

## Minimum client contract

Proposed resource operations:

- `POST /v1/ai/conversations`
- `POST /v1/ai/conversations/{conversation_id}/turns`
- `GET /v1/ai/turns/{turn_id}`
- `GET /v1/ai/turns/{turn_id}/events`
- `GET /v1/ai/conversations/{conversation_id}`
- `DELETE /v1/ai/conversations/{conversation_id}`
- `POST /v1/ai/privacy/export`

Turn creation requires an idempotency key scoped to tenant, authenticated
subject, conversation, and key. A duplicate returns the original turn.

The client may provide a message, locale, timezone, and selected event
reference. It must not provide authoritative tenant/user identity, age, risk
state, jurisdiction, consent, entitlements, or allowed tools.

Use stable problem responses such as `invalid_request`,
`authentication_required`, `resource_not_found`, `consent_required`,
`blocked_by_policy`, `rate_limited`, `dependency_unavailable`, and
`deadline_exceeded`. Never reveal whether another tenant's resource exists.

## Complete-mediation tool broker

The model proposes only a name and arguments:

```json
{
  "name": "get_current_odds",
  "arguments": {
    "event_id": "opaque-event-reference",
    "market": "canonical-market-key"
  }
}
```

The broker validates that proposal and injects all security context:

```json
{
  "tool_call_id": "opaque",
  "turn_id": "opaque",
  "tenant_id": "server-owned",
  "subject_id": "server-owned",
  "policy_decision_id": "server-owned",
  "entitlement_set_id": "server-owned",
  "requested_at_utc": "UTC timestamp",
  "tool_catalog_version": "immutable version"
}
```

No server-owned field may be accepted from model-generated arguments.

Every result uses a common envelope plus a separate exact `data` schema for
each tool:

```json
{
  "schema_version": "dime.tool-response.v1",
  "tool_name": "get_current_odds",
  "tool_version": "1.0.0",
  "tool_call_id": "opaque",
  "status": "ok",
  "as_of_utc": "UTC timestamp",
  "valid_until_utc": "UTC timestamp",
  "source_ids": ["opaque-source-reference"],
  "source_scope": {},
  "data": {},
  "quality_flags": [],
  "warnings": [],
  "trace_id": "opaque"
}
```

Unknown fields fail validation. The release manifest binds the Base, adapter,
prompt, template, tool schemas, policy, math, simulator, and evaluator versions.

### Production tightening required

| Current tool | Required production constraint |
|---|---|
| `get_game_context` | Canonical event reference, field allowlist, timestamp per fact |
| `get_current_odds` | Canonical market key, provider/book scope, selection, line, price, observation, freshness, and envelope-authorized quote source |
| `get_odds_history` | Requested/returned range containment, stable pagination, chronological order, truncation/gap flags, and envelope-authorized item sources |
| `get_market_splits` | Server-owned entitlement scope, provider universe, methodology, selection-keyed ticket/handle percentages, complete/partial coverage, sample size or explicit unknown |
| `calculate_market_math` | Operation-specific schema, Decimal-string output, formula/version, no executable expression |
| `get_bet_tracker_summary` | Server-bound subject, aggregates only, sample and coverage disclosures |
| `run_simulation` | Server-selected approved version, bounded draws, immutable inputs, seed, artifact hash and calibration version |

Conversation history is orchestrator context, not a model-callable search across
users.

## Security and privacy invariants

- Derive tenant and subject from a verified server session.
- Enforce resource authorization at each conversation and Bet Tracker query.
- Never forward a browser token to the model or GPU process.
- Use least-privilege read identities for provider adapters.
- Personalization consent and training-data consent are separate and default
  off.
- Do not pass raw Bet Tracker notes or arbitrary rows; compute normalized
  aggregates server-side.
- Keep policy rationale and sensitive risk attributes out of ordinary prompts.
- Do not share prompt caches, KV caches, summaries, or retrieval results across
  users.
- Model output cannot update durable memory, policy, profile, or canonical
  facts.
- Support deletion across messages, summaries, projections, future datasets,
  and any later embeddings.
- Redact telemetry by default and never log secrets or access tokens.

## Responsible-gaming enforcement

Evaluate policy:

1. before model inference;
2. before every tool execution;
3. before displaying the final answer.

Server-owned outcomes include allowing education, public analysis, live
analysis, personalized coaching, or bounded simulation; blocking wagering
assistance; and selecting a deterministic protective flow.

For underage, self-excluded, blocked-jurisdiction, severe-distress, or
immediate-harm states, prefer reviewed application content over ordinary model
generation. The model must never invent contact resources. Exact policy and
escalation rules require product and legal approval.

## Evidence verifier

Before display:

- current lines, splits, injuries, results, simulations, and coaching metrics
  must trace to a tool result and source ID;
- every assistant numeric token must trace to a linked successful tool result,
  and deterministic market-math outputs must also be recomputed from their
  recorded tool arguments;
- event, market, period, selection, and timestamp identities must agree;
- freshness policy must pass;
- split scope and unavailable sample size must be disclosed, and a known
  sample must contain at least one observation;
- each nonempty tool result must exactly acknowledge its originating
  schema-valid call arguments, including deterministic optional defaults;
- registry scope/freshness classes, Decimal numeric domains, temporal
  relationships, and nested server-owned argument exclusion are enforced by
  the local contract validator;
- warnings are closed codes bound to exact tool, status, and quote semantics
  rather than provider prose; schema failures expose only governed schema
  locations/categories; and every public response validation requires the
  originating arguments;
- unsupported causal claims about market movement must be suppressed;
- simulations must name version, inputs, seed, draws, and limitations;
- guarantees, loss chasing, authorization bypass, and cross-user access are
  blocked.

If verification fails, allow one bounded repair against the same evidence. If
that fails, return a deterministic abstention.

## Provisional dependency ceilings

These are starting circuit-breaker budgets to test, not production SLOs:

| Operation | Initial ceiling | Retry |
|---|---:|---|
| Authentication/policy | 300 ms | None; fail closed |
| Local game/current-odds read | 750 ms | None in turn path |
| History/splits/Bet summary | 1.5 s | One transient read retry within budget |
| Deterministic math | 100 ms | None |
| Synchronous simulation | 5 s | None; larger work becomes a persisted job |
| Model inference | 20 s | No retry after generation starts |
| Output verification | 750 ms | One repair, not an infrastructure retry |
| Whole turn | 30 s | Client may replay the same idempotency key |

Provider ingestion runs outside the chat request. Direct provider fallback is
off initially.

## Failure matrix

| Failure | User-visible behavior | Required control |
|---|---|---|
| Policy unavailable | No private/wagering assistance | Fail closed; static education only if explicitly allowed |
| Odds stale/missing | No current-market claim | Return freshness/absence and abstain |
| History partial | Gap disclosure; no causal conclusion | Typed truncation and gap flags |
| Split sample unavailable | Explicitly unknown | Never imply whole-market coverage |
| Bet Tracker unavailable/unauthorized | No personalized assessment | Do not disclose record existence |
| Simulation timeout | No synthetic result | Bounded job or answer unavailable |
| Model timeout | No partial text | `answer_unavailable` |
| Cache unavailable | Slower canonical read | Bypass; cache is never authoritative |
| Queue saturated | Retryable rejection | Bounded queue, `429/503`, `Retry-After` |
| Duplicate request | Original turn returned | Durable idempotency record |
| Provider outage | Only approved-fresh snapshots | Circuit breaker and freshness gate |
| Policy/verifier defect | Capability disabled | Independent kill switches |

## Observability

Propagate a W3C `traceparent` and record opaque request, conversation, turn,
model-run, tool-call, policy-decision, and simulation-run identifiers.

Measure version identities, state latency, queue age, concurrency, tokens, GPU
latency, tool count, source freshness, gaps, provider failures, policy blocks,
verifier rejections, repairs, abstentions, export/deletion outcomes, and cost.
Do not log raw private prompts, Bet Tracker rows, access tokens, or sensitive
policy attributes.

## Delivery sequence

1. **Contract closure** — approve market keys, provider rights, freshness,
   policy, retention, workload, SLO, recovery, and owners.
2. **Deterministic control plane** — turn state machine, broker, math dispatch,
   policy interface, audit events, and synthetic adapters. No model output to
   users.
3. **Isolated model shadow** — immutable release binding and full system
   evaluation on fixtures.
4. **Public market beta** — licensed ingestion and read-only public analysis.
5. **Versioned simulation** — reproducibility, calibration, bounds, and job
   recovery.
6. **Private coaching** — explicit consent, aggregates, retention/export/delete,
   and cross-tenant testing.
7. **Limited canary** — on-call ownership, kill switches, dashboards, alerts,
   incident drills, and rollback.

Extract a separately deployed service only after telemetry demonstrates an
isolation, scaling, or ownership need.

## Unresolved decisions

The proposed Foundation request and response boundary is now concretized by
the [tool and canonical market contracts](TOOL_AND_MARKET_CONTRACTS.md).
Those contracts close market identity and exact response shapes without
selecting a provider, implementing an authenticated broker, or authorizing
production. Server-owned entitlement, subject, policy, and simulation choices
remain outside model-visible arguments.

Production work still requires:

- backend language/framework, database, identity, hosting, and deployment
  evidence;
- tenant and Bet Tracker authorization semantics;
- clients, compatibility windows, and offline behavior;
- peak/sustained work, payloads, concurrency, growth, and geography;
- latency/availability targets, RTO/RPO, cost budget, and on-call ownership;
- provider rights, caching, attribution, retention, and failover;
- jurisdiction, age, self-exclusion, risk, and escalation rules;
- conversation, provider, simulation, audit, and backup lifecycle rules;
- simulation method, validation, calibration, versioning, and compute budget;
- freshness thresholds for each data class;
- privacy/export/erasure obligations and whether user-data training will ever
  be allowed;
- serving isolation and network policy for Llama.

Useful primary references include the
[OAuth 2.0 Security BCP](https://datatracker.ietf.org/doc/rfc9700/),
[OWASP prompt-injection guidance](https://genai.owasp.org/llmrisk/llm01-prompt-injection/),
[OWASP excessive-agency guidance](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/),
[W3C Trace Context](https://www.w3.org/TR/trace-context/), and the
[NIST Generative AI Profile](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence).
