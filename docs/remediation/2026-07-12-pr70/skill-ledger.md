# Skill-usage ledger — PR #70 remediation (2026-07-12)

| Skill | Where used | Decision informed | Artifact / code result |
|---|---|---|---|
| /apple-design | Task 3/4 design | Drawer settle: critically-damped spring (damping 1.0), velocity handoff, interruptible re-target; direct manipulation vs animation distinction; reduced-motion = gentler equivalent, never lockout | springSettle.ts spec in task4-brief.md; Task 3 model choice (option 1) |
| /frontend-design (read from disk — not registered as invocable this session; no silent substitution) | Task 3/4 briefs | Restraint: no redesign; quality floor = reduced motion + visible focus; preserve existing identity | Brief constraints forbidding visual change; parity-evidence requirement |
| /pm-problem | Phase 1 | Framed who is hurt (paying chat users, low-slate splits users, reduced-motion users, repo owner) and the scope boundary (no revert, no redesign) | Problem statement (in-conversation deliverable) |
| /product-strategy | Phase 1 | Hotfix-on-branch over revert; ranked defect order; North Star = every gate executable and green from a clean checkout | Strategy decision record; plan ordering |
| /ship | Task 11 | Release-readiness framing and packaging only; explicitly NOT used as merge/deploy permission | Draft PR body structure; release-authorization section of final report |
| /sp-debug → superpowers:systematic-debugging | Phase 3 + every fix task | Reproduce-first Iron Law; root cause before fix; minimal single change per commit | Baseline-FAIL evidence requirements in every task brief; env-gate catching the Task 1 regression before commit |
| /sp-parallel → superpowers:dispatching-parallel-agents | Phase 2 + review waves | One agent per independent domain; all dispatches in one message; read-only first pass | 4-domain parallel review (turn 1); parallel governance work while implementers own the worktree |
| /sp-plan → superpowers:writing-plans | Plan authoring | Task right-sizing, exact files per task, global constraints header, no placeholders | docs/superpowers/plans/2026-07-12-pr70-remediation.md (commit b942a75c) |
| /sp-execute → executing-plans discipline | Phase 4 | Phase-by-phase execution with review checkpoints and evidence between tasks | Sequential Task 2→3→4 dispatch protocol; controller stays out of the worktree while an implementer owns it |
| /sp-verify + /verification-before-completion | Task 11 (and turn-1 verification) | Evidence before assertions; no success claims without command output; clean-checkout matrix | Turn-1 verification table (tsc/vitest/build/smoke/prod-identity); final verification matrix |
| /sp-subagents → superpowers:subagent-driven-development | Phase 2/4 | Fresh implementer per task + task review + final independent verifier; file-handoff briefs/reports; model selection per task | briefs/task{2,3,4}-brief.md + report protocol; independent verifier dispatch |
| /stop-slop (read from disk — not registered as invocable this session) | Task 8 + all deliverable prose | Active voice, specifics, no filler, no em dashes in new doc text; reject superficial fixes and unverified claims | Corrections appended to dime-ai-sol-iteration.md, audit appendix erratum, INCIDENTS.md update (commit 50ce2932) |
| /systematic-debugging | (same as /sp-debug row — invoked explicitly) | See /sp-debug | Same artifacts |
| /ui-build | Task 4 brief | Minimal-diff UI change discipline; SSE core untouched; pixel-equivalent output | task4-brief.md constraints |
| /ui-style | Task 3/4 briefs | MASTER.md is authoritative: one 160ms curve, Motion 2/10, reduced-motion disables transitions; .dc-pressable 120ms is a violation to fix | Brand-law block in both briefs; .dc-pressable fix requirement |
| /ui-design-asset | Task 4 evidence | Parity-proof artifact definition (before/after screenshot pairs, MASTER.md palette as review checklist); no new assets | evidence/parity/ screenshot requirement in task4-brief.md |
| /ui-ux-pro-max | Task 3 brief | search.py: reduced-motion (High severity) and focus-state (High) rules | Reduced-motion + focus acceptance criteria in task3-brief.md |

Notes:
- `/frontend-design` and `/stop-slop` are not registered in this session's invocable skill list; their SKILL.md files were read from `.claude/skills/` and applied. Recorded here instead of silently substituting.
- `superpowers:verification-before-completion` governs the completion standard: statuses only from the mandated vocabulary, every claim traceable to a command output in the evidence index.
