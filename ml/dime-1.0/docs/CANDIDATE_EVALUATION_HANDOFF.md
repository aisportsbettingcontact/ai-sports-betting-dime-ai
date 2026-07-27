# Candidate-to-locked-evaluator handoff

This contract closes the boundary between Dime training and locked evaluation.
It defines how an unpromoted adapter candidate can be evaluated without
publishing it to the production Hugging Face model repository and without
exposing locked cases to training.

The project is currently `foundation_only`. This document specifies a required
future control; it does not authorize a transfer, locked evaluation, model
publication, or serving activation.

## Why this boundary exists

The production repository,
`taileredsports/Llama-3-Dime-1.0`, may contain only a serving-approved adapter.
A new candidate cannot receive a production Hugging Face commit SHA until
after locked evaluation and release review pass. Requiring that SHA before
locked evaluation would create an impossible and unsafe circular dependency.

The candidate therefore enters the isolated evaluator through a controlled,
one-way, content-addressed transfer. The currently promoted Hugging Face
adapter revision remains available to the evaluator only as the champion
comparison control. It is not the transport for the new candidate.

## Boundary diagram

```text
training workspace                              restricted evaluator
------------------                              --------------------
completed_unreviewed candidate
├── adapter_model.safetensors
├── adapter_config.json
└── training_manifest.json
        │
        │ hash and authorize exact bytes
        ▼
one-way transfer control ──────────────────────► fresh evaluator input
                                                 read-only after receipt
                                                 separate cache/filesystem
                                                 no training volume mount
                                                        │
HF locked suite ────────────────────────────────────────►│
HF Meta base / promoted champion control ──────────────►│
                                                        ▼
                                              restricted full results
                                                        │
                                                        ▼
                                      sanitized aggregate summary only
                                                        │
                                                        ▼
                                     candidate input securely destroyed
```

No raw locked content, case-level output, private threshold, rubric, answer,
prompt, or trace may travel in the reverse direction.

## Roles and credential separation

| Actor | May read | Must not receive |
|---|---|---|
| Training Pod | Approved foundation and development revisions, gated Meta base, current promoted adapter | Locked-evaluator, locked-publisher, or release-publisher credentials |
| Transfer operator | Exact candidate source and transfer record needed for the approved copy | Locked dataset credential or raw locked results |
| Isolated evaluator | Transferred candidate, pinned Meta base, locked suite, current promoted champion when one exists | Training or release-publisher credentials; shared training filesystem/cache |
| Release workspace | Sanitized aggregate evidence and exact candidate bundle after all gates pass | Locked credential, raw cases, or restricted full results |

The transfer authority is not a Hugging Face publishing credential. It cannot
make the candidate visible in the production model repository. The evaluator's
`dime-locked-evaluator-read-v1` token reads the locked suite, pinned Meta base,
and an existing promoted champion control; it does not fetch the new candidate.

## Required transfer records

The handoff is an append-only three-record sequence. No record is rewritten to
claim a later event:

1. `transfer_authorization` is created and approved before bytes move.
2. `receiver_receipt` is created after destination verification.
3. `cleanup_event` is created after restricted-copy cleanup.

Each later record references the SHA-256 of every earlier record. The three
records remain separate so approval cannot claim a receipt or cleanup that has
not happened yet.

Before any candidate bytes enter the evaluator, the reviewer-owned
`transfer_authorization` must bind all of the following:

- a unique transfer ID and evaluator run ID;
- the exact experiment ID;
- full source Git commit `S`;
- full training-authorization Git commit `A`;
- full evaluator implementation Git commit;
- approved locked-suite opaque reference, manifest SHA-256, and expected case
  count;
- candidate `adapter_model.safetensors` SHA-256;
- candidate `adapter_config.json` SHA-256;
- generated `training_manifest.json` SHA-256;
- a canonical SHA-256 over the ordered transfer inventory;
- exact file names, byte lengths, and individual SHA-256 values;
- authorization reference, approver identity, and normalized UTC approval
  time;
- destination environment's opaque identifier and storage classification;
- the required receiver controls, including no training-volume or shared-cache
  mount; and
- the required cleanup policy and retention class.

After the copy, `receiver_receipt` binds:

- the transfer-authorization SHA-256;
- the destination's recomputed file names, lengths, and SHA-256 values;
- the destination-control verification results;
- the read-only input transition; and
- the normalized UTC receipt time and verifier identity.

After cleanup, `cleanup_event` binds:

- the transfer-authorization and receiver-receipt SHA-256 values;
- the exact restricted candidate input and scratch scope covered;
- cleanup result and any policy-approved exception;
- confirmation that required restricted audit evidence was preserved; and
- the normalized UTC completion time and verifier identity.

The transfer inventory is closed-world. For the initial contract it contains
exactly:

```text
adapter_model.safetensors
adapter_config.json
training_manifest.json
```

Any tokenizer, prompt, generation, or other runtime override must already be
bound through the training manifest and release contract. Adding bytes to the
locked-evaluation input requires a reviewed contract revision before the
locked suite is opened.

The transfer records contain hashes and operational metadata only. They
contain no secret, raw training record, locked case, case ID, answer, private
rubric, threshold, prompt, or result.

## Transfer protocol

1. Training finishes atomically at
   `/workspace/runs/<experiment-id>/adapters/final/` and labels the output
   `completed_unreviewed`.
2. After `training_manifest.json` is final, the training process hashes the
   three allowed candidate files and records their identities in separate
   sanitized run evidence. The training manifest cannot contain its own final
   file hash.
3. Human review confirms the experiment, source/authorization chain, data
   revisions, base revision, configuration, manifest state, and candidate
   hashes. It validates the training manifest's internal provenance fields
   separately, then creates and approves an immutable
   `transfer_authorization`.
4. An authorized operator copies exactly the closed-world inventory through an
   approved one-way transport into a new restricted evaluator input directory.
5. The evaluator recomputes every file length and SHA-256 before loading any
   candidate byte. Missing, extra, renamed, linked, non-regular, or mismatched
   content fails closed before the locked suite is opened. Successful
   verification creates an immutable `receiver_receipt`; it does not modify
   the authorization record.
6. After receipt verification, the evaluator input becomes read-only for the
   duration of the run. It is never mounted back into training, development,
   serving, or a general release workspace.
7. The evaluator runs the candidate and, when applicable, the exact promoted
   champion against the same approved locked-suite snapshot and frozen
   evaluator contract.
8. Only an approved, non-reconstructable
   `dime-release-evaluation-summary-v1` aggregate may leave. It binds the same
   candidate hashes, evaluator run ID, restricted report hash, human-review
   record hash, locked-suite identity, comparison reports, and quality-slice
   report. Transfer-record identities remain in restricted audit storage; the
   release summary does not expose or claim fields absent from its executable
   schema.
9. The restricted candidate copy and evaluator scratch state are securely
   destroyed according to the approved retention policy after the authorized
   aggregate and required restricted audit evidence are durably recorded.
   Cleanup creates an immutable `cleanup_event`; it does not modify either
   earlier record.
10. Publication may begin only after locked evaluation, human review, release
    authorization, and every other release gate pass. The publisher then
    publishes the same candidate bytes and captures their first production
    Hugging Face commit SHA.

An implementation must make steps 4, 5, 6, 8, and 9 auditable and fail closed.
Until that implementation and its operator procedure are reviewed, locked
evaluation remains unauthorized.

## Failure and recovery rules

Abort before opening the locked suite when:

- the transfer or evaluator run ID is reused;
- a required approval or identity is absent;
- source or authorization commits are not full immutable SHAs;
- candidate hashes differ between sanitized run evidence, transfer
  authorization, and receiver receipt;
- the training manifest's internal provenance differs from the authorized
  experiment, source, data, base, prompt, tool, schema, config, decoding, or
  runtime identities;
- an extra, missing, symlinked, renamed, or non-regular file appears;
- the destination can mount the training volume or shared model-development
  cache;
- a destination credential exceeds the evaluator access matrix;
- the candidate input cannot be made read-only after receipt; or
- the cleanup control cannot be scheduled and audited.

If transfer fails, create a new transfer ID and fresh destination. Never repair
or replace bytes in a verified evaluator input directory. A failed or rejected
candidate is never uploaded to the production model repository.

## Evidence and retention

GitHub may retain only the reviewed contract, sanitized aggregate results,
content hashes, opaque references, and non-sensitive decision records.
Restricted storage retains the full locked report and human-review record
under the locked-evaluation retention policy. The training workspace retains
the original candidate as governed run output until its review and recovery
retention decisions are complete.

The evaluator's copied candidate is temporary. Its destruction does not delete
the governed training output, and it does not authorize deleting a promoted
release, source revision, approved dataset, or required audit record.

## Implementation acceptance criteria

A future implementation is acceptable only when tests prove:

- no production Hugging Face candidate revision is required before evaluation;
- exact candidate bytes are bound at sender and receiver;
- transfer inventory is closed-world;
- training cannot access locked data;
- the evaluator cannot write to the promoted model repository;
- no shared training volume or cache is mounted in the evaluator;
- only the sanitized aggregate can cross back;
- cleanup is recorded without erasing required restricted audit evidence; and
- the exact evaluated bytes are the bytes later submitted to release review.

See also:

- [Platform ownership](PLATFORM_OWNERSHIP.md)
- [Hugging Face registry](HUGGING_FACE_REGISTRY.md)
- [RunPod workspace and runbook](RUNPOD_WORKSPACE_RUNBOOK.md)
- [Release gates](RELEASE_GATES.md)
