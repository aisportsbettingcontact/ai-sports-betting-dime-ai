#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SHA_PIN = /^[0-9a-f]{40}$/;
const DOCKER_DIGEST_PIN = /@sha256:[0-9a-f]{64}$/;
const WRITE_EXCEPTION = "auto-merge-dependabot.yml";
// Per-workflow approved WRITE scopes (verification framework, 2026-08-05).
// Fail-closed: any write not listed here for its exact workflow filename is
// rejected. Justifications:
//   security-events — SARIF upload to the code-scanning tab (CodeQL action)
//   id-token        — OIDC for scorecard publish / artifact attestation
//   attestations    — actions/attest-build-provenance (SLSA provenance)
//   packages        — push the verification image digest to GHCR (11 only)
const WRITE_APPROVALS = new Map([
  ["auto-merge-dependabot.yml", new Set(["contents", "pull-requests"])],
  ["02-codeql.yml", new Set(["security-events"])],
  ["05-workflow-security.yml", new Set(["security-events"])],
  ["09-artifact-build-and-smoke.yml", new Set(["security-events"])],
  [
    "11-artifact-attestation.yml",
    new Set(["id-token", "attestations", "packages"]),
  ],
  ["12-nightly-verification.yml", new Set(["security-events", "id-token"])],
]);
const PERMISSION_SCOPES = new Set([
  "actions",
  "attestations",
  "checks",
  "contents",
  "deployments",
  "discussions",
  "id-token",
  "issues",
  "models",
  "packages",
  "pages",
  "pull-requests",
  "security-events",
  "statuses",
]);

async function filesBelow(directory, predicate) {
  const found = [];
  async function visit(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && predicate(entry.name)) found.push(path);
    }
  }
  await visit(directory);
  return found.sort();
}

function permissionBlocks(source) {
  const lines = source.split(/\r?\n/);
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s*)permissions:\s*(.*?)\s*$/);
    if (!match) continue;
    const indent = match[1].length;
    const inline = match[2];
    const values = [];
    if (inline) {
      values.push({ scope: "<inline>", access: inline, line: index + 1 });
    } else {
      for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
        const line = lines[cursor];
        if (/^\s*(?:#.*)?$/.test(line)) continue;
        const child = line.match(/^(\s+)([a-z-]+):\s*([^#\s]+).*$/i);
        if (!child || child[1].length <= indent) break;
        values.push({
          scope: child[2],
          access: child[3],
          line: cursor + 1,
        });
      }
    }
    blocks.push({ indent, line: index + 1, values });
  }
  return blocks;
}

function inspectPermissions(name, source, failures) {
  const blocks = permissionBlocks(source);
  const top = blocks.filter(block => block.indent === 0);
  if (top.length !== 1) {
    failures.push(
      `${name}: workflow must define exactly one explicit top-level permissions map`
    );
    return;
  }
  const allowedWrites = WRITE_APPROVALS.get(name) ?? new Set();
  for (const block of blocks) {
    for (const value of block.values) {
      const normalized = String(value.access).toLowerCase();
      if (
        value.scope === "<inline>" ||
        normalized === "write-all" ||
        normalized === "read-all"
      ) {
        failures.push(
          `${name}:${value.line}: permissions must use an explicit least-privilege map`
        );
        continue;
      }
      if (!PERMISSION_SCOPES.has(value.scope)) {
        failures.push(
          `${name}:${value.line}: permission scope is outside the closed allowlist`
        );
        continue;
      }
      if (
        normalized === "write" &&
        // approved writes may live at job level (least privilege); the
        // dependabot exception keeps its stricter top-level exact-match below
        !allowedWrites.has(value.scope)
      ) {
        failures.push(
          `${name}:${value.line}: unapproved write permission ${value.scope}`
        );
      }
      if (!["read", "write", "none"].includes(normalized)) {
        failures.push(
          `${name}:${value.line}: invalid or dynamic permission value`
        );
      }
    }
  }
  if (name === WRITE_EXCEPTION) {
    const writes = new Set(
      top[0].values
        .filter(value => value.access.toLowerCase() === "write")
        .map(value => value.scope)
    );
    if (
      writes.size !== allowedWrites.size ||
      [...allowedWrites].some(scope => !writes.has(scope))
    ) {
      failures.push(
        `${name}: write exception must remain exactly contents and pull-requests`
      );
    }
  }
}

function inspectActionReferences(name, source, failures) {
  let count = 0;
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    const match = line.match(/^\s*(?:-\s*)?uses\s*:\s*([^#\s]+)(?:\s+#.*)?$/);
    if (!match) continue;
    count += 1;
    const reference = match[1];
    if (reference.startsWith("./")) {
      continue;
    }
    if (reference.startsWith("docker://")) {
      if (!DOCKER_DIGEST_PIN.test(reference)) {
        failures.push(
          `${name}:${index + 1}: Docker action is not pinned to a digest`
        );
      }
      continue;
    }
    const at = reference.lastIndexOf("@");
    if (at < 1 || !SHA_PIN.test(reference.slice(at + 1))) {
      failures.push(`${name}:${index + 1}: action is not pinned to a commit`);
    }
  }
  return count;
}

// Duplicate mapping keys make GitHub reject the whole workflow file at push
// time — the workflow silently dies and every push logs a phantom failure run
// (2026-08-05: three hardened workflows shipped duplicate `env:` blocks;
// zizmor and this checker both parsed leniently and missed it). This is a
// dependency-free block-scope scanner for the plain block-style YAML that
// workflows use: it tracks a stack of (indent, seen-keys) mapping scopes,
// treats `- ` list items as fresh scopes, and skips block-scalar bodies
// (`run: |` / `>` content must not be scanned).
function inspectDuplicateKeys(name, source, failures) {
  const stack = []; // { indent, keys:Set }
  let blockScalarIndent = null; // inside `key: |` body while line indent > this
  const lines = source.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index];
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
    const indentMatch = raw.match(/^(\s*)/);
    let indent = indentMatch[1].length;
    if (blockScalarIndent !== null) {
      if (indent > blockScalarIndent) continue; // still inside the scalar body
      blockScalarIndent = null;
    }
    let rest = raw.slice(indent);
    // Each `- ` opens a nested scope for the list item's own mapping.
    while (rest.startsWith("- ")) {
      indent += 2;
      rest = rest.slice(2);
      while (stack.length && stack[stack.length - 1].indent >= indent) {
        stack.pop();
      }
      stack.push({ indent, keys: new Set() });
    }
    const key = rest.match(/^([A-Za-z_][\w.-]*):(\s|$)/);
    if (!key) continue;
    while (stack.length && stack[stack.length - 1].indent > indent) {
      stack.pop();
    }
    let scope = stack[stack.length - 1];
    if (!scope || scope.indent < indent) {
      scope = { indent, keys: new Set() };
      stack.push(scope);
    }
    if (scope.keys.has(key[1])) {
      failures.push(
        `${name}:${index + 1}: duplicate mapping key '${key[1]}' — GitHub rejects the workflow file and it silently stops running`
      );
    }
    scope.keys.add(key[1]);
    if (/:\s*[|>][+-]?\s*(#.*)?$/.test(rest)) {
      blockScalarIndent = indent;
    }
  }
}

export async function scanActionsSecurity(
  repositoryRoot,
  { enforceRepositoryContracts = true } = {}
) {
  const workflowsDirectory = resolve(repositoryRoot, ".github/workflows");
  const workflowPaths = await filesBelow(
    workflowsDirectory,
    name => name.endsWith(".yml") || name.endsWith(".yaml")
  );
  const compositePaths = await filesBelow(
    resolve(repositoryRoot, ".github/actions"),
    name => name === "action.yml" || name === "action.yaml"
  );
  const failures = [];
  let actionReferences = 0;
  let productionSecretReferences = 0;

  for (const path of workflowPaths) {
    const name = relative(workflowsDirectory, path);
    const source = await readFile(path, "utf8");
    inspectDuplicateKeys(name, source, failures);
    inspectPermissions(name, source, failures);
    actionReferences += inspectActionReferences(name, source, failures);
    const jobBlocks = source.split(/(?=^  [A-Za-z0-9_-]+:\s*$)/gm);
    for (const block of jobBlocks) {
      const secretNames = [...block.matchAll(/secrets\.([A-Z0-9_]+)/g)]
        .map(match => match[1])
        .filter(secretName => secretName !== "GITHUB_TOKEN");
      if (secretNames.length === 0) continue;
      productionSecretReferences += secretNames.length;
      if (!/^    environment:\s*Production\s*$/m.test(block)) {
        failures.push(
          `${name}: production secret is outside the protected Production environment`
        );
      }
      for (const line of block.split(/\r?\n/)) {
        if (
          /secrets\.[A-Z0-9_]+/.test(line) &&
          !/secrets\.GITHUB_TOKEN/.test(line) &&
          !/^\s{10,}[A-Z0-9_]+:\s*\$\{\{[^}]*secrets\.[A-Z0-9_]+[^}]*\}\}/.test(
            line
          )
        ) {
          failures.push(
            `${name}: production secret is not scoped to an individual step`
          );
        }
      }
    }
    if (
      basename(name) === "ci.yml" &&
      /secrets\.(?!GITHUB_TOKEN\b)[A-Z0-9_]+/.test(source)
    ) {
      failures.push("ci.yml: pull-request CI must remain secretless");
    }
    if (/RAILWAY_API_TOKEN/.test(source)) {
      failures.push(`${name}: Railway control-plane tokens are forbidden`);
    }
    if (/gh\s+pr\s+review[\s\S]{0,160}--approve/.test(source)) {
      failures.push(`${name}: workflows may not self-approve pull requests`);
    }
  }

  for (const path of compositePaths) {
    const name = relative(repositoryRoot, path);
    const source = await readFile(path, "utf8");
    actionReferences += inspectActionReferences(name, source, failures);
    if (/secrets\.[A-Z0-9_]+/.test(source)) {
      failures.push(`${name}: composite actions must not reference secrets`);
    }
  }

  if (enforceRepositoryContracts) {
    const railwayHealth = await readFile(
      resolve(workflowsDirectory, "railway-p0-control.yml"),
      "utf8"
    );
    for (const forbidden of [
      "railway deploy",
      "railway redeploy",
      "railway run",
      "railway variable",
      "railway shell",
      "secrets.",
    ]) {
      if (railwayHealth.toLowerCase().includes(forbidden)) {
        failures.push(
          `railway-p0-control.yml: forbidden capability present: ${forbidden}`
        );
      }
    }
    const codeowners = await readFile(
      resolve(repositoryRoot, ".github/CODEOWNERS"),
      "utf8"
    );
    if (
      !/^\/\.github\/\s+@prez-ai-sports-betting\s+@aisportsbettingcontact\s*$/m.test(
        codeowners
      )
    ) {
      failures.push("CODEOWNERS: .github security owners are missing");
    }
  }

  return {
    status: failures.length === 0 ? "PASS" : "FAIL",
    workflowsChecked: workflowPaths.length,
    compositesChecked: compositePaths.length,
    actionReferences,
    productionSecretReferences,
    failures,
  };
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === modulePath) {
  const root = resolve(dirname(modulePath), "..");
  const result = await scanActionsSecurity(root);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.failures.length > 0) process.exitCode = 1;
}
