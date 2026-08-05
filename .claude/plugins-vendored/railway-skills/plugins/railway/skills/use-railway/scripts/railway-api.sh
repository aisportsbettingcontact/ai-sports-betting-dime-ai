#!/usr/bin/env bash
# DISABLED in the Dime fork — fail-closed stub.
#
# The upstream version of this script read a Railway API token from
# ~/.railway/config.json and posted arbitrary GraphQL to
# backboard.railway.com. That contradicts Dime credential law
# (config/dime-agent-access.v1.json: remoteMutationsAuthorized: false;
# the standard Railway CLI config must hold NO access/refresh token).
#
# This stub reads no files, sends no network requests, and always exits 1
# so every legacy call site fails closed instead of finding a worse path.

cat >&2 <<'EOF'
{
  "error": "railway-api.sh is disabled in the Dime fork",
  "detail": "This script must not read ~/.railway/config.json. Railway access for this repository goes through the hash-pinned Dime keychain broker (pnpm agent:context / scripts/dime-railway-secure.mjs). Arbitrary GraphQL from the agent is not authorized (remoteMutationsAuthorized: false). For reads, use the Railway MCP tools or the read-only CLI with explicit human approval."
}
EOF
exit 1
