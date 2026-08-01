# HARNESS.md — agent runtimes and their wiring

Every way an agent executes against this repo, and which files configure each. Deep pi
runbook: `references/pi-harness.md`.

| Harness | Runtime | Context it loads | Config files |
|---|---|---|---|
| Claude Code | CLI / desktop / cloud | `CLAUDE.md`, `.claude/skills/`, plugins, `.claude/commands/` | `.claude/settings.json`, `.mcp.json`, `.claude/scripts/bootstrap-plugins.sh` (SessionStart hook) |
| pi (interactive) | global `@earendil-works/pi-coding-agent` | `AGENTS.md` (not CLAUDE.md — first match wins), all skill trees + packages, `.claude/commands/` as `/templates`, `.pi/APPEND_SYSTEM.md` | `.pi/settings.json` (skills, prompts, packages, model policy, dime theme), `.pi/extensions/dime-guard.ts` (law enforcement at the tool layer), `~/.pi/agent/trust.json` |
| pi (headless) | `pi -p` / `--mode json` / `--mode rpc` | same, with `-a`/`--approve` for project trust | same |
| Embedded pi runtime | `@earendil-works/pi-agent-core` + `pi-ai` in the Express server | system prompt supplied by caller | `server/_core/piAgent.ts` (`createPiAgent`/`runPiAgent`) |
| Agent SDK runner | `@anthropic-ai/claude-agent-sdk` subprocess | Claude Code context | `server/_core/dimeAgent.ts` (`runDimeAgent`) |
| Codex | OpenAI Codex CLI/cloud | `AGENTS.md` (native), `CODEX.md` | `CODEX.md`; model `gpt-5.6-sol` per LLM.md |

## Choosing a runtime

- **Interactive engineering** → Claude Code or pi. Both see the same skills and command
  templates; pi is the minimal/extensible harness, Claude Code carries plugins + MCP.
- **Server-side agentic task, multi-step with built-in file/bash tools** →
  `runDimeAgent()` (subprocess, Claude Code toolset).
- **Server-side embedded agent, app-defined tools, SSE streaming, steering** →
  `createPiAgent()`/`runPiAgent()` (in-process, no subprocess, typebox `AgentTool`s).
- **Process integration from non-Node tooling** → `pi --mode rpc` (LF-delimited JSONL).
- **SDK scripting** → `@earendil-works/pi-coding-agent` `createAgentSession()` (full
  coding-agent session: tools, skills, sessions) or bare `pi-agent-core` for custom loops.

## Invariants across harnesses

Model policy per `LLM.md` (Fable 5 / Opus 5 / Codex 5.6 Sol only). Laws per `AGENTS.md`
(brand, deploy, data contracts, frozen chat provider). Skills per `SKILLS.md` — the same
skill corpus is exposed to every harness so behavior stays consistent regardless of which
agent runs.

## Production chat

`POST /api/dime/chat` executes through pi: `DIME_CHAT_LLM_PROVIDER = "pi"` serves chat via
the embedded pi-agent-core runtime (`runPiChat` in `server/_core/piAgent.ts`) with
claude-fable-5 — same validation, budgets, cost metering, and SSE contract as the retained
`"anthropic"` direct-SDK path. `"dime1"` stays gated behind `ml/dime-1.0` release gates.

## Session sharing

`pi-share-hf` publishes redacted pi sessions to the **private** HF dataset
`taileredsports/dime-ai-pi-sessions` (workspace `.pi/hf-sessions/`, gitignored; fail-closed
pipeline: exact-secret redaction → TruffleHog → LLM review → manual reject → upload). See
`references/pi-harness.md`.

## Trust and bootstrap

- pi: project resources (`.pi/settings.json`, skills, prompts, packages) load only after
  trust — `/trust` interactively, `-a` per headless run. Declared `packages` auto-install
  on trust (`.pi/git/`, gitignored).
- Claude Code: plugins bootstrap via the SessionStart hook (self-healing, offline from
  `.claude/plugins-vendored/`).
