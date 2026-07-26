# Dime AI Data Governance

## Default rules

- The sample files are synthetic fixtures only.
- This GitHub repository is public. A branch or draft pull request is already
  publication.
- “Approved for training” is not the same as approved for public publication.
- Only redistribution-cleared, synthetic or properly de-identified,
  identifier-free material with recorded provenance and rights may enter
  GitHub.
- Personalization is off until the user opts in.
- Reusing conversations or Bet Tracker history for training is a separate opt-in
  and is off by default.
- Private user history stays in user-scoped retrieval; it is not placed in model
  weights merely because it is available to the product.
- Every training item needs a stable ID, timestamp, provenance, rights basis,
  privacy state, partition keys, and human review status.
- Public accessibility is not a training, caching, display, or redistribution
  license.
- Raw Bet Tracker exports, chats, private retrieval context, hidden
  evaluations, provider exports, and licensed odds/splits data without public
  redistribution rights never enter GitHub.
- Hashing raw personal identifiers is not de-identification.

## Required dataset lineage

Every governed dataset release must record:

- dataset name and immutable version;
- source record IDs and snapshot timestamps;
- source owner and contractual rights;
- whether the record is human-authored, synthetic, or teacher-generated;
- consent basis and deletion obligations where user data is involved;
- deidentification method and direct-identifier scan result;
- event, source, and hashed-user partition keys;
- curriculum skill, interaction, difficulty, risk, and scenario-cluster labels;
- reviewer and approval date;
- deduplication, contamination, and quality checks;
- SHA-256 hashes of the final split files;
- visibility and publication classification;
- train and validation record counts;
- provider-derived and user-data declarations;
- the curriculum, tool-catalog, and chat-template hashes;
- partition-leakage and future-data audit results; and
- a deletion-policy identifier plus limitations.

Unknown provenance, license, or required consent is a build failure.

## Splitting

Split by event, source snapshot, conversation, scenario cluster, and user—not
by individual row. No related event, duplicated or near-duplicated passage,
scenario, conversation, or user's records may cross train, validation, locked,
or hidden partitions. Historical evaluations must enforce
`available_at <= as_of_utc`.

The v3 dataset manifest must bind the curriculum, tool catalog, chat template,
train, and validation hashes and record counts. It must attest rights, consent,
privacy, partition-leakage, future-data, semantic-deduplication, and
evaluation-contamination review.

Full training additionally binds the SHA-256 of the approved v3
`dataset_manifest.json` and the SHA-256 of `checksums.json` into the
candidate-specific platform authorization. The trainer validates both schemas,
recomputes both hashes, verifies every referenced split, and rejects v2
manifests. An approved Hugging Face revision or local file path by itself is
not sufficient authorization.

The historical v2 schema remains tracked without semantic changes. It is not
sufficient for new public publication. `scripts/validate_data.py` rejects
non-sample public JSONL unless the exact approved train/validation paths are
bound to a valid v3 `approved-public` manifest.

Approved private foundation data belongs in
`taileredsports/dime-foundation-sft`; visible private development evaluations
belong in `taileredsports/dime-eval-development`; and locked or hidden
release-gate material belongs in the separately restricted
`taileredsports/dime-eval-locked`. None belongs in this public repository. The
training credential is denied access to the locked repository.

## Retention and deletion

Before production, Dime needs written retention schedules for raw conversations,
retrieval indexes, derived profiles, training candidates, released datasets,
logs, and backups. A deletion or withdrawn-consent workflow must remove the item
from future retrieval and future dataset builds and track which prior immutable
artifacts require retirement or documented exception handling.

## Data quality ladder

1. Synthetic fixtures validate plumbing.
2. Human-authored gold examples establish desired behavior.
3. Rights-cleared historical snapshots add domain coverage.
4. Deidentified, separately consented user examples may add coaching coverage.
5. Hard cases and failures enter a reviewed correction set.

Do not bulk-train raw chats, feed dumps, articles, or Bet Tracker tables.
