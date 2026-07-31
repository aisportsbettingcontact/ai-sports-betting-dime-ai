import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";

import { REPOSITORY_ROOT } from "./dime-agent-access.mjs";
import {
  brokerMatchesImmutableProvenance,
  hasExactMode,
  validateImmutableProvenanceState,
} from "./dime-railway-secure.mjs";

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
    assert.equal(source.includes('strcmp(argv[1], "variable")'), false);
    assert.match(source, /capture_railway_variable_map/);
    assert.match(source, /select_role_credentials/);
    assert.match(source, /verify_authentication_closure_before_credentials/);
    for (const forbidden of [
      "redeploy",
      "up",
      "run",
      "shell",
      "delete",
      "connect",
      "link",
    ]) {
      assert.equal(source.includes(`strcmp(argv[1], "${forbidden}")`), false);
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
      "-Wno-deprecated-declarations",
      "-O2",
      "-o",
      executable,
    ]);
    for (const args of [
      ["redeploy", "--yes"],
      ["variable", "set", "DATABASE_URL=forbidden"],
      [
        "variable",
        "list",
        "--project",
        "8dd7341d-702c-48c7-90df-5c19a4f04913",
        "--environment",
        "787f3113-17ab-47d9-9819-1268aeb09b3e",
        "--json",
      ],
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
  const [source, installer, provisioner, packageJson] = await Promise.all([
    readFile(
      resolve(REPOSITORY_ROOT, "scripts/dime-railway-keychain.c"),
      "utf8"
    ),
    readFile(
      resolve(REPOSITORY_ROOT, "scripts/install-dime-railway-keychain.mjs"),
      "utf8"
    ),
    readFile(
      resolve(REPOSITORY_ROOT, "scripts/provision-dime-credential-trust.mjs"),
      "utf8"
    ),
    readFile(resolve(REPOSITORY_ROOT, "package.json"), "utf8"),
  ]);
  assert.equal(source.includes('printf("%s", credential)'), false);
  assert.equal(source.includes("puts((char *)credential)"), false);
  assert.match(source, /kSecAttrAccessibleWhenUnlockedThisDeviceOnly/);
  assert.match(source, /kSecAttrSynchronizable, kCFBooleanFalse/);
  assert.match(source, /command is outside the pinned read-only contract/);
  assert.match(source, /DimeAI\/railway-home/);
  assert.match(source, /getpwuid\(getuid\(\)\)/);
  assert.equal(source.includes("/Users/danielwalker/"), false);
  assert.match(source, /umask\(0077\)/);
  assert.match(source, /capture_railway_variable_map/);
  assert.match(source, /select_role_credentials/);
  assert.match(
    source,
    /verify_authentication_child\(\);\s*verify_authentication_closure_before_credentials\(\);\s*umask\(0077\);\s*size_t raw_length/s
  );
  assert.match(source, /posix_spawn_file_actions_addchdir_np/);
  assert.match(source, /DIME_AUTH_APPLICATION_DIRECTORY/);
  assert.match(source, /DIME_AUTH_CLOSURE_MANIFEST_SHA256/);
  assert.match(source, /DIME_AUTH_CLOSURE_PUBLIC_KEY_SHA256/);
  assert.match(source, /"closure-preflight"/);
  assert.equal(
    /append_environment\([^;]+,\s*"NODE_(?:PATH|OPTIONS)"/s.test(source),
    false
  );
  assert.match(
    source,
    /posix_spawn_file_actions_addopen\(\s*&actions,\s*STDERR_FILENO,\s*"\/dev\/null"/
  );
  assert.equal(source.includes('strcmp(argv[1], "variable")'), false);
  assert.equal(source.includes("dime-railway-credential-filter"), false);
  assert.match(installer, /dime-railway-keychain\.candidate/);
  assert.match(installer, /activeBrokerUnchanged: true/);
  assert.equal(
    installer.includes(
      "await rename(temporaryExecutable, SECURE_RAILWAY_EXECUTABLE)"
    ),
    false
  );
  assert.match(provisioner, /process\.getuid\(\) === 0/);
  assert.match(provisioner, /PROVISION_DIME_CREDENTIAL_TRUST_V2/);
  assert.match(provisioner, /credentialsRead: false/);
  assert.equal(
    Object.keys(JSON.parse(packageJson).scripts).some(name =>
      name.includes("provision")
    ),
    false
  );
});

test("Railway broker verification requires exact non-writable modes", () => {
  assert.equal(hasExactMode({ mode: 0o100500 }, 0o500), true);
  assert.equal(hasExactMode({ mode: 0o100700 }, 0o500), false);
  assert.equal(hasExactMode({ mode: 0o100600 }, 0o500), false);
  assert.equal(hasExactMode({ mode: 0o104500 }, 0o500), false);
  assert.equal(hasExactMode({ mode: 0o40700 }, 0o700), true);
  assert.equal(hasExactMode({ mode: 0o40750 }, 0o700), false);
});

test("Railway credential execution rejects same-user and replacement provenance", () => {
  const rootDirectory = {
    isDirectory: () => true,
    isSymbolicLink: () => false,
    uid: 0,
    mode: 0o40755,
  };
  const rootPin = {
    isFile: () => true,
    isSymbolicLink: () => false,
    uid: 0,
    mode: 0o100444,
  };
  assert.equal(validateImmutableProvenanceState(rootDirectory, rootPin), true);
  assert.throws(
    () =>
      validateImmutableProvenanceState(
        { ...rootDirectory, uid: process.getuid() },
        rootPin
      ),
    /root-owned/
  );
  const approved = "a".repeat(64);
  assert.equal(
    brokerMatchesImmutableProvenance(`${approved}\n`, approved),
    true
  );
  assert.equal(
    brokerMatchesImmutableProvenance(`${approved}\n`, "b".repeat(64)),
    false
  );
});
