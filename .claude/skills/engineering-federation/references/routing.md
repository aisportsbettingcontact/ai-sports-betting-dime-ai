# Engineering federation routing — invocation surfaces and evidence contract

Verified against this repo 2026-08-05; invocation reality, the evidence-record section, and
the DR-014 ruling re-verified 2026-08-07 (each dated in place). When this disagrees with the
files on disk, the files win — update this doc.

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

**Invocation reality (verified 2026-08-07).** `.agents/skills/` is the cross-platform
directory (17 agent platforms, per CLAUDE.md). **No entry is registered as a Claude Code
skill by virtue of living there** — the Skill tool cannot invoke a copy in that tree, so
anything living *only* there is Read-path only. That is why the two architect rows below
changed. (A name may still be reachable from a *different* source: `stripe-best-practices`
sits in `.agents/skills/` and is also invocable as `stripe:stripe-best-practices` — that
is the stripe plugin's copy, not this one.)

The converse does **not** hold: presence in `.claude/skills/` is necessary, not
sufficient. Two verified counter-examples, each for a different reason —
`review-animations` sets `disable-model-invocation: true` in its frontmatter
(`.claude/skills/review-animations/SKILL.md`), and `frontend-design` has ordinary
frontmatter yet is still not in the roster, which `design-federation` records as a plain
observed fact ("**Not in the Skill roster.** Load via `Read`" —
`design-federation/references/routing.md`; also its `registry.md`). So do not mark a row
"Skill tool" because of where the file sits: **confirm the name is in the live roster,
and if it is not, give the Read path.** The rows below were each checked that way.

| Skill | ID / invocation | Role |
| --- | --- | --- |
| architect-backend-systems | **Read-path only** — `.agents/skills/` is not a Claude Code skill directory. `Read .agents/skills/architect-backend-systems/SKILL.md`, then its `references/architecture-standard.md` for the mode you need | Lead for design/audit/modernize/implement/incident modes; carries its own `agents/` + `references/` |
| architect-github-repos | **Read-path only** — same reason. `Read .agents/skills/architect-github-repos/SKILL.md` | Repo-structure audits, dead/duplicated file classification |
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

## Evidence record (§21.3, Dime-adapted)

**Home:** the PR body, under `## Evidence record (engineering-federation §21.3)`.

**Template:** `references/record-template.yaml` — a real file to copy from, so the block
is never retyped from memory. Field names follow §21.3 verbatim.

```bash
cat .claude/skills/engineering-federation/references/record-template.yaml
# strip the comment header, fill it, paste under the PR body heading above
```

**Why the PR body and not a file.** The convention already exists and has run: PR #364
(the federation's first production run) and PR #371 both carry a filled block. It decayed
afterwards — of the 67 PRs merged since the skill landed (`f348c5ea4`, 2026-08-05), only
those two carry a record — but the failure was **friction, not location**: the template
was a fenced block buried in this file, and nothing in the PR template asked for it. Both
are now fixed (a copyable file; a "Federation evidence" section in
`.github/pull_request_template.md`).

> **Settled — owner ruling, Prez, 2026-08-07. Do not relitigate.** The record **stays in
> the PR body**; relocating it to a per-PR tracked file (`docs/audits/<date>-<slug>-evidence/record.yaml`
> beside the design bundle) was proposed and **rejected**. Recorded as the partial ruling in
> `os/decisions/DR-014-consolidation-ruling.md` (Ruling 2), which upholds that record's
> "One file, one job … DR-005 must **not** mint a parallel evidence record." The path
> forward is `os/decisions/DR-005-first-loop-selection.md`: this same PR-body block becomes
> machine-validated via `shared/loop/evidenceRecord.ts` (zod) + `scripts/check-evidence-record.mjs`
> — which is why the template's field names follow §21.3 verbatim rather than a local
> dialect. Everything else in DR-014 is still AWAITING RULING; only the location was ruled.

Verbatim command output backs every recorded field; absence of a section must be
explained, not omitted (§23). Dime field meanings — `artifact_digest` = Railway
deployment id + `meta.commitHash`, `migration_revision` = drizzle journal tag — are in
`dime-mapping.md`, "Evidence record".

Terminal-outcome rules (§21.4): `shipped` requires all required gates green at the
authorized boundary; a partially implemented change is never `shipped`; missing authority
is `halted_permission`, not a workaround. The enum's **authoritative definition is §21.4
of the vendored standard** (authority chain #3, above this adaptation);
`record-template.yaml`, SKILL.md's "If claiming done" conditional, and the PR template
restate it. If it ever changes, the standard is what changed — propagate outward from there.
