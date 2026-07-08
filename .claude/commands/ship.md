Run the release pipeline for: $ARGUMENTS (a PR number, or "current branch").

1. Use the superpowers:verification-before-completion skill: confirm the PR's CI state
   with real check-run evidence (Security Audit + TypeScript must be green; report
   Vitest status honestly).
2. If green and the user has authorized merging: merge the PR, then restart the working
   branch from the new main (checkout -B + force-with-lease push of merged-history only).
3. If the diff touched drizzle/ schema: remind that .github/workflows/db-push.yml must be
   run BEFORE the Manus deploy.
4. Print the Manus deploy paste-prompt from RELEASING.md Step 2 and the post-deploy
   verification checklist. Remind: merging does NOT deploy — production changes only on
   Manus Deploy/Publish.
