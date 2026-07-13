#!/bin/bash
# SessionStart hook for Claude Code on the web.
#
# Fresh web containers start with neither node_modules nor the plugin arsenal
# declared in .claude/settings.json — headless sessions do not auto-install
# project-declared marketplaces/plugins, so the skills mapped in CLAUDE.md
# never load. This hook installs both. It is idempotent: on a warm (cached)
# container every step short-circuits in a few seconds.
set -uo pipefail

# Local (desktop/CLI) sessions manage their own deps and plugins.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$PROJECT_DIR"

LOG=/tmp/session-start-hook.log
: > "$LOG"
STATUS=0

# --- 1. Node dependencies (pnpm, mirrors CI) --------------------------------
if [ -d node_modules ]; then
  echo "[hook] node_modules present, skipping pnpm install"
elif command -v pnpm >/dev/null 2>&1; then
  echo "[hook] pnpm install --frozen-lockfile (log: $LOG)"
  if ! pnpm install --frozen-lockfile >>"$LOG" 2>&1; then
    echo "[hook] WARN: pnpm install failed — see $LOG"
    tail -5 "$LOG"
    STATUS=1
  fi
else
  echo "[hook] WARN: pnpm not found, skipping dependency install"
  STATUS=1
fi

# --- 2. Plugin marketplaces + plugins from .claude/settings.json ------------
SETTINGS="$PROJECT_DIR/.claude/settings.json"
if command -v claude >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1 && [ -f "$SETTINGS" ]; then
  # Marketplaces declared in settings but not yet known to the CLI.
  MISSING_MARKETPLACES=$(python3 - "$SETTINGS" <<'PY'
import json, os, sys
settings = json.load(open(sys.argv[1]))
known_path = os.path.expanduser("~/.claude/plugins/known_marketplaces.json")
known = json.load(open(known_path)) if os.path.exists(known_path) else {}
for name, cfg in settings.get("extraKnownMarketplaces", {}).items():
    src = cfg.get("source", {})
    if name not in known and src.get("source") == "github" and src.get("repo"):
        print(src["repo"])
PY
  )
  while IFS= read -r repo; do
    [ -z "$repo" ] && continue
    if claude plugin marketplace add "$repo" >>"$LOG" 2>&1; then
      echo "[hook] added marketplace $repo"
    else
      echo "[hook] WARN: failed to add marketplace $repo — see $LOG"
      STATUS=1
    fi
  done <<< "$MISSING_MARKETPLACES"

  # Enabled plugins not yet installed.
  MISSING_PLUGINS=$(python3 - "$SETTINGS" <<'PY'
import json, os, sys
settings = json.load(open(sys.argv[1]))
inst_path = os.path.expanduser("~/.claude/plugins/installed_plugins.json")
installed = {}
if os.path.exists(inst_path):
    installed = json.load(open(inst_path)).get("plugins", {})
for plugin, enabled in settings.get("enabledPlugins", {}).items():
    if enabled and plugin not in installed:
        print(plugin)
PY
  )
  INSTALLED=0
  FAILED=0
  while IFS= read -r plugin; do
    [ -z "$plugin" ] && continue
    if claude plugin install "$plugin" >>"$LOG" 2>&1; then
      INSTALLED=$((INSTALLED + 1))
    else
      echo "[hook] WARN: failed to install plugin $plugin — see $LOG"
      FAILED=$((FAILED + 1))
      STATUS=1
    fi
  done <<< "$MISSING_PLUGINS"
  echo "[hook] plugins: $INSTALLED installed, $FAILED failed, rest already present"
else
  echo "[hook] WARN: claude CLI or python3 unavailable, skipping plugin install"
  STATUS=1
fi

exit "$STATUS"
