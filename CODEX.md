# CODEX.md — Codex-specific context

Codex loads `AGENTS.md` natively — follow it in full (laws, conventions, skills,
harness map). This file only adds what is Codex-specific:

- **Model: `gpt-5.6-sol`** (per `LLM.md`). Do not select older models.
- Skills live in the trees listed in `SKILLS.md`; `.agents/skills/` is the universal
  directory. Read a skill's `SKILL.md` and follow it when it applies.
- Command playbooks in `.claude/commands/*.md` are harness-neutral prompt templates —
  reusable as task instructions even without a slash-command mechanism.
- Verification before completion: `npx tsc --noEmit` must pass; do not run the full vitest
  suite without CI secrets (DB-dependent tests fail locally).
