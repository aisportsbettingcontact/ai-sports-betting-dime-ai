#!/usr/bin/env bash

# Load the shared, read-only Dime context for Claude Code without making a
# missing network or expired cache block SessionStart.

set -u

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"

if [[ ! -f "${REPOSITORY_ROOT}/scripts/dime-agent-access.mjs" ]]; then
  echo "[dime-context] shared access script is missing; continuing without a capsule" >&2
  exit 0
fi

node "${REPOSITORY_ROOT}/scripts/dime-agent-access.mjs" context
status=$?

if [[ ${status} -ne 0 ]]; then
  echo "[dime-context] live context was unavailable or stale; continuing with the reported fail-closed state" >&2
fi

exit 0
