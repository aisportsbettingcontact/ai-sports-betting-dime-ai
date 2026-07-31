# Dime Route-Aware Context Compiler v1

Status: `IMPLEMENTED_OFFLINE_NOT_ACTIVATED`

The compiler is an additive, pure packing layer for the existing Runtime Answer
Routing v1 and Dime Chat retrieval path. It does not classify requests, retrieve
records, call tools, invoke a model, activate a route, or change a production
answer.

## Contract

The caller supplies normalized, source-bound context items containing:

- stable fact, source, and authority identities;
- provider-observation and retrieval timestamps;
- freshness and contradiction state;
- required/optional status;
- a structural token estimate; and
- bounded decision value.

The compiler validates the route policy, deduplicates exact semantic material,
preserves contradictions, packs every required fact, ranks optional evidence by
marginal decision value per token, and emits an explicit omitted-fact ledger.
If required facts exceed the route budget, compilation fails rather than
truncating.

All token counts remain
`STRUCTURAL_ESTIMATE_NOT_MODEL_EXACT` until the selected tokenizer is frozen.

## Route boundaries

- `platform` and `account` prohibit game retrieval.
- `educational`, `bet_explanation`, and `general_sports` require an explicit
  request before dynamic retrieval is admitted.
- `matchup` permits one exact event or at most two explicit candidates.
- `historical` requires a point-in-time cutoff.
- `live_data` requires authoritative observation timestamps on every dynamic
  item.

## Offline acceptance

```text
critical_fact_recall = 1.0
route_policy_violations = 0
duplicate_context_rate <= 0.02
irrelevant_context_rate <= 0.05
silent_context_truncations = 0
```

Run:

```bash
pnpm vitest run server/_core/dimeContextCompiler.test.ts
pnpm check
```

## Authorization boundary

This implementation does not authorize runtime integration, provider
execution, deployment, tracing, shadow traffic, route activation, model
download, evaluation execution, or training. Runtime wiring requires a
separate reviewed and owner-authorized change.
