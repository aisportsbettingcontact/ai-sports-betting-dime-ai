import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

export const SECURE_RAILWAY_DIRECTORY = resolve(
  homedir(),
  "Library/Application Support/DimeAI/bin"
);
export const SECURE_RAILWAY_EXECUTABLE = resolve(
  SECURE_RAILWAY_DIRECTORY,
  "dime-railway-keychain"
);
export const SECURE_RAILWAY_HOME = resolve(
  homedir(),
  "Library/Application Support/DimeAI/railway-home"
);
export const SECURE_RAILWAY_TRUST_DIRECTORY =
  "/Library/Application Support/DimeAI/trust";
export const SECURE_RAILWAY_PROVENANCE = resolve(
  SECURE_RAILWAY_TRUST_DIRECTORY,
  "dime-railway-keychain.sha256"
);

const SHA256_PATTERN = /^[0-9a-f]{64}\n?$/;

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

export function hasExactMode(state, expectedMode) {
  return (state.mode & 0o7777) === expectedMode;
}

export function validateImmutableProvenanceState(
  trustDirectory,
  provenanceFile
) {
  invariant(
    trustDirectory.isDirectory() && !trustDirectory.isSymbolicLink(),
    "Railway provenance trust directory is invalid"
  );
  invariant(
    trustDirectory.uid === 0 && hasExactMode(trustDirectory, 0o755),
    "Railway provenance trust directory must be root-owned mode 0755"
  );
  invariant(
    provenanceFile.isFile() && !provenanceFile.isSymbolicLink(),
    "Railway provenance file is invalid"
  );
  invariant(
    provenanceFile.uid === 0 && hasExactMode(provenanceFile, 0o444),
    "Railway provenance file must be root-owned mode 0444"
  );
  return true;
}

export function brokerMatchesImmutableProvenance(expectedSha256, actualSha256) {
  return (
    SHA256_PATTERN.test(expectedSha256) &&
    expectedSha256.trim() === actualSha256
  );
}

async function sha256File(path) {
  const digest = createHash("sha256");
  await new Promise((resolvePromise, rejectPromise) => {
    const stream = createReadStream(path);
    stream.on("data", chunk => digest.update(chunk));
    stream.once("error", rejectPromise);
    stream.once("end", resolvePromise);
  });
  return digest.digest("hex");
}

export async function verifyBrokerProvenance({
  executablePath = SECURE_RAILWAY_EXECUTABLE,
  trustDirectoryPath = SECURE_RAILWAY_TRUST_DIRECTORY,
  provenancePath = SECURE_RAILWAY_PROVENANCE,
} = {}) {
  const [trustDirectory, provenanceFile, expectedBytes] = await Promise.all([
    lstat(trustDirectoryPath),
    lstat(provenancePath),
    readFile(provenancePath, "utf8"),
  ]).catch(() => {
    throw new Error(
      "Railway credential execution is blocked: independent immutable provenance is unavailable"
    );
  });
  validateImmutableProvenanceState(trustDirectory, provenanceFile);
  const actualSha256 = await sha256File(executablePath);
  invariant(
    brokerMatchesImmutableProvenance(expectedBytes, actualSha256),
    "Railway broker does not match independent immutable provenance"
  );
  return {
    status: "PASS",
    trustRoot: "root-owned-immutable-sha256",
    brokerSha256: actualSha256,
  };
}

export async function verifySecureRailwayBroker() {
  const [directory, executable, isolatedHome, provenance] = await Promise.all([
    lstat(SECURE_RAILWAY_DIRECTORY),
    lstat(SECURE_RAILWAY_EXECUTABLE),
    lstat(SECURE_RAILWAY_HOME),
    verifyBrokerProvenance(),
  ]);
  invariant(directory.isDirectory(), "secure Railway directory is invalid");
  invariant(
    !directory.isSymbolicLink(),
    "secure Railway directory is a symlink"
  );
  invariant(
    hasExactMode(directory, 0o700),
    "secure Railway directory permissions must be 0700"
  );
  invariant(executable.isFile(), "secure Railway broker is not a regular file");
  invariant(!executable.isSymbolicLink(), "secure Railway broker is a symlink");
  invariant(
    hasExactMode(executable, 0o500),
    "secure Railway broker permissions must be 0500"
  );
  invariant(
    directory.uid === process.getuid() && executable.uid === process.getuid(),
    "secure Railway broker ownership mismatch"
  );
  invariant(
    isolatedHome.isDirectory() &&
      !isolatedHome.isSymbolicLink() &&
      isolatedHome.uid === process.getuid() &&
      hasExactMode(isolatedHome, 0o700),
    "secure Railway isolated home must be an owned mode-0700 directory"
  );
  return {
    status: "PASS",
    storage: "macos-keychain",
    credentialAvailable: "NOT_PROBED",
    credentialPrinted: false,
    provenance,
  };
}
