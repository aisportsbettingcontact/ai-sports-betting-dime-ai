#!/usr/bin/env node

/**
 * Separately authorized administrator-only promotion for the already reviewed
 * authentication-closure and Railway-broker candidates.
 *
 * This script is intentionally unreachable from package.json. Candidate
 * generation never invokes it. It does not read a Railway credential, provider
 * token, production credential triple, or browser session.
 */

import { createHash, createPrivateKey, createPublicKey } from "node:crypto";
import { execFile } from "node:child_process";
import {
  chmod,
  chown,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  AUTHENTICATION_CANDIDATE_DESCRIPTOR,
  AUTHENTICATION_CANDIDATE_DIRECTORY,
} from "./build-dime-authentication-closure.mjs";
import {
  AUTHENTICATION_APPLICATION_DIRECTORY,
  AUTHENTICATION_CLOSURE_MANIFEST,
  AUTHENTICATION_CLOSURE_PUBLIC_KEY,
  AUTHENTICATION_ENTRYPOINT,
  AUTHENTICATION_TRUST_DIRECTORY,
  buildAuthenticationClosureManifest,
  collectAuthenticationTree,
  createAuthenticationClosureEnvelope,
  verifyAuthenticationClosure,
} from "./lib/dime-authentication-closure.mjs";
import {
  EXECUTABLE_TRUST_DIRECTORY,
  verifyOnePasswordSigningIdentity,
} from "./lib/dime-trusted-executables.mjs";
import {
  SECURE_RAILWAY_DIRECTORY,
  SECURE_RAILWAY_EXECUTABLE,
  SECURE_RAILWAY_PROVENANCE,
  SECURE_RAILWAY_TRUST_DIRECTORY,
} from "./dime-railway-secure.mjs";

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(scriptPath), "..");
const brokerSourcePath = resolve(
  repositoryRoot,
  "scripts/dime-railway-keychain.c"
);
const brokerCandidateDescriptorPath = resolve(
  SECURE_RAILWAY_DIRECTORY,
  "dime-railway-keychain.provenance-candidate.json"
);
const CONFIRMATION = "PROVISION_DIME_CREDENTIAL_TRUST_V2";
const TRUSTED_RAILWAY_EXECUTABLE = resolve(
  EXECUTABLE_TRUST_DIRECTORY,
  "railway-v1"
);
const HASH_PINNED_EXECUTABLES = ["node", "env", "git", "gh", "aws"];

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function contentInventory(inventory) {
  return inventory.entries.map(entry =>
    entry.type === "file"
      ? {
          type: entry.type,
          path: entry.path,
          size: entry.size,
          sha256: entry.sha256,
        }
      : { type: entry.type, path: entry.path }
  );
}

async function sha256File(path) {
  return sha256(await readFile(path));
}

function compilerString(name, value) {
  invariant(
    typeof value === "string" &&
      !value.includes('"') &&
      !value.includes("\\") &&
      !value.includes("\0"),
    `${name} cannot be represented as a compiler literal`
  );
  return `-D${name}="${value}"`;
}

function parseArguments(argv) {
  const values = argv.filter(value => value !== "--");
  let privateKeyPath = null;
  let confirmation = null;
  while (values.length > 0) {
    const value = values.shift();
    if (value === "--signing-private-key") {
      privateKeyPath = values.shift() ?? null;
    } else if (value === "--confirm") {
      confirmation = values.shift() ?? null;
    } else {
      throw new Error(`unknown option: ${value}`);
    }
  }
  return { privateKeyPath, confirmation };
}

async function hardenPromotedTree(path) {
  const state = await lstat(path);
  invariant(!state.isSymbolicLink(), `promotion rejects symlink: ${path}`);
  if (state.isDirectory()) {
    for (const name of (await readdir(path)).sort()) {
      await hardenPromotedTree(resolve(path, name));
    }
    await chown(path, 0, 0);
    await chmod(path, 0o555);
    return;
  }
  invariant(state.isFile(), `promotion rejects special file: ${path}`);
  await chown(path, 0, 0);
  await chmod(path, 0o444);
}

async function requirePrivateSigningKey(path) {
  invariant(
    path && isAbsolute(path),
    "signing private key path must be absolute"
  );
  invariant(
    (await realpath(path)) === path,
    "signing private key path must be canonical"
  );
  const segments = path.split("/").filter(Boolean);
  let ancestor = "/";
  for (const segment of segments.slice(0, -1)) {
    ancestor = resolve(ancestor, segment);
    const ancestorState = await lstat(ancestor);
    invariant(
      ancestorState.isDirectory() &&
        !ancestorState.isSymbolicLink() &&
        ancestorState.uid === 0 &&
        (ancestorState.mode & 0o022) === 0,
      "signing private key has an untrusted writable ancestor"
    );
  }
  const state = await lstat(path);
  invariant(
    state.isFile() &&
      !state.isSymbolicLink() &&
      state.uid === 0 &&
      ((state.mode & 0o7777) === 0o400 || (state.mode & 0o7777) === 0o600),
    "signing private key must be a root-owned mode-0400 or mode-0600 file"
  );
  const privateKey = createPrivateKey(await readFile(path));
  invariant(
    privateKey.asymmetricKeyType === "ed25519",
    "signing private key must be Ed25519"
  );
  return privateKey;
}

async function requireRootProtectedExecutable(path, expectedSha256, label) {
  invariant((await realpath(path)) === path, `${label} path must be canonical`);
  const segments = path.split("/").filter(Boolean);
  let ancestor = "/";
  for (const segment of segments.slice(0, -1)) {
    ancestor = resolve(ancestor, segment);
    const state = await lstat(ancestor);
    invariant(
      state.isDirectory() &&
        !state.isSymbolicLink() &&
        state.uid === 0 &&
        (state.mode & 0o022) === 0,
      `${label} has an untrusted writable ancestor`
    );
  }
  const state = await lstat(path);
  invariant(
    state.isFile() &&
      !state.isSymbolicLink() &&
      state.uid === 0 &&
      (state.mode & 0o7777) === 0o755 &&
      (await sha256File(path)) === expectedSha256,
    `${label} is not the reviewed root-protected mode-0755 executable`
  );
}

async function requireReviewedExecutable(executable, label) {
  invariant(
    executable &&
      typeof executable.path === "string" &&
      /^[0-9a-f]{64}$/.test(executable.sha256) &&
      Number.isInteger(executable.uid) &&
      Number.isInteger(executable.mode),
    `${label} candidate identity is invalid`
  );
  invariant(
    (await realpath(executable.path)) === executable.path,
    `${label} path must be canonical`
  );
  const state = await lstat(executable.path);
  invariant(
    state.isFile() &&
      !state.isSymbolicLink() &&
      state.uid === executable.uid &&
      (state.mode & 0o7777) === executable.mode &&
      (state.mode & 0o022) === 0 &&
      (state.mode & 0o111) !== 0 &&
      (await sha256File(executable.path)) === executable.sha256,
    `${label} changed after independent candidate review`
  );
  return executable;
}

async function requireAbsent(path, label) {
  await lstat(path)
    .then(() => {
      throw new Error(
        `${label} already exists; reviewed replacement is required`
      );
    })
    .catch(error => {
      if (error?.code !== "ENOENT") throw error;
    });
}

async function validateCredentialExecutableClosure(candidateDescriptor) {
  const executables = candidateDescriptor.credentialExecutables;
  invariant(
    executables && typeof executables === "object",
    "credential executable closure is missing"
  );
  invariant(
    HASH_PINNED_EXECUTABLES.every(name => executables[name]),
    "credential executable closure is incomplete"
  );
  invariant(executables.op, "1Password executable identity is missing");
  await Promise.all(
    [...HASH_PINNED_EXECUTABLES, "op"].map(name =>
      requireReviewedExecutable(executables[name], name)
    )
  );
  invariant(
    executables.node.path === candidateDescriptor.executables.node.path &&
      executables.node.sha256 === candidateDescriptor.executables.node.sha256,
    "credential and authentication Node identities differ"
  );
  await verifyOnePasswordSigningIdentity(executables.op.path);
  return executables;
}

async function requireExecutableTrustTargetsAbsent() {
  await mkdir(EXECUTABLE_TRUST_DIRECTORY, { recursive: true, mode: 0o755 });
  await chown(EXECUTABLE_TRUST_DIRECTORY, 0, 0);
  await chmod(EXECUTABLE_TRUST_DIRECTORY, 0o755);
  await Promise.all([
    ...HASH_PINNED_EXECUTABLES.map(name =>
      requireAbsent(
        resolve(EXECUTABLE_TRUST_DIRECTORY, `${name}.sha256`),
        `${name} executable provenance`
      )
    ),
    requireAbsent(TRUSTED_RAILWAY_EXECUTABLE, "trusted Railway executable"),
  ]);
}

async function provisionExecutableTrust(executables) {
  for (const name of HASH_PINNED_EXECUTABLES) {
    await writeProtectedFile(
      resolve(EXECUTABLE_TRUST_DIRECTORY, `${name}.sha256`),
      `${executables[name].sha256}\n`
    );
  }
}

async function provisionTrustedRailwayExecutable(executable) {
  await requireReviewedExecutable(executable, "Railway executable");
  const temporary = `${TRUSTED_RAILWAY_EXECUTABLE}.${process.pid}.tmp`;
  await writeFile(temporary, await readFile(executable.path), {
    mode: 0o500,
    flag: "wx",
  });
  await chown(temporary, 0, 0);
  await chmod(temporary, 0o755);
  invariant(
    (await sha256File(temporary)) === executable.sha256,
    "trusted Railway copy differs from reviewed source"
  );
  await rename(temporary, TRUSTED_RAILWAY_EXECUTABLE);
  await requireRootProtectedExecutable(
    TRUSTED_RAILWAY_EXECUTABLE,
    executable.sha256,
    "trusted Railway executable"
  );
  return {
    path: TRUSTED_RAILWAY_EXECUTABLE,
    sha256: executable.sha256,
  };
}

async function writeProtectedFile(path, bytes) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, bytes, { mode: 0o400, flag: "wx" });
  await chown(temporary, 0, 0);
  await chmod(temporary, 0o444);
  await rename(temporary, path);
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  invariant(process.getuid() === 0, "administrator uid 0 is required");
  invariant(
    args.confirmation === CONFIRMATION,
    `explicit --confirm ${CONFIRMATION} is required`
  );
  const privateKey = await requirePrivateSigningKey(args.privateKeyPath);
  const publicKey = createPublicKey(privateKey);
  const [candidateDescriptor, brokerCandidateDescriptor] = await Promise.all([
    readFile(AUTHENTICATION_CANDIDATE_DESCRIPTOR, "utf8").then(JSON.parse),
    readFile(brokerCandidateDescriptorPath, "utf8").then(JSON.parse),
  ]);
  invariant(
    candidateDescriptor?.kind ===
      "dime-authentication-closure-provenance-candidate" &&
      candidateDescriptor.trusted === false &&
      candidateDescriptor.credentialExecution ===
        "BLOCKED_PENDING_INDEPENDENT_ADMIN_PROVENANCE",
    "authentication closure candidate descriptor is invalid"
  );
  invariant(
    brokerCandidateDescriptor?.kind ===
      "dime-railway-broker-provenance-candidate" &&
      brokerCandidateDescriptor.trusted === false &&
      brokerCandidateDescriptor.authenticationChild?.sha256 ===
        candidateDescriptor.deterministicBundle.sha256,
    "Railway broker candidate descriptor is invalid"
  );
  invariant(
    (await sha256File(brokerSourcePath)) ===
      brokerCandidateDescriptor.broker?.sourceSha256,
    "Railway broker source changed after candidate review"
  );
  const credentialExecutables =
    await validateCredentialExecutableClosure(candidateDescriptor);
  await requireReviewedExecutable(
    brokerCandidateDescriptor.executables.railway,
    "Railway executable"
  );
  await Promise.all([
    requireRootProtectedExecutable(
      candidateDescriptor.executables.node.path,
      candidateDescriptor.executables.node.sha256,
      "Node executable"
    ),
    requireRootProtectedExecutable(
      candidateDescriptor.executables.browser.path,
      candidateDescriptor.executables.browser.sha256,
      "browser executable"
    ),
    requireReviewedExecutable(credentialExecutables.op, "1Password executable"),
  ]);
  const [candidateState, secureDirectoryState] = await Promise.all([
    lstat(AUTHENTICATION_CANDIDATE_DIRECTORY),
    lstat(SECURE_RAILWAY_DIRECTORY),
  ]);
  invariant(
    candidateState.isDirectory() &&
      !candidateState.isSymbolicLink() &&
      (candidateState.mode & 0o7777) === 0o700,
    "authentication closure candidate directory is invalid"
  );
  invariant(
    secureDirectoryState.isDirectory() &&
      !secureDirectoryState.isSymbolicLink() &&
      (secureDirectoryState.mode & 0o7777) === 0o700,
    "secure Railway directory is invalid"
  );
  const reviewedCandidateInventory = await collectAuthenticationTree(
    AUTHENTICATION_CANDIDATE_DIRECTORY,
    {
      expectedUid: candidateState.uid,
      directoryMode: 0o500,
      rootDirectoryMode: 0o700,
      fileMode: 0o400,
    }
  );
  invariant(
    JSON.stringify(reviewedCandidateInventory) ===
      JSON.stringify(candidateDescriptor.application?.candidateInventory),
    "authentication closure candidate changed after review"
  );
  await lstat(AUTHENTICATION_APPLICATION_DIRECTORY)
    .then(() => {
      throw new Error(
        "authentication application already exists; reviewed replacement procedure is required"
      );
    })
    .catch(error => {
      if (error?.code !== "ENOENT") throw error;
    });

  await requireExecutableTrustTargetsAbsent();
  await provisionExecutableTrust(credentialExecutables);
  const trustedRailway = await provisionTrustedRailwayExecutable(
    brokerCandidateDescriptor.executables.railway
  );

  const applicationStaging = `${AUTHENTICATION_APPLICATION_DIRECTORY}.${process.pid}.staging`;
  await mkdir(dirname(AUTHENTICATION_APPLICATION_DIRECTORY), {
    recursive: true,
    mode: 0o755,
  });
  await chown(dirname(AUTHENTICATION_APPLICATION_DIRECTORY), 0, 0);
  await chmod(dirname(AUTHENTICATION_APPLICATION_DIRECTORY), 0o755);
  await rm(applicationStaging, { recursive: true, force: true });
  await cp(AUTHENTICATION_CANDIDATE_DIRECTORY, applicationStaging, {
    recursive: true,
    dereference: false,
    preserveTimestamps: false,
  });
  await hardenPromotedTree(applicationStaging);
  await rename(applicationStaging, AUTHENTICATION_APPLICATION_DIRECTORY);

  await mkdir(AUTHENTICATION_TRUST_DIRECTORY, {
    recursive: true,
    mode: 0o755,
  });
  await chown(AUTHENTICATION_TRUST_DIRECTORY, 0, 0);
  await chmod(AUTHENTICATION_TRUST_DIRECTORY, 0o755);
  const manifest = await buildAuthenticationClosureManifest({
    nodePath: candidateDescriptor.executables.node.path,
    browserPath: candidateDescriptor.executables.browser.path,
    configurationPaths: candidateDescriptor.configuration,
  });
  invariant(
    JSON.stringify(contentInventory(manifest.applicationInventory)) ===
      JSON.stringify(
        contentInventory(candidateDescriptor.application.candidateInventory)
      ),
    "promoted authentication application differs from the reviewed candidate"
  );
  const envelope = createAuthenticationClosureEnvelope(
    manifest,
    privateKey,
    publicKey
  );
  await writeProtectedFile(
    AUTHENTICATION_CLOSURE_PUBLIC_KEY,
    publicKey.export({ type: "spki", format: "pem" })
  );
  await writeProtectedFile(
    AUTHENTICATION_CLOSURE_MANIFEST,
    `${JSON.stringify(envelope)}\n`
  );
  await verifyAuthenticationClosure({ environment: {} });

  const [
    nodeSha256,
    railwaySha256,
    authSha256,
    manifestSha256,
    publicKeySha256,
  ] = await Promise.all([
    sha256File(candidateDescriptor.executables.node.path),
    sha256File(trustedRailway.path),
    sha256File(AUTHENTICATION_ENTRYPOINT),
    sha256File(AUTHENTICATION_CLOSURE_MANIFEST),
    sha256File(AUTHENTICATION_CLOSURE_PUBLIC_KEY),
  ]);
  invariant(
    nodeSha256 === candidateDescriptor.executables.node.sha256 &&
      railwaySha256 === trustedRailway.sha256 &&
      authSha256 === candidateDescriptor.deterministicBundle.sha256,
    "candidate executable identity changed before administrator promotion"
  );

  const brokerTemporary = resolve(
    SECURE_RAILWAY_DIRECTORY,
    `dime-railway-keychain.${process.pid}.admin-staging`
  );
  await execFileAsync(
    "/usr/bin/clang",
    [
      brokerSourcePath,
      compilerString(
        "DIME_NODE_EXECUTABLE",
        candidateDescriptor.executables.node.path
      ),
      compilerString("DIME_NODE_SHA256", nodeSha256),
      compilerString("DIME_RAILWAY_EXECUTABLE", trustedRailway.path),
      compilerString("DIME_RAILWAY_SHA256", railwaySha256),
      compilerString(
        "DIME_AUTH_APPLICATION_DIRECTORY",
        AUTHENTICATION_APPLICATION_DIRECTORY
      ),
      compilerString("DIME_PRODUCTION_AUTH_SCRIPT", AUTHENTICATION_ENTRYPOINT),
      compilerString("DIME_PRODUCTION_AUTH_SHA256", authSha256),
      compilerString(
        "DIME_AUTH_CLOSURE_MANIFEST",
        AUTHENTICATION_CLOSURE_MANIFEST
      ),
      compilerString("DIME_AUTH_CLOSURE_MANIFEST_SHA256", manifestSha256),
      compilerString(
        "DIME_AUTH_CLOSURE_PUBLIC_KEY",
        AUTHENTICATION_CLOSURE_PUBLIC_KEY
      ),
      compilerString("DIME_AUTH_CLOSURE_PUBLIC_KEY_SHA256", publicKeySha256),
      "-framework",
      "Security",
      "-framework",
      "CoreFoundation",
      "-Wall",
      "-Wextra",
      "-Werror",
      "-Wno-deprecated-declarations",
      "-O2",
      "-o",
      brokerTemporary,
    ],
    {
      timeout: 120_000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
      env: {
        HOME: "/var/root",
        PATH: "/usr/bin:/bin",
        TMPDIR: "/private/tmp",
      },
    }
  );
  invariant(
    (await sha256File(brokerSourcePath)) ===
      brokerCandidateDescriptor.broker.sourceSha256,
    "Railway broker source changed during administrator compilation"
  );
  await chown(
    brokerTemporary,
    secureDirectoryState.uid,
    secureDirectoryState.gid
  );
  await chmod(brokerTemporary, 0o500);
  const brokerSha256 = await sha256File(brokerTemporary);
  await mkdir(SECURE_RAILWAY_TRUST_DIRECTORY, {
    recursive: true,
    mode: 0o755,
  });
  await chown(SECURE_RAILWAY_TRUST_DIRECTORY, 0, 0);
  await chmod(SECURE_RAILWAY_TRUST_DIRECTORY, 0o755);
  await writeProtectedFile(SECURE_RAILWAY_PROVENANCE, `${brokerSha256}\n`);
  await rename(brokerTemporary, SECURE_RAILWAY_EXECUTABLE);

  process.stdout.write(
    `${JSON.stringify({
      status: "PROVISIONED",
      trustRoot: "root-owned-ed25519-and-compiled-sha256",
      authenticationApplication: AUTHENTICATION_APPLICATION_DIRECTORY,
      closureManifest: AUTHENTICATION_CLOSURE_MANIFEST,
      brokerProvenance: SECURE_RAILWAY_PROVENANCE,
      executableTrustDirectory: EXECUTABLE_TRUST_DIRECTORY,
      trustedRailwayExecutable: TRUSTED_RAILWAY_EXECUTABLE,
      credentialsRead: false,
      loginAttempted: false,
      providerExecutionAttempted: false,
      nextGate: "independent read-only provenance verification",
    })}\n`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  main().catch(error => {
    process.stderr.write(
      `Dime credential trust provisioning failed closed: ${error.message}\n`
    );
    process.exitCode = 1;
  });
}
