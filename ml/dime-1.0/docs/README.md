# Dime 1.0 documentation

This directory contains the governed specifications, dated research, planning,
and experiment records for the runnable project at `ml/dime-1.0/`.

GitHub `main` is the reviewed source of truth. Branches and pull requests are
public draft work. See [Platform ownership](PLATFORM_OWNERSHIP.md).

## Operations and registries

- [Platform ownership](PLATFORM_OWNERSHIP.md)
- [Hugging Face registry](HUGGING_FACE_REGISTRY.md)
- [RunPod workspace and runbook](RUNPOD_WORKSPACE_RUNBOOK.md)
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
- [Curriculum and evaluation](DIME_V1_CURRICULUM_AND_EVALUATION.md)
- [Data governance](DATA_GOVERNANCE.md)
- [Release gates](RELEASE_GATES.md)
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
