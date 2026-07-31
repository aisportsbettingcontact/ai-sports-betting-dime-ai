# Foundation incremental evidence v1

Parent records reused: 300.
Delta records admitted: 150.
Cumulative records: 450.
Remaining records: 1950.
Historical semantic comparisons are checksum-bound and reused; only the delta comparisons were newly executed.

This aggregate-only directory contains no private records, task text, answer keys, credentials, provider output, or record identifiers. It authorizes no training, publication, deployment, provider execution, route activation, credential access, model download, or Railway mutation.

## Reproduce

Set the nine private-root variables below to independently protected local roots. The command validates exact manifests and hashes before comparison and uses a cooperative exclusive promotion lock. A failed promotion cleans only the target inode created by this process. This does not claim hostile same-user filesystem containment.

```sh
uv run --frozen python scripts/freeze_foundation_cumulative_evidence.py \
  --boundary-manifest configs/foundation_cumulative_boundary_450_v1.json \
  --boundary-manifest-sha256 45a413f3508114548996ef5e27e7691d3a0acbcdf49843b73424974a743e419f \
  --prior-artifact-root "first_live_data_shard=${DIME_PRIOR_FIRST_ROOT}" \
  --prior-artifact-root "second_live_data_shard=${DIME_PRIOR_SECOND_ROOT}" \
  --prior-source-packet-root "first_live_data_shard=${DIME_PRIOR_FIRST_SOURCES}" \
  --prior-source-packet-root "second_live_data_shard=${DIME_PRIOR_SECOND_SOURCES}" \
  --delta-artifact-root "${DIME_DELTA_ROOT}" \
  --delta-source-packet-root "${DIME_DELTA_SOURCES}" \
  --quarantine-root "platform_shard_001_incident=${DIME_INCIDENT_QUARANTINE}" \
  --quarantine-root "platform_shard_001_live_audit=${DIME_AUDIT_QUARANTINE}" \
  --semantic-root "${DIME_SEMANTIC_R5_ROOT}" \
  --output-root evidence/execution/dime-llm-v1-foundation-003 \
  --created-at 2026-07-30T23:25:00Z
```
