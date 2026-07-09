/**
 * ciTestGuard.ts — shared skip-guard for tests scoped out of CI.
 *
 * Two categories of tests must not run in GitHub Actions:
 *   1. Presence-probes — assert that a real credential exists in the env
 *      (ciSecrets, vsinCredentials, claude:ANTHROPIC_API_KEY). Valuable on
 *      a developer/operator machine; meaningless noise in CI where those
 *      secrets are deliberately not configured.
 *   2. Live-network credential checks — authenticate against external
 *      services (Gmail SMTP, Discord REST) or need a real database.
 *
 * Usage (mirrors the graceful-skip pattern in fileParser.test.ts):
 *   import { IS_CI } from "./_core/ciTestGuard";
 *   describe.skipIf(IS_CI)("…", () => { … });   // whole suite
 *   it.skipIf(IS_CI)("…", () => { … });          // single probe
 *
 * GitHub Actions always sets CI=true; local runs normally don't, so the
 * probes still execute wherever real credentials are expected to exist.
 */
export const IS_CI = process.env.CI === "true" || process.env.CI === "1";
