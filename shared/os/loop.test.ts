import { describe, expect, it } from "vitest";
import { parseLoop, LOOP_QUESTIONS, LOOP_COMPONENTS, findUnresolvedCrossLinks } from "./loop";
import { readFileSync, readdirSync, existsSync } from "fs";
import { resolve } from "path";

const ACTIVE = `
# LOOP-001 — a loop

**Status:** ACTIVE · **DRI:** Prez · **Kind:** loop · **Goal:** GR-0001 · **observe_by:** 2026-09-05

## 1. What objective controls this process?
GR-0001, bounded by the limits it declares.

## 2. Who owns the result?
Prez.

## 3. What evidence informed the most recent action?
The Stage 1 audit.

## 4. What did the system do?
Merged PR #405.

## 5. What artifact records it?
\`os-ledger:cycles.jsonl\` — cycle \`merge-2c6501bad32c\`.

## 6. What happened afterward?
Both Railway services deployed; smoke 10/10.

## 7. How was the result evaluated?
Against the goal's acceptance criteria.

## 8. What changed because of the evaluation?
[[OBS-0001]] was filed.

## 9. What knowledge will influence the next cycle?
[[an-exit-code-cannot-tell-a-diagnosis-from-a-crash]]

## Components

| Component | This loop |
|---|---|
| Goal | GR-0001 |
| Context | the repo |
| Action | merge to main |
| Artifact | cycles.jsonl |
| Outcome | deploy verdict |
| Evaluation | smoke + audit |
| Adjustment + Memory | lessons |
`;

describe("the D5 contract", () => {
  it("interrogates with all nine questions and names seven components", () => {
    expect(LOOP_QUESTIONS).toHaveLength(9);
    expect(LOOP_COMPONENTS).toHaveLength(7);
  });

  it("parses a complete loop", () => {
    const l = parseLoop(ACTIVE);
    expect(l.id).toBe("LOOP-001");
    expect(l.status).toBe("ACTIVE");
    expect(l.dri).toBe("Prez");
    expect(l.goal).toBe("GR-0001");
  });

  it("names EVERY unanswered question at once, not just the first", () => {
    const gutted = ACTIVE.replace("## 3. What evidence informed the most recent action?", "## 3. Something else").replace(
      "## 7. How was the result evaluated?",
      "## 7. Something else",
    );
    expect(() => parseLoop(gutted)).toThrow(/3[\s\S]*7|7[\s\S]*3/);
  });

  it("rejects a question left unanswered — a heading with no body below it", () => {
    const empty = ACTIVE.replace(
      "## 6. What happened afterward?\nBoth Railway services deployed; smoke 10/10.",
      "## 6. What happened afterward?",
    );
    expect(() => parseLoop(empty)).toThrow(/unanswered|empty/i);
  });

  it("requires all seven D5 components", () => {
    const missing = ACTIVE.replace("| Outcome | deploy verdict |", "");
    expect(() => parseLoop(missing)).toThrow(/Outcome/);
  });

  it("requires a goal record — a loop without an objective is not a loop", () => {
    const noGoal = ACTIVE.replace(" · **Goal:** GR-0001", "");
    expect(() => parseLoop(noGoal)).toThrow(/goal/i);
  });

  it("a DEFERRED loop needs a reason, but not nine answers it cannot have", () => {
    const deferred = `
# LOOP-009 — deferred

**Status:** DEFERRED · **DRI:** Prez · **Kind:** loop · **blocked_on:** DR-005

Not yet designated.
`;
    const l = parseLoop(deferred);
    expect(l.status).toBe("DEFERRED");
    expect(l.blockedOn).toMatch(/DR-005/);
  });

  it("a DEFERRED loop with no blocked_on is a quiet omission, not a decision", () => {
    const silent = `
# LOOP-009 — deferred

**Status:** DEFERRED · **DRI:** Prez · **Kind:** loop

Not yet designated.
`;
    expect(() => parseLoop(silent)).toThrow(/blocked_on/i);
  });
});

describe("cross-links must resolve — a loop that cites a fiction is not evidence", () => {
  it("finds a wiki-link that resolves to no known artifact", () => {
    const unresolved = findUnresolvedCrossLinks(ACTIVE, new Set(["OBS-0001"]));
    expect(unresolved).toContain("an-exit-code-cannot-tell-a-diagnosis-from-a-crash");
  });

  it("reports nothing when every link resolves", () => {
    const known = new Set(["OBS-0001", "an-exit-code-cannot-tell-a-diagnosis-from-a-crash"]);
    expect(findUnresolvedCrossLinks(ACTIVE, known)).toEqual([]);
  });
});

describe("the REAL os/loops/", () => {
  const dir = resolve(__dirname, "../..", "os/loops");

  it("every loop record parses under the D5 contract", () => {
    const files = existsSync(dir) ? readdirSync(dir).filter((f) => /^LOOP-\d+.*\.md$/.test(f)) : [];
    expect(files.length, "no loop records found").toBeGreaterThan(0);
    for (const f of files) {
      expect(() => parseLoop(readFileSync(resolve(dir, f), "utf-8")), f).not.toThrow();
    }
  });

  it("at least two loops are ACTIVE — a cross-link needs two", () => {
    const files = readdirSync(dir).filter((f) => /^LOOP-\d+.*\.md$/.test(f));
    const active = files
      .map((f) => parseLoop(readFileSync(resolve(dir, f), "utf-8")))
      .filter((l) => l.status === "ACTIVE");
    expect(active.length).toBeGreaterThanOrEqual(2);
  });

  it("every deferred loop states why", () => {
    const files = readdirSync(dir).filter((f) => /^LOOP-\d+.*\.md$/.test(f));
    for (const f of files) {
      const l = parseLoop(readFileSync(resolve(dir, f), "utf-8"));
      if (l.status === "DEFERRED") expect(l.blockedOn, `${f} defers without a reason`).toBeTruthy();
    }
  });
});

describe("the cross-link between loops is DEMONSTRATED, not asserted", () => {
  const root = resolve(__dirname, "../..");

  /** Every id the /os/ tree can resolve: loops, goals, decisions, observations, lessons, issues. */
  function knownArtifacts(): Set<string> {
    const known = new Set<string>();
    const add = (dir: string, fn: (f: string) => string | null) => {
      const d = resolve(root, dir);
      if (!existsSync(d)) return;
      for (const f of readdirSync(d)) {
        const id = fn(f);
        if (id) known.add(id);
      }
    };
    add("os/loops", (f) => /^(LOOP-\d+)/.exec(f)?.[1] ?? null);
    add("os/goals", (f) => /^(GR-\d+)/.exec(f)?.[1] ?? null);
    add("os/decisions", (f) => /^(DR-\d+)/.exec(f)?.[1] ?? null);
    add("os/loops/observations", (f) => /^(OBS-\d+)/.exec(f)?.[1] ?? null);
    add("os/plan/issues", (f) => /^(ISSUE-\d+)/.exec(f)?.[1] ?? null);
    // Lessons are referenced by filename slug, not an id.
    add("os/memory/lessons", (f) => (f.endsWith(".md") && f !== "README.md" ? f.replace(/\.md$/, "") : null));
    return known;
  }

  it("every wiki-link in every loop and observation resolves to a real artifact", () => {
    const known = knownArtifacts();
    expect(known.size, "no artifacts discovered — the scan is vacuous").toBeGreaterThan(20);

    const targets: [string, string][] = [];
    for (const [dir, re] of [
      ["os/loops", /^LOOP-\d+.*\.md$/],
      ["os/loops/observations", /^OBS-\d+.*\.md$/],
      ["os/decisions", /^DR-\d+.*\.md$/],
    ] as [string, RegExp][]) {
      const d = resolve(root, dir);
      if (!existsSync(d)) continue;
      for (const f of readdirSync(d).filter((x) => re.test(x))) {
        targets.push([`${dir}/${f}`, readFileSync(resolve(d, f), "utf-8")]);
      }
    }
    expect(targets.length).toBeGreaterThan(5);

    const broken: string[] = [];
    for (const [path, md] of targets) {
      for (const t of findUnresolvedCrossLinks(md, known)) broken.push(`${path} -> [[${t}]]`);
    }
    expect(broken, "a link that resolves to nothing reads as evidence and carries none").toEqual([]);
  });

  it("LOOP-001 records a decision whose evidence is a LOOP-002 artifact", () => {
    // The ISSUE-013 acceptance criterion, made checkable: an artifact id produced
    // by one loop must resolve inside a decision recorded by the other. Asserting
    // that the loops are "connected" in prose would prove nothing.
    const dr = resolve(root, "os/decisions/DR-016-cron-cadence-truth.md");
    expect(existsSync(dr), "DR-016 is the cross-link of record").toBe(true);
    const md = readFileSync(dr, "utf-8");

    expect(md, "the decision must cite the observation, not describe it").toMatch(/\[\[OBS-0002\]\]/);
    expect(findUnresolvedCrossLinks(md, knownArtifacts())).toEqual([]);

    // …and the cited observation must itself belong to the OTHER loop.
    const obs = readFileSync(resolve(root, "os/loops/observations/OBS-0002-cron-cadence-drift.md"), "utf-8");
    expect(obs).toMatch(/\*\*Loop:\*\*\s*LOOP-002/);
  });

  it("LOOP-001 has at least one cycle with an observed outcome and a filed adjustment", () => {
    // D16 criterion: a completed LIVE cycle. Until OBS-0001 existed, every entry
    // in os-ledger:cycles.jsonl carried outcome: null — the honest record of a
    // loop that had not closed.
    const obs = resolve(root, "os/loops/observations/OBS-0001-pr398-cycle.md");
    expect(existsSync(obs)).toBe(true);
    const md = readFileSync(obs, "utf-8");
    expect(md).toMatch(/\*\*Loop:\*\*\s*LOOP-001/);
    expect(md, "an observation must cite the cycle it observed").toMatch(/merge-[0-9a-f]{12}/);
    for (const section of ["## Action", "## Artifact", "## Outcome", "## Evaluation", "## Adjustment", "## Memory"]) {
      expect(md, `OBS-0001 omits ${section}`).toContain(section);
    }
  });
});
