# Dime 1.0 documentation

This directory contains the governed specifications, dated research, planning,
and experiment records for the runnable project at `ml/dime-1.0/`.

GitHub `main` is the reviewed source of truth. Branches and pull requests are
public draft work. See [Platform ownership](PLATFORM_OWNERSHIP.md).

## Operations and registries

- [Platform ownership](PLATFORM_OWNERSHIP.md)
- [Hugging Face registry](HUGGING_FACE_REGISTRY.md)
- [RunPod workspace and runbook](RUNPOD_WORKSPACE_RUNBOOK.md)
- [Foundation v1 candidate-to-freeze workflow](FOUNDATION_V1_DATASET_WORKFLOW.md)
- [Tool and canonical market contracts](TOOL_AND_MARKET_CONTRACTS.md)
- [Candidate-to-locked-evaluator handoff](CANDIDATE_EVALUATION_HANDOFF.md)
- [Sanitized evidence index](../evidence/README.md)

## Research

- [Model and training strategy](research/2026-07-24-model-and-training-strategy.md)
- [Llama 3 build, fine-tuning, and optimization playbook](research/2026-07-25-llama3-build-finetune-and-optimization-playbook.md)

## Plans and reports

- [Rehearsal verification and v1 build plan](plans/2026-07-25-rehearsal-verification-and-v1-build-plan.md)

## Project-owned specifications

The following documents stay beside the code because they govern the active
training project and release process:

- [System architecture](DIME_V1_SYSTEM_ARCHITECTURE.md)
- [Tool and canonical market contracts](TOOL_AND_MARKET_CONTRACTS.md)
- [Curriculum and evaluation](DIME_V1_CURRICULUM_AND_EVALUATION.md)
- [Dime answer rubric v1](DIME_ANSWER_RUBRIC_V1.md)
- [Data governance](DATA_GOVERNANCE.md)
- [Release gates](RELEASE_GATES.md)
- [Foundation build policy](../configs/foundation_v1_build.yaml)
- [Foundation reviewer registry](../configs/foundation_reviewer_registry.json)
- [Curriculum program schema](../schemas/curriculum_program.schema.json)
- [Foundation SFT record schema](../schemas/sft_record.schema.json)
- [Foundation source-registry schema](../schemas/foundation_source_registry.schema.json)
- [Foundation review-ledger schema](../schemas/foundation_review_ledger.schema.json)
- [Foundation candidate-audit schema](../schemas/foundation_candidate_audit.schema.json)
- [Foundation external-audit schema](../schemas/foundation_external_audit.schema.json)
- [Foundation approval schema](../schemas/foundation_approval.schema.json)
- [Foundation reviewer-registry schema](../schemas/foundation_reviewer_registry.schema.json)
- [Foundation development-evaluation identity schema](../schemas/foundation_development_eval_identity.schema.json)
- [Foundation dataset-manifest v4 schema](../schemas/dataset_manifest.v4.schema.json)
- [Run-manifest template](../configs/run_manifest_TEMPLATE.json)
- [Run-manifest schema](../schemas/run_manifest.schema.json)
- [Foundation checksum-manifest schema](../schemas/foundation_checksums.schema.json)
- [Sanitized release-evaluation schema](../schemas/release_evaluation_summary.schema.json)
- [Training roadmap](TRAINING_ROADMAP.md)
- [Llama license checklist](LLAMA_LICENSE_CHECKLIST.md)

Maintain only one editable canonical copy of each specification.

Documents under `research/` are date-stamped background material. They may
contain historical options or standalone-project examples and are not current
runtime authority. Current identity and release authority live in the root
README, `configs/runtime.env`, `configs/platform_contract.json`,
`PLATFORM_OWNERSHIP.md`, `HUGGING_FACE_REGISTRY.md`, and `RELEASE_GATES.md`.
