#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  chmod,
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
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AUTHENTICATION_APPLICATION_DIRECTORY,
  AUTHENTICATION_ENTRYPOINT,
  collectAuthenticationTree,
} from "./lib/dime-authentication-closure.mjs";
import {
  resolveTrustedExecutable,
  verifyAbsoluteExecutable,
} from "./lib/dime-trusted-executables.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(scriptPath), "..");
const require = createRequire(import.meta.url);

export const AUTHENTICATION_CANDIDATE_DIRECTORY = resolve(
  repositoryRoot,
  ".cache/dime-authentication-closure/v2.candidate"
);
export const AUTHENTICATION_CANDIDATE_DESCRIPTOR = resolve(
  repositoryRoot,
  ".cache/dime-authentication-closure/v2.provenance-candidate.json"
);

const DEFAULT_BROWSER_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
];

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function hardenCandidateTree(path) {
  const state = await lstat(path);
  invariant(!state.isSymbolicLink(), `candidate contains a symlink: ${path}`);
  if (state.isDirectory()) {
    await chmod(path, 0o500);
    const names = (await readdir(path)).sort();
    for (const name of names) {
      await hardenCandidateTree(resolve(path, name));
    }
    return;
  }
  invariant(state.isFile(), `candidate contains a special file: ${path}`);
  await chmod(path, 0o400);
}

async function resolvePackageRoot(name, packageRequire = require) {
  const packageJson = await realpath(
    packageRequire.resolve(`${name}/package.json`)
  );
  return dirname(packageJson);
}

async function copyPackageTree(name, sourceRoot, destinationRoot) {
  const destination = resolve(destinationRoot, "node_modules", name);
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  await cp(sourceRoot, destination, {
    recursive: true,
    dereference: true,
    preserveTimestamps: false,
  });
  return { name, sourceRoot, destination };
}

async function selectBrowser(
  candidatePaths,
  allowedRoots = ["/Applications", "/System/Applications"]
) {
  const failures = [];
  for (const path of candidatePaths) {
    try {
      return await verifyAbsoluteExecutable(path, {
        label: "production authentication browser",
        allowedRoots,
      });
    } catch (error) {
      failures.push(error?.message ?? String(error));
    }
  }
  throw new Error(
    `production authentication browser is unavailable: ${failures.join("; ")}`
  );
}

export async function resolveCredentialExecutableClosure() {
  const [node, env, git, gh, aws, op] = await Promise.all([
    resolveTrustedExecutable("node", { skipIndependentTrust: true }),
    resolveTrustedExecutable("env", { skipIndependentTrust: true }),
    resolveTrustedExecutable("git", { skipIndependentTrust: true }),
    resolveTrustedExecutable("gh", { skipIndependentTrust: true }),
    resolveTrustedExecutable("aws", { skipIndependentTrust: true }),
    resolveTrustedExecutable("op"),
  ]);
  return { node, env, git, gh, aws, op };
}

function finalPathForCandidate(candidateDirectory, candidatePath) {
  const relativePath = candidatePath.slice(candidateDirectory.length + 1);
  invariant(
    relativePath.length > 0 && !relativePath.startsWith(".."),
    "candidate path is outside the candidate directory"
  );
  return resolve(AUTHENTICATION_APPLICATION_DIRECTORY, relativePath);
}

export async function buildAuthenticationClosureCandidate({
  candidateDirectory = AUTHENTICATION_CANDIDATE_DIRECTORY,
  descriptorPath = AUTHENTICATION_CANDIDATE_DESCRIPTOR,
  browserCandidatePaths = DEFAULT_BROWSER_CANDIDATES,
  browserAllowedRoots = ["/Applications", "/System/Applications"],
  nodeExecutablePath = process.execPath,
  nodeAllowedRoots = null,
  credentialExecutables = null,
} = {}) {
  const temporaryDirectory = `${candidateDirectory}.${process.pid}.tmp`;
  await rm(temporaryDirectory, { recursive: true, force: true });
  await mkdir(resolve(temporaryDirectory, "scripts"), {
    recursive: true,
    mode: 0o700,
  });
  await mkdir(resolve(temporaryDirectory, "config"), {
    recursive: true,
    mode: 0o700,
  });
  try {
    const [{ build }, node, browser] = await Promise.all([
      import("esbuild"),
      verifyAbsoluteExecutable(nodeExecutablePath, {
        label: "node",
        ...(nodeAllowedRoots === null
          ? {}
          : { allowedRoots: nodeAllowedRoots }),
      }),
      selectBrowser(browserCandidatePaths, browserAllowedRoots),
    ]);
    const outputPath = resolve(
      temporaryDirectory,
      "scripts/dime-production-auth.bundle.mjs"
    );
    const buildResult = await build({
      absWorkingDir: repositoryRoot,
      entryPoints: ["scripts/dime-production-auth.mjs"],
      outfile: outputPath,
      bundle: true,
      platform: "node",
      format: "esm",
      target: ["node20"],
      external: ["playwright"],
      sourcemap: false,
      sourcesContent: false,
      legalComments: "none",
      charset: "utf8",
      treeShaking: true,
      metafile: true,
      logLevel: "silent",
    });
    const runtimeImports = Object.values(buildResult.metafile.outputs)
      .flatMap(output => output.imports)
      .filter(entry => entry.external)
      .map(entry => entry.path)
      .sort();
    const externalImports = runtimeImports.filter(
      path => !path.startsWith("node:")
    );
    invariant(
      JSON.stringify(externalImports) === JSON.stringify(["playwright"]),
      `authentication bundle has an unexpected external import: ${externalImports.join(", ")}`
    );

    const accessConfiguration = resolve(
      temporaryDirectory,
      "config/dime-agent-access.v1.json"
    );
    const platformConfiguration = resolve(
      temporaryDirectory,
      "ml/dime-1.0/configs/platform_contract.json"
    );
    await mkdir(dirname(platformConfiguration), {
      recursive: true,
      mode: 0o700,
    });
    const playwrightSourceRoot = await resolvePackageRoot("playwright");
    const playwrightRequire = createRequire(
      resolve(playwrightSourceRoot, "package.json")
    );
    const playwrightCoreSourceRoot = await resolvePackageRoot(
      "playwright-core",
      playwrightRequire
    );
    await cp(
      resolve(repositoryRoot, "config/dime-agent-access.v1.json"),
      accessConfiguration
    );
    await cp(
      resolve(repositoryRoot, "ml/dime-1.0/configs/platform_contract.json"),
      platformConfiguration
    );
    await copyPackageTree(
      "playwright",
      playwrightSourceRoot,
      temporaryDirectory
    );
    await copyPackageTree(
      "playwright-core",
      playwrightCoreSourceRoot,
      temporaryDirectory
    );
    await hardenCandidateTree(temporaryDirectory);
    const inventory = await collectAuthenticationTree(temporaryDirectory, {
      expectedUid: process.getuid(),
      directoryMode: 0o500,
      fileMode: 0o400,
    });
    const entrypointCandidate = resolve(
      temporaryDirectory,
      "scripts/dime-production-auth.bundle.mjs"
    );
    const candidate = {
      schemaVersion: 1,
      kind: "dime-authentication-closure-provenance-candidate",
      trusted: false,
      deterministicBundle: {
        path: finalPathForCandidate(temporaryDirectory, entrypointCandidate),
        requiredPath: AUTHENTICATION_ENTRYPOINT,
        sha256: sha256(await readFile(entrypointCandidate)),
        localModulesBundled: true,
        externalImports,
        nodeBuiltinImports: runtimeImports.filter(path =>
          path.startsWith("node:")
        ),
      },
      application: {
        candidatePath: candidateDirectory,
        requiredPath: AUTHENTICATION_APPLICATION_DIRECTORY,
        candidateInventory: inventory,
        requiredDirectoryMode: "0555",
        requiredFileMode: "0444",
        requiredOwner: "root",
      },
      executables: {
        node,
        browser,
      },
      credentialExecutables,
      configuration: [
        finalPathForCandidate(temporaryDirectory, accessConfiguration),
        finalPathForCandidate(temporaryDirectory, platformConfiguration),
      ],
      packageTrees: ["playwright", "playwright-core"],
      environment: {
        nodePath: "CLEARED",
        nodeOptions: "CLEARED",
        inheritedEnvironmentAllowed: false,
      },
      credentialTransport: "PRIVATE_STDIN_PIPE_ONLY",
      credentialExecution: "BLOCKED_PENDING_INDEPENDENT_ADMIN_PROVENANCE",
    };
    await chmod(temporaryDirectory, 0o700);
    await rm(candidateDirectory, { recursive: true, force: true });
    await rename(temporaryDirectory, candidateDirectory);
    await mkdir(dirname(descriptorPath), { recursive: true, mode: 0o700 });
    await writeFile(descriptorPath, `${JSON.stringify(candidate, null, 2)}\n`, {
      mode: 0o400,
    });
    await chmod(descriptorPath, 0o400);
    return candidate;
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

async function main() {
  const credentialExecutables = await resolveCredentialExecutableClosure();
  const candidate = await buildAuthenticationClosureCandidate({
    credentialExecutables,
  });
  process.stdout.write(
    `${JSON.stringify({
      status: "BLOCKED",
      candidateBuilt: true,
      trusted: candidate.trusted,
      applicationCandidate: candidate.application.candidatePath,
      descriptor: AUTHENTICATION_CANDIDATE_DESCRIPTOR,
      credentialExecution: candidate.credentialExecution,
      credentialsRead: false,
    })}\n`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  main().catch(error => {
    process.stderr.write(
      `Dime authentication closure candidate failed: ${error.message}\n`
    );
    process.exitCode = 1;
  });
}
