# PREZ AI — SKILLS DIRECTORY & OPERATING MAP

> The complete arsenal: **91 skills · 32 invocable commands · 2 auto-resolving marketplaces ·
> universal + project skill directories.** Every session on this repo inherits all of it on boot.
> This file is both the inventory and the operating manual: how to **call, trigger, execute,
> streamline, and subagent-execute** every skill.
>
> Precedence law: `design-system/dime-ai/MASTER.md` beats any skill's style output. Always.

---

## 1 · How the collective loads

| Mechanism | Carries | Config |
|---|---|---|
| Project skills dir | uipro's 7 design skills | `.claude/skills/` (committed) |
| Universal skills dir | npx-installed skills — usable by 17 agent platforms | `.agents/skills/` + `skills-lock.json`; Claude Code symlinks in `.claude/skills/` |
| Plugin system | superpowers (14) + pm-skills (55) | `.claude/settings.json` → `extraKnownMarketplaces` + `enabledPlugins` (project scope; auto-installs in fresh containers) |
| Commands | 30 slash commands | `.claude/commands/` |
| Session maps | `CLAUDE.md` (boot map) · this file (deep directory) | repo root |

Marketplaces: `claude-plugins-official` (anthropics/claude-plugins-official) · `pm-skills` (deanpeters/Product-Manager-Skills).

---

## 2 · The operating model

### 2.1 Three ways to CALL any skill

| Surface | Form | Use when |
|---|---|---|
| Slash command | `/pm-story <rich context>` | You want the structured-output contract baked into `.claude/commands/` — fastest, most consistent |
| Direct skill | `Use the user-story skill on …` / `superpowers:writing-plans` | You need the skill without the command's output contract, or it has no command |
| Natural trigger | Just describe the task | Skill descriptions are trigger-matched ("use when…") — the session self-selects. Least deterministic; fine for obvious matches |

**`$ARGUMENTS` quality is the throttle.** `/pm-story checkout` is thin.
`/pm-story checkout abandonment for returning customers with saved payment info` lets the
skill ask smart questions. Feed commands sentences, not topics.

### 2.2 Three EXECUTION tiers (know what you invoked)

| Tier | Shape | Time | Examples |
|---|---|---|---|
| Component | One-shot deliverable template | minutes | `user-story`, `positioning-statement`, `proto-persona`, `press-release` |
| Interactive | Multi-turn guided flow — expects your answers | one sitting | `prioritization-advisor`, `pol-probe-advisor`, all `*-advisor`, `*-workshop` |
| Workflow | Multi-phase orchestrator that chains other skills | spans sessions | `discovery-process`, `roadmap-planning`, `product-strategy-session`, `prd-development`, superpowers' brainstorm→plan→execute spine |

Streamlining rule: **components inside interactives inside workflows.** Never run a workflow
to get a component's output.

### 2.3 The SUBAGENT doctrine (`/sp-subagents` → `superpowers:subagent-driven-development`)

The single biggest streamlining lever. Fresh subagent per task + two-stage review
(spec compliance, then code quality) + one broad final review.

**When to route work through subagents:**

| Situation | Play |
|---|---|
| Executing any written plan (3+ tasks) | `/sp-subagents` — implementer per task, task-reviewer after each, fix-loop until approved, ledger in `.superpowers/sdd/progress.md` |
| 2+ independent research/read tasks | `/sp-parallel` — concurrent read-only agents, synthesize results |
| One big read (audit, codebase sweep) | Single Explore subagent — conclusions return, file dumps don't pollute the controller |
| Tightly-coupled edits, single file, conversation | Stay inline — dispatch overhead exceeds the win |

**Dispatch mechanics (non-negotiables from the skill):**
- Task brief as a **file**, not pasted text; report file named after the brief
- Reviewer gets brief + report + `review-package BASE..HEAD` diff file
- **Never dispatch parallel implementers** (conflicts); parallel is for reads
- Model selection: transcription tasks → cheapest tier; integration → standard; architecture + final whole-branch review → most capable. Specify the model explicitly on every dispatch
- Progress ledger survives compaction — trust it and `git log` over memory

**Where subagents slot into NON-code skills:** any PM workflow phase that is *research or
generation over many inputs* — e.g. `discovery-process` interview synthesis (one agent per
transcript batch), `company-intel` (one agent per competitor), `roadmap-planning` Phase 1
(parallel agents for OKR review / customer problems / tech constraints / stakeholder asks),
`stakeholder-identification` (one agent per org area). The controller keeps the framework;
subagents do the reading.

---

## 3 · Layer-by-layer operating map

### Layer A — Engineering process (14 · superpowers · invoke `superpowers:<name>` or `/sp-*`)

| Skill | Use when | Command |
|---|---|---|
| `using-superpowers` | Session start — skill discovery and routing | `/sp-help` |
| `brainstorming` | Before ANY creative work; hard-gates implementation until design approval | `/sp-brainstorm` |
| `writing-plans` | Spec in hand, before code — bite-sized TDD tasks, exact paths, zero placeholders | `/sp-plan` |
| `executing-plans` | Executing a plan in a separate/parallel session with checkpoints | `/sp-execute` |
| `subagent-driven-development` | Executing a plan in THIS session — fresh subagent per task | `/sp-subagents` |
| `dispatching-parallel-agents` | 2+ independent tasks, no shared state | `/sp-parallel` |
| `test-driven-development` | Any feature/bugfix — failing test first, always | `/sp-tdd` |
| `systematic-debugging` | Any bug/failure — root cause with evidence before fixes | `/sp-debug` |
| `verification-before-completion` | Before claiming done — command output or it didn't happen | `/sp-verify` |
| `requesting-code-review` | Work complete, pre-merge | `/sp-review-ask` |
| `receiving-code-review` | Feedback arrived — verify before implementing | `/sp-review-apply` |
| `using-git-worktrees` | Feature work needs isolation | `/sp-worktree` |
| `finishing-a-development-branch` | Tests green — merge/PR/cleanup decision | `/sp-finish` |
| `writing-skills` | Creating/editing skills — TDD for documentation | `/sp-skill-new` |

**Operate:** this layer is the **spine**, not a menu — brainstorm → plan → subagents →
verify → review → finish is one pipeline. Trigger discipline: the moment you think "this is
too simple to need X," that's the trigger for X. **Subagent play:** `/sp-subagents` IS the
execution engine; `/sp-tdd` runs *inside* each dispatched implementer; `/sp-verify` gates
every task-complete claim; the final whole-branch review dispatches on the most capable model.

### Layer B — Design intelligence (7 · uipro · `.claude/skills/`)

| Skill | Use when | Command |
|---|---|---|
| `ui-ux-pro-max` | Plan/build/review any UI — 67 styles, 161 palettes, 57 pairings, 21 stacks, dials | `/ui-build` |
| `design-system` | Token architecture, component specs, Master+Overrides persistence | `/ui-tokens` |
| `ui-styling` | shadcn/Tailwind implementation, a11y, dark mode | `/ui-style` |
| `design` | Producing assets — logos, CIP, icons, social, banners | `/ui-design-asset` |
| `brand` | Voice, identity standards, consistency audits, asset validation | `/ui-brand` |
| `banner-design` | Social/ads/web/print banners | `/ui-banner` |
| `slides` | HTML presentations with Chart.js + tokens | `/ui-slides` |

**Operate:** always **within `/ui-brand` context** — every `/ui-*` command already hard-wires
`design-system/dime-ai/MASTER.md` precedence; palette/font generator output is reference data,
never law. CLI trigger for evidence, not vibes:
`python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<query>" --stack react --density 8 --motion 2`.
**Subagent play:** parallel read-agents for design research (one per reference page or
competitor surface); implementation of UI plans goes through `/sp-subagents` with MASTER.md's
Pre-Delivery Checklist pasted into every task reviewer's constraints block.

### Layer C — Design taste (1 · Anthropic official)

| Skill | Use when | Command |
|---|---|---|
| `frontend-design` | New/reshaped UI needs a distinctive, non-templated direction — one justifiable aesthetic risk | `/ui-direction` |

**Operate:** invoke ONCE per surface at direction-setting time (before `/sp-plan`), not during
implementation. Constraint: distinctiveness through typography/spacing/composition — the Dime
palette is closed. **Subagent play:** generate 2–3 direction candidates via parallel agents,
judge against MASTER.md, then lock direction into the spec.

### Layer D — Payments (1 · Stripe official)

| Skill | Use when | Command |
|---|---|---|
| `stripe-best-practices` | Any Stripe build/change/review — API selection, billing, webhooks, key security | `/stripe` |

**Operate:** grounded in repo touchpoints (`server/stripeWebhook.ts`, `/pricing`, `/account`,
Profile plan labels). Trigger on ANY payment-adjacent diff, not just new features.
**Subagent play:** a dedicated reviewer subagent armed with the skill's `references/security.md`
+ `billing.md` as its constraints block for every payments PR.

### Layer E — Product management (55 · pm-skills · invoke by name)

**E1 · Discovery & problem framing (11):** `problem-statement`, `problem-framing-canvas`,
`jobs-to-be-done`, `discovery-process`, `discovery-interview-prep`, `opportunity-solution-tree`,
`pol-probe`, `pol-probe-advisor`, `lean-ux-canvas`, `epic-hypothesis`, `derisk-measurement-advisor`
> **Operate:** the front door of every initiative. Chain: `/pm-problem` → `jobs-to-be-done`
> → `/pm-probe`. Never start a PRD or roadmap with an unframed problem. **Subagent play:**
> parallel agents for interview synthesis, JTBD evidence gathering, probe-result analysis.

**E2 · Definition & delivery (9):** `user-story` (`/pm-story`), `user-story-splitting`,
`user-story-mapping`, `user-story-mapping-workshop`, `epic-breakdown-advisor` (`/pm-epic`),
`prd-development` (`/pm-prd`), `press-release`, `storyboard`, `prioritization-advisor` (`/pm-prioritize`)
> **Operate:** converts framed problems into build-ready artifacts — the hinge between PM
> layers and the superpowers spine: `/pm-story` output feeds `/sp-plan` directly. **Subagent
> play:** one agent per epic for parallel story generation; controller dedupes and sequences.

**E3 · Strategy & positioning (10):** `product-strategy-session`, `roadmap-planning` (`/pm-roadmap`),
`positioning-statement`, `positioning-workshop`, `proto-persona`, `customer-journey-map`,
`customer-journey-mapping-workshop`, `pestel-analysis`, `tam-sam-som-calculator`,
`company-intel` / `company-research`
> **Operate:** `roadmap-planning` is the orchestrator — 5 phases (inputs → epics → prioritize
> → sequence → communicate); it *consumes* `epic-hypothesis` and `prioritization-advisor`.
> Roadmaps are Now/Next/Later hypotheses, never feature lists or date contracts. **Subagent
> play:** Phase 1 input-gathering fans out (goals / problems / constraints / requests, one
> agent each); `company-intel` runs one agent per competitor.

**E4 · Growth & finance (8):** `business-health-diagnostic`, `saas-revenue-growth-metrics`,
`saas-economics-efficiency-metrics`, `finance-metrics-quickref`, `finance-based-pricing-advisor`,
`feature-investment-advisor`, `acquisition-channel-advisor`, `organic-growth-advisor`
> **Operate:** decision gates, not dashboards — invoke when a *specific* money decision is
> live (price change, channel scale/kill, feature ROI). `finance-metrics-quickref` is the
> only always-cheap lookup. **Subagent play:** metric-pull agents feed the advisor; the
> advisor runs inline (it needs your answers).

**E5 · Stakeholders & facilitation (5):** `stakeholder-identification`, `stakeholder-mapping`,
`stakeholder-engagement-advisor`, `workshop-facilitation`, `eol-message`
> **Operate:** identification → mapping → engagement, in that order. `workshop-facilitation`
> is the interaction protocol the `*-workshop` skills delegate to. **Subagent play:** org-area
> agents for identification; engagement planning stays inline (relationship nuance).

**E6 · AI product practice (4):** `recommendation-canvas`, `ai-shaped-readiness-advisor`,
`agent-orchestration-advisor`, `context-engineering-advisor`
> **Operate:** meta-tools for THIS system — `agent-orchestration-advisor` when a PM task
> should become parallel agents; `context-engineering-advisor` when a workflow feels bloated.
> They tune the arsenal itself.

**E7 · Career & leadership (5):** `altitude-horizon-framework`, `director-readiness-advisor`,
`vp-cpo-readiness-advisor`, `executive-onboarding-playbook`, `product-sense-interview-answer`
> **Operate:** personal-development track; on-demand, never chained. Keep out of build loops.

**E8 · Meta (3):** `pm-skill-creator`, `skill-authoring-workflow`, + `superpowers:writing-skills`
> **Operate:** the arsenal grows itself — idea → `pm-skill-creator` (shape) →
> `skill-authoring-workflow` (compliance) → `superpowers:writing-skills` (TDD: baseline-fail
> before writing, close loopholes after). **Subagent play:** pressure-test scenarios run as
> subagents WITHOUT the draft skill (RED), then with it (GREEN).

### Layer F — Advertising (12 · realkimbarrett/advertising-skills · `.agents/skills/`)

`avatar-extraction` · `offer-extraction` · `schwartz-awareness-mapper` · `headline-matrix` ·
`mechanism-builder` · `objection-crusher` · `ad-angle-multiplier` (creative testing) ·
`scroll-stopping-creative` · `conversion-path-builder` · `performance-diagnosis` ·
`generic-language-killer` · `full-funnel-campaign-orchestrator`

> **Operate:** the growth counterpart to the PM layer — invoke when the work is ACQUIRING
> users, not building product: landing/ad copy, paid campaigns, funnel design, creative
> testing. `full-funnel-campaign-orchestrator` is the workflow tier; the rest are
> components. `generic-language-killer` doubles as a copy QA gate for ANY marketing
> surface (run it on landing page copy before shipping). Dime brand law still governs all
> visual output. **Subagent play:** `ad-angle-multiplier` fans out naturally — one agent
> per angle batch; `performance-diagnosis` gets campaign exports as file handoffs.

---

## 4 · Canonical chains (trigger → execute → verify)

Each chain names where `/sp-subagents` takes over. Bold = subagent-executed stage.

**C1 · Feature, end-to-end (the user's canonical example, formalized)**
`/sp-brainstorm` the task → `jobs-to-be-done` for the customer job → design gate approved →
`/sp-plan` → `/ui-build` *within* `/ui-brand` law → **`/sp-subagents` executes the plan**
(TDD inside each implementer) → `/sp-debug` on any failure → `/sp-verify` with command
evidence → `/sp-review-ask` → `/sp-finish`.

**C2 · Discovery → committed roadmap**
`/pm-problem` → `/pm-probe` (kill weak hypotheses cheaply) → `/pm-story` → `/pm-epic` →
`/pm-prioritize` → `/pm-roadmap` (Now/Next/Later; **Phase-1 inputs gathered by parallel
agents**) → top "Now" epic feeds C1.

**C3 · New product surface (Dime pattern — proven this session)**
`/pm-problem` → `proto-persona` + `jobs-to-be-done` → `/ui-direction` (one aesthetic risk,
palette closed) → static prototype in `dime-ai/reference-pages/` → `/ui-brand` audit →
`/sp-plan` the React build → **`/sp-subagents`** → `/sp-verify` (render + screenshot) →
`/sp-finish`.

**C4 · Pricing / membership change**
`finance-based-pricing-advisor` (ARPU/churn/NRR gate) → `/pm-probe` the riskiest assumption →
`/stripe` for implementation review → **`/sp-subagents`** for the code → dedicated Stripe
security reviewer subagent → `/sp-verify`.

**C5 · Incident / bug**
`/sp-debug` (root cause with evidence — no fixes first) → failing test via `/sp-tdd` →
fix → `/sp-verify` → if systemic, `/pm-problem` to decide whether product work exists.

**C6 · Growing the arsenal**
Gap identified → `pm-skill-creator` → `skill-authoring-workflow` → `/sp-skill-new`
(**baseline pressure-tests as subagents**, RED→GREEN→REFACTOR) → install per §6 → row added here.

---

## 5 · Maximization roadmap (Now / Next / Later)

*Structured per `roadmap-planning`: outcome-framed epics, not a feature list. Each item names
its chain and success signal.*

**NOW — committed**
| Epic | Chain | Success signal |
|---|---|---|
| Dime Feed Phase A (shell + feed pane in React, live `games.list`) | C1, spec = `dime-ai/DIME-FEED-MIGRATION-DRAFT.md` + MASTER.md | `/feed` data renders in Dime shell behind test route; checklist green |
| CI fully green | C5 on remaining Vitest secrets gap | all 3 stages pass on main |
| Arsenal adoption | this file + `CLAUDE.md` in every session | chains invoked by name, zero re-explaining |

**NEXT — high confidence**
| Epic | Chain | Success signal |
|---|---|---|
| Feed Phases B–C (token bridge, card redesign) | C1 with **`/sp-subagents`** per component cluster | `#39FF14` count in feed code → 0 |
| Dime Chat reskin on shell | C3 | chat + feed share one shell, SSE core untouched |
| Membership surface (PRO menu, upgrade/cancel) | C4 | Stripe flows reviewed against skill references |

**LATER — exploration**
| Epic | Chain | Success signal |
|---|---|---|
| Trends pane (nightly-trends data → read procedure) | C2 first (is it wanted?) → C1 | sidebar "Trends" live |
| Chat persistence (`dime_conversations`) | C1 | Recent Chats survive sessions |
| Growth instrumentation | E4 gates on real usage data | pricing/channel decisions made with `saas-*-metrics` |
| Landing → production swap | C3 finish | `LandingPage.tsx` replaced, 21+/RG language intact |

Re-sequence quarterly; roadmap is hypothesis, not contract.

---

## 6 · Governing law & maintenance

**Law (above all skills):** `design-system/dime-ai/MASTER.md` + `pages/*.md` overrides →
`dime-ai/` brand kit → `CLAUDE.md` boot map. Conflicts: brand law > `frontend-design` taste >
uipro reference data. Process skills govern *how*, never *what*. Backend contracts in
`design-system/dime-ai/pages/ai-model-projections.md` are inviolable.

**Maintenance:**
- Plugin skill: `claude plugin install <name>@<marketplace> -s project` → commit `.claude/settings.json`
- Universal skill: `npx skills add <repo> --skill <name>` → commit `.agents/`, symlink, lockfile
- Command: drop `<name>.md` with `$ARGUMENTS` in `.claude/commands/` → commit
- New skill: chain C6 — no skill without a failing baseline test first
- Cost control: ~80 always-on tokens per enabled plugin; prune unused layers in `.claude/settings.json`
