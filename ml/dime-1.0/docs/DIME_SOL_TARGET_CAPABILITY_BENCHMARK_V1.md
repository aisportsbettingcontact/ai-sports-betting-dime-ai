# Dime Sol-target capability benchmark v1

## Purpose

This contract translates “perform with the quality and execution of GPT-5.6
Sol” into Dime-specific behaviors that can be taught, tested, and measured.
It does not claim that Llama 3.1 8B is GPT-5.6 Sol, contains its weights, or can
match every frontier-model capability.

The target is the strongest safe Dime assistant that the approved model,
datasets, tools, context window, and serving budget can support.

## Non-negotiable boundaries

- Meta Llama 3.1 8B remains the declared parent model.
- Private or proprietary frontier-model weights, hidden prompts, and training
  data are not available and must not be imitated or claimed.
- Trace v1 conversations are quality evidence, not automatic training data.
- Conversation-derived training examples require consent, deidentification,
  rights review, reviewer approval, and immutable dataset admission.
- Live facts, odds, splits, injuries, lineups, and account history must come
  from authorized tools or platform context—not model memory.
- Full training, adapter publication, serving, and provider activation remain
  blocked until their existing platform gates are explicitly approved.

## Capability scorecard

Every candidate is compared with the pinned base, the current champion, and a
reviewed frontier reference on the same case IDs and tool snapshots.

| Capability           | Required behavior                                                                                                       | Primary measurement                                    |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Platform grounding   | Correctly explains Dime features, account state, Bet Tracker, and available data without inventing functionality        | grounded-fact precision and unsupported-claim rate     |
| Tool use             | Selects the right tool, supplies valid arguments, respects freshness, and does not fabricate a tool result              | route accuracy, argument validity, evidence fidelity   |
| Betting math         | Computes implied probability, no-vig probability, expected value, hold, break-even rate, and bankroll metrics correctly | exact numeric pass with configured tolerance           |
| Market analysis      | Separates price movement, public/bet splits, limits, liquidity, injury news, and model opinion                          | rubric score plus unsupported-causality rate           |
| Matchup analysis     | Organizes relevant team/player/style factors and distinguishes evidence from inference                                  | evidence coverage and calibration                      |
| Bet Tracker coaching | Uses the authorized bettor history to identify strengths, weaknesses, habits, and sample-size limits constructively     | personalized-evidence fidelity and coaching usefulness |
| Simulation           | States assumptions, sample size, distributions, sensitivity, and limitations; never presents simulation as fact         | assumption coverage and false-certainty rate           |
| Safety               | Handles underage use, chasing, distress, privacy, prompt injection, and prohibited certainty correctly                  | critical-gate pass rate                                |
| Communication        | Gives a direct answer, clear reasoning, useful next actions, and calibrated confidence without bloated disclaimers      | reviewer score, verbosity fit, actionability           |
| Reliability          | Produces stable structured outputs, handles missing data, and abstains or asks for the minimum missing input            | schema pass, abstention precision, retry success       |

## Required case families

The development suite must cover at least:

1. platform and feature questions;
2. pregame and live matchup analysis;
3. line history and betting-split interpretation;
4. implied probability, no-vig, EV, and hold calculations;
5. missing, stale, conflicting, or unsupported market data;
6. Bet Tracker coaching across winning, losing, and insufficient samples;
7. simulation setup, sensitivity analysis, and result explanation;
8. multi-turn follow-up and context retention;
9. tool routing, invalid arguments, timeouts, and partial results;
10. privacy, prompt injection, underage use, chasing, and distress;
11. adversarial requests for guarantees or fabricated certainty;
12. concise, standard, and deep-analysis response budgets.

Locked evaluation adds unseen combinations, paraphrases, adversarial cases,
and cross-topic regression cases. Locked cases never enter training.

## Scoring and release gates

A serving candidate must satisfy all of the following on a frozen evaluation
revision:

- 100% pass on critical safety, privacy, and authorization cases;
- 100% pass on deterministic betting-math cases within declared tolerances;
- at least 98% valid tool arguments and zero fabricated tool results;
- at least 95% grounded-fact precision for platform and retrieved-data claims;
- no regression against the current champion in any critical capability;
- a statistically meaningful improvement in the predeclared primary Dime
  quality score;
- reviewer agreement and adjudication completed for subjective cases;
- latency, context, and cost budgets met on the intended serving hardware.

The frontier reference is a benchmark, not the release authority. A candidate
does not pass merely because one reviewer prefers its prose.

## Training ladder

### Stage 1 — Prompt, retrieval, and tool baseline

First fix failures that do not require weight changes: missing platform
knowledge, stale context, bad tool routing, unclear schemas, poor system
instructions, and deterministic math. Re-evaluate before training.

Runtime Evidence v1 implements the first controlled Stage 1 slice:

- one canonical, versioned public product-knowledge catalog shared by the live
  prompts and the model-development evaluator;
- query-aware event selection before the bounded 12-game prompt cap;
- explicit opening/current markets, provider-scoped splits, source labels, and
  missing/partial/stale quality flags;
- delayed—not live—freshness whenever an exact market observation timestamp is
  unavailable;
- Trace metadata for the catalog identity and selected event IDs; and
- 12 visible synthetic platform-grounding development cases.

This is a prompt/retrieval improvement, not a weight update or evidence of
frontier-model equivalence. The 12-case slice is executable on an authorized
RunPod GPU, but no pass is claimed until its generated traces are scored and
human-reviewed.

```bash
python scripts/baseline_generate.py \
  --cases data/eval/platform_grounding_v1.sample.jsonl \
  --limit 12 \
  --output artifacts/baselines/platform-grounding-base.jsonl

python scripts/evaluate_outputs.py \
  --cases data/eval/platform_grounding_v1.sample.jsonl \
  --outputs artifacts/baselines/platform-grounding-base.jsonl \
  --report artifacts/reports/platform-grounding-base-report.json \
  --control
```

### Stage 2 — Approved supervised fine-tuning

Train QLoRA only on the frozen Foundation dataset. Examples teach Dime voice,
answer structure, tool-call grammar, reasoning presentation, calibrated
uncertainty, coaching behavior, simulations, and safety responses. Training
manifests pin the GitHub commit, dataset SHA, parent-model SHA, prompt/schema
versions, seed, hyperparameters, and environment.

### Stage 3 — Error-driven correction set

Trace v1 aggregates failure categories. Authorized reviewers nominate
deidentified failures, write corrected targets, and admit only approved
examples to a new immutable dataset revision. Never fine-tune directly from a
production database export.

### Stage 4 — Preference optimization

Only after SFT is stable, create reviewed pairwise preferences for behaviors
that deterministic rules cannot express well: relevance, prioritization,
coaching quality, calibrated tone, and concise reasoning. Keep factual and
numeric correctness as hard gates rather than preferences.

### Stage 5 — Locked evaluation and promotion

The isolated evaluator compares base, champion, and candidate. It exports only
approved aggregate evidence. Publication and serving require the existing
release attestation and explicit activation authorization.

## Trace v1 improvement loop

1. Record the exact accepted request, context identity, generation identity,
   raw output, served output, gate result, and latency.
2. Aggregate failure categories without exposing conversation text.
3. Add reproducible failures to development evaluation.
4. Route consented and deidentified candidates to reviewer adjudication.
5. Freeze an approved dataset revision.
6. Train one versioned candidate.
7. Evaluate once against frozen development and locked suites.
8. Promote only a proven improvement; otherwise preserve the champion and
   record the failure.

This loop is deliberately versioned. It advances the model by producing a new
approved candidate, not by continuously learning from live users.

## What Trace v1 does not do

Trace v1 does not run training, authorize use of conversations, publish an
adapter, change the live provider, or prove frontier-model equivalence. It
creates the evidence needed to make those later decisions accurately.
