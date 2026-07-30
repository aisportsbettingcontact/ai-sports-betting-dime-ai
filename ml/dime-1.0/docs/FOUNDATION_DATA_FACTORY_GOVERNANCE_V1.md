# Foundation Data Factory Governance v1

## Boundary

This change implements the Foundation Data Factory governance and conversion
machinery. It contains no private Foundation records and performs no external
data or model operation.

Before owner merge of the exact reviewed head, the contract is
`PROPOSED_NON_EXECUTING` and has no authorization effect. Owner merge may
authorize only:

1. Codex private record generation.
2. Independent record critique.
3. Deterministic record validation.
4. Private evaluation semantic-case generation.
5. Private Hugging Face publication only after every exact release precondition
   passes.

It does not authorize model download, RunPod inference, training, benchmark
execution, Railway mutation, tracing, or route activation.

## Governed authorship

Teacher-generated records are a distinct, private source class. They may not
be labeled `synthetic`. Every record binds:

- the exact generator and independent critic identities and model revisions;
- generation and critique receipt hashes;
- an approved independent-review decision with zero unresolved material
  findings;
- an immutable source-packet reference or an explicitly synthetic behavioral
  source;
- rights, timestamps, route, tool, curriculum, and uncertainty fields; and
- pre-prose partition identity.

The generator and critic may use the same pinned model revision, but their
actor IDs, prompt revisions, prompt hashes, execution receipts, context
hashes, and responsibilities must all differ. Placeholders, movable `latest`
revisions, all-zero receipts, nominal-only critic identities, self-review, and
pending rights fail conversion.

## Scenario-level partitioning

The train/validation split is assigned before substantive prose generation
through `configs/foundation_partition_registry_v1.json`. The frozen algorithm
hashes:

```text
split_assignment_seed + ":" + scenario_family_id
```

SHA-256 bucket `0 mod 10` is validation; all other buckets are train. The
global registry binds every non-null scenario, template, source event,
conversation, quantitative scenario, and combined entity-set/temporal-bucket
identity to one shard and split. Collection validation rejects cross-shard or
cross-split collisions, seed or algorithm drift, stale registry entries, and
record split disagreement.

## Governed JSON and release publication

All governed JSON under configs, schemas, evidence, tools, and authoring
templates is parsed with duplicate-key rejection. Authorization-bearing
documents never use last-value-wins semantics.

Private publication is not unconditional. The pure publication guard accepts
only an exact 2,400-authoring/2,400-trainer release with zero unconverted or
extra records, pending rights, material findings, exact duplicates,
cross-split collisions, evaluation contamination, conversion mismatches, or
silent truncations, plus a verified release checksum.

## Structured tool supervision

The authoring boundary supports exactly nine expected execution states:

```text
skipped
success
empty
failure
timeout
stale
malformed
conflicting
rejected
```

Executed steps must contain a response that passes the existing tool-response
contract and matches the originating tool, call ID, arguments, status class,
and authoritative observation timestamp. `skipped` steps cannot contain a
response.

## Deterministic conversion

`src/dime_ai/foundation_data_factory.py` converts approved authoring records to
the existing `dime-sft-foundation-v1` trainer schema. It preserves source and
teacher lineage, numeric assertions, curriculum labels, tool calls, tool
results, and the exact final response.

Encoding uses the existing assistant-only chat formatter:

- system and user tokens are masked;
- tool-call tokens emitted by the assistant are supervised;
- tool-result tokens are masked;
- assistant outcome tokens are supervised; and
- over-length records are rejected instead of silently truncated.

The release requirement remains exact: 2,400 authoring records must produce
2,400 trainer records, with zero unconverted records, extras, pending rights,
hash mismatches, or silent truncations.

## Validation

From `ml/dime-1.0`:

```bash
PYTHONPATH=src .venv/bin/python scripts/validate_foundation_data_factory.py
PYTHONPATH=src .venv/bin/python scripts/validate_governed_json.py
PYTHONPATH=src .venv/bin/python scripts/validate_foundation_control.py
PYTHONPATH=src .venv/bin/pytest -q
```

A valid pre-merge report still states `executing: false`,
`generated_record_count: 0`, `published_record_count: 0`, and
`external_invocation_count: 0`.
