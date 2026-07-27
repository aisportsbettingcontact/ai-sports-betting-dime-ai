# Dime tool and canonical market contracts

## Status and purpose

This proposed Foundation v1 contract bundle defines the model-visible requests
and production-shaped responses for Dime's seven read-only tools. It is
GitHub-only governance and validation material. It does not connect a provider,
read a private account, authorize training, publish an artifact, deploy a
service, or activate serving.

The bundle closes two previously open boundaries: governed records can no
longer store free-form market names, and a generic response envelope is no
longer sufficient to admit arbitrary tool data.

## Trust boundaries

The model proposes only a registered tool name and schema-valid model-visible
arguments. A future authenticated broker remains responsible for tenant and
subject identity, entitlement scope, provider authorization, policy decisions,
resource ownership, approved simulation implementation, credentials, and
serving endpoints. None of those server-owned values can be supplied through
`tools/tools.v1.json`.

All tracked examples are synthetic. Provider payloads and database column
shapes are deliberately not part of this contract.

## Canonical market keys

`tools/market_keys.v1.json` is the only Foundation market vocabulary. A stored
key has exactly this stable identity:

```json
{"market_type":"spread","period":"full_game"}
```

The ordered v1 catalog contains game-level `moneyline`, `spread`, and `total`
only, all for `full_game`. Event identity is separate. Quotes, line values,
prices, timestamps, books, providers, sources, entitlement scope, account
scope, credentials, traces, and policy decisions are mutable or contextual and
must never appear in a market key.

Input aliases such as `ml`, `point_spread`, and `over_under` are documented for
a future boundary normalizer. Governed records must store the canonical value,
never an alias. Player/team propositions, period markets, derivatives, and
exotics are deferred until their stable dimensions and selection semantics are
separately reviewed; there is no free-form escape hatch. Catalog entries are
ordered, non-deprecated, provider-neutral, and closed by
`schemas/market_keys.schema.json`.

## Requests and server-owned fields

The request catalog remains exactly:

1. `get_game_context`
2. `get_current_odds`
3. `get_odds_history`
4. `get_market_splits`
5. `calculate_market_math`
6. `get_bet_tracker_summary`
7. `run_simulation`

Odds, history, splits, and probability-CLV requests use the structured market
key. History has bounded windows, a maximum of 500 returned snapshots per
request, and bounded cursors. Market-splits entitlement is injected by the
server. Bet Tracker exposes only permitted aggregate filters; authenticated
self scope and the authoritative as-of time are injected by the server.
Simulation draws are bounded from 1,000 through 1,000,000, while the approved
implementation/version remains server-selected. Market math is an exact
operation union and never accepts an expression or executable input. No tool
can write data or retrieve another user's conversation history.

The loader recursively examines executable JSON-Schema property names,
including nested `properties`, `items`, composition branches, and `$defs`.
Tenant, user, subject, account, provider, entitlement, policy, authoritative
time, simulation implementation, and credential fields therefore fail bundle
loading at any depth; descriptions are not treated as executable fields.

## Common response envelope

Every result is a closed `dime-tool-response-v1` object containing:

- exact tool and schema versions plus `tool_call_id`;
- one of `ok`, `partial`, `not_found`, `stale`, `unauthorized`,
  `blocked_by_policy`, or `error`;
- canonical `as_of_utc` and a status-appropriate `valid_until_utc`;
- bounded `source_ids`, explicit `source_scope`, and exact `data`;
- bounded `quality_flags`, closed machine-readable `warnings`, and `trace_id`.

`ok` requires nonempty exact data. `partial` requires a `partial` quality flag.
`stale` requires a `stale` quality flag and cannot label an odds quote current.
`not_found`, `unauthorized`, `blocked_by_policy`, and `error` require empty
data and a null validity endpoint. Invalid validity intervals fail closed.
Provider-backed or private aggregate data requires source identity. Warnings
are not free text: the only v1 codes are `current_quote_unavailable` and
`stale_pregame_quote`. Trusted UI code may map those codes to prose later.
They are also bound to exact response semantics: non-odds tools and complete
current odds require no warning; missing current odds require
`current_quote_unavailable`; fully stale odds require `stale_pregame_quote`;
and partial odds require that stale warning if and only if at least one quote
is stale. Unauthorized, policy-blocked, and error responses carry no warning.
Unknown, missing, extra, or contradictory warning states fail closed.
Credentials, identifiers, filesystem paths, provider text, and tracebacks are
not schema-valid under any response status.

Registry scope and freshness declarations are executable. Game, odds,
history, splits, and simulation use `provider_scoped`; market math uses
`deterministic`; Bet Tracker uses `authorized_private_aggregate`.
Deterministic scope has an empty provider universe and uses `as_of_utc` only,
with a null validity endpoint. Successful provider/private/simulation results
require source identity and a non-reversed validity interval. Failures always
use a null validity endpoint.

The common envelope is only the first validation layer. The tool name selects
one exact data schema under `schemas/tool_responses/`; a payload valid for one
tool is not admitted as another tool's payload.

For every nonempty result, the validator also retains and compares the
originating schema-valid arguments. Event, market, requested fields, time
window, normalized math inputs, filters, draws, and seed cannot drift between
call and result. Omitted game fields deterministically mean all six registered
field groups; omitted current-odds mode means `pregame`; omitted history limit
means 500; omitted Bet Tracker filters mean `{}`.

## Exact data contracts

- Game context acknowledges requested fields, returns a canonical event
  reference, a closed fact allowlist, and explicit missing fields.
- Current odds binds event, canonical market, phase, entitled provider scope,
  selections, Decimal-string lines, prices, observation time, quote status,
  and a required source ID on every quote. Every quote source must be declared
  by the envelope.
- Odds history binds requested/returned windows, a maximum of 500
  chronological snapshots, stable cursor state, truncation, and gap flags.
  Every snapshot source must be declared by the envelope, and returned bounds
  cannot escape explicit requested bounds or exceed the envelope time.
- Market splits binds provider universe, methodology, observation time,
  sample-size knowledge, and coverage to a selection-keyed `splits`
  collection. Each unique selection has bounded Decimal-string ticket and
  handle percentages plus an optional Decimal-string line and valid American
  price. A known sample contains at least one observation; an unavailable
  sample is represented only by `sample_size: null` and
  `sample_size_known: false`. `complete_market` coverage requires both
  percentage columns to total 100 within 0.000001 percentage points.
  `partial_market` requires explicit `partial_market_coverage` disclosure.
- Market math binds an operation, `dime-market-math-v1`, normalized inputs,
  and operation-specific Decimal-string output. Every successful response is
  independently recomputed from the bound inputs with the canonical
  `market_math.py` implementation and governed `0.000000001` tolerance,
  including development-evaluation fixtures.
- Bet Tracker returns authenticated-self aggregates only, including filter
  acknowledgment, coverage, count, stake/result/price-quality aggregates, and
  sample disclosure. Raw bets, notes, names, emails, account identifiers, and
  cross-user identifiers are not schema-valid. Successful data requires at
  least one bet, positive stake, coverage provably inside explicit filter
  bounds, and ROI equal to profit divided by stake within the governed
  `0.000000001` tolerance. Zero matches use `not_found` with empty data.
- Simulation binds the event, server-selected version, immutable input and
  artifact hashes, bounded draws, seed, Decimal-string distribution,
  calibration version, run time, and limitations.

JSON numbers remain bounded request inputs where calculation requires them.
Computed decimal output is stored as a finite canonical Decimal string so
serialization does not silently change its value.

Externally visible schema failures contain only a static contract label,
governed schema path, and static validator category. They never include the
invalid value, instance mapping key, provider identifier, credential,
filesystem path, or `jsonschema` instance message.

Semantic validation uses `Decimal`: probabilities are in `[0,1]`, probability
CLV is in `[-1,1]`, decimal odds exceed 1, split percentages are in `[0,100]`,
and simulation quantiles are ordered. American odds are integers in
`[-100000,-100]` or `[100,100000]`. ROI arrays have equal lengths and positive
total stake; CLV entry/closing maps have identical selections and include the
backed selection. Quote/snapshot/split/coverage/simulation times cannot exceed
their envelope time, windows cannot reverse, and history bounds, ordering, and
cursor claims must agree.

## Loader, hashing, and failure behavior

`dime_ai.tool_contracts.load_tool_contracts()` reuses the hardened Foundation
descriptor reader. It opens each fixed registered path beneath validated
directory descriptors, uses `O_NOFOLLOW`, `O_CLOEXEC`, and final-file
`O_NONBLOCK`, checks that same descriptor with `fstat`, and reads only that
descriptor. Traversal, symlinks, FIFOs, directories, duplicate JSON keys,
non-finite JSON values, remote schema references, path/hash/version mismatch,
and seven-tool parity mismatch fail closed with bounded errors.

The deterministic bundle algorithm creates one canonical 13-entry JSON
manifest with
`schema_version=dime-tool-contract-bundle-manifest-v1`. Its entries are the
request catalog; market catalog and its governing schema; response registry
and its governing schema; response envelope; and all seven per-tool data
schemas in canonical tool order. Its entries contain the fixed ordered
governed paths and the SHA-256 of each file's raw bytes. JSON is
serialized with sorted keys, compact separators, UTF-8, no NaN, and one final
newline; the bundle SHA-256 is the hash of those manifest bytes. The Foundation
build contract carries `tool_contract_bundle_sha256`, while the taxonomy
hash-binds the market catalog. A governed-byte change therefore changes its
file identity and aggregate identity and cannot be paired with stale approval
evidence.

## Versioning and production prerequisites

Versions are exact, not ranges. Any incompatible request, envelope, registry,
market, or data-schema change requires a reviewed version and updated hashes.
Deprecation must be explicit; v1 has no deprecated canonical market.

Production still requires authenticated broker implementation, provider rights
and entitlements, source/freshness thresholds, privacy and retention policy,
simulation approval/calibration, observability, compatibility and pagination
behavior, load and failure testing, independent review, release evidence, and
an explicit platform authorization change. The current platform contract
continues to block training, locked evaluation, publication, serving, and
provider activation.
