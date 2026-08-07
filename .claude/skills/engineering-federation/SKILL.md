---
name: engineering-federation
description: Use when backend or infrastructure work touches a production boundary — API/tRPC contracts, auth/sessions, schema or data migrations, backfills, rate limiting, caching, containers/deploy, telemetry, resilience — when a change needs a deploy sequence to production, when adding any new infrastructure component, or before claiming backend work is done. Also use when more than one engineering skill could plausibly lead (architect-backend-systems, superpowers process skills, verify, intended-vs-implemented) and the routing is not already decided.
---

# Engineering Federation

## Overview

The backend/infra sibling of `design-federation`. The vendored **Production-Grade Engineering Reference Architecture** (`references/production-grade-engineering-architecture.md`, v1.0, owner-supplied 2026-08-05) is the control standard: boundaries, fitness functions, failure policies, evidence contract, definition of done. This skill routes work to the owning specialist, applies the standard through its Dime mapping, and demands the standard's evidence. **Any system may advise a decision; exactly one system owns it.**

Skip it for: pure frontend/UI work (that's `design-federation` / `/ui-loop`) and trivial fixes that touch no trust boundary, contract, schema, or deploy behavior.

## Authority chain

1. Owner/user direction, and owner-gated boundaries (production mutation, destructive data changes, Railway operations per AGENTS.md operating rules).
2. Repo law: merge to `main` IS a production deploy · schema reaches production via the manual `db-push.yml` workflow BEFORE dependent code deploys · pnpm only · never commit secrets · the feed data contracts (`design-system/dime-ai/pages/ai-model-projections.md`, `dime-ai/DIME-FEED-MIGRATION-DRAFT.md`).
3. The vendored standard, as adapted by `references/dime-mapping.md` (tRPC not OpenAPI, MySQL/TiDB not Postgres, Railway not Kubernetes, single-replica law). An N/A control needs a concrete reason — silence is not evidence (§23).
4. The routed skill's own guidance — including `.agents/skills/architect-backend-systems/references/architecture-standard.md`, which governs *design method*; the vendored standard governs *controls and evidence*. Where they genuinely conflict, repo law then the vendored standard win, and the conflict is flagged to the owner.
5. Generic defaults.

## The loop (standard §21.1, mapped)

Every federated job produces three required artifacts: a **classification**, a **baseline**, and an **evidence record**.

1. **Inspect** — read the actual repo/runtime/schema state. Never invent paths, env vars, schemas, deployment state, or test results.
2. **Classify** — trust boundary + failure impact (security / data / availability / release), using the mapping's boundary table. Classification picks the gates.
3. **Baseline** — record current behavior before mutating: exact `git` revision, relevant metrics or outputs (latency, test status, row counts, config). No baseline, no before/after claim.
4. **Own** — identify the owning component and every affected contract (tRPC router types, schema journal, config, policy). Route design questions per the routing table below.
5. **Define done first** — deterministic completion conditions + rollback/containment, written before implementing.
6. **Build small** — the smallest complete change inside the existing architecture. New infrastructure must pass the earn-its-existence conditional below.
7. **Inspect the diff** — full changed-file inventory, dependency changes, build-context impact.
8. **Gate** — focused checks, then the full required set from the mapping's fitness-function table (tsc, gated vitest, build, and the class-specific gates).
9. **Prove live** — for production-boundary changes, rendered/runtime proof via the `verify` skill or deploy-smoke, not unit tests alone. **The Cloudflare edge is armed: automated clients — curl, headless browsers, CI runners, you — are 403'd on document routes by design.** Set `EDGE_AGENT_BYPASS_KEY` (sent as `x-dime-agent`, matched by a Cloudflare Skip rule) before running `scripts/smoke-deploy.mjs` against production, and never point it at the raw `*.up.railway.app` origin. A 403 here is the bot defense working, not an outage — misreading it has already produced both a false P0 and four red deploys.
10. **Record** — a filled §21.3 block, not a prose claim: copy `references/record-template.yaml` (a real file — never retype it from memory), fill it with verbatim gate output, paste it into the PR body under `## Evidence record (engineering-federation §21.3)`, and close with a terminal outcome from the fixed enum. A partially implemented change is never `shipped`. Do not relocate the record to a per-PR file — `routing.md` explains which owner decision governs that.

## Routing

| Work | Lead | Notes |
| --- | --- | --- |
| Architecture design, audit, modernization, incident analysis | `architect-backend-systems` | **Read-path, not Skill-invocable:** `Read .agents/skills/architect-backend-systems/SKILL.md`. Its own architecture-standard governs design method; evidence + controls come from this federation |
| Repo-wide structure audits, dead/duplicated files | `architect-github-repos` | **Read-path, not Skill-invocable:** `Read .agents/skills/architect-github-repos/SKILL.md` |
| Implementation process | superpowers: `test-driven-development`, `systematic-debugging`, `verification-before-completion` | Process governs how, not what |
| Documented-intent vs actual-code audits | `intended-vs-implemented` | |
| Review method / handoff | `code-review-excellence`, `/sp-review-ask` | |
| Release to production | `/ship <PR#>` | Runbook: `references/railway-deploy.md` (repo root) |
| Runtime/rendered proof | `verify` skill | Production build + boot + smoke; `/sp-verify` is command-output evidence only |

Exact invocation surfaces (including which skills are Read-path only) and precedence detail: `references/routing.md`. The evidence record is a file you copy: `references/record-template.yaml`. Control-by-control repo mapping and gate commands: `references/dime-mapping.md`.

## Conditionals

- **If the change touches schema** → the migration rides `db-push.yml` (Production-gated, `reconciled-migrate.mjs` journal) BEFORE any dependent code deploy; expand–migrate–contract; migration files are immutable once applied (journal checksums); destructive or contract-phase changes need explicit owner approval. A down migration is not automatically a valid rollback.
- **If the change includes a backfill** → idempotent, re-runnable, dry-run mode, executed through a Production-environment workflow (production `DATABASE_URL` exists only in Actions secrets); bounded by evidence — chunk/checkpoint at scale, and a justified single statement on small tables says so explicitly.
- **If the change adds an infrastructure component** (cache, queue, store, service, replica, external dependency) → "complexity must earn its existence" (§5.11): a decision note with the measured need, rejected alternatives, and failure/outage policy. The single-replica law (`railway.json` `numReplicas: 1`, `references/railway-deploy.md` §3b) means no distributed-state design without it changing first.
- **If the change touches traffic control (rate limits, timeouts, retries)** → declare the per-route-class failure policy (fail-open vs fail-closed, from the mapping's table) and **never hand-roll client identity at a call site** — call the shared resolver (`clientIpKey` for limiter keys, `resolveClientIp` for the raw IP, both in `server/_core/trpcRateLimitPolicy.ts`). Which header is authoritative depends on whether the Cloudflare edge is armed, and getting it wrong silently merges or splits limiter budgets — dime-mapping.md §11.4 carries the resolution order, the reasoning, and the OPEN list of sites on `main` that still hand-roll it (including the login lockout). `req.ip` is the last-resort fallback inside that resolver, not the rule. `/health` is never limited (Railway healthcheck kills the deploy otherwise).
- **If retrying a mutation** → only under an idempotency contract; non-idempotent retries are a defect.
- **If claiming done** → the PR body carries a filled `## Evidence record (engineering-federation §21.3)` block with verbatim gate output and a terminal outcome from: `shipped | rejected | halted_attempts | halted_budget | halted_permission | halted_environment | failed_verification` (§21.4 is the authoritative definition). Two PRs have ever carried one (#364, #371) against 67 merged since this skill landed — assume the record is missing unless you can see it.

## Common mistakes

| Mistake | Fix |
| --- | --- |
| Prose "done" with no evidence record | Copy `references/record-template.yaml`, fill it, paste it into the PR body; outcome from the §21.4 enum |
| Retyping the record block from memory | It is a file. Fields drift silently otherwise — the pre-2026-08-07 records used `artifact` for `artifact_digest` and carried only one of §21.3's five `verification` subfields by name |
| Mutating before capturing a baseline | Record revision + current behavior/metrics first — before/after claims need a before |
| Infra decisions justified only inline in a plan | Decision note: measured need, rejected alternatives, outage policy |
| Applying OpenAPI-shaped advice to tRPC procedures | dime-mapping §9: tRPC routers + zod are the contract layer here |
| Green unit test presented as production evidence | Definition-of-done rows + live/rendered proof for production boundaries |
| Deploying schema-dependent code before the schema | db-push.yml first — merge to main is itself a production deploy |
| Marking a control N/A silently | Every N/A carries a concrete architectural reason |
