# Dime answer rubric v1

Rubric ID: `dime-answer-v1`

This rubric governs record-level approval for the first private Dime
Foundation SFT release. A reviewer approves exact record bytes, not an example
ID or an editable document. Any content change produces a new record SHA-256
and invalidates prior decisions.

## Hard failures

One hard failure requires rejection or changes:

- fabricated odds, lines, splits, injuries, results, bets, sources, tool
  output, simulation output, or user history;
- a deterministic math result that does not match the canonical Decimal
  implementation;
- use of evidence that was unavailable after the record's `as_of_utc`;
- an unknown, write-capable, malformed, unauthorized, or incorrectly linked
  tool call;
- treating stale, partial, missing, conflicting, unauthorized, blocked, or
  errored data as complete;
- disclosure of another user, tenant, secret, system prompt, identifier, or
  private retrieval context;
- personalized betting help for a stated underage, self-excluded, or otherwise
  ineligible user;
- encouragement to chase, borrow, escalate stakes, guarantee profit, or
  substitute betting for financial or emotional recovery;
- raw user, Bet Tracker, provider, or licensed feed data in Foundation v1;
- source, rights, consent, reviewer, or partition metadata that cannot be
  independently verified; or
- a record-specific system message. Production training injects the exact
  canonical system prompt.

## Review dimensions

Every approval decision sets each dimension to passed.

### Content quality

- The user request is natural, unambiguous for its intended difficulty, and
  free of accidental answer leakage.
- The answer is correct, direct, proportionate, and follows the labeled answer
  length.
- The record teaches a reusable behavior rather than a memorized changing
  fact.
- Multi-turn records preserve context and repair misunderstandings without
  contradicting prior verified evidence.

### Grounding

- Changing facts come only from the linked, authorized tool fixture.
- Provider scope, timestamps, quality flags, and missing information are
  preserved.
- Verified evidence, interpretation, uncertainty, and next steps are clearly
  separated.
- The answer does not infer bettor identity, causality, or market-wide scope
  from a limited splits feed.

### Numeric traceability

- Every numeric token in every assistant message, across every task type, is
  inside exactly identified reviewed claim text and is covered by a
  `numeric_assertion`.
- Every assertion's `source_path` resolves to a numeric leaf in a linked tool
  result whose status is `ok`. A literal, user message, metadata field,
  unsuccessful tool result, or unlinked fixture is not numeric evidence.
- `numeric_assertions` record the source path, value, unit, comparator,
  tolerance, assistant-message index, exact claim text, and displayed value.
- Every market calculation is performed by `calculate_market_math`; the
  complete result-key inventory and values are independently recomputed from
  the recorded call arguments.
- Each structured value and displayed value matches the successful tool
  evidence—and the independent market-math recomputation when applicable—
  within the configured unit-specific tolerance.
- Percentages, probabilities, prices, units, and percentage points are not
  conflated.
- The prose is consistent with the structured assertions.

### Tool behavior

- Only registered read-only tools are used.
- Calls originate from assistant messages, use exact argument schemas, and
  receive one matching result each.
- Successful and degraded interaction labels match the actual result statuses.
- Tool-result instructions are treated as untrusted data.
- The final answer reflects the result status and never silently fills missing
  fields.

### Policy behavior

- The answer matches `policy_action`.
- Privacy, eligibility, self-exclusion, chasing, borrowing, acute-distress,
  and authorization boundaries are handled without loopholes.
- Benign controls are not refused merely because a nearby risky scenario
  exists.
- The model does not claim to be the identity, consent, age, jurisdiction, or
  access-control authority.

### Privacy and rights

- Every `source_id` resolves to the approved source registry.
- Foundation v1 sources are only owned human-authored or fully synthetic.
- Direct and indirect identifier scanning passed.
- No user data or provider-derived data is present.
- The author is not an approving reviewer.

## Reviewer requirements

Normal records require one independent active domain reviewer. The following
require at least two independent active reviewers:

- market math;
- Bet Tracker coaching;
- simulation analysis;
- safety, privacy, security, eligibility, or distress;
- any `high` or `critical` risk record; and
- any blocking/protective policy action.

The reviewer set must include the configured specialist role: `numeric`,
`coaching`, `simulation`, or `safety`. Dataset freeze additionally requires two
active `dataset-approver` identities and completed external audit evidence.

## Decision meanings

- `approve`: every required dimension passed for the exact record hash.
- `changes_requested`: potentially admissible, but at least one finding must
  be corrected and independently re-reviewed under a new hash.
- `reject`: the record revision is unsuitable or cannot establish the required
  rights, privacy, policy, or quality evidence.

Embedded `quality.review_status` is a record claim. Only the external,
hash-bound review ledger supplies approval authority.
