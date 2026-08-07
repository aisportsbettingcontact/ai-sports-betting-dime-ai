# Control plane — rulesets, merge queue, CODEOWNERS

Current live state (re-verified 2026-08-05, post-merge): ruleset
**`main-protection` (id 18701573, active)** with `pull_request`,
`required_status_checks`, `non_fast_forward`, `deletion`; classic branch
protection with strict checks, 1 approval + code-owner + last-push approval,
stale-approval dismissal, conversation resolution, `enforce_admins`,
force-push/deletion blocked.

> **DRIFT FOUND AND CLOSED 2026-08-05.** `main` is guarded by *two independent*
> mechanisms, and they had drifted apart: **`Secret Scan (gitleaks)` was
> required by classic protection but ABSENT from ruleset 18701573**, so secret
> scanning gated merges through only one of the two surfaces. If classic
> protection were ever relaxed — as it legitimately was during the 2026-08-05
> manus-purge break-glass — secret scanning would have silently stopped
> gating. Earlier revisions of this document asserted four ruleset contexts;
> that was aspirational, not measured.
>
> Both surfaces now carry the same four contexts, and **every one is pinned to
> `integration_id: 15368` (GitHub Actions)**. The three pre-existing entries
> were unpinned, which meant a same-named check from any other app could have
> satisfied them; all four were verified to genuinely originate from the
> Actions app before pinning. `scripts/graduate-ruleset.mjs` prints the
> ruleset-vs-classic comparison on every run so this cannot go quiet again.
>
> | Context | Ruleset 18701573 | Classic protection |
> | --- | --- | --- |
> | Security Audit | ✅ pinned | ✅ |
> | TypeScript Check | ✅ pinned | ✅ |
> | Vitest | ✅ pinned | ✅ |
> | Secret Scan (gitleaks) | ✅ pinned | ✅ |

## Graduating checks — use the script, not hand-edited JSON

`node scripts/graduate-ruleset.mjs --wave=<1|2|3> [--apply] [--force]`

Dry-run by default. Before writing anything it proves, against live GitHub
data, that (1) the wave's observation window from ROLLOUT.md has elapsed,
(2) every context it is about to require actually **reported** on a recent
merged PR — requiring a context that never reports wedges every merge on
"Expected — waiting for status" — and (3) each of those reports was green.
`--force` overrides only the calendar, never the reported-and-green proof.

## Target configuration

Apply after the graduation milestones in ROLLOUT.md (adding a required check
that doesn't exist yet blocks all merges — sequence matters).

### Required status checks (end state)

```
Security Audit                     (existing, ci.yml)
TypeScript Check                   (existing, ci.yml)
Vitest                             (existing, ci.yml)
Secret Scan (gitleaks)             (existing)
01-pr-proof-contract
02-codeql
03-semgrep-blocking
05-workflow-security
06-dependency-review
07-coverage-patch                  (after calibration window)
08-contract-and-data-integrity
09-artifact-build-and-smoke
10-ai-eval-critical                (AI_SURFACE=true)
11-artifact-attestation
```

Advisory (never in the required list until graduated per ROLLOUT.md):
`03-semgrep-advisory`, `ai-review`, `mutation-diff`, `fuzz-diff`,
`openssf-scorecard`, `format-check`.

### gh api — add required checks to the existing ruleset

```bash
# Read current ruleset, edit required_status_checks in place:
gh api repos/tailered-ai/dime-ai/rulesets/18701573 > ruleset.json
# (edit: append the new contexts to rules[type=required_status_checks].parameters.required_status_checks
#  with integration_id pinned to GitHub Actions app id 15368 — binds check identity
#  to the Actions app so a same-named check from another app can't satisfy it)
gh api -X PUT repos/tailered-ai/dime-ai/rulesets/18701573 --input ruleset.json
```

Classic protection mirror (strict=true stays):

```bash
gh api -X PATCH repos/tailered-ai/dime-ai/branches/main/protection/required_status_checks \
  -f strict=true \
  $(printf -- '-f contexts[]=%q ' "Security Audit" "TypeScript Check" "Vitest" "Secret Scan (gitleaks)" \
    01-pr-proof-contract 02-codeql 03-semgrep-blocking 05-workflow-security 06-dependency-review \
    08-contract-and-data-integrity 09-artifact-build-and-smoke 10-ai-eval-critical 11-artifact-attestation)
```

### Merge queue

Enable on `main` (Settings → Rules → ruleset → "Require merge queue", or
`gh api` ruleset `merge_queue` rule). This eliminates the stale-branch races
observed on 2026-08-05 (PR #359 went stale twice under strict checks while
#357/#358 merged). Every required workflow in this framework declares
`merge_group` for exactly this reason. Recommended params for a solo repo:
`grouping_strategy: ALLGREEN`, `max_entries_to_build: 2`, merge method: merge.

### Signed commits

Not currently enforced. Decision for the owner: most commits are agent-authored
via CLI without signing set up; enabling `required_signatures` today would
block the primary workflow. Recorded as **deferred owner decision** — enable
after configuring commit signing for the working machine(s).

### Two approvals on sensitive paths / break-glass

Single-maintainer reality: a second human approval cannot exist. Compensating
controls: `enforce_admins` stays ON for normal operation; the break-glass path
is the documented, memory-recorded protection-lowering procedure used for the
2026-08-05 manus purge (lower → act → restore, each step logged in the ops
record). CODEOWNERS keeps review-policy and workflow files owner-only so an AI
reviewer or contributor cannot alter its own instructions silently.

### Secret Protection

GitHub push protection is an org/repo setting (Settings → Code security →
Secret Protection → Push protection: enable). Gitleaks remains the in-CI layer
either way. Status: to confirm in UI — cannot be set via current `gh api` PAT
scope; open item in ROLLOUT.md.

## CODEOWNERS

`.github/CODEOWNERS` extended (this PR) to cover: `/` default, `.github/`,
migrations (`/drizzle/`), auth/billing (`/server/stripe/`, auth/session files),
AI surface (prompts, model config, agent runtimes, `ml/dime-1.0/`,
`shared/dime/`), and the AI-review + verification-policy files themselves
(`.coderabbit.yaml`, `.semgrep/`, `docs/verification/`) — reviewers read
instructions from the PR head, so the instruction files must be owner-gated.

## Org policy note

Full-SHA action pinning is already repo-law, enforced per-PR by
`scripts/check-github-actions-security.mjs` (0 non-SHA refs across 135 uses
at audit time) and now additionally by zizmor (05). Org-level: adopt the same
requirement in any future repo; this repo is the reference implementation.
