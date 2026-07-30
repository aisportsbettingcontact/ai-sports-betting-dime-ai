# Foundation and Evaluation Identity v1

## Status

`INCOMPLETE_NOT_AUTHORIZED`

This change freezes the next control-plane boundary. It does not claim that the private
Foundation release or any protected evaluation suite exists, and it does not authorize data
generation, publication, RunPod use, model download, inference, training, selection, serving,
Railway changes, tracing, shadow traffic, or route activation.

## What is frozen

- The 2,400-record Foundation target: 2,160 train and 240 validation records.
- The exact nine-route distribution and six cross-cutting minimums.
- A canonical private Data Factory authoring record with source, rights, freshness, tool,
  provenance, critique, expected-behavior, and uncertainty fields.
- Bounded generation shards of at most 200 records with separate generator and critic
  identities.
- The 270-case development, 81-case critical, 180-case locked, and 120-case
  general-regression layers.
- Separate semantic-case and answer-key repositories with training access prohibited.
- Base-versus-Instruct controls, a routing-only Candidate A/B comparison, three closed RunPod
  authorization gates, and the paired Candidate C selection standard.
- A full-training schedule that derives optimizer steps after tokenization and requires at
  least six validation/checkpoint opportunities.
- Exact staged-adapter verification against the integrity-checked best checkpoint before
  release promotion.

The machine-readable sources are:

- `configs/foundation_release_plan_v1.json`
- `configs/evaluation_identity_plan_v1.json`
- `configs/model_execution_gates_v1.json`
- `schemas/foundation_record.schema.json`

Run the static audit from `ml/dime-1.0`:

```bash
.venv/bin/python scripts/validate_foundation_control.py
```

The audit is deterministic and has no authorization effect. `plan_valid: true` means only
that the missing-state control plane matches its frozen schema; `ready` remains `false` until
the separately governed evidence and access controls exist.

## Authoring and trainer boundaries

`foundation_record.schema.json` is the private Data Factory authoring boundary.
`sft_record.schema.json` remains the trainer-ready release boundary. They are intentionally
separate because the existing release validator, numeric traceability, grouping, review ledger,
and private Hugging Face freezer depend on the trainer schema.

No record may enter the trainer-ready release until an independently reviewed, deterministic
conversion contract binds every authoring field to the existing release controls. That
conversion contract is currently missing, so the Foundation plan fails closed.

## AI-authorship governance blocker

The requested factory uses Codex 5.6 Sol for bounded generation and independent critique.
Current repository governance prohibits retained substantive AI-authored prose. This PR records
that conflict explicitly; it does not silently reinterpret generated prose as an already
approved source class. An owner-reviewed governance change, pinned generator/critic identities,
and signed receipts are required before record generation.

## Evaluation exposure finding

The existing public 81-case benchmark remains useful for development and architecture
regression, but it includes expected behavior and gold material in the application repository.
It therefore cannot be represented as a sealed, contamination-clean selection suite.

The identity plan marks it `EXPOSED_NOT_SELECTION_ELIGIBLE` and requires a sealed replacement:

1. A private semantic-case repository without gold answers.
2. A separately controlled answer-key repository bound to semantic-record hashes.
3. A runner denied answer-key access.
4. A scorer denied training data and model execution.
5. Training credentials denied every evaluation repository.

The locked suite additionally requires a one-execution limit and append-only consumption
receipt. Until those controls and all immutable identities exist, benchmark and locked
evaluation execution remain unauthorized.

## Required private Foundation evidence

The eventual private Hugging Face release must return an exact 40-character commit and publish
only sanitized, checksum-bound evidence to this repository:

- release identity
- dataset manifest and checksum manifest
- dataset card
- provenance, split, leakage, coverage, and rights reports
- `SHA256SUMS`
- a small non-sensitive fixture

The 2,400 private records must not be packaged in the application image.

## Next separately authorized sequence

1. Resolve AI-authorship policy and reviewer identities.
2. Implement and approve the authoring-to-trainer conversion.
3. Produce immutable source packets and bounded, independently critiqued shards.
4. Freeze the private Foundation release and sanitized evidence.
5. Implement evaluation credential separation and freeze all four identities.
6. Produce the complete non-overlap proof.
7. Request Gate 1 baseline inference authorization.

Nothing in this document advances any execution gate.
