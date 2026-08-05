import { describe, expect, it } from "vitest";
import { parseAuthority, findUnrungedActors } from "./authority";
import { readFileSync, existsSync, readdirSync } from "fs";
import { resolve } from "path";

const MD = `
# AUTHORITY

## Rungs

| Rung | Name | May do | Gate |
|---|---|---|---|
| 1 | read-only | Analyse, recommend, report | none |
| 2 | reversible | Reversible low-risk action | evaluation shows reliability |
| 3 | irreversible | High-impact or hard-to-reverse | Prez, per action |

## Actors

| Actor | Rung | Status | Notes |
|---|---|---|---|
| \`executor\` | 2 | ACTIVE | mission executor |
| \`SEAT-001\` | 2 | DEFERRED | blocked_on: LOOP-002 |
| \`SEAT-003\` | 3 | DEFERRED | blocked_on: NO_LOOP |
`;

describe("parseAuthority", () => {
  it("reads the three rungs in order", () => {
    const a = parseAuthority(MD);
    expect(a.rungs.map((r) => r.rung)).toEqual([1, 2, 3]);
    expect(a.rungs[0].name).toBe("read-only");
    expect(a.rungs[2].gate).toBe("Prez, per action");
  });

  it("reads actors with their rung and status, stripping code ticks", () => {
    const a = parseAuthority(MD);
    expect(a.actors.find((x) => x.actor === "executor")).toMatchObject({ rung: 2, status: "ACTIVE" });
    expect(a.actors.find((x) => x.actor === "SEAT-001")).toMatchObject({ rung: 2, status: "DEFERRED" });
  });

  it("requires the mission executor to be present — L5 names it explicitly", () => {
    expect(() => parseAuthority(MD.replace(/^\| `executor`.*$/m, ""))).toThrow(/executor/i);
  });

  it("rejects an actor whose rung is not a defined rung", () => {
    expect(() => parseAuthority(MD.replace("| `SEAT-003` | 3 |", "| `SEAT-003` | 9 |"))).toThrow(/rung 9/i);
  });

  it("rejects a deferred actor with no stated reason — deferral must carry a why", () => {
    expect(() => parseAuthority(MD.replace("blocked_on: NO_LOOP", ""))).toThrow(/blocked_on/i);
  });
});

describe("findUnrungedActors", () => {
  it("names charters that have no entry in the ladder", () => {
    const a = parseAuthority(MD);
    expect(findUnrungedActors(a, ["SEAT-001", "SEAT-002"])).toEqual(["SEAT-002"]);
  });

  it("returns empty when every charter is runged", () => {
    const a = parseAuthority(MD);
    expect(findUnrungedActors(a, ["SEAT-001", "SEAT-003"])).toEqual([]);
  });
});

describe("the REAL os/agents/AUTHORITY.md", () => {
  const root = resolve(__dirname, "../..");
  const md = readFileSync(resolve(root, "os/agents/AUTHORITY.md"), "utf-8");

  it("parses and satisfies every invariant", () => {
    const a = parseAuthority(md);
    expect(a.rungs.length).toBeGreaterThanOrEqual(3);
    expect(a.actors.length).toBeGreaterThan(0);
  });

  it("gives the mission executor an explicit rung — doctrine L5 requires it by name", () => {
    const exec = parseAuthority(md).actors.find((x) => x.actor === "executor");
    expect(exec).toBeDefined();
    // The executor must NOT hold the irreversible rung.
    expect(exec!.rung).toBeLessThan(3);
  });

  it("keeps merge-to-main and deploy at the human-gated rung", () => {
    const top = parseAuthority(md).rungs.find((r) => r.rung === 3)!;
    expect(top.mayDo.toLowerCase()).toContain("merge to `main`".toLowerCase().replace(/`/g, ""));
    expect(top.gate.toLowerCase()).toContain("prez");
  });

  it("states what it cannot enforce — a ladder that overstates its power is worse than none", () => {
    expect(md).toMatch(/cannot enforce/i);
    expect(md).toMatch(/required_approving_review_count.*0/);
  });

  it("has a JSON mirror that is in sync (regenerate with scripts/os/authority-sync.mjs)", () => {
    const jsonPath = resolve(root, "os/agents/authority.json");
    expect(existsSync(jsonPath)).toBe(true);
    const mirror = JSON.parse(readFileSync(jsonPath, "utf-8"));
    const parsed = parseAuthority(md);
    expect(mirror.rungs).toEqual(parsed.rungs);
    expect(mirror.actors).toEqual(parsed.actors);
  });

  it("rungs every charter that exists — no seat may act without a rung (L4)", () => {
    const chartersDir = resolve(root, "os/agents/charters");
    const ids = existsSync(chartersDir)
      ? readdirSync(chartersDir)
          .filter((f) => f.startsWith("SEAT-"))
          .map((f) => f.split("-").slice(0, 2).join("-"))
      : [];
    expect(findUnrungedActors(parseAuthority(md), ids)).toEqual([]);
  });
});
