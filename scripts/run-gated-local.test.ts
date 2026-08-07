import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs module without type declarations
import { discoverDbSuites, mergeVitestReports, planRun } from "./run-gated-local.mjs";

describe("run-gated-local plan (Incident 42)", () => {
  const dbSuites = ["server/appUsers.register.test.ts", "server/tokenVersion.db.test.ts"];

  it("keeps the exact single parallel run when DATABASE_URL is absent", () => {
    const plan = planRun({ hasDatabaseUrl: false, dbSuites });
    expect(plan.mode).toBe("single");
    expect(plan.phases).toHaveLength(1);
    expect(plan.phases[0].extraArgs).toEqual([]);
    expect(plan.phases[0].output).toBe("vitest-results.json");
  });

  it("splits into parallel non-DB + serialized DB phases when DATABASE_URL is present", () => {
    const plan = planRun({ hasDatabaseUrl: true, dbSuites });
    expect(plan.mode).toBe("split");
    const [a, b] = plan.phases;
    // Phase A excludes every DB suite; phase B runs exactly them, serially.
    expect(a.extraArgs).toEqual(dbSuites.map((f) => `--exclude=${f}`));
    expect(b.filters).toEqual(dbSuites);
    expect(b.extraArgs).toContain("--no-file-parallelism");
  });

  it("falls back to a single run when no DB suite exists to serialize", () => {
    expect(planRun({ hasDatabaseUrl: true, dbSuites: [] }).mode).toBe("single");
  });

  it("discovers the real repo DB suites by their SKIP_DB_IN_CI guard", () => {
    const found = discoverDbSuites(process.cwd());
    // The 6 suites documented in ci.yml's db-tests job, plus the guard's own
    // home if it ever gains a test — assert the known members, not a count.
    expect(found).toContain("server/tokenVersion.db.test.ts");
    expect(found).toContain("server/appUsers.register.test.ts");
    expect(found).toContain("server/mlbDoubleheader.db.test.ts");
    for (const file of found) expect(file).toMatch(/\.test\.ts$/);
  });

  it("merges reports so the gate sees one honest run", () => {
    const merged = mergeVitestReports([
      { success: true, numTotalTests: 3, testResults: [{ name: "a" }] },
      { success: false, numTotalTests: 2, testResults: [{ name: "b" }, { name: "c" }] },
    ]);
    expect(merged.success).toBe(false);
    expect(merged.numTotalTests).toBe(5);
    expect(merged.testResults.map((r: { name: string }) => r.name)).toEqual(["a", "b", "c"]);
  });
});
