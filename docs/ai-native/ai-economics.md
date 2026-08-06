# AI usage and outcome economics (v1)

Token-maxing per the source: "Maximizing token usage, not headcount… willing to run an
uncomfortably high API bill" — adopted here strictly as **outcome-adjusted** spend:
`verified leverage = value of verified outcome / total workflow cost`. Spend more when
marginal verified value exceeds marginal cost and risk; otherwise redesign or stop.

## Current state (VERIFIED, audit 2026-07-28)
- No USD measurement exists anywhere in the product: the only USD field
  (`server/_core/dimeAgent.ts:92` `totalCostUsd`) is returned and never persisted; the chat
  path logs raw token usage to console only; the WC2026 route persists tokens/credits
  (`dime_request_audit`/`dime_response_audit`) but no USD.
- Cost is *controlled* (owner-only entitlement, 30 req/min cap) but not *measured*. UNKNOWN
  whether the external gateway dashboard covers it; `references/ai-gateway-setup.md` cited in
  code does not exist.

## Instrumented this session
- `workflow_cost` artifact (envelope `cost` block: inputTokens, outputTokens, usd, latencyMs,
  retries) attached to outcome artifacts via `links.outcomeRef`.
- Query `costPerVerifiedOutcome()` (`shared/loop/queries.ts`): totals + USD per verified
  outcome, with honest states (`not_measured` with no cost artifacts; `incomplete` when spend
  exists but zero verified outcomes — "leverage cannot be assessed"). Executed in tests.

## This session's own spend (honest accounting)
- This program ran ~400k+ subagent tokens (3 exploration agents) plus the main session.
  Exact USD is UNKNOWN from inside the session (no gateway meter available here) — recorded
  as a limitation, not estimated. The verified outcomes it purchased are enumerated in
  `verification-report.md`.

## Budgets and floors (proposed, owner decision — not yet enforced)
- Quality floor: no cost-driven downgrade may violate a deterministic gate; graders never
  override invariants (tested).
- Budget breach behavior: surfaces as a flagged state on the economics query — never a
  silent absorb, never an auto-shutoff of settlement-critical loops.
- Next emitters (queued): `/api/dime/chat` stream.done handler → `workflow_cost` row with a
  price table; model-runner spawn wrapper → cost per projection run; both need owner review.
