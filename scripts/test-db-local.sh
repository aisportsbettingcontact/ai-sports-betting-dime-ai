#!/usr/bin/env bash
# test-db-local.sh — run the five real-database Vitest suites against an
# isolated, throwaway MySQL instance. Never touches a remote database.
#
# Requirements: a local `mysqld` binary (`brew install mysql`) on PATH or in
# /opt/homebrew/opt/mysql/bin. Docker users can instead run:
#   docker run --rm -d --name dime-test-db -e MYSQL_ALLOW_EMPTY_PASSWORD=1 \
#     -e MYSQL_DATABASE=dime_test -p 3307:3306 mysql:8
#   DATABASE_URL="mysql://root@127.0.0.1:3307/dime_test" \
#     pnpm exec drizzle-kit migrate && DATABASE_URL=... pnpm exec vitest run <suites>
#
# Usage: scripts/test-db-local.sh [--keep]
set -euo pipefail

PORT=3307
DB_NAME="dime_test"
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/dime-test-db.XXXXXX")"
DATADIR="$WORKDIR/data"
SOCKET="$WORKDIR/mysql.sock"
DATABASE_URL="mysql://root@127.0.0.1:${PORT}/${DB_NAME}"

# Safety: this script only ever runs against the loopback instance it starts.
case "$DATABASE_URL" in
  mysql://root@127.0.0.1:${PORT}/${DB_NAME}) ;;
  *) echo "refusing to run against $DATABASE_URL" >&2; exit 1 ;;
esac

MYSQLD="$(command -v mysqld || echo /opt/homebrew/opt/mysql/bin/mysqld)"
MYSQL="$(command -v mysql || echo /opt/homebrew/opt/mysql/bin/mysql)"
if [ ! -x "$MYSQLD" ]; then
  echo "mysqld not found — install with: brew install mysql" >&2
  exit 1
fi

cleanup() {
  if [ -f "$WORKDIR/mysqld.pid" ]; then
    kill "$(cat "$WORKDIR/mysqld.pid")" 2>/dev/null || true
    sleep 1
  fi
  if [ "${1:-}" != "--keep" ]; then rm -rf "$WORKDIR"; fi
}
trap 'cleanup "${1:-}"' EXIT

echo "[db-local] initializing throwaway datadir at $DATADIR"
"$MYSQLD" --initialize-insecure --datadir="$DATADIR" >/dev/null 2>&1
"$MYSQLD" --datadir="$DATADIR" --port="$PORT" --socket="$SOCKET" \
  --bind-address=127.0.0.1 --pid-file="$WORKDIR/mysqld.pid" \
  --log-error="$WORKDIR/mysqld.err" --daemonize

for _ in $(seq 1 30); do [ -S "$SOCKET" ] && break; sleep 1; done
[ -S "$SOCKET" ] || { echo "mysqld failed to start; see $WORKDIR/mysqld.err" >&2; exit 1; }

"$MYSQL" --socket="$SOCKET" -u root -e "CREATE DATABASE IF NOT EXISTS ${DB_NAME};"

echo "[db-local] provisioning current schema (push, not migrate: history is not replayable from scratch — see ci.yml db-tests job)"
DATABASE_URL="$DATABASE_URL" pnpm exec drizzle-kit push --force

echo "[db-local] running the five real-database suites"
DATABASE_URL="$DATABASE_URL" pnpm exec vitest run \
  server/appUsers.login.test.ts \
  server/appUsers.register.test.ts \
  server/completeAccountSetup.test.ts \
  server/passwordReset.test.ts \
  server/tokenVersion.db.test.ts
