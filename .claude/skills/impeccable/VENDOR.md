# Vendored: impeccable

- **Source:** [pbakaus/impeccable](https://github.com/pbakaus/impeccable) (Paul Bakaus)
- **Pinned commit:** `ae5e95101a6979e7f7973a4ff57680b3c7adc1ec` ("Sync generated provider output", 2026-08-04)
- **Skill version:** 4.0.4 · **License:** Apache-2.0 (`LICENSE` + `NOTICE.md` in this directory)
- **Vendored on:** 2026-08-05, from the repo's checked-in Claude payload at `.claude/skills/impeccable/` (the npm tarball ships only the CLI; the repo is the vendorable source)

## What was vendored

- This directory: `SKILL.md`, `reference/` (35 command/reference docs + `degraded/` with 4 degraded-mode subagent docs), `scripts/` (detector, live-mode, context tooling — Node ES modules, engines >22.18; local node is v22.22)
- `.claude/agents/impeccable-{asset-producer,documenter,finish-reviewer,manual-edit-applier}.md` — subagents referenced by the `document`/`live`/finish flows

## Deliberately NOT vendored

- **Hook wiring.** Upstream's `.claude/settings.json` installs PostToolUse (Edit/Write) + Stop hooks running `scripts/hook.mjs` (design detection on UI edits). This repo's `.claude/settings.json` is load-bearing (marketplace/plugin config) and hook installation is an owner decision. To opt in, merge the `hooks` block from the pinned upstream `.claude/settings.json` into `.claude/settings.local.json`.
- Other provider dirs (`.codex/`, `.cursor/`, `.pi/`, …) — pi already sees this copy via `.pi/settings.json`'s `../.claude/skills` include.

## Deterministic detector (no hook needed)

```bash
node .claude/skills/impeccable/scripts/detect.mjs --json client/src/   # vendored, offline (verified 2026-08-05)
npx impeccable@3.5.0 detect --json client/src/                         # equivalent pinned CLI
```

The 23 in-agent commands (`/impeccable init|shape|critique|audit|polish|…`) route through `SKILL.md` + `reference/`, not through `.claude/commands/` files.

## Updating

Re-clone upstream, check out a newer commit deliberately (tip churns — a CI bot syncs generated output), diff `SKILL.md`/`scripts/`, re-copy, and update the pin here. Treat like a dependency bump: inspect added scripts before running them.
