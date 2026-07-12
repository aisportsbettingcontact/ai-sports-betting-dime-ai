/**
 * ciTestGuard.ts — shared skip-guards for environment-bound tests.
 *
 * Two categories of tests cannot run in this repository's GitHub Actions
 * environment as it actually exists (verified 2026-07-12: only 7 Actions
 * secrets are configured; DATABASE_URL, DISCORD_*, VSIN_*, GMAIL_APP_PASSWORD,
 * NBA_SHEET_ID, PUBLIC_ORIGIN and the OAuth values documented in ci.yml are
 * NOT among them):
 *
 *   1. Presence/liveness probes — assert that a real credential exists or
 *      authenticates (ciSecrets, vsinCredentials, email SMTP, Discord REST,
 *      claude credentials). Operator-side checks; guard with IS_CI.
 *   2. Real-database suites — need a MySQL DATABASE_URL. These are NOT
 *      operator-only: the dedicated `db-tests` CI job provides a MySQL
 *      service container and sets DB_TESTS=1, so they run there. Guard with
 *      SKIP_DB_IN_CI so they skip only in the secretless main vitest job.
 *
 * Every skip declared here must have a matching entry in
 * vitest.environment-failure-allowlist.json (expectedCiSkips), which
 * scripts/check-environment-failures.mjs enforces — an undeclared skip fails
 * the CI gate instead of passing silently.
 */
export const IS_CI = process.env.CI === "true" || process.env.CI === "1";

/** Real-DB suites run in CI only inside the db-tests job (MySQL service). */
export const SKIP_DB_IN_CI = IS_CI && process.env.DB_TESTS !== "1";
