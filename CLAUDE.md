# CLAUDE.md

AI Sports Betting platform (React + tRPC + Drizzle/MySQL + Express) undergoing a rebrand to
**Dime AI**. This file maps the project's skill arsenal and the rules that govern it.

## Skill arsenal — structure

| Layer | Location | Contents |
|---|---|---|
| Design intelligence | `.claude/skills/` (uipro) | ui-ux-pro-max (searchable styles/palettes/fonts/stacks + dials), design-system, design, ui-styling, brand, banner-design, slides |
| Design taste | `.agents/skills/frontend-design/` | Anthropic official — distinctive, non-templated visual direction |
| Payments | `.agents/skills/stripe-best-practices/` | Stripe official — API selection, billing, webhooks, key security |
| Engineering process | plugin `superpowers@claude-plugins-official` | 14 skills: brainstorming, writing/executing-plans, TDD, systematic-debugging, verification-before-completion, code review (both directions), subagent/parallel dispatch, worktrees, branch finishing, writing-skills |
| Product management | plugins `*@pm-skills` (55 skills) | Full deanpeters/Product-Manager-Skills catalog: discovery, JTBD, user stories/splitting/mapping, PRD, prioritization, roadmap, positioning, personas, journey maps, OST, POL probes, stakeholders, SaaS finance/growth metrics, TAM/SAM/SOM, workshops, exec-track advisors |

Plugin config lives in `.claude/settings.json` (`extraKnownMarketplaces` + `enabledPlugins`) —
everything auto-installs on session start in any environment. `skills-lock.json` pins the
npx-installed sources. `.agents/skills/` is the universal directory (17 agent platforms).

## Custom commands (`.claude/commands/`)

`/pm-story` · `/pm-prd` · `/pm-probe` · `/pm-prioritize` · `/pm-epic` · `/pm-problem` · `/pm-roadmap`
— each invokes the matching PM skill with structured output requirements. Give `$ARGUMENTS`
real context, not just a topic name. Chain them: problem → probe → story → epic → prioritize.

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

## Repo conventions

- TypeScript strict; `npx tsc --noEmit` must pass (CI runs it with `NODE_OPTIONS=--max-old-space-size=6144`)
- Vitest suite requires GitHub Actions secrets (see `.github/workflows/ci.yml` header) — DB-dependent
  tests fail without `DATABASE_URL` etc.
- Never commit secrets. The `uploads/` folder inside `dime-ai/design-bundle/` contains personal
  reference material — do not redistribute it or ship it to production bundles.
- Sports-betting product: keep responsible-gaming language on marketing surfaces (21+, 1-800-GAMBLER).
