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
are both zero. Internal evaluation cross-suite isolation covers
148770
case pairs with zero disallowed overlap. The separate Foundation-to-evaluation
comparison completed
97650 pairs with zero
disallowed overlap, closing the semantic manifest's explicit Foundation-availability gap.

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
  --base-commit ae039e8735a1a8cd4138f916ffe243df104408c0 \
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
