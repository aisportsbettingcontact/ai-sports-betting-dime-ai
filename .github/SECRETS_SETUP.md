# GitHub Repository Secrets Setup

This document lists every secret required by the CI/CD workflows in `.github/workflows/`.

## How to Add Secrets

1. Go to your GitHub repository
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret** for each entry below
4. Paste the exact value — no surrounding quotes

---

## Required Secrets

| Secret Name | Description | Format | Required By |
|---|---|---|---|
| `DATABASE_URL` | MySQL/TiDB connection string | `mysql://user:pass@host:port/dbname` | `ci.yml` (test stage) |
| `JWT_SECRET` | Session cookie signing secret | Min 16 chars, random string | `ci.yml` (test stage) |
| `PUBLIC_ORIGIN` | Production base URL (no trailing slash) | `https://aisportsbettingmodels.com` | `ci.yml` (test stage) |

---

## Validation

The `ciSecrets.test.ts` Vitest test validates all 3 secrets on every CI run.

If a secret is missing or malformed, the test will fail with a specific message like:

```
✗ DATABASE_URL — FAIL: Missing or empty
  → Add it at: https://github.com/YOUR_ORG/YOUR_REPO/settings/secrets/actions/new
```

---

## Optional Secrets (for full feature coverage)

| Secret Name | Description | Used By |
|---|---|---|
| `DISCORD_BOT_TOKEN` | Discord bot token | Discord integration |
| `DISCORD_CLIENT_ID` | Discord OAuth client ID | Discord login |
| `DISCORD_CLIENT_SECRET` | Discord OAuth client secret | Discord login |
| `KENPOM_EMAIL` | KenPom login email | NCAA model data |
| `KENPOM_PASSWORD` | KenPom login password | NCAA model data |
| `VSIN_EMAIL` | VSiN login email | Odds refresh pipeline |
| `VSIN_PASSWORD` | VSiN login password | Odds refresh pipeline |
| `METABET_API_KEY` | MetaBet API key | Odds data |

---

## Security Notes

- **Never commit `.env` files** — all secrets must flow through GitHub Secrets
- **Rotate secrets immediately** if they are ever exposed in logs or commits
- **Use `git secret scan`** or GitHub's push protection to prevent accidental commits
- The `ciSecrets.test.ts` test logs only the first 4 chars + length of each secret — never the full value
