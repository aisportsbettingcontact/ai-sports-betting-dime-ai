#!/usr/bin/env node

/**
 * Shared Dime agent access broker.
 *
 * The automatic path composes the existing read-only GitHub/Railway capsule
 * with sanitized identity evidence. Credential-bearing checks are isolated by
 * scope through 1Password `op run`; arbitrary child commands and secret-value
 * output are intentionally not implemented.
 */

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, lstat, open, readFile, stat, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  fixedMinimalEnvironment,
  resolveTrustedExecutable,
} from "./lib/dime-trusted-executables.mjs";
import {
  readIntegrityProtectedJson,
  tryWriteIntegrityProtectedJson,
} from "./lib/dime-integrity-envelope.mjs";

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = fileURLToPath(import.meta.url);
export const REPOSITORY_ROOT = resolve(dirname(SCRIPT_PATH), "..");
export const ACCESS_MANIFEST_PATH = resolve(
  REPOSITORY_ROOT,
  "config/dime-agent-access.v1.json"
);
export const ACCESS_CACHE_PATH = resolve(
  REPOSITORY_ROOT,
  ".cache/dime-agent-access/identity-v1.json"
);
const CREDENTIAL_CACHE_ROOT = resolve(
  REPOSITORY_ROOT,
  ".cache/dime-agent-access/credentials"
);
const CACHE_LOCK_PATH = `${ACCESS_CACHE_PATH}.lock`;
const CONTROL_PLANE_SCRIPT = resolve(
  REPOSITORY_ROOT,
  "scripts/dime-control-plane.mjs"
);
const COMMAND_TIMEOUT_MS = 25_000;
const BROKER_TIMEOUT_MS = 90_000;
const MAX_BUFFER = 2 * 1024 * 1024;
const MAX_IDENTITY_RESPONSE_BYTES = 64 * 1024;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const AWS_PROFILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.@+-]{0,63}$/;
const EXPECTED_HF_SCOPES = new Set([
  "hf-training",
  "hf-serving",
  "hf-release-publisher",
  "hf-locked-evaluator",
  "hf-locked-publisher",
]);
const CREDENTIAL_SCOPES = new Set([...EXPECTED_HF_SCOPES, "runpod"]);
const BROKER_ENV_MARKER = "DIME_AGENT_BROKER_SCOPE";

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function requireExactKeys(value, expected, label) {
  invariant(value && typeof value === "object", `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  invariant(
    actual.length === required.length &&
      actual.every((key, index) => key === required[index]),
    `${label} keys must be exactly: ${required.join(", ")}`
  );
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function redactAgentError(value) {
  return String(value ?? "")
    .replace(/\bhf_[A-Za-z0-9]{12,}\b/g, "<redacted-huggingface-token>")
    .replace(/\brpa_[A-Za-z0-9_-]{12,}\b/g, "<redacted-runpod-api-key>")
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "<redacted-aws-access-key>")
    .replace(
      /\b(?:gh[opusr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,})\b/g,
      "<redacted-github-token>"
    )
    .replace(
      /\b(?:railway_[A-Za-z0-9_-]{12,}|rw_[A-Za-z0-9_-]{12,})\b/gi,
      "<redacted-railway-token>"
    )
    .replace(/\b(Bearer\s+)\S+/gi, "$1<redacted>")
    .replace(
      /([?&](?:api_key|token|key|secret|password)=)[^&\s]+/gi,
      "$1<redacted>"
    )
    .replace(
      /\b((?:token|api[_-]?key|secret|password)\s*[:=]\s*)\S+/gi,
      "$1<redacted>"
    )
    .slice(0, 2_000);
}

function validateBrokerFile(value, label) {
  invariant(
    typeof value === "string" &&
      /^\.env\.agent\.[a-z0-9-]+\.1password$/.test(value),
    `${label} must be a root .env.agent.<scope>.1password file`
  );
}

function validateOnePasswordReference(reference, expectedItem, label) {
  requireExactKeys(reference, ["vault", "item", "section", "field"], label);
  invariant(
    reference.vault === "Dime Infrastructure",
    `${label}.vault is invalid`
  );
  invariant(reference.item === expectedItem, `${label}.item is invalid`);
  invariant(reference.section === null, `${label}.section is invalid`);
  invariant(reference.field === "credential", `${label}.field is invalid`);
}

function onePasswordReferenceValue(reference) {
  return `op://${[
    reference.vault,
    reference.item,
    reference.section,
    reference.field,
  ]
    .filter(segment => segment !== null)
    .join("/")}`;
}

export function validateAccessManifest(manifest) {
  requireExactKeys(
    manifest,
    [
      "$schema",
      "schemaVersion",
      "kind",
      "controlPlaneManifest",
      "cache",
      "platform",
      "providers",
      "safety",
    ],
    "manifest"
  );
  invariant(manifest.schemaVersion === 1, "manifest schemaVersion must be 1");
  invariant(manifest.kind === "dime-agent-access", "manifest kind is invalid");
  invariant(
    manifest.controlPlaneManifest ===
      "config/dime-control-plane-targets.v1.json",
    "control-plane manifest path is invalid"
  );

  requireExactKeys(
    manifest.cache,
    ["identityTtlSeconds", "productionAuthPersistenceAllowed"],
    "cache"
  );
  invariant(
    Number.isInteger(manifest.cache.identityTtlSeconds) &&
      manifest.cache.identityTtlSeconds >= 30 &&
      manifest.cache.identityTtlSeconds <= 3_600,
    "identity cache TTL is invalid"
  );
  invariant(
    manifest.cache.productionAuthPersistenceAllowed === false,
    "production auth persistence must remain disabled"
  );

  requireExactKeys(
    manifest.platform,
    [
      "origin",
      "loginPath",
      "authenticatedPath",
      "identityProcedure",
      "browserChannel",
      "credentialSource",
      "roles",
    ],
    "platform"
  );
  invariant(
    manifest.platform.origin === "https://aisportsbettingmodels.com",
    "platform origin is invalid"
  );
  invariant(manifest.platform.loginPath === "/login", "login path is invalid");
  invariant(
    manifest.platform.authenticatedPath === "/chat",
    "authenticated path is invalid"
  );
  invariant(
    manifest.platform.identityProcedure === "appUsers.me",
    "identity procedure is invalid"
  );
  invariant(
    manifest.platform.browserChannel === "chrome",
    "browser channel is invalid"
  );
  requireExactKeys(
    manifest.platform.credentialSource,
    ["kind", "service", "retrieval", "plaintextCacheAllowed"],
    "platform.credentialSource"
  );
  invariant(
    manifest.platform.credentialSource.kind === "railway-service-variables" &&
      manifest.platform.credentialSource.service === "shared" &&
      manifest.platform.credentialSource.retrieval ===
        "native-broker-exact-role-authentication" &&
      manifest.platform.credentialSource.plaintextCacheAllowed === false,
    "platform credential source contract is invalid"
  );
  requireExactKeys(
    manifest.platform.roles,
    ["owner", "user"],
    "platform.roles"
  );

  const expectedRoleEnvironment = {
    owner: {
      email: "DIME_PROD_OWNER_EMAIL",
      password: "DIME_PROD_OWNER_PASSWORD",
      username: "DIME_PROD_OWNER_USERNAME",
    },
    user: {
      email: "DIME_PROD_USER_EMAIL",
      password: "DIME_PROD_USER_PASSWORD",
      username: "DIME_PROD_USER_USERNAME",
    },
  };
  for (const role of ["owner", "user"]) {
    const config = manifest.platform.roles[role];
    requireExactKeys(
      config,
      ["expectedRole", "environment"],
      `platform.roles.${role}`
    );
    invariant(config.expectedRole === role, `${role} expectedRole is invalid`);
    requireExactKeys(
      config.environment,
      ["email", "password", "username"],
      `${role}.environment`
    );
    invariant(
      JSON.stringify(config.environment) ===
        JSON.stringify(expectedRoleEnvironment[role]),
      `${role} environment names are invalid`
    );
  }

  requireExactKeys(
    manifest.providers,
    ["github", "railway", "onePassword", "aws", "huggingFace", "runPod"],
    "providers"
  );
  invariant(
    manifest.providers.github.repository ===
      "aisportsbettingcontact/ai-sports-betting-dime-ai",
    "GitHub repository is invalid"
  );
  invariant(
    manifest.providers.railway.projectId ===
      "8dd7341d-702c-48c7-90df-5c19a4f04913",
    "Railway project is invalid"
  );
  invariant(
    manifest.providers.railway.environmentId ===
      "787f3113-17ab-47d9-9819-1268aeb09b3e",
    "Railway environment is invalid"
  );
  invariant(
    manifest.providers.railway.cli === "dime-railway-keychain" &&
      manifest.providers.railway.credentialSource ===
        "macos-keychain-device-only-broker",
    "Railway Keychain broker contract is invalid"
  );
  invariant(
    manifest.providers.onePassword.injectionMode === "scope-isolated-op-run" &&
      manifest.providers.onePassword.plaintextSecretFilesAllowed === false,
    "1Password isolation contract is invalid"
  );
  invariant(
    manifest.providers.aws.staticCredentialsAllowed === false,
    "AWS static credentials must remain prohibited"
  );
  invariant(
    manifest.providers.aws.region === "us-west-2",
    "AWS region is invalid"
  );
  invariant(
    Array.isArray(manifest.providers.aws.allowedProfiles) &&
      manifest.providers.aws.allowedProfiles.includes(
        manifest.providers.aws.defaultProfile
      ),
    "AWS default profile must be allowlisted"
  );

  const brokerFiles = [];
  const hfScopes = manifest.providers.huggingFace.scopes;
  requireExactKeys(hfScopes, [...EXPECTED_HF_SCOPES], "huggingFace.scopes");
  for (const [scope, config] of Object.entries(hfScopes)) {
    requireExactKeys(
      config,
      ["credentialName", "tokenRole", "brokerEnvFile", "onePasswordReference"],
      `huggingFace.scopes.${scope}`
    );
    invariant(
      config.tokenRole === "fineGrained",
      `${scope} must require a fine-grained token`
    );
    validateBrokerFile(config.brokerEnvFile, `${scope}.brokerEnvFile`);
    validateOnePasswordReference(
      config.onePasswordReference,
      config.credentialName,
      `${scope}.onePasswordReference`
    );
    brokerFiles.push(config.brokerEnvFile);
  }
  invariant(
    manifest.providers.huggingFace.account === "taileredsports",
    "Hugging Face account is invalid"
  );
  invariant(
    manifest.providers.huggingFace.identityEndpoint ===
      "https://huggingface.co/api/whoami-v2",
    "Hugging Face identity endpoint is invalid"
  );
  invariant(
    manifest.providers.huggingFace.platformContract ===
      "ml/dime-1.0/configs/platform_contract.json",
    "Hugging Face platform contract path is invalid"
  );

  const runPod = manifest.providers.runPod;
  requireExactKeys(
    runPod,
    [
      "credentialName",
      "permissionContract",
      "identityVerified",
      "permissionsVerified",
      "brokerEnvFile",
      "onePasswordReference",
      "verificationEndpoint",
      "verificationMethod",
    ],
    "runPod"
  );
  invariant(
    runPod.permissionContract === "permission-unverified" &&
      runPod.identityVerified === false &&
      runPod.permissionsVerified === false,
    "RunPod permission contract is invalid"
  );
  invariant(
    runPod.verificationEndpoint ===
      "https://rest.runpod.io/v1/endpoints?includeTemplate=false&includeWorkers=false",
    "RunPod verification endpoint is invalid"
  );
  invariant(
    runPod.verificationMethod === "GET_BEARER",
    "RunPod verification method is invalid"
  );
  validateBrokerFile(runPod.brokerEnvFile, "runPod.brokerEnvFile");
  validateOnePasswordReference(
    runPod.onePasswordReference,
    `Run Pod - ${runPod.credentialName}`,
    "runPod.onePasswordReference"
  );
  brokerFiles.push(runPod.brokerEnvFile);
  invariant(
    new Set(brokerFiles).size === brokerFiles.length,
    "every credential scope must use a different broker environment file"
  );

  requireExactKeys(
    manifest.safety,
    [
      "automaticOperations",
      "credentialValuesInRepository",
      "credentialValuesInCache",
      "rawProviderResponsesInCache",
      "railwayVariableExportAllowed",
      "railwayExactPlatformCredentialReadAllowed",
      "arbitraryChildCommandsAllowed",
      "remoteMutationsAuthorized",
      "productionLoginIsExplicit",
      "trainingAuthorized",
      "providerActivationAuthorized",
    ],
    "safety"
  );
  invariant(
    JSON.stringify(manifest.safety.automaticOperations) ===
      JSON.stringify([
        "cached-context",
        "identity-diagnostics",
        "public-health",
      ]),
    "automatic operation allowlist is invalid"
  );
  for (const key of [
    "credentialValuesInRepository",
    "credentialValuesInCache",
    "rawProviderResponsesInCache",
    "railwayVariableExportAllowed",
    "arbitraryChildCommandsAllowed",
    "remoteMutationsAuthorized",
    "trainingAuthorized",
    "providerActivationAuthorized",
  ]) {
    invariant(manifest.safety[key] === false, `${key} must remain false`);
  }
  invariant(
    manifest.safety.railwayExactPlatformCredentialReadAllowed === true,
    "exact Railway platform-credential reads must remain explicitly allowed"
  );
  invariant(
    manifest.safety.productionLoginIsExplicit === true,
    "production login must remain explicit"
  );
  return manifest;
}

async function validateHuggingFaceContract(manifest) {
  const path = resolve(
    REPOSITORY_ROOT,
    manifest.providers.huggingFace.platformContract
  );
  const contract = JSON.parse(await readFile(path, "utf8"));
  const credentials = contract?.hugging_face?.credentials;
  invariant(
    credentials && typeof credentials === "object",
    "Hugging Face platform credential contract is missing"
  );
  for (const config of Object.values(manifest.providers.huggingFace.scopes)) {
    invariant(
      Object.hasOwn(credentials, config.credentialName),
      `Hugging Face credential ${config.credentialName} is absent from the platform contract`
    );
  }
}

export async function loadAccessManifest(path = ACCESS_MANIFEST_PATH) {
  const bytes = await readFile(path);
  const manifest = validateAccessManifest(JSON.parse(bytes.toString("utf8")));
  await validateHuggingFaceContract(manifest);
  return {
    manifest,
    manifestSha256: sha256(bytes),
  };
}

function copyEnvironment(names) {
  return Object.fromEntries(
    names
      .filter(name => process.env[name] !== undefined)
      .map(name => [name, process.env[name]])
  );
}

export function minimalEnvironment(extra = {}) {
  return fixedMinimalEnvironment(extra);
}

function controlPlaneEnvironment() {
  return minimalEnvironment({
    GH_PAGER: "cat",
  });
}

function brokerEnvironment() {
  return minimalEnvironment({
    ...copyEnvironment([
      "OP_SERVICE_ACCOUNT_TOKEN",
      "OP_CONNECT_HOST",
      "OP_CONNECT_TOKEN",
      "OP_ACCOUNT",
    ]),
  });
}

function clearBrokerCredentials() {
  for (const key of [
    "OP_SERVICE_ACCOUNT_TOKEN",
    "OP_CONNECT_HOST",
    "OP_CONNECT_TOKEN",
  ]) {
    delete process.env[key];
  }
}

async function run(executable, args, options = {}) {
  try {
    const result = await execFileAsync(executable, args, {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
      timeout: options.timeoutMs ?? COMMAND_TIMEOUT_MS,
      maxBuffer: options.maxBuffer ?? MAX_BUFFER,
      windowsHide: true,
      env: options.env ?? minimalEnvironment(),
    });
    return String(result.stdout ?? "").trim();
  } catch (error) {
    if (options.acceptExitCode2 && error?.code === 2 && error?.stdout) {
      return String(error.stdout).trim();
    }
    const detail = redactAgentError(
      error?.stderr || error?.stdout || error?.message
    );
    throw new Error(
      `${executable} ${args.slice(0, 4).join(" ")} failed: ${detail}`
    );
  }
}

async function runJson(executable, args, options = {}) {
  const output = await run(executable, args, options);
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(
      `${executable} returned invalid JSON: ${redactAgentError(
        output.slice(0, 300)
      )}`
    );
  }
}

async function runControlPlane(command, args = []) {
  const node = await resolveTrustedExecutable("node");
  return runJson(node.path, [CONTROL_PLANE_SCRIPT, command, ...args], {
    env: controlPlaneEnvironment(),
    acceptExitCode2: command === "context",
  });
}

async function acquireCacheLock() {
  await mkdir(dirname(ACCESS_CACHE_PATH), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const handle = await open(CACHE_LOCK_PATH, "wx", 0o600);
      await handle.writeFile(
        JSON.stringify({
          pid: process.pid,
          createdAt: new Date().toISOString(),
        })
      );
      await handle.close();
      return;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      try {
        const lock = await stat(CACHE_LOCK_PATH);
        if (Date.now() - lock.mtimeMs > 30_000) {
          await unlink(CACHE_LOCK_PATH);
          continue;
        }
      } catch (statError) {
        if (statError?.code !== "ENOENT") throw statError;
      }
      await new Promise(resolvePromise => setTimeout(resolvePromise, 100));
    }
  }
  throw new Error("timed out waiting for the agent-access cache lock");
}

async function releaseCacheLock() {
  try {
    await unlink(CACHE_LOCK_PATH);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export function accessCacheState(cache, manifestSha256, nowMs = Date.now()) {
  if (
    cache?.schemaVersion !== 1 ||
    cache?.kind !== "dime-agent-identity-cache" ||
    cache?.manifestSha256 !== manifestSha256
  ) {
    return { valid: false, fresh: false, ageSeconds: null };
  }
  const generatedAt = Date.parse(cache.generatedAt);
  const expiresAt = Date.parse(cache.expiresAt);
  if (!Number.isFinite(generatedAt) || !Number.isFinite(expiresAt)) {
    return { valid: false, fresh: false, ageSeconds: null };
  }
  return {
    valid: true,
    fresh: nowMs < expiresAt,
    ageSeconds: Math.max(0, Math.floor((nowMs - generatedAt) / 1_000)),
  };
}

async function readAccessCache(manifestSha256, allowStale = false) {
  try {
    const cache = await readIntegrityProtectedJson(ACCESS_CACHE_PATH);
    const state = accessCacheState(cache, manifestSha256);
    if (!state.valid || (!state.fresh && !allowStale)) return null;
    return {
      ...cache,
      cache: {
        hit: true,
        stale: !state.fresh,
        ageSeconds: state.ageSeconds,
      },
    };
  } catch {
    return null;
  }
}

function expectedBrokerVariable(scope) {
  invariant(CREDENTIAL_SCOPES.has(scope), `unknown credential scope: ${scope}`);
  return EXPECTED_HF_SCOPES.has(scope) ? "HF_TOKEN" : "RUNPOD_API_KEY";
}

function expectedBrokerReference(manifest, scope) {
  invariant(CREDENTIAL_SCOPES.has(scope), `unknown credential scope: ${scope}`);
  const reference = EXPECTED_HF_SCOPES.has(scope)
    ? manifest.providers.huggingFace.scopes[scope].onePasswordReference
    : manifest.providers.runPod.onePasswordReference;
  return onePasswordReferenceValue(reference);
}

export function validateBrokerReference(
  contents,
  expectedVariable,
  expectedReference
) {
  invariant(
    expectedVariable === "HF_TOKEN" || expectedVariable === "RUNPOD_API_KEY",
    "broker reference variable is invalid"
  );
  invariant(
    !contents.includes("\0") && !contents.includes("\r"),
    "broker reference file contains invalid control characters"
  );
  const lines = contents.endsWith("\n")
    ? contents.slice(0, -1).split("\n")
    : contents.split("\n");
  invariant(
    lines.length === 1 && lines[0].length > 0,
    "broker reference file must contain exactly one assignment"
  );
  const prefix = `${expectedVariable}=`;
  invariant(
    lines[0].startsWith(prefix),
    `broker reference file must assign only ${expectedVariable}`
  );
  invariant(
    typeof expectedReference === "string" &&
      expectedReference.startsWith("op://") &&
      expectedReference.length <= 4_096 &&
      !/[\u0000-\u001f\u007f]/.test(expectedReference) &&
      lines[0] === `${expectedVariable}="${expectedReference}"`,
    "broker reference must match the exact reviewed vault, item, section, and field"
  );
}

export async function secureBrokerFile(
  path,
  expectedVariable,
  expectedReference
) {
  try {
    const info = await lstat(path);
    invariant(
      !info.isSymbolicLink(),
      "broker reference path must not be a symlink"
    );
    invariant(info.isFile(), "broker reference path must be a regular file");
    invariant(info.size <= 8 * 1024, "broker reference file is too large");
    invariant(
      (info.mode & 0o7777) === 0o600,
      "broker reference file permissions must be 0600"
    );
    invariant(
      info.uid === process.getuid(),
      "broker reference file ownership mismatch"
    );
    validateBrokerReference(
      await readFile(path, "utf8"),
      expectedVariable,
      expectedReference
    );
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function brokerFileState(manifest, name, scope) {
  const path = resolve(REPOSITORY_ROOT, name);
  try {
    return {
      configured: await secureBrokerFile(
        path,
        expectedBrokerVariable(scope),
        expectedBrokerReference(manifest, scope)
      ),
      securePermissions: true,
    };
  } catch (error) {
    return {
      configured: true,
      securePermissions: false,
      error: redactAgentError(error?.message),
    };
  }
}

export function credentialPresence(environment, names) {
  const missing = names.filter(
    name =>
      typeof environment[name] !== "string" ||
      environment[name].length === 0 ||
      environment[name].length > 8_192
  );
  return {
    configured: missing.length === 0,
    requiredNames: [...names],
    missingNames: missing,
  };
}

export function credentialContractSha256(manifest, scope) {
  invariant(CREDENTIAL_SCOPES.has(scope), `unknown credential scope: ${scope}`);
  const contract = EXPECTED_HF_SCOPES.has(scope)
    ? {
        provider: "huggingface",
        account: manifest.providers.huggingFace.account,
        identityEndpoint: manifest.providers.huggingFace.identityEndpoint,
        credentialName:
          manifest.providers.huggingFace.scopes[scope].credentialName,
        tokenRole: manifest.providers.huggingFace.scopes[scope].tokenRole,
        onePasswordReference:
          manifest.providers.huggingFace.scopes[scope].onePasswordReference,
      }
    : {
        provider: "runpod",
        credentialName: manifest.providers.runPod.credentialName,
        permissionContract: manifest.providers.runPod.permissionContract,
        identityVerified: manifest.providers.runPod.identityVerified,
        permissionsVerified: manifest.providers.runPod.permissionsVerified,
        onePasswordReference: manifest.providers.runPod.onePasswordReference,
        verificationEndpoint: manifest.providers.runPod.verificationEndpoint,
        verificationMethod: manifest.providers.runPod.verificationMethod,
      };
  return sha256(JSON.stringify(contract));
}

export function normalizeHuggingFaceIdentity(identity, expected) {
  invariant(identity && typeof identity === "object", "HF identity is invalid");
  invariant(
    identity.name === expected.account,
    "Hugging Face account identity mismatch"
  );
  const auth = identity.auth;
  invariant(
    auth && auth.type === "access_token",
    "Hugging Face credential must be an access token"
  );
  const token = auth.accessToken;
  invariant(token && typeof token === "object", "HF token identity is missing");
  invariant(
    token.displayName === expected.credentialName,
    "Hugging Face credential-name mismatch"
  );
  invariant(
    token.role === expected.tokenRole,
    "Hugging Face credential role mismatch"
  );
  return {
    status: "PASS",
    account: expected.account,
    credentialName: expected.credentialName,
    tokenRole: expected.tokenRole,
    authorization: "IDENTITY_ONLY",
  };
}

export function normalizeAwsIdentity(identity, profile) {
  invariant(
    identity && typeof identity === "object",
    "AWS identity is invalid"
  );
  invariant(
    typeof identity.Account === "string" && identity.Account.length > 0,
    "AWS account identity is missing"
  );
  invariant(
    typeof identity.Arn === "string" && identity.Arn.startsWith("arn:aws:"),
    "AWS principal ARN is invalid"
  );
  const resource = identity.Arn.split(":").slice(5).join(":");
  const principalType = resource.startsWith("assumed-role/")
    ? "assumed-role"
    : resource.split("/")[0] || "unknown";
  return {
    status: "PASS",
    profile,
    region: "us-west-2",
    principalType,
    accountFingerprint: sha256(identity.Account).slice(0, 16),
    principalFingerprint: sha256(identity.Arn).slice(0, 16),
    authorization: "IDENTITY_ONLY",
  };
}

export function normalizeRunPodIdentity(identity, credentialName) {
  invariant(
    identity && typeof identity === "object",
    "RunPod identity is invalid"
  );
  invariant(
    typeof identity.id === "string" && identity.id.length > 0,
    "RunPod identity ID is missing"
  );
  invariant(
    typeof identity.email === "string" && identity.email.includes("@"),
    "RunPod identity email is missing"
  );
  return {
    status: "CREDENTIAL_PRESENT_PERMISSION_UNVERIFIED",
    configuredCredentialName: credentialName,
    identityVerified: false,
    permissionsVerified: false,
    authorization: "NONE",
  };
}

export function normalizeOnePasswordDesktopAccess(accounts, vaults) {
  invariant(
    Array.isArray(accounts) && accounts.length > 0,
    "1Password account list is empty"
  );
  invariant(
    Array.isArray(vaults) && vaults.length > 0,
    "1Password vault access is empty"
  );
  const account = accounts[0];
  invariant(
    typeof account.url === "string" && account.url.length > 0,
    "1Password account URL is missing"
  );
  let accountHost;
  try {
    accountHost = new URL(
      account.url.includes("://") ? account.url : `https://${account.url}`
    ).host;
  } catch {
    throw new Error("1Password account URL is invalid");
  }
  invariant(accountHost.length > 0, "1Password account host is invalid");
  invariant(
    vaults.every(
      vault =>
        vault &&
        typeof vault === "object" &&
        typeof vault.id === "string" &&
        vault.id.length > 0
    ),
    "1Password vault identity is invalid"
  );
  return {
    status: "PASS",
    accountHost,
    accountType: "desktop-app",
    accessibleVaultCount: vaults.length,
    authorization: "SECRET_REFERENCE_RESOLUTION_ONLY",
  };
}

async function inspectOnePassword() {
  const op = await resolveTrustedExecutable("op");
  try {
    const identity = await runJson(op.path, ["whoami", "--format=json"], {
      env: brokerEnvironment(),
    });
    let accountHost = null;
    try {
      accountHost = new URL(identity.url).host;
    } catch {
      accountHost = null;
    }
    return {
      status: "PASS",
      accountHost,
      accountType: identity.account_type ?? null,
      authorization: "SECRET_REFERENCE_RESOLUTION_ONLY",
    };
  } catch (identityError) {
    try {
      const accounts = await runJson(
        op.path,
        ["account", "list", "--format=json"],
        {
          env: brokerEnvironment(),
        }
      );
      const vaults = await runJson(
        op.path,
        ["vault", "list", "--format=json"],
        {
          env: brokerEnvironment(),
          timeoutMs: BROKER_TIMEOUT_MS,
        }
      );
      return normalizeOnePasswordDesktopAccess(accounts, vaults);
    } catch (desktopError) {
      return {
        status: "NOT_AUTHENTICATED",
        error: redactAgentError(
          desktopError?.message || identityError?.message
        ),
        authorization: "NONE",
      };
    }
  }
}

async function inspectAws(manifest) {
  const aws = manifest.providers.aws;
  const selected = process.env[aws.profileEnvironment] || aws.defaultProfile;
  invariant(
    AWS_PROFILE_PATTERN.test(selected) &&
      aws.allowedProfiles.includes(selected),
    "AWS profile is not in the reviewed allowlist"
  );
  try {
    const executable = await resolveTrustedExecutable("aws");
    const identity = await runJson(
      executable.path,
      [
        "sts",
        "get-caller-identity",
        "--profile",
        selected,
        "--region",
        aws.region,
        "--output",
        "json",
      ],
      { env: minimalEnvironment() }
    );
    return normalizeAwsIdentity(identity, selected);
  } catch (error) {
    return {
      status: "NOT_AUTHENTICATED",
      profile: selected,
      region: aws.region,
      error: redactAgentError(error?.message),
      authorization: "NONE",
    };
  }
}

function inspectRailwayPlatformCredentialSource(manifest) {
  const source = manifest.platform.credentialSource;
  return {
    status: "PASS",
    source: source.kind,
    service: source.service,
    retrieval: source.retrieval,
    rawMapVisibleToAgent: false,
    explicitOnly: true,
    valuesRead: false,
    authorization: "AUTHENTICATION_ONLY",
  };
}

async function allBrokerStates(manifest) {
  const entries = [
    ...Object.entries(manifest.providers.huggingFace.scopes).map(
      ([scope, config]) => [scope, config.brokerEnvFile]
    ),
    ["runpod", manifest.providers.runPod.brokerEnvFile],
  ];
  return Object.fromEntries(
    await Promise.all(
      entries.map(async ([scope, file]) => [
        scope,
        {
          brokerEnvFile: file,
          ...(await brokerFileState(manifest, file, scope)),
        },
      ])
    )
  );
}

function newCache(manifestSha256, ttlSeconds, previous = null) {
  const now = Date.now();
  return {
    schemaVersion: 1,
    kind: "dime-agent-identity-cache",
    manifestSha256,
    generatedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlSeconds * 1_000).toISOString(),
    providers: previous?.providers ?? {},
    credentials: previous?.credentials ?? {},
  };
}

async function saveCredentialResult(manifest, scope, result) {
  await tryWriteIntegrityProtectedJson(
    resolve(CREDENTIAL_CACHE_ROOT, `${scope}.json`),
    {
      schemaVersion: 1,
      kind: "dime-agent-credential-evidence",
      scope,
      contractSha256: credentialContractSha256(manifest, scope),
      verifiedAt: new Date().toISOString(),
      result,
    }
  );
}

async function readCredentialEvidence(manifest) {
  const entries = await Promise.all(
    [...CREDENTIAL_SCOPES].map(async scope => {
      try {
        const evidence = await readIntegrityProtectedJson(
          resolve(CREDENTIAL_CACHE_ROOT, `${scope}.json`)
        );
        invariant(
          evidence?.schemaVersion === 1 &&
            evidence?.kind === "dime-agent-credential-evidence" &&
            evidence?.scope === scope &&
            evidence?.contractSha256 ===
              credentialContractSha256(manifest, scope) &&
            (evidence?.result?.status === "PASS" ||
              (scope === "runpod" &&
                evidence?.result?.status ===
                  "CREDENTIAL_PRESENT_PERMISSION_UNVERIFIED")),
          "credential evidence contract mismatch"
        );
        return [
          scope,
          {
            ...evidence.result,
            verifiedAt: evidence.verifiedAt,
            contractSha256: evidence.contractSha256,
          },
        ];
      } catch {
        return [scope, null];
      }
    })
  );
  return Object.fromEntries(
    entries.filter(([, evidence]) => evidence !== null)
  );
}

async function runDoctor(manifest, manifestSha256) {
  const [
    controlPlane,
    onePassword,
    aws,
    platformCredentials,
    brokerFiles,
    credentialEvidence,
  ] = await Promise.all([
    runControlPlane("context"),
    inspectOnePassword(),
    inspectAws(manifest),
    inspectRailwayPlatformCredentialSource(manifest),
    allBrokerStates(manifest),
    readCredentialEvidence(manifest),
  ]);
  const previous = await readAccessCache(manifestSha256, true);
  const next = newCache(
    manifestSha256,
    manifest.cache.identityTtlSeconds,
    previous
  );
  next.providers = {
    controlPlane: {
      status: controlPlane.summary?.connection ?? "FAIL",
      githubRepository: controlPlane.github?.repository ?? null,
      railwayProjectId: controlPlane.railway?.project?.id ?? null,
      railwayEnvironmentId: controlPlane.railway?.environment?.id ?? null,
      authorization: "READ_ONLY",
    },
    onePassword,
    aws,
    platformCredentials,
    brokerFiles,
  };
  const cachePersisted = await tryWriteIntegrityProtectedJson(
    ACCESS_CACHE_PATH,
    next
  );
  return {
    schemaVersion: 1,
    kind: "dime-agent-access-doctor",
    generatedAt: next.generatedAt,
    manifestSha256,
    cacheIntegrity: cachePersisted
      ? "SIGNED_AND_VERIFIED"
      : "UNPERSISTED_TRUST_UNAVAILABLE",
    overall:
      controlPlane.summary?.connection === "PASS" &&
      onePassword.status === "PASS" &&
      aws.status === "PASS" &&
      platformCredentials.status === "PASS" &&
      Object.values(brokerFiles).every(
        state => state.configured && state.securePermissions
      )
        ? "PASS"
        : "SETUP_REQUIRED",
    controlPlane: {
      connection: controlPlane.summary?.connection ?? "FAIL",
      productionState: controlPlane.summary?.productionState ?? "UNKNOWN",
      repository: controlPlane.github?.repository ?? null,
      railwayProject: controlPlane.railway?.project ?? null,
      railwayEnvironment: controlPlane.railway?.environment ?? null,
    },
    onePassword,
    aws,
    platformCredentials: next.providers.platformCredentials,
    brokerFiles,
    credentialEvidence,
    safety: manifest.safety,
  };
}

async function verifyHuggingFaceCredential(manifest, scope) {
  const config = manifest.providers.huggingFace.scopes[scope];
  const presence = credentialPresence(process.env, ["HF_TOKEN"]);
  invariant(
    presence.configured,
    `missing required credential environment: ${presence.missingNames.join(", ")}`
  );
  const response = await fetch(
    manifest.providers.huggingFace.identityEndpoint,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${process.env.HF_TOKEN}`,
        "User-Agent": "dime-agent-access-v1",
      },
      redirect: "error",
      signal: AbortSignal.timeout(COMMAND_TIMEOUT_MS),
    }
  );
  const body = await response.text();
  invariant(
    Buffer.byteLength(body, "utf8") <= MAX_IDENTITY_RESPONSE_BYTES,
    "Hugging Face identity response exceeded the size limit"
  );
  invariant(
    response.ok,
    `Hugging Face identity request returned HTTP ${response.status}`
  );
  const identity = JSON.parse(body);
  const result = normalizeHuggingFaceIdentity(identity, {
    account: manifest.providers.huggingFace.account,
    credentialName: config.credentialName,
    tokenRole: config.tokenRole,
  });
  await saveCredentialResult(manifest, scope, result);
  return result;
}

async function verifyRunPodCredential(manifest) {
  const presence = credentialPresence(process.env, ["RUNPOD_API_KEY"]);
  invariant(
    presence.configured,
    `missing required credential environment: ${presence.missingNames.join(", ")}`
  );
  const runPod = manifest.providers.runPod;
  invariant(
    runPod.verificationMethod === "GET_BEARER",
    "RunPod verification method is invalid"
  );
  const response = await fetch(runPod.verificationEndpoint, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${process.env.RUNPOD_API_KEY}`,
      "User-Agent": "dime-agent-access-v1",
    },
    redirect: "error",
    signal: AbortSignal.timeout(COMMAND_TIMEOUT_MS),
  });
  const body = await response.text();
  invariant(
    Buffer.byteLength(body, "utf8") <= MAX_IDENTITY_RESPONSE_BYTES,
    "RunPod identity response exceeded the size limit"
  );
  invariant(
    response.ok,
    `RunPod identity request returned HTTP ${response.status}`
  );
  const payload = JSON.parse(body);
  invariant(Array.isArray(payload), "RunPod verification response is invalid");
  const result = {
    status: "CREDENTIAL_PRESENT_PERMISSION_UNVERIFIED",
    configuredCredentialName: runPod.credentialName,
    identityVerified: false,
    permissionsVerified: false,
    authorization: "NONE",
    accessibleEndpointCount: payload.length,
  };
  await saveCredentialResult(manifest, "runpod", result);
  return result;
}

export async function credentialBrokerPlan(
  manifest,
  scope,
  { executableResolver = resolveTrustedExecutable } = {}
) {
  invariant(CREDENTIAL_SCOPES.has(scope), `unknown credential scope: ${scope}`);
  const brokerEnvFile = EXPECTED_HF_SCOPES.has(scope)
    ? manifest.providers.huggingFace.scopes[scope].brokerEnvFile
    : manifest.providers.runPod.brokerEnvFile;
  const [op, node, environmentLauncher] = await Promise.all([
    executableResolver("op"),
    executableResolver("node"),
    executableResolver("env"),
  ]);
  return {
    executable: op.path,
    executableSha256: op.sha256,
    args: [
      "run",
      `--env-file=${resolve(REPOSITORY_ROOT, brokerEnvFile)}`,
      "--",
      environmentLauncher.path,
      "-u",
      "OP_SERVICE_ACCOUNT_TOKEN",
      "-u",
      "OP_CONNECT_HOST",
      "-u",
      "OP_CONNECT_TOKEN",
      "-u",
      "OP_ACCOUNT",
      node.path,
      SCRIPT_PATH,
      "credential",
      "--scope",
      scope,
      "--broker-active",
      "--json",
    ],
    brokerEnvFile,
  };
}

async function brokerCredential(manifest, scope) {
  const plan = await credentialBrokerPlan(manifest, scope);
  const path = resolve(REPOSITORY_ROOT, plan.brokerEnvFile);
  invariant(
    await secureBrokerFile(
      path,
      expectedBrokerVariable(scope),
      expectedBrokerReference(manifest, scope)
    ),
    `missing broker reference file: ${plan.brokerEnvFile}`
  );
  const output = await run(plan.executable, plan.args, {
    env: {
      ...brokerEnvironment(),
      [BROKER_ENV_MARKER]: scope,
    },
    timeoutMs: BROKER_TIMEOUT_MS,
  });
  return JSON.parse(output);
}

function isolatedCredentialEnvironment(scope) {
  if (EXPECTED_HF_SCOPES.has(scope)) {
    const presence = credentialPresence(process.env, ["HF_TOKEN"]);
    if (!presence.configured) return null;
    return minimalEnvironment({
      [BROKER_ENV_MARKER]: scope,
      HF_TOKEN: process.env.HF_TOKEN,
    });
  }
  const presence = credentialPresence(process.env, ["RUNPOD_API_KEY"]);
  if (!presence.configured) return null;
  return minimalEnvironment({
    [BROKER_ENV_MARKER]: scope,
    RUNPOD_API_KEY: process.env.RUNPOD_API_KEY,
  });
}

async function verifyInjectedCredential(scope) {
  const environment = isolatedCredentialEnvironment(scope);
  if (!environment) return null;
  const node = await resolveTrustedExecutable("node");
  const output = await run(
    node.path,
    [SCRIPT_PATH, "credential", "--scope", scope, "--broker-active", "--json"],
    {
      env: environment,
      timeoutMs: BROKER_TIMEOUT_MS,
    }
  );
  return JSON.parse(output);
}

async function verifyCredential(manifest, scope) {
  invariant(CREDENTIAL_SCOPES.has(scope), `unknown credential scope: ${scope}`);
  if (process.env[BROKER_ENV_MARKER] !== scope) {
    const injected = await verifyInjectedCredential(scope);
    if (injected) return injected;
    return brokerCredential(manifest, scope);
  }
  clearBrokerCredentials();
  if (EXPECTED_HF_SCOPES.has(scope)) {
    return verifyHuggingFaceCredential(manifest, scope);
  }
  return verifyRunPodCredential(manifest);
}

function compactAccessCache(cache, brokerFiles, credentialEvidence) {
  const scopes = Object.fromEntries(
    Object.entries(brokerFiles).map(([scope, state]) => [
      scope,
      {
        configured: state.configured,
        securePermissions: state.securePermissions,
        verified: credentialEvidence[scope]?.status ?? "NOT_VERIFIED",
      },
    ])
  );
  if (!cache) {
    return {
      status: "NOT_CHECKED",
      providers: {
        onePassword: "NOT_CHECKED",
        aws: "NOT_CHECKED",
        platformCredentials: "PINNED",
      },
      scopes,
    };
  }
  return {
    status: cache.cache?.stale ? "STALE" : "CACHED",
    generatedAt: cache.generatedAt,
    expiresAt: cache.expiresAt,
    cache: cache.cache,
    providers: {
      controlPlane: cache.providers?.controlPlane?.status ?? "NOT_CHECKED",
      onePassword: cache.providers?.onePassword?.status ?? "NOT_CHECKED",
      aws: cache.providers?.aws
        ? {
            status: cache.providers.aws.status,
            profile: cache.providers.aws.profile,
            region: cache.providers.aws.region,
          }
        : "NOT_CHECKED",
      platformCredentials:
        cache.providers?.platformCredentials?.status ?? "PINNED",
    },
    scopes,
  };
}

async function buildContext(manifest, manifestSha256, refresh) {
  const controlPlane = await runControlPlane(
    "context",
    refresh ? ["--refresh"] : []
  );
  const [cache, brokerFiles, credentialEvidence] = await Promise.all([
    readAccessCache(manifestSha256, true),
    allBrokerStates(manifest),
    readCredentialEvidence(manifest),
  ]);
  return {
    schemaVersion: 1,
    kind: "dime-agent-context",
    generatedAt: new Date().toISOString(),
    controlPlane,
    access: {
      manifestSha256,
      identity: compactAccessCache(cache, brokerFiles, credentialEvidence),
    },
    safety: {
      automaticContextReadOnly: true,
      credentialValuesPresent: false,
      productionLoginAuthorizedByContext: false,
      remoteMutationsAuthorized: false,
      trainingAuthorized: false,
      providerActivationAuthorized: false,
    },
  };
}

function parseArguments(argv) {
  const values = argv.filter(value => value !== "--");
  const command =
    values[0] && !values[0].startsWith("-") ? values.shift() : "context";
  let scope = null;
  let refresh = false;
  let json = false;
  let brokerActive = false;
  let help = false;
  while (values.length > 0) {
    const value = values.shift();
    if (value === "--scope") {
      scope = values.shift() ?? null;
    } else if (value === "--refresh") {
      refresh = true;
    } else if (value === "--json") {
      json = true;
    } else if (value === "--broker-active") {
      brokerActive = true;
    } else if (value === "-h" || value === "--help") {
      help = true;
    } else {
      throw new Error(`unknown option: ${value}`);
    }
  }
  return { command, scope, refresh, json, brokerActive, help };
}

function help() {
  return `Dime shared agent access v1

Usage:
  node scripts/dime-agent-access.mjs context [--refresh]
  node scripts/dime-agent-access.mjs doctor [--json]
  node scripts/dime-agent-access.mjs credential --scope <reviewed-scope> [--json]
  node scripts/dime-agent-access.mjs invalidate-cache

Credential scopes:
  hf-training | hf-serving | hf-release-publisher |
  hf-locked-evaluator | hf-locked-publisher | runpod

The context and doctor paths are read-only. Credential checks prove identity
only; they do not authorize provider execution, publication, training, or any
remote mutation.`;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${help()}\n`);
    return;
  }
  const { manifest, manifestSha256 } = await loadAccessManifest();

  if (args.command === "context") {
    const result = await buildContext(manifest, manifestSha256, args.refresh);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.controlPlane?.cache?.stale) process.exitCode = 2;
    return;
  }
  if (args.command === "doctor") {
    invariant(!args.scope, "--scope is not valid for doctor");
    const result = await runDoctor(manifest, manifestSha256);
    process.stdout.write(
      args.json
        ? `${JSON.stringify(result, null, 2)}\n`
        : `Dime agent access: ${result.overall}\nGitHub/Railway: ${result.controlPlane.connection}\n1Password: ${result.onePassword.status}\nAWS: ${result.aws.status}\nRemote mutations: NOT AUTHORIZED\n`
    );
    if (result.overall !== "PASS") process.exitCode = 2;
    return;
  }
  if (args.command === "credential") {
    invariant(args.scope, "credential requires --scope");
    if (args.brokerActive) {
      invariant(
        process.env[BROKER_ENV_MARKER] === args.scope,
        "broker scope marker mismatch"
      );
    }
    const result = await verifyCredential(manifest, args.scope);
    process.stdout.write(
      args.json
        ? `${JSON.stringify(result, null, 2)}\n`
        : `${args.scope}: ${result.status} (${result.authorization})\n`
    );
    return;
  }
  if (args.command === "invalidate-cache") {
    for (const path of [
      ACCESS_CACHE_PATH,
      ...[...CREDENTIAL_SCOPES].map(scope =>
        resolve(CREDENTIAL_CACHE_ROOT, `${scope}.json`)
      ),
    ]) {
      try {
        await unlink(path);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
    process.stdout.write(
      "Local Dime agent-access identity cache invalidated.\n"
    );
    return;
  }
  throw new Error(`unknown command: ${args.command}`);
}

if (
  process.env.DIME_BUNDLED_PRODUCTION_AUTH !== "1" &&
  process.argv[1] &&
  resolve(process.argv[1]) === SCRIPT_PATH
) {
  main().catch(error => {
    process.stderr.write(
      `Dime agent access failed: ${redactAgentError(error?.message)}\n`
    );
    process.exitCode = 1;
  });
}
