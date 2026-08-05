#!/usr/bin/env bash
# UserPromptSubmit hook — injects the Dime execution capsule into EVERY prompt.
# Must stay tiny (runs per prompt), cwd-independent, and never exit non-zero:
# a failed capsule must degrade to nothing, never block the prompt.
set +e
cat <<'CAPSULE'
[Dime execution capsule] Primary harness: Claude Code (VS Code/Desktop, subscription auth — no API key for interactive work). Models: current-generation only — Fable 5 / Opus 5; Codex gpt-5.6-sol (LLM.md is law). API credits: spend ONLY on Dime Chat work or pi-share-hf reviews; CI model calls paused (LLM.md "API credit budget"). Skills: if one plausibly applies, invoke it BEFORE acting (SKILLS.md; ~227 wired; process skills first). pi harness: pnpm pi | pi:ship <PR#> | pi:review | pi:rpc; embedded runtimes runPiAgent/runPiChat in server/_core/piAgent.ts (HARNESS.md). Laws: UI obeys design-system/dime-ai/MASTER.md; merge to main IS a production deploy; schema changes need db-push.yml first; never commit secrets.
CAPSULE

# --- /os/ clock (ISSUE-007) -------------------------------------------------
# Appends ONE line naming what has gone quiet. Fires on EVERY prompt, which is
# the only channel measured to survive at this company: CLAUDE.md (hook-loaded)
# has 31 commits in 30 days; OPERATING-RULES.md declares itself non-negotiable,
# is loaded by nothing, and has been dead for 28 days.
# Hard budget: never fail, never block, never take long.
_os_clock="${CLAUDE_PROJECT_DIR:-.}/scripts/os/clock.mjs"
# NOTE: no `timeout` here. GNU coreutils `timeout` is absent on macOS, and using
# it silently swallowed the clock's output into `|| true` — a gate that emitted
# nothing and looked fine. The clock is pure fs reads over ~50 small files and
# self-limits; portability beats a watchdog that breaks the thing it guards.
if [ -f "$_os_clock" ]; then
  node "$_os_clock" 2>/dev/null || true
fi

exit 0
