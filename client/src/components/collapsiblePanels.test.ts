import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (f: string) =>
  fs.readFileSync(path.join(import.meta.dirname, f), "utf8");
const recent = read("RecentSchedulePanel.tsx");
const situational = read("SituationalResultsPanel.tsx");

describe.each([
  ["RecentSchedulePanel", recent],
  ["SituationalResultsPanel", situational],
])("%s collapsible contract", (_name, src) => {
  it("declares collapsible?: boolean defaulting to true", () => {
    expect(src).toMatch(/collapsible\?: boolean/);
    expect(src).toMatch(/collapsible = true/);
  });
  it("forces expanded when collapsible is false", () => {
    // Derived expansion: non-collapsible panels are always open.
    expect(src).toMatch(/collapsible \? \w+ : true/);
  });
});
