# Public data boundary

This directory contains synthetic development fixtures and templates for the
Dime 1.0 post-training and evaluation contracts. It is not an approved
production training dataset.

GitHub is public. A record may be committed here only when it is explicitly
approved for public publication, redistribution-cleared, synthetic or properly
de-identified, free of direct and indirect identifiers, free of provider
restrictions, supported by provenance and rights records, and reviewed through
a pull request.

Never commit user betting histories, chat transcripts, account or device
identifiers, payment information, raw Bet Tracker exports, private retrieval
context, hidden evaluations, raw provider exports, or licensed odds/splits data
without public redistribution rights. Hashing a direct identifier does not make
raw personal data publishable.

## Tracked fixture classes

- `sft/*.sample.jsonl` contains small, synthetic, public development fixtures.
- `eval/*.sample.jsonl` contains visible, synthetic development evaluation
  cases. These are not locked or hidden release evaluations.
- `templates/` contains record-shape examples only.

The sample files are deliberately too small for production training and may
truthfully fail curriculum or evaluation-program quotas.

## Publication manifest

Any non-sample SFT JSONL proposed for this public repository must use the exact
approved paths `data/sft/train.APPROVED.jsonl` and
`data/sft/validation.APPROVED.jsonl` and must be bound to
`configs/dataset_manifest_APPROVED.json`.

The approved manifest must conform to
`schemas/dataset_manifest.v3.schema.json` and bind:

- visibility, publication classification, provenance/source class, source
  owner, rights basis, restrictions, synthetic status, and user/provider-data
  declarations;
- train and validation record counts and whole-file SHA-256 values;
- curriculum, tool-catalog, and chat-template hashes;
- named reviewers, approval timestamp, privacy/rights/consent review;
- partition, future-data, semantic-deduplication, and evaluation-contamination
  audits; and
- a deletion-policy identifier and limitations.

`scripts/validate_data.py` fails closed if non-sample public JSONL appears
without that complete v3 contract. The v2 schema remains tracked for historical
compatibility; it is not sufficient for new public publication.

Private or proprietary approved data belongs in a separate private Hugging Face
dataset repository. Its repository name has not been selected and is not
invented here.
