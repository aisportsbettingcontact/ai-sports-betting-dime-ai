# LLM.md — model policy and routing

Authoritative model policy for every agent runtime in this repo. Summarized in AGENTS.md
and CLAUDE.md; this file wins on conflict.

## Approved models (current generation only)

| Provider     | Model            | Context / max out | Use                                                               |
| ------------ | ---------------- | ----------------- | ----------------------------------------------------------------- |
| anthropic    | `claude-fable-5` | 1M / 128K         | Default everywhere                                                |
| anthropic    | `claude-opus-5`  | 1M / 128K         | Alternate when Fable is unavailable or a second opinion is wanted |
| openai-codex | `gpt-5.6-sol`    | per catalog       | When using Codex (subscription auth)                              |

**We do not use older models in execution.** No claude-opus-4-x, sonnet, haiku, gpt-4/5.x
below 5.6, etc. If a task seems to want a cheaper model, use Fable 5 anyway — consistency
beats micro-savings here.

## Enforcement points

| Surface          | Mechanism                                                                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pi CLI           | `.pi/settings.json`: `defaultProvider: "anthropic"`, `defaultModel: "claude-fable-5"`, `enabledModels: ["claude-fable-5", "claude-opus-5", "gpt-5.6-sol"]` (Ctrl+P cycles only these) |
| Embedded runtime | `server/_core/piAgent.ts` `PI_AGENT_APPROVED_MODELS`; `resolvePiAgentModel()` throws on anything else unless `DIME_ALLOW_LEGACY_MODELS=1`                                             |
| Agent SDK runner | `DIME_AGENT_MODEL` env/default = `claude-fable-5` (`server/_core/dimeAgent.ts`)                                                                                                       |
| Claude Code      | Session model selection — keep Fable 5/Opus 5                                                                                                                                         |

## Auth model: subscription-first (IMPORTANT)

**Interactive execution runs on Claude subscription auth, not the Anthropic API.**
Claude Code (VS Code extension + Desktop) is the primary harness and authenticates via
the user's Claude Pro/Max subscription. The pi CLI does the same: `/login` → Anthropic
(Claude Pro/Max). No `ANTHROPIC_API_KEY` is required for any interactive work, and an
empty API balance must never block it.

API credentials are needed only for the non-interactive surfaces:

- server runtimes in production — `runPiChat`/`runPiAgent` (piAgent.ts),
  `runDimeAgent` (dimeAgent.ts), `createAnthropicClient` callers
- headless pipelines — `pi -p` in CI, `pi-share-hf` LLM review

## API credit budget (owner directive, 2026-08-01)

The funded `ANTHROPIC_API_KEY` balance is spent ONLY on:

1. **Dime AI Chat** — testing, auditing, training, deployment, or execution of the
   chat surface (`runPiChat`, `dime-chat.route.ts`, and their verification), and
2. **pi-share-hf LLM reviews** of collected sessions.

Everything else uses subscription auth or a model-free path (`pi:audit`, tsc,
vitest). **Unattended/CI model calls are paused**: the `pi Review` workflow is
`disabled_manually` — re-enable (`gh workflow enable pi-review.yml`) only on
explicit owner say-so. Before any action that would bill the key, state which
bucket it falls in; if neither, don't spend. Maximize intent: one reasoned call
beats ambient automation.

## Routing and credentials (API surfaces only)

Anthropic API traffic — Anthropic SDK (`server/_core/anthropicClient.ts`), Agent SDK
subprocess (`dimeAgent.ts`), embedded pi-agent-core (`piAgent.ts`), headless pi —
routes through an Anthropic-compatible gateway when configured:

- `ANTHROPIC_BASE_URL` — gateway host (overrides api.anthropic.com)
- `ANTHROPIC_AUTH_TOKEN` — gateway key, sent as `Authorization: Bearer` (wins over API key)
- `ANTHROPIC_API_KEY` — direct key, sent as `x-api-key` (fallback)

pi-ai resolves these in the same order natively; `resolvePiAgentModel()` applies the
baseUrl per model. Codex (`gpt-5.6-sol`) authenticates via Codex OAuth (`/login` in pi) or
`OPENAI_API_KEY` for the plain openai provider. Until Codex auth exists, pi startup prints
`Warning: No models match pattern "gpt-5.6-sol"` — expected; the pattern activates on
login. The id is real: verified in pi-ai's `openai-codex` catalog (alongside `gpt-5.6-luna`
and `gpt-5.6-terra`).

## Dime Chat provider

`DIME_CHAT_LLM_PROVIDER` is `"pi"` (owner-authorized unfreeze, 2026-08-01): production
chat serves through the embedded pi-agent-core runtime (`runPiChat`, claude-fable-5) on
the server's API credentials — a sanctioned credit bucket. The value is pinned by
`server/dimeChatProviderFreeze.test.ts` and `ml/dime-1.0/tests/test_repository_contract.py`,
so any silent change fails CI. The `"dime1"` provider remains inactive: its promotion is
owner-gated behind `ml/dime-1.0/docs/RELEASE_GATES.md` and has no trained checkpoint.
