import assert from "node:assert/strict";
import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { test } from "vitest";

import {
  FIXED_CHILD_PATH,
  fixedMinimalEnvironment,
  resolveTrustedExecutable,
} from "./lib/dime-trusted-executables.mjs";

test("PATH-shadowed op, gh, and aws executables are never selected or executed", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "dime-executable-trust-"));
  const reviewed = resolve(directory, "reviewed");
  try {
    const shadowedNames = ["op", "gh", "aws", "node"];
    const markers = shadowedNames.map(name =>
      resolve(directory, `${name}-executed`)
    );
    await Promise.all(
      shadowedNames.map((name, index) =>
        writeFile(
          resolve(directory, name),
          `#!/bin/sh\nprintf bad > '${markers[index]}'\n`,
          { mode: 0o500 }
        )
      )
    );
    await writeFile(reviewed, "#!/bin/sh\nexit 0\n", { mode: 0o500 });
    await Promise.all([
      ...shadowedNames.map(name => chmod(resolve(directory, name), 0o500)),
      chmod(reviewed, 0o500),
    ]);
    const originalPath = process.env.PATH;
    process.env.PATH = directory;
    try {
      for (const name of ["op", "gh", "aws"]) {
        const executable = await resolveTrustedExecutable(name, {
          candidatePaths: [reviewed],
          allowedRoots: [directory],
          skipIndependentTrust: true,
        });
        assert.equal(executable.path, await realpath(reviewed));
      }
      const nodeState = await lstat(process.execPath);
      if ((nodeState.mode & 0o022) === 0) {
        const node = await resolveTrustedExecutable("node", {
          allowedRoots: [dirname(process.execPath)],
          skipIndependentTrust: true,
        });
        assert.equal(node.path, process.execPath);
      } else {
        await assert.rejects(
          resolveTrustedExecutable("node", {
            allowedRoots: [dirname(process.execPath)],
            skipIndependentTrust: true,
          }),
          /node must not be group- or world-writable/
        );
      }
    } finally {
      process.env.PATH = originalPath;
    }
    for (const marker of markers) {
      await assert.rejects(readFile(marker), /ENOENT/);
    }
    assert.equal(fixedMinimalEnvironment().PATH, FIXED_CHILD_PATH);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
