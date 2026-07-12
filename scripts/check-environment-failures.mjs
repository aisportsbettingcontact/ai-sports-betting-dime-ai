/**
 * check-environment-failures.mjs — executable gate over vitest results.
 *
 * Consumes vitest's JSON reporter output and the allowlist in
 * vitest.environment-failure-allowlist.json, and decides pass/fail instead
 * of leaving that judgment to whoever reads the terminal. The allowlist is
 * data; this script is the mechanism that makes it binding.
 *
 * Profiles:
 *   --profile=local        Failures must be an exact subset of the allowlist,
 *                          and each must be explainable by a missing env var
 *                          (entry.requiredEnv). An allowlisted test that PASSES
 *                          while its env vars are absent is a stale entry and
 *                          fails the gate. An allowlisted test that FAILS while
 *                          all its env vars are present is a real failure.
 *   --profile=ci           Zero failures tolerated. Skipped suites must be
 *                          declared in expectedCiSkips (with a reason) or the
 *                          gate fails. Dependabot actors (structurally without
 *                          repository secrets) are evaluated as local.
 *
 * Usage:
 *   vitest run --reporter=default --reporter=json --outputFile=vitest-results.json
 *   node scripts/check-environment-failures.mjs \
 *     --profile=local --input=vitest-results.json [--report=report.json]
 *
 * Exit codes: 0 gate passes; 1 gate fails; 2 usage/input error.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKIPPED_STATUSES = new Set(["skipped", "pending", "todo", "disabled"]);

export function testId(relFile, assertion) {
  const ancestors = assertion.ancestorTitles?.filter(Boolean) ?? [];
  const suffix = [...ancestors, assertion.title].join(" > ");
  return `${relFile}::${suffix}`;
}

export function evaluateResults({
  results,
  allowlist,
  profile,
  env,
  actor = "",
  rootDir = process.cwd(),
}) {
  const effectiveProfile =
    profile === "ci" && actor === "dependabot[bot]" ? "local" : profile;

  const statusById = new Map();
  const fileByById = new Map();
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  const collectionErrors = [];
  for (const file of results.testResults ?? []) {
    const relFile = path.isAbsolute(file.name)
      ? path.relative(rootDir, file.name)
      : file.name;
    const assertions = file.assertionResults ?? [];
    // A file that FAILED with zero assertion results never ran its tests —
    // a collection error (broken import, syntax error, top-level throw).
    // The environment allowlist excuses failing ASSERTIONS, never a file
    // that produced none: with `vitest run || true` feeding this gate and
    // tsconfig excluding *.test.ts from typecheck, nothing else would
    // surface it. Fatal in every profile.
    if (file.status === "failed" && assertions.length === 0) {
      collectionErrors.push(relFile);
    }
    for (const assertion of assertions) {
      const id = testId(relFile, assertion);
      statusById.set(id, assertion.status);
      fileByById.set(id, relFile);
      if (assertion.status === "passed") passed += 1;
      else if (assertion.status === "failed") failed += 1;
      else if (SKIPPED_STATUSES.has(assertion.status)) skipped += 1;
    }
  }

  const entries = allowlist.entries ?? [];
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const expectedCiSkips = allowlist.expectedCiSkips ?? [];
  const problems = [];

  for (const relFile of collectionErrors) {
    problems.push({
      kind: "collection-error",
      testId: `${relFile}::(file failed before any test ran)`,
      detail:
        "Test file failed with zero assertion results (import/syntax/top-level error). Never excusable by the allowlist.",
    });
  }
  // Belt for report shapes we do not anticipate: vitest said the run failed
  // but nothing above accounts for it.
  if (
    results.success === false &&
    problems.length === 0 &&
    failed === 0 &&
    ![...statusById.values()].some((s) => s === "failed")
  ) {
    problems.push({
      kind: "unaccounted-failure",
      testId: "(run)",
      detail:
        "vitest reported success:false, but no failed assertions or collection errors are visible in the JSON report.",
    });
  }

  const missingEnv = (entry) =>
    (entry.requiredEnv ?? []).filter((name) => !env[name]);

  if (effectiveProfile === "local") {
    for (const [id, status] of statusById) {
      if (status !== "failed") continue;
      const entry = entryById.get(id);
      if (!entry) {
        problems.push({
          kind: "new-failure",
          testId: id,
          detail: "Failure is not in the environment allowlist.",
        });
        continue;
      }
      const required = entry.requiredEnv ?? [];
      if (required.length > 0 && missingEnv(entry).length === 0) {
        problems.push({
          kind: "real-failure-despite-env",
          testId: id,
          detail: `All required env vars (${required.join(", ")}) are present; the environment cannot explain this failure.`,
        });
      }
    }
    for (const entry of entries) {
      const status = statusById.get(entry.id);
      const required = entry.requiredEnv ?? [];
      if (status === undefined) {
        problems.push({
          kind: "not-executed",
          testId: entry.id,
          detail: "Allowlisted test was not discovered or not executed.",
        });
        continue;
      }
      if (
        status === "passed" &&
        required.length > 0 &&
        missingEnv(entry).length > 0
      ) {
        problems.push({
          kind: "stale-entry",
          testId: entry.id,
          detail: `Test passes while ${missingEnv(entry).join(", ")} is absent; the entry no longer describes an environment-bound failure.`,
        });
      }
    }
  } else if (effectiveProfile === "ci") {
    for (const [id, status] of statusById) {
      if (status === "failed") {
        problems.push({
          kind: "ci-failure",
          testId: id,
          detail: "CI tolerates zero test failures.",
        });
      } else if (SKIPPED_STATUSES.has(status)) {
        const file = fileByById.get(id);
        const declared = expectedCiSkips.some(
          (skip) => skip.file === file || skip.id === id
        );
        if (!declared) {
          problems.push({
            kind: "unexpected-skip",
            testId: id,
            detail:
              "Skipped in CI without a declared reason in expectedCiSkips.",
          });
        }
      }
    }
  } else {
    throw new Error(`Unknown profile: ${profile}`);
  }

  const environmentBound = entries.filter(
    (entry) => statusById.get(entry.id) === "failed"
  ).length;

  return {
    ok: problems.length === 0,
    profile: effectiveProfile,
    problems,
    summary: {
      passed,
      failed,
      skipped,
      notExecuted: entries.filter((e) => !statusById.has(e.id)).length,
      environmentBound,
    },
  };
}

function parseArgs(argv) {
  const args = {};
  for (const raw of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(raw);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { profile, input } = args;
  if (!profile || !input) {
    console.error(
      "Usage: node scripts/check-environment-failures.mjs --profile=local|ci --input=vitest-results.json [--report=out.json] [--actor=$GITHUB_ACTOR]"
    );
    process.exit(2);
  }
  let results;
  let allowlist;
  try {
    results = JSON.parse(readFileSync(input, "utf8"));
    allowlist = JSON.parse(
      readFileSync(
        new URL("../vitest.environment-failure-allowlist.json", import.meta.url),
        "utf8"
      )
    );
  } catch (error) {
    console.error(`[env-gate] Cannot read inputs: ${error.message}`);
    process.exit(2);
  }

  const evaluation = evaluateResults({
    results,
    allowlist,
    profile,
    env: process.env,
    actor: args.actor ?? "",
  });

  if (args.report) {
    writeFileSync(args.report, JSON.stringify(evaluation, null, 2));
  }

  const { summary } = evaluation;
  console.log(
    `[env-gate] profile=${evaluation.profile} passed=${summary.passed} failed=${summary.failed} skipped=${summary.skipped} notExecuted=${summary.notExecuted} environmentBound=${summary.environmentBound}`
  );
  for (const problem of evaluation.problems) {
    console.error(`[env-gate] ${problem.kind}: ${problem.testId} — ${problem.detail}`);
  }
  console.log(evaluation.ok ? "[env-gate] PASS" : "[env-gate] FAIL");
  process.exit(evaluation.ok ? 0 : 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
