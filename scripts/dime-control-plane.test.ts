import assert from "node:assert/strict";
import { test } from "vitest";

import {
  buildReadOnlyCommandPlan,
  cacheState,
  compactContext,
  createSummary,
  loadManifest,
  normalizeOrigin,
  redact,
  summarizeChecks,
  validateManifest,
  validateRailwayTopology,
} from "./dime-control-plane.mjs";

async function manifestFixture() {
  return structuredClone((await loadManifest()).manifest);
}

function topologyFixture(manifest) {
  const services = manifest.railway.services;
  return {
    id: manifest.railway.project.id,
    name: manifest.railway.project.name,
    workspaceId: manifest.railway.workspace.id,
    workspace: {
      name: manifest.railway.workspace.name,
    },
    environments: {
      edges: [
        {
          node: {
            id: manifest.railway.environment.id,
            name: manifest.railway.environment.name,
            canAccess: true,
            serviceInstances: {
              edges: [
                {
                  node: {
                    serviceId: services.application.id,
                    serviceName: services.application.name,
                    source: {
                      repo: services.application.expectedRepository,
                      image: null,
                    },
                  },
                },
                {
                  node: {
                    serviceId: services.backend.id,
                    serviceName: services.backend.name,
                    source: {
                      repo: services.backend.expectedRepository,
                      image: null,
                    },
                  },
                },
                {
                  node: {
                    serviceId: services.database.id,
                    serviceName: services.database.name,
                    source: {
                      repo: null,
                      image: "mysql:9.4",
                    },
                  },
                },
              ],
            },
          },
        },
      ],
    },
  };
}

test("the committed target manifest validates and is read-only", async () => {
  const manifest = await manifestFixture();
  assert.equal(validateManifest(manifest), manifest);
  assert.equal(manifest.safety.mode, "read-only");
  assert.equal(manifest.safety.remoteMutationsAuthorized, false);
  assert.equal(manifest.safety.mutationCommandsExposed, false);
});

test("manifest validation rejects remote mutation authority", async () => {
  const manifest = await manifestFixture();
  manifest.safety.remoteMutationsAuthorized = true;
  assert.throws(
    () => validateManifest(manifest),
    /remote mutations must remain unauthorized/
  );
});

test("manifest validation rejects duplicate Railway service identity", async () => {
  const manifest = await manifestFixture();
  manifest.railway.services.backend.id =
    manifest.railway.services.application.id;
  assert.throws(
    () => validateManifest(manifest),
    /Railway service IDs must be unique/
  );
});

test("manifest validation rejects unreviewed extra keys", async () => {
  const manifest = await manifestFixture();
  manifest.railway.environment.alias = "prod";
  assert.throws(
    () => validateManifest(manifest),
    /railway\.environment keys must be exactly/
  );
});

test("origin normalization accepts the reviewed HTTPS .git spelling only by identity", () => {
  assert.equal(
    normalizeOrigin(
      "https://github.com/tailered-ai/dime-ai.git"
    ),
    "https://github.com/tailered-ai/dime-ai"
  );
  assert.notEqual(
    normalizeOrigin(
      "https://github.com/another-owner/dime-ai.git"
    ),
    "https://github.com/tailered-ai/dime-ai"
  );
});

test("the generated command plan contains only explicit read operations", async () => {
  const manifest = await manifestFixture();
  const plan = buildReadOnlyCommandPlan(
    manifest,
    "agent/dime-control-plane-connection-v1"
  );
  const flatCommands = [
    plan.githubViewer,
    plan.githubRepository,
    plan.githubMainRef,
    plan.githubPullRequest,
    plan.railwayTopology,
    ...Object.values(plan.railwayDeployments),
  ];

  for (const [executable, args] of flatCommands) {
    assert.ok(["git", "gh", "dime-railway-keychain"].includes(executable));
    if (executable === "dime-railway-keychain") {
      assert.ok(["status", "deployment"].includes(args[0]));
      if (args[0] === "deployment") assert.equal(args[1], "list");
      assert.equal(args.includes(manifest.railway.project.id), true);
      assert.equal(args.includes(manifest.railway.environment.id), true);
    }
    if (executable === "gh" && args[0] === "pr") {
      assert.equal(args[1], "list");
    }
    if (executable === "gh" && args[0] === "repo") {
      assert.equal(args[1], "view");
    }
  }
});

test("the control-plane runner does not pass unrelated provider credentials to children", async () => {
  const source = await import("node:fs/promises").then(module =>
    module.readFile(
      new URL("./dime-control-plane.mjs", import.meta.url),
      "utf8"
    )
  );
  assert.match(source, /resolveTrustedExecutable\(executable\)/);
  assert.match(source, /executable === "dime-railway-keychain"/);
  assert.equal(source.includes("...process.env"), false);
  for (const forbidden of [
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "HF_TOKEN",
    "RUNPOD_API_KEY",
    "AWS_SECRET_ACCESS_KEY",
    "DIME_PROD_OWNER_PASSWORD",
    "DIME_PROD_USER_PASSWORD",
  ]) {
    assert.equal(source.includes(`inheritedNames.push("${forbidden}"`), false);
  }
});

test("Railway topology validation requires the exact environment and sources", async () => {
  const manifest = await manifestFixture();
  const topology = topologyFixture(manifest);
  const services = validateRailwayTopology(manifest, topology);
  assert.equal(
    services.application.sourceRepository,
    manifest.github.repository
  );
  assert.equal(services.database.sourceImage, "mysql:9.4");

  topology.environments.edges[0].node.serviceInstances.edges[0].node.source.repo =
    "wrong-owner/wrong-repository";
  assert.throws(
    () => validateRailwayTopology(manifest, topology),
    /source repository mismatch/
  );
});

test("cache freshness is bound to the exact manifest checksum", () => {
  const now = Date.parse("2026-07-30T12:00:00.000Z");
  const snapshot = {
    schemaVersion: 1,
    kind: "dime-control-plane-status",
    manifestSha256: "a".repeat(64),
    generatedAt: "2026-07-30T11:59:00.000Z",
    expiresAt: "2026-07-30T12:04:00.000Z",
  };
  assert.deepEqual(cacheState(snapshot, "a".repeat(64), now), {
    valid: true,
    fresh: true,
    ageSeconds: 60,
  });
  assert.equal(cacheState(snapshot, "b".repeat(64), now).valid, false);
  assert.equal(
    cacheState(snapshot, "a".repeat(64), now + 5 * 60_000).fresh,
    false
  );
  assert.equal(
    cacheState(snapshot, "a".repeat(64), now, {
      branch: "main",
      head: "c".repeat(40),
      workingTreeSha256: "d".repeat(64),
    }).valid,
    false
  );
});

test("check rollups remain compact and preserve failures", () => {
  assert.deepEqual(
    summarizeChecks([
      { conclusion: "SUCCESS", status: "COMPLETED" },
      { conclusion: "FAILURE", status: "COMPLETED" },
      { conclusion: null, status: "IN_PROGRESS" },
      { conclusion: "SKIPPED", status: "COMPLETED" },
    ]),
    {
      total: 4,
      pass: 1,
      fail: 1,
      pending: 1,
      skipped: 1,
      other: 0,
    }
  );
});

test("production summary requires both services on the exact GitHub main SHA", () => {
  const sha = "a".repeat(40);
  const local = { head: sha };
  const github = {
    repository: "tailered-ai/dime-ai",
    defaultBranch: "main",
    defaultBranchSha: sha,
    pullRequest: null,
  };
  const railway = {
    deployments: {
      application: {
        commitHash: sha,
        status: "SUCCESS",
        branch: "main",
        repository: github.repository,
      },
      backend: {
        commitHash: sha,
        status: "SUCCESS",
        branch: "main",
        repository: github.repository,
      },
      database: { commitHash: null, status: "SUCCESS" },
    },
  };
  const health = {
    application: { ok: true },
    backend: { ok: true },
  };
  assert.equal(
    createSummary(local, github, railway, health).productionState,
    "PASS"
  );
  railway.deployments.backend.commitHash = "b".repeat(40);
  assert.equal(
    createSummary(local, github, railway, health).productionState,
    "ATTENTION"
  );
});

test("compact context omits verbose health bodies and image metadata", () => {
  const snapshot = {
    generatedAt: "2026-07-30T12:00:00.000Z",
    expiresAt: "2026-07-30T12:05:00.000Z",
    cache: { hit: true, stale: false, ageSeconds: 10 },
    safety: { mode: "read-only" },
    local: {
      branch: "main",
      head: "a".repeat(40),
      dirty: false,
      changedPathCount: 0,
    },
    github: {
      repository: "owner/repository",
      defaultBranch: "main",
      defaultBranchSha: "a".repeat(40),
      pullRequest: null,
    },
    railway: {
      project: { id: "project", name: "project" },
      environment: { id: "environment", name: "production" },
      services: {
        application: { id: "app" },
        backend: { id: "backend" },
        database: { id: "database" },
      },
      deployments: {
        application: {
          id: "app-deploy",
          status: "SUCCESS",
          commitHash: "a".repeat(40),
          imageDigest: "must-not-appear",
        },
        backend: {
          id: "backend-deploy",
          status: "SUCCESS",
          commitHash: "a".repeat(40),
        },
        database: {
          id: "database-deploy",
          status: "SUCCESS",
          commitHash: null,
        },
      },
    },
    health: {
      application: {
        ok: true,
        httpStatus: 200,
        latencyMs: 10,
        bodySha256: "must-not-appear",
      },
    },
    summary: { connection: "PASS" },
  };
  const context = compactContext(snapshot);
  const serialized = JSON.stringify(context);
  assert.equal(serialized.includes("must-not-appear"), false);
  assert.equal(context.railway.deployments.application.serviceId, "app");
});

test("error redaction removes credential-shaped values", () => {
  const githubLikeValue = ["gho", "abcdefghijklmnopqrstuvwxyz"].join("_");
  const passwordLikeValue = ["sample", "password", "value"].join("-");
  const secretLikeValue = ["sample", "secret", "value"].join("-");
  const result = redact(
    `token=${githubLikeValue} password=${passwordLikeValue} ?secret=${secretLikeValue}`
  );
  assert.equal(result.includes(githubLikeValue), false);
  assert.equal(result.includes(passwordLikeValue), false);
  assert.equal(result.includes(secretLikeValue), false);
  assert.match(result, /redacted/);
});
