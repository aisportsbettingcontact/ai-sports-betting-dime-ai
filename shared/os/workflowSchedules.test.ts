import { describe, expect, it } from "vitest";
import { extractSchedules } from "./workflowSchedules";

/** Convenience: the crons, or throw if the reader refused. */
function crons(yaml: string): string[] {
  const r = extractSchedules(yaml, "probe.yml");
  if (r.refused) throw new Error(r.refused);
  return r.crons;
}

describe("the shapes GitHub actually accepts", () => {
  it("reads the ordinary block form", () => {
    expect(
      crons(`name: x\non:\n  schedule:\n    - cron: "*/5 * * * *"\n`),
    ).toEqual(["*/5 * * * *"]);
  });

  it("reads a sequence indented FLUSH with its key — valid YAML, silently dropped before", () => {
    expect(crons(`name: x\non:\n  schedule:\n  - cron: "*/15 * * * *"\n`)).toEqual(["*/15 * * * *"]);
  });

  it("reads multiple entries, in order", () => {
    expect(
      crons(`on:\n  schedule:\n    - cron: "*/30 * * * *"\n    - cron: "15 8 * * *"\n`),
    ).toEqual(["*/30 * * * *", "15 8 * * *"]);
  });

  it("reads unquoted, single-quoted and double-quoted values, and strips trailing comments", () => {
    expect(crons(`on:\n  schedule:\n    - cron: */5 * * * *  # every five\n`)).toEqual(["*/5 * * * *"]);
    expect(crons(`on:\n  schedule:\n    - cron: '0 9 * * *'\n`)).toEqual(["0 9 * * *"]);
    expect(crons(`on:\n  schedule:\n    - cron: "0 9 * * *" # nightly\n`)).toEqual(["0 9 * * *"]);
  });

  it("tolerates a quoted `on` key — YAML 1.1 reads bare `on` as a boolean", () => {
    expect(crons(`"on":\n  schedule:\n    - cron: "0 9 * * *"\n`)).toEqual(["0 9 * * *"]);
    expect(crons(`'on':\n  schedule:\n    - cron: "0 9 * * *"\n`)).toEqual(["0 9 * * *"]);
  });

  it("returns nothing for a workflow with no schedule", () => {
    expect(crons(`on:\n  workflow_dispatch:\njobs:\n  x:\n    steps: []\n`)).toEqual([]);
  });

  it("handles other `on:` triggers alongside schedule", () => {
    expect(
      crons(`on:\n  push:\n    branches: [main]\n  schedule:\n    - cron: "0 9 * * *"\n  workflow_dispatch:\n`),
    ).toEqual(["0 9 * * *"]);
  });
});

describe("a schedule: that is not the workflow's trigger must NOT be collected", () => {
  it("ignores `schedule:` inside a run: block scalar — a heredoc writing a config file", () => {
    // Confirmed false positive in the shipped scanner: it extracted "* * * * *"
    // from a shell heredoc that happened to contain the word.
    const yaml = [
      "on:",
      "  workflow_dispatch:",
      "jobs:",
      "  build:",
      "    steps:",
      "      - run: |",
      "          cat > cfg.yml <<'X'",
      "          schedule:",
      '            - cron: "* * * * *"',
      "          X",
      "",
    ].join("\n");
    expect(crons(yaml)).toEqual([]);
  });

  it("ignores `schedule:` under env:, not under on:", () => {
    // Confirmed false positive: it extracted "0 0 * * *".
    expect(
      crons(`on:\n  workflow_dispatch:\nenv:\n  schedule:\n    - cron: "0 0 * * *"\n`),
    ).toEqual([]);
  });

  it("ignores `schedule:` nested inside a job", () => {
    expect(
      crons(`on:\n  workflow_dispatch:\njobs:\n  x:\n    schedule:\n      - cron: "0 0 * * *"\n`),
    ).toEqual([]);
  });

  it("ignores a block scalar INSIDE the on: mapping — where scoping cannot help", () => {
    // Mutation testing found the heredoc test above was passing because of the
    // `on:`-scoping, not the block-scalar masking: disabling masking left the
    // suite green. This is the case where masking is genuinely load-bearing —
    // the scalar's body lies within `on:`'s own indent range, so scoping cannot
    // reject it and only masking can.
    const yaml = [
      "on:",
      "  workflow_dispatch:",
      "  notes: |",
      "    schedule:",
      '      - cron: "* * * * *"',
      "",
    ].join("\n");
    expect(crons(yaml)).toEqual([]);
  });

  it("ignores a folded block scalar that merely mentions the word", () => {
    expect(crons(`on:\n  workflow_dispatch:\njobs:\n  x:\n    steps:\n      - run: >\n          schedule:\n          - cron: "0 0 * * *"\n`)).toEqual([]);
  });
});

describe("shapes it cannot parse are REFUSED, never silently dropped", () => {
  // Every one of these was silently dropped by the shipped scanner, so a
  // workflow could declare a schedule and simply not be measured. Refusing
  // names the file and fails the run; dropping it looks like compliance.
  it("refuses a flow mapping on `on:`", () => {
    const r = extractSchedules(`name: x\non: { schedule: [{ cron: "*/5 * * * *" }] }\n`, "a.yml");
    expect(r.refused).toMatch(/flow|inline/i);
    expect(r.refused).toContain("a.yml");
  });

  it("refuses an inline sequence on `schedule:`", () => {
    const r = extractSchedules(`on:\n  schedule: [{cron: "*/10 * * * *"}]\n`, "b.yml");
    expect(r.refused).toMatch(/flow|inline/i);
  });

  it("refuses a folded/block scalar cron value", () => {
    // The shipped scanner captured the literal ">-" as the expression and then
    // aborted the ENTIRE observation on it.
    for (const ind of [">-", ">", "|", "|-"]) {
      const r = extractSchedules(`on:\n  schedule:\n    - cron: ${ind}\n        */20 * * * *\n`, "c.yml");
      expect(r.refused, `indicator ${ind}`).toMatch(/scalar/i);
    }
  });

  it("refuses an anchor or alias where a cron is expected", () => {
    expect(extractSchedules(`on:\n  schedule:\n    - cron: *ref\n`, "d.yml").refused).toMatch(/anchor|alias/i);
    expect(extractSchedules(`on:\n  schedule: &s\n    - cron: "0 9 * * *"\n`, "e.yml").refused).toMatch(/anchor|alias/i);
  });

  it("refuses a schedule entry that is not a cron mapping", () => {
    expect(extractSchedules(`on:\n  schedule:\n    - notcron: "0 9 * * *"\n`, "f.yml").refused).toMatch(/cron/i);
  });

  it("a refusal names the file, so the operator knows where to look", () => {
    const r = extractSchedules(`on: { schedule: [] }\n`, "very-specific-name.yml");
    expect(r.refused).toContain("very-specific-name.yml");
  });
});

describe("the real workflows in this repo all parse", () => {
  it("does not refuse any of them", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { resolve, join } = await import("node:path");
    const dir = resolve(__dirname, "../..", ".github/workflows");
    const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
    expect(files.length).toBeGreaterThan(20);

    const refusals: string[] = [];
    let withSchedule = 0;
    for (const f of files) {
      const r = extractSchedules(readFileSync(join(dir, f), "utf8"), f);
      if (r.refused) refusals.push(r.refused);
      if (r.crons.length > 0) withSchedule++;
    }
    expect(refusals).toEqual([]);
    // A vacuous pass guard: the repo really does have scheduled workflows.
    expect(withSchedule).toBeGreaterThanOrEqual(10);
  });
});
