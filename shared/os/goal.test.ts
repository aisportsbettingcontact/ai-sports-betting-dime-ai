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
    expect(parseGoal(md).activityPaths.length).toBeGreaterThan(0);
  });
});
