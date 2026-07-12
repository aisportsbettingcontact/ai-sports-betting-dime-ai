Run the Railway release pipeline for: $ARGUMENTS (a PR number, or "current branch").

Deployment truth: Railway is the sole host and auto-deploys every push/merge to `main` —
**a merge to `main` IS a production deploy.** Schema migrations run only via the manual
`.github/workflows/db-push.yml` workflow and must succeed BEFORE merging code that depends
on them. Manual approval permissions remain in force throughout.

## 1. Resolve and classify

1. Resolve the PR (`gh pr view <number>`, or the current branch's PR). Record the head SHA.
2. Inspect the changed-file list and classify:
   - **Schema-affecting**: `drizzle/schema.ts`, `drizzle/wc2026.schema.ts`,
     `drizzle/dime.schema.ts`, anything else under `drizzle/**`, or migration SQL.
   - **DB-dependent runtime code**: server code that reads/writes tables whose shape this PR changes.

## 2. Release gates (evidence, not assumption)

3. Pull real GitHub check-run evidence for the head SHA (`gh pr checks`, `gh api` check-runs).
4. Required green: Security Audit, TypeScript (typecheck), Vitest, plus any other required
   branch-protection checks.
5. Report missing, skipped, cancelled, pending, or failing checks honestly, by name.
6. **If CI is not fully green: STOP. Do not merge.**

## 3. Migration gate (only when schema-affecting)

7. For a schema-affecting PR, STOP before merge.

   Before triggering the workflow:
   - Record the PR head branch and exact head SHA.
   - Confirm the head branch still points to that SHA.
   - Separately confirm, without exposing secret values, that the repository's
     `DATABASE_URL` secret is bound to the intended target database.
   - The current workflow has no database-selection input or GitHub Environment,
     so workflow success alone does not independently prove the target database.

   Never assume a migration was run. Never trigger it without explicit user
   authorization.

   After authorization, dispatch `.github/workflows/db-push.yml` against the PR head
   branch (`gh workflow run db-push.yml --ref <head-branch>`), then verify the
   resulting workflow run has:
   - event: workflow_dispatch
   - headSha exactly equal to the recorded PR head SHA
   - status: completed
   - conclusion: success
   - the expected workflow name and run URL
   (`gh run list --workflow=db-push.yml --commit <head-sha>` filters to the exact run.)

   If the target database binding cannot be confirmed, or the run SHA differs from
   the recorded PR head SHA: STOP. Do not merge.

## 4. Pre-merge summary and authorization

8. Present: PR + head commit SHA, changed files, CI state, migration state, production
   risks, and a rollback plan.
9. Require explicit user authorization immediately before merging. No authorization → stop.

## 5. Merge

10. Merge using the repository's approved merge method.
11. Do NOT force-push, reset, or recreate local branches (`checkout -B`) unless separately
    authorized.

## 6. Verify production against the merged commit

12. Confirm Railway detected and deployed the EXACT merge commit (deployment status/logs).
13. Verify: Railway deployment status; `GET /health` on the production origin; the relevant
    application origin; targeted smoke checks for the changed surface
    (`node scripts/smoke-deploy.mjs <origin>` covers the standard set).
14. If deployment or smoke verification fails: report immediately, do NOT claim success,
    and do NOT roll back automatically without authorization.

## 7. Final release report

15. Return: merged PR, merge commit SHA, CI evidence, migration evidence (or "not
    applicable"), Railway deployment evidence, smoke-test results, unresolved risks.
