#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workflowsDirectory = resolve(root, ".github/workflows");
const workflowNames = (await readdir(workflowsDirectory))
  .filter(name => name.endsWith(".yml"))
  .sort();
const failures = [];
let actionReferences = 0;
let productionSecretReferences = 0;

for (const name of workflowNames) {
  const source = await readFile(resolve(workflowsDirectory, name), "utf8");
  const lines = source.split(/\r?\n/);
  const jobBlocks = source.split(/(?=^  [A-Za-z0-9_-]+:\s*$)/gm);

  for (const [index, line] of lines.entries()) {
    const match = line.match(/^\s*uses:\s*([^#\s]+)(?:\s+#.*)?$/);
    if (!match) continue;
    actionReferences += 1;
    const reference = match[1];
    if (reference.startsWith("./")) continue;
    const at = reference.lastIndexOf("@");
    if (at < 1 || !/^[0-9a-f]{40}$/.test(reference.slice(at + 1))) {
      failures.push(`${name}:${index + 1}: action is not pinned to a commit`);
    }
  }

  for (const block of jobBlocks) {
    const secretNames = [
      ...block.matchAll(/secrets\.([A-Z0-9_]+)/g),
    ]
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
        !/^\s{10,}[A-Z0-9_]+:\s*\$\{\{[^}]*secrets\.[A-Z0-9_]+[^}]*\}\}/.test(line)
      ) {
        failures.push(
          `${name}: production secret is not scoped to an individual step`
        );
      }
    }
  }

  if (
    name === "ci.yml" &&
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
  resolve(root, ".github/CODEOWNERS"),
  "utf8"
);
if (!/^\/\.github\/\s+@prez-ai-sports-betting\s*$/m.test(codeowners)) {
  failures.push("CODEOWNERS: .github security owner is missing");
}

const result = {
  status: failures.length === 0 ? "PASS" : "FAIL",
  workflowsChecked: workflowNames.length,
  actionReferences,
  productionSecretReferences,
  failures,
};
process.stdout.write(`${JSON.stringify(result)}\n`);
if (failures.length > 0) process.exitCode = 1;
