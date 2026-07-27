# Dime 1.0 — governed Llama 3.1 post-training foundation

`ml/dime-1.0/` is the canonical reviewed development avenue for Dime AI model
post-training and evaluation.

This is not pretraining a model from scratch. It is a governed QLoRA/SFT
post-training foundation built from a pinned pretrained Llama 3.1 8B Base
checkpoint.

## Frozen foundation

| Contract | Value |
|---|---|
| Parent model | `meta-llama/Llama-3.1-8B` |
| Parent revision | `d04e592bb4f6aa9cfee91e2e20afa771667e1d4b` |
| Model type | Llama 3.1 8B Base, not Instruct |
| Development method | QLoRA/SFT post-training and evaluation |
| Approved-training dataset repository | `taileredsports/dime-foundation-sft` |
| Development-evaluation repository | `taileredsports/dime-eval-development` |
| Locked-evaluation repository | `taileredsports/dime-eval-locked` |
| Promoted-adapter repository | `taileredsports/Llama-3-Dime-1.0` |
| Initial verified GPU | RTX 4090 24 GB |
| Training quantization | NF4 4-bit with double quantization |
| Compute dtype | BF16 |
| Artifact name | `Llama-3-Dime-1.0` |

A Base checkpoint does not provide the instruction following, chat behavior,
tool grammar, grounded answers, abstention, or safety required by Dime. Those
behaviors must be taught and evaluated explicitly.

## Current status: foundation only

The application provider remains hardcoded to `frozen`. This project does not
authorize a model call, deployment, or production change.

- No production-trained Dime checkpoint exists.
- No production release evaluation has passed.
- No verified merged model exists.
- No verified AWQ serving artifact exists.
- No production vLLM endpoint exists.
- No provider activation is approved.

The four private Hugging Face repositories currently contain governance cards
only. No approved foundation dataset, development-evaluation release,
locked-evaluation release, or serving-approved adapter has been published.
Their current card commits are registry evidence, not training, evaluation, or
serving revisions.

`configs/curriculum_v1.yaml` remains a proposed curriculum. The tracked
Foundation v1 candidate, review, audit, and freeze contracts make a future
dataset reviewable; they do not create an approved dataset, publish anything
to Hugging Face, authorize training, change serving, or activate the provider.

The small 2026-07-25 rehearsal proved only that selected infrastructure
mechanics execute. It used 8 training and 4 validation records, scored 3 of 10
expected evaluation cases, passed zero cases, retained critical failures, and
set `release_gate_pass` to `false`.

## Ownership

GitHub `main` is the canonical reviewed source for code, prompts, templates,
tool contracts, schemas, synthetic public fixtures, configurations, tests,
documentation, sanitized evidence, and release gates. Branches and pull
requests are review-visible draft work.

The tool-contract identity covers the request and market catalogs, both
governing schemas, the response registry and envelope, and all seven data
schemas. Stored nonempty results are validated against their originating call
arguments plus executable scope, freshness, numeric, and temporal rules.

Approved data and model artifacts are separated across four private Hugging
Face repositories. The model repository is adapter-only: it must never receive
Meta base weights, merged full-model weights, quantized full-model weights, or
training checkpoints. RunPod provides temporary compute and a persistent
working volume, but it is never the only authoritative location for an
important artifact. Locked evaluations must never enter the training
environment.

See:

- [Tool and canonical market contracts](docs/TOOL_AND_MARKET_CONTRACTS.md)
- [Platform ownership](docs/PLATFORM_OWNERSHIP.md)
- [Hugging Face registry](docs/HUGGING_FACE_REGISTRY.md)
- [Foundation v1 dataset workflow](docs/FOUNDATION_V1_DATASET_WORKFLOW.md)
- [RunPod workspace and runbook](docs/RUNPOD_WORKSPACE_RUNBOOK.md)
- [Candidate-to-locked-evaluator handoff](docs/CANDIDATE_EVALUATION_HANDOFF.md)
- [Public data boundary](data/README.md)

## Repository map

```text
ml/dime-1.0/
├── configs/                 # Runtime identity and guarded training configs
├── data/                    # Synthetic public samples and private-workflow templates
├── docs/                    # Governance, plans, research, and release gates
├── evidence/                # Reviewed sanitized audits and rehearsal evidence
├── prompts/                 # Versioned training prompt and chat template
├── schemas/                 # Dataset, evaluation, and tool contracts
├── scripts/                 # CPU validation plus explicitly gated GPU utilities
├── src/dime_ai/             # Validation, formatting, math, and audit code
├── tests/                   # Static and deterministic CPU tests
└── tools/                   # Versioned read-only tool catalog
```

Generated artifacts, caches, raw/private/hidden data, weights, checkpoints,
merged or quantized models, and packaging archives are ignored. Reviewed
evidence lives under `evidence/`, separate from generated `artifacts/`.

## Dependency contracts

`pyproject.toml` and `uv.lock` are the canonical CPU development and test
dependency contract. From this directory:

```bash
uv sync --frozen --dev
uv lock --check
uv run ruff check .
uv run ruff format --check .
uv run pytest -q
```

`requirements.lock.txt` is a pinned environment freeze scoped to the documented
RunPod image. It is not a standalone cross-platform lock: PyTorch is supplied
by that image and verified separately by `scripts/verify_runtime.py`.

## CPU-local validation

CPU validation is secretless, offline with respect to Hugging Face, and does
not download a model or tokenizer:

```bash
uv sync --frozen --dev
uv lock --check
uv run ruff check .
uv run pytest -q
uv run python -m compileall -q src scripts
uv run python scripts/validate_data.py

audit_dir="$(mktemp -d)"
uv run python scripts/audit_curriculum.py \
  --report "${audit_dir}/curriculum-audit.json"
uv run python scripts/audit_evaluation_program.py \
  --report "${audit_dir}/evaluation-program-audit.json"
cmp "${audit_dir}/curriculum-audit.json" \
  evidence/audits/starter-v1.1.0/curriculum-audit.json
cmp "${audit_dir}/evaluation-program-audit.json" \
  evidence/audits/starter-v1.1.0/evaluation-program-audit.json
uv pip check
```

The starter audits intentionally report that production quotas are not met.
Validation checks their deterministic integrity and non-release labeling; it
does not convert those truthful failures into release passes.

## RunPod GPU validation

GPU validation begins from a clone or synchronized checkout of this GitHub
repository:

```bash
git clone https://github.com/aisportsbettingcontact/ai-sports-betting-dime-ai.git
cd ai-sports-betting-dime-ai/ml/dime-1.0
bash scripts/bootstrap_env.sh
source /opt/dime-venv/bin/activate
```

`scripts/bootstrap_env.sh` derives the project root from its own location.
`DIME_PROJECT_DIR` remains an optional explicit override for controlled
environments.

Training uses the fine-grained, read-only `dime-training-read-v1` Hugging Face
credential supplied through the compute platform. It can read the approved
foundation dataset, development evaluations, promoted-adapter repository, and
gated Meta base model; it cannot read locked evaluations and cannot publish.
Publishing and serving use separate least-privilege credentials. Never paste,
print, read back, copy, or commit any credential.

The Foundation candidate auditor and freezer are CPU-safe, but their
development-evaluation provenance gate is an authenticated remote operation.
Both require an explicit nonempty `HF_TOKEN` and identity schema
`dime-foundation-development-eval-identity-v2`. The verifier resolves
`taileredsports/dime-eval-development` at the identity's exact lowercase
40-character commit SHA, proves the repository is private, requires its root
`README.md` and `evaluation_manifest.json`, enumerates the complete recursive
`cases/**/*.jsonl` inventory, and byte-compares every declared manifest and
case file with the local working copy. A missing token, inaccessible remote,
moving alias, public repository, partial inventory, hash/count mismatch, or
byte mismatch fails closed. There is no local-only or cached-evidence fallback.

The following validations are Hugging-Face- or GPU-gated and are intentionally
excluded from public CPU CI:

- `scripts/verify_runtime.py`
- `scripts/model_smoke_test.py`
- `scripts/template_contract_test.py`
- `scripts/baseline_generate.py`
- `scripts/train_qlora.py`
- `scripts/adapter_smoke_test.py`
- `scripts/publish_adapter.py`

`template_contract_test.py` loads the gated tokenizer to verify exact tokenizer
behavior. Static chat-template invariants are covered separately by the CPU
test suite without downloading the gated tokenizer or model.

## QLoRA rehearsal

The tracked rehearsal configuration is a tiny infrastructure diagnostic. It
may verify tokenization, assistant-only labels, NF4 double quantization,
checkpoint writing, and adapter reload on an approved GPU. It is not full
training and cannot establish model quality.

The reviewed, non-weight 2026-07-25 evidence is under
`evidence/rehearsals/2026-07-25/`. The rehearsal adapter is rejected for release
and must not be used as a production starting checkpoint.

## Full training

No full run is authorized until:

1. every record passes provenance, public/private placement, privacy, rights,
   consent, and quality review;
2. train, validation, locked, hidden, and adversarial partitions are governed;
3. partition, future-data, semantic-deduplication, and contamination audits
   pass;
4. deterministic tool, math, policy, and safety contracts pass, including
   successful tool-result evidence for every assistant numeric token across
   every task family and independent recomputation of market-math results;
5. the private Foundation snapshot has the exact five-file inventory, all
   hashes and record counts match an approved v4 manifest, and its independent
   review and audit evidence is bound into authorization; and
6. the release gates in [RELEASE_GATES.md](docs/RELEASE_GATES.md) are adopted.

The sample audits are intentionally non-passing against production quotas.
Strict full-training commands must fail closed when governed metadata or quota
evidence is missing.

The tracked full-run file is a template, not an authorization. The current
platform contract sets `authorization.full_training` to `false`, so the
training entrypoint rejects it even if every placeholder is filled. A later
candidate-specific authorization pull request must move the platform to
`training_authorized` and populate `authorization.training_candidate` with
the exact experiment, prior clean source commit, config hash, foundation
dataset-manifest and checksum-manifest hashes, preflight run-manifest hash,
full 40-character foundation and development-evaluation revisions, and the
approved locked-evaluation full revision or structured opaque reference.
It must also include `foundation_evidence_hashes`, matching the approved v4
manifest exactly:

- the system-prompt, Foundation build-config, source-registry, exact
  source-artifact aggregate, review-ledger, candidate-audit, and
  approval-record SHA-256 values; and
- the independently reviewed semantic-deduplication,
  privacy-and-identifiers, rights, development-evaluation-contamination,
  locked-evaluation-contamination, and numeric-traceability report SHA-256
  values.

A dataset revision, manifest hash, or passing local audit alone is not
training authorization.

Authorization uses two reviewed commits to avoid a circular hash:

1. source commit `S` contains all executable code, schemas, templates, and the
   completed training config;
2. the preflight `run_manifest.json` is built from `S` and the approved
   immutable inputs in the isolated experiment directory;
3. authorization commit `A` follows `S`, binds that manifest's hash, and
   changes only `ml/dime-1.0/configs/platform_contract.json` across the entire
   repository;
4. training runs from a clean checkout of `A`, verifies that `S` is its
   ancestor, and verifies every candidate field and content hash.

Training output is always labeled
`completed_unreviewed`; only a separate human review may advance that exact
candidate to `approved_for_release_review`.

Publication has a second candidate-bound gate:
`authorization.release_candidate` must match the exact training-contract,
adapter, config, manifest, sanitized evaluation-summary, canonical bundle
payload, locked-suite manifest and expected-case count, immutable comparison
control kind/repository/revision/artifact, paired comparison report, quality
slice report, and destination parent hashes. A later release must retain and
beat or tie the current promoted champion; only the inaugural release may use
the pinned Meta base control. The publisher loads only the canonical contract
from a clean reviewed Git checkout; no caller-supplied contract can override
it.

## Model publishing

No upload is performed by this project automatically. A later,
owner-authorized release must satisfy the license checklist, model-card,
evaluation, attestation, and artifact-hash gates before the separate
`dime-release-publisher-v1` credential publishes an allowlisted adapter release
to `taileredsports/Llama-3-Dime-1.0`.

Training remains read-only. Publishing and serving remain separate from
training and from each other. The publisher must never create a repository,
change visibility, or upload a whole workspace.

## Future serving and promotion

`server/_core/dime1Model.ts` remains a frozen runtime integration scaffold.
`prompts/dime_system_v1.md` is the versioned training behavior contract,
`prompts/llama3_dime_chat_template_v1.jinja` is the chat-template contract, and
`tools/tools.v1.json` is the tool catalog.

The runtime and training prompts are not claimed to be identical. A later
promotion pull request must reconcile and hash the approved runtime prompt
against the canonical training prompt, prove every release gate, preserve
application policy controls, and explicitly change the provider constant.

## Required reading

- [Platform ownership](docs/PLATFORM_OWNERSHIP.md)
- [Hugging Face registry](docs/HUGGING_FACE_REGISTRY.md)
- [RunPod workspace and runbook](docs/RUNPOD_WORKSPACE_RUNBOOK.md)
- [Machine-readable platform contract](configs/platform_contract.json)
- [Data governance](docs/DATA_GOVERNANCE.md)
- [Foundation v1 dataset workflow](docs/FOUNDATION_V1_DATASET_WORKFLOW.md)
- [Dime answer rubric v1](docs/DIME_ANSWER_RUBRIC_V1.md)
- [System architecture](docs/DIME_V1_SYSTEM_ARCHITECTURE.md)
- [Curriculum and evaluation](docs/DIME_V1_CURRICULUM_AND_EVALUATION.md)
- [Release gates](docs/RELEASE_GATES.md)
- [Training roadmap](docs/TRAINING_ROADMAP.md)
- [Llama license checklist](docs/LLAMA_LICENSE_CHECKLIST.md)
- [Sanitized evidence index](evidence/README.md)
- [Infrastructure setup evidence](evidence/infrastructure/2026-07-26/README.md)
- [Rehearsal evidence](evidence/rehearsals/2026-07-25/README.md)

The included `LICENSE` and `NOTICE` remain unchanged. The parent weights remain
governed by the applicable Meta Llama 3.1 terms and are not redistributed here.
