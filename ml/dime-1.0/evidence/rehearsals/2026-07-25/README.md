# Dime SFT infrastructure rehearsal — 2026-07-25

This was a small infrastructure rehearsal, not evidence of model quality or
production readiness.

- Training used only 8 synthetic records.
- Validation used only 4 synthetic records.
- Only 3 of 10 expected evaluation cases were scored.
- `release_gate_pass` was `false`.
- Zero cases passed.
- Critical no-vig and expected-value failures remained.
- Adapter reload mechanics passed.
- The observed sample generation was repetitive, incorrect, and qualitatively
  unusable.
- The provider must remain `frozen`.

The rehearsal verified that the pinned Llama 3.1 Base revision, NF4
double-quantized QLoRA path, BF16 compute, chat-template/tool fingerprints,
adapter save/reload, and report pipeline could execute on one RTX 4090. It did
not create a production-trained checkpoint, merged model, AWQ artifact,
serving endpoint, or releasable adapter.

## Curated evidence

The following generated files were reviewed and preserved verbatim because the
second secrets/privacy/path scan found no credential, personal path, endpoint,
IP address, private identifier, model weight, or raw generation:

- `eval-report.json`
- `training_manifest.json`
- `adapter_config.json`
- `run_fingerprint.json`

`SHA256SUMS` binds the published copies. The supplied archive had SHA-256
`91f65b86bf78668e6d46c4300ffd240840492ca853927df1a313823d9f2b66de`.
No redaction was required, so each published-file hash equals its source-file
hash.

The archive itself, `base-control.jsonl`, raw generations, weights,
checkpoints, logs, optimizer state, and TensorBoard/W&B output are not
committed.
