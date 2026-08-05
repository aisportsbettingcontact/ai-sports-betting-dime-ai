# Verification framework — rollout plan

State: framework installed on branch `ci/verification-framework` (2026-08-05).
Nothing below is a required check until the ruleset is updated per RULESETS.md
— new workflows run on every PR immediately but cannot block until graduated.

## Wave 0 — merge the framework (no ruleset change)

All new workflows run informationally. Watch one full week of PRs for false
reds. Existing required checks (Security Audit, TypeScript Check, Vitest,
Secret Scan) keep guarding merges exactly as today.

## Wave 1 — graduate the deterministic core (after 1 clean week)

Add to required checks: `01-pr-proof-contract`, `05-workflow-security`,
`06-dependency-review`, `08-contract-and-data-integrity`,
`10-ai-eval-critical`. These are deterministic re-arrangements of already-
green machinery — graduation risk is CI minutes, not false blocks.

## Wave 2 — graduate the scanners (after 02/03 baselines are clean)

`02-codeql` (triage the first full scan; dismiss-or-fix every finding so the
PR delta gate starts from zero), `03-semgrep-blocking` (custom ERROR rules
only; tune any rule that false-fires more than once — calibration beats
suppression). Then `09-artifact-build-and-smoke` (validate Docker build time
in CI stays < 10 min; it is the gate that catches Railway-build breakage at
PR time) and `11-artifact-attestation`.

## Wave 3 — calibrated gates

- `07-coverage-patch`: run advisory ≥ 2 weeks; confirm the v8 line-mapping
  produces < 5% disputed uncovered-line reports, then require.
- `format-check`: DONE 2026-08-05 (owner-directed, ahead of wave) — format-all
  commit landed (576 files) with the scope law in `.prettierignore`: immutable
  (drizzle), checksummed (platform_knowledge, ml manifests, patches), vendored
  (.claude/.agents/.pi), design-law (design-system, dime-ai), records (docs,
  audits, references), harness-synced root *.md, data corpora, and 42
  source-shape-pinned files that law tests byte-assert (their pins verified
  green post-format). Gate is green; ruleset membership still follows Wave 1+.
- `mutation-diff` (nightly full already): after 2 clean nightly runs, add a
  diff-scoped advisory PR job; graduate a break-threshold on
  parlay/betTracker/pricing modules only.
- Merge queue: enable in the ruleset once Wave 1 is stable (kills the
  stale-branch races of 2026-08-05).

## Owner-gated enablements (explicitly NOT time-based)

| Item | Precondition |
|---|---|
| CodeRabbit app install (Layer 9) | owner installs; API-credit law reconciled; 30–50 PR calibration begins then |
| Promptfoo model-calling evals + nightly red-team (Layer 10) | owner lifts the CI model-spend pause; judge from non-Anthropic family configured |
| GitHub push protection | owner enables in repo/org security settings (PAT scope couldn't) |
| Renovate app | owner installs the GitHub App; renovate.json is ready |
| Signed commits ruleset | owner sets up commit signing first |
| Promotion-by-digest deploys (SLSA end-state) | owner switches Railway service from source-builds to image deploys consuming the attested GHCR digest |
| KNOWN-FINDING-1 fix (settleParlay VOID guard) | owner reviews AUDIT.md §8 — money-code change, drafted + validated during discovery |

## Calibration criteria (uniform)

A check graduates from advisory to required only when: ≥ 20 observations,
false-positive rate < 20% (scanners) or < 5% (deterministic), and one
documented dry-run of the failure mode (we intentionally break it once and
watch it block). A required check that false-blocks twice in a week gets
demoted back to advisory and recalibrated — engineers routing around the
system is the failure mode that kills verification programs.

## CI-minute budget note

Waves 1–2 roughly double PR CI time (docker build + codeql are the heavy
adds). Acceptable for a critical-tier repo; if minutes become a constraint,
09 and 02 can move to merge_group-only (they still gate merges via the queue,
skipping intermediate pushes).
