import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "vitest";

import { loadAccessManifest, REPOSITORY_ROOT } from "./dime-agent-access.mjs";
import { loadManifest as loadControlPlaneManifest } from "./dime-control-plane.mjs";
import {
  expectedPlatformIdentity,
  parseRailwayCredentialPayload,
  railwayPlatformCredentialPlan,
  verifyPlatformIdentity,
} from "./dime-production-auth.mjs";

async function fixture() {
  return structuredClone((await loadAccessManifest()).manifest);
}

function ownerEnvironment() {
  return {
    DIME_PROD_OWNER_EMAIL: "owner@example.invalid",
    DIME_PROD_OWNER_PASSWORD: ["valid", "test", "password"].join("-"),
    DIME_PROD_OWNER_USERNAME: "owner_test",
  };
}

test("owner and user Railway reads remain role-separated and target-pinned", async () => {
  const manifest = await fixture();
  const { manifest: targets } = await loadControlPlaneManifest();
  const owner = railwayPlatformCredentialPlan(manifest, targets, "owner");
  const user = railwayPlatformCredentialPlan(manifest, targets, "user");
  assert.match(owner.executable, /dime-railway-keychain$/);
  assert.match(user.executable, /dime-railway-keychain$/);
  assert.deepEqual(owner.args, ["platform-auth", "owner"]);
  assert.deepEqual(user.args, ["platform-auth", "user"]);
  assert.equal(owner.serviceId, null);
  assert.deepEqual(
    owner.names,
    Object.values(manifest.platform.roles.owner.environment)
  );
  assert.deepEqual(
    user.names,
    Object.values(manifest.platform.roles.user.environment)
  );
  assert.equal(owner.scope, "railway-platform-owner");
  assert.equal(user.scope, "railway-platform-user");
  assert.equal(owner.retrieval, "native-broker-exact-role-authentication");
  assert.equal(
    owner.args.some(value => ["shell", "run"].includes(value)),
    false
  );
});

test("Railway credential payload accepts only the exact role triple", async () => {
  const manifest = await fixture();
  const names = Object.values(manifest.platform.roles.owner.environment);
  const environment = ownerEnvironment();
  assert.deepEqual(
    parseRailwayCredentialPayload(JSON.stringify(environment), names),
    environment
  );
  assert.throws(
    () =>
      parseRailwayCredentialPayload(
        JSON.stringify({ ...environment, DATABASE_URL: "must-not-cross" }),
        names
      ),
    /exact role triple/
  );
  assert.throws(
    () =>
      parseRailwayCredentialPayload(
        JSON.stringify({ ...environment, DIME_PROD_OWNER_PASSWORD: null }),
        names
      ),
    /DIME_PROD_OWNER_PASSWORD/
  );
});

test("expected platform identity requires the exact environment triple", async () => {
  const manifest = await fixture();
  const environment = ownerEnvironment();
  const expected = expectedPlatformIdentity(manifest, "owner", environment);
  assert.equal(expected.email, environment.DIME_PROD_OWNER_EMAIL);
  assert.equal(expected.username, environment.DIME_PROD_OWNER_USERNAME);
  assert.equal(expected.expectedRole, "owner");
  assert.throws(
    () =>
      expectedPlatformIdentity(manifest, "owner", {
        ...environment,
        DIME_PROD_OWNER_PASSWORD: "",
      }),
    /DIME_PROD_OWNER_PASSWORD/
  );
});

test("authenticated identity must match email, username, role, and access", async () => {
  const manifest = await fixture();
  const expected = expectedPlatformIdentity(
    manifest,
    "owner",
    ownerEnvironment()
  );
  const verified = verifyPlatformIdentity(
    {
      email: expected.email,
      username: expected.username,
      role: "owner",
      hasAccess: true,
      sessionExpiresAt: Date.now() + 60_000,
    },
    expected
  );
  const serialized = JSON.stringify(verified);
  assert.equal(serialized.includes(expected.email), false);
  assert.equal(serialized.includes(expected.username), false);
  assert.match(verified.identityFingerprint, /^[0-9a-f]{16}$/);

  assert.throws(
    () =>
      verifyPlatformIdentity(
        {
          email: expected.email,
          username: expected.username,
          role: "user",
          hasAccess: true,
        },
        expected
      ),
    /role identity mismatch/
  );
});

test("production auth source pins the origin, identity endpoint, selectors, and one-attempt contract", async () => {
  const source = await readFile(
    resolve(REPOSITORY_ROOT, "scripts/dime-production-auth.mjs"),
    "utf8"
  );
  assert.match(source, /manifest\.platform\.origin/);
  assert.match(source, /manifest\.platform\.identityProcedure/);
  assert.match(source, /"#identifier"/);
  assert.match(source, /"#password"/);
  assert.match(source, /loginAttempts:/);
  assert.equal((source.match(/await loginOnce\(/g) ?? []).length, 1);
  assert.equal(source.includes("storageState:"), false);
  assert.equal(
    source.includes("browser.newContext({ acceptDownloads: false })"),
    true
  );
  assert.equal(source.includes("credentialValuesCached: false"), true);
  assert.equal(source.includes('lifetime: "browser-process-only"'), true);
  assert.equal(source.includes('"shell"'), false);
  assert.equal(source.includes('"run"'), false);
  assert.equal(source.includes("console.log(expected.password)"), false);
});
