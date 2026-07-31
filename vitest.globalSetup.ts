/**
 * vitest.globalSetup.ts
 *
 * Refuse to run the test suite against a production database.
 *
 * WHY (found the hard way, 2026-07-31): several suites — tokenVersion.db,
 * appUsers.login/register, completeAccountSetup, passwordReset — INSERT and
 * DELETE real `app_users` rows. They read `DATABASE_URL` from the ambient
 * environment, and on a developer machine that variable is frequently the live
 * TiDB Cloud DSN. `pnpm vitest run` then silently writes to production. There is
 * no `.env` file to inspect and nothing in vitest.config.ts hints at it, so the
 * hazard is invisible until you read the connection string.
 *
 * CI is unaffected: the DB Tests job points DATABASE_URL at its own ephemeral
 * MySQL service (127.0.0.1), and the Vitest job runs secretless.
 *
 * Escape hatch: set ALLOW_PROD_DB_TESTS=1 deliberately. It is intentionally
 * verbose and intentionally not a flag anyone sets by muscle memory.
 */

/** Hosts that are always safe: loopback and in-container service names. */
const LOCAL_HOST_PATTERN = /^(localhost|127\.0\.0\.1|::1|0\.0\.0\.0|host\.docker\.internal|mysql|db)$/i;

/** Managed-database hostnames that are never a test target. */
const MANAGED_HOST_PATTERN = /(tidbcloud\.com|rds\.amazonaws\.com|\.render\.com|\.railway\.app|planetscale|\bprod\b|\.prod\.)/i;

export function assessDatabaseUrl(raw: string | undefined): {
  allowed: boolean;
  host: string | null;
  reason: string;
} {
  if (!raw || raw.trim() === "") {
    return { allowed: true, host: null, reason: "DATABASE_URL unset — DB suites will skip or fail closed" };
  }
  let host: string | null = null;
  try {
    host = new URL(raw).hostname || null;
  } catch {
    // An unparseable DSN is not something to guess about.
    return { allowed: false, host: null, reason: "DATABASE_URL is not a parseable URL" };
  }
  if (host && LOCAL_HOST_PATTERN.test(host)) {
    return { allowed: true, host, reason: "local host" };
  }
  if (host && MANAGED_HOST_PATTERN.test(host)) {
    return { allowed: false, host, reason: "managed/production database host" };
  }
  return { allowed: false, host, reason: "non-local database host" };
}

export default function setup(): void {
  const verdict = assessDatabaseUrl(process.env.DATABASE_URL);
  if (verdict.allowed) {
    if (verdict.host) console.log(`[vitest:guard] DATABASE_URL host=${verdict.host} — ${verdict.reason}`);
    return;
  }
  if (process.env.ALLOW_PROD_DB_TESTS === "1") {
    console.warn(
      `[vitest:guard] OVERRIDE — running against host=${verdict.host ?? "(unparseable)"} ` +
      `(${verdict.reason}). These suites INSERT and DELETE app_users rows.`
    );
    return;
  }
  throw new Error(
    `[vitest:guard] Refusing to run: DATABASE_URL points at ${verdict.host ?? "(unparseable)"} — ${verdict.reason}.\n` +
    `  Several suites INSERT and DELETE real app_users rows, so this would mutate that database.\n` +
    `  Use a local database:   DATABASE_URL='mysql://root@127.0.0.1:3306/dime_test' pnpm vitest run\n` +
    `  Or run without one:     env -u DATABASE_URL pnpm vitest run\n` +
    `  Override deliberately:  ALLOW_PROD_DB_TESTS=1 pnpm vitest run`
  );
}
