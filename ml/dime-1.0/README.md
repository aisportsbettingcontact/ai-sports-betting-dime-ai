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
| Intended private model repository | `taileredsports/Llama-3-Dime-1.0` |
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

The small 2026-07-25 rehearsal proved only that selected infrastructure
mechanics execute. It used 8 training and 4 validation records, scored 3 of 10
expected evaluation cases, passed zero cases, retained critical failures, and
set `release_gate_pass` to `false`.

## Ownership

GitHub `main` is the canonical reviewed source for code, prompts, templates,
tool contracts, schemas, synthetic public fixtures, public development
evaluations, configurations, tests, documentation, sanitized evidence, and
release gates. Branches and draft pull requests are public draft work.

Approved weights and release-specific model artifacts belong in the intended
private Hugging Face model repository. Private training data and hidden
evaluations belong in a separate private dataset repository whose name has not
been selected. RunPod is disposable compute, never a source of truth.

See [Platform ownership](docs/PLATFORM_OWNERSHIP.md) and
[Public data boundary](data/README.md).

## Repository map

```text
ml/dime-1.0/
├── configs/                 # Runtime identity and guarded training configs
├── data/                    # Synthetic public samples and record templates
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

Training requires a write-scoped Hugging Face secret supplied by the compute
platform. Future serving must use a separate read-scoped secret. Never paste,
print, read back, copy, or commit either credential.

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
4. deterministic tool, math, policy, and safety contracts pass;
5. the dataset hashes and record counts match an approved v3 manifest; and
6. the release gates in [RELEASE_GATES.md](docs/RELEASE_GATES.md) are adopted.

The sample audits are intentionally non-passing against production quotas.
Strict full-training commands must fail closed when governed metadata or quota
evidence is missing.

## Model publishing

No upload is performed by this project automatically. A later,
owner-authorized release must satisfy the license checklist, model-card,
evaluation, attestation, and artifact-hash gates before publishing only
allowlisted model artifacts to the intended private model repository.

Training and publishing credentials must remain write-scoped and separate from
future serving credentials. The publisher must never create a repository,
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
- [Data governance](docs/DATA_GOVERNANCE.md)
- [System architecture](docs/DIME_V1_SYSTEM_ARCHITECTURE.md)
- [Curriculum and evaluation](docs/DIME_V1_CURRICULUM_AND_EVALUATION.md)
- [Release gates](docs/RELEASE_GATES.md)
- [Training roadmap](docs/TRAINING_ROADMAP.md)
- [Llama license checklist](docs/LLAMA_LICENSE_CHECKLIST.md)
- [Rehearsal evidence](evidence/rehearsals/2026-07-25/README.md)

The included `LICENSE` and `NOTICE` remain unchanged. The parent weights remain
governed by the applicable Meta Llama 3.1 terms and are not redistributed here.
