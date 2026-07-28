# Foundation AI reviewer provisioning

## Outcome of this work package

Dime can now prepare and verify a **provisioned but inactive** candidate profile
for each of the two owner-approved AI reviewer assignments. This closes the
gap between placeholder reviewer IDs and real, cryptographically bound
reviewer identities without granting either reviewer authority.

The provisioning tool:

- accepts only the two existing stable reviewer and profile IDs;
- requires exact model, runtime, model-lineage, policy-lineage, and workload
  identity pins;
- hashes the reviewer-specific instruction, tool, inference, conflict, and
  recusal policies itself;
- rejects non-UTF-8, NUL-bearing, symlinked, oversized, or PEM-bearing policy
  artifacts;
- verifies each 32-byte Ed25519 public key and derives its key ID;
- proves control of each public key with a signed, profile-bound challenge;
- rejects shared keys, workload identities, model lineages, policy lineages,
  model stacks, or materially identical policy stacks;
- writes only a new candidate file outside the Git worktree; and
- always preserves `proposed`, inactive, and unauthorized state.

It never creates, imports, reads, prints, or persists a private signing key.

## Where each artifact belongs

The public repository contains only this schema, tool, template, tests, and
runbook. A temporary provisioning bundle belongs in an owner-controlled private
workspace outside the Git checkout. Private signing keys belong only in two
separate, non-exportable Ed25519 KMS/HSM signing identities.

```text
GitHub ml/dime-1.0/
  schemas/foundation_ai_reviewer_provisioning_input.schema.json
  scripts/prepare_ai_reviewer_profiles.py
  data/templates/foundation_ai_reviewer_provisioning_input_TEMPLATE.json

Private provisioning bundle (outside Git)
  provisioning.json
  reviewer-one/
    system-instruction.md
    tool-contract.json
    inference-policy.json
    conflict-policy.json
    recusal-policy.json
  reviewer-two/
    system-instruction.md
    tool-contract.json
    inference-policy.json
    conflict-policy.json
    recusal-policy.json

External signer A                        External signer B
  workload identity A                     workload identity B
  non-exportable Ed25519 key A             non-exportable Ed25519 key B
```

Do not place raw private keys, PEM files, seed bytes, secret-manager responses,
API tokens, candidate data, or locked-evaluation content in the bundle.

## Required owner inputs

Provisioning cannot truthfully finish until the owner supplies:

1. two materially independent model stacks, each with a full 40- or
   64-character content-addressed model revision and reviewer-runtime digest;
2. two owner-approved model-lineage IDs and two policy-lineage IDs;
3. two distinct short-lived workload identities, each authorized to invoke
   only its own signer;
4. reviewer-specific system instructions, inference policies, conflict
   policies, and recusal policies;
5. the common or reviewer-specific tool contract;
6. two distinct raw Ed25519 public keys and their validity windows; and
7. signatures created by those bound non-exportable signers over the exact
   generated challenges.

Different reviewer IDs or keys alone do not establish independence. The model
and policy lineages must also be materially distinct.

Tags, branches, dates, release names, and semantic versions are not immutable
identity pins and are rejected. A bounded signing-key window must end after it
starts and must not already be expired when the candidate is prepared.

## Two-phase procedure

### 1. Prepare the private bundle

Copy the provisioning template into a new private directory outside the Git
worktree as `provisioning.json`. Copy the five public policy artifacts for each
reviewer into that directory. Replace every field except
`possession_proof_signature_base64`, which remains `null`.

Set `source_registry_sha256` to the SHA-256 of the exact current
`configs/foundation_reviewer_registry.json`. Set `target_registry_version` to a
new monotonically higher version.

### 2. Generate exact public challenges

From `ml/dime-1.0/`:

```bash
uv run python scripts/prepare_ai_reviewer_profiles.py \
  --bundle-dir /absolute/private/provisioning-bundle \
  --emit-challenges
```

The command writes one `dime-reviewer-*.challenge.bin` file per reviewer. These
files are public challenge bytes, not secrets. Each challenge binds the exact
source-registry SHA-256, target registry version, reviewer ID, and complete
candidate profile. Each workload identity sends only its own challenge to its
own KMS/HSM key and receives a raw 64-byte Ed25519 signature.

The signing service must expose a purpose-bound reviewer signing operation. It
must not offer a general arbitrary-message signing endpoint, and callers must
not be able to override reviewer ID, profile, key, registry binding, or
timestamp.

### 3. Add possession proofs

Encode each raw 64-byte signature as canonical padded Base64 and place it in
the corresponding `possession_proof_signature_base64` field. Never place a
private key in the input.

### 4. Prepare the inactive candidate registry

```bash
uv run python scripts/prepare_ai_reviewer_profiles.py \
  --bundle-dir /absolute/private/provisioning-bundle
```

On success the command writes `candidate-reviewer-registry.json` with mode
`0600` and prints its SHA-256. It refuses to overwrite an existing file. The
command first reads the governed platform contract and fails unless every
authorization gate is still blocked. The candidate remains:

- registry status `proposed`;
- both reviewers `active: false`;
- both profiles `status: provisioned`;
- receipt-verifier activation `false`; and
- training, locked evaluation, publication, serving, and provider activation
  unchanged and blocked.

### 5. Preserve public proof, not secrets

The later provisioning PR may contain the reviewed candidate registry, exact
public policy artifacts, public keys, public challenge hashes, signatures, and
a sanitized access-test attestation. It must not contain private keys,
credentials, private data, model context, or secret-manager output.

## Access tests required before activation

For reviewer A, prove workload A can invoke only signer A and is denied signer
B. Prove the inverse for reviewer B. Prove anonymous, training, serving,
release-publisher, workbench, locked-evaluator, and locked-publisher identities
cannot invoke either signer. Prove a revoked workload identity cannot sign.

Then verify:

- A challenge signed by A verifies only under public key A;
- B verifies only under B;
- cross-key, tampered-profile, stale-registry, altered-policy, and replayed
  proofs fail;
- no logs or attestations contain credentials or private-key material; and
- the two model and policy lineages satisfy the two-group quorum.

## Activation remains a separate decision

Provisioning does not activate reviewer authority. A later focused,
owner-approved activation change must review the exact candidate and sanitized
access proofs, wire the independent owner authorization input into both audit
and freeze entry points, and prove the positive and negative activation matrix.
That later change may activate reviewer authority only. It must leave training,
locked evaluation, publication, serving, and provider activation blocked.
