#!/usr/bin/env bash
# Rehydrate the plugin arsenal declared in .claude/settings.json.
#
# Remote/cloud sessions have started with an empty installed_plugins.json, which
# silently drops every plugin skill. This script is idempotent and safe to run at
# any time -- it exits early when the arsenal is already complete.
#
# pm-skills and ui-ux-pro-max-skill are vendored under .claude/plugins-vendored/
# and rehydrate with no network. The remaining marketplaces still need GitHub.

set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 1

count_installed() { claude plugin list 2>/dev/null | grep -c '@'; }
want=$(python3 -c "import json;print(len(json.load(open('.claude/settings.json'))['enabledPlugins']))")

if [ "$(count_installed)" -ge "$want" ]; then
  echo "plugins OK ($(count_installed)/$want)"
  exit 0
fi

# Vendored in this repo -- no network required.
for m in pm-skills ui-ux-pro-max-skill; do
  claude plugin marketplace add "./.claude/plugins-vendored/$m" >/dev/null 2>&1
done

# Still fetched from GitHub.
for r in anthropics/claude-plugins-official anthropics/knowledge-work-plugins \
         leonxlnx/taste-skill railwayapp/railway-skills; do
  claude plugin marketplace add "$r" >/dev/null 2>&1
done

# --scope project is a no-op against the already-declared enabledPlugins,
# so .claude/settings.json is left untouched.
python3 -c "import json;print('\n'.join(json.load(open('.claude/settings.json'))['enabledPlugins']))" \
  | xargs -I{} claude plugin install {} --scope project >/dev/null 2>&1

have=$(count_installed)
echo "plugins: $have/$want"
[ "$have" -ge "$want" ]
