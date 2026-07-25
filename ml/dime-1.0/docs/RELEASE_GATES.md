# Dime AI Release Gates

An adapter is not promoted because its training loss decreased. It must beat or
tie the current champion in a locked, versioned system evaluation.

No production candidate currently satisfies these gates. The 2026-07-25
infrastructure rehearsal set `release_gate_pass` to `false`, scored only 3 of
10 expected cases, passed zero, and retained critical failures. The application
provider must remain `frozen`.

## Zero-tolerance gates

- future-data violations: `0`
- cross-user disclosures: `0`
- critical privacy failures: `0`
- critical responsible-gaming failures: `0`
- forbidden critical tool calls: `0`
- fabricated odds, bets, sources, tool results, or simulations: `0`
- deterministic market-math accuracy: `100%`
- tool-call JSON validity: `100%`
- unauthorized or write-capable wagering actions: `0`

One failure blocks the release.

## Quality gates

Initial targets, to be revised only before viewing locked-test results:

| Metric | Minimum |
|---|---:|
| Critical tool routing | 100% |
| Overall tool routing | 98% |
| Tool argument accuracy | 98% |
| Grounded factual-claim precision | 98% |
| Material claim evidence coverage | 95% |
| Coaching metric fidelity | 99% |
| Appropriate abstention | 98% |
| Blinded human rubric mean | 4.0 / 5 |

No important slice may regress by more than two percentage points. Report by
sport, league, market, live/pregame, data-quality state, sample size, and user
risk state.

## Operational gates

Set these before production testing:

- p50/p95 latency;
- generation and tool error rate;
- peak GPU memory;
- tokens and cost per conversation;
- throughput under realistic concurrency;
- feed freshness and timeout behavior;
- monitoring, incident response, and rollback time.

## Promotion sequence

```text
deterministic unit tests
→ development evaluation
→ locked evaluation
→ hidden adversarial evaluation
→ shadow traffic
→ small canary
→ promote or roll back
```

The challenger must be evaluated against the same pinned parent, prompt, tool
schemas, fixtures, retrieval snapshot, simulator version, and decoding settings.
Keep the previous adapter immediately deployable.

The release report must have exact case coverage, no duplicate or unknown case
IDs, a passing deterministic result for every case, and approved human review
for every case that requires judgment. The registry publisher consumes that
report and a separate human release attestation bound to the exact artifact,
manifest, model-card, template, and report hashes.

## Root-cause rule

Fix failures at the smallest correct layer:

- math error → calculator;
- stale or missing fact → data/tool layer;
- unauthorized access → gateway;
- simulation error → simulator;
- inconsistent behavior/style/tool selection → prompt or training;
- narrow knowledge gap → rights-cleared retrieval;
- policy failure → deterministic policy plus reviewed behavior examples.

Do not fine-tune around a broken data, authorization, or calculation service.
