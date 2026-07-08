# PREZ AI — SKILLS DIRECTORY

> The complete arsenal: **79 skills · 30 commands · 2 auto-resolving marketplaces ·
> universal + project skill directories.** Every session on this repo inherits all of it on boot.
>
> Precedence law: `design-system/dime-ai/MASTER.md` beats any skill's style output. Always.

---

## How the collective loads

| Mechanism | What it carries | Config |
|---|---|---|
| Project skills dir | uipro's 7 design skills | `.claude/skills/` (committed) |
| Universal skills dir | npx-installed skills, usable by 17 agent platforms | `.agents/skills/` + `skills-lock.json`; Claude Code reads via symlinks in `.claude/skills/` |
| Plugin system | superpowers (14) + pm-skills (55) | `.claude/settings.json` → `extraKnownMarketplaces` + `enabledPlugins` (project scope, auto-installs in fresh containers) |
| Commands | 30 slash commands wrapping the arsenal | `.claude/commands/` |
| Session map | Structure + precedence + Dime pointers | `CLAUDE.md` (repo root) |

Marketplaces: `claude-plugins-official` (github: anthropics/claude-plugins-official) ·
`pm-skills` (github: deanpeters/Product-Manager-Skills).

---

## Layer 1 — Design intelligence (7 · uipro · `.claude/skills/`)

| Skill | Use when |
|---|---|
| `ui-ux-pro-max` | Planning/building/reviewing any UI — searchable styles (67), palettes (161), font pairings (57), charts (25), stacks (21), UX rules; design dials (`--variance/--motion/--density`). CLI: `python3 .claude/skills/ui-ux-pro-max/scripts/search.py` |
| `design-system` | Token architecture (primitive→semantic→component), component specs, validators, Master+Overrides persistence |
| `design` | Producing brand/design assets — logos, CIP, icons, banners, slides, social images |
| `ui-styling` | shadcn/ui + Tailwind implementation, accessible components, dark mode |
| `brand` | Brand voice, visual identity standards, consistency audits, asset validation |
| `banner-design` | Banners for social/ads/web/print (22 styles, platform sizes) |
| `slides` | Strategic HTML presentations with Chart.js + design tokens |

## Layer 2 — Design taste (1 · Anthropic official · `.agents/skills/`)

| Skill | Use when |
|---|---|
| `frontend-design` | New or reshaped UI needs a distinctive, non-templated visual direction — deliberate typography/layout choices, one justifiable aesthetic risk |

## Layer 3 — Payments (1 · Stripe official · `.agents/skills/`)

| Skill | Use when |
|---|---|
| `stripe-best-practices` | Building/modifying/reviewing any Stripe work — API selection, billing/subscriptions, webhooks, key security, deprecated-API migration. Repo touchpoints: `server/stripeWebhook.ts`, `/pricing`, `/account` |

## Layer 4 — Engineering process (14 · superpowers plugin)

Invoke as `superpowers:<name>`.

| Skill | Use when |
|---|---|
| `using-superpowers` | Starting any conversation — how to find and apply skills |
| `brainstorming` | Before ANY creative work — features, components, behavior changes |
| `writing-plans` | You have a spec/requirements for multi-step work, before touching code |
| `executing-plans` | Executing a written plan with review checkpoints |
| `subagent-driven-development` | Executing plan tasks via fresh subagents in-session |
| `dispatching-parallel-agents` | 2+ independent tasks with no shared state |
| `test-driven-development` | Implementing any feature or bugfix, before implementation code |
| `systematic-debugging` | Any bug, test failure, or unexpected behavior, before proposing fixes |
| `verification-before-completion` | About to claim work complete/fixed/passing — evidence first |
| `requesting-code-review` | Completing tasks or preparing to merge |
| `receiving-code-review` | Handling review feedback — verify before implementing |
| `using-git-worktrees` | Feature work needing isolation from the current workspace |
| `finishing-a-development-branch` | Implementation done, tests pass — merge/PR/cleanup decision |
| `writing-skills` | Creating or editing skills (TDD for documentation) |

## Layer 5 — Product management (55 · pm-skills plugins)

Invoke by plugin name (e.g. `user-story`, `pol-probe`).

**Discovery & problem framing (11)**
| Skill | Use when |
|---|---|
| `problem-statement` | Framing who is blocked, on what, and why it matters — before discovery, prioritization, or a PRD |
| `problem-framing-canvas` | A team needs MITRE's canvas to sharpen a fuzzy problem |
| `jobs-to-be-done` | Clarifying unmet needs, repositioning, improving discovery/messaging |
| `discovery-process` | Running a full cycle: hypothesis → interviews → synthesis → experiments |
| `discovery-interview-prep` | Planning customer interviews with the right goal/segment/method |
| `opportunity-solution-tree` | A stakeholder request needs problem framing before build decisions |
| `pol-probe` | Testing a risky hypothesis cheaply — harsh truth before building |
| `pol-probe-advisor` | Choosing which probe type matches the learning goal |
| `lean-ux-canvas` | Framing a business problem and surfacing assumptions (Lean UX v2) |
| `epic-hypothesis` | Framing a major initiative as a testable hypothesis |
| `derisk-measurement-advisor` | Deciding what to measure/test to de-risk an idea (DUFV + PESTEL) |

**Definition & delivery (9)**
| Skill | Use when |
|---|---|
| `user-story` | Turning needs into dev-ready stories (Mike Cohn + Gherkin) |
| `user-story-splitting` | A story/epic is too big to estimate, sequence, or ship |
| `user-story-mapping` | Planning a workflow/backlog/MVP around the user journey |
| `user-story-mapping-workshop` | Facilitating a story-mapping session with a team |
| `epic-breakdown-advisor` | Splitting epics with Humanizing Work patterns |
| `prd-development` | Turning discovery into an engineering-ready PRD |
| `press-release` | Amazon-style working-backwards alignment before building |
| `storyboard` | A six-frame narrative for alignment, concept reviews, demos |
| `prioritization-advisor` | Choosing RICE/ICE/value-effort/etc. for your context |

**Strategy & positioning (10)**
| Skill | Use when |
|---|---|
| `product-strategy-session` | End-to-end strategy: positioning → discovery → roadmap |
| `roadmap-planning` | Turning strategy into an executable, sequenced release plan |
| `positioning-statement` | Geoffrey Moore-style who/what/category/differentiation |
| `positioning-workshop` | Messaging feels fuzzy/generic — workshop it with the team |
| `proto-persona` | A working customer profile before deeper validation |
| `customer-journey-map` | Diagnosing a broken experience across stages/touchpoints/emotions |
| `customer-journey-mapping-workshop` | Facilitating the journey-mapping session |
| `pestel-analysis` | External forces could materially shift product/strategy |
| `tam-sam-som-calculator` | Sizing a market with explicit assumptions and caveats |
| `company-intel` / `company-research` | Structured competitor/company/industry research briefs |

**Growth & finance (8)**
| Skill | Use when |
|---|---|
| `business-health-diagnostic` | Preparing a business review across growth/retention/efficiency/capital |
| `saas-revenue-growth-metrics` | Diagnosing momentum, churn, expansion, PMF signals |
| `saas-economics-efficiency-metrics` | Judging unit economics and capital efficiency for scaling |
| `finance-metrics-quickref` | Fast lookup of a SaaS metric, formula, or benchmark |
| `finance-based-pricing-advisor` | Deciding whether a pricing move should ship (ARPU/churn/NRR/payback) |
| `feature-investment-advisor` | Whether a feature deserves investment (revenue/ROI/strategy) |
| `acquisition-channel-advisor` | Scale, test, or kill a growth channel |
| `organic-growth-advisor` | Which organic growth lever to pull next (segments/geo/channels/products) |

**Stakeholders & facilitation (5)**
| Skill | Use when |
|---|---|
| `stakeholder-identification` | Mapping every stakeholder before engaging anyone |
| `stakeholder-mapping` | Prioritizing stakeholders with complementary grids |
| `stakeholder-engagement-advisor` | Planning outreach for one critical relationship |
| `workshop-facilitation` | Running any interactive session with consistent pacing |
| `eol-message` | Retiring a product/feature/plan with clear, empathetic comms |

**AI product practice (4)**
| Skill | Use when |
|---|---|
| `recommendation-canvas` | Evaluating an AI product idea across outcomes/risks/positioning |
| `ai-shaped-readiness-advisor` | Assessing AI-first vs AI-shaped maturity |
| `agent-orchestration-advisor` | A complex PM task should run as parallel specialized agents |
| `context-engineering-advisor` | An AI workflow feels bloated, brittle, or hard to steer |

**Career & leadership (5)**
| Skill | Use when |
|---|---|
| `altitude-horizon-framework` | Diagnosing PM→Director scope/horizon gaps |
| `director-readiness-advisor` | Coaching through the PM→Director transition |
| `vp-cpo-readiness-advisor` | Transitioning to VP/CPO scope |
| `executive-onboarding-playbook` | A 30-60-90 diagnostic plan for a new exec role |
| `product-sense-interview-answer` | Practicing spoken product-sense interview answers |

**Meta (3)**
| Skill | Use when |
|---|---|
| `pm-skill-creator` | Shaping raw content/ideas into a new compliant PM skill |
| `skill-authoring-workflow` | Turning PM content into a publish-ready skill without breaking standards |
| *(pairs with `superpowers:writing-skills` for TDD-grade skill authoring)* | |

---

## The 30 commands (`.claude/commands/`)

Give `$ARGUMENTS` real context, not just a topic name.

| Namespace | Commands | Wraps |
|---|---|---|
| `/pm-*` (7) | `/pm-problem` `/pm-probe` `/pm-story` `/pm-epic` `/pm-prioritize` `/pm-prd` `/pm-roadmap` | PM skills with structured-output contracts |
| `/sp-*` (14) | `/sp-brainstorm` `/sp-plan` `/sp-execute` `/sp-tdd` `/sp-debug` `/sp-verify` `/sp-review-ask` `/sp-review-apply` `/sp-parallel` `/sp-subagents` `/sp-worktree` `/sp-finish` `/sp-skill-new` `/sp-help` | superpowers process skills |
| `/ui-*` (8) | `/ui-build` `/ui-tokens` `/ui-style` `/ui-direction` `/ui-design-asset` `/ui-banner` `/ui-slides` `/ui-brand` | Design skills — every one hard-wires Dime brand precedence |
| `/stripe` (1) | `/stripe` | stripe-best-practices, grounded in this repo's payment code |

**Canonical chains**

- Discovery: `/pm-problem` → `/pm-probe` → `/pm-story` → `/pm-epic` → `/pm-prioritize`
- Full-stack build loop: `/pm-problem` → `/pm-story` → `/sp-plan` → `/sp-tdd` → `/ui-build` → `/sp-verify` → `/sp-review-ask` → `/sp-finish`

---

## Governing law (not skills — above skills)

| File | Role |
|---|---|
| `design-system/dime-ai/MASTER.md` | Dime brand rules: one-accent mint `#45E0A8` (`#0FA36B` text-on-light), Familjen Grotesk + IBM Plex Mono, 160ms motion, anti-patterns, delivery checklist |
| `design-system/dime-ai/pages/ai-model-projections.md` | Feed-page overrides + `games.list` backend data contract |
| `dime-ai/` | Brand kit source of truth: design bundle, reference pages, logos, migration draft |
| `CLAUDE.md` | Session boot map (arsenal + precedence + conventions) |

**When skills disagree with the law, the law wins. When skills disagree with each other:
brand law > frontend-design taste > uipro reference data. Process skills govern *how*,
never *what*.**

---

## Maintaining the arsenal

- **Add a plugin skill:** `claude plugin install <name>@<marketplace> -s project` → commit `.claude/settings.json`
- **Add a universal skill:** `npx skills add <github-repo> --skill <name>` → commit `.agents/`, symlink, `skills-lock.json`
- **Add a command:** drop a `<name>.md` with `$ARGUMENTS` into `.claude/commands/` → commit
- **Author a new skill:** `/sp-skill-new` (TDD for documentation — baseline-test before writing)
- **Prune cost:** each enabled plugin adds ~80 always-on tokens/session; disable in `.claude/settings.json` if a layer goes unused
