#!/usr/bin/env node

/**
 * Dime GitHub/Railway connection capsule.
 *
 * This command intentionally exposes read-only inspection only. It uses
 * explicit, checksum-pinned targets and execFile (never a shell) so a local
 * Railway link, current directory, or user-provided string cannot redirect an
 * operation to another project or environment.
 */

import { createHash } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  SECURE_RAILWAY_EXECUTABLE,
  verifySecureRailwayBroker,
} from "./dime-railway-secure.mjs";

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = fileURLToPath(import.meta.url);
export const REPOSITORY_ROOT = resolve(dirname(SCRIPT_PATH), "..");
export const MANIFEST_PATH = resolve(
  REPOSITORY_ROOT,
  "config/dime-control-plane-targets.v1.json"
);
export const CACHE_PATH = resolve(
  REPOSITORY_ROOT,
  ".cache/dime-control-plane/status-v1.json"
);
const LOCK_PATH = `${CACHE_PATH}.lock`;
const COMMAND_TIMEOUT_MS = 20_000;
const HEALTH_TIMEOUT_MS = 12_000;
const MAX_COMMAND_BUFFER = 12 * 1024 * 1024;
const MAX_HEALTH_BODY_BYTES = 64 * 1024;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const ALLOWED_OPERATIONS = new Set([
  "identity",
  "topology",
  "deployment-list",
  "public-health",
]);

function invariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function scalar(value) {
  return ["string", "number", "boolean"].includes(typeof value) ? value : null;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sleep(milliseconds) {
  return new Promise(resolvePromise =>
    setTimeout(resolvePromise, milliseconds)
  );
}

export function normalizeOrigin(value) {
  return String(value ?? "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\.git$/, "")
    .toLowerCase();
}

export function redact(value) {
  return String(value ?? "")
    .replace(
      /\b(?:gh[opusr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,})\b/g,
      "<redacted-github-token>"
    )
    .replace(
      /\b(?:railway_[A-Za-z0-9_-]{12,}|rw_[A-Za-z0-9_-]{12,})\b/gi,
      "<redacted-railway-token>"
    )
    .replace(/([?&](?:token|key|secret|password)=)[^&\s]+/gi, "$1<redacted>")
    .replace(
      /\b((?:token|api[_-]?key|secret|password)\s*[:=]\s*)\S+/gi,
      "$1<redacted>"
    )
    .slice(0, 2_000);
}

function validateIdentity(value, label) {
  invariant(value && typeof value === "object", `${label} must be an object`);
  invariant(UUID_PATTERN.test(value.id), `${label}.id must be a UUID`);
  invariant(
    typeof value.name === "string" && value.name.length > 0,
    `${label}.name is required`
  );
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

export function validateManifest(manifest) {
  requireExactKeys(
    manifest,
    [
      "$schema",
      "schemaVersion",
      "kind",
      "cache",
      "github",
      "railway",
      "safety",
    ],
    "manifest"
  );
  invariant(manifest?.schemaVersion === 1, "manifest schemaVersion must be 1");
  invariant(
    manifest?.kind === "dime-control-plane-targets",
    "manifest kind is invalid"
  );
  requireExactKeys(
    manifest.cache,
    ["ttlSeconds", "lockMaxAgeSeconds", "lockWaitSeconds"],
    "cache"
  );
  invariant(
    Number.isInteger(manifest?.cache?.ttlSeconds) &&
      manifest.cache.ttlSeconds >= 30 &&
      manifest.cache.ttlSeconds <= 3_600,
    "cache.ttlSeconds must be between 30 and 3600"
  );
  invariant(
    Number.isInteger(manifest?.cache?.lockMaxAgeSeconds) &&
      manifest.cache.lockMaxAgeSeconds >= 10 &&
      manifest.cache.lockMaxAgeSeconds <= 300,
    "cache.lockMaxAgeSeconds must be between 10 and 300"
  );
  invariant(
    Number.isInteger(manifest?.cache?.lockWaitSeconds) &&
      manifest.cache.lockWaitSeconds >= 1 &&
      manifest.cache.lockWaitSeconds <= 30,
    "cache.lockWaitSeconds must be between 1 and 30"
  );

  invariant(
    manifest?.github?.host === "github.com",
    "only github.com is permitted"
  );
  requireExactKeys(
    manifest.github,
    ["host", "repository", "defaultBranch", "originUrl"],
    "github"
  );
  invariant(
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(
      manifest?.github?.repository ?? ""
    ),
    "github.repository must be owner/repository"
  );
  invariant(
    manifest?.github?.defaultBranch === "main",
    "github.defaultBranch must be main"
  );
  invariant(
    normalizeOrigin(manifest?.github?.originUrl) ===
      `https://github.com/${manifest.github.repository}`.toLowerCase(),
    "github.originUrl does not match github.repository"
  );

  validateIdentity(manifest?.railway?.workspace, "railway.workspace");
  validateIdentity(manifest?.railway?.project, "railway.project");
  validateIdentity(manifest?.railway?.environment, "railway.environment");
  requireExactKeys(
    manifest.railway,
    ["workspace", "project", "environment", "services"],
    "railway"
  );
  for (const key of ["workspace", "project", "environment"]) {
    requireExactKeys(manifest.railway[key], ["id", "name"], `railway.${key}`);
  }

  const services = manifest?.railway?.services;
  invariant(services && typeof services === "object", "services are required");
  const serviceKeys = ["application", "backend", "database"];
  requireExactKeys(services, serviceKeys, "railway.services");
  const serviceIds = [];
  for (const key of serviceKeys) {
    validateIdentity(services[key], `railway.services.${key}`);
    serviceIds.push(services[key].id);
  }
  invariant(
    new Set(serviceIds).size === serviceIds.length,
    "Railway service IDs must be unique"
  );
  for (const key of ["application", "backend"]) {
    requireExactKeys(
      services[key],
      ["id", "name", "expectedRepository", "healthUrl"],
      `railway.services.${key}`
    );
    invariant(
      services[key].expectedRepository === manifest.github.repository,
      `${key}.expectedRepository must match github.repository`
    );
    const healthUrl = new URL(services[key].healthUrl);
    invariant(
      healthUrl.protocol === "https:",
      `${key}.healthUrl must use HTTPS`
    );
    invariant(
      healthUrl.username === "" && healthUrl.password === "",
      `${key}.healthUrl must not contain credentials`
    );
  }
  requireExactKeys(
    services.database,
    ["id", "name", "expectedImagePrefix"],
    "railway.services.database"
  );
  invariant(
    services.database.expectedImagePrefix === "mysql:",
    "database.expectedImagePrefix must be mysql:"
  );

  invariant(
    manifest?.safety?.mode === "read-only",
    "safety.mode must be read-only"
  );
  requireExactKeys(
    manifest.safety,
    [
      "mode",
      "remoteMutationsAuthorized",
      "mutationCommandsExposed",
      "authorizedOperations",
    ],
    "safety"
  );
  invariant(
    manifest?.safety?.remoteMutationsAuthorized === false,
    "remote mutations must remain unauthorized"
  );
  invariant(
    manifest?.safety?.mutationCommandsExposed === false,
    "mutation commands must not be exposed"
  );
  invariant(
    Array.isArray(manifest?.safety?.authorizedOperations) &&
      manifest.safety.authorizedOperations.length > 0 &&
      manifest.safety.authorizedOperations.every(operation =>
        ALLOWED_OPERATIONS.has(operation)
      ),
    "manifest contains an unauthorized operation"
  );
  invariant(
    new Set(manifest.safety.authorizedOperations).size ===
      ALLOWED_OPERATIONS.size &&
      [...ALLOWED_OPERATIONS].every(operation =>
        manifest.safety.authorizedOperations.includes(operation)
      ),
    "manifest must contain the exact read-only operation set"
  );

  return manifest;
}

export async function loadManifest(path = MANIFEST_PATH) {
  const bytes = await readFile(path);
  const manifest = validateManifest(JSON.parse(bytes.toString("utf8")));
  return {
    manifest,
    manifestSha256: sha256(bytes),
  };
}

async function run(executable, args, options = {}) {
  const inheritedNames = [
    "HOME",
    "PATH",
    "TMPDIR",
    "USER",
    "LOGNAME",
    "SHELL",
    "LANG",
    "LC_ALL",
    "XDG_CONFIG_HOME",
    "XDG_CACHE_HOME",
    "SSH_AUTH_SOCK",
  ];
  if (executable === "gh") {
    inheritedNames.push("GH_TOKEN", "GITHUB_TOKEN", "GH_CONFIG_DIR");
  }
  const isolatedEnvironment = Object.fromEntries(
    inheritedNames
      .filter(name => process.env[name] !== undefined)
      .map(name => [name, process.env[name]])
  );
  try {
    const resolvedExecutable =
      executable === "dime-railway-keychain"
        ? SECURE_RAILWAY_EXECUTABLE
        : executable;
    if (executable === "dime-railway-keychain") {
      await verifySecureRailwayBroker();
    }
    const result = await execFileAsync(resolvedExecutable, args, {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
      timeout: options.timeoutMs ?? COMMAND_TIMEOUT_MS,
      maxBuffer: MAX_COMMAND_BUFFER,
      windowsHide: true,
      env: {
        ...isolatedEnvironment,
        NO_COLOR: "1",
        GH_PAGER: "cat",
        PAGER: "cat",
      },
    });
    return String(result.stdout ?? "").trim();
  } catch (error) {
    const stderr = redact(error?.stderr || error?.stdout || error?.message);
    throw new Error(
      `${executable} ${args.slice(0, 3).join(" ")} failed: ${stderr}`
    );
  }
}

async function runJson(executable, args) {
  const output = await run(executable, args);
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(
      `${executable} returned invalid JSON: ${redact(output.slice(0, 300))}`
    );
  }
}

export function buildReadOnlyCommandPlan(manifest, branch) {
  const repository = manifest.github.repository;
  const project = manifest.railway.project.id;
  const environment = manifest.railway.environment.id;
  const commands = {
    githubViewer: ["gh", ["api", "user", "--jq", ".login"]],
    githubRepository: [
      "gh",
      [
        "repo",
        "view",
        repository,
        "--json",
        "nameWithOwner,defaultBranchRef,url,viewerPermission,isPrivate",
      ],
    ],
    githubMainRef: [
      "gh",
      [
        "api",
        `repos/${repository}/git/ref/heads/${manifest.github.defaultBranch}`,
      ],
    ],
    railwayTopology: [
      "dime-railway-keychain",
      ["status", "--project", project, "--environment", environment, "--json"],
    ],
  };
  if (branch && branch !== manifest.github.defaultBranch && branch !== "HEAD") {
    commands.githubPullRequest = [
      "gh",
      [
        "pr",
        "list",
        "--repo",
        repository,
        "--head",
        branch,
        "--state",
        "all",
        "--limit",
        "1",
        "--json",
        [
          "number",
          "state",
          "isDraft",
          "headRefName",
          "headRefOid",
          "baseRefName",
          "baseRefOid",
          "mergeable",
          "reviewDecision",
          "statusCheckRollup",
          "url",
        ].join(","),
      ],
    ];
  }
  commands.railwayDeployments = Object.fromEntries(
    Object.entries(manifest.railway.services).map(([key, service]) => [
      key,
      [
        "dime-railway-keychain",
        [
          "deployment",
          "list",
          "--project",
          project,
          "--environment",
          environment,
          "--service",
          service.id,
          "--limit",
          "1",
          "--json",
        ],
      ],
    ])
  );
  return commands;
}

async function getLocalRepository(manifest) {
  const [topLevel, origin, branch, head, dirty] = await Promise.all([
    run("git", ["rev-parse", "--show-toplevel"]),
    run("git", ["remote", "get-url", "origin"]),
    run("git", ["branch", "--show-current"]),
    run("git", ["rev-parse", "HEAD"]),
    run("git", ["status", "--porcelain=v1", "--untracked-files=normal"]),
  ]);
  invariant(
    resolve(topLevel) === REPOSITORY_ROOT,
    `command must run from the repository at ${REPOSITORY_ROOT}`
  );
  invariant(
    normalizeOrigin(origin) === normalizeOrigin(manifest.github.originUrl),
    `origin mismatch: expected ${manifest.github.originUrl}`
  );
  invariant(SHA_PATTERN.test(head), "local HEAD is not a 40-character SHA");
  return {
    root: REPOSITORY_ROOT,
    origin: manifest.github.originUrl,
    branch: branch || "HEAD",
    head,
    dirty: dirty.length > 0,
    changedPathCount: dirty ? dirty.split("\n").filter(Boolean).length : 0,
    workingTreeSha256: sha256(dirty),
  };
}

export function summarizeChecks(checks = []) {
  const summary = {
    total: 0,
    pass: 0,
    fail: 0,
    pending: 0,
    skipped: 0,
    other: 0,
  };
  for (const check of checks ?? []) {
    summary.total += 1;
    const conclusion = String(check?.conclusion ?? "").toUpperCase();
    const state = String(check?.state ?? "").toUpperCase();
    const status = String(check?.status ?? "").toUpperCase();
    const value = conclusion || state;
    if (
      [
        "FAILURE",
        "ERROR",
        "CANCELLED",
        "TIMED_OUT",
        "ACTION_REQUIRED",
      ].includes(value)
    ) {
      summary.fail += 1;
    } else if (["SKIPPED", "NEUTRAL"].includes(value)) {
      summary.skipped += 1;
    } else if (
      ["PENDING", "EXPECTED", "QUEUED", "IN_PROGRESS", "WAITING"].includes(
        value || status
      ) ||
      (status && status !== "COMPLETED")
    ) {
      summary.pending += 1;
    } else if (value === "SUCCESS") {
      summary.pass += 1;
    } else {
      summary.other += 1;
    }
  }
  return summary;
}

function normalizePullRequest(items) {
  const item = Array.isArray(items) ? items[0] : null;
  if (!item) return null;
  return {
    number: item.number,
    state: item.state,
    draft: item.isDraft,
    headBranch: item.headRefName,
    headSha: item.headRefOid,
    baseBranch: item.baseRefName,
    baseSha: item.baseRefOid,
    mergeable: item.mergeable,
    reviewDecision: item.reviewDecision || null,
    checks: summarizeChecks(item.statusCheckRollup),
    url: item.url,
  };
}

async function inspectGithub(manifest, local, plan) {
  const prPromise = plan.githubPullRequest
    ? runJson(...plan.githubPullRequest)
    : Promise.resolve([]);
  const [viewer, repository, defaultRef, pullRequests] = await Promise.all([
    run(...plan.githubViewer),
    runJson(...plan.githubRepository),
    runJson(...plan.githubMainRef),
    prPromise,
  ]);

  invariant(viewer.length > 0, "GitHub viewer identity is empty");
  invariant(
    repository.nameWithOwner === manifest.github.repository,
    "GitHub repository identity mismatch"
  );
  invariant(
    repository.defaultBranchRef?.name === manifest.github.defaultBranch,
    "GitHub default branch mismatch"
  );
  invariant(repository.isPrivate === false, "GitHub visibility changed");
  const defaultBranchSha = defaultRef?.object?.sha;
  invariant(
    SHA_PATTERN.test(defaultBranchSha ?? ""),
    "GitHub default branch SHA is invalid"
  );
  const pullRequest = normalizePullRequest(pullRequests);
  if (pullRequest) {
    invariant(
      pullRequest.headBranch === local.branch,
      "GitHub pull request branch mismatch"
    );
  }
  return {
    viewer,
    repository: repository.nameWithOwner,
    url: repository.url,
    permission: repository.viewerPermission,
    defaultBranch: manifest.github.defaultBranch,
    defaultBranchSha,
    pullRequest,
  };
}

function environmentNode(topology, environmentId) {
  return topology?.environments?.edges
    ?.map(edge => edge?.node)
    .find(node => node?.id === environmentId);
}

export function validateRailwayTopology(manifest, topology) {
  invariant(
    topology?.id === manifest.railway.project.id,
    "Railway project ID mismatch"
  );
  invariant(
    topology?.name === manifest.railway.project.name,
    "Railway project name mismatch"
  );
  invariant(
    topology?.workspaceId === manifest.railway.workspace.id,
    "Railway project workspace mismatch"
  );
  invariant(
    topology?.workspace?.name === manifest.railway.workspace.name,
    "Railway workspace name mismatch"
  );
  const environment = environmentNode(
    topology,
    manifest.railway.environment.id
  );
  invariant(environment, "pinned Railway environment is missing");
  invariant(
    environment.name === manifest.railway.environment.name,
    "Railway environment name mismatch"
  );
  invariant(
    environment.canAccess === true,
    "Railway environment is inaccessible"
  );

  const actualServices = new Map(
    (environment?.serviceInstances?.edges ?? []).map(edge => [
      edge?.node?.serviceId,
      edge?.node,
    ])
  );
  const normalized = {};
  for (const [key, expected] of Object.entries(manifest.railway.services)) {
    const actual = actualServices.get(expected.id);
    invariant(actual, `Railway ${key} service is missing`);
    invariant(
      actual.serviceName === expected.name,
      `Railway ${key} service name mismatch`
    );
    if (expected.expectedRepository) {
      invariant(
        actual.source?.repo === expected.expectedRepository,
        `Railway ${key} source repository mismatch`
      );
    }
    if (expected.expectedImagePrefix) {
      invariant(
        String(actual.source?.image ?? "").startsWith(
          expected.expectedImagePrefix
        ),
        `Railway ${key} source image mismatch`
      );
    }
    normalized[key] = {
      id: expected.id,
      name: expected.name,
      sourceRepository: actual.source?.repo ?? null,
      sourceImage: actual.source?.image ?? null,
    };
  }
  return normalized;
}

function normalizeDeployment(items, key) {
  const item = Array.isArray(items) ? items[0] : null;
  invariant(item, `Railway ${key} has no deployment`);
  const commitHash = item.meta?.commitHash ?? null;
  if (commitHash !== null) {
    invariant(
      SHA_PATTERN.test(commitHash),
      `Railway ${key} deployment commit is invalid`
    );
  }
  return {
    id: item.id,
    status: item.status,
    createdAt: item.createdAt,
    branch: item.meta?.branch ?? null,
    commitHash,
    repository: item.meta?.repo ?? null,
    image: item.meta?.image ?? null,
    imageDigest: item.meta?.imageDigest ?? null,
  };
}

async function inspectRailway(manifest, plan) {
  const deploymentEntries = Object.entries(plan.railwayDeployments);
  const [topology, deploymentResults] = await Promise.all([
    runJson(...plan.railwayTopology),
    Promise.all(
      deploymentEntries.map(async ([key, command]) => [
        key,
        await runJson(...command),
      ])
    ),
  ]);
  const services = validateRailwayTopology(manifest, topology);
  const deployments = Object.fromEntries(
    deploymentResults.map(([key, items]) => [
      key,
      normalizeDeployment(items, key),
    ])
  );
  return {
    viewer: {
      name: "keychain-broker",
      workspaceAccess: true,
      credentialPrinted: false,
    },
    workspace: manifest.railway.workspace,
    project: manifest.railway.project,
    environment: manifest.railway.environment,
    services,
    deployments,
  };
}

async function inspectHealth(serviceKey, url) {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "dime-control-plane-connection-v1",
      },
      redirect: "error",
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    const text = await response.text();
    invariant(
      Buffer.byteLength(text, "utf8") <= MAX_HEALTH_BODY_BYTES,
      `${serviceKey} health response exceeded ${MAX_HEALTH_BODY_BYTES} bytes`
    );
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    return {
      url,
      ok: response.ok,
      httpStatus: response.status,
      latencyMs: Date.now() - started,
      serviceStatus: scalar(body?.status ?? body?.health ?? body?.ok),
      bodySha256: sha256(text),
    };
  } catch (error) {
    return {
      url,
      ok: false,
      httpStatus: null,
      latencyMs: Date.now() - started,
      serviceStatus: null,
      bodySha256: null,
      error: redact(error?.message),
    };
  }
}

export function createSummary(local, github, railway, health) {
  const app = railway.deployments.application;
  const backend = railway.deployments.backend;
  const database = railway.deployments.database;
  const appOnMain = app.commitHash === github.defaultBranchSha;
  const backendOnMain = backend.commitHash === github.defaultBranchSha;
  const servicesAligned =
    app.commitHash !== null && app.commitHash === backend.commitHash;
  const deploymentSourcesPass = [app, backend].every(
    deployment =>
      deployment.branch === github.defaultBranch &&
      deployment.repository === github.repository
  );
  const healthPass = Object.values(health).every(result => result.ok);
  const deploySuccess = [app, backend, database].every(
    deployment => deployment.status === "SUCCESS"
  );
  const prHeadMatchesLocal =
    github.pullRequest === null ||
    github.pullRequest.headSha === local.head ||
    github.pullRequest.state === "MERGED";
  return {
    connection: "PASS",
    productionState:
      appOnMain &&
      backendOnMain &&
      servicesAligned &&
      deploymentSourcesPass &&
      healthPass &&
      deploySuccess
        ? "PASS"
        : "ATTENTION",
    deploymentParity: {
      applicationOnGithubMain: appOnMain,
      backendOnGithubMain: backendOnMain,
      applicationBackendAligned: servicesAligned,
    },
    healthPass,
    deploymentSuccess: deploySuccess,
    deploymentSourcesPass,
    pullRequestHeadMatchesLocal: prHeadMatchesLocal,
  };
}

async function createLiveSnapshot(
  manifest,
  manifestSha256,
  currentLocal = null
) {
  const generatedAtMs = Date.now();
  const local = currentLocal ?? (await getLocalRepository(manifest));
  const plan = buildReadOnlyCommandPlan(manifest, local.branch);
  const healthEntries = Object.entries(manifest.railway.services)
    .filter(([, service]) => service.healthUrl)
    .map(([key, service]) => [key, service.healthUrl]);
  const [github, railway, healthResults] = await Promise.all([
    inspectGithub(manifest, local, plan),
    inspectRailway(manifest, plan),
    Promise.all(
      healthEntries.map(async ([key, url]) => [
        key,
        await inspectHealth(key, url),
      ])
    ),
  ]);
  const health = Object.fromEntries(healthResults);
  const summary = createSummary(local, github, railway, health);
  return {
    schemaVersion: 1,
    kind: "dime-control-plane-status",
    manifestSha256,
    generatedAt: new Date(generatedAtMs).toISOString(),
    expiresAt: new Date(
      generatedAtMs + manifest.cache.ttlSeconds * 1_000
    ).toISOString(),
    cache: {
      hit: false,
      stale: false,
      ageSeconds: 0,
    },
    safety: {
      mode: manifest.safety.mode,
      remoteMutationsAuthorized: false,
      mutationCommandsExposed: false,
    },
    local,
    github,
    railway,
    health,
    summary,
  };
}

export function cacheState(
  snapshot,
  manifestSha256,
  nowMs = Date.now(),
  currentLocal = null
) {
  if (
    !snapshot ||
    snapshot.schemaVersion !== 1 ||
    snapshot.kind !== "dime-control-plane-status" ||
    snapshot.manifestSha256 !== manifestSha256
  ) {
    return { valid: false, fresh: false, ageSeconds: null };
  }
  if (
    currentLocal &&
    (snapshot.local?.branch !== currentLocal.branch ||
      snapshot.local?.head !== currentLocal.head ||
      snapshot.local?.workingTreeSha256 !== currentLocal.workingTreeSha256)
  ) {
    return { valid: false, fresh: false, ageSeconds: null };
  }
  const generatedAtMs = Date.parse(snapshot.generatedAt);
  const expiresAtMs = Date.parse(snapshot.expiresAt);
  if (!Number.isFinite(generatedAtMs) || !Number.isFinite(expiresAtMs)) {
    return { valid: false, fresh: false, ageSeconds: null };
  }
  return {
    valid: true,
    fresh: nowMs < expiresAtMs,
    ageSeconds: Math.max(0, Math.floor((nowMs - generatedAtMs) / 1_000)),
  };
}

async function readCached(manifestSha256, currentLocal, allowStale = false) {
  try {
    const snapshot = JSON.parse(await readFile(CACHE_PATH, "utf8"));
    const state = cacheState(
      snapshot,
      manifestSha256,
      Date.now(),
      currentLocal
    );
    if (!state.valid || (!state.fresh && !allowStale)) return null;
    return {
      ...snapshot,
      cache: {
        hit: true,
        stale: !state.fresh,
        ageSeconds: state.ageSeconds,
      },
    };
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function acquireLock(manifest) {
  await mkdir(dirname(CACHE_PATH), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + manifest.cache.lockWaitSeconds * 1_000;
  while (Date.now() < deadline) {
    try {
      const handle = await open(LOCK_PATH, "wx", 0o600);
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
        const lockStat = await stat(LOCK_PATH);
        if (
          Date.now() - lockStat.mtimeMs >
          manifest.cache.lockMaxAgeSeconds * 1_000
        ) {
          await unlink(LOCK_PATH);
          continue;
        }
      } catch (statError) {
        if (statError?.code !== "ENOENT") throw statError;
      }
      await sleep(100);
    }
  }
  throw new Error("timed out waiting for the local connection-cache lock");
}

async function releaseLock() {
  try {
    await unlink(LOCK_PATH);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function writeCached(snapshot) {
  await mkdir(dirname(CACHE_PATH), { recursive: true, mode: 0o700 });
  const temporary = `${CACHE_PATH}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, CACHE_PATH);
}

async function status({ refresh = false, allowStaleFallback = true } = {}) {
  const { manifest, manifestSha256 } = await loadManifest();
  let currentLocal = await getLocalRepository(manifest);
  if (!refresh) {
    const cached = await readCached(manifestSha256, currentLocal);
    if (cached) return cached;
  }

  await acquireLock(manifest);
  try {
    currentLocal = await getLocalRepository(manifest);
    if (!refresh) {
      const filledWhileWaiting = await readCached(manifestSha256, currentLocal);
      if (filledWhileWaiting) return filledWhileWaiting;
    }
    const snapshot = await createLiveSnapshot(
      manifest,
      manifestSha256,
      currentLocal
    );
    await writeCached(snapshot);
    return snapshot;
  } catch (error) {
    if (allowStaleFallback) {
      const stale = await readCached(manifestSha256, currentLocal, true);
      if (stale) {
        return {
          ...stale,
          cache: {
            ...stale.cache,
            stale: true,
            refreshError: redact(error?.message),
          },
          summary: {
            ...stale.summary,
            connection: "STALE",
          },
        };
      }
    }
    throw error;
  } finally {
    await releaseLock();
  }
}

async function toolVersions() {
  const [git, gh, railway, node] = await Promise.all([
    run("git", ["--version"]),
    run("gh", ["--version"]),
    run("dime-railway-keychain", ["--version"]),
    Promise.resolve(process.version),
  ]);
  return {
    git: git.split("\n")[0],
    gh: gh.split("\n")[0],
    railway: railway.split("\n")[0],
    node,
  };
}

function compactSha(value) {
  return value ? value.slice(0, 12) : "none";
}

function renderHuman(snapshot, doctor = false) {
  const lines = [
    `Dime control-plane connection: ${snapshot.summary.connection}`,
    `Production state: ${snapshot.summary.productionState}`,
    `Cache: ${snapshot.cache.hit ? "HIT" : "REFRESH"}${
      snapshot.cache.stale ? " (STALE)" : ""
    } · age ${snapshot.cache.ageSeconds}s · expires ${snapshot.expiresAt}`,
    `Safety: ${snapshot.safety.mode} · remote mutations NOT AUTHORIZED`,
    `GitHub: ${snapshot.github.repository} · main ${compactSha(
      snapshot.github.defaultBranchSha
    )} · viewer ${snapshot.github.viewer}`,
    `Local: ${snapshot.local.branch} @ ${compactSha(snapshot.local.head)} · ${
      snapshot.local.dirty
        ? `${snapshot.local.changedPathCount} changed path(s)`
        : "clean"
    }`,
  ];
  if (snapshot.github.pullRequest) {
    const pr = snapshot.github.pullRequest;
    lines.push(
      `PR #${pr.number}: ${pr.state}${pr.draft ? " DRAFT" : ""} · checks ${
        pr.checks.pass
      } pass/${pr.checks.fail} fail/${pr.checks.pending} pending · ${pr.url}`
    );
  }
  for (const key of ["application", "backend", "database"]) {
    const deployment = snapshot.railway.deployments[key];
    lines.push(
      `Railway ${key}: ${snapshot.railway.services[key].name} · ${
        deployment.status
      } · ${compactSha(deployment.commitHash)} · ${deployment.id}`
    );
  }
  for (const [key, result] of Object.entries(snapshot.health)) {
    lines.push(
      `Health ${key}: ${result.ok ? "PASS" : "FAIL"} · HTTP ${
        result.httpStatus ?? "none"
      } · ${result.latencyMs}ms`
    );
  }
  if (snapshot.cache.refreshError) {
    lines.push(`Refresh error: ${snapshot.cache.refreshError}`);
  }
  if (doctor && snapshot.clients) {
    lines.push(
      `Clients: ${snapshot.clients.git} · ${snapshot.clients.gh} · ${snapshot.clients.railway} · Node ${snapshot.clients.node}`
    );
  }
  return lines.join("\n");
}

export function compactContext(snapshot) {
  return {
    schemaVersion: 1,
    kind: "dime-control-plane-context",
    generatedAt: snapshot.generatedAt,
    expiresAt: snapshot.expiresAt,
    cache: snapshot.cache,
    safety: snapshot.safety,
    local: {
      branch: snapshot.local.branch,
      head: snapshot.local.head,
      dirty: snapshot.local.dirty,
      changedPathCount: snapshot.local.changedPathCount,
    },
    github: {
      repository: snapshot.github.repository,
      defaultBranch: snapshot.github.defaultBranch,
      defaultBranchSha: snapshot.github.defaultBranchSha,
      pullRequest: snapshot.github.pullRequest,
    },
    railway: {
      project: snapshot.railway.project,
      environment: snapshot.railway.environment,
      deployments: Object.fromEntries(
        Object.entries(snapshot.railway.deployments).map(
          ([key, deployment]) => [
            key,
            {
              serviceId: snapshot.railway.services[key].id,
              deploymentId: deployment.id,
              status: deployment.status,
              commitHash: deployment.commitHash,
            },
          ]
        )
      ),
    },
    health: Object.fromEntries(
      Object.entries(snapshot.health).map(([key, result]) => [
        key,
        {
          ok: result.ok,
          httpStatus: result.httpStatus,
          latencyMs: result.latencyMs,
        },
      ])
    ),
    summary: snapshot.summary,
  };
}

function parseArguments(argv) {
  const values = argv.filter(value => value !== "--");
  const command = values[0]?.startsWith("-") ? "status" : values[0] || "status";
  const flags = new Set(
    values
      .slice(command === values[0] ? 1 : 0)
      .filter(value => value.startsWith("-"))
  );
  const allowed = new Set(["--json", "--refresh", "-h", "--help"]);
  for (const flag of flags) {
    invariant(allowed.has(flag), `unknown option: ${flag}`);
  }
  return {
    command,
    json: flags.has("--json"),
    refresh: flags.has("--refresh"),
    help: flags.has("-h") || flags.has("--help"),
  };
}

function help() {
  return `Dime control-plane connection v1

Usage:
  node scripts/dime-control-plane.mjs status [--refresh] [--json]
  node scripts/dime-control-plane.mjs context [--refresh]
  node scripts/dime-control-plane.mjs doctor [--json]
  node scripts/dime-control-plane.mjs targets [--json]
  node scripts/dime-control-plane.mjs invalidate-cache

Commands:
  status            Return a fresh-or-cached compact GitHub/Railway snapshot.
  context           Return the token-lean machine context as one JSON line.
  doctor            Force a live identity, topology, deployment, and health check.
  targets           Validate and print the non-secret pinned target manifest.
  invalidate-cache  Delete only the local ignored status cache.

Safety:
  No deploy, redeploy, restart, variable, database, source-link, or other
  remote mutation command is implemented by this tool.`;
}

async function main() {
  const arguments_ = parseArguments(process.argv.slice(2));
  if (arguments_.help) {
    process.stdout.write(`${help()}\n`);
    return;
  }

  if (arguments_.command === "status") {
    const snapshot = await status({ refresh: arguments_.refresh });
    process.stdout.write(
      arguments_.json
        ? `${JSON.stringify(snapshot, null, 2)}\n`
        : `${renderHuman(snapshot)}\n`
    );
    if (snapshot.cache.stale) process.exitCode = 2;
    return;
  }

  if (arguments_.command === "context") {
    const snapshot = await status({ refresh: arguments_.refresh });
    process.stdout.write(`${JSON.stringify(compactContext(snapshot))}\n`);
    if (snapshot.cache.stale) process.exitCode = 2;
    return;
  }

  if (arguments_.command === "doctor") {
    const snapshot = await status({
      refresh: true,
      allowStaleFallback: false,
    });
    snapshot.clients = await toolVersions();
    process.stdout.write(
      arguments_.json
        ? `${JSON.stringify(snapshot, null, 2)}\n`
        : `${renderHuman(snapshot, true)}\n`
    );
    return;
  }

  if (arguments_.command === "targets") {
    const { manifest, manifestSha256 } = await loadManifest();
    const result = { manifestSha256, manifest };
    process.stdout.write(
      arguments_.json
        ? `${JSON.stringify(result, null, 2)}\n`
        : `Dime control-plane targets: PASS\nManifest SHA-256: ${manifestSha256}\nSafety: read-only; remote mutations NOT AUTHORIZED\n`
    );
    return;
  }

  if (arguments_.command === "invalidate-cache") {
    try {
      await unlink(CACHE_PATH);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    process.stdout.write("Local Dime control-plane cache invalidated.\n");
    return;
  }

  throw new Error(`unknown command: ${arguments_.command}`);
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  main().catch(error => {
    process.stderr.write(
      `Dime control-plane connection failed: ${redact(error?.message)}\n`
    );
    process.exitCode = 1;
  });
}
