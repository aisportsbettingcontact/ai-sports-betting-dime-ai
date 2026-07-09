#!/usr/bin/env bash
# .github/add-secrets.sh
#
# One-shot script to add all 7 required GitHub Actions secrets to the
# aisportsbettingcontact/aisportsbetting repository.
#
# PREREQUISITES:
#   1. Install GitHub CLI: https://cli.github.com/
#   2. Create a Personal Access Token (PAT) at:
#      https://github.com/settings/tokens/new
#      Required scopes: repo (full) — this includes secrets:write
#   3. Run: gh auth login  (select "Paste an authentication token" and paste your PAT)
#
# USAGE:
#   chmod +x .github/add-secrets.sh
#   ./.github/add-secrets.sh
#
# The script will prompt for each secret value interactively.
# Values are NEVER echoed to the terminal or logged.
#
# VALIDATION:
#   After running, the ciSecrets.test.ts Vitest test will validate all secrets
#   on the next CI run. Check the Actions tab for pass/fail per secret.

set -euo pipefail

REPO="aisportsbettingcontact/aisportsbetting"

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║         GitHub Actions Secrets Setup — AI Sports Betting     ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "[INPUT] Target repo: $REPO"
echo "[STEP]  Verifying gh CLI auth and secrets:write permission..."
echo ""

# Verify gh CLI is authenticated
if ! gh auth status &>/dev/null; then
  echo "[FAIL] gh CLI is not authenticated."
  echo "       Run: gh auth login"
  echo "       Then re-run this script."
  exit 1
fi

# Verify secrets:write access by attempting a dry-run list
if ! gh secret list --repo "$REPO" &>/dev/null; then
  echo "[FAIL] Token does not have secrets:write permission on $REPO."
  echo "       Create a PAT at: https://github.com/settings/tokens/new"
  echo "       Required scopes: repo (full)"
  echo "       Then run: gh auth login --with-token"
  exit 1
fi

echo "[VERIFY] PASS — secrets:write permission confirmed"
echo ""

# ─── Helper function ──────────────────────────────────────────────────────────
set_secret() {
  local name="$1"
  local description="$2"
  local example="$3"

  echo "──────────────────────────────────────────────────────────────"
  echo "  Secret: $name"
  echo "  Usage:  $description"
  echo "  Format: $example"
  echo ""
  # -s flag: silent input (no echo)
  read -r -s -p "  Enter value (input hidden): " value
  echo ""

  if [ -z "$value" ]; then
    echo "  [SKIP] Empty value — skipping $name"
    echo ""
    return
  fi

  echo "  [STEP] Setting $name..."
  echo "$value" | gh secret set "$name" --repo "$REPO"
  echo "  [OUTPUT] $name set successfully (length=${#value})"
  echo ""
}

# ─── Set all 7 required secrets ──────────────────────────────────────────────

set_secret \
  "DATABASE_URL" \
  "MySQL/TiDB connection string for the production database" \
  "mysql://user:password@host:3306/dbname"

set_secret \
  "APP_SESSION_SECRET" \
  "Session cookie signing secret — must be at least 16 chars" \
  "random-string-min-16-chars"

set_secret \
  "PUBLIC_ORIGIN" \
  "Production base URL — no trailing slash" \
  "https://aisportsbettingmodels.com"

set_secret \
  "VITE_APP_ID" \
  "Manus OAuth application ID" \
  "alphanumeric-app-id"

set_secret \
  "OAUTH_SERVER_URL" \
  "Manus OAuth backend base URL" \
  "https://api.manus.im"

set_secret \
  "OWNER_OPEN_ID" \
  "Owner's Manus open ID" \
  "alphanumeric-open-id"

set_secret \
  "NBA_SHEET_ID" \
  "Google Sheets ID for NBA model sync (44-char base64url)" \
  "1MWNh0pM...44chars"

# ─── Verification ─────────────────────────────────────────────────────────────
echo "══════════════════════════════════════════════════════════════"
echo "[STEP] Verifying all secrets are now set..."
echo ""

SECRETS_SET=$(gh secret list --repo "$REPO" 2>/dev/null | awk '{print $1}')
REQUIRED=("DATABASE_URL" "APP_SESSION_SECRET" "PUBLIC_ORIGIN" "VITE_APP_ID" "OAUTH_SERVER_URL" "OWNER_OPEN_ID" "NBA_SHEET_ID")
ALL_PASS=true

for secret in "${REQUIRED[@]}"; do
  if echo "$SECRETS_SET" | grep -q "^$secret$"; then
    echo "  [PASS] $secret — confirmed in repo secrets"
  else
    echo "  [FAIL] $secret — NOT found in repo secrets"
    ALL_PASS=false
  fi
done

echo ""
if [ "$ALL_PASS" = true ]; then
  echo "[OUTPUT] All 7 required secrets are set."
  echo "[VERIFY] PASS — push any commit to main to trigger CI and validate with ciSecrets.test.ts"
else
  echo "[OUTPUT] Some secrets are missing — re-run this script for the missing ones."
  echo "[VERIFY] FAIL — CI will fail until all 7 secrets are present"
fi
echo "══════════════════════════════════════════════════════════════"
echo ""
