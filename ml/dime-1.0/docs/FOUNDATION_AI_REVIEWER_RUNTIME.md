# Foundation AI reviewer runtime and signer architecture

## Purpose and current status

This document defines the selected runtime and security architecture for the
two Foundation v1 AI reviewer assignments. It binds each reviewer to an exact
model revision, an immutable RunPod worker image, an isolated RunPod Serverless
endpoint plan, an AWS provisioning-workload Lambda, a purpose-bound signer
Lambda, and a separate non-exportable AWS KMS signing key.

This architecture is **planned, inactive, and non-authorizing**. Implementing
or testing it does not:

- activate either reviewer;
- admit private candidate data;
- approve a dataset;
- authorize GPU execution, training, locked evaluation, publication, release,
  serving, or provider activation; or
- change the Dime Chat application provider from `frozen`.

The governed reviewer registry remains `proposed`; both reviewers remain
`active: false`; and all platform authorization gates remain blocked until a
separate owner-approved activation change reviews the exact provisioned
profiles and sanitized evidence.

## Immutable runtime selection

The reviewer assignments deliberately use different model families and policy
lineages. A shared worker image does not merge their identities: each model,
endpoint, endpoint API key, policy bundle, AWS workload, signer, KMS key, and
audit path remains separately bound.

| Assignment | Stable reviewer identity | Responsibility | Model repository | Exact model revision |
|---|---|---|---|---|
| Reviewer A | `dime-reviewer-d55729f9-9153-4534-95bd-6bf097416980` | Domain, numeric, simulation, semantic audit, and dataset approval | `Qwen/Qwen3-32B` | `9216db5781bf21249d130ec9da846c4624c16137` |
| Reviewer B | `dime-reviewer-c3ddb330-def3-4406-9325-1b4d48d32543` | Coaching, safety, privacy, rights, evaluation audit, locked-evaluation review, and dataset approval | `mistralai/Mistral-Small-3.2-24B-Instruct-2506` | `95a6d26c4bfb886c58daf9d3f7332c857cb27b43` |

Both RunPod deployments use this exact Linux/AMD64 worker image:

```text
docker.io/runpod/worker-v1-vllm:v2.22.5@sha256:d8bc05a0b87d5a07a2112c7919b1995a5908651d46b9b43d8dd367fa4b2724f1
```

The selected image exposes vLLM `0.20.2` with CUDA `13.0.2`. Its source release
commit is:

```text
9e1c4831366e828cad978ced046b1e2e56664e19
```

Both plans require at least 80 GB of VRAM, keep `workers_min=0` and
`workers_max=1`, and permit only one concurrent request. The initial Qwen
context is capped at 16,384 tokens so its BF16 weights, KV cache, and runtime
overhead fit reliably on a single 80 GB-class GPU. The smaller Mistral stack
retains a 32,768-token cap.

Tags are descriptive only. The full Hugging Face commit SHAs and Linux/AMD64
container manifest digest are the runtime identities. A branch, `main`,
`latest`, a semantic version alone, an OCI index digest in place of the
platform manifest, or a shortened digest is not an acceptable replacement.

## Selected architecture

```text
GitHub main
  reviewed pins, policies, SAM source, tests, runbooks
         |
         | owner-reviewed deployment inputs
         v
AWS SAM provisioning stack in us-west-2

  Provisioning workload A ──own only──> Signer Lambda A ──kms:Sign──> KMS key A
  Provisioning workload B ──own only──> Signer Lambda B ──kms:Sign──> KMS key B
                                      exact challenge digests only

Separate future inference plane (not created by this stack)

  RunPod private endpoint A              RunPod private endpoint B
  Qwen/Qwen3-32B at exact SHA            Mistral Small 3.2 at exact SHA
```

The tracked workload Lambdas are narrow provisioning identities. They invoke
their own purpose-bound signers and prove that the peer signer is denied. They
do not call RunPod, hold endpoint credentials, process candidate records, or
issue review decisions. A later owner-approved activation change must define
and validate any live inference orchestrator and secret boundary. RunPod
workers must never receive AWS credentials or call KMS directly.

The signer Lambdas are not general signing services. Each accepts only the
defined Foundation reviewer provisioning operation, the exact domain-separated
challenge, and the exact challenge SHA-256 pinned for that reviewer. Callers
cannot substitute a reviewer ID, profile ID, message, key, or operation.

The two paths do not share a provisioning workload function, signer function,
KMS key, policy bundle, or audit identity. Future endpoints must also use
separate API keys, model caches, writable volumes, and receipt stores.
Workload A cannot invoke signer B, signer A cannot use key B, and the inverse
restrictions apply to Reviewer B.

## Platform ownership

### GitHub

GitHub `main` is authoritative for:

- the two model repository IDs and full revision SHAs;
- the worker image repository, tag, full deploy digest, vLLM/CUDA versions,
  and source release commit;
- reviewer IDs, profile IDs, policy contracts, tool contracts, schemas, and
  fail-closed validation code;
- the AWS SAM template and Lambda source;
- secretless RunPod planning source;
- reviewer activation and release gates;
- tests and operating documentation; and
- reviewed, sanitized attestations that contain no secret or reconstructable
  private data.

GitHub never owns or stores KMS private-key material, RunPod endpoint API keys,
AWS credentials, endpoint identifiers, Terraform or CloudFormation state,
private candidate records, locked-evaluation content, raw cloud logs, or
secret-manager output.

### AWS

AWS in `us-west-2` is authoritative for:

- two separate asymmetric KMS keys using
  `KeySpec=ECC_NIST_EDWARDS25519` and `KeyUsage=SIGN_VERIFY`;
- two purpose-bound signer Lambdas, each bound to one reviewer, one profile,
  one expected challenge SHA-256, and one KMS key;
- two provisioning-workload Lambdas, each able to invoke only its own signer;
- least-privilege Lambda execution, invocation, and KMS key policies;
- signer and workload disablement or revocation state; and
- durable Lambda and KMS audit records.

Each provisioning workload Lambda may invoke its own signer only. It cannot
call RunPod, invoke the peer signer, or use KMS directly. Each signer Lambda
may call `kms:Sign` only on its own key. Neither path receives permission to
decrypt unrelated data, access the other reviewer path, train a model, publish
an adapter, access Hugging Face release credentials, or mutate infrastructure.

The KMS signing keys are created inside AWS and are non-exportable. Only public
key material is exported through an owner-controlled, read-only process.

### RunPod

If separately authorized and created, RunPod owns only replaceable inference
execution:

- one private queue endpoint for Reviewer A;
- one separate private queue endpoint for Reviewer B;
- the exact digest-pinned worker runtime;
- ephemeral or isolated model caches; and
- one separate endpoint API key per future inference caller.

RunPod is not authoritative for reviewer identity, approval, receipt signing,
signing-key custody, policy, release status, source code, or final evidence.
Endpoint IDs, worker IDs, public addresses, API-key values, and request IDs are
operational values and must not be committed.

The endpoints must not mount the Dime training network volume, expose Jupyter
or SSH, receive AWS, publisher, or locked-evaluator credentials, or share a
writable cache. Endpoint health does not grant reviewer authority.

## Zero-secret repository boundary

The public repository may contain only identifiers safe for review:

- model repository names and full content-addressed revisions;
- the full container image digest and source release commit;
- stable reviewer and profile IDs;
- KMS public-key bytes, public-key hashes, aliases, and sanitized key
  attestations;
- Lambda source and SAM resource definitions without deployed identifiers;
- public provisioning challenges, signatures, and their SHA-256 values;
- secret **names or references**, never secret values; and
- redacted, non-reconstructable positive and negative access-test results.

The following must remain outside Git:

- KMS private-key material;
- RunPod endpoint API-key values;
- AWS, RunPod, Hugging Face, or model-provider tokens;
- deployed Lambda, KMS, endpoint, account, and request identifiers unless
  transformed into an approved opaque public identity;
- CloudFormation change sets, deployment parameter files containing
  environment values, and cloud state;
- private candidate records and locked-evaluation content; and
- raw audit logs that contain session, account, endpoint, secret, or request
  identifiers.

Provisioning commands must not print secret values. CI runs with no AWS or
RunPod credentials and never deploys or mutates infrastructure.

## SAM stack modes

The AWS SAM stack has three explicit modes. A mode transition is a reviewed
owner action, not an automatic consequence of a passing local test.

### `LOCKED`

`LOCKED` is the default and rollback mode. It must expose no usable signing
path:

- provisioning workloads are unavailable;
- signer invocation is unavailable;
- no RunPod endpoint API key exists in or is usable by this stack;
- no provisioning challenge can be signed; and
- all Dime authorization gates remain blocked.

Every fresh environment begins in `LOCKED`. Any unexpected policy, runtime,
evidence, or cost condition returns the stack to `LOCKED`.

### `KEY_SETUP`

`KEY_SETUP` exists only to establish and verify the two non-exportable KMS
identities:

- create key A and key B with the exact Ed25519 signing-only contract;
- preserve distinct aliases and administration boundaries;
- export each public SubjectPublicKeyInfo document through an owner-controlled
  read-only operation;
- convert each document to the raw 32-byte Ed25519 public key required by the
  Dime verifier;
- record public-key SHA-256 values and sanitized metadata; and
- generate the two exact profile-bound provisioning challenges.

The workload and signer invocation paths remain unavailable in `KEY_SETUP`.
The mode does not call RunPod and cannot sign a challenge.

### `PROVISIONING`

`PROVISIONING` enables only the bounded evidence path:

- deploy signer A and signer B with their own reviewer ID, profile ID, KMS key,
  and expected challenge SHA-256;
- deploy workload A and workload B with permission to invoke only their own
  signer;
- allow each signer to call `kms:Sign` only on its own key; and
- execute the positive and negative provisioning probes.

`PROVISIONING` is not reviewer activation. It accepts only synthetic
non-private probes and the exact provisioning challenges. When the evidence
window ends, the stack returns to `LOCKED`.

## Controlled deployment sequence

Every phase fails closed. A later phase may begin only after the earlier
phase's required evidence passes and is reviewed.

### Phase 0 — reviewed source

1. Begin from a clean checkout of an exact reviewed GitHub commit.
2. Confirm the platform remains `foundation_only`, both reviewers are
   inactive, and all training, evaluation, publication, serving, and provider
   gates are false.
3. Validate the model SHAs, worker digest, reviewer IDs, policy hashes, and
   planned AWS workload identities against the governed contracts.
4. Run all Dime CPU validation, schemas, Lambda unit tests, SAM validation, and
   secret scans without cloud credentials.
5. Confirm the SAM plan begins in `LOCKED`.

Failure or a dirty worktree stops the procedure.

### Phase 1 — AWS `KEY_SETUP`, then back to `LOCKED`

1. Deploy the reviewed SAM stack in `us-west-2` with mode `KEY_SETUP`.
2. Create and inspect the two separate KMS Ed25519 signing keys.
3. Retrieve each public key through the owner-controlled export path.
4. Convert each KMS SubjectPublicKeyInfo document to the exact raw 32-byte
   Ed25519 public key required by the receipt verifier.
5. Verify the raw public-key hashes are different and match the proposed
   profile inputs.
6. Generate each profile-bound challenge and its SHA-256.
7. Return the stack to `LOCKED` before provisioning endpoint access.

No RunPod endpoint or secret is needed during key setup.

### Phase 2 — RunPod private endpoints

With AWS back in `LOCKED`:

1. Create two separate private RunPod Serverless queue endpoints from the exact
   Linux/AMD64 worker digest.
2. Pin endpoint A to `Qwen/Qwen3-32B` at
   `9216db5781bf21249d130ec9da846c4624c16137`.
3. Pin endpoint B to
   `mistralai/Mistral-Small-3.2-24B-Instruct-2506` at
   `95a6d26c4bfb886c58daf9d3f7332c857cb27b43`.
4. Create distinct endpoint API keys. Keep each value in a separately reviewed
   owner-controlled secret boundary for a future inference caller. Do not add
   either credential to the provisioning signer stack.
5. Apply the separately reviewed system instruction, tool contract, inference
   policy, conflict policy, recusal policy, and deterministic request settings
   for that reviewer.
6. Confirm there is no unauthenticated inference path, shared API key, shared
   volume, public notebook, SSH service, or cross-endpoint secret reference.
7. Verify the live worker reports the expected model revision, image digest,
   runtime versions, and policy hashes before accepting a response.

Endpoint creation is still provisioning. Do not send private Foundation
records or locked-evaluation cases.

### Phase 3 — AWS `PROVISIONING` and possession proofs

1. Provide the reviewed reviewer-specific challenge SHA-256 values to the SAM
   deployment without exposing endpoint API-key values.
2. Move the stack from `LOCKED` to `PROVISIONING`.
3. Invoke workload A with challenge A. It must invoke signer A, obtain a KMS A
   signature, and prove that invocation of signer B is denied.
4. Invoke workload B with challenge B. It must invoke signer B, obtain a KMS B
   signature, and prove that invocation of signer A is denied.
5. Each signer calls KMS with
   `SigningAlgorithm=ED25519_SHA_512` and `MessageType=RAW`. The signer does
   not pre-hash, wrap, normalize, or regenerate the challenge.
6. Canonically encode each raw 64-byte signature as padded Base64 and add it to
   the corresponding private provisioning input.
7. Run `scripts/prepare_ai_reviewer_profiles.py` to verify both possession
   proofs and prepare the inactive candidate reviewer registry.
8. Verify the candidate binds the source-registry SHA-256, monotonically
   higher registry version, exact model/runtime/policy pins, distinct workload
   identities, and the two KMS public keys.
9. Capture only the approved sanitized evidence, then return the SAM stack to
   `LOCKED` and scale the RunPod endpoints to zero.

A successful possession proof proves control of a configured signing path. It
does not approve data or activate a reviewer.

### Phase 4 — separate activation decision

Activation is a later, focused, owner-approved change. It must bind the exact
candidate registry and all required evidence, then rerun the positive and
negative matrix. That change may activate reviewer authority only. It must
leave training, locked evaluation, publication, serving, and provider
activation blocked.

## Required evidence

### Positive evidence

The sanitized evidence package must prove:

- `LOCKED` exposed no usable workload or signing path;
- `KEY_SETUP` created two distinct non-exportable KMS public identities without
  enabling signer or RunPod access;
- workload A invoked only signer A, which signed only with key A;
- workload B invoked only signer B, which signed only with key B;
- each public key verifies its own exact challenge signature;
- the AWS provisioning workloads had no RunPod endpoint credential or
  inference permission;
- each future inference caller used only its own endpoint API-key boundary;
- each private endpoint loaded its assigned model at the exact full Hugging
  Face commit;
- each endpoint ran the exact Linux/AMD64 container digest;
- each endpoint loaded its reviewer-specific instruction, tool, inference,
  conflict, and recusal policy hashes;
- authenticated health and one synthetic, non-private review request succeeded
  per endpoint; and
- required Lambda and KMS audit events were recorded.

### Negative evidence

The package must also prove:

- workload A is denied signer B and workload B is denied signer A;
- signer A is denied key B and signer B is denied key A;
- anonymous, training, serving, release-publisher, workbench,
  locked-evaluator, and locked-publisher identities cannot invoke either
  workload or signer;
- disabled or `LOCKED` functions cannot sign;
- a removed endpoint API key cannot call its endpoint;
- a signature from A fails under key B and the inverse also fails;
- altered challenges, altered profiles, altered policy hashes, stale registry
  bindings, expired keys, and replayed proofs fail closed;
- unauthenticated endpoint requests and cross-endpoint API keys are denied;
- an endpoint configured with a moving model alias, wrong model SHA, wrong
  image digest, or another reviewer's secret reference is rejected;
- neither endpoint can read the other endpoint's cache, credential, receipt
  store, or policy bundle; and
- logs, outputs, SAM plans, and attestations contain no token, private key,
  endpoint API-key value, or reconstructable private data.

Evidence must state what was tested, when, against which immutable identities,
and the pass/fail result. Raw credentials, account details, request IDs,
function ARNs, key ARNs, and endpoint IDs remain in restricted audit storage.

## Rollback and revocation

Rollback is fail-closed and proceeds in this order:

1. move the SAM stack to `LOCKED`;
2. stop or scale both RunPod endpoints to zero;
3. revoke or rotate the affected RunPod endpoint API key;
4. remove the affected workload's permission to invoke its signer;
5. remove the affected signer's permission to call `kms:Sign`;
6. disable the affected KMS key if compromise is suspected;
7. preserve restricted AWS and RunPod audit evidence;
8. invalidate any unreviewed candidate or possession proof derived from the
   revoked path; and
9. revert public configuration through a reviewed GitHub change.

KMS keys are not immediately deleted during an incident. Disablement preserves
the public verification history and audit trail while preventing new
signatures. Replacement requires a new key ID, public-key hash, possession
proof, candidate registry, and review.

If only a RunPod runtime fails, stop that endpoint and recreate it from the
exact source and image pins. Do not reuse an unverified cache or silently fall
back to another model, image, endpoint, workload, or signer.

## Cost controls

- Do not allocate RunPod workers while the AWS stack is in `KEY_SETUP`.
- Keep the SAM stack in `LOCKED` and RunPod endpoints scaled to zero outside an
  approved provisioning or review window.
- Cap RunPod worker count, concurrency, execution timeout, and queue depth at
  the smallest owner-approved values that satisfy the controlled test.
- Do not attach the training network volume or create another persistent
  reviewer volume.
- Load only the assigned model into each endpoint; do not duplicate both
  models across both endpoints.
- Stop workers immediately after the evidence window.
- Configure RunPod spend alerts and an owner-defined hard budget before the
  first live endpoint test.
- Configure bounded Lambda concurrency, timeouts, and log retention before
  entering `PROVISIONING`.
- Treat unexpected restarts, scaling, invocation volume, image pulls, queue
  growth, or idle workers as a rollback trigger until reviewed.

Cost savings never justify a shared endpoint API key, workload, signer, KMS
key, moving image tag, mutable model revision, or bypassed access test.

## Explicit non-scope

This architecture does not:

- generate, review, freeze, or publish the 2,400-record Foundation dataset;
- permit private Foundation data to enter an endpoint;
- expose or evaluate locked release cases;
- authorize QLoRA/SFT training or any GPU training run;
- upload an adapter or base-model weights to Hugging Face;
- merge, quantize, release, or serve a Dime adapter;
- change Railway, the web application, database schema, Dime Chat route, or
  server provider wiring;
- replace `meta-llama/Llama-3.1-8B` as the governed Dime post-training parent;
- authorize either reviewer model as the Dime Chat production model;
- activate the reviewer registry, receipt verifier, provider, or release
  gates;
- create static AWS credentials or export a KMS private key;
- create a general-purpose signing API;
- give a RunPod worker direct AWS or KMS access; or
- make RunPod, AWS, or an endpoint the sole authoritative location for source,
  policy, approval, or release evidence.

The only intended outcome is a reproducible, independently secured,
cryptographically provable, and still-inactive two-reviewer runtime ready for
a later owner activation decision.
