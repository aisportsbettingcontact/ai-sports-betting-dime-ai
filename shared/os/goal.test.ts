import { describe, expect, it } from "vitest";
import { parseGoal, GOAL_FIELDS, findPriorityContradiction } from "./goal";
import { readFileSync, readdirSync, existsSync } from "fs";
import { resolve } from "path";

const GOOD = `
# GR-0001 — a goal

**Status:** ACTIVE · **DRI:** Prez · **Kind:** goal · **observe_by:** 2026-09-05

## Desired outcome
What must become true.

## The need behind it
Why the company needs it.

## Evidence that justified pursuing it
The audit found X.

## Acceptance criteria
- [ ] measurable thing

## Constraints
No production data.

## Time horizon
2026-08-31

## Responsible individual
Prez

## Current status
In progress.

## Evaluation measures
| Measure | Threshold | Current |
|---|---|---|
| criteria VERIFIED | 12 of 12 | 0 |

## Activity paths
- \`os/**\`
`;

describe("parseGoal", () => {
  it("requires all nine L1 fields", () => {
    expect(GOAL_FIELDS).toHaveLength(9);
    const g = parseGoal(GOOD);
    expect(g.id).toBe("GR-0001");
    expect(g.dri).toBe("Prez");
  });

  it("throws naming EVERY missing field, not just the first", () => {
    const stripped = GOOD.replace("## Constraints", "## Notes").replace("## Time horizon", "## When");
    expect(() => parseGoal(stripped)).toThrow(/Constraints[\s\S]*Time horizon|Time horizon[\s\S]*Constraints/);
  });

  it("requires at least one evaluation measure with a threshold — not prose", () => {
    const noThreshold = GOOD.replace("| criteria VERIFIED | 12 of 12 | 0 |", "");
    expect(() => parseGoal(noThreshold)).toThrow(/threshold/i);
  });

  it("reads the declared activity paths the contradiction check uses", () => {
    expect(parseGoal(GOOD).activityPaths).toEqual(["os/**"]);
  });
});

describe("findPriorityContradiction", () => {
  it("reports no contradiction when activity matches the declared paths", () => {
    const r = findPriorityContradiction(["os/**"], [["os/a.md"], ["os/b.md", "os/c.md"]]);
    expect(r.contradiction).toBe(false);
    expect(r.onGoalCycles).toBe(2);
  });

  it("flags a contradiction when most activity is elsewhere — the D13 requirement", () => {
    const r = findPriorityContradiction(["os/**"], [["server/x.ts"], ["client/y.ts"], ["os/a.md"]]);
    expect(r.contradiction).toBe(true);
    expect(r.onGoalCycles).toBe(1);
    expect(r.totalCycles).toBe(3);
  });

  it("counts a cycle as on-goal if ANY changed file matches", () => {
    expect(findPriorityContradiction(["os/**"], [["server/x.ts", "os/a.md"]]).onGoalCycles).toBe(1);
  });

  it("treats every regex metacharacter as a literal — only * and ** are wildcards", () => {
    // `?` was missing from the escape set, so it survived as a regex quantifier:
    // the glob `a?b.ts` failed to match itself and matched `b.ts` and `ab.ts`
    // instead. Any unescaped metachar is a wildcard nobody asked for.
    const lit = (g: string, p: string) => findPriorityContradiction([g], [[p]]).onGoalCycles === 1;

    for (const c of [".", "+", "?", "^", "$", "{", "}", "(", ")", "|", "[", "]"]) {
      const glob = `a${c}b.ts`;
      expect(lit(glob, glob), `glob ${JSON.stringify(glob)} must match itself literally`).toBe(true);
    }

    // The specific over-match: `?` must not make the preceding character optional.
    expect(lit("a?b.ts", "b.ts")).toBe(false);
    expect(lit("a?b.ts", "ab.ts")).toBe(false);
  });

  it("reports not_measured with zero cycles rather than a fabricated 100%", () => {
    const r = findPriorityContradiction(["os/**"], []);
    expect(r.state).toBe("not_measured");
    expect(r.contradiction).toBe(false);
  });
});

describe("the REAL os/goals/", () => {
  const root = resolve(__dirname, "../..");
  const dir = resolve(root, "os/goals");

  it("every goal record parses and carries all nine L1 fields", () => {
    const files = existsSync(dir) ? readdirSync(dir).filter((f) => /^GR-\d+.*\.md$/.test(f)) : [];
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(() => parseGoal(readFileSync(resolve(dir, f), "utf-8"))).not.toThrow();
    }
  });

  it("GR-0001 declares limits — a goal without limits is unevaluable (D5)", () => {
    const md = readFileSync(resolve(dir, "GR-0001-ai-native-certification.md"), "utf-8");
    const constraints = md.split(/^## Constraints$/m)[1].split(/^## /m)[0];
    expect(constraints).toMatch(/No merge to `main`/);
    expect(constraints).toMatch(/provenance|blends/i);
  });

  it("GR-0001 binds a target metric to a threshold, not prose", () => {
    const md = readFileSync(resolve(dir, "GR-0001-ai-native-certification.md"), "utf-8");
    expect(md).toMatch(/\|\s*\*\*12 of 12\*\*\s*\|/);
  });

  it("declares activity paths so the D13 contradiction check is computable", () => {
    const md = readFileSync(resolve(dir, "GR-0001-ai-native-certification.md"), "utf-8");
    // Assert the EXACT set. `.length > 0` passed while two prose sentences were
    // silently being parsed as globs — a vacuous assertion that hid a real bug.
    expect(parseGoal(md).activityPaths).toEqual([
      "os/**",
      "shared/os/**",
      "scripts/os/**",
      ".github/workflows/os-*.yml",
    ]);
  });
});

describe("section boundaries — an H3 subsection must not leak into its parent", () => {
  // Found in the PR #398 audit: GR-0001 grew a `### First reading` subsection under
  // `## Activity paths`, and its prose bullets were parsed as activity-path globs.
  // The section splitter used /^##\s/ , which cannot match `### ` (the third `#` is
  // not whitespace), so an H3 never terminated the section.
  const withSubsection = GOOD.replace(
    "## Activity paths\n- `os/**`\n",
    "## Activity paths\n- `os/**`\n\n### A note\n- this sentence is prose, not a glob\n- **bold** commentary\n",
  );

  it("does not parse an H3 subsection's bullets as activity paths", () => {
    expect(parseGoal(withSubsection).activityPaths).toEqual(["os/**"]);
  });

  it("rejects an activity path that is not path-shaped, loudly", () => {
    const prose = GOOD.replace("- `os/**`", "- `os/**`\n- this is a sentence, not a glob");
    expect(() => parseGoal(prose)).toThrow(/activity path/i);
  });

  it("a bare `**` would match every path — it must be rejected, not silently accepted", () => {
    // The dangerous case: one such entry makes every cycle on-goal, so the
    // contradiction check reports a clean 100% forever and never fires again.
    const wild = GOOD.replace("- `os/**`", "- `**`");
    expect(() => parseGoal(wild)).toThrow(/activity path/i);
  });

  it("does not count an H3 subsection's table rows as evaluation measures", () => {
    const emptied = GOOD.replace("| criteria VERIFIED | 12 of 12 | 0 |", "").replace(
      "## Activity paths",
      "### Some other table\n| a | b |\n|---|---|\n| 1 | 2 |\n\n## Activity paths",
    );
    expect(() => parseGoal(emptied)).toThrow(/threshold/i);
  });
});
