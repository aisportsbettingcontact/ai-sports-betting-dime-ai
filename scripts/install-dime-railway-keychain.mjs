#!/usr/bin/env node

import { execFile } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  SECURE_RAILWAY_DIRECTORY,
  SECURE_RAILWAY_EXECUTABLE,
  SECURE_RAILWAY_HOME,
  SECURE_RAILWAY_PROVENANCE,
} from "./dime-railway-secure.mjs";
import {
  AUTHENTICATION_CLOSURE_MANIFEST,
  AUTHENTICATION_CLOSURE_PUBLIC_KEY,
  AUTHENTICATION_APPLICATION_DIRECTORY,
  AUTHENTICATION_ENTRYPOINT,
} from "./lib/dime-authentication-closure.mjs";
import { verifyAbsoluteExecutable } from "./lib/dime-trusted-executables.mjs";
import {
  AUTHENTICATION_CANDIDATE_DESCRIPTOR,
  buildAuthenticationClosureCandidate,
} from "./build-dime-authentication-closure.mjs";

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(import.meta.url);
const sourcePath = resolve(dirname(scriptPath), "dime-railway-keychain.c");
const candidateExecutable = resolve(
  SECURE_RAILWAY_DIRECTORY,
  "dime-railway-keychain.candidate"
);
const temporaryExecutable = `${candidateExecutable}.${process.pid}.tmp`;
const candidateProvenancePath = resolve(
  SECURE_RAILWAY_DIRECTORY,
  "dime-railway-keychain.provenance-candidate.json"
);

async function sha256File(path) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

function compilerString(name, value) {
  if (value.includes('"') || value.includes("\\") || value.includes("\0")) {
    throw new Error(
      `${name} contains characters unsafe for a compiler literal`
    );
  }
  return `-D${name}="${value}"`;
}

async function hardenTree(path) {
  const state = await lstat(path);
  if (state.isSymbolicLink()) {
    throw new Error(`refusing symlink in secure Railway home: ${path}`);
  }
  if (state.isDirectory()) {
    await chmod(path, 0o700);
    for (const name of await readdir(path)) {
      await hardenTree(resolve(path, name));
    }
    return;
  }
  if (!state.isFile()) {
    throw new Error(`refusing non-file in secure Railway home: ${path}`);
  }
  await chmod(path, 0o600);
}

async function main() {
  await mkdir(SECURE_RAILWAY_DIRECTORY, { recursive: true, mode: 0o700 });
  await chmod(SECURE_RAILWAY_DIRECTORY, 0o700);
  await mkdir(SECURE_RAILWAY_HOME, { recursive: true, mode: 0o700 });
  await hardenTree(SECURE_RAILWAY_HOME);
  const authenticationCandidate = await buildAuthenticationClosureCandidate();
  const [node, railway, sourceSha256, productionAuthSha256] = await Promise.all(
    [
      verifyAbsoluteExecutable(process.execPath, { label: "node" }),
      verifyAbsoluteExecutable("/opt/homebrew/bin/railway", {
        label: "railway",
        allowedRoots: ["/opt/homebrew"],
      }),
      sha256File(sourcePath),
      Promise.resolve(authenticationCandidate.deterministicBundle.sha256),
    ]
  );
  try {
    await execFileAsync(
      "/usr/bin/clang",
      [
        sourcePath,
        compilerString("DIME_NODE_EXECUTABLE", node.path),
        compilerString("DIME_NODE_SHA256", node.sha256),
        compilerString("DIME_RAILWAY_EXECUTABLE", railway.path),
        compilerString("DIME_RAILWAY_SHA256", railway.sha256),
        compilerString(
          "DIME_AUTH_APPLICATION_DIRECTORY",
          AUTHENTICATION_APPLICATION_DIRECTORY
        ),
        compilerString(
          "DIME_PRODUCTION_AUTH_SCRIPT",
          AUTHENTICATION_ENTRYPOINT
        ),
        compilerString("DIME_PRODUCTION_AUTH_SHA256", productionAuthSha256),
        compilerString(
          "DIME_AUTH_CLOSURE_MANIFEST",
          AUTHENTICATION_CLOSURE_MANIFEST
        ),
        compilerString(
          "DIME_AUTH_CLOSURE_PUBLIC_KEY",
          AUTHENTICATION_CLOSURE_PUBLIC_KEY
        ),
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
        temporaryExecutable,
      ],
      {
        timeout: 120_000,
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
      }
    );
    await chmod(temporaryExecutable, 0o500);
    await rename(temporaryExecutable, candidateExecutable);
    const brokerSha256 = await sha256File(candidateExecutable);
    await writeFile(
      candidateProvenancePath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          kind: "dime-railway-broker-provenance-candidate",
          trusted: false,
          credentialExecutionStatus:
            "BLOCKED_PENDING_INDEPENDENT_ADMIN_PROVENANCE",
          broker: {
            candidatePath: candidateExecutable,
            approvedPath: SECURE_RAILWAY_EXECUTABLE,
            sha256: brokerSha256,
            sourceSha256,
          },
          executables: {
            node: { path: node.path, sha256: node.sha256 },
            railway: { path: railway.path, sha256: railway.sha256 },
          },
          authenticationChild: {
            path: AUTHENTICATION_ENTRYPOINT,
            sha256: productionAuthSha256,
            applicationDirectory: AUTHENTICATION_APPLICATION_DIRECTORY,
            candidateDescriptor: AUTHENTICATION_CANDIDATE_DESCRIPTOR,
            manifest: AUTHENTICATION_CLOSURE_MANIFEST,
            publicKey: AUTHENTICATION_CLOSURE_PUBLIC_KEY,
            manifestSha256Compiled: false,
            publicKeySha256Compiled: false,
            completeClosureAttested: false,
          },
          requiredImmutableProvenancePath: SECURE_RAILWAY_PROVENANCE,
        },
        null,
        2
      )}\n`,
      { mode: 0o400 }
    );
    await chmod(candidateProvenancePath, 0o400);
  } finally {
    await unlink(temporaryExecutable).catch(error => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
  process.stdout.write(
    JSON.stringify({
      status: "BLOCKED",
      installed: false,
      activeBrokerUnchanged: true,
      candidateBuilt: true,
      candidatePath: candidateExecutable,
      approvedPath: SECURE_RAILWAY_EXECUTABLE,
      mode: "0500",
      isolatedHomeMode: "0700",
      credentialImported: false,
      credentialExecution: "BLOCKED_PENDING_INDEPENDENT_ADMIN_PROVENANCE",
      provenanceCandidate: candidateProvenancePath,
      authenticationClosureCandidate: AUTHENTICATION_CANDIDATE_DESCRIPTOR,
      requiredImmutableProvenance: SECURE_RAILWAY_PROVENANCE,
      adHocSignatureAccepted: false,
    }) + "\n"
  );
}

main().catch(error => {
  process.stderr.write(
    `Secure Railway broker installation failed: ${error.message}\n`
  );
  process.exitCode = 1;
});
