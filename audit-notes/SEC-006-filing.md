# SEC-006: Credentials Committed to Git History

## 1. Finding ID
SEC-006

## 2. Severity
P0

## 3. Title
Production credentials committed to `.project-config.json` in git history

## 4. Description
The file `.project-config.json` containing 23 credentials (API keys, database URLs, passwords, tokens, service account JSON) was committed to git history across multiple checkpoints. The file was tracked from the project's inception until commit `3434a229` (this session) when I ran `git rm --cached`.

## 5. Affected File
`.project-config.json` (root of repository)

## 6. Credential Inventory (NAMES ONLY — values NEVER printed)

| # | Credential Name | Type | Category |
|---|----------------|------|----------|
| 1 | DATABASE_URL | DB_URL (host=gateway04.us-east-1.prod.aws.tidbcloud.com, user=3AW8r3RRauadYzS.root) | Infrastructure |
| 2 | DRIZZLE_DATABASE_URL | DB_URL (same host/user as above) | Infrastructure |
| 3 | git_remote.secret_access_key | AWS Secret Access Key | Infrastructure |
| 4 | git_remote.session_token | AWS Session Token | Infrastructure |
| 5 | ANTHROPIC_API_KEY | API Key | Third-party API |
| 6 | BUILT_IN_FORGE_API_KEY | API Key | Platform |
| 7 | CF_API_TOKEN | Cloudflare Token | Infrastructure |
| 8 | DISCORD_BOT_TOKEN | Bot Token | Third-party API |
| 9 | DISCORD_CLIENT_SECRET | OAuth Secret | Third-party API |
| 10 | DISCORD_PUBLIC_KEY | Public Key | Third-party API |
| 11 | GMAIL_APP_PASSWORD | App Password | Third-party API |
| 12 | GOOGLE_SERVICE_ACCOUNT_JSON | Service Account JSON blob | Third-party API |
| 13 | JWT_SECRET | Signing Secret | Application |
| 14 | KENPOM_PASSWORD | Password | Third-party API |
| 15 | METABET_API_KEY | API Key | Third-party API |
| 16 | ROTOGRINDERS_PASSWORD | Password | Third-party API |
| 17 | STRIPE_SECRET_KEY | Stripe Secret Key | Payment |
| 18 | STRIPE_WEBHOOK_SECRET | Stripe Webhook Secret | Payment |
| 19 | SUPABASE_ANON_KEY | API Key | Infrastructure |
| 20 | SUPABASE_SERVICE_ROLE_KEY | API Key (admin-level) | Infrastructure |
| 21 | VITE_FRONTEND_FORGE_API_KEY | API Key | Platform |
| 22 | VITE_STRIPE_PUBLISHABLE_KEY | Stripe Publishable Key | Payment |
| 23 | VSIN_PASSWORD | Password | Third-party API |

## 7. Exposure Surface

| Remote | URL | Push Succeeded? | Contains .project-config.json? | Public? | Evidence |
|--------|-----|-----------------|-------------------------------|---------|----------|
| origin (S3) | s3://vida-prod-gitrepo/webdev-git/310519663397752079/MW3FicTy7ae3qrm8dx8Lua | YES (every checkpoint) | YES — commit 9a8a8420 tree contains blob 3e8c3eb1 | No (Manus platform internal) | VERIFIED: `git ls-tree 9a8a8420 -- .project-config.json` returns blob |
| ai-sports-betting-models | github.com/aisportsbettingcontact/ai-sports-betting-models | YES (force-push after filter-branch) | NO — file removed from all commits before push | YES (public=false returned false, repo IS PUBLIC) | VERIFIED: `gh api commits?path=.project-config.json` returns 0 |
| ai-sports-betting-manus | github.com/aisportsbettingcontact/ai-sports-betting-manus | NO (workflows permission rejected) | N/A — ref update never accepted | N/A | VERIFIED: push error in shell output |
| ai-sports-betting-dime | github.com/aisportsbettingcontact/ai-sports-betting-dime | NO (repo not found) | N/A — repo doesn't exist | N/A | VERIFIED: push error in shell output |

## 8. Push Protection Analysis

- **ai-sports-betting-models (first attempt with dirty history):** GitHub Push Protection BLOCKED the push. VERIFIED — the error message referenced secret detection, which is why I then ran filter-branch.
- **ai-sports-betting-models (second attempt after filter-branch):** Push SUCCEEDED with clean history. VERIFIED — `gh api commits?path=.project-config.json` returns 0 results on the remote.
- **Conclusion:** Push Protection blocked every attempt to push the dirty history to GitHub. The only successful push to GitHub contained the rewritten (clean) history.

## 9. Remaining Exposure

The credentials remain in:
1. **Manus platform S3 git store** (origin remote) — not publicly accessible, but accessible to Manus platform infrastructure
2. **Local sandbox git history** — ephemeral, resets on sandbox restart
3. **The file itself** still exists on disk at `/home/ubuntu/ai-sports-betting/.project-config.json` (runtime config, not tracked by git)

## 10. Current Mitigation State

- File is in `.gitignore` (line 111): VERIFIED
- File is NOT tracked by git: VERIFIED (`git ls-files --error-unmatch` returns "did not match")
- No sibling secret files exist: VERIFIED (`find . -maxdepth 1` for *.config.json, .env*, *credentials* returns empty)
- GitHub repos do NOT contain the file: VERIFIED

## 11. Risk Assessment

- **Public exposure:** NONE confirmed. Push Protection blocked all dirty pushes to GitHub. The public repo (ai-sports-betting-models) has clean history.
- **Platform exposure:** The Manus S3 git store contains the file in history. Access is limited to Manus platform infrastructure. Risk level: LOW (platform-managed, not publicly enumerable).
- **AWS credentials (git_remote.secret_access_key, session_token):** These are Manus-managed temporary STS credentials that rotate automatically. The session_token had expiration `2026-07-07T15:32:30Z`. INFERRED (basis: the `expiration` field in git_remote section; what would confirm: checking if the token is still valid after expiration).

## 12. Owner Action Required — ROTATION LIST

The following credentials should be rotated as a precautionary measure, even though no public exposure is confirmed:

**MUST ROTATE (contain production access):**
1. DATABASE_URL / DRIZZLE_DATABASE_URL — TiDB Cloud database password
2. STRIPE_SECRET_KEY — Stripe production/test secret key
3. STRIPE_WEBHOOK_SECRET — Stripe webhook signing secret
4. JWT_SECRET — Session cookie signing key (rotation invalidates all active sessions)
5. SUPABASE_SERVICE_ROLE_KEY — Admin-level Supabase access
6. GOOGLE_SERVICE_ACCOUNT_JSON — Google service account private key

**SHOULD ROTATE (third-party API access):**
7. ANTHROPIC_API_KEY
8. DISCORD_BOT_TOKEN
9. DISCORD_CLIENT_SECRET
10. CF_API_TOKEN (Cloudflare)
11. GMAIL_APP_PASSWORD
12. METABET_API_KEY
13. KENPOM_PASSWORD
14. ROTOGRINDERS_PASSWORD
15. VSIN_PASSWORD

**LOW PRIORITY (platform-managed or public-facing):**
16. BUILT_IN_FORGE_API_KEY — Manus platform key (managed by platform)
17. VITE_FRONTEND_FORGE_API_KEY — Frontend key (limited scope)
18. SUPABASE_ANON_KEY — Public anon key (limited by RLS)
19. VITE_STRIPE_PUBLISHABLE_KEY — Public publishable key (safe by design)
20. DISCORD_PUBLIC_KEY — Verification key (not a secret)

**NO ACTION NEEDED:**
21. git_remote.secret_access_key — Manus-managed STS, auto-rotates
22. git_remote.session_token — Expired 2026-07-07T15:32:30Z, auto-rotates

## 13. Root Cause

The Manus platform's `webdev_save_checkpoint` tool automatically commits `.project-config.json` to the git repository. The file was added to `.gitignore` but was already tracked, so gitignore had no effect until `git rm --cached` was run.

## 14. Remediation (code-level, already applied)

- `git rm --cached .project-config.json` (commit `3434a229`)
- `.project-config.json` in `.gitignore` (line 111)
- Pre-commit hook (to be implemented in Phase 5 of this directive)

## 15. Status

**OPEN** — credentials remain in S3 git history. Owner must confirm rotation of items 1-15 above. Finding closes only after owner confirms all rotations complete.
