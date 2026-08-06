import {
  createHash,
  createPublicKey,
  sign as signPayload,
  verify as verifySignature,
} from "node:crypto";
import { readdir, lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const AUTHENTICATION_APPLICATION_DIRECTORY =
  "/Library/Application Support/DimeAI/authentication/v2";
export const AUTHENTICATION_ENTRYPOINT = resolve(
  AUTHENTICATION_APPLICATION_DIRECTORY,
  "scripts/dime-production-auth.bundle.mjs"
);
export const AUTHENTICATION_CONFIGURATION_RELATIVE_PATHS = Object.freeze([
  "config/dime-agent-access.v1.json",
  "ml/dime-1.0/configs/platform_contract.json",
]);
export const AUTHENTICATION_TRUST_DIRECTORY =
  "/Library/Application Support/DimeAI/trust/authentication";
export const AUTHENTICATION_CLOSURE_MANIFEST = resolve(
  AUTHENTICATION_TRUST_DIRECTORY,
  "closure-v2.json"
);
export const AUTHENTICATION_CLOSURE_PUBLIC_KEY = resolve(
  AUTHENTICATION_TRUST_DIRECTORY,
  "closure-ed25519-public.pem"
);
export const AUTHENTICATION_FIXED_ENVIRONMENT = Object.freeze([
  "DIME_AUTH_CLOSURE_PREFLIGHT",
  "DIME_BUNDLED_PRODUCTION_AUTH",
  "DIME_PLATFORM_CREDENTIAL_SOURCE",
  "HOME",
  "LANG",
  "LC_ALL",
  "LOGNAME",
  "PATH",
  "TMPDIR",
  "USER",
]);

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function exactKeys(value, keys, label) {
  invariant(
    value && typeof value === "object" && !Array.isArray(value),
    `${label} must be an object`
  );
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  invariant(
    actual.length === expected.length &&
      actual.every((key, index) => key === expected[index]),
    `${label} keys are outside the closed contract`
  );
}

function exactMode(state, mode) {
  return (state.mode & 0o7777) === mode;
}

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function sha256File(path) {
  return sha256Bytes(await readFile(path));
}

function canonicalPayload(value) {
  return Buffer.from(JSON.stringify(value), "utf8");
}

function canonicalInventory(entries) {
  return Buffer.from(JSON.stringify(entries), "utf8");
}

function publicKeyId(publicKey) {
  return createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest("hex");
}

function asPublicKey(value) {
  return value?.type === "public" ? value : createPublicKey(value);
}

function normalizedRelativePath(root, path) {
  const value = relative(root, path).split(sep).join("/");
  invariant(
    value.length > 0 &&
      value !== ".." &&
      !value.startsWith("../") &&
      !value.includes("\0"),
    "authentication closure contains an invalid relative path"
  );
  return value;
}

async function requireCanonicalPath(path, label) {
  invariant(isAbsolute(path), `${label} path must be absolute`);
  invariant((await realpath(path)) === path, `${label} path must be canonical`);
}

async function verifyProtectedAncestorChain(path, expectedUid, label) {
  const segments = path.split(sep).filter(Boolean);
  let ancestor = sep;
  for (const segment of segments.slice(0, -1)) {
    ancestor = resolve(ancestor, segment);
    const state = await lstat(ancestor);
    invariant(
      state.isDirectory() &&
        !state.isSymbolicLink() &&
        state.uid === expectedUid &&
        (state.mode & 0o022) === 0,
      `${label} has an untrusted writable ancestor`
    );
  }
}

/**
 * Return the complete deterministic inventory of a closed application tree.
 * Directories and files have exact modes; links and special files are rejected.
 */
export async function collectAuthenticationTree(
  root,
  {
    expectedUid = 0,
    directoryMode = 0o555,
    rootDirectoryMode = directoryMode,
    fileMode = 0o444,
  } = {}
) {
  await requireCanonicalPath(root, "authentication application");
  const entries = [];

  async function visit(directory) {
    const names = (await readdir(directory)).sort((left, right) =>
      left < right ? -1 : left > right ? 1 : 0
    );
    for (const name of names) {
      invariant(
        name !== "." &&
          name !== ".." &&
          !name.includes("/") &&
          !name.includes("\0"),
        "authentication closure contains an invalid entry name"
      );
      const path = resolve(directory, name);
      const state = await lstat(path);
      invariant(
        !state.isSymbolicLink(),
        `authentication closure dependency is a symlink: ${name}`
      );
      invariant(
        state.uid === expectedUid,
        `authentication closure dependency has untrusted ownership: ${name}`
      );
      const relativePath = normalizedRelativePath(root, path);
      if (state.isDirectory()) {
        invariant(
          exactMode(state, directoryMode),
          `authentication closure directory mode is not ${directoryMode
            .toString(8)
            .padStart(4, "0")}: ${relativePath}`
        );
        entries.push({
          type: "directory",
          path: `${relativePath}/`,
          mode: directoryMode.toString(8).padStart(4, "0"),
        });
        await visit(path);
        continue;
      }
      invariant(
        state.isFile(),
        `authentication closure contains a non-file dependency: ${relativePath}`
      );
      invariant(
        exactMode(state, fileMode),
        `authentication closure file mode is not ${fileMode
          .toString(8)
          .padStart(4, "0")}: ${relativePath}`
      );
      entries.push({
        type: "file",
        path: relativePath,
        mode: fileMode.toString(8).padStart(4, "0"),
        size: state.size,
        sha256: await sha256File(path),
      });
    }
  }

  const rootState = await lstat(root);
  invariant(
    rootState.isDirectory() &&
      !rootState.isSymbolicLink() &&
      rootState.uid === expectedUid &&
      exactMode(rootState, rootDirectoryMode),
    "authentication application root is not a trusted immutable directory"
  );
  await visit(root);
  return {
    entries,
    entryCount: entries.length,
    treeSha256: sha256Bytes(canonicalInventory(entries)),
  };
}

function subtreeEntries(inventory, applicationDirectory, subtreeRoot) {
  invariant(
    subtreeRoot === applicationDirectory ||
      subtreeRoot.startsWith(`${applicationDirectory}${sep}`),
    "package tree is outside the authentication application"
  );
  const prefix = `${normalizedRelativePath(
    applicationDirectory,
    subtreeRoot
  )}/`;
  return inventory.entries
    .filter(entry => entry.path === prefix || entry.path.startsWith(prefix))
    .map(entry => ({
      ...entry,
      path: entry.path.slice(prefix.length),
    }))
    .filter(entry => entry.path.length > 0);
}

function validateFileIdentity(value, label) {
  exactKeys(value, ["path", "sha256"], label);
  invariant(isAbsolute(value.path), `${label}.path must be absolute`);
  invariant(SHA256_PATTERN.test(value.sha256), `${label}.sha256 is invalid`);
}

export function validateAuthenticationClosureManifest(
  manifest,
  {
    expectedApplicationDirectory = AUTHENTICATION_APPLICATION_DIRECTORY,
    expectedEntrypoint = AUTHENTICATION_ENTRYPOINT,
  } = {}
) {
  exactKeys(
    manifest,
    [
      "schemaVersion",
      "kind",
      "applicationDirectory",
      "workingDirectory",
      "entrypoint",
      "node",
      "browser",
      "configuration",
      "playwrightPackages",
      "applicationInventory",
      "environment",
      "credentialTransport",
      "authorization",
    ],
    "authentication closure manifest"
  );
  invariant(manifest.schemaVersion === 2, "closure schemaVersion must be 2");
  invariant(
    manifest.kind === "dime-credential-authentication-closure",
    "closure kind is invalid"
  );
  invariant(
    manifest.applicationDirectory === expectedApplicationDirectory &&
      manifest.workingDirectory === expectedApplicationDirectory,
    "authentication application or working directory is invalid"
  );
  validateFileIdentity(manifest.entrypoint, "closure entrypoint");
  validateFileIdentity(manifest.node, "closure node");
  validateFileIdentity(manifest.browser, "closure browser");
  invariant(
    manifest.entrypoint.path === expectedEntrypoint,
    "closure entrypoint path is invalid"
  );
  invariant(
    Array.isArray(manifest.configuration) &&
      manifest.configuration.length === 2,
    "closure must identify the exact two authentication configuration files"
  );
  const expectedConfigurationPaths =
    AUTHENTICATION_CONFIGURATION_RELATIVE_PATHS.map(path =>
      resolve(expectedApplicationDirectory, path)
    );
  for (const [index, configuration] of manifest.configuration.entries()) {
    validateFileIdentity(configuration, `closure configuration ${index}`);
    invariant(
      configuration.path === expectedConfigurationPaths[index],
      "closure authentication configuration path is invalid"
    );
  }
  invariant(
    Array.isArray(manifest.playwrightPackages) &&
      manifest.playwrightPackages.length === 2,
    "closure must identify the exact Playwright package tree"
  );
  const packageNames = [];
  for (const packageTree of manifest.playwrightPackages) {
    exactKeys(
      packageTree,
      ["name", "root", "entryCount", "treeSha256"],
      "Playwright package tree"
    );
    invariant(
      packageTree.name === "playwright" ||
        packageTree.name === "playwright-core",
      "closure contains an unexpected Playwright package"
    );
    invariant(
      packageTree.root ===
        resolve(expectedApplicationDirectory, "node_modules", packageTree.name),
      "Playwright package root is invalid"
    );
    invariant(
      Number.isInteger(packageTree.entryCount) &&
        packageTree.entryCount > 0 &&
        SHA256_PATTERN.test(packageTree.treeSha256),
      "Playwright package inventory is invalid"
    );
    packageNames.push(packageTree.name);
  }
  invariant(
    packageNames.sort().join(",") === "playwright,playwright-core",
    "Playwright package inventory is incomplete"
  );
  exactKeys(
    manifest.applicationInventory,
    ["entryCount", "treeSha256", "entries"],
    "application inventory"
  );
  invariant(
    Array.isArray(manifest.applicationInventory.entries) &&
      Number.isInteger(manifest.applicationInventory.entryCount) &&
      manifest.applicationInventory.entryCount ===
        manifest.applicationInventory.entries.length &&
      SHA256_PATTERN.test(manifest.applicationInventory.treeSha256),
    "application inventory is invalid"
  );
  invariant(
    JSON.stringify(manifest.environment) ===
      JSON.stringify({
        allowlist: AUTHENTICATION_FIXED_ENVIRONMENT,
        nodeOptions: "CLEARED",
        nodePath: "CLEARED",
      }),
    "authentication child environment is not fixed"
  );
  invariant(
    manifest.credentialTransport === "PRIVATE_STDIN_PIPE_ONLY",
    "credential transport must remain a private standard-input pipe"
  );
  invariant(
    manifest.authorization === "INDEPENDENT_ADMIN_PROVISIONED",
    "closure manifest lacks independent administrator authorization"
  );
  return manifest;
}

export function createAuthenticationClosureEnvelope(
  manifest,
  privateKey,
  publicKeyInput,
  options = {}
) {
  validateAuthenticationClosureManifest(manifest, options);
  const publicKey = asPublicKey(publicKeyInput);
  return {
    schemaVersion: 1,
    kind: "dime-authentication-closure-envelope",
    algorithm: "Ed25519",
    keyId: publicKeyId(publicKey),
    manifest,
    signature: signPayload(
      null,
      canonicalPayload(manifest),
      privateKey
    ).toString("base64"),
  };
}

export const createAuthenticationClosureEnvelopeForTest =
  createAuthenticationClosureEnvelope;

export function verifyAuthenticationClosureEnvelope(
  envelope,
  publicKeyInput,
  options = {}
) {
  exactKeys(
    envelope,
    ["schemaVersion", "kind", "algorithm", "keyId", "manifest", "signature"],
    "authentication closure envelope"
  );
  invariant(
    envelope.schemaVersion === 1 &&
      envelope.kind === "dime-authentication-closure-envelope" &&
      envelope.algorithm === "Ed25519",
    "authentication closure envelope is invalid"
  );
  const publicKey = asPublicKey(publicKeyInput);
  invariant(
    envelope.keyId === publicKeyId(publicKey),
    "authentication closure signing key identity mismatch"
  );
  const signature = Buffer.from(envelope.signature, "base64");
  invariant(
    signature.length === 64 &&
      verifySignature(
        null,
        canonicalPayload(envelope.manifest),
        publicKey,
        signature
      ),
    "authentication closure manifest signature is invalid"
  );
  return validateAuthenticationClosureManifest(envelope.manifest, options);
}

async function verifyProtectedTrustFile(
  path,
  { expectedUid, mode, label, enforceProtectedAncestors }
) {
  await requireCanonicalPath(path, label);
  if (enforceProtectedAncestors) {
    await verifyProtectedAncestorChain(path, expectedUid, label);
  }
  const state = await lstat(path);
  invariant(
    state.isFile() &&
      !state.isSymbolicLink() &&
      state.uid === expectedUid &&
      exactMode(state, mode),
    `${label} is not independently protected`
  );
}

async function verifyExternalExecutable(
  identity,
  expectedUid,
  label,
  enforceProtectedAncestors
) {
  await requireCanonicalPath(identity.path, label);
  if (enforceProtectedAncestors) {
    await verifyProtectedAncestorChain(identity.path, expectedUid, label);
  }
  const state = await lstat(identity.path);
  invariant(
    state.isFile() &&
      !state.isSymbolicLink() &&
      state.uid === expectedUid &&
      (state.mode & 0o022) === 0 &&
      (state.mode & 0o111) !== 0,
    `${label} is not a trusted executable`
  );
  invariant(
    (await sha256File(identity.path)) === identity.sha256,
    `${label} does not match the closure manifest`
  );
}

/**
 * Verify the full closure before a broker may retrieve even the first byte of
 * a Railway variable response. Callers may use the returned manifest
 * internally, but must serialize only the sanitized verification fields.
 */
export async function verifyAuthenticationClosure({
  trustDirectoryPath = AUTHENTICATION_TRUST_DIRECTORY,
  manifestPath = AUTHENTICATION_CLOSURE_MANIFEST,
  publicKeyPath = AUTHENTICATION_CLOSURE_PUBLIC_KEY,
  expectedUid = 0,
  directoryMode = 0o555,
  fileMode = 0o444,
  environment = process.env,
  expectedApplicationDirectory = AUTHENTICATION_APPLICATION_DIRECTORY,
  expectedEntrypoint = AUTHENTICATION_ENTRYPOINT,
  enforceProtectedAncestors = expectedUid === 0,
} = {}) {
  invariant(
    !Object.hasOwn(environment, "NODE_PATH") &&
      !Object.hasOwn(environment, "NODE_OPTIONS"),
    "authentication child Node injection variables were not cleared"
  );
  const unexpectedEnvironmentNames = Object.keys(environment).filter(
    name => !AUTHENTICATION_FIXED_ENVIRONMENT.includes(name)
  );
  invariant(
    unexpectedEnvironmentNames.length === 0,
    "authentication child environment is outside the fixed allowlist"
  );
  await requireCanonicalPath(
    trustDirectoryPath,
    "authentication closure trust directory"
  );
  if (enforceProtectedAncestors) {
    await verifyProtectedAncestorChain(
      trustDirectoryPath,
      expectedUid,
      "authentication closure trust directory"
    );
  }
  const trustState = await lstat(trustDirectoryPath);
  invariant(
    trustState.isDirectory() &&
      !trustState.isSymbolicLink() &&
      trustState.uid === expectedUid &&
      exactMode(trustState, 0o755),
    "authentication closure trust directory is not root protected"
  );
  await Promise.all([
    verifyProtectedTrustFile(manifestPath, {
      expectedUid,
      mode: 0o444,
      label: "authentication closure manifest",
      enforceProtectedAncestors,
    }),
    verifyProtectedTrustFile(publicKeyPath, {
      expectedUid,
      mode: 0o444,
      label: "authentication closure public key",
      enforceProtectedAncestors,
    }),
  ]);
  const [envelopeBytes, publicKeyBytes] = await Promise.all([
    readFile(manifestPath),
    readFile(publicKeyPath),
  ]);
  const manifest = verifyAuthenticationClosureEnvelope(
    JSON.parse(envelopeBytes.toString("utf8")),
    publicKeyBytes,
    { expectedApplicationDirectory, expectedEntrypoint }
  );
  if (enforceProtectedAncestors) {
    await verifyProtectedAncestorChain(
      manifest.applicationDirectory,
      expectedUid,
      "authentication application"
    );
  }
  const inventory = await collectAuthenticationTree(
    manifest.applicationDirectory,
    {
      expectedUid,
      directoryMode,
      fileMode,
    }
  );
  invariant(
    inventory.entryCount === manifest.applicationInventory.entryCount &&
      inventory.treeSha256 === manifest.applicationInventory.treeSha256 &&
      JSON.stringify(inventory.entries) ===
        JSON.stringify(manifest.applicationInventory.entries),
    "authentication application inventory does not match the closure manifest"
  );
  await Promise.all([
    verifyExternalExecutable(
      manifest.node,
      expectedUid,
      "closure node",
      enforceProtectedAncestors
    ),
    verifyExternalExecutable(
      manifest.browser,
      expectedUid,
      "closure browser executable",
      enforceProtectedAncestors
    ),
  ]);
  const entrypoint = inventory.entries.find(
    entry =>
      entry.type === "file" &&
      resolve(manifest.applicationDirectory, entry.path) ===
        manifest.entrypoint.path
  );
  invariant(
    entrypoint?.sha256 === manifest.entrypoint.sha256,
    "bundled authentication artifact does not match the closure manifest"
  );
  for (const configuration of manifest.configuration) {
    const entry = inventory.entries.find(
      candidate =>
        candidate.type === "file" &&
        resolve(manifest.applicationDirectory, candidate.path) ===
          configuration.path
    );
    invariant(
      entry?.sha256 === configuration.sha256,
      "authentication configuration does not match the closure manifest"
    );
  }
  for (const packageTree of manifest.playwrightPackages) {
    const entries = subtreeEntries(
      inventory,
      manifest.applicationDirectory,
      packageTree.root
    );
    invariant(
      entries.length === packageTree.entryCount &&
        sha256Bytes(canonicalInventory(entries)) === packageTree.treeSha256,
      `${packageTree.name} package tree does not match the closure manifest`
    );
  }
  return {
    schemaVersion: 1,
    kind: "dime-authentication-closure-verification",
    status: "PASS",
    credentialBytesRead: 0,
    nodePathCleared: true,
    nodeOptionsCleared: true,
    authorization: "NONE",
    manifest,
  };
}

export async function buildAuthenticationClosureManifest({
  applicationDirectory = AUTHENTICATION_APPLICATION_DIRECTORY,
  entrypointPath = AUTHENTICATION_ENTRYPOINT,
  nodePath,
  browserPath,
  configurationPaths,
  expectedUid = 0,
  directoryMode = 0o555,
  fileMode = 0o444,
}) {
  const inventory = await collectAuthenticationTree(applicationDirectory, {
    expectedUid,
    directoryMode,
    fileMode,
  });
  const fileIdentity = path => {
    const entry = inventory.entries.find(
      candidate =>
        candidate.type === "file" &&
        resolve(applicationDirectory, candidate.path) === path
    );
    invariant(entry, `closure inventory is missing ${path}`);
    return { path, sha256: entry.sha256 };
  };
  const packageTree = name => {
    const root = resolve(applicationDirectory, "node_modules", name);
    const entries = subtreeEntries(inventory, applicationDirectory, root);
    invariant(entries.length > 0, `${name} package tree is empty`);
    return {
      name,
      root,
      entryCount: entries.length,
      treeSha256: sha256Bytes(canonicalInventory(entries)),
    };
  };
  return validateAuthenticationClosureManifest(
    {
      schemaVersion: 2,
      kind: "dime-credential-authentication-closure",
      applicationDirectory,
      workingDirectory: applicationDirectory,
      entrypoint: fileIdentity(entrypointPath),
      node: { path: nodePath, sha256: await sha256File(nodePath) },
      browser: { path: browserPath, sha256: await sha256File(browserPath) },
      configuration: configurationPaths.map(fileIdentity),
      playwrightPackages: [
        packageTree("playwright"),
        packageTree("playwright-core"),
      ],
      applicationInventory: inventory,
      environment: {
        allowlist: AUTHENTICATION_FIXED_ENVIRONMENT,
        nodeOptions: "CLEARED",
        nodePath: "CLEARED",
      },
      credentialTransport: "PRIVATE_STDIN_PIPE_ONLY",
      authorization: "INDEPENDENT_ADMIN_PROVISIONED",
    },
    {
      expectedApplicationDirectory: applicationDirectory,
      expectedEntrypoint: entrypointPath,
    }
  );
}
