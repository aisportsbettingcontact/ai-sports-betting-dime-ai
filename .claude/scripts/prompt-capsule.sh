#!/usr/bin/env bash
# UserPromptSubmit hook — injects the Dime execution capsule into EVERY prompt.
# Must stay tiny (runs per prompt), cwd-independent, and never exit non-zero:
# a failed capsule must degrade to nothing, never block the prompt.
set +e
cat <<'CAPSULE'
[Dime execution capsule] Primary harness: Claude Code (VS Code/Desktop, subscription auth — no API key for interactive work). Models: current-generation only — Fable 5 / Opus 5; Codex gpt-5.6-sol (LLM.md is law). API credits: spend ONLY on Dime Chat work or pi-share-hf reviews; CI model calls paused (LLM.md "API credit budget"). Skills: if one plausibly applies, invoke it BEFORE acting (SKILLS.md; ~227 wired; process skills first). pi harness: pnpm pi | pi:ship <PR#> | pi:review | pi:rpc; embedded runtimes runPiAgent/runPiChat in server/_core/piAgent.ts (HARNESS.md). Laws: UI obeys design-system/dime-ai/MASTER.md; merge to main IS a production deploy; schema changes need db-push.yml first; never commit secrets.
CAPSULE
exit 0
