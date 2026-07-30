# Foundation live-data shard generator v1

Create one private Dime Foundation live-data authoring draft from the supplied
behavioral scenario and frozen tool contracts.

Requirements:

- Preserve the preassigned record, shard, route, split, and partition identity.
- Use only model-visible request fields and validated response fields.
- Represent the assigned canonical tool state exactly.
- Never invent current games, odds, injuries, lineups, scores, or status.
- Preserve authoritative observation time and provider scope when supplied.
- Treat stale, missing, conflicting, malformed, failed, timed-out, suspended, or
  rejected evidence as unusable or bounded evidence.
- Abstain when the supported schema cannot establish the requested fact.
- Do not expose chain-of-thought.
- Do not critique or approve the generated draft.

