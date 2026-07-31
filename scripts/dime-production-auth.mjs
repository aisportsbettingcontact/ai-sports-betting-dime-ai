#!/usr/bin/env node

/**
 * Explicit, role-separated production login harness for Dime.
 *
 * Credentials are read only for an explicit login from pinned Railway shared
 * variables. A shell-free child pipeline sends Railway's raw response directly
 * into an ephemeral exact-role filter, so only the three reviewed values reach
 * this process. The script makes at most one credential login attempt, verifies
 * the authenticated server identity, and never persists browser session state.
 */

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  credentialPresence,
  loadAccessManifest,
  minimalEnvironment,
  redactAgentError,
  REPOSITORY_ROOT,
} from "./dime-agent-access.mjs";
import { loadManifest as loadControlPlaneManifest } from "./dime-control-plane.mjs";
import {
  SECURE_RAILWAY_EXECUTABLE,
  verifySecureRailwayBroker,
} from "./dime-railway-secure.mjs";
import { verifyAuthenticationClosure } from "./lib/dime-authentication-closure.mjs";

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const AUTH_CACHE_ROOT = resolve(REPOSITORY_ROOT, ".cache/dime-agent-auth");
const COMMAND_TIMEOUT_MS = 90_000;
const PAGE_TIMEOUT_MS = 35_000;
const MAX_RAILWAY_CREDENTIAL_RESPONSE_BYTES = 32 * 1024;
const SOURCE_MARKER = "DIME_PLATFORM_CREDENTIAL_SOURCE";
const CLOSURE_PREFLIGHT_MARKER = "DIME_AUTH_CLOSURE_PREFLIGHT";
const ALLOWED_ROLES = new Set(["owner", "user"]);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function rolePaths(role) {
  return {
    storage: resolve(AUTH_CACHE_ROOT, `${role}.storage-state.json`),
    metadata: resolve(AUTH_CACHE_ROOT, `${role}.metadata.json`),
  };
}

function safeRailwayEnvironment(scope) {
  return minimalEnvironment({
    [SOURCE_MARKER]: scope,
  });
}

export function railwayPlatformCredentialPlan(
  manifest,
  targets,
  role,
  { headed = false } = {}
) {
  invariant(ALLOWED_ROLES.has(role), `unknown platform role: ${role}`);
  invariant(
    manifest.platform.credentialSource.kind === "railway-service-variables" &&
      manifest.platform.credentialSource.service === "shared" &&
      manifest.platform.credentialSource.retrieval ===
        "native-broker-exact-role-authentication",
    "Railway platform credential source is not pinned"
  );
  invariant(
    targets.railway.project.id === manifest.providers.railway.projectId &&
      targets.railway.environment.id ===
        manifest.providers.railway.environmentId,
    "Railway platform target mismatch"
  );
  return {
    executable: SECURE_RAILWAY_EXECUTABLE,
    args: ["platform-auth", role, ...(headed ? ["--headed"] : [])],
    names: Object.values(manifest.platform.roles[role].environment),
    scope: `railway-platform-${role}`,
    serviceId: null,
    retrieval: "native-broker-exact-role-authentication",
  };
}

export function parseRailwayCredentialPayload(output, names) {
  invariant(
    Buffer.byteLength(output, "utf8") <= MAX_RAILWAY_CREDENTIAL_RESPONSE_BYTES,
    "Railway credential response exceeded the size limit"
  );
  let payload;
  try {
    payload = JSON.parse(output);
  } catch {
    throw new Error("Railway credential response was not valid JSON");
  }
  invariant(
    payload && typeof payload === "object" && !Array.isArray(payload),
    "Railway credential response must be an object"
  );
  const actualNames = Object.keys(payload).sort();
  const expectedNames = [...names].sort();
  invariant(
    actualNames.length === expectedNames.length &&
      actualNames.every((name, index) => name === expectedNames[index]),
    "Railway credential response did not contain the exact role triple"
  );
  const presence = credentialPresence(payload, names);
  invariant(
    presence.configured,
    `missing required Railway credential environment: ${presence.missingNames.join(", ")}`
  );
  return payload;
}

export function expectedPlatformIdentity(manifest, role, environment) {
  invariant(ALLOWED_ROLES.has(role), `unknown platform role: ${role}`);
  const config = manifest.platform.roles[role];
  const names = config.environment;
  const presence = credentialPresence(environment, [
    names.email,
    names.password,
    names.username,
  ]);
  invariant(
    presence.configured,
    `missing required credential environment: ${presence.missingNames.join(", ")}`
  );
  const email = environment[names.email];
  const username = environment[names.username];
  const password = environment[names.password];
  invariant(
    email.includes("@") && email.length <= 320,
    `${names.email} is not a valid email identity`
  );
  invariant(
    /^[A-Za-z0-9_.-]{1,80}$/.test(username),
    `${names.username} is not a valid username identity`
  );
  invariant(
    password.length >= 8 && password.length <= 1_024,
    `${names.password} length is invalid`
  );
  return {
    role,
    expectedRole: config.expectedRole,
    email,
    username,
    password,
  };
}

export function verifyPlatformIdentity(actual, expected) {
  invariant(
    actual && typeof actual === "object",
    "platform identity is absent"
  );
  invariant(
    actual.hasAccess === true,
    "platform identity does not have access"
  );
  invariant(
    String(actual.email ?? "").toLowerCase() === expected.email.toLowerCase(),
    "platform email identity mismatch"
  );
  invariant(
    String(actual.username ?? "").toLowerCase() ===
      expected.username.toLowerCase(),
    "platform username identity mismatch"
  );
  invariant(
    actual.role === expected.expectedRole,
    "platform role identity mismatch"
  );
  return {
    role: expected.role,
    expectedRole: expected.expectedRole,
    identityFingerprint: platformIdentityFingerprint(actual),
    sessionExpiresAt:
      typeof actual.sessionExpiresAt === "number"
        ? actual.sessionExpiresAt
        : null,
  };
}

function platformIdentityFingerprint(actual) {
  return sha256(
    `${String(actual.email).toLowerCase()}\0${String(
      actual.username
    ).toLowerCase()}\0${actual.role}`
  ).slice(0, 16);
}

async function removeRoleCache(role) {
  const paths = rolePaths(role);
  await Promise.all(
    Object.values(paths).map(async path => {
      try {
        await unlink(path);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    })
  );
}

async function readAuthenticatedIdentity(page, procedure) {
  const result = await page.evaluate(async procedureName => {
    const input = encodeURIComponent(JSON.stringify({ json: null }));
    const response = await fetch(`/api/trpc/${procedureName}?input=${input}`, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    const payload = await response.json();
    const findIdentity = value => {
      if (!value || typeof value !== "object") return null;
      if (
        typeof value.email === "string" &&
        typeof value.username === "string" &&
        typeof value.role === "string" &&
        typeof value.hasAccess === "boolean"
      ) {
        return {
          email: value.email,
          username: value.username,
          role: value.role,
          hasAccess: value.hasAccess,
          sessionExpiresAt:
            typeof value.sessionExpiresAt === "number"
              ? value.sessionExpiresAt
              : null,
        };
      }
      for (const child of Object.values(value)) {
        const match = findIdentity(child);
        if (match) return match;
      }
      return null;
    };
    return {
      ok: response.ok,
      status: response.status,
      identity: findIdentity(payload),
    };
  }, procedure);
  invariant(
    result.ok,
    `platform identity request returned HTTP ${result.status}`
  );
  return result.identity;
}

async function loginOnce(browser, manifest, expected, headed) {
  const context = await browser.newContext({ acceptDownloads: false });
  const page = await context.newPage();
  page.setDefaultTimeout(PAGE_TIMEOUT_MS);
  const loginUrl = new URL(
    manifest.platform.loginPath,
    manifest.platform.origin
  );
  loginUrl.searchParams.set("returnPath", manifest.platform.authenticatedPath);
  await page.goto(loginUrl.href, { waitUntil: "domcontentloaded" });
  await page.locator("#identifier").fill(expected.email);
  await page.locator("#password").fill(expected.password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.waitForURL(
    url =>
      url.origin === manifest.platform.origin &&
      url.pathname === manifest.platform.authenticatedPath,
    { timeout: PAGE_TIMEOUT_MS }
  );
  const actual = await readAuthenticatedIdentity(
    page,
    manifest.platform.identityProcedure
  );
  const verified = verifyPlatformIdentity(actual, expected);
  return {
    context,
    page,
    verified,
    headed,
    credentialLoginAttempted: true,
  };
}

async function verifyWithBrowser(
  manifest,
  role,
  { headed, credentialLoader, browserExecutablePath }
) {
  await removeRoleCache(role);
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    executablePath: browserExecutablePath,
    headless: !headed,
    env: minimalEnvironment(),
  });
  try {
    const expected = await credentialLoader();
    let result;
    try {
      result = await loginOnce(browser, manifest, expected, headed);
    } finally {
      expected.email = "";
      expected.username = "";
      expected.password = "";
    }

    const output = {
      schemaVersion: 1,
      kind: "dime-production-auth-verification",
      status: "PASS",
      role,
      expectedRole: result.verified.expectedRole,
      identityFingerprint: result.verified.identityFingerprint,
      platformOrigin: manifest.platform.origin,
      session: {
        persisted: false,
        storageStateWritten: false,
        lifetime: "browser-process-only",
      },
      sideEffects: {
        credentialLoginAttempted: result.credentialLoginAttempted,
        lastSignedInUpdated: result.credentialLoginAttempted,
      },
      safety: {
        credentialSource: manifest.platform.credentialSource.kind,
        credentialValuesPrinted: false,
        credentialValuesCached: false,
        railwayRawVariableMapVisibleToAgent: false,
        railwayVariableValuesPersisted: false,
        sessionValuesPrinted: false,
        sessionValuesPersisted: false,
        loginAttempts: result.credentialLoginAttempted ? 1 : 0,
        remoteMutationAuthorization: false,
      },
    };

    if (headed) {
      process.stdout.write(
        `${JSON.stringify(output, null, 2)}\n` +
          "Verified production browser is open. Close the browser to end this command.\n"
      );
      await new Promise(resolvePromise =>
        browser.once("disconnected", resolvePromise)
      );
      return { output, alreadyPrinted: true };
    }
    await result.context.close();
    await browser.close();
    return { output, alreadyPrinted: false };
  } catch (error) {
    await browser.close().catch(() => undefined);
    throw error;
  }
}

async function readPrivateCredentialInput(names) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    invariant(
      bytes <= MAX_RAILWAY_CREDENTIAL_RESPONSE_BYTES,
      "private credential payload exceeded the size limit"
    );
    chunks.push(Buffer.from(chunk));
  }
  const payload = Buffer.concat(chunks, bytes);
  for (const chunk of chunks) chunk.fill(0);
  try {
    return parseRailwayCredentialPayload(
      payload.toString("utf8").trim(),
      names
    );
  } finally {
    payload.fill(0);
  }
}

async function runNativePlatformAuth(manifest, role, passthrough) {
  const { manifest: targets } = await loadControlPlaneManifest();
  await verifySecureRailwayBroker();
  const plan = railwayPlatformCredentialPlan(manifest, targets, role, {
    headed: passthrough.headed,
  });
  const result = await execFileAsync(plan.executable, plan.args, {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    timeout: passthrough.headed ? undefined : COMMAND_TIMEOUT_MS,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
    env: safeRailwayEnvironment(plan.scope),
  });
  return String(result.stdout ?? "").trim();
}

function parseArguments(argv) {
  const values = argv.filter(value => value !== "--");
  const command =
    values[0] && !values[0].startsWith("-") ? values.shift() : "verify";
  let role = null;
  let refresh = false;
  let headed = false;
  let json = false;
  let brokerActive = false;
  let help = false;
  while (values.length > 0) {
    const value = values.shift();
    if (value === "--role") role = values.shift() ?? null;
    else if (value === "--refresh") refresh = true;
    else if (value === "--headed") headed = true;
    else if (value === "--json") json = true;
    else if (value === "--broker-active") brokerActive = true;
    else if (value === "-h" || value === "--help") help = true;
    else throw new Error(`unknown option: ${value}`);
  }
  return { command, role, refresh, headed, json, brokerActive, help };
}

function help() {
  return `Dime explicit production authentication v1

Usage:
  node scripts/dime-production-auth.mjs verify --role owner|user [--refresh] [--headed] [--json]
  node scripts/dime-production-auth.mjs invalidate --role owner|user

Every explicit login delegates to the independently provenance-pinned native
broker. The broker captures the full Railway map privately, selects the exact
role triple inside native code, and sends only that triple to this fixed child
over private standard input. No variable map or credential value is printed.
Production login is explicit and does not authorize any other remote mutation.`;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${help()}\n`);
    return;
  }
  if (args.command === "closure-preflight") {
    invariant(
      args.brokerActive &&
        process.env[CLOSURE_PREFLIGHT_MARKER] === "1" &&
        process.env[SOURCE_MARKER] === undefined,
      "closure preflight is reserved for the provenance-pinned native broker"
    );
    const closure = await verifyAuthenticationClosure();
    process.stdout.write(
      `${JSON.stringify({
        schemaVersion: closure.schemaVersion,
        kind: closure.kind,
        status: closure.status,
        credentialBytesRead: closure.credentialBytesRead,
        authorization: closure.authorization,
      })}\n`
    );
    return;
  }
  invariant(ALLOWED_ROLES.has(args.role), "--role must be owner or user");
  const { manifest } = await loadAccessManifest();

  if (args.command === "invalidate") {
    await removeRoleCache(args.role);
    process.stdout.write(
      `Local ${args.role} production-auth cache invalidated.\n`
    );
    return;
  }
  invariant(args.command === "verify", `unknown command: ${args.command}`);

  const scope = `railway-platform-${args.role}`;
  if (process.env[SOURCE_MARKER] !== scope) {
    invariant(
      !args.brokerActive,
      "--broker-active is reserved for the provenance-pinned native broker"
    );
    const output = await runNativePlatformAuth(manifest, args.role, args);
    process.stdout.write(`${output}\n`);
    return;
  }
  invariant(
    args.brokerActive,
    "Railway source marker requires --broker-active"
  );
  const closure = await verifyAuthenticationClosure();
  const names = Object.values(manifest.platform.roles[args.role].environment);
  const result = await verifyWithBrowser(manifest, args.role, {
    headed: args.headed,
    browserExecutablePath: closure.manifest.browser.path,
    credentialLoader: async () => {
      const environment = await readPrivateCredentialInput(names);
      try {
        return expectedPlatformIdentity(manifest, args.role, environment);
      } finally {
        for (const name of Object.keys(environment)) environment[name] = "";
      }
    },
  });
  if (!result.alreadyPrinted) {
    process.stdout.write(
      args.json
        ? `${JSON.stringify(result.output, null, 2)}\n`
        : `Dime production ${args.role} auth: PASS\nSession persistence: DISABLED\nCredential values: NOT PRINTED\nRemote mutations: NOT AUTHORIZED\n`
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  main().catch(error => {
    process.stderr.write(
      `Dime production auth failed: ${redactAgentError(error?.message)}\n`
    );
    process.exitCode = 1;
  });
}
