# Foundation continuation evidence v1

This directory contains sanitized, aggregate-only evidence for the second
live-data shard and the cumulative live-data boundary. It contains no private
Foundation records, semantic cases, answer keys, credentials, or provider output.

## Admission result

- First live-data shard: 150 records admitted.
- Second live-data shard: 150 genuinely new records admitted.
- Combined live-data route: 300 records (270 train / 30 validation).
- Complete Foundation target: 2400 records.
- Remaining deficit: 2100 records
  (1890 train /
  210 validation).

Every combined partition, exact-duplicate, semantic-duplicate,
repository-evaluation-overlap, and private-semantic-overlap gate is zero. The
second shard contributes 15 new task types from five checksum-bound source packets
with zero prior task-type overlap.

## Semantic result

The authoritative semantic-only r5 suite contains 651 cases
and zero answer keys. Internal cross-suite isolation covers
148770
case pairs with zero disallowed overlap. The cumulative 300 Foundation records
complete
195300
Foundation-to-evaluation comparisons with zero disallowed overlap.

## Verification

From `ml/dime-1.0`:

```bash
sha256sum -c evidence/execution/dime-llm-v1-foundation-002/SHA256SUMS
python scripts/validate_governed_json.py
pytest -q
```

No command or evidence here authorizes training, publication, deployment,
provider execution, route activation, model download, credential access, or
Railway mutation.
