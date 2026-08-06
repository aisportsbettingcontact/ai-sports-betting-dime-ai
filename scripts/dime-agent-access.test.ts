import assert from "node:assert/strict";
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "vitest";

import {
  ACCESS_MANIFEST_PATH,
  accessCacheState,
  credentialContractSha256,
  credentialBrokerPlan,
  credentialPresence,
  loadAccessManifest,
  normalizeAwsIdentity,
  normalizeHuggingFaceIdentity,
  normalizeOnePasswordDesktopAccess,
  normalizeRunPodIdentity,
  redactAgentError,
  REPOSITORY_ROOT,
  secureBrokerFile,
  validateAccessManifest,
} from "./dime-agent-access.mjs";

async function fixture() {
  return structuredClone((await loadAccessManifest()).manifest);
}

test("the committed access manifest validates the exact targets and denies writes", async () => {
  const manifest = await fixture();
  assert.equal(validateAccessManifest(manifest), manifest);
  assert.equal(
    manifest.providers.github.repository,
    "aisportsbettingcontact/ai-sports-betting-dime-ai"
  );
  assert.equal(
    manifest.providers.railway.projectId,
    "8dd7341d-702c-48c7-90df-5c19a4f04913"
  );
  assert.equal(
    manifest.providers.railway.environmentId,
    "787f3113-17ab-47d9-9819-1268aeb09b3e"
  );
  assert.equal(manifest.safety.remoteMutationsAuthorized, false);
  assert.equal(manifest.safety.railwayVariableExportAllowed, false);
  assert.equal(manifest.safety.railwayExactPlatformCredentialReadAllowed, true);
  assert.equal(manifest.safety.trainingAuthorized, false);
  assert.equal(manifest.safety.providerActivationAuthorized, false);
});

test("platform roles use six exact names from unreferenced Railway shared variables", async () => {
  const manifest = await fixture();
  assert.deepEqual(manifest.platform.roles.owner.environment, {
    email: "DIME_PROD_OWNER_EMAIL",
    password: "DIME_PROD_OWNER_PASSWORD",
    username: "DIME_PROD_OWNER_USERNAME",
  });
  assert.deepEqual(manifest.platform.roles.user.environment, {
    email: "DIME_PROD_USER_EMAIL",
    password: "DIME_PROD_USER_PASSWORD",
    username: "DIME_PROD_USER_USERNAME",
  });
  assert.deepEqual(manifest.platform.credentialSource, {
    kind: "railway-service-variables",
    service: "shared",
    retrieval: "native-broker-exact-role-authentication",
    plaintextCacheAllowed: false,
  });
  assert.equal(
    Object.hasOwn(manifest.platform.roles.owner, "brokerEnvFile"),
    false
  );
});

test("manifest rejects bulk Railway export and merged provider scopes", async () => {
  const manifest = await fixture();
  manifest.safety.railwayVariableExportAllowed = true;
  assert.throws(
    () => validateAccessManifest(manifest),
    /railwayVariableExportAllowed must remain false/
  );
  const disabledExactRead = await fixture();
  disabledExactRead.safety.railwayExactPlatformCredentialReadAllowed = false;
  assert.throws(
    () => validateAccessManifest(disabledExactRead),
    /exact Railway platform-credential reads/
  );

  const duplicate = await fixture();
  duplicate.providers.runPod.brokerEnvFile =
    duplicate.providers.huggingFace.scopes["hf-training"].brokerEnvFile;
  assert.throws(
    () => validateAccessManifest(duplicate),
    /different broker environment file/
  );
});

test("a full-access RunPod key can never be labeled read-only", async () => {
  const manifest = await fixture();
  manifest.providers.runPod.permissionContract = "restricted-read-only";
  manifest.providers.runPod.identityVerified = true;
  manifest.providers.runPod.permissionsVerified = true;
  assert.throws(
    () => validateAccessManifest(manifest),
    /RunPod permission contract is invalid/
  );
});

test("credential presence reports names only", () => {
  const value = ["credential", "value", "must", "not", "escape"].join("-");
  const result = credentialPresence(
    { FIRST_CREDENTIAL: value, SECOND_CREDENTIAL: "" },
    ["FIRST_CREDENTIAL", "SECOND_CREDENTIAL"]
  );
  assert.deepEqual(result, {
    configured: false,
    requiredNames: ["FIRST_CREDENTIAL", "SECOND_CREDENTIAL"],
    missingNames: ["SECOND_CREDENTIAL"],
  });
  assert.equal(JSON.stringify(result).includes(value), false);
});

test("Hugging Face identity must match the exact named fine-grained credential", () => {
  const result = normalizeHuggingFaceIdentity(
    {
      name: "taileredsports",
      auth: {
        type: "access_token",
        accessToken: {
          displayName: "dime-training-read-v1",
          role: "fineGrained",
        },
      },
    },
    {
      account: "taileredsports",
      credentialName: "dime-training-read-v1",
      tokenRole: "fineGrained",
    }
  );
  assert.deepEqual(result, {
    status: "PASS",
    account: "taileredsports",
    credentialName: "dime-training-read-v1",
    tokenRole: "fineGrained",
    authorization: "IDENTITY_ONLY",
  });
  assert.throws(
    () =>
      normalizeHuggingFaceIdentity(
        {
          name: "taileredsports",
          auth: {
            type: "access_token",
            accessToken: {
              displayName: "dime-release-publisher-v1",
              role: "fineGrained",
            },
          },
        },
        {
          account: "taileredsports",
          credentialName: "dime-training-read-v1",
          tokenRole: "fineGrained",
        }
      ),
    /credential-name mismatch/
  );
});

test("AWS and RunPod normalization stores fingerprints, not raw identity", () => {
  const account = "123456789012";
  const arn = "arn:aws:sts::123456789012:assumed-role/dime-builder/session";
  const aws = normalizeAwsIdentity(
    { Account: account, Arn: arn, UserId: "session-id" },
    "dime-builder"
  );
  const awsJson = JSON.stringify(aws);
  assert.equal(awsJson.includes(account), false);
  assert.equal(awsJson.includes(arn), false);
  assert.equal(aws.principalType, "assumed-role");

  const email = ["platform", "owner"].join("-") + "@example.invalid";
  const runPod = normalizeRunPodIdentity(
    { id: "runpod-account-id", email },
    "dime-control-plane-read-v1"
  );
  const runPodJson = JSON.stringify(runPod);
  assert.equal(runPodJson.includes(email), false);
  assert.equal(runPodJson.includes("runpod-account-id"), false);
  assert.equal(runPod.status, "CREDENTIAL_PRESENT_PERMISSION_UNVERIFIED");
  assert.equal(runPod.identityVerified, false);
  assert.equal(runPod.permissionsVerified, false);
  assert.equal(runPod.authorization, "NONE");
});

test("RunPod verification uses a bearer header and never a credential-bearing URL", async () => {
  const manifest = await fixture();
  assert.equal(manifest.providers.runPod.verificationMethod, "GET_BEARER");
  assert.match(
    manifest.providers.runPod.verificationEndpoint,
    /^https:\/\/rest\.runpod\.io\/v1\/endpoints/
  );
  assert.equal(
    /(?:api[_-]?key|token|secret)=/i.test(
      manifest.providers.runPod.verificationEndpoint
    ),
    false
  );
  const source = await readFile(
    resolve(REPOSITORY_ROOT, "scripts/dime-agent-access.mjs"),
    "utf8"
  );
  assert.match(
    source,
    /Authorization: `Bearer \$\{process\.env\.RUNPOD_API_KEY\}`/
  );
  assert.equal(source.includes('searchParams.set("api_key"'), false);
});

test("1Password desktop access retains no account or vault identity", () => {
  const result = normalizeOnePasswordDesktopAccess(
    [
      {
        url: "my.1password.com",
        email: "owner@example.invalid",
        user_uuid: "user-secret-identity",
        account_uuid: "account-secret-identity",
      },
    ],
    [
      {
        id: "vault-secret-identity",
        name: "Sensitive Vault Name",
      },
    ]
  );
  assert.deepEqual(result, {
    status: "PASS",
    accountHost: "my.1password.com",
    accountType: "desktop-app",
    accessibleVaultCount: 1,
    authorization: "SECRET_REFERENCE_RESOLUTION_ONLY",
  });
  const serialized = JSON.stringify(result);
  for (const secret of [
    "owner@example.invalid",
    "user-secret-identity",
    "account-secret-identity",
    "vault-secret-identity",
    "Sensitive Vault Name",
  ]) {
    assert.equal(serialized.includes(secret), false);
  }
});

test("credential broker plans are fixed op-run commands with no arbitrary command", async () => {
  const manifest = await fixture();
  const executableResolver = async (name: string) => ({
    path: `/reviewed/${name}`,
    sha256: name.repeat(64).slice(0, 64),
  });
  for (const scope of ["hf-training", "runpod"]) {
    const plan = await credentialBrokerPlan(manifest, scope, {
      executableResolver,
      // The real validator stats the on-disk broker file; this fixture has no
      // such file. The refusal path is covered by the test below.
      brokerFileValidator: async () => true,
    });
    assert.equal(plan.executable, "/reviewed/op");
    assert.equal(plan.args[0], "run");
    assert.equal(plan.args.includes("/reviewed/env"), true);
    for (const name of [
      "OP_SERVICE_ACCOUNT_TOKEN",
      "OP_CONNECT_HOST",
      "OP_CONNECT_TOKEN",
      "OP_ACCOUNT",
    ]) {
      assert.equal(plan.args.includes(name), true);
    }
    assert.equal(plan.args.includes("/reviewed/node"), true);
    assert.equal(plan.args.includes("--broker-active"), true);
    assert.equal(plan.args.includes(scope), true);
    assert.equal(
      plan.args.some(argument =>
        /(?:railway|deploy|variables|training|publish)/i.test(argument)
      ),
      scope === "hf-training"
    );
  }
});

test("1Password broker files accept only one scope-exact secret reference", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "dime-broker-reference-"));
  const valid = resolve(directory, "valid.env");
  const plaintext = resolve(directory, "plaintext.env");
  const mixed = resolve(directory, "mixed.env");
  const wrongScope = resolve(directory, "wrong-scope.env");
  const wrongItem = resolve(directory, "wrong-item.env");
  const linked = resolve(directory, "linked.env");
  const expectedReference =
    "op://Dime Infrastructure/dime-training-read-v1/credential";
  try {
    await writeFile(valid, `HF_TOKEN="${expectedReference}"\n`, {
      mode: 0o600,
    });
    await chmod(valid, 0o600);
    assert.equal(
      await secureBrokerFile(valid, "HF_TOKEN", expectedReference),
      true
    );

    await writeFile(plaintext, "HF_TOKEN=plaintext-forbidden\n", {
      mode: 0o600,
    });
    await chmod(plaintext, 0o600);
    await assert.rejects(
      secureBrokerFile(plaintext, "HF_TOKEN", expectedReference),
      /exact reviewed vault, item, section, and field/
    );

    await writeFile(
      mixed,
      [
        `HF_TOKEN="${expectedReference}"`,
        'RUNPOD_API_KEY="op://Dime Infrastructure/Run Pod - dime-control-plane-read-v1/credential"',
      ].join("\n"),
      { mode: 0o600 }
    );
    await chmod(mixed, 0o600);
    await assert.rejects(
      secureBrokerFile(mixed, "HF_TOKEN", expectedReference),
      /exactly one assignment/
    );

    await writeFile(
      wrongScope,
      'RUNPOD_API_KEY="op://Dime Infrastructure/Run Pod - dime-control-plane-read-v1/credential"\n',
      { mode: 0o600 }
    );
    await chmod(wrongScope, 0o600);
    await assert.rejects(
      secureBrokerFile(wrongScope, "HF_TOKEN", expectedReference),
      /must assign only HF_TOKEN/
    );

    await writeFile(
      wrongItem,
      'HF_TOKEN="op://Dime Infrastructure/dime-release-publisher-v1/credential"\n',
      { mode: 0o600 }
    );
    await chmod(wrongItem, 0o600);
    await assert.rejects(
      secureBrokerFile(wrongItem, "HF_TOKEN", expectedReference),
      /exact reviewed vault, item, section, and field/
    );

    await symlink(valid, linked);
    await assert.rejects(
      secureBrokerFile(linked, "HF_TOKEN", expectedReference),
      /must not be a symlink/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("identity cache freshness is checksum-bound", () => {
  const now = Date.parse("2026-07-30T12:00:00.000Z");
  const cache = {
    schemaVersion: 1,
    kind: "dime-agent-identity-cache",
    manifestSha256: "a".repeat(64),
    generatedAt: "2026-07-30T11:59:00.000Z",
    expiresAt: "2026-07-30T12:04:00.000Z",
  };
  assert.deepEqual(accessCacheState(cache, "a".repeat(64), now), {
    valid: true,
    fresh: true,
    ageSeconds: 60,
  });
  assert.equal(accessCacheState(cache, "b".repeat(64), now).valid, false);
});

test("provider evidence hashes ignore unrelated platform edits", async () => {
  const manifest = await fixture();
  const training = credentialContractSha256(manifest, "hf-training");
  const runpod = credentialContractSha256(manifest, "runpod");
  const platformOnly = structuredClone(manifest);
  platformOnly.platform.authenticatedPath = "/different-platform-path";
  assert.equal(credentialContractSha256(platformOnly, "hf-training"), training);
  assert.equal(credentialContractSha256(platformOnly, "runpod"), runpod);

  const changedCredential = structuredClone(manifest);
  changedCredential.providers.huggingFace.scopes["hf-training"].credentialName =
    "different-training-credential";
  assert.notEqual(
    credentialContractSha256(changedCredential, "hf-training"),
    training
  );
});

test("agent error redaction covers every credential family", () => {
  const values = {
    hf: "hf_" + "A".repeat(30),
    runpod: "rpa_" + "B".repeat(30),
    aws: "AKIA" + "C".repeat(16),
    github: "gho_" + "D".repeat(30),
    password: ["sample", "password", "value"].join("-"),
  };
  const redacted = redactAgentError(
    `${values.hf} ${values.runpod} ${values.aws} ${values.github} password=${values.password}`
  );
  for (const value of Object.values(values)) {
    assert.equal(redacted.includes(value), false);
  }
});

test("Codex and Claude both load the shared context without secret output", async () => {
  const [agents, claude, settings, hook, manifestBytes] = await Promise.all([
    readFile(resolve(REPOSITORY_ROOT, "AGENTS.md"), "utf8"),
    readFile(resolve(REPOSITORY_ROOT, "CLAUDE.md"), "utf8"),
    readFile(resolve(REPOSITORY_ROOT, ".claude/settings.json"), "utf8"),
    readFile(
      resolve(REPOSITORY_ROOT, ".claude/scripts/bootstrap-dime-context.sh"),
      "utf8"
    ),
    readFile(ACCESS_MANIFEST_PATH, "utf8"),
  ]);
  assert.match(agents, /pnpm agent:context/);
  assert.match(claude, /pnpm agent:context/);
  assert.match(settings, /bootstrap-dime-context\.sh/);
  assert.match(hook, /dime-agent-access\.mjs" context/);
  assert.match(hook, /exit 0/);
  assert.equal(/hf_[A-Za-z0-9]{12,}/.test(manifestBytes), false);
  assert.equal(/rpa_[A-Za-z0-9_-]{12,}/.test(manifestBytes), false);
});

test("shared context never inherits Railway credentials", async () => {
  const source = await readFile(
    resolve(REPOSITORY_ROOT, "scripts/dime-agent-access.mjs"),
    "utf8"
  );
  const controlPlaneEnvironment = source.slice(
    source.indexOf("function controlPlaneEnvironment()"),
    source.indexOf("function brokerEnvironment()")
  );
  assert.equal(controlPlaneEnvironment.includes("RAILWAY_TOKEN"), false);
  assert.equal(controlPlaneEnvironment.includes("RAILWAY_API_TOKEN"), false);
});

test("credential broker plan refuses to hand op a path that fails validation at handoff time", async () => {
  const manifest = await fixture();
  const executableResolver = async (name: string) => ({
    path: `/reviewed/${name}`,
    sha256: name.repeat(64).slice(0, 64),
  });

  // Preflight can pass minutes before the handoff, so the plan re-validates
  // immediately before embedding the path in the op-run argv. A file that has
  // since been swapped (wrong mode, wrong owner, symlinked, wrong contents)
  // must abort the plan rather than be handed to a second process.
  await assert.rejects(
    () =>
      credentialBrokerPlan(manifest, "runpod", {
        executableResolver,
        brokerFileValidator: async () => false,
      }),
    /failed validation immediately before handoff/
  );

  await assert.rejects(
    () =>
      credentialBrokerPlan(manifest, "hf-training", {
        executableResolver,
        brokerFileValidator: async () => {
          throw new Error("broker reference file permissions must be 0600");
        },
      }),
    /0600/
  );
});

test("credential broker plan validates the exact path it hands to op", async () => {
  const manifest = await fixture();
  const executableResolver = async (name: string) => ({
    path: `/reviewed/${name}`,
    sha256: name.repeat(64).slice(0, 64),
  });
  const validated: string[] = [];

  const plan = await credentialBrokerPlan(manifest, "runpod", {
    executableResolver,
    brokerFileValidator: async (path: string) => {
      validated.push(path);
      return true;
    },
  });

  // The path that was checked and the path embedded in argv must be the same
  // string — re-resolving it separately would reintroduce the gap.
  const envFileArg = plan.args.find((a: string) => a.startsWith("--env-file="));
  assert.equal(validated.length, 1);
  assert.equal(envFileArg, `--env-file=${validated[0]}`);
});
