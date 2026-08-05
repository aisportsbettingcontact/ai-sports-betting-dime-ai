/**
 * run-gated-local.mjs — local entrypoint for the gated vitest run.
 *
 * Incident 42: `test:gated:local` ran every file in parallel; with a
 * DATABASE_URL in the shell the six real-DB suites actually execute, and
 * `tokenVersion.db.test.ts` performs a global tokenVersion mutation that can
 * force-log-out another suite's authenticated caller mid-file. CI avoids the
 * race by running the DB suites in a dedicated job with --no-file-parallelism
 * (.github/workflows/ci.yml); locally nothing did.
 *
 * This runner restores determinism without punishing the common case:
 *   - no DATABASE_URL  → one parallel vitest run (exact previous behavior;
 *     DB suites self-skip or fail env-bound as before).
 *   - DATABASE_URL set → phase A: every non-DB suite, parallel;
 *     phase B: the DB-bound suites only, --no-file-parallelism (serial files,
 *     matching CI); reports merged into one vitest-results.json for the gate.
 *
 * DB-bound suites are DISCOVERED, not hardcoded: any server test file that
 * references the SKIP_DB_IN_CI guard (server/_core/ciTestGuard.ts) is
 * DB-bound by definition. A new real-DB suite adopting the repo convention is
 * picked up automatically; one that skips the convention is caught by the
 * db-tests CI job review, not silently raced here.
 *
 * Every decision is logged with a [gated-local] prefix so a failing run can be
 * reconstructed from output alone.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RESULTS = "vitest-results.json";
const PHASE_A_RESULTS = "vitest-results.phase-a.json";
const PHASE_B_RESULTS = "vitest-results.phase-b.json";
const DB_GUARD_MARKER = "SKIP_DB_IN_CI";

/** Recursively list *.test.ts files under a directory (repo-relative). */
function listTestFiles(rootDir, dir) {
  const out = [];
  for (const entry of readdirSync(path.join(rootDir, dir), { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTestFiles(rootDir, rel));
    else if (entry.name.endsWith(".test.ts")) out.push(rel);
  }
  return out;
}

/** DB-bound = test file referencing the SKIP_DB_IN_CI guard. */
export function discoverDbSuites(rootDir) {
  return listTestFiles(rootDir, "server")
    .filter((rel) => {
      try {
        return readFileSync(path.join(rootDir, rel), "utf8").includes(DB_GUARD_MARKER);
      } catch {
        return false;
      }
    })
    .sort();
}

/** Decide the execution plan. Pure — unit-tested. */
export function planRun({ hasDatabaseUrl, dbSuites }) {
  if (!hasDatabaseUrl || dbSuites.length === 0) {
    return {
      mode: "single",
      phases: [{ label: "all", filters: [], extraArgs: [], output: RESULTS }],
    };
  }
  return {
    mode: "split",
    phases: [
      {
        label: "non-db (parallel)",
        filters: [],
        extraArgs: dbSuites.map((f) => `--exclude=${f}`),
        output: PHASE_A_RESULTS,
      },
      {
        label: "db (serialized files, mirrors CI --no-file-parallelism)",
        filters: dbSuites,
        extraArgs: ["--no-file-parallelism"],
        output: PHASE_B_RESULTS,
      },
    ],
  };
}

/**
 * Merge vitest JSON reports. The env-gate reads only `success` and
 * `testResults`; numeric roll-ups are recomputed for log accuracy.
 */
export function mergeVitestReports(reports) {
  const merged = {
    success: reports.every((r) => r.success !== false),
    testResults: reports.flatMap((r) => r.testResults ?? []),
  };
  for (const key of [
    "numTotalTests",
    "numPassedTests",
    "numFailedTests",
    "numPendingTests",
    "numTotalTestSuites",
    "numPassedTestSuites",
    "numFailedTestSuites",
  ]) {
    merged[key] = reports.reduce((sum, r) => sum + (r[key] ?? 0), 0);
  }
  return merged;
}

function runVitest(phase) {
  const args = [
    "vitest",
    "run",
    "--reporter=default",
    "--reporter=json",
    `--outputFile=${phase.output}`,
    ...phase.extraArgs,
    ...phase.filters,
  ];
  console.log(`[gated-local] phase "${phase.label}": npx ${args.join(" ")}`);
  const started = Date.now();
  const result = spawnSync("npx", args, { stdio: "inherit" });
  console.log(
    `[gated-local] phase "${phase.label}" finished in ${((Date.now() - started) / 1000).toFixed(1)}s (vitest exit=${result.status}; gate decides pass/fail)`
  );
  return result.status ?? 1;
}

function main() {
  const rootDir = process.cwd();
  const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
  const dbSuites = discoverDbSuites(rootDir);
  console.log(
    `[gated-local] DATABASE_URL=${hasDatabaseUrl ? "present" : "absent"}; ${dbSuites.length} DB-bound suite(s) discovered via ${DB_GUARD_MARKER}: ${dbSuites.join(", ") || "(none)"}`
  );
  const plan = planRun({ hasDatabaseUrl, dbSuites });
  console.log(`[gated-local] mode=${plan.mode}`);

  for (const phase of plan.phases) runVitest(phase);

  if (plan.mode === "split") {
    const reports = plan.phases.map((phase) => {
      if (!existsSync(phase.output)) {
        console.error(`[gated-local] missing report ${phase.output} — treating run as failed`);
        return { success: false, testResults: [] };
      }
      return JSON.parse(readFileSync(phase.output, "utf8"));
    });
    const merged = mergeVitestReports(reports);
    writeFileSync(RESULTS, JSON.stringify(merged));
    console.log(
      `[gated-local] merged ${plan.phases.length} phase reports → ${RESULTS} (files=${merged.testResults.length}, success=${merged.success})`
    );
  }

  const gate = spawnSync(
    "node",
    [
      "scripts/check-environment-failures.mjs",
      "--profile=local",
      `--input=${RESULTS}`,
      "--report=env-gate-report.json",
    ],
    { stdio: "inherit" }
  );
  process.exit(gate.status ?? 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
