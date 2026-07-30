import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";

import { REPOSITORY_ROOT } from "./dime-agent-access.mjs";
import { hasExactMode } from "./dime-railway-secure.mjs";

const execFileAsync = promisify(execFile);

test("Railway Keychain broker rejects mutation and unpinned targets before credential access", async () => {
  if (process.platform !== "darwin") {
    const source = await readFile(
      resolve(REPOSITORY_ROOT, "scripts/dime-railway-keychain.c"),
      "utf8"
    );
    assert.match(source, /is_allowed_read_command\(int argc, char \*\*argv\)/);
    assert.match(source, /strcmp\(argv\[3\], PINNED_PROJECT\) == 0/);
    assert.match(source, /strcmp\(argv\[5\], PINNED_ENVIRONMENT\) == 0/);
    assert.match(source, /is_pinned_service\(argv\[8\]\)/);
    assert.match(
      source,
      /if \(!is_allowed_read_command\(argc, argv\)\)\s+fail_closed/
    );
    for (const forbidden of [
      "redeploy",
      "up",
      "run",
      "shell",
      "delete",
      "connect",
      "link",
    ]) {
      assert.equal(
        source.includes(`strcmp(argv[1], "${forbidden}")`),
        false
      );
    }
    return;
  }
  const directory = await mkdtemp(resolve(tmpdir(), "dime-railway-broker-"));
  const executable = resolve(directory, "broker");
  try {
    await execFileAsync("/usr/bin/clang", [
      resolve(REPOSITORY_ROOT, "scripts/dime-railway-keychain.c"),
      "-framework",
      "Security",
      "-framework",
      "CoreFoundation",
      "-Wall",
      "-Wextra",
      "-Werror",
      "-O2",
      "-o",
      executable,
    ]);
    for (const args of [
      ["redeploy", "--yes"],
      ["variable", "set", "DATABASE_URL=forbidden"],
      [
        "status",
        "--project",
        "00000000-0000-4000-8000-000000000000",
        "--environment",
        "787f3113-17ab-47d9-9819-1268aeb09b3e",
        "--json",
      ],
    ]) {
      await assert.rejects(
        execFileAsync(executable, args),
        /outside the pinned read-only contract/
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Railway Keychain source contains no credential-print path", async () => {
  const source = await readFile(
    resolve(REPOSITORY_ROOT, "scripts/dime-railway-keychain.c"),
    "utf8"
  );
  assert.equal(source.includes('printf("%s", credential)'), false);
  assert.equal(source.includes('puts((char *)credential)'), false);
  assert.match(source, /kSecAttrAccessibleWhenUnlockedThisDeviceOnly/);
  assert.match(source, /kSecAttrSynchronizable, kCFBooleanFalse/);
  assert.match(source, /command is outside the pinned read-only contract/);
  assert.match(source, /DimeAI\/railway-home/);
  assert.match(source, /getpwuid\(getuid\(\)\)/);
  assert.equal(source.includes("/Users/danielwalker/"), false);
  assert.match(source, /umask\(0077\)/);
  assert.equal(source.includes('append_environment(environment, &environment_count, "HOME", getenv("HOME"))'), false);
});

test("Railway broker verification requires exact non-writable modes", () => {
  assert.equal(hasExactMode({ mode: 0o100500 }, 0o500), true);
  assert.equal(hasExactMode({ mode: 0o100700 }, 0o500), false);
  assert.equal(hasExactMode({ mode: 0o100600 }, 0o500), false);
  assert.equal(hasExactMode({ mode: 0o104500 }, 0o500), false);
  assert.equal(hasExactMode({ mode: 0o40700 }, 0o700), true);
  assert.equal(hasExactMode({ mode: 0o40750 }, 0o700), false);
});
