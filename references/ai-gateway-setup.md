# Vercel AI Gateway — Claude routing runbook

How every Claude surface in this repo (server SDK calls, Dime chat SSE, the Claude
Agent SDK, and the Claude Code CLI on a dev machine) routes through the
[Vercel AI Gateway](https://vercel.com/docs/ai-gateway) — for traffic/token
monitoring in the AI Gateway Overview and traces in Vercel Observability.

The gateway exposes an **Anthropic-compatible endpoint**, so routing is purely
an environment-variable change. No code changes are needed to switch between
direct Anthropic and the gateway.

## Environment variables

| Variable | Direct Anthropic | Via AI Gateway |
|---|---|---|
| `ANTHROPIC_API_KEY` | your Anthropic key | **empty string** (must not carry a value) |
| `ANTHROPIC_BASE_URL` | unset | `https://ai-gateway.vercel.sh` |
| `ANTHROPIC_AUTH_TOKEN` | unset | your AI Gateway API key |

Rules that make this work everywhere:

- `ANTHROPIC_AUTH_TOKEN` is sent as `Authorization: Bearer …`; `ANTHROPIC_API_KEY`
  as `x-api-key`. The API rejects requests carrying **both** headers.
- Claude Code (and therefore the Agent SDK subprocess) checks `ANTHROPIC_API_KEY`
  **first** — set it to an empty string when using the gateway token, don't just
  leave your old key in place.

## Where each surface picks this up

| Surface | File | Mechanism |
|---|---|---|
| Server SDK calls (`invokeClaude`/`streamClaude`) | `server/_core/claude.ts` → `server/_core/anthropicClient.ts` | `createAnthropicClient()` resolves auth token → api key, plus `baseURL` |
| Dime chat SSE (`POST /api/dime/chat`) | `server/dime-chat.route.ts` | same factory; 500s with a clear message if neither credential is set |
| Agent SDK tasks | `server/_core/dimeAgent.ts` | `agentEnv()` injects the vars into the Claude Code subprocess spawned by `query()` |
| Claude Code CLI (dev machine) | your `~/.zshrc` / `~/.bashrc` | export the three vars per the table above, `claude /logout` first |

`anthropicClient.ts` prefers `ANTHROPIC_AUTH_TOKEN` when both credentials are
set, so a stale `ANTHROPIC_API_KEY` can't produce the dual-header rejection —
but keep it empty anyway for the CLI/Agent SDK path.

## Agent SDK usage

```ts
import { runDimeAgent } from "../server/_core/dimeAgent";

const { result, totalCostUsd, numTurns } = await runDimeAgent({
  prompt: "Summarize how the projections feed normalizes MLB odds.",
  // allowedTools defaults to read-only: Read, Glob, Grep, WebSearch, WebFetch
  // pass ["Read", "Edit", "Bash"] etc. to allow writes — deliberately opt-in
  cwd: process.cwd(),
});
```

The Agent SDK (`@anthropic-ai/claude-agent-sdk`) spawns Claude Code as a
subprocess and drives the full agent loop (built-in file/search/bash tools).
Use it for multi-step tool-using tasks; keep chat-style token streaming on the
existing `streamClaude()` / dime-chat SSE path.

Model defaults to `claude-fable-5` (override per-call or with `DIME_AGENT_MODEL`).

## Claude Code CLI on a dev machine

```sh
claude /logout   # if previously logged in
export ANTHROPIC_BASE_URL="https://ai-gateway.vercel.sh"
export ANTHROPIC_AUTH_TOKEN="<your-ai-gateway-api-key>"
export ANTHROPIC_API_KEY=""
claude
```

**With a Claude subscription instead** (keeps subscription billing, gateway
observability): don't set the auth-token trio; instead

```sh
export ANTHROPIC_BASE_URL="https://ai-gateway.vercel.sh"
export ANTHROPIC_CUSTOM_HEADERS="x-ai-gateway-api-key: Bearer <your-ai-gateway-api-key>"
claude   # then log in with Option 1 — Claude account with subscription
```

## Gotchas

- **Bedrock/Vertex upstreams**: if the gateway routes to Bedrock or Vertex,
  set `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1` — Claude Code adds
  Anthropic-only beta headers those providers reject.
- **Fast mode** (Opus, dev CLI only): `CLAUDE_CODE_SKIP_FAST_MODE_ORG_CHECK=1`
  then toggle with `/fast`. Billed as extra usage at premium per-token rates.
- **Tests**: `server/claude.test.ts` mocks `@anthropic-ai/sdk`, so none of this
  affects CI; the credential presence probe is CI-skipped.
- **Deploys**: the backend env vars live wherever the server runs — Railway
  service variables (`references/railway-deploy.md`).
  Gateway routing takes effect only after the vars are set there and the
  backend is redeployed.
