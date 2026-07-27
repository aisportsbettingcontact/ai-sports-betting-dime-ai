# Dime 1.0 RunPod workspace and runbook

This runbook defines the reproducible training workspace, run identity,
artifact lifecycle, recovery process, and shutdown procedure for Dime 1.0.

It does not authorize full training or publication. The current project remains
foundation-only, and the application provider remains `frozen`.

## Operating principles

- The network volume at `/workspace` persists across Pod replacement.
- The environment at `/opt/dime-venv` is fast and disposable; rebuild it after
  Pod migration or replacement.
- Source, datasets, the Meta base, prompts, schemas, tools, and decoding
  settings are pinned before a run starts.
- The training Pod uses only `dime-training-read-v1`.
- Locked evaluations and publisher credentials never enter the training Pod or
  its network volume.
- One experiment ID owns one run directory and one immutable manifest.
- RunPod is never the only location holding an important source, approved
  dataset, adapter release, or final evidence file.
- Stop GPU compute as soon as the authorized GPU work is complete.

The machine-readable path and credential contract is
[`configs/platform_contract.json`](../configs/platform_contract.json).

## Approved template contract

| Setting | Contract |
|---|---|
| Template | `dime-llama31-8b-training-v1` |
| Container image | `runpod/pytorch:1.0.2-cu1281-torch280-ubuntu2404` |
| Minimum GPU | NVIDIA GeForce RTX 4090, 24 GB VRAM |
| Persistent mount | Existing network volume at `/workspace` |
| Container disk | Rebuildable; no authoritative artifacts |
| Jupyter | Port `8888`, only when needed |
| Hugging Face secret | `dime-training-read-v1`, injected as `HF_TOKEN` |
| Hugging Face cache | `/workspace/.cache/huggingface` |
| Package cache | `/workspace/.cache/pip` |
| Python output | Unbuffered |

Do not create a new network volume when the governed volume already exists.
Do not place a secret value directly into an unencrypted template field.

Pod names are operational labels, not experiment identity. Pod IDs, volume IDs,
endpoint URLs, and credential values are not committed to public GitHub
evidence.

## Persistent workspace layout

```text
/workspace/
├── repos/
│   └── ai-sports-betting-dime-ai/
├── datasets/
│   ├── foundation-sft/
│   │   └── <full-hf-commit-sha>/
│   └── eval-development/
│       └── <full-hf-commit-sha>/
├── runs/
│   └── <experiment-id>/
│       ├── checkpoints/
│       ├── adapters/
│       │   └── final/          # created atomically only after training
│       ├── logs/
│       ├── reports/
│       └── run_manifest.json
├── archive/
└── .cache/
    ├── huggingface/
    └── pip/
```

The locked evaluation repository has no path in this layout. It belongs in a
separate restricted evaluator environment.

## Run identity

Use a unique, readable experiment ID:

```text
dime-sft-<purpose>-<yyyymmddThhmmssZ>-<short-git-sha>
```

Example:

```text
dime-sft-foundation-v1-20260801T180000Z-1a2b3c4
```

The directory name and `run_manifest.json` experiment ID must match. Never
reuse an experiment ID, even for a failed or interrupted run.

## Phase 1: deploy and verify the workspace

Deploy a Pod from the saved template, attach the existing governed network
volume, and start only one GPU unless an approved experiment explicitly
requires otherwise.

In the Pod terminal:

```bash
cd /workspace

df -h /workspace
findmnt -T /workspace

python -c "import os; print('HF_TOKEN configured:', bool(os.getenv('HF_TOKEN'))); print('HF_HOME:', os.getenv('HF_HOME')); print('PIP_CACHE_DIR:', os.getenv('PIP_CACHE_DIR'))"

nvidia-smi \
  --query-gpu=name,memory.total,driver_version \
  --format=csv,noheader
```

Expected:

- `/workspace` is the network-volume mount;
- `HF_TOKEN configured` is `True`;
- `HF_HOME` is `/workspace/.cache/huggingface`;
- `PIP_CACHE_DIR` is `/workspace/.cache/pip`; and
- the approved GPU/runtime is visible.

Do not print `HF_TOKEN`. If the credential is absent or the mount is wrong,
stop before downloading or training.

## Phase 2: pin the complete GitHub checkout

The full repository is required because the Dime repository-contract tests
inspect root and server files outside `ml/dime-1.0/`.

Set the reviewed full Git commit:

```bash
export DIME_GIT_COMMIT="<full-40-character-reviewed-github-commit-sha>"
```

Clone once if the checkout does not exist:

```bash
git clone \
  https://github.com/aisportsbettingcontact/ai-sports-betting-dime-ai.git \
  /workspace/repos/ai-sports-betting-dime-ai
```

Refresh and detach at the approved commit:

```bash
git -C /workspace/repos/ai-sports-betting-dime-ai \
  fetch --prune origin main

git -C /workspace/repos/ai-sports-betting-dime-ai \
  checkout --detach "${DIME_GIT_COMMIT}"

test "$(
  git -C /workspace/repos/ai-sports-betting-dime-ai rev-parse HEAD
)" = "${DIME_GIT_COMMIT}"

test -z "$(
  git -C /workspace/repos/ai-sports-betting-dime-ai status --porcelain
)"
```

Do not train from a branch tip, uncommitted changes, a ZIP upload, or a partial
copy. A dirty checkout is a failed preflight.

## Phase 3: build the disposable Python environment

The project path is:

```bash
cd /workspace/repos/ai-sports-betting-dime-ai/ml/dime-1.0
```

Build or rebuild:

```bash
bash scripts/bootstrap_env.sh
source /opt/dime-venv/bin/activate
```

Verify:

```bash
which python
python -m pip check
python scripts/verify_runtime.py
```

`which python` must resolve to `/opt/dime-venv/bin/python`. The environment can
disappear when the Pod is migrated or terminated; that is expected. The
repository lock and persistent caches make it reproducible.

## Phase 4: verify the training credential boundary

Before downloading a governed dataset:

1. verify the foundation Dataset Card by its approved full revision;
2. verify the development-evaluation Dataset Card by its approved full
   revision;
3. verify the promoted-adapter Model Card if a starting adapter is approved;
4. verify the pinned Meta configuration; and
5. prove that locked evaluation is inaccessible.

The repository IDs and current state are defined in
[`HUGGING_FACE_REGISTRY.md`](HUGGING_FACE_REGISTRY.md).

An access check is not a release decision. For each dataset, a `null`
`approved_release_revision` means there is no authorized snapshot to download.
For the promoted-adapter repository, `null` means no champion exists yet; that
is valid only before the inaugural adapter release and does not authorize
downloading the governance scaffold as a model.

## Phase 5: download only approved immutable revisions

After owner approval supplies the full release SHAs:

```bash
export DIME_FOUNDATION_REVISION="<full-40-character-hf-commit-sha>"
export DIME_DEVELOPMENT_EVAL_REVISION="<full-40-character-hf-commit-sha>"

hf download \
  taileredsports/dime-foundation-sft \
  --repo-type dataset \
  --revision "${DIME_FOUNDATION_REVISION}" \
  --local-dir "/workspace/datasets/foundation-sft/${DIME_FOUNDATION_REVISION}"

hf download \
  taileredsports/dime-eval-development \
  --repo-type dataset \
  --revision "${DIME_DEVELOPMENT_EVAL_REVISION}" \
  --local-dir "/workspace/datasets/eval-development/${DIME_DEVELOPMENT_EVAL_REVISION}"
```

Verify every published checksum before using a file. Record the repository ID,
full revision, file inventory, record counts, and verified hashes in the run
manifest.

Never use `main`, `latest`, or a tag as the authoritative revision. Never
download `taileredsports/dime-eval-locked` in this environment.

## Phase 6: create the experiment directory and manifest

Create the run structure:

```bash
export DIME_EXPERIMENT_ID="<approved-unique-experiment-id>"
export DIME_RUN_DIR="/workspace/runs/${DIME_EXPERIMENT_ID}"

mkdir -p \
  "${DIME_RUN_DIR}/checkpoints" \
  "${DIME_RUN_DIR}/adapters" \
  "${DIME_RUN_DIR}/logs" \
  "${DIME_RUN_DIR}/reports"
```

Create only the `adapters/` parent during preflight. The configured
`final_adapter_dir` is `${DIME_RUN_DIR}/adapters/final`; both `final/` and its
adjacent `final.staging/` path must be absent when training begins. The trainer
writes `final.staging/` and atomically renames it to `final/` only after all
adapter files and the immutable training manifest are complete. This prevents
a documented directory-setup step from colliding with final artifact
publication and preserves the no-overwrite guarantee.

Before training, `run_manifest.json` must record:

- schema version and experiment ID;
- hypothesis, owner, approval state, and timestamps;
- full GitHub repository and commit SHA;
- foundation repository and full commit SHA;
- development-evaluation repository and full commit SHA;
- Meta repository and pinned revision;
- starting adapter repository, revision, and hash, or explicit `null`;
- prompt, chat-template, tool-catalog, schema, and config versions and hashes;
- training and decoding configurations;
- random seeds;
- Python, package, PyTorch, CUDA, image, and GPU identity;
- output directories;
- checkpoint-retention policy;
- privacy, provenance, rights, and contamination approvals.

The preflight manifest must validate against
`../schemas/run_manifest.schema.json`. Its exact SHA-256 is included in the
training candidate authorization. The foundation `dataset_manifest.json` and
`checksums.json` must likewise validate against their tracked schemas, match
the approved v3 release, and have their exact SHA-256 values included in that
authorization. A path or repository revision alone is not proof of the bytes
used.

The authorized `run_manifest.json` is an immutable preflight record and
therefore remains `status: preflight` after its hash is approved. Execution
progress and results are recorded separately in the run's logs and reports.
The adapter's generated `training_manifest.json` records the completed run and
remains immutable at `release_review_status: completed_unreviewed`; approval is
recorded separately in the reviewed experiment decision and release
attestation. No training artifact may set a serving status.

## Phase 7: run preflight validation

From `ml/dime-1.0/`:

```bash
uv lock --check
ruff check .
python -m compileall -q src scripts
pytest -q
python scripts/validate_data.py
python scripts/template_contract_test.py
python scripts/model_smoke_test.py
```

Also reproduce the deterministic curriculum and evaluation audits documented
in the root README. The starter audits are expected to truthfully report that
production quotas are unmet; their reproducibility does not authorize a run.

Stop if:

- the checkout is dirty or not at the approved commit;
- a revision is missing or not 40 characters;
- a checksum, record count, schema, runtime, tokenizer, or smoke test fails;
- locked data or a prohibited credential is present;
- the approved config still contains a placeholder;
- the dataset approval is incomplete; or
- GPU memory is unexpectedly occupied.

## Phase 8: train only after explicit authorization

The current repository includes a rehearsal config and a full-training
template. Neither is automatic authorization.

An authorized full run requires a reviewed, non-template config bound to the
experiment ID and run directory. Authorization uses two commits so neither a
config hash nor run-manifest hash must contain the commit that approves it:

1. source commit `S` contains all executable code, governed files, manifest
   schemas and templates, and the approved full-training config;
2. the isolated run directory contains the completed preflight run manifest
   built from `S` and the approved immutable inputs;
3. authorization commit `A` descends from `S`, binds that manifest's exact
   hash, changes only `ml/dime-1.0/configs/platform_contract.json` across the
   entire repository, sets the platform to `training_authorized`, and turns on
   `authorization.full_training`;
4. `authorization.training_candidate` binds the exact experiment ID, `S`,
   foundation/development revisions, foundation dataset-manifest hash,
   foundation checksum-manifest hash, locked opaque reference, config hash,
   and preflight run-manifest hash; and
5. training executes only from a completely clean checkout of `A`, proves
   that `S` is an ancestor, and recomputes every bound value.

The immutable output manifest records `S` as the source Git commit and `A` as
the training-authorization Git commit.

The command shape is:

```bash
python scripts/train_qlora.py \
  --config "configs/<approved-full-training-config>.yaml" \
  --allow-full-run
```

`--allow-full-run` is a required operator acknowledgement, not a bypass. Any
dirty file, invalid source/authorization chain, any unexpected repository
change between `S` and `A`, candidate-binding mismatch, dataset count/hash mismatch,
manifest-schema failure, or missing approval still stops before model
training.

Stream logs into the run directory without exposing credentials or private
records. Retain recovery checkpoints according to the approved interval and
space budget. A checkpoint is recovery state, not a promoted model.

Do not change multiple major experimental variables in one run. Record every
deviation from the approved manifest before continuing.

## Phase 9: evaluate and classify the candidate

Evaluation must distinguish:

- deterministic repository and schema checks;
- development evaluation;
- human review;
- locked evaluation in the separate environment; and
- operational serving tests after promotion.

The training Pod may run development evaluation only. It must not receive the
locked credential or locked files.

At completion:

1. hash the candidate adapter and all reports;
2. preserve commands, exit results, final artifact hashes, and report hashes in
   the run's logs, reports, and generated training manifest without mutating
   the authorized preflight manifest;
3. mark the candidate `completed_unreviewed`;
4. preserve sanitized reports needed for review;
5. copy no private record or case-level locked material into GitHub; and
6. submit the candidate to the separate review and locked-evaluation process.

The candidate is not approved merely because it reloads, generates text, or
improves training loss.

## Phase 10: one-way locked-evaluation handoff

The candidate does not have, and must not be given, a production Hugging Face
revision before locked evaluation. The production model repository accepts
serving-approved releases only.

After training and development review, an authorized operator:

1. selects exactly `adapter_model.safetensors`, `adapter_config.json`, and
   `training_manifest.json` from the completed run;
2. binds their names, lengths, SHA-256 values, experiment ID, source commit,
   training-authorization commit, evaluator commit, locked-suite reference,
   evaluator run ID, and approval in an immutable
   `transfer_authorization`; the final manifest file hash is external and is
   never embedded in `training_manifest.json` itself;
3. sends only those bytes through the approved one-way transport into a fresh,
   isolated evaluator input;
4. proves the evaluator has a separate filesystem and cache and cannot mount
   the training network volume;
5. requires the evaluator to reject extra, missing, linked, non-regular, or
   hash-mismatched files before opening the locked suite;
6. records receiver verification in an immutable `receiver_receipt` and makes
   the verified evaluator input read-only for the run;
7. permits only the approved sanitized aggregate to leave; and
8. records secure cleanup in a separate immutable `cleanup_event` after the
   required restricted evidence is preserved.

The source candidate remains governed run output on the training volume until
its review and recovery retention decisions are complete. The copied evaluator
input never appears in the promoted model repository and is never mounted back
into training. The locked suite, restricted report, and case-level output never
enter the training volume.

The complete contract and future implementation acceptance criteria are in
[Candidate-to-locked-evaluator handoff](CANDIDATE_EVALUATION_HANDOFF.md).
Until that implementation is reviewed and authorized, locked evaluation
remains blocked.

## Phase 11: promotion handoff

The training Pod cannot publish because its credential is read-only.

After all gates pass, a separate release workspace:

1. receives the exact hashed candidate bundle;
2. confirms the immutable training manifest is `completed_unreviewed` and the
   separate, reviewer-owned experiment decision is
   `approved_for_release_review`;
3. verifies the Git, foundation, development, locked, base, experiment,
   evaluator, prompt, tool, schema, config, decoding, runtime, bundle, model,
   and evaluation identities;
4. confirms an owner-approved platform-contract pull request has set
   `authorization.adapter_publication` to `true` for this candidate;
5. completes the Model Card, root `LICENSE`, `NOTICE`, evaluation summary, and
   release attestation;
6. enforces the root-only adapter payload allowlist and treats only the remote
   `.gitattributes` as permitted non-payload repository metadata;
7. reads the destination's full current SHA immediately before publication and
   records it as the expected parent;
8. uses `dime-release-publisher-v1` with that expected parent as an optimistic
   concurrency guard;
9. publishes to `taileredsports/Llama-3-Dime-1.0` and captures the returned
   full Hugging Face commit SHA;
10. uses a separate read-only credential to verify the exact remote inventory
    and every payload hash at that returned SHA;
11. writes and preserves a publication receipt containing the expected parent,
    returned SHA, remote inventory, post-upload hashes, attestation hash, and
    verification result; and
12. records the returned SHA, receipt hash, and rollback SHA in a separate
    serving-promotion pull request.

A parent mismatch, unexpected remote file, missing returned SHA, hash mismatch,
or invalid receipt aborts promotion before tagging or serving.

The rehearsal adapter is never eligible for this handoff.

## Phase 12: retain, archive, and stop

Before stopping the Pod:

- verify GitHub contains the reviewed source and sanitized small evidence;
- verify Hugging Face contains every approved frozen dataset or promoted
  adapter;
- verify important manifests and hashes have a second governed copy;
- retain only the recovery checkpoints required by policy;
- remove duplicate caches or rejected outputs only through a separately
  reviewed cleanup step; and
- confirm the network volume remains mounted and intact.

Then stop GPU compute. A stopped Pod should report no GPU hourly charge, while
the network volume continues its storage charge.

Terminate obsolete Pod records only after confirming no required data remains
on their container disks. Terminating a Pod must not delete the governed
network volume.

## Recovery after migration or Pod loss

1. Deploy from the saved template with the existing network volume.
2. Verify `/workspace` and the injected training-read credential.
3. Rebuild `/opt/dime-venv`.
4. Verify the pinned full Git checkout.
5. Verify the dataset revision directories and checksums.
6. Read the run manifest and most recent approved recovery checkpoint.
7. Confirm the resume command, seed behavior, scheduler state, and output path.
8. Record the infrastructure transition in an append-only recovery log under
   the run's `logs/` or `reports/` directory. Do not modify
   `run_manifest.json`; it is the immutable, candidate-bound preflight
   manifest.
9. Resume only when the recovered state is complete and the run remains
   authorized.

Never recreate missing provenance from memory. If the exact run identity or
checkpoint integrity cannot be established, reject the resume and start a new
experiment ID.

## Incident stop conditions

Stop the run and preserve evidence if:

- a secret appears in output or logs;
- a credential has broader access than the declared matrix;
- locked content is discovered in training storage;
- the source or dataset revision changes;
- a checksum changes;
- a user or provider data-rights issue appears;
- the GPU/runtime differs from the approved contract;
- output is written outside the experiment directory unexpectedly;
- the network volume becomes unavailable; or
- RunPod becomes the only remaining copy of an important artifact.

Credential exposure requires secret revocation and rotation before any resume.
Do not paste the exposed value into a ticket, pull request, or chat.

## Setup evidence

The first normalized workspace verification is documented at
[`evidence/infrastructure/2026-07-26/`](../evidence/infrastructure/2026-07-26/).
It proves the observed setup mechanics and access isolation only. It does not
authorize training, locked evaluation, publication, serving, or provider
activation.
