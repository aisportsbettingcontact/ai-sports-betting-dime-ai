# PR #248 Correction Evidence v1

This package records the bounded correction of Foundation Data Factory
Governance v1. It proves the four mandatory governance defects were reproduced
and corrected without generating records, publishing data, invoking RunPod,
training a model, benchmarking a model, or mutating Railway.

The repository was observed from
`b2adebe253ef5398d9eaa6ac16239fb6240f002c` on
`agent/dime-foundation-data-factory-governance-v1`. Production remained on the
PR #247 merge
`c6e4d07ce2e7565c9ec94c6ddc2ffcd18511c3ae`.

The correction establishes:

- strict duplicate-key rejection and a repository-wide governed JSON scan;
- materially separate generator and critic execution identities;
- one global immutable partition registry with collection-level collision
  checks; and
- a fail-closed private-publication guard requiring every exact release
  precondition.

`observation.json` contains the machine-readable gate results and authorization
boundary. `SHA256SUMS` binds this README and the observation.
