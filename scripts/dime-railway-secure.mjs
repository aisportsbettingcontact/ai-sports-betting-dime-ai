import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { lstat } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

export function hasExactMode(state, expectedMode) {
  return (state.mode & 0o7777) === expectedMode;
}

export async function verifySecureRailwayBroker() {
  const [directory, executable, isolatedHome] = await Promise.all([
    lstat(SECURE_RAILWAY_DIRECTORY),
    lstat(SECURE_RAILWAY_EXECUTABLE),
    lstat(SECURE_RAILWAY_HOME),
  ]);
  invariant(directory.isDirectory(), "secure Railway directory is invalid");
  invariant(!directory.isSymbolicLink(), "secure Railway directory is a symlink");
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
  await execFileAsync(
    "/usr/bin/codesign",
    ["--verify", "--strict", SECURE_RAILWAY_EXECUTABLE],
    {
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 64 * 1024,
      windowsHide: true,
      env: {},
    }
  ).catch(() => {
    throw new Error("secure Railway broker signature verification failed");
  });
  const { stdout } = await execFileAsync(
    SECURE_RAILWAY_EXECUTABLE,
    ["status"],
    {
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 64 * 1024,
      windowsHide: true,
      env: Object.fromEntries(
        ["HOME", "PATH", "TMPDIR", "USER", "LOGNAME", "LANG", "LC_ALL"]
          .filter(name => process.env[name] !== undefined)
          .map(name => [name, process.env[name]])
      ),
    }
  );
  const status = JSON.parse(stdout);
  invariant(
    status.status === "PASS" &&
      status.storage === "macos-keychain" &&
      status.credentialAvailable === true &&
      status.credentialPrinted === false,
    "secure Railway broker status is invalid"
  );
  return {
    status: "PASS",
    storage: "macos-keychain",
    credentialAvailable: true,
    credentialPrinted: false,
  };
}
