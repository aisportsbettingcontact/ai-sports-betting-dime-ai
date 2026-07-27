# Dime AI experiment record template

Complete this record before an experiment begins. Replace every placeholder,
record full commit SHAs, and bind the final record to the machine-readable
`run_manifest.json`.

## Identity and authorization

- Experiment ID:
- Status:
  `draft | preflight | authorized | running | completed_unreviewed | approved_for_release_review | rejected`
- Date/owner:
- Reviewer:
- Authorization reference:
- Hypothesis:
- One major variable changed:
- Expected decision:
- Estimated GPU time and cost:

Training completion is not release or serving approval.

## Immutable source identity

- GitHub repository: `aisportsbettingcontact/ai-sports-betting-dime-ai`
- Full source Git commit SHA `S`:
- Full training-authorization Git commit SHA `A`:
- `S` is an ancestor of `A`:
- Only `ml/dime-1.0/configs/platform_contract.json` changed anywhere in the
  repository across `S..A`:
- Worktree clean: `true | false`
- Project path: `ml/dime-1.0`
- Training platform-contract path and SHA-256 at `A`:
- `authorization.training_candidate` exact binding verified:
- Training config path and SHA-256:
- Preflight run-manifest path, schema version, and SHA-256:
- Prompt path/version and SHA-256:
- Chat-template path/version and SHA-256:
- Tool-catalog path/version and SHA-256:
- Dataset/evaluation schema versions and SHA-256:
- Decoding configuration and SHA-256:
- Runtime contract SHA-256:

## Model identity

- Parent repository: `meta-llama/Llama-3.1-8B`
- Parent revision: `d04e592bb4f6aa9cfee91e2e20afa771667e1d4b`
- Starting adapter repository or `null`:
- Starting adapter full commit SHA or `null`:
- Starting adapter SHA-256 or `null`:
- Candidate adapter path:

## Dataset identity

- Foundation repository: `taileredsports/dime-foundation-sft`
- Foundation full commit SHA:
- Foundation version/tag as display metadata:
- Foundation dataset-manifest schema version and SHA-256:
- Foundation checksum-manifest schema version and SHA-256:
- Train file SHA-256 and record count:
- Validation file SHA-256 and record count:
- Development-evaluation repository:
  `taileredsports/dime-eval-development`
- Development-evaluation full commit SHA:
- Development-evaluation file hashes and case counts:
- Locked-evaluation repository: `taileredsports/dime-eval-locked`
- Locked-evaluation full commit SHA, approved opaque release reference, or
  `not executed`:
- Provenance/rights approval:
- Privacy/consent approval:
- Partition/future-data/deduplication/contamination approval:

Do not include locked cases, answers, rubrics, thresholds, or case-level
results in this record.

The release handoff may include only the sanitized
`dime-release-evaluation-summary-v1`: evaluator run ID, approved locked-suite
reference, evaluator implementation commit/hash, exact candidate identities,
restricted-report/human-review hashes, and aggregate counts. Record no case ID
or case-level result.

## Runtime identity

- RunPod template: `dime-llama31-8b-training-v1`
- Container image: `runpod/pytorch:1.0.2-cu1281-torch280-ubuntu2404`
- Experiment directory: `/workspace/runs/<experiment-id>/`
- Python/PyTorch/CUDA:
- GPU and VRAM:
- Package-lock SHA-256:
- Seed or seed set:
- Checkpoint interval and retention policy:
- Start/completion timestamps:
- Actual GPU time and cost:

Do not record raw Pod IDs, volume IDs, endpoint URLs, or credential values in
public evidence.

## Preflight

- Full Git checkout pinned, detached, and clean:
- Foundation dataset revision and checksums verified:
- Development-evaluation revision and checksums verified:
- Locked evaluation absent from training storage:
- Training credential is `dime-training-read-v1`:
- Publisher and locked credentials absent:
- Runtime verification:
- Lint/compile/tests:
- Public data validation:
- Curriculum/evaluation audits:
- Chat-template contract:
- Base-model smoke test:
- GPU memory idle before training:
- All placeholders removed from approved config:

Any failed preflight item blocks execution.

## Results

- Training/evaluation loss:
- Candidate adapter SHA-256:
- Candidate adapter-config SHA-256:
- Training manifest SHA-256:
- Development-evaluation report SHA-256:
- Canonical bundle-payload SHA-256:
- Hard-gate result:
- Quality metrics overall and by slice:
- Human paired comparison:
- Latency/VRAM/throughput:
- Newly observed failures:
- Privacy/safety review:
- Regression cases added:
- Recovery checkpoint retained:

## Locked evaluation handoff

- Candidate bundle transferred by hash:
- Isolated evaluator run ID:
- Locked dataset full commit SHA recorded in restricted evidence:
- Approved aggregate result:
- Locked-evaluation report SHA-256 or approved restricted evidence reference:
- Raw locked content excluded from this record:

The training environment never performs this step and never receives the
locked-evaluator credential.

## Decision

- Decision: `approved_for_release_review | reject | revise`
- Evidence:
- Known limitations:
- Follow-up:
- Rollback artifact:
- Reviewer:
- Decision timestamp:

Setting the experiment status to `approved_for_release_review` requires the
reviewer and timestamp above, but it does not itself authorize publication.

## Release-review handoff

- Platform contract authorizes adapter publication: `true | false`
- Platform authorization reference and full Git commit SHA:
- `authorization.release_candidate`
  experiment/source/training-authorization/training-contract binding:
- `authorization.release_candidate` adapter/config/manifest/evaluation
  SHA-256 binding:
- `authorization.release_candidate` canonical bundle-payload SHA-256 binding:
- `authorization.release_candidate` locked-suite manifest SHA-256 and
  expected-case-count binding:
- Current promoted champion full revision, or `none` for the inaugural release:
- `authorization.release_candidate` comparison-control kind/repository/revision
  and artifact, paired-comparison report, and quality-slice report binding:
- `authorization.release_candidate` expected Hugging Face parent binding:
- Destination repository: `taileredsports/Llama-3-Dime-1.0`
- Destination repository type: `model`
- Expected parent Hugging Face full commit SHA:
- Release attestation status: `approved_for_release_review`
- `private_registry_publication_approved`: `true | false`
- `approved_for_serving`: `true | false`
- Release attestation SHA-256:
- Comparison control kind/repository/full revision/artifact SHA-256:
- Candidate-vs-control decision and paired counts:
- Control report and paired-comparison report SHA-256:
- Quality metrics, worst important-slice regression, and slice-report SHA-256:
- Model Card SHA-256:
- `LICENSE` SHA-256:
- `NOTICE` SHA-256:
- Exact local payload inventory verified:
- Unknown files, nested paths, and symlinks absent:
- Meta/full-model weights and training state absent:
- Publisher workspace is separate from training:
- Publisher credential role: `dime-release-publisher-v1`
- Verifier token is distinct and externally provisioned from
  `dime-serving-read-v1`: `true | false`

If every release-review and publication gate later passes:

- Returned Hugging Face full commit SHA:
- Exact remote inventory verified at returned SHA:
- Post-upload `checksums.sha256` verification:
- Publication receipt path and SHA-256:
- Human-readable tag, if assigned:
- Rollback full commit SHA:

The publication receipt is created after upload; it is not included in the
commit it verifies. Publication still requires the separate publisher
credential and an owner-approved platform contract with
`authorization.adapter_publication: true`. Serving still requires a separate
promotion pull request pinned to the returned full Hugging Face commit SHA.
