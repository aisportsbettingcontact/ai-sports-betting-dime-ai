# AWS Foundation reviewer signer control plane

## Status

`INFRASTRUCTURE SOURCE ONLY — REVIEWERS INACTIVE — DEPLOYMENT NOT AUTHORIZED`

This AWS SAM stack defines two isolated reviewer workload identities and two
purpose-bound, non-exportable Ed25519 signers. It supports only the existing
Foundation reviewer **provisioning possession proof**. It does not activate a
reviewer, approve data, run a model, read private datasets, authorize training,
publish an adapter, serve Dime Chat, or change Railway, RunPod, or Hugging Face.

The stack belongs in a dedicated owner-controlled Dime reviewer-security AWS
account in `us-west-2`. Do not deploy it into the Railway application account
or a training environment.

## Security boundary

```text
owner-controlled invocation
  ├── reviewer A workload role → reviewer A signer alias → KMS key A
  │                            ╰─ peer signer probe must be AccessDenied
  └── reviewer B workload role → reviewer B signer alias → KMS key B
                               ╰─ peer signer probe must be AccessDenied
```

- Each workload role trusts only AWS Lambda.
- Each workload can invoke only its own immutable signer alias.
- Each workload explicitly denies its peer signer, every other Lambda target,
  and direct `kms:Sign`.
- Each signer role can call `kms:Sign` only on its own KMS key.
- Both IAM and KMS key policies require `MessageType=RAW` and
  `SigningAlgorithm=ED25519_SHA_512`.
- The signer accepts only one challenge whose SHA-256 is pinned into the
  published Lambda version.
- No function URL, API Gateway, IAM user, access key, static credential, model
  credential, secret, or public bucket exists.
- CloudTrail records the Lambda invocation chain and KMS management calls in a
  private, versioned, retained S3 bucket.

## Controlled modes

| Mode | KMS keys | Functions | Purpose |
|---|---|---|---|
| `LOCKED` | Disabled | Reserved concurrency `0` | Default and post-provisioning state |
| `KEY_SETUP` | Enabled | Reserved concurrency `0` | Retrieve the two public SPKI DER keys |
| `PROVISIONING` | Enabled | Reserved concurrency `1` | Sign the two exact possession challenges |

There is deliberately no active-reviewing mode. A separate owner-approved
change is required before either reviewer may issue governed decisions.

`PROVISIONING` fails CloudFormation rule validation unless both public
challenge SHA-256 parameters are configured. The default all-zero values can
never be used for signing.

## Repository validation

From `ml/dime-1.0/`:

```bash
uv run python scripts/validate_reviewer_signer_iac.py
uv run pytest -q \
  tests/test_reviewer_signer_iac.py \
  tests/test_reviewer_signer_handlers.py \
  tests/test_export_aws_kms_ed25519_public_key.py
```

Before creating any AWS change set, run an exact recorded AWS SAM CLI version:

```bash
sam validate --lint \
  --template-file infrastructure/aws/reviewer-signers/template.yaml
sam build \
  --template-file infrastructure/aws/reviewer-signers/template.yaml
```

Do not place AWS credentials in pull-request CI. Static repository validation
does not authorize a deployment.

## Owner-controlled deployment procedure

### 1. Deploy the locked stack

Review the packaged template and CloudFormation change set. Deploy only with:

```text
StackMode=LOCKED
ReviewerAExpectedChallengeSha256=0000000000000000000000000000000000000000000000000000000000000000
ReviewerBExpectedChallengeSha256=0000000000000000000000000000000000000000000000000000000000000000
```

Record the exact Git commit, template SHA-256, packaged artifact digest, AWS
account, Region, stack ID, and change-set ID in the private run manifest.

The stack outputs two workload-role ARNs. Those exact ARNs are the
`workload_identity_id` values for the private provisioning input.

### 2. Retrieve public keys

Update only `StackMode` to `KEY_SETUP`. Functions remain unable to run. Retrieve
each public key through the owner deployment identity:

```bash
aws kms get-public-key \
  --key-id <REVIEWER_KEY_ARN> \
  --query PublicKey \
  --output text \
  | base64 --decode > /absolute/private/path/reviewer.spki.der
```

Convert that **public-only** SPKI DER value:

```bash
uv run python scripts/export_aws_kms_ed25519_public_key.py \
  --spki-der /absolute/private/path/reviewer.spki.der
```

AWS returns X.509 SubjectPublicKeyInfo DER. Dime requires raw 32-byte Ed25519
Base64 plus the SHA-256 of those raw bytes. The conversion script accepts only
one canonical Ed25519 SPKI public key and never contacts AWS.

### 3. Generate the exact challenges

Complete the private provisioning bundle outside Git, keeping possession proof
signatures `null`, and generate the public challenge files:

```bash
uv run python scripts/prepare_ai_reviewer_profiles.py \
  --bundle-dir /absolute/private/provisioning-bundle \
  --emit-challenges
```

Confirm each challenge is no more than 4,096 bytes. Capture the printed
SHA-256 values without copying the challenge payload into logs.

### 4. Run the bounded probes

Update the stack with:

```text
StackMode=PROVISIONING
ReviewerAExpectedChallengeSha256=<EXACT_REVIEWER_A_CHALLENGE_SHA256>
ReviewerBExpectedChallengeSha256=<EXACT_REVIEWER_B_CHALLENGE_SHA256>
```

Invoke each workload's `provisioning-v1` alias with only:

```json
{
  "operation": "run_foundation_reviewer_provisioning_probe_v1",
  "challenge_base64": "<CANONICAL_PADDED_BASE64>",
  "challenge_sha256": "<EXACT_SHA256>"
}
```

Success requires:

1. the owned signer returns one raw 64-byte Ed25519 signature;
2. the peer signer invocation fails at IAM with `AccessDeniedException`;
3. reviewer A's signature verifies only with public key A;
4. reviewer B's signature verifies only with public key B; and
5. altered, cross-key, stale-registry, and replay-under-new-registry proofs fail
   through the existing Dime verifier.

Do not treat a peer function error as an access denial.

### 5. Relock and preserve evidence

Immediately return `StackMode` to `LOCKED`. Confirm:

- both keys are disabled;
- all four functions have reserved concurrency `0`;
- CloudTrail contains both workload calls, both owned signer calls, both denied
  peer calls, and both KMS signing calls; and
- no Lambda or CloudTrail record contains credentials, private-key material,
  raw private bundle data, or model context.

Keep detailed AWS identifiers and CloudTrail logs in the private security
workspace. A later GitHub PR may include sanitized public keys, challenge
hashes, signatures, access-test results, template and source hashes, and the
inactive candidate registry. It must leave every platform authorization gate
blocked.

## Revocation

To stop use immediately:

1. update the stack to `LOCKED`;
2. confirm both workload and signer concurrency values are `0`;
3. confirm the affected KMS key is disabled;
4. mark the governed public key revoked in a separate reviewed registry
   change; and
5. preserve old public evidence for verification of historical receipts.

Never delete an old verification record simply because its signing key was
revoked. The KMS keys and audit bucket use CloudFormation retain policies.
