# Dime AI Iterative Training Roadmap

## Phase 0 — Freeze the control

Goal: establish what the exact untuned Base model can and cannot do.

1. Pin model, revision, tokenizer, runtime, chat format, system contract, tool
   schemas, evaluation data, and decoding settings.
2. Run data validation, deterministic tests, the 4-bit model smoke test, and a
   Base-control generation.
3. Save raw traces and the evaluation report without editing them.

The current sample suite is plumbing validation, not a meaningful benchmark.

## Phase 1 — Instruction and tool foundation

Goal: teach the Base checkpoint to converse, follow the Dime contract, select
read-only tools, handle non-`ok` statuses, and answer in a stable structure.

Build the human-reviewed gold set against `configs/curriculum_v1.yaml`. The
first meaningful foundation target is 2,400 records: 2,160 grouped training
records and 240 grouped validation records. Below 1,600 approved records, keep
the result labeled `research-alpha`. Quality and coverage matter more than the
count. Include:

- ordinary multi-turn instruction following;
- exact tool routing and argument construction;
- tool-result interpretation;
- stale, partial, unauthorized, and missing-data behavior;
- evidence/interpretation separation;
- uncertainty and abstention;
- privacy and responsible-gaming boundaries.

Overfit 32 representative examples as a diagnostic before the full stage. The goal is to
prove the formatter, labels, optimizer, save/resume, and adapter reload work.

## Phase 2 — Dime domain SFT

Goal: deepen sports-market reasoning and bettor coaching without memorizing
changing facts.

Expand reviewed examples across:

- matchup and trend analysis with supplied evidence;
- opening/current/closing line and price history;
- ticket/handle scope and market interpretation;
- implied probability, hold, no-vig, EV, settlement, ROI, and canonical CLV;
- Bet Tracker sample size, segmentation, price quality, drawdown, and habits;
- simulation requests, distributions, assumptions, seeds, and write-ups;
- contradictory, incomplete, stale, and provider-conflicting inputs.

Balance simple and hard cases. Do not let one sport, market, provider, answer
length, or positive-outcome pattern dominate. Keep events and users separated
across splits.

## Phase 3 — Preference optimization

Goal: improve judgment and communication after SFT is stable.

Create reviewed preference pairs from real failure modes: grounded vs.
unsupported, calibrated vs. certain, useful vs. verbose, constructive vs.
shaming, correct abstention vs. fabricated completion. Start with a modest
versioned set rather than generating large unreviewed teacher-output volumes.

DPO or a similar preference method should not be used to repair deterministic
math, authorization, feed freshness, or simulation bugs.

## Phase 4 — System evaluation

Evaluate the entire system, not only the adapter:

- exact and adversarial tool routing;
- numeric fidelity;
- source/freshness faithfulness;
- historical cutoff leakage;
- calibration and forecast quality;
- simulation fidelity;
- coaching fidelity and sample-size judgment;
- prompt injection, secrets, and tenant isolation;
- responsible-gaming behavior;
- latency, memory, throughput, and cost.

Run fixed dev tests frequently. Use locked tests only at decision points and
hidden red-team cases before release.

## Phase 5 — Controlled deployment

Deploy read-only first:

1. offline candidate;
2. internal dogfood;
3. shadow traffic with no user-visible answer;
4. small canary;
5. measured expansion;
6. immediate rollback on a hard-gate failure.

Age, jurisdiction, self-exclusion, tenant authorization, consent, and
write-action denial remain deterministic gateway controls.

## Optimization loop

For every material failure:

```text
capture trace
→ classify root cause
→ add a failing regression case
→ fix the smallest correct layer
→ rerun dev tests
→ compare challenger with champion
→ locked test only when warranted
```

Change one major variable at a time. Record:

- hypothesis;
- parent and adapter;
- prompt and chat format;
- data versions and hashes;
- tool/retrieval/simulator versions;
- hyperparameters and seed;
- exact metrics by slice;
- cost and runtime;
- decision and rollback artifact.

Never optimize solely for lower training loss or a handful of attractive chat
examples.
