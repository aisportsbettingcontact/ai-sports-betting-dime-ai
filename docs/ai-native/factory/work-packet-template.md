# Factory work packet — template

One packet = one bounded outcome through the software factory:
evidence → spec → executable acceptance criteria → implementation → deterministic gates →
(probabilistic rubric only where judgment is unavoidable) → classified defects → regression →
review/approval → observed outcome.

Copy this file to `docs/ai-native/factory/packets/NNN-<slug>.md` and fill every section.
A packet with an empty section is not in the factory; it is ad-hoc work.

```markdown
# Packet NNN — <title>

## Evidence (why this, now)
- <path/query/incident that grounds the problem — no evidence, no packet>

## Specification (narrow, with exclusions)
- In scope:
- Explicitly out of scope:

## Executable acceptance criteria
- [ ] <vitest test name or command + expected output>  ← criteria are runnable, not prose

## DRI and boundaries
- DRI: <one name/role>
- Implementation authority: <what may be changed without asking>
- Approval required from: <role> for <which actions>

## Deterministic gates (ordered; a failure here cannot be outvoted by any rubric)
1. `npx vitest run <suites>` — all green
2. `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit` — clean
3. Invariants affected: <list from docs/ai-native/target-architecture.md>

## Probabilistic rubric (only if a judgment dimension exists; else "N/A")
- Behavior evaluated: / Anchors (1–5): / Calibration sample: / Threshold + escalation:

## Defects found (classify each)
| # | Symptom | Class (spec|prompt|model|context|retrieval|tool|schema|code|data|runtime|evaluator|permission|unsupported-requirement) | Smallest correction | Regression rerun |
|---|---|---|---|---|

## Outcome
- Result metric + observation window:
- Status: VERIFIED_COMPLETE | IMPLEMENTED_UNVERIFIED | PARTIAL | BLOCKED
```
