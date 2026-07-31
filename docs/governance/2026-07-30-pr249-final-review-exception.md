# PR #249 final-review governance exception

Status: **OPEN — remediation required**

This artifact records a sanitized governance exception. It does not contain or
authorize any credential, provider execution, Railway variable read, production
login, deployment, database operation, model operation, or remote settings
change.

## Immutable review facts

- Pull request: `#249`
- Final reviewed branch head: `88ac09d52e6f7f727d16ecb2c25c5b694e7f5504`
- Independent approval by `prez-ai-sports-betting` applied to the earlier head
  `83f18acc` and was dismissed after the branch changed.
- Reviews on the final head were owner comments, not an independent approval.
- The pull request was merged without an independent approval on the exact
  final head.

## Repository governance observed after merge

- Required status checks were strict and included Security Audit, TypeScript,
  Vitest, and Gitleaks.
- Pull-request protection required one approval, stale-review dismissal,
  Code Owner review, approval after the latest push, resolved conversations,
  and applied to administrators.
- Active ruleset `18701573` had no bypass actors and the current user had no
  bypass authority.
- The same ruleset's pull-request rule independently specified zero approvals
  and did not require Code Owner review, approval after the latest push, or
  conversation resolution.

The conflicting rule surfaces mean the final-head independent-review invariant
was not reliably enforced. Passing CI and a prior-head approval do not close
this exception.

## Closure conditions

1. An independent reviewer reviews this corrective change at its exact final
   head with zero unresolved threads.
2. Repository protection and active rulesets are reconciled so the effective
   policy unambiguously requires the intended final-head independent review.
3. Reconciliation evidence records the effective settings and confirms there
   is no bypass actor.
4. The evidence is reviewed separately from the author of the corrective
   implementation.

Until all closure conditions are met, this exception remains open. This
artifact does not authorize a remote repository-settings mutation; any such
change requires separate owner authorization.
