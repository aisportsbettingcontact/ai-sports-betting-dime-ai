# SKILLS.md — skill corpus and triggering

Every skill source in this repo, wired so all harnesses see the same corpus. Audited via
pi's own resource loader (2026-08-01): **227 skills + 33 prompt templates load in pi, zero
duplicate names, zero diagnostics errors.** CLAUDE.md's arsenal table describes what each
collection contains; this file covers where they live and how they load and trigger.

## Sources

| Source                                                                                                   | Count | Claude Code          | pi                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------- | ----- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.claude/skills/` (flat: uipro, taste, phuryn PM, emil, anthropic, repo-specific…)                       | 99    | native               | `.pi/settings.json` `skills` (7 older uipro dirs excluded — superseded below)                                                                                             |
| `.claude/plugins-vendored/ui-ux-pro-max-skill/.claude/skills/`                                           | 7     | plugin               | settings (v2.11.0, newer than flat copies: 84 styles / 192 palettes / 74 fonts). Path must point INSIDE the plugin — pi skips dot-directories (`.claude/`) when recursing |
| `.claude/plugins-vendored/pm-skills/` (deanpeters)                                                       | 70    | plugins (55 enabled) | settings (all 70)                                                                                                                                                         |
| `.claude/plugins-vendored/dime-vendored/` (superpowers 14, mcp-server-dev, figma)                        | 31    | plugins              | settings                                                                                                                                                                  |
| `.claude/plugins-vendored/railway-skills/`                                                               | 1     | plugin               | settings                                                                                                                                                                  |
| `.agents/skills/` (universal: frontend-design, stripe-best-practices, architect-\*, advertising)         | 16    | native               | auto-discovered                                                                                                                                                           |
| Package `git:github.com/badlogic/pi-skills` (web search, browser automation, Google APIs, transcription) | ~8    | —                    | `.pi/settings.json` `packages` → `.pi/git/`                                                                                                                               |
| Package `git:github.com/anthropics/skills` (docx/pdf/pptx/xlsx, web artifacts)                           | ~15   | —                    | same                                                                                                                                                                      |
| `.claude/plugins-vendored/taste-skill/`                                                                  | 13    | plugin               | _skipped — exact duplicates of the flat copies_                                                                                                                           |

Known duplicate names: 5 phuryn/deanpeters collisions (`ansoff-matrix`,
`customer-journey-map`, `opportunity-solution-tree`, `porters-five-forces`,
`swot-analysis`) load from both trees in pi; pi is lenient (warns, loads). Either variant
is acceptable.

## Triggering (make skills fire intuitively)

- **Rule for every agent: if a skill plausibly applies — even 1% — invoke it before
  responding.** Process skills first (brainstorming, systematic-debugging, TDD,
  verification-before-completion), then domain skills (frontend-design, stripe, uipro).
- Claude Code: `Skill` tool / `/<command>`; superpowers' using-superpowers gate enforces
  the rule at session start.
- pi: skills are advertised in `<available_skills>` (name + description) so the model
  auto-selects by prompt match; explicit invocation is `/skill:<name>`. All 33
  `.claude/commands/*.md` are also loaded as `/` prompt templates (same `$ARGUMENTS`
  syntax) — `/ship`, `/stripe`, `/ui-build`, `/sp-*`, `/pm-*`, plus pi-native `/review`
  from `.pi/prompts/`.
- Embedded runtimes get no skill discovery — bake needed skill content into the
  `systemPrompt` passed to `createPiAgent()`/`runDimeAgent()`.

## Precedence

Dime brand law (`design-system/dime-ai/MASTER.md`) beats every skill's palette/font/motion
suggestions. Process skills govern how, not what. User/owner direction beats both.

## Importing into QM

QM (references/qm-harness.md) imports this repo as a **skill pack** — same Agent Skills
standard, scanned for `SKILL.md`. Canonical pack config: git URL of this repo with
`skillGlobs: [".agents/skills/**", ".claude/skills/**"]` and the 7 superseded flat uipro
dirs excluded (the same dedup `.pi/settings.json` applies). Private repo ⇒ the pack
credential's path allow-list must cover `/aisportsbettingcontact/`. QM audits pack
commits and handles name collisions at ingest.

## Adding skills

Drop a `<name>/SKILL.md` dir in `.agents/skills/` (all harnesses pick it up) or
`.claude/skills/` (add the path to `.pi/settings.json` if pi should see it). External
collections: `pi install -l <git|npm source>` (records into `packages`, auto-installs for
everyone on trust).
