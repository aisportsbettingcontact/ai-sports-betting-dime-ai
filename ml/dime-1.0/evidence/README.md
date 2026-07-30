# Dime 1.0 sanitized evidence index

This directory contains reviewed, public-safe evidence for Dime 1.0
infrastructure, audits, experiments, and release decisions.

Evidence is not authority by itself. Current contracts live in the root
README, `configs/platform_contract.json`, and `docs/`. Historical evidence
records what was observed under a specific source, data, runtime, and
experiment identity.

## Evidence classes

- [`audits/`](audits/) contains deterministic, reproducible program audits.
- [`benchmarks/`](benchmarks/) contains frozen, public-safe runtime contract
  benchmarks with deterministic local evidence.
- [`decisions/`](decisions/) contains structured, checksum-pinned decision
  records that remain non-authorizing until their named authority acts.
- [`infrastructure/`](infrastructure/) contains sanitized setup and runtime
  verification records.
- [`manifests/`](manifests/) is reserved for reviewed, sanitized manifest
  examples and publication records.
- [`rehearsals/`](rehearsals/) contains non-release rehearsal evidence.

The current local Phase 1 observability boundary is frozen at
[`manifests/phase1-observability-closure-v1/`](manifests/phase1-observability-closure-v1/).
It records production closure as blocked and authorizes no deployment or
traffic stage.

## Publication boundary

Evidence committed here must exclude:

- credential values or secret-manager references that reveal values;
- raw Pod IDs, volume IDs, endpoint URLs, or private network identifiers;
- private training records or provider data;
- locked cases, answers, rubrics, thresholds, or case-level results;
- raw user histories, chats, account data, or retrieval context;
- model or adapter weights;
- checkpoints, optimizer state, caches, logs, or workspaces; and
- absolute private paths unless the path itself is an approved public
  operational contract.

Permitted evidence includes sanitized configuration, exact public Git and
Hugging Face revision identifiers, record counts, aggregate results, hashes,
tool/runtime versions, pass/fail states, limitations, and non-release labels.

## Integrity

Each dated evidence directory should include:

1. a human-readable `README.md`;
2. machine-readable evidence where useful;
3. SHA-256 checksums for the machine-readable files; and
4. a clear statement of what the evidence does and does not prove.

Private source evidence may be represented by its SHA-256 hash without copying
the private file into GitHub. The private file's hash must be labeled
separately from the hash of any sanitized derivative.

No production dataset, locked suite, model release, or serving promotion is
approved in the current foundation.
