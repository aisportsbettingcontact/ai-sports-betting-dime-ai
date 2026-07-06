# Anthropic Advisor Tool Reference (Beta)
## Saved: 2026-07-06T16:55:00Z from user-provided docs

## Key Facts
- Beta header: `advisor-tool-2026-03-01`
- Tool type: `advisor_20260301`
- Name: must be `"advisor"`
- The executor model calls the advisor like any other tool
- Advisor runs server-side, no extra round trips needed
- Advisor sees full conversation transcript

## Model Compatibility (Executor → Advisor)
- Claude Fable 5 (claude-fable-5) → can only advise itself
- Claude Mythos 5 (claude-mythos-5) → can only advise itself
- Claude Haiku 4.5 → Fable 5, Mythos 5, Opus 4.8/4.7/4.6, Sonnet 4.6
- Claude Sonnet 4.6 → Fable 5, Mythos 5, Opus 4.8/4.7/4.6, Sonnet 4.6
- Claude Sonnet 5 → Fable 5, Mythos 5, Opus 4.8/4.7
- Claude Opus 4.6 → Fable 5, Mythos 5, Opus 4.8/4.7/4.6
- Claude Opus 4.7/4.8 → Fable 5, Mythos 5, Opus 4.8/4.7

## Tool Parameters
- type: "advisor_20260301" (required)
- name: "advisor" (required)
- model: advisor model ID (required)
- max_uses: integer (optional, per-request cap)
- max_tokens: integer (optional, min 1024, caps advisor output)
- caching: {"type": "ephemeral", "ttl": "5m" | "1h"} or null

## Usage/Billing
- Advisor tokens billed at ADVISOR model rates
- Top-level usage fields = executor tokens only
- Advisor tokens in usage.iterations[] with type: "advisor_message"
- Typical advisor output: 400-700 text tokens, 1400-1800 total with thinking

## TypeScript Quick Start
```typescript
const response = await client.beta.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 4096,
  betas: ["advisor-tool-2026-03-01"],
  tools: [
    { type: "advisor_20260301", name: "advisor", model: "claude-opus-4-8" }
  ],
  messages: [{ role: "user", content: "..." }]
});
```

## Key Behaviors
- Streaming: advisor sub-inference does NOT stream (pause then full result)
- pause_turn: response can end with stop_reason "pause_turn" while advisor pending
- Multi-turn: include advisor_tool_result blocks in message history
- If removing advisor tool, MUST also strip advisor_tool_result blocks from history

## Cost Control
- max_uses caps calls per request
- For conversation-level caps: count client-side, remove tool when ceiling reached
- Caching breaks even at ~3 advisor calls per conversation

## Current Dime WC2026 Status
- Route uses model: "claude-fable-5" (can only advise itself per compatibility table)
- This means advisor tool CANNOT be used with claude-fable-5 as executor + different advisor
- To use advisor pattern: would need to change executor to claude-sonnet-4-6 or similar
- OR: use claude-fable-5 as both executor AND advisor (self-advising)
