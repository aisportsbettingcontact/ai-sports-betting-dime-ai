import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "vitest";

import { scanActionsSecurity } from "./check-github-actions-security.mjs";

async function fixture(workflowName: string, workflow: string) {
  const root = await mkdtemp(resolve(tmpdir(), "dime-actions-security-"));
  await mkdir(resolve(root, ".github/workflows"), { recursive: true });
  await writeFile(resolve(root, ".github/workflows", workflowName), workflow);
  return root;
}

test("yaml workflow extension cannot bypass action pinning", async () => {
  const root = await fixture(
    "bypass.yaml",
    [
      "name: bypass",
      "on: workflow_dispatch",
      "permissions:",
      "  contents: read",
      "jobs:",
      "  check:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses : actions/checkout@main",
    ].join("\n")
  );
  try {
    const result = await scanActionsSecurity(root, {
      enforceRepositoryContracts: false,
    });
    assert.equal(result.status, "FAIL");
    assert.ok(result.failures.some(failure => /not pinned/.test(failure)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("composite actions cannot bypass action pinning", async () => {
  const root = await fixture(
    "valid.yml",
    [
      "name: valid",
      "on: workflow_dispatch",
      "permissions:",
      "  contents: read",
      "jobs:",
      "  check:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: 'true'",
    ].join("\n")
  );
  await mkdir(resolve(root, ".github/actions/example"), { recursive: true });
  await writeFile(
    resolve(root, ".github/actions/example/action.yaml"),
    [
      "name: example",
      "runs:",
      "  using: composite",
      "  steps:",
      "    - uses: actions/setup-node@v4",
    ].join("\n")
  );
  try {
    const result = await scanActionsSecurity(root, {
      enforceRepositoryContracts: false,
    });
    assert.equal(result.status, "FAIL");
    assert.ok(
      result.failures.some(failure => /action\.yaml.*not pinned/.test(failure))
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unapproved workflow write permissions are rejected", async () => {
  const root = await fixture(
    "write.yml",
    [
      "name: write",
      "on: workflow_dispatch",
      "permissions:",
      "  contents: write",
      "jobs:",
      "  check:",
      "    permissions:",
      "      issues: write",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: 'true'",
    ].join("\n")
  );
  try {
    const result = await scanActionsSecurity(root, {
      enforceRepositoryContracts: false,
    });
    assert.equal(result.status, "FAIL");
    assert.ok(
      result.failures.filter(failure =>
        /unapproved write permission/.test(failure)
      ).length >= 2
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("duplicate mapping keys fail the gate (GitHub rejects the file silently)", async () => {
  const root = await fixture(
    "dup.yml",
    [
      "name: dup",
      "on: workflow_dispatch",
      "permissions:",
      "  contents: read",
      "jobs:",
      "  check:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      '      - name: "step"',
      "        env:",
      "          A: one",
      "        env:",
      "          B: two",
      "        run: |",
      "          echo ok",
      "          env: not-a-key-inside-block-scalar",
    ].join("\n")
  );
  try {
    const result = await scanActionsSecurity(root, {
      enforceRepositoryContracts: false,
    });
    assert.equal(result.status, "FAIL");
    assert.ok(
      result.failures.some(failure =>
        /duplicate mapping key 'env'/.test(failure)
      )
    );
    assert.equal(
      result.failures.filter(f => /duplicate/.test(f)).length,
      1,
      "block-scalar body must not be scanned for keys"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repeated step names across list items are separate scopes (no false positive)", async () => {
  const root = await fixture(
    "ok.yml",
    [
      "name: ok",
      "on: workflow_dispatch",
      "permissions:",
      "  contents: read",
      "jobs:",
      "  check:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      '      - name: "one"',
      "        env:",
      "          A: x",
      "        run: echo 1",
      '      - name: "two"',
      "        env:",
      "          A: y",
      "        run: echo 2",
    ].join("\n")
  );
  try {
    const result = await scanActionsSecurity(root, {
      enforceRepositoryContracts: false,
    });
    assert.ok(
      !result.failures.some(f => /duplicate/.test(f)),
      `unexpected: ${result.failures.join("; ")}`
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
