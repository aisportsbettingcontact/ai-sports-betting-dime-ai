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
  ONE_PASSWORD_DESIGNATED_REQUIREMENT,
  resolveTrustedExecutable,
  verifyOnePasswordSigningIdentity,
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

test("valid 1Password signing verification precedes exact designated identity verification", async () => {
  const calls: Array<{ executable: string; args: string[] }> = [];
  const runner = async (executable: string, args: string[]) => {
    calls.push({ executable, args });
    return { stdout: "", stderr: "" };
  };
  assert.equal(
    await verifyOnePasswordSigningIdentity("/reviewed/absolute/op", {
      runner,
      platform: "darwin",
    }),
    "developer-team-id:2BUA8C4S2C"
  );
  assert.deepEqual(calls, [
    {
      executable: "/usr/bin/codesign",
      args: ["--verify", "--strict", "--verbose=4", "/reviewed/absolute/op"],
    },
    {
      executable: "/usr/bin/codesign",
      args: [
        "--verify",
        "--strict",
        "--verbose=4",
        `-R=${ONE_PASSWORD_DESIGNATED_REQUIREMENT}`,
        "/reviewed/absolute/op",
      ],
    },
  ]);
  assert.match(
    ONE_PASSWORD_DESIGNATED_REQUIREMENT,
    /identifier "com\.1password\.op"/
  );
  assert.match(ONE_PASSWORD_DESIGNATED_REQUIREMENT, /2BUA8C4S2C/);
});

test("invalid signature with expected metadata is rejected before identity verification", async () => {
  let calls = 0;
  await assert.rejects(
    verifyOnePasswordSigningIdentity("/reviewed/absolute/op", {
      platform: "darwin",
      runner: async () => {
        calls += 1;
        const error = new Error("verification failed") as Error & {
          stderr: string;
        };
        error.stderr =
          "Identifier=com.1password.op\nTeamIdentifier=2BUA8C4S2C\n";
        throw error;
      },
    }),
    /cryptographic signature verification failed/
  );
  assert.equal(calls, 1);
});

test("failed codesign command output is never accepted as signing evidence", async () => {
  let identityAttempted = false;
  await assert.rejects(
    verifyOnePasswordSigningIdentity("/reviewed/absolute/op", {
      platform: "darwin",
      runner: async (_executable: string, args: string[]) => {
        if (args.some(argument => argument.startsWith("-R="))) {
          identityAttempted = true;
        }
        throw Object.assign(new Error("codesign command failed"), {
          stderr: "Identifier=com.1password.op\nTeamIdentifier=2BUA8C4S2C\n",
        });
      },
    }),
    /cryptographic signature verification failed/
  );
  assert.equal(identityAttempted, false);
});

for (const scenario of ["wrong identifier", "wrong team ID"] as const) {
  test(`${scenario} is rejected by the designated requirement stage`, async () => {
    let calls = 0;
    await assert.rejects(
      verifyOnePasswordSigningIdentity("/reviewed/absolute/op", {
        platform: "darwin",
        runner: async () => {
          calls += 1;
          if (calls === 2) throw new Error(scenario);
          return { stdout: "", stderr: "" };
        },
      }),
      /designated signing identity mismatch/
    );
    assert.equal(calls, 2);
  });
}

test("unsigned 1Password binary is rejected at cryptographic verification", async () => {
  let calls = 0;
  await assert.rejects(
    verifyOnePasswordSigningIdentity("/reviewed/absolute/op", {
      platform: "darwin",
      runner: async () => {
        calls += 1;
        throw new Error("code object is not signed at all");
      },
    }),
    /cryptographic signature verification failed/
  );
  assert.equal(calls, 1);
});
