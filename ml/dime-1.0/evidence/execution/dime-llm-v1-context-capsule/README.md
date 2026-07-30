# Dime LLM v1 context capsule

This checksum-pinned capsule records the sanitized coordination baseline for the
Foundation and evaluation evidence release.

- PR #250 is the merged production baseline at `7ed09adb`.
- PR #251 (Track F) and PR #252 (Track E) are open drafts at exact heads
  `9edff5ee` and `d420b452`; all required checks pass.
- PR #253 is an open RunPod Gate 1 draft at `3e406ac2`; Gitleaks, Dime, and
  Security pass while remaining CI is pending, and effective authorization is false.
- The PR #249 final-head review exception remains an open security P1.
- The separate PR #250 post-merge credential-execution P1 remains blocked:
  root trust is unprovisioned, and codesign cryptographic verification plus
  full credential dependency closure are pending.
- The pilot is validated but not admitted; the first live-data shard admits 150 records.
- The exact Foundation deficit is 2,250 records: 2,025 train and 225 validation.
- Semantic r5 contains 270 / 81 / 180 / 120 cases, zero answer keys, and has
  zero disallowed overlap in 97,650 comparisons against the admitted shard.
- RunPod Gate 1 authorization is `NONE`.

The capsule contains no credentials, private Foundation records, semantic cases,
answer keys, provider output, or production data. It does not authorize any
credential use, provider/model execution, training, publication, deployment,
route activation, or Railway mutation.
