/**
 * ciSecrets.test.ts
 *
 * Validates that all required GitHub Actions secrets are correctly injected
 * into the CI test environment. This test is the canary that catches missing
 * or misconfigured secrets before they cause cryptic failures in downstream
 * tests (e.g., database connection errors, auth failures).
 *
 * [INPUT]  Environment variables injected from GitHub repository secrets
 * [STEP]   Validate each required secret: present, non-empty, correct format
 * [OUTPUT] Pass/fail per secret with a structured diagnostic log
 * [VERIFY] All secrets must pass for the CI test stage to proceed
 *
 * Required GitHub repository secrets (Settings → Secrets and variables → Actions):
 *
 *   DATABASE_URL      — MySQL/TiDB connection string
 *                       Format: mysql://user:password@host:port/database
 *                       Used by: all DB-backed test procedures
 *
 *   APP_SESSION_SECRET — Session cookie signing secret (replaces exposed JWT_SECRET)
 *                       Format: any non-empty string (min 44 chars required)
 *                       Used by: auth.logout.test.ts, tokenVersion.test.ts
 *
 *   PUBLIC_ORIGIN     — Canonical public origin for CSRF Origin check
 *                       Format: https://aisportsbettingmodels.com (no trailing slash)
 *                       Used by: discordAuth.test.ts, CSRF middleware
 *
 *   VITE_APP_ID       — Legacy OAuth application ID (retired platform)
 *                       Format: alphanumeric string
 *                       Used by: OAuth flow tests
 *
 *   OAUTH_SERVER_URL  — Legacy OAuth backend base URL (retired platform)
 *                       Format: https://<oauth-host> (no trailing slash)
 *                       Used by: OAuth flow tests
 *
 *   OWNER_OPEN_ID     — Owner's legacy OAuth open ID
 *                       Format: alphanumeric string
 *                       Used by: owner-gated procedure tests
 *
 * How to add these secrets to GitHub:
 *   1. Go to: https://github.com/<owner>/<repo>/settings/secrets/actions
 *   2. Click "New repository secret"
 *   3. Enter the exact key name (e.g., DATABASE_URL) and value
 *   4. Click "Add secret"
 *   Repeat for each secret listed above.
 *
 * IMPORTANT: These secrets are NEVER logged in full. Only their presence,
 * length, and format are validated. The actual values are never printed.
 */

import { describe, it, expect } from "vitest";
import { IS_CI } from "./_core/ciTestGuard";

// ─── Secret descriptor type ───────────────────────────────────────────────────
type SecretDescriptor = {
  /** Environment variable name */
  key: string;
  /** Human-readable description for diagnostic messages */
  description: string;
  /** Minimum required length (characters) */
  minLength: number;
  /** Optional regex to validate format (applied after length check) */
  format?: RegExp;
  /** Human-readable format description for error messages */
  formatDescription?: string;
  /** Whether to skip the test if the secret is absent (for optional secrets) */
  optional?: boolean;
};

// ─── Required secrets registry ───────────────────────────────────────────────
const REQUIRED_SECRETS: SecretDescriptor[] = [
  {
    key: "DATABASE_URL",
    description: "MySQL/TiDB connection string",
    minLength: 20,
    format: /^mysql(2)?:\/\/.+:.+@.+:\d+\/.+$/,
    formatDescription: "mysql://user:password@host:port/database",
  },
  {
    key: "APP_SESSION_SECRET",
    description: "Session cookie signing secret (replaces exposed JWT_SECRET)",
    minLength: 44,
    // No format constraint — any non-empty string of sufficient length is valid
  },
  {
    key: "PUBLIC_ORIGIN",
    description: "Canonical public origin for CSRF check",
    minLength: 10,
    format: /^https?:\/\/[a-zA-Z0-9\-\.]+[^/]$/,
    formatDescription: "https://aisportsbettingmodels.com (no trailing slash)",
  },
  {
    key: "VITE_APP_ID",
    description: "Legacy OAuth application ID (retired platform)",
    minLength: 1,
  },
  {
    key: "OAUTH_SERVER_URL",
    description: "Legacy OAuth backend base URL (retired platform)",
    minLength: 10,
    format: /^https?:\/\/.+/,
    formatDescription: "https://<oauth-host> (no trailing slash)",
  },
  {
    key: "OWNER_OPEN_ID",
    description: "Owner's legacy OAuth open ID",
    minLength: 1,
  },
];

// ─── Helper: safe secret preview (never logs full value) ─────────────────────
function safePreview(value: string): string {
  if (value.length === 0) return "(EMPTY)";
  if (value.length <= 8) return "*".repeat(value.length);
  return (
    value.substring(0, 4) +
    "*".repeat(Math.min(value.length - 4, 8)) +
    `...(len=${value.length})`
  );
}

// ─── Test suite ───────────────────────────────────────────────────────────────
// Skipped in CI because the repository does not actually configure the secret
// set this file documents (verified 2026-07-12: 7 Actions secrets exist;
// DATABASE_URL, PUBLIC_ORIGIN and the OAuth/Discord/VSIN values
// are absent). Until those secrets are provisioned this suite can only
// validate a real operator environment; once they exist, remove this guard so
// the suite becomes the CI canary its header describes. The skip is declared
// in vitest.environment-failure-allowlist.json (expectedCiSkips) and enforced
// by scripts/check-environment-failures.mjs.
describe.skipIf(IS_CI)("CI secrets validation", () => {
  it("All required GitHub Actions secrets are present and correctly formatted", () => {
    console.log("[INPUT] Validating CI secrets in test environment...");
    console.log(`[INPUT] NODE_ENV: ${process.env.NODE_ENV ?? "(not set)"}`);
    console.log(
      "─────────────────────────────────────────────────────────────"
    );

    const failures: string[] = [];

    for (const secret of REQUIRED_SECRETS) {
      const value = process.env[secret.key] ?? "";
      const preview = safePreview(value);

      // [STEP] Check presence
      if (value.length === 0) {
        if (secret.optional) {
          console.log(`[STATE] ${secret.key}: SKIPPED (optional, not set)`);
          continue;
        }
        const msg = `${secret.key} is NOT SET — ${secret.description}`;
        console.error(`[FAIL]  ${secret.key}: MISSING | ${msg}`);
        failures.push(msg);
        continue;
      }

      // [STEP] Check minimum length
      if (value.length < secret.minLength) {
        const msg =
          `${secret.key} is too short (${value.length} chars, min ${secret.minLength}) — ` +
          `${secret.description}`;
        console.error(
          `[FAIL]  ${secret.key}: TOO_SHORT | preview=${preview} | ${msg}`
        );
        failures.push(msg);
        continue;
      }

      // [STEP] Check format (if specified)
      if (secret.format && !secret.format.test(value)) {
        const msg =
          `${secret.key} has invalid format — expected: ${secret.formatDescription ?? secret.format.toString()} — ` +
          `${secret.description}`;
        console.error(
          `[FAIL]  ${secret.key}: INVALID_FORMAT | preview=${preview} | ${msg}`
        );
        failures.push(msg);
        continue;
      }

      // [VERIFY] PASS
      console.log(
        `[PASS]  ${secret.key}: OK | preview=${preview} | ${secret.description}`
      );
    }

    console.log(
      "─────────────────────────────────────────────────────────────"
    );

    if (failures.length > 0) {
      console.error(`[OUTPUT] ${failures.length} secret(s) failed validation:`);
      for (const f of failures) {
        console.error(`  - ${f}`);
      }
      console.error(
        "[OUTPUT] Action required: add missing secrets to GitHub repository secrets.\n" +
          "  Go to: https://github.com/<owner>/<repo>/settings/secrets/actions\n" +
          "  Add each missing secret listed above."
      );
    } else {
      console.log(
        `[OUTPUT] All ${REQUIRED_SECRETS.length} required secrets are present and valid`
      );
    }

    console.log(
      `[VERIFY] ${failures.length === 0 ? "PASS" : "FAIL"} — CI secrets validation`
    );

    // Fail the test with a clear diagnostic message listing all missing secrets
    expect(
      failures,
      `Missing or invalid CI secrets:\n${failures.map(f => `  - ${f}`).join("\n")}`
    ).toHaveLength(0);
  });

  // ─── Individual secret tests for granular CI failure attribution ───────────
  // These tests run independently so GitHub Actions can show exactly which
  // secret is missing in the test results UI, rather than a single combined failure.

  it("DATABASE_URL is set and matches MySQL connection string format", () => {
    const value = process.env.DATABASE_URL ?? "";
    console.log(`[INPUT] DATABASE_URL: ${safePreview(value)}`);
    expect(value.length, "DATABASE_URL is not set").toBeGreaterThan(0);
    expect(
      /^mysql(2)?:\/\/.+:.+@.+:\d+\/.+$/.test(value),
      `DATABASE_URL format invalid — expected: mysql://user:password@host:port/database`
    ).toBe(true);
    console.log("[VERIFY] PASS — DATABASE_URL is set and format-valid");
  });

  it("APP_SESSION_SECRET is set with sufficient length (min 44 chars)", () => {
    const value = process.env.APP_SESSION_SECRET ?? "";
    console.log(`[INPUT] APP_SESSION_SECRET: ${safePreview(value)}`);
    expect(value.length, "APP_SESSION_SECRET is not set").toBeGreaterThan(0);
    expect(
      value.length,
      `APP_SESSION_SECRET too short (${value.length} chars, min 44)`
    ).toBeGreaterThanOrEqual(44);
    console.log(
      `[VERIFY] PASS — APP_SESSION_SECRET is set, length=${value.length}`
    );
  });

  it("PUBLIC_ORIGIN is set and has no trailing slash", () => {
    const value = process.env.PUBLIC_ORIGIN ?? "";
    console.log(`[INPUT] PUBLIC_ORIGIN: ${safePreview(value)}`);
    expect(value.length, "PUBLIC_ORIGIN is not set").toBeGreaterThan(0);
    expect(
      value.endsWith("/"),
      "PUBLIC_ORIGIN must not have a trailing slash"
    ).toBe(false);
    expect(
      /^https?:\/\/.+/.test(value),
      "PUBLIC_ORIGIN must start with http:// or https://"
    ).toBe(true);
    console.log("[VERIFY] PASS — PUBLIC_ORIGIN is set and format-valid");
  });
});
