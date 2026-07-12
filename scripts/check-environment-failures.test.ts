import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs module without type declarations
import { evaluateResults, testId } from "./check-environment-failures.mjs";

type Status = "passed" | "failed" | "skipped";

function vitestJson(
  cases: Array<{ file: string; suite: string; title: string; status: Status }>
) {
  const byFile = new Map<string, (typeof cases)[number][]>();
  for (const c of cases) {
    byFile.set(c.file, [...(byFile.get(c.file) ?? []), c]);
  }
  return {
    testResults: [...byFile.entries()].map(([file, assertions]) => ({
      name: `/repo/${file}`,
      assertionResults: assertions.map((a) => ({
        ancestorTitles: [a.suite],
        title: a.title,
        status: a.status,
      })),
    })),
  };
}

const allowlist = {
  entries: [
    {
      id: "server/vsinCredentials.test.ts::VSiN credentials > VSIN_EMAIL is set and non-empty",
      requiredEnv: ["VSIN_EMAIL"],
    },
  ],
  expectedCiSkips: [
    { file: "server/email.test.ts", reason: "live SMTP probe, operator-side" },
  ],
};

const vsinCase = {
  file: "server/vsinCredentials.test.ts",
  suite: "VSiN credentials",
  title: "VSIN_EMAIL is set and non-empty",
} as const;

describe("environment-failure gate", () => {
  it("builds ids in the allowlist's file::suite > title format", () => {
    expect(
      testId("server/vsinCredentials.test.ts", {
        ancestorTitles: ["VSiN credentials"],
        title: "VSIN_EMAIL is set and non-empty",
      })
    ).toBe(allowlist.entries[0]!.id);
  });

  it("accepts a known allowlisted failure whose env var is absent", () => {
    const result = evaluateResults({
      results: vitestJson([{ ...vsinCase, status: "failed" }]),
      allowlist,
      profile: "local",
      env: {},
      rootDir: "/repo",
    });
    expect(result.ok).toBe(true);
    expect(result.summary.environmentBound).toBe(1);
  });

  it("fails on a new failure that is not allowlisted", () => {
    const result = evaluateResults({
      results: vitestJson([
        { ...vsinCase, status: "failed" },
        {
          file: "client/src/lib/feedRoutes.test.ts",
          suite: "feedRoutes",
          title: "canonicalizes",
          status: "failed",
        },
      ]),
      allowlist,
      profile: "local",
      env: {},
      rootDir: "/repo",
    });
    expect(result.ok).toBe(false);
    expect(result.problems).toContainEqual(
      expect.objectContaining({ kind: "new-failure" })
    );
  });

  it("fails a stale entry that passes while its env var is absent", () => {
    const result = evaluateResults({
      results: vitestJson([{ ...vsinCase, status: "passed" }]),
      allowlist,
      profile: "local",
      env: {},
      rootDir: "/repo",
    });
    expect(result.ok).toBe(false);
    expect(result.problems).toContainEqual(
      expect.objectContaining({ kind: "stale-entry" })
    );
  });

  it("fails a functional regression mislabeled as environmental (env present)", () => {
    const result = evaluateResults({
      results: vitestJson([{ ...vsinCase, status: "failed" }]),
      allowlist,
      profile: "local",
      env: { VSIN_EMAIL: "ops@example.com" },
      rootDir: "/repo",
    });
    expect(result.ok).toBe(false);
    expect(result.problems).toContainEqual(
      expect.objectContaining({ kind: "real-failure-despite-env" })
    );
  });

  it("fails when an allowlisted test is not executed at all", () => {
    const result = evaluateResults({
      results: vitestJson([]),
      allowlist,
      profile: "local",
      env: {},
      rootDir: "/repo",
    });
    expect(result.ok).toBe(false);
    expect(result.problems).toContainEqual(
      expect.objectContaining({ kind: "not-executed" })
    );
    expect(result.summary.notExecuted).toBe(1);
  });

  it("fails CI on any failure and on undeclared skips", () => {
    const result = evaluateResults({
      results: vitestJson([
        { ...vsinCase, status: "failed" },
        {
          file: "server/tokenVersion.db.test.ts",
          suite: "tokenVersion.db",
          title: "force logout",
          status: "skipped",
        },
      ]),
      allowlist,
      profile: "ci",
      env: {},
      rootDir: "/repo",
    });
    expect(result.ok).toBe(false);
    const kinds = result.problems.map((p: { kind: string }) => p.kind);
    expect(kinds).toContain("ci-failure");
    expect(kinds).toContain("unexpected-skip");
  });

  it("allows declared CI skips and evaluates dependabot as local", () => {
    const ciResult = evaluateResults({
      results: vitestJson([
        {
          file: "server/email.test.ts",
          suite: "Gmail SMTP credentials",
          title: "authenticates",
          status: "skipped",
        },
      ]),
      allowlist,
      profile: "ci",
      env: {},
      rootDir: "/repo",
    });
    expect(ciResult.ok).toBe(true);

    const dependabotResult = evaluateResults({
      results: vitestJson([{ ...vsinCase, status: "failed" }]),
      allowlist,
      profile: "ci",
      actor: "dependabot[bot]",
      env: {},
      rootDir: "/repo",
    });
    expect(dependabotResult.ok).toBe(true);
    expect(dependabotResult.profile).toBe("local");
  });
});
