# Foundation execution evidence v1

This directory contains sanitized, aggregate-only evidence. It contains no private
Foundation records, semantic cases, answer keys, credentials, or provider output.

## Admission result

- Pilot: not admitted (`PILOT_ARTIFACT_EXPLICITLY_NOT_RELEASE`).
- First live-data shard: 150 records admitted.
- Complete Foundation target: 2400 records.
- Remaining deficit: 2250 records.
- Training/validation deficit: 2025 / 225.

## Semantic result

The private semantic suites reproduce 651 cases across development,
sealed critical, locked, and general regression. Answer-key-bearing cases and artifacts
are both zero. The four-way comparison completed
97650 pairs with zero disallowed overlap.

## Reproduction

Run from `ml/dime-1.0` with private paths supplied locally:

```bash
python scripts/compare_foundation_to_private_evaluation.py \
  --accepted-root <accepted-foundation-root> \
  --semantic-root <semantic-r5-root> \
  --output-root <new-private-comparison-root> \
  --comparison-id foundation-live-data-semantic-r5-release-reproduction-v1

python scripts/freeze_foundation_execution_evidence.py \
  --pilot-root <finalized-pilot-root> \
  --pilot-source-packet-root <pilot-source-packet-root> \
  --accepted-root <accepted-foundation-root> \
  --accepted-source-packet-root <accepted-source-packet-root> \
  --semantic-root <semantic-r5-root> \
  --comparison-root <private-comparison-root> \
  --recovery-root <protected-recovery-root> \
  --output-root <new-public-evidence-root> \
  --base-commit 7ed09adb4fcdb9e2d9047e73e34f84c80d865b78 \
  --created-at <canonical-utc-timestamp>
```

Verification:

```bash
sha256sum -c SHA256SUMS
python scripts/validate_governed_json.py
pytest -q
```

No command above authorizes training, publication, deployment, provider execution,
route activation, model download, credential access, or Railway mutation.
