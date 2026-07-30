# RunPod Gate 1 Authorization v1

## Current verdict

`BLOCKED_INCOMPLETE_NOT_AUTHORIZED`

This package prepares the exact Gate 1 control plane without calling RunPod, reading a
credential, downloading a model or tokenizer, running inference or a benchmark, training,
serving, changing Railway, or deploying.

The proposal deliberately distinguishes a reviewed image tag from an immutable OCI image
digest. The tag is frozen because it is independently present in the platform and training
contracts. The digest remains null because no governed artifact proves it.

## Proven identities

The repository currently proves:

- Base: `meta-llama/Llama-3.1-8B` at
  `d04e592bb4f6aa9cfee91e2e20afa771667e1d4b`;
- Instruct: `meta-llama/Llama-3.1-8B-Instruct` at
  `0e9e39f249a16976918f6564b8830bc894c89659`;
- matching tokenizer revisions for each candidate;
- image tag `runpod/pytorch:1.0.2-cu1281-torch280-ubuntu2404`;
- prompt revision `dime-prompt-v1` and exact prompt/template hashes;
- tool revision `tools.v1` and exact catalog hash;
- Runtime Answer Routing revision `runtime-answer-routing-v1` and source hash;
- the current retrieval source hash, but not a named retrieval revision;
- deterministic decoding revision `decoding-v1`; and
- the frozen Base-versus-Instruct and model-artifact evaluation contract hashes.

The static validator re-hashes every bound repository artifact. A changed artifact or stale
binding fails closed.

## Unresolved required fields

The following values remain null or explicitly blocked because the repository does not prove
them:

- OCI container digest;
- Base serialization-profile checksum;
- Instruct serialization-profile checksum;
- named retrieval revision;
- merged context-compiler revision;
- maximum GPU hours;
- maximum spend in USD;
- independently protected credential-execution closure;
- RunPod permission attestation;
- independent review; and
- owner merge.

No alias, image tag, nearby source checksum, guessed budget, or reported external state may
substitute for one of these values.

## Owner-merge ceiling

A future exact reviewed head that closes every blocker may authorize only:

- `model_download`;
- `base_vs_instruct_inference`;
- `candidate_a_inference`; and
- `candidate_b_inference`.

This draft records those four actions as the maximum owner-merge scope, but their effective
authorization is currently false. Merging this incomplete draft cannot make an action
executable.

Benchmark scoring, answer-key access, locked evaluation, model selection, smoke or full
training, checkpoint resume, model serving, provider activation, Railway mutation, and
deployment remain explicitly false. Training and serving are outside Gate 1.

## Context capsule

The compact capsule at
`evidence/execution/dime-llm-v1-context-capsule/capsule.json` records only sanitized,
checksum-bound state. Production SHAs and unreconciled Foundation counts remain null. It
contains no secrets, raw Foundation records, raw evaluation cases, or answer keys.

## Validation

From `ml/dime-1.0`:

```bash
python scripts/validate_runpod_gate_1.py
pytest -q tests/test_runpod_gate_1_authorization_v1.py
```

The audit is repository-local and prints only states, counts, and gate booleans. It never
touches a provider or credential source.

## Next exact action

Produce a new exact reviewed head that replaces every missing identity and limit with
independently verifiable evidence, updates the checksums, passes the full governing suite and
secret scan, receives independent approval, and is owner-merged. Only then can a separate
operation-specific credential and RunPod preflight determine whether the four Gate 1 actions
are executable.
