Work on the QM (multiplayer agent harness) integration for this repo:

$ARGUMENTS

Ground every step in `references/qm-harness.md` (the runbook) and the reference clone at
`~/src/qm`. Non-negotiables:

- The skill-corpus contract is `qm.pack.json` — machine-readable single source of truth
  for how QM imports this repo as a skill pack. Any skill added, renamed, or excluded
  must keep `pnpm qm:pack:verify` green (it also runs inside `pnpm pi:audit` and CI).
- Credit law (LLM.md): the funded Dime Chat `ANTHROPIC_API_KEY` is NEVER wired into QM's
  keychain, org config, deployment secrets, or harness credentials. QM model spend uses
  a separately provisioned key/org or OpenRouter — owner decision.
- Deployment (`qm init --target docker|fly|aws`) is owner-gated behind the five decisions
  enumerated in the runbook (target, org slug, sign-in transport + admin email, Slack,
  model-provider key). Prepare everything; execute nothing cloud-side without them.
- Inside any QM sandbox, a checkout of this repo behaves like a fresh machine: trust it,
  and the full pi wiring (AGENTS.md, .pi/settings.json, dime-guard, pnpm pi:\*) applies.
