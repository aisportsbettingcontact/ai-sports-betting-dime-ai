# CLAUDE.md

AI Sports Betting platform (React + tRPC + Drizzle/MySQL + Express) undergoing a rebrand to
**Dime AI**. This file maps the project's skill arsenal and the rules that govern it.

## Skill arsenal — structure

| Layer | Location | Contents |
|---|---|---|
| Design intelligence | `.claude/skills/` (uipro) | ui-ux-pro-max (searchable styles/palettes/fonts/stacks + dials), design-system, design, ui-styling, brand, banner-design, slides |
| Design intelligence (upstream plugin) | plugin `ui-ux-pro-max@ui-ux-pro-max-skill` | nextlevelbuilder/ui-ux-pro-max-skill marketplace — upstream ui-ux-pro-max, tracks upstream releases alongside the vendored `.claude/skills/` copy |
| Design taste | `.agents/skills/frontend-design/` | Anthropic official — distinctive, non-templated visual direction |
| Writing quality | `.claude/skills/stop-slop/` | hardikpandya/stop-slop — strips AI writing tells from prose (filler phrases, formulaic structures, passive voice); use when drafting/editing copy or docs |
| Design taste (Emil Kowalski) | `.claude/skills/` (emilkowalski/skill) | emil-design-eng (UI polish philosophy), apple-design (Apple-style motion/materials for web), animation-vocabulary (name-that-motion glossary), review-animations |
| Design taste (Anthropic, pinned 9d2f1ae) | `.claude/skills/` | frontend-design (also in `.agents/skills/`), algorithmic-art (p5.js generative art + templates), mcp-builder (MCP server quality guide) |
| Design taste (leonxlnx, pinned b177427) | `.claude/skills/` (13 skills, leonxlnx/taste-skill, MIT) + plugin `taste-skill@taste-skill` | Anti-slop frontend: taste-skill (v2 default, brief-inference + VARIANCE/MOTION/DENSITY dials), taste-skill-v1, redesign-skill (audit-first upgrades), soft-skill (expensive/agency look), minimalist-skill (Notion/Linear editorial), brutalist-skill (Swiss/terminal), gpt-tasteskill (GSAP motion), output-skill (anti-truncation), stitch-skill (Google Stitch DESIGN.md), image-to-code-skill, imagegen-frontend-web/-mobile, brandkit (image-gen only). Plugin tracks upstream alongside the vendored copies |
| Code review | `.claude/skills/code-review-excellence/` | wshobson/agents (pinned d7cf7dc) — review methodology: severity triage, security/perf/maintainability checklists, feedback phrasing |
| Product management (phuryn) | `.claude/skills/` (68 skills, phuryn/pm-skills) | Strategy (canvases, five-forces, pricing), discovery (assumptions, experiments, interviews, OST), execution (PRD, OKRs, sprints, retros), GTM (ICP, battlecards, growth loops), market research, analytics (SQL, A/B, cohorts), toolkit (NDA, privacy policy). Overlaps deanpeters plugins — prefer `/pm-*` commands for the deanpeters chain |
| Upload bundles | `.claude/skill-zips/` | 17 claude.ai-ready skill zips (one skill per zip; `phuryn-pm-skills-all.zip` = 68 inner zips) for Settings → Skills → Add |
| Payments | `.agents/skills/stripe-best-practices/` | Stripe official — API selection, billing, webhooks, key security |
| Engineering process | plugin `superpowers@claude-plugins-official` | 14 skills: brainstorming, writing/executing-plans, TDD, systematic-debugging, verification-before-completion, code review (both directions), subagent/parallel dispatch, worktrees, branch finishing, writing-skills |
| MCP development | plugin `mcp-server-dev@claude-plugins-official` | Designing and building MCP servers that work well with Claude: deployment models (remote HTTP, MCPB, local), tool design patterns, auth, interactive MCP apps |
| Product management | plugins `*@pm-skills` (55 skills) | Full deanpeters/Product-Manager-Skills catalog: discovery, JTBD, user stories/splitting/mapping, PRD, prioritization, roadmap, positioning, personas, journey maps, OST, POL probes, stakeholders, SaaS finance/growth metrics, TAM/SAM/SOM, workshops, exec-track advisors |
| Advertising | `.agents/skills/` (12, realkimbarrett/advertising-skills) | Direct response: avatar/offer extraction, Schwartz awareness mapping, headline-matrix, mechanism-builder, objection-crusher, ad-angle-multiplier (creative testing), scroll-stopping-creative, conversion-path-builder, performance-diagnosis, generic-language-killer, full-funnel-campaign-orchestrator |

Plugin config lives in `.claude/settings.json` (`extraKnownMarketplaces` + `enabledPlugins`) —
everything auto-installs on session start in any environment. `skills-lock.json` pins the
npx-installed sources. `.agents/skills/` is the universal directory (17 agent platforms).

## Custom commands (`.claude/commands/`)

Give `$ARGUMENTS` real context, not just a topic name. Full command definitions are under
`.claude/commands/`; inspect only the command relevant to the current task.

Non-derivable notes: the `/pm-*` discovery chain is `/pm-problem` → `/pm-probe` → `/pm-story` →
`/pm-epic` → `/pm-prioritize`; ALL `/ui-*` commands enforce Dime brand law from
`design-system/dime-ai/MASTER.md`; `/stripe` is grounded in this repo's webhook/checkout code;
`/ship <PR#>` = verify CI and release gates → merge approved PR → confirm Railway deployment and
smoke checks; `/gh-fix <issue#>` = issue → isolated worktree → focused fix → verification → PR.

Typical build loop: `/pm-problem` → `/pm-story` → `/sp-plan` → `/sp-tdd` → `/ui-build` → `/sp-verify` → `/sp-review-ask` → `/sp-finish`.

Useful CLI: `python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<query>" [--domain ...] [--stack ...] [--design-system --variance N --motion N --density N]`

## Precedence rules (IMPORTANT)

1. **Dime brand law beats skill suggestions.** For any UI work, `design-system/dime-ai/MASTER.md`
   (+ `design-system/dime-ai/pages/*.md` overrides) is authoritative: one-accent mint `#45E0A8`
   (`#0FA36B` for mint text on light), Familjen Grotesk + IBM Plex Mono, 160ms motion, no
   gradients/purple/neon-green/gold. uipro's palette/font generator output is generic — never
   let it override the locked tokens.
2. **Process skills govern how, not what.** superpowers (TDD, verification, planning) applies to
   engineering work; PM skills apply to product framing; neither overrides explicit user direction.
3. **Backend data contracts** for the projections feed are documented in
   `design-system/dime-ai/pages/ai-model-projections.md` and `dime-ai/DIME-FEED-MIGRATION-DRAFT.md`
   — do not violate them when rebuilding UI.

## Dime AI context pointers

- `dime-ai/README.md` — brand kit map + verified tokens
- `dime-ai/reference-pages/` — implementation references: chat/home (dark+light), feed
  (dark+light), landing page. Static, pixel-verified against the Claude Design source.
- `dime-ai/DIME-FEED-MIGRATION-DRAFT.md` — the phased plan for rehosting the MLB projections
  feed inside the Dime shell (route `/feed` → "AI Model Projections" tab)
- Chat page: `client/src/pages/DimeChat.tsx` (`/chat`, SSE via `POST /api/dime/chat`) — keep the
  streaming core when reskinning
- Claude traffic routing — the Anthropic SDK (`server/_core/anthropicClient.ts`), Agent SDK
  (`server/_core/dimeAgent.ts`), and Claude Code CLI all route through an Anthropic-compatible
  gateway via `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`
- `ml/dime-1.0/README.md` — Dime 1.0 self-hosted model runbook (QLoRA fine-tune of Llama 3 8B
  Instruct → 4-bit AWQ → private RunPod Serverless vLLM endpoint; Railway stays the control
  plane). Server wiring: `server/_core/dime1*.ts` behind `DIME_CHAT_LLM_PROVIDER` (ships
  `"frozen"`; flip to `"dime1"` only after the runbook's eval gates pass)

## Deploy law (IMPORTANT)

**Hosting: Railway serves the whole app** (Express serves API + built Vite client;
DNS on the custom domain points at Railway). Runbook: `references/railway-deploy.md` —
Dockerfile/`railway.json` build everything, with Debian Python for the model runners.
Railway auto-deploys on push to `main`. An earlier standalone frontend host was dropped
2026-07-11 (it was the planned frontend host mid-migration); the app is Railway-only now.
The legacy platform deployment has been retired (its runbook was removed from the repo
2026-07-23).
Schema changes always need the manual `db-push.yml` workflow before any code deploy.

## Repo conventions

- TypeScript strict; `npx tsc --noEmit` must pass (CI runs it with `NODE_OPTIONS=--max-old-space-size=6144`)
- Vitest suite requires GitHub Actions secrets (see `.github/workflows/ci.yml` header) — DB-dependent
  tests fail without `DATABASE_URL` etc.
- Never commit secrets. The `uploads/` folder inside `dime-ai/design-bundle/` contains personal
  reference material — do not redistribute it or ship it to production bundles.
- Sports-betting product: keep responsible-gaming language on marketing surfaces (21+, 1-800-GAMBLER).
