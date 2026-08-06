# Dime AI Rehearsal Verification and v1 Build Plan

## Executive outcome

The first Dime Llama rehearsal is complete and verified.

The experiment proves that the exact
`meta-llama/Llama-3.1-8B` revision, RunPod RTX 4090 environment, Dime chat
template, tool serialization, assistant-only labels, 4-bit QLoRA, checkpoint
fingerprints, adapter save/reload, and evaluation reporting work together.

It does **not** prove that the adapter is useful. The rehearsal artifact is
explicitly rejected for release and must not be published or deployed.

## Verified evidence

| Check | Result |
|---|---|
| Parent revision | `d04e592bb4f6aa9cfee91e2e20afa771667e1d4b` |
| Runtime | Python 3.12.3, PyTorch 2.8.0+cu128, CUDA 12.8 |
| GPU | NVIDIA GeForce RTX 4090 |
| Strict data validation | Passed |
| Unit tests on RunPod | 40 passed |
| Chat-template contract | Passed |
| 4-bit Base forward pass | Passed at 5.72 GB allocated |
| Rehearsal training | 3/3 optimizer steps |
| Trainable LoRA parameters | 41,943,040 |
| Training runtime | 31.82 seconds |
| Final training loss | 2.0591 |
| Observed validation loss | 2.362 at step 1; 1.945 at step 3 |
| Adapter reload | Passed |
| Base/adapter maximum logit delta | 3.21875 |

Every source fingerprint recorded on RunPod exactly matched the Codex copy:

- rehearsal config;
- train and validation fixtures;
- Dime chat template;
- tool catalog;
- dependency lock;
- runtime contract;
- Base-control evaluation cases.

The supplied evidence archive SHA-256 was:

`91f65b86bf78668e6d46c4300ffd240840492ca853927df1a313823d9f2b66de`

## What the Base control established

The untuned Base model:

- called no tools on three tool-requiring cases;
- passed 0/3 tool-routing checks;
- passed 0/3 numeric-fidelity checks;
- passed 0/3 policy-action checks;
- passed 0/3 deterministic cases;
- repeated prompts and produced unsupported calculations.

This is the expected result for a Base checkpoint. Dime must first teach
instruction following, chat behavior, tool grammar, grounding, uncertainty,
abstention, privacy, and safety.

## Why the rehearsal answer was poor

The reloaded adapter repeated an incorrect sentence about simulation. That is
not evidence of a broken adapter. The nonzero logit delta proves that the
adapter affected the model, while the poor answer proves that twelve synthetic
examples and three optimizer steps are not a behavioral dataset.

Training loss is not a product-quality metric. The rehearsal adapter must not
be used as the starting point for the next run.

## Platform ownership decision

GitHub `main` is the reviewed source of truth for:

- prompts and chat templates;
- tool and data schemas;
- training and evaluation data;
- experiment records and hashes;
- validation and evaluation code;
- release gates and attestations.

Branches and pull requests contain public draft work. RunPod is a replaceable
GPU worker. The intended private Hugging Face model repository is a controlled
registry for approved model artifacts only; a separately named private dataset
repository will own approved non-public data. The Dime application backend owns
identity, policy, live facts, deterministic math, simulations, Bet Tracker
authorization, and private-user scope.

## Dime v1 training target

The first meaningful instruction-and-tool dataset is:

- 2,400 approved SFT records;
- 2,160 grouped training records;
- 240 grouped validation records.

Primary quotas:

| Competency | Total |
|---|---:|
| Conversation and epistemics | 240 |
| Tool selection and arguments | 360 |
| Tool grounding and degraded statuses | 360 |
| Deterministic market math | 240 |
| Odds movement and splits | 300 |
| Matchups, trends, and projections | 240 |
| Bet Tracker coaching | 240 |
| Simulation analysis | 180 |
| Responsible gaming, privacy, and security | 240 |

At least 720 records are multi-turn, 480 are multi-tool, and 360 are
adversarial or contradictory. User histories remain out of this foundation
dataset; Bet Tracker examples use synthetic aggregates.

## Evaluation target

Build 416 governed cases:

- 320 standard cases across visible development, sealed validation, locked,
  and independently hidden exposure levels;
- 96 red-team cases distributed across those same exposure levels.

Before the full bank, use a new 48-case Foundation Screen comparing the pinned
Base system with the first real candidate:

- 12 tool route/argument/status cases;
- 8 market-math cases;
- 8 odds/splits/game-grounding cases;
- 6 Bet Tracker cases;
- 4 simulation cases;
- 5 privacy/security cases;
- 5 responsible-gaming/eligibility/distress cases.

The existing 16 sample cases are visible development regressions. They cannot
be relabeled as locked or hidden because they have already been inspected.

## Serving architecture

Start with a modular monolith plus an isolated GPU inference process:

```text
authenticated Dime API
  -> deterministic policy gate
  -> conversation orchestrator
  -> complete-mediation read-only tool broker
  -> isolated Llama inference
  -> evidence/output verifier
  -> verified answer or deterministic abstention
```

The model never receives credentials, chooses user scope, executes tools
directly, performs canonical math, runs unbounded simulations, or controls
eligibility.

## Immediate next work

No additional GPU training is warranted yet.

1. Keep the RunPod Pod stopped and preserve its network volume.
2. Approve the Dime competency and evaluation contracts.
3. Define canonical market keys and exact per-tool production response schemas.
4. Author the new 48-case Foundation Screen before training data.
5. Author and review the first 600-record foundation tranche.
6. Run strict quota, provenance, privacy, deduplication, partition, and
   contamination audits.
7. Only then prepare the 32-example overfit diagnostic and the first meaningful
   candidate run.

## Production decisions still needed

- Existing backend, database, identity, hosting, and deployment stack.
- Bet Tracker tenant/user authorization semantics.
- Supported clients and expected traffic/concurrency.
- Licensed odds/splits providers and their caching/display/training rights.
- Market-data freshness rules.
- Responsible-gaming jurisdictions, age, self-exclusion, and escalation rules.
- Data retention, export, erasure, backup, and residency requirements.
- Simulation methodology, calibration, approved versions, and compute limits.
- Serving SLO, RTO/RPO, cost budget, and operational ownership.

These are not blockers for synthetic data authoring, but they block production
integration and release.
