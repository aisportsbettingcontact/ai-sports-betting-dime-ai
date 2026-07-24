#!/usr/bin/env bash
# Rehydrate the plugin arsenal declared in .claude/settings.json.
#
# Remote/cloud sessions have started with an empty installed_plugins.json, which
# silently drops every plugin skill. This script is idempotent and safe to run at
# any time -- it exits early when the arsenal is already complete.
#
# All six marketplaces are vendored under .claude/plugins-vendored/, so this
# runs fully offline -- no GitHub, no network.

set -uo pipefail

# Resolve the repo root from THIS script's location, never from $PWD -- hooks do
# not necessarily run from the repo root. Never exit 2: SessionStart treats that
# as a blocking error, and a missing skill arsenal must not block a session.
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)" || exit 1

# grep -c prints 0 AND exits 1 when there is no match -- `|| true` keeps the
# single "0" on stdout; `|| echo 0` would emit "0\n0" and break the comparison.
count_installed() { claude plugin list 2>/dev/null | grep -c '@' || true; }
want=$(python3 -c "import json;print(len(json.load(open('.claude/settings.json'))['enabledPlugins']))" 2>/dev/null)
case "$want" in ''|*[!0-9]*) echo "bootstrap-plugins: cannot read .claude/settings.json" >&2; exit 1;; esac

if [ "$(count_installed)" -ge "$want" ]; then
  echo "plugins OK ($(count_installed)/$want)"
  exit 0
fi

for m in .claude/plugins-vendored/*/; do
  claude plugin marketplace add "./$m" >/dev/null 2>&1
done

# --scope project is a no-op against the already-declared enabledPlugins,
# so .claude/settings.json is left untouched.
python3 -c "import json;print('\n'.join(json.load(open('.claude/settings.json'))['enabledPlugins']))" \
  | xargs -I{} claude plugin install {} --scope project >/dev/null 2>&1

have=$(count_installed)
echo "plugins: $have/$want"
[ "$have" -ge "$want" ] || exit 1
