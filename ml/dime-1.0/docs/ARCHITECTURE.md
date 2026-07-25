# Dime AI Architecture and Trust Boundaries

## Status

This starter is a research and development foundation for a **read-only**
sports-market analyst. It is not production-ready, a sportsbook, a wagering
execution system, a guaranteed prediction service, or a substitute for licensed
legal, financial, clinical, or responsible-gaming support.

Adapting Llama 3.1 is not foundation-model training from scratch. Dime is:

1. starting from Meta's pretrained Llama 3.1 8B Base weights;
2. teaching chat, tool selection, analytical behavior, and communication with a
   QLoRA adapter;
3. retrieving changing or private facts at runtime;
4. using deterministic services for math and simulations;
5. enforcing authorization and safety outside the model.

## Boundaries

```text
Authenticated Dime session
        |
        v
Policy + authorization gateway
  age | jurisdiction | self-exclusion | consent | tenant | tool allowlist
        |
        v
Dime Llama adapter <---- shared, rights-cleared RAG
        |
        +---- read-only live data tools
        +---- deterministic market-math service
        +---- versioned simulation service
        +---- user-scoped private Bet Tracker retrieval
        |
        v
Grounding/freshness/output checks ---> audit + monitoring + rollback
```

The model cannot grant itself permission. Tenant identity comes from the
authenticated gateway, never from model-generated arguments. Retrieved text and
tool output are untrusted data rather than instructions.

## Where information belongs

| Layer | Appropriate content | Excluded content |
|---|---|---|
| Adapter weights | Stable terminology, analytical frameworks, response structure, tool-selection examples, Dime tone | Live odds, current injuries/results, private histories, secrets |
| Shared RAG | Rights-cleared static rules, definitions, methodology | Unlicensed articles or mixed-tenant records |
| Private retrieval | Minimum-necessary data for the authenticated user, when consented | Global user index or another user's records |
| Read-only tools | Timestamped odds/splits/history, game state, aggregate Bet Tracker summary, math, simulations | Bet placement, deposits, withdrawals, limit changes |
| Policy gateway | Age, jurisdiction, self-exclusion, authorization, consent and harm-state controls | Any rule the LLM can override |

The training process should not receive production database credentials and
should not have unrestricted access to user data or live feeds.

## Later production services

The repository contains model-training contracts, not the production gateway,
retrieval system, live-data ingestion, simulation engine, or inference service.
Those require separate architecture, testing, monitoring, and legal review.
