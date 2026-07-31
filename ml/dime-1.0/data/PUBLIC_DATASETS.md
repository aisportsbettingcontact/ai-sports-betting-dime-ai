# Dime LLM v1 public datasets

This release publishes two complete, checksum-bound datasets at the explicit
direction of the platform owner on 2026-07-31.

## Foundation SFT dataset

- `sft/train.APPROVED.jsonl`: 405 records
- `sft/validation.APPROVED.jsonl`: 45 records
- total: 450 teacher-generated records
- route coverage: 300 live-data records and 150 platform records
- manifest: `../configs/dataset_manifest_APPROVED.json`

The records contain no user data or provider-supplied production payloads.
Provider identifiers appearing in synthetic tool fixtures are not credentials
or provider-derived observations.

## Public semantic evaluation dataset

- `../datasets/public_semantic_v1/development.jsonl`: 270 cases
- `../datasets/public_semantic_v1/sealed_critical.jsonl`: 81 cases
- `../datasets/public_semantic_v1/locked.jsonl`: 180 cases
- `../datasets/public_semantic_v1/general_regression.jsonl`: 120 cases
- total: 651 semantic-only cases
- manifest: `../configs/public_semantic_evaluation_manifest_v1.json`

These cases contain no answer keys, gold responses, production data, private
chain-of-thought, credentials, or direct identifiers. Their original embedded
privacy fields are preserved as generation-time provenance. The public release
manifest supersedes the original handling boundary for these copies.

Publication permanently contaminates these exact 651 cases for sealed or
locked model selection. They remain useful for public development and
regression testing, but they are not eligible for independent final evaluation.

Publication alone does not authorize training, provider execution, model
download, deployment, tracing, shadow traffic, or route activation.
