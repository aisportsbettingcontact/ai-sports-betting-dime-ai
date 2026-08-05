# Federation routing — exact invocation surfaces

Verified against this repo 2026-08-05. When something here disagrees with the skill's own files on disk, the files win — update this doc.

## Brand law (final authority — read, never summarize)

Reading order for any page build:

1. `design-system/dime-ai/pages/<page-name>.md` — if it exists, its rules override the Master. Today: `ai-model-projections.md`, `signup.md`.
2. `design-system/dime-ai/MASTER.md` — everything else, including the Pre-Delivery Checklist that gates delivery.
3. `dime-ai/THREE-COLOR-LAW.md` — wins over MASTER.md wherever they disagree (MASTER.md's own SUPERSEDED note, 2026-07-13). Its v3 is the "dimensional" amendment and includes owner-approved **motion** rules (1–2px lift, small shadow expansion, optional restrained rotateX/rotateY, compressed press, non-bouncing spring return — on interactive projections cards/controls), which amend the 160ms one-curve law on that product. The Law's win is not limited to color.
4. `design-system/dime-ai/TYPOGRAPHY.md` — orthogonal layer owning size, rhythm, measure, wrap (never color).

Known internal drift to respect, not resolve: MASTER.md still specifies IBM Plex Mono for micro-labels while a 2026-07-24 audit note retired Plex Mono in shipped code (Familjen Grotesk only, mono-*style* treatment). Flag it when relevant; the owner resolves it. Scoring rule for the Pre-Delivery Checklist's "Familjen Grotesk + IBM Plex Mono loaded" item until then: **pass = Familjen-only with mono-style treatment and Plex Mono NOT loaded** (the supersede note wins).

## 1. ui-ux-pro-max — research librarian + design-system generator

- **Skill IDs:** `ui-ux-pro-max:ui-ux-pro-max` (plugin v2.11.0 — prefer it for its newer scripts/flags) · flat `ui-ux-pro-max` (fallback; its data CSVs are synced to the same 84 styles/192 palettes/74 pairings, but its SKILL.md self-description still says 67/161/57 and its script lacks `--force`/`--full`).
- **CLI (flat copy, stable path):** `python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<query>" [--domain style|color|chart|landing|product|ux|typography|icons|gsap|react|web|google-fonts] [--stack react|nextjs|…] [-n N] [--json]`
- **Design-system mode:** add `--design-system [-p "Project Name"] [-f markdown]`; dials `--variance 1-10 --motion 1-10 --density 1-10` work **only** with `--design-system`.
- **Persist:** `--persist [--page "<page>"] [--output-dir <project-root>]` writes `design-system/<project-slug>/MASTER.md` (+ `pages/<page-slug>.md`). Slug = `-p` name (else the whole query) lowercased/hyphenated. **The slug `dime-ai` is the brand-law directory — never persist to it.** Governed surfaces: don't persist at all (see SKILL.md conditionals). Plugin copy adds `--full` and `--force` (persist skips an existing MASTER.md without `--force`); the flat copy has neither flag.
- Generator palette/font output is generic by definition — evidence, never authority (CLAUDE.md precedence rule 1).

## 2. frontend-design — default art director

- **Not in the Skill roster.** Load via `Read .claude/skills/frontend-design/SKILL.md` (byte-identical mirror in `.agents/skills/frontend-design/`). Pinned 9d2f1ae, hash in `skills-lock.json`.
- Process it enforces: ground in subject/audience/single job → compact design-plan token system **before code** (color roles, type roles, layout prose + ASCII, one signature element) → pre-code critique pass ("would I produce this for any similar page?") → build exactly to plan → self-critique during build.
- Under Dime law its palette/typeface freedom collapses: treat MASTER.md as "the brief pins the direction" (its own words: the brief always wins). Spend the signature element inside the law — layout, structure, copy, one rationed moment — never a new color/font/gradient.

## 3. Taste family — routed expressive specialist

- **Skill IDs (flat / plugin):** `taste-skill` / `taste-skill:taste-skill` (v2, default, self-labeled experimental), `taste-skill-v1`, `redesign-skill`, `soft-skill`, `minimalist-skill`, `brutalist-skill`, `gpt-tasteskill`, `output-skill` (anti-truncation, not a design direction), `stitch-skill` (Google Stitch only). Pinned b177427, MIT.
- **Dials (v2/v1, exact spellings, set conversationally — never file edits, never aliases):** `DESIGN_VARIANCE` (baseline 8), `MOTION_INTENSITY` (6), `VISUAL_DENSITY` (4), each 1–10. Bands: VARIANCE 1-3 Predictable / 4-7 Offset / 8-10 Asymmetric; MOTION 1-3 Static / 4-7 Fluid CSS / 8-10 Choreography; DENSITY 1-3 Art Gallery / 4-7 Daily App / 8-10 Cockpit.
- **Scope (v2's own words):** landing pages, portfolios, redesigns. Its Section 13 refuses dashboards, data tables, multi-step product UI, code editors, native mobile, realtime collab — route those to impeccable + uipro instead.
- Sibling routing: `redesign-skill` = audit-first in-place upgrade, no rewrite · `soft-skill` = expensive/agency look (its glass/gradient vocabulary is largely banned by Dime law — usable only within tokens) · `minimalist-skill` = Notion/Linear editorial · `brutalist-skill` = Swiss-print/terminal (accepts data-heavy dashboards) · `gpt-tasteskill` = GSAP ScrollTrigger pages — MASTER.md bans GSAP/scroll/parallax outright ("this is a data product, not a marketing page"), with no marketing exemption anywhere in the law, so it may not Lead any Dime surface unless an owner directive amends the law; keep it for non-Dime/external artifacts only.
- v2 requires: one-line Design Read, reasoned dial values, final pre-flight check. Em-dash ban, reduced-motion above MOTION_INTENSITY 3, dual dark/light by default.

## 4. Emil skills — motion and component craft

- **Skill IDs:** `emil-design-eng` (build/polish; invoked without a concrete question it returns only a canned greeting — always pass the actual code/question), `apple-design` (gesture/spring/fluid-interface physics, materials, web typography), `animation-vocabulary` (name-that-motion only).
- **`review-animations` — the motion audit gate.** `disable-model-invocation: true`, so it is NOT Skill-invocable: `Read .claude/skills/review-animations/SKILL.md` + `.claude/skills/review-animations/STANDARDS.md`, apply to the diff. Output contract: one `| Before | After | Why |` findings table, then a tiered verdict ending in explicit **Block** or **Approve** with file:line citations.
- Dime cap: emil's generic budgets (press 100–160ms, modal up to 500ms, UI cap 300ms) are ceilings *above* the brand law. The governing motion law per surface: MASTER.md's one-curve `160ms cubic-bezier(0.16, 1, 0.3, 1)` / Motion 2/10 by default, **as amended by THREE-COLOR-LAW v3** on interactive projections cards/controls (owner-approved restrained lift/spring — the review-animations gate must not Block behavior v3 grants).
- Upstream skills not vendored here: prototype, pick-ui-library (do not reference them).

## 5. impeccable — design operations (vendored, pinned)

- **Skill ID:** `impeccable` (v4.0.4). Provenance/pin/license: `.claude/skills/impeccable/VENDOR.md` (Apache-2.0, commit `ae5e951`).
- **In-agent commands (route through the skill, no `.claude/commands/` files):** `/impeccable init | craft | shape | critique | audit | polish | document | extract | bolder | quieter | distill | harden | onboard | animate | colorize | typeset | layout | delight | overdrive | clarify | adapt | optimize | live`.
- **Deterministic detector:** `node .claude/skills/impeccable/scripts/detect.mjs --json <dir>` (vendored, offline; Node ≥22.18 — local v22.22 verified 2026-08-05). Equivalent pinned CLI: `npx impeccable@3.5.0 detect --json <dir>`. CI-shaped JSON findings; 59 rules.
- Edit-time hooks deliberately not wired (owner opt-in; see VENDOR.md). Subagents `impeccable-*` live in `.claude/agents/`.

## 6. Observation — eyes and hands

- **`verify` skill** (`.claude/skills/verify/SKILL.md`): production build + boot recipe, `node scripts/smoke-deploy.mjs <url>` (6 checks, works on localhost and live Railway), bot-prerender curl, Playwright rendered-page/screenshot recipe. Its Playwright snippet hardcodes remote-container paths (`/opt/pw-browsers/chromium`, `/home/user/...`) — resolve per environment; locally prefer the `playwright-cli` or `agent-browser` skills.
- Viewports for the bundle: 1440×900 and 390×844 minimum, plus a reduced-motion pass.
- `/sp-verify` = superpowers:verification-before-completion — command output (tsc/tests/build). Required, and distinct from rendered proof.

## Process shell (unchanged by this skill)

`/sp-brainstorm` before creative work · worktree isolation for feature work · TDD where code is testable · `/sp-review-ask` before merge · `/ship <PR#>` for release. The federation loop slots into the existing chain: `/pm-problem → /pm-story → /sp-plan → /sp-tdd → /ui-loop (federated build+verify) → /sp-review-ask → /sp-finish`.
