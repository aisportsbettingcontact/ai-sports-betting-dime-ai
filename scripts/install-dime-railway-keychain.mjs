#!/usr/bin/env node

import { execFile } from "node:child_process";
import { chmod, lstat, mkdir, readdir, rename, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  SECURE_RAILWAY_DIRECTORY,
  SECURE_RAILWAY_EXECUTABLE,
  SECURE_RAILWAY_HOME,
} from "./dime-railway-secure.mjs";

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(import.meta.url);
const sourcePath = resolve(dirname(scriptPath), "dime-railway-keychain.c");
const temporaryExecutable = `${SECURE_RAILWAY_EXECUTABLE}.${process.pid}.tmp`;

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
  try {
    await execFileAsync(
      "/usr/bin/clang",
      [
        sourcePath,
        "-framework",
        "Security",
        "-framework",
        "CoreFoundation",
        "-Wall",
        "-Wextra",
        "-Werror",
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
    await execFileAsync(
      "/usr/bin/codesign",
      [
        "--force",
        "--sign",
        "-",
        "--identifier",
        "com.aisportsbettingmodels.dime.railway-keychain",
        temporaryExecutable,
      ],
      {
        timeout: 30_000,
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
      }
    );
    await chmod(temporaryExecutable, 0o500);
    await rename(temporaryExecutable, SECURE_RAILWAY_EXECUTABLE);
  } finally {
    await unlink(temporaryExecutable).catch(error => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
  process.stdout.write(
    JSON.stringify({
      status: "PASS",
      installed: true,
      path: SECURE_RAILWAY_EXECUTABLE,
      mode: "0500",
      isolatedHomeMode: "0700",
      credentialImported: false,
    }) + "\n"
  );
}

main().catch(error => {
  process.stderr.write(`Secure Railway broker installation failed: ${error.message}\n`);
  process.exitCode = 1;
});
