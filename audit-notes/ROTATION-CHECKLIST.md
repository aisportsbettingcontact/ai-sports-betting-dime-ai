# ROTATION-CHECKLIST.md — SEC-006 Credential Rotation

**Purpose:** Owner completes this checklist to close SEC-006. Each credential was exposed in `.project-config.json` git history (Manus S3 origin). No public exposure confirmed (GitHub Push Protection blocked all dirty pushes), but precautionary rotation is required.

**Instructions:** Mark each item `[x]` after rotation is confirmed. SEC-006 closes when all MUST ROTATE and SHOULD ROTATE items are checked.

---

## MUST ROTATE (production access)

- [ ] **DATABASE_URL / DRIZZLE_DATABASE_URL** — TiDB Cloud database password. Rotate in TiDB Cloud console → update in Manus Settings → Secrets.
- [ ] **STRIPE_SECRET_KEY** — Stripe secret key. Rotate in Stripe Dashboard → Developers → API keys → Roll key. Update in Manus Settings → Payment.
- [ ] **STRIPE_WEBHOOK_SECRET** — Stripe webhook signing secret. Delete and recreate webhook endpoint in Stripe Dashboard → Developers → Webhooks. Update in Manus Settings → Payment.
- [ ] **JWT_SECRET** — Session cookie signing key. Generate new random value (e.g., `openssl rand -hex 32`). Update in Manus Settings → Secrets. Note: invalidates all active sessions.
- [ ] **SUPABASE_SERVICE_ROLE_KEY** — Admin-level Supabase access. Rotate in Supabase Dashboard → Settings → API → Generate new service_role key. Update in Manus Settings → Secrets.
- [ ] **GOOGLE_SERVICE_ACCOUNT_JSON** — Google service account private key. Rotate in Google Cloud Console → IAM → Service Accounts → Keys → Create new key, delete old. Update in Manus Settings → Secrets.

## SHOULD ROTATE (third-party API access)

- [ ] **ANTHROPIC_API_KEY** — Anthropic API. Rotate in console.anthropic.com → API Keys. Update in Manus Settings → Secrets.
- [ ] **DISCORD_BOT_TOKEN** — Discord bot token. Rotate in Discord Developer Portal → Bot → Reset Token. Update in Manus Settings → Secrets.
- [ ] **DISCORD_CLIENT_SECRET** — Discord OAuth secret. Rotate in Discord Developer Portal → OAuth2 → Reset Secret. Update in Manus Settings → Secrets.
- [ ] **CF_API_TOKEN** — Cloudflare API token. Rotate in Cloudflare Dashboard → My Profile → API Tokens → Roll. Update in Manus Settings → Secrets.
- [ ] **GMAIL_APP_PASSWORD** — Gmail app password. Revoke in Google Account → Security → App passwords → Delete and recreate. Update in Manus Settings → Secrets.
- [ ] **METABET_API_KEY** — MetaBet API key. Contact MetaBet support or rotate in their dashboard. Update in Manus Settings → Secrets.
- [ ] **KENPOM_PASSWORD** — KenPom account password. Change at kenpom.com → Account settings. Update in Manus Settings → Secrets.
- [ ] **ROTOGRINDERS_PASSWORD** — RotoGrinders account password. Change at rotogrinders.com → Account settings. Update in Manus Settings → Secrets.
- [ ] **VSIN_PASSWORD** — VSiN account password. Change at vsin.com → Account settings. Update in Manus Settings → Secrets.

## LOW PRIORITY (platform-managed or public-facing)

- [ ] **BUILT_IN_FORGE_API_KEY** — Manus platform key (managed by platform, rotation may not be possible).
- [ ] **VITE_FRONTEND_FORGE_API_KEY** — Frontend key (limited scope, public-facing by design).
- [ ] **SUPABASE_ANON_KEY** — Public anon key (safe by design, protected by RLS).
- [ ] **VITE_STRIPE_PUBLISHABLE_KEY** — Stripe publishable key (public by design).
- [ ] **DISCORD_PUBLIC_KEY** — Verification key (not a secret).

## NO ACTION NEEDED

- [x] **git_remote.secret_access_key** — Manus-managed STS credential, auto-rotates.
- [x] **git_remote.session_token** — Expired 2026-07-07T15:32:30Z, auto-rotates.

---

## Completion Criteria

SEC-006 closes when:
1. All 6 MUST ROTATE items are `[x]`
2. All 9 SHOULD ROTATE items are `[x]`
3. Owner confirms no unauthorized usage detected during exposure window

**Date completed:** _______________  
**Confirmed by:** _______________
