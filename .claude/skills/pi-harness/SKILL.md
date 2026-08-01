---
name: pi-harness
description: Use when shipping, releasing, reviewing branches/PRs, running agents or agentic tasks, choosing models or providers, driving the pi CLI (pnpm pi:*), the embedded pi runtimes (runPiAgent/runPiChat/piAgent.ts), Dime Chat providers, or session sharing. Routes execution through the pi foundation per HARNESS.md/LLM.md/SKILLS.md.
---

# pi-harness — execute through the pi foundation

This repo's execution backbone is pi. When a task touches shipping, review, agents,
or model selection, route it through these entry points instead of ad-hoc commands.

## Entry points

| Task | Command / API |
|---|---|
| Ship a PR through release gates | `pnpm pi:ship <PR#>` (interactive — human authorizes merge) |
| Review current branch | `pnpm pi:review` (headless) or `/review` inside pi |
| Interactive pi session | `pnpm pi` (trusted; loads AGENTS.md + 227 skills + 33 templates) |
| Process integration | `pnpm pi:rpc` (LF-JSONL) / `pnpm pi:json` |
| Server-side agent task (built-in tools) | `runDimeAgent()` — server/_core/dimeAgent.ts |
| Server-side embedded agent (app tools, SSE) | `createPiAgent()` / `runPiAgent()` — server/_core/piAgent.ts |
| Chat completion serving | `runPiChat()` — server/_core/piAgent.ts |
| Publish agent sessions | `pi-share-hf collect/review/upload` → PRIVATE HF dataset (references/pi-harness.md) |

## Rules

1. **Auth**: interactive work runs on Claude Code / pi subscription auth (`/login` in pi) —
   no API key required. API credits are needed only for server runtimes (runPiChat,
   runDimeAgent in production) and headless pipelines (pi -p in CI, pi-share-hf review).
2. **Models**: current-generation only per LLM.md — claude-fable-5 (default),
   claude-opus-5, openai-codex/gpt-5.6-sol. `resolvePiAgentModel()` enforces this in code;
   `.pi/settings.json` enforces it in the CLI. Never select older models.
3. **Guard**: pi sessions run `.pi/extensions/dime-guard.ts` — destructive git and
   protected-path writes are blocked at the tool layer. Do not work around it.
4. **Docs of record**: HARNESS.md (runtime matrix), SKILLS.md (corpus + triggering),
   LLM.md (model law), references/pi-harness.md (deep runbook).
