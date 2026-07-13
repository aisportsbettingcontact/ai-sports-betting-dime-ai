import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Regression guard for the simulation-count claim.
 *
 * Defect (P1): the marketing landing surface stated "10,000 simulations per
 * game" while the Monte Carlo engine (server/MLBAIModel.py) runs 400,000 and
 * the feed cards say "400K" — a 40x understatement and a self-contradiction
 * across surfaces. These tests lock every user-facing surface to the engine
 * truth so the copies cannot drift apart again.
 */

const repoRoot = path.resolve(import.meta.dirname, "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8");
}

describe("simulation-count claim consistency", () => {
  it("MLB engine runs 400,000 simulations", () => {
    const py = read("server/MLBAIModel.py");
    expect(py).toMatch(/SIMULATIONS\s*=\s*400_000/);
  });

  const userFacingFiles = [
    "client/src/pages/dime/landing/landing-content.ts",
    "client/src/pages/dime/landing/components/Hero.tsx",
    "client/src/pages/dime/landing/components/MarketConsole.tsx",
    // 2026-07-13 audit: these two SEO surfaces drifted to "10,000" because the
    // guard didn't cover them. Crawlers index them — they must match the engine.
    "client/index.html",
    "server/landingPrerender.ts",
  ];

  for (const rel of userFacingFiles) {
    it(`${rel} contains no "10,000 simulations" claim`, () => {
      const src = read(rel);
      expect(src).not.toMatch(/10,000\s+simulations/i);
      expect(src).not.toMatch(/10,000_(?:PER_GAME|sims)/i);
      expect(src).not.toMatch(/ten thousand simulations/i);
    });
  }

  it("landing states 400,000 simulations per game", () => {
    const src = read("client/src/pages/dime/landing/landing-content.ts");
    expect(src).toMatch(/400,000 simulations/);
    // The headline "Simulations per game" stat value must be 400,000.
    expect(src).toMatch(/value:\s*"400,000"/);
  });

  it("schema documentation no longer references the stale 250k figure", () => {
    const schema = read("drizzle/schema.ts");
    expect(schema).not.toMatch(/250k simulations/i);
  });
});
