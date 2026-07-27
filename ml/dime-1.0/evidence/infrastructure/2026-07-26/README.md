# Dime infrastructure setup verification — 2026-07-26

## Classification

`SANITIZED INFRASTRUCTURE EVIDENCE — NOT RELEASE AUTHORITY`

This evidence records the initial least-privilege Hugging Face setup,
normalized RunPod workspace, pinned source checkout, and GPU validation. It
contains no credential values, raw Pod IDs, raw volume IDs, private endpoint
details, datasets, locked cases, or model weights.

It does not authorize:

- full training;
- locked evaluation;
- adapter publication;
- model serving;
- provider activation; or
- use of the rehearsal adapter.

## Observed source identity

```text
repository: aisportsbettingcontact/ai-sports-betting-dime-ai
commit:     0d2c8ce0a9de028367e4fb788278e913c7d72d8b
checkout:   full, detached, clean
project:    ml/dime-1.0
```

The full checkout was required for tests that inspect root and server
contracts outside the training directory.

## Observed Hugging Face boundary

The following governance-card revisions were present:

| Role | Repository | Revision | Release state |
|---|---|---|---|
| Foundation SFT | `taileredsports/dime-foundation-sft` | `af9a45fb7835df01585c859c628e1dbc9e372356` | Scaffold only |
| Development evaluation | `taileredsports/dime-eval-development` | `5b75491b4fc3d3b22e270510f7cba767d01ec363` | Scaffold only |
| Locked evaluation | `taileredsports/dime-eval-locked` | `4ad747fd76d3f54b54ef7d3b5ebc36ccbe7fd8d1` | Scaffold only |
| Promoted adapter | `taileredsports/Llama-3-Dime-1.0` | `298c735fa2b32e3f63b19a1b18c4f4f901933e3e` | Scaffold only |

No approved dataset, locked suite, or serving adapter was present.

Live positive and negative access checks verified:

- training could read foundation, development, adapter, and gated Meta;
- training could not read locked evaluation;
- serving could read adapter and gated Meta and could not read any dataset;
- the general publisher could access foundation, development, and adapter and
  could not access locked evaluation or gated Meta;
- the locked evaluator could read locked evaluation, adapter, and gated Meta
  and could not read foundation or development; and
- the locked publisher could access locked evaluation and could not access the
  other Dime repositories or gated Meta.

Repository-local tests preserve the declared matrix, but only a new live check
can prove current external permissions after a Hugging Face change.

## Observed RunPod boundary

The governed network volume was mounted at `/workspace`. The workspace was
normalized to:

```text
/workspace/
├── repos/ai-sports-betting-dime-ai/
├── datasets/foundation-sft/
├── datasets/eval-development/
├── runs/
├── archive/rehearsal-v1-2026-07-25/
└── .cache/
    ├── huggingface/
    └── pip/
```

The rebuildable Python environment lived at `/opt/dime-venv`.

The training template used:

```text
template:  dime-llama31-8b-training-v1
image:     runpod/pytorch:1.0.2-cu1281-torch280-ubuntu2404
GPU:       NVIDIA GeForce RTX 4090, 24 GB
credential role: dime-training-read-v1
```

Locked evaluation had no path on the training volume. Publisher and locked
credentials were not installed in the training template.

## Validation results

The observed environment passed:

- runtime package and CUDA verification;
- `ruff` validation;
- Python compilation;
- 55 repository tests;
- public data validation;
- deterministic curriculum-audit reproduction;
- deterministic evaluation-program-audit reproduction;
- chat-template contract validation;
- gated base-model forward-pass smoke testing; and
- training-token locked-evaluation denial.

The base-model smoke test loaded:

```text
model:    meta-llama/Llama-3.1-8B
revision: d04e592bb4f6aa9cfee91e2e20afa771667e1d4b
GPU allocation after load: 5.72 GB
forward-pass shape: (1, 8, 128256)
```

The GPU returned to an idle state after validation.

## Rehearsal preservation

The legacy rehearsal workspace was moved under the dated archive. The
rehearsal adapter remained:

`REHEARSAL — NOT APPROVED FOR SERVING`

Selected preserved hashes:

```text
adapter_model.safetensors
3502412f7a691ddb6bb5a29b42c5c50b3770dd1ceb26d9e0074ddb2d03b4ddd7

dime-rehearsal-evidence-v1.tar.gz
91f65b86bf78668e6d46c4300ffd240840492ca853927df1a313823d9f2b66de
```

No rehearsal weight was uploaded to the production model repository.

## Private source-manifest integrity

The detailed setup manifest remains on governed private RunPod storage. It is
not copied into this public repository because it contains raw infrastructure
identifiers.

Its SHA-256 is:

```text
817b01617475ded4cfcce9a67b7847c82e387b6a8c9717ff4d1c3c29517fa2bf
```

This is the hash of the private source manifest. It is not the hash of the
sanitized `setup-summary.json` committed beside this README.

## Files

- [`setup-summary.json`](setup-summary.json) — machine-readable public-safe
  summary.
- [`SHA256SUMS`](SHA256SUMS) — integrity hash for the sanitized summary.

## Limitations

This record proves only the observed setup and validation at the captured
source and repository revisions. External token permissions, repository heads,
RunPod availability, package availability, and hardware can change. Re-run
their live checks before an authorized training, evaluation, publication, or
serving action.
