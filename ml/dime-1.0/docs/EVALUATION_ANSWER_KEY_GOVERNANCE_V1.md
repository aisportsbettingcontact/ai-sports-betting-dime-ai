# Evaluation Answer-Key Governance v1

## Status

This package is a proposed, non-executing control plane. Before the owner merges the
exact independently reviewed head, it has no authorization effect. It contains schemas,
policy, a static validator, tests, and checksum evidence only.

It contains no semantic evaluation cases, answer keys, model outputs, credentials, provider
configuration, or executable benchmark authorization.

## Exact owner-merge boundary

Owner merge of the exact reviewed head may authorize only:

- private answer-key generation;
- private answer-key publication;
- training, model-runner, and scorer separation; and
- a locked-evaluation consumption ledger.

Owner merge does not authorize model download, RunPod inference, benchmark execution, model
training, model serving, or Railway mutation. Every one of those gates remains explicitly
false. In particular, a model runner still requires a separate benchmark-execution gate
before it may access any model endpoint.

## Closed identity matrix

| Identity | Allowed reads | Allowed writes | Explicitly excluded |
| --- | --- | --- | --- |
| Training | Private Foundation only | None | All semantic cases, keys, outputs, scores, ledgers, and model endpoints |
| Model runner | Semantic cases and their manifests | Blinded model outputs | Foundation, answer keys, scores, ledgers, and current model-endpoint access |
| Scorer | Answer keys, key manifests, and blinded outputs | Evaluation scores | Foundation, semantic cases, ledgers, and model endpoints |
| Locked controller | Semantic manifests, key manifests, and the consumption ledger | Consumption ledger | Raw cases, keys, outputs, scores, Foundation, and model endpoints |

For each identity and access mode, the allow and deny lists are disjoint and classify the
entire resource universe exactly once. The semantic validator rejects added, removed, or
reclassified resources.

No identity credential is provisioned by this package.

## Private answer-key lifecycle

Every private answer-key record must:

1. bind to an exact semantic repository revision and manifest checksum;
2. bind to the corresponding semantic record checksum;
3. omit copied semantic case content;
4. use the strict private answer-key schema;
5. record separate generator and reviewer identities and immutable receipts;
6. pass independent review, checksum verification, private-repository access-policy review,
   and secret scanning; and
7. publish only to the separate private answer-key repository for its evaluation layer.

Semantic-case and answer-key repository identities are disjoint across all four layers.
The public control-plane repository never receives private records.

## Runner and scorer blinding

Runner outputs carry only a random blind identifier, semantic-record checksum, assistant
output, normalized tool-state checksums, and an output receipt. Provider identity, model
identity, semantic case content, and answer-key material are prohibited.

The scorer can read answer keys and blinded outputs, but it cannot read the Foundation,
semantic cases, or a model endpoint. This prevents the scorer from invoking or modifying the
candidate it judges.

## Locked evaluation

Each exact locked semantic revision and answer-key revision receives a maximum of one
authorized execution. The first attempt consumes the allowance, whether it succeeds or
fails. A terminal, append-only receipt must bind the runner identity, scorer identity,
blinded-output manifest, and result manifest. Retry is explicitly false.

This package initializes no ledger and executes no locked evaluation. The schema and
validator only make the future single-use record fail closed.

## Static validation

From `ml/dime-1.0`:

```bash
python scripts/validate_evaluation_answer_key_governance.py
pytest -q tests/test_evaluation_answer_key_governance_v1.py
```

The audit reports only sanitized counts, gate states, and validation errors. It does not read
credentials, private repositories, semantic cases, answer keys, model endpoints, or Railway.

## Remaining gates

Independent approval and owner merge of the exact reviewed head remain required. After merge,
private repositories, immutable revisions, access policies, identities, publication
credentials, and audit receipts still have to be provisioned and independently verified.
Model access and every evaluation execution remain subject to their own separate gates.
