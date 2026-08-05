# Engineering Federation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Federate the owner-supplied "Production-Grade Engineering Reference Architecture" (v1.0, 2026-08-05) as a repo skill — the backend/infra sibling of `design-federation`: a thin router + control standard with the full document vendored as the canonical reference, Dime-specific control mapping, routing to the existing process/architecture skills, and an `/eng-loop` entry point.

**Architecture:** Same pattern as design-federation (see `2026-08-05-design-federation.md`, merged as PR #360): the skill holds routing, precedence, conditionals, and the evidence contract; all depth lives in `references/`. The vendored standard governs *controls and evidence*; `architect-backend-systems` (+ its own `references/architecture-standard.md`) remains the routed specialist for *design method* — precedence resolved explicitly so the repo never has rival standards.

**Tech Stack:** Markdown skill (`.claude/skills/engineering-federation/`), `.claude/commands/eng-loop.md`, existing gates as fitness functions (tsc, vitest, gitleaks, osv-scanner, `smoke-deploy.mjs`, `db-push.yml`, `reconciled-migrate.mjs`).

## Global Constraints

- Repo law outranks the standard: merge to main IS a production deploy; schema changes require the manual `db-push.yml` workflow (Production-gated, `reconciled-migrate.mjs` plan/apply with `JOURNAL_PROFILE=railway-production-v1`) BEFORE dependent code deploys; pnpm only; never commit secrets; Railway mutations and credentials follow AGENTS.md operating rules.
- The vendored standard is adapted by *mapping*, not by editing: the document stays as supplied (transport mojibake restored — `â` → `—`, `Ã—` → `×`, box-drawing chars, etc.; a restoration note in the mapping file). Dime deltas live in `references/dime-mapping.md`.
- Known contract deltas the mapping must own: tRPC + zod is the API contract layer (OpenAPI applies only to non-tRPC public surfaces); MySQL/Drizzle not PostgreSQL (HypoPG-class tooling N/A); Railway managed platform not Kubernetes (Profile A); Railway edge is the reverse proxy (no self-hosted Envoy/Caddy layer today); no distributed cache/Valkey in the stack today — "complexity must earn its existence" applies.
- §23 rule carried over: an N/A control needs a concrete reason; silence is not evidence.
- New `.claude/skills/` dirs are gitignored by default — add the negation (pi-harness precedent).
- No commits in this session unless the user asks; report and offer the PR.

---

### Task 1: RED baselines — two plan-only scenarios without the skill

- [x] **Step 1:** Launch two background agents: (a) schema change + backfill + deploy sequence for a `favorite_count` feed field; (b) rate limiting for the public feed API (dimensions, store, failure mode, client identity behind Railway's proxy).
- [x] **Step 2:** Score against the standard: db-push-before-code law, expand–migrate–contract, bounded/resumable backfill, idempotency, limiter failure policy by route class, no invented infrastructure, evidence record + terminal outcome. Record verbatim failures; they drive SKILL.md emphasis (recipe + required slots, not prohibitions).

### Task 2: Vendor the standard

**Files:**

- Create: `.claude/skills/engineering-federation/references/production-grade-engineering-architecture.md` (full v1.0 text, mojibake-restored, otherwise verbatim)

- [x] **Step 1:** Write the document in sequential chunks (≈50 KB); verify section count (§1–§26) and spot-check tables/mermaid blocks against the supplied file.

### Task 3: Author the skill

**Files:**

- Create: `.claude/skills/engineering-federation/SKILL.md` — thin router: authority chain, the §21.1 execution loop adapted to repo commands, routing table (which existing skill/command leads which class of backend work), hard conditionals (schema → db-push law; destructive migration → owner gate; new infra component → "earn its existence" ADR; claim of done → evidence record), common-mistakes table from RED.
- Create: `.claude/skills/engineering-federation/references/dime-mapping.md` — control-by-control mapping of the standard's §§9–17, 20, 23 onto this repo's real mechanisms, with explicit N/A reasons and "verify at use time" rows (no false compliance claims).
- Create: `.claude/skills/engineering-federation/references/routing.md` — exact invocation surfaces: architect-backend-systems (+ precedence vs its architecture-standard.md), architect-github-repos, superpowers TDD/debugging/verification, verify skill, intended-vs-implemented, code-review-excellence, `/ship`, `/gh-fix`, security-review, and the evidence-record template (§21.3 YAML adapted).

**Interfaces:**

- Produces: `Evidence record` + `terminal outcome` contract consumed by Task 4's command and Task 5's GREEN scenarios.

- [x] **Step 1:** Write the three files; SKILL.md stays a router (≤ ~120 lines), depth in references.
- [x] **Step 2:** Frontmatter SDO check: `name: engineering-federation`, description "Use when…" triggering-conditions only, <1024 chars.

### Task 4: Command + doc sync

**Files:**

- Create: `.claude/commands/eng-loop.md` (house style, `$ARGUMENTS`)
- Modify: `.gitignore` (negation `!.claude/skills/engineering-federation/`)
- Modify: `CLAUDE.md` (arsenal row), `SKILLS.md` (counts 101→102 flat / 34→35 templates + note), `AGENTS.md` (skills summary line)

- [x] **Step 1:** Write command; add negation; apply the three doc edits (pipe-aligned CLAUDE.md row via the same padding script as PR #360).

### Task 5: GREEN — re-run both scenarios with the skill loaded

- [x] **Step 1:** Same prompts + "Read the engineering-federation SKILL.md first and follow it."
- [x] **Step 2:** Pass criteria (all met): schema scenario sequences db-push before dependent code deploy and designs a bounded resumable backfill with N/N-1 compatibility; rate-limit scenario classifies route failure policy, derives identity from Railway's trusted forwarding only, and does not invent a distributed store without an "earn its existence" justification; both produce the evidence record with a terminal outcome.
- [x] **Step 3:** No misses — no re-runs needed. Bonus: GREEN inspection surfaced two live security findings for the owner (batched-login limiter evasion; public forceRefresh cache bypass on games.list).

### Task 6: Verify + wrap

- [x] **Step 1:** Claims-vs-disk pass: every path, command, and count stated in the new files verified against the repo.
- [ ] **Step 2:** Report; offer branch + PR (pattern: PR #360). No commit without the ask.
