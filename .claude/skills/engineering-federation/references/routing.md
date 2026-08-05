# Engineering federation routing — invocation surfaces and evidence contract

Verified against this repo 2026-08-05. When this disagrees with the files on disk, the
files win — update this doc.

## Precedence between the two standards

- `references/production-grade-engineering-architecture.md` (this federation's vendored
  standard) owns **controls, gates, failure policies, evidence, and definition of done**.
- `.agents/skills/architect-backend-systems/references/architecture-standard.md` owns
  **design method** (requirement model → domain/topology → contracts → data → security →
  reliability → adversarial review) and applies whenever architect-backend-systems leads.
- Repo law (CLAUDE.md / AGENTS.md laws) outranks both. A genuine conflict between the two
  standards is resolved toward repo law first, then the vendored standard, and is flagged
  to the owner rather than silently harmonized.

## Skills

| Skill | ID / invocation | Role |
| --- | --- | --- |
| architect-backend-systems | Skill tool (also `.agents/skills/architect-backend-systems/`) | Lead for design/audit/modernize/implement/incident modes; carries its own `agents/` + `references/` |
| architect-github-repos | Skill tool (`.agents/skills/`) | Repo-structure audits, dead/duplicated file classification |
| superpowers process skills | `superpowers:test-driven-development`, `superpowers:systematic-debugging`, `superpowers:verification-before-completion`, `superpowers:writing-plans` (commands `/sp-tdd`, `/sp-debug`, `/sp-verify`, `/sp-plan`) | How, not what |
| verify | Skill tool (`.claude/skills/verify/`) | Production build + boot + `smoke-deploy.mjs` + rendered proof; its Playwright snippet hardcodes remote-container paths — resolve per environment |
| intended-vs-implemented | Skill tool (`.claude/skills/`) | Gap audits between documented intent and code |
| code-review-excellence | Skill tool (`.claude/skills/`) | Review methodology; pair with `/sp-review-ask` / `/sp-review-apply` |
| design-federation | Skill tool + `/ui-loop` | Anything visual routes there, not here |

## Commands

- `/eng-loop <change + context>` — entry point for this federation.
- `/ship <PR#>` — CI + release gates → merge → Railway deploy confirmation + smoke.
- `/gh-fix <issue#>` — issue → worktree → focused fix → verification → PR.
- `gh workflow run db-push.yml --ref <branch>` — apply schema to production (Production
  environment approval; run BEFORE merging dependent code).
- `gh workflow run deploy-smoke.yml` / automatic on main push — post-deploy smoke.

## Evidence record template (§21.3, Dime-adapted)

Attach to the PR (or paste in the final report). Verbatim command output backs every
`recorded` field; absence of a section must be explained, not omitted.

```yaml
outcome: shipped | rejected | halted_attempts | halted_budget | halted_permission | halted_environment | failed_verification
source_revision: <commit SHA>
baseline: <revision + measured before-state captured in step 3>
classification: <trust boundary + failure impact class>
diff_scope: <complete changed-file inventory>
contracts_changed: <tRPC routers/types, schema journal, config, policy, or none>
artifact: <Railway deployment id + meta.commitHash, or none>
migration_revision: <drizzle journal tag, or none>
verification:
  focused_checks: <recorded results>
  full_gates: <tsc / gated vitest / build / class-specific gates, recorded>
  live_proof: <smoke/verify-skill output, or explicit N/A + reason>
production_mutation: true | false   # any merge to main is true (deploy law)
approvals: <owner directives, db-push run URLs, PR approvals, or none>
known_limitations: <explicit list>
rollback_or_containment: <exact mechanism — env knob, revert, forward-fix plan>
decision_notes: <ADR-style notes for any new component or budget change, or none>
```

Terminal-outcome rules (§21.4): `shipped` requires all required gates green at the
authorized boundary; a partially implemented change is never `shipped`; missing authority
is `halted_permission`, not a workaround.
