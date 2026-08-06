# Foundation AI-agent decision receipts

## Purpose and current authorization state

Dime can cryptographically verify a registered AI agent's decision without
treating an API token, service account, model name, or prose assertion as
reviewer identity. The verifier is implemented and fail-closed.

This capability does **not** activate an AI reviewer. The governed registry is
still `proposed`, its two agent profiles remain `configuration_pending`, no
public keys or model revisions have been assigned, and both the registry and
independent owner-controlled activation gates remain false. Training,
publication, serving, and provider activation remain unauthorized.
The public-only provisioning tool can prepare signed candidate profiles, but
the current governed profiles have not received those owner-controlled inputs.

## Receipt and key contract

The only supported signature suite is:

- verifier: `dime-ed25519-decision-receipt-verifier` version `1.0.0`;
- signature: Ed25519 over a raw 32-byte public key and raw 64-byte signature;
- encoding: canonical padded Base64;
- receipt schema: `dime-agent-decision-receipt-v1`; and
- content addressing: lowercase SHA-256 of the complete canonical receipt file.

The public verification key belongs in the Git-controlled reviewer registry.
It is not secret. Its key ID is exactly `key-<sha256(raw-public-key)>`.
Private signing keys must never enter GitHub, Hugging Face, RunPod receipt
directories, logs, shared credentials, or model context. Each official agent
must use its own non-exportable signing identity.

## Exact signed bytes

The Ed25519 signature covers:

```text
UTF8("DIME-AGENT-DECISION-RECEIPT-V1") || 0x00 ||
DimeCanonicalJsonV1(payload)
```

`DimeCanonicalJsonV1` is a deliberately small Dime byte contract, not RFC 8785
JCS:

1. encode UTF-8 without Unicode normalization;
2. sort object keys lexicographically using the runtime's Unicode string order;
3. use `,` and `:` with no extra whitespace;
4. emit non-ASCII characters directly;
5. reject NaN and Infinity;
6. use JSON escapes for control characters and quotes; and
7. append exactly one line-feed byte.

Receipt payloads contain only schema-constrained strings. A signer in another
language must pass the repository's golden canonicalization vectors before it
can be considered compatible.

## What every signature binds

The signed payload binds one immutable decision to:

- a globally unique receipt ID;
- the decision purpose;
- the stable reviewer ID;
- the exact agent profile ID and profile SHA-256;
- the exact reviewer-registry version and raw-file SHA-256;
- the public-key-derived issuer key ID;
- the governed subject SHA-256;
- the canonical decision-context SHA-256; and
- the whole-second UTC decision timestamp.

The decision-context digest is recomputed by Dime from the schema-validated
decision after removing only its detached receipt-reference field. Callers
cannot supply or override that digest.

## Governed decision paths

Signature verification is wired into all AI-capable Foundation authority paths:

1. record review decisions;
2. source-rights review decisions;
3. all six external audit decisions; and
4. final dataset approvals.

Human-only evidence continues to work without a receipt directory. Any AI
review reference requires the exact receipt bytes and full verification
context; a digest string by itself grants no authority.

## Private receipt-store boundary

Audit and freeze accept an optional `--agent-receipt-dir`. It must remain
outside the public Git worktree. The directory:

- is flat and contains only regular, non-symlink files;
- names each file `<raw-file-sha256>.json`;
- accepts only canonical receipt bytes;
- limits each receipt to 64 KiB and the store to 10,000 files;
- rejects duplicate content digests and duplicate receipt IDs; and
- at freeze, must exactly equal every receipt referenced by source reviews,
  record reviews, external audits, and dataset approval.

The candidate audit may see a superset because later-stage audit and approval
receipts can already exist. The final freeze is closed-world and rejects every
extra or missing receipt.

## Failure and replay behavior

Unsupported schemas, algorithms, encodings, noncanonical JSON/Base64, invalid
signatures, wrong keys, inactive profiles, registry/profile/context/time
mismatches, missing bytes, digest reuse, receipt-ID reuse, or inventory drift
fail closed. There is no network key lookup, algorithm fallback, quorum
degradation, or service-token identity fallback.

Receipts are durable evidence rather than bearer tokens. Reviewer and key
validity are half-open intervals evaluated at the signed decision time.
Existing audit and approval freshness rules still control promotion. A key or
registry rotation requires in-flight evidence to be reviewed again against the
new exact registry revision.

## Activation boundary

A later, separate owner-approved change must provide both agents' exact model,
runtime, instruction, tool, policy, workload-identity, and public-key
identities; prove positive and negative signing tests; set the registry
activation flag; and satisfy an independent owner-controlled activation gate.
This verifier implementation alone cannot self-grant reviewer authority.
Use [Foundation AI reviewer provisioning](FOUNDATION_AI_REVIEWER_PROVISIONING.md)
to prepare and verify those public inputs without importing a private key or
activating either reviewer.
