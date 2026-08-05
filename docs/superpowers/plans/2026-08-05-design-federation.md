# Design Federation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A thin orchestrator (`design-federation` skill + `/ui-loop` command) that routes Dime UI work across the five vendored design systems — uipro (research), frontend-design (art direction), taste family (expressive specialist), emil (motion), impeccable (design ops, newly vendored) — under Dime brand law as final authority, with a required lead declaration, brief, and evidence bundle.

**Architecture:** No monolith: the orchestrator only classifies the surface, declares exactly one aesthetic Lead, runs the loop (brief → research → direction → build → observe → audit → repair), and demands evidence. All design knowledge stays in the five upstream systems; all visual authority stays in `design-system/dime-ai/` + `dime-ai/THREE-COLOR-LAW.md`. Impeccable is vendored at a pinned commit (Apache-2.0), hooks deliberately not wired.

**Tech Stack:** Markdown skills (`.claude/skills/`), `.claude/commands/` wrappers, existing verify skill + playwright for observation, impeccable detector (Node ≥22.18) for deterministic audit.

## Global Constraints

- Dime brand law is final: reading order = `design-system/dime-ai/pages/<page>.md` (overrides) → `design-system/dime-ai/MASTER.md`, with `dime-ai/THREE-COLOR-LAW.md` winning wherever they disagree (incl. v3's owner-approved motion rules — scoping it to "color/surface" was a review-confirmed defect, fixed 2026-08-05) and `design-system/dime-ai/TYPOGRAPHY.md` orthogonal (size/rhythm/measure/wrap). Locked: mint `#45E0A8` (`#0FA36B` mint text on light), Familjen Grotesk (Plex Mono retired 2026-07-24 in shipped code; MASTER.md still lists it for micro-labels — cite both, do not resolve), 160ms `cubic-bezier(0.16, 1, 0.3, 1)` one-curve law, no gradients/purple/neon-green/gold.
- The orchestrator must NEVER restate brand tokens as its own rules — reference the law files by path (single source of truth; four places already state the precedence).
- Exact dial spellings: taste = `DESIGN_VARIANCE` / `MOTION_INTENSITY` / `VISUAL_DENSITY` (1–10, conversational); uipro CLI = `--variance/--motion/--density` (only with `--design-system`). Never alias.
- `frontend-design` and `review-animations` are NOT Skill-tool-invocable in Claude Code sessions — they load via Read on their SKILL.md paths.
- uipro `--persist` writes `design-system/<project-slug>/` — the slug `dime-ai` is the brand-law directory; a persist targeting it, or a second persisted tree governing an already-governed surface, is forbidden.
- Changes to `design-system/dime-ai/**` are owner-directive territory: propose via PR + decision record, never silently edit.
- No commits in this session (harness law: commit only when the user asks). Branch/commit/PR listed as a deferred final step for the owner.
- Skills placed in `.claude/skills/` are auto-seen by pi (`.pi/settings.json` includes `../.claude/skills`); `.agents/skills/` is NOT in pi's include list.

---

### Task 1: Vendor impeccable at pinned commit — ✅ DONE (this session)

**Files:**

- Create: `.claude/skills/impeccable/` (SKILL.md v4.0.4, `reference/` ×35 + `degraded/` ×4, `scripts/`, LICENSE, NOTICE.md, VENDOR.md)
- Create: `.claude/agents/impeccable-{asset-producer,documenter,finish-reviewer,manual-edit-applier}.md`

- [x] **Step 1:** Clone `pbakaus/impeccable` at `ae5e95101a6979e7f7973a4ff57680b3c7adc1ec`, copy `.claude/skills/impeccable/` + LICENSE + NOTICE.md + the four `.claude/agents/` subagents into the repo.
- [x] **Step 2:** Write `VENDOR.md` (provenance, pin, license, hook wiring deliberately NOT merged — opt-in via `.claude/settings.local.json`, documented there).
- [x] **Step 3:** Verify none of it is gitignored: `git status --porcelain .claude/skills/impeccable .claude/agents | head` shows `??` entries. Expected: files listed, not silent.

### Task 2: RED baselines — ✅ DONE (workflow `wf_8fb419f5-ae1`)

Three plan-only scenarios without the orchestrator. Observed failures the skill must fix:

1. Four aesthetic authorities stacked on one surface, no declared lead, frontend-design never considered (invisible — not in Skill roster).
2. uipro `--persist` created a rival `design-system/dime-feed/` tree for a surface already governed by `design-system/dime-ai/pages/ai-model-projections.md`.
3. Motion diff shipped without the `review-animations` Block/Approve gate (invisible — `disable-model-invocation: true`).
4. No standardized evidence artifact; verification described ad hoc.

Form of the fix (writing-skills "Match the Form to the Failure"): omission/shaping failures → positive recipe + REQUIRED structural slots + observable-predicate conditionals. Not prohibition tables.

### Task 3: Author the design-federation skill

**Files:**

- Create: `.claude/skills/design-federation/SKILL.md` (the recipe; <150 lines)
- Create: `.claude/skills/design-federation/references/routing.md` (full invocation surfaces)
- Create: `.claude/skills/design-federation/references/brief-template.yaml`
- Create: `.claude/skills/design-federation/references/evidence-bundle.md`
- Create: `.claude/skills/design-federation/references/registry.md` (five systems: pins, licenses, scopes, conflict rules)

**Interfaces:**

- Consumes: skill IDs and Read-paths as verified by the understand workflow (`wf_ea461d55-c4a`); brand-law reading order; verify skill; impeccable commands/detector.
- Produces: the `Lead declaration` + `brief` + `evidence bundle` contract that Task 4's command and Task 6's GREEN scenarios rely on.

- [x] **Step 1:** Write the five files with the exact content authored in this session (content is the deliverable; the GREEN scenarios in Task 5 are its test).
- [x] **Step 2:** Sanity-check frontmatter: `name: design-federation`, description starts "Use when", no workflow summary in the description (SDO rule), <1024 chars.
- [x] **Step 3:** `wc -w .claude/skills/design-federation/SKILL.md` — accepted at ~830 words body (over the ~600 target; the routing table + conditionals earn their words, detail stays in references/).

### Task 4: Command wrapper + doc sync

**Files:**

- Create: `.claude/commands/ui-loop.md`
- Modify: `CLAUDE.md` (arsenal table: impeccable + design-federation rows; custom-commands note for `/ui-loop`)
- Modify: `SKILLS.md` (command count 33→34; source table rows; precedence section pointer)
- Modify: `AGENTS.md` (mirror rows; CLAUDE.md wins on conflict)

- [x] **Step 1:** Write `ui-loop.md` in the house style of the other 5-line `ui-*` wrappers, pointing at the design-federation skill with `$ARGUMENTS`.
- [x] **Step 2:** Read the exact SKILLS.md / AGENTS.md sections before editing; keep each edit to the minimal rows/count bumps; verify with `grep -n "All 34\|design-federation\|impeccable" SKILLS.md AGENTS.md CLAUDE.md`.

### Task 5: GREEN — re-run the three RED scenarios with the skill loaded

- [x] **Step 1:** Workflow: same three prompts + instruction that the design-federation skill exists (agents read it from disk). Schema adds `lead_declared`, `gates_run`, `evidence_bundle`.
- [x] **Step 2:** Pass criteria (all met): S1 declares exactly ONE aesthetic lead (others critic-only); S2 refuses a rival persisted tree for a governed surface (folds findings via PR-able override proposal instead); S3 includes the review-animations Read-gate with Block/Approve; all three name the evidence bundle.
- [x] **Step 3:** Any miss → tighten the specific recipe slot (not add prohibitions), re-run that scenario once.

### Task 6: Adversarial review + wrap

- [x] **Step 1:** Review workflow over all new/modified files: (a) contradiction hunt vs MASTER.md/THREE-COLOR-LAW/CLAUDE.md precedence; (b) path/ID correctness (every skill ID, Read path, CLI flag verified against disk); (c) license/provenance compliance (Apache-2.0 NOTICE, MIT attributions); (d) drift check on SKILLS.md/AGENTS.md counts.
- [x] **Step 2:** Fix confirmed findings; re-verify fixed files only.
- [ ] **Step 3:** Report to owner. Deferred (needs owner ask): `git checkout -b feat/design-federation && git add <new files> && git commit` — do not commit in this session.

## Self-Review

- Spec coverage: federation doc's Phase-1 deliverables (orchestrator, routing, brief schema, evidence bundle, impeccable install, registry pinning) → Tasks 1, 3, 4. Phase-2+ (CI gates, waivers, agent graph, vertical packs) deliberately out of scope — Phase 1 first, per the doc's own sequence; noted in final report.
- The doc's `PRODUCT.md`/`DESIGN.md` are not created: this repo already has their equivalents (CLAUDE.md + dime-ai/README.md product truth; design-system/dime-ai/ as DESIGN.md+MASTER.md fused). Creating rivals would violate the doc's own "one canonical source" rule.
- Type consistency: names used throughout — `design-federation` (skill), `/ui-loop` (command), `Lead declaration`, `evidence bundle` — match across Tasks 3–5.
